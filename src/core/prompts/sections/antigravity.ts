import * as os from "os"

export const ANTIGRAVITY_TEMPLATE = (
	toolDefinitions: string,
	toolUseGuidelines: string,
	userRules: string,
	userInformation: string,
	mcpServers: string,
	capabilities: string,
	modes: string,
	customInstructions: string,
	subAgentsSection: string,
	skillsSection: string,
	projectInit: string,
	disableBatchToolUse: boolean = false,
	maxToolCalls?: number,
) =>
	`<identity>
${projectInit ? "\n# PROJECT OVERVIEW\n" + projectInit + "\n\n" : ""}${userInformation}
# USER RULES
${userRules}
${subAgentsSection}
${skillsSection}
${mcpServers}
${capabilities}
${modes}
${customInstructions}
# TOOL PROTOCOL
# AUTOMATIC CONTEXT UPDATING (MANDATORY)
When you \`edit\` or \`write\` a file, the system **AUTOMATICALLY UPDATES** all previous \`read\` results for that file in your history.
- **ACTION:** Treat updated \`read\` blocks as ground truth.
- **NEVER** re-\`read\` a file immediately after editing; the context is already current. Only reread a file if your getting errors with the edit tool.
- **DEDUPLICATION:** Do not request the same file multiple times in one turn (e.g., full read + line range). Pick the most efficient format and stick to it.
- Your read results are akin to a live file in a vs code editor tab rather then stale context that never updates. 
- After making an edit to a file, your old blocks can be used to reference what the previous content was for that read
${toolUseGuidelines}
${toolDefinitions}`
