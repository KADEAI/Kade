export function isTextProtocolShadowToolBlock(block: any): boolean {
	if (block?.type !== "tool_use" && block?.type !== "mcp_tool_use") {
		return false
	}

	const id = (block as any)?.id || (block as any)?.toolUseId
	return typeof id === "string" && (id.startsWith("unified_") || id.startsWith("xml_"))
}

export function stripTextProtocolShadowToolBlocks(blocks: any[]): any[] {
	return blocks.filter((block: any) => !isTextProtocolShadowToolBlock(block))
}
