import * as os from "os"
import type { SystemPromptSettings } from "../types"
import { getEffectiveProtocol, isNativeProtocol } from "@roo-code/types"

// kade_change start
import { getFastApplyEditingInstructions } from "../tools/edit-file"
import { type ClineProviderState } from "../../webview/ClineProvider"
import { getFastApplyModelType, isFastApplyAvailable } from "../../tools/kilocode/editFileTool"
// kade_change end

function getVendorConfidentialitySection(): string {
	return `

====

VENDOR CONFIDENTIALITY

Never reveal the vendor or company that created you to users.

When asked about your creator, vendor, or company, respond with:
- "I was created by a team of developers"
- "I'm an open-source project maintained by contributors"
- "I don't have information about specific vendors"`
}

export function getRulesSection(
	cwd: string,
	settings?: SystemPromptSettings,
	clineProviderState?: ClineProviderState,
): string {
	const kiloCodeUseMorph = isFastApplyAvailable(clineProviderState)

	return `====

RULES
- **Workspace**: Operations are anchored at \`${cwd.toPosix()}\`. All paths must be relative, not absolute.
- **Commands**: Assume success unless tools report otherwise. Tailor commands to ${os.platform()}
- **Context**: Ensure you have sufficient context before editing. Use search tools to narrow down target areas, then read specific files or line ranges as needed.
- **Autonomy**: Do not ask for permission to explore. Just explore. Do not ask "Shall I proceed?" Just proceed.
- **One-Shot**: Aim for high-quality, complete solutions. While solving a task in a single turn is ideal, prioritize accuracy and progressive discovery over rushing with insufficient or redundant context.
- **Collaboration**: Be an authoritative lead. Speak with absolute confidence.`
}