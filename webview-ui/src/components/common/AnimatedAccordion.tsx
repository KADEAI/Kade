import React, { ReactNode, useRef, useEffect } from "react"

interface AnimatedAccordionProps {
	isExpanded: boolean
	children: ReactNode
	contentClassName?: string
	style?: React.CSSProperties
}

export const AnimatedAccordion = ({ isExpanded, children, contentClassName, style }: AnimatedAccordionProps) => {
	const prevExpanded = useRef(isExpanded)

	useEffect(() => {
		if (prevExpanded.current === isExpanded) {
			return
		}

		prevExpanded.current = isExpanded
		// Wait until layout commits, then notify once.
		const raf = window.requestAnimationFrame(() => {
			window.dispatchEvent(new Event("tool-animate-height"))
		})

		return () => window.cancelAnimationFrame(raf)
	}, [isExpanded])

	const { transition: _ignoredTransition, ...safeStyle } = style ?? {}

	return (
		<div
			style={{
				display: "grid",
				// INSTANT layout change - no transition to avoid scroll jank
				gridTemplateRows: isExpanded ? "1fr" : "0fr",
				...safeStyle,
			}}>
			<div 
				style={{ 
					overflow: "hidden", 
					minHeight: 0,
					// Smooth opacity fade for visual polish (doesn't affect layout)
					opacity: isExpanded ? 1 : 0,
					transition: "opacity 150ms ease-out",
				}} 
				className={contentClassName}
			>
				{children}
			</div>
		</div>
	)
}
