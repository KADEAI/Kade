import { McpHub } from "../../../services/mcp/McpHub"
import { getMcpToolsForXml } from "../tools/mcp-tools"

export function getXmlToolsPrompt(isMorphEnabled: boolean, isIndexingEnabled: boolean = false, isBrowserEnabled: boolean = false, isTodoEnabled: boolean = false, mcpHub?: McpHub): string {
  const mcpToolsSection = getMcpToolsForXml(mcpHub)

  const askSection = isIndexingEnabled ? `
**ask**
Description: Fast semantic search — the most efficient way to map a new codebase or locate specific logic. Returns the most relevant code for a query. Supports multiple queries separated by commas.
Usage: \`<ask> <query> <optional path> </ask>\`
Example: \`<ask> <authentication middleware> </ask>\`
` : ""

  const todoSection = isTodoEnabled ? `
**todo**
Description: Record a task or reminder.
Usage: \`<todo> <task> </todo>\`
Example: \`<todo> <Refactor auth logic> </todo>\`
` : ""

  const browserSection = isBrowserEnabled ? `
**browser**
Description: Interact with a Puppeteer-controlled browser. Use for web development or web research.
Usage: \`<browse> <url> </browse>\`
Usage: \`<click> <coordinate> </click>\`
Usage: \`<type> <text> </type>\`
Usage: \`<scroll> <direction> </scroll>\`
` : ""

  return `====

# ⚡ Kilo-XML Shorthand Protocol

This is the next iteration of tool calling. It is a highly optimized, shorthand format designed for maximum precision and minimal overhead while maintaining standard XML structure.

### 📜 Core Syntax
Tool calls use standard XML tags with values provided in sequential angle brackets.

<toolname> <value1> <value2> ... </toolname>

- **Standard Tags**: Always use a closing tag with a forward slash (e.g., \`</read>\`).
- **Positional Values**: Provide parameters in the exact order defined below.
- **⚠️ CRITICAL**: Every positional value MUST be wrapped in angle brackets \`< >\`. Bare text without brackets will FAIL.
  - ✅ CORRECT: \`<read> <file.txt> </read>\`
  - ❌ WRONG: \`<read> file.txt </read>\`

---

### 📂 SHORTHAND CATALOG, MAKE SURE TO FOLLOW THIS EXACT SCHEMA FOR XML TOOL USAGE SHOWCASED IN THESE EXAMPLES, DO NOT HALLUCINATE OTHER VALUES FOR THESE TAGS, AND OR SCHEMA, OTHER THEN WHATS LISTED BELOW!

**read**
Description: Read the contents of a file. Allows multiple files to be read as well. You MUST provide at least one file path wrapped in angle brackets.
Usage: \`<read> <path 1-10> <path2> </read>\`
Example: \`<read> <src/main.ts 1-50> <src/utils.ts 100-120> </read>\`
Single file: \`<read> <file.txt> </read>\`


**edit**
Description: Modify a file by replacing old content with new content. Supports multiple blocks.
Usage: \`<edit> <path> <SEARCH start-end:/REPLACE: blocks> </edit>\`
Example (Single-Block):
<edit> <src/utils.ts> <
Old 1-2:
  const x = 1;
  const y = 2;
REPLACE:
  const x = 2;
  const z = 3;
> </edit>

Example (Multi-Block):
<edit> <src/utils.ts> <
Old 10-10:
  console.log("test");
REPLACE:
  console.log("debug");

Old 20-21:
  return true;
  retun yes!
REPLACE:
  return false;
  return no!
> </edit>

**write**
Description: Create a new file or overwrite an existing one. Automatically creates any missing parent directories recursively.
Usage: \`<write> <path> <content> </write>\`
Example:
<write> <script.py> <
print("Hello World")
> </write>

**ls**
Description: List files in a directory.
Usage: \`<ls> <path> <recursive> </ls>\`
Example: \`<ls> <src> <true> </ls>\`

**grep**
Description: Search for string matches in files.
Usage: \`<grep> <query> <path> <file_pattern> </grep>\`
Example: \`<grep> <sample> <src> <*.ts> </grep>\`

**glob**
Description: Find files matching a glob pattern.
Usage: \`<glob> <pattern> <path> </glob>\`
Example: \`<glob> <**/*.test.ts> <src> </glob>\`

**bash**
Description: Execute a shell command.
Usage: \`<bash> <command> </bash>\`
Example: \`<bash> <npm test> </bash>\`

${todoSection}${askSection}
**context**
Description: Fast context search — automatically runs multiple parallel grep and file read operations to find the most relevant code for a query. Returns exact file and folder paths with line ranges.
Usage: \`<context> <query> <optional path> </context>\`
Example: \`<context> <authentication middleware> </context>\`
Example (scoped): \`<context> <authentication middleware> <src/auth> </context>\`

**web**
Description: Perform a web search.
Usage: \`<web> <query> </web>\`
Example: \`<web> <React 19 features> </web>\`

**fetch**
Description: Fetch text content from a URL.
Usage: \`<fetch> <url> </fetch>\`
Example: \`<fetch> <https://example.com> </fetch>\`

**research**
Description: Perform deep research on a topic.
Usage: \`<research> <query> <depth> </research>\`
Example: \`<research> <LLM architectures> <3> </research>\`

${browserSection}

${mcpToolsSection}

---

### 🛡️ Implementation Rules
1. **Precision**: Text inside \`SEARCH:\` sections must match the file content exactly.
2. **Minimization**: Only include the lines that need to be changed in edits.
3. **Completion**: Always close your tool calls with the standard XML closing tag.
4. **Efficiency**: You can batch multiple tools to gather info faster, but avoid batching dependent actions where you guess the state of the codebase.
   - **Good**: \`<grep> ... </grep>\` + \`<ls> ... </ls>\` + \`<read> ... </read>\` (Gathering full context)
   - **Bad**: \`<grep> "FIXME" </grep>\` + \`<edit> ... </edit>\` (Trying to edit before you know the line numbers from the grep)
5. **Mastery**: The foundation is set. You have the schema, the shortcuts, and the logic. Now, go forth and execute with god-tier engineering.

`;
}

