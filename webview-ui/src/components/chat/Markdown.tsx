import { memo, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { Copy, Check } from "lucide-react"
import styled, { keyframes } from "styled-components"

import { useCopyToClipboard } from "@src/utils/clipboard"
import { StandardTooltip } from "@src/components/ui"

import MarkdownBlock from "../common/MarkdownBlock"

// Spring pop-in for checkmark
const springPopIn = keyframes`
	0% { transform: scale(0) rotate(-10deg); opacity: 0; }
	55% { transform: scale(1.2) rotate(3deg); opacity: 1; }
	100% { transform: scale(1) rotate(0deg); opacity: 1; }
`

const CheckWrapper = styled.span`
	display: inline-flex;
	animation: ${springPopIn} 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
`

export const Markdown = memo(({ markdown, partial, filePaths, cwd }: { markdown?: string; partial?: boolean; filePaths?: string[]; cwd?: string }) => {
	const [isHovering, setIsHovering] = useState(false)
	const [hasCopied, setHasCopied] = useState(false)

	// Shorter feedback duration for copy button flash.
	const { copyWithFeedback } = useCopyToClipboard(200)

	if (!markdown || markdown.length === 0) {
		return null
	}

	// kilocode_change: surgically strip "cancer blocks" (redundant protocol noise and script echoes)
	// We do this globally in Markdown component to catch leaks in all message types.
	const cleanMarkdown = markdown
		.replace(/```(?:tool|cmd)[\s\S]*?```/g, "")
		.replace(/<(?:tool|cmd|cmd_execution)[\s\S]*?<\/(?:tool|cmd|cmd_execution)>/g, "")
		.replace(/\[execute_command for[\s\S]*?\] Result:/g, "")
		.replace(/"?Command:"?\s*(.*?)(?:\nOutput:[\s\S]*|(?:\n|$))/gi, "$1") // Simplify matches and handle quotes
		.replace(/Output:Command:\s*[\s\S]*/i, "")
		.replace(/\{"type"\s*:\s*"use_mcp_tool"[\s\S]*?\}\s*"?\}?/g, "")
		.trim()

	if (cleanMarkdown === "" || cleanMarkdown === "---" || cleanMarkdown === "***" || cleanMarkdown === "___") {
		return null
	}

	return (
		<div
			onMouseEnter={() => setIsHovering(true)}
			onMouseLeave={() => setIsHovering(false)}
			style={{ position: "relative", transform: "translateZ(0)", backfaceVisibility: "hidden", willChange: "transform" }}>
			<div style={{ wordBreak: "break-word", overflowWrap: "anywhere", textRendering: "optimizeLegibility" }}>
				<MarkdownBlock markdown={cleanMarkdown} filePaths={filePaths} cwd={cwd} isStreaming={partial} />
			</div>
			{markdown && !partial && isHovering && (
				<div
					style={{
						position: "absolute",
						bottom: "-4px",
						right: "8px",
						opacity: 0,
						animation: "fadeIn 0.2s ease-in-out forwards",
						borderRadius: "4px",
					}}>
					<style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1.0; } }`}</style>
					<StandardTooltip content="Copy as markdown">
						<VSCodeButton
							className="copy-button"
							appearance="icon"
							style={{
								height: "24px",
								border: "none",
								background: hasCopied ? "color-mix(in srgb, var(--vscode-button-background) 25%, transparent)" : "transparent",
								transition: "background 0.2s ease-in-out, transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
								color: hasCopied ? "white" : "var(--vscode-descriptionForeground)",
								transform: "scale(1)",
							}}
							onMouseOver={(e: any) => { e.currentTarget.style.transform = "scale(1.12)" }}
							onMouseOut={(e: any) => { e.currentTarget.style.transform = "scale(1)" }}
							onClick={async () => {
								const success = await copyWithFeedback(markdown)
								if (success) {
									setHasCopied(true)
									setTimeout(() => setHasCopied(false), 200) // Match the copyWithFeedback delay
								}
							}}>
							{hasCopied ? <CheckWrapper><Check size={14} /></CheckWrapper> : <Copy size={14} />}
						</VSCodeButton>
					</StandardTooltip>
				</div>
			)}
		</div>
	)
})
