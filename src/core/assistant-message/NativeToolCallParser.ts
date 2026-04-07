import { type ToolName, toolNames, type FileEntry } from "@roo-code/types";
import {
  type ToolUse,
  type McpToolUse,
  type ToolParamName,
  toolParamNames,
  type NativeToolArgs,
} from "../../shared/tools";
import { resolveToolAlias } from "../../shared/tool-aliases"; // kade_change
import { parseJSON } from "partial-json";
import { z } from "zod";
import type {
  ApiStreamToolCallStartChunk,
  ApiStreamToolCallDeltaChunk,
  ApiStreamToolCallEndChunk,
} from "../../api/transform/stream";
import {
  MCP_TOOL_PREFIX,
  MCP_TOOL_SEPARATOR,
  parseMcpToolName,
} from "../../utils/mcp-name";
import { convertFileEntries, extractParamsFromXml } from "./XmlToolParser";
import { parseStructuredEditBlocks } from "../tools/EditTool";
import {
  HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
  formatEditHistoryPreview,
  formatWriteHistoryPlaceholderBody,
  redactEditHistoryBody,
} from "../prompts/responses";
import {
  resolveContentRouterTool,
  resolveToolsRouterOperation,
} from "../prompts/tools/native-tools/registry";

/**
 * Helper type to extract properly typed native arguments for a given tool.
 * Returns the type from NativeToolArgs if the tool is defined there, otherwise never.
 */
type NativeArgsFor<TName extends ToolName> = TName extends keyof NativeToolArgs
  ? NativeToolArgs[TName]
  : never;
type NativeEditInput = NativeToolArgs["edit"]["edit"];
type NativeEditBlock = Exclude<
  Extract<NativeEditInput, Array<unknown>>[number],
  string
>;

const EXECUTE_NON_EMPTY_STRING = z.string().trim().min(1, "must be a non-empty string");
const EXECUTE_NON_EMPTY_STRING_OR_ARRAY = z.union([
  EXECUTE_NON_EMPTY_STRING,
  z.array(EXECUTE_NON_EMPTY_STRING).min(1, "must contain at least one item"),
]);
const EXECUTE_EDIT_BLOCK_SCHEMA = z
  .object({
    lines: EXECUTE_NON_EMPTY_STRING.optional(),
    lineRange: EXECUTE_NON_EMPTY_STRING.optional(),
    old: EXECUTE_NON_EMPTY_STRING.optional(),
    oldText: EXECUTE_NON_EMPTY_STRING.optional(),
    new: EXECUTE_NON_EMPTY_STRING.optional(),
    newText: EXECUTE_NON_EMPTY_STRING.optional(),
    start_line: z.number().int().positive().optional(),
    end_line: z.number().int().positive().optional(),
    range: z.any().optional(),
    type: EXECUTE_NON_EMPTY_STRING.optional(),
    replaceAll: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.old === undefined &&
      value.oldText === undefined &&
      value.new === undefined &&
      value.newText === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must include old or new",
      });
    }
  });
const EXECUTE_READ_TARGET = z.union([
  EXECUTE_NON_EMPTY_STRING,
  z.object({
    path: EXECUTE_NON_EMPTY_STRING,
  }).passthrough(),
]);
const EXECUTE_BROWSER_ACTIONS = [
  "launch",
  "click",
  "hover",
  "type",
  "press",
  "scroll_down",
  "scroll_up",
  "resize",
  "close",
  "screenshot",
] as const;
const EXECUTE_COMPUTER_ACTIONS = [
  "key",
  "type",
  "mouse_move",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "scroll",
  "get_screenshot",
  "get_cursor_position",
] as const;
const EXECUTE_CALL_ARGUMENT_SCHEMAS = {
  read: z
    .object({
      files: z.array(EXECUTE_READ_TARGET).min(1, "must include at least one file target"),
    })
    .strict(),
  grep: z
    .object({
      query: EXECUTE_NON_EMPTY_STRING_OR_ARRAY,
      path: EXECUTE_NON_EMPTY_STRING.optional(),
      case_insensitive: z.boolean().optional(),
      whole_word: z.boolean().optional(),
      literal: z.boolean().optional(),
      multiline: z.boolean().optional(),
    })
    .strict(),
  glob: z
    .object({
      pattern: EXECUTE_NON_EMPTY_STRING_OR_ARRAY,
      path: EXECUTE_NON_EMPTY_STRING.optional(),
      case_insensitive: z.boolean().optional(),
    })
    .strict(),
  list: z
    .object({
      path: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict(),
  bash: z
    .object({
      command: EXECUTE_NON_EMPTY_STRING,
      cwd: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict(),
  web: z
    .object({
      query: EXECUTE_NON_EMPTY_STRING,
    })
    .strict(),
  ask: z
    .object({
      query: EXECUTE_NON_EMPTY_STRING,
      path: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict(),
  agent: z
    .object({
      prompt: EXECUTE_NON_EMPTY_STRING,
    })
    .strict(),
  fetch: z
    .object({
      url: EXECUTE_NON_EMPTY_STRING,
    })
    .strict(),
  edit: z
    .object({
      path: EXECUTE_NON_EMPTY_STRING,
      edit: z.union([
        EXECUTE_NON_EMPTY_STRING,
        EXECUTE_EDIT_BLOCK_SCHEMA,
        z.array(EXECUTE_EDIT_BLOCK_SCHEMA).min(1, "must include at least one edit block"),
      ]),
    })
    .strict(),
  write: z
    .object({
      path: EXECUTE_NON_EMPTY_STRING,
      content: z.string().min(1, "must not be empty"),
    })
    .strict(),
  todo: z
    .object({
      todos: z.string().min(1, "must not be empty"),
    })
    .strict(),
  browser_action: z
    .object({
      action: z.enum(EXECUTE_BROWSER_ACTIONS),
      url: EXECUTE_NON_EMPTY_STRING.optional(),
      coordinate: EXECUTE_NON_EMPTY_STRING.optional(),
      size: EXECUTE_NON_EMPTY_STRING.optional(),
      text: EXECUTE_NON_EMPTY_STRING.optional(),
      path: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.action === "launch" && !value.url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: 'is required when action is "launch"',
        });
      }
      if ((value.action === "click" || value.action === "hover") && !value.coordinate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinate"],
          message: `is required when action is "${value.action}"`,
        });
      }
      if (value.action === "resize" && !value.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["size"],
          message: 'is required when action is "resize"',
        });
      }
      if ((value.action === "type" || value.action === "press") && !value.text) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: `is required when action is "${value.action}"`,
        });
      }
    }),
  computer_action: z
    .object({
      action: z.enum(EXECUTE_COMPUTER_ACTIONS),
      coordinate: EXECUTE_NON_EMPTY_STRING.optional(),
      text: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        [
          "mouse_move",
          "left_click_drag",
          "scroll",
        ].includes(value.action) &&
        !value.coordinate
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinate"],
          message: `is required when action is "${value.action}"`,
        });
      }
      if ((value.action === "key" || value.action === "type" || value.action === "scroll") && !value.text) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: `is required when action is "${value.action}"`,
        });
      }
    }),
  access_mcp_resource: z
    .object({
      server_name: EXECUTE_NON_EMPTY_STRING,
      uri: EXECUTE_NON_EMPTY_STRING,
    })
    .strict(),
  generate_image: z
    .object({
      prompt: EXECUTE_NON_EMPTY_STRING,
      path: EXECUTE_NON_EMPTY_STRING,
      image: EXECUTE_NON_EMPTY_STRING.optional(),
    })
    .strict(),
} satisfies Record<string, z.ZodType<Record<string, any>>>;
type GroupedBatchToolName =
  | "tool"
  | "execute"
  | "tools"
  | "workspace"
  | "content"
  | "internet"
  | "system";

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 */
/**
 * Event types returned from raw chunk processing.
 */
export type ToolCallStreamEvent =
  | ApiStreamToolCallStartChunk
  | ApiStreamToolCallDeltaChunk
  | ApiStreamToolCallEndChunk;

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 *
 * This class also handles raw tool call chunk processing, converting
 * provider-level raw chunks into start/delta/end events.
 */
export class NativeToolCallParser {
  private static normalizeNativeEditTextValue(
    value: unknown,
  ): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private static getNativeEditLineRange(
    args: Record<string, any>,
  ): unknown {
    return args.lines ?? args.lineRange ?? args.range;
  }

  private static getNativeEditOldText(
    args: Record<string, any>,
  ): string | undefined {
    return this.normalizeNativeEditTextValue(
      args.old ?? args.otxt ?? args.oldText ?? args.old_text ?? args.old_string ?? args.search,
    );
  }

  private static getNativeEditNewText(
    args: Record<string, any>,
  ): string | undefined {
    return this.normalizeNativeEditTextValue(
      args.new ?? args.ntxt ?? args.newText ?? args.new_text ?? args.new_string ?? args.replace,
    );
  }

  private static readonly IGNORED_META_ARGUMENT_KEYS = new Set([
    "_placeholder",
  ]);
  private static readonly GROUPED_BATCH_TOOL_NAMES =
    new Set<GroupedBatchToolName>([
      "tool",
      "execute",
      "tools",
      "workspace",
      "content",
      "internet",
      "system",
    ]);
  private static readonly EXECUTE_COMMAND_NAMES = new Set([
    "read",
    "grep",
    "glob",
    "list",
    "bash",
    "web",
    "ask",
    "agent",
    "fetch",
    "edit",
    "write",
    "todo",
    "browser_action",
    "computer_action",
    "access_mcp_resource",
      "generate_image",
    ]);

  private static isExecutePayload(
    args: unknown,
  ): args is { calls?: unknown; tools?: unknown; commands?: unknown } & Record<string, any> {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return false;
    }

    const record = args as Record<string, unknown>;
    const candidate = record.calls ?? record.tools ?? record.commands;
    if (candidate === undefined) {
      return false;
    }

    if (typeof candidate === "string") {
      return true;
    }

    return Array.isArray(candidate) && candidate.every((value) => typeof value === "string");
  }

  private static unwrapToolArgumentEnvelope(
    args: unknown,
    fallbackResolvedName?: string,
  ): { args: Record<string, any>; resolvedName?: string } | undefined {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return undefined;
    }

    const record = args as Record<string, any>;
    const nestedArgs =
      record.arguments ??
      record.args ??
      record.params ??
      record.input;

    if (!nestedArgs || typeof nestedArgs !== "object" || Array.isArray(nestedArgs)) {
      return undefined;
    }

    const rawWrappedName =
      typeof record.name === "string"
        ? record.name
        : typeof record.tool === "string"
          ? record.tool
          : undefined;
    const resolvedWrappedName = rawWrappedName
      ? resolveToolAlias(rawWrappedName)
      : undefined;
    const hasOnlyWrapperKeys = Object.keys(record).every((key) =>
      ["name", "tool", "arguments", "args", "params", "input", "id", "type"].includes(key),
    );

    if (
      resolvedWrappedName &&
      fallbackResolvedName &&
      resolvedWrappedName !== fallbackResolvedName
    ) {
      if (!((resolvedWrappedName === "execute" || resolvedWrappedName === "tool") && this.isExecutePayload(nestedArgs))) {
        return undefined;
      }
    } else if (!resolvedWrappedName && !hasOnlyWrapperKeys) {
      return undefined;
    }

    return {
      args: nestedArgs as Record<string, any>,
      resolvedName: resolvedWrappedName,
    };
  }

  private static shouldPreserveOriginalGroupedHistoryInput(
    nativeArgs: unknown,
  ): boolean {
    if (!nativeArgs || typeof nativeArgs !== "object" || Array.isArray(nativeArgs)) {
      return false;
    }

    const record = nativeArgs as Record<string, any>;
    const calls = Array.isArray(record.calls) ? record.calls : undefined;
    const parseErrors = Array.isArray(record.parseErrors)
      ? record.parseErrors
      : undefined;

    return (
      typeof record.parseError === "string" ||
      (parseErrors !== undefined && parseErrors.length > 0) ||
      (!!calls && calls.length === 0 && typeof record.missingParamName === "string")
    );
  }

  private static shouldPreserveGroupedHistoryInputForHistory(
    resolvedName: string,
    args: unknown,
  ): args is Record<string, unknown> {
    return (
      this.isGroupedBatchToolName(resolvedName) &&
      !!args &&
      typeof args === "object" &&
      !Array.isArray(args)
    );
  }

  // Streaming state management for argument accumulation (keyed by tool call id)
  // Note: name is string to accommodate dynamic MCP tools (mcp_serverName_toolName)
  private static streamingToolCalls = new Map<
    string,
    {
      id: string;
      name: string;
      argumentsAccumulator: string;
    }
  >();

  // Raw chunk tracking state (keyed by index from API stream)
  private static rawChunkTracker = new Map<
    number,
    {
      id: string;
      name: string;
      hasStarted: boolean;
      deltaBuffer: string[];
    }
  >();

  // Turn-specific identifier to ensure tool call IDs are unique across turns
  private static currentTurnId = Date.now().toString();

  /**
   * Process a raw tool call chunk from the API stream.
   * Handles tracking, buffering, and emits start/delta/end events.
   *
   * This is the entry point for providers that emit tool_call_partial chunks.
   * Returns an array of events to be processed by the consumer.
   */
  public static processRawChunk(chunk: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }): ToolCallStreamEvent[] {
    const events: ToolCallStreamEvent[] = [];
    const { index, id, name, arguments: args } = chunk;

    let tracked = this.rawChunkTracker.get(index);

    // Initialize new tool call tracking when we first receive a chunk for this index
    if (!tracked) {
      // If provider omitted id, or provided a non-globally-unique one (like 0 or edit-0),
      // make it unique for this turn. Standard OpenAI/Anthropic IDs (call_..., toolu_...)
      // are preserved as-is.
      const baseId = id || `generated-${index}`;
      const uniqueId =
        baseId.startsWith("call_") ||
        baseId.startsWith("toolu_") ||
        baseId.startsWith("unified_")
          ? baseId
          : `${this.currentTurnId}-${baseId}`;

      tracked = {
        id: uniqueId,
        name: name || "",
        hasStarted: false,
        deltaBuffer: [],
      };
      this.rawChunkTracker.set(index, tracked);
    }

    if (!tracked) {
      return events;
    }

    // Update name if present in chunk and not yet set
    if (name) {
      tracked.name = name;
    }

    // Emit start event when we have the name
    if (!tracked.hasStarted && tracked.name) {
      events.push({
        type: "tool_call_start",
        id: tracked.id,
        name: tracked.name,
      });
      tracked.hasStarted = true;

      // Flush buffered deltas
      for (const bufferedDelta of tracked.deltaBuffer) {
        events.push({
          type: "tool_call_delta",
          id: tracked.id,
          delta: bufferedDelta,
        });
      }
      tracked.deltaBuffer = [];
    }

    // Emit delta event for argument chunks
    if (args) {
      if (tracked.hasStarted) {
        events.push({
          type: "tool_call_delta",
          id: tracked.id,
          delta: args,
        });
      } else {
        tracked.deltaBuffer.push(args);
      }
    }

    return events;
  }

  /**
   * Process stream finish reason.
   * Emits end events when finish_reason is 'tool_calls'.
   */
  public static processFinishReason(
    finishReason: string | null | undefined,
  ): ToolCallStreamEvent[] {
    const events: ToolCallStreamEvent[] = [];

    if (finishReason === "tool_calls" && this.rawChunkTracker.size > 0) {
      for (const [, tracked] of this.rawChunkTracker.entries()) {
        events.push({
          type: "tool_call_end",
          id: tracked.id,
        });
      }
    }

    return events;
  }

  /**
   * Finalize any remaining tool calls that weren't explicitly ended.
   * Should be called at the end of stream processing.
   */
  public static finalizeRawChunks(): ToolCallStreamEvent[] {
    const events: ToolCallStreamEvent[] = [];

    if (this.rawChunkTracker.size > 0) {
      for (const [, tracked] of this.rawChunkTracker.entries()) {
        if (tracked.hasStarted) {
          events.push({
            type: "tool_call_end",
            id: tracked.id,
          });
        }
      }
      this.rawChunkTracker.clear();
    }

    return events;
  }

  /**
   * Clear all raw chunk tracking state.
   * Should be called when a new API request starts.
   */
  public static clearRawChunkState(): void {
    this.rawChunkTracker.clear();
    this.currentTurnId = Date.now().toString();
  }

  public static compactToolInputForHistory(
    toolName: string,
    input: Record<string, any>,
    options: { forModel?: boolean } = {},
  ): Record<string, any> {
    const forModel = options.forModel === true;
    const resolvedName = resolveToolAlias(toolName);
    const formatReadHistoryTarget = (rawFile: unknown): string | undefined => {
      const fileEntries = convertFileEntries([rawFile]).filter(
        (entry) => typeof entry.path === "string" && entry.path.length > 0,
      );
      const entry = fileEntries[0];
      if (!entry) {
        return undefined;
      }

      if (entry.head !== undefined) {
        return `${entry.path}:H${entry.head}`;
      }

      if (entry.tail !== undefined) {
        return `${entry.path}:T${entry.tail}`;
      }

      if (Array.isArray(entry.lineRanges) && entry.lineRanges.length > 0) {
        const range = entry.lineRanges[0];
        if (range?.start !== undefined && range?.end !== undefined) {
          return `${entry.path}:L${range.start}-${range.end}`;
        }
      }

      return entry.path;
    };
    const compactNestedArgs = (
      nestedName: string,
      nestedArgs: Record<string, any>,
    ) => this.compactToolInputForHistory(nestedName, nestedArgs, options);
    const toPublicToolsRouterAction = (
      call: Record<string, any>,
    ): Record<string, any> => {
      const nestedName = typeof call.name === "string" ? call.name : "";
      const rawArgs =
        call.arguments &&
        typeof call.arguments === "object" &&
        !Array.isArray(call.arguments)
          ? (call.arguments as Record<string, any>)
          : {};
      const nestedArgs = compactNestedArgs(nestedName, rawArgs);

      switch (resolveToolAlias(nestedName)) {
        case "read": {
          const rawFiles = Array.isArray(nestedArgs.files)
            ? nestedArgs.files
            : nestedArgs.path !== undefined
              ? [nestedArgs.path]
              : [];
          const paths = rawFiles
            .map((file) => formatReadHistoryTarget(file))
            .filter((value): value is string => typeof value === "string");

          return {
            read: paths.length <= 1 ? (paths[0] ?? "") : paths,
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        }
        case "grep":
          return {
            grep: nestedArgs.query ?? nestedArgs.pattern ?? nestedArgs.command,
            ...(nestedArgs.path !== undefined ? { path: nestedArgs.path } : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "glob":
          return {
            find: nestedArgs.pattern ?? nestedArgs.query,
            ...(nestedArgs.path !== undefined ? { path: nestedArgs.path } : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "list":
          return {
            ls: nestedArgs.path ?? ".",
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "web":
          return {
            web: nestedArgs.query,
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "fetch":
          return {
            fetch: nestedArgs.url ?? nestedArgs.query,
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "bash":
          return {
            bash: nestedArgs.command ?? nestedArgs.query,
            ...((nestedArgs.cwd ?? nestedArgs.path) !== undefined
              ? { path: nestedArgs.cwd ?? nestedArgs.path }
              : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "agent":
          return {
            agent: nestedArgs.prompt ?? nestedArgs.query,
            ...(nestedArgs.mode !== undefined ? { mode: nestedArgs.mode } : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "todo":
          return {
            todo: nestedArgs.todos ?? nestedArgs.query,
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "browser_action":
          return {
            browser_action: nestedArgs.action,
            ...(nestedArgs.action !== undefined
              ? { action: nestedArgs.action }
              : {}),
            ...(nestedArgs.coordinate !== undefined
              ? { coordinate: nestedArgs.coordinate }
              : {}),
            ...(nestedArgs.size !== undefined ? { size: nestedArgs.size } : {}),
            ...(nestedArgs.text !== undefined ? { text: nestedArgs.text } : {}),
            ...(nestedArgs.path !== undefined ? { path: nestedArgs.path } : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "computer_action":
          return {
            computer_action: nestedArgs.action,
            ...(nestedArgs.action !== undefined
              ? { action: nestedArgs.action }
              : {}),
            ...(nestedArgs.coordinate !== undefined
              ? { coordinate: nestedArgs.coordinate }
              : {}),
            ...(nestedArgs.text !== undefined ? { text: nestedArgs.text } : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "access_mcp_resource":
          return {
            access_mcp_resource: nestedArgs.uri,
            server_name: nestedArgs.server_name,
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        case "generate_image":
          return {
            generate_image: nestedArgs.prompt ?? nestedArgs.query,
            ...(nestedArgs.path !== undefined ? { path: nestedArgs.path } : {}),
            ...(nestedArgs.image !== undefined
              ? { image: nestedArgs.image }
              : {}),
            ...(nestedArgs.metadata !== undefined
              ? { metadata: nestedArgs.metadata }
              : {}),
          };
        default:
          return {
            name: nestedName,
            ...nestedArgs,
          };
      }
    };
    const toPublicContentRouterAction = (
      call: Record<string, any>,
    ): Record<string, any> => {
      const nestedName = typeof call.name === "string" ? call.name : "";
      const rawArgs =
        call.arguments &&
        typeof call.arguments === "object" &&
        !Array.isArray(call.arguments)
          ? (call.arguments as Record<string, any>)
          : {};
      const nestedArgs = compactNestedArgs(nestedName, rawArgs);

      if (resolveToolAlias(nestedName) === "write") {
        const action: Record<string, any> = {
          path: nestedArgs.path,
        };
        const content = nestedArgs.write ?? nestedArgs.content;
        if (content !== undefined) {
          action.write = content;
        }
        if (nestedArgs.metadata !== undefined) {
          action.metadata = nestedArgs.metadata;
        }
        return action;
      }

      if (resolveToolAlias(nestedName) === "edit") {
        const action: Record<string, any> = {
          path: nestedArgs.path ?? input.path,
        };
        if (nestedArgs.edit !== undefined) {
          action.edit = Array.isArray(nestedArgs.edit)
            ? nestedArgs.edit.map((block) => {
                if (!block || typeof block !== "object" || Array.isArray(block)) {
                  return block;
                }
                const record = block as Record<string, any>;
                return {
                  ...(this.getNativeEditLineRange(record) !== undefined
                    ? { lines: this.getNativeEditLineRange(record) }
                    : {}),
                  ...(this.getNativeEditOldText(record) !== undefined
                    ? { old: this.getNativeEditOldText(record) }
                    : {}),
                  ...(this.getNativeEditNewText(record) !== undefined
                    ? { new: this.getNativeEditNewText(record) }
                    : {}),
                  ...(record.type !== undefined ? { type: record.type } : {}),
                  ...(record.replaceAll !== undefined
                    ? { replaceAll: record.replaceAll }
                    : {}),
                };
              })
            : nestedArgs.edit;
        } else {
          if (this.getNativeEditLineRange(nestedArgs) !== undefined) {
            action.lines = this.getNativeEditLineRange(nestedArgs);
          }
          if (this.getNativeEditOldText(nestedArgs) !== undefined) {
            action.old = this.getNativeEditOldText(nestedArgs);
          }
          if (this.getNativeEditNewText(nestedArgs) !== undefined) {
            action.new = this.getNativeEditNewText(nestedArgs);
          }
        }
        if (nestedArgs.metadata !== undefined) {
          action.metadata = nestedArgs.metadata;
        }
        return action;
      }

      return {
        tool: nestedName,
        ...nestedArgs,
      };
    };
    const compactNestedCalls = (
      callKey: "calls" | "tools",
      nameKey: "name" | "tool",
      argsKey: "arguments" | "args",
    ): Record<string, any> => {
      const rawCalls = Array.isArray(input[callKey])
        ? input[callKey]
        : undefined;
      if (!rawCalls) {
        return input;
      }

      return {
        ...input,
        [callKey]: rawCalls.map((call) => {
          if (!call || typeof call !== "object") {
            return call;
          }
          const record = call as Record<string, any>;
          const nestedName =
            typeof record[nameKey] === "string" ? record[nameKey] : undefined;
          const nestedArgs =
            record[argsKey] && typeof record[argsKey] === "object"
              ? (record[argsKey] as Record<string, any>)
              : record.arguments && typeof record.arguments === "object"
                ? (record.arguments as Record<string, any>)
                : undefined;

          if (!nestedName || !nestedArgs) {
            return call;
          }

          return {
            ...record,
            [argsKey === "arguments" ? "arguments" : argsKey]:
              this.compactToolInputForHistory(nestedName, nestedArgs, options),
          };
        }),
      };
    };
    const toExecuteCommand = (call: Record<string, any>): string | undefined => {
      const nestedName = typeof call.name === "string" ? call.name : "";
      const rawArgs =
        call.arguments &&
        typeof call.arguments === "object" &&
        !Array.isArray(call.arguments)
          ? (call.arguments as Record<string, any>)
          : {};
      const nestedArgs = compactNestedArgs(nestedName, rawArgs);
      const resolvedNestedName = resolveToolAlias(nestedName);

      switch (resolvedNestedName) {
        case "read": {
          const rawFiles = Array.isArray(nestedArgs.files)
            ? nestedArgs.files
            : nestedArgs.path !== undefined
              ? [nestedArgs.path]
              : [];
          const paths = rawFiles
            .map((file) => formatReadHistoryTarget(file))
            .filter((value): value is string => typeof value === "string");
          return paths.length > 0 ? paths.map((path) => `read:${path}`).join("\n") : undefined;
        }
        case "grep":
          return nestedArgs.path !== undefined
            ? `grep:${nestedArgs.path}:${nestedArgs.query ?? nestedArgs.pattern ?? ""}`.trim()
            : `grep:${nestedArgs.query ?? nestedArgs.pattern ?? ""}`.trim();
        case "glob":
          return nestedArgs.path !== undefined
            ? `find:${nestedArgs.path}:${nestedArgs.pattern ?? nestedArgs.query ?? ""}`.trim()
            : `find:${nestedArgs.pattern ?? nestedArgs.query ?? ""}`.trim();
        case "list":
          return `list:${nestedArgs.path ?? "."}`.trim();
        case "bash":
          return nestedArgs.cwd !== undefined
            ? `bash:${nestedArgs.cwd}:${nestedArgs.command ?? nestedArgs.query ?? ""}`.trim()
            : `bash:${nestedArgs.command ?? nestedArgs.query ?? ""}`.trim();
        case "web":
          return `web:${nestedArgs.query ?? ""}`.trim();
        case "fetch":
          return `fetch:${nestedArgs.url ?? nestedArgs.query ?? ""}`.trim();
        case "ask":
          return nestedArgs.path !== undefined
            ? `ask:${nestedArgs.path}:${nestedArgs.query ?? ""}`.trim()
            : `ask:${nestedArgs.query ?? ""}`.trim();
        case "agent":
          return `agent:${nestedArgs.prompt ?? nestedArgs.query ?? ""}`.trim();
        case "todo":
          return `todo\n${nestedArgs.todos ?? nestedArgs.query ?? ""}`.trim();
        case "write":
          if (
            forModel &&
            typeof nestedArgs.content !== "string" &&
            typeof nestedArgs.write !== "string"
          ) {
            return undefined;
          }
          return nestedArgs.path
            ? `write:${nestedArgs.path}|${formatWriteHistoryPlaceholderBody(
                nestedArgs.content ?? nestedArgs.write,
              )}`
            : undefined;
        case "edit": {
          const editLines = Array.isArray(nestedArgs.edit)
            ? nestedArgs.edit
                .map((block) => {
                  if (!block || typeof block !== "object" || Array.isArray(block)) {
                    return undefined;
                  }
                  const record = block as Record<string, any>;
                  const lineRange = this.getNativeEditLineRange(record);
                  const oldText = this.getNativeEditOldText(record);
                  const newText = this.getNativeEditNewText(record);
                  if (
                    typeof lineRange !== "string" ||
                    typeof oldText !== "string" ||
                    typeof newText !== "string"
                  ) {
                    return undefined;
                  }
                  return `${lineRange}|${oldText}->${newText}`;
                })
                .filter((line): line is string => typeof line === "string")
            : [];
          const editBody =
            typeof nestedArgs.edit === "string"
              ? nestedArgs.edit
              : editLines.length > 0
                ? editLines.join("\n")
              : this.getNativeEditLineRange(nestedArgs) !== undefined ||
                  this.getNativeEditOldText(nestedArgs) !== undefined ||
                  this.getNativeEditNewText(nestedArgs) !== undefined
                ? this.getNativeEditLineRange(nestedArgs) !== undefined
                  ? `${this.getNativeEditLineRange(nestedArgs)}|${this.getNativeEditOldText(nestedArgs) ?? ""}->${this.getNativeEditNewText(nestedArgs) ?? ""}`
                  : [
                      "oldText:",
                      this.getNativeEditOldText(nestedArgs) ?? "",
                      "newText:",
                      this.getNativeEditNewText(nestedArgs) ?? "",
                    ].join("\n")
                : undefined;
          if (forModel && !editBody) {
            return undefined;
          }
          return [
            nestedArgs.path ? `edit:${nestedArgs.path}` : "edit",
            editBody,
          ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join("\n");
        }
        default:
          return undefined;
      }
    };

    if (resolvedName === "execute" || resolvedName === "tool") {
      const rawCalls = Array.isArray(input.calls) ? input.calls : undefined;
      const hasStructuredCalls =
        rawCalls?.some(
          (call) => !!call && typeof call === "object" && !Array.isArray(call),
        ) ?? false;
      if (rawCalls && hasStructuredCalls) {
        const compactedCommands = rawCalls
          .filter(
            (call): call is Record<string, any> =>
              !!call && typeof call === "object" && !Array.isArray(call),
          )
          .map((call) => toExecuteCommand(call))
          .filter((command): command is string => typeof command === "string");

        // If model-facing compaction would erase every grouped call, keep the
        // original structured payload so history/debug views stay honest.
        if (forModel && rawCalls.length > 0 && compactedCommands.length === 0) {
          return input;
        }

        return {
          [resolvedName === "tool" ? "calls" : "commands"]: compactedCommands,
        };
      }

      const rawCommands = Array.isArray(input.calls)
        ? input.calls
        : Array.isArray(input.tools)
        ? input.tools
        : Array.isArray(input.commands)
          ? input.commands
          : undefined;
      if (!rawCommands) {
        return input;
      }

      return {
        [resolvedName === "tool" ? "calls" : "commands"]: rawCommands
          .filter((command): command is string => typeof command === "string")
          .map((command) => {
            const parsedCommand = this.parseExecuteCommand(command);
            if ("error" in parsedCommand) {
              return forModel ? undefined : command;
            }

            return toExecuteCommand(parsedCommand.call) ?? command;
          })
          .filter((command): command is string => typeof command === "string"),
      };
    }

    if (resolvedName === "batch") {
      return compactNestedCalls("calls", "name", "arguments");
    }

    if (
      this.GROUPED_BATCH_TOOL_NAMES.has(resolvedName as GroupedBatchToolName)
    ) {
      if (Array.isArray(input.calls)) {
        if (resolvedName === "tools") {
          return {
            tools: input.calls
              .filter(
                (call): call is Record<string, any> =>
                  !!call && typeof call === "object" && !Array.isArray(call),
              )
              .map((call) => toPublicToolsRouterAction(call)),
          };
        }
        if (resolvedName === "content") {
          return {
            content: input.calls
              .filter(
                (call): call is Record<string, any> =>
                  !!call && typeof call === "object" && !Array.isArray(call),
              )
              .map((call) => toPublicContentRouterAction(call)),
          };
        }
        return compactNestedCalls("calls", "name", "arguments");
      }
      return compactNestedCalls("tools", "tool", "args");
    }

    if (resolvedName === "write") {
      const compacted = { ...input };
      if (forModel) {
        if (typeof compacted.write === "string") {
          delete compacted.write;
        }
        if (typeof compacted.content === "string") {
          delete compacted.content;
        }
        return compacted;
      }

      return {
        ...compacted,
        write:
          typeof compacted.write === "string"
            ? formatWriteHistoryPlaceholderBody(compacted.write)
            : compacted.write,
        content:
          typeof compacted.content === "string"
            ? formatWriteHistoryPlaceholderBody(compacted.content)
            : compacted.content,
      };
    }

    if (resolvedName !== "edit" && resolvedName !== "edit_file") {
      return input;
    }

    const compacted = { ...input };
    const rawEdit = compacted.edit ?? compacted.edits;
    if (typeof rawEdit === "string") {
      if (forModel) {
        if ("edit" in compacted) {
          delete compacted.edit;
        }
        if ("edits" in compacted) {
          delete compacted.edits;
        }
      } else {
        const redacted = redactEditHistoryBody(rawEdit);
        if ("edit" in compacted) {
          compacted.edit = redacted;
        }
        if ("edits" in compacted) {
          compacted.edits = redacted;
        }
      }
      return compacted;
    }

    const rawBlocks = Array.isArray(rawEdit)
      ? rawEdit
      : rawEdit && typeof rawEdit === "object"
        ? [rawEdit]
        : undefined;

    const compactBlock = (block: Record<string, any>) => {
      const nextBlock = { ...block };
      let didReplaceText = false;
      for (const key of [
        "old",
        "new",
        "otxt",
        "ntxt",
        "oldText",
        "newText",
        "old_text",
        "new_text",
        "old_string",
        "new_string",
        "search",
        "replace",
      ]) {
        if (typeof nextBlock[key] === "string") {
          if (forModel) {
            delete nextBlock[key];
          } else {
            nextBlock[key] = formatEditHistoryPreview(nextBlock[key]);
          }
          didReplaceText = true;
        }
      }
      if (!didReplaceText && !forModel) {
        nextBlock.old = formatEditHistoryPreview(nextBlock.old);
        nextBlock.new = formatEditHistoryPreview(nextBlock.new);
        nextBlock.oldText = formatEditHistoryPreview(nextBlock.oldText);
        nextBlock.newText = formatEditHistoryPreview(nextBlock.newText);
      }
      return nextBlock;
    };

    if (!rawBlocks) {
      const hasTopLevelEditText = [
        "old",
        "new",
        "otxt",
        "ntxt",
        "oldText",
        "newText",
        "old_text",
        "new_text",
        "old_string",
        "new_string",
        "search",
        "replace",
      ].some((key) => typeof compacted[key] === "string");
      return hasTopLevelEditText ? compactBlock(compacted) : compacted;
    }

    const compactedBlocks = rawBlocks.map((block) => {
      if (typeof block === "string") {
        return forModel ? undefined : HISTORY_CONTENT_PLACEMENT_PLACEHOLDER;
      }

      return block && typeof block === "object"
        ? compactBlock(block as Record<string, any>)
        : block;
    }).filter((block) => block !== undefined);
    if ("edit" in compacted) {
      if (compactedBlocks.length === 0 && forModel) {
        delete compacted.edit;
      } else {
        compacted.edit = Array.isArray(rawEdit)
          ? compactedBlocks
          : compactedBlocks[0];
      }
    }
    if ("edits" in compacted) {
      if (compactedBlocks.length === 0 && forModel) {
        delete compacted.edits;
      } else {
        compacted.edits = Array.isArray(rawEdit)
          ? compactedBlocks
          : compactedBlocks[0];
      }
    }
    return compacted;
  }

  /**
   * Start streaming a new tool call.
   * Initializes tracking for incremental argument parsing.
   * Accepts string to support both ToolName and dynamic MCP tools (mcp_serverName_toolName).
   */
  public static startStreamingToolCall(id: string, name: string): void {
    // CRITICAL: Resolve tool alias IMMEDIATELY before storing
    // This prevents 'read' from being treated as invalid and causing catastrophic misparsing
    const resolvedName = resolveToolAlias(name);

    this.streamingToolCalls.set(id, {
      id,
      name: resolvedName,
      argumentsAccumulator: "",
    });
  }

  /**
   * Clear all streaming tool call state.
   * Should be called when a new API request starts to prevent memory leaks
   * from interrupted streams.
   */
  public static clearAllStreamingToolCalls(): void {
    this.streamingToolCalls.clear();
  }

  /**
   * Check if there are any active streaming tool calls.
   * Useful for debugging and testing.
   */
  public static hasActiveStreamingToolCalls(): boolean {
    return this.streamingToolCalls.size > 0;
  }

  /**
   * Process a chunk of JSON arguments for a streaming tool call.
   * Uses partial-json-parser to extract values from incomplete JSON immediately.
   * Returns a partial ToolUse with currently parsed parameters.
   */
  public static processStreamingChunk(
    id: string,
    chunk: string,
  ): ToolUse | null {
    const toolCall = this.streamingToolCalls.get(id);
    if (!toolCall) {
      console.warn(
        `[NativeToolCallParser] Received chunk for unknown tool call: ${id}`,
      );
      return null;
    }

    // Accumulate the JSON string
    toolCall.argumentsAccumulator += chunk;

    // For dynamic MCP tools, we don't return partial updates - wait for final
    const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR;
    if (toolCall.name.startsWith(mcpPrefix)) {
      return null;
    }

    // kade_change: AGGRESSIVE attempt_completion streaming - bypass JSON parsing entirely
    // This treats the result field as raw text stream for immediate character-by-character updates
    if (toolCall.name.includes("attempt_completion")) {
      console.log(
        `[NativeToolCallParser] Processing attempt_completion chunk: "${chunk}"`,
      );
      console.log(
        `[NativeToolCallParser] Current accumulator: "${toolCall.argumentsAccumulator}"`,
      );
      const result = this.extractAttemptCompletionResult(toolCall);
      if (result && result.nativeArgs && "result" in result.nativeArgs) {
        const attemptCompletionArgs = result.nativeArgs as { result: string };
        console.log(
          `[NativeToolCallParser] Extracted result: "${attemptCompletionArgs.result}"`,
        );
      } else {
        console.log(`[NativeToolCallParser] No result extracted from chunk`);
      }
      return result;
    }

    // Parse whatever we can from the incomplete JSON!
    try {
      let partialArgs = parseJSON(toolCall.argumentsAccumulator);
      return this.createFromPartialArgs(toolCall, partialArgs);
    } catch {
      // FALLBACK: Hybrid Protocol Recovery (The "Annoying Ass Issue" Fix)

      // 1. XML Recovery Path
      if (
        toolCall.argumentsAccumulator.trim().startsWith("<") ||
        toolCall.argumentsAccumulator.includes("<tool_call>")
      ) {
        const partialArgs = this.extractArgumentsFromTags(
          toolCall.argumentsAccumulator,
        );
        if (Object.keys(partialArgs).length > 0) {
          return this.createFromPartialArgs(toolCall, partialArgs);
        }
      }

      // 2. Unified Protocol Recovery Path
      // If JSON parsing fails but the accumulator looks like a Unified Protocol call
      // (e.g. "edit;index.html\nOld:..."), we manually extract the bits.
      // Strip thinking blocks and handle potential backticks
      const recoveryText = toolCall.argumentsAccumulator
        .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
        .trim();
      // Simplified robust regex: find the first occurrence of a known tool name followed by a separator
      const toolNames =
        "edit|read|write|bash|list|grep|glob|ask|todo|web|agent|fetch|browser_action|computer_action|access_mcp_resource|generate_image";
      // Changed to use [\s\S]*? to consume noise AND then capture the tool name.
      // We use a non-capturing group for the noise to keep group indexing stable.
      const unifiedMatch = recoveryText.match(
        new RegExp(
          `(?:^|[\\s\\S]*?)(?:tool\\s+)?(${toolNames})\\b[; (]?\\s*([^\\s\\n\\r)]*)`,
          "i",
        ),
      );

      if (unifiedMatch) {
        const shortName = unifiedMatch[1].toLowerCase();
        const argsPart = (unifiedMatch[2] ?? "").trim();

        // console.log(`[UnifiedRecovery] matched shortName: ${shortName}, argsPart: ${argsPart}`)

        // Re-use logic for mapping and populating
        const resolvedName = resolveToolAlias(shortName) as ToolName;
        // We create a dummy ToolUse to populate via the mapping logic if needed,
        // but for streaming update we just need the basic params.
        const params: any = {};
        if (resolvedName === "edit") {
          const parts = argsPart.split(" ").filter(Boolean);
          params.path = parts[0];
        } else if (resolvedName === "read" || resolvedName === "write") {
          params.path = argsPart;
        }

        // For 'edit', we also check for the diffuse content in the rest of the accumulator
        // Optimization: Cache edits for performance to avoid O(N^2) scans
        let editsMatch = (toolCall as any).lastEditsMatch;
        if (
          !editsMatch ||
          toolCall.argumentsAccumulator.length >
            ((toolCall as any).lastAccumulatorLength || 0) + 100
        ) {
          // Improved SEARCH/REPLACE regex to handle cases where there might not be a newline exactly after Old/New if it's super partial
          editsMatch = recoveryText.match(
            /(?:Old|SEARCH)[\s\t]*:?[\s\t]*\r?\n?([\s\S]*?)\r?\n(?:New|REPLACE)[\s\t]*:?[\s\t]*\r?\n?([\s\S]*?)(?=\r?\n(?:Old|SEARCH)|\r?\n\(done\)|$)/gi,
          );
          (toolCall as any).lastEditsMatch = editsMatch;
          (toolCall as any).lastAccumulatorLength =
            toolCall.argumentsAccumulator.length;
        }

        const nativeArgs: any = { ...params };

        // Handle 'write' content extraction
        if (resolvedName === "write") {
          const contentStart = recoveryText.indexOf(argsPart) + argsPart.length;
          if (contentStart > 0) {
            let content = recoveryText.slice(contentStart).trim();
            if (content.startsWith(")")) content = content.slice(1).trim();
            // Strip leading/trailing code blocks if present
            const mdMatch = content.match(/```(?:\w+)?\r?\n([\s\S]*?)```/);
            if (mdMatch) content = mdMatch[1].trim();
            nativeArgs.content = content;
          }
        }

        if (editsMatch) {
          const normalizedEditBlocks = editsMatch
            .map((m: string) => {
              const innerMatched = m.match(
                /(?:Old|SEARCH)[\s\t]*:?[\s\t]*\r?\n?([\s\S]*?)\r?\n(?:New|REPLACE)[\s\t]*:?[\s\t]*\r?\n?([\s\S]*)/i,
              );
              if (!innerMatched) return null;

              const clean = (t: string) => {
                let text = t.trim();
                const mdMatch = text.match(/```(?:\w+)?\r?\n([\s\S]*?)```/);
                if (mdMatch) return mdMatch[1].trim();
                if (text.startsWith("```")) {
                  const nl = text.indexOf("\n");
                  text = nl !== -1 ? text.slice(nl + 1) : text.slice(3);
                  if (text.endsWith("```")) text = text.slice(0, -3);
                  text = text.trim();
                }
                const transition = text.match(
                  /\r?\n\r?\n([A-Z][a-zA-Z',! ]{3,}\b[\s\S]*)$/,
                );
                if (
                  transition &&
                  !/[{};<>\[\]=]/.test(transition[1].slice(0, 30))
                ) {
                  text = text.slice(0, transition.index);
                }
                return text.trim();
              };

              return {
                oldText: clean(innerMatched[1]),
                newText: clean(innerMatched[2]),
              };
            })
            .filter(Boolean);

          if (normalizedEditBlocks.length > 0) {
            nativeArgs.edit = normalizedEditBlocks;
          }
        }

        // If we have any extracted info, return it
        if (
          params.path ||
          (nativeArgs.edit && nativeArgs.edit.length > 0) ||
          nativeArgs.content
        ) {
          return {
            type: "tool_use",
            id: toolCall.id,
            name: resolvedName,
            params: params,
            nativeArgs: nativeArgs,
            partial: true,
          };
        }
      }
      return null;
    }
  }

  private static createFromPartialArgs(
    toolCall: any,
    partialArgs: any,
  ): ToolUse | null {
    // Resolve tool alias to canonical name
    const resolvedName = (
      this.isExecutePayload(partialArgs)
        ? (toolCall.name === "execute" ? "execute" : "tool")
        : resolveToolAlias(toolCall.name)
    ) as ToolName;
    // Preserve original name if it differs from resolved or if a grouped batching tool maps to batch execution
    const originalName =
      toolCall.name !== resolvedName ||
      this.isGroupedBatchToolName(resolvedName as string)
        ? this.isExecutePayload(partialArgs)
          ? toolCall.name
          : toolCall.name
        : undefined;

    // Create partial ToolUse with extracted values
    return this.createPartialToolUse(
      toolCall.id,
      resolvedName,
      partialArgs || {},
      true, // partial
      originalName,
    );
  }

  /**
   * Aggressive regex extraction for attempt_completion result streaming.
   * Bypasses JSON parsing entirely to treat the result field as raw text stream.
   * This enables immediate character-by-character streaming without JSON buffering delays.
   */
  private static extractAttemptCompletionResult(toolCall: {
    id: string;
    name: string;
    argumentsAccumulator: string;
  }): ToolUse | null {
    console.log(
      `[extractAttemptCompletionResult] Starting extraction for accumulator: "${toolCall.argumentsAccumulator}"`,
    );

    // Multiple regex patterns to handle different JSON formatting scenarios
    const patterns = [
      // Most aggressive: captures everything after "result": " to the end
      /"result"\s*:\s*"(.*)/s,
      // Standard: {"result": "content"} - handles escaped quotes properly
      /"result"\s*:\s*"([^"]*(?:\\.[^"]*)*)/s,
      // Handle single quotes
      /'result'\s*:\s*'(.*)/s,
    ];

    let extractedContent = "";

    for (const pattern of patterns) {
      const match = toolCall.argumentsAccumulator.match(pattern);
      if (match) {
        console.log(
          `[extractAttemptCompletionResult] Pattern matched: ${pattern.toString()}, extracted: "${match[1]}"`,
        );
        extractedContent = match[1];
        break;
      }
    }

    if (!extractedContent) {
      console.log(
        `[extractAttemptCompletionResult] No content extracted, returning null`,
      );
      return null; // No result content found yet
    }

    // Aggressive unescaping to get raw text immediately
    const originalContent = extractedContent; // Keep original for checking
    let content = extractedContent
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      .replace(/\\\\/g, "\\");

    // Remove any trailing JSON artifacts that might indicate end of string
    // Be careful not to remove legitimate escaped quotes
    // Check if content ends with escaped quote pattern (like \"\"} which is \" followed by "})
    const endsWithEscapedQuotePattern =
      originalContent.endsWith('\\"') ||
      /\\"\s*"\s*}\s*$/.test(originalContent);

    if (!endsWithEscapedQuotePattern) {
      // Only remove trailing quotes if the content doesn't end with an escaped quote pattern
      content = content
        .replace(/"\s*}\s*$/s, "") // Remove trailing " }
        .replace(/'}\s*$/s, "") // Remove trailing '}
        .replace(/"}\s*$/s, "") // Remove trailing "}
        .replace(/"\s*$/s, "") // Remove trailing "
        .replace(/'\s*$/s, ""); // Remove trailing '
    } else {
      // Content ends with escaped quote pattern, remove only the non-escaped parts
      content = content
        .replace(/}\s*$/s, "") // Remove trailing }
        .replace(/"\s*$/s, "") // Remove trailing non-escaped "
        .replace(/'\s*$/s, ""); // Remove trailing ' (if any)
    }

    // Ensure we don't return a trailing backslash if it looks like the start of an escape sequence
    if (originalContent.endsWith("\\") && !originalContent.endsWith("\\\\")) {
      content = content.slice(0, -1);
    }

    // Create partial ToolUse with immediately extracted content
    const result = this.createPartialToolUse(
      toolCall.id,
      "attempt_completion",
      { result: content },
      true, // partial
      undefined,
    );
    console.log(
      `[extractAttemptCompletionResult] Returning ToolUse with result: "${content}"`,
    );
    return result;
  }

  /**
   * Finalize a streaming tool call.
   * Parses the complete JSON and returns the final ToolUse or McpToolUse.
   */
  public static finalizeStreamingToolCall(
    id: string,
  ): ToolUse | McpToolUse | null {
    const toolCall = this.streamingToolCalls.get(id);
    if (!toolCall) {
      console.warn(
        `[NativeToolCallParser] Attempting to finalize unknown tool call: ${id}`,
      );
      return null;
    }

    // Parse the complete accumulated JSON
    // Cast to any for the name since parseToolCall handles both ToolName and dynamic MCP tools
    const finalToolUse = this.parseToolCall({
      id: toolCall.id,
      name: toolCall.name as ToolName,
      arguments: toolCall.argumentsAccumulator,
    });

    // Clean up streaming state
    this.streamingToolCalls.delete(id);

    return finalToolUse;
  }

  /**
   * Convert raw file entries from API (with line_ranges) to FileEntry objects
   * (with lineRanges). Handles multiple formats for compatibility:
   *
   * New tuple format: { path: string, line_ranges: [[1, 50], [100, 150]] }
   * Object format: { path: string, line_ranges: [{ start: 1, end: 50 }] }
   * Legacy string format: { path: string, line_ranges: ["1-50"] }
   *
   * Returns: { path: string, lineRanges: [{ start: 1, end: 50 }] }
   */
  private static convertFileEntries(files: any[]): FileEntry[] {
    return convertFileEntries(files);
  }

  /**
   * Extracts arguments from XML-style tags (Recovery path).
   */
  private static extractArgumentsFromTags(text: string): Record<string, any> {
    const args: Record<string, any> = {};
    const parameterRegex =
      /<parameter(?:=([^\s>]+)|\s+name=(['"])(.*?)\2)[^>]*>([\s\S]*?)<\/parameter>/gi;
    let match: RegExpExecArray | null;

    while ((match = parameterRegex.exec(text)) !== null) {
      const rawName = (match[1] ?? match[3] ?? "").trim();
      if (!rawName) {
        continue;
      }

      const value = match[4].trim();
      const existing = args[rawName];
      if (existing === undefined) {
        args[rawName] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        args[rawName] = [existing, value];
      }
    }

    const rawParams = extractParamsFromXml(text);
    for (const [key, value] of Object.entries(rawParams)) {
      if (args[key] === undefined) {
        args[key] = value;
      }
    }

    // Recovery for files: if we found a <path> but no files array yet
    if (args.path && !args.files) {
      args.files = [{ path: args.path }];
    }

    return args;
  }

  private static hasAnyNativeEditTextFields(
    args: Record<string, any>,
  ): boolean {
    return (
      this.getNativeEditOldText(args) !== undefined ||
      this.getNativeEditNewText(args) !== undefined
    );
  }

  private static hasCompleteNativeEditTextFields(
    args: Record<string, any>,
  ): boolean {
    const hasOldText = this.getNativeEditOldText(args) !== undefined;
    const hasNewText = this.getNativeEditNewText(args) !== undefined;

    return hasOldText && hasNewText;
  }

  private static isNativeDeleteEditBlock(args: Record<string, any>): boolean {
    return (
      typeof args.type === "string" &&
      /^(?:rm|remove|delete|line_deletion)$/i.test(args.type)
    );
  }

  private static normalizeNativeLineRangeValue(
    value: unknown,
  ): string | undefined {
    if (typeof value === "string") {
      return value;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const start = (value as Record<string, any>).start;
    const end = (value as Record<string, any>).end ?? start;
    if (
      typeof start === "number" &&
      Number.isFinite(start) &&
      typeof end === "number" &&
      Number.isFinite(end)
    ) {
      return `${start}-${end}`;
    }

    return undefined;
  }

  private static normalizeNativeEditBlock(
    rawEdit: unknown,
    allowPartialBlocks: boolean,
  ): NativeEditBlock | undefined {
    if (!rawEdit || typeof rawEdit !== "object" || Array.isArray(rawEdit)) {
      return undefined;
    }

    const edit = rawEdit as Record<string, any>;
    const hasTextFields = allowPartialBlocks
      ? this.hasAnyNativeEditTextFields(edit)
      : this.hasCompleteNativeEditTextFields(edit);
    const isDeleteBlock = this.isNativeDeleteEditBlock(edit);

    if (!hasTextFields && !isDeleteBlock) {
      return undefined;
    }

    return {
      lineRange:
        this.normalizeNativeLineRangeValue(this.getNativeEditLineRange(edit)) ??
        (edit.start_line !== undefined
          ? `${edit.start_line}-${edit.end_line ?? edit.start_line}`
          : undefined),
      oldText: this.getNativeEditOldText(edit),
      newText: this.getNativeEditNewText(edit),
      start_line: edit.start_line,
      end_line: edit.end_line,
      range: edit.range,
      type: edit.type,
      replaceAll: edit.replaceAll ?? edit.replace_all,
    };
  }

  private static parseBottomLineRangeEditBlock(
    block: string,
  ): NativeEditBlock | undefined {
    const normalizedBlock = block.replace(/\r\n/g, "\n").trim();
    if (!normalizedBlock) {
      return undefined;
    }

    const match = normalizedBlock.match(
      /^oldText:\s*\n([\s\S]*?)\nnewText:\s*\n([\s\S]*?)\nlineRange:\s*\n(\d+-\d+)\s*$/i,
    );
    if (!match) {
      return undefined;
    }

    return {
      oldText: match[1],
      newText: match[2],
      lineRange: match[3],
    };
  }

  private static normalizeNativeEditArgs(
    args: Record<string, any> | undefined,
    allowPartialBlocks = false,
  ): NativeToolArgs["edit"] | undefined {
    if (!args || typeof args !== "object") {
      return undefined;
    }

    const editFilePath = args.file_path || args.path;
    if (!editFilePath) {
      return undefined;
    }

    let rawEdits = args.edits ?? args.edit;
    let editsArray: Array<NativeEditBlock | string> | undefined;

    if (rawEdits !== undefined) {
      if (typeof rawEdits === "string") {
        try {
          const parsed = JSON.parse(rawEdits);
          if (Array.isArray(parsed)) {
            editsArray = parsed;
          } else if (parsed && typeof parsed === "object") {
            editsArray = [parsed];
          }
        } catch {
          const parsedBlocks = parseStructuredEditBlocks(rawEdits);
          if (parsedBlocks.length > 0) {
            editsArray = parsedBlocks as NativeEditBlock[];
          } else {
            const bottomRangeBlock =
              this.parseBottomLineRangeEditBlock(rawEdits);
            if (bottomRangeBlock) {
              editsArray = [bottomRangeBlock];
            }
          }
        }
      } else if (Array.isArray(rawEdits)) {
        editsArray = rawEdits.flatMap((rawEdit) => {
          if (typeof rawEdit === "string") {
            const parsedBlocks = parseStructuredEditBlocks(rawEdit);
            if (parsedBlocks.length > 0) {
              return parsedBlocks;
            }

            const bottomRangeBlock =
              this.parseBottomLineRangeEditBlock(rawEdit);
            return bottomRangeBlock ? [bottomRangeBlock] : [];
          }

          return [rawEdit];
        });
      } else if (typeof rawEdits === "object" && rawEdits !== null) {
        editsArray = [rawEdits];
      }
    }
    // Compatibility path for models that emit a single edit block at top level
    // instead of wrapping it in edit: [{ ... }].
    if (!editsArray) {
      const hasTopLevelEditFields = allowPartialBlocks
        ? this.hasAnyNativeEditTextFields(args)
        : this.hasCompleteNativeEditTextFields(args);
      const isDeleteBlock = this.isNativeDeleteEditBlock(args);

      if (hasTopLevelEditFields || isDeleteBlock) {
        editsArray = [args as NativeEditBlock];
      }
    }

    if (!editsArray) {
      return undefined;
    }

    const normalizedEdits = editsArray
      .map((edit) => this.normalizeNativeEditBlock(edit, allowPartialBlocks))
      .filter((edit): edit is NativeEditBlock => edit !== undefined);

    if (normalizedEdits.length === 0) {
      return undefined;
    }

    return {
      path: editFilePath,
      edit: normalizedEdits,
    };
  }

  private static normalizeArgsForTool<TName extends ToolName>(
    args: Record<string, any> | undefined,
    resolvedName: TName,
  ): Record<string, any> {
    if (!args || typeof args !== "object") {
      return {};
    }

    const normalizedArgs = { ...args };

    if (
      resolvedName === "grep" &&
      normalizedArgs.query === undefined &&
      normalizedArgs.pattern === undefined &&
      normalizedArgs.regex === undefined &&
      normalizedArgs.command !== undefined
    ) {
      normalizedArgs.query = normalizedArgs.command;
      delete normalizedArgs.command;
    }

    if (
      resolvedName === "bash" &&
      normalizedArgs.command === undefined &&
      normalizedArgs.query !== undefined
    ) {
      normalizedArgs.command = normalizedArgs.query;
    }

    if (
      resolvedName === "fetch" &&
      normalizedArgs.url === undefined &&
      normalizedArgs.query !== undefined
    ) {
      normalizedArgs.url = normalizedArgs.query;
    }

    if (
      resolvedName === "write" &&
      normalizedArgs.content === undefined &&
      normalizedArgs.write !== undefined
    ) {
      normalizedArgs.content = normalizedArgs.write;
    }

    if (
      resolvedName === "read" &&
      normalizedArgs.path === undefined &&
      normalizedArgs.files === undefined &&
      normalizedArgs.file !== undefined
    ) {
      normalizedArgs.path = normalizedArgs.file;
      delete normalizedArgs.file;
    }

    if (resolvedName === "edit") {
      if (normalizedArgs.lineRange === undefined && normalizedArgs.lines !== undefined) {
        normalizedArgs.lineRange = normalizedArgs.lines;
      }
      if (normalizedArgs.oldText === undefined && normalizedArgs.old !== undefined) {
        normalizedArgs.oldText = normalizedArgs.old;
      }
      if (normalizedArgs.newText === undefined && normalizedArgs.new !== undefined) {
        normalizedArgs.newText = normalizedArgs.new;
      }
    }

    return normalizedArgs;
  }

  private static isGroupedBatchToolName(
    name: string,
  ): name is GroupedBatchToolName {
    return this.GROUPED_BATCH_TOOL_NAMES.has(name as GroupedBatchToolName);
  }

  private static toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }

    return value === undefined || value === null ? [] : [value];
  }

  private static normalizeGroupedActions(
    value: unknown,
  ): Record<string, any>[] {
    const unwrap = (input: unknown): unknown => {
      if (typeof input !== "string") {
        return input;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        return undefined;
      }

      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
        return input;
      }

      try {
        return JSON.parse(trimmed);
      } catch {
        return input;
      }
    };

    const normalized = unwrap(value);
    if (Array.isArray(normalized)) {
      return normalized.filter(
        (action): action is Record<string, any> =>
          !!action && typeof action === "object" && !Array.isArray(action),
      );
    }

    if (
      normalized &&
      typeof normalized === "object" &&
      !Array.isArray(normalized)
    ) {
      return [normalized as Record<string, any>];
    }

    return [];
  }

  private static inferGroupedActionTool(
    action: Record<string, any>,
    candidates: string[],
    resolveCandidate?: (value: string) => string | undefined,
  ):
    | { toolName: string; primaryValue: unknown; rest: Record<string, any> }
    | undefined {
    const normalizedAction = this.mergeGroupedActionPayload(action);
    const allowedCandidates = new Set(candidates);
    for (const explicitKey of ["tool", "name", "operation", "call", "op", "kind", "type"]) {
      const explicitToolName =
        typeof normalizedAction[explicitKey] === "string"
          ? String(normalizedAction[explicitKey]).trim()
          : "";
      if (!explicitToolName) {
        continue;
      }

      const resolvedToolName = resolveCandidate?.(explicitToolName) ?? explicitToolName;
      const { [explicitKey]: _ignoredToolName, ...rest } = normalizedAction;
      return {
        toolName: allowedCandidates.has(resolvedToolName) ? resolvedToolName : explicitToolName,
        primaryValue: undefined,
        rest,
      };
    }

    const matchedEntries = Object.entries(normalizedAction).filter(([key]) => {
      if (["tool", "name", "operation", "call", "op", "kind", "type"].includes(key)) {
        return false;
      }
      const resolvedKey = resolveCandidate?.(key) ?? key;
      return allowedCandidates.has(resolvedKey);
    });
    if (matchedEntries.length !== 1) {
      return undefined;
    }

    const [matchedKey, primaryValue] = matchedEntries[0];
    const toolName = resolveCandidate?.(matchedKey) ?? matchedKey;
    const { [matchedKey]: _ignoredPrimaryValue, ...rest } = normalizedAction;
    return {
      toolName,
      primaryValue,
      rest,
    };
  }

  private static mergeGroupedActionPayload(
    action: Record<string, any>,
  ): Record<string, any> {
    let merged = { ...action };

    for (const nestedKey of ["arguments", "args", "params", "input", "payload"]) {
      const nestedValue = merged[nestedKey];
      if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) {
        continue;
      }

      const { [nestedKey]: _ignoredNestedValue, ...rest } = merged;
      merged = {
        ...(nestedValue as Record<string, any>),
        ...rest,
      };
    }

    return merged;
  }

  private static unwrapCompactGroupedPrimaryValue(
    primaryValue: unknown,
    rest: Record<string, any>,
  ): { primaryValue: unknown; rest: Record<string, any> } {
    if (!primaryValue || typeof primaryValue !== "object" || Array.isArray(primaryValue)) {
      return { primaryValue, rest };
    }

    return {
      primaryValue: (primaryValue as Record<string, any>).query ?? (primaryValue as Record<string, any>).value,
      rest: {
        ...primaryValue,
        ...rest,
      },
    };
  }

  private static buildToolsRouterCall(
    action: Record<string, any>,
  ): { name: string; arguments: Record<string, any> } | undefined {
    const normalizedAction = this.mergeGroupedActionPayload(action);
    const inferred = this.inferGroupedActionTool(normalizedAction, [
      "read",
      "grep",
      "find",
      "ls",
      "web",
      "fetch",
      "ask",
      "agent",
      "todo",
      "browser_action",
      "computer_action",
      "access_mcp_resource",
      "generate_image",
      "command",
    ], resolveToolsRouterOperation);
    if (!inferred) {
      return undefined;
    }
    let { toolName, primaryValue, rest } = inferred;

    if (
      [
        "grep",
        "find",
        "ls",
        "bash",
        "web",
        "fetch",
        "ask",
        "agent",
        "todo",
        "browser_action",
        "access_mcp_resource",
        "generate_image",
        "command",
      ].includes(toolName)
    ) {
      const normalized = this.unwrapCompactGroupedPrimaryValue(primaryValue, rest);
      primaryValue = normalized.primaryValue;
      rest = normalized.rest;
    }

    switch (toolName) {
      case "read": {
        const rawPaths =
          primaryValue ??
          rest.path ??
          rest.paths ??
          rest.files ??
          rest.file ??
          rest.file_path ??
          rest.filepath ??
          rest.target ??
          rest.targets ??
          rest.query ??
          rest.value;
        const files = this.toArray(rawPaths).filter(
          (value): value is string => typeof value === "string",
        );
        return {
          name: "read",
          arguments: {
            ...(files.length > 0 ? { files } : {}),
            ...(rest.metadata !== undefined ? { metadata: rest.metadata } : {}),
          },
        };
      }
      case "grep":
        return {
          name: "grep",
          arguments: {
            path: rest.path ?? rest.dir ?? rest.directory,
            query:
              primaryValue ??
              rest.query ??
              rest.pattern ??
              rest.command ??
              rest.cmd ??
              rest.text ??
              rest.value,
            include: rest.include,
            include_all: rest.include_all,
            exclude: rest.exclude,
            metadata: rest.metadata,
          },
        };
      case "find":
        return {
          name: "glob",
          arguments: {
            path: rest.path ?? rest.dir ?? rest.directory,
            pattern:
              primaryValue ??
              rest.query ??
              rest.pattern ??
              rest.value ??
              rest.file ??
              rest.file_path,
            metadata: rest.metadata,
          },
        };
      case "ls":
        return {
          name: "list",
          arguments: {
            path:
              primaryValue ??
              rest.path ??
              rest.dir ??
              rest.directory ??
              rest.cwd ??
              rest.query ??
              rest.value,
            recursive: rest.recursive,
            metadata: rest.metadata,
          },
        };
      case "web":
        return {
          name: "web",
          arguments: {
            query:
              primaryValue ??
              rest.query ??
              rest.prompt ??
              rest.question ??
              rest.text ??
              rest.value,
            allowed_domains: rest.allowed_domains,
            blocked_domains: rest.blocked_domains,
            metadata: rest.metadata,
          },
        };
      case "fetch":
        return {
          name: "fetch",
          arguments: {
            url:
              primaryValue ??
              rest.url ??
              rest.uri ??
              rest.query ??
              rest.value,
            include_links: rest.include_links,
            metadata: rest.metadata,
          },
        };
      case "ask":
        return {
          name: "ask",
          arguments: {
            query:
              primaryValue ??
              rest.query ??
              rest.prompt ??
              rest.question ??
              rest.text ??
              rest.value,
            path: rest.path ?? rest.dir ?? rest.directory,
            metadata: rest.metadata,
          },
        };
      case "command":
      case "bash":
        return {
          name: "bash",
          arguments: {
            command:
              primaryValue ??
              rest.command ??
              rest.cmd ??
              rest.query ??
              rest.prompt ??
              rest.value,
            cwd: rest.cwd ?? rest.path ?? rest.dir ?? rest.directory,
            stdin: rest.stdin,
            execution_id: rest.execution_id,
            metadata: rest.metadata,
          },
        };
      case "agent":
        return {
          name: "agent",
          arguments: {
            prompt:
              primaryValue ??
              rest.prompt ??
              rest.query ??
              rest.question ??
              rest.task ??
              rest.value,
            mode: rest.mode,
            api_provider: rest.api_provider,
            model_id: rest.model_id,
            metadata: rest.metadata,
          },
        };
      case "todo":
        return {
          name: "todo",
          arguments: {
            todos:
              primaryValue ??
              rest.todos ??
              rest.query ??
              rest.task ??
              rest.text ??
              rest.value,
            metadata: rest.metadata,
          },
        };
      case "browser_action":
        return {
          name: "browser_action",
          arguments: {
            action: primaryValue ?? rest.action,
            url: rest.url ?? rest.uri ?? rest.query,
            coordinate: rest.coordinate,
            size: rest.size,
            text: rest.text,
            path: rest.path ?? rest.file ?? rest.file_path,
            metadata: rest.metadata,
          },
        };
      case "computer_action":
        return {
          name: "computer_action",
          arguments: {
            action: primaryValue ?? rest.action,
            coordinate: rest.coordinate,
            text: rest.text ?? rest.query ?? rest.value,
            metadata: rest.metadata,
          },
        };
      case "access_mcp_resource":
        return {
          name: "access_mcp_resource",
          arguments: {
            server_name: rest.server_name ?? rest.server,
            uri:
              primaryValue ??
              rest.uri ??
              rest.url ??
              rest.query ??
              rest.value,
            metadata: rest.metadata,
          },
        };
      case "generate_image":
        return {
          name: "generate_image",
          arguments: {
            prompt:
              primaryValue ??
              rest.prompt ??
              rest.query ??
              rest.description ??
              rest.value,
            path: rest.path ?? rest.file ?? rest.file_path,
            image: rest.image ?? rest.source,
            metadata: rest.metadata,
          },
        };
      default:
        return {
          name: toolName,
          arguments:
            primaryValue === undefined
              ? rest
              : { ...rest, value: primaryValue },
        };
    }
  }

  private static buildContentRouterCall(
    action: Record<string, any>,
  ): { name: string; arguments: Record<string, any> } | undefined {
    action = this.mergeGroupedActionPayload(action);
    const explicitTool =
      typeof action.tool === "string"
        ? resolveContentRouterTool(action.tool) ?? action.tool.trim().toLowerCase()
        : "";

    if (explicitTool === "write") {
      return {
        name: "write",
        arguments: {
          path: action.path ?? action.file_path,
          content: action.content ?? action.write,
          metadata: action.metadata,
        },
      };
    }

    const hasFlatEditPayload =
      this.getNativeEditLineRange(action) !== undefined ||
      this.getNativeEditOldText(action) !== undefined ||
      this.getNativeEditNewText(action) !== undefined;

    if (hasFlatEditPayload) {
      return {
        name: "edit",
        arguments: {
          path: action.path ?? action.file_path,
          lineRange: this.getNativeEditLineRange(action),
          oldText: this.getNativeEditOldText(action),
          newText: this.getNativeEditNewText(action),
          metadata: action.metadata,
        },
      };
    }

    const inferred = this.inferGroupedActionTool(
      action,
      ["write", "edit"],
      resolveContentRouterTool,
    );
    if (!inferred) {
      return undefined;
    }
    const { toolName, primaryValue, rest } = inferred;

    if (toolName === "write") {
      const nestedWriteObject =
        primaryValue && typeof primaryValue === "object" && !Array.isArray(primaryValue)
          ? (primaryValue as Record<string, any>)
          : undefined;
      return {
        name: "write",
        arguments: {
          path: rest.path ?? nestedWriteObject?.path ?? nestedWriteObject?.file_path,
          content:
            (nestedWriteObject?.content ?? nestedWriteObject?.write) ??
            primaryValue ??
            rest.write ??
            rest.content,
          metadata: rest.metadata ?? nestedWriteObject?.metadata,
        },
      };
    }

    if (toolName === "edit") {
      const nestedEditObject =
        primaryValue && typeof primaryValue === "object" && !Array.isArray(primaryValue)
          ? (primaryValue as Record<string, any>)
          : undefined;
      const editPath = rest.path ?? nestedEditObject?.path ?? nestedEditObject?.file_path;
      const hasStructuredEditPayload =
        (typeof primaryValue === "string" && primaryValue.trim().length > 0) ||
        (Array.isArray(primaryValue) && primaryValue.length > 0) ||
        (primaryValue &&
          typeof primaryValue === "object" &&
          !Array.isArray(primaryValue)) ||
        (typeof rest.edit === "string" && rest.edit.trim().length > 0) ||
        (Array.isArray(rest.edit) && rest.edit.length > 0) ||
        (rest.edit &&
          typeof rest.edit === "object" &&
          !Array.isArray(rest.edit));
      if (hasStructuredEditPayload) {
        const structuredEditPayload =
          nestedEditObject && (nestedEditObject.path !== undefined || nestedEditObject.file_path !== undefined)
            ? (() => {
                const { path, file_path, ...restNestedEdit } = nestedEditObject;
                return restNestedEdit;
              })()
            : primaryValue ?? rest.edit;
        return {
          name: "edit",
          arguments: {
            path: editPath,
            edit: structuredEditPayload,
            metadata: rest.metadata,
          },
        };
      }
      const hasNestedFlatEditPayload =
        this.getNativeEditLineRange(rest) !== undefined ||
        this.getNativeEditOldText(rest) !== undefined ||
        this.getNativeEditNewText(rest) !== undefined;

      if (!hasNestedFlatEditPayload) {
        return undefined;
      }

      return {
        name: "edit",
        arguments: {
          path: editPath,
          lineRange: this.getNativeEditLineRange(rest),
          oldText: this.getNativeEditOldText(rest),
          newText: this.getNativeEditNewText(rest),
          metadata: rest.metadata,
        },
      };
    }

    return {
      name: toolName,
      arguments: rest,
    };
  }

  private static buildExecuteRouterCall(
    action: Record<string, any>,
  ): { name: string; arguments: Record<string, any> } | undefined {
    const normalizedAction = this.mergeGroupedActionPayload(action);
    const explicitContentTool =
      typeof normalizedAction.tool === "string"
        ? resolveContentRouterTool(normalizedAction.tool)
        : undefined;
    const explicitToolsRouterTool =
      typeof normalizedAction.tool === "string"
        ? resolveToolsRouterOperation(normalizedAction.tool)
        : undefined;

    // OpenAI strict mode may force unrelated fields to be present with empty defaults.
    // When the model explicitly selected a non-content tool, trust that discriminator
    // and do not infer an edit/write payload from incidental old/new/lines fields.
    if (explicitToolsRouterTool !== undefined && explicitContentTool === undefined) {
      return this.buildToolsRouterCall(normalizedAction);
    }

    const looksLikeContentPayload =
      explicitContentTool !== undefined ||
      normalizedAction.content !== undefined ||
      normalizedAction.write !== undefined ||
      normalizedAction.edit !== undefined ||
      this.getNativeEditOldText(normalizedAction) !== undefined ||
      this.getNativeEditNewText(normalizedAction) !== undefined ||
      this.getNativeEditLineRange(normalizedAction) !== undefined;
    const contentCall = looksLikeContentPayload
      ? this.buildContentRouterCall(normalizedAction)
      : undefined;
    if (contentCall) {
      return contentCall;
    }

    return this.buildToolsRouterCall(normalizedAction);
  }

  private static readonly EXECUTE_COMMON_PATH_NAMES = new Set([
    ".",
    "..",
    "src",
    "app",
    "lib",
    "test",
    "tests",
    "dist",
    "build",
    "docs",
    "packages",
    "apps",
    "web",
    "server",
    "client",
    "api",
    "scripts",
  ]);

  private static tokenizeExecuteHeader(input: string): string[] {
    const tokens: string[] = [];
    const tokenRegex = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(input)) !== null) {
      const quotedValue = match[1] ?? match[2];
      if (quotedValue !== undefined) {
        try {
          tokens.push(JSON.parse(`"${quotedValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`));
        } catch {
          tokens.push(quotedValue);
        }
        continue;
      }

      if (match[3]) {
        tokens.push(match[3]);
      }
    }

    return tokens;
  }

  private static looksLikeExecutePath(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../") ||
      trimmed.startsWith("~") ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes(":") ||
      trimmed.includes("*")
    ) {
      return true;
    }

    if (
      /\.(?:[a-z0-9]{1,8})$/i.test(trimmed) ||
      this.EXECUTE_COMMON_PATH_NAMES.has(trimmed.toLowerCase())
    ) {
      return true;
    }

    return false;
  }

  private static splitExecuteCommand(
    command: string,
  ): {
    raw: string;
    header: string;
    body: string;
    bodyLines: string[];
    verb: string;
    rest: string;
    tokens: string[];
    usedColonPrefix: boolean;
  } {
    const normalizeExecuteVerbToken = (token: string): string =>
      token.replace(/[.:,;!?]+$/g, "");

    const normalized = command.replace(/\r\n/g, "\n").trim();
    const lines = normalized.split("\n");
    const header = (lines.shift() ?? "").trim();
    const body = lines.join("\n").trimEnd();
    const colonSeparatorIndex = header.indexOf(":");
    if (colonSeparatorIndex > 0) {
      const colonVerbCandidate = header.slice(0, colonSeparatorIndex).trim();
      const resolvedColonVerb = resolveToolAlias(colonVerbCandidate);
      if (this.EXECUTE_COMMAND_NAMES.has(resolvedColonVerb)) {
        const rest = header.slice(colonSeparatorIndex + 1).trim();
        return {
          raw: normalized,
          header,
          body,
          bodyLines: body
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
          verb: colonVerbCandidate,
          rest,
          tokens: this.tokenizeExecuteHeader(rest),
          usedColonPrefix: true,
        };
      }
    }

    const headerTokens = this.tokenizeExecuteHeader(header);
    const rawVerb = headerTokens[0] ?? "";
    const verb = normalizeExecuteVerbToken(rawVerb);
    const rest = rawVerb ? header.slice(rawVerb.length).trim() : header;

    return {
      raw: normalized,
      header,
      body,
      bodyLines: body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      verb,
      rest,
      tokens: headerTokens.slice(1),
      usedColonPrefix: false,
    };
  }

  private static extractExecutePrimaryAndPath(
    tokens: string[],
    rest: string,
    bodyLines: string[],
    mode: "query" | "command" = "query",
  ): { primary?: string; path?: string } {
    const quotedTokens = this.tokenizeExecuteHeader(rest);

    const quotedInSeparatorIndex = quotedTokens.indexOf("in");
    if (quotedInSeparatorIndex > 0) {
      return {
        primary: quotedTokens.slice(0, quotedInSeparatorIndex).join(" "),
        path:
          quotedTokens.slice(quotedInSeparatorIndex + 1).join(" ") ||
          bodyLines[0],
      };
    }

    if (mode !== "command" && quotedTokens.length >= 2) {
      return {
        primary: quotedTokens[0],
        path: quotedTokens[1] ?? bodyLines[0],
      };
    }

    if (tokens.length === 0) {
      return {
        primary: bodyLines[0],
        path: bodyLines[1],
      };
    }

    if (tokens.length === 1) {
      return {
        primary: tokens[0],
        path: bodyLines[0],
      };
    }

    const inSeparatorIndex = tokens.indexOf("in");
    if (inSeparatorIndex > 0) {
      return {
        primary: tokens.slice(0, inSeparatorIndex).join(" "),
        path: tokens.slice(inSeparatorIndex + 1).join(" ") || bodyLines[0],
      };
    }

    const lastToken = tokens[tokens.length - 1];
    const shouldTreatLastTokenAsPath =
      this.looksLikeExecutePath(lastToken) &&
      (mode !== "command" &&
        tokens[0].includes("|") ||
        tokens[0].includes("*") ||
        tokens.length > 2);

    if (shouldTreatLastTokenAsPath) {
      return {
        primary: tokens.slice(0, -1).join(" "),
        path: lastToken,
      };
    }

    return {
      primary: tokens.join(" "),
      path: bodyLines[0],
    };
  }

  private static applyExecuteGrepFlag(
    token: string,
    options: {
      case_insensitive?: boolean;
      whole_word?: boolean;
      literal?: boolean;
      multiline?: boolean;
    },
  ): boolean {
    const applyShortFlag = (flag: string): boolean => {
      switch (flag) {
        case "r":
        case "R":
        case "n":
        case "H":
        case "h":
          return true;
        case "i":
          options.case_insensitive = true;
          return true;
        case "w":
          options.whole_word = true;
          return true;
        case "F":
          options.literal = true;
          return true;
        case "E":
        case "G":
        case "P":
          options.literal = false;
          return true;
        case "U":
          options.multiline = true;
          return true;
        default:
          return false;
      }
    };

    switch (token) {
      case "--recursive":
      case "--dereference-recursive":
      case "--line-number":
      case "--with-filename":
      case "--no-filename":
        return true;
      case "--ignore-case":
        options.case_insensitive = true;
        return true;
      case "--word-regexp":
        options.whole_word = true;
        return true;
      case "--fixed-strings":
        options.literal = true;
        return true;
      case "--extended-regexp":
      case "--basic-regexp":
      case "--perl-regexp":
        options.literal = false;
        return true;
      case "--multiline":
        options.multiline = true;
        return true;
      default:
        break;
    }

    if (!token.startsWith("-") || token === "-") {
      return false;
    }

    if (token.startsWith("--")) {
      return false;
    }

    const shortFlags = token.slice(1);
    if (!shortFlags) {
      return false;
    }

    for (const flag of shortFlags) {
      if (!applyShortFlag(flag)) {
        return false;
      }
    }

    return true;
  }

  private static parseExecuteGrepCommand(parsed: {
    rest: string;
    bodyLines: string[];
  }): {
    query?: string;
    path?: string;
    case_insensitive?: boolean;
    whole_word?: boolean;
    literal?: boolean;
    multiline?: boolean;
  } {
    const options: {
      case_insensitive?: boolean;
      whole_word?: boolean;
      literal?: boolean;
      multiline?: boolean;
    } = {};
    const headerArgs = this.tokenizeExecuteHeader(parsed.rest);
    let headerIndex = 0;
    while (
      headerIndex < headerArgs.length &&
      this.applyExecuteGrepFlag(headerArgs[headerIndex], options)
    ) {
      headerIndex++;
    }

    const remainingHeaderArgs = headerArgs.slice(headerIndex);
    const remainingBodyLines = [...parsed.bodyLines];
    while (
      remainingBodyLines.length > 0 &&
      this.applyExecuteGrepFlag(remainingBodyLines[0], options)
    ) {
      remainingBodyLines.shift();
    }

    const inSeparatorIndex = remainingHeaderArgs.indexOf("in");
    if (inSeparatorIndex > 0) {
      const query = remainingHeaderArgs.slice(0, inSeparatorIndex).join(" ");
      const path = remainingHeaderArgs.slice(inSeparatorIndex + 1).join(" ");
      return {
        ...(query ? { query } : {}),
        ...(path
          ? { path }
          : remainingBodyLines[0]
            ? { path: remainingBodyLines[0] }
            : {}),
        ...options,
      };
    }

    if (remainingHeaderArgs.length >= 2) {
      return {
        query: remainingHeaderArgs[0],
        path: remainingHeaderArgs[1],
        ...options,
      };
    }

    if (remainingHeaderArgs.length === 1) {
      return {
        query: remainingHeaderArgs[0],
        ...(remainingBodyLines[0] ? { path: remainingBodyLines[0] } : {}),
        ...options,
      };
    }

    return {
      query: remainingBodyLines[0],
      ...(remainingBodyLines[1] ? { path: remainingBodyLines[1] } : {}),
      ...options,
    };
  }

  private static parseExecuteFindCommand(parsed: {
    rest: string;
    bodyLines: string[];
  }): {
    pattern?: string;
    path?: string;
    case_insensitive?: boolean;
  } {
    const args = this.tokenizeExecuteHeader(parsed.rest);
    let path: string | undefined;
    let pattern: string | undefined;
    let case_insensitive = false;
    const inSeparatorIndex = args.indexOf("in");

    if (args[0] === "-name" || args[0] === "--name") {
      pattern = args[1] ?? parsed.bodyLines[0];
      path = args[2] ?? parsed.bodyLines[1];
    } else if (args[0] === "-iname" || args[0] === "--iname") {
      case_insensitive = true;
      pattern = args[1] ?? parsed.bodyLines[0];
      path = args[2] ?? parsed.bodyLines[1];
    } else if (
      args.length >= 3 &&
      !args[0].startsWith("-") &&
      (args[1] === "-name" || args[1] === "--name" || args[1] === "-iname" || args[1] === "--iname")
    ) {
      path = args[0];
      case_insensitive = args[1] === "-iname" || args[1] === "--iname";
      pattern = args[2] ?? parsed.bodyLines[0];
    } else if (inSeparatorIndex > 0) {
      pattern = args.slice(0, inSeparatorIndex).join(" ");
      path = args.slice(inSeparatorIndex + 1).join(" ") || parsed.bodyLines[1];
    } else {
      pattern = args[0] ?? parsed.bodyLines[0];
      path = args[1] ?? parsed.bodyLines[1];
    }

    if (!pattern) {
      if (parsed.bodyLines[0]) {
        pattern = parsed.bodyLines[0];
      }
    }

    if (!path && parsed.bodyLines[1]) {
      path = parsed.bodyLines[1];
    }

    return {
      ...(pattern ? { pattern } : {}),
      ...(path ? { path } : {}),
      ...(case_insensitive ? { case_insensitive: true } : {}),
    };
  }

  private static shouldMergeExecuteContinuation(
    resolvedName: string,
    error: string,
  ): boolean {
    return (
      (resolvedName === "edit" &&
        error === "edit requires at least one oldText/newText block.") ||
      (resolvedName === "write" &&
        error === "write requires file content in the command body.") ||
      (resolvedName === "todo" &&
        error === "todo requires checklist content or text.")
    );
  }

  private static looksLikeExecuteCommandStart(command: string): boolean {
    const parsed = this.splitExecuteCommand(command);
    if (!parsed.verb) {
      return false;
    }

    return this.EXECUTE_COMMAND_NAMES.has(resolveToolAlias(parsed.verb.trim()));
  }

  private static looksLikeExecuteBodyContinuation(command: string): boolean {
    const firstLine = command.trim().split("\n", 1)[0]?.trim() ?? "";
    if (!firstLine) {
      return false;
    }

    return /^(oldText\b|newText\b|search:?$|replace:?$|[-*]\s+\[[ xX]\]|<<<<<<<|=======|>>>>>>>)/i.test(
      firstLine,
    );
  }

  private static normalizeExecuteRawCommands(rawCommands: unknown[]): unknown[] {
    const normalized: unknown[] = [];
    const unwrapQuotedDslString = (value: string): string => {
      const quotePairs: Record<string, string> = {
        '"': '"',
        "'": "'",
        "`": "`",
        "“": "”",
        "‘": "’",
      };
      const first = value[0];
      const last = value[value.length - 1];
      return first && last && quotePairs[first] === last
        ? value.slice(1, -1)
        : value;
    };

    for (const rawCommand of rawCommands) {
      if (typeof rawCommand !== "string") {
        normalized.push(rawCommand);
        continue;
      }

      const trimmed = rawCommand.trim();
      if (!trimmed) {
        normalized.push(rawCommand);
        continue;
      }

      const looksJsonWrapped =
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'));

      if (!looksJsonWrapped) {
        const unwrapped = unwrapQuotedDslString(trimmed);
        normalized.push(unwrapped.length > 0 ? unwrapped : rawCommand);
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          normalized.push(...parsed);
          continue;
        }
        if (typeof parsed === "string") {
          normalized.push(parsed);
          continue;
        }
      } catch {
        if (trimmed.startsWith('["') && trimmed.endsWith('"]')) {
          normalized.push(trimmed.slice(2, -2));
          continue;
        }
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          normalized.push(trimmed.slice(1, -1));
          continue;
        }
      }

      const unwrapped = unwrapQuotedDslString(trimmed);
      normalized.push(unwrapped.length > 0 ? unwrapped : rawCommand);
    }

    return normalized;
  }

  private static isExecuteReadRangeSpecifier(value: string): boolean {
    const trimmed = value.trim();
    return /^(?:L)?\d+-\d+$/i.test(trimmed) || /^[HT]\d+$/i.test(trimmed);
  }

  private static isExecuteReadRangeListSpecifier(value: string): boolean {
    const ranges = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return ranges.length > 0 && ranges.every((range) => this.isExecuteReadRangeSpecifier(range));
  }

  private static normalizeExecuteReadRangeList(value: string): string {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        if (/^[HT]/i.test(item)) {
          return item.toUpperCase();
        }

        return item.toUpperCase().startsWith("L") ? item.toUpperCase() : `L${item}`;
      })
      .join(",");
  }

  private static parseColonExecuteReadTarget(rest: string): string | undefined {
    const trimmed = rest.trim();
    if (!trimmed) {
      return undefined;
    }

    const lastColonIndex = trimmed.lastIndexOf(":");
    if (lastColonIndex > 0) {
      const maybePath = trimmed.slice(0, lastColonIndex).trim();
      const maybeRange = trimmed.slice(lastColonIndex + 1).trim();
      if (maybePath && this.isExecuteReadRangeListSpecifier(maybeRange)) {
        return `${maybePath}:${this.normalizeExecuteReadRangeList(maybeRange)}`;
      }
    }

    return trimmed;
  }

  private static parseLeadingColonExecutePathAndValue(
    rest: string,
  ): { path?: string; value?: string } {
    const trimmed = rest.trim();
    if (!trimmed) {
      return {};
    }

    const firstColonIndex = trimmed.indexOf(":");
    if (firstColonIndex <= 0) {
      return { value: trimmed };
    }

    const path = trimmed.slice(0, firstColonIndex).trim();
    const value = trimmed.slice(firstColonIndex + 1).trim();
    if (!path || !value || !this.looksLikeExecutePath(path)) {
      return { value: trimmed };
    }

    return { path, value };
  }

  private static parseExecuteCompactEditBlocks(
    bodyLines: string[],
  ): NativeEditBlock[] {
    const blocks: NativeEditBlock[] = [];

    for (const line of bodyLines) {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex <= 0) {
        continue;
      }

      const lineRange = line.slice(0, separatorIndex).trim();
      const replacement = line.slice(separatorIndex + 1).trim();
      const arrowIndex = replacement.indexOf("->");
      if (!lineRange || arrowIndex < 0) {
        continue;
      }

      const oldText = replacement.slice(0, arrowIndex).trim();
      const newText = replacement.slice(arrowIndex + 2).trim();
      if (!oldText && !newText) {
        continue;
      }

      blocks.push({
        lineRange,
        oldText,
        newText,
      });
    }

    return blocks;
  }

  private static parseExecuteWriteInlinePayload(
    value: string,
  ): { path?: string; content?: string } {
    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }

    const separatorIndex = trimmed.indexOf("|");
    if (separatorIndex <= 0) {
      return { path: trimmed };
    }

    const path = trimmed.slice(0, separatorIndex).trim();
    const content = trimmed.slice(separatorIndex + 1);
    return {
      ...(path ? { path } : {}),
      ...(content.length > 0 ? { content } : {}),
    };
  }

  private static normalizeExecuteReadTargets(
    tokens: string[],
    bodyLines: string[],
    inlineValue: string,
  ): string[] {
    const rawTargets = [...tokens, ...bodyLines].filter(Boolean);

    if (rawTargets.length === 0 && inlineValue) {
      rawTargets.push(inlineValue);
    }

    if (
      rawTargets.length >= 2 &&
      this.isExecuteReadRangeSpecifier(rawTargets[1])
    ) {
      const [pathTarget, rangeTarget, ...restTargets] = rawTargets;
      const trimmedRange = rangeTarget.trim();
      const normalizedRange = trimmedRange.toUpperCase().startsWith("L")
        ? trimmedRange.toUpperCase()
        : /^[HT]/i.test(trimmedRange)
          ? trimmedRange.toUpperCase()
          : `L${trimmedRange}`;

      return [`${pathTarget}:${normalizedRange}`, ...restTargets];
    }

    return rawTargets;
  }

  private static parseExecuteCommand(
    command: string,
  ):
    | { call: { name: string; arguments: Record<string, any> } }
    | { error: string } {
    const validateExecuteCall = (
      call: { name: string; arguments: Record<string, any> },
    ): { call: { name: string; arguments: Record<string, any> } } | { error: string } => {
      const schema = EXECUTE_CALL_ARGUMENT_SCHEMAS[call.name as keyof typeof EXECUTE_CALL_ARGUMENT_SCHEMAS];
      if (!schema) {
        return { call };
      }

      const result = schema.safeParse(call.arguments);
      if (result.success) {
        return {
          call: {
            name: call.name,
            arguments: result.data,
          },
        };
      }

      const issue = result.error.issues[0];
      const path = issue?.path?.join(".");
      return {
        error: path
          ? `${call.name} ${path} ${issue.message}.`
          : `${call.name} ${issue?.message ?? "is invalid"}.`,
      };
    };

    const parsed = this.splitExecuteCommand(command);
    if (!parsed.raw || !parsed.verb) {
      return { error: "Command is empty." };
    }

    const resolvedName = resolveToolAlias(parsed.verb.trim());
    const inlineValue = parsed.rest;

    switch (resolvedName) {
      case "read": {
        const targets = parsed.usedColonPrefix
          ? (() => {
              const target = this.parseColonExecuteReadTarget(parsed.rest);
              return target ? [target] : [];
            })()
          : this.normalizeExecuteReadTargets(
              parsed.tokens,
              parsed.bodyLines,
              inlineValue,
            );
        if (targets.length === 0) {
          return { error: 'read requires at least one path target.' };
        }
        return validateExecuteCall({
          name: "read",
          arguments: { files: targets },
        });
      }
      case "grep": {
        const grepArgs: ReturnType<typeof this.parseExecuteGrepCommand> = parsed.usedColonPrefix
          ? (() => {
              const { path, value } = this.parseLeadingColonExecutePathAndValue(
                parsed.rest,
              );
              return {
                query: value,
                ...(path ? { path } : {}),
              };
            })()
          : this.parseExecuteGrepCommand(parsed);
        if (!grepArgs.query) {
          return { error: "grep requires a query." };
        }
        return validateExecuteCall({
          name: "grep",
          arguments: {
            query: grepArgs.query,
            ...(grepArgs.path ? { path: grepArgs.path } : {}),
            ...(grepArgs.case_insensitive === true
              ? { case_insensitive: true }
              : {}),
            ...(grepArgs.whole_word === true ? { whole_word: true } : {}),
            ...(grepArgs.literal !== undefined
              ? { literal: grepArgs.literal }
              : {}),
            ...(grepArgs.multiline === true ? { multiline: true } : {}),
          },
        });
      }
      case "glob": {
        const findArgs: ReturnType<typeof this.parseExecuteFindCommand> = parsed.usedColonPrefix
          ? (() => {
              const { path, value } = this.parseLeadingColonExecutePathAndValue(
                parsed.rest,
              );
              return {
                pattern: value,
                ...(path ? { path } : {}),
              };
            })()
          : this.parseExecuteFindCommand(parsed);
        if (!findArgs.pattern) {
          return { error: "find requires a pattern." };
        }
        return validateExecuteCall({
          name: "glob",
          arguments: {
            pattern: findArgs.pattern,
            ...(findArgs.path ? { path: findArgs.path } : {}),
            ...(findArgs.case_insensitive === true
              ? { case_insensitive: true }
              : {}),
          },
        });
      }
      case "list": {
        const path = (parsed.tokens[0] ?? parsed.bodyLines[0] ?? inlineValue) || ".";
        return validateExecuteCall({
          name: "list",
          arguments: {
            ...(path ? { path } : {}),
          },
        });
      }
      case "bash": {
        const bashArgs = parsed.usedColonPrefix
          ? this.parseLeadingColonExecutePathAndValue(parsed.rest)
          : (() => {
              const { primary, path } = this.extractExecutePrimaryAndPath(
                parsed.tokens,
                parsed.rest,
                parsed.bodyLines,
                "command",
              );
              return { value: primary, path };
            })();
        if (!bashArgs.value) {
          return { error: "bash requires a command." };
        }
        return validateExecuteCall({
          name: "bash",
          arguments: {
            command: bashArgs.value,
            ...(bashArgs.path ? { cwd: bashArgs.path } : {}),
          },
        });
      }
      case "web":
      case "ask":
      case "agent": {
        const askArgs =
          resolvedName === "ask" && parsed.usedColonPrefix
            ? this.parseLeadingColonExecutePathAndValue(parsed.rest)
            : { value: inlineValue || parsed.body };
        const value = askArgs.value;
        if (!value) {
          return { error: `${resolvedName} requires a query.` };
        }
        const argumentKey =
          resolvedName === "agent"
            ? "prompt"
            : resolvedName === "ask"
              ? "query"
              : "query";
        return validateExecuteCall({
          name: resolvedName,
          arguments: {
            [argumentKey]: value,
            ...(resolvedName === "ask" && askArgs.path
              ? { path: askArgs.path }
              : {}),
          },
        });
      }
      case "fetch": {
        const url = inlineValue || parsed.bodyLines[0];
        if (!url) {
          return { error: "fetch requires a URL." };
        }
        return validateExecuteCall({
          name: "fetch",
          arguments: { url },
        });
      }
      case "edit": {
        let path = inlineValue;
        let body = parsed.body;
        if (parsed.usedColonPrefix) {
          path = parsed.rest;
        } else if (!path && parsed.bodyLines.length > 0) {
          const [firstLine, ...restLines] = parsed.body.split("\n");
          path = firstLine?.trim() ?? "";
          body = restLines.join("\n").trim();
        }
        if (!path) {
          return { error: "edit requires a target path." };
        }
        if (!body) {
          return { error: "edit requires at least one oldText/newText block." };
        }
        const compactEditBlocks = this.parseExecuteCompactEditBlocks(
          parsed.bodyLines,
        );
        return validateExecuteCall({
          name: "edit",
          arguments: {
            path,
            edit:
              compactEditBlocks.length === parsed.bodyLines.length &&
              compactEditBlocks.length > 0
                ? compactEditBlocks
                : body,
          },
        });
      }
      case "write": {
        let path = inlineValue;
        let content = parsed.body;
        if (parsed.usedColonPrefix) {
          const inlineWrite = this.parseExecuteWriteInlinePayload(parsed.rest);
          path = inlineWrite.path ?? "";
          content =
            inlineWrite.content !== undefined
              ? parsed.body
                ? `${inlineWrite.content}\n${parsed.body}`
                : inlineWrite.content
              : parsed.body;
        } else if (!path && parsed.bodyLines.length > 0) {
          const [firstLine, ...restLines] = parsed.body.split("\n");
          path = firstLine?.trim() ?? "";
          content = restLines.join("\n");
        }
        if (!path) {
          return { error: "write requires a target path." };
        }
        if (!content) {
          return { error: "write requires file content in the command body." };
        }
        return validateExecuteCall({
          name: "write",
          arguments: {
            path,
            content,
          },
        });
      }
      case "todo": {
        const todos = parsed.body || inlineValue;
        if (!todos) {
          return { error: "todo requires checklist content or text." };
        }
        return validateExecuteCall({
          name: "todo",
          arguments: {
            todos,
          },
        });
      }
      case "browser_action": {
        const action = parsed.tokens[0];
        const actionValue = parsed.tokens.slice(1).join(" ") || parsed.bodyLines[0];
        if (!action) {
          return { error: "browser_action requires an action." };
        }
        return validateExecuteCall({
          name: "browser_action",
          arguments: {
            action,
            ...(action === "launch" && actionValue ? { url: actionValue } : {}),
            ...((action === "click" || action === "hover") && actionValue
              ? { coordinate: actionValue }
              : {}),
            ...(action === "resize" && actionValue ? { size: actionValue } : {}),
            ...((action === "type" || action === "press") && actionValue
              ? { text: actionValue }
              : {}),
          },
        });
      }
      case "computer_action": {
        const action = parsed.tokens[0];
        const actionValue = parsed.tokens.slice(1).join(" ") || parsed.bodyLines[0];
        if (!action) {
          return { error: "computer_action requires an action." };
        }
        const pointerValue = parsed.tokens[1] ?? parsed.bodyLines[0];
        const textValue =
          action === "scroll"
            ? (parsed.tokens.slice(2).join(" ") || parsed.bodyLines[1] || parsed.bodyLines[0])
            : actionValue;
        return validateExecuteCall({
          name: "computer_action",
          arguments: {
            action,
            ...(
              [
                "mouse_move",
                "left_click",
                "left_click_drag",
                "right_click",
                "middle_click",
                "double_click",
                "scroll",
              ].includes(action) && pointerValue
                ? { coordinate: pointerValue }
                : {}
            ),
            ...((action === "key" || action === "type" || action === "scroll") && textValue
              ? { text: textValue }
              : {}),
          },
        });
      }
      case "access_mcp_resource": {
        const serverName = parsed.tokens[0] ?? parsed.bodyLines[0];
        const uri = parsed.tokens[1] ?? parsed.bodyLines[1];
        if (!serverName || !uri) {
          return {
            error:
              "access_mcp_resource requires a server name and a resource URI.",
          };
        }
        return validateExecuteCall({
          name: "access_mcp_resource",
          arguments: {
            server_name: serverName,
            uri,
          },
        });
      }
      case "generate_image": {
        const prompt = inlineValue || parsed.bodyLines[0];
        const path = inlineValue ? parsed.bodyLines[0] : parsed.bodyLines[1];
        const image = inlineValue ? parsed.bodyLines[1] : parsed.bodyLines[2];
        if (!prompt || !path) {
          return {
            error: "generate_image requires a prompt and an output path.",
          };
        }
        return validateExecuteCall({
          name: "generate_image",
          arguments: {
            prompt,
            path,
            ...(image ? { image } : {}),
          },
        });
      }
      default:
        return { error: `Unknown tool command "${parsed.verb}".` };
    }
  }

  private static parseMalformedToolCalls(rawCalls: unknown): {
    directBatchCalls: Array<{ name: string; arguments: Record<string, any> }>;
    rawCommands: unknown[];
  } {
    const parsedCalls =
      typeof rawCalls === "string"
        ? (() => {
            const trimmed = rawCalls.trim();
            if (!trimmed) {
              return [];
            }
            try {
              return JSON.parse(trimmed);
            } catch {
              return [rawCalls];
            }
          })()
        : rawCalls;

    if (!Array.isArray(parsedCalls)) {
      return { directBatchCalls: [], rawCommands: [] };
    }

    const directBatchCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
    const rawCommands = parsedCalls.map((call) => {
      if (typeof call === "string") {
        return call;
      }
      if (!call || typeof call !== "object") {
        return call;
      }

      const record = call as Record<string, unknown>;
      if (
        typeof record.name === "string" &&
        record.arguments &&
        typeof record.arguments === "object" &&
        !Array.isArray(record.arguments)
      ) {
        directBatchCalls.push({
          name: record.name,
          arguments: record.arguments as Record<string, any>,
        });
        return undefined;
      }
      if (typeof record.arguments === "string" && record.arguments.trim().length > 0) {
        return record.arguments;
      }
      if (typeof record.command === "string" && record.command.trim().length > 0) {
        return record.command;
      }

      return call;
    });

    return {
      directBatchCalls,
      rawCommands: rawCommands.filter((command) => command !== undefined),
    };
  }

  private static executeCommandsToBatchCalls(
    groupedName: "execute" | "tool",
    args: Record<string, any> | undefined,
  ): NativeToolArgs["batch"] | undefined {
    if (!args || typeof args !== "object") {
      return undefined;
    }

    let rawCommands: unknown[] = [];
    let directBatchCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
    const sourceCommands = args.calls ?? args.tools ?? args.commands;
    if (
      groupedName === "tool" &&
      typeof args.calls !== "undefined" &&
      typeof args.tools === "undefined" &&
      typeof args.commands === "undefined"
    ) {
      const salvaged = this.parseMalformedToolCalls(args.calls);
      rawCommands = salvaged.rawCommands;
      directBatchCalls = salvaged.directBatchCalls;
    } else if (Array.isArray(sourceCommands)) {
      rawCommands = sourceCommands;
    } else if (typeof sourceCommands === "string") {
      const trimmed = sourceCommands.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          rawCommands = Array.isArray(parsed) ? parsed : [sourceCommands];
        } catch {
          rawCommands = [sourceCommands];
        }
      } else {
        rawCommands = [sourceCommands];
      }
    } else if (typeof args.calls !== "undefined") {
      const salvaged = this.parseMalformedToolCalls(args.calls);
      rawCommands = salvaged.rawCommands;
      directBatchCalls = salvaged.directBatchCalls;
    }

    const missingParamName = groupedName === "tool" ? "calls" : "commands";

    if (directBatchCalls.length > 0 && rawCommands.length === 0) {
      return {
        calls: directBatchCalls,
        missingParamName,
      };
    }

    if (rawCommands.length === 0) {
      return {
        calls: [],
        missingParamName,
      };
    }

    rawCommands = this.normalizeExecuteRawCommands(rawCommands);

    const calls: Array<{ name: string; arguments: Record<string, any> }> = [];
    const parseErrors: NonNullable<NativeToolArgs["batch"]["parseErrors"]> = [];

    for (let index = 0; index < rawCommands.length; index++) {
      const rawCommand = rawCommands[index];
      if (typeof rawCommand !== "string" || rawCommand.trim().length === 0) {
        parseErrors.push({
          index,
          command: typeof rawCommand === "string" ? rawCommand : String(rawCommand),
          error: "Each tool DSL entry must be a non-empty string.",
        });
        continue;
      }

      let parsedCommand = this.parseExecuteCommand(rawCommand);
      if ("error" in parsedCommand) {
        const splitCommand = this.splitExecuteCommand(rawCommand);
        const resolvedName = resolveToolAlias(splitCommand.verb.trim());
        const nextRawCommand = rawCommands[index + 1];
        const canAttemptMerge =
          typeof nextRawCommand === "string" &&
          nextRawCommand.trim().length > 0 &&
          this.shouldMergeExecuteContinuation(
            resolvedName,
            parsedCommand.error,
          ) &&
          (this.looksLikeExecuteBodyContinuation(nextRawCommand) ||
            !this.looksLikeExecuteCommandStart(nextRawCommand));

        if (canAttemptMerge) {
          let mergedCommand = rawCommand.trimEnd();
          let lastSuccessfulParse:
            | { call: { name: string; arguments: Record<string, any> } }
            | undefined;
          let consumedIndex = index;

          for (let nextIndex = index + 1; nextIndex < rawCommands.length; nextIndex++) {
            const continuation = rawCommands[nextIndex];
            if (typeof continuation !== "string" || continuation.trim().length === 0) {
              break;
            }
            if (this.looksLikeExecuteCommandStart(continuation)) {
              break;
            }

            mergedCommand = `${mergedCommand}\n${continuation}`;
            const mergedParsedCommand = this.parseExecuteCommand(mergedCommand);
            if ("error" in mergedParsedCommand) {
              if (
                !this.shouldMergeExecuteContinuation(
                  resolvedName,
                  mergedParsedCommand.error,
                )
              ) {
                break;
              }
              consumedIndex = nextIndex;
              continue;
            }

            lastSuccessfulParse = mergedParsedCommand;
            consumedIndex = nextIndex;
          }

          if (lastSuccessfulParse) {
            parsedCommand = lastSuccessfulParse;
            index = consumedIndex;
          }
        }
      }

      if ("error" in parsedCommand) {
        parseErrors.push({
          index,
          command: rawCommand,
          error: parsedCommand.error,
        });
        continue;
      }

      calls.push(parsedCommand.call);
    }

    if (calls.length === 0 && parseErrors.length > 0) {
      return {
        calls,
        missingParamName,
        parseError: parseErrors[0].error,
        parseErrors,
      };
    }

    return {
      calls: [...directBatchCalls, ...calls],
      missingParamName,
      ...(parseErrors.length > 0 ? { parseErrors } : {}),
    };
  }

  private static groupedActionsToBatchCalls(
    groupedName: GroupedBatchToolName,
    args: Record<string, any> | undefined,
  ): NativeToolArgs["batch"] | undefined {
    if (!args || typeof args !== "object") {
      return undefined;
    }

    if (groupedName === "execute" || groupedName === "tool") {
      if (groupedName === "tool") {
        if (
          args.calls === undefined &&
          args.tools === undefined &&
          args.commands === undefined
        ) {
          const rawName =
            typeof args.name === "string" ? String(args.name).trim() : "";
          const name = resolveToolAlias(rawName);
          const argumentsValue =
            args.arguments ??
            args.args ??
            args.params ??
            args.input;

          if (
            name &&
            argumentsValue &&
            typeof argumentsValue === "object" &&
            !Array.isArray(argumentsValue)
          ) {
            return {
              calls: [
                {
                  name,
                  arguments: argumentsValue as Record<string, any>,
                },
              ],
              missingParamName: "calls",
            };
          }

          const singleCall = this.buildExecuteRouterCall(args);
          if (singleCall) {
            return {
              calls: [singleCall],
              missingParamName: "calls",
            };
          }
        }

        const normalizedActions = this.normalizeGroupedActions(
          args.calls ?? args.tools ?? args.commands,
        );
        if (normalizedActions.length > 0) {
          const calls = normalizedActions
            .map((action) => {
              const actionRecord = action as Record<string, any>;
              const rawName =
                typeof actionRecord.name === "string"
                  ? String(actionRecord.name).trim()
                  : "";
              const name = resolveToolAlias(rawName);
              const argumentsValue =
                actionRecord.arguments ??
                actionRecord.args ??
                actionRecord.params ??
                actionRecord.input;

              if (
                name &&
                argumentsValue &&
                typeof argumentsValue === "object" &&
                !Array.isArray(argumentsValue)
              ) {
                return {
                  name,
                  arguments: argumentsValue as Record<string, any>,
                };
              }

              return this.buildExecuteRouterCall(actionRecord);
            })
            .filter(
              (call): call is { name: string; arguments: Record<string, any> } =>
                !!call && call.name.length > 0,
            );

          if (calls.length > 0) {
            return {
              calls,
              missingParamName: "calls",
            };
          }
        }
      }

      return this.executeCommandsToBatchCalls(groupedName, args);
    }

    const missingParamName =
      groupedName === "content"
        ? "content"
        : groupedName === "tools"
          ? "tools"
          : "calls";
    const rawActions =
      groupedName === "tools"
        ? (args.tools ?? args.calls ?? args.actions)
        : groupedName === "content"
          ? (args.content ?? args.calls ?? args.actions)
          : args.actions;

    const normalizedActions = this.normalizeGroupedActions(rawActions);
    if (normalizedActions.length === 0) {
      return {
        calls: [],
        missingParamName,
      };
    }

    const directBatchCalls = normalizedActions
      .map((action) => {
        const actionRecord = action as Record<string, any>;
        const rawName =
          typeof actionRecord.name === "string"
            ? String(actionRecord.name).trim()
            : "";
        const name = resolveToolAlias(rawName);
        const argumentsValue =
          actionRecord.arguments ??
          actionRecord.args ??
          actionRecord.params ??
          actionRecord.input;
        if (
          !name ||
          !argumentsValue ||
          typeof argumentsValue !== "object" ||
          Array.isArray(argumentsValue)
        ) {
          return undefined;
        }

        return {
          name,
          arguments: argumentsValue as Record<string, any>,
        };
      })
      .filter(
        (call): call is { name: string; arguments: Record<string, any> } =>
          !!call,
      );

    if (directBatchCalls.length === normalizedActions.length) {
      return {
        calls: directBatchCalls,
        missingParamName,
      };
    }

    const calls = normalizedActions
      .map((action) => {
        const normalizedAction = action as Record<string, any>;
        if (groupedName === "tools") {
          return this.buildToolsRouterCall(normalizedAction);
        }

        if (groupedName === "content") {
          return this.buildContentRouterCall(normalizedAction);
        }

        const { tool, ...rest } = normalizedAction;
        return {
          name: String(tool ?? ""),
          arguments: rest,
        };
      })
      .filter(
        (call): call is { name: string; arguments: Record<string, any> } =>
          !!call && call.name.length > 0,
      );

    if (calls.length === 0 && normalizedActions.length > 0) {
      return {
        calls: [],
        missingParamName,
        parseError:
          groupedName === "content"
            ? 'Invalid content router item. Each item must specify "tool": "write" or "edit", or include a write/edit payload.'
            : 'Invalid tools router item. Each item must specify a valid tool operation or include a supported compact payload.',
      };
    }

    return {
      calls,
      missingParamName,
    };
  }

  /**
   * Create a partial ToolUse from currently parsed arguments.
   * Used during streaming to show progress.
   * @param originalName - The original tool name as called by the model (if different from canonical name)
   */
  private static createPartialToolUse(
    id: string,
    name: ToolName,
    partialArgs: Record<string, any>,
    partial: boolean,
    originalName?: string,
  ): ToolUse | null {
    const normalizedArgs = this.normalizeArgsForTool(partialArgs, name);

    // Build legacy params for display
    // NOTE: For streaming partial updates, we MUST populate params even for complex types
    // because tool.handlePartial() methods rely on params to show UI updates
    const params: Partial<Record<ToolParamName, string>> = {};

    for (const [key, value] of Object.entries(normalizedArgs)) {
      if (toolParamNames.includes(key as ToolParamName)) {
        params[key as ToolParamName] =
          typeof value === "string" ? value : JSON.stringify(value);
      }
    }

    // Build partial nativeArgs based on what we have so far
    let nativeArgs: any = undefined;
    if (this.isGroupedBatchToolName(name)) {
      const groupedBatchArgs = this.groupedActionsToBatchCalls(
        name,
        normalizedArgs,
      );
      if (groupedBatchArgs) {
        nativeArgs = groupedBatchArgs;
      }
      const result: ToolUse = {
        type: "tool_use" as const,
        name: "batch" as ToolName,
        params,
        partial,
        nativeArgs,
      };

      if (originalName) {
        result.originalName = originalName;
      }

      return result;
    }

    switch (name) {
      case "read":
        if (normalizedArgs.files && Array.isArray(normalizedArgs.files)) {
          nativeArgs = { files: this.convertFileEntries(normalizedArgs.files) };
        } else if (normalizedArgs.path) {
          nativeArgs = {
            files: this.convertFileEntries([normalizedArgs.path]),
          };
        }
        break;

      case "attempt_completion":
        if (normalizedArgs.result) {
          nativeArgs = { result: normalizedArgs.result };
        }
        break;

      case "bash":
        if (normalizedArgs.command) {
          nativeArgs = {
            command: normalizedArgs.command,
            cwd: normalizedArgs.cwd,
          };
        }
        break;

      case "batch": {
        const rawCalls = normalizedArgs.calls ?? normalizedArgs.tools;
        if (Array.isArray(rawCalls)) {
          nativeArgs = {
            calls: rawCalls.map((call) => ({
              name: String(call?.name ?? ""),
              arguments:
                call &&
                typeof call.arguments === "object" &&
                call.arguments !== null &&
                !Array.isArray(call.arguments)
                  ? call.arguments
                  : {},
            })),
          };
        }
        break;
      }

      case "write":
        if (normalizedArgs.path || normalizedArgs.content) {
          nativeArgs = {
            path: normalizedArgs.path,
            content: normalizedArgs.content,
          };
        }
        break;

      case "browser_action":
        if (normalizedArgs.action !== undefined) {
          nativeArgs = {
            action: normalizedArgs.action,
            url: normalizedArgs.url,
            coordinate: normalizedArgs.coordinate,
            size: normalizedArgs.size,
            text: normalizedArgs.text,
            path: normalizedArgs.path,
          };
        }
        break;

      case "computer_action":
        if (normalizedArgs.action !== undefined) {
          nativeArgs = {
            action: normalizedArgs.action,
            coordinate: normalizedArgs.coordinate,
            text: normalizedArgs.text,
          };
        }
        break;

      case "ask":
        if (normalizedArgs.query !== undefined) {
          nativeArgs = {
            query: normalizedArgs.query,
            path: normalizedArgs.path,
          };
        }
        break;

      case "web":
        if (normalizedArgs.query !== undefined) {
          nativeArgs = {
            query: normalizedArgs.query,
            allowed_domains: normalizedArgs.allowed_domains,
            blocked_domains: normalizedArgs.blocked_domains,
          };
        }
        break;

      case "fetch":
        if (normalizedArgs.url !== undefined) {
          nativeArgs = {
            url: normalizedArgs.url,
            include_links: normalizedArgs.include_links,
          };
        }
        break;

      case "agent":
        if (normalizedArgs.prompt !== undefined) {
          nativeArgs = {
            prompt: normalizedArgs.prompt,
            mode: normalizedArgs.mode,
            api_provider: normalizedArgs.api_provider,
            model_id: normalizedArgs.model_id,
          };
        }
        break;

      case "fetch_instructions":
        if (normalizedArgs.task !== undefined) {
          nativeArgs = {
            task: normalizedArgs.task,
          };
        }
        break;

      case "generate_image":
        if (
          normalizedArgs.prompt !== undefined ||
          normalizedArgs.path !== undefined
        ) {
          nativeArgs = {
            prompt: normalizedArgs.prompt,
            path: normalizedArgs.path,
            image: normalizedArgs.image,
          };
        }
        break;

      case "run_slash_command":
        if (normalizedArgs.command !== undefined) {
          nativeArgs = {
            command: normalizedArgs.command,
            args: normalizedArgs.args,
          };
        }
        break;

      case "grep":
        if (
          normalizedArgs.path !== undefined ||
          normalizedArgs.query !== undefined ||
          normalizedArgs.pattern !== undefined ||
          normalizedArgs.regex !== undefined
        ) {
          nativeArgs = {
            path: normalizedArgs.path,
            query:
              normalizedArgs.query ||
              normalizedArgs.pattern ||
              normalizedArgs.regex,
            file_pattern: normalizedArgs.file_pattern,
            context_lines: normalizedArgs.context_lines,
            literal: normalizedArgs.literal,
            include: normalizedArgs.include,
            include_all: normalizedArgs.include_all,
            exclude: normalizedArgs.exclude,
            whole_word: normalizedArgs.whole_word,
            case_sensitive: normalizedArgs.case_sensitive,
          };
        }
        break;

      case "glob":
        if (
          normalizedArgs.pattern !== undefined ||
          normalizedArgs.query !== undefined ||
          normalizedArgs.extension !== undefined ||
          normalizedArgs.path !== undefined
        ) {
          nativeArgs = {
            path: normalizedArgs.path,
            pattern: normalizedArgs.pattern || normalizedArgs.query,
            extension: normalizedArgs.extension,
            case_insensitive: normalizedArgs.case_insensitive,
          };
        }
        break;

      case "list":
        if (
          normalizedArgs.path !== undefined ||
          normalizedArgs.recursive !== undefined
        ) {
          nativeArgs = {
            path: normalizedArgs.path,
            recursive: normalizedArgs.recursive,
          };
        }
        break;

      case "switch_mode":
        if (
          normalizedArgs.mode_slug !== undefined ||
          normalizedArgs.reason !== undefined
        ) {
          nativeArgs = {
            mode_slug: normalizedArgs.mode_slug,
            reason: normalizedArgs.reason,
          };
        }
        break;

      case "todo":
        if (normalizedArgs.todos !== undefined) {
          nativeArgs = {
            todos: normalizedArgs.todos,
          };
        }
        break;

      case "use_mcp_tool":
        if (
          normalizedArgs.server_name !== undefined ||
          normalizedArgs.tool_name !== undefined
        ) {
          nativeArgs = {
            server_name: normalizedArgs.server_name,
            tool_name: normalizedArgs.tool_name,
            arguments: normalizedArgs.arguments,
          };
        }
        break;

      case "access_mcp_resource":
        if (
          partialArgs.server_name !== undefined ||
          partialArgs.uri !== undefined
        ) {
          nativeArgs = {
            server_name: partialArgs.server_name,
            uri: partialArgs.uri,
          };
        }
        break;

      case "edit":
        nativeArgs = this.normalizeNativeEditArgs(partialArgs, true);
        break;

      default:
        break;
    }

    if (name === "edit" && !nativeArgs) {
      return null;
    }

    const result: ToolUse = {
      type: "tool_use" as const,
      name,
      params,
      partial,
      nativeArgs,
    };

    // Preserve original name for API history when an alias was used
    if (originalName) {
      result.originalName = originalName;
    }

    return result;
  }

  /**
   * Convert a native tool call chunk to a ToolUse object.
   *
   * @param toolCall - The native tool call from the API stream
   * @returns A properly typed ToolUse object
   */
  public static parseToolCall<TName extends ToolName>(toolCall: {
    id: string;
    name: TName;
    arguments: string;
  }): ToolUse<TName> | McpToolUse | null {
    // Check if this is a dynamic MCP tool (mcp--serverName--toolName)
    const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR;
    if (
      typeof toolCall.name === "string" &&
      toolCall.name.startsWith(mcpPrefix)
    ) {
      return this.parseDynamicMcpTool(toolCall);
    }
    // Resolve tool alias to canonical name (e.g., "edit_file" -> "apply_diff", "temp_edit_file" -> "search_and_replace")
    const resolvedName = resolveToolAlias(toolCall.name as string) as TName;
    const isGroupedBatchTool = this.isGroupedBatchToolName(
      resolvedName as string,
    );

    // Validate tool name (after alias resolution)
    if (!isGroupedBatchTool && !toolNames.includes(resolvedName as ToolName)) {
      console.error(
        `Invalid tool name: ${toolCall.name} (resolved: ${resolvedName})`,
      );
      console.error(`Valid tool names:`, toolNames);
      return null;
    }

    // Some providers emit zero-arg native list calls with an empty arguments string
    // instead of "{}", which should still execute as "list cwd".
    if (
      resolvedName === "list" &&
      (toolCall.arguments ?? "").trim().length === 0
    ) {
      return this.parseFromArgs<TName>(toolCall, {}, resolvedName);
    }

    try {
      // Parse the arguments JSON string
      const parsedArgs = JSON.parse(toolCall.arguments);
      const unwrapped = this.unwrapToolArgumentEnvelope(
        parsedArgs,
        resolvedName as string,
      );
      const args = unwrapped?.args ?? parsedArgs;
      const effectiveResolvedName = (unwrapped?.resolvedName ?? resolvedName) as TName;

      const groupedDslName =
        this.isGroupedBatchToolName(effectiveResolvedName as string)
          ? effectiveResolvedName
          : (
              Object.prototype.hasOwnProperty.call(args, "tools") ||
              (Object.prototype.hasOwnProperty.call(args, "calls") &&
                !Object.prototype.hasOwnProperty.call(args, "commands"))
                ? "tool"
                : "execute"
            ) as TName;

      if (this.isExecutePayload(args) && effectiveResolvedName !== groupedDslName) {
        const result = this.parseFromArgs<any>(
          {
            ...toolCall,
            name: groupedDslName,
          },
          args,
          groupedDslName as any,
        );
        if (
          result &&
          result.type === "tool_use" &&
          (
            this.shouldPreserveOriginalGroupedHistoryInput(result.nativeArgs) ||
            this.shouldPreserveGroupedHistoryInputForHistory(
              groupedDslName as string,
              args,
            )
          )
        ) {
          result.historyInput = (
            this.shouldPreserveGroupedHistoryInputForHistory(
              groupedDslName as string,
              args,
            )
              ? args
              : parsedArgs
          ) as Record<string, unknown>;
        }
        return result;
      }
      const result = this.parseFromArgs<TName>(
        toolCall,
        args,
        effectiveResolvedName,
      );
      if (
        result &&
        result.type === "tool_use" &&
        (
          (
            this.isGroupedBatchToolName(effectiveResolvedName as string) &&
            this.shouldPreserveOriginalGroupedHistoryInput(result.nativeArgs)
          ) ||
          this.shouldPreserveGroupedHistoryInputForHistory(
            effectiveResolvedName as string,
            args,
          )
        )
      ) {
        result.historyInput = (
          this.shouldPreserveGroupedHistoryInputForHistory(
            effectiveResolvedName as string,
            args,
          )
            ? args
            : parsedArgs
        ) as Record<string, unknown>;
      }
      return result;
    } catch {
      // FALLBACK: Hybrid Protocol Recovery (The "Annoying Ass Issue" Fix)

      // 1. XML Recovery Path
      if (toolCall.arguments.trim().startsWith("<")) {
        const args = this.extractArgumentsFromTags(toolCall.arguments);
        if (Object.keys(args).length > 0) {
          return this.parseFromArgs<TName>(toolCall, args, resolvedName);
        }
      }

      // 2. Unified Protocol Recovery Path
      // This handles the finalization of tools that used raw Unified text instead of JSON
      // Strip thinking blocks and handle potential backticks
      const recoveryText = toolCall.arguments
        .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
        .trim();
      const unifiedMatch = recoveryText.match(
        /^(?:`{1,3}(?:\w+)?\r?\n)?\s*\(?(\w+)\b;?([^ \n\r)]*)/,
      );
      if (unifiedMatch) {
        const shortName = unifiedMatch[1];
        const argsPart = unifiedMatch[2];
        const params: any = {};
        if (shortName === "edit") {
          const parts = argsPart.split(" ").filter(Boolean);
          params.path = parts[0];
        } else if (shortName === "read" || shortName === "write") {
          params.path = argsPart;
        }

        const editsMatch = toolCall.arguments.match(
          /(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*?)(?=\r?\n(?:Old|SEARCH)|\r?\n\(done\)|$)/gi,
        );
        const nativeArgs: any = { ...params };

        // Handle 'write' content extraction
        if (shortName === "write") {
          const contentStart = toolCall.arguments.indexOf(")") + 1;
          if (contentStart > 0) {
            let content = toolCall.arguments.slice(contentStart).trim();
            // Strip leading/trailing code blocks if present
            const mdMatch = content.match(/```(?:\w+)?\r?\n([\s\S]*?)```/);
            if (mdMatch) content = mdMatch[1].trim();
            nativeArgs.content = content;
          }
        }

        if (editsMatch) {
          nativeArgs.edits = editsMatch
            .map((m) => {
              const innerMatched = m.match(
                /(?:Old|SEARCH)[\t ]*:?[\t ]*\r?\n([\s\S]*?)\r?\n(?:New|REPLACE)[\t ]*:?[\t ]*\r?\n([\s\S]*)/i,
              );
              if (!innerMatched) return null;

              const clean = (t: string) => {
                let text = t.trim();
                const mdMatch = text.match(/```(?:\w+)?\r?\n([\s\S]*?)```/);
                if (mdMatch) return mdMatch[1].trim();
                if (text.startsWith("```")) {
                  const nl = text.indexOf("\n");
                  text = nl !== -1 ? text.slice(nl + 1) : text.slice(3);
                  if (text.endsWith("```")) text = text.slice(0, -3);
                  text = text.trim();
                }
                return text.trim();
              };

              return {
                oldText: clean(innerMatched[1]),
                newText: clean(innerMatched[2]),
              };
            })
            .filter(Boolean);
        }

        return {
          type: "tool_use",
          id: toolCall.id,
          name: resolvedName as any,
          params: params,
          nativeArgs: nativeArgs,
          partial: false,
        } as any;
      }
      return null;
    }
  }

  private static parseFromArgs<TName extends ToolName>(
    toolCall: any,
    args: any,
    resolvedName: TName,
  ): ToolUse<TName> | McpToolUse | null {
    try {
      const normalizedArgs = this.normalizeArgsForTool(args, resolvedName);

      // Native execution path uses nativeArgs instead, which has proper typing.
      const params: Partial<Record<ToolParamName, string>> = {};

      for (const [key, value] of Object.entries(normalizedArgs)) {
        if (this.IGNORED_META_ARGUMENT_KEYS.has(key)) {
          continue;
        }

        // Skip complex parameters that have been migrated to nativeArgs.
        // For read, the 'files' parameter is a FileEntry[] array that can't be
        // meaningfully stringified. The properly typed data is in nativeArgs instead.
        if (resolvedName === "read" && key === "files") {
          continue;
        }

        // Validate parameter name
        if (!toolParamNames.includes(key as ToolParamName)) {
          console.warn(`Unknown parameter '${key}' for tool '${resolvedName}'`);
          console.warn(`Valid param names:`, toolParamNames);
          continue;
        }

        // Convert to string for legacy params format
        const stringValue =
          typeof value === "string" ? value : JSON.stringify(value);
        params[key as ToolParamName] = stringValue;
      }

      // Build typed nativeArgs for tools that support it.
      // This switch statement serves two purposes:
      // 1. Validation: Ensures required parameters are present before constructing nativeArgs
      // 2. Transformation: Converts raw JSON to properly typed structures
      //
      // Each case validates the minimum required parameters and constructs a properly typed
      // nativeArgs object. If validation fails, nativeArgs remains undefined and the tool
      // will fall back to legacy parameter parsing if supported.
      let nativeArgs: NativeArgsFor<TName> | undefined = undefined;
      if (this.isGroupedBatchToolName(resolvedName as string)) {
        nativeArgs = this.groupedActionsToBatchCalls(
          resolvedName as GroupedBatchToolName,
          normalizedArgs,
        ) as NativeArgsFor<TName> | undefined;
      } else
        switch (resolvedName) {
          case "read":
            if (normalizedArgs.files && Array.isArray(normalizedArgs.files)) {
              nativeArgs = {
                files: this.convertFileEntries(normalizedArgs.files),
              } as NativeArgsFor<TName>;
            } else if (normalizedArgs.path) {
              // Support top-level single file read for convenience
              const entry: FileEntry = this.convertFileEntries([
                normalizedArgs.path,
              ])[0];
              if (
                normalizedArgs.line_ranges &&
                Array.isArray(normalizedArgs.line_ranges)
              ) {
                entry.lineRanges = this.convertFileEntries([
                  { path: entry.path, line_ranges: normalizedArgs.line_ranges },
                ])[0].lineRanges;
              } else if (
                normalizedArgs.start_line !== undefined &&
                normalizedArgs.end_line !== undefined
              ) {
                const start = Number(normalizedArgs.start_line);
                const end = Number(normalizedArgs.end_line);
                if (!isNaN(start) && !isNaN(end)) {
                  entry.lineRanges = [{ start, end }];
                }
              }
              nativeArgs = { files: [entry] } as NativeArgsFor<TName>;
            }
            break;

          case "attempt_completion":
            if (normalizedArgs.result) {
              nativeArgs = {
                result: normalizedArgs.result,
              } as NativeArgsFor<TName>;
            }
            break;

          case "bash":
            if (normalizedArgs.command) {
              nativeArgs = {
                command: normalizedArgs.command,
                cwd: normalizedArgs.cwd,
              } as NativeArgsFor<TName>;
            }
            break;

          case "batch": {
            const rawCalls = normalizedArgs.calls ?? normalizedArgs.tools;
            if (Array.isArray(rawCalls)) {
              nativeArgs = {
                calls: rawCalls.map((call: any) => ({
                  name: String(call?.name ?? ""),
                  arguments:
                    call &&
                    typeof call.arguments === "object" &&
                    call.arguments !== null &&
                    !Array.isArray(call.arguments)
                      ? call.arguments
                      : {},
                })),
              } as NativeArgsFor<TName>;
            }
            break;
          }

          // kade_change start
          case "edit":
            nativeArgs = this.normalizeNativeEditArgs(normalizedArgs) as
              | NativeArgsFor<TName>
              | undefined;
            break;
          case "condense":
          case "edit_file":
          case "delete_file":
          case "new_rule":
          case "report_bug":
            break;
          // kade_change end

          case "browser_action":
            if (normalizedArgs.action !== undefined) {
              nativeArgs = {
                action: normalizedArgs.action,
                url: normalizedArgs.url,
                coordinate: normalizedArgs.coordinate,
                size: normalizedArgs.size,
                text: normalizedArgs.text,
                path: normalizedArgs.path,
              } as NativeArgsFor<TName>;
            }
            break;

          case "computer_action":
            if (normalizedArgs.action !== undefined) {
              nativeArgs = {
                action: normalizedArgs.action,
                coordinate: normalizedArgs.coordinate,
                text: normalizedArgs.text,
              } as NativeArgsFor<TName>;
            }
            break;

          case "ask":
            if (normalizedArgs.query !== undefined) {
              nativeArgs = {
                query: normalizedArgs.query,
                path: normalizedArgs.path,
              } as NativeArgsFor<TName>;
            }
            break;

          case "web":
            if (normalizedArgs.query !== undefined) {
              nativeArgs = {
                query: normalizedArgs.query,
                allowed_domains: normalizedArgs.allowed_domains,
                blocked_domains: normalizedArgs.blocked_domains,
              } as NativeArgsFor<TName>;
            }
            break;

          case "fetch":
            if (normalizedArgs.url !== undefined) {
              nativeArgs = {
                url: normalizedArgs.url,
                include_links: normalizedArgs.include_links,
              } as NativeArgsFor<TName>;
            }
            break;

          case "agent":
            if (normalizedArgs.prompt !== undefined) {
              nativeArgs = {
                prompt: normalizedArgs.prompt,
                mode: normalizedArgs.mode,
                api_provider: normalizedArgs.api_provider,
                model_id: normalizedArgs.model_id,
              } as NativeArgsFor<TName>;
            }
            break;

          case "fetch_instructions":
            if (normalizedArgs.task !== undefined) {
              nativeArgs = {
                task: normalizedArgs.task,
              } as NativeArgsFor<TName>;
            }
            break;

          case "generate_image":
            if (
              normalizedArgs.prompt !== undefined &&
              normalizedArgs.path !== undefined
            ) {
              nativeArgs = {
                prompt: normalizedArgs.prompt,
                path: normalizedArgs.path,
                image: normalizedArgs.image,
              } as NativeArgsFor<TName>;
            }
            break;

          case "run_slash_command":
            if (normalizedArgs.command !== undefined) {
              nativeArgs = {
                command: normalizedArgs.command,
                args: normalizedArgs.args,
              } as NativeArgsFor<TName>;
            }
            break;

          case "grep":
            if (
              normalizedArgs.query !== undefined ||
              normalizedArgs.pattern !== undefined ||
              normalizedArgs.regex !== undefined
            ) {
              nativeArgs = {
                path: normalizedArgs.path,
                query:
                  normalizedArgs.query ||
                  normalizedArgs.pattern ||
                  normalizedArgs.regex,
                file_pattern: normalizedArgs.file_pattern,
                context_lines: normalizedArgs.context_lines,
                literal: normalizedArgs.literal,
                include: normalizedArgs.include,
                include_all: normalizedArgs.include_all,
                exclude: normalizedArgs.exclude,
                whole_word: normalizedArgs.whole_word,
                case_sensitive: normalizedArgs.case_sensitive,
              } as NativeArgsFor<TName>;
            }
            break;

          case "glob":
            if (
              normalizedArgs.pattern !== undefined ||
              normalizedArgs.query !== undefined ||
              normalizedArgs.extension !== undefined ||
              normalizedArgs.path !== undefined
            ) {
              nativeArgs = {
                path: normalizedArgs.path,
                pattern: normalizedArgs.pattern || normalizedArgs.query,
                extension: normalizedArgs.extension,
                case_insensitive: normalizedArgs.case_insensitive,
              } as NativeArgsFor<TName>;
            }
            break;

          case "list":
            if (
              normalizedArgs.path !== undefined ||
              normalizedArgs.recursive !== undefined
            ) {
              nativeArgs = {
                path: normalizedArgs.path,
                recursive: normalizedArgs.recursive,
              } as NativeArgsFor<TName>;
            }
            break;

          case "switch_mode":
            if (
              normalizedArgs.mode_slug !== undefined &&
              normalizedArgs.reason !== undefined
            ) {
              nativeArgs = {
                mode_slug: normalizedArgs.mode_slug,
                reason: normalizedArgs.reason,
              } as NativeArgsFor<TName>;
            }
            break;

          case "todo":
            if (normalizedArgs.todos !== undefined) {
              nativeArgs = {
                todos: normalizedArgs.todos,
              } as NativeArgsFor<TName>;
            }
            break;

          case "write":
            if (
              normalizedArgs.path !== undefined &&
              normalizedArgs.content !== undefined
            ) {
              nativeArgs = {
                path: normalizedArgs.path,
                content: normalizedArgs.content,
              } as NativeArgsFor<TName>;
            }
            break;

          case "use_mcp_tool":
            if (
              normalizedArgs.server_name !== undefined &&
              normalizedArgs.tool_name !== undefined
            ) {
              nativeArgs = {
                server_name: normalizedArgs.server_name,
                tool_name: normalizedArgs.tool_name,
                arguments: normalizedArgs.arguments,
              } as NativeArgsFor<TName>;
            }
            break;

          case "access_mcp_resource":
            if (
              normalizedArgs.server_name !== undefined &&
              normalizedArgs.uri !== undefined
            ) {
              nativeArgs = {
                server_name: normalizedArgs.server_name,
                uri: normalizedArgs.uri,
              } as NativeArgsFor<TName>;
            }
            break;

          default:
            break;
        }

      if (resolvedName === "edit" && !nativeArgs) {
        return null;
      }
      const result: ToolUse<TName> = {
        type: "tool_use" as const,
        name: (this.isGroupedBatchToolName(resolvedName as string)
          ? "batch"
          : resolvedName) as TName,
        params,
        partial: false, // Native tool calls are always complete when yielded
        nativeArgs,
      };

      // Preserve original name for API history when an alias was used or when a grouped batching tool maps to batch execution
      if (
        toolCall.name !== resolvedName ||
        this.isGroupedBatchToolName(resolvedName as string)
      ) {
        result.originalName = toolCall.name;
      }

      return result;
    } catch (error: any) {
      console.error(
        `Failed to parse tool call arguments: ${error instanceof Error ? error.message : String(error)}`,
      );

      console.error(`Tool call: ${JSON.stringify(toolCall, null, 2)}`);
      return null;
    }
  }

  /**
   * Parse dynamic MCP tools (named mcp--serverName--toolName).
   * These are generated dynamically by getMcpServerTools() and are returned
   * as McpToolUse objects that preserve the original tool name.
   *
   * In native mode, MCP tools are NOT converted to use_mcp_tool - they keep
   * their original name so it appears correctly in API conversation history.
   * The use_mcp_tool wrapper is only used in XML mode.
   */
  public static parseDynamicMcpTool(toolCall: {
    id: string;
    name: string;
    arguments: string;
  }): McpToolUse | null {
    try {
      // Parse the arguments - these are the actual tool arguments passed directly
      const args = JSON.parse(toolCall.arguments || "{}");

      // Extract server_name and tool_name from the tool name itself
      // Format: mcp--serverName--toolName (using -- separator)
      const parsed = parseMcpToolName(toolCall.name);
      if (!parsed) {
        console.error(`Invalid dynamic MCP tool name format: ${toolCall.name}`);
        return null;
      }

      const { serverName, toolName } = parsed;

      const result: McpToolUse = {
        type: "mcp_tool_use" as const,
        id: toolCall.id,
        // Keep the original tool name (e.g., "mcp--serverName--toolName") for API history
        name: toolCall.name,
        serverName,
        toolName,
        arguments: args,
        partial: false,
      };

      return result;
    } catch (error) {
      console.error(`Failed to parse dynamic MCP tool:`, error);
      return null;
    }
  }
}
