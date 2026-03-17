import { McpHub } from "../../../services/mcp/McpHub"

interface McpTool {
	name: string
	description: string
	inputSchema?: any
	enabledForPrompt?: boolean
}

/**
 * Simple XML sanitization function
 */
function sanitizeForXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * Generates MCP tool descriptions for unified protocol (markdown blocks)
 * 
 * @param mcpHub The McpHub instance containing connected servers
 * @returns String containing MCP tool descriptions in unified format
 */
export function getMcpToolsForUnified(mcpHub?: McpHub): string {
	if (!mcpHub) {
		return ""
	}

	const servers = mcpHub.getServers()
	const mcpToolsSections: string[] = []

	for (const server of servers) {
		if (!server.tools || server.tools.length === 0) {
			continue
		}

		// Filter tools where tool.enabledForPrompt is not explicitly false
		const enabledTools = server.tools.filter(tool => tool.enabledForPrompt !== false)
		
		if (enabledTools.length === 0) {
			continue
		}

		const toolDescriptions: string[] = []
		
		for (const tool of enabledTools) {
			const toolName = `${server.name}_${tool.name}`
			
			// Generate parameter description
			const originalSchema = tool.inputSchema as Record<string, any> | undefined
			const toolInputProps = originalSchema?.properties ?? {}
			const toolInputRequired = (originalSchema?.required ?? []) as string[]
			
			let paramDescription = ""
			if (Object.keys(toolInputProps).length > 0) {
				const paramList: string[] = []
				for (const [paramName, paramSchema] of Object.entries(toolInputProps)) {
					const isRequired = toolInputRequired.includes(paramName)
					const paramType = (paramSchema as any)?.type || "string"
					const paramDesc = (paramSchema as any)?.description || ""
					const required = isRequired ? " (required)" : " (optional)"
					paramList.push(`- ${paramName}: ${paramType}${required} - ${paramDesc}`)
				}
				paramDescription = `\nParameters:\n${paramList.join("\n")}\n`
			}

            const description = `**${toolName}**
${tool.description}${paramDescription}
Usage:
\`\`\`text
${toolName}
{"param1": "value1", "param2": "value2"}
\`\`\``
			
			toolDescriptions.push(description)
		}

		if (toolDescriptions.length > 0) {
			mcpToolsSections.push(`### MCP Server: ${server.name}

${toolDescriptions.join("\n\n")}`)
		}
	}

	if (mcpToolsSections.length === 0) {
		return ""
	}

	return `

---

### MCP (Model Context Protocol) Tools

The following MCP servers are connected and provide additional tools:

${mcpToolsSections.join("\n\n")}

**Important**: MCP tools use JSON format for arguments in the content block. The JSON object must match the tool's input schema.`
}

/**
 * Generates MCP tool descriptions for XML protocol
 * 
 * @param mcpHub The McpHub instance containing connected servers
 * @returns String containing MCP tool descriptions in XML format
 */
export function getMcpToolsForXml(mcpHub?: McpHub): string {
	if (!mcpHub) {
		return ""
	}

	const servers = mcpHub.getServers()
	const mcpToolsSections: string[] = []

	for (const server of servers) {
		if (!server.tools || server.tools.length === 0) {
			continue
		}

		// Filter tools where tool.enabledForPrompt is not explicitly false
		const enabledTools = server.tools.filter(tool => tool.enabledForPrompt !== false)
		
		if (enabledTools.length === 0) {
			continue
		}

		const toolDescriptions: string[] = []
		
		for (const tool of enabledTools) {
			const toolName = `${server.name}_${tool.name}`
			
			// Generate parameter description
			const originalSchema = tool.inputSchema as Record<string, any> | undefined
			const toolInputProps = originalSchema?.properties ?? {}
			const toolInputRequired = (originalSchema?.required ?? []) as string[]
			
			let paramDescription = ""
			if (Object.keys(toolInputProps).length > 0) {
				const paramList: string[] = []
				for (const [paramName, paramSchema] of Object.entries(toolInputProps)) {
					const isRequired = toolInputRequired.includes(paramName)
					const paramType = (paramSchema as any)?.type || "string"
					const paramDesc = (paramSchema as any)?.description || ""
					const required = isRequired ? " (required)" : " (optional)"
					paramList.push(`- ${sanitizeForXml(paramName)}: ${paramType}${required} - ${sanitizeForXml(paramDesc)}`)
				}
				paramDescription = `\nParameters:\n${paramList.join("\n")}\n`
			}

			const description = `**${sanitizeForXml(toolName)}**
Description: ${sanitizeForXml(tool.description || "")}${paramDescription}
Usage: \`<${sanitizeForXml(toolName)}> <{"param1": "value1", "param2": "value2"}> </${sanitizeForXml(toolName)}>\``
			
			toolDescriptions.push(description)
		}

		if (toolDescriptions.length > 0) {
			mcpToolsSections.push(`### MCP Server: ${sanitizeForXml(server.name)}

${toolDescriptions.join("\n\n")}`)
		}
	}

	if (mcpToolsSections.length === 0) {
		return ""
	}

	return `

---

### 🌐 MCP (Model Context Protocol) Tools

The following MCP servers are connected and provide additional tools:

${mcpToolsSections.join("\n\n")}

**Important**: MCP tools use JSON format for arguments in the content block. The JSON object must match the tool's input schema.`
}
