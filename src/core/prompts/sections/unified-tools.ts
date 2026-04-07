import { McpHub } from "../../../services/mcp/McpHub";
import { getMcpToolsForUnified } from "../tools/mcp-tools";

export function getUnifiedToolsPrompt(
  isIndexingEnabled: boolean = false,
  isBrowserEnabled: boolean = false,
  isComputerEnabled: boolean = false,
  isTodoEnabled: boolean = false,
  isSubAgentEnabled: boolean = false,
  mcpHub?: McpHub,
  disableBatchToolUse: boolean = false,
  maxToolCalls?: number,
): string {
  let batchingRule = "multiple tool calls allowed";
  if (disableBatchToolUse) {
    batchingRule = "exactly one tool call per response";
  } else if (maxToolCalls && maxToolCalls > 1) {
    batchingRule = `at most ${maxToolCalls} tool calls per response`;
  }

  return [
    `@tool DSL SCHEMA
===
Description:
@read: read files. One file per line. Use path:ranges when ranges are needed. Use start-end for line ranges, Hn for the first n lines, and Tn for the last n lines.
@grep: search text. Case-insensitive by default. Use | for multiple queries. Use scope:query where scope is a path or include=glob list optionally followed by |path. Query text is plain text only. This is code-first search, so common noise such as docs, text files, assets, generated files, and locales may be excluded unless you opt in with include=.
@find: find files or patterns. Use | for multiple names or patterns. Use path:pattern when a path is needed.
@ls: list files.
@bash: run a shell command. Use path:command when a path is needed.
@web: search the web.
@fetch: fetch a URL.${isIndexingEnabled ? "\nAsk: semantic code search." : ""}${isSubAgentEnabled ? "\nAgent: delegate a focused task to a sub-agent." : ""}
@edit: edit files. Multi-block edits are preferred. Partial edits can go through in multi-block edits when blocks do not overlap.
@write: write a full file.${isTodoEnabled ? "\nTodo: set or replace the todo list with markdown checklist items." : ""}${isComputerEnabled ? "\n@desktop: control the local desktop with keyboard, mouse, scrolling, screenshots, and cursor inspection." : ""}
===`,
    `Syntax:
    arguments with ? = optional
@read: "path:ranges?"
@grep: "scope?:query" (scope is optional; use path or include=*file_name,*.ext? or to use both, split with a | include=*file_name,*.ext?|path. Split on the first : only, so the rest of the query stays literal. Use include= when searching text/docs/non-code files or needing less noise in a grep search)
@find: "path?:pattern,optional commas?"
@ls: "path"
@bash: "path?:command"
@web: "query"
@fetch: "url"${isIndexingEnabled ? '\n@ask: "query"' : ""}${isSubAgentEnabled ? '@agent: "prompt"' : ""}
@edit: "path"
otxt[range?]: Old content
ntxt: New content

[More otxt/ntxt blocks?]
EOF
@write: "path"
Content goes here
EOF${isTodoEnabled ? '\n\n@todo: "title?"\n[ ] item\n[-] item\n[x] item\nETXT' : ""}${isComputerEnabled ? '\n@desktop: "action[:value]" "optional extra value?" (for pointer actions after @desktop: "get_screenshot", plain x,y means normalized 0-1000 grid coordinates)' : ""}
===`,

    `Examples:
@read: "sample.txt"    
@read: "sample.txt:1-7,10-19,T20"
@read: "sample.txt:1-100"
@grep: "include=*.txt|sample.txt:dog|cats|pizza"
@grep: "dogs|cats"
@grep: "include=*.ts,*.tsx:AuthService|SessionManager"
@grep: "include=*.tsx|webview-ui:readtool|edittool"
@find: "sample.txt"
@find: "src:*.ts,*.tsx"
@find: "tsconfig.json,package.json"
@ls: "."
@ls: "src/components"
@bash: "echo all your base are belong to us"
@bash: "react-app:npm run build"
@web: "best pizza in nyc"
@fetch: "https://example.com"${isIndexingEnabled ? '\n\n@ask: "where does auth start"' : ""}${isSubAgentEnabled ? '\n\n@agent: "analyze the current project structure"' : ""}${isComputerEnabled ? '\n@desktop: "get_screenshot"\n@desktop: "mouse_move:500,500"\n@desktop: "left_click:500,500"\n@desktop: "double_click:500,500"\n@desktop: "key:Cmd+K"\n@desktop: "type:hello world"\n@desktop: "scroll:500,500:down:500"\n@desktop: "get_cursor_position"' : ""}
@edit: "sample.txt"
otxt[4-6]: Line 2
Line 3
ntxt: Edited line 2
Edited line 3
Added line 4

otxt: Bad line
ntxt: Good line

otxt: the tenth and last line.
ntxt: cool!
EOF
@write: "sample.txt"
This is a sample text file
This is line 2 of this sample text file
EOF${isTodoEnabled ? '\n\n@todo: "Implementation"\n[ ] Analyze requirements\n[-] Update parser\n[x] Add tests\nETXT' : ""}

Simple independent batch example:
@read: "README.md:1-40"
@grep: "src:TODO|FIXME"
@write: "sample.txt"
this is a sample text file
EOF
@write: "notes.txt"
Investigation notes
- README intro captured separately
- TODO/FIXME scan requested separately
EOF
===`,
    `Execution & Rules:
- @read uses path:ranges?. If ranges are present, split on the first : and treat everything after it as the range string.
- @grep uses scope?:query. If scope is present, split on the first : only. Scope may be path or include=...|path.
- @find uses path?:pattern. If a path is present, split on the first : only.
- @bash uses path?:command. If a path is present, split on the first : only.
- Escape a literal top-level tool line in prose or content with a leading /, such as /@read: "file.ts" or /@server_tool: {"key":"value"}.
- Escape a literal EOF line in prose or content as /EOF.
- Use prose when no tools are needed.
- Use only tool calls when tools are needed.
- Tool mode begins when the first non-whitespace line starts with @name:
- Tool lines start at column 1 as @name:
- Only a top-level line starting at column 1 as @name: is a tool call.
Invald: Let me read this file @read: "file.ts"
Valid: Let me read this file
@read: "file.ts"
=== Escaping
- Inline mentions like "use @read for files" inside a normal sentence are just text.
- If you place a tool line on its own top-level line while discussing or demonstrating the tools, escape it with a leading / so it stays literal.
- Escape literal top-level tool lines in prose or content with a leading /, such as /@read: "file.ts" or /@server_tool: {"key":"value"}.
- Escape a literal EOF or ETXT line in prose or content as /EOF or /ETXT.
- If you are discussing, explaining, or showing the tool syntax itself, always escape those tool lines so they stay literal.
=== Using tools and closing
- After tool mode begins, every top-level non-empty line must start with @, unless it is body content for the active block or the closing line for that active block.
- For @edit, use otxt[1-3]: when you want a line range, or otxt: with no range.
- For @edit, use ntxt: for replacement text.
- otxt/ntxt blocks may replace a full block or just a substring within a line. You do not need to include the entire old line when the target text is unambiguous.
- For @edit and @write, close the active block with EOF on its own line.
- For @todo, close the active block with ETXT on its own line.
- After EOF or ETXT, either start another top-level @tool line or end the response immediately.
=== Edit & Write stripping
- Successful @edit calls may later appear in conversation history as "Content placed in paired result below" placeholders.
- Successful @write calls may later appear as truncated previews ending with "..... see result for rest of write".
- Those placeholders do not mean the tool did nothing; the canonical applied edit blocks or post-write file snapshot are stored in the paired tool result.
- When history shows either form, treat the paired tool result as the source of truth for what changed.
=== Batching
Batching: ${batchingRule}.`,
    `Rules:
- Only use the tools listed here.
- Only the tool names listed here are valid top-level tool names.
- Do not invent syntax.
- Do not add unsupported values not shown in the syntax, and do not invent --flags; only use the argument shapes shown here. The only tool that flags are allowed in is the @bash tool.
${isBrowserEnabled ? '- browser_action is outside this @tool DSL.' : ""}${isComputerEnabled ? '\n- When computer use is available, use @desktop for desktop automation in this DSL. After @desktop: "get_screenshot", plain x,y coordinates are normalized to a visible 0-1000 grid overlay across the screenshot. Prefer compact action-first forms consistently across desktop actions, such as "mouse_move:500,500", "left_click:500,500", "key:Cmd+K", "type:hello world", and "scroll:500,500:down:500".' : ""}
- Do not mix prose with tool calls.
- The only thing allowed after a tool call, is another tool call or the end of the response.
- If you include prose after a tool call, the response will be rejected.
- @grep is optimized for code search, not raw grep. If the target may be in .txt, .md, docs, assets, generated files, or similar non-code content, add an explicit include= glob that matches those files.
- Read before edit unless the exact target and/or context is already in recent tool results.
- Batch independent calls only.
- Do not batch dependent calls. Such as editing a file in the same turn as reading but that read isnt even in your context yet, so you're assuming what the contents are.
- Do not batch speculative edits with discovery.
- Stop using tools when the task is complete.
===`,
    `Flow:
- Map -> @ls or @find
- Search -> @grep (grep is your most important tool for discovery and likely will get you to where you need to be 99% of the time)${isIndexingEnabled ? " or @ask" : ""}
- Read -> @read (prefer specific line ranges over full file reads)
- Change or identify -> Identify/deduce problem, @edit, or @write the solution`,
    getMcpToolsForUnified(mcpHub) || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const UNIFIED_TOOLS_PROMPT = getUnifiedToolsPrompt(
  false,
  false,
  false,
  true,
  true,
);
