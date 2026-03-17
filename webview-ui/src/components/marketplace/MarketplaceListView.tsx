import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { X, ChevronsUpDown } from "lucide-react"
import { MarketplaceItemCard } from "./components/MarketplaceItemCard"
import { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useStateManager } from "./useStateManager"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { IssueFooter } from "./IssueFooter"
import { Trans } from "react-i18next" // kade_change
import { cn } from "@/lib/utils"

export interface MarketplaceListViewProps {
	stateManager: MarketplaceViewStateManager
	allTags: string[]
	filteredTags: string[]
	filterByType?: "mcp" | "mode"
	// kade_change start
	headerMessage?: {
		translationKey: string
		onLinkClick: () => void
	}
	// kade_change end
}

export function MarketplaceListView({
	stateManager,
	allTags,
	filteredTags,
	filterByType,
	headerMessage, // kade_change start
}: MarketplaceListViewProps) {
	const [state, manager] = useStateManager(stateManager)
	const { t } = useAppTranslation()
	const { marketplaceInstalledMetadata, cloudUserInfo } = useExtensionState()
	const [isTagPopoverOpen, setIsTagPopoverOpen] = React.useState(false)
	const [tagSearch, setTagSearch] = React.useState("")
	const allItems = state.displayItems || []
	const organizationMcps = state.displayOrganizationMcps || []
	const [searchInput, setSearchInput] = React.useState(state.filters.search || "")
	const isSearchActive = !!state.filters.search || state.filters.tags.length > 0 || state.filters.installed !== "all"

	// Update local search input when state changes (e.g. clear filters)
	React.useEffect(() => {
		setSearchInput(state.filters.search || "")
	}, [state.filters.search])

	const handleSearchTrigger = () => {
		manager.transition({
			type: "UPDATE_FILTERS",
			payload: { filters: { search: searchInput } },
		})
	}

	// NOTE: installed metadata is already synchronized into the state manager via handleMessage("state"/"marketplaceData")
	// in MarketplaceViewStateManager; avoid dispatching UPDATE_FILTERS here to prevent render loops.

	// Filter items by type if specified
	const items = filterByType ? allItems.filter((item) => item.type === filterByType) : allItems
	const orgMcps = filterByType === "mcp" ? organizationMcps : []

	const isEmpty = items.length === 0 && orgMcps.length === 0

	return (
		<>
			{/* kade_change start - headerMessage */}
			{headerMessage && (
				<div className="mb-6 p-4 rounded-xl bg-vscode-textBlock-background/30 border border-vscode-panel-border/50 backdrop-blur-sm relative overflow-hidden group">
					<div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-colors" />
					<div className="relative z-10 flex items-start gap-3">
						<div className="mt-0.5 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
							<span className="codicon codicon-sparkle text-primary animate-pulse" />
						</div>
						<p className="text-sm text-vscode-descriptionForeground m-0 leading-relaxed">
							<Trans
								i18nKey={headerMessage.translationKey}
								components={{
									1: (
										<a
											className="text-primary hover:text-primary/80 font-bold underline decoration-primary/30 underline-offset-4 cursor-pointer transition-colors"
											onClick={headerMessage.onLinkClick}
										/>
									),
								}}
							/>
						</p>
					</div>
				</div>
			)}
			{/* kade_change end - headerMessage */}

			<div className="mb-6 space-y-3">
				<div className="relative flex gap-2">
					<div className="relative flex-1 group">
						<span className="absolute left-3 top-1/2 -translate-y-1/2 codicon codicon-search text-vscode-input-foreground opacity-40 group-focus-within:opacity-100 transition-opacity" />
						<Input
							type="text"
							placeholder={
								filterByType === "mcp"
									? t("marketplace:filters.search.placeholderMcp")
									: filterByType === "mode"
										? t("marketplace:filters.search.placeholderMode")
										: t("marketplace:filters.search.placeholder")
							}
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleSearchTrigger()
								}
							}}
							className="pl-9 h-10 rounded-xl bg-vscode-input-background/50 border-vscode-input-border focus:border-primary/50 transition-all"
						/>
					</div>
					<Button
						size="sm"
						variant="primary"
						className="h-10 px-4 rounded-xl font-bold shadow-lg shadow-primary/10 hover:shadow-primary/20 transition-all active:scale-95"
						onClick={handleSearchTrigger}
						disabled={state.isFetching}
					>
						{state.isFetching ? (
							<span className="codicon codicon-sync animate-spin" />
						) : (
							<span className="codicon codicon-search" />
						)}
						<span className="ml-2 hidden sm:inline">{t("common:search")}</span>
					</Button>
				</div>
				<div className="flex gap-2">
					<Select
						value={state.filters.installed}
						onValueChange={(value: "all" | "installed" | "not_installed") =>
							manager.transition({
								type: "UPDATE_FILTERS",
								payload: { filters: { installed: value } },
							})
						}>
						<SelectTrigger className="flex-1 h-8 rounded-lg bg-vscode-select-background/50 border-vscode-input-border hover:bg-vscode-select-background transition-colors">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="rounded-xl border-vscode-panel-border shadow-xl">
							<SelectItem value="all" className="rounded-lg">{t("marketplace:filters.installed.all")}</SelectItem>
							<SelectItem value="installed" className="rounded-lg">{t("marketplace:filters.installed.installed")}</SelectItem>
							<SelectItem value="not_installed" className="rounded-lg">
								{t("marketplace:filters.installed.notInstalled")}
							</SelectItem>
						</SelectContent>
					</Select>
					{allTags.length > 0 && (
						<div className="flex-1">
							<Popover open={isTagPopoverOpen} onOpenChange={(open) => setIsTagPopoverOpen(open)}>
								<PopoverTrigger asChild>
									<Button
										variant="combobox"
										role="combobox"
										aria-expanded={isTagPopoverOpen}
										className="w-full justify-between h-7">
										<span className="truncate">
											{state.filters.tags.length > 0
												? state.filters.tags
													.map((t: string) => t.charAt(0).toUpperCase() + t.slice(1))
													.join(", ")
												: t("marketplace:filters.tags.label")}
										</span>
										<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[var(--radix-popover-trigger-width)] p-0"
									onClick={(e) => e.stopPropagation()}>
									<Command>
										<div className="relative">
											<CommandInput
												className="h-9 pr-8"
												placeholder={t("marketplace:filters.tags.placeholder")}
												value={tagSearch}
												onValueChange={setTagSearch}
											/>
											{tagSearch && (
												<Button
													variant="ghost"
													size="icon"
													className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
													onClick={() => setTagSearch("")}>
													<X className="h-4 w-4" />
												</Button>
											)}
										</div>
										<CommandList className="max-h-[200px] overflow-y-auto bg-vscode-dropdown-background divide-y divide-vscode-panel-border">
											<CommandEmpty className="p-2 text-sm text-vscode-descriptionForeground">
												{t("marketplace:filters.tags.noResults")}
											</CommandEmpty>
											<CommandGroup>
												{filteredTags.map((tag: string) => (
													<CommandItem
														key={tag}
														value={tag}
														onSelect={() => {
															const isSelected = state.filters.tags.includes(tag)
															manager.transition({
																type: "UPDATE_FILTERS",
																payload: {
																	filters: {
																		tags: isSelected
																			? state.filters.tags.filter(
																				(t) => t !== tag,
																			)
																			: [...state.filters.tags, tag],
																	},
																},
															})
														}}
														data-selected={state.filters.tags.includes(tag)}
														className="grid grid-cols-[1rem_1fr] gap-2 cursor-pointer text-sm capitalize"
														onMouseDown={(e) => {
															e.stopPropagation()
															e.preventDefault()
														}}>
														{state.filters.tags.includes(tag) ? (
															<span className="codicon codicon-check" />
														) : (
															<span />
														)}
														{tag}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
						</div>
					)}
				</div>
				{state.filters.tags.length > 0 && (
					<div className="text-xs text-vscode-descriptionForeground mt-2 flex items-center justify-between">
						<div className="flex items-center">
							<span className="codicon codicon-tag mr-1"></span>
							{t("marketplace:filters.tags.selected")}
						</div>
						<Button
							className="shadow-none font-normal flex items-center gap-1 h-auto py-0.5 px-1.5 text-xs"
							size="sm"
							variant="secondary"
							onClick={(e) => {
								e.stopPropagation()
								manager.transition({
									type: "UPDATE_FILTERS",
									payload: { filters: { tags: [] } },
								})
							}}>
							<span className="codicon codicon-close"></span>
							{t("marketplace:filters.tags.clear")}
						</Button>
					</div>
				)}
			</div>

			{state.isFetching && isEmpty && (
				<div className="flex flex-col items-center justify-center h-64 text-vscode-descriptionForeground animate-fade-in">
					<div className="animate-spin mb-4">
						<span className="codicon codicon-sync text-3xl"></span>
					</div>
					<p>{t("marketplace:items.refresh.refreshing")}</p>
					<p className="text-sm mt-2 animate-pulse">{t("marketplace:items.refresh.mayTakeMoment")}</p>
				</div>
			)}

			{!state.isFetching && isEmpty && (
				<div className="flex flex-col items-center justify-center h-64 text-vscode-descriptionForeground animate-fade-in">
					<span className="codicon codicon-inbox text-4xl mb-4 opacity-70"></span>
					<p className="font-medium">{t("marketplace:items.empty.noItems")}</p>
					<p className="text-sm mt-2">{t("marketplace:items.empty.adjustFilters")}</p>
					<Button
						onClick={() =>
							manager.transition({
								type: "UPDATE_FILTERS",
								payload: { filters: { search: "", type: "", tags: [], installed: "all" } },
							})
						}
						className="mt-4 bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground transition-colors">
						<span className="codicon codicon-clear-all mr-2"></span>
						{t("marketplace:items.empty.clearAllFilters")}
					</Button>
				</div>
			)}

			{!state.isFetching && !isEmpty && (
				<div className="pb-3">
					{orgMcps.length > 0 && (
						<div className="mb-6">
							<div className="flex items-center gap-2 mb-3 px-1">
								<span className="codicon codicon-organization text-lg"></span>
								<h3 className="text-sm font-semibold text-vscode-foreground">
									{t("marketplace:sections.organizationMcps", {
										organization: cloudUserInfo?.organizationName,
									})}
								</h3>
								<div className="flex-1 h-px bg-vscode-input-border"></div>
							</div>
							<div className="grid grid-cols-1 min-[450px]:grid-cols-2 min-[750px]:grid-cols-3 min-[1050px]:grid-cols-4 gap-3">
								{orgMcps.map((item) => (
									<MarketplaceItemCard
										key={`org-${item.id}`}
										item={item}
										filters={state.filters}
										setFilters={(filters) =>
											manager.transition({
												type: "UPDATE_FILTERS",
												payload: { filters },
											})
										}
										installed={{
											project: marketplaceInstalledMetadata?.project?.[item.id],
											global: marketplaceInstalledMetadata?.global?.[item.id],
										}}
									/>
								))}
							</div>
						</div>
					)}

					{items.length > 0 && (
						<div>
							{(orgMcps.length > 0 || !isSearchActive) && (
								<div className="flex items-center gap-2 mb-3 px-1">
									<span className={cn("codicon text-lg", isSearchActive ? "codicon-globe" : "codicon-star-full")}></span>
									<h3 className="text-sm font-semibold text-vscode-foreground">
										{isSearchActive ? t("marketplace:sections.marketplace") : t("marketplace:sections.featured")}
									</h3>
									<div className="flex-1 h-px bg-vscode-input-border"></div>
								</div>
							)}
							<div className="grid grid-cols-1 min-[450px]:grid-cols-2 min-[750px]:grid-cols-3 min-[1050px]:grid-cols-4 gap-3">
								{items.map((item) => (
									<MarketplaceItemCard
										key={item.id}
										item={item}
										filters={state.filters}
										setFilters={(filters) =>
											manager.transition({
												type: "UPDATE_FILTERS",
												payload: { filters },
											})
										}
										installed={{
											project: marketplaceInstalledMetadata?.project?.[item.id],
											global: marketplaceInstalledMetadata?.global?.[item.id],
										}}
									/>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</>
	)
}
