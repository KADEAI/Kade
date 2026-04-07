const DEFAULT_NOISE_IGNORE_GLOBS = [
	"!.*",
	"!**/.*/",
	"!node_modules",
	"!dist",
	"!build",
	"!out",
	"!assets",
	"!vendor",
	"!target",
	"!coverage",
	"!.nyc_output",
	"!.turbo",
	"!.vscode",
	"!.github",
	"!.gemini",
	"!.cline",
	"!.roo",
	"!**/generated/**",
	"!**/*.d.ts",
	"!**/*.map",
	"!**/*.min.*",
	"!**/*.snap",
	"!**/*.tsbuildinfo",
	"!package-lock.json",
	"!pnpm-lock.yaml",
	"!yarn.lock",
	"!**/*.md",
	"!**/*.markdown",
	"!**/*.txt",
	"!**/*.rst",
	"!**/*.adoc",
	"!**/*.svg",
	"!**/*.png",
	"!**/*.jpg",
	"!**/*.jpeg",
	"!**/*.gif",
	"!**/*.ico",
	"!**/*.webp",
	"!**/*.woff",
	"!**/*.woff2",
	"!**/*.ttf",
	"!**/*.eot",
	"!**/*.mp3",
	"!**/*.wav",
	"!**/*.mp4",
	"!**/*.pdf",
	"!**/package.nls*.json",
	"!**/i18n/locales/**",
	"!**/dist/locales/**",
	"!**/locales/**",
]

const TEST_IGNORE_GLOBS = [
	"!**/*.test.*",
	"!**/*.spec.*",
	"!**/__tests__/**",
	"!**/tests/**",
	"!**/test/**",
]

export function buildGrepIgnoreGlobs({
	includeAll = false,
	includeTests = false,
}: {
	includeAll?: boolean
	includeTests?: boolean
} = {}): string[] {
	if (includeAll) {
		return []
	}

	return includeTests
		? [...DEFAULT_NOISE_IGNORE_GLOBS]
		: [...DEFAULT_NOISE_IGNORE_GLOBS, ...TEST_IGNORE_GLOBS]
}

export function buildOrderedGrepGlobs({
	include,
	exclude,
	includeAll = false,
	includeTests = false,
}: {
	include?: string | string[] | null
	exclude?: string | string[] | null
	includeAll?: boolean
	includeTests?: boolean
} = {}): string[] {
	const globs = buildGrepIgnoreGlobs({ includeAll, includeTests })

	const splitGlobList = (value?: string | string[] | null): string[] => {
		const inputs = Array.isArray(value) ? value : value ? [value] : []
		const patterns: string[] = []

		for (const input of inputs) {
			let current = ""
			let braceDepth = 0
			let bracketDepth = 0
			let escaped = false

			for (const char of input) {
				if (escaped) {
					current += char
					escaped = false
					continue
				}

				if (char === "\\") {
					current += char
					escaped = true
					continue
				}

				if (char === "{") {
					braceDepth += 1
				} else if (char === "}" && braceDepth > 0) {
					braceDepth -= 1
				} else if (char === "[") {
					bracketDepth += 1
				} else if (char === "]" && bracketDepth > 0) {
					bracketDepth -= 1
				}

				if ((char === "," || char === "\n") && braceDepth === 0 && bracketDepth === 0) {
					const trimmed = current.trim()
					if (trimmed) {
						patterns.push(trimmed)
					}
					current = ""
					continue
				}

				current += char
			}

			const trimmed = current.trim()
			if (trimmed) {
				patterns.push(trimmed)
			}
		}

		return patterns
	}

	// Ripgrep resolves glob precedence by the last matching glob. Put the
	// built-in noise filters first so an explicit include like "*.txt" can
	// intentionally opt back into file types that are normally suppressed.
	for (const pattern of splitGlobList(include)) {
		globs.push(pattern)
	}

	// Keep user-provided excludes last so they override both the defaults and
	// any explicit include.
	for (const pattern of splitGlobList(exclude)) {
		globs.push(pattern.startsWith("!") ? pattern : `!${pattern}`)
	}

	return globs
}
