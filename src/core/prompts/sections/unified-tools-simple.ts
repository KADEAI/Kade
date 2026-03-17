import { McpHub } from "../../../services/mcp/McpHub"
import { getMcpToolsForUnified } from "../tools/mcp-tools"

export function getUnifiedToolsPrompt(
  isIndexingEnabled: boolean = false,
  isBrowserEnabled: boolean = false,
  isTodoEnabled: boolean = false,
  isSubAgentEnabled: boolean = false,
  mcpHub?: McpHub,
  disableBatchToolUse: boolean = false,
  maxToolCalls?: number
): string {
  const mcpToolsSection = getMcpToolsForUnified(mcpHub)

  const askRegistry = isIndexingEnabled ? `Tool: ask
Syntax: <<ask --query query>>
Usage: Semantic search across codebase for logic, components, patterns.
Flags: --query <string>
Note: ${disableBatchToolUse ? 'Primary discovery tool.' : 'Supports multi-query batching. Primary discovery tool.'}` : ""

  const browserRegistry = isBrowserEnabled ? `Tool: browser
Syntax: 
  <<browse --url url>>
  <<click --coordinate x,y>>
  <<type --text text>>
  <<scroll --direction down|up>>
Usage: Virtual browser interaction.
Methods:
  - browse: --url <url>
  - click:  --coordinate <x,y>
  - type:   --text <string>
  - scroll: --direction <up|down>` : ""

  const todoRegistry = isTodoEnabled ? `Tool: todo
Syntax:
  <<todo
  1. task one
  2. task two
  /todo>>
Usage: Manage persistent task list.
Operation:
  - Replace: Full list to initialize/overwrite plan
  - Update: Numbers + status (e.g. "1: completed")
End tag: /todo>>
Note: Use at task start to plan work.` : ""

  const askWorkflow = isIndexingEnabled ? `
1. Discovery & Mapping ("Ask-First" Strategy):
   - Ask First: Use 'ask' tool for feature discovery.${disableBatchToolUse ? '' : '\n   - Batch Queries: Group questions in single \'ask\' calls.'}
   - Global Search: Covers all directories instantly.
   - Targeted Grep: Use 'grep' for exact symbols after finding targets.
` : `
1. Discovery & Mapping:
   - Initial Map: Use 'ls' and 'find' to explore structure.
   - Verification: Confirm structures before reading files.
`

  let batchingRule = `5. Batching Rule: You can batch multiple tool calls to improve efficiency.`
  if (disableBatchToolUse) {
    batchingRule = `5. Batching Rule: You are restricted to ONE tool call per turn.`
  } else if (maxToolCalls && maxToolCalls > 1) {
    batchingRule = `5. Batching Rule: You are limited to ${maxToolCalls} tool calls per turn.`
  }

  const batchingExamples = disableBatchToolUse ? "" : `
#### Good Batching (Discovery)
Group discovery tools for full context before acting.
<<grep --query AuthService --path src/>>
<<find --pattern **/auth/*.ts --path src/>>
<<ls --path src/core/auth>>
<<read --path src/core/auth/AuthService.ts>>

#### Bad Batching (Sequential Dependency)
Avoid chaining dependent actions in same turn.
<<read --path src/logic.ts>>
<<edit --path src/logic.ts ...>>
(Bad: need file content before editing.)`

  return `<tool_protocol>

<tool_introduction>
# Double Angle CLI Flags Protocol
CRITICAL: TEXT-BASED tool calling ONLY.
- Use double-angle tool calls in this exact format: <<tool --flag value>>
- Follow only the schema below. Do not invent tools, flags, or formats.
- Do not use OpenAI native function-calling APIs.
- Tool calls must be visible in chat output (not hidden reasoning).
- In this protocol, visible text tool calls are the function-calling mechanism.
- All tool calls must open and close with double angles. \`edit\` and \`write\` must include their required closing tags. Example edit: 
  <<edit --path path
  Content:
  Old (n-n):
  This is a word
  This is another word 
  New:
  This is an edited word
  This is another edited word
  /edit>>
  or if a write: 
  <<write --path path
  Content:
  Hello World
  /write>>
- Use ONLY <<tool --flag value>> syntax
- Escape when you need to **talk about** tools without triggering them: write \\<\<tool (with a backslash) to render it as plain text. For content-tool closers, escape as \\/edit>> or \\/write>> to prevent premature closing; the parser will unescape in the saved content.
- In your tool responses only include what's defined in the <tool_schema> section, do not add extra xml tags to the beginning or end of things such as </tool_protocol> et cetera. Only what is defined in tool schema. What's defined in the <tool_schema> section below is all that's needed to call tools.
</tool_introduction>

<tool_schema>
### File Operations:

Tool: read
Syntax: <<read --path path --lines range --head number --tail number>>
Usage: Read file content from local system.
Flags:
  Required: --path <string or comma-separated paths>
  Optional: --lines <range or comma-separated ranges>
  Optional: --head <number> (read first N lines)
  Optional: --tail <number> (read last N lines)
Note: Supports recursive filename search from root. If you specify just a filename (e.g. --path task.ts), it will search the entire directory tree to find the file, even if it's deeply nested. Supports reading multiple files at once with comma-separated paths (e.g. --path file1.ts,file2.ts --lines 1-10,20-30).

Tool: edit
Syntax:
  <<edit --path path
  Content:
  Old (n):
  This is a word
  New:
  This is an edited word
  /edit>>
Usage: Modify existing files with precision markers.
Flags:
  Required: --path <string>
Body: "Old (start-end):" with line range, "New:" with replacement content.
One line edits: Use a single line number, e.g. Old (12):
End tag: /edit>>
Note: Multiple non-overlapping Old/New blocks allowed per call.

Tool: write
Syntax:
  <<write --path path
  Content:
  Hello World
  /write>>
Usage: Create new files or overwrite existing ones.
Flags:
  Required: --path <string>
End tag: /write>>

Tool: mkdir
Syntax: <<mkdir --path path>>
Usage: Create directories recursively.
Flags:
  Required: --path <comma-separated-paths>

Tool: mv
Syntax: <<mv --path source1, source2 --to destination1, destination2>> or <<mv --rename source1, source2 --to source3, source4>>
Usage: Move/rename files and directories.
Flags:
  Required: --path OR --rename <comma-separated paths>
  Required: --to <comma-separated paths or single directory>

###Search & Exploration:

Tool: ls
Syntax: <<ls --path path --recursive true|false>>
Usage: List directory contents. Defaults to current directory.
Flags:
  Optional: --path <string> (defaults to current directory)
  Optional: --recursive <true|false>

Tool: grep
Syntax: <<grep --query query --path path>>
Usage: Search text across files using ripgrep. Defaults to current directory. Case-insensitive by default.
Flags:
  Required: --query <string>
  Optional: --path <string or comma-separated paths> (defaults to current directory)
Note: Searches recursively across all files by default. You can also specify just a filename (e.g. --path task.ts) to search WITHIN that specific file only, even if it's deeply nested—the tool will find the file anywhere in the tree and search its contents. Supports searching in multiple files at once with comma-separated paths.

Tool: find
Syntax: <<find --pattern pattern --path path>>
Usage: Find files matching pattern (glob). Defaults to current directory.
Flags:
  Required: --pattern <string>
  Optional: --path <string> (defaults to current directory)

Tool: semgrep
Syntax: <<semgrep --query query --path path>>
Usage: Semantic grep in directory (best for general queries, effective with specific path). Defaults to current directory.
Flags:
  Required: --query <string>
  Optional: --path <string> (defaults to current directory)
${askRegistry ? `
${askRegistry}` : ''}
### System & Web:

Tool: bash
Syntax: <<bash --run command --path directory>>
Usage: Run shell commands on system. Commands default to root directory.
Flags:
  Required: --run <string>
  Optional: --path <directory> (defaults to root)
${todoRegistry ? `
${todoRegistry}` : ''}
Tool: web
Syntax: <<web --query query>>
Usage: Search Google for info, docs, error solutions, you don't need user's permission beforehand to do web searches either, make sure to use this to your advantage.
Flags:
  Required: --query <string>

${isSubAgentEnabled ? `Tool: agent
Syntax: <<agent --prompt prompt>>
Usage: Spawns an autonomous sub-agent for complex sub-tasks or research.
Flags:
  Required: --prompt <string>
  Optional: --mode <string>
  Optional: --parallelMode <true|false>` : ""}

Tool: fetch
Syntax: <<fetch --url url>>
Usage: Retrieve URL content and convert to markdown.
Flags:
  Required: --url <string>
${browserRegistry ? `
${browserRegistry}` : ''}${mcpToolsSection ? `
${mcpToolsSection}` : ''}
</tool_schema>

<tool_usage_examples>
### File Operations

<<read --path src/main.ts --lines 1-100>>

<<edit --path src/app.ts (multi-block example, preferred format)
Content:
Old (12):
const port = 3000
New:
const port = 8080
Old (17-18):
This is a word 
this is another word
New:
This is an edit
This is another edit
/edit>>

<<write --path src/tools/tool.ts
Content:
this is a write tool test.
this is how content goes in the write tool.
The content that goes inside here is not a string
It's a content body!
After you include the closing tag,
this is the content that will be in the file.
/write>>

<<mkdir --path src/components/ui,src/hooks>>

<<mv --path src/main.ts --to src/core/main.ts>>

<<mv --path src/a.ts, src/b.ts --to src/components>>

###Search & Exploration:

<<ls --path src/components>>

<<grep --query AuthService --path src/>>

<<find --pattern **/*.test.ts --path src>>

<<semgrep --query api endpoints --path src/api>>

### System & Web

<<bash --run npm run build --path apps/web>>

<<web --query python game engine optimization 2026>>

<<fetch --url https://docs.python.org>>
${batchingExamples}
</tool_usage_examples>

<rules>
Task_Completion: Respond with final text confirmation (no tool blocks) to mark task finished.
REMINDER: - Use a single backslash before the opener when you want to talk about a tool without triggering it:
Type \<<tool in your message. The parser will render it as literal <<tool text.
For closers, type \/edit>> or \/write>>; they’ll stay as plain text in the content and won’t close anything.
${askWorkflow}
2. Autonomous Execution: Use available tool outputs directly (including prior system observations) and proceed end-to-end without asking the user to relay data already in context. Only ask the user when a product/behavior decision is required or execution is blocked.
Precision Context: Use 'grep' and 'read' with line ranges to narrow code after finding area.${disableBatchToolUse ? '' : '\n3. Grouped Actions: Group discovery tools in one turn, apply changes in next.'}
${batchingRule}
</rules>

</tool_protocol>`}
export const UNIFIED_TOOLS_PROMPT = getUnifiedToolsPrompt(false, false, true, true)
