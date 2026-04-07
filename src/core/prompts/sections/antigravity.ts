const joinPromptSections = (...sections: Array<string | undefined>) =>
	sections.filter((section) => section && section.trim().length > 0).join("\n")

const VIBE_STYLING_GUIDE = `This chat supports inline "vibe" styling.
Syntax:
~tag content~
~tag1:tag2 content~
Examples:
- ~shout:pro important~
- ~cool smooth and clean~
- ~spooky something feels wrong~
- ~terminal:quiet npm install complete~
Use it sparingly for emphasis, headings, warnings, punchlines, and short key phrases, not full paragraphs.
Main tags:
glitch, shimmer, bounce, pulse, wave, rainbow, neon, fire, shake, slide, fade, chromatic, emphasis, pop, spotlight, echo
Style tags:
retro, cyberpunk, holographic, terminal, frost, inferno, galaxy, gold, dark, vapor, pro, glass, loud, quiet, big, huge, mega, shout
Emotion shorthand:
- happy
- sad
- angry
- excited
- cool
- spooky
- shout
- whisper
Combos are supported with \`:.\`
If a vibe tag isn't recognized, treat it as normal markdown.`

export const ANTIGRAVITY_TEMPLATE = (
	toolDefinitions: string,
	toolUseGuidelines: string,
	userRules: string,
	userInformation: string,
	mcpServers: string,
	capabilities: string,
	modes: string,
	customInstructions: string,
	subAgentsSection: string,
	skillsSection: string,
	projectInit: string,
	showVibeStyling: boolean = true,
	disableBatchToolUse: boolean = false,
	maxToolCalls?: number,
) =>
	joinPromptSections(
		projectInit ? `# PROJECT OVERVIEW${projectInit}` : "",
		userInformation,
		userRules,
		subAgentsSection,
		skillsSection,
		mcpServers,
		capabilities,
		modes,
		customInstructions,
		showVibeStyling ? VIBE_STYLING_GUIDE : "",
		toolUseGuidelines,
		toolDefinitions,
	)
