import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeLink, VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react" // kade_change
import { GitBranch, Trash2, Clock, AlertTriangle } from "lucide-react" // kade_change
import { Trans } from "react-i18next"
import { buildDocLink } from "@src/utils/docLinks"
import { Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"

import { Section } from "./Section"
import { useRegisterSetting } from "./useSettingsSearch"
import {
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	MAX_CHECKPOINT_TIMEOUT_SECONDS,
	MIN_CHECKPOINT_TIMEOUT_SECONDS,
} from "@roo-code/types"

type CheckpointSettingsProps = HTMLAttributes<HTMLDivElement> & {
	enableCheckpoints?: boolean
	// kade_change start
	autoPurgeEnabled?: boolean
	autoPurgeDefaultRetentionDays?: number
	autoPurgeFavoritedTaskRetentionDays?: number | null
	autoPurgeCompletedTaskRetentionDays?: number
	autoPurgeIncompleteTaskRetentionDays?: number
	autoPurgeLastRunTimestamp?: number
	setCachedStateField: SetCachedStateField<
		| "enableCheckpoints"
		| "autoPurgeEnabled"
		| "autoPurgeDefaultRetentionDays"
		| "autoPurgeFavoritedTaskRetentionDays"
		| "autoPurgeCompletedTaskRetentionDays"
		| "autoPurgeIncompleteTaskRetentionDays"
		| "checkpointTimeout"
	>
	onManualPurge?: () => void
	// kade_change end
	checkpointTimeout?: number
}

export const CheckpointSettings = ({
	enableCheckpoints,
	// kade_change start
	autoPurgeEnabled,
	autoPurgeDefaultRetentionDays,
	autoPurgeFavoritedTaskRetentionDays,
	autoPurgeCompletedTaskRetentionDays,
	autoPurgeIncompleteTaskRetentionDays,
	autoPurgeLastRunTimestamp,
	onManualPurge,
	// kade_change end
	checkpointTimeout,
	setCachedStateField,
	...props
}: CheckpointSettingsProps) => {
	const { t } = useAppTranslation()
	// Register settings for search
	useRegisterSetting({ settingId: "checkpoints-enable", section: "checkpoints", label: t("settings:checkpoints.enable.label") })
	useRegisterSetting({ settingId: "checkpoints-timeout", section: "checkpoints", label: t("settings:checkpoints.timeout.label") })
	useRegisterSetting({ settingId: "checkpoints-autopurge", section: "checkpoints", label: t("settings:autoPurge.enable.label") })
	useRegisterSetting({ settingId: "checkpoints-retention-default", section: "checkpoints", label: t("settings:autoPurge.defaultRetention.label") })
	useRegisterSetting({ settingId: "checkpoints-purge-favorited", section: "checkpoints", label: t("settings:autoPurge.neverPurgeFavorited.label") })
	useRegisterSetting({ settingId: "checkpoints-retention-favorited", section: "checkpoints", label: t("settings:autoPurge.favoritedRetention.label") })
	useRegisterSetting({ settingId: "checkpoints-retention-completed", section: "checkpoints", label: t("settings:autoPurge.completedRetention.label") })
	useRegisterSetting({ settingId: "checkpoints-retention-incomplete", section: "checkpoints", label: t("settings:autoPurge.incompleteRetention.label") })
	useRegisterSetting({ settingId: "checkpoints-manual-purge", section: "checkpoints", label: t("settings:autoPurge.manualPurge.button") })
	return (
		<div className="flex flex-col gap-4" {...props}>
			<Section className="flex flex-col gap-6 pt-0">
				{/* Legacy Warning Card */}
				<div className="bg-amber-500/10 border border-amber-500/30 rounded-[24px] p-5 flex items-start gap-4 shadow-xl">
					<div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0">
						<AlertTriangle className="size-5" />
					</div>
					<div className="flex flex-col gap-1.5 pt-0.5">
						<div className="text-[13px] font-bold text-amber-500 uppercase tracking-widest">Legacy Option</div>
						<div className="text-[12px] leading-relaxed text-vscode-foreground/90 font-medium">
							This feature is now a legacy option from Cline/RooCode. Kade has moved to using native VS Code snapshots and an advanced edit history service. This transition saves tremendous amounts of storage and eliminates the need for having to backup on each turn; Backing up of a file is only made when an edit/write has been done. To revert, you have three options: simply press the undo button in the edit/write tool block, reject the change in the diff bar above the chat input box (you can still undo edits in the tool blocks even after approving changes), or undo the message send by clicking on your previous messages. Please only use this setting if specifically required for legacy workflows.
						</div>
					</div>
				</div>

				{/* Checkpoint Configuration Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<GitBranch className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							Checkpoint Configuration
						</span>
					</div>

					<div className="flex flex-col gap-4">
						<div data-setting-id="checkpoints-enable">
							<VSCodeCheckbox
								checked={enableCheckpoints}
								onChange={(e: any) => setCachedStateField("enableCheckpoints", e.target.checked)}>
								<span className="font-medium text-[13px]">{t("settings:checkpoints.enable.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
								<Trans
									i18nKey="settings:checkpoints.enable.description"
									components={{
										0: (
											<VSCodeLink
												href={buildDocLink("features/checkpoints", "checkpoint_settings")}
												target="_blank"
												className="text-vscode-textLink-foreground hover:underline"
											/>
										),
									}}
								/>
							</div>
						</div>

						<div className="flex flex-col gap-2 mt-2" data-setting-id="checkpoints-timeout">
							<label className="text-sm font-medium">{t("settings:checkpoints.timeout.label")}</label>
							<div className="flex items-center gap-4">
								<Slider
									value={[checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS]}
									min={MIN_CHECKPOINT_TIMEOUT_SECONDS}
									max={MAX_CHECKPOINT_TIMEOUT_SECONDS}
									step={1}
									onValueChange={([value]) => setCachedStateField("checkpointTimeout", value)}
									className="flex-1"
								/>
								<span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
									{checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS}s
								</span>
							</div>
							<div className="text-vscode-descriptionForeground text-[11px] opacity-80 mt-1">
								{t("settings:checkpoints.timeout.description")}
							</div>
						</div>
					</div>
				</div>

				{/* Auto-Purge Settings Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Trash2 className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							{t("settings:sections.autoPurge")}
						</span>
					</div>

					<div className="flex flex-col gap-5">
						<div data-setting-id="checkpoints-autopurge">
							<VSCodeCheckbox
								checked={autoPurgeEnabled}
								onChange={(e: any) => {
									setCachedStateField("autoPurgeEnabled", e.target.checked)
								}}>
								<span className="font-medium text-[13px]">{t("settings:autoPurge.enable.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
								{t("settings:autoPurge.enable.description")}
							</div>
						</div>

						{autoPurgeEnabled && (
							<div className="flex flex-col gap-5 pl-4 border-l-2 border-vscode-focusBorder/50">
								<div data-setting-id="checkpoints-retention-default">
									<label className="block text-[13px] font-medium mb-2">
										{t("settings:autoPurge.defaultRetention.label")}
									</label>
									<VSCodeTextField
										value={String(autoPurgeDefaultRetentionDays || 30)}
										onInput={(e: any) => {
											const value = parseInt(e.target.value) || 30
											setCachedStateField("autoPurgeDefaultRetentionDays", Math.max(1, value))
										}}
										placeholder="30"
										className="w-full"
									/>
									<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80">
										{t("settings:autoPurge.defaultRetention.description")}
									</div>
								</div>

								<div data-setting-id="checkpoints-purge-favorited">
									<VSCodeCheckbox
										checked={autoPurgeFavoritedTaskRetentionDays === null}
										onChange={(e: any) => {
											setCachedStateField(
												"autoPurgeFavoritedTaskRetentionDays",
												e.target.checked ? null : 90,
											)
										}}>
										<span className="font-medium text-[13px]">
											{t("settings:autoPurge.neverPurgeFavorited.label")}
										</span>
									</VSCodeCheckbox>
									<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
										{t("settings:autoPurge.neverPurgeFavorited.description")}
									</div>
								</div>

								{autoPurgeFavoritedTaskRetentionDays !== null && (
									<div className="pl-7" data-setting-id="checkpoints-retention-favorited">
										<label className="block text-[13px] font-medium mb-2">
											{t("settings:autoPurge.favoritedRetention.label")}
										</label>
										<VSCodeTextField
											value={String(autoPurgeFavoritedTaskRetentionDays || 90)}
											onInput={(e: any) => {
												const value = parseInt(e.target.value) || 90
												setCachedStateField(
													"autoPurgeFavoritedTaskRetentionDays",
													Math.max(1, value),
												)
											}}
											placeholder="90"
											className="w-full"
										/>
									</div>
								)}

								<div data-setting-id="checkpoints-retention-completed">
									<label className="block text-[13px] font-medium mb-2">
										{t("settings:autoPurge.completedRetention.label")}
									</label>
									<VSCodeTextField
										value={String(autoPurgeCompletedTaskRetentionDays || 30)}
										onInput={(e: any) => {
											const value = parseInt(e.target.value) || 30
											setCachedStateField("autoPurgeCompletedTaskRetentionDays", Math.max(1, value))
										}}
										placeholder="30"
										className="w-full"
									/>
									<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80">
										{t("settings:autoPurge.completedRetention.description")}
									</div>
								</div>

								<div data-setting-id="checkpoints-retention-incomplete">
									<label className="block text-[13px] font-medium mb-2">
										{t("settings:autoPurge.incompleteRetention.label")}
									</label>
									<VSCodeTextField
										value={String(autoPurgeIncompleteTaskRetentionDays || 7)}
										onInput={(e: any) => {
											const value = parseInt(e.target.value) || 7
											setCachedStateField("autoPurgeIncompleteTaskRetentionDays", Math.max(1, value))
										}}
										placeholder="7"
										className="w-full"
									/>
									<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80">
										{t("settings:autoPurge.incompleteRetention.description")}
									</div>
								</div>

								<div className="flex items-center justify-between pt-3 border-t border-vscode-input-border/10">
									<div className="flex items-center gap-2">
										{autoPurgeLastRunTimestamp && (
											<div className="text-vscode-descriptionForeground text-[11px] font-medium opacity-80">
												<Clock className="w-3 h-3 inline mr-1.5 opacity-60" />
												{t("settings:autoPurge.lastRun.label")}:{" "}
												{new Date(autoPurgeLastRunTimestamp).toLocaleDateString()}
											</div>
										)}
									</div>
									<VSCodeButton onClick={onManualPurge} appearance="secondary" className="scale-90 origin-right" data-setting-id="checkpoints-manual-purge">
										{t("settings:autoPurge.manualPurge.button")}
									</VSCodeButton>
								</div>
							</div>
						)}
					</div>
				</div>
			</Section>
			{/* kade_change end - Auto-Purge Settings Section */}
		</div>
	)
}
