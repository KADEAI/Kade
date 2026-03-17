import React, { useMemo, useState, useEffect } from "react"
import { MarketplaceItem, TelemetryEventName } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { ViewState } from "../MarketplaceViewStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { isValidUrl } from "../../../utils/url"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StandardTooltip } from "@/components/ui"
import { MarketplaceInstallModal } from "./MarketplaceInstallModal"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"

const TAG_ICON_MAP: Record<string, string> = {
	// Development & Engineering
	"developer": "codicon-code",
	"code": "codicon-code",
	"tools": "codicon-tools",
	"backend": "codicon-database",
	"frontend": "codicon-paintcan",
	"api": "codicon-symbol-interface",
	"database": "codicon-database",
	"sql": "codicon-database",
	"nosql": "codicon-database",
	"security": "codicon-shield",
	"auth": "codicon-lock",
	"testing": "codicon-beaker",
	"test": "codicon-beaker",
	"qa": "codicon-check-all",
	"devops": "codicon-rocket",
	"cicd": "codicon-rocket",
	"automation": "codicon-rocket",
	"infrastructure": "codicon-server",
	"cloud": "codicon-cloud",
	"aws": "codicon-cloud",
	"azure": "codicon-cloud",
	"gcp": "codicon-cloud",
	"docker": "codicon-container",
	"kubernetes": "codicon-container",
	"k8s": "codicon-container",
	"git": "codicon-git-branch",
	"github": "codicon-github",
	"gitlab": "codicon-github",
	"bitbucket": "codicon-github",
	"terminal": "codicon-terminal",
	"shell": "codicon-terminal",
	"bash": "codicon-terminal",
	"zsh": "codicon-terminal",
	"powershell": "codicon-terminal",

	// Frameworks & Languages
	"react": "codicon-symbol-class",
	"vue": "codicon-symbol-class",
	"angular": "codicon-symbol-class",
	"svelte": "codicon-symbol-class",
	"nextjs": "codicon-symbol-class",
	"typescript": "codicon-symbol-type-parameter",
	"javascript": "codicon-symbol-keyword",
	"python": "codicon-symbol-method",
	"rust": "codicon-symbol-property",
	"go": "codicon-symbol-interface",
	"golang": "codicon-symbol-interface",
	"java": "codicon-symbol-class",
	"cpp": "codicon-symbol-class",
	"c#": "codicon-symbol-class",
	"php": "codicon-symbol-class",
	"ruby": "codicon-symbol-class",

	// Media & Design
	"media": "codicon-image",
	"image": "codicon-image",
	"photo": "codicon-image",
	"video": "codicon-device-camera-video",
	"movie": "codicon-device-camera-video",
	"audio": "codicon-megaphone",
	"music": "codicon-music",
	"design": "codicon-paintcan",
	"ux": "codicon-eye",
	"ui": "codicon-layout",
	"responsive": "codicon-device-mobile",
	"mobile": "codicon-device-mobile",
	"web": "codicon-globe",
	"internet": "codicon-globe",

	// Artificial Intelligence
	"ai": "codicon-sparkle",
	"llm": "codicon-sparkle",
	"ml": "codicon-sparkle",
	"nlp": "codicon-sparkle",
	"generate": "codicon-sparkle",
	"search": "codicon-search",
	"query": "codicon-search",

	// Entertainment & More
	"gaming": "codicon-game",
	"game": "codicon-game",
	"entertainment": "codicon-device-camera-video",
	"social": "codicon-organization",
	"chat": "codicon-comment",
	"communication": "codicon-mail",
	"writing": "codicon-edit",
	"documentation": "codicon-book",
	"docs": "codicon-book",
	"science": "codicon-beaker",
	"math": "codicon-symbol-operator",
	"health": "codicon-heart",
	"fitness": "codicon-heart",
	"finance": "codicon-credit-card",
	"crypto": "codicon-key",
	"blockchain": "codicon-key",
}

interface ItemInstalledMetadata {
	type: string
}

interface MarketplaceItemCardProps {
	item: MarketplaceItem
	filters: ViewState["filters"]
	setFilters: (filters: Partial<ViewState["filters"]>) => void
	installed: {
		project: ItemInstalledMetadata | undefined
		global: ItemInstalledMetadata | undefined
	}
}

export const MarketplaceItemCard: React.FC<MarketplaceItemCardProps> = ({ item, filters, setFilters, installed }) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()
	const [showInstallModal, setShowInstallModal] = useState(false)
	const [installModalVersion, setInstallModalVersion] = useState(0) // kilocode_change
	const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
	const [removeTarget, setRemoveTarget] = useState<"project" | "global">("project")
	const [removeError, setRemoveError] = useState<string | null>(null)

	// Listen for removal result messages
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "marketplaceRemoveResult" && message.slug === item.id) {
				if (message.success) {
					// Removal succeeded - refresh marketplace data
					vscode.postMessage({
						type: "fetchMarketplaceData",
					})
				} else {
					// Removal failed - show error message to user
					setRemoveError(message.error || t("marketplace:items.unknownError"))
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [item.id, t])

	const typeLabel = useMemo(() => {
		const labels: Partial<Record<MarketplaceItem["type"], string>> = {
			mode: t("marketplace:filters.type.mode"),
			mcp: t("marketplace:filters.type.mcpServer"),
		}
		return labels[item.type] ?? "N/A"
	}, [item.type, t])

	// Determine installation status
	const isInstalledGlobally = !!installed.global
	const isInstalledInProject = !!installed.project
	const isInstalled = isInstalledGlobally || isInstalledInProject

	const displayIconClass = useMemo(() => {
		if (item.iconName) return item.iconName

		if (item.tags && item.tags.length > 0) {
			for (const tag of item.tags) {
				const lowerTag = tag.toLowerCase()
				// Check for exact match or substring in our extensive map
				for (const [key, icon] of Object.entries(TAG_ICON_MAP)) {
					if (lowerTag.includes(key)) {
						return icon
					}
				}
			}
		}

		return item.type === "mode" ? "codicon-beaker" : "codicon-server"
	}, [item.iconName, item.tags, item.type])

	const handleInstallClick = () => {
		// Send telemetry for install button click
		telemetryClient.capture(TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED, {
			itemId: item.id,
			itemType: item.type,
			itemName: item.name,
		})

		setInstallModalVersion((prev) => prev + 1) // kilocode_change
		// Show modal for all item types (MCP and modes)
		setShowInstallModal(true)
	}

	return (
		<>
			<div className="group border border-vscode-panel-border rounded-xl p-4 bg-vscode-editor-background/40 backdrop-blur-sm hover:border-vscode-focusBorder/50 transition-all duration-300 hover:shadow-lg hover:shadow-black/20 relative overflow-hidden flex flex-col h-full">
				<div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

				<div className="flex gap-3 items-start justify-between relative z-10">
					<div className="flex gap-3 items-start flex-1 min-w-0">
						{/* Icon rendering */}
						<div className="flex-shrink-0 w-10 h-10 rounded-lg bg-vscode-sideBar-background flex items-center justify-center border border-vscode-panel-border group-hover:border-vscode-focusBorder/30 transition-colors">
							<span className={cn("codicon text-2xl opacity-80 group-hover:opacity-100 transition-opacity", displayIconClass)} />
						</div>

						<div className="flex-1 min-w-0">
							<h3 className="text-base font-bold text-vscode-foreground mt-0 mb-1 leading-tight flex items-center gap-2">
								<span className="truncate">
									{item.type === "mcp" && item.url && isValidUrl(item.url) ? (
										<Button
											variant="link"
											className="p-0 h-auto text-base font-bold text-vscode-foreground hover:underline p-0"
											onClick={() => vscode.postMessage({ type: "openExternal", url: item.url })}>
											{item.name}
										</Button>
									) : (
										item.name
									)}
								</span>
								{(item as any).isFeatured && (
									<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-vscode-activityBarBadge-background text-vscode-activityBarBadge-foreground border border-vscode-activityBarBadge-background shrink-0 font-bold uppercase tracking-wider">
										Featured
									</span>
								)}
							</h3>
							<div className="flex flex-wrap gap-2 items-center">
								<AuthorInfo item={item} typeLabel={typeLabel} />
								{(item as any).installCount !== undefined && (
									<>
										<span className="text-vscode-descriptionForeground/40 text-[10px]">•</span>
										<span className="text-[11px] text-vscode-descriptionForeground/80">
											{(item as any).installCount} installs
										</span>
									</>
								)}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{isInstalled ? (
							<StandardTooltip
								content={
									isInstalledInProject
										? t("marketplace:items.card.removeProjectTooltip")
										: t("marketplace:items.card.removeGlobalTooltip")
								}>
								<Button
									size="sm"
									variant="secondary"
									className="text-[11px] h-7 py-0 px-3 rounded-md bg-vscode-button-secondaryBackground/50 hover:bg-vscode-button-secondaryHoverBackground"
									onClick={() => {
										const target = isInstalledInProject ? "project" : "global"
										setRemoveTarget(target)
										setShowRemoveConfirm(true)
									}}>
									{t("marketplace:items.card.remove")}
								</Button>
							</StandardTooltip>
						) : (
							<Button
								size="sm"
								variant="primary"
								className="text-[11px] font-bold h-7 py-0 px-4 rounded-md shadow-sm hover:shadow-md transition-all active:scale-95"
								onClick={handleInstallClick}>
								{t("marketplace:items.card.install")}
							</Button>
						)}
					</div>
				</div>

				<p className="mt-3 mb-4 text-sm text-vscode-foreground/90 leading-relaxed flex-grow">
					{item.description}
				</p>

				{/* Installation status badges and tags in the same row */}
				{(isInstalled || (item.tags && item.tags.length > 0)) && (
					<div className="relative flex flex-wrap gap-1.5 mt-auto pt-2 border-t border-vscode-panel-border/30">
						{/* Installation status badge */}
						{isInstalled && (
							<span className="text-[10px] font-bold px-2 py-0.5 rounded-full h-5 flex items-center bg-green-500/10 text-green-400 border border-green-500/20 shrink-0 uppercase tracking-tight">
								<span className="codicon codicon-check text-[10px] mr-1" />
								{t("marketplace:items.card.installed")}
							</span>
						)}

						{/* Tags */}
						{item.tags &&
							item.tags.length > 0 &&
							item.tags.map((tag) => (
								<StandardTooltip
									key={tag}
									content={
										filters.tags.includes(tag)
											? t("marketplace:filters.tags.clear", { count: tag })
											: t("marketplace:filters.tags.clickToFilter")
									}>
									<Button
										size="sm"
										variant="secondary"
										className={cn("rounded-full capitalize text-[10px] px-2.5 h-5 bg-vscode-badge-background/30 hover:bg-vscode-badge-background/50 border-none", {
											"bg-primary/20 text-primary border border-primary/30": filters.tags.includes(tag),
										})}
										onClick={() => {
											const newTags = filters.tags.includes(tag)
												? filters.tags.filter((t: string) => t !== tag)
												: [...filters.tags, tag]
											setFilters({ tags: newTags })
										}}>
										{tag}
									</Button>
								</StandardTooltip>
							))}
					</div>
				)}

				{/* Error message display */}
				{removeError && (
					<div className="text-vscode-errorForeground text-xs mt-2 font-medium">
						{t("marketplace:items.removeFailed", { error: removeError })}
					</div>
				)}
			</div>

			{/* Installation Modal - Outside the clickable card */}
			<MarketplaceInstallModal
				key={`install-modal-${item.id}-${installModalVersion}` /* kilocode_change */}
				item={item}
				isOpen={showInstallModal}
				onClose={() => setShowInstallModal(false)}
				hasWorkspace={!!cwd}
			/>

			{/* Remove Confirmation Dialog */}
			<AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{item.type === "mode"
								? t("marketplace:removeConfirm.mode.title")
								: t("marketplace:removeConfirm.mcp.title")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{item.type === "mode" ? (
								<>
									{t("marketplace:removeConfirm.mode.message", { modeName: item.name })}
									<div className="mt-2 text-sm">
										{t("marketplace:removeConfirm.mode.rulesWarning")}
									</div>
								</>
							) : (
								t("marketplace:removeConfirm.mcp.message", { mcpName: item.name })
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("marketplace:removeConfirm.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								// Clear any previous error
								setRemoveError(null)

								vscode.postMessage({
									type: "removeInstalledMarketplaceItem",
									mpItem: item,
									mpInstallOptions: { target: removeTarget },
								})

								setShowRemoveConfirm(false)
							}}>
							{t("marketplace:removeConfirm.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

interface AuthorInfoProps {
	item: MarketplaceItem
	typeLabel: string
}

const AuthorInfo: React.FC<AuthorInfoProps> = ({ item, typeLabel }) => {
	const { t } = useAppTranslation()

	const handleOpenAuthorUrl = () => {
		if (item.authorUrl && isValidUrl(item.authorUrl)) {
			vscode.postMessage({ type: "openExternal", url: item.authorUrl })
		}
	}

	if (item.author) {
		return (
			<p className="text-sm text-vscode-descriptionForeground my-0">
				{typeLabel}{" "}
				{item.authorUrl && isValidUrl(item.authorUrl) ? (
					<Button
						variant="link"
						className="p-0 h-auto text-sm text-vscode-textLink hover:underline"
						onClick={handleOpenAuthorUrl}>
						{t("marketplace:items.card.by", { author: item.author })}
					</Button>
				) : (
					t("marketplace:items.card.by", { author: item.author })
				)}
			</p>
		)
	}
	return null
}
