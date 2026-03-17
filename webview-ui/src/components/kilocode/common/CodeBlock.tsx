import { memo, useEffect, useRef, useCallback, useState, useMemo } from "react"
import styled from "styled-components"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { getHighlighter, isLanguageLoaded, normalizeLanguage, ExtendedLanguage } from "@src/utils/highlighter"
import { bundledLanguages } from "shiki"
import type { ShikiTransformer } from "shiki"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { ChevronDown, ChevronUp, Copy, Check, Search } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { StandardTooltip, Popover, PopoverContent, PopoverTrigger } from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { cn } from "@/lib/utils"

export const CODE_BLOCK_BG_COLOR = "var(--vscode-editor-background, --vscode-sideBar-background, rgb(30 30 30))"
export const WRAPPER_ALPHA = "cc" // 80% opacity

// Configuration constants
export const WINDOW_SHADE_SETTINGS = {
	transitionDelayS: 0.2,
	collapsedHeight: 250, // Default collapsed height in pixels


}

// Tolerance in pixels for determining when a container is considered "at the bottom"
export const SCROLL_SNAP_TOLERANCE = 20

interface CodeBlockProps {
	source?: string
	rawSource?: string // Add rawSource prop for copying raw text
	language: string
	preStyle?: React.CSSProperties
	initialWordWrap?: boolean
	collapsedHeight?: number
	initialWindowShade?: boolean
	onLanguageChange?: (language: ExtendedLanguage) => void
	isStreaming?: boolean
}

const CodeBlockControls = styled.div`
	position: absolute;
	top: 5.2px;
	right: 17px;
	display: flex;
	align-items: center;
	gap: 0px;
	z-index: 20;
	opacity: 0;
	/* kade_change: explicit depth boost to prevent z-fighting */
	transform: translateZ(10px);
	backface-visibility: hidden;
	/* kade_change: reduce transition complexity during scroll */
	transition: opacity 0.2s ease-out;
	padding: 0.4px 4px;
	background-color: color-mix(in srgb, var(--vscode-editor-background) 95%, transparent);
	border: 0.1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
	border-radius: 10px;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);

	&:hover {
		transform: translate3d(0, -1px, 10px);
		background-color: color-mix(in srgb, var(--vscode-editor-background) 95%, transparent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
		border-color: color-mix(in srgb, var(--vscode-foreground) 35%, transparent);
	}
`

const CodeBlockContainer = styled.div`
	position: relative;
	margin: 12px 0;
	border-radius: 12px;
	overflow: hidden;
	background-color: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
	/* kade_change: explicit 3D layer for compositor stability */
	transform-style: preserve-3d;
	transform: translateZ(0);

	&:hover ${CodeBlockControls} {
		opacity: 1;
	}
`

export const StyledPre = styled.div.attrs({ className: "anchored-container" }) <{
	preStyle?: React.CSSProperties
	wordwrap?: "true" | "false" | undefined
	windowshade?: "true" | "false"
	collapsedHeight?: number
}>`
	max-height: ${({ windowshade, collapsedHeight }) =>
		windowshade === "true" ? `${collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight}px` : "none"};
	overflow-y: auto;
	padding: 0;
	transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);

	pre {
		background-color: transparent !important;
		margin: 0;
		padding: 0px 15px;
		
		width: 100%;
		box-sizing: border-box;
	}

	pre,
	code {
		white-space: ${({ wordwrap }) => (wordwrap === "false" ? "pre" : "pre-wrap")};
		word-break: ${({ wordwrap }) => (wordwrap === "false" ? "normal" : "normal")};
		overflow-wrap: ${({ wordwrap }) => (wordwrap === "false" ? "normal" : "break-word")};
		font-size: 12px;
		font-family: var(--vscode-editor-font-family, "Cascadia Code", "Fira Code", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", monospace);
		line-height: 1.5;
	}

	.hljs {
		color: var(--vscode-editor-foreground, #fff);
		background-color: transparent !important;
	}
`

const DropdownTrigger = styled.div`
	font-size: 10px;
	font-family: var(--vscode-editor-font-family, "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", monospace);
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	padding: 2px 8px;
	border-right: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
	margin-right: 2px;
	text-transform: lowercase;
	opacity: 0.8;
	transition: all 0.2s;
	display: flex;
	align-items: center;
	gap: 3px;
	user-select: none;

	&:hover {
		opacity: 1;
		color: var(--vscode-foreground);
	}

	svg {
		opacity: 0.5;
	}
`

const DropdownContent = styled.div`
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 240px;
	overflow-y: auto;
	padding: 4px;

	&::-webkit-scrollbar {
		width: 4px;
	}
	&::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
		border-radius: 10px;
	}
`

const DropdownItem = styled.div<{ $isSelected: boolean }>`
	padding: 6px 10px;
	font-size: 11px;
	font-weight: 500;
	color: ${({ $isSelected }) => ($isSelected ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	background: ${({ $isSelected }) => ($isSelected ? "color-mix(in srgb, var(--vscode-foreground) 5%, transparent)" : "transparent")};
	cursor: pointer;
	border-radius: 6px;
	transition: all 0.1s;
	text-transform: uppercase;
	display: flex;
	align-items: center;
	gap: 6px;

	&:hover {
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		color: var(--vscode-foreground);
	}

	&::before {
		content: "";
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: ${({ $isSelected }) => ($isSelected ? "var(--vscode-symbolIcon-keywordForeground)" : "transparent")};
		transition: background 0.2s;
	}
`

const CodeBlock = memo(
	({
		source,
		rawSource,
		language,
		preStyle,
		initialWordWrap = true,
		initialWindowShade = true,
		collapsedHeight,
		onLanguageChange,
	}: CodeBlockProps) => {
		const [wordWrap, setWordWrap] = useState(initialWordWrap)
		const [windowShade, setWindowShade] = useState(initialWindowShade)
		const [currentLanguage, setCurrentLanguage] = useState<ExtendedLanguage>(() => normalizeLanguage(language))
		const portalContainer = useRooPortal("roo-portal")
		const userChangedLanguageRef = useRef(false)
		const [highlightedCode, setHighlightedCode] = useState<React.ReactNode>(null)
		const [showCollapseButton, setShowCollapseButton] = useState(true)
		const [isHovered, setIsHovered] = useState(false)
		const [isDropdownOpen, setIsDropdownOpen] = useState(false)
		const [langSearch, setLangSearch] = useState("")
		const dropdownRef = useRef<HTMLDivElement>(null)
		const codeBlockRef = useRef<HTMLDivElement>(null)
		const preRef = useRef<HTMLDivElement>(null)
		const copyButtonWrapperRef = useRef<HTMLDivElement>(null)
		const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
		const { t } = useAppTranslation()
		const isMountedRef = useRef(true)
		const shouldAutoScrollRef = useRef(true)

		// Syntax highlighting with cached Shiki instance and mounted state management
		useEffect(() => {
			isMountedRef.current = true

			// Create a safe fallback using React elements instead of HTML string
			const fallback = (
				<pre style={{ padding: 0, margin: 0 }}>
					<code className={`hljs language-${currentLanguage || "txt"}`}>{source || ""}</code>
				</pre>
			)

			const highlight = async () => {
				// Show plain text if language needs to be loaded.
				if (currentLanguage && !isLanguageLoaded(currentLanguage)) {
					if (isMountedRef.current) {
						setHighlightedCode(fallback)
					}
				}

				const highlighter = await getHighlighter(currentLanguage)
				if (!isMountedRef.current) return

				const hast = await highlighter.codeToHast(source || "", {
					lang: currentLanguage || "txt",
					theme: document.body.className.toLowerCase().includes("light") ? "github-light" : "github-dark",
					transformers: [
						{
							pre(node) {
								return node
							},
							code(node) {
								node.properties.class = `hljs language-${currentLanguage}`
								return node
							},
						},
					] as ShikiTransformer[],
				})
				if (!isMountedRef.current) return

				try {
					const reactElement = toJsxRuntime(hast, {
						Fragment,
						jsx,
						jsxs,
					})

					if (isMountedRef.current) {
						setHighlightedCode(reactElement)
					}
				} catch (error) {
					console.error("[CodeBlock] Error converting HAST to JSX:", error)
					if (isMountedRef.current) {
						setHighlightedCode(fallback)
					}
				}
			}

			highlight().catch((e) => {
				console.error("[CodeBlock] Syntax highlighting error:", e)
				if (isMountedRef.current) {
					setHighlightedCode(fallback)
				}
			})

			return () => {
				isMountedRef.current = false
			}
		}, [source, currentLanguage])

		// Update language if prop changes (unless user manually changed it)
		useEffect(() => {
			if (!userChangedLanguageRef.current) {
				setCurrentLanguage(normalizeLanguage(language))
			}
		}, [language])

		// Check if content height exceeds collapsed height whenever content changes
		useEffect(() => {
			const codeBlock = codeBlockRef.current
			if (codeBlock) {
				const actualHeight = codeBlock.scrollHeight
				setShowCollapseButton(actualHeight >= (collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight))
			}
		}, [highlightedCode, collapsedHeight])

		// Handle auto-scrolling as content streams in
		useEffect(() => {
			if (shouldAutoScrollRef.current && preRef.current) {
				preRef.current.scrollTo({
					top: preRef.current.scrollHeight,
					behavior: "auto",
				})
			}
		}, [highlightedCode])

		// Detect manual scroll to toggle auto-scroll state
		const handleScroll = useCallback(() => {
			if (preRef.current) {
				const { scrollTop, scrollHeight, clientHeight } = preRef.current
				const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_SNAP_TOLERANCE
				shouldAutoScrollRef.current = isAtBottom
			}
		}, [])

		const updateCodeBlockButtonPosition = useCallback(() => {
			// No-op for now as we use absolute positioning in the new design
		}, [])

		const handleCopy = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation()
				const textToCopy = rawSource !== undefined ? rawSource : source || ""
				if (textToCopy) {
					copyWithFeedback(textToCopy, e)
				}
			},
			[source, rawSource, copyWithFeedback],
		)

		// Handle hover events for menu visibility
		const handleMouseEnter = useCallback(() => {
			setIsHovered(true)
		}, [])

		const handleMouseLeave = useCallback(() => {
			setIsHovered(false)
		}, [])

		if (source?.length === 0) {
			return null
		}

		return (
			<CodeBlockContainer ref={codeBlockRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
				<CodeBlockControls>
					<Popover
						open={isDropdownOpen}
						onOpenChange={(open) => {
							setIsDropdownOpen(open)
							if (!open) setLangSearch("")
						}}>
						<PopoverTrigger asChild>
							<DropdownTrigger>
								{currentLanguage}
								<ChevronDown size={10} />
							</DropdownTrigger>
						</PopoverTrigger>
						<PopoverContent
							container={portalContainer}
							align="end"
							sideOffset={8}
							className="p-0 min-w-[160px] bg-popover/40 backdrop-blur-3xl border border-vscode-dropdown-border rounded-xl shadow-2xl z-[1000] overflow-hidden flex flex-col">
							<div className="p-2 border-b border-vscode-dropdown-border">
								<div className="relative flex items-center">
									<Search size={10} className="absolute left-2 text-vscode-descriptionForeground opacity-50" />
									<input
										className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded pl-6 pr-2 py-1 text-[11px] outline-none focus:border-vscode-focusBorder"
										placeholder={t("common:ui.search_placeholder")}
										value={langSearch}
										onChange={(e) => setLangSearch(e.target.value)}
										onClick={(e) => e.stopPropagation()}
										autoFocus
									/>
								</div>
							</div>
							<DropdownContent className="flex-1">
								{(!langSearch || normalizeLanguage(language).toLowerCase().includes(langSearch.toLowerCase())) && (
									<DropdownItem
										$isSelected={currentLanguage === normalizeLanguage(language)}
										onClick={() => {
											const newLang = normalizeLanguage(language)
											userChangedLanguageRef.current = true
											setCurrentLanguage(newLang)
											setIsDropdownOpen(false)
											if (onLanguageChange) onLanguageChange(newLang)
										}}>
										{normalizeLanguage(language)}
									</DropdownItem>
								)}

								{Object.keys(bundledLanguages)
									.sort()
									.map((lang) => {
										const normalizedLang = normalizeLanguage(lang as ExtendedLanguage)
										if (normalizedLang === normalizeLanguage(language)) return null
										if (langSearch && !normalizedLang.toLowerCase().includes(langSearch.toLowerCase())) return null
										return (
											<DropdownItem
												key={lang}
												$isSelected={currentLanguage === normalizedLang}
												onClick={() => {
													userChangedLanguageRef.current = true
													setCurrentLanguage(normalizedLang)
													setIsDropdownOpen(false)
													if (onLanguageChange) onLanguageChange(normalizedLang)
												}}>
												{normalizedLang}
											</DropdownItem>
										)
									})}
							</DropdownContent>
						</PopoverContent>
					</Popover>

					<div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
						{showCollapseButton && (
							<StandardTooltip
								content={t(`chat:codeblock.tooltips.${windowShade ? "expand" : "collapse"}`)}
								side="top">
								<button
									onClick={() => setWindowShade(!windowShade)}
									className="p-1 hover:bg-vscode-toolbar-hoverBackground rounded text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center">
									{windowShade ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
								</button>
							</StandardTooltip>
						)}

						<StandardTooltip content={t("chat:codeblock.tooltips.copy_code")} side="top">
							<button
								onClick={handleCopy}
								className="p-1 hover:bg-vscode-toolbar-hoverBackground rounded text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center min-w-[24px]">
								{showCopyFeedback ? <Check size={14} className="text-vscode-charts-green" /> : <Copy size={14} />}
							</button>
						</StandardTooltip>
					</div>
				</CodeBlockControls>

				<MemoizedStyledPre
					preRef={preRef}
					preStyle={preStyle}
					wordWrap={wordWrap}
					windowShade={windowShade}
					collapsedHeight={collapsedHeight}
					highlightedCode={highlightedCode}
					updateCodeBlockButtonPosition={updateCodeBlockButtonPosition}
					onScroll={handleScroll}
				/>
			</CodeBlockContainer>
		)
	},
)

// Memoized content component to prevent unnecessary re-renders of highlighted code
const MemoizedCodeContent = memo(({ children }: { children: React.ReactNode }) => <>{children}</>)

// Memoized StyledPre component
const MemoizedStyledPre = memo(
	({
		preRef,
		preStyle,
		wordWrap,
		windowShade,
		collapsedHeight,
		highlightedCode,
		updateCodeBlockButtonPosition,
		onScroll,
	}: {
		preRef: React.RefObject<HTMLDivElement>
		preStyle?: React.CSSProperties
		wordWrap: boolean
		windowShade: boolean
		collapsedHeight?: number
		highlightedCode: React.ReactNode
		updateCodeBlockButtonPosition: (forceHide?: boolean) => void
		onScroll?: () => void
	}) => (
		<StyledPre
			ref={preRef}
			preStyle={preStyle}
			wordwrap={wordWrap ? "true" : "false"}
			windowshade={windowShade ? "true" : "false"}
			collapsedHeight={collapsedHeight}
			onMouseDown={() => updateCodeBlockButtonPosition(true)}
			onMouseUp={() => updateCodeBlockButtonPosition(false)}
			onScroll={onScroll}>
			<MemoizedCodeContent>{highlightedCode}</MemoizedCodeContent>
		</StyledPre>
	),
	)

export default CodeBlock
