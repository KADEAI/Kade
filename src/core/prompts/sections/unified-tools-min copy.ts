import { McpHub } from "../../../services/mcp/McpHub";
import { getMcpToolsForUnified } from "../tools/mcp-tools";

export function getUnifiedToolsPrompt(
  isIndexingEnabled: boolean = false,
  isBrowserEnabled: boolean = false,
  isTodoEnabled: boolean = false,
  isSubAgentEnabled: boolean = false,
  mcpHub?: McpHub,
  disableBatchToolUse: boolean = false,
  maxToolCalls?: number,
): string {
  const joinSections = (...sections: Array<string | undefined>) =>
    sections
      .map((section) => section?.trim())
      .filter((section) => section && section.length > 0)
      .join("\n\n");

  const mcpToolsSection = getMcpToolsForUnified(mcpHub);

  let batchingRule = "multiple tool calls allowed";
  if (disableBatchToolUse) {
    batchingRule = "exactly one tool call per response";
  } else if (maxToolCalls && maxToolCalls > 1) {
    batchingRule = `at most ${maxToolCalls} tool calls per response`;
  }

  const enabledTools = [
    "read",
    "grep",
    "find",
    "list",
    "bash",
    "web",
    "fetch",
    "edit",
    "write",
    ...(isTodoEnabled ? ["todo"] : []),
    ...(isIndexingEnabled ? ["ask"] : []),
    ...(isSubAgentEnabled ? ["agent"] : []),
  ].join(", ");

  const descriptions = [
    "Read: read files. One file per line. Ranges are optional. Use Hn for the first n lines and Tn for the last n lines.",
    "Grep: search text. Use | for multiple queries. Optional path.",
    "Find: find files or patterns. Use | for multiple names or patterns. Optional path.",
    "List: list files in a directory.",
    "Bash: run a shell command. Optional path.",
    "Web: search the web.",
    "Fetch: fetch a URL.",
    ...(isIndexingEnabled ? ["Ask: semantic code search."] : []),
    ...(isSubAgentEnabled ? ["Agent: delegate a focused task to a sub-agent."] : []),
    "Edit: edit files. Multi-block edits are preferred. Partial edits can succeed in multi-block mode when blocks do not overlap.",
    "Write: write a full file.",
    ...(isTodoEnabled
      ? ["Todo: set or replace the todo list with markdown checklist items."]
      : []),
  ].join("\n");

  const syntax = [
    '@read: "path [ranges?]"',
    '@grep: "query[|optional pipes?]" "optional path?"',
    '@find: "query[|optional pipes?]" "optional path?"',
    '@list: "path"',
    '@bash: "command" "optional path?"',
    '@web: "query"',
    '@fetch: "url"',
    ...(isIndexingEnabled ? ['@ask: "query"'] : []),
    ...(isSubAgentEnabled ? ['@agent: "prompt"'] : []),
    '@edit: "path"',
    '@write: "path"',
    ...(isTodoEnabled ? ['@todo: "title?"'] : []),
  ].join("\n");

  const examples = [
    '@read: "src/app.ts"',
    '@read: "src/app.ts 40-60,80-90"',
    '@read: "src/app.ts H20"',
    '@read: "src/app.ts T20"',
    '@grep: "auth|session" "src"',
    '@find: "package.json|tsconfig.json" "src"',
    '@list: "src/components"',
    '@bash: "npm run build" "apps/web"',
    '@web: "python apps"',
    '@fetch: "https://example.com"',
    ...(isIndexingEnabled ? ['@ask: "auth flow entrypoint"'] : []),
    ...(isSubAgentEnabled ? ['@agent: "analyze the current project structure"'] : []),
    `@edit: "src/app.ts"
oldText 12-14:
foo()
newText:
bar()

oldText:
baz()
newText:
qux()`,
    `@write: "notes.txt"
build passed`,
    ...(isTodoEnabled
      ? [
          `@todo: "Implementation"
[ ] Analyze requirements
[-] Update parser
[x] Add tests`,
        ]
      : []),
  ].join("\n\n");

  const browserNote = isBrowserEnabled
    ? "Browser/computer-use actions are outside this DSL."
    : "";

  return joinSections(
    `UNIFIED TOOL DSL

Description:
${descriptions}

Available tools: ${enabledTools}${browserNote ? `\n${browserNote}` : ""}`,
    `Syntax:
${syntax}`,
    `Examples:
${examples}`,
    `Execution:
Use prose when no tools are needed.
Use only tool calls when tools are needed.
Tool lines start at column 1 as @name:
Block tools continue until the next top-level tool line or end of response.
Batching: ${batchingRule}`,
    `Rules:
Only use the tools listed above.
Do not invent syntax.
Do not mix prose with tool calls in the same response.
Read before edit unless the exact target text is already in recent tool results.
Batch independent calls only.
Do not batch dependent calls.
Do not batch speculative edits with discovery.
Stop using tools when the task is complete.`,
    `Flow:
Map -> @list or @find
Search -> @grep${isIndexingEnabled ? " or @ask" : ""}
Read -> @read
Change -> @edit or @write`,
    mcpToolsSection || "",
  );
}

export const UNIFIED_TOOLS_PROMPT = getUnifiedToolsPrompt(
  false,
  false,
  true,
  true,
);
