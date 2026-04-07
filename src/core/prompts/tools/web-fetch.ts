import { ToolArgs } from "./types"

export function getWebFetchDescription(args: ToolArgs): string {
    return `## fetch
Description: Fetch the content of a URL. Returns text-first content by default with links and image noise stripped. Use -L or include_links=true when you want links preserved.
Parameters:
- url: (required) The URL to fetch.
- include_links: (optional) Set to true to preserve links and image placeholders in the output.
Usage:
<fetch>
<url>https://example.com</url>
</fetch>`
}
