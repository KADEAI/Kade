import { memo, useMemo, useEffect, useRef } from "react"
import { ClineMessage } from "@roo-code/types"
import { ClineSayBrowserAction } from "@roo/ExtensionMessage"
import { vscode } from "@src/utils/vscode"
import { getViewportCoordinate as getViewportCoordinateShared, prettyKey } from "@roo/browserUtils"
import {
	MousePointer as MousePointerIcon,
	Keyboard,
	ArrowDown,
	ArrowUp,
	Pointer,
	Play,
	Check,
	Maximize2,
	Camera,
} from "lucide-react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useTranslation } from "react-i18next"

import { ToolHeader } from "./tools/ToolHeader"

interface BrowserActionRowProps {
	message: ClineMessage
	nextMessage?: ClineMessage
	actionIndex?: number
	totalActions?: number
}

// Get icon for each action type
const getActionIcon = (action: string) => {
	switch (action) {
		case "click":
			return <MousePointerIcon className="w-3.5 h-3.5 opacity-70" />
		case "type":
		case "press":
			return <Keyboard className="w-3.5 h-3.5 opacity-70" />
		case "scroll_down":
		case "scroll_up":
			return <ArrowDown className="w-3.5 h-3.5 opacity-70" />
		case "launch":
			return <Play className="w-3.5 h-3.5 opacity-70" />
		case "close":
			return <Check className="w-3.5 h-3.5 opacity-70" />
		case "resize":
			return <Maximize2 className="w-3.5 h-3.5 opacity-70" />
		case "screenshot":
			return <Camera className="w-3.5 h-3.5 opacity-70" />
		case "hover":
		default:
			return <Pointer className="w-3.5 h-3.5 opacity-70" />
	}
}

const BrowserActionRow = memo(({ message, nextMessage, actionIndex, totalActions }: BrowserActionRowProps) => {
	const { t } = useTranslation()
	const { isBrowserSessionActive } = useExtensionState()
	const hasHandledAutoOpenRef = useRef(false)

	// Parse this specific browser action
	const browserAction = useMemo<ClineSayBrowserAction | null>(() => {
		try {
			return JSON.parse(message.text || "{}") as ClineSayBrowserAction
		} catch {
			return null
		}
	}, [message.text])

	// Get viewport dimensions from the result message if available
	const viewportDimensions = useMemo(() => {
		if (!nextMessage || nextMessage.say !== "browser_action_result") return null
		try {
			const result = JSON.parse(nextMessage.text || "{}")
			return {
				width: result.viewportWidth,
				height: result.viewportHeight,
			}
		} catch {
			return null
		}
	}, [nextMessage])

	// Format action display text
	const [actionVerb, detailsText] = useMemo(() => {
		if (!browserAction) return [t("chat:browser.actions.title"), ""]

		// Helper to scale coordinates from screenshot dimensions to viewport dimensions
		// Matches the backend's scaleCoordinate function logic
		const getViewportCoordinate = (coord?: string): string =>
			getViewportCoordinateShared(coord, viewportDimensions?.width ?? 0, viewportDimensions?.height ?? 0)

		switch (browserAction.action) {
			case "launch":
				return ["Launched", "browser"]
			case "click":
				return [
					"Clicked",
					`at (${browserAction.executedCoordinate || getViewportCoordinate(browserAction.coordinate)})`,
				]
			case "type":
				return ["Typed", `"${browserAction.text}"`]
			case "press":
				return ["Pressed", prettyKey(browserAction.text)]
			case "hover":
				return [
					"Hovered",
					`at (${browserAction.executedCoordinate || getViewportCoordinate(browserAction.coordinate)})`,
				]
			case "scroll_down":
			case "scroll_up":
				return ["Scrolled", "the web page"]
			case "resize":
				return ["Resized", `to ${browserAction.size?.split(/[x,]/).join(" x ")}`]
			case "screenshot":
				return ["Saved", "screenshot"]
			case "close":
				return ["Closed", "browser"]
			default:
				return [browserAction.action, ""]
		}
	}, [browserAction, viewportDimensions, t])

	// Auto-open Browser Session panel when:
	// 1. This is a "launch" action (new browser session) - always opens and navigates to launch
	// 2. Regular actions - only open panel if user hasn't manually closed it, let internal auto-advance logic handle step
	// Only run this once per action to avoid re-sending messages when scrolling
	useEffect(() => {
		if (!isBrowserSessionActive || hasHandledAutoOpenRef.current) {
			return
		}

		const isLaunchAction = browserAction?.action === "launch"

		if (isLaunchAction) {
			// Launch action: navigate to step 0 (the launch)
			vscode.postMessage({
				type: "showBrowserSessionPanelAtStep",
				stepIndex: 0,
				isLaunchAction: true,
			})
			hasHandledAutoOpenRef.current = true
		} else {
			// Regular actions: just show panel, don't navigate
			// BrowserSessionRow's internal auto-advance logic will handle jumping to new steps
			// only if user is currently on the most recent step
			vscode.postMessage({
				type: "showBrowserSessionPanelAtStep",
				isLaunchAction: false,
			})
			hasHandledAutoOpenRef.current = true
		}
	}, [isBrowserSessionActive, browserAction])

	return (
		<div className="px-[1px] py-[1px]">
			<ToolHeader
				toolName="browser"
				actionVerb={actionVerb}
				onToggle={() => {
					const idx = typeof actionIndex === "number" ? Math.max(0, actionIndex - 1) : 0
					vscode.postMessage({ type: "showBrowserSessionPanelAtStep", stepIndex: idx, forceShow: true })
				}}
				details={
					<div className="flex items-center gap-1.5 min-w-0">
						{browserAction && (
							<>
								<div className="flex-shrink-0 flex items-center opacity-70">
									{getActionIcon(browserAction.action)}
								</div>
								<span className="truncate antialiased text-vscode-descriptionForeground">
									{detailsText}
								</span>
							</>
						)}
					</div>
				}
				extra={
					actionIndex !== undefined &&
					totalActions !== undefined && (
						<span className="text-vscode-descriptionForeground opacity-60 antialiased text-[12px] ml-auto pr-1">
							({actionIndex}/{totalActions})
						</span>
					)
				}
			/>
		</div>
	)
})

BrowserActionRow.displayName = "BrowserActionRow"

export default BrowserActionRow
