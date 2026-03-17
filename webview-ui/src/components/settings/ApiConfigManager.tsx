import { memo, useEffect, useRef, useState } from "react"
import { AlertTriangle, Users2, Plus, Edit2, Trash2, Check, X } from "lucide-react"

import type { ProviderSettingsEntry, OrganizationAllowList, ProfileType } from "@roo-code/types" // kade_change - autocomplete profile type system
import { MODEL_SELECTION_ENABLED } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	type SearchableSelectOption,
	Button,
	Input,
	Dialog,
	DialogContent,
	DialogTitle,
	StandardTooltip,
	SearchableSelect,
	// kade_change start - autocomplete profile type system
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
	// kade_change end
} from "@/components/ui"
import { getProviderIcon } from "./providerIcons"

interface ApiConfigManagerProps {
	currentApiConfigName?: string
	activeApiConfigName?: string // kade_change: Track which profile is actually active
	listApiConfigMeta?: ProviderSettingsEntry[]
	organizationAllowList?: OrganizationAllowList
	onSelectConfig: (configName: string) => void
	onActivateConfig?: (configName: string) => void // kade_change: Explicit activation handler
	onDeleteConfig: (configName: string) => void
	onRenameConfig: (oldName: string, newName: string) => void
	onUpsertConfig: (configName: string, profileType?: ProfileType) => void // kade_change - autocomplete profile type system
}

const ApiConfigManager = ({
	currentApiConfigName = "",
	activeApiConfigName, // kade_change: Track which profile is actually active
	listApiConfigMeta = [],
	organizationAllowList,
	onSelectConfig,
	onActivateConfig, // kade_change: Explicit activation handler
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
}: ApiConfigManagerProps) => {
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [newProfileType, setNewProfileType] = useState<ProfileType>("chat") // kade_change - autocomplete profile type system
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)

	// Check if a profile is valid based on the organization allow list
	const isProfileValid = (profile: ProviderSettingsEntry): boolean => {
		// If no organization allow list or allowAll is true, all profiles are valid
		if (!organizationAllowList || organizationAllowList.allowAll) {
			return true
		}

		// Check if the provider is allowed
		const provider = profile.apiProvider
		if (!provider) return true

		const providerConfig = organizationAllowList.providers[provider]
		if (!providerConfig) {
			return false
		}

		// If provider allows all models, profile is valid
		return !!providerConfig.allowAll || !!(providerConfig.models && providerConfig.models.length > 0)
	}

	const validateName = (name: string, isNewProfile: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return t("settings:providers.nameEmpty")

		const nameExists = listApiConfigMeta?.some((config) => config.name.toLowerCase() === trimmed.toLowerCase())

		// For new profiles, any existing name is invalid.
		if (isNewProfile && nameExists) {
			return t("settings:providers.nameExists")
		}

		// For rename, only block if trying to rename to a different existing profile.
		if (!isNewProfile && nameExists && trimmed.toLowerCase() !== currentApiConfigName?.toLowerCase()) {
			return t("settings:providers.nameExists")
		}

		return null
	}

	const resetCreateState = () => {
		setIsCreating(false)
		setNewProfileName("")
		setNewProfileType("chat") // kade_change - autocomplete profile type system
		setError(null)
	}

	const resetRenameState = () => {
		setIsRenaming(false)
		setInputValue("")
		setError(null)
	}

	// Focus input when entering rename mode.
	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	// Focus input when opening new dialog.
	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	// Reset state when current profile changes.
	useEffect(() => {
		resetCreateState()
		resetRenameState()
	}, [currentApiConfigName])

	const handleSelectConfig = (configName: string) => {
		if (!configName) return
		onSelectConfig(configName)
	}

	const handleAdd = () => {
		resetCreateState()
		setIsCreating(true)
	}

	const handleStartRename = () => {
		setIsRenaming(true)
		setInputValue(currentApiConfigName || "")
		setError(null)
	}

	const handleCancel = () => {
		resetRenameState()
	}

	const handleSave = () => {
		const trimmedValue = inputValue.trim()
		const error = validateName(trimmedValue, false)

		if (error) {
			setError(error)
			return
		}

		if (isRenaming && currentApiConfigName) {
			if (currentApiConfigName === trimmedValue) {
				resetRenameState()
				return
			}
			onRenameConfig(currentApiConfigName, trimmedValue)
		}

		resetRenameState()
	}

	const handleNewProfileSave = () => {
		const trimmedValue = newProfileName.trim()
		const error = validateName(trimmedValue, true)

		if (error) {
			setError(error)
			return
		}

		onUpsertConfig(trimmedValue, newProfileType) // kade_change - autocomplete profile type system
		resetCreateState()
	}

	const handleDelete = () => {
		if (!currentApiConfigName || !listApiConfigMeta || listApiConfigMeta.length <= 1) return

		// Let the extension handle both deletion and selection.
		onDeleteConfig(currentApiConfigName)
	}

	const isOnlyProfile = listApiConfigMeta?.length === 1
	const isEditingDifferentProfile = activeApiConfigName && currentApiConfigName !== activeApiConfigName // kade_change: Check if we're editing a different profile than the active one

	return (
		<div className="group relative flex flex-col gap-3 rounded-xl border border-white/[0.04] bg-[#282828] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all hover:border-white/[0.08] overflow-hidden font-sans">
			{/* Header Section */}
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-2 min-w-0">
					<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
						<Users2 size={14} />
					</div>
					<div className="min-w-0">
						<h3 className="text-sm font-semibold text-vscode-foreground truncate">
							{t("settings:profiles.title", { defaultValue: "Config Profiles" })}
						</h3>
					</div>
				</div>
				<StandardTooltip content={t("settings:providers.addProfile")}>
					<Button
						variant="secondary"
						size="icon"
						onClick={handleAdd}
						data-testid="add-profile-button"
						className="h-7 w-7 bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground shrink-0">
						<Plus className="size-3.5" />
					</Button>
				</StandardTooltip>
			</div>

			{/* Content Section */}
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-2">
					{isRenaming ? (
						<div data-testid="rename-form" className="flex items-center gap-2">
							<Input
								ref={inputRef}
								value={inputValue}
								onChange={(e) => {
									setInputValue(e.target.value)
									setError(null)
								}}
								placeholder={t("settings:providers.enterNewName")}
								onKeyDown={(e) => {
									if (e.key === "Enter" && inputValue.trim()) {
										handleSave()
									} else if (e.key === "Escape") {
										handleCancel()
									}
								}}
								className="h-8 grow min-w-0"
							/>
							<div className="flex items-center gap-1 shrink-0">
								<Button
									variant="ghost"
									size="icon"
									disabled={!inputValue.trim()}
									onClick={handleSave}
									data-testid="save-rename-button"
									className="h-7 w-7 text-green-500 hover:bg-green-500/10">
									<Check className="size-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onClick={handleCancel}
									data-testid="cancel-rename-button"
									className="h-7 w-7 text-red-500 hover:bg-red-500/10">
									<X className="size-3.5" />
								</Button>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<SearchableSelect
								value={currentApiConfigName}
								onValueChange={handleSelectConfig}
								options={listApiConfigMeta.map((config) => {
									const valid = isProfileValid(config)
									const isActive = config.name === activeApiConfigName
									const profileType = config.profileType || "chat"
									const providerIcon = config.apiProvider ? getProviderIcon(config.apiProvider, "shrink-0") : undefined

									return {
										value: config.name,
										label: isActive ? `${config.name} (Active)` : config.name,
										icon: providerIcon,
										render: (
											<div className="flex w-full items-center justify-between gap-2">
												<div className="flex min-w-0 items-center gap-2">
													{!valid && (
														<StandardTooltip content={t("settings:validation.profileInvalid")}>
															<AlertTriangle size={14} className="shrink-0 text-vscode-errorForeground" />
														</StandardTooltip>
													)}
													<span className="truncate font-medium">{config.name}</span>
												</div>
												<div className="flex items-center gap-2 shrink-0">
													{isActive && (
														<span className="flex h-4 items-center rounded-full bg-green-500/20 px-1.5 text-[9px] font-medium text-green-500">
															Active
														</span>
													)}
													<span
														className={`flex h-4 items-center rounded-full px-1.5 text-[9px] font-medium ${profileType === "autocomplete"
															? "bg-purple-500/20 text-purple-500"
															: "bg-blue-500/20 text-blue-500"
															}`}>
														{profileType === "autocomplete" ? "AC" : "Chat"}
													</span>
												</div>
											</div>
										),
										disabled: !valid,
									} as SearchableSelectOption
								})}
								placeholder={t("settings:common.select")}
								searchPlaceholder={t("settings:providers.searchPlaceholder")}
								emptyMessage={t("settings:providers.noMatchFound")}
								searchable={false}
								className="h-8 flex-1 min-w-0"
								data-testid="select-component"
							/>
							{currentApiConfigName && (
								<div className="flex items-center gap-0.5 shrink-0">
									<StandardTooltip content={t("settings:providers.renameProfile")}>
										<Button
											variant="ghost"
											size="icon"
											onClick={handleStartRename}
											data-testid="rename-profile-button"
											className="h-8 w-8 text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground">
											<Edit2 className="size-3.5" />
										</Button>
									</StandardTooltip>
									<StandardTooltip
										content={
											isOnlyProfile
												? t("settings:providers.cannotDeleteOnlyProfile")
												: t("settings:providers.deleteProfile")
										}>
										<Button
											variant="ghost"
											size="icon"
											onClick={handleDelete}
											data-testid="delete-profile-button"
											disabled={isOnlyProfile}
											className="h-8 w-8 text-vscode-errorForeground hover:bg-vscode-errorForeground/10">
											<Trash2 className="size-3.5" />
										</Button>
									</StandardTooltip>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Active State / Activation Button */}
				<div className="flex items-center justify-between rounded-md bg-vscode-editor-background/50 p-2">
					<div className="text-[11px] text-vscode-descriptionForeground">
						{isEditingDifferentProfile ? (
							<span className="flex items-center gap-1.5 text-vscode-editorWarning-foreground">
								<AlertTriangle size={11} />
								Viewing {currentApiConfigName} (inactive)
							</span>
						) : (
							<span className="flex items-center gap-1.5 text-green-500">
								<Check size={11} />
								Current Active Profile
							</span>
						)}
					</div>
					{isEditingDifferentProfile && onActivateConfig && (
						<Button
							size="sm"
							onClick={() => onActivateConfig(currentApiConfigName)}
							data-testid="activate-profile-button"
							className="h-6 bg-primary text-[10px] font-medium text-primary-foreground hover:bg-primary/90 px-2">
							{t("settings:providers.makeActiveProfile")}
						</Button>
					)}
				</div>
			</div>

			<Dialog
				open={isCreating}
				onOpenChange={(open: boolean) => {
					if (open) {
						setIsCreating(true)
						setNewProfileName("")
						setError(null)
					} else {
						resetCreateState()
					}
				}}
				aria-labelledby="new-profile-title">
				<DialogContent className="max-w-sm bg-vscode-editor-background border border-vscode-editorGroup-border p-5 shadow-2xl sm:rounded-xl">
					<DialogTitle className="text-base font-semibold text-vscode-foreground">
						{t("settings:providers.newProfile")}
					</DialogTitle>
					<div className="mt-3 flex flex-col gap-3">
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-vscode-foreground">
								{t("settings:providers.profileName")}
							</label>
							<Input
								ref={newProfileInputRef}
								value={newProfileName}
								onInput={(e: any) => {
									setNewProfileName(e.target.value)
									setError(null)
								}}
								placeholder={t("settings:providers.enterProfileName")}
								data-testid="new-profile-input"
								onKeyDown={(e: any) => {
									if (e.key === "Enter" && newProfileName.trim()) {
										handleNewProfileSave()
									} else if (e.key === "Escape") {
										resetCreateState()
									}
								}}
								className="h-8"
							/>
						</div>
						{MODEL_SELECTION_ENABLED && (
							<div className="space-y-1.5">
								<label className="text-xs font-medium text-vscode-foreground">
									{t("settings:providers.profileType")}
								</label>
								<Select
									value={newProfileType}
									onValueChange={(value) => setNewProfileType(value as ProfileType)}>
									<SelectTrigger className="h-8 w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent className="bg-vscode-dropdown-background border-vscode-dropdown-border">
										<SelectItem value="chat">{t("settings:providers.profileTypeChat")}</SelectItem>
										<SelectItem value="autocomplete">{t("settings:providers.profileTypeAutocomplete")}</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-[10px] text-vscode-descriptionForeground">
									{t("settings:providers.profileTypeDescription")}
								</p>
							</div>
						)}
					</div>
					{error && (
						<div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-500/10 p-2 text-[10px] text-red-500">
							<AlertTriangle size={10} />
							<span data-testid="error-message">{error}</span>
						</div>
					)}
					<div className="mt-4 flex justify-end gap-2">
						<Button
							variant="ghost"
							onClick={resetCreateState}
							data-testid="cancel-new-profile-button"
							className="h-8 text-xs">
							{t("settings:common.cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={!newProfileName.trim()}
							onClick={handleNewProfileSave}
							data-testid="create-profile-button"
							className="h-8 text-xs">
							{t("settings:providers.createProfile")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default memo(ApiConfigManager)
