import { Anthropic } from "@anthropic-ai/sdk";

import type {
  ClineAsk,
  ToolProgressStatus,
  ToolGroup,
  ToolName,
  FileEntry,
  BrowserActionParams,
  GenerateImageParams,
} from "@roo-code/types";

export type { ToolName }; // Re-export ToolName

export type ToolResponse =
  | string
  | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export type AskApproval = (
  type: ClineAsk,
  partialMessage?: string,
  progressStatus?: ToolProgressStatus,
  forceApproval?: boolean,
) => Promise<boolean>;

export type HandleError = (action: string, error: Error) => Promise<void>;

export type PushToolResult = (content: ToolResponse) => void;

export type RemoveClosingTag = (tag: ToolParamName, content?: string) => string;

export type AskFinishSubTaskApproval = () => Promise<boolean>;

export type ToolDescription = () => string;

export interface TextContent {
  type: "text";
  content: string;
  partial: boolean;
}

export const toolParamNames = [
  "command",
  "stdin",
  "execution_id",
  "calls",
  "commands",
  "path",
  "content",
  "write",
  "regex",
  "file_pattern",
  "recursive",
  "action",
  "url",
  "coordinate",
  // Research Web
  "depth",
  "text",
  "server_name",
  "tool_name",
  "arguments",
  "uri",
  "question",
  "result",
  "diff",
  "mode_slug",
  "reason",
  "line",
  "mode",
  "message",
  "cwd",
  "follow_up",
  "task",
  "size",
  "old_string",
  "new_string",
  "use_regex",
  "ignore_case",
  // kade_change start
  "title",
  "description",
  "target_file",
  "instructions",
  "code_edit",

  // kade_change end
  "query",
  "args",
  "start_line",
  "end_line",
  "todos",
  "prompt",
  "image",
  "files", // Native protocol parameter for read
  // kade_change start
  "file_path",
  "edits",
  "diffs",
  // kade_change end
  // kade_change start
  "agent",
  "api_provider",
  "model_id",
  // kade_change end
  "web",
  "fetch",
  "allowed_domains",
  "blocked_domains",
  "pattern",
  "context_lines",
  "literal",
  "old_text",
  "new_text",
  "old_string",
  "new_string",
  "edit",
  "indentation",
  "lineRange",
  "include",
  "include_all",
  "exclude",
  "case_sensitive",
  "whole_word",
  "effect",
  "emotion",
  "gui",
  "color",
  "bg",
  "border",
  "shadow",
  "style",
  "intensity",
  "source",
  "destination",
  "include_links",
  "tools",
] as const;

export type ToolParamName = (typeof toolParamNames)[number];

export type ToolProtocol = "xml" | "native" | "unified";

/**
 * Type map defining the native (typed) argument structure for each tool.
 * Tools not listed here will fall back to `any` for backward compatibility.
 */
export type NativeToolArgs = {
  access_mcp_resource: { server_name: string; uri: string };
  read: { files: FileEntry[] };
  attempt_completion: { result: string; command?: string };
  bash: {
    command?: string;
    cwd?: string;
    stdin?: string;
    execution_id?: string;
  };
  batch: {
    calls: Array<{
      name: string;
      arguments: Record<string, unknown>;
    }>;
    missingParamName?: "calls" | "commands" | "tools" | "content";
    parseError?: string;
    parseErrors?: Array<{
      index: number;
      command: string;
      error: string;
    }>;
  };
  edit: {
    path: string;
    edit:
      | string
      | Array<
          | string
          | {
              oldText?: string;
              newText?: string;
              start_line?: number;
              end_line?: number;
              lineRange?: string;
              range?: unknown;
              type?: "line_deletion" | "search_replace" | string;
              replaceAll?: boolean;
            }
        >;
  };
  browser_action: BrowserActionParams;
  computer_action: {
    action:
      | "key"
      | "type"
      | "mouse_move"
      | "left_click"
      | "left_click_drag"
      | "right_click"
      | "middle_click"
      | "double_click"
      | "scroll"
      | "get_screenshot"
      | "get_cursor_position";
    coordinate?: string;
    text?: string;
  };
  ask: { query: string; path?: string };
  fetch_instructions: { task: string };
  generate_image: GenerateImageParams;
  run_slash_command: { command: string; args?: string };
  list: { path?: string | string[]; recursive?: boolean };
  grep: {
    path?: string | string[];
    query?: string | string[];
    command?: string;
    file_pattern?: string | string[] | null;
    context_lines?: number;
    literal?: boolean;
    include?: string | string[] | null;
    include_all?: boolean;
    exclude?: string | string[] | null;
    whole_word?: boolean;
    case_sensitive?: boolean;
    mode?: "text" | "refs" | "all_refs";
  };
  glob: {
    path?: string | string[];
    pattern?: string | string[];
    extension?: string;
    case_insensitive?: boolean;
  };
  switch_mode: { mode_slug: string; reason: string };
  todo: { todos: string };
  use_mcp_tool: {
    server_name: string;
    tool_name: string;
    arguments?: Record<string, unknown>;
  };
  write: { path: string; content: string };
  // kade_change start
  agent: {
    prompt: string;
    mode?: string;
    api_provider?: string;
    model_id?: string;
  };
  fast_context: { query: string; path?: string };
  // kade_change end
  web: {
    query: string;
    allowed_domains?: string[];
    blocked_domains?: string[];
  };
  fetch: { url: string; include_links?: boolean };
  research_web: { query: string; depth?: number };
  wrap: {
    effect?: string;
    emotion?: string;
    gui?: string;
    color?: string;
    bg?: string;
    border?: string;
    shadow?: string;
    style?: string;
    intensity?: string;
    content?: string;
  };
  mkdir: { path?: string };
  move_file: { source: string; destination: string };

  // Add more tools as they are migrated to native protocol
};

/**
 * Generic ToolUse interface that provides proper typing for both protocols.
 *
 * @template TName - The specific tool name, which determines the nativeArgs type
 */
export interface ToolUse<TName extends ToolName = ToolName> {
  type: "tool_use";
  id?: string; // Optional ID to track tool calls
  name: TName;
  /**
   * The original tool name as called by the model (e.g. an alias like "edit_file"),
   * if it differs from the canonical tool name used for execution.
   * Used to preserve tool names in API conversation history.
   */
  originalName?: string;
  // params is a partial record, allowing only some or none of the possible parameters to be used
  params: Partial<Record<ToolParamName, string>>;
  partial: boolean;
  toolUseId?: string; // kade_change
  /**
   * Optional original argument payload preserved for conversation history when
   * parser normalization would otherwise lose important debugging context.
   */
  historyInput?: Record<string, unknown>;
  // nativeArgs is properly typed based on TName if it's in NativeToolArgs, otherwise never
  nativeArgs?: TName extends keyof NativeToolArgs
    ? NativeToolArgs[TName]
    : never;
}

/**
 * Represents a native MCP tool call from the model.
 * In native mode, MCP tools are called directly with their prefixed name (e.g., "mcp_serverName_toolName")
 * rather than through the use_mcp_tool wrapper. This type preserves the original tool name
 * so it appears correctly in API conversation history.
 */
export interface McpToolUse {
  type: "mcp_tool_use";
  id?: string; // Tool call ID from the API
  /** The original tool name from the API (e.g., "mcp_serverName_toolName") */
  name: string;
  /** Extracted server name from the tool name */
  serverName: string;
  /** Extracted tool name from the tool name */
  toolName: string;
  /** Arguments passed to the MCP tool */
  arguments: Record<string, unknown>;
  partial: boolean;
}

export interface ResearchWebToolUse extends ToolUse<"research_web"> {
  name: "research_web";
  params: Partial<Pick<Record<ToolParamName, string>, "query" | "depth">>;
}

export interface ExecuteCommandToolUse extends ToolUse<"bash"> {
  name: "bash";
  // Pick<Record<ToolParamName, string>, "command"> makes "command" required, but Partial<> makes it optional
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      "command" | "stdin" | "execution_id" | "cwd"
    >
  >;
}

export interface ReadFileToolUse extends ToolUse<"read"> {
  name: "read";
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      "args" | "path" | "start_line" | "end_line" | "files"
    >
  >;
}

export interface FetchInstructionsToolUse
  extends ToolUse<"fetch_instructions"> {
  name: "fetch_instructions";
  params: Partial<Pick<Record<ToolParamName, string>, "task">>;
}

export interface WriteToFileToolUse extends ToolUse<"write"> {
  name: "write";
  params: Partial<Pick<Record<ToolParamName, string>, "path" | "content" | "write">>;
}

// kade_change start
export interface DeleteFileToolUse extends ToolUse {
  name: "delete_file";
  params: Partial<Pick<Record<ToolParamName, string>, "path">>;
}
// kade_change end

export interface CodebaseSearchToolUse extends ToolUse<"ask"> {
  name: "ask";
  params: Partial<Pick<Record<ToolParamName, string>, "query" | "path">>;
}

export interface GrepToolUse extends ToolUse<"grep"> {
  name: "grep";
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      | "path"
      | "query"
      | "command"
      | "file_pattern"
      | "context_lines"
      | "literal"
      | "include"
      | "exclude"
    >
  >;
}

export interface ListDirToolUse extends ToolUse<"list"> {
  name: "list";
  params: Partial<Pick<Record<ToolParamName, string>, "path" | "recursive">>;
}

export interface MkdirToolUse extends ToolUse<"mkdir"> {
  name: "mkdir";
  params: Partial<Pick<Record<ToolParamName, string>, "path">>;
}

export interface GlobToolUse extends ToolUse<"glob"> {
  name: "glob";
  params: Partial<Pick<Record<ToolParamName, string>, "path" | "pattern">>;
}

export interface BrowserActionToolUse extends ToolUse<"browser_action"> {
  name: "browser_action";
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      "action" | "url" | "coordinate" | "text" | "size" | "path"
    >
  >;
}

export interface ComputerActionToolUse extends ToolUse<"computer_action"> {
  name: "computer_action";
  params: Partial<
    Pick<Record<ToolParamName, string>, "action" | "coordinate" | "text">
  >;
}

export interface UseMcpToolToolUse extends ToolUse<"use_mcp_tool"> {
  name: "use_mcp_tool";
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      "server_name" | "tool_name" | "arguments"
    >
  >;
}

export interface AccessMcpResourceToolUse
  extends ToolUse<"access_mcp_resource"> {
  name: "access_mcp_resource";
  params: Partial<Pick<Record<ToolParamName, string>, "server_name" | "uri">>;
}

export interface AttemptCompletionToolUse
  extends ToolUse<"attempt_completion"> {
  name: "attempt_completion";
  params: Partial<Pick<Record<ToolParamName, string>, "result" | "command">>;
}

export interface SwitchModeToolUse extends ToolUse<"switch_mode"> {
  name: "switch_mode";
  params: Partial<Pick<Record<ToolParamName, string>, "mode_slug" | "reason">>;
}

export interface NewTaskToolUse extends ToolUse<"new_task"> {
  name: "new_task";
  params: Partial<
    Pick<Record<ToolParamName, string>, "mode" | "message" | "todos">
  >;
}

export interface RunSlashCommandToolUse extends ToolUse<"run_slash_command"> {
  name: "run_slash_command";
  params: Partial<Pick<Record<ToolParamName, string>, "command" | "args">>;
}

// kade_change start: New Edit Tool
export interface EditToolUse extends ToolUse<"edit"> {
  name: "edit";
  params: Required<Pick<Record<ToolParamName, string>, "path">> & {
    edit: string;
  };
}
// kade_change end
export interface EditFileToolUse extends ToolUse {
  name: "edit_file";
  params: Required<
    Pick<
      Record<ToolParamName, string>,
      "target_file" | "instructions" | "code_edit"
    >
  >;
}
// kade_change end

export interface GenerateImageToolUse extends ToolUse<"generate_image"> {
  name: "generate_image";
  params: Partial<
    Pick<Record<ToolParamName, string>, "prompt" | "path" | "image">
  >;
}

// kade_change start
export interface RunSubAgentToolUse extends ToolUse<"agent"> {
  name: "agent";
  params: Partial<Pick<Record<ToolParamName, string>, "prompt" | "mode">>;
}
// kade_change end

export interface WebSearchToolUse extends ToolUse<"web"> {
  name: "web";
  params: Partial<
    Pick<
      Record<ToolParamName, string>,
      "query" | "allowed_domains" | "blocked_domains"
    >
  >;
}

export interface WebFetchToolUse extends ToolUse<"fetch"> {
  name: "fetch";
  params: Partial<Pick<Record<ToolParamName, string>, "url" | "include_links">>;
}

// Define tool group configuration
export type ToolGroupConfig = {
  tools: readonly string[];
  alwaysAvailable?: boolean; // Whether this group is always available and shouldn't show in prompts view
  customTools?: readonly string[]; // Opt-in only tools - only available when explicitly included via model's includedTools
};

export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
  bash: "run commands",
  batch: "batch tool calls",
  read: "read files",
  fetch_instructions: "fetch instructions",
  write: "write files",
  edit: "edit file",
  // kade_change start
  edit_file: "edit file",
  delete_file: "delete files",
  report_bug: "report bug",
  condense: "condense the current context window",
  mkdir: "create directories",
  move_file: "move files",
  // kade_change end
  grep: "search files",
  glob: "find files by pattern",
  list: "list files",
  browser_action: "use a browser",
  computer_action: "control the desktop",
  use_mcp_tool: "use mcp tools",
  access_mcp_resource: "access mcp resources",
  attempt_completion: "complete tasks",
  switch_mode: "switch modes",
  new_task: "create new task",
  new_rule: "create new rule",
  ask: "codebase search",
  todo: "update todo list",
  run_slash_command: "run slash command",
  generate_image: "generate images",
  // kade_change
  agent: "run sub-agent",
  fast_context: "search codebase context",
  web: "search the web",
  fetch: "fetch web content",
  research_web: "research web",
  wrap: "wrap text/effects",
} as const;

// Define available tool groups.
export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
  read: {
    tools: [
      "workspace",
      "read",
      "fetch_instructions",
      "grep",
      "list",
      "glob",
      "ask",
      "fast_context",
    ],
  },
  edit: {
    tools: [
      "content",
      "edit",
      "edit_file", // kade_change: Morph fast apply
      "write",
      "mkdir",
      "move_file",
      // "delete_file", // kade_change: hidden
      "new_rule", // kade_change
      "generate_image",
    ],
  },
  browser: {
    tools: ["browser_action", "computer_action"],
  },
  command: {
    tools: ["system", "bash", "batch"],
  },
  mcp: {
    tools: ["use_mcp_tool", "access_mcp_resource"],
  },
  modes: {
    tools: ["switch_mode"], // "new_task" hidden
    alwaysAvailable: true,
  },
  external: {
    tools: ["internet", "web", "fetch", "research_web"],
  },
};

// Tools that are always available to all modes.
export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
  // "attempt_completion", // Hidden - not needed for conversational flow
  // "switch_mode", // Hidden - not needed for conversational flow
  // "new_task", // Hidden - not needed for conversational flow
  "report_bug",
  "condense", // kade_change
  "todo",
  "run_slash_command",
  "web",
  "fetch",
  "research_web",
  "fetch",
  "agent",
  "batch",
] as const;

/**
 * Central registry of tool aliases.
 * Maps alias name -> canonical tool name.
 *
 * This allows models to use alternative names for tools (e.g., "write_file" instead of "write").
 * When a model calls a tool by its alias, the system resolves it to the canonical name for execution,
 * but preserves the alias in API conversation history for consistency.
 *
 * To add a new alias, simply add an entry here. No other files need to be modified.
 */
export const TOOL_ALIASES: Record<string, ToolName> = {
  command: "bash",
  shell: "bash",
  run_command: "bash",
  execute_command: "bash",
  terminal: "bash",
  find: "glob",
  find_files: "glob",
  // edit_file: "edit", // Removed - edit_file is now a standalone tool, not an alias
  read_file: "read",
  read_files: "read",
  open_file: "read",
  view_file: "read",
  cat: "read",
  write_file: "write",
  create_file: "write",
  save_file: "write",
  ls: "list",
  dir: "list",
  dirlist: "list",
  list_files: "list",
  list_dir: "list",
  list_directory: "list",
  web_search: "web",
  search_web: "web",
  browse_web: "web",
  open_url: "fetch",
  fetch_url: "fetch",
  visit_url: "fetch",
  subagent: "agent",
  run_sub_agent: "agent",
  todos: "todo",
  checklist: "todo",
  update_todo_list: "todo",
  browser: "browser_action",
  browser_use: "browser_action",
  computer: "computer_action",
  desktop: "computer_action",
  computer_use: "computer_action",
  mcp_resource: "access_mcp_resource",
  read_mcp_resource: "access_mcp_resource",
  create_image: "generate_image",
  image_generation: "generate_image",
} as const;

export type DiffResult =
  | { success: true; content: string; failParts?: DiffResult[] }
  | ({
      success: false;
      error?: string;
      details?: {
        similarity?: number;
        threshold?: number;
        matchedRange?: { start: number; end: number };
        searchContent?: string;
        bestMatch?: string;
      };
      failParts?: DiffResult[];
    } & ({ error: string } | { failParts: DiffResult[] }));

export interface DiffItem {
  content: string;
  startLine?: number;
}

export interface DiffStrategy {
  /**
   * Get the name of this diff strategy for analytics and debugging
   * @returns The name of the diff strategy
   */
  getName(): string;

  /**
   * Get the tool description for this diff strategy
   * @param args The tool arguments including cwd and toolOptions
   * @returns The complete tool description including format requirements and examples
   */
  getToolDescription(args: {
    cwd: string;
    toolOptions?: { [key: string]: string };
  }): string;

  /**
   * Apply a diff to the original content
   * @param originalContent The original file content
   * @param diffContent The diff content in the strategy's format (string for legacy, DiffItem[] for new)
   * @param startLine Optional line number where the search block starts. If not provided, searches the entire file.
   * @param endLine Optional line number where the search block ends. If not provided, searches the entire file.
   * @returns A DiffResult object containing either the successful result or error details
   */
  applyDiff(
    originalContent: string,
    diffContent: string | DiffItem[],
    startLine?: number,
    endLine?: number,
  ): Promise<DiffResult>;

  getProgressStatus?(toolUse: ToolUse, result?: any): ToolProgressStatus;
}
