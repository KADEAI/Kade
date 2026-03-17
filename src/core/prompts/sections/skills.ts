export function getSkillsSection(
	enabledSkills?: string[],
	installedSkills?: Array<{ id: string; name: string; path: string; content?: string }>,
): string {
	if (!enabledSkills || enabledSkills.length === 0 || !installedSkills || installedSkills.length === 0) {
		return ""
	}

	const enabledSkillsCatalog = installedSkills
		.filter(skill => enabledSkills.includes(skill.id))
		.map(skill => `- ${skill.name}: ${skill.path}/SKILL.md`)
		.join("\n")

	if (!enabledSkillsCatalog) {
		return ""
	}

	return `====

# SKILLS

The following skills are available to you for this turn:

${enabledSkillsCatalog}

Use them as an on-demand skill registry:
- Do not assume a skill's full instructions from its name alone.
- When a task clearly matches one of these skills, open that skill's \`SKILL.md\` file and read it with your read tool. The user has this enabled, and expects you to use these skills to your advantage if it matches the task, so actually read the skill if a task seems relevant enough to that skill.
- Treat the skill file as the source of truth for that workflow.
- Prefer opening a skill only when it is relevant instead of loading every skill eagerly.
- When reading a skill, read the skill first, before making other tool calls, then once you have the result of the \`SKILL.md\`, proceed to continue with the task at hand.

If a task does not match any listed skill, proceed normally without forcing skill usage.

====`
}
