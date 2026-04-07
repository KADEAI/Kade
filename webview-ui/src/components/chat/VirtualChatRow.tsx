import React, { memo, useEffect, useRef, useState } from "react"

/**
 * VirtualChatList — CSS content-visibility:auto based rendering optimization.
 *
 * Strategy:
 *  - Every row is always in the DOM (no JS windowing, no scroll fighting).
 *  - `content-visibility: auto` tells the browser to skip layout/paint for
 *    rows outside the viewport. This is a browser-native skip, not JS.
 *  - `contain-intrinsic-size` provides a size hint so the browser can
 *    correctly compute scrollbar height without rendering the content.
 *    We track each row's real measured height and update the hint so the
 *    scrollbar stays accurate as rows are measured.
 *
 * Performance optimizations:
 *  - GPU acceleration via transform: translateZ(0)
 *  - contain: layout style paint for isolation
 *  - Batched ResizeObserver updates via requestAnimationFrame
 *  - Throttled style updates to avoid layout thrashing
 *
 * Result: native scrolling with zero JS on the scroll path, zero re-renders
 * on scroll, and no competing scroll adjustments.
 */

// Module-level height cache so hints survive re-renders.
const heightCache = new Map<string, number>()

// Shared ResizeObserver for all rows (much more efficient than one per row)
let sharedResizeObserver: ResizeObserver | null = null
const observedElements = new Map<Element, string>() // element -> rowKey
const streamingElements = new Map<Element, boolean>() // element -> streaming state
let rafId: number | null = null
const pendingUpdates = new Map<string, number>() // rowKey -> height

function getSharedResizeObserver(): ResizeObserver {
	if (!sharedResizeObserver) {
		sharedResizeObserver = new ResizeObserver((entries) => {
			// Batch all height updates
			for (const entry of entries) {
				const rowKey = observedElements.get(entry.target)
				if (!rowKey) continue

				// KILOCODE FIX: If the row is currently streaming/growing, don't update the
				// intrinsic size hint yet. Updating it mid-stream triggers a layout shift
				// that fights the browser's scroll anchoring.
				if (streamingElements.get(entry.target)) continue

				const h = entry.contentRect.height
				if (h && h > 0) {
					pendingUpdates.set(rowKey, h)
				}
			}

			// Coalesce updates into a single rAF
			if (rafId === null && pendingUpdates.size > 0) {
				rafId = requestAnimationFrame(() => {
					rafId = null
					pendingUpdates.forEach((height, key) => {
						const cachedHeight = heightCache.get(key)
						// Only update if height changed significantly (> 2px)
						if (!cachedHeight || Math.abs(height - cachedHeight) > 2) {
							heightCache.set(key, height)
							// Find the element and update its intrinsic size
							for (const [el, k] of observedElements) {
								if (k === key && el instanceof HTMLElement) {
									el.style.containIntrinsicSize = `auto ${height}px`
									break
								}
							}
						}
					})
					pendingUpdates.clear()
				})
			}
		})
	}
	return sharedResizeObserver
}

export function clearVirtualHeightCache() {
	heightCache.clear()
	pendingUpdates.clear()
	if (rafId !== null) {
		cancelAnimationFrame(rafId)
		rafId = null
	}
}

// ─── VirtualChatList ────────────────────────────────────────────────────────

interface VirtualChatListProps {
	rowKeys: string[]
	rowStreamingStates?: boolean[]
	scrollEl: HTMLElement | null
	isStreaming: boolean
	renderRow: (index: number) => React.ReactNode
	footerHeight: number
}

export const VirtualChatList = memo(function VirtualChatList({
	rowKeys,
	rowStreamingStates,
	renderRow,
	footerHeight,
}: VirtualChatListProps) {
	return (
		<>
			{rowKeys.map((key, index) => (
				<ContentVisibilityRow
					key={key}
					rowKey={key}
					isStreaming={rowStreamingStates?.[index] ?? false}>
					{renderRow(index)}
				</ContentVisibilityRow>
			))}
			<div style={{ height: footerHeight, minHeight: footerHeight }}>
				<div className="scroll-anchor" style={{ height: "1px" }} />
			</div>
		</>
	)
})

// ─── ContentVisibilityRow ────────────────────────────────────────────────────

interface ContentVisibilityRowProps {
	rowKey: string
	isStreaming: boolean
	children: React.ReactNode
}

const DEFAULT_HEIGHT = 80
const STREAMING_SETTLE_MS = 480

// Stable row styles - defined once, not recreated on each render
const rowBaseStyles: React.CSSProperties = {
	// GPU acceleration - prevents repaints from affecting other rows
	transform: "translateZ(0)",
	backfaceVisibility: "hidden",
	// Prevent content from causing horizontal overflow
	overflowX: "hidden",
}

const ContentVisibilityRow = memo(function ContentVisibilityRow({
	rowKey,
	isStreaming,
	children,
}: ContentVisibilityRowProps) {
	const ref = useRef<HTMLDivElement>(null)
	const cachedHeight = heightCache.get(rowKey) ?? DEFAULT_HEIGHT
	const settleTimerRef = useRef<number | null>(null)
	const hasStreamedRef = useRef(isStreaming)
	const [isSettling, setIsSettling] = useState(isStreaming)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		// Register with shared observer
		const ro = getSharedResizeObserver()
		observedElements.set(el, rowKey)
		streamingElements.set(el, isStreaming)
		ro.observe(el)

		return () => {
			observedElements.delete(el)
			streamingElements.delete(el)
			ro.unobserve(el)
		}
	}, [rowKey])

	useEffect(() => {
		const el = ref.current
		if (!el) return

		if (isStreaming) {
			hasStreamedRef.current = true
			setIsSettling(true)
			if (settleTimerRef.current !== null) {
				clearTimeout(settleTimerRef.current)
				settleTimerRef.current = null
			}
			streamingElements.set(el, true)
			return
		}

		if (!hasStreamedRef.current) {
			setIsSettling(false)
			streamingElements.set(el, false)
			return
		}

		if (settleTimerRef.current !== null) {
			clearTimeout(settleTimerRef.current)
		}

		// Keep the row in full-layout mode for a beat after streaming ends.
		// This avoids the completion-time flash when containment/content-visibility
		// snaps back on during the final assistant message paint.
		streamingElements.set(el, true)
		settleTimerRef.current = window.setTimeout(() => {
			setIsSettling(false)
			streamingElements.set(el, false)
			settleTimerRef.current = null
		}, STREAMING_SETTLE_MS)

		return () => {
			if (settleTimerRef.current !== null) {
				clearTimeout(settleTimerRef.current)
				settleTimerRef.current = null
			}
			streamingElements.delete(el)
		}
	}, [isStreaming])

	const shouldKeepFullLayout = isStreaming || isSettling

	return (
		<div
			ref={ref}
			style={{
				...rowBaseStyles,
				containIntrinsicSize: `auto ${cachedHeight}px`,
				// Only apply content-visibility and contain to non-streaming rows
				// Streaming rows need full layout to prevent collapse/flash
				...(shouldKeepFullLayout
					? {}
					: {
							contentVisibility: "auto" as const,
							contain: "layout style paint" as const,
						}),
			}}>
			{children}
		</div>
	)
})

// Legacy alias
export const VirtualChatRow = VirtualChatList
