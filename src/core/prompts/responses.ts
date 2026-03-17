import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import * as diff from "diff"
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/RooIgnoreController"
import { RooProtectedController } from "../protect/RooProtectedController"
import * as vscode from "vscode"
import { ToolProtocol, isNativeProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import { Package } from "../../shared/package"
import { formatBytes } from "../../utils/format"

export const formatResponse = {
	// kilocode_change start
	duplicateFileReadNotice: () =>
		`[[NOTE] This file read has been removed to save space in the context window. Refer to the latest file read for the most up to date version of this file.]`,

	contextTruncationNotice: () =>
		`[NOTE] Some previous conversation history has been removed to manage the context window. The initial request and the most recent exchanges have been retained for continuity.`,

	condense: () =>
		`The conversation has been condensed to save space. This summary covers the key points of our discussion so far.\n<explicit_instructions type="condense_response">Please respond by briefly asking the user what they'd like to focus on next. You can reference the summary provided, but keep your response concise and avoid making assumptions about continuing work unless the user directs you to.</explicit_instructions>`,
	// kilocode_change end
	toolDenied: (protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation.",
			})
		}
		return `The user denied this operation.`
	},

	toolDeniedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation and provided the following feedback",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified" || (protocol as string) === "markdown") {
			return `The user denied this operation and provided the following feedback:\n\n${feedback}`
		}
		return `The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolApprovedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "approved",
				message: "The user approved this operation and provided the following context",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified" || (protocol as string) === "markdown") {
			return `The user approved this operation and provided the following context:\n\n${feedback}`
		}
		return `The user approved this operation and provided the following context:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolError: (error?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "error",
				message: "The tool execution failed",
				error: error,
			})
		}
		return `The tool execution failed with the following error:\n${error}`
	},

	rooIgnoreError: (path: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "error",
				type: "access_denied",
				message: "Access blocked by .kadeignore",
				path: path,
				suggestion: "Try to continue without this file, or ask the user to update the .kadeignore file",
			})
		}
		return `Access to ${path} is blocked by the .kadeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kadeignore file.`
	},

	noToolsUsed: (protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		// kilocode_change start: Less aggressive about forcing task completion
		return `[NOTE] You did not use a tool in your previous response.

${instructions}

# What to do now

- If you just completed work and the user seems satisfied, inform them conversationally.
- If you need information from the user, use ask_followup_question.
- If there's more work to do, use the appropriate tool.
- If you were just having a conversation or answering a question, that's fine - not every response needs a tool.

(This is an automated message.)`
		// kilocode_change end
	},


	tooManyMistakes: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "guidance",
				message: "You seem to be having trouble proceeding",
				feedback: feedback,
			})
		}
		if ((protocol as string) === "unified") {
			return `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n\n${feedback}`
		}
		return `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${feedback}\n</feedback>`
	},

	missingToolParameterError: (paramName: string, protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		return `Missing value for required parameter '${paramName}'. Please retry with complete response.\n\n${instructions}`
	},

	invalidMcpToolArgumentError: (serverName: string, toolName: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "error",
				type: "invalid_argument",
				message: "Invalid JSON argument",
				server: serverName,
				tool: toolName,
				suggestion: "Please retry with a properly formatted JSON argument",
			})
		}
		return `Invalid JSON argument used with ${serverName} for ${toolName}. Please retry with a properly formatted JSON argument.`
	},

	unknownMcpToolError: (serverName: string, toolName: string, availableTools: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_tool",
				message: "Tool does not exist on server",
				server: serverName,
				tool: toolName,
				available_tools: availableTools.length > 0 ? availableTools : [],
				suggestion: "Please use one of the available tools or check if the server is properly configured",
			})
		}
		const toolsList = availableTools.length > 0 ? availableTools.join(", ") : "No tools available"
		return `Tool '${toolName}' does not exist on server '${serverName}'.\n\nAvailable tools on this server: ${toolsList}\n\nPlease use one of the available tools or check if the server is properly configured.`
	},

	unknownMcpServerError: (serverName: string, availableServers: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.MARKDOWN)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_server",
				message: "Server is not configured",
				server: serverName,
				available_servers: availableServers.length > 0 ? availableServers : [],
			})
		}
		const serversList = availableServers.length > 0 ? availableServers.join(", ") : "No servers available"
		return `Server '${serverName}' is not configured. Available servers: ${serversList}`
	},

	toolResult: (
		text: string,
		images?: string[],
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		const systemText = text
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text: systemText }
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return systemText
		}
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		files: string[],
		didHitLimit: boolean,
		rooIgnoreController: RooIgnoreController | undefined,
		showRooIgnoredFiles: boolean,
		rooProtectedController?: RooProtectedController,
		fileLines?: Map<string, number>,
		directoryMetadata?: Map<string, { files: number, folders: number }>,
		isCompact: boolean = false,
	): string => {
		const sorted = files
			.map((file) => {
				const relativePath = path.relative(absolutePath, file).split(path.sep).join("/")
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			.sort((a, b) => {
				// Prioritize folders
				const aIsDir = a.endsWith("/")
				const bIsDir = b.endsWith("/")
				if (aIsDir && !bIsDir) return -1
				if (!aIsDir && bIsDir) return 1
				return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
			})

		if (files.length === 0) {
			return "No files found."
		}

		// Categories
		const folders: string[] = []
		const commonProjectFiles: string[] = []
		const configFiles: string[] = []
		const textFiles: string[] = []
		const imageFiles: string[] = []
		const otherFiles: string[] = []
		const hiddenFiles: string[] = []

		const languageBuckets: Record<string, string[]> = {
			"TypeScript Files": [],
			"JavaScript Files": [],
			"Python Files": [],
			"Go Files": [],
			"Rust Files": [],
			"Java Files": [],
			"C/C++ Files": [],
			"C# Files": [],
			"PHP Files": [],
			"Ruby Files": [],
			"Swift Files": [],
			"Kotlin Files": [],
			"Dart Files": [],
			"Scala Files": [],
			"Elixir Files": [],
			"Haskell Files": [],
			"Lua Files": [],
			"R Files": [],
			"Vue Files": [],
			"Svelte Files": [],
			"Shell Files": [],
			"SQL Files": [],
		}

		// Image extensions
		const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"])
		const languageByExt: Record<string, keyof typeof languageBuckets> = {
			// TypeScript
			".ts": "TypeScript Files",
			".tsx": "TypeScript Files",
			".mts": "TypeScript Files",
			".cts": "TypeScript Files",
			// JavaScript
			".js": "JavaScript Files",
			".jsx": "JavaScript Files",
			".mjs": "JavaScript Files",
			".cjs": "JavaScript Files",
			// Python
			".py": "Python Files",
			".ipynb": "Python Files",
			// Go
			".go": "Go Files",
			// Rust
			".rs": "Rust Files",
			// Java
			".java": "Java Files",
			// C/C++
			".c": "C/C++ Files",
			".cc": "C/C++ Files",
			".cpp": "C/C++ Files",
			".cxx": "C/C++ Files",
			".h": "C/C++ Files",
			".hpp": "C/C++ Files",
			".hh": "C/C++ Files",
			".hxx": "C/C++ Files",
			// C#
			".cs": "C# Files",
			// PHP
			".php": "PHP Files",
			// Ruby
			".rb": "Ruby Files",
			".rake": "Ruby Files",
			// Swift
			".swift": "Swift Files",
			// Kotlin
			".kt": "Kotlin Files",
			".kts": "Kotlin Files",
			// Dart
			".dart": "Dart Files",
			// Scala
			".scala": "Scala Files",
			// Elixir
			".ex": "Elixir Files",
			".exs": "Elixir Files",
			// Haskell
			".hs": "Haskell Files",
			".lhs": "Haskell Files",
			// Lua
			".lua": "Lua Files",
			// R
			".r": "R Files",
			".rmd": "R Files",
			// Vue / Svelte
			".vue": "Vue Files",
			".svelte": "Svelte Files",
			// Shell
			".sh": "Shell Files",
			".bash": "Shell Files",
			".zsh": "Shell Files",
			".fish": "Shell Files",
			// SQL
			".sql": "SQL Files",
		}
		// Text extensions (simplified check for common text files)
		const textExts = new Set([
			".txt", ".md", ".json", ".css", ".html",
			".xml", ".yaml", ".yml", ".bat", ".pl", ".ini", ".conf", ".env",
			".log", ".csv", ".toml", ".lock"
		])
		// Text files without reliable extensions
		const textFileNames = new Set([
			"dockerfile", "makefile", "readme", "readme.md", "changelog", "license",
		])
		// Common project files that should be surfaced prominently
		const commonProjectFileNames = new Set([
			"package.json",
			"package-lock.json",
			"pnpm-lock.yaml",
			"yarn.lock",
			"bun.lockb",
			"bun.lock",
			"npm-shrinkwrap.json",
			"tsconfig.json",
			"jsconfig.json",
			"composer.json",
			"cargo.toml",
			"go.mod",
			"go.sum",
			"pyproject.toml",
			"requirements.txt",
			"pipfile",
			"pipfile.lock",
			"gemfile",
			"gemfile.lock",
			"mix.exs",
			"mix.lock",
			"dockerfile",
			"makefile",
			"readme",
			"readme.md",
			"changelog",
			"license",
		])
		// Config files should have their own bucket
		const configExts = new Set([
			".toml", ".yaml", ".yml", ".ini", ".conf", ".cfg", ".config", ".env", ".properties",
		])
		const commonConfigFileNames = new Set([
			".editorconfig",
			".gitignore",
			".gitattributes",
			".prettierrc",
			".prettierrc.json",
			".prettierrc.js",
			".prettierrc.cjs",
			".prettierrc.yaml",
			".eslintrc",
			".eslintrc.json",
			".eslintrc.js",
			".eslintrc.cjs",
			".npmrc",
			".nvmrc",
			".dockerignore",
			"vite.config.ts",
			"vite.config.js",
			"webpack.config.js",
			"webpack.config.ts",
			"rollup.config.js",
			"rollup.config.ts",
			"postcss.config.js",
			"tailwind.config.js",
			"tailwind.config.ts",
			"eslint.config.js",
			"eslint.config.ts",
			"jest.config.js",
			"jest.config.ts",
			"vitest.config.ts",
			"vitest.config.js",
			"babel.config.js",
			"babel.config.cjs",
		])

		const sortByExtensionThenName = (arr: string[]) =>
			arr.sort((a, b) => {
				const extA = path.extname(a).toLowerCase()
				const extB = path.extname(b).toLowerCase()
				if (extA !== extB) return extA.localeCompare(extB, undefined, { sensitivity: "base" })

				const nameA = path.basename(a).toLowerCase()
				const nameB = path.basename(b).toLowerCase()
				if (nameA !== nameB) return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" })

				return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
			})

		for (const file of sorted) {
			const absoluteFilePath = path.resolve(absolutePath, file)
			const isIgnored = rooIgnoreController ? !rooIgnoreController.validateAccess(absoluteFilePath) : false
			if (isIgnored && !showRooIgnoredFiles) continue

			const name = path.basename(file)
			const lowerName = name.toLowerCase()
			const ext = path.extname(file).toLowerCase()

			if (file.endsWith("/")) {
				folders.push(file)
			} else if (name.startsWith(".")) {
				hiddenFiles.push(file)
			} else if (commonProjectFileNames.has(lowerName)) {
				commonProjectFiles.push(file)
			} else if (configExts.has(ext) || commonConfigFileNames.has(lowerName)) {
				configFiles.push(file)
			} else if (lowerName.endsWith(".d.ts")) {
				languageBuckets["TypeScript Files"].push(file)
			} else if (languageByExt[ext]) {
				languageBuckets[languageByExt[ext]].push(file)
			} else if (imageExts.has(ext)) {
				imageFiles.push(file)
			} else if (textExts.has(ext) || textFileNames.has(lowerName)) {
				textFiles.push(file)
			} else {
				otherFiles.push(file)
			}
		}

		for (const key of Object.keys(languageBuckets)) {
			sortByExtensionThenName(languageBuckets[key])
		}
		sortByExtensionThenName(commonProjectFiles)
		sortByExtensionThenName(configFiles)
		sortByExtensionThenName(textFiles)
		sortByExtensionThenName(imageFiles)
		sortByExtensionThenName(otherFiles)
		sortByExtensionThenName(hiddenFiles)

		let output = `Total files: ${files.length}${didHitLimit ? "+" : ""}, Total folders: ${folders.length}\n`
		output += `(file_name|L = line count)\n\n`

		// Helper to format line logic
		const formatLine = (file: string, isFolder: boolean) => {
			const absoluteFilePath = path.resolve(absolutePath, file)
			const isIgnored = rooIgnoreController ? !rooIgnoreController.validateAccess(absoluteFilePath) : false

			let meta = ""
			if (isIgnored) {
				meta = ` ${LOCK_TEXT_SYMBOL}`
			} else if (rooProtectedController?.isWriteProtected(absoluteFilePath)) {
				meta = " 🛡️"
			} else if (isFolder) {
				const dmKey = file.endsWith("/") ? file.slice(0, -1) : file
				const dm = directoryMetadata?.get(dmKey)
				if (dm) {
					const fileCount = dm.files
					meta = ` (${fileCount >= 1000 ? '1000+' : fileCount} files)`
				}
			} else {
				const lines = fileLines?.get(absoluteFilePath)
				if (lines !== undefined) meta = `|L${lines}`
			}
			return `${file}${meta}`
		}

		// Folders & Hidden (User example put folders near top, slightly ambiguous, but let's do Folders -> Hidden -> Types)
		// Actually, user example had: ".kilocode" (hidden folder) at top under "Hidden files ... Folders".
		// Let's grouping Logic:
		// 1. Folders
		// 2. Python
		// 3. Text
		// 4. Images
		// 5. Other
		// 6. Hidden

		const allLines: string[] = []

		if (folders.length > 0) {
			folders.forEach(f => allLines.push(formatLine(f, true)))
		}

		if (commonProjectFiles.length > 0) {
			commonProjectFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (configFiles.length > 0) {
			configFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		const languageSectionOrder: Array<{ key: keyof typeof languageBuckets, icon: string }> = [
			{ key: "TypeScript Files", icon: "🔷" },
			{ key: "JavaScript Files", icon: "🟨" },
			{ key: "Python Files", icon: "🐍" },
			{ key: "Go Files", icon: "🐹" },
			{ key: "Rust Files", icon: "🦀" },
			{ key: "Java Files", icon: "☕" },
			{ key: "C/C++ Files", icon: "🧩" },
			{ key: "C# Files", icon: "🎯" },
			{ key: "PHP Files", icon: "🐘" },
			{ key: "Ruby Files", icon: "💎" },
			{ key: "Swift Files", icon: "🕊" },
			{ key: "Kotlin Files", icon: "🧪" },
			{ key: "Dart Files", icon: "🎯" },
			{ key: "Scala Files", icon: "🔺" },
			{ key: "Elixir Files", icon: "🧪" },
			{ key: "Haskell Files", icon: "λ" },
			{ key: "Lua Files", icon: "🌙" },
			{ key: "R Files", icon: "📊" },
			{ key: "Vue Files", icon: "🟩" },
			{ key: "Svelte Files", icon: "🟧" },
			{ key: "Shell Files", icon: "💻" },
			{ key: "SQL Files", icon: "🗄" },
		]
		for (const section of languageSectionOrder) {
			const filesForLang = languageBuckets[section.key]
			if (filesForLang.length > 0) {
				filesForLang.forEach(f => allLines.push(formatLine(f, false)))
			}
		}

		if (textFiles.length > 0) {
			textFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (imageFiles.length > 0) {
			const imgByType: Record<string, string[]> = {}
			imageFiles.forEach(f => {
				const ext = path.extname(f).toUpperCase().slice(1) || "OTHER"
				if (!imgByType[ext]) imgByType[ext] = []
				imgByType[ext].push(f)
			})
			for (const type of Object.keys(imgByType).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
				const fileList = sortByExtensionThenName(imgByType[type])
				fileList.forEach(f => allLines.push(formatLine(f, false)))
			}
		}

		if (otherFiles.length > 0) {
			otherFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		if (hiddenFiles.length > 0) {
			hiddenFiles.forEach(f => allLines.push(formatLine(f, false)))
		}

		output += allLines.join("\n") + "\n"

		if (didHitLimit) {
			output += `\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		}

		return output.trim()
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "", undefined, undefined, {
			context: 3,
		})
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},
}

// to avoid circular dependency
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
			// data:image/png;base64,base64string
			const [rest, base64] = dataUrl.split(",")
			const mimeType = rest.split(":")[1].split(";")[0]
			return {
				type: "image",
				source: { type: "base64", media_type: mimeType, data: base64 },
			} as Anthropic.ImageBlockParam
		})
		: []
}

const toolUseInstructionsReminder = `# Reminder: Instructions for Tool Use

`

const toolUseInstructionsReminderNative = `# Reminder: Instructions for Tool Use

Make sure to follow the XML schema listed in the system prompt examples and do not deviate from it or hallucinate your own custom values for the tags..`

const toolUseInstructionsReminderUnified = ""

/**
 * Gets the appropriate tool use instructions reminder based on the protocol.
 *
 * @param protocol - Optional tool protocol, defaults to XML if not provided
 * @returns The tool use instructions reminder text
 */
function getToolInstructionsReminder(protocol?: ToolProtocol): string {
	const effectiveProtocol = protocol ?? TOOL_PROTOCOL.MARKDOWN
	if (effectiveProtocol === "unified") {
		return toolUseInstructionsReminderUnified
	}
	return isNativeProtocol(effectiveProtocol) ? toolUseInstructionsReminderNative : toolUseInstructionsReminder
}
