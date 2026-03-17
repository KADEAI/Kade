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
