import { type Tool } from "./converters"

export const research_web: Tool = {
    name: "research_web",
    description: "Deep web research. Searches and analyzes multiple top sources in parallel for complex queries.",
    params: {
        query: "The search query to research.",
        depth: {
            type: "integer",
            description: "Number of top results to fetch and analyze (default 3, max 5).",
        },
    },
}

export default research_web
