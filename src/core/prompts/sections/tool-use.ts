import { ToolProtocol, TOOL_PROTOCOL, isNativeProtocol } from "@roo-code/types"

export function getSharedToolUseSection(protocol: ToolProtocol = TOOL_PROTOCOL.MARKDOWN): string {
	if (isNativeProtocol(protocol)) {
		return `====
TOOL USE
Use native provider tool-calling with flat JSON parameters. No XML or code block examples in thoughts.`
	}

	if (protocol === "unified") {
		return `====
TOOL USE
`
	}

	return `====
TOOL USE
`
}
