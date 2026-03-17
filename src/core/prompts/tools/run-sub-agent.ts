import { ToolArgs } from "./types"

export function getRunSubAgentDescription(args: ToolArgs): string {
	return `## agent
Description: Spawns a new autonomous sub-agent to handle a complex sub-task or research query. The sub-agent runs in its own context and will report back its findings. Use this for tasks that require exploration, research, or multi-step reasoning.

Parameters:
- prompt: (required) The objective or prompt for the sub-agent.

Usage:
\`\`\`agent
Research the best way to implement X
\`\`\``
}
