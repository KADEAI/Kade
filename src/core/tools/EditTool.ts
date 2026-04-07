import fs from "fs/promises";
import path from "path";
import { getReadablePath } from "../../utils/path";
import { isPathOutsideWorkspace } from "../../utils/pathUtils";
import { Task } from "../task/Task";
import {
  buildAppliedEditBlocksFromContents,
  formatNativeEditResult,
  formatResponse,
  inferEditHistorySyntax,
  isEditHistoryPlaceholder,
} from "../prompts/responses";
import { ClineSayTool } from "../../shared/ExtensionMessage";
import { RecordSource } from "../context-tracking/FileContextTrackerTypes";
import { fileExistsAtPath } from "../../utils/fs";
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types";
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments";
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats";
import { BaseTool, ToolCallbacks } from "./BaseTool";
import type { ToolUse } from "../../shared/tools";
import { normalizeLineEndings_kilocode } from "./kilocode/normalizeLineEndings";
import { findLastIndex } from "../../shared/array";
import {
  stripLineNumbers,
  stripMarkdown,
} from "../../integrations/misc/extract-text";
import { formatWithPrettier } from "./helpers/formatWithPrettier";

// --- Types & Interfaces from New Tool ---

export interface EditBlock {
  oldText: string;
  newText: string;
  start_line?: number;
  end_line?: number;
  range?: [number, number]; // kade_change: Support [start, end]
  replaceAll?: boolean;
  type?: "line_deletion" | "search_replace";
}

interface EditToolParams {
  path: string;
  file_path?: string; // legacy support
  edit: Array<EditBlock | string> | string;
  edits?: Array<EditBlock | string> | string; // legacy support
}

interface SimilarMatch {
  lineNumber: number;
  content: string;
  similarity: number;
}

const DEFAULT_FUZZY_MATCH_THRESHOLD = 0.8;

const normalizeLineEndings = (text: string, useCrLf: boolean): string => {
  return useCrLf
    ? text.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n")
    : text.replace(/\r\n/g, "\n");
};

// WHITESPACE CHAOS NORMALIZATION: Aggressively normalize whitespace for fuzzy matching
// This allows matching even when AI provides completely wrong indentation/spacing
const normalizeWhitespaceForMatching = (text: string): string => {
  return (
    text
      // Normalize line endings
      .replace(/\r\n/g, "\n")
      // Convert tabs to spaces
      .replace(/\t/g, "    ")
      // Remove trailing whitespace from each line
      .replace(/[ \t]+$/gm, "")
      // Collapse multiple spaces to single space (but preserve line structure)
      .replace(/[ ]{2,}/g, " ")
      // Remove leading whitespace from each line (normalize indentation away)
      .replace(/^[ \t]+/gm, "")
      // Remove blank lines
      .replace(/\n\s*\n/g, "\n")
      // Trim
      .trim()
  );
};

const stripLeadingEditLabelFromFirstNonEmptyLine = (
  text: string,
  label: "old" | "new",
  useCrLf: boolean,
): string => {
  const pattern =
    label === "old"
      ? /^(\s*)old(?:\s*:|\s+)(.*)$/i
      : /^(\s*)new(?:\s*:|\s+)(.*)$/i;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) {
      continue;
    }

    const match = lines[i].match(pattern);
    if (!match) {
      return text;
    }

    lines[i] = `${match[1]}${match[2]}`;
    return normalizeLineEndings(lines.join("\n"), useCrLf);
  }

  return text;
};

const normalizeAccidentalLeadingOldNewPair = (
  oldText: string,
  newText: string,
  useCrLf: boolean,
): { oldText: string; newText: string; normalized: boolean } => {
  const strippedOldText = stripLeadingEditLabelFromFirstNonEmptyLine(
    oldText,
    "old",
    useCrLf,
  );
  if (strippedOldText === oldText) {
    return { oldText, newText, normalized: false };
  }

  const strippedNewText = stripLeadingEditLabelFromFirstNonEmptyLine(
    newText,
    "new",
    useCrLf,
  );
  if (strippedNewText === newText) {
    return { oldText, newText, normalized: false };
  }

  return {
    oldText: strippedOldText,
    newText: strippedNewText,
    normalized: true,
  };
};

const decodeCompactEditEscape = (
  input: string,
  index: number,
): { value: string; consumed: number } => {
  const nextChar = input[index + 1];
  if (nextChar === undefined) {
    return { value: "\\", consumed: 1 };
  }

  if (input.startsWith("\\->", index)) {
    return { value: "->", consumed: 3 };
  }

  switch (nextChar) {
    case "n":
      return { value: "\n", consumed: 2 };
    case "r":
      return { value: "\r", consumed: 2 };
    case "t":
      return { value: "\t", consumed: 2 };
    case "\\":
    case '"':
    case "'":
    case "`":
    case "→":
      return { value: nextChar, consumed: 2 };
    default:
      return { value: `\\${nextChar}`, consumed: 2 };
  }
};

const decodeCompactEditContent = (value: string): string => {
  let decoded = "";

  for (let index = 0; index < value.length; ) {
    if (value[index] !== "\\") {
      decoded += value[index];
      index++;
      continue;
    }

    const escape = decodeCompactEditEscape(value, index);
    decoded += escape.value;
    index += escape.consumed;
  }

  return decoded;
};

/** Parses "12", "12-15", "12 - 15" style read/edit range hints. */
export const parseLineRangeFromString = (
  value: string,
): { start: number; end: number } | null => {
  const m = value.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!m) {
    return null;
  }
  const start = parseInt(m[1], 10);
  const end = m[2] !== undefined ? parseInt(m[2], 10) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return { start, end };
};

/**
 * Removes a duplicated compact-range prefix (e.g. "108-110|") from edit text when it matches
 * the already-parsed line hint. Models often paste `lineRange|...` into oldText while also
 * sending lineRange in JSON, producing `108-110|108-110|code` in the compact form.
 */
export const stripRedundantLineRangePipePrefix = (
  text: string,
  rangeStart: number,
  rangeEnd: number,
  options?: {
    allowAnyLeadingRangePrefix?: boolean;
  },
): string => {
  if (!text) {
    return text;
  }
  const prefixMatch = text.match(
    /^\s*(?:\d+\+?\s+)?(\d+)(?:\s*[-–]\s*(\d+))?\s*\|/,
  );
  if (!prefixMatch) {
    return text;
  }

  const parsedStart = parseInt(prefixMatch[1], 10);
  const parsedEnd = parseInt(prefixMatch[2] || prefixMatch[1], 10);
  const matchesHint = parsedStart === rangeStart && parsedEnd === rangeEnd;
  if (!matchesHint && !options?.allowAnyLeadingRangePrefix) {
    return text;
  }

  return text.slice(prefixMatch[0].length);
};

const findCompactEditSeparator = (
  input: string,
): { index: number; length: number } | null => {
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === "\\") {
      const escape = decodeCompactEditEscape(input, index);
      index += escape.consumed - 1;
      continue;
    }

    if (char === "→") {
      return { index, length: 1 };
    }

    if (char === "-" && input[index + 1] === ">") {
      return { index, length: 2 };
    }
  }

  return null;
};

const parseCompactEditString = (value: string): EditBlock | null => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (!normalized) {
    return null;
  }

  let payload = normalized;
  let start_line: number | undefined;
  let end_line: number | undefined;

  const pipeIndex = normalized.indexOf("|");
  if (pipeIndex !== -1) {
    let rangeCandidate = normalized.slice(0, pipeIndex).trim();
    // IDE gutter like "110→108-110" before the pipe — keep only the range segment
    rangeCandidate = rangeCandidate.replace(/^\d+\s*→\s*/, "");
    const rangeMatch = rangeCandidate.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (rangeMatch) {
      start_line = parseInt(rangeMatch[1], 10);
      end_line = parseInt(rangeMatch[2] || rangeMatch[1], 10);
      payload = normalized.slice(pipeIndex + 1);
      payload = stripRedundantLineRangePipePrefix(
        payload,
        start_line,
        end_line,
      );
    }
  }

  const separator = findCompactEditSeparator(payload);
  if (!separator) {
    return null;
  }

  return {
    oldText: decodeCompactEditContent(payload.slice(0, separator.index)),
    newText: decodeCompactEditContent(
      payload.slice(separator.index + separator.length),
    ),
    start_line,
    end_line,
  };
};

const parseQuotedCompactEditLines = (
  rawEdits: string,
  options?: {
    allowTrailingPartialLine?: boolean;
  },
): EditBlock[] | null => {
  const lines = rawEdits
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const blocks: EditBlock[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const firstChar = line[0];
    if (!(firstChar === '"' || firstChar === "'" || firstChar === "`")) {
      return null;
    }

    const lastChar = line[line.length - 1];
    if (lastChar !== firstChar) {
      const isTrailingLine = index === lines.length - 1;
      if (options?.allowTrailingPartialLine && isTrailingLine) {
        return blocks;
      }
      return null;
    }

    let slashCount = 0;
    for (
      let index = line.length - 2;
      index >= 0 && line[index] === "\\";
      index--
    ) {
      slashCount++;
    }
    if (slashCount % 2 === 1) {
      const isTrailingLine = index === lines.length - 1;
      if (options?.allowTrailingPartialLine && isTrailingLine) {
        return blocks;
      }
      return null;
    }

    const parsed = parseCompactEditString(line.slice(1, -1));
    if (!parsed) {
      return null;
    }
    blocks.push(parsed);
  }

  return blocks;
};

const tryParseCompactEditBlocks = (
  rawEdits: string,
  options?: {
    allowTrailingPartialLine?: boolean;
  },
): EditBlock[] | null => {
  const normalized = rawEdits.trim();
  if (!normalized) {
    return null;
  }

  const looksLikeStructuredEditProtocol = (value: string): boolean => {
    const normalizedValue = value.replace(/\r\n/g, "\n").trim();
    if (!normalizedValue) {
      return false;
    }

    const hasSearchHeader =
      /(^|\n)\s*(?:SEARCH|old|oldText|oldtxt|otxt)(?:[\t ]*(?:\[\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\]|\(\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\)|\d+(?:(?:[-]|,[\t ]*)\d+)?))?\s*:/i.test(
        normalizedValue,
      );
    const hasReplaceHeader =
      /(^|\n)\s*(?:REPLACE|new|newText|newtxt|ntxt)(?:[\t ]*(?:\[\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\]|\(\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\)|\d+(?:(?:[-]|,[\t ]*)\d+)?))?\s*:/i.test(
        normalizedValue,
      );

    return hasSearchHeader && hasReplaceHeader;
  };

  const decodeEscapedStructuredEditPayload = (
    value: string,
  ): string | null => {
    const candidates = [value];
    const firstChar = value[0];
    const lastChar = value[value.length - 1];
    if (
      value.length >= 2 &&
      (firstChar === '"' || firstChar === "'" || firstChar === "`") &&
      lastChar === firstChar
    ) {
      candidates.push(value.slice(1, -1));
    }

    for (const candidate of candidates) {
      const decoded = decodeCompactEditContent(candidate);
      if (looksLikeStructuredEditProtocol(decoded)) {
        return decoded;
      }
    }

    return null;
  };

  if (looksLikeStructuredEditProtocol(normalized)) {
    return null;
  }

  const decodedStructuredPayload = decodeEscapedStructuredEditPayload(normalized);
  if (decodedStructuredPayload) {
    return null;
  }

  const quotedBlocks = parseQuotedCompactEditLines(normalized, options);
  if (quotedBlocks !== null) {
    return quotedBlocks;
  }

  const singleBlock = parseCompactEditString(normalized);
  return singleBlock ? [singleBlock] : null;
};

const isOptionalFormatterPunctuation = (
  token: string,
  nextToken?: string,
): boolean =>
  (token === ";" && nextToken === "}") ||
  (token === "," &&
    (nextToken === ")" || nextToken === "]" || nextToken === "}"));

const dropOptionalFormatterTokens = (tokens: string[]): string[] =>
  tokens.filter(
    (token, index) => !isOptionalFormatterPunctuation(token, tokens[index + 1]),
  );

// --- New Token-Based Matching Logic ---

interface Token {
  text: string;
  start: number;
  end: number;
}

const tokenize = (text: string, startOffset: number = 0): Token[] => {
  const tokens: Token[] = [];
  // Capture:
  // 1. Horizontal whitespace at start of line (Indentation)
  // 2. Words/numbers (\w+)
  // 3. Newlines and their following indentation (folded if necessary)
  // 4. Single non-word/non-space symbols (matched individually to avoid clumping quotes with parens)

  const regex = /(?:^|[\r\n])([ \t]+)|\w+|(?:\r?\n)+|[^\s\w]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let tokenText = match[0];

    // If it's a newline sequence, normalize to '\n'
    if (/^[\r\n]+$/.test(tokenText)) {
      tokenText = "\n";
    }

    // Indentation token (leading spaces/tabs)
    // We treat it as a special token to help disambiguate blocks
    if (match[1]) {
      // Prepend a special marker or just keep the whitespace
      // Keeping it as-is is best for exact-ish matching
      tokenText = match[1];
    } else if (/^\s+$/.test(tokenText) && !tokenText.includes("\n")) {
      // Skip internal single spaces/tabs between code tokens
      continue;
    }

    // Quote normalization: treat ', ", and ` as equivalent tokens for matching
    if (tokenText === "'" || tokenText === '"' || tokenText === "`") {
      tokenText = '"';
    }

    tokens.push({
      text: tokenText,
      start: startOffset + match.index,
      end: startOffset + match.index + match[0].length,
    });
  }
  return tokens;
};

const getLineIndentation = (content: string, index: number): string => {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  let indentation = "";
  for (let i = lineStart; i < content.length; i++) {
    if (content[i] === " " || content[i] === "\t") {
      indentation += content[i];
    } else {
      break;
    }
  }
  return indentation;
};

const getIndentationWidth = (indentation: string): number => {
  let width = 0;
  for (const char of indentation) {
    width += char === "\t" ? 4 : 1;
  }
  return width;
};

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
};

const detectIndentationQuantum = (content: string): number => {
  const lines = content.split(/\r?\n/);
  const indentWidths = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ \t]*/)?.[0] ?? "")
    .filter((indentation) => indentation.length > 0)
    .map(getIndentationWidth)
    .filter((width) => width > 0);

  if (indentWidths.length === 0) {
    return 4;
  }

  let quantum = indentWidths[0];
  for (const width of indentWidths.slice(1)) {
    quantum = gcd(quantum, width);
  }

  if (quantum > 1) {
    return quantum;
  }

  const uniqueSorted = [...new Set(indentWidths)].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < uniqueSorted.length; i++) {
    const delta = uniqueSorted[i] - uniqueSorted[i - 1];
    if (delta > 0) {
      deltas.push(delta);
    }
  }

  const preferred = deltas
    .filter((delta) => delta > 1)
    .sort((a, b) => {
      const countDiff =
        deltas.filter((candidate) => candidate === b).length -
        deltas.filter((candidate) => candidate === a).length;
      return countDiff !== 0 ? countDiff : a - b;
    })[0];

  return preferred ?? 4;
};

const isControlFlowOpener = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.endsWith(":") ||
    trimmed.endsWith("{") ||
    /\b(then|do)\s*$/i.test(trimmed)
  );
};

const isDedentLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.startsWith("</") ||
    /^[\]\)\}]/.test(trimmed) ||
    /^(else|elif|except|finally|catch)\b/.test(trimmed)
  );
};

const getBracketBalance = (line: string): number => {
  let balance = 0;
  for (const char of line) {
    if (char === "(" || char === "[" || char === "{") {
      balance++;
    } else if (char === ")" || char === "]" || char === "}") {
      balance--;
    }
  }
  return balance;
};

const getTagBalance = (line: string): number => {
  const trimmed = line.trim();
  if (
    !trimmed ||
    !/<\/?[A-Za-z]/.test(trimmed) ||
    !(
      trimmed.startsWith("<") ||
      /\breturn\s*</.test(trimmed) ||
      /=\s*</.test(trimmed) ||
      /[({[,]\s*</.test(trimmed)
    )
  ) {
    return 0;
  }

  const tagRegex = /<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*?)?(\/?)>/g;
  let match: RegExpExecArray | null;
  let balance = 0;

  while ((match = tagRegex.exec(trimmed)) !== null) {
    const fullMatch = match[0];
    const isClosing = fullMatch.startsWith("</");
    const isSelfClosing =
      match[2] === "/" ||
      fullMatch.endsWith("/>") ||
      /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(
        fullMatch,
      );

    if (isClosing) {
      balance--;
    } else if (!isSelfClosing) {
      balance++;
    }
  }

  return balance;
};

const startsUnclosedOpeningTag = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("</")) {
    return false;
  }

  const tagStartMatch = trimmed.match(/^<([A-Za-z][\w:-]*)(?:\s[^<>]*)?$/);
  if (!tagStartMatch) {
    return false;
  }

  return !trimmed.endsWith(">") && !trimmed.endsWith("/>");
};

const closesTagContinuation = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.endsWith(">") && !trimmed.startsWith("</");
};

const opensContainerContinuation = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /[([{]\s*$/.test(trimmed) || getBracketBalance(trimmed) > 0;
};

const opensTagStructure = (line: string): boolean => getTagBalance(line) > 0;

const opensStructuralDepth = (line: string): boolean =>
  isControlFlowOpener(line) ||
  opensContainerContinuation(line) ||
  opensTagStructure(line) ||
  startsUnclosedOpeningTag(line);

const getRelativeIndentationLevels = (text: string): number[] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const baseIndent = getIndentationWidth(lines[0].match(/^[ \t]*/)?.[0] ?? "");
  return lines.map((line) => {
    const currentIndent = getIndentationWidth(line.match(/^[ \t]*/)?.[0] ?? "");
    return currentIndent - baseIndent;
  });
};

const getLineContents = (text: string): string[] => {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
};

const isStaircaseBlock = (text: string, quantum: number): boolean => {
  const levels = getRelativeIndentationLevels(text);
  if (levels.length < 2) {
    return false;
  }

  return levels.some((level) => level >= quantum);
};

const snapRelativeIndentation = (relative: number, quantum: number): number => {
  if (relative === 0) {
    return 0;
  }

  const snapped = Math.round(relative / quantum) * quantum;
  if (snapped === 0) {
    return relative > 0 ? quantum : -quantum;
  }

  return snapped;
};

const isPythonLikeBlock = (text: string): boolean =>
  /^\s*(def|class)\b/m.test(text);

const isJavaScriptLikeBlock = (text: string): boolean =>
  /\b(function|const|let|var|async function)\b/.test(text) ||
  /[{};]/.test(text);

const isJavaScriptFunctionDeclaration = (line: string): boolean =>
  /^(?:async\s+)?function\b/.test(line.trim());

const normalizeObviousPythonisms = (text: string): string =>
  text
    .replace(/\bconsole\.log\s*\(/g, "print(")
    .replace(/\breturn\s+true\b/g, "return True")
    .replace(/\breturn\s+false\b/g, "return False");

const normalizePythonTopLevelScopes = (
  text: string,
  useCrLf: boolean,
): string => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const result: string[] = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i];
    const nextTrimmed = lines[i + 1]?.trim() ?? "";

    if (!trimmed) {
      result.push("");
      continue;
    }

    let currentLevel = indentLevel;
    if (/^(def|class)\b/.test(trimmed)) {
      currentLevel = 0;
    } else if (
      /^(return|pass|break|continue|raise)\b/.test(trimmed) &&
      /^(def|class)\b/.test(nextTrimmed)
    ) {
      currentLevel = 1;
    }

    result.push(" ".repeat(currentLevel * 4) + trimmed);

    if (/^(def|class)\b/.test(nextTrimmed)) {
      indentLevel = 0;
      continue;
    }

    if (trimmed.endsWith(":")) {
      indentLevel = currentLevel + 1;
    } else if (/^(return|pass|break|continue|raise)\b/.test(trimmed)) {
      indentLevel = Math.max(1, currentLevel);
    } else {
      indentLevel = currentLevel;
    }
  }

  return result.join(useCrLf ? "\r\n" : "\n");
};

const repairNestedPythonBlockIndentation = (
  text: string,
  matchedText: string,
  fileIndentation: string,
  useCrLf: boolean,
): string => {
  const oldRelativeLevels = getRelativeIndentationLevels(matchedText);
  const oldNonEmptyLines = getLineContents(matchedText);
  const bodyRelative = oldRelativeLevels
    .filter((level) => level > 0)
    .sort((a, b) => a - b)[0];
  const dedentRelative = oldRelativeLevels
    .filter((level, index) => isDedentLine(oldNonEmptyLines[index] ?? ""))
    .sort((a, b) => a - b)[0];

  if (bodyRelative === undefined) {
    return text;
  }

  const baseFileIndentWidth = getIndentationWidth(fileIndentation);
  const quantum = Math.max(1, detectIndentationQuantum(matchedText));
  const lines = text.split(/\r?\n/);
  const nonEmptyIndexes = lines
    .map((line, index) => (line.trim().length > 0 ? index : -1))
    .filter((index) => index >= 0);
  const lastNonEmptyIndex = nonEmptyIndexes.at(-1) ?? -1;
  const trimmedByIndex = lines.map((line) => line.trim());

  let previousTrimmedLine = "";
  let previousAdjustedRelative = 0;

  const transformed = lines.map((line, index) => {
    const trimmed = trimmedByIndex[index];
    if (!trimmed) {
      return "";
    }

    const nextTrimmed =
      trimmedByIndex[
        nonEmptyIndexes.find((candidate) => candidate > index) ?? -1
      ] ?? "";
    let adjustedRelative = Math.max(
      0,
      getIndentationWidth(line.match(/^[ \t]*/)?.[0] ?? "") -
        baseFileIndentWidth,
    );

    if (/^(def|class)\b/.test(trimmed)) {
      adjustedRelative = Math.max(0, bodyRelative - quantum);
    } else if (isDedentLine(trimmed)) {
      adjustedRelative =
        dedentRelative ?? Math.max(0, previousAdjustedRelative - quantum);
    } else if (
      previousTrimmedLine &&
      isControlFlowOpener(previousTrimmedLine)
    ) {
      adjustedRelative = previousAdjustedRelative + quantum;
    } else if (
      isControlFlowOpener(trimmed) &&
      previousAdjustedRelative > bodyRelative
    ) {
      adjustedRelative = Math.max(
        bodyRelative,
        previousAdjustedRelative - quantum,
      );
    } else if (
      /^(return|pass|break|continue|raise)\b/.test(trimmed) &&
      (index === lastNonEmptyIndex || /^(def|class)\b/.test(nextTrimmed))
    ) {
      adjustedRelative = bodyRelative;
    } else if (
      previousTrimmedLine &&
      !isControlFlowOpener(previousTrimmedLine) &&
      adjustedRelative > previousAdjustedRelative
    ) {
      adjustedRelative = previousAdjustedRelative;
    }

    previousTrimmedLine = trimmed;
    previousAdjustedRelative = adjustedRelative;
    return " ".repeat(baseFileIndentWidth + adjustedRelative) + trimmed;
  });

  return transformed.join(useCrLf ? "\r\n" : "\n");
};

const hoistImmediateNestedJsHelpers = (
  text: string,
  useCrLf: boolean,
): string => {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 2; i++) {
    const controlLine = lines[i];
    const controlTrimmed = controlLine.trim();
    if (!isControlFlowOpener(controlTrimmed)) {
      continue;
    }

    const controlIndent = getIndentationWidth(
      controlLine.match(/^[ \t]*/)?.[0] ?? "",
    );
    const functionLineIndex = i + 1;
    const functionTrimmed = lines[functionLineIndex].trim();
    if (!isJavaScriptFunctionDeclaration(functionTrimmed)) {
      continue;
    }

    let functionEndIndex = functionLineIndex;
    let functionBraceDepth = 0;
    for (; functionEndIndex < lines.length; functionEndIndex++) {
      functionBraceDepth += getBracketBalance(lines[functionEndIndex].trim());
      if (functionBraceDepth <= 0 && functionEndIndex > functionLineIndex) {
        break;
      }
    }

    const callLineIndex = functionEndIndex + 1;
    const blockEndIndex = callLineIndex + 1;
    if (callLineIndex >= lines.length || blockEndIndex >= lines.length) {
      continue;
    }

    const callTrimmed = lines[callLineIndex].trim();
    if (
      !/^[A-Za-z_$][\w$]*\s*\(/.test(callTrimmed) ||
      lines[blockEndIndex].trim() !== "}"
    ) {
      continue;
    }

    const hoistedIndent = " ".repeat(controlIndent);
    const bodyIndent = " ".repeat(controlIndent + 4);
    const functionLines = lines
      .slice(functionLineIndex, functionEndIndex + 1)
      .map((line, offset) => {
        const trimmed = line.trim();
        return (offset === 0 ? hoistedIndent : bodyIndent) + trimmed;
      });

    lines.splice(
      i,
      blockEndIndex - i + 1,
      ...functionLines,
      hoistedIndent + controlTrimmed,
      bodyIndent + callTrimmed,
      hoistedIndent + "}",
    );
    i += functionLines.length;
  }

  return lines.join(useCrLf ? "\r\n" : "\n");
};

const deconflictDuplicateJsDeclarations = (
  text: string,
  useCrLf: boolean,
): string => {
  const lines = text.split(/\r?\n/);
  const renameMap = new Map<string, string>();
  const counts = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^(\s*)(const|let|var)\s+([A-Za-z_$][\w$]*)\b(.*)$/,
    );
    if (!match) {
      continue;
    }

    const [, indent, keyword, name, rest] = match;
    const nextCount = (counts.get(name) ?? 0) + 1;
    counts.set(name, nextCount);

    if (nextCount === 1) {
      continue;
    }

    const renamed = `${name}_${nextCount}`;
    renameMap.set(name, renamed);
    lines[i] = `${indent}${keyword} ${renamed}${rest}`;
  }

  if (renameMap.size === 0) {
    return text;
  }

  return lines
    .map((line) => {
      if (/^\s*(const|let|var)\s+/.test(line)) {
        return line;
      }

      let updated = line;
      for (const [original, renamed] of renameMap) {
        updated = updated.replace(
          new RegExp(`\\b${original}\\b`, "g"),
          renamed,
        );
      }
      return updated;
    })
    .join(useCrLf ? "\r\n" : "\n");
};

const postProcessHeuristicOutput = (
  text: string,
  matchedText: string,
  fileContent: string,
  fileIndentation: string,
  isAtLineStart: boolean,
  useCrLf: boolean,
): string => {
  let output = text;

  if (isPythonLikeBlock(fileContent) || isPythonLikeBlock(matchedText)) {
    output = normalizeObviousPythonisms(output);
    if (isAtLineStart && getIndentationWidth(fileIndentation) > 0) {
      output = repairNestedPythonBlockIndentation(
        output,
        matchedText,
        fileIndentation,
        useCrLf,
      );
    } else if (isAtLineStart && getIndentationWidth(fileIndentation) === 0) {
      output = normalizePythonTopLevelScopes(output, useCrLf);
    }
  }

  if (
    isJavaScriptLikeBlock(fileContent) ||
    isJavaScriptLikeBlock(matchedText)
  ) {
    output = hoistImmediateNestedJsHelpers(output, useCrLf);
    output = deconflictDuplicateJsDeclarations(output, useCrLf);
  }

  return output;
};

const applyIndentationHeuristics = (
  replaceString: string,
  fileIndentation: string,
  matchedText: string,
  fileContent: string,
  isAtLineStart: boolean,
  useCrLf: boolean,
): string => {
  const replacementLines = replaceString.split(/\r?\n/);
  let aiBaseline: string | null = null;
  for (const line of replacementLines) {
    if (line.trim().length > 0) {
      aiBaseline = line.match(/^\s*/)?.[0] || "";
      break;
    }
  }

  if (aiBaseline === null) {
    return replaceString;
  }

  const quantum = detectIndentationQuantum(fileContent);
  const baseFileIndentWidth = getIndentationWidth(fileIndentation);
  const aiBaselineWidth = getIndentationWidth(aiBaseline);
  const oldBlockWasStaircase = isStaircaseBlock(matchedText, quantum);
  const oldRelativeLevels = getRelativeIndentationLevels(matchedText);
  const oldNonEmptyLines = getLineContents(matchedText);

  const rawRelativeLevels = replacementLines.map((line) => {
    if (line.trim().length === 0) {
      return null;
    }
    const currentIndent = getIndentationWidth(line.match(/^\s*/)?.[0] ?? "");
    return currentIndent - aiBaselineWidth;
  });

  const nonZeroRawLevels = rawRelativeLevels.filter(
    (level): level is number => level !== null && level !== 0,
  );
  const lazyFlatInput =
    oldBlockWasStaircase &&
    replacementLines.filter((line) => line.trim().length > 0).length > 1 &&
    (nonZeroRawLevels.length === 0 ||
      nonZeroRawLevels.every((level) => Math.abs(level) < quantum));
  const structureSignalsPresent = replacementLines.some(
    (line) =>
      line.trim().length > 0 &&
      (opensStructuralDepth(line) || isDedentLine(line)),
  );
  const structuralInferenceInput =
    structureSignalsPresent &&
    replacementLines.filter((line) => line.trim().length > 0).length > 1 &&
    (nonZeroRawLevels.length === 0 ||
      nonZeroRawLevels.every((level) => Math.abs(level) < quantum));
  const canUseOldScaffold =
    lazyFlatInput &&
    oldRelativeLevels.length > 0 &&
    oldNonEmptyLines.length ===
      replacementLines.filter((line) => line.trim().length > 0).length;
  const shouldRunLanguageSpecificPostProcessing =
    lazyFlatInput || structuralInferenceInput;

  let previousAppliedRelative = 0;
  let previousTrimmedLine = "";
  let scaffoldIndex = 0;
  let structuralDepth = 0;
  let tagContinuationActive = false;

  const transformed = replacementLines.map((line, i) => {
    if (i === 0 && !isAtLineStart) {
      if (canUseOldScaffold && line.trim().length > 0) {
        scaffoldIndex++;
      }
      previousTrimmedLine = line.trim();
      return line;
    }

    if (line.trim().length === 0) {
      return "";
    }

    const contentWithoutIndent = line.trimStart();
    const rawRelative = rawRelativeLevels[i] ?? 0;
    if (structuralInferenceInput && isDedentLine(contentWithoutIndent)) {
      structuralDepth = Math.max(0, structuralDepth - quantum);
    }

    let appliedRelative = canUseOldScaffold
      ? (oldRelativeLevels[scaffoldIndex] ??
        snapRelativeIndentation(rawRelative, quantum))
      : snapRelativeIndentation(rawRelative, quantum);
    scaffoldIndex++;

    if (structuralInferenceInput && !canUseOldScaffold) {
      appliedRelative = Math.max(appliedRelative, structuralDepth);
    }

    if (
      lazyFlatInput &&
      i > 0 &&
      !canUseOldScaffold &&
      !structuralInferenceInput
    ) {
      if (isDedentLine(contentWithoutIndent)) {
        appliedRelative = Math.max(0, previousAppliedRelative - quantum);
      } else if (
        isControlFlowOpener(previousTrimmedLine) &&
        appliedRelative <= previousAppliedRelative
      ) {
        appliedRelative = previousAppliedRelative + quantum;
      } else if (
        appliedRelative === 0 &&
        previousAppliedRelative > 0 &&
        !isDedentLine(contentWithoutIndent)
      ) {
        appliedRelative = previousAppliedRelative;
      }
    }

    const targetIndentWidth = Math.max(
      0,
      baseFileIndentWidth + appliedRelative,
    );
    previousAppliedRelative = appliedRelative;
    previousTrimmedLine = contentWithoutIndent;

    if (structuralInferenceInput) {
      const wasTagContinuationActive = tagContinuationActive;
      structuralDepth = appliedRelative;
      if (
        wasTagContinuationActive &&
        closesTagContinuation(contentWithoutIndent)
      ) {
        tagContinuationActive = false;
      }
      if (startsUnclosedOpeningTag(contentWithoutIndent)) {
        tagContinuationActive = true;
      }
      if (opensStructuralDepth(contentWithoutIndent)) {
        structuralDepth += quantum;
      }
    }

    return " ".repeat(targetIndentWidth) + contentWithoutIndent;
  });

  const joined = transformed.join(useCrLf ? "\r\n" : "\n");
  if (!shouldRunLanguageSpecificPostProcessing) {
    return joined;
  }
  return postProcessHeuristicOutput(
    joined,
    matchedText,
    fileContent,
    fileIndentation,
    isAtLineStart,
    useCrLf,
  );
};

const getOffsetsForLineRange = (
  content: string,
  startLine: number,
  endLine: number,
  useCrLf: boolean,
): { startOffset: number; endOffset: number; text: string } | null => {
  if (startLine < 1 || endLine < startLine) {
    return null;
  }

  let currentIdx = 0;
  let currentLine = 1;

  while (currentLine < startLine && currentIdx < content.length) {
    const nextNL = content.indexOf("\n", currentIdx);
    if (nextNL === -1) {
      return null;
    }
    currentIdx = nextNL + 1;
    currentLine++;
  }

  if (currentLine !== startLine) {
    return null;
  }

  const startOffset = currentIdx;
  let linesToConsume = endLine - startLine + 1;

  while (linesToConsume > 0 && currentIdx < content.length) {
    const nextNL = content.indexOf("\n", currentIdx);
    if (nextNL === -1) {
      currentIdx = content.length;
      break;
    }
    currentIdx = nextNL + 1;
    linesToConsume--;
  }

  let endOffset = currentIdx;
  if (endOffset > startOffset && content[endOffset - 1] === "\n") {
    endOffset--;
    if (endOffset > startOffset && content[endOffset - 1] === "\r") {
      endOffset--;
    }
  }

  const text = normalizeLineEndings(
    content.slice(startOffset, endOffset),
    useCrLf,
  );
  return { startOffset, endOffset, text };
};

const findNearbyNormalizedLineRangeMatch = (
  content: string,
  searchText: string,
  startLine: number,
  endLine: number,
  useCrLf: boolean,
  radius: number = 12,
): {
  startOffset: number;
  endOffset: number;
  text: string;
  startLine: number;
  endLine: number;
} | null => {
  const targetLineCount = Math.max(1, endLine - startLine + 1);
  const normalizedSearch = normalizeWhitespaceForMatching(searchText);

  if (!normalizedSearch) {
    return null;
  }

  for (let delta = 0; delta <= radius; delta++) {
    const candidateStarts =
      delta === 0 ? [startLine] : [startLine - delta, startLine + delta];

    for (const candidateStart of candidateStarts) {
      if (candidateStart < 1) {
        continue;
      }

      const candidateEnd = candidateStart + targetLineCount - 1;
      const candidate = getOffsetsForLineRange(
        content,
        candidateStart,
        candidateEnd,
        useCrLf,
      );

      if (!candidate) {
        continue;
      }

      if (normalizeWhitespaceForMatching(candidate.text) === normalizedSearch) {
        return {
          ...candidate,
          startLine: candidateStart,
          endLine: candidateEnd,
        };
      }
    }
  }

  return null;
};

const buildNonWhitespaceTokenSignature = (text: string): string[] =>
  dropOptionalFormatterTokens(
    tokenize(text)
      .map((token) => token.text)
      .filter((token) => token !== "\n" && !/^[ \t]+$/.test(token))
      .map((token) => {
        const trimmed = token.trim();
        if (/^\d+(\.\d+)?$/.test(trimmed)) {
          return "NUM";
        }
        return trimmed.toLowerCase();
      }),
  );

const buildExactNonWhitespaceTokenSignature = (text: string): string[] =>
  dropOptionalFormatterTokens(
    tokenize(text)
      .map((token) => token.text)
      .filter((token) => token !== "\n" && !/^[ \t]+$/.test(token))
      .map((token) => token.trim().toLowerCase()),
  );

const signaturesAreEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
};

const findNearbyTokenEquivalentRangeMatch = (
  content: string,
  searchText: string,
  startLine: number,
  endLine: number,
  useCrLf: boolean,
  radius: number = 40,
): {
  startOffset: number;
  endOffset: number;
  text: string;
  startLine: number;
  endLine: number;
} | null => {
  const searchSignature = buildNonWhitespaceTokenSignature(searchText);

  if (searchSignature.length === 0) {
    return null;
  }

  const targetLineCount = Math.max(1, endLine - startLine + 1);
  const maxExtraLines = Math.max(12, targetLineCount * 6);
  let bestMatch: {
    startOffset: number;
    endOffset: number;
    text: string;
    startLine: number;
    endLine: number;
    score: number;
  } | null = null;

  for (let delta = 0; delta <= radius; delta++) {
    const candidateStarts =
      delta === 0 ? [startLine] : [startLine - delta, startLine + delta];

    for (const candidateStart of candidateStarts) {
      if (candidateStart < 1) {
        continue;
      }

      const maxCandidateLength = targetLineCount + maxExtraLines;

      for (
        let candidateLength = 1;
        candidateLength <= maxCandidateLength;
        candidateLength++
      ) {
        const candidateEnd = candidateStart + candidateLength - 1;
        const candidate = getOffsetsForLineRange(
          content,
          candidateStart,
          candidateEnd,
          useCrLf,
        );

        if (!candidate) {
          break;
        }

        if (
          signaturesAreEqual(
            buildNonWhitespaceTokenSignature(candidate.text),
            searchSignature,
          )
        ) {
          const score =
            Math.abs(candidateStart - startLine) * 1000 +
            Math.abs(candidateLength - targetLineCount);

          if (!bestMatch || score < bestMatch.score) {
            bestMatch = {
              ...candidate,
              startLine: candidateStart,
              endLine: candidateEnd,
              score,
            };
          }

          break;
        }
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  const { score: _score, ...match } = bestMatch;
  return match;
};

const findExactTokenEquivalentRangeMatch = (
  content: string,
  searchText: string,
  useCrLf: boolean,
): {
  startOffset: number;
  endOffset: number;
  text: string;
  startLine: number;
  endLine: number;
} | null => {
  const searchSignature = buildExactNonWhitespaceTokenSignature(searchText);

  if (searchSignature.length === 0) {
    return null;
  }

  const totalLines = content.split(/\r?\n/).length;
  const targetLineCount = Math.max(1, searchText.split(/\r?\n/).length);
  const maxCandidateLength = Math.min(
    totalLines,
    Math.max(targetLineCount + 40, targetLineCount * 6),
  );
  let bestMatch: {
    startOffset: number;
    endOffset: number;
    text: string;
    startLine: number;
    endLine: number;
    score: number;
  } | null = null;
  let isAmbiguous = false;

  for (let candidateStart = 1; candidateStart <= totalLines; candidateStart++) {
    for (
      let candidateLength = 1;
      candidateLength <= maxCandidateLength;
      candidateLength++
    ) {
      const candidateEnd = candidateStart + candidateLength - 1;
      if (candidateEnd > totalLines) {
        break;
      }

      const candidate = getOffsetsForLineRange(
        content,
        candidateStart,
        candidateEnd,
        useCrLf,
      );
      if (!candidate) {
        break;
      }

      if (
        signaturesAreEqual(
          buildExactNonWhitespaceTokenSignature(candidate.text),
          searchSignature,
        )
      ) {
        const score = Math.abs(candidateLength - targetLineCount);
        if (!bestMatch || score < bestMatch.score) {
          bestMatch = {
            ...candidate,
            startLine: candidateStart,
            endLine: candidateEnd,
            score,
          };
          isAmbiguous = false;
        } else if (bestMatch && score === bestMatch.score) {
          isAmbiguous = true;
        }

        break;
      }
    }
  }

  if (!bestMatch || isAmbiguous) {
    return null;
  }

  const { score: _score, ...match } = bestMatch;
  return match;
};

const diagnoseMismatch = (
  searchContent: string,
  fileContent: string,
): string => {
  const searchTokens = tokenize(searchContent);
  const fileTokens = tokenize(fileContent);

  if (searchTokens.length === 0) return "Empty search block.";

  let bestScore = 0;
  let bestIndex = -1;

  if (fileTokens.length > 50000)
    return "File too large for detailed mismatch diagnosis.";

  for (let i = 0; i <= fileTokens.length - searchTokens.length; i++) {
    let score = 0;
    for (let j = 0; j < searchTokens.length; j++) {
      if (fileTokens[i + j].text === searchTokens[j].text) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const bestSimilarity =
    searchTokens.length > 0 ? bestScore / searchTokens.length : 1;

  if (bestIndex !== -1 && bestSimilarity > 0.6) {
    // >60% match
    const startToken = fileTokens[bestIndex];
    const lineNum = fileContent.slice(0, startToken.start).split(/\n/).length;
    const similarityPercent = Math.round(bestSimilarity * 100);

    for (let j = 0; j < searchTokens.length; j++) {
      if (fileTokens[bestIndex + j].text !== searchTokens[j].text) {
        return `Closest match found at line ${lineNum} with ${similarityPercent}% similarity. Mismatch: expected '${searchTokens[j].text}', but found '${fileTokens[bestIndex + j].text}'.`;
      }
    }
    return `Closest match found at line ${lineNum} with ${similarityPercent}% similarity, but it wasn't unique enough for an automatic edit.`;
  }

  return "Please ensure you are providing enough context and that the text matches exactly.";
};

const findBestMatch = (
  searchContent: string,
  fileContent: string,
  startOffset: number,
  useCrLf: boolean,
  lineHint?: number,
): { index: number; matchLength: number } | null => {
  // Strategy 1: Exact Match (Fastest)
  const exactNorm = normalizeLineEndings(searchContent, useCrLf);
  const idx = fileContent.indexOf(exactNorm, startOffset);
  if (idx !== -1) {
    const secondIdx = fileContent.indexOf(exactNorm, idx + 1);
    if (secondIdx === -1) {
      const matchResult = { index: idx, matchLength: exactNorm.length };
      return expandMatchWithIndentation(
        matchResult,
        searchContent,
        fileContent,
        tokenize(fileContent),
        -1,
        -1,
        true,
      );
    }

    // If ambiguous, check if we can disambiguate using lineHint
    if (lineHint !== undefined) {
      const allIndices: number[] = [idx, secondIdx];
      let nextIdx = fileContent.indexOf(exactNorm, secondIdx + 1);
      while (nextIdx !== -1) {
        allIndices.push(nextIdx);
        nextIdx = fileContent.indexOf(exactNorm, nextIdx + 1);
      }

      // Find closest to lineHint
      let bestIdx = -1;
      let minDiff = Infinity;

      for (const matchIdx of allIndices) {
        const matchLine = fileContent.slice(0, matchIdx).split(/\n/).length;
        const diff = Math.abs(matchLine - lineHint);
        if (diff < minDiff) {
          minDiff = diff;
          bestIdx = matchIdx;
        }
      }

      if (bestIdx !== -1) {
        const matchResult = { index: bestIdx, matchLength: exactNorm.length };
        // IMPORTANT: Also expand exact matches to include indentation so getLineIndentation works correctly
        return expandMatchWithIndentation(
          matchResult,
          searchContent,
          fileContent,
          tokenize(fileContent),
          -1,
          -1,
          true,
        );
      }
    }

    // If still ambiguous or no hint, fall through to token matching for robust disambiguation
  }

  // Strategy 2: Token-Based Sequence Match (Robust to whitespace/newlines)
  const searchTokens = tokenize(searchContent);
  const fileTokens = tokenize(fileContent);

  if (searchTokens.length === 0) return null;

  // WHITESPACE CHAOS MODE: Create normalized token sequences for fuzzy comparison
  // This allows matching even when AI provides completely wrong indentation/spacing
  const normalizeTokenSequence = (tokens: Token[]): string[] => {
    return dropOptionalFormatterTokens(
      tokens
        .filter((t) => t.text !== "\n" && !/^[ \t]+$/.test(t.text)) // Remove newlines and pure whitespace tokens
        .map((t) => t.text.trim().toLowerCase()),
    );
  };

  const normalizedSearchTokens = normalizeTokenSequence(searchTokens);
  const normalizedFileTokens = normalizeTokenSequence(fileTokens);

  // Map normalized file tokens back to original token indices
  const normalizedToOriginalMap: number[] = [];
  let normalizedIdx = 0;
  for (let i = 0; i < fileTokens.length; i++) {
    const token = fileTokens[i];
    if (
      token.text !== "\n" &&
      !/^[ \t]+$/.test(token.text) &&
      !isOptionalFormatterPunctuation(
        token.text.trim(),
        fileTokens[i + 1]?.text,
      )
    ) {
      normalizedToOriginalMap[normalizedIdx] = i;
      normalizedIdx++;
    }
  }

  const checkMatch = (fileTokenIdx: number): boolean => {
    for (let i = 0; i < searchTokens.length; i++) {
      if (fileTokenIdx + i >= fileTokens.length) return false;
      if (fileTokens[fileTokenIdx + i].text !== searchTokens[i].text)
        return false;
    }
    return true;
  };

  const checkNormalizedMatch = (normalizedFileIdx: number): boolean => {
    for (let i = 0; i < normalizedSearchTokens.length; i++) {
      if (normalizedFileIdx + i >= normalizedFileTokens.length) return false;
      if (
        normalizedFileTokens[normalizedFileIdx + i] !==
        normalizedSearchTokens[i]
      )
        return false;
    }
    return true;
  };

  const matches: number[] = [];
  const matchMetadata = new Map<
    number,
    { endTokenIdx: number; isNormalized: boolean }
  >();
  let startTokenIdx = 0;
  if (startOffset > 0) {
    startTokenIdx = fileTokens.findIndex((t) => t.start >= startOffset);
    if (startTokenIdx === -1) startTokenIdx = fileTokens.length;
  }

  // STRATEGY 1: Normalized token matching (WHITESPACE CHAOS MODE - PRIMARY)
  // This handles extreme whitespace differences by comparing semantic structure
  if (normalizedSearchTokens.length > 0) {
    for (
      let j = 0;
      j <= normalizedFileTokens.length - normalizedSearchTokens.length;
      j++
    ) {
      if (checkNormalizedMatch(j)) {
        // Map back to original token indices - need BOTH start and end
        const originalStartIdx = normalizedToOriginalMap[j];
        const originalEndIdx =
          normalizedToOriginalMap[j + normalizedSearchTokens.length - 1];
        if (originalStartIdx !== undefined && originalEndIdx !== undefined) {
          matches.push(originalStartIdx);
          matchMetadata.set(originalStartIdx, {
            endTokenIdx: originalEndIdx,
            isNormalized: true,
          });
        }
      }
    }
  }

  // STRATEGY 2: Exact token matching (FALLBACK for when whitespace is already correct)
  if (matches.length === 0) {
    for (
      let j = startTokenIdx;
      j <= fileTokens.length - searchTokens.length;
      j++
    ) {
      if (fileTokens[j].text === searchTokens[0].text) {
        if (checkMatch(j)) {
          matches.push(j);
        }
      }
    }
  }

  // Ambiguity Check
  if (matches.length > 1) {
    if (lineHint !== undefined) {
      let bestMatchIdx = -1;
      let minDiff = Infinity;
      for (const matchIdx of matches) {
        const matchLine = fileContent
          .slice(0, fileTokens[matchIdx].start)
          .split(/\n/).length;
        const diff = Math.abs(matchLine - lineHint);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatchIdx = matchIdx;
        }
      }
      if (bestMatchIdx !== -1) {
        const firstToken = fileTokens[bestMatchIdx];
        const lastToken = fileTokens[bestMatchIdx + searchTokens.length - 1];
        const matchResult = {
          index: firstToken.start,
          matchLength: lastToken.end - firstToken.start,
        };
        return expandMatchWithIndentation(
          matchResult,
          searchContent,
          fileContent,
          fileTokens,
          bestMatchIdx,
          searchTokens.length,
        );
      }
    }
    return null;
  }

  if (matches.length === 1) {
    const matchTokenIdx = matches[0];
    const metadata = matchMetadata.get(matchTokenIdx);
    const firstToken = fileTokens[matchTokenIdx];

    // Use metadata if available (normalized match), otherwise use searchTokens.length (exact match)
    const lastTokenIdx = metadata
      ? metadata.endTokenIdx
      : matchTokenIdx + searchTokens.length - 1;
    const lastToken = fileTokens[lastTokenIdx];
    const tokenCount = metadata
      ? lastTokenIdx - matchTokenIdx + 1
      : searchTokens.length;

    const matchResult = {
      index: firstToken.start,
      matchLength: lastToken.end - firstToken.start,
    };
    return expandMatchWithIndentation(
      matchResult,
      searchContent,
      fileContent,
      fileTokens,
      matchTokenIdx,
      tokenCount,
    );
  }

  return null;
};

const expandMatchWithIndentation = (
  match: { index: number; matchLength: number },
  searchContent: string,
  fileContent: string,
  fileTokens?: Token[],
  matchTokenIdx?: number,
  searchTokenCount?: number,
  forceAlways?: boolean,
): { index: number; matchLength: number } => {
  let matchStart = match.index;
  let matchLength = match.matchLength;

  const lineStart = fileContent.lastIndexOf("\n", matchStart) + 1;
  let onlyWhitespaceBefore = true;
  for (let i = lineStart; i < matchStart; i++) {
    if (fileContent[i] !== " " && fileContent[i] !== "\t") {
      onlyWhitespaceBefore = false;
      break;
    }
  }

  const searchLines = searchContent.split(/\r?\n/);
  const firstSearchLine = searchLines[0];
  const hasLeadingWhitespace = /^[ \t]+/.test(firstSearchLine);

  if (onlyWhitespaceBefore && (hasLeadingWhitespace || forceAlways)) {
    // Expand to include the leading whitespace
    const expansion = matchStart - lineStart;
    matchStart = lineStart;
    matchLength += expansion;
  }

  return {
    index: matchStart,
    matchLength: matchLength,
  };
};

const findBestFuzzyMatch = (
  searchTokens: Token[],
  fileTokens: Token[],
  minSimilarity: number,
  lineHint?: number,
  fileContent?: string,
): { startIndex: number; endIndex: number; score: number } | null => {
  if (searchTokens.length === 0 || fileTokens.length === 0) return null;

  let bestScore = 0;
  let bestMatches: Array<{
    startIndex: number;
    endIndex: number;
    score: number;
  }> = [];

  const selectBestMatch = () => {
    if (bestMatches.length === 0) {
      return null;
    }

    if (bestMatches.length === 1) {
      return bestMatches[0];
    }

    if (lineHint !== undefined && fileContent) {
      return bestMatches.reduce((closest, current) => {
        const currentLine = fileContent
          .slice(0, current.startIndex)
          .split("\n").length;
        const closestLine = fileContent
          .slice(0, closest.startIndex)
          .split("\n").length;
        return Math.abs(currentLine - lineHint) <
          Math.abs(closestLine - lineHint)
          ? current
          : closest;
      });
    }

    return null;
  };

  // Optimization: If search is much longer than file segment, skip
  if (searchTokens.length > fileTokens.length + 5) return null;

  // WHITESPACE CHAOS MODE: Create normalized token sequences for ultra-fuzzy matching
  const normalizeTokenForFuzzy = (token: Token): string => {
    const trimmed = token.text.trim();
    if (trimmed === "\n" || /^[ \t]+$/.test(trimmed)) return ""; // Ignore whitespace
    if (/^\d+(\.\d+)?$/.test(trimmed)) return "NUM";
    if (/^["'`].*["'`]$/.test(trimmed)) return "STR";
    return trimmed.toLowerCase();
  };

  const normalizedSearch = dropOptionalFormatterTokens(
    searchTokens.map(normalizeTokenForFuzzy).filter((t) => t !== ""),
  );
  const normalizedFile = dropOptionalFormatterTokens(
    fileTokens.map(normalizeTokenForFuzzy).filter((t) => t !== ""),
  );

  // Map normalized indices back to original token indices
  const normalizedToOriginal: number[] = [];
  let normIdx = 0;
  for (let i = 0; i < fileTokens.length; i++) {
    const norm = normalizeTokenForFuzzy(fileTokens[i]);
    const nextNorm = fileTokens[i + 1]
      ? normalizeTokenForFuzzy(fileTokens[i + 1])
      : "";
    if (norm !== "" && !isOptionalFormatterPunctuation(norm, nextNorm)) {
      normalizedToOriginal[normIdx] = i;
      normIdx++;
    }
  }

  // Try normalized matching first (whitespace-agnostic)
  for (let i = 0; i <= normalizedFile.length - normalizedSearch.length; i++) {
    let score = 0;
    for (let j = 0; j < normalizedSearch.length; j++) {
      if (normalizedFile[i + j] === normalizedSearch[j]) {
        score++;
      }
    }

    const similarity = score / normalizedSearch.length;

    if (similarity >= Math.max(0.7, minSimilarity)) {
      // Lower threshold for normalized matching
      const originalStartIdx = normalizedToOriginal[i];
      const originalEndIdx =
        normalizedToOriginal[i + normalizedSearch.length - 1];

      if (originalStartIdx !== undefined && originalEndIdx !== undefined) {
        const currentMatch = {
          startIndex: fileTokens[originalStartIdx].start,
          endIndex: fileTokens[originalEndIdx].end,
          score: similarity,
        };

        if (similarity > bestScore) {
          bestScore = similarity;
          bestMatches = [currentMatch];
        } else if (similarity === bestScore) {
          bestMatches.push(currentMatch);
        }
      }
    }
  }

  // If normalized matching found something, return it
  const normalizedBestMatch = selectBestMatch();
  if (normalizedBestMatch) return normalizedBestMatch;
  if (bestScore >= Math.max(0.7, minSimilarity) && bestMatches.length > 1)
    return null;

  bestScore = 0;
  bestMatches = [];

  // Fallback to exact token matching
  for (
    let i = 0;
    i <= fileTokens.length - Math.floor(searchTokens.length * minSimilarity);
    i++
  ) {
    let score = 0;
    const windowSize = Math.min(searchTokens.length, fileTokens.length - i);

    for (let j = 0; j < windowSize; j++) {
      if (fileTokens[i + j].text === searchTokens[j].text) {
        score++;
      }
    }

    const similarity = score / searchTokens.length;

    if (similarity >= minSimilarity) {
      const currentMatch = {
        startIndex: fileTokens[i].start,
        endIndex: fileTokens[i + windowSize - 1].end,
        score: similarity,
      };

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatches = [currentMatch];
      } else if (similarity === bestScore) {
        bestMatches.push(currentMatch);
      }
    }
  }

  if (bestScore < minSimilarity) {
    return null;
  }

  return selectBestMatch();
};

// --- Main Tool Implementation ---

export const parseStructuredEditBlocks = (
  rawEdits: string,
  options?: {
    allowTrailingPartialCompactLine?: boolean;
  },
): EditBlock[] => {
  const normalizeStructuredEditPayload = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    const candidates = [trimmed];
    const firstChar = trimmed[0];
    const lastChar = trimmed[trimmed.length - 1];
    if (
      trimmed.length >= 2 &&
      (firstChar === '"' || firstChar === "'" || firstChar === "`") &&
      lastChar === firstChar
    ) {
      candidates.push(trimmed.slice(1, -1));
    }

    for (const candidate of candidates) {
      const decoded = decodeCompactEditContent(candidate);
      const normalizedDecoded = decoded.replace(/\r\n/g, "\n").trim();
      const hasSearchHeader =
        /(^|\n)\s*(?:SEARCH|old|oldText|oldtxt|otxt)(?:[\t ]*(?:\[\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\]|\(\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\)|\d+(?:(?:[-]|,[\t ]*)\d+)?))?\s*:/i.test(
          normalizedDecoded,
        );
      const hasReplaceHeader =
        /(^|\n)\s*(?:REPLACE|new|newText|newtxt|ntxt)(?:[\t ]*(?:\[\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\]|\(\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\)|\d+(?:(?:[-]|,[\t ]*)\d+)?))?\s*:/i.test(
          normalizedDecoded,
        );

      if (hasSearchHeader && hasReplaceHeader) {
        return decoded;
      }
    }

    return value;
  };

  const normalizedRawEdits = normalizeStructuredEditPayload(rawEdits);
  const compactBlocks = tryParseCompactEditBlocks(normalizedRawEdits, {
    allowTrailingPartialLine: options?.allowTrailingPartialCompactLine,
  });
  if (compactBlocks !== null) {
    return compactBlocks;
  }

  const blocks: EditBlock[] = [];

  type ParsedHeader = {
    type: string;
    start?: string;
    end?: string;
    inlineContent?: string;
  };

  const parseHeaderLine = (
    line: string,
    allowReplacementHeaders: boolean,
  ): ParsedHeader | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const searchHeaderMatch = trimmed.match(
      /^(SEARCH|old|oldText|oldtxt|otxt)(?:[\t ]*(?:\[\s*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*\]|\(\s*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?\s*\)|(\d+)(?:(?:[-]|,[\t ]*)(\d+))?))?\s*:(?:[\t ]*(.*))?$/i,
    );
    if (searchHeaderMatch) {
      return {
        type: searchHeaderMatch[1],
        start:
          searchHeaderMatch[2] ||
          searchHeaderMatch[4] ||
          searchHeaderMatch[6],
        end:
          searchHeaderMatch[3] ||
          searchHeaderMatch[5] ||
          searchHeaderMatch[7],
        inlineContent: searchHeaderMatch[8] ?? "",
      };
    }

    const deleteHeaderMatch = trimmed.match(
      /^(rm|remove|delete)[\t ]+(?:\(?[\t ]*(\d+)(?:-(\d+))?[\t ]*\)?)$/i,
    );
    if (deleteHeaderMatch) {
      return {
        type: deleteHeaderMatch[1],
        start: deleteHeaderMatch[2],
        end: deleteHeaderMatch[3],
      };
    }

    if (!allowReplacementHeaders) {
      return null;
    }

    const replacementHeaderMatch =
      trimmed.match(
        /^(REPLACE|new|newText|newtxt|ntxt)(?:[\t ]*(?:\[\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\]|\(\s*\d+(?:(?:[-]|,[\t ]*)\d+)?\s*\)|\d+(?:(?:[-]|,[\t ]*)\d+)?))?\s*:(?:[\t ]*(.*))?$/i,
      ) || trimmed.match(/^(REPLACE|newText):(?:[\t ]+(.*))?$/i);
    if (replacementHeaderMatch) {
      return {
        type: replacementHeaderMatch[1],
        inlineContent:
          replacementHeaderMatch[replacementHeaderMatch.length - 1] ?? "",
      };
    }

    return null;
  };

  const lines = normalizedRawEdits.split(/\r?\n/);
  const rawBlocks: Array<ParsedHeader & { content: string }> = [];
  let currentHeader: ParsedHeader | null = null;
  let currentContent: string[] = [];

  const flushCurrentBlock = () => {
    if (!currentHeader) {
      return;
    }

    let content = currentContent.join("\n");
    if (content.startsWith("\n")) content = content.slice(1);
    if (content.endsWith("\n")) content = content.slice(0, -1);

    rawBlocks.push({
      ...currentHeader,
      content,
    });

    currentHeader = null;
    currentContent = [];
  };

  for (const line of lines) {
    const parsedHeader = parseHeaderLine(line, currentHeader !== null);
    if (parsedHeader) {
      flushCurrentBlock();
      currentHeader = parsedHeader;
      if (parsedHeader.inlineContent) {
        currentContent.push(parsedHeader.inlineContent);
      }
      continue;
    }

    if (currentHeader) {
      currentContent.push(line);
    }
  }

  flushCurrentBlock();

  if (rawBlocks.length > 0) {
    const pendingOlds: {
      content: string;
      start_line?: number;
      end_line?: number;
    }[] = [];

    for (const block of rawBlocks) {
      const isOld = /SEARCH|old|oldText|oldtxt|otxt/i.test(block.type);
      const isDelete = /rm|remove|delete/i.test(block.type);
      const content = block.content;

      if (isDelete) {
        if (block.start) {
          blocks.push({
            type: "line_deletion",
            start_line: parseInt(block.start),
            end_line: block.end ? parseInt(block.end) : parseInt(block.start),
            oldText: "",
            newText: "",
          });
        }
      } else if (isOld) {
        pendingOlds.push({
          content,
          start_line: block.start ? parseInt(block.start) : undefined,
          end_line: block.end
            ? parseInt(block.end)
            : block.start
              ? parseInt(block.start)
              : undefined,
        });
      } else {
        const matchingOld = pendingOlds.shift();
        if (matchingOld) {
          const normalizedPair = normalizeAccidentalLeadingOldNewPair(
            matchingOld.content,
            content,
            false,
          );
          blocks.push({
            oldText: normalizedPair.oldText,
            newText: normalizedPair.newText,
            start_line: matchingOld.start_line,
            end_line: matchingOld.end_line,
          });
        }
      }
    }
  } else {
    let match;
    const angleRegex =
      /(?:<{4,7})\s*SEARCH\s*(?:\(\s*(\d+)\s*-\s*(\d+)\s*\))?\s*\n([\s\S]*?)\n(?:={4,7})\s*REPLACE\s*\n([\s\S]*?)\n(?:>{4,7})/g;
    while ((match = angleRegex.exec(normalizedRawEdits)) !== null) {
      blocks.push({
        start_line: match[1] ? parseInt(match[1]) : undefined,
        end_line: match[2] ? parseInt(match[2]) : undefined,
        oldText: match[3],
        newText: match[4],
      });
    }
  }

  return blocks;
};

export class EditTool extends BaseTool<"edit"> {
  readonly name = "edit" as const;

  parseLegacy(params: Partial<Record<string, string>>): EditToolParams {
    // Return type match
    const filePath =
      params.target_file || params.file_path || params.path || "";

    // Single edit via parameter fields (XML style)
    if (
      params.old_text ||
      params.old_string ||
      params.new_text ||
      params.new_string
    ) {
      return {
        path: filePath,
        file_path: filePath,
        edit: [
          {
            oldText: params.old_text || params.old_string || "",
            newText: params.new_text || params.new_string || "",
          },
        ],
        edits: [
          {
            oldText: params.old_text || params.old_string || "",
            newText: params.new_text || params.new_string || "",
          },
        ],
      };
    }

    const rawEdits =
      params.edit || params.edits || params.diff || params.diffs || "";
    const blocks = parseStructuredEditBlocks(rawEdits);

    return {
      path: filePath,
      file_path: filePath,
      edit: blocks,
      edits: blocks,
    };
  }

  async execute(
    params: EditToolParams,
    task: Task,
    callbacks: ToolCallbacks,
  ): Promise<void> {
    // Support both legacy "file_path" and new "path"
    // Support both legacy "edits" and new "edit"
    const filePath_param = params.path || params.file_path;
    const edits_param = params.edit || params.edits;

    const { askApproval, handleError, pushToolResult, toolProtocol } =
      callbacks;

    try {
      // Validate and sanitize file_path parameter
      // Convert file_path to string if it's not already
      let filePath: string;
      if (typeof filePath_param !== "string") {
        try {
          filePath = String(filePath_param);
          console.warn(
            "[EditTool] Converted path from",
            typeof filePath_param,
            "to string",
          );
        } catch (error) {
          task.consecutiveMistakeCount++;
          task.recordToolError("edit");
          pushToolResult(
            formatResponse.toolError(
              "Invalid path parameter: must be a string.",
              toolProtocol,
            ),
          );
          return;
        }
      } else {
        filePath = filePath_param;
      }

      // Validate and sanitize edits parameter
      // 'edit' could be a single object or an array in the new schema
      let editsArray: EditBlock[] = [];
      const isPlaceholderEditPayload = (() => {
        if (typeof edits_param === "string") {
          return isEditHistoryPlaceholder(edits_param, filePath);
        }
        if (!Array.isArray(edits_param)) {
          return false;
        }

        return (
          edits_param.length > 0 &&
          edits_param.every(
            (editEntry) =>
              typeof editEntry === "string" &&
              isEditHistoryPlaceholder(editEntry, filePath),
          )
        );
      })();

      if (isPlaceholderEditPayload) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit");
        pushToolResult(
          formatResponse.toolError(
            `Refusing to apply stripped history placeholder edits to ${filePath}. Use the canonical edit body or the paired applied Previous/New blocks instead.`,
            toolProtocol,
          ),
        );
        return;
      }

      if (edits_param) {
        if (Array.isArray(edits_param)) {
          for (const editEntry of edits_param) {
            if (typeof editEntry === "string") {
              editsArray.push(...parseStructuredEditBlocks(editEntry));
            } else if (editEntry && typeof editEntry === "object") {
              editsArray.push(editEntry as EditBlock);
            }
          }
        } else if (typeof edits_param === "string") {
          editsArray = parseStructuredEditBlocks(edits_param);
        } else if (typeof edits_param === "object" && edits_param !== null) {
          editsArray = [edits_param as EditBlock];
        }
      }

      if (editsArray.length === 0) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit");
        pushToolResult(
          formatResponse.toolError(
            `Edit payload was empty or unusable for ${filePath}. This often happens when a unified edit block is truncated or only contains stripped history placeholders like "Content placed in paired result below". Retry with the full Search/Replace edit body.`,
            toolProtocol,
          ),
        );
        return;
      }

      // Pre-process mapped range -> start_line/end_line; strip duplicated range| prefixes in text
      editsArray.forEach((e) => {
        const ext = e as EditBlock & { lineRange?: string };
        if (e.range && Array.isArray(e.range) && e.range.length === 2) {
          if (e.start_line === undefined) e.start_line = e.range[0];
          if (e.end_line === undefined) e.end_line = e.range[1];
        }
        if (
          typeof ext.lineRange === "string" &&
          ext.lineRange.trim().length > 0
        ) {
          const parsed = parseLineRangeFromString(ext.lineRange);
          if (parsed) {
            if (e.start_line === undefined) e.start_line = parsed.start;
            if (e.end_line === undefined) e.end_line = parsed.end;
          }
        }
        const hintStart =
          e.start_line !== undefined ? Number(e.start_line) : undefined;
        const hintEnd =
          e.end_line !== undefined ? Number(e.end_line) : hintStart;
        if (
          hintStart !== undefined &&
          hintEnd !== undefined &&
          !Number.isNaN(hintStart) &&
          !Number.isNaN(hintEnd)
        ) {
          if (typeof e.oldText === "string") {
            e.oldText = stripRedundantLineRangePipePrefix(
              e.oldText,
              hintStart,
              hintEnd,
              { allowAnyLeadingRangePrefix: true },
            );
          }
          if (typeof e.newText === "string") {
            e.newText = stripRedundantLineRangePipePrefix(
              e.newText,
              hintStart,
              hintEnd,
              { allowAnyLeadingRangePrefix: true },
            );
          }
        }
      });

      // Determine relative path
      let relPath: string;
      if (path.isAbsolute(filePath)) {
        relPath = path.relative(task.cwd, filePath);
      } else {
        relPath = filePath;
      }

      const accessAllowed = task.rooIgnoreController?.validateAccess(relPath);
      if (!accessAllowed) {
        await task.say("rooignore_error", relPath);
        pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol));
        return;
      }

      // Check protected status
      const isWriteProtected =
        task.rooProtectedController?.isWriteProtected(relPath) || false;
      const absolutePath = path.resolve(task.cwd, relPath);
      const fileExists = await fileExistsAtPath(absolutePath);

      if (!fileExists) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit");
        const errorMessage = `File not found: ${relPath}. Cannot edit a non-existent file.`;
        await task.say("error", errorMessage);
        pushToolResult(formatResponse.toolError(errorMessage, toolProtocol));
        return;
      }

      let fileContent: string;
      try {
        fileContent = await fs.readFile(absolutePath, "utf8");
      } catch (error) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit");
        const errorMessage = `Failed to read file '${relPath}'. Please verify permissions.`;
        await task.say("error", errorMessage);
        pushToolResult(formatResponse.toolError(errorMessage, toolProtocol));
        return;
      }

      const useCrLf = fileContent.includes("\r\n");

      // Capture snapshot for undo
      try {
        const { EditHistoryService } = await import(
          "../../services/edit-history/EditHistoryService"
        );
        if (!callbacks.toolCallId) {
          console.warn(
            "[EditTool] No toolCallId available for snapshot - undo will not work",
          );
        } else {
          const service = EditHistoryService.getInstance();
          service.addSnapshot(callbacks.toolCallId, {
            filePath: absolutePath,
            originalContent: fileContent,
          });
          // console.log(`[EditTool] ✅ Snapshot saved for ${relPath} (toolCallId: ${callbacks.toolCallId})`)
        }
      } catch (e) {
        console.error("[EditTool] ❌ Failed to capture snapshot:", e);
      }

      // --- USE NEW MATCHING LOGIC ---

      interface EditOperation {
        start: number;
        end: number;
        replacement: string;
        blockIndex: number;
      }
      const operations: EditOperation[] = [];

      // Track per-block results for partial success reporting
      interface BlockResult {
        blockIndex: number;
        success: boolean;
        error?: string;
        oldTextPreview?: string;
      }
      const blockResults: BlockResult[] = [];

      // 1. Sort edits by line number descending so we calculate offsets bottom-to-top
      // This prevents earlier edits from shifting line numbers for later ones.
      const sortedEdits = [...editsArray].sort((a, b) => {
        const lineA = a.start_line !== undefined ? Number(a.start_line) : 0;
        const lineB = b.start_line !== undefined ? Number(b.start_line) : 0;
        return lineB - lineA;
      });

      for (let blockIndex = 0; blockIndex < sortedEdits.length; blockIndex++) {
        const edit = sortedEdits[blockIndex];

        // Comprehensive validation with fallbacks
        if (!edit || typeof edit !== "object") {
          blockResults.push({
            blockIndex,
            success: false,
            error: "Invalid edit block: each edit must be an object.",
          });
          continue;
        }

        // --- LINE DELETION MODE (Fast Path) ---
        if (edit.type === "line_deletion") {
          if (edit.start_line === undefined || isNaN(Number(edit.start_line))) {
            blockResults.push({
              blockIndex,
              success: false,
              error: "Invalid line_deletion: 'start_line' is required.",
            });
            continue;
          }
          const startLine = Number(edit.start_line);
          const endLine = edit.end_line ? Number(edit.end_line) : startLine;

          // Robust Offset Calculation
          let currentIdx = 0;
          let currentLine = 1;

          // Find start offset (start of startLine)
          while (currentLine < startLine && currentIdx < fileContent.length) {
            const nextNL = fileContent.indexOf("\n", currentIdx);
            if (nextNL === -1) {
              currentIdx = fileContent.length;
              break;
            }
            currentIdx = nextNL + 1;
            currentLine++;
          }
          const startOffset = currentIdx;

          // Find end offset (end of endLine, including newline)
          // We need to consume the lines from startLine to endLine
          let linesToConsume = endLine - startLine + 1;

          while (linesToConsume > 0 && currentIdx < fileContent.length) {
            const nextNL = fileContent.indexOf("\n", currentIdx);
            if (nextNL === -1) {
              currentIdx = fileContent.length;
              break;
            }
            currentIdx = nextNL + 1;
            linesToConsume--;
          }
          const endOffset = currentIdx;

          if (startOffset < fileContent.length) {
            // Create operation
            operations.push({
              start: startOffset,
              end: endOffset,
              replacement: "",
              blockIndex,
            });
            blockResults.push({ blockIndex, success: true });
            continue; // Skip standard logic
          } else {
            blockResults.push({
              blockIndex,
              success: false,
              error: `Line ${startLine} is beyond end of file.`,
            });
            continue;
          }
        }

        // --- REPLACE ALL MODE ---
        if (edit.replaceAll) {
          // Use simple string replacement for all occurrences
          // We need to resolve oldText and newText similar to subsequent logic

          let oldText = edit.oldText;
          // Fallback resolution if not set in direct object (though parser sets it)
          if (!oldText) {
            if ((edit as any).old_text !== undefined)
              oldText = (edit as any).old_text;
            if ((edit as any).old_string !== undefined)
              oldText = (edit as any).old_string;
          }

          let newText = edit.newText;
          if (newText === undefined) {
            if ((edit as any).new_text !== undefined)
              newText = (edit as any).new_text;
            if ((edit as any).new_string !== undefined)
              newText = (edit as any).new_string;
          }
          if (newText === undefined) newText = "";

          if (!oldText || typeof oldText !== "string") {
            blockResults.push({
              blockIndex,
              success: false,
              error:
                "Invalid replace_all: 'oldText' is required and must be a string.",
            });
            continue;
          }

          // Check if oldText exists in content
          if (!fileContent.includes(oldText)) {
            blockResults.push({
              blockIndex,
              success: false,
              error: `Could not find text to replace_all: ${oldText.slice(0, 100)}...`,
              oldTextPreview: oldText.slice(0, 100),
            });
            continue;
          }

          // Perform global replacement
          // Using split/join is safer for literal strings than regex construction
          const newContent = fileContent.split(oldText).join(String(newText));

          // We bypass the operations array and diff logic for this atomic operation
          // But we still want to show the diff!

          // Update fileContent for final diff generation
          // We need to ensure loop doesn't overwrite if multiple edits (though replace_all should be atomic/single usually)
          // If there are mixed edits, global replace might invalidate indices.
          // For safety, if replace_all is used, it should probably be the only edit or we process strictly.
          // Given the parser creates a single block for replace_all, we can treat it as the transformation.

          // However, execute() continues to process 'operations' and then applies them.
          // We can hijack operations to cover the whole file? No, that's messy.
          // Easier to just update fileContent directly here?
          // Wait, the tool logic applies 'operations' to 'fileContent' (variable newContent later).
          // Let's create an operation that covers the entire file? No.

          // Let's create operations for each occurrence?
          const parts = fileContent.split(oldText);
          let currentIdx = 0;
          for (let i = 0; i < parts.length - 1; i++) {
            currentIdx += parts[i].length;
            operations.push({
              start: currentIdx,
              end: currentIdx + oldText.length,
              replacement: String(newText),
              blockIndex,
            });
            currentIdx += oldText.length; // Advance past the match
          }
          blockResults.push({ blockIndex, success: true });

          continue; // Skip standard logic
        }

        // Handle oldText validation with fallbacks (Case-Insensitive)
        let oldText: string | undefined;
        let dynamicStartLine: number | undefined;
        let dynamicEndLine: number | undefined;

        // Helper to find key case-insensitively
        const findKey = (obj: any, target: string): string | undefined => {
          if (obj[target] !== undefined) return target;
          const lowerTarget = target.toLowerCase();
          return Object.keys(obj).find((k) => k.toLowerCase() === lowerTarget);
        };

        // 1. Try "oldText" (case-insensitive)
        const oldTextKey = findKey(edit, "oldText");
        if (oldTextKey) {
          oldText = (edit as any)[oldTextKey];
        }

        // 2. Try legacy "old_text", "old_string" (case-insensitive)
        if (oldText === undefined) {
          const legacyKey1 = findKey(edit, "old_text");
          if (legacyKey1) oldText = (edit as any)[legacyKey1];
        }
        if (oldText === undefined) {
          const legacyKey2 = findKey(edit, "old_string");
          if (legacyKey2) oldText = (edit as any)[legacyKey2];
        }

        // 3. Scan for dynamic keys (e.g. "oldText 1-2") - Regex is already case-insensitive
        if (oldText === undefined) {
          for (const key of Object.keys(edit)) {
            const match = key.match(/^oldText\s*\(?(\d+)-(\d+)\)?$/i);
            if (match) {
              oldText = (edit as any)[key];
              dynamicStartLine = parseInt(match[1]);
              dynamicEndLine = parseInt(match[2]);
              break;
            }
          }
        }

        if (oldText === undefined || oldText === null) {
          blockResults.push({
            blockIndex,
            success: false,
            error:
              "Invalid edit block: 'oldText' (or 'oldText start-end') is required.",
          });
          continue;
        }

        if (typeof oldText !== "string") {
          // Try to convert to string if possible
          try {
            oldText = String(oldText);
            console.warn(
              "[EditTool] Converted oldText from",
              typeof oldText,
              "to string",
            );
          } catch (error) {
            blockResults.push({
              blockIndex,
              success: false,
              error: `Invalid edit block: 'old_text' must be a string, got ${typeof oldText}.`,
            });
            continue;
          }
        }

        // Handle newText validation with fallbacks (Case-Insensitive)
        let newText: string;

        // 1. Try "newText" (case-insensitive)
        let rawNewText: any = undefined;
        const newTextKey = findKey(edit, "newText");
        if (newTextKey) {
          rawNewText = (edit as any)[newTextKey];
        }

        // 2. Try legacy "new_text" etc.
        if (rawNewText === undefined) {
          const legacyKey3 = findKey(edit, "new_text");
          if (legacyKey3) rawNewText = (edit as any)[legacyKey3];
        }
        if (rawNewText === undefined) {
          const legacyKey4 = findKey(edit, "new_string");
          if (legacyKey4) rawNewText = (edit as any)[legacyKey4];
        }

        if (rawNewText === undefined || rawNewText === null) {
          // Allow empty newText but not undefined/null
          newText = "";
        } else if (typeof rawNewText !== "string") {
          // Try to convert to string if possible
          try {
            newText = String(rawNewText);
            console.warn(
              "[EditTool] Converted newText from",
              typeof rawNewText,
              "to string",
            );
          } catch (error) {
            blockResults.push({
              blockIndex,
              success: false,
              error: `Invalid edit block: 'new_text' must be a string, got ${typeof rawNewText}.`,
            });
            continue;
          }
        } else {
          newText = rawNewText;
        }

        // Validate line numbers if provided
        let startLine = edit.start_line;
        let endLine = edit.end_line;

        // Prefer dynamic keys if present
        if (dynamicStartLine !== undefined) startLine = dynamicStartLine;
        if (dynamicEndLine !== undefined) endLine = dynamicEndLine;

        if (startLine !== undefined) {
          const sl = Number(startLine);
          if (isNaN(sl) || sl < 1) {
            blockResults.push({
              blockIndex,
              success: false,
              error:
                "Invalid edit block: 'start_line' must be a positive number.",
            });
            continue;
          }
        }

        if (endLine !== undefined) {
          const el = Number(endLine);
          if (isNaN(el) || el < 1) {
            blockResults.push({
              blockIndex,
              success: false,
              error:
                "Invalid edit block: 'end_line' must be a positive number.",
            });
            continue;
          }
        }

        // Update edit object for subsequent logic (Strategy 0 needs these)
        edit.start_line = startLine;
        edit.end_line = endLine;
        edit.oldText = oldText; // Ensure oldText is set for error messages later

        // Map EditBlock (oldText/newText) to logic's (oldText/newText)
        // We strip line numbers and markdown in case the AI included them from its view
        // We also strip trailing newlines to ensure consistency with token matching (which ignores trailing whitespace)
        // and prevents double-newline insertion when replacing blocks that didn't capture the trailing newline.
        let searchString = normalizeLineEndings(
          stripMarkdown(stripLineNumbers(oldText)),
          useCrLf,
        );
        let replaceString = normalizeLineEndings(
          stripMarkdown(stripLineNumbers(newText)),
          useCrLf,
        );

        let match: { index: number; matchLength: number } | null = null;

        // Special case: Empty search block with line hint (Line-based exact replacement without validation)
        if (searchString === "" && edit.start_line !== undefined && !match) {
          const startLine = Number(edit.start_line);
          const endLine =
            edit.end_line !== undefined ? Number(edit.end_line) : startLine;

          let currentIdx = 0;
          let currentLine = 1;

          // Find start offset
          while (currentLine < startLine && currentIdx < fileContent.length) {
            const nextNL = fileContent.indexOf("\n", currentIdx);
            if (nextNL === -1) {
              currentIdx = fileContent.length;
              // If we are appending past the end of the file, add a newline
              if (currentLine < startLine) {
                fileContent += useCrLf ? "\r\n" : "\n";
                currentIdx = fileContent.length;
                currentLine++;
              } else {
                break;
              }
            } else {
              currentIdx = nextNL + 1;
              currentLine++;
            }
          }
          const startOffset = currentIdx;

          // Find end offset
          let linesToConsume = endLine - startLine + 1;
          while (linesToConsume > 0 && currentIdx < fileContent.length) {
            const nextNL = fileContent.indexOf("\n", currentIdx);
            if (nextNL === -1) {
              currentIdx = fileContent.length;
              break;
            }
            currentIdx = nextNL + 1;
            linesToConsume--;
          }

          let endOffset = currentIdx;
          // Back up before the trailing newline so we don't overwrite it
          // unless this is the very end of the file without a newline
          if (endOffset > startOffset) {
            if (fileContent[endOffset - 1] === "\n") {
              endOffset--;
              if (
                endOffset > startOffset &&
                fileContent[endOffset - 1] === "\r"
              ) {
                endOffset--;
              }
            }
          }

          if (startOffset < fileContent.length) {
            const actualOldText = fileContent.slice(startOffset, endOffset);
            edit.oldText = actualOldText;
            // Crucial: Update searchString so it's not empty anymore for the matching logic
            searchString = normalizeLineEndings(
              stripMarkdown(stripLineNumbers(actualOldText)),
              useCrLf,
            );
            match = {
              index: startOffset,
              matchLength: endOffset - startOffset,
            };
          } else {
            match = { index: currentIdx, matchLength: 0 }; // Fallback to insertion at end if out of bounds
          }
        }

        const resolveMatchForSearchString = (
          candidateSearchString: string,
        ): {
          match: { index: number; matchLength: number } | null;
          resolvedSearchString: string;
        } => {
          const searchTokens = tokenize(candidateSearchString);
          let resolvedSearchString = candidateSearchString;
          let resolvedMatch: { index: number; matchLength: number } | null =
            null;

          if (edit.start_line !== undefined) {
            const hintedRange = getOffsetsForLineRange(
              fileContent,
              Number(edit.start_line),
              edit.end_line !== undefined
                ? Number(edit.end_line)
                : Number(edit.start_line),
              useCrLf,
            );

            if (hintedRange) {
              const normalizedSearch =
                normalizeWhitespaceForMatching(resolvedSearchString);
              const normalizedHintedText = normalizeWhitespaceForMatching(
                hintedRange.text,
              );

              if (
                resolvedSearchString === "" ||
                resolvedSearchString === hintedRange.text ||
                normalizedSearch === normalizedHintedText
              ) {
                edit.oldText = hintedRange.text;
                resolvedSearchString = hintedRange.text;
                resolvedMatch = {
                  index: hintedRange.startOffset,
                  matchLength: hintedRange.endOffset - hintedRange.startOffset,
                };
              }
            }

            if (!resolvedMatch) {
              const nearbyMatch = findNearbyNormalizedLineRangeMatch(
                fileContent,
                resolvedSearchString,
                Number(edit.start_line),
                edit.end_line !== undefined
                  ? Number(edit.end_line)
                  : Number(edit.start_line),
                useCrLf,
              );

              if (nearbyMatch) {
                edit.oldText = nearbyMatch.text;
                resolvedSearchString = nearbyMatch.text;
                edit.start_line = nearbyMatch.startLine;
                edit.end_line = nearbyMatch.endLine;
                resolvedMatch = {
                  index: nearbyMatch.startOffset,
                  matchLength: nearbyMatch.endOffset - nearbyMatch.startOffset,
                };
              }
            }

            if (!resolvedMatch) {
              const tokenEquivalentMatch = findNearbyTokenEquivalentRangeMatch(
                fileContent,
                resolvedSearchString,
                Number(edit.start_line),
                edit.end_line !== undefined
                  ? Number(edit.end_line)
                  : Number(edit.start_line),
                useCrLf,
              );

              if (tokenEquivalentMatch) {
                edit.oldText = tokenEquivalentMatch.text;
                resolvedSearchString = tokenEquivalentMatch.text;
                edit.start_line = tokenEquivalentMatch.startLine;
                edit.end_line = tokenEquivalentMatch.endLine;
                resolvedMatch = {
                  index: tokenEquivalentMatch.startOffset,
                  matchLength:
                    tokenEquivalentMatch.endOffset -
                    tokenEquivalentMatch.startOffset,
                };
              }
            }
          }

          if (
            !resolvedMatch &&
            edit.start_line === undefined &&
            resolvedSearchString.trim().length > 0
          ) {
            const exactTokenEquivalentMatch =
              findExactTokenEquivalentRangeMatch(
                fileContent,
                resolvedSearchString,
                useCrLf,
              );

            if (exactTokenEquivalentMatch) {
              edit.oldText = exactTokenEquivalentMatch.text;
              resolvedSearchString = exactTokenEquivalentMatch.text;
              resolvedMatch = {
                index: exactTokenEquivalentMatch.startOffset,
                matchLength:
                  exactTokenEquivalentMatch.endOffset -
                  exactTokenEquivalentMatch.startOffset,
              };
            }
          }

          if (!resolvedMatch && edit.start_line) {
            const lines = fileContent.split(/\r?\n/);
            const startLineIdx = edit.start_line - 1;
            const endLineIdx = (edit.end_line || edit.start_line) - 1;

            const sliceStartLine = Math.min(
              lines.length,
              Math.max(0, startLineIdx - 20),
            );
            const sliceEndLine = Math.min(lines.length, endLineIdx + 20);

            const sliceLines = lines.slice(sliceStartLine, sliceEndLine + 1);
            const sliceContent = sliceLines.join(useCrLf ? "\r\n" : "\n");

            let sliceOffset = 0;
            for (let i = 0; i < sliceStartLine; i++) {
              sliceOffset += lines[i].length + (useCrLf ? 2 : 1);
            }

            const fuzzyMatch = findBestFuzzyMatch(
              searchTokens,
              tokenize(sliceContent, sliceOffset),
              DEFAULT_FUZZY_MATCH_THRESHOLD,
              edit.start_line,
              fileContent,
            );

            if (fuzzyMatch) {
              const rawMatch = {
                index: fuzzyMatch.startIndex,
                matchLength: fuzzyMatch.endIndex - fuzzyMatch.startIndex,
              };
              resolvedMatch = expandMatchWithIndentation(
                rawMatch,
                resolvedSearchString,
                fileContent,
                undefined,
                -1,
                -1,
                true,
              );
            }
          }

          if (!resolvedMatch) {
            resolvedMatch = findBestMatch(
              resolvedSearchString,
              fileContent,
              0,
              useCrLf,
              edit.start_line,
            );
          }

          if (!resolvedMatch && searchTokens.length > 0) {
            const fullFileFuzzyMatch = findBestFuzzyMatch(
              searchTokens,
              tokenize(fileContent),
              DEFAULT_FUZZY_MATCH_THRESHOLD,
              edit.start_line,
              fileContent,
            );

            if (fullFileFuzzyMatch) {
              const rawMatch = {
                index: fullFileFuzzyMatch.startIndex,
                matchLength:
                  fullFileFuzzyMatch.endIndex - fullFileFuzzyMatch.startIndex,
              };
              resolvedMatch = expandMatchWithIndentation(
                rawMatch,
                resolvedSearchString,
                fileContent,
                undefined,
                -1,
                -1,
                true,
              );
            }
          }

          return { match: resolvedMatch, resolvedSearchString };
        };

        if (!match) {
          const resolvedMatch = resolveMatchForSearchString(searchString);
          match = resolvedMatch.match;
          searchString = resolvedMatch.resolvedSearchString;
        }

        if (!match) {
          const normalizedPair = normalizeAccidentalLeadingOldNewPair(
            searchString,
            replaceString,
            useCrLf,
          );

          if (normalizedPair.normalized) {
            const retriedMatch = resolveMatchForSearchString(
              normalizedPair.oldText,
            );
            if (retriedMatch.match) {
              searchString = retriedMatch.resolvedSearchString;
              replaceString = normalizedPair.newText;
              edit.oldText = normalizedPair.oldText;
              edit.newText = normalizedPair.newText;
              match = retriedMatch.match;
            }
          }
        }

        if (!match) {
          const diagnosis = diagnoseMismatch(searchString, fileContent);
          const oldTextPreview = edit.oldText || "(empty)";
          const err = `Could not find a unique match. ${diagnosis}`;

          blockResults.push({
            blockIndex,
            success: false,
            error: err,
            oldTextPreview,
          });
          continue;
        }

        // --- Indentation Re-basing + Grid Snapping + Semantic Staircasing ---
        let finalReplacement = replaceString;
        const fileIndentation = getLineIndentation(fileContent, match.index);
        const lineStart = fileContent.lastIndexOf("\n", match.index) + 1;
        const isAtLineStart = match.index === lineStart;
        const matchedText = fileContent.slice(
          match.index,
          match.index + match.matchLength,
        );

        finalReplacement = applyIndentationHeuristics(
          replaceString,
          fileIndentation,
          matchedText,
          fileContent,
          isAtLineStart,
          useCrLf,
        );

        operations.push({
          start: match.index,
          end: match.index + match.matchLength,
          replacement: finalReplacement,
          blockIndex,
        });
        blockResults.push({ blockIndex, success: true });
      }

      // --- PARTIAL SUCCESS REPORTING ---
      const failedBlocks = blockResults.filter((r) => !r.success);
      const successfulBlocks = blockResults.filter((r) => r.success);

      // If ALL blocks failed, return error immediately
      if (failedBlocks.length === editsArray.length) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit", "all_blocks_failed");

        let errorMsg = `All ${editsArray.length} edit block(s) failed:\n\n`;
        failedBlocks.forEach((block, idx) => {
          errorMsg += `Block ${block.blockIndex + 1}: ${block.error}\n`;
          if (block.oldTextPreview && idx < 2) {
            // Show preview for first 2 failures
            errorMsg += `  Search text: ${block.oldTextPreview}...\n`;
          }
        });
        errorMsg += `\nTip: To avoid repeated edit failures, provide old and new blocks without indentation or extra whitespace so the tool can normalize flat in/out edits automatically. If it still fails, re-read the specified line range and try again.`;

        await task.say("error", errorMsg);
        pushToolResult(formatResponse.toolError(errorMsg, toolProtocol));
        return;
      }

      // If SOME blocks failed, record errors but continue with successful ones
      if (failedBlocks.length > 0) {
        task.consecutiveMistakeCount++;
        task.recordToolError("edit", "partial_failure");
        // Note: Error details will be included in the ClineSayTool message for UI display
      }

      // Apply in reverse order (Standard practice)
      operations.sort((a, b) => b.start - a.start);

      // Check for overlaps
      for (let i = 0; i < operations.length - 1; i++) {
        if (operations[i].start < operations[i + 1].end) {
          // This shouldn't happen with proper block processing, but check anyway
          const msg =
            "Overlapping edits detected among successful blocks. Please ensure SEARCH blocks are distinct.";
          await task.say("error", msg);
          pushToolResult(formatResponse.toolError(msg, toolProtocol));
          return;
        }
      }

      let newContent = fileContent;
      for (const op of operations) {
        newContent =
          newContent.slice(0, op.start) +
          op.replacement +
          newContent.slice(op.end);
      }

      const state = await task.providerRef.deref()?.getState();

      newContent = await formatWithPrettier({
        cwd: task.cwd,
        relativePath: relPath,
        content: newContent,
        previousContent: fileContent,
        formatterSettings: state?.formatterSettings,
      });

      // --- END NEW MATCHING LOGIC ---

      // --- RESUME EXISTING UI WORKFLOW ---

      if (newContent === fileContent) {
        pushToolResult("No changes required (content matched already).");
        return;
      }

      task.consecutiveMistakeCount = 0;

      // Store edits for result formatting
      task.lastEditBlocks = sortedEdits;

      // Track the canonical applied blocks for the eventual tool result.
      const pathKey =
        process.platform === "win32"
          ? absolutePath.toLowerCase()
          : absolutePath;

      // Initialize diff view
      task.diffViewProvider.editType = "modify";
      task.diffViewProvider.originalContent = fileContent;

      const diff = formatResponse.createPrettyPatch(
        relPath,
        fileContent,
        newContent,
      );
      if (!diff) {
        pushToolResult(`No changes needed for '${relPath}'`);
        await task.diffViewProvider.reset();
        return;
      }

      const provider = task.providerRef.deref();
      const diagnosticsEnabled = state?.diagnosticsEnabled ?? true;
      const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
      const isPreventFocusDisruptionEnabled = experiments.isEnabled(
        state?.experiments ?? {},
        EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
      );

      const sanitizedDiff = sanitizeUnifiedDiff(diff);
      const diffStats = computeDiffStats(sanitizedDiff) || undefined;
      const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath);

      const sharedMessageProps: ClineSayTool = {
        tool: "appliedDiff",
        path: getReadablePath(task.cwd, relPath),
        diff: sanitizedDiff,
        isOutsideWorkspace,
        id: callbacks.toolCallId,
        // Include partial success info if some blocks failed
        ...(failedBlocks.length > 0
          ? {
              partialSuccess: {
                successCount: successfulBlocks.length,
                totalCount: editsArray.length,
                failedBlocks: failedBlocks.map((fb) => ({
                  blockIndex: fb.blockIndex,
                  error: fb.error || "",
                  oldTextPreview: fb.oldTextPreview,
                })),
              },
            }
          : {}),
      };

      const completeMessage = JSON.stringify({
        ...sharedMessageProps,
        content: sanitizedDiff,
        isProtected: isWriteProtected,
        diffStats,
      } satisfies ClineSayTool);

      if (!isPreventFocusDisruptionEnabled) {
        await task.diffViewProvider.open(relPath);
        await task.diffViewProvider.update(newContent, true);
        task.diffViewProvider.scrollToFirstDiff();
      }

      const didApprove = await askApproval(
        "tool",
        completeMessage,
        undefined,
        isWriteProtected,
      );

      if (!didApprove) {
        if (!isPreventFocusDisruptionEnabled) {
          await task.diffViewProvider.revertChanges();
        }
        pushToolResult("Changes were rejected by the user.");
        await task.diffViewProvider.reset();
        return;
      }

      if (isPreventFocusDisruptionEnabled) {
        await task.diffViewProvider.saveDirectly(
          relPath,
          newContent,
          false,
          diagnosticsEnabled,
          writeDelayMs,
          true,
        );
      } else {
        await task.diffViewProvider.saveChanges(
          diagnosticsEnabled,
          writeDelayMs,
          true,
        );
      }

      if (relPath) {
        await task.fileContextTracker.trackFileContext(
          relPath,
          "roo_edited" as RecordSource,
        );
      }

      // Capture modified state for Redo
      try {
        const { EditHistoryService } = await import(
          "../../services/edit-history/EditHistoryService"
        );
        if (callbacks.toolCallId) {
          const service = EditHistoryService.getInstance();
          service.updateModifiedState(
            callbacks.toolCallId,
            absolutePath,
            newContent,
          );
          // console.log(`[EditTool] ✅ Modified state saved for ${relPath} (toolCallId: ${callbacks.toolCallId})`)
        }
      } catch (e) {
        console.error("[EditTool] ❌ Failed to capture modified state:", e);
      }

      task.didEditFile = true;

      const currentCount =
        (task.luxurySpa.fileEditCounts.get(pathKey) || 0) + 1;
      task.luxurySpa.fileEditCounts.set(pathKey, currentCount);

      const appliedEditBlocks = buildAppliedEditBlocksFromContents(
        fileContent,
        newContent,
      ).sort((a, b) => {
        const lineA = a.startLine ?? Number.MAX_SAFE_INTEGER;
        const lineB = b.startLine ?? Number.MAX_SAFE_INTEGER;
        if (lineA !== lineB) {
          return lineA - lineB;
        }
        return a.index - b.index;
      });
      const failedEditBlocks = failedBlocks.map((block, failedIndex) => ({
        index: appliedEditBlocks.length + failedIndex + 1,
        status: "failed" as const,
        error: `Requested block #${block.blockIndex + 1}: ${block.error}`,
        oldTextPreview: block.oldTextPreview,
      }));
      const blockIndexOffset =
        task.luxurySpa.fileEditBlockCounts.get(pathKey) || 0;
      const resultBlocks = [...appliedEditBlocks, ...failedEditBlocks].map(
        (block) => ({
          ...block,
          index: block.index + blockIndexOffset,
        }),
      );
      task.luxurySpa.fileEditBlockCounts.set(
        pathKey,
        blockIndexOffset + resultBlocks.length,
      );
      task.luxurySpa.recordRecentEditBlocks(absolutePath, appliedEditBlocks);

      const rawEditBodyForFormatting =
        typeof edits_param === "string"
          ? edits_param
          : Array.isArray(edits_param)
            ? edits_param.find((entry): entry is string => typeof entry === "string")
            : undefined;
      const explicitContentCloser =
        typeof (params as any).contentCloser === "string"
          ? (params as any).contentCloser
          : undefined;

      let message = `File modified successfully (Edit #${currentCount})\n`;
      message += `Applied edit history:\n${formatNativeEditResult(
        relPath,
        resultBlocks,
        {
          editCount: currentCount,
          problems: task.diffViewProvider.newProblemsMessage,
          syntax: inferEditHistorySyntax(
            rawEditBodyForFormatting,
            explicitContentCloser,
          ),
        },
      )}`;

      const enhancedPushToolResult = (content: any) => {
        pushToolResult(content);
        (async () => {
          try {
            const toolId = callbacks.toolCallId;
            const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
              try {
                const parsed = JSON.parse(m.text || "{}");
                const isAppliedDiff =
                  (m.say === "tool" || m.ask === "tool") &&
                  parsed.tool === "appliedDiff";
                if (!isAppliedDiff) return false;
                if (toolId && parsed.id) {
                  return parsed.id === toolId;
                }
                return parsed.path === getReadablePath(task.cwd, relPath);
              } catch {
                return false;
              }
            });

            if (lastMsgIndex !== -1) {
              const msg = task.clineMessages[lastMsgIndex];
              const toolData = JSON.parse(msg.text || "{}");
              toolData.content = content;
              msg.text = JSON.stringify(toolData);
              msg.partial = false;
              await task.saveClineMessages();
              await task.updateClineMessage(msg);
            }
          } catch (error) {
            console.error(`[edit] Failed to update UI: ${error}`);
          }
        })();
      };
      enhancedPushToolResult(message);

      task.recordToolUsage("edit");
      await task.diffViewProvider.reset();
      task.processQueuedMessages();
    } catch (error) {
      console.error(`[EditTool] DBG FATAL EXECUTE ERROR:`, error);
      await handleError("search and replace", error as Error);
      await task.diffViewProvider.reset();
      throw error;
    }
  }

  override async handlePartial(
    task: Task,
    block: ToolUse<"edit">,
  ): Promise<void> {
    // Extract and validate parameters with fallbacks
    const rawParams = block.params as any;
    const nativeArgs = (block as any).nativeArgs || {};
    let filePath: string | undefined;
    let edits: any[] | undefined;

    // Handle path with fallbacks - check nativeArgs first (from Unified parser)
    const pathValue =
      nativeArgs.path ||
      rawParams.target_file ||
      rawParams.path ||
      rawParams.file_path;
    if (pathValue !== undefined) {
      if (typeof pathValue !== "string") {
        try {
          filePath = String(pathValue);
          console.warn(
            "[EditTool.handlePartial] Converted path from",
            typeof pathValue,
            "to string",
          );
        } catch (error) {
          console.log(
            `[EditTool.handlePartial] ❌ Failed to convert path to string`,
          );
          return;
        }
      } else {
        filePath = pathValue;
      }
    }

    // Handle edits with fallbacks
    // Check nativeArgs.edits (array from Unified parser) FIRST, then params.edits, then params.edit (raw string)
    // so already-parsed edits are used directly instead of falling through to parseLegacy
    const editsValue =
      nativeArgs.edits || nativeArgs.edit || rawParams.edits || rawParams.edit;
    if (editsValue !== undefined) {
      if (Array.isArray(editsValue)) {
        edits = editsValue.flatMap((edit) =>
          typeof edit === "string" ? parseStructuredEditBlocks(edit) : [edit],
        );
      } else if (typeof editsValue === "string") {
        edits = parseStructuredEditBlocks(editsValue, {
          allowTrailingPartialCompactLine: true,
        });
      } else if (typeof editsValue === "object" && editsValue !== null) {
        // Convert single edit to array
        edits = [editsValue];
        console.warn("[EditTool.handlePartial] Converted single edit to array");
      } else {
        console.log(
          `[EditTool.handlePartial] ❌ Invalid edit type: ${typeof editsValue}`,
        );
        return;
      }
    }

    // Validate required parameters before proceeding
    if (!filePath || !edits) {
      console.log(
        `[EditTool.handlePartial] ❌ Missing required parameters - path: ${!!filePath}, edit: ${!!edits}`,
      );
      return; // Don't send partial message if required params are missing
    }

    // Validate each edit in the array
    const validEdits = edits.filter((edit, index) => {
      if (!edit || typeof edit !== "object") {
        console.warn(
          `[EditTool.handlePartial] Skipping invalid edit at index ${index}: not an object`,
        );
        return false;
      }
      return true;
    });

    if (validEdits.length === 0) {
      console.log(`[EditTool.handlePartial] ❌ No valid edits found`);
      return;
    }

    let operationPreview: string | undefined;
    const count = validEdits.length;
    operationPreview = `applying ${count} edit block${count !== 1 ? "s" : ""}`;

    let relPath = filePath || "";
    if (filePath && path.isAbsolute(filePath)) {
      relPath = path.relative(task.cwd, filePath);
    }

    const absolutePath = relPath ? path.resolve(task.cwd, relPath) : "";
    const isOutsideWorkspace = absolutePath
      ? isPathOutsideWorkspace(absolutePath)
      : false;

    const sharedMessageProps: ClineSayTool = {
      tool: "appliedDiff",
      path: getReadablePath(task.cwd, relPath),
      diff: operationPreview,
      isOutsideWorkspace,
      id: block.id,
      edits: validEdits.map((e: any) => ({
        oldText: e.oldText,
        newText: e.newText,
        replaceAll: e.replaceAll,
      })),
    };

    // Stream edit previews as non-interactive say() messages so they don't get stuck
    // as the active approval request while the task is still streaming.
    task
      .say(
        "tool",
        JSON.stringify(sharedMessageProps),
        undefined,
        true,
        undefined,
        undefined,
        {
          isNonInteractive: true,
          skipSave: true,
        },
      )
      .catch(() => {});
  }
}

export const editTool = new EditTool();
export const __editToolInternals = {
  getOffsetsForLineRange,
  findNearbyNormalizedLineRangeMatch,
  findNearbyTokenEquivalentRangeMatch,
  findBestMatch,
  findBestFuzzyMatch,
  normalizeWhitespaceForMatching,
  tokenize,
  detectIndentationQuantum,
  applyIndentationHeuristics,
  parseLineRangeFromString,
  stripRedundantLineRangePipePrefix,
};
