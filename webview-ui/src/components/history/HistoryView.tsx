import React, { memo, useState } from "react"

import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { BatchDeleteTaskDialog } from "./BatchDeleteTaskDialog"
import { cn } from "@/lib/utils"

import {
	Button,
	Checkbox,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Tab, TabContent } from "../common/Tab"
import { useTaskSearch } from "./useTaskSearch"
import TaskItem from "./TaskItem"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const {
		data, // kilocode_change
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
		// kilocode_change start
		taskHistoryFullLength,
		showFavoritesOnly,
		setShowFavoritesOnly,
		setRequestedPageIndex,
		// kilocode_change end
	} = useTaskSearch()
	// kilocode_change start
	const tasks = data?.historyItems ?? []
	const pageIndex = data?.pageIndex ?? 0
	const pageCount = data?.pageCount ?? 1
	// kilocode_change end
	const { t } = useAppTranslation()

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [isSelectionMode, setIsSelectionMode] = useState(false)
	const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
	const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState<boolean>(false)

	// Toggle selection mode
	const toggleSelectionMode = () => {
		setIsSelectionMode(!isSelectionMode)
		if (isSelectionMode) {
			setSelectedTaskIds([])
		}
	}

	// Toggle selection for a single task
	const toggleTaskSelection = (taskId: string, isSelected: boolean) => {
		if (isSelected) {
			setSelectedTaskIds((prev) => [...prev, taskId])
		} else {
			setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
		}
	}

	// Toggle select all tasks
	const toggleSelectAll = (selectAll: boolean) => {
		if (selectAll) {
			setSelectedTaskIds(tasks.map((task) => task.id))
		} else {
			setSelectedTaskIds([])
		}
	}

	// Handle batch delete button click
	const handleBatchDelete = () => {
		if (selectedTaskIds.length > 0) {
			setShowBatchDeleteDialog(true)
		}
	}

	return (
		<Tab className="bottom-0">
			<TabContent className="px-3 py-0 overflow-y-auto overflow-x-hidden flex flex-col h-full">
				<div className="space-y-4 pb-4">
					{/* Header Section */}
					<div className="relative flex items-center gap-2 p-1 pb-2 border-b border-white/5 mb-2">
						<div className="relative flex-1 min-w-[120px]">
							<div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
								<span className="codicon codicon-search text-vscode-foreground/50 text-xs" />
							</div>
							<input
								type="text"
								className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded h-7 pl-7 pr-6 text-sm focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
								placeholder={t("history:searchPlaceholder")}
								value={searchQuery}
								onInput={(e) => {
									const newValue = (e.target as HTMLInputElement)?.value
									setSearchQuery(newValue)
									if (newValue && !searchQuery && sortOption !== "mostRelevant") {
										setLastNonRelevantSort(sortOption)
										setSortOption("mostRelevant")
									}
								}}
							/>
							{searchQuery && (
								<button
									className="absolute inset-y-0 right-1.5 flex items-center text-vscode-foreground/50 hover:text-vscode-foreground cursor-pointer"
									onClick={() => setSearchQuery("")}
								>
									<span className="codicon codicon-close text-xs" />
								</button>
							)}
						</div>

						<Select
							value={showAllWorkspaces ? "all" : "current"}
							onValueChange={(value) => setShowAllWorkspaces(value === "all")}>
							<SelectTrigger className="w-[100px] h-7 text-xs bg-transparent border-none hover:bg-vscode-toolbar-hoverBackground px-2 rounded-sm gap-1 justify-start">
								<span className="codicon codicon-folder opacity-70" />
								<span className="truncate">
									{t(`history:workspace.${showAllWorkspaces ? "all" : "current"}`)}
								</span>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="current" className="text-xs">
									{t("history:workspace.current")}
								</SelectItem>
								<SelectItem value="all" className="text-xs">
									{t("history:workspace.all")}
								</SelectItem>
							</SelectContent>
						</Select>

						<Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
							<SelectTrigger className="w-[28px] h-7 text-xs bg-transparent border-none hover:bg-vscode-toolbar-hoverBackground px-0 justify-center rounded-sm">
								<span className="codicon codicon-arrow-down opacity-70" />
							</SelectTrigger>
							<SelectContent align="end">
								<SelectItem value="newest" className="text-xs">{t("history:newest")}</SelectItem>
								<SelectItem value="oldest" className="text-xs">{t("history:oldest")}</SelectItem>
								<SelectItem value="mostExpensive" className="text-xs">{t("history:mostExpensive")}</SelectItem>
								<SelectItem value="mostTokens" className="text-xs">{t("history:mostTokens")}</SelectItem>
								<SelectItem value="mostRelevant" disabled={!searchQuery} className="text-xs">{t("history:mostRelevant")}</SelectItem>
							</SelectContent>
						</Select>

						<StandardTooltip content={t("history:favorites")}>
							<Button
								variant="ghost"
								onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
								className={cn("h-7 w-7 p-0 rounded-sm", showFavoritesOnly ? "text-yellow-500" : "opacity-70 hover:opacity-100")}>
								<span className={`codicon ${showFavoritesOnly ? "codicon-star-full" : "codicon-star-empty"}`} />
							</Button>
						</StandardTooltip>

						<div className="w-[1px] h-4 bg-vscode-widget-border mx-0.5" />

						<StandardTooltip
							content={
								isSelectionMode
									? `${t("history:exitSelectionMode")}`
									: `${t("history:enterSelectionMode")}`
							}>
							<Button
								variant={isSelectionMode ? "primary" : "ghost"}
								onClick={toggleSelectionMode}
								className="h-7 w-7 p-0 rounded-sm"
								data-testid="toggle-selection-mode-button">
								<span
									className={`codicon ${isSelectionMode ? "codicon-check-all" : "codicon-checklist"}`}
								/>
							</Button>
						</StandardTooltip>
						<Button onClick={onDone} variant="ghost" className="h-7 w-7 p-0 rounded-sm">
							<span className="codicon codicon-close" />
						</Button>

						{/* Select all control overlay - appears over search when active */}
						{isSelectionMode && tasks.length > 0 && (
							<div className="absolute inset-0 z-10 flex items-center px-3 bg-vscode-editor-background border-b border-vscode-focusBorder/50 animate-in fade-in slide-in-from-top-1">
								<div className="flex items-center gap-2 w-full">
									<Checkbox
										checked={tasks.length > 0 && selectedTaskIds.length === tasks.length}
										onCheckedChange={(checked) => toggleSelectAll(checked === true)}
										className="w-3.5 h-3.5"
									/>
									<span className="text-vscode-foreground text-sm font-medium">
										{selectedTaskIds.length === tasks.length
											? t("history:deselectAll")
											: t("history:selectAll")}
									</span>
									<span className="ml-auto text-vscode-descriptionForeground px-1.5 py-0.5 rounded-full bg-vscode-badge-background text-vscode-badge-foreground text-xs">
										{selectedTaskIds.length}/{taskHistoryFullLength}
									</span>
									<Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-2" onClick={toggleSelectionMode}>
										<span className="codicon codicon-close" />
									</Button>
								</div>
							</div>
						)}
					</div>

					{/* Task List */}
					{tasks.map((item, index) => (
						<TaskItem
							key={item.id}
							item={item}
							variant="full"
							showWorkspace={showAllWorkspaces}
							isSelectionMode={isSelectionMode}
							isSelected={selectedTaskIds.includes(item.id)}
							onToggleSelection={toggleTaskSelection}
							onDelete={setDeleteTaskId}
							className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards text-xs"
							style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
						/>
					))}
				</div>
			</TabContent>

			{/* Bottom Action Bar */}
			<div className="bg-vscode-editor-background/95 backdrop-blur border-t border-white/5 z-20 text-xs">
				{/* Fixed action bar at bottom - only shown in selection mode with selected items */}
				{isSelectionMode && selectedTaskIds.length > 0 && (
					<div className="p-2 flex justify-between items-center bg-vscode-input-background/20">
						<div className="text-vscode-foreground font-medium">
							{t("history:selectedItems", {
								selected: selectedTaskIds.length,
								total: taskHistoryFullLength, // kilocode_change
							})}
						</div>
						<div className="flex gap-2">
							<Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedTaskIds([])}>
								{t("history:clearSelection")}
							</Button>
							<Button variant="primary" size="sm" className="h-6 text-xs bg-red-500 hover:bg-red-600 text-white border-none" onClick={handleBatchDelete}>
								{t("history:deleteSelected")}
							</Button>
						</div>
					</div>
				)}
				{
					// kilocode_change start
					<div className="p-2 flex justify-between items-center h-10">
						<span className="text-vscode-descriptionForeground opacity-80 pl-1">
							{t("kilocode:pagination.page", {
								page: pageIndex + 1,
								count: pageCount,
							})}
						</span>
						<div className="flex gap-1">
							<Button
								variant="ghost"
								disabled={pageIndex <= 0}
								className="h-7 w-7 p-0 rounded-full"
								onClick={() => {
									if (pageIndex > 0) {
										setRequestedPageIndex(pageIndex - 1)
									}
								}}>
								<span className="codicon codicon-chevron-left" />
							</Button>
							<Button
								variant="ghost"
								disabled={pageIndex >= pageCount - 1}
								className="h-7 w-7 p-0 rounded-full"
								onClick={() => {
									if (pageIndex < pageCount - 1) {
										setRequestedPageIndex(pageIndex + 1)
									}
								}}>
								<span className="codicon codicon-chevron-right" />
							</Button>
						</div>
					</div>
					// kilocode_change end
				}
			</div>

			{/* Delete dialog */}
			{
				deleteTaskId && (
					<DeleteTaskDialog taskId={deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)} open />
				)
			}

			{/* Batch delete dialog */}
			{
				showBatchDeleteDialog && (
					<BatchDeleteTaskDialog
						taskIds={selectedTaskIds}
						open={showBatchDeleteDialog}
						onOpenChange={(open) => {
							if (!open) {
								setShowBatchDeleteDialog(false)
								setSelectedTaskIds([])
								setIsSelectionMode(false)
							}
						}}
					/>
				)
			}
		</Tab >
	)
}

export default memo(HistoryView)
