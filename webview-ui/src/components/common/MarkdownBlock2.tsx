import React, { memo, useMemo, useRef, createContext, useContext } from "react"
import ReactMarkdown from "react-markdown"
import styled, { keyframes, css } from "styled-components"
import { visit } from "unist-util-visit"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import remarkGfm from "remark-gfm"
import { Globe } from "lucide-react"

import { vscode } from "@src/utils/vscode"

import CodeBlock from "../kilocode/common/CodeBlock" // kilocode_change
import MermaidBlock from "./MermaidBlock"
import { FileIcon } from "../chat/tools/FileIcon"

// ═══════════════════════════════════════════════════════
// ██ V I B E   S Y S T E M — Inline text effects     ██
// ═══════════════════════════════════════════════════════
// Syntax: ~effect content here~
// Examples: ~glitch oh snap~ | ~neon I'm glowing~ | ~cyberpunk hack the planet~
// Multi: ~glitch:cyberpunk double trouble~

const vibePulsePro = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.82; }
`
const vibeFloating = keyframes`
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
`
const vibeRainbowPro = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`
const vibeGlitchDrift = keyframes`
  0%, 87%, 100% { transform: translate(0, 0); clip-path: none; text-shadow: none; }
  88% { transform: translate(-2px, 0); clip-path: polygon(0 20%, 100% 20%, 100% 40%, 0 40%); text-shadow: 2px 0 0 rgba(255,0,180,0.7), -2px 0 0 rgba(0,240,255,0.7); }
  89% { transform: translate(2px, 0); clip-path: polygon(0 55%, 100% 55%, 100% 75%, 0 75%); text-shadow: -2px 0 0 rgba(255,0,180,0.7), 2px 0 0 rgba(0,240,255,0.7); }
  90% { transform: translate(0, 0); clip-path: none; text-shadow: none; }
  94%, 96% { transform: translate(1px, 0); text-shadow: -1px 0 0 rgba(255,0,180,0.5), 1px 0 0 rgba(0,240,255,0.5); }
  95%, 97% { transform: translate(-1px, 0); text-shadow: 1px 0 0 rgba(255,0,180,0.5), -1px 0 0 rgba(0,240,255,0.5); }
`
const vibeSheen = keyframes`
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
`
const vibeBeating = keyframes`
  0%, 100% { opacity: 0.75; text-shadow: none; }
  50% { opacity: 1; text-shadow: 0 0 12px currentColor, 0 0 4px currentColor; }
`
const vibeEmphasisPulse = keyframes`
  0%, 100% { color: inherit; text-shadow: none; font-weight: inherit; }
  50% { color: #ffffff; text-shadow: 0 0 16px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.6); font-weight: 700; }
`
const vibeShout = keyframes`
  0%, 100% { color: inherit; text-shadow: none; }
  6%  { color: #ffffff; text-shadow: 0 0 20px rgba(255,255,255,1), 0 0 6px rgba(255,200,100,0.8); }
  12% { color: inherit; text-shadow: none; }
  18% { color: #fff5cc; text-shadow: 0 0 14px rgba(255,220,100,0.8); }
  24% { color: inherit; text-shadow: none; }
`
const vibeFlickerPro = keyframes`
  0%, 19%, 21%, 23%, 52%, 56%, 100% { opacity: 1; }
  20%, 22%, 54% { opacity: 0.75; }
`
const vibeChromShift = keyframes`
  0%, 100% { text-shadow: 0.8px 0 0 rgba(255,60,60,0.45), -0.8px 0 0 rgba(60,220,255,0.45); }
  33% { text-shadow: -0.8px 0 0 rgba(255,60,60,0.45), 0.8px 0 0 rgba(60,220,255,0.45); }
  66% { text-shadow: 0 0.8px 0 rgba(255,60,60,0.35), 0 -0.8px 0 rgba(60,220,255,0.35); }
`
const vibeShimmerPro = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`
const vibeLiquid = keyframes`
  0%, 100% { transform: scale(1, 1); }
  30% { transform: scale(0.97, 1.03); }
  60% { transform: scale(1.03, 0.97); }
`

// Map of effect name → CSS
const VIBE_EFFECTS: Record<string, ReturnType<typeof css>> = {
	glitch: css`
		animation: ${vibeGlitchDrift} 6s infinite;
		display: inline-block;
	`,
	shimmer: css`
		background: linear-gradient(
			90deg,
			color-mix(in srgb, currentColor 70%, transparent) 0%,
			rgba(255,255,255,0.95) 40%,
			rgba(220,220,255,0.85) 50%,
			rgba(255,255,255,0.95) 60%,
			color-mix(in srgb, currentColor 70%, transparent) 100%
		);
		background-size: 300% 100%;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: ${vibeShimmerPro} 5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
		font-weight: 600;
	`,
	bounce: css`animation: ${vibeFloating} 2.4s infinite cubic-bezier(0.37, 0, 0.63, 1);`,
	pulse: css`animation: ${vibePulsePro} 3s infinite ease-in-out;`,
	wave: css`animation: ${vibeLiquid} 4s infinite ease-in-out;`,
	rainbow: css`
		background: linear-gradient(to right, #ff6b6b, #ffa94d, #ffe066, #69db7c, #4dabf7, #cc5de8);
		background-size: 300% auto;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: ${vibeRainbowPro} 8s linear infinite;
	`,
	neon: css`
		animation: ${vibeFlickerPro} 5s infinite;
		filter: drop-shadow(0 0 5px currentColor);
	`,
	fire: css`
		color: #ff6b35;
		text-shadow: 0 0 8px rgba(255,107,53,0.5), 0 0 16px rgba(255,60,0,0.25);
		animation: ${vibePulsePro} 2s infinite ease-in-out;
	`,
	shake: css`animation: ${vibeLiquid} 0.8s infinite;`,
	slide: css`animation: ${vibeLiquid} 1s ease-out both;`,
	fade: css`animation: ${vibePulsePro} 2s ease-out both;`,
	chromatic: css`animation: ${vibeChromShift} 6s infinite linear;`,
	emphasis: css`
		animation: ${vibeEmphasisPulse} 4s ease-in-out infinite;
	`,
	pop: css`animation: ${vibeBeating} 5s ease-in-out infinite;`,
	whisperEffect: css`opacity: 0.55; animation: ${vibePulsePro} 5s infinite ease-in-out;`,
	gentle: css`animation: ${vibeFloating} 5s infinite cubic-bezier(0.37, 0, 0.63, 1);`,
	shoutEffect: css`
		animation: ${vibeShout} 1.8s ease-in-out infinite;
		font-weight: 700;
	`,
	spotlight: css`
		background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%);
		background-size: 300% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		animation: ${vibeSheen} 4s infinite ease-in-out;
	`,
	echo: css`
		position: relative;
		&::before {
			content: attr(data-content);
			position: absolute;
			top: 0; left: 0; opacity: 0.2;
			transform: scale(1.05);
			filter: blur(3px);
			animation: ${vibePulsePro} 4s infinite;
			pointer-events: none;
		}
	`,
}

const VIBE_STYLES: Record<string, string> = {
	neon: "color: #00ffcc; font-weight: 600; filter: drop-shadow(0 0 10px rgba(0,255,204,0.4));",
	retro: "color: #e8a45a; font-family: var(--vscode-editor-font-family, 'SF Mono', monospace); font-size: 0.88em; font-weight: 500; border-bottom: 1.5px solid rgba(232,164,90,0.4); padding-bottom: 0.5px;",
	cyberpunk: "color: #00fff9; font-weight: 800; text-transform: uppercase; font-style: italic; background: linear-gradient(90deg, #ff00c1, #00fff9); -webkit-background-clip: text; -webkit-text-fill-color: transparent;",
	holographic: "background: linear-gradient(135deg, #00f2ff, #006aff, #7000ff, #ff00c1, #00f2ff); background-size: 400% 400%; -webkit-background-clip: text; -webkit-text-fill-color: transparent;",
	terminal: "color: #4ade80; font-family: var(--vscode-editor-font-family, 'SF Mono', monospace); font-size: 0.875em; font-weight: 500; background: rgba(74,222,128,0.07); border: 0.5px solid rgba(74,222,128,0.18); border-radius: 4px; padding: 0.1em 0.45em; letter-spacing: 0.01em;",
	frost: "color: #ffffff; text-shadow: 0 0 10px rgba(0,212,255,0.6); font-weight: 500; font-style: italic;",
	inferno: "color: #ff6347; text-shadow: 0 0 6px rgba(255,99,71,0.4), 0 0 12px rgba(255,0,0,0.2); font-weight: 700;",
	galaxy: "background: linear-gradient(90deg, #9d50bb, #6e48aa, #2b2d42); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 600;",
	gold: "background: linear-gradient(to bottom, #bf953f, #fcf6ba, #b38728, #fbf5b7, #aa771c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));",
	dark: "color: rgba(255,255,255,0.9); font-weight: 200; letter-spacing: 0.1em; opacity: 0.8;",
	vapor: "font-family: 'Futura', sans-serif; font-weight: 900; background: linear-gradient(180deg, #ff71ce 0%, #01cdfe 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-style: italic; letter-spacing: -0.05em;",
	pro: "letter-spacing: -0.04em; font-weight: 800; background: linear-gradient(180deg, #fff 0%, #aaa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));",
	glass: "position: relative; padding: 1px 8px; border-radius: 20px; &::before { content: ''; position: absolute; inset: 0; background: rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: -1; }",
	loud: "font-weight: 800; font-size: 1.1em; letter-spacing: -0.01em; text-transform: uppercase;",
	quiet: "font-weight: 300; opacity: 0.5; font-size: 0.85em; letter-spacing: 0.05em; display: inline-block; transform: scale(0.95);",
	big: "font-size: 1.15em; font-weight: 700;",
	huge: "font-size: 1.25em; font-weight: 800; letter-spacing: -0.02em;",
	mega: "font-size: 1.4em; font-weight: 950; line-height: 1.0; letter-spacing: -0.03em; text-transform: uppercase; background: linear-gradient(to bottom, #fff, #999); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));",
	shout: "font-size: 1.35em; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; color: #ffffff; text-shadow: 0 1px 8px rgba(255,255,255,0.25);",
}

const VibeSpan = styled.span<{ $effects: string[]; $styles: string[] }>`
  display: inline-block;
  vertical-align: baseline;
  position: relative;
  isolation: isolate;
  ${({ $styles }) => $styles.map(s => VIBE_STYLES[s] || "").join("\n")}
  ${({ $effects }) => $effects.map(e => VIBE_EFFECTS[e])}
`

const VIBE_KEYWORDS = new Set([
	...Object.keys(VIBE_EFFECTS),
	...Object.keys(VIBE_STYLES),
	"happy", "sad", "angry", "excited", "cool", "spooky", "shout", "whisper",
])

// Remark plugin: intercepts GFM delete nodes (~text~) and converts
// them to vibe nodes in the AST when the text starts with a known vibe keyword.
// e.g. ~glitch hello world~ becomes a node that renders as <vibe data-tags="glitch">hello world</vibe>
// Regular strikethrough like ~oops~ is left untouched.
function remarkVibe() {
	return (tree: any) => {
		visit(tree, "delete", (node: any, index: any, parent: any) => {
			if (!parent || index == null) return

			// Extract the full text content from the delete node's children
			const textParts: string[] = []
			for (const child of node.children) {
				if (child.type === "text") textParts.push(child.value)
				else if (child.type === "inlineCode") textParts.push(child.value)
			}
			const fullText = textParts.join("")

			// Check if it starts with a vibe keyword (e.g. "glitch hello" or "fire:inferno yo")
			const match = fullText.match(/^([a-zA-Z][a-zA-Z0-9:]*?)\s+(.+)$/s)
			if (!match) return // Not a vibe pattern, leave as strikethrough

			const tagPart = match[1]
			const tags = tagPart.split(":")
			const isVibe = tags.some(t => VIBE_KEYWORDS.has(t))
			if (!isVibe) return // No recognized keywords, leave as strikethrough

			const content = match[2]

			// Transform the node into a 'vibe' element for the renderer
			node.type = "vibe"
			node.data = {
				hName: "vibe",
				hProperties: {
					"data-tags": tags.join(":"),
				},
			}
			// Replace children with the stripped content
			node.children = [{ type: "text", value: content }]
		})
	}
}

// Component that renders <vibe> tags with effects
const VibeRenderer = ({ children, ...props }: any) => {
	const tagsStr = props["data-tags"] || ""
	let tags = tagsStr.split(":").filter(Boolean)

	// Emotion Mapping Engine
	if (tags.includes("happy")) tags = [...new Set([...tags, "rainbow", "gentle"])]
	if (tags.includes("sad")) tags = [...new Set([...tags, "fade", "dark"])]
	if (tags.includes("angry")) tags = [...new Set([...tags, "fire", "shake", "inferno"])]
	if (tags.includes("excited")) tags = [...new Set([...tags, "emphasis", "bounce", "neon"])]
	if (tags.includes("cool")) tags = [...new Set([...tags, "gentle", "frost", "pro"])]
	if (tags.includes("spooky")) tags = [...new Set([...tags, "glitch", "dark", "echo"])]
	if (tags.includes("shout")) tags = [...new Set([...tags, "shout"])]
	if (tags.includes("whisper")) tags = [...new Set([...tags, "whisperEffect", "quiet"])]

	const effects = tags.filter((t: string) => t in VIBE_EFFECTS)
	const styles = tags.filter((t: string) => t in VIBE_STYLES)

	// Convert children to text for data-content attribute (used by pseudo-elements)
	const content = React.Children.toArray(children)
		.map(child => (typeof child === "string" ? child : ""))
		.join("")

	return <VibeSpan $effects={effects} $styles={styles} data-content={content}>{children}</VibeSpan>
}

const LinkContext = createContext<boolean>(false)

interface MarkdownBlockProps {
	markdown?: string
	className?: string
	filePaths?: string[]
	cwd?: string
}

const StyledMarkdown = styled.div<{ $isStreaming?: boolean }>`
	/* ══════════════════════════════════════════════
	   ██  G O D - T I E R   T Y P O G R A P H Y  ██
	   ══════════════════════════════════════════════ */

	/* ── Foundation ── */
	line-height: 1.50;
	font-size: 13.6px;
	font-family: var(--vscode-editor-system-font-family);
	color: var(--vscode-editor-foreground);
	-webkit-font-smoothing: subpixel-antialiased;
	font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "dlig" 1, "ss01" 1, "ss02" 1;
	font-synthesis: none;
	word-spacing: 0.001em;
	letter-spacing: 0.000em;
	min-height: 0;
	display: block;
	will-change: transform;
	backface-visibility: visible;
	position: relative;
	font-weight: 460;

	${({ $isStreaming }) =>
		$isStreaming &&
		`
		animation: streaming-text-fade 0.5s ease-out forwards;
	`}

	
	/* ── Base Weight ── */
	/* Removed overly aggressive * { font-weight: 400; } to allow inherited bolding */

	/* ── Emphasis ── */
	strong {
		font-weight: 660;
		color: var(--vscode-editor-foreground);
		letter-spacing: -0.000em;
		transition: none;
		position: relative;
	}

	em {
		font-style: italic;
		color: inherit;
	}

	/* ── Inline Code ── */
	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family, "SF Mono", Monaco, Inconsolata, "Roboto Mono", monospace);
		font-size: 0.86em;
		font-weight: 520;
		color: var(--vscode-symbolIcon-keywordForeground);
		background-color: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
		padding: 0.14em 0.38em;
		border-radius: 3.5px;
		border: 0.4px solid color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: anywhere;
		font-variant-numeric: tabular-nums;
		font-feature-settings: "tnum" 1, "lnum" 1;
		letter-spacing: 0.01em;
		transition: background-color 0.2s ease, border-color 0.2s ease;
		position: relative;

		&:hover {
			background-color: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			border-color: color-mix(in srgb, var(--vscode-symbolIcon-keywordForeground) 12%, transparent);
		}
	}

	/* ── Heading Hierarchy ──
	   Scale: 1.5 / 1.22 / 1.05 / 0.92  (Major Third-ish)
	   Weight descends: 700 → 660 → 700 → 680
	   Letter-spacing tightens with size (optical correction)
	   Top margin > bottom margin (binds heading to its content)
	*/
	h1, h2, h3, h4 {
		color: var(--vscode-editor-foreground);
		line-height: 1.25;
		font-feature-settings: "kern" 1, "liga" 1;
		position: relative;
		transition: all 0.2s ease;
	}

	h1 {
		font-size: 1.5em;
		font-weight: 700;
		letter-spacing: -0.025em;
		margin: 1.6em 0 0.55em 0;
	}

	h2 {
		font-size: 1.22em;
		font-weight: 660;
		letter-spacing: -0.018em;
		margin: 1.4em 0 0.45em 0;
		text-shadow: 0 1px 1px color-mix(in srgb, var(--vscode-editor-foreground) 5%, transparent);
	}

	h3 {
		font-size: 1.05em;
		font-weight: 700;
		letter-spacing: -0.008em;
		margin: 1.25em 0 0.35em 0;
		text-shadow: 0 1px 1px color-mix(in srgb, var(--vscode-editor-foreground) 3%, transparent);
	}

	h4 {
		font-size: 0.92em;
		font-weight: 680;
		letter-spacing: 0.005em;
		text-transform: none;
		margin: 1.1em 0 0.3em 0;
		color: var(--vscode-editor-foreground);
		text-shadow: 0 1px 1px color-mix(in srgb, var(--vscode-editor-foreground) 2%, transparent);
	}

	/* Heading hover effects — intentionally minimal */
	h1:hover, h2:hover, h3:hover, h4:hover {
		color: var(--vscode-editor-foreground);
	}

	/* First child heading: no top gap */
	> h1:first-child,
	> h2:first-child,
	> h3:first-child,
	> h4:first-child {
		margin-top: 0;
	}

	/* Heading immediately after heading: tighten */
	h1 + h2 { margin-top: 0.4em; }
	h2 + h3 { margin-top: 0.35em; }
	h3 + h4 { margin-top: 0.3em; }

	/* Heading immediately before table: tighten and add visual connection */
	h1:has(+ table),
	h2:has(+ table),
	h3:has(+ table),
	h4:has(+ table) {
		margin-bottom: 0.2em;
	}

	/* Table immediately after heading: enhanced styling */
	h1 + table,
	h2 + table,
	h3 + table,
	h4 + table {
		margin-top: 0.2em;
		border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
		border-radius: 5px;
		overflow: hidden;
		box-shadow: 0 1px 3px color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
	}

	/* ── Paragraph & Block Spacing ── */
	p {
		margin: 0.55em 0;
		display: block;
		hanging-punctuation: first allow-end last;
		text-indent: 0;
		orphans: 2;
		widows: 2;
		position: relative;
	}

	${({ $isStreaming }) =>
		$isStreaming &&
		`
		p, li, strong, em, code, span {
			animation: streaming-text-fade 0.2s ease-out forwards;
		}
	`}

	p:first-child {
		margin-top: 0;
	}

	p:last-child {
		margin-bottom: 0;
	}

	p > span {
		display: inline;
		line-height: inherit;
	}

	/* ── Lists ── */
	ul, ol {
		margin: 0.5em 0;
		padding-left: 1.5em;
		list-style-position: outside;
	}

	ol {
		list-style-type: decimal;
	}

	ul {
		list-style-type: disc;
	}

	/* Nested list markers */
	ul ul { list-style-type: circle; }
	ul ul ul { list-style-type: square; }
	ol ol { list-style-type: lower-alpha; }
	ol ol ol { list-style-type: lower-roman; }

	li::marker {
		color: color-mix(in srgb, var(--vscode-editor-foreground) 38%, transparent);
		font-weight: 450;
	}

	ol > li::marker {
		font-variant-numeric: tabular-nums;
		font-size: 0.92em;
	}

	li {
		margin: 0 0 0.25em 0;
		padding-left: 0.2em;
		line-height: 1.6;
	}

	li:last-child {
		margin-bottom: 0;
	}

	/* Nested lists: tighter */
	li > ul, li > ol {
		margin: 0.15em 0 0.05em 0;
	}

	/* ── Blockquote ── */
	blockquote {
		margin: 0.75em 0;
		padding: 0.4em 1em;
		border-left: 2.5px solid color-mix(in srgb, var(--vscode-editor-foreground) 14%, transparent);
		background-color: color-mix(in srgb, var(--vscode-editor-foreground) 3%, transparent);
		border-radius: 0 5px 5px 0;
		color: color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
		font-style: italic;
		transition: border-left-color 0.25s ease, background-color 0.25s ease;
		position: relative;

		&:hover {
			background-color: color-mix(in srgb, var(--vscode-editor-foreground) 5%, transparent);
			border-left-color: color-mix(in srgb, var(--vscode-editor-foreground) 28%, transparent);
		}

		p {
			margin: 0.3em 0;
		}

		/* Nested blockquotes */
		blockquote {
			margin: 0.4em 0;
			border-left-color: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
		}
	}

	/* ── Links ── */
	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 25%, transparent);
		transition: color 0.2s ease, border-bottom-color 0.2s ease;
		font-weight: 460;
		position: relative;

		&:hover {
			color: var(--vscode-textLink-activeForeground);
			border-bottom-color: var(--vscode-textLink-activeForeground);
		}
	}

	/* ── Text Selection ── */
	::selection {
		background-color: color-mix(in srgb, var(--vscode-editor-foreground) 20%, transparent);
		color: var(--vscode-editor-background);
		text-shadow: none;
	}

	/* ── Focus Visible ── */
	:focus-visible {
		outline: 2px solid color-mix(in srgb, white 30%, transparent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* ── Horizontal Rule ── */
	hr {
		border: none;
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent 0%,
			color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent) 15%,
			color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent) 85%,
			transparent 100%
		);
		margin: 1.4em 0;
	}

	/* ── KaTeX & Math ── */
	.katex {
		font-size: 1.1em;
		color: var(--vscode-editor-foreground);
		font-family: KaTeX_Main, "Times New Roman", serif;
		line-height: 1.2;
		white-space: normal;
		text-indent: 0;
	}

	.katex-display {
		display: block;
		margin: 0.6em 0;
		text-align: center;
		padding: 0.6em;
		overflow-x: auto;
		overflow-y: hidden;
		background-color: var(--vscode-textCodeBlock-background);
		border-radius: 4px;
	}

	.katex-error {
		color: var(--vscode-errorForeground);
	}

	/* ── Code Blocks ── */
	pre {
		min-height: 1.5em;
		transition: height 0.2s ease-out;
	}

	div:has(> pre) {
		position: relative;
		contain: layout style;
		padding: 0.5em 0;
	}

	/* ── Tables ── */
	table {
		border-collapse: collapse;
		border-spacing: 0;
		margin: 0.5em 0;
		width: 100%;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		border: 0.4px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
		border-radius: 7px;
		box-shadow: 0 0px 0px color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
	}

	th, td {
		padding: 7px 12px;
		text-align: left;
		border: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		white-space: normal;
		overflow-wrap: break-word;
		word-break: break-word;
		min-width: 60px;
		max-width: 300px;
	}

	th {
		background-color: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
		font-weight: 620;
		font-size: 0.92em;
		letter-spacing: 0.01em;
		color: var(--vscode-editor-foreground);
		text-align: left;
	}

	td:first-child {
		font-weight: 500;
	}

	tr:hover td {
		background-color: color-mix(in srgb, var(--vscode-foreground) 3%, transparent);
	}
`

const FileLink = styled.a`
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 0;
	margin: 0;
	background-color: transparent !important;
	color: #4DAAFC !important;
	text-decoration: none !important;
	border-bottom: none !important;
	border: none !important;
	font-family: "Menlo", Monaco, Consolas, "Courier New", monospace !important;
	font-size: 12.95px !important;

	.reasoning-content & {
		font-size: 11.5px !important;
	}

	cursor: pointer;
	vertical-align: baseline;
	transition: all 0.15s ease;
	white-space: normal;
	word-break: break-all;
	overflow-wrap: anywhere;

	/* Precise position adjustment */
	position: relative;
	top: 3.74px; 
	left: 0px; 

	&:hover, &:focus, &:active {
		background-color: color-mix(in srgb, var(--vscode-badge-background) 0%, transparent);
		color: var(--vscode-textLink-activeForeground) !important;
		text-decoration: none !important;
		outline: none !important;
		box-shadow: none !important;
		border: none !important;
	}

	.file-icon {
		flex-shrink: 0;
		opacity: 0.85;
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		transform: translateY(-0.5px);
	}
`

const WebLink = styled.a`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 1px 6px;
	margin: 0 2px;
	background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, transparent);
	color: var(--vscode-textLink-foreground) !important;
	text-decoration: none !important;
	border-radius: 4px;
	font-size: 13.5px;
	font-weight: 500;
	transition: all 0.2s ease;
	vertical-align: middle;
	position: relative;
	top: -1px;

	&:hover {
		background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
		color: var(--vscode-textLink-activeForeground) !important;
		transform: translateY(-1px);
	}

	.globe-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		color: var(--vscode-testing-iconPassed);
		opacity: 0.8;
	}
`

const mentionRegexSource = /(?:^|(?<=\s))(?<!\\)@(?:(?:\/|\w+:\/\/)(?:[^\s\\]|\\ )+?|[\w\.-]+\.[a-zA-Z0-9]{2,10}|[a-f0-9]{7,40}\b|problems\b|git-changes\b|terminal\b)(?=[.,;:!?]?(?=[\s\r\n]|$))/.source
const absolutePathRegexSource = /(?:(?<=^|[\s\(\)\[\]\{\}'"`])(?:[a-zA-Z]:[\\/]|[\\/]))[^:?*"<>|\s]+(?:\.[a-zA-Z0-9]+)+(?::\d+)?/.source
// Matches things that look like source files, including paths with slashes.
// Requires at least one letter and a 2-10 char extension.
const genericFileRegexSource = /\b[\w\.\-\/\\]*[a-zA-Z][\w\.\-\/\\]*\.[a-zA-Z0-9]{2,10}\b(?::\d+)?/.source

const useLinkregex = (filePaths: string[] = []) => {
	// PERF: Track previous files to avoid reprocessing when nothing changed
	const prevFilesRef = useRef<string[]>()
	const prevResultRef = useRef<{ masterRegex: RegExp; basenameToPaths: Map<string, string[]> }>()
	
	return useMemo(() => {
		// Check if files actually changed (deep comparison)
		const filesChanged = !prevFilesRef.current || 
			prevFilesRef.current.length !== filePaths.length ||
			prevFilesRef.current.some((file: string, i: number) => file !== filePaths[i])
		
		// If no changes, return cached result
		if (!filesChanged && prevResultRef.current) {
			return prevResultRef.current
		}
		
		// Prepare workspace matches
		const basenameToPaths = new Map<string, string[]>()

		// PERF: Limit to first 1000 files to prevent severe performance issues in large codebases
		// Processing 10k+ files on every render causes the entire chat to freeze
		const limitedFilePaths = filePaths.slice(0, 1000)

		if (limitedFilePaths && limitedFilePaths.length > 0) {
			limitedFilePaths.forEach(fp => {
				const basename = fp.split(/[\\/]/).pop()
				if (basename && basename.length > 2) {
					if (!basenameToPaths.has(basename)) basenameToPaths.set(basename, [])
					basenameToPaths.get(basename)!.push(fp)
				}
			})
		}

		// We no longer include all workspace paths in the regex to avoid hitting limits
		// with large projects. Instead, we rely on the generic file regex and resolve
		// candidates using basenameToPaths.
		const branches = [
			mentionRegexSource,
			absolutePathRegexSource,
			genericFileRegexSource,
		]

		const result = {
			masterRegex: new RegExp(branches.join("|"), "g"),
			basenameToPaths
		}
		
		// Cache the result for next time
		prevFilesRef.current = filePaths
		prevResultRef.current = result
		
		return result
	}, [filePaths])
}

// Linkification moved to Remark plugin for performance

// recursive renderChildren removed for performance

const TableScrollWrapper = styled.div`
	overflow-x: auto;
	margin: 0.75rem 0;
	max-width: 100%;
	display: block;
	border-radius: 8px;
	border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);

	&::-webkit-scrollbar {
		height: 4px;
	}
	&::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
		border-radius: 10px;
	}
`

const MarkdownBlock = memo(({ markdown, className, filePaths, cwd, isStreaming }: MarkdownBlockProps & { isStreaming?: boolean }) => {
	const { masterRegex, basenameToPaths } = useLinkregex(filePaths)
	const components = useMemo(
		() => ({
			p: ({ children }: any) => {
				return <p>{children}</p>
			},
			li: ({ children }: any) => {
				return <li>{children}</li>
			},
			table: ({ children, ...props }: any) => {
				return (
					<TableScrollWrapper>
						<table {...props}>{children}</table>
					</TableScrollWrapper>
				)
			},
			a: ({ href, children, ...props }: any) => {
				const isInsideLink = useContext(LinkContext)
				if (isInsideLink) return <>{children}</>

				const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
					const isLocalPath = href?.startsWith("file://") || href?.startsWith("/") || !href?.includes("://")
					if (!isLocalPath) return
					e.preventDefault()

					let filePath = href.replace("file://", "")

					// Dynamic resolution: if it's a basename, find the full path
					const basename = filePath.split(/[\\/]/).pop()
					if (basename && basenameToPaths.has(basename)) {
						const paths = basenameToPaths.get(basename)!
						if (paths.length > 0 && !paths.includes(filePath)) {
							filePath = paths[0]
						}
					}

					const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
					let values = undefined
					if (match) {
						filePath = match[1]
						values = { line: parseInt(match[2]) }
					}

					const isAbsolute = filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath)

					vscode.postMessage({ type: "openFile", text: filePath, values })
				}

				const isLocal = href?.startsWith("file://") || href?.startsWith("/") || !href?.includes("://")

				if (isLocal) {
					return (
						<FileLink {...props} href={href} onClick={handleClick}>
							<span className="file-icon">
								<FileIcon fileName={href} size={16} />
							</span>
							<LinkContext.Provider value={true}>{children}</LinkContext.Provider>
						</FileLink>
					)
				} else {
					return (
						<WebLink {...props} href={href} target="_blank" rel="noopener noreferrer">
							<Globe size={13} style={{ flexShrink: 0 }} />
							<LinkContext.Provider value={true}>{children}</LinkContext.Provider>
						</WebLink>
					)
				}
			},
			pre: ({ children, ..._props }: any) => {
				const codeEl = children as React.ReactElement
				if (!codeEl || !codeEl.props) return <pre>{children}</pre>

				const { className = "", children: codeChildren } = codeEl.props
				let codeString = ""
				if (typeof codeChildren === "string") {
					codeString = codeChildren
				} else if (Array.isArray(codeChildren)) {
					codeString = codeChildren.filter((child) => typeof child === "string").join("")
				}

				if (className.includes("language-mermaid")) {
					if (!codeString.trim()) return null
					return (
						<div style={{ margin: "0.5rem 0" }}>
							<MermaidBlock code={codeString} />
						</div>
					)
				}

				const match = /language-(\w+)/.exec(className)
				const language = match ? match[1] : "text"
				const isInternalTool = language === "tool" || language === "cmd" || className.toLowerCase().includes("tool") || className.toLowerCase().includes("cmd") || codeString.includes("<tool") || codeString.includes("<cmd")

				if (isInternalTool) return null
				if (!codeString.trim()) return null

				return (
					<div style={{ margin: "0.5rem 0" }}>
						<CodeBlock source={codeString} language={language} />
					</div>
				)
			},
			code: ({ children, className, ...props }: any) => {
				const isInsideLink = useContext(LinkContext)
				const isInline = !className
				if (!isInsideLink && isInline && typeof children === "string") {
					const text = children
					const isUrl = text.includes("://") || text.startsWith("www.") || /^[a-zA-Z0-9.-]+\.(com|org|net|edu|gov|io|ai|me|dev|app|info)$/.test(text)

					// Use the masterRegex already computed in the scope
					masterRegex.lastIndex = 0
					if (isUrl || masterRegex.test(text) || text.startsWith("file://") || text.startsWith("/")) {
						if (isUrl) {
							const href = text.startsWith("www.") ? `https://${text}` : text
							return (
								<code className={className} {...props} style={{ background: "transparent", padding: 0, border: "none" }}>
									<WebLink href={href} target="_blank" rel="noopener noreferrer">
										<span className="globe-icon">
											<Globe size={13} strokeWidth={2.5} />
										</span>
										{children}
									</WebLink>
								</code>
							)
						}

						let href = text
						if (!href.startsWith("file://") && !href.startsWith("/")) {
							// No longer prefixing with ./ as it breaks backend search fallback
						}
						if (!href.startsWith("file://")) href = "file://" + href

						const handleClick = (e: React.MouseEvent) => {
							e.preventDefault()
							let filePath = href.replace("file://", "")

							const basename = filePath.split(/[\\/]/).pop()
							if (basename && basenameToPaths.has(basename)) {
								const paths = basenameToPaths.get(basename)!
								if (paths.length > 0 && !paths.includes(filePath)) {
									filePath = paths[0]
								}
							}

							const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
							let values = undefined
							if (match) {
								filePath = match[1]
								values = { line: parseInt(match[2]) }
							}
							vscode.postMessage({ type: "openFile", text: filePath, values })
						}

						return (
							<code className={className} {...props} style={{ background: "transparent", padding: 0, border: "none" }}>
								<FileLink href={href} onClick={handleClick}>
									<span className="file-icon">
										<FileIcon fileName={href} size={16} />
									</span>
									{children}
								</FileLink>
							</code>
						)
					}
				}

				return (
					<code className={className} {...props}>
						{children}
					</code>
				)
			},
		}),
		[filePaths, cwd],
	)

	const remarkLinkify = useMemo(() => {
		return () => {
			return (tree: any) => {
				visit(tree, "text", (node: any, index: any, parent: any) => {
					if (parent && (parent.type === "link" || parent.type === "a")) return
					if (!node.value || !masterRegex) return
					const matches = Array.from(node.value.matchAll(masterRegex)) as RegExpMatchArray[]
					if (matches.length === 0) return

					const children: any[] = []
					let lastIndex = 0
					for (const match of matches) {
						if (match.index! > lastIndex) {
							children.push({ type: "text", value: node.value.slice(lastIndex, match.index) })
						}
						const text = match[0]
						let href: string | undefined
						const isUrl = text.includes("://") || text.startsWith("www.") || /^[a-zA-Z0-9.-]+\.(com|org|net|edu|gov|io|ai|me|dev|app|info)$/.test(text)

						if (text.startsWith("@")) {
							href = `file://${text.slice(1)}`
						} else if (isUrl) {
							href = text.startsWith("www.") ? `https://${text}` : text
						} else if (basenameToPaths.has(text)) {
							const paths = basenameToPaths.get(text)!
							if (paths.length > 0) {
								href = `file://${paths[0]}`
							}
						} else {
							href = `file://${text}`
						}

						children.push({
							type: "link",
							url: href,
							children: [{ type: "text", value: text }],
						})
						lastIndex = match.index! + text.length
					}
					if (lastIndex < node.value.length) {
						children.push({ type: "text", value: node.value.slice(lastIndex) })
					}
					parent.children.splice(index, 1, ...children)
				})
			}
		}
	}, [masterRegex, basenameToPaths])

	const processedMarkdown = useMemo(() => {
		if (!markdown) return ""
		// Escape $ followed by a digit (currency) to prevent remark-math misinterpretation
		// while leaving actual math ($$ or escaped \$) alone.
		return markdown.replace(/\$(?=\d)/g, "\\$")
	}, [markdown])

	return (
		<StyledMarkdown className={className} $isStreaming={isStreaming}>
			<ReactMarkdown
				remarkPlugins={[
					remarkGfm,
					remarkMath,
					remarkVibe,
					!isStreaming ? remarkLinkify : () => { },
					() => {
						return (tree: any) => {
							visit(tree, "code", (node: any) => {
								if (!node.lang) {
									node.lang = "text"
								} else if (node.lang.includes(".")) {
									node.lang = node.lang.split(".").slice(-1)[0]
								}
							})
						}
					},
				]}
				rehypePlugins={[rehypeKatex as any]}
				components={{ ...components, vibe: VibeRenderer } as any}>
				{processedMarkdown}
			</ReactMarkdown>
		</StyledMarkdown>
	)
})

export default MarkdownBlock
