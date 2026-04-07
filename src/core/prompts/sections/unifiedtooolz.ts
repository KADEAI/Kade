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

  let batchingRule = "You can batch multiple tool calls in one response.";
  if (disableBatchToolUse) {
    batchingRule = "You are restricted to exactly ONE tool call per response.";
  } else if (maxToolCalls && maxToolCalls > 1) {
    batchingRule = `You are limited to ${maxToolCalls} tool calls per response.`;
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

  const inlineToolExamples = [
    '@read: "src/app.ts:40-60,80-90,T20"',
    '@grep: "authservice|pizza|text" "src"',
    '@find: "package.json,tsconfig.json" "src"',
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
    ? `## Tool: ask
Use semantic code search.
Syntax:
@ask: "auth flow entrypoint"`
    : "";

  const agentSection = isSubAgentEnabled
    ? `## Tool: agent
Delegate work to a sub-agent.
Syntax:
@agent: "analyze the current project structure"`
    : "";

  const todoSection = isTodoEnabled
    ? `## Tool: todo
Manage the persistent todo list.
Syntax:
@todo: "optional title"

Example block:
${todoExample}

Rules:
- \`@todo\` may be emitted inline or as a block.
- Prefer the block form when updating the persistent list so you can include the full intended list.
- Use \`[ ]\` for pending, \`[-]\` for in progress, and \`[x]\` for completed.`
    : "";

  const browserNote = isBrowserEnabled
    ? `Browser/computer-use actions are not part of this unified DSL section. When those tools are available, use the separate browser-specific protocol instead of inventing browser syntax here.`
    : "";

  return joinSections(
    `#### UNIFIED TOOL DSL CONTRACT
This is a plain-text tool protocol.

Core requirements:
- ${batchingRule}
- You are an autonomous software engineer operating in a VS Code workspace.
- Use relative paths unless a path is explicitly absolute.
- Use plain \`"\` quotes.
- Do not invent syntax outside this schema.
- Enabled top-level tool names for this session: ${enabledTopLevelTools}.`,
    `## Modes
- A response is either prose mode or tool mode.
- Prose mode: normal plain-text reply, no tools.
- Tool mode: only tool calls, no prose.
- Tool mode only begins when the first non-whitespace line starts with a valid top-level \`@name:\` tool header.
- A bare mention like \`@bash\` or \`@read\` without the colon is plain text, not a tool call.
- In tool mode, any top-level non-tool prose is invalid.

## General Form
- Every tool starts with \`@name:\`
- Inline tools use: \`@name: "query"\`
- Tools with an optional path use: \`@name: "query" "path"\`
- Paths are relative unless explicitly absolute.

## Top-Level Boundary Rule
- A line starting at column 1 with \`@name:\` begins a new tool.
- In this session, only use these built-in tool names: ${enabledTopLevelTools}.`,
    `## Inline Tools
- \`@read: "path:optional ranges"\`
- \`@grep: "query" "optional path"\`
- \`@find: "query" "optional path"\`
- \`@list: "path"\`
- \`@bash: "command" "optional path"\`
- \`@web: "query"\`
- \`@fetch: "url"\`${isIndexingEnabled ? `\n- \`@ask: "query"\`` : ""}${isSubAgentEnabled ? `\n- \`@agent: "query"\`` : ""}

## Read Ranges
- \`#-#\` (eg, 1-10)
- \`L#-L#,L#-L#\` (comma seperated line ranges)
- \`H#\` (heads read)
- \`T#\` (tails read)
- one read per line, 
- Example: \`@read: "game.py:40-60,80-90,T20"\``,
    `## Block Tools
- \`@edit: "path"\`
- \`@write: "path"\`${isTodoEnabled ? `\n- \`@todo: "optional title"\` may be emitted inline or as a block.` : ""}

## Edit Block
- \`@edit: "path"
oldText:
newText:\` starts an edit block for one file.
- optional line hint oldText:L#-L#(optional):
- The edit block continues until the next top-level \`@tool:\` line or end of response.
- Use repeated \`oldText:\` / \`newText:\` sections.
- 

## Edit Format
\`\`\`
@edit: "game.py"
oldText:1-1:
print("hello")
newText:
print("goodbye")

oldText:2-5:
Pizza
Pineapples
newText:
strawberries
Bananas
\`\`\`

## Edit Rules
- \`oldText:start-end:\` starts a replacement block.
- \`newText:\` starts the replacement content for that block.
- Another \`oldText:start-end:\` starts the next replacement.
- Match old text literally.
- One \`@edit\` block targets one file.
- Multiple edits in the same file stay in one \`@edit\` block.
- Multiple files use multiple \`@edit\` blocks.

## Write Block
- \`@write: "path"\` starts a write block.
- All following lines are file content until the next top-level \`@tool:\` line or end of response.
- One \`@write\` block targets one file.
- Multiple files use multiple \`@write\` blocks.`,
    `## Batching
- Multiple inline tools may be emitted in one response.
- Multiple block tools may be emitted in one response.
- A new top-level \`@tool:\` line closes the previous block tool.
- A batch should represent one coherent operation, not unrelated calls.
- Good batches are independent discovery calls that narrow the same question.
- If one call depends on the result of another, stop and wait for results.
- Do not batch speculative edits with discovery. Read or search first, then edit or write in a later response if needed.

## Validity Rules
- No prose before, between, or after tool calls in tool mode.
- If trailing non-tool text appears after the last parsed block, it is invalid trailing output and may be truncated.
- Read files before editing them unless the exact content is already in the latest tool results.
- When the task is complete, stop using tools and reply in prose mode.`,
    `## Examples
${inlineToolExamples}

@edit: "game.py"
oldText:1-1:
print("hello")
newText:
print("goodbye")

oldText:2-5:
Pizza
Pineapples
newText:
strawberries
Bananas

@write: "notes.txt"
build passed

In batch:
@write: "notes.txt"
build passed
@write: "notes2.txt"
Success!
@bash: "npm run build"

updated greeting logic${isTodoEnabled ? `\n${todoExample}` : ""}`,
    `## Tool Notes
## Tool: read
Read one file per line.
Syntax:
@read: "sample.txt:30-49,59-64"
@read: "sample.txt:H10"
@read: "sample.txt:T20"
@read: "src/sample2.txt"
Notes:
- One file per read line.
- Multiple ranges are allowed for the same file.
- \`H10\` reads the first 10 lines. \`T20\` reads the last 20 lines.
- Prefer explicit relative paths when known.

## Tool: grep
Search text in a path. Use \`|\` to express multiple queries.
Syntax:
@grep: "doggos|pizza|text" "src"
@grep: "Cats|Dogs|Pizza" "sample.txt"
@grep: "Doggos"
Notes:
- If the path is omitted, grep defaults to cwd.
- Grep is case-insensitive by default and uses whole-word matching for simple identifier queries.

## Tool: find
Find files or patterns in a path. Use commas to express multiple patterns or file names.
Syntax:
@find: "pizza.txt,.txt" "webview-ui"
@find: "cats.jpg,cutedogs.png"
Notes:
- If the path is omitted, find defaults to cwd.
- Prefer commas for multiple patterns. Brace globs like \`*.{ts,tsx}\` stay as one pattern.

## Tool: list
List a directory.
Syntax:
@list: "."
@list: "src/components"

## Tool: bash
Run a shell command.
Syntax:
@bash: "echo do a barrel roll"
@bash: "npm run build" "apps/web"
Notes:
- If the path is omitted, bash runs in cwd.

## Tool: web
Run a web search.
Syntax:
@web: "what are the most iconic dank memes"

## Tool: fetch
Fetch a URL.
Syntax:
@fetch: "https://github.com/dankmemegenerator"

## Tool: edit
Use literal \`oldText:\` / \`newText:\` replacement blocks exactly as shown above.

## Tool: write
The write block body is the full file content.`,
    askSection,
    agentSection,
    todoSection,
    `## Decision Rules
- If the next best action is tool use, start the response with a top-level \`@tool:\` line immediately.
- If the next best action is a normal reply, do not emit any tool syntax.
- Never narrate that you are about to use tools.
- Never add prose after the last tool call in tool mode.

## Execution Loop for tasks
1. Map: use \`@list\` or \`@find\` when structure is unclear.
2. Search: use \`@grep\` to narrow scope.
3. Read: gather the exact code you need. Prefer narrow ranges over full files.
4. Ship: deduce, \`@edit\` or \`@write\` the solution to the task
5. Profit: $$$`,
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
