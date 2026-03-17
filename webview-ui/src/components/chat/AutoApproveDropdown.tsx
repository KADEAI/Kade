import React from "react"
import { ListChecks, LayoutList, Settings, CheckCheck, X, ShieldCheck, CheckCircle2, ListFilter } from "lucide-react"

import { vscode } from "@/utils/vscode"

import { cn } from "@/lib/utils"

import { useExtensionState } from "@/context/ExtensionStateContext"

import { useAppTranslation } from "@/i18n/TranslationContext"

import { useAutoApprovalToggles } from "@/hooks/useAutoApprovalToggles"
import { useAutoApprovalState } from "@/hooks/useAutoApprovalState"

import { useRooPortal } from "@/components/ui/hooks/useRooPortal"

import { Popover, PopoverContent, PopoverTrigger, StandardTooltip, ToggleSwitch, Button } from "@/components/ui"

import { AutoApproveSetting, autoApproveSettingsConfig } from "../settings/AutoApproveToggle"

interface AutoApproveDropdownProps {
	disabled?: boolean
	triggerClassName?: string
}

export const AutoApproveDropdown = ({ disabled = false, triggerClassName = "" }: AutoApproveDropdownProps) => {
	const [open, setOpen] = React.useState(false)
	const portalContainer = useRooPortal("roo-portal")
	const { t } = useAppTranslation()

	const {
		autoApprovalEnabled,
		setAutoApprovalEnabled,
		alwaysApproveResubmit,
		setAlwaysAllowReadOnly,
		setAlwaysAllowWrite,
		setAlwaysAllowExecute,
		setAlwaysAllowBrowser,
		setAlwaysAllowMcp,
		setAlwaysAllowModeSwitch,
		setAlwaysAllowSubtasks,
		setAlwaysApproveResubmit,
		setAlwaysAllowFollowupQuestions,
		setAlwaysAllowUpdateTodoList,
	} = useExtensionState()

	const baseToggles = useAutoApprovalToggles()

	// Include alwaysApproveResubmit in addition to the base toggles.
	const toggles = React.useMemo(
		() => ({
			...baseToggles,
			alwaysApproveResubmit: alwaysApproveResubmit,
		}),
		[baseToggles, alwaysApproveResubmit],
	)

	const onAutoApproveToggle = React.useCallback(
		(key: AutoApproveSetting, value: boolean) => {
			vscode.postMessage({ type: "updateSettings", updatedSettings: { [key]: value } })

			switch (key) {
				case "alwaysAllowReadOnly":
					setAlwaysAllowReadOnly(value)
					break
				case "alwaysAllowWrite":
					setAlwaysAllowWrite(value)
					break
				case "alwaysAllowExecute":
					setAlwaysAllowExecute(value)
					break
				case "alwaysAllowBrowser":
					setAlwaysAllowBrowser(value)
					break
				case "alwaysAllowMcp":
					setAlwaysAllowMcp(value)
					break
				case "alwaysAllowModeSwitch":
					setAlwaysAllowModeSwitch(value)
					break
				case "alwaysAllowSubtasks":
					setAlwaysAllowSubtasks(value)
					break
				case "alwaysApproveResubmit":
					setAlwaysApproveResubmit(value)
					break
				case "alwaysAllowFollowupQuestions":
					setAlwaysAllowFollowupQuestions(value)
					break
				case "alwaysAllowUpdateTodoList":
					setAlwaysAllowUpdateTodoList(value)
					break
			}

			// If enabling any option, ensure autoApprovalEnabled is true.
			if (value && !autoApprovalEnabled) {
				setAutoApprovalEnabled(true)
				vscode.postMessage({ type: "autoApprovalEnabled", bool: true })
			}
		},
		[
			autoApprovalEnabled,
			setAlwaysAllowReadOnly,
			setAlwaysAllowWrite,
			setAlwaysAllowExecute,
			setAlwaysAllowBrowser,
			setAlwaysAllowMcp,
			setAlwaysAllowModeSwitch,
			setAlwaysAllowSubtasks,
			setAlwaysApproveResubmit,
			setAlwaysAllowFollowupQuestions,
			setAlwaysAllowUpdateTodoList,
			setAutoApprovalEnabled,
		],
	)

	const handleSelectAll = React.useCallback(() => {
		// Enable all options
		Object.keys(autoApproveSettingsConfig).forEach((key) => {
			onAutoApproveToggle(key as AutoApproveSetting, true)
		})
		// Enable master auto-approval
		if (!autoApprovalEnabled) {
			setAutoApprovalEnabled(true)
			vscode.postMessage({ type: "autoApprovalEnabled", bool: true })
		}
	}, [onAutoApproveToggle, autoApprovalEnabled, setAutoApprovalEnabled])

	const handleSelectNone = React.useCallback(() => {
		// Disable all options
		Object.keys(autoApproveSettingsConfig).forEach((key) => {
			onAutoApproveToggle(key as AutoApproveSetting, false)
		})
	}, [onAutoApproveToggle])

	const handleOpenSettings = React.useCallback(
		() =>
			window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "autoApprove" } }),
		[],
	)

	// Handle the main auto-approval toggle
	const handleAutoApprovalToggle = React.useCallback(() => {
		const newValue = !(autoApprovalEnabled ?? false)
		setAutoApprovalEnabled(newValue)
		vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
	}, [autoApprovalEnabled, setAutoApprovalEnabled])

	// Calculate enabled and total counts as separate properties
	const settingsArray = Object.values(autoApproveSettingsConfig)

	const enabledCount = React.useMemo(() => {
		return Object.values(toggles).filter((value) => !!value).length
	}, [toggles])

	const totalCount = React.useMemo(() => {
		return Object.keys(toggles).length
	}, [toggles])

	const { hasEnabledOptions, effectiveAutoApprovalEnabled } = useAutoApprovalState(toggles, autoApprovalEnabled)

	const tooltipText =
		!effectiveAutoApprovalEnabled || enabledCount === 0
			? t("chat:autoApprove.tooltipManage")
			: t("chat:autoApprove.tooltipStatus", {
				toggles: settingsArray
					.filter((setting) => toggles[setting.key])
					.map((setting) => t(setting.labelKey))
					.join(", "),
			})

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="auto-approve-dropdown-root">
			<StandardTooltip content={tooltipText}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="auto-approve-dropdown-trigger"
					className={cn(
						"inline-flex items-center justify-center relative",
						"w-7 h-7 p-1 rounded-md transition-all duration-150",
						"bg-transparent border-none",
						disabled
							? "opacity-40 cursor-not-allowed"
							: cn(
								"opacity-80 hover:opacity-100 cursor-pointer",
								"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
								effectiveAutoApprovalEnabled && enabledCount > 0 ? "text-white" : "text-vscode-foreground",
							),
						triggerClassName,
					)}>
					<ShieldCheck className="size-[17px] flex-shrink-0" />
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="end"
				sideOffset={8}
				container={portalContainer}
				className="p-0 overflow-hidden w-[320px] bg-popover/40 backdrop-blur-2xl rounded-2xl border border-vscode-dropdown-border shadow-2xl"
				onOpenAutoFocus={(e) => e.preventDefault()}>
				<div className="flex flex-col w-full">
					{/* Header with description */}
					<div className="p-4 border-b border-vscode-dropdown-border/50 bg-white/5">
						<div className="flex items-center justify-between gap-1 mb-1">
							<div className="flex items-center gap-2">
								<ShieldCheck className="size-4 text-vscode-button-background" />
								<h4 className="m-0 font-bold text-sm text-vscode-foreground tracking-tight">
									{t("chat:autoApprove.title")}
								</h4>
							</div>
							<button
								onClick={handleOpenSettings}
								className="p-1 rounded-md hover:bg-white/10 transition-colors text-vscode-descriptionForeground hover:text-vscode-foreground">
								<Settings className="size-3.5" />
							</button>
						</div>
						<p className="m-0 text-[11px] text-vscode-descriptionForeground leading-relaxed opacity-80">
							{t("chat:autoApprove.description")}
						</p>
					</div>

					<div className="max-h-[320px] overflow-y-auto p-2 scrollbar-thin">
						<div className="flex flex-col gap-1">
							{settingsArray.map(({ key, labelKey, descriptionKey, icon }) => {
								const isEnabled = toggles[key]
								return (
									<button
										key={key}
										disabled={!effectiveAutoApprovalEnabled}
										onClick={() => onAutoApproveToggle(key, !isEnabled)}
										className={cn(
											"flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-all duration-150",
											"hover:bg-white/10 text-left w-full",
											isEnabled
												? "text-vscode-foreground font-medium bg-white/5"
												: "text-vscode-descriptionForeground hover:text-vscode-foreground",
											!effectiveAutoApprovalEnabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
										)}>
										<span className={`codicon codicon-${icon} text-sm flex-shrink-0 w-4 h-4 flex items-center justify-center ${isEnabled ? "text-vscode-button-background" : "opacity-60"}`} />
										<span className="flex-1 truncate">{t(labelKey)}</span>
										<div className={cn(
											"w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all",
											isEnabled
												? "bg-vscode-button-background border-vscode-button-background"
												: "border-white/20",
										)}>
											{isEnabled && <CheckCheck className="size-2.5 text-white" />}
										</div>
									</button>
								)
							})}
						</div>
					</div>

					{/* Bottom bar with Select All/None buttons */}
					<div className="flex flex-row items-center justify-between px-3 py-3 border-t border-vscode-dropdown-border/50 bg-white/5">
						<div className="flex flex-row gap-2">
							<button
								aria-label={t("chat:autoApprove.selectAll")}
								onClick={handleSelectAll}
								disabled={!effectiveAutoApprovalEnabled}
								className={cn(
									"flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold rounded-md transition-all hover:bg-white/10",
									!effectiveAutoApprovalEnabled ? "opacity-30 cursor-not-allowed" : "text-vscode-foreground",
								)}>
								<ListChecks className="w-3.5 h-3.5" />
								<span>{t("chat:autoApprove.all")}</span>
							</button>
							<button
								aria-label={t("chat:autoApprove.selectNone")}
								onClick={handleSelectNone}
								disabled={!effectiveAutoApprovalEnabled}
								className={cn(
									"flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold rounded-md transition-all hover:bg-white/10",
									!effectiveAutoApprovalEnabled ? "opacity-30 cursor-not-allowed" : "text-vscode-foreground",
								)}>
								<LayoutList className="w-3.5 h-3.5" />
								<span>{t("chat:autoApprove.none")}</span>
							</button>
						</div>

						<label
							className={cn(
								"flex items-center gap-2 cursor-pointer select-none",
								!hasEnabledOptions && "opacity-50 grayscale",
							)}
							onClick={(e) => {
								if (!hasEnabledOptions) return
								if ((e.target as HTMLElement).closest('[role="switch"]')) {
									e.preventDefault()
									return
								}
								handleAutoApprovalToggle()
							}}>
							<ToggleSwitch
								checked={effectiveAutoApprovalEnabled}
								aria-label="Toggle auto-approval"
								disabled={!hasEnabledOptions}
								onChange={handleAutoApprovalToggle}
							/>
							<span className={cn("text-[11px] font-bold uppercase tracking-wider text-vscode-foreground")}>
								{effectiveAutoApprovalEnabled ? "ON" : "OFF"}
							</span>
						</label>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
