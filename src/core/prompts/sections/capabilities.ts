import { McpHub } from "../../../services/mcp/McpHub"

export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `${mcpHub ? "\**MCP**: Access to connected Model Context Protocol servers for specialized tools and data." : ""}`
}
