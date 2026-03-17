import { Tool } from "./converters"

const WEB_SEARCH_DESCRIPTION = "Search the web for info. Returns titles, URLs, and snippets."

export const web_search: Tool = {
    name: "web_search",
    description: WEB_SEARCH_DESCRIPTION,
    params: {
        query: "Search query string",
        max_results: {
            type: ["integer", "null"],
            description: "Maximum results to return (default 10)",
        },
    },
    required: ["query"],
}

export default web_search
