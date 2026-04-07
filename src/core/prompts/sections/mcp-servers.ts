import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"

export async function getMcpServersSection(
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	enableMcpServerCreation?: boolean,
	includeToolDescriptions: boolean = true,
): Promise<string> {
	if (!mcpHub) {
		return ""
	}

	const connectedServers =
		mcpHub.getServers().length > 0
			? `${mcpHub
				.getServers()
				.filter((server) => server.status === "connected")
				.map((server) => {
					// Only include tool descriptions when using XML protocol
					const tools = includeToolDescriptions
						? server.tools
							?.filter((tool) => tool.enabledForPrompt !== false)
							?.map((tool) => {
								const schemaStr = tool.inputSchema
									? `    Expected Parameters (XML Tags):
        ${Object.entries((tool.inputSchema as any).properties || {})
										.map(([prop, details]: [string, any]) => {
											const required = (tool.inputSchema as any).required?.includes(prop) ? " (required)" : ""
											return `- <${prop}>: ${details.description || details.type || "string"}${required}`
										})
										.join("\n        ")}`
									: ""

								return `- ${tool.name}: ${tool.description}\n${schemaStr}`
							})
							.join("\n\n")
						: undefined

					const templates = server.resourceTemplates
						?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
						.join("\n")

					const resources = server.resources
						?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
						.join("\n")

					const config = JSON.parse(server.config)

					return (
						`## ${server.name}${config.command ? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)` : ""}` +
						(server.instructions ? `\n\n### Instructions\n${server.instructions}` : "") +
						(tools ? `\n\n### Available Tools\n${tools}` : "") +
						(templates ? `\n\n### Resource Templates\n${templates}` : "") +
						(resources ? `\n\n### Direct Resources\n${resources}` : "")
					)
				})
				.join("\n\n")}`
			: "(No MCP servers currently connected)"

	// Different instructions based on protocol
	const toolAccessInstructions = includeToolDescriptions
		? ``
		: ``

	const baseSection = `
# Connected MCP Servers

${toolAccessInstructions}

${connectedServers}`

	if (!enableMcpServerCreation) {
		return baseSection
	}

	return (
		baseSection +
		``
	)
}
