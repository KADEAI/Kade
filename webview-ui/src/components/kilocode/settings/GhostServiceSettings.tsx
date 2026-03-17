//kilocode_change - new file
import { HTMLAttributes, useCallback, useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Zap, Clock, Info } from "lucide-react"
import { cn } from "@/lib/utils"

import { Section } from "../../settings/Section"
import { EXTREME_SNOOZE_VALUES_ENABLED, GhostServiceSettings, MODEL_SELECTION_ENABLED } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { VSCodeCheckbox, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useKeybindings } from "@/hooks/useKeybindings"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { StandardTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui"

type GhostServiceSettingsViewProps = HTMLAttributes<HTMLDivElement> & {
	ghostServiceSettings: GhostServiceSettings
	onGhostServiceSettingsChange: <K extends keyof NonNullable<GhostServiceSettings>>(
		field: K,
		value: NonNullable<GhostServiceSettings>[K],
	) => void
}

export const GhostServiceSettingsView = ({
	ghostServiceSettings,
	onGhostServiceSettingsChange,
	className,
	...props
}: GhostServiceSettingsViewProps) => {
	const { t } = useAppTranslation()
	const { kiloCodeWrapperProperties } = useExtensionState()
	const {
		enableAutoTrigger,
		enableQuickInlineTaskKeybinding,
		enableSmartInlineTaskKeybinding,
		enableChatAutocomplete,
		provider,
		model,
	} = ghostServiceSettings || {}
	const keybindings = useKeybindings(["kilo-code.addToContextAndFocus", "kilo-code.ghost.generateSuggestions"])
	const [snoozeDuration, setSnoozeDuration] = useState<number>(300)
	const [currentTime, setCurrentTime] = useState<number>(Date.now())

	useEffect(() => {
		const interval = setInterval(() => {
			setCurrentTime(Date.now())
		}, 30_000)

		return () => clearInterval(interval)
	}, [])

	const snoozeUntil = ghostServiceSettings?.snoozeUntil
	const isSnoozed = snoozeUntil ? currentTime < snoozeUntil : false

	const onEnableAutoTriggerChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableAutoTrigger", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onEnableQuickInlineTaskKeybindingChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableQuickInlineTaskKeybinding", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onEnableSmartInlineTaskKeybindingChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableSmartInlineTaskKeybinding", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onEnableChatAutocompleteChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableChatAutocomplete", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const openGlobalKeybindings = (filter?: string) => {
		vscode.postMessage({ type: "openGlobalKeybindings", text: filter })
	}

	const handleSnooze = useCallback(() => {
		vscode.postMessage({ type: "snoozeAutocomplete", value: snoozeDuration })
	}, [snoozeDuration])

	const handleUnsnooze = useCallback(() => {
		vscode.postMessage({ type: "snoozeAutocomplete", value: 0 })
	}, [])

	return (
		<div className={cn("flex flex-col", className)} {...props}>


			<Section className="flex flex-col gap-6">
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Zap className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							{t("kilocode:ghost.settings.triggers")}
						</span>
					</div>

					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between">
								<VSCodeCheckbox checked={enableAutoTrigger || false} onChange={onEnableAutoTriggerChange}>
									<span className="font-medium text-sm">
										{t("kilocode:ghost.settings.enableAutoTrigger.label")}
									</span>
								</VSCodeCheckbox>
								<StandardTooltip content={t("kilocode:ghost.settings.enableAutoTrigger.description")}>
									<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
								</StandardTooltip>
							</div>

							{enableAutoTrigger && (
								<div className="flex flex-col gap-3 mt-1 ml-6 bg-vscode-textBlockQuote-background/20 p-3 rounded border border-vscode-textBlockQuote-border/10">
									<div className="flex items-center gap-2">
										<Clock className="size-3.5 text-vscode-descriptionForeground" />
										<span className="font-medium text-[11px] uppercase tracking-wider">
											{t("kilocode:ghost.settings.snooze.label")}
										</span>
									</div>
									{isSnoozed ? (
										<div className="flex items-center justify-between bg-vscode-input-background px-2 py-1 rounded border border-vscode-input-border/50">
											<span className="text-vscode-descriptionForeground text-[10px] italic">
												{t("kilocode:ghost.settings.snooze.currentlySnoozed")}
											</span>
											<VSCodeButton appearance="secondary" onClick={handleUnsnooze} className="scale-90 origin-right">
												{t("kilocode:ghost.settings.snooze.unsnooze")}
											</VSCodeButton>
										</div>
									) : (
										<div className="flex items-center gap-2">
											<Select
												value={snoozeDuration.toString()}
												onValueChange={(value) => setSnoozeDuration(Number(value))}>
												<SelectTrigger className="min-w-[100px] scale-95 origin-left h-7 rounded-lg">
													<SelectValue placeholder="Snooze" />
												</SelectTrigger>
												<SelectContent>
													{EXTREME_SNOOZE_VALUES_ENABLED && (
														<SelectItem value="60">
															{t("kilocode:ghost.settings.snooze.duration.1min")}
														</SelectItem>
													)}
													<SelectItem value="300">
														{t("kilocode:ghost.settings.snooze.duration.5min")}
													</SelectItem>
													<SelectItem value="900">
														{t("kilocode:ghost.settings.snooze.duration.15min")}
													</SelectItem>
													<SelectItem value="1800">
														{t("kilocode:ghost.settings.snooze.duration.30min")}
													</SelectItem>
													<SelectItem value="3600">
														{t("kilocode:ghost.settings.snooze.duration.1hour")}
													</SelectItem>
												</SelectContent>
											</Select>
											<VSCodeButton appearance="secondary" onClick={handleSnooze} className="scale-95">
												{t("kilocode:ghost.settings.snooze.button")}
											</VSCodeButton>
										</div>
									)}
									<div className="text-vscode-descriptionForeground text-[10px] leading-snug opacity-80">
										{t("kilocode:ghost.settings.snooze.description")}
									</div>
								</div>
							)}
						</div>

						{!kiloCodeWrapperProperties?.kiloCodeWrapped && (
							<>
								<div className="flex flex-col gap-1.5 border-t border-vscode-input-border/10 pt-3">
									<div className="flex items-center justify-between">
										<VSCodeCheckbox
											checked={enableQuickInlineTaskKeybinding || false}
											onChange={onEnableQuickInlineTaskKeybindingChange}>
											<span className="font-medium text-sm">
												{t("kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label", {
													keybinding: keybindings["kilo-code.addToContextAndFocus"],
												})}
											</span>
										</VSCodeCheckbox>
										<div className="flex items-center gap-2.5">
											<a
												href="#"
												onClick={() => openGlobalKeybindings("kilo-code.addToContextAndFocus")}
												className="text-[10px] text-vscode-textLink-foreground hover:underline cursor-pointer opacity-80 uppercase font-bold tracking-tight">
												Edit
											</a>
											<StandardTooltip
												content={
													<div className="flex flex-col gap-1">
														<Trans i18nKey="kilocode:ghost.settings.enableQuickInlineTaskKeybinding.description" />
													</div>
												}>
												<Info className="size-3.4 text-vscode-descriptionForeground cursor-help" />
											</StandardTooltip>
										</div>
									</div>
								</div>
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center justify-between">
										<VSCodeCheckbox
											checked={enableSmartInlineTaskKeybinding || false}
											onChange={onEnableSmartInlineTaskKeybindingChange}>
											<span className="font-medium text-sm">
												{t("kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label", {
													keybinding: keybindings["kilo-code.ghost.generateSuggestions"],
												})}
											</span>
										</VSCodeCheckbox>
										<div className="flex items-center gap-2.5">
											<a
												href="#"
												onClick={() => openGlobalKeybindings("kilo-code.ghost.generateSuggestions")}
												className="text-[10px] text-vscode-textLink-foreground hover:underline cursor-pointer opacity-80 uppercase font-bold tracking-tight">
												Edit
											</a>
											<StandardTooltip
												content={
													<div className="flex flex-col gap-1">
														<Trans
															i18nKey="kilocode:ghost.settings.enableSmartInlineTaskKeybinding.description"
															values={{
																keybinding:
																	keybindings["kilo-code.ghost.generateSuggestions"],
															}}
														/>
													</div>
												}>
												<Info className="size-3.4 text-vscode-descriptionForeground cursor-help" />
											</StandardTooltip>
										</div>
									</div>
								</div>
							</>
						)}

						<div className="flex flex-col gap-1.5 border-t border-vscode-input-border/10 pt-3">
							<div className="flex items-center justify-between">
								<VSCodeCheckbox
									checked={enableChatAutocomplete || false}
									onChange={onEnableChatAutocompleteChange}>
									<span className="font-medium text-sm">
										{t("kilocode:ghost.settings.enableChatAutocomplete.label")}
									</span>
								</VSCodeCheckbox>
								<StandardTooltip content={t("kilocode:ghost.settings.enableChatAutocomplete.description")}>
									<Info className="size-3.4 text-vscode-descriptionForeground cursor-help" />
								</StandardTooltip>
							</div>
						</div>
					</div>
				</div>

				{/* Model Info Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Bot className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							{t("kilocode:ghost.settings.model")}
						</span>
					</div>

					<div className="flex flex-col gap-3">
						{provider && model ? (
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-0.5">
									<span className="text-[9px] uppercase font-bold text-vscode-descriptionForeground tracking-widest opacity-70">
										{t("kilocode:ghost.settings.provider")}
									</span>
									<span className="text-xs font-medium">{provider}</span>
								</div>
								<div className="flex flex-col gap-0.5">
									<span className="text-[9px] uppercase font-bold text-vscode-descriptionForeground tracking-widest opacity-70">
										{t("kilocode:ghost.settings.model")}
									</span>
									<span className="text-xs font-medium truncate">{model}</span>
								</div>
							</div>
						) : (
							<div className="text-vscode-errorForeground text-[11px] flex items-center gap-2 bg-vscode-errorForeground/5 p-2 rounded border border-vscode-errorForeground/10">
								<div className="codicon codicon-warning scale-75" />
								{t("kilocode:ghost.settings.noModelConfigured")}
							</div>
						)}
						{MODEL_SELECTION_ENABLED && (
							<div className="text-vscode-descriptionForeground text-[10px] mt-1 italic border-t border-vscode-input-border/10 pt-2 opacity-70">
								{t("kilocode:ghost.settings.configureAutocompleteProfile")}
							</div>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}
