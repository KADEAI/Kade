import { Tool } from "./converters"

const WEB_FETCH_DESCRIPTION =
    "Fetch text content from a URL. Useful for reading documentation or web pages. By default it strips links and image noise; pass include_links=true to preserve them."

export const web_fetch: Tool = {
    name: "web_fetch",
    description: WEB_FETCH_DESCRIPTION,
    params: {
        url: "The URL to fetch",
        include_links: "Optional boolean. Preserve links and image placeholders in the result.",
    },
}

export default web_fetch
