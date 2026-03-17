import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import styled from "styled-components"
import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { MermaidSyntaxFixer } from "@src/services/mermaidSyntaxFixer"
import CodeBlock from "../kilocode/common/CodeBlock"
import { MermaidButton } from "@/components/common/MermaidButton"
import { MermaidFixButton } from "@/components/common/MermaidFixButton"
import { ImagePreviewModal } from "./ImagePreviewModal"

// Removed previous attempts at static imports for individual diagram types
// as the paths were incorrect for Mermaid v11.4.1 and caused errors.
// The primary strategy will now rely on Vite's bundling configuration.

const MERMAID_MAX_HEIGHT = 320
const MERMAID_SVG_CACHE = new Map<string, { svg: string; error: string | null }>()

const MERMAID_THEME = {
	background: "#1e1e1e", // VS Code dark theme background
	textColor: "#ffffff", // Main text color
	mainBkg: "#2d2d2d", // Background for nodes
	nodeBorder: "#888888", // Border color for nodes
	lineColor: "#cccccc", // Lines connecting nodes
	primaryColor: "#3c3c3c", // Primary color for highlights
	primaryTextColor: "#ffffff", // Text in primary colored elements
	primaryBorderColor: "#888888",
	secondaryColor: "#2d2d2d", // Secondary color for alternate elements
	tertiaryColor: "#454545", // Third color for special elements

	// Class diagram specific
	classText: "#ffffff",

	// State diagram specific
	labelColor: "#ffffff",

	// Sequence diagram specific
	actorLineColor: "#cccccc",
	actorBkg: "#2d2d2d",
	actorBorder: "#888888",
	actorTextColor: "#ffffff",

	// Flow diagram specific
	fillType0: "#2d2d2d",
	fillType1: "#3c3c3c",
	fillType2: "#454545",
}

mermaid.initialize({
	startOnLoad: false,
	securityLevel: "loose",
	theme: "dark",
	suppressErrorRendering: true,
	themeVariables: {
		...MERMAID_THEME,
		fontSize: "16px",
		fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",

		// Additional styling
		noteTextColor: "#ffffff",
		noteBkgColor: "#454545",
		noteBorderColor: "#888888",

		// Improve contrast for special elements
		critBorderColor: "#ff9580",
		critBkgColor: "#803d36",

		// Task diagram specific
		taskTextColor: "#ffffff",
		taskTextOutsideColor: "#ffffff",
		taskTextLightColor: "#ffffff",

		// Numbers/sections
		sectionBkgColor: "#2d2d2d",
		sectionBkgColor2: "#3c3c3c",

		// Alt sections in sequence diagrams
		altBackground: "#2d2d2d",

		// Links
		linkColor: "#6cb6ff",

		// Borders and lines
		compositeBackground: "#2d2d2d",
		compositeBorder: "#888888",
		titleColor: "#ffffff",
	},
})

interface MermaidBlockProps {
	code: string
}

// kade_change next line rename to originalCode to keep the difference with Roo smaller
export default function MermaidBlock({ code: originalCode }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [isErrorExpanded, setIsErrorExpanded] = useState(false)
	// kade_change start
	const [svgContent, setSvgContent] = useState<string>("")
	const [isFixing, setIsFixing] = useState(false)
	const [code, setCode] = useState("")
	const [needsExpand, setNeedsExpand] = useState(false)
	const [isExpanded, setIsExpanded] = useState(false)
	// kade_change end
	const [selectedImage, setSelectedImage] = useState<string | null>(null)
	const skipNextRenderRef = useRef(false)
	const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
	const { t } = useAppTranslation()

	// 1) Whenever `code` changes, mark that we need to re-render a new chart
	useEffect(() => {
		setIsLoading(true)
		setError(null)
		// kade_change start
		setCode(originalCode)
		setIsFixing(false)
		// kade_change end
		setIsExpanded(false)

		const cacheKey = originalCode.trim()
		if (cacheKey && MERMAID_SVG_CACHE.has(cacheKey)) {
			const cached = MERMAID_SVG_CACHE.get(cacheKey)!
			setSvgContent(cached.svg)
			setError(cached.error)
			setIsLoading(false)
			skipNextRenderRef.current = true
		}
	}, [originalCode]) // kade_change originalCode instead of code

	// kade_change start
	const handleSyntaxFix = async () => {
		if (isFixing) return

		setIsLoading(true)
		setIsFixing(true)
		const result = await MermaidSyntaxFixer.autoFixSyntax(code)
		if (result.fixedCode) {
			// Use the improved code even if not completely successful
			setCode(result.fixedCode)
		}

		if (!result.success) {
			setError(result.error || t("common:mermaid.errors.fix_failed"))
		}

		setIsFixing(false)
		setIsLoading(false)
	}
	// kade_change end

	// 2) Debounce the actual parse/render
	// the LLM is still 'typing', and we do not want to start rendering and/or autofixing before it is fully done.
	useDebounceEffect(
		() => {
			//kade_change start
			if (isFixing) return
			if (skipNextRenderRef.current) {
				skipNextRenderRef.current = false
				return
			}
			setIsLoading(true)
			//kade_change end

			mermaid
				.parse(code)
				.then(() => {
					const id = `mermaid-${Math.random().toString(36).substring(2)}`
					return mermaid.render(id, code)
				})
				.then(({ svg }) => {
					//kade_change start
					const sanitizedSvg = svg
						.replace(/(<svg\b[^>]*)(>)/i, `$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet"$2`)
						.replace(/max-width:\s*[^;]+;?/gi, "")
					setError(null)
					setSvgContent(sanitizedSvg)
					const cacheKey = code.trim()
					if (cacheKey) {
						MERMAID_SVG_CACHE.set(cacheKey, { svg: sanitizedSvg, error: null })
					}
					// kade_change end
				})
				.catch((err) => {
					console.warn("Mermaid parse/render failed:", err)
					// kade_change start
					const errorMessage = err instanceof Error ? err.message : t("common:mermaid.render_error")
					setError(errorMessage)
					const cacheKey = code.trim()
					if (cacheKey) {
						MERMAID_SVG_CACHE.set(cacheKey, { svg: "", error: errorMessage })
					}
					// kade_change end
				})
				.finally(() => {
					setIsLoading(false)
				})
		},
		500, // Delay 500ms
		[code, isFixing, originalCode, t], // Dependencies for scheduling // kade_change added isFixing, originalCode and t
	)

	useEffect(() => {
		const el = containerRef.current
		if (!el || typeof ResizeObserver === "undefined") {
			setNeedsExpand(false)
			return
		}

		let animationFrame: number | null = null
		const measure = () => {
			if (animationFrame) cancelAnimationFrame(animationFrame)
			animationFrame = requestAnimationFrame(() => {
				const totalHeight = el.scrollHeight
				setNeedsExpand(totalHeight > MERMAID_MAX_HEIGHT + 16)
			})
		}

		const observer = new ResizeObserver(measure)
		observer.observe(el)
		measure()

		return () => {
			if (animationFrame) cancelAnimationFrame(animationFrame)
			observer.disconnect()
		}
	}, [svgContent])

	useEffect(() => {
		if (!needsExpand) {
			setIsExpanded(false)
		}
	}, [needsExpand])

	/**
	 * Called when user clicks the rendered diagram.
	 * Converts the <svg> to a PNG and sends it to the extension.
	 */
	const handleClick = async () => {
		if (!containerRef.current) return
		const svgEl = containerRef.current.querySelector("svg")
		if (!svgEl) return

		try {
			const pngDataUrl = await svgToPng(svgEl)
			setSelectedImage(pngDataUrl)
		} catch (err) {
			console.error("Error converting SVG to PNG:", err)
		}
	}

	// Copy functionality handled directly through the copyWithFeedback utility

	return (
		<MermaidBlockContainer>
			{isLoading && (
				<LoadingMessage>
					{isFixing /* kade_change */ ? t("common:mermaid.fixing_syntax") : t("common:mermaid.loading")}
				</LoadingMessage>
			)}

			{error ? (
				<ErrorShell>
					<div
						style={{
							borderBottom: isErrorExpanded
								? "1px solid color-mix(in srgb, var(--vscode-editorGroup-border) 70%, transparent)"
								: "none",
							fontWeight: "normal",
							fontSize: "var(--vscode-font-size)",
							color: "var(--vscode-editor-foreground)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							cursor: "pointer",
							padding: "12px 14px",
						}}
						onClick={() => setIsErrorExpanded(!isErrorExpanded)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
								flexGrow: 1,
							}}>
							<span
								className="codicon codicon-warning"
								style={{
									color: "var(--vscode-editorWarning-foreground)",
									opacity: 0.8,
									fontSize: 16,
									marginBottom: "-1.5px",
								}}></span>
							<span style={{ fontWeight: "bold" }}>{t("common:mermaid.render_error")}</span>
						</div>
						<div style={{ display: "flex", alignItems: "center" }}>
							{/* kade_change start */}
							{!!error && (
								<MermaidFixButton
									onClick={(e) => {
										e.stopPropagation()
										handleSyntaxFix()
									}}
									disabled={isFixing}
									title={t("common:mermaid.fix_syntax_button")}>
									<span className={`codicon codicon-${isFixing ? "loading" : "wand"}`}></span>
								</MermaidFixButton>
							)}
							{/* kade_change end */}
							<CopyButton
								onClick={(e) => {
									e.stopPropagation()
									const combinedContent = `Error: ${error}\n\n\`\`\`mermaid\n${code}\n\`\`\``
									copyWithFeedback(combinedContent, e)
								}}>
								<span className={`codicon codicon-${showCopyFeedback ? "check" : "copy"}`}></span>
							</CopyButton>
							<span className={`codicon codicon-chevron-${isErrorExpanded ? "up" : "down"}`}></span>
						</div>
					</div>
					{isErrorExpanded && (
						<div
							style={{
								padding: "12px 14px 14px",
								backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 88%, transparent)",
								borderTop: "none",
							}}>
							<div style={{ marginBottom: "8px", color: "var(--vscode-descriptionForeground)" }}>
								{error}
							</div>
							<CodeBlock language="mermaid" source={code} />
							{/* kade_change start */}
							{code !== originalCode && (
								<div style={{ marginTop: "8px" }}>
									<div style={{ marginBottom: "4px", fontSize: "0.9em", fontWeight: "bold" }}>
										{t("common:mermaid.original_code")}
									</div>
									<CodeBlock language="mermaid" source={originalCode} />
								</div>
							)}
							{/* kade_change end */}
						</div>
					)}
				</ErrorShell>
			) : (
				<MermaidButton containerRef={containerRef} code={code} isLoading={isLoading} svgToPng={svgToPng}>
					<DiagramSurface>
						{/* kade_change start switched from ref to dangerouslySetInnerHTML */}
						<SvgContainer
							onClick={handleClick}
							ref={containerRef}
							$isLoading={isLoading}
							$isExpanded={isExpanded}
							dangerouslySetInnerHTML={{ __html: svgContent }}
						/>
						{needsExpand && !isExpanded && <OverflowHint />}
					</DiagramSurface>
					{needsExpand && (
						<ExpandRow>
							<ExpandButton
								onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
									event.stopPropagation()
									setIsExpanded((prev) => !prev)
								}}
							>
								<span className="codicon codicon-resize"></span>
								{isExpanded ?
									t("common:mermaid.collapse_diagram", { defaultValue: "Collapse diagram" }) :
									t("common:mermaid.expand_diagram", { defaultValue: "Expand diagram" })}
							</ExpandButton>
						</ExpandRow>
					)}
				</MermaidButton>
			)}
			<ImagePreviewModal
				isOpen={!!selectedImage}
				onClose={() => setSelectedImage(null)}
				imageUri={selectedImage || ""}
			/>
		</MermaidBlockContainer>
	)
}

async function svgToPng(svgEl: SVGElement): Promise<string> {
	// Clone the SVG to avoid modifying the original
	const svgClone = svgEl.cloneNode(true) as SVGElement

	// Get the original viewBox
	const viewBox = svgClone.getAttribute("viewBox")?.split(" ").map(Number) || []
	const originalWidth = viewBox[2] || svgClone.clientWidth
	const originalHeight = viewBox[3] || svgClone.clientHeight

	// Calculate the scale factor to fit editor width while maintaining aspect ratio

	// Unless we can find a way to get the actual editor window dimensions through the VS Code API (which might be possible but would require changes to the extension side),
	// the fixed width seems like a reliable approach.
	const editorWidth = 3_600

	const scale = editorWidth / originalWidth
	const scaledHeight = originalHeight * scale

	// Update SVG dimensions
	svgClone.setAttribute("width", `${editorWidth}`)
	svgClone.setAttribute("height", `${scaledHeight}`)

	const serializer = new XMLSerializer()
	const svgString = serializer.serializeToString(svgClone)

	// Create a data URL directly
	// First, ensure the SVG string is properly encoded
	const encodedSvg = encodeURIComponent(svgString).replace(/'/g, "%27").replace(/"/g, "%22")

	const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`

	return new Promise((resolve, reject) => {
		const img = new Image()

		img.onload = () => {
			const canvas = document.createElement("canvas")
			canvas.width = editorWidth
			canvas.height = scaledHeight

			const ctx = canvas.getContext("2d")
			if (!ctx) return reject("Canvas context not available")

			// Fill background with Mermaid's dark theme background color
			ctx.fillStyle = MERMAID_THEME.background
			ctx.fillRect(0, 0, canvas.width, canvas.height)

			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"

			ctx.drawImage(img, 0, 0, editorWidth, scaledHeight)
			resolve(canvas.toDataURL("image/png", 1.0))
		}
		img.onerror = reject
		img.src = svgDataUrl
	})
}

const MermaidBlockContainer = styled.div`
	position: relative;
	margin: 8px 0;
	padding: 0;
	background: transparent;
	border: none;
	box-shadow: none;
`

const LoadingMessage = styled.div`
	padding: 2px 2px 10px;
	color: var(--vscode-descriptionForeground);
	font-size: 12px;
	letter-spacing: 0.01em;
`

const ErrorShell = styled.div`
	overflow: hidden;
	border-radius: 12px;
	border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 24%, var(--vscode-editorGroup-border));
	background: linear-gradient(
		180deg,
		color-mix(in srgb, var(--vscode-editorWarning-foreground) 7%, var(--vscode-editor-background)) 0%,
		color-mix(in srgb, var(--vscode-editor-background) 96%, transparent) 100%
	);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
`

const CopyButton = styled.button`
	padding: 3px;
	height: 24px;
	margin-right: 4px;
	color: var(--vscode-editor-foreground);
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: 1px solid transparent;
	border-radius: 8px;
	cursor: pointer;
	transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;

	&:hover {
		opacity: 1;
		background: color-mix(in srgb, var(--vscode-editor-foreground) 7%, transparent);
		border-color: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
	}
`

interface SvgContainerProps {
	$isLoading: boolean
	$isExpanded: boolean
}

const SvgContainer = styled.div<SvgContainerProps>`
	opacity: ${(props) => (props.$isLoading ? 0.3 : 1)};
	min-height: 96px;
	padding: 0;
	transition: opacity 0.2s ease;
	cursor: pointer;
	display: flex;
	justify-content: center;
	align-items: center;
	max-height: ${(props) => (props.$isExpanded ? "none" : `${MERMAID_MAX_HEIGHT}px`)};
	overflow: hidden;
	border-radius: 0;
	border: none;
	background: transparent;
	box-shadow: none;

	/* Ensure the SVG scales within the container */
	& > svg {
		display: block; /* Ensure block layout */
		width: 100%;
		height: auto;
		max-width: min(100%, 560px);
		max-height: ${(props) => (props.$isExpanded ? "none" : `${MERMAID_MAX_HEIGHT - 24}px`)}; /* Respect container's max-height */
		margin: 0 auto;
		filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15));
	}
`

const DiagramSurface = styled.div`
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 8px;
`

const OverflowHint = styled.div`
	position: absolute;
	left: 12px;
	right: 12px;
	bottom: 12px;
	height: 72px;
	pointer-events: none;
	background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.6) 100%);
	background: linear-gradient(
		180deg,
		color-mix(in srgb, var(--vscode-editor-background) 0%, transparent) 0%,
		color-mix(in srgb, var(--vscode-editor-background) 75%, rgba(0, 0, 0, 0.7)) 100%
	);
	z-index: 5;
	border-radius: 0 0 12px 12px;
`

const ExpandRow = styled.div`
	margin-top: 8px;
	display: flex;
	justify-content: flex-end;
`

const ExpandButton = styled.button`
	border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
	background: color-mix(in srgb, var(--vscode-editor-background) 92%, rgba(255, 255, 255, 0.03));
	color: var(--vscode-foreground);
	font-size: 11.5px;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	padding: 5px 12px;
	border-radius: 999px;
	gap: 6px;
	display: inline-flex;
	align-items: center;
	cursor: pointer;
	transition: transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;

	&:hover {
		transform: translateY(-1px);
		border-color: var(--vscode-focusBorder);
		background: color-mix(in srgb, var(--vscode-editor-background) 85%, rgba(255, 255, 255, 0.06));
	}

	.codicon {
		font-size: 12px;
	}
`
