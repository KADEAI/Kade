import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"

export function getToolUseGuidelinesSection(protocol: ToolProtocol = TOOL_PROTOCOL.MARKDOWN): string {
	return `# Tool Use Guidelines
**Dialogue**: Answer questions and explain logic in plain text alongside or instead of tools.
`
}
