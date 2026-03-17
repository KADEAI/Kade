import { Tool } from "./converters"

const ACCESS_MCP_RESOURCE_DESCRIPTION = `Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.

Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access

Example: Accessing a weather resource
{ "server_name": "weather-server", "uri": "weather://san-francisco/current" }

Example: Accessing a file resource from an MCP server
{ "server_name": "filesystem-server", "uri": "file:///path/to/data.json" }`

export const access_mcp_resource: Tool = {
	name: "access_mcp_resource",
	description: ACCESS_MCP_RESOURCE_DESCRIPTION,
	params: {
		server_name: "The name of the MCP server providing the resource",
		uri: "The URI identifying the specific resource to access",
	},
}

export default access_mcp_resource
