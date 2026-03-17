import { memo, useState, useMemo, ReactNode } from "react"
import { ChevronDown, Copy, Check, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { cn } from "../../../lib/utils"

type CommandStatus = "pending" | "running" | "success" | "error"

interface CommandExecutionBlockProps {
	text: string
	isRunning?: boolean
	isLast?: boolean
	exitCode?: number
	terminalStatus?: string
}

/**
 * Parses the combined command+output text into separate parts.
 * The format is: "command\nOutput:\noutput_text"
 */
function parseCommandAndOutput(text: string | undefined): { command: string; output: string } {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	let output = text.slice(index + COMMAND_OUTPUT_STRING.length)

	// `combineCommandSequences` adds "\nOutput:" before output; real output often starts with a newline.
	output = output.replace(/^\n/, "")

	// Clean up output - remove leading "command_output" lines that may appear from message parsing
	const lines = output.split("\n")
	const cleanedLines = lines.filter((line) => line.trim() !== "command_output")
	output = cleanedLines.join("\n").replace(/\n+$/, "")

	return {
		command: text.slice(0, index).trim(),
		output,
	}
}

/**
 * Convert ANSI escape sequences to HTML using VS Code terminal theme variables.
 */
function ansiToHtml(str: string): string {
	if (!str) return ""

	// 1. Basic HTML escaping
	let html = str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")

	// 2. Comprehensive ANSI colors mapping using VSCode Terminal variables
	const colors: Record<number, string> = {
		// Foreground
		30: "color: var(--vscode-terminal-ansiBlack)",
		31: "color: var(--vscode-terminal-ansiRed)",
		32: "color: var(--vscode-terminal-ansiGreen)",
		33: "color: var(--vscode-terminal-ansiYellow)",
		34: "color: var(--vscode-terminal-ansiBlue)",
		35: "color: var(--vscode-terminal-ansiMagenta)",
		36: "color: var(--vscode-terminal-ansiCyan)",
		37: "color: var(--vscode-terminal-ansiWhite)",
		90: "color: var(--vscode-terminal-ansiBrightBlack)",
		91: "color: var(--vscode-terminal-ansiBrightRed)",
		92: "color: var(--vscode-terminal-ansiBrightGreen)",
		93: "color: var(--vscode-terminal-ansiBrightYellow)",
		94: "color: var(--vscode-terminal-ansiBrightBlue)",
		95: "color: var(--vscode-terminal-ansiBrightMagenta)",
		96: "color: var(--vscode-terminal-ansiBrightCyan)",
		97: "color: var(--vscode-terminal-ansiBrightWhite)",
		// Background
		40: "background-color: var(--vscode-terminal-ansiBlack)",
		41: "background-color: var(--vscode-terminal-ansiRed)",
		42: "background-color: var(--vscode-terminal-ansiGreen)",
		43: "background-color: var(--vscode-terminal-ansiYellow)",
		44: "background-color: var(--vscode-terminal-ansiBlue)",
		45: "background-color: var(--vscode-terminal-ansiMagenta)",
		46: "background-color: var(--vscode-terminal-ansiCyan)",
		47: "background-color: var(--vscode-terminal-ansiWhite)",
		100: "background-color: var(--vscode-terminal-ansiBrightBlack)",
		101: "background-color: var(--vscode-terminal-ansiBrightRed)",
		102: "background-color: var(--vscode-terminal-ansiBrightGreen)",
		103: "background-color: var(--vscode-terminal-ansiBrightYellow)",
		104: "background-color: var(--vscode-terminal-ansiBrightBlue)",
		105: "background-color: var(--vscode-terminal-ansiBrightMagenta)",
		106: "background-color: var(--vscode-terminal-ansiBrightCyan)",
		107: "background-color: var(--vscode-terminal-ansiBrightWhite)",
	}

	let openSpans = 0
	// Process escape sequences
	// eslint-disable-next-line no-control-regex
	html = html.replace(/\x1b\[([0-9;]*)m/g, (match, codesStr) => {
		const codes = codesStr.split(";").map((c: string) => parseInt(c) || 0)

		// Handle reset
		if (codes.includes(0)) {
			const res = "</span>".repeat(openSpans)
			openSpans = 0
			return res
		}

		const styles: string[] = []
		let i = 0
		while (i < codes.length) {
			const code = codes[i]
			if (colors[code]) {
				styles.push(colors[code])
			} else if (code === 1) {
				styles.push("font-weight: bold")
			} else if (code === 3) {
				styles.push("font-style: italic")
			} else if (code === 4) {
				styles.push("text-decoration: underline")
			} else if (code === 39) {
				styles.push("color: inherit")
			} else if (code === 49) {
				styles.push("background-color: inherit")
			} else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
				// 256 Color Support (38;5;n)
				const isBg = code === 48
				const index = codes[i + 2]
				if (index < 16) {
					// Map first 16 to theme variables
					const base = index < 8 ? 30 + index : 90 + (index - 8)
					if (colors[base])
						styles.push(
							colors[base].replace(
								isBg ? "color:" : "background-color:",
								isBg ? "background-color:" : "color:",
							),
						)
				} else {
					// Approximation for 256 colors beyond 16 (or fallback to grey)
					styles.push(`${isBg ? "background-" : ""}color: #888`)
				}
				i += 2
			} else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
				// TrueColor support (38;2;R;G;B)
				const isBg = code === 48
				const r = codes[i + 2],
					g = codes[i + 3],
					b = codes[i + 4]
				styles.push(`${isBg ? "background-" : ""}color: rgb(${r},${g},${b})`)
				i += 4
			}
			i++
		}

		if (styles.length > 0) {
			openSpans++
			return `<span style="${styles.join("; ")}">`
		}
		return ""
	})

	return html + "</span>".repeat(openSpans)
}

export const CommandExecutionBlock = memo(
	({ text, isRunning = false, isLast = false, exitCode, terminalStatus }: CommandExecutionBlockProps) => {
		const { t } = useTranslation("agentManager")
		const { command, output: rawOutput } = useMemo(() => parseCommandAndOutput(text), [text])
		const [isExpanded, setIsExpanded] = useState(true)
		const [copied, setCopied] = useState(false)

		const outputHtml = useMemo(() => ansiToHtml(rawOutput), [rawOutput])
		const hasOutput = useMemo(() => /\S/.test(rawOutput), [rawOutput])
		const hasOutputMarker = useMemo(() => text.indexOf(COMMAND_OUTPUT_STRING) !== -1, [text])
		const isCompleted = exitCode !== undefined || terminalStatus === "timeout" || terminalStatus === "exited"

		// Determine status - deterministic based on exit code
		const status: CommandStatus = useMemo(() => {
			// Running: has output marker but no output yet, only for the most recent command
			if (!isCompleted && (isRunning || (hasOutputMarker && isLast)) && !hasOutput) {
				return "running"
			}
			// Error: timeout or non-zero exit code
			if (terminalStatus === "timeout" || (exitCode !== undefined && exitCode !== 0)) {
				return "error"
			}
			// Success: zero exit code, has output, or has output marker (executed but no visible output)
			if (exitCode === 0 || hasOutput || hasOutputMarker) {
				return "success"
			}
			// Pending: waiting for approval/execution
			return "pending"
		}, [isCompleted, isRunning, hasOutputMarker, isLast, hasOutput, terminalStatus, exitCode])

		const isError = status === "error"

		const handleCopy = async () => {
			try {
				await navigator.clipboard.writeText(command)
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			} catch {
				// Clipboard API may fail in some contexts
			}
		}

		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-sm font-mono text-sm">
				{/* Header with status and command */}
				<div className="flex items-center justify-between gap-2 px-2 py-1.5">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<StatusIndicator status={status} />
						<pre className="overflow-x-auto whitespace-pre m-0 p-0 flex-1 min-w-0">{command}</pre>
					</div>
					<div className="flex items-center gap-1 flex-shrink-0">
						<button
							onClick={handleCopy}
							className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors rounded hover:bg-vscode-toolbar-hoverBackground"
							title={t("messages.copyCommand")}>
							{copied ? <Check size={14} /> : <Copy size={14} />}
						</button>
						{hasOutput && (
							<button
								onClick={() => setIsExpanded(!isExpanded)}
								className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors rounded hover:bg-vscode-toolbar-hoverBackground"
								title={isExpanded ? t("messages.collapseOutput") : t("messages.expandOutput")}>
								<ChevronDown
									className={cn(
										"size-4 transition-transform duration-200",
										isExpanded && "rotate-180",
									)}
								/>
							</button>
						)}
					</div>
				</div>

				{/* Output */}
				{hasOutput && (
					<div
						className={cn(
							"overflow-hidden transition-all duration-200 border-t border-vscode-panel-border",
							{
								"max-h-0 border-t-0": !isExpanded,
								"max-h-[500px] overflow-y-auto": isExpanded,
							},
						)}>
						<div className="p-2 bg-vscode-editor-background">
							<pre
								className={cn(
									"overflow-x-auto whitespace-pre m-0 p-0 text-xs font-mono",
									isError ? "text-red-400" : "text-[var(--vscode-terminal-foreground,#cccccc)]",
								)}
								dangerouslySetInnerHTML={{ __html: outputHtml }}
							/>
						</div>
					</div>
				)}
			</div>
		)
	},
)

CommandExecutionBlock.displayName = "CommandExecutionBlock"

/**
 * Status indicator dot/spinner
 */
function StatusIndicator({ status }: { status: CommandStatus }) {
	switch (status) {
		case "pending":
			return <div className="size-2 rounded-full bg-yellow-500/70 flex-shrink-0" />
		case "running":
			return <Loader2 size={10} className="animate-spin text-blue-400 flex-shrink-0" />
		case "success":
			return <div className="size-2 rounded-full bg-green-500 flex-shrink-0" />
		case "error":
			return <div className="size-2 rounded-full bg-red-500 flex-shrink-0" />
	}
}
