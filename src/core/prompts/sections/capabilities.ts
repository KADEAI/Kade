import { McpHub } from "../../../services/mcp/McpHub"

export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `====
CAPABILITIES
- **Tools**: Full access to CLI, file operations (read/write/edit/search), and source analysis.
- **Environment**: A recursive file list of \`${cwd}\` is provided initially; use your view files tool to explore more if needed..${mcpHub ? "\n- **MCP**: Access to connected Model Context Protocol servers for specialized tools and data." : ""}`
}
