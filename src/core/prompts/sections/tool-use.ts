import { ToolProtocol, TOOL_PROTOCOL, isNativeProtocol } from "@roo-code/types"

export function getSharedToolUseSection(protocol: ToolProtocol = TOOL_PROTOCOL.UNIFIED): string {
	if (isNativeProtocol(protocol)) {
		return `====
## TOOL USAGE:
`
	}

	if (protocol === "unified") {
		return `====
## TOOL USAGE:`
	}

	return `====
## TOOL USAGE:`
}
