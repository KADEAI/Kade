import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AnimatedAccordion } from "../common/AnimatedAccordion"

import MarkdownBlock from "../common/MarkdownBlock"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
	AdvancedThinkingIndicator,
	ThinkingPulse,
	ThinkingPhase,
} from "./AdvancedThinkingIndicator"
import { ShimmeringText } from "./StreamingLoadingText"



interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	metadata?: {
		reasoningPhase?: ThinkingPhase
		reasoningSteps?: ThinkingPhase[]
		currentStep?: number
		estimatedCost?: number
		tokenCount?: number
		reasoningDurationMs?: number
	}
}

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	isCollapsed: boolean
	onToggle: () => void
	metadata?: {
		reasoningPhase?: ThinkingPhase
		reasoningSteps?: ThinkingPhase[]
		currentStep?: number
		estimatedCost?: number
		tokenCount?: number
		reasoningDurationMs?: number
	}
}

export const ReasoningBlock = ({
	content,
	ts,
	isStreaming,
	isLast,
	isCollapsed,
	onToggle,
	metadata,
}: ReasoningBlockProps) => {
	const { t } = useTranslation()

	const startTimeRef = useRef<number>(ts)
	const [elapsed, setElapsed] = useState<number>(metadata?.reasoningDurationMs ?? 0)
	const contentRef = useRef<HTMLDivElement>(null)
	const userHasScrolledUp = useRef(false)
	// rAF handle so we can coalesce many rapid mutations into one scroll per frame
	const rafRef = useRef<number | null>(null)

	// Handle manual scroll to disable/enable auto-scroll
	const handleScroll = () => {
		if (!contentRef.current) return
		const { scrollTop, scrollHeight, clientHeight } = contentRef.current
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 10
		userHasScrolledUp.current = !isAtBottom
	}

	// Auto-scroll to the bottom as new content streams in.
	// Key design decision: use instant scrollTop assignment (not 'smooth') so we
	// don't queue competing CSS scroll animations that fight each other during
	// rapid char-by-char streaming. We also gate every scroll behind a single
	// requestAnimationFrame so dozens of MutationObserver callbacks per second
	// are collapsed into at most one DOM write per frame.
	useEffect(() => {
		if (!contentRef.current || !isStreaming) return

		const container = contentRef.current

		const scrollToBottom = () => {
			if (userHasScrolledUp.current) return
			// Direct assignment: instant, no animation queue
			container.scrollTop = container.scrollHeight
		}

		const scheduleScroll = () => {
			if (userHasScrolledUp.current) return
			// Only schedule one rAF at a time; ignore subsequent calls in same frame
			if (rafRef.current !== null) return
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = null
				scrollToBottom()
			})
		}

		const observer = new MutationObserver(scheduleScroll)

		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true,
		})

		// Snap to bottom immediately on mount / when streaming starts
		scrollToBottom()

		return () => {
			observer.disconnect()
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current)
				rafRef.current = null
			}
		}
	}, [isStreaming])

	// No internal state effects - all expansion logic moved to parent

	useEffect(() => {
		if (metadata?.reasoningDurationMs !== undefined) {
			setElapsed(metadata.reasoningDurationMs)
		}
	}, [metadata?.reasoningDurationMs])

	useEffect(() => {
		if (isLast && isStreaming) {
			const tick = () => setElapsed(Date.now() - startTimeRef.current)
			tick()
			const id = setInterval(tick, 100) // Increase frequency for smoother updates
			return () => clearInterval(id)
		}
	}, [isLast, isStreaming])

	const seconds = Math.floor(elapsed / 1000)

	const handleToggle = () => {
		onToggle()
	}

	// Use advanced thinking indicator for streaming responses
	const useAdvancedIndicator = isLast && isStreaming && metadata?.reasoningPhase

	const headerEntranceClass = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:slide-in-from-bottom-1"

		return (
			<div
				className="group transition-all duration-500 ease-out"
				style={{
					transformStyle: "preserve-3d",
					transform: "translateZ(0)",
					fontFamily: 'var(--vscode-font-family)',
				}}>
			{/* Header with toggle */}
			<div
					className={cn(
							"relative flex items-center justify-between mb-0 pl-0 pr-0 cursor-pointer select-none transition-all duration-500 ease-out",
							headerEntranceClass,
							isStreaming && "opacity-90"
						)}
					style={{ marginLeft: "-1px" }}
					onClick={handleToggle}>
				{isStreaming && (
					<div className="absolute bottom-0 left-0 right-0 h-[1.5px] overflow-hidden z-10 opacity-70">
						<div className="loading-bar w-full h-full animate-shimmer" />
					</div>
				)}
				<div className={cn("flex items-center gap-2 transition-all duration-300 ease-out", headerEntranceClass)}>
					{/* Use advanced indicator for last streaming message */}
					{useAdvancedIndicator ? (
						<div className={cn("flex items-center gap-2 transition-all duration-300 ease-out", headerEntranceClass)}>
							<AdvancedThinkingIndicator
								phase={metadata.reasoningPhase}
								phases={metadata.reasoningSteps}
								currentPhaseIndex={metadata.currentStep ?? 0}
								elapsedMs={elapsed}
								estimatedCost={metadata.estimatedCost}
								tokenCount={metadata.tokenCount}
								isStreaming={isStreaming}
								style="detailed"
								compact={false}
							/>
						</div>
					) : (
						/* Original indicator for non-streaming or messages without metadata */
						<span
							className={cn(
								"inline-flex items-center gap-1 align-baseline text-[13.5px] leading-normal select-none cursor-pointer transition-all duration-300 ease-out",
								isStreaming && "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
							)}
							style={{ fontFamily: 'var(--vscode-font-family)' }}
							onClick={handleToggle}
						>
							{isStreaming ? (
								<ShimmeringText text={t("chat:reasoning.thinking")} compact />
							) : (
								<span className="text-vscode-descriptionForeground font-normal opacity-90 antialiased transition-all duration-300">
									Thought for
								</span>
							)}
							{(elapsed > 0 || !isStreaming) && (
								<span className="text-vscode-descriptionForeground opacity-50 antialiased transition-all duration-300">
									{seconds}s
								</span>
							)}
							<ChevronRight
								className={cn(
									"w-3 h-3 inline ml-1 text-vscode-descriptionForeground opacity-40 transition-all duration-300 ease-out align-middle",
									!isCollapsed && "rotate-90"
								)}
							/>
						</span>
					)}
				</div>
				<div className="flex items-center gap-2 transition-all duration-300 ease-out">
					{/* Show compact pulse indicator when collapsed and streaming */}
					{isCollapsed && isStreaming && (
						<ThinkingPulse className="mr-2 animate-pulse" />
					)}
				</div>
			</div>

			{/* Content area */}
			<AnimatedAccordion isExpanded={!isCollapsed}>
				{((content?.trim()?.length ?? 0) > 0 || (isStreaming && metadata?.reasoningPhase)) && (
					<div
						ref={contentRef}
						onScroll={handleScroll}
						className={cn(
							"ml-2 pl-0 pr-2 pb-1 text-vscode-descriptionForeground text-[13.5px] leading-[1.6] opacity-45 anchored-container mt-1 max-h-60 overflow-y-auto custom-scrollbar",
							"transition-all duration-500 ease-out",
							isStreaming && "animate-in fade-in slide-in-from-bottom-3 duration-700",
							isStreaming && "shadow-xl shadow-blue-500/5"
						)}>
						<div className={cn(
							"relative",
							// isStreaming && "before:absolute before:inset-0 before:bg-gradient-to-b before:from-transparent before:via-white/2 before:to-transparent before:animate-pulse before:rounded"
						)}>
							<MarkdownBlock
								markdown={content}
								className={cn(
									"!text-[13.3px] reasoning-content transition-all duration-300",
									isStreaming && "is-streaming animate-in fade-in duration-700 slide-in-from-left-1",
									isStreaming && "drop-shadow-sm"
								)}
							/>
						</div>
					</div>
				)}
			</AnimatedAccordion>

			{/* Show metadata summary - moved inside the main accordion or shown statically to prevent double-animation jitter */}
			{isCollapsed && metadata?.reasoningPhase && !isStreaming && (
				<div className="ml-6 text-[11px] text-vscode-descriptionForeground/50 flex items-center gap-3 mt-0.5 mb-1 animate-in fade-in duration-300">
					<span className="capitalize">{metadata.reasoningPhase}</span>
					{metadata.tokenCount !== undefined && (
						<span>{metadata.tokenCount.toLocaleString()} tokens</span>
					)}
					{metadata.estimatedCost !== undefined && (
						<span>~${metadata.estimatedCost.toFixed(4)}</span>
					)}
				</div>
			)}
		</div>
	)
}

export default ReasoningBlock
