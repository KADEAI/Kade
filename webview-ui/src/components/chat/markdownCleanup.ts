const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createFenceBlockRegex = (languages: readonly string[], flags = "g") =>
  new RegExp(
    `(?:^|\\n)\`\`\`(?:${languages.map(escapeRegex).join("|")})(?=[ \\t\\r\\n]|$)[\\s\\S]*?\`\`\``,
    flags,
  );

const GENERIC_PROTOCOL_FENCE_LANGUAGES = ["tool", "cmd"] as const;

const CHAT_TOOL_FENCE_LANGUAGES = [
  "read",
  "edit",
  "write",
  "ls",
  "glob",
  "grep",
  "search",

  "done",
  "web",
  "research",
  "fetch",
  "browse",
  "click",
  "type",
  "scroll",
  "image",
  "ask",
  "edit_file",
  "new_rule",
  "report_bug",
  "agent",
  "condense",
  "sub",
  "diff",
  "delete",
  "delete_file",
  "fast_context",
  "context",
  "mv",
  "move",
  "rename",
  "browser_action",
  "browser",
  "semgrep",
  "wrap",
  "mkdir",
  "find",
] as const;

const GENERIC_PROTOCOL_FENCE_BLOCK_REGEX = createFenceBlockRegex(
  GENERIC_PROTOCOL_FENCE_LANGUAGES,
);

const CHAT_TOOL_FENCE_BLOCK_REGEX = createFenceBlockRegex(
  CHAT_TOOL_FENCE_LANGUAGES,
);

const TOOL_TAG_REGEX =
  /<(?:tool|cmd|cmd_execution|todo|todo)[\s\S]*?<\/(?:tool|cmd|cmd_execution|todo|todo)>/g;
const COMMAND_RESULT_REGEX =
  /\[(?:bash|read|edit|write|grep|glob|ls) for[\s\S]*?\] Result:/g;
const COMMAND_OUTPUT_REGEX = /Command:\s*[\s\S]*?\nOutput:[\s\S]*/i;
const MCP_TOOL_PAYLOAD_REGEX =
  /\{"type"\s*:\s*"use_mcp_tool"[\s\S]*?\}\s*"?\}?/g;

export const stripSharedProtocolMarkdown = (markdown: string) =>
  markdown
    .replace(GENERIC_PROTOCOL_FENCE_BLOCK_REGEX, "")
    .replace(TOOL_TAG_REGEX, "")
    .replace(COMMAND_RESULT_REGEX, "")
    .replace(COMMAND_OUTPUT_REGEX, "")
    .replace(MCP_TOOL_PAYLOAD_REGEX, "");

export const stripChatToolFenceBlocks = (markdown: string) =>
  markdown.replace(CHAT_TOOL_FENCE_BLOCK_REGEX, "");
