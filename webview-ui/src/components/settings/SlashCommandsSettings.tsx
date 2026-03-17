import React, { useState, useEffect } from "react"
import { Trash2, Plus, Globe, Folder, Settings, SquareSlash } from "lucide-react"
import { Trans } from "react-i18next"

import type { Command } from "@roo/ExtensionMessage"

import { useAppTranslation } from "@/i18n/TranslationContext"
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
	Button,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { buildDocLink } from "@/utils/docLinks"
import { cn } from "@/lib/utils"
import { ShimmerText } from "../ui/shimmer-text"


import { Section } from "./Section"
import { SlashCommandItem } from "../chat/SlashCommandItem"
import { useRegisterSetting } from "./useSettingsSearch"

export const SlashCommandsSettings: React.FC = () => {
	const { t } = useAppTranslation()
	// Register settings for search
	useRegisterSetting({ settingId: "slash-commands-section", section: "slashCommands", label: t("settings:sections.slashCommands") })

	const { commands, cwd } = useExtensionState()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [commandToDelete, setCommandToDelete] = useState<Command | null>(null)
	const [globalNewName, setGlobalNewName] = useState("")
	const [workspaceNewName, setWorkspaceNewName] = useState("")

	// Check if we're in a workspace/project
	const hasWorkspace = Boolean(cwd)

	// Request commands when component mounts
	useEffect(() => {
		handleRefresh()
	}, [])

	const handleRefresh = () => {
		vscode.postMessage({ type: "requestCommands" })
	}

	const handleDeleteClick = (command: Command) => {
		setCommandToDelete(command)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = () => {
		if (commandToDelete) {
			vscode.postMessage({
				type: "deleteCommand",
				text: commandToDelete.name,
				values: { source: commandToDelete.source },
			})
			setDeleteDialogOpen(false)
			setCommandToDelete(null)
			// Refresh the commands list after deletion
			setTimeout(handleRefresh, 100)
		}
	}

	const handleDeleteCancel = () => {
		setDeleteDialogOpen(false)
		setCommandToDelete(null)
	}

	const handleCreateCommand = (source: "global" | "project", name: string) => {
		if (!name.trim()) return

		// Append .md if not already present
		const fileName = name.trim().endsWith(".md") ? name.trim() : `${name.trim()}.md`

		vscode.postMessage({
			type: "createCommand",
			text: fileName,
			values: { source },
		})

		// Clear the input and refresh
		if (source === "global") {
			setGlobalNewName("")
		} else {
			setWorkspaceNewName("")
		}
		setTimeout(handleRefresh, 500)
	}

	const handleCommandClick = (command: Command) => {
		// For now, we'll just show the command name - editing functionality can be added later
		// This could be enhanced to open the command file in the editor
		console.log(`Command clicked: ${command.name} (${command.source})`)
	}

	// Group commands by source
	const builtInCommands = commands?.filter((cmd) => cmd.source === "built-in") || []
	const globalCommands = commands?.filter((cmd) => cmd.source === "global") || []
	const projectCommands = commands?.filter((cmd) => cmd.source === "project") || []

	return (
		<div>


			<Section className="flex flex-col gap-6">
				{/* Description section */}
				<div className="text-vscode-descriptionForeground text-[13px] leading-relaxed px-1">
					<Trans
						i18nKey="settings:slashCommands.description"
						components={{
							DocsLink: (
								<a
									href={buildDocLink("features/slash-commands", "slash_commands_settings")}
									target="_blank"
									rel="noopener noreferrer"
									className="text-vscode-textLink-foreground hover:underline">
									Docs
								</a>
							),
						}}
					/>
				</div>

				{/* Global Commands Section */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl" data-setting-id="slash-commands-section-global">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Globe className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							{t("chat:slashCommands.globalCommands")}
						</span>
					</div>
					<div className="flex flex-col gap-3">
						<div className="rounded-xl border border-vscode-input-border/20 overflow-hidden bg-vscode-editor-background/20">
							{globalCommands.map((command) => (
								<SlashCommandItem
									key={`global-${command.name}`}
									command={command}
									onDelete={handleDeleteClick}
									onClick={handleCommandClick}
								/>
							))}
							{/* New global command input */}
							<div className="px-4 py-3 flex items-center gap-2 bg-vscode-input-background/20 border-t border-vscode-input-border/20">
								<input
									type="text"
									value={globalNewName}
									onChange={(e) => setGlobalNewName(e.target.value)}
									placeholder={t("chat:slashCommands.newGlobalCommandPlaceholder")}
									className="flex-1 bg-vscode-input-background text-vscode-input-foreground placeholder-vscode-input-placeholderForeground border border-vscode-input-border/50 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-vscode-focusBorder transition-colors"
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleCreateCommand("global", globalNewName)
										}
									}}
								/>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => handleCreateCommand("global", globalNewName)}
									disabled={!globalNewName.trim()}
									className="size-8 flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-vscode-button-background/10 rounded-lg transition-all">
									<Plus className="w-4 h-4" />
								</Button>
							</div>
						</div>
					</div>
				</div>

				{/* Workspace Commands Section - Only show if in a workspace */}
				{hasWorkspace && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl" data-setting-id="slash-commands-section-workspace">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<Folder className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								{t("chat:slashCommands.workspaceCommands")}
							</span>
						</div>
						<div className="flex flex-col gap-3">
							<div className="rounded-xl border border-vscode-input-border/20 overflow-hidden bg-vscode-editor-background/20">
								{projectCommands.map((command) => (
									<SlashCommandItem
										key={`project-${command.name}`}
										command={command}
										onDelete={handleDeleteClick}
										onClick={handleCommandClick}
									/>
								))}
								{/* New workspace command input */}
								<div className="px-4 py-3 flex items-center gap-2 bg-vscode-input-background/20 border-t border-vscode-input-border/20">
									<input
										type="text"
										value={workspaceNewName}
										onChange={(e) => setWorkspaceNewName(e.target.value)}
										placeholder={t("chat:slashCommands.newWorkspaceCommandPlaceholder")}
										className="flex-1 bg-vscode-input-background text-vscode-input-foreground placeholder-vscode-input-placeholderForeground border border-vscode-input-border/50 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-vscode-focusBorder transition-colors"
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												handleCreateCommand("project", workspaceNewName)
											}
										}}
									/>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleCreateCommand("project", workspaceNewName)}
										disabled={!workspaceNewName.trim()}
										className="size-8 flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-vscode-button-background/10 rounded-lg transition-all">
										<Plus className="w-4 h-4" />
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Built-in Commands Section */}
				{builtInCommands.length > 0 && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl" data-setting-id="slash-commands-section-builtin">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<Settings className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								{t("chat:slashCommands.builtInCommands")}
							</span>
						</div>
						<div className="flex flex-col gap-3">
							<div className="rounded-xl border border-vscode-input-border/20 overflow-hidden bg-vscode-editor-background/20">
								{builtInCommands.map((command) => (
									<SlashCommandItem
										key={`built-in-${command.name}`}
										command={command}
										onDelete={handleDeleteClick}
										onClick={handleCommandClick}
									/>
								))}
							</div>
						</div>
					</div>
				)}
			</Section>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent onEscapeKeyDown={handleDeleteCancel} className="bg-[#1e1e1e] border-white/5 p-6 max-w-[300px] rounded-[1.5rem] shadow-none ring-1 ring-white/10">
					<div className="space-y-6">
						<AlertDialogHeader className="space-y-2 text-center">
							<AlertDialogTitle className="text-lg font-semibold text-vscode-foreground text-center">
								{t("chat:slashCommands.deleteDialog.title")}
							</AlertDialogTitle>
							<AlertDialogDescription className="text-vscode-descriptionForeground text-xs leading-relaxed text-center px-1">
								{t("chat:slashCommands.deleteDialog.description", { name: commandToDelete?.name })}
							</AlertDialogDescription>
						</AlertDialogHeader>

						<AlertDialogFooter className="flex flex-col gap-2">
							<AlertDialogAction
								onClick={handleDeleteConfirm}
								className="w-full h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all border-none flex items-center justify-center gap-2">
								<Trash2 size={14} />
								{t("chat:slashCommands.deleteDialog.confirm")}
							</AlertDialogAction>
							<AlertDialogCancel onClick={handleDeleteCancel} className="w-full h-9 rounded-xl bg-transparent hover:bg-white/5 text-vscode-descriptionForeground text-xs border-none transition-all">
								{t("chat:slashCommands.deleteDialog.cancel")}
							</AlertDialogCancel>
						</AlertDialogFooter>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
