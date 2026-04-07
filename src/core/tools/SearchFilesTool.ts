import path from "path";
import { promises as fs } from "fs";

import * as vscode from "vscode";

import { Task } from "../task/Task";
import { ClineSayTool } from "../../shared/ExtensionMessage";
import { getReadablePath, resolveRecursivePath } from "../../utils/path";
import { isPathOutsideWorkspace } from "../../utils/pathUtils";
import { getBinPath, execRipgrep } from "../../services/ripgrep";
import { BaseTool, ToolCallbacks } from "./BaseTool";
import { buildOrderedGrepGlobs } from "./searchFilesIgnoreGlobs";
import type { ToolUse } from "../../shared/tools";
import { findLastIndex } from "../../shared/array";

interface GrepParams {
  path?: string | string[];
  query: string | string[]; // Support both single query and multiple queries
  recursive_resolution?: boolean; // Internal flag to indicate if paths have been resolved
  file_pattern?: string | string[] | null;
  include?: string | string[] | null; // kade_change: Support 'include'
  exclude?: string | string[] | null; // kade_change: Support 'exclude'
  include_all?: boolean; // Whether to include docs, locales, generated files, assets, etc.
  context_lines?: number; // Configurable context lines
  literal?: boolean; // Whether to treat query as literal string
  whole_word?: boolean; // Whether to match whole words only
  case_insensitive?: boolean; // kade_change: Support 'case_insensitive'
  case_sensitive?: boolean; // Alias used by native JSON tools
  tests?: boolean; // Whether to include test files while still filtering non-code noise
  multiline?: boolean; // Whether to enable multiline regex matching (-U flag)
}

interface ParsedSearchLine {
  line_number: number;
  content: string;
  isMatch: boolean;
}

interface RipgrepSubmatch {
  start: number;
  end: number;
}

interface RipgrepSearchResultData {
  path: {
    text: string;
  };
  lines: {
    text?: string;
  };
  line_number: number;
  submatches?: RipgrepSubmatch[];
}

function wrapMatchedSubstrings(text: string, submatches: RipgrepSubmatch[]): string {
  if (submatches.length === 0) {
    return text;
  }

  let result = "";
  let cursor = 0;

  for (const submatch of submatches) {
    const start = Math.max(0, Math.min(submatch.start, text.length));
    const end = Math.max(start, Math.min(submatch.end, text.length));

    if (start < cursor) {
      continue;
    }

    result += text.slice(cursor, start);
    result += `→${text.slice(start, end)}←`;
    cursor = end;
  }

  result += text.slice(cursor);
  return result;
}

export function isIdentifierLikeQuery(query: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(query);
}

export function shouldUseWholeWordSearch(
  _query: string,
  options: { literal: boolean; wholeWord?: boolean },
): boolean {
  if (options.wholeWord !== undefined) {
    return options.wholeWord;
  }

  return false;
}

export function resolveCaseInsensitiveSearch(params: Pick<GrepParams, "case_sensitive" | "case_insensitive">): boolean {
  if (params.case_sensitive === true) {
    return false;
  }

  if (params.case_insensitive === false) {
    return false;
  }

  return true;
}

function splitUnescapedPipes(query: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of query) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

export function looksLikeRegexIntent(query: string): boolean {
  return /\\[|(){}+?]|\.\*|\.\+|\[[^\]]+\]|\(\?:|\(\?|\^|\$|\\[bBdDsSwW]|\{(?:\d+,?\d*)\}/.test(
    query,
  );
}

export function normalizeShellRegexQuery(query: string): string {
  return query.replace(/\\([|(){}+?])/g, "$1");
}

export function normalizeGrepQueries(
  query: string | string[],
  options: { explicitLiteral: boolean; literal?: boolean },
): { queries: string[]; literal: boolean } {
  if (Array.isArray(query)) {
    const normalizedQueries = query
      .map((entry) =>
        !options.explicitLiteral || options.literal === false
          ? normalizeShellRegexQuery(entry)
          : entry,
      )
      .filter((entry) => entry.trim().length > 0);
    return {
      queries: normalizedQueries,
      literal: options.explicitLiteral ? options.literal === true : true,
    };
  }

  if (!options.explicitLiteral && looksLikeRegexIntent(query)) {
    return {
      queries: [normalizeShellRegexQuery(query)],
      literal: false,
    };
  }

  if (options.explicitLiteral && options.literal === false) {
    return {
      queries: [normalizeShellRegexQuery(query)],
      literal: false,
    };
  }

  if (!options.explicitLiteral) {
    const pipeSplitQueries = splitUnescapedPipes(query)
      .map((part) => part.trim())
      .filter(Boolean);
    if (pipeSplitQueries.length > 1) {
      return {
        queries: pipeSplitQueries,
        literal: true,
      };
    }
  }

  return {
    queries: [query],
    literal: options.explicitLiteral ? options.literal === true : true,
  };
}

export class GrepTool extends BaseTool<"grep"> {
  readonly name = "grep" as const;
  private readonly MAX_TOTAL_MATCHES = 150;
  private readonly MAX_LINE_LENGTH = 300;

  /**
   * Parse ripgrep JSON output and convert to grouped path/line format
   * for cleaner display in logs and UI.
   *
   * Performance notes:
   *  - Uses a single running `totalMatches` counter (O(1) per match) instead of
   *    re-summing all buckets on every insert (previously O(n*m)).
   *  - Returns the unique match count directly so callers don't have to re-parse
   *    the formatted string to obtain it.
   */
  private async parseRipgrepJsonOutput(
    jsonOutput: string,
    cwd: string,
    maxMatches?: number,
  ): Promise<{ output: string; count: number }> {
    const lines = jsonOutput.split("\n");
    const matchesByFile = new Map<string, ParsedSearchLine[]>();
    const limit = maxMatches ?? this.MAX_TOTAL_MATCHES;
    let totalMatches = 0; // O(1) running counter of actual match lines

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.startsWith("{")) continue;

      try {
        const parsed = JSON.parse(trimmedLine) as { type?: string; data?: unknown };

        if (parsed.type === "match" || parsed.type === "context") {
          const resultData = parsed.data as RipgrepSearchResultData;
          const {
            path: ripgrepPath,
            lines: content,
            line_number,
            submatches = [],
          } = resultData;
          const filePathRaw = ripgrepPath.text;
          const filePath = path.relative(cwd, filePathRaw);
          const rawText = content.text ?? "";
          // We don't trim the start so we can preserve indentation for readability,
          // but we do trim the end to remove trailing newlines.
          const trimmedLineContent = rawText.trimEnd();
          const visibleLineContent = trimmedLineContent.substring(0, this.MAX_LINE_LENGTH);
          const visibleSubmatches =
            parsed.type === "match"
              ? submatches
                  .map((submatch) => ({
                    start: submatch.start,
                    end: submatch.end,
                  }))
                  .filter((submatch) => submatch.start < this.MAX_LINE_LENGTH)
                  .map((submatch) => ({
                    start: submatch.start,
                    end: Math.min(submatch.end, this.MAX_LINE_LENGTH),
                  }))
              : [];
          const lineContent =
            parsed.type === "match"
              ? wrapMatchedSubstrings(visibleLineContent, visibleSubmatches)
              : visibleLineContent;
          const truncatedSuffix =
            trimmedLineContent.length > this.MAX_LINE_LENGTH ? " [truncated]" : "";

          if (!matchesByFile.has(filePath)) {
            matchesByFile.set(filePath, []);
          }

          // Skip empty lines - they're just noise
          if (lineContent.trim()) {
            matchesByFile
              .get(filePath)!
              .push({
                line_number,
                content: `${lineContent}${truncatedSuffix}`,
                isMatch: parsed.type === "match",
              });

            if (parsed.type === "match") {
              totalMatches++;
            }
          }

          if (totalMatches >= limit) break;
        }
      } catch {
        console.warn(
          `Failed to parse JSON line: ${trimmedLine.substring(0, 50)}...`,
        );
      }
    }

    const formattedResults: string[] = [];
    let uniqueCount = 0;

    for (const [filePath, fileMatches] of matchesByFile.entries()) {
      // Get line count for the file
      const absolutePath = path.resolve(cwd, filePath);
      let lineCount = "?";
      try {
        const fileContent = await fs.readFile(absolutePath, "utf-8");
        lineCount = fileContent.split("\n").length.toString();
      } catch {
        // If we can't read the file, just skip the line count
      }
      
      formattedResults.push(`## ${filePath}|L${lineCount}`);
      
      // Deduplicate within the same file (context lines can overlap between adjacent matches).
      // If the same line appears as both context and match, keep the stronger match marker.
      const uniqueMatches = [...fileMatches]
        .sort((a, b) => a.line_number - b.line_number)
        .reduce<ParsedSearchLine[]>((acc, current) => {
          const last = acc[acc.length - 1];
          if (
            last &&
            last.line_number === current.line_number &&
            last.content === current.content
          ) {
            last.isMatch = last.isMatch || current.isMatch;
            return acc;
          }

          acc.push({ ...current });
          return acc;
        }, []);
      
      // Group matches that are within 10 lines of each other
      const groupedMatches: ParsedSearchLine[][] = [];
      let currentGroup: ParsedSearchLine[] = [];
      
      uniqueMatches.forEach((match, idx) => {
        if (currentGroup.length === 0) {
          currentGroup.push(match);
        } else {
          const lastMatch = currentGroup[currentGroup.length - 1];
          if (match.line_number - lastMatch.line_number <= 30) {
            currentGroup.push(match);
          } else {
            groupedMatches.push(currentGroup);
            currentGroup = [match];
          }
        }
        
        if (idx === uniqueMatches.length - 1 && currentGroup.length > 0) {
          groupedMatches.push(currentGroup);
        }
      });
      
      const maxLineNumLength = Math.max(...uniqueMatches.map(m => m.line_number.toString().length));
      
      groupedMatches.forEach((group, groupIdx) => {
        group.forEach((m) => {
          const paddedLineNum = m.line_number.toString().padStart(maxLineNumLength, " ");
          const marker = m.isMatch ? "*" : " ";
          formattedResults.push(`  ${paddedLineNum}${marker}→${m.content}`);
        });
        
        if (groupIdx < groupedMatches.length - 1) {
          formattedResults.push("  ..."); // Ellipsis to indicate gap between groups
        }
      });
      
      uniqueCount += uniqueMatches.filter((match) => match.isMatch).length;
    }

    return { output: formattedResults.join("\n").trim(), count: uniqueCount };
  }

  parseLegacy(params: Partial<Record<string, string>>): GrepParams {
    return {
      path: params.path || "",
      query: params.regex || params.query || params.pattern || "", // Support both old and new param names
      file_pattern: params.file_pattern || undefined,
      context_lines: params.context_lines
        ? parseInt(params.context_lines)
        : undefined,
      literal: params.literal === "true",
      whole_word: params.whole_word === "true",
      multiline: params.multiline === "true",
    };
  }

  async execute(
    params: GrepParams,
    task: Task,
    callbacks: ToolCallbacks,
  ): Promise<void> {
    const { askApproval, handleError, pushToolResult } = callbacks;

    const rawPathValues = Array.isArray(params.path) ? params.path : [params.path || "."];
    const query = params.query;
    const filePattern = params.file_pattern || params.include || undefined; // kade_change: Support 'include' alias
    const excludePattern = params.exclude; // kade_change: Support 'exclude'
    const contextLines = params.context_lines || 1;
    const requestedWholeWord = params.whole_word;
    const isCaseInsensitive = resolveCaseInsensitiveSearch(params);
    const includeAll = params.include_all || false;
    const includeTests = params.tests || false;
    const isMultiline = params.multiline || false;

    if (!query) {
      task.consecutiveMistakeCount++;
      task.recordToolError("grep");
      task.didToolFailInCurrentTurn = true;
      pushToolResult(await task.sayAndCreateMissingParamError("grep", "query"));
      return;
    }

    task.consecutiveMistakeCount = 0;

    const explicitLiteral = params.literal !== undefined;
    const normalizedQueryConfig = normalizeGrepQueries(query, {
      explicitLiteral,
      literal: params.literal,
    });
    const queries = normalizedQueryConfig.queries;
    const isLiteral = normalizedQueryConfig.literal;

    // Calculate per-query limit: divide total max by number of queries
    const perQueryLimit = Math.max(1, Math.floor(this.MAX_TOTAL_MATCHES / queries.length));

    // Split string paths by pipe/comma and support native string[] multi-path input.
    const rawPaths = rawPathValues.flatMap((value) =>
      typeof value === "string"
        ? value
            .split(/[|,]/)
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
    );
    if (rawPaths.length === 0) {
      rawPaths.push(".");
    }
    const resolvedPaths: string[] = [];

    for (const p of rawPaths) {
      const { resolvedPath } = await resolveRecursivePath(task.cwd, p);
      resolvedPaths.push(resolvedPath);
    }

    const relDirPaths = resolvedPaths;
    const absolutePaths = relDirPaths.map((p) => path.resolve(task.cwd, p));
    const isOutsideWorkspace = absolutePaths.some((p) =>
      isPathOutsideWorkspace(p),
    );

    const displayFilePattern = Array.isArray(filePattern)
      ? filePattern.join(", ")
      : (filePattern ?? undefined);

    const sharedMessageProps: ClineSayTool = {
      tool: "grep",
      path: relDirPaths.map((p) => getReadablePath(task.cwd, p)).join(", "),
      regex: Array.isArray(queries) ? queries.join("|") : String(queries[0] || ""), // For display purposes
      filePattern: displayFilePattern,
      isOutsideWorkspace,
      id: callbacks.toolCallId,
    };

    try {
      // Resolve the ripgrep binary path ONCE outside the query loop.
      // Previously this was called inside the loop, causing redundant filesystem
      // probes (up to 4 path checks per query) on every iteration.
      const vscodeAppRoot = vscode.env.appRoot;
      const rgPath = await getBinPath(vscodeAppRoot);

      if (!rgPath) {
        throw new Error("Could not find ripgrep binary");
      }

      /**
       * Build the argument list for a single query and execute ripgrep.
       * Keeping this as a local helper makes the parallel Promise.all below tidy.
       */
      const runSingleQuery = async (singleQuery: string): Promise<string> => {
        const rgArgs: string[] = ["--json", "--no-messages", "--follow"];
        const useWholeWord = shouldUseWholeWordSearch(singleQuery, {
          literal: isLiteral,
          wholeWord: requestedWholeWord,
        });

        if (isLiteral) {
          rgArgs.push("-F");
        }

        if (isCaseInsensitive) {
          rgArgs.push("-i");
        }

        if (useWholeWord) {
          rgArgs.push("-w");
        }

        if (isMultiline) {
          rgArgs.push("-U"); // Enable multiline matching
        }

        // Tell ripgrep to stop after `perQueryLimit` matches per file.
        // This lets the subprocess exit early instead of emitting thousands
        // of JSON lines that we would just discard in the JS layer.
        rgArgs.push("--max-count", String(perQueryLimit));

        rgArgs.push("--context", contextLines.toString());

        for (const glob of buildOrderedGrepGlobs({
          include: filePattern,
          exclude: excludePattern,
          includeAll,
          includeTests,
        })) {
          rgArgs.push("--glob", glob);
        }

        // Use -e so queries starting with "-" are never misread as flags
        rgArgs.push("-e", singleQuery);
        rgArgs.push(...absolutePaths);

        return execRipgrep(rgPath, rgArgs);
      };

      // Run all queries in parallel instead of sequentially.
      // For a single query this is a no-op; for multiple queries it avoids
      // waiting for each ripgrep subprocess to finish before starting the next.
      const rawResults = await Promise.all(queries.map(runSingleQuery));

      const querySegments: string[] = [];

      for (let i = 0; i < queries.length; i++) {
        const singleQuery = queries[i];
        const rawOutput = rawResults[i];

        if (!rawOutput) continue;

        // parseRipgrepJsonOutput now returns the unique match count directly,
        // so we no longer need to re-split and filter the formatted string.
        const { output: formattedResult, count: resultCount } =
          await this.parseRipgrepJsonOutput(rawOutput, task.cwd, perQueryLimit);

        if (!formattedResult) continue;

        let segment = `Query: "${singleQuery}" (${resultCount} matches, max ${perQueryLimit})\n${formattedResult}`;

        if (resultCount >= perQueryLimit) {
          segment += `\n[Reached per-query limit of ${perQueryLimit} results]`;
        }

        querySegments.push(segment);
      }

      const searchResults =
        querySegments.join("\n") ||
        (queries.length === 1
          ? `No matches found for query "${queries[0]}".`
          : `No matches found for queries ${queries.map((entry) => `"${entry}"`).join(", ")}.`);

      const completeMessage = JSON.stringify({
        ...sharedMessageProps,
        content: searchResults,
      } satisfies ClineSayTool);
      const didApprove = await askApproval("tool", completeMessage);

      if (!didApprove) {
        return;
      }

      const enhancedPushToolResult = (content: any) => {
        pushToolResult(content);
        (async () => {
          try {
            const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
              try {
                const parsed = JSON.parse(m.text || "{}");
                return (
                  (m.say === "tool" || m.ask === "tool") &&
                  parsed.tool === "grep" &&
                  parsed.id === callbacks.toolCallId
                );
              } catch {
                return false;
              }
            });

            if (lastMsgIndex !== -1) {
              const msg = task.clineMessages[lastMsgIndex];
              const toolData = JSON.parse(msg.text || "{}");
              toolData.content = content;
              msg.text = JSON.stringify(toolData);
              await task.updateClineMessage(msg);
            }
          } catch (error) {
            console.error(`[grep] Failed to update UI: ${error}`);
          }
        })();
      };

      enhancedPushToolResult(searchResults);
    } catch (error) {
      await handleError("searching files", error as Error);
    }
  }

  override async handlePartial(task: Task, block: ToolUse<"grep">): Promise<void> {
    if (!block.partial) {
      return
    }

    const nativeArgs = block.nativeArgs as Partial<GrepParams> | undefined
    const relDirPathValue = nativeArgs?.path || block.params.path
    const queryValue = nativeArgs?.query || block.params.query || block.params.regex
    const query = Array.isArray(queryValue) ? queryValue.join("|") : queryValue
    const filePattern = nativeArgs?.file_pattern || nativeArgs?.include || block.params.file_pattern || block.params.include

    if (!relDirPathValue && !query) {
      return
    }

    const normalizedPaths = (Array.isArray(relDirPathValue) ? relDirPathValue : [relDirPathValue || ""])
      .flatMap((value) =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : typeof value === "string"
            ? [value]
            : [],
      )
      .map((value) => (value ? this.removeClosingTag("path", value, block.partial) : ""))
      .filter(Boolean)

    const normalizedQuery = Array.isArray(query)
      ? query.filter((value): value is string => typeof value === "string").join("|")
      : query || ""

    const displayFilePattern = Array.isArray(filePattern)
      ? filePattern.join(", ")
      : (filePattern ?? undefined)

    const sharedMessageProps: ClineSayTool = {
      tool: "grep",
      path: normalizedPaths.map((value) => getReadablePath(task.cwd, value)).join(", "),
      regex: this.removeClosingTag("query", normalizedQuery, block.partial),
      filePattern: displayFilePattern,
      isOutsideWorkspace: normalizedPaths
        .map((value) => path.resolve(task.cwd, value))
        .some((absolutePath) => isPathOutsideWorkspace(absolutePath)),
      id: block.id,
    }

    const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
    await task.say("tool", partialMessage, undefined, block.partial).catch(() => {})
  }
}

export const grepTool = new GrepTool();
