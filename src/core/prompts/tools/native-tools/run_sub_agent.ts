import { Tool } from "./converters"

const RUN_SUB_AGENT_DESCRIPTION = "Spawn an autonomous sub-agent for complex sub-tasks. Runs in an isolated context for parallel execution."

export const run_sub_agent: Tool = {
    name: "agent",
    description: RUN_SUB_AGENT_DESCRIPTION,
    params: {
        prompt: "The objective or prompt for the sub-agent. Be specific about what you want the sub-agent to do.",
    },
    required: ["prompt"],
}

export default run_sub_agent
