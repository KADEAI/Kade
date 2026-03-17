import { HTMLAttributes, useMemo } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRegisterSetting } from "./useSettingsSearch"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import {
	Database,
	FoldVertical,
	Layers,
	FileText,
	ShieldAlert,
	Clock,
	DollarSign,
	Scan,
	Info,
	Sparkles,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	Button,
	StandardTooltip,
} from "@/components/ui"

import { SetCachedStateField } from "./types"

import { Section } from "./Section"
import { vscode } from "@/utils/vscode"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	listApiConfigMeta: any[]
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	maxReadFileLine?: number
	maxImageFileSize?: number
	maxTotalImageSize?: number
	maxConcurrentFileReads?: number
	allowVeryLargeReads?: boolean
	profileThresholds?: Record<string, number>
	includeDiagnosticMessages?: boolean
	maxDiagnosticMessages?: number
	writeDelayMs: number
	includeCurrentTime?: boolean
	includeCurrentCost?: boolean
	maxGitStatusFiles?: number
	slidingWindowSize?: number
	setCachedStateField: SetCachedStateField<
		| "autoCondenseContext"
		| "autoCondenseContextPercent"
		| "maxOpenTabsContext"
		| "maxWorkspaceFiles"
		| "showRooIgnoredFiles"
		| "maxReadFileLine"
		| "maxImageFileSize"
		| "maxTotalImageSize"
		| "maxConcurrentFileReads"
		| "allowVeryLargeReads"
		| "profileThresholds"
		| "includeDiagnosticMessages"
		| "maxDiagnosticMessages"
		| "writeDelayMs"
		| "includeCurrentTime"
		| "includeCurrentCost"
		| "includeCurrentCost"
		| "maxGitStatusFiles"
		| "slidingWindowSize"
	>
}

const SettingsCard = ({
	title,
	icon: Icon,
	children,
	description,
}: {
	title: string
	icon: any
	children: React.ReactNode
	description?: string
}) => (
	<div className="bg-vscode-sideBar-background/40 border border-vscode-widget-border rounded-[24px] p-5 flex flex-col gap-5 backdrop-blur-sm shadow-xl transition-all hover:bg-vscode-sideBar-background/60">
		<div className="flex items-center justify-between border-b border-vscode-widget-border/50 pb-3 mb-1">
			<div className="flex items-center gap-2.5">
				<div className="p-1.5 rounded-lg bg-vscode-button-background/10 text-vscode-button-background">
					<Icon className="w-4 h-4" />
				</div>
				<span className="font-semibold text-sm tracking-tight">{title}</span>
			</div>
			{description && (
				<StandardTooltip content={description}>
					<Info className="w-3.5 h-3.5 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			)}
		</div>
		<div className="flex flex-col gap-5">{children}</div>
	</div>
)

const SettingRow = ({
	label,
	description,
	children,
	className,
}: {
	label: string
	description?: string
	children: React.ReactNode
	className?: string
}) => (
	<div className={cn("flex flex-col gap-1.5", className)}>
		<div className="flex items-center justify-between">
			<span className="text-[13px] font-medium text-vscode-foreground/90">{label}</span>
			{description && (
				<StandardTooltip content={description}>
					<Info className="w-3 h-3 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			)}
		</div>
		{children}
	</div>
)

export const ContextManagementSettings = ({
	autoCondenseContext,
	autoCondenseContextPercent,
	listApiConfigMeta,
	maxOpenTabsContext,
	maxWorkspaceFiles,
	showRooIgnoredFiles,
	setCachedStateField,
	maxReadFileLine,
	maxImageFileSize,
	maxTotalImageSize,
	maxConcurrentFileReads,
	allowVeryLargeReads,
	profileThresholds = {},
	includeDiagnosticMessages,
	maxDiagnosticMessages,
	writeDelayMs,
	includeCurrentTime,
	includeCurrentCost,
	maxGitStatusFiles,
	slidingWindowSize,
	className,
	...props
}: ContextManagementSettingsProps) => {
	const { t } = useAppTranslation()
	const [selectedThresholdProfile, setSelectedThresholdProfile] = React.useState<string>("default")

	// Register settings for search
	useRegisterSetting({ settingId: "context-auto-condense", section: "contextManagement", label: t("settings:contextManagement.autoCondenseContext.name") })
	// useRegisterSetting({ settingId: "context-sliding-window", section: "contextManagement", label: "Sliding Window Size" })
	useRegisterSetting({ settingId: "context-open-tabs", section: "contextManagement", label: t("settings:contextManagement.openTabs.label") })
	useRegisterSetting({ settingId: "context-workspace-files", section: "contextManagement", label: t("settings:contextManagement.workspaceFiles.label") })
	useRegisterSetting({ settingId: "context-git-status-files", section: "contextManagement", label: t("settings:contextManagement.maxGitStatusFiles.label") })
	useRegisterSetting({ settingId: "context-rooignore", section: "contextManagement", label: t("settings:contextManagement.rooignore.label") })
	useRegisterSetting({ settingId: "context-concurrent-reads", section: "contextManagement", label: t("settings:contextManagement.maxConcurrentFileReads.label") })
	useRegisterSetting({ settingId: "context-max-read-file", section: "contextManagement", label: t("settings:contextManagement.maxReadFile.label") })
	useRegisterSetting({ settingId: "context-max-image-size", section: "contextManagement", label: t("settings:contextManagement.maxImageFileSize.label") })
	useRegisterSetting({ settingId: "context-max-total-image-size", section: "contextManagement", label: t("settings:contextManagement.maxTotalImageSize.label") })
	useRegisterSetting({ settingId: "context-allow-large-reads", section: "contextManagement", label: t("kilocode:settings.contextManagement.allowVeryLargeReads.label") })
	useRegisterSetting({ settingId: "context-include-time", section: "contextManagement", label: t("settings:contextManagement.includeCurrentTime.label") })
	useRegisterSetting({ settingId: "context-include-cost", section: "contextManagement", label: t("settings:contextManagement.includeCurrentCost.label") })
	useRegisterSetting({ settingId: "context-include-diagnostics", section: "contextManagement", label: t("settings:contextManagement.diagnostics.includeMessages.label") })

	const getCurrentThresholdValue = () => {
		if (selectedThresholdProfile === "default") {
			return autoCondenseContextPercent
		}
		const profileThreshold = profileThresholds[selectedThresholdProfile]
		if (profileThreshold === undefined || profileThreshold === -1) {
			return autoCondenseContextPercent
		}
		return profileThreshold
	}

	const handleThresholdChange = (value: number) => {
		if (selectedThresholdProfile === "default") {
			setCachedStateField("autoCondenseContextPercent", value)
		} else {
			const newThresholds = {
				...profileThresholds,
				[selectedThresholdProfile]: value,
			}
			setCachedStateField("profileThresholds", newThresholds)
			vscode.postMessage({ type: "updateSettings", updatedSettings: { profileThresholds: newThresholds } })
		}
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>


			<Section className="grid grid-cols-1 gap-6">
				{/* Auto-Condense Card */}
				<div data-setting-id="context-auto-condense">
					<SettingsCard
						title={t("settings:contextManagement.autoCondenseContext.name")}
						icon={Sparkles}
						description={t("settings:contextManagement.condensingThreshold.profileDescription")}>
						<div className="flex items-center justify-between">
							<span className="text-[13px] font-medium opacity-90 transition-opacity">
								Enable Intelligent Context Management
							</span>
							<div className="flex h-5 items-center">
								<VSCodeCheckbox
									checked={autoCondenseContext}
									onChange={(e: any) => setCachedStateField("autoCondenseContext", e.target.checked)}
									className="m-0"
									data-testid="auto-condense-context-checkbox"
								/>
							</div>
						</div>

						{autoCondenseContext && (
							<div className="flex flex-col gap-4 pl-4 border-l-2 border-vscode-focusBorder bg-vscode-focusBorder/5 p-4 rounded-xl animate-in fade-in slide-in-from-left-2 duration-300">
								<div className="flex items-center gap-2 mb-1">
									<FoldVertical size={14} className="text-vscode-focusBorder" />
									<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-focusBorder">
										{t("settings:contextManagement.condensingThreshold.label")}
									</span>
								</div>

								<div className="flex flex-col gap-3">
									<Select
										value={selectedThresholdProfile || "default"}
										onValueChange={(value) => setSelectedThresholdProfile(value)}>
										<SelectTrigger className="w-full h-8 text-xs bg-vscode-input-background" data-testid="threshold-profile-select">
											<SelectValue
												placeholder={
													t("settings:contextManagement.condensingThreshold.selectProfile") || "Select profile"
												}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="default" className="text-xs">
												{t("settings:contextManagement.condensingThreshold.defaultProfile") || "Default Profile"}
											</SelectItem>
											{(listApiConfigMeta || []).map((config) => (
												<SelectItem key={config.id} value={config.id} className="text-xs">
													{config.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>

									<div className="flex flex-col gap-2">
										<div className="flex items-center gap-4">
											<Slider
												min={10}
												max={100}
												step={1}
												value={[getCurrentThresholdValue()]}
												onValueChange={([value]) => handleThresholdChange(value)}
												className="flex-1"
												data-testid="condense-threshold-slider"
											/>
											<span className="w-12 text-right font-mono text-xs bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border font-bold text-vscode-focusBorder">
												{getCurrentThresholdValue()}%
											</span>
										</div>
										<p className="text-[11px] text-vscode-descriptionForeground leading-relaxed">
											{selectedThresholdProfile === "default"
												? t("settings:contextManagement.condensingThreshold.defaultDescription", {
													threshold: autoCondenseContextPercent,
												})
												: t("settings:contextManagement.condensingThreshold.profileDescription")}
										</p>
									</div>
								</div>
							</div>
						)}
					</SettingsCard>
				</div>

				{/* Sliding Window Card disabled */}
				{/* <div data-setting-id="context-sliding-window">
					<SettingsCard title="Context Window" icon={Scan}>
						<SettingRow
							label="Sliding Window Size"
							description="Number of messages to keep in context. Older messages beyond this limit will be dropped before condensation. Set to 0 for unlimited (default).">
							<div className="flex items-center gap-4">
								<Slider
									min={0}
									max={200}
									step={5}
									value={[slidingWindowSize ?? 50]}
									onValueChange={([value]) => setCachedStateField("slidingWindowSize", value)}
									className="flex-1"
									data-testid="sliding-window-slider"
								/>
								<span className="w-16 text-center font-mono text-xs bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
									{(slidingWindowSize === 0 || slidingWindowSize === undefined) ? "Unlimited" : slidingWindowSize}
								</span>
							</div>
						</SettingRow>
					</SettingsCard>
				</div> */}

				{/* Workspace card */}
				<SettingsCard title="Workspace Resources" icon={Layers}>
					<div data-setting-id="context-open-tabs">
						<SettingRow
							label={t("settings:contextManagement.openTabs.label")}
							description={t("settings:contextManagement.openTabs.description")}>
							<div className="flex items-center gap-4">
								<Slider
									min={0}
									max={500}
									step={1}
									value={[maxOpenTabsContext ?? 20]}
									onValueChange={([value]) => setCachedStateField("maxOpenTabsContext", value)}
									className="flex-1"
									data-testid="open-tabs-limit-slider"
								/>
								<span className="w-8 text-right font-mono text-sm bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
									{maxOpenTabsContext ?? 20}
								</span>
							</div>
						</SettingRow>
					</div>

					<div data-setting-id="context-workspace-files">
						<SettingRow
							label={t("settings:contextManagement.workspaceFiles.label")}
							description={t("settings:contextManagement.workspaceFiles.description")}>
							<div className="flex items-center gap-4">
								<Slider
									min={0}
									max={500}
									step={1}
									value={[maxWorkspaceFiles ?? 200]}
									onValueChange={([value]) => setCachedStateField("maxWorkspaceFiles", value)}
									className="flex-1"
									data-testid="workspace-files-limit-slider"
								/>
								<span className="w-8 text-right font-mono text-sm bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
									{maxWorkspaceFiles ?? 200}
								</span>
							</div>
						</SettingRow>
					</div>

					<div data-setting-id="context-git-status-files">
						<SettingRow
							label={t("settings:contextManagement.maxGitStatusFiles.label")}
							description={t("settings:contextManagement.maxGitStatusFiles.description")}>
							<div className="flex items-center gap-4">
								<Slider
									min={0}
									max={50}
									step={1}
									value={[maxGitStatusFiles ?? 0]}
									onValueChange={([value]) => setCachedStateField("maxGitStatusFiles", value)}
									className="flex-1"
									data-testid="max-git-status-files-slider"
								/>
								<span className="w-8 text-right font-mono text-sm bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
									{maxGitStatusFiles ?? 0}
								</span>
							</div>
						</SettingRow>
					</div>

					<div className="pt-2 border-t border-vscode-widget-border/50">
						<VSCodeCheckbox
							checked={showRooIgnoredFiles}
							onChange={(e: any) => setCachedStateField("showRooIgnoredFiles", e.target.checked)}
							className="m-0"
							data-testid="show-rooignored-files-checkbox">
							<div className="flex items-center gap-2">
								<span className="text-[13px] font-medium">
									{t("settings:contextManagement.rooignore.label")}
								</span>
								<StandardTooltip content={t("settings:contextManagement.rooignore.description")}>
									<Info className="w-3 h-3 text-vscode-descriptionForeground cursor-help" />
								</StandardTooltip>
							</div>
						</VSCodeCheckbox>
					</div>
				</SettingsCard>

				{/* Reading Limits Card */}
				<SettingsCard title="File Reading Controls" icon={FileText}>
					<div data-setting-id="context-concurrent-reads">
						<SettingRow
							label={t("settings:contextManagement.maxConcurrentFileReads.label")}
							description={t("settings:contextManagement.maxConcurrentFileReads.description")}>
							<div className="flex items-center gap-4">
								<Slider
									min={1}
									max={100}
									step={1}
									value={[Math.max(1, maxConcurrentFileReads ?? 5)]}
									onValueChange={([value]) => setCachedStateField("maxConcurrentFileReads", value)}
									className="flex-1"
									data-testid="max-concurrent-file-reads-slider"
								/>
								<span className="w-8 text-right font-mono text-sm bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
									{Math.max(1, maxConcurrentFileReads ?? 5)}
								</span>
							</div>
						</SettingRow>
					</div>

					<div data-setting-id="context-max-read-file">
						<SettingRow
							label={t("settings:contextManagement.maxReadFile.label")}
							description={t("settings:contextManagement.maxReadFile.description")}>
							<div className="flex items-center gap-4 bg-vscode-input-background/30 p-2 rounded-lg border border-vscode-input-border/50">
								<Input
									type="number"
									className="w-20 bg-vscode-input-background h-8 text-sm"
									value={maxReadFileLine ?? -1}
									min={-1}
									onChange={(e) => {
										const newValue = parseInt(e.target.value, 10)
										if (!isNaN(newValue) && newValue >= -1) {
											setCachedStateField("maxReadFileLine", newValue)
										}
									}}
									disabled={maxReadFileLine === -1}
									data-testid="max-read-file-line-input"
								/>
								<span className="text-xs text-vscode-descriptionForeground">
									{t("settings:contextManagement.maxReadFile.lines")}
								</span>
								<div className="flex-1" />
								<VSCodeCheckbox
									checked={maxReadFileLine === -1}
									onChange={(e: any) =>
										setCachedStateField("maxReadFileLine", e.target.checked ? -1 : 500)
									}
									className="text-xs m-0"
									data-testid="max-read-file-always-full-checkbox">
									{t("settings:contextManagement.maxReadFile.always_full_read")}
								</VSCodeCheckbox>
							</div>
						</SettingRow>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div data-setting-id="context-max-image-size">
							<SettingRow
								label={t("settings:contextManagement.maxImageFileSize.label")}
								description={t("settings:contextManagement.maxImageFileSize.description")}>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										className="flex-1 bg-vscode-input-background h-8 text-sm"
										value={maxImageFileSize ?? 5}
										min={1}
										max={100}
										onChange={(e) => {
											const newValue = parseInt(e.target.value, 10)
											if (!isNaN(newValue) && newValue >= 1 && newValue <= 100) {
												setCachedStateField("maxImageFileSize", newValue)
											}
										}}
										data-testid="max-image-file-size-input"
									/>
									<span className="text-xs text-vscode-descriptionForeground">MB</span>
								</div>
							</SettingRow>
						</div>
						<div data-setting-id="context-max-total-image-size">
							<SettingRow
								label={t("settings:contextManagement.maxTotalImageSize.label")}
								description={t("settings:contextManagement.maxTotalImageSize.description")}>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										className="flex-1 bg-vscode-input-background h-8 text-sm"
										value={maxTotalImageSize ?? 20}
										min={1}
										max={500}
										onChange={(e) => {
											const newValue = parseInt(e.target.value, 10)
											if (!isNaN(newValue) && newValue >= 1 && newValue <= 500) {
												setCachedStateField("maxTotalImageSize", newValue)
											}
										}}
										data-testid="max-total-image-size-input"
									/>
									<span className="text-xs text-vscode-descriptionForeground">MB</span>
								</div>
							</SettingRow>
						</div>
					</div>

					<div className="pt-2 border-t border-vscode-widget-border/50">
						<VSCodeCheckbox
							checked={allowVeryLargeReads}
							onChange={(e: any) => setCachedStateField("allowVeryLargeReads", e.target.checked)}
							className="m-0">
							<div className="flex items-center gap-2">
								<span className="text-[13px] font-medium">
									{t("kilocode:settings.contextManagement.allowVeryLargeReads.label")}
								</span>
								<StandardTooltip
									content={t("kilocode:settings.contextManagement.allowVeryLargeReads.description")}>
									<Info className="w-3 h-3 text-vscode-descriptionForeground cursor-help" />
								</StandardTooltip>
							</div>
						</VSCodeCheckbox>
					</div>
				</SettingsCard>

				{/* Metadata Card */}
				<SettingsCard title="Context Metadata" icon={Scan}>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-3">
							<div data-setting-id="context-include-time">
								<VSCodeCheckbox
									checked={includeCurrentTime}
									onChange={(e: any) => setCachedStateField("includeCurrentTime", e.target.checked)}
									className="m-0"
									data-testid="include-current-time-checkbox">
									<div className="flex items-center gap-2.5 px-1 py-0.5">
										<Clock className="w-3.5 h-3.5 text-vscode-foreground/60" />
										<span className="text-[13px]">{t("settings:contextManagement.includeCurrentTime.label")}</span>
									</div>
								</VSCodeCheckbox>
							</div>

							<div data-setting-id="context-include-cost">
								<VSCodeCheckbox
									checked={includeCurrentCost}
									onChange={(e: any) => setCachedStateField("includeCurrentCost", e.target.checked)}
									className="m-0"
									data-testid="include-current-cost-checkbox">
									<div className="flex items-center gap-2.5 px-1 py-0.5">
										<DollarSign className="w-3.5 h-3.5 text-vscode-foreground/60" />
										<span className="text-[13px]">{t("settings:contextManagement.includeCurrentCost.label")}</span>
									</div>
								</VSCodeCheckbox>
							</div>

							<div data-setting-id="context-include-diagnostics">
								<VSCodeCheckbox
									checked={includeDiagnosticMessages}
									onChange={(e: any) => setCachedStateField("includeDiagnosticMessages", e.target.checked)}
									className="m-0"
									data-testid="include-diagnostic-messages-checkbox">
									<div className="flex items-center gap-2.5 px-1 py-0.5">
										<ShieldAlert className="w-3.5 h-3.5 text-vscode-foreground/60" />
										<span className="text-[13px]">
											{t("settings:contextManagement.diagnostics.includeMessages.label")}
										</span>
									</div>
								</VSCodeCheckbox>
							</div>
						</div>

						{includeDiagnosticMessages && (
							<div className="mt-1 flex flex-col gap-5 pl-4 border-l-2 border-vscode-widget-border/20 p-4">
								<SettingRow
									label={t("settings:contextManagement.diagnostics.maxMessages.label")}
									description={t("settings:contextManagement.diagnostics.maxMessages.description")}>
									<div className="flex items-center gap-4">
										<Slider
											min={1}
											max={100}
											step={1}
											value={[
												maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0
													? 100
													: (maxDiagnosticMessages ?? 50),
											]}
											onValueChange={([value]) => {
												setCachedStateField("maxDiagnosticMessages", value === 100 ? -1 : value)
											}}
											className="flex-1"
											data-testid="max-diagnostic-messages-slider"
										/>
										<span className="w-16 text-center font-mono text-xs bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border">
											{(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
												maxDiagnosticMessages === 100
												? t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")
												: (maxDiagnosticMessages ?? 50)}
										</span>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => setCachedStateField("maxDiagnosticMessages", 50)}
											className="h-7 w-7 opacity-60 hover:opacity-100"
											disabled={maxDiagnosticMessages === 50}>
											<span className="codicon codicon-discard" />
										</Button>
									</div>
								</SettingRow>

								<SettingRow
									label={t("settings:contextManagement.diagnostics.delayAfterWrite.label")}
									description={t("settings:contextManagement.diagnostics.delayAfterWrite.description")}>
									<div className="flex items-center gap-4">
										<Slider
											min={0}
											max={5000}
											step={100}
											value={[writeDelayMs]}
											onValueChange={([value]) => setCachedStateField("writeDelayMs", value)}
											className="flex-1"
											data-testid="write-delay-slider"
										/>
										<span className="w-16 text-center font-mono text-xs bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border text-vscode-descriptionForeground">
											{writeDelayMs}ms
										</span>
									</div>
								</SettingRow>
							</div>
						)}
					</div>
				</SettingsCard >
			</Section >
		</div >
	)
}
