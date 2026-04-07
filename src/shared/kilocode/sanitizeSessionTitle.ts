const VIBE_TAGS = new Set([
	"glitch",
	"shimmer",
	"bounce",
	"pulse",
	"wave",
	"rainbow",
	"neon",
	"fire",
	"shake",
	"slide",
	"fade",
	"chromatic",
	"emphasis",
	"pop",
	"spotlight",
	"echo",
	"retro",
	"cyberpunk",
	"holographic",
	"terminal",
	"frost",
	"inferno",
	"galaxy",
	"gold",
	"dark",
	"vapor",
	"pro",
	"glass",
	"loud",
	"quiet",
	"big",
	"huge",
	"mega",
	"shout",
	"happy",
	"sad",
	"angry",
	"excited",
	"cool",
	"spooky",
	"whisper",
])

const VIBE_PATTERN = /~([a-z]+(?::[a-z]+)*)\s+([^~]+?)~/gi

export function stripInlineVibes(text: string): string {
	if (!text.includes("~")) {
		return text
	}

	return text.replace(VIBE_PATTERN, (match, rawTags: string, content: string) => {
		const tags = rawTags.split(":")
		if (!tags.some((tag) => VIBE_TAGS.has(tag.toLowerCase()))) {
			return match
		}

		return content.trim()
	})
}

export function sanitizeSessionTitle(text: string): string {
	return stripInlineVibes(text).replace(/\s+/g, " ").trim()
}

export function createSessionTitlePreview(text: string, maxLength = 40): string {
	const sanitized = sanitizeSessionTitle(text)
	if (sanitized.length <= maxLength) {
		return sanitized
	}

	return `${sanitized.substring(0, maxLength)}...`
}
