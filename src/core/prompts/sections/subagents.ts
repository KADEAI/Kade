export function getSubAgentsSection(enableSubAgents?: boolean): string {
	if (!enableSubAgents) {
		return ""
	}
	return `====

# SUB-AGENTS

You have the ability to spawn autonomous sub-agents to handle complex sub-tasks, research queries, or parallelizable work.

## When to use sub-agents:
- **Research**: When you need to explore a topic deeply without cluttering your main context.
- **Complexity**: When a task is too large and can be broken down into independent components.
- **Parallelism**: When multiple tasks can be performed simultaneously.
- **Isolation**: When you want to test something in a separate environment (sub-agents run in isolated git worktrees).

## How sub-agents work:
1. You spawn a sub-agent using the \`agent\` tool.
2. The sub-agent runs independently in the background.
3. You can monitor progress in the Agent Manager panel.
4. Sub-agents are autonomous and will attempt to complete their assigned objective.

Note: Sub-agents are powerful but consume resources. Use them judiciously for tasks that benefit from isolation or parallel execution.`
}
