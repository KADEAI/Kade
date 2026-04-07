import { Anthropic } from "@anthropic-ai/sdk";

import { TOOL_PROTOCOL, type ToolProtocol } from "@roo-code/types";

import { resolveToolAlias } from "../../shared/tool-aliases";
import {
  HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
  formatEditHistoryPreview,
  formatEditHistoryPlaceholder,
  formatWriteHistoryPlaceholder,
  formatWriteHistoryPlaceholderBody,
} from "../prompts/responses";
import { splitConsolidatedToolResults } from "./toolResultSeparators";
import type { ApiMessage } from "../task-persistence";
import type { AssistantMessageContent } from "../assistant-message/parseAssistantMessage";
import { parseStructuredEditBlocks } from "../tools/EditTool";

type AssistantToolSummary = {
  resultHeader: string;
};

type TextProtocolSerializationOptions = {
  preserveToolInvocationBodyIds?: Set<string>;
};

type HistorySegment = {
  kind: "text" | "tool";
  text: string;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function formatUnifiedInvocation(
  name: string,
  ...args: Array<string | undefined>
): string {
  const filtered = args.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return filtered.length > 0
    ? `@${name}: ${filtered.map((value) => quoteIfNeeded(value)).join(" ")}`
    : `@${name}:`;
}

function formatUnifiedWriteInvocation(path: string, content: string): string {
  return [`@write: ${path}`, content, "EOF"].join("\n");
}

function formatBrowserActionInvocation(
  input: Record<string, any>,
  protocol: ToolProtocol,
  asMarkdownBlock: (name: string, body: string) => string,
): string | null {
  const action = String(input.action ?? "").trim();
  if (!action) {
    return null;
  }

  const value = String(
    input.url ??
      input.coordinate ??
      input.text ??
      input.size ??
      input.path ??
      "",
  ).trim();
  const serialized = value
    ? `browser_action ${action} ${quoteIfNeeded(value)}`
    : `browser_action ${action}`;

  return protocol === TOOL_PROTOCOL.MARKDOWN
    ? asMarkdownBlock("browser_action", serialized)
    : serialized;
}

function formatDesktopActionInvocation(
  input: Record<string, any>,
  protocol: ToolProtocol,
  asMarkdownBlock: (name: string, body: string) => string,
): string | null {
  const action = String(input.action ?? "").trim();
  if (!action) {
    return null;
  }

  const coordinate =
    typeof input.coordinate === "string" ? input.coordinate.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";

  let command = action;
  if (action === "scroll") {
    command = coordinate && text ? `scroll:${coordinate}:${text}` : text ? `scroll:${text}` : action;
  } else if (
    [
      "mouse_move",
      "left_click",
      "left_click_drag",
      "right_click",
      "middle_click",
      "double_click",
    ].includes(action)
  ) {
    command = coordinate ? `${action}:${coordinate}` : action;
  } else if (action === "key" || action === "type") {
    command = text ? `${action}:${text}` : action;
  }

  return protocol === TOOL_PROTOCOL.MARKDOWN
    ? asMarkdownBlock("desktop", command)
    : formatUnifiedInvocation("desktop", command);
}

type HistoryEditBlock = {
  oldText: string;
  newText: string;
  startLine?: number;
  endLine?: number;
};

function normalizeHistoryEditBlocks(input: Record<string, any>): HistoryEditBlock[] {
  const rawEdit = input.edit ?? input.edits;

  if (Array.isArray(rawEdit)) {
    return rawEdit.flatMap((edit: any) => {
      if (typeof edit === "string") {
        return parseStructuredEditBlocks(edit).map((block) => {
          const legacyBlock = block as typeof block & {
            startLine?: number;
            endLine?: number;
          };

          return {
            oldText: block.oldText ?? "",
            newText: block.newText ?? "",
            startLine: legacyBlock.start_line ?? legacyBlock.startLine,
            endLine:
              legacyBlock.end_line ??
              legacyBlock.endLine ??
              legacyBlock.start_line ??
              legacyBlock.startLine,
          };
        });
      }

      if (edit && typeof edit === "object") {
        const startLine = edit.start_line ?? edit.startLine;
        const endLine =
          edit.end_line ?? edit.endLine ?? startLine;
        return [
          {
            oldText:
              edit.oldText ??
              edit.old_text ??
              HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
            newText:
              edit.newText ??
              edit.new_text ??
              HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
            startLine,
            endLine,
          },
        ];
      }

      return [];
    });
  }

  if (typeof rawEdit === "string") {
    return parseStructuredEditBlocks(rawEdit).map((block) => {
      const legacyBlock = block as typeof block & {
        startLine?: number;
        endLine?: number;
      };

      return {
        oldText: block.oldText ?? "",
        newText: block.newText ?? "",
        startLine: legacyBlock.start_line ?? legacyBlock.startLine,
        endLine:
          legacyBlock.end_line ??
          legacyBlock.endLine ??
          legacyBlock.start_line ??
          legacyBlock.startLine,
      };
    });
  }

  if (rawEdit && typeof rawEdit === "object") {
    const startLine = (rawEdit as any).start_line ?? (rawEdit as any).startLine;
    const endLine =
      (rawEdit as any).end_line ?? (rawEdit as any).endLine ?? startLine;
    return [
      {
        oldText:
          (rawEdit as any).oldText ??
          (rawEdit as any).old_text ??
          HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
        newText:
          (rawEdit as any).newText ??
          (rawEdit as any).new_text ??
          HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
        startLine,
        endLine,
      },
    ];
  }

  return [];
}

function formatUnifiedEditInvocation(path: string, input: Record<string, any>): string {
  const blocks = normalizeHistoryEditBlocks(input);
  if (blocks.length === 0) {
    return `@edit: ${path}`;
  }

  return [
    `@edit: ${path}`,
    ...blocks.map((block) => {
      const hasRange =
        typeof block.startLine === "number" && typeof block.endLine === "number";
      const rangeHeader = hasRange
        ? `old[${block.startLine}${block.endLine !== block.startLine ? `-${block.endLine}` : ""}]:`
        : "old:";
      return [
        rangeHeader,
        formatEditHistoryPreview(block.oldText),
        "new:",
        formatEditHistoryPreview(block.newText),
      ].join("\n");
    }),
  ].join("\n");
}

function formatShellHistoryPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty line)";
  }
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}

function normalizeToolName(name: string): string {
  const canonical = resolveToolAlias(name);
  switch (canonical) {
    case "bash":
      return "shell";
    case "glob":
      return "find";
    default:
      return canonical;
  }
}

function formatReadTargets(input: Record<string, any>): string[] {
  const files = Array.isArray(input.files)
    ? input.files
    : input.path
      ? [
          {
            path: input.path,
            lineRanges: input.line_ranges ?? input.lineRanges,
            head: input.head,
            tail: input.tail,
          },
        ]
      : [];

  return files
    .map((file: any) => {
      if (!file?.path) {
        return "";
      }

      const target = file.path;
      const lineRanges = Array.isArray(file.lineRanges)
        ? file.lineRanges
        : Array.isArray(file.line_ranges)
          ? file.line_ranges
          : [];

      if (lineRanges.length > 0) {
        const formattedRanges = lineRanges
          .map((range: any) => {
            if (
              range &&
              typeof range === "object" &&
              range.start !== undefined &&
              range.end !== undefined
            ) {
              return `${range.start}-${range.end}`;
            }
            if (Array.isArray(range) && range.length >= 2) {
              return `${range[0]}-${range[1]}`;
            }
            return "";
          })
          .filter(Boolean)
          .join(", ");
        return formattedRanges
          ? `read ${target} ${formattedRanges}`
          : `read ${target}`;
      }

      if (file.head !== undefined) {
        return `read ${target} H${file.head}`;
      }

      if (file.tail !== undefined) {
        return `read ${target} T${file.tail}`;
      }

      return `read ${target}`;
    })
    .filter(Boolean);
}

function formatUnifiedReadTargets(input: Record<string, any>): string[] {
  const files = Array.isArray(input.files)
    ? input.files
    : input.path
      ? [
          {
            path: input.path,
            lineRanges: input.line_ranges ?? input.lineRanges,
            head: input.head,
            tail: input.tail,
          },
        ]
      : [];

  return files
    .map((file: any) => {
      if (!file?.path) {
        return "";
      }

      let target = String(file.path);
      const lineRanges = Array.isArray(file.lineRanges)
        ? file.lineRanges
        : Array.isArray(file.line_ranges)
          ? file.line_ranges
          : [];

      if (lineRanges.length > 0) {
        const formattedRanges = lineRanges
          .map((range: any) => {
            if (
              range &&
              typeof range === "object" &&
              range.start !== undefined &&
              range.end !== undefined
            ) {
              return `${range.start}-${range.end}`;
            }
            if (Array.isArray(range) && range.length >= 2) {
              return `${range[0]}-${range[1]}`;
            }
            return "";
          })
          .filter(Boolean)
          .join(",");
        if (formattedRanges) {
          target += `:${formattedRanges}`;
        }
      } else if (file.head !== undefined) {
        target += `:H${file.head}`;
      } else if (file.tail !== undefined) {
        target += `:T${file.tail}`;
      }

      return formatUnifiedInvocation("read", target);
    })
    .filter(Boolean);
}

function formatEditBlocks(input: Record<string, any>): string {
  const rawEdit = typeof input.edit === "string" ? input.edit.trim() : "";
  if (rawEdit) {
    return rawEdit;
  }

  const edits = Array.isArray(input.edit)
    ? input.edit
    : Array.isArray(input.edits)
      ? input.edits
      : [];
  return edits
    .map((edit: any) => {
      const startLine = edit?.start_line ?? edit?.startLine;
      const endLine = edit?.end_line ?? edit?.endLine ?? startLine;
      const explicitRange = edit?.lineRange ?? edit?.range;
      const range =
        explicitRange ??
        (startLine !== undefined && endLine !== undefined
          ? `${startLine}-${endLine}`
          : "");
      const searchHeader = range ? `old[${range}]:` : "old:";
      return [
        searchHeader,
        edit?.oldText ?? edit?.old_text ?? "",
        "new:",
        edit?.newText ?? edit?.new_text ?? "",
      ]
        .join("\n")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}

function formatTextProtocolToolUse(
  block: Anthropic.ToolUseBlock,
  protocol: ToolProtocol,
): { invocation: string | null; resultHeader: string } {
  const normalizedName = normalizeToolName(block.name);
  const input = ((block as any).input ?? {}) as Record<string, any>;
  const path = typeof input.path === "string" ? input.path : "";
  const isUnified = protocol === TOOL_PROTOCOL.UNIFIED;
  const asMarkdownBlock = (name: string, body: string) =>
    `\
\`\`\`${name}
${body}
\`\`\``;

  switch (normalizedName) {
    case "list": {
      const unifiedInvocation = formatUnifiedInvocation("list", path || ".");
      const markdownInvocation = asMarkdownBlock(
        "ls",
        path && path !== "." ? path : "",
      );
      return {
        invocation:
          protocol === TOOL_PROTOCOL.MARKDOWN
            ? markdownInvocation
            : unifiedInvocation,
        resultHeader: `[LIST for '${path || "."}']`,
      };
    }

    case "read": {
      const lines = isUnified
        ? formatUnifiedReadTargets(input)
        : formatReadTargets(input);
      const markdownBody = formatReadTargets(input)
        .map((line) => line.replace(/^read\s+/, ""))
        .join("\n");
      return {
        invocation:
          lines.length > 0
            ? protocol === TOOL_PROTOCOL.MARKDOWN
              ? asMarkdownBlock("read", markdownBody)
              : lines.join("\n")
            : null,
        resultHeader: `[READ for '${path || input.file || "unknown"}']`,
      };
    }

    case "grep": {
      const queryValues = toArray(input.query ?? input.pattern ?? input.regex)
        .map(String)
        .filter(Boolean);
      const query = queryValues.join("|");
      return {
        invocation: query
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock(
                "grep",
                `${query}${path && path !== "." ? ` ${path}` : ""}`,
              )
            : formatUnifiedInvocation(
                "grep",
                query,
                path && path !== "." ? path : undefined,
              )
          : null,
        resultHeader: `[GREP for '${query || "unknown"}'${path ? ` in '${path}'` : ""}]`,
      };
    }

    case "find": {
      const patternValues = toArray(
        input.pattern ?? input.query ?? input.extension,
      )
        .map(String)
        .filter(Boolean);
      const pattern = patternValues.join("|");
      return {
        invocation: pattern
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock(
                "find",
                `${pattern}${path && path !== "." ? ` ${path}` : ""}`,
              )
            : formatUnifiedInvocation(
                "find",
                pattern,
                path && path !== "." ? path : undefined,
              )
          : null,
        resultHeader: `[FIND for '${pattern || "unknown"}'${path ? ` in '${path}'` : ""}]`,
      };
    }

    case "shell": {
      const command = String(input.command ?? "").trim();
      const hasStdin = Object.prototype.hasOwnProperty.call(input, "stdin");
      const stdin = typeof input.stdin === "string" ? input.stdin : "";
      const executionId = String(
        input.execution_id ?? input.executionId ?? "",
      ).trim();

      if (hasStdin) {
        const stdinArg = `--stdin ${quoteIfNeeded(stdin)}`;
        const executionArg = executionId
          ? ` --execution_id ${quoteIfNeeded(executionId)}`
          : "";
        const serializedStdinInvocation = `${stdinArg}${executionArg}`;
        return {
          invocation:
            protocol === TOOL_PROTOCOL.MARKDOWN
              ? asMarkdownBlock("bash", serializedStdinInvocation)
              : formatUnifiedInvocation("bash", serializedStdinInvocation),
          resultHeader: `[SHELL stdin '${formatShellHistoryPreview(stdin)}'${executionId ? ` for '${executionId}'` : ""}]`,
        };
      }

      if (!command) {
        return { invocation: null, resultHeader: `[SHELL]` };
      }
      return {
        invocation:
          protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock(
                "bash",
                input.cwd ? `${input.cwd}: ${command}` : command,
              )
            : formatUnifiedInvocation(
                "bash",
                command,
                typeof input.cwd === "string" && input.cwd.length > 0
                  ? input.cwd
                  : undefined,
              ),
        resultHeader: `[SHELL for '${command}'${input.cwd ? ` in '${input.cwd}'` : ""}]`,
      };
    }

    case "ask":
    case "web":
    case "fetch":
    case "agent": {
      const query = String(
        input.query ?? input.url ?? input.prompt ?? "",
      ).trim();
      const keyword = normalizedName;
      return {
        invocation: query
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock(keyword === "agent" ? "agent" : keyword, query)
            : formatUnifiedInvocation(keyword, query)
          : null,
        resultHeader: `[${keyword.toUpperCase()} for '${query || "unknown"}']`,
      };
    }

    case "browser_action": {
      const action = String(input.action ?? "").trim();
      return {
        invocation: formatBrowserActionInvocation(
          input,
          protocol,
          asMarkdownBlock,
        ),
        resultHeader: `[BROWSER_ACTION for '${action || "unknown"}']`,
      };
    }

    case "computer_action": {
      const action = String(input.action ?? "").trim();
      return {
        invocation: formatDesktopActionInvocation(
          input,
          protocol,
          asMarkdownBlock,
        ),
        resultHeader: `[COMPUTER_ACTION for '${action || "unknown"}']`,
      };
    }

    case "write": {
      const content = typeof input.content === "string" ? input.content : "";
      return {
        invocation: path
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock("write", `${path}\n${content}`.trim())
            : formatUnifiedWriteInvocation(path, content)
          : null,
        resultHeader: `[WRITE for '${path || "unknown"}']`,
      };
    }

    case "edit": {
      return {
        invocation: path
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock("edit", `${path}\n${formatEditBlocks(input)}`.trim())
            : formatUnifiedEditInvocation(path, input)
          : null,
        resultHeader: `[EDIT for '${path || "unknown"}']`,
      };
    }

    case "todo": {
      const todos =
        typeof input.todos === "string"
          ? input.todos
          : Array.isArray(input.todos)
            ? input.todos.join("\n")
            : "";
      return {
        invocation: todos
          ? protocol === TOOL_PROTOCOL.MARKDOWN
            ? asMarkdownBlock("todo", todos)
            : `@todo:\n${todos}`
          : null,
        resultHeader: `[TODO]`,
      };
    }

    default: {
      const inputText =
        Object.keys(input).length > 0 ? ` ${JSON.stringify(input)}` : "";
      return {
        invocation: null,
        resultHeader: `[${normalizeToolName(block.name).toUpperCase()}${inputText}]`,
      };
    }
  }
}

function stringifyToolResultContent(
  content: Anthropic.ToolResultBlockParam["content"],
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is Anthropic.TextBlockParam => block.type === "text",
      )
      .map((block) => block.text)
      .join("\n\n");
  }

  return "";
}

function isToolResultFailureText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).status === "error"
    ) {
      return true;
    }
  } catch {
    // Ignore non-JSON tool results.
  }

  return (
    trimmed.includes("The tool execution failed with the following error:") ||
    trimmed.includes("Missing value for required parameter '") ||
    trimmed.includes('Error: Unknown tool command "') ||
    /^\[\d+\]\s+(?:execute|tool)\b[\s\S]*?\nError:\s/m.test(trimmed) ||
    trimmed.includes('"status":"error"') ||
    trimmed.includes('"status": "error"')
  );
}

function getToolUseIdsFromTextResultBlock(
  block: Anthropic.TextBlockParam & {
    _toolUseId?: string;
    _toolUseIds?: string[];
  },
): string[] {
  if (Array.isArray(block._toolUseIds) && block._toolUseIds.length > 0) {
    return block._toolUseIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }

  return typeof block._toolUseId === "string" && block._toolUseId.length > 0
    ? [block._toolUseId]
    : [];
}

function collectFailedToolUseIdsFromTextResultBlock(
  block: Anthropic.TextBlockParam & {
    _toolUseId?: string;
    _toolUseIds?: string[];
  },
  failedToolUseIds: Set<string>,
): void {
  const toolUseIds = getToolUseIdsFromTextResultBlock(block);
  if (toolUseIds.length === 0) {
    return;
  }

  const segments = splitConsolidatedToolResults(block.text);
  toolUseIds.forEach((toolUseId, index) => {
    const segment =
      segments[index] ?? (toolUseIds.length === 1 ? block.text : "");
    if (isToolResultFailureText(segment)) {
      failedToolUseIds.add(toolUseId);
    }
  });
}

export function collectFailedToolUseIdsFromContentBlocks(
  blocks: Anthropic.ContentBlockParam[],
): Set<string> {
  const failedToolUseIds = new Set<string>();

  for (const block of blocks) {
    if (block.type === "tool_result") {
      if (isToolResultFailureText(stringifyToolResultContent(block.content))) {
        failedToolUseIds.add(block.tool_use_id);
      }
      continue;
    }

    if (block.type === "text") {
      collectFailedToolUseIdsFromTextResultBlock(
        block as Anthropic.TextBlockParam & {
          _toolUseId?: string;
          _toolUseIds?: string[];
        },
        failedToolUseIds,
      );
    }
  }

  return failedToolUseIds;
}

function collectFailedToolUseIdsFromMessages(
  messages: ApiMessage[],
): Set<string> {
  const failedToolUseIds = new Set<string>();

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    collectFailedToolUseIdsFromContentBlocks(message.content).forEach((id) =>
      failedToolUseIds.add(id),
    );
  }

  return failedToolUseIds;
}

function shouldPreserveToolInvocationBody(
  toolName: string,
  toolUseId: string | undefined,
  preserveToolInvocationBodyIds?: Set<string>,
): boolean {
  if (!toolUseId || !preserveToolInvocationBodyIds?.has(toolUseId)) {
    return false;
  }

  const normalizedToolName = normalizeToolName(toolName);
  return normalizedToolName === "write" || normalizedToolName === "edit";
}

function renderHistorySegments(
  segments: HistorySegment[],
  protocol: ToolProtocol,
): string[] {
  const rendered: string[] = [];
  const pendingToolInvocations: string[] = [];

  const flushPendingToolInvocations = () => {
    if (pendingToolInvocations.length === 0) {
      return;
    }

    rendered.push(
      protocol === TOOL_PROTOCOL.UNIFIED
        ? pendingToolInvocations.join("\n")
        : pendingToolInvocations.join("\n\n"),
    );
    pendingToolInvocations.length = 0;
  };

  for (const segment of segments) {
    if (!segment.text.trim()) {
      continue;
    }

    if (segment.kind === "tool") {
      pendingToolInvocations.push(segment.text);
      continue;
    }

    flushPendingToolInvocations();
    rendered.push(segment.text);
  }

  flushPendingToolInvocations();
  return rendered;
}

export function translateApiMessagesForUnifiedHistory(
  messages: ApiMessage[],
  protocol: ToolProtocol,
): ApiMessage[] {
  if (
    protocol !== TOOL_PROTOCOL.UNIFIED &&
    protocol !== TOOL_PROTOCOL.MARKDOWN
  ) {
    return messages;
  }

  const translated: ApiMessage[] = [];
  const failedToolUseIds = collectFailedToolUseIdsFromMessages(messages);
  let previousAssistantTools = new Map<string, AssistantToolSummary>();

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      translated.push(message);
      continue;
    }

    if (message.role === "assistant") {
      const passthroughBlocks: Anthropic.ContentBlockParam[] = [];
      const toolHistorySegments: HistorySegment[] = [];
      const currentAssistantTools = new Map<string, AssistantToolSummary>();

      for (const block of message.content) {
        if (block.type !== "tool_use") {
          passthroughBlocks.push(block);
          continue;
        }

        const toolUseBlock = block as Anthropic.ToolUseBlock;
        const { invocation, resultHeader } = formatTextProtocolToolUse(
          toolUseBlock,
          protocol,
        );
        currentAssistantTools.set((block as Anthropic.ToolUseBlock).id, {
          resultHeader,
        });
        if (!invocation) {
          toolHistorySegments.push({
            kind: "text",
            text: resultHeader,
          });
          continue;
        }

        const input = ((toolUseBlock as any).input ?? {}) as Record<
          string,
          any
        >;
        const preserveBody = shouldPreserveToolInvocationBody(
          toolUseBlock.name,
          toolUseBlock.id,
          failedToolUseIds,
        );
        toolHistorySegments.push(
          preserveBody
            ? {
                kind: "tool",
                text: invocation,
              }
            : (compactHistoryInvocationForTool(
                toolUseBlock.name,
                typeof input.path === "string"
                  ? input.path
                  : typeof input.target_file === "string"
                    ? input.target_file
                    : undefined,
                protocol,
                input,
              ) ?? {
                kind: "tool",
                text: invocation,
              }),
        );
      }

      for (const renderedText of renderHistorySegments(
        toolHistorySegments,
        protocol,
      )) {
        passthroughBlocks.push({
          type: "text",
          text: renderedText,
        });
      }

      previousAssistantTools = currentAssistantTools;
      translated.push({
        ...message,
        content: passthroughBlocks,
      });
      continue;
    }

    if (message.role === "user") {
      const translatedBlocks: Anthropic.ContentBlockParam[] = [];

      for (const block of message.content) {
        if (block.type !== "tool_result") {
          translatedBlocks.push(block);
          continue;
        }

        const summary = previousAssistantTools.get(block.tool_use_id);
        const resultBody = stringifyToolResultContent(block.content);
        const resultHeader =
          summary?.resultHeader ??
          `[TOOL_RESULT ${quoteIfNeeded(block.tool_use_id)}]`;
        const text = resultBody.startsWith(resultHeader)
          ? resultBody
          : `${resultHeader}\n${resultBody || "(tool did not return anything)"}`;
        translatedBlocks.push({
          type: "text",
          text,
        });
      }

      translated.push({
        ...message,
        content: translatedBlocks,
      });
      continue;
    }

    translated.push(message);
  }

  return translated;
}

function getToolInputFromAssistantBlock(
  block: AssistantMessageContent,
): Record<string, any> {
  if (block.type === "mcp_tool_use") {
    return block.arguments;
  }

  if (block.type === "tool_use") {
    const historyInput = (block as any).historyInput;
    if (
      historyInput &&
      typeof historyInput === "object" &&
      !Array.isArray(historyInput)
    ) {
      return historyInput as Record<string, any>;
    }
    const nativeArgs = block.nativeArgs as Record<string, any> | undefined;
    if (nativeArgs && Object.keys(nativeArgs).length > 0) {
      return nativeArgs;
    }
    return block.params as Record<string, any>;
  }

  return {};
}

function compactHistoryInvocationForTool(
  toolName: string,
  path: string | undefined,
  protocol: ToolProtocol,
  input?: Record<string, any>,
): HistorySegment | null {
  const normalizedToolName = normalizeToolName(toolName);
  const compactPath = path || "unknown";

  if (normalizedToolName === "write") {
    const writeContent =
      typeof input?.content === "string"
        ? input.content
        : typeof input?.write === "string"
          ? input.write
          : undefined;
    const compactContent = formatWriteHistoryPlaceholderBody(writeContent);
    return {
      kind: protocol === TOOL_PROTOCOL.UNIFIED ? "tool" : "text",
      text:
        protocol === TOOL_PROTOCOL.UNIFIED
          ? formatUnifiedWriteInvocation(compactPath, compactContent)
          : ["```tool", formatWriteHistoryPlaceholder(compactPath, writeContent), "```"].join(
              "\n",
            ),
    };
  }

  if (normalizedToolName === "edit") {
    const placeholderInput = {
      ...(input ?? {}),
      edit: normalizeHistoryEditBlocks(input ?? {}).map((block) => ({
        start_line: block.startLine,
        end_line: block.endLine,
        oldText: formatEditHistoryPreview(block.oldText),
        newText: formatEditHistoryPreview(block.newText),
      })),
    };
    return {
      kind: protocol === TOOL_PROTOCOL.UNIFIED ? "tool" : "text",
      text:
        protocol === TOOL_PROTOCOL.UNIFIED
          ? formatUnifiedEditInvocation(compactPath, placeholderInput)
          : [
              "```tool",
              formatEditHistoryPlaceholder(compactPath, input ? formatEditBlocks(input) : ""),
              "```",
            ].join("\n"),
    };
  }

  return null;
}

function compactInvocationForHistory(
  block: Extract<
    AssistantMessageContent,
    { type: "tool_use" | "mcp_tool_use" }
  >,
  invocation: string | null,
  protocol: ToolProtocol,
): HistorySegment | null {
  if (!invocation || block.type !== "tool_use") {
    return invocation
      ? {
          kind: "tool",
          text: invocation,
        }
      : null;
  }

  const path =
    block.params.path ||
    block.params.target_file ||
    ((block.nativeArgs as any)?.path as string | undefined) ||
    "unknown";
  return (
    compactHistoryInvocationForTool(
      block.name,
      path,
      protocol,
      getToolInputFromAssistantBlock(block),
    ) ?? {
      kind: "tool",
      text: invocation,
    }
  );
}

export function serializeAssistantBlocksForTextProtocol(
  blocks: AssistantMessageContent[],
  protocol: ToolProtocol,
  options?: TextProtocolSerializationOptions,
): string {
  if (
    protocol !== TOOL_PROTOCOL.UNIFIED &&
    protocol !== TOOL_PROTOCOL.MARKDOWN
  ) {
    return "";
  }

  const outputParts: string[] = [];
  const hasAnyToolBlocks = blocks.some(
    (block) => block.type === "tool_use" || block.type === "mcp_tool_use",
  );
  const historySegments: HistorySegment[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      if (hasAnyToolBlocks) {
        continue;
      }

      const text = block.content.trim();
      if (text) {
        outputParts.push(text);
      }
      continue;
    }

    const toolName =
      block.type === "tool_use"
        ? block.name
        : `${block.serverName}_${block.toolName}`;
    const { invocation, resultHeader } = formatTextProtocolToolUse(
      {
        type: "tool_use",
        id: block.id ?? "",
        name: toolName as any,
        input: getToolInputFromAssistantBlock(block),
      } as Anthropic.ToolUseBlock,
      protocol,
    );
    const preserveBody = shouldPreserveToolInvocationBody(
      toolName,
      block.id,
      options?.preserveToolInvocationBodyIds,
    );
    const compactedInvocation = preserveBody
      ? invocation
        ? {
            kind: "tool" as const,
            text: invocation,
          }
        : null
      : compactInvocationForHistory(
          block as Extract<
            AssistantMessageContent,
            { type: "tool_use" | "mcp_tool_use" }
          >,
          invocation,
          protocol,
        );

    if (!compactedInvocation) {
      historySegments.push({
        kind: "text",
        text: resultHeader,
      });
      continue;
    }

    historySegments.push(compactedInvocation);
  }

  outputParts.push(...renderHistorySegments(historySegments, protocol));
  return outputParts.join("\n\n").trim();
}
