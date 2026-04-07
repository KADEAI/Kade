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

  let batchingRule = "You may emit multiple tool calls in one response.";
  if (disableBatchToolUse) {
    batchingRule = "You may emit exactly one tool call per response.";
  } else if (maxToolCalls && maxToolCalls > 1) {
    batchingRule = `You may emit at most ${maxToolCalls} tool calls per response.`;
  }

  const enabledTopLevelTools = [
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

  const inlineExamples = [
    '@read: "src/app.ts:40-60,80-90,T20"',
    '@grep: "authservice|pizza|text" "src"',
    '@find: "package.json|tsconfig.json" "src"',
    '@list: "src/components"',
    '@bash: "npm run build" "apps/web"',
    '@web: "python apps"',
    '@fetch: "https://example.com"',
    ...(isIndexingEnabled ? ['@ask: "auth flow entrypoint"'] : []),
    ...(isSubAgentEnabled ? ['@agent: "analyze the current project structure"'] : []),
  ].join("\n");

  const todoExample = isTodoEnabled
    ? `
@todo: "Implementation"
[ ] Analyze requirements
[-] Update parser
[x] Add tests`
    : "";

  const askSection = isIndexingEnabled
    ? `ask
  form: @ask: "query"
  use: semantic code search`
    : "";

  const agentSection = isSubAgentEnabled
    ? `agent
  form: @agent: "prompt"
  use: delegate a focused task to a sub-agent`
    : "";

  const todoSection = isTodoEnabled
    ? `todo
  form: @todo: "optional title"
  body: markdown-style checklist
  states: [ ] pending, [-] in progress, [x] done
  note: may be inline or block; prefer block when replacing the full list

${todoExample}`
    : "";

  const browserNote = isBrowserEnabled
    ? `browser
  note: browser/computer-use actions are outside this DSL; use their separate protocol`
    : "";

  return joinSections(
    `UNIFIED DSL
This is a visible text language for tool use.

Session
  tools: ${enabledTopLevelTools}
  quotes: use plain "
  paths: relative unless explicitly absolute
  batching: ${batchingRule}

Mode
  prose mode = normal reply, no tools
  tool mode = only tool calls, no prose
  tool mode begins when the first non-whitespace line starts with @name:
  a bare mention like @read or @bash is just text, not a tool call`,
    `Grammar
  tool       := header inline-args? | block-tool
  header     := @name:
  inline     := @name: "arg"
  inline+path:= @name: "arg" "path"
  top-level  := a line that starts at column 1 with @name:
  boundary   := a new top-level tool line closes the previous block

Validity
  only these top-level names are valid: ${enabledTopLevelTools}
  do not invent syntax outside this schema
  in tool mode, do not place prose before, between, or after tools
  when finished, stop using tools and return to prose mode`,
    `Core forms
  @read: "path optional ranges"
  @grep: "query" "optional path"
  @find: "query" "optional path"
  @list: "path"
  @bash: "query" "optional path"
  @web: "query"
  @fetch: "url"${isIndexingEnabled ? `\n  @ask: "query"` : ""}${isSubAgentEnabled ? `\n  @agent: "prompt"` : ""}
  @edit: "path"
  @write: "path"${isTodoEnabled ? `\n  @todo: "optional title"` : ""}`,
    `read
  one read line = one file
  ranges:
    1-10
    40-60,80-90
    L40-L60,L80-L90
    H10
    T20
  example:
    @read: "game.py 40-60,80-90,T20"`,
    `edit
  purpose: literal replacement in one file
  shape:
    @edit: "path"
    oldText:
    ...
    newText:
    ...
  optional line hint:
    oldText 12-16:
  repeat oldText/newText pairs for multiple edits in the same file
  old text must match literally
  read before edit unless the exact text is already in the latest tool results

  example:
  @edit: "game.py"
  oldText 1-1:
  print("hello")
  newText:
  print("goodbye")

  oldText:2-5:
  Pizza
  Pineapples
  newText:
  strawberries
  Bananas`,
    `write
  purpose: full file content for one file
  shape:
    @write: "path"
    <entire file body>
  body continues until the next top-level tool or end of response

  example:
  @write: "notes.txt"
  build passed`,
    `Execution pattern
  map    -> @list or @find
  search -> @grep${isIndexingEnabled ? " or @ask" : ""}
  read   -> @read (prefer specific line ranges over full file reads)
  change -> @edit or @write

Batching
  you can batch call as many tools as you want in one turn
  do not batch a call that depends on another call's result
  do not batch speculative edits with discovery`,
    `Examples
${inlineExamples}${isTodoEnabled ? `\n${todoExample}` : ""}`,
    `Tool registry
read
  form: @read: "path:optional ranges"
  use: read one file per line

grep
  form: @grep: "query" "optional path"
  use: text search
  note: use | to express multiple queries

find
  form: @find: "query" "optional path"
  use: find files or patterns
  note: use | to express multiple names or patterns

list
  form: @list: "path"
  use: list a directory

bash
  form: @bash: "command" "optional path"
  use: run a shell command

web
  form: @web: "query"
  use: web search

fetch
  form: @fetch: "url"
  use: fetch a URL as content

edit
  form: @edit: "path"
  use: literal oldText/newText replacement block

write
  form: @write: "path"
  use: full file content block`,
    askSection,
    agentSection,
    todoSection,
    browserNote,
    mcpToolsSection || "",
  );
}

export const UNIFIED_TOOLS_PROMPT = getUnifiedToolsPrompt(
  false,
  false,
  true,
  true,
);
