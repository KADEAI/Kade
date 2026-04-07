import fs from "fs/promises"
import path from "path"

import * as vscode from "vscode"

type ThemeIconPath =
	| string
	| {
			light?: string
			dark?: string
			highContrast?: string
			highContrastLight?: string
	  }

type RawThemeFont = {
	id: string
	src?: Array<{ path: string; format?: string }>
	weight?: string
	style?: string
	size?: string
}

type RawThemeIconDefinition = {
	iconPath?: ThemeIconPath
	fontCharacter?: string
	fontColor?: string
	fontId?: string
	fontSize?: string
}

type RawFileIconTheme = {
	inherits?: string
	iconDefinitions?: Record<string, RawThemeIconDefinition>
	file?: string
	folder?: string
	folderExpanded?: string
	rootFolder?: string
	rootFolderExpanded?: string
	fileExtensions?: Record<string, string>
	fileNames?: Record<string, string>
	folderNames?: Record<string, string>
	folderNamesExpanded?: Record<string, string>
	languageIds?: Record<string, string>
	fonts?: RawThemeFont[]
}

type ResolvedThemeIconDefinition = {
	iconUri?: string
	fontCharacter?: string
	fontColor?: string
	fontId?: string
	fontSize?: string
}

type ThemeSource = {
	themePath: string
	resourceRoot: vscode.Uri
}

export type ResolvedFileIconTheme = {
	themeId: string
	file?: string
	folder?: string
	folderExpanded?: string
	rootFolder?: string
	rootFolderExpanded?: string
	fileExtensions: Record<string, string>
	fileNames: Record<string, string>
	folderNames: Record<string, string>
	folderNamesExpanded: Record<string, string>
	languageIds: Record<string, string>
	iconDefinitions: Record<string, ResolvedThemeIconDefinition>
	extensionToLanguageId: Record<string, string>
	fileNameToLanguageId: Record<string, string>
}

export type ResolvedFileIconThemePayload = {
	theme?: ResolvedFileIconTheme
	fontCss: string
	localResourceRoots: vscode.Uri[]
}

const mergeRecord = <T>(base?: Record<string, T>, override?: Record<string, T>) => ({
	...(base ?? {}),
	...(override ?? {}),
})

const mergeFonts = (base?: RawThemeFont[], override?: RawThemeFont[]) => {
	const merged = new Map<string, RawThemeFont>()

	for (const font of base ?? []) {
		merged.set(font.id, font)
	}

	for (const font of override ?? []) {
		merged.set(font.id, font)
	}

	return [...merged.values()]
}

const mergeThemes = (
	base: RawFileIconTheme,
	override: RawFileIconTheme,
): RawFileIconTheme => ({
	...base,
	...override,
	iconDefinitions: mergeRecord(base.iconDefinitions, override.iconDefinitions),
	fileExtensions: mergeRecord(base.fileExtensions, override.fileExtensions),
	fileNames: mergeRecord(base.fileNames, override.fileNames),
	folderNames: mergeRecord(base.folderNames, override.folderNames),
	folderNamesExpanded: mergeRecord(
		base.folderNamesExpanded,
		override.folderNamesExpanded,
	),
	languageIds: mergeRecord(base.languageIds, override.languageIds),
	fonts: mergeFonts(base.fonts, override.fonts),
})

const readThemeJson = async (
	themePath: string,
	visited = new Set<string>(),
): Promise<RawFileIconTheme> => {
	const normalizedThemePath = path.resolve(themePath)

	if (visited.has(normalizedThemePath)) {
		return {}
	}

	visited.add(normalizedThemePath)

	const raw = await fs.readFile(normalizedThemePath, "utf-8")
	const theme = JSON.parse(raw) as RawFileIconTheme

	if (!theme.inherits) {
		return theme
	}

	const inheritedTheme = await readThemeJson(
		path.resolve(path.dirname(normalizedThemePath), theme.inherits),
		visited,
	)
	return mergeThemes(inheritedTheme, theme)
}

const getBundledThemeSource = (themeId: string): ThemeSource | undefined => {
	const appRoot = vscode.env.appRoot
	if (!appRoot) {
		return undefined
	}

	if (themeId === "vs-seti") {
		const extensionRoot = path.join(appRoot, "extensions", "theme-seti")
		return {
			themePath: path.join(extensionRoot, "icons", "vs-seti-icon-theme.json"),
			resourceRoot: vscode.Uri.file(extensionRoot),
		}
	}

	if (themeId === "vs-minimal") {
		const extensionRoot = path.join(appRoot, "extensions", "theme-defaults")
		return {
			themePath: path.join(
				extensionRoot,
				"fileicons",
				"vs_minimal-icon-theme.json",
			),
			resourceRoot: vscode.Uri.file(extensionRoot),
		}
	}

	return undefined
}

const getThemeSource = (themeId: string): ThemeSource | undefined => {
	for (const extension of vscode.extensions.all) {
		const iconThemes = extension.packageJSON?.contributes?.iconThemes
		if (!Array.isArray(iconThemes)) {
			continue
		}

		const themeContribution = iconThemes.find(
			(iconTheme: { id?: string; path?: string }) => iconTheme.id === themeId,
		)
		if (!themeContribution?.path) {
			continue
		}

		return {
			themePath: path.resolve(extension.extensionPath, themeContribution.path),
			resourceRoot: extension.extensionUri,
		}
	}

	return getBundledThemeSource(themeId)
}

const resolveIconPathForThemeKind = (
	iconPath: ThemeIconPath | undefined,
	themeKind: vscode.ColorThemeKind,
): string | undefined => {
	if (!iconPath) {
		return undefined
	}

	if (typeof iconPath === "string") {
		return iconPath
	}

	switch (themeKind) {
		case vscode.ColorThemeKind.Light:
			return (
				iconPath.light ??
				iconPath.dark ??
				iconPath.highContrastLight ??
				iconPath.highContrast
			)
		case vscode.ColorThemeKind.HighContrast:
			return (
				iconPath.highContrast ??
				iconPath.dark ??
				iconPath.light ??
				iconPath.highContrastLight
			)
		case vscode.ColorThemeKind.HighContrastLight:
			return (
				iconPath.highContrastLight ??
				iconPath.light ??
				iconPath.dark ??
				iconPath.highContrast
			)
		case vscode.ColorThemeKind.Dark:
		default:
			return (
				iconPath.dark ??
				iconPath.light ??
				iconPath.highContrast ??
				iconPath.highContrastLight
			)
	}
}

const buildLanguageMaps = () => {
	const extensionToLanguageId: Record<string, string> = {}
	const fileNameToLanguageId: Record<string, string> = {}

	for (const extension of vscode.extensions.all) {
		const languages = extension.packageJSON?.contributes?.languages
		if (!Array.isArray(languages)) {
			continue
		}

		for (const language of languages) {
			if (!language?.id || typeof language.id !== "string") {
				continue
			}

			for (const fileExtension of Array.isArray(language.extensions)
				? language.extensions
				: []) {
				if (typeof fileExtension !== "string" || !fileExtension.length) {
					continue
				}

				const normalizedExtension = fileExtension.replace(/^\./, "").toLowerCase()
				if (normalizedExtension && !extensionToLanguageId[normalizedExtension]) {
					extensionToLanguageId[normalizedExtension] = language.id
				}
			}

			for (const fileName of Array.isArray(language.filenames)
				? language.filenames
				: []) {
				if (typeof fileName !== "string" || !fileName.length) {
					continue
				}

				const normalizedFileName = fileName.toLowerCase()
				if (!fileNameToLanguageId[normalizedFileName]) {
					fileNameToLanguageId[normalizedFileName] = language.id
				}
			}
		}
	}

	return { extensionToLanguageId, fileNameToLanguageId }
}

export const getResolvedFileIconTheme = async (
	webview: vscode.Webview,
): Promise<ResolvedFileIconThemePayload> => {
	const iconThemeConfig = vscode.workspace.getConfiguration("workbench")
	const iconThemeInspect = iconThemeConfig.inspect<string | null>("iconTheme")
	const themeId =
		iconThemeConfig.get<string | null>("iconTheme") ??
		iconThemeInspect?.defaultValue ??
		undefined

	if (!themeId) {
		return { fontCss: "", localResourceRoots: [] }
	}

	const themeSource = getThemeSource(themeId)
	if (!themeSource) {
		return { fontCss: "", localResourceRoots: [] }
	}

	const themeJsonPath = themeSource.themePath
	const themeJson = await readThemeJson(themeJsonPath)
	const themeDirectory = path.dirname(themeJsonPath)
	const { extensionToLanguageId, fileNameToLanguageId } = buildLanguageMaps()

	const iconDefinitions = Object.fromEntries(
		Object.entries(themeJson.iconDefinitions ?? {}).map(
			([iconId, definition]) => {
				const resolvedPath = resolveIconPathForThemeKind(
					definition.iconPath,
					vscode.window.activeColorTheme.kind,
				)
				const iconUri = resolvedPath
					? webview
							.asWebviewUri(
								vscode.Uri.file(path.resolve(themeDirectory, resolvedPath)),
							)
							.toString()
					: undefined

				return [
					iconId,
					{
						iconUri,
						fontCharacter: definition.fontCharacter,
						fontColor: definition.fontColor,
						fontId: definition.fontId,
						fontSize: definition.fontSize,
					} satisfies ResolvedThemeIconDefinition,
				]
			},
		),
	)

	const fontCss = (themeJson.fonts ?? [])
		.map((font) => {
			const fontSource = font.src?.[0]
			if (!fontSource?.path) {
				return ""
			}

			const fontUri = webview
				.asWebviewUri(vscode.Uri.file(path.resolve(themeDirectory, fontSource.path)))
				.toString()
			const fontFormat = fontSource.format
				? ` format("${fontSource.format}")`
				: ""

			return `
@font-face {
	font-family: "file-icon-theme-${font.id}";
	src: url("${fontUri}")${fontFormat};
	font-weight: ${font.weight ?? "normal"};
	font-style: ${font.style ?? "normal"};
}
`.trim()
		})
		.filter(Boolean)
		.join("\n")

	return {
		fontCss,
		localResourceRoots: [themeSource.resourceRoot],
		theme: {
			themeId,
			file: themeJson.file,
			folder: themeJson.folder,
			folderExpanded: themeJson.folderExpanded,
			rootFolder: themeJson.rootFolder,
			rootFolderExpanded: themeJson.rootFolderExpanded,
			fileExtensions: themeJson.fileExtensions ?? {},
			fileNames: themeJson.fileNames ?? {},
			folderNames: themeJson.folderNames ?? {},
			folderNamesExpanded: themeJson.folderNamesExpanded ?? {},
			languageIds: themeJson.languageIds ?? {},
			iconDefinitions,
			extensionToLanguageId,
			fileNameToLanguageId,
		},
	}
}
