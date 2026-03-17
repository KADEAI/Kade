import React, { useEffect, useMemo, useState } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { CalendarClock, Clock3, Info, MessageSquareQuote, Pause, Play, Save, Sparkles, Trash2 } from "lucide-react"

import { vscode } from "@/utils/vscode"
import { Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StandardTooltip } from "../ui"
import { Section } from "./Section"
import { SetCachedStateField } from "./types"

interface InfinitySavedPrompt {
	id: string
	label: string
	prompt: string
}

interface InfinitySettingsProps {
	infinityEnabled?: boolean
	infinityPrompt?: string
	infinityIntervalMinutes?: number
	infinityIsRunning?: boolean
	infinityScheduleType?: "interval" | "hourly" | "daily"
	infinityScheduleHour?: number
	infinityScheduleMinute?: number
	infinityNextRunAt?: number
	infinitySavedPrompts?: InfinitySavedPrompt[]
	activeInfinityPromptId?: string
	setCachedStateField: SetCachedStateField<
		| "infinityEnabled"
		| "infinityPrompt"
		| "infinityIntervalMinutes"
		| "infinityScheduleType"
		| "infinityScheduleHour"
		| "infinityScheduleMinute"
		| "infinitySavedPrompts"
		| "activeInfinityPromptId"
	>
}

export const InfinitySettings = ({
	infinityEnabled = false,
	infinityPrompt = "",
	infinityIntervalMinutes = 5,
	infinityIsRunning = false,
	infinityScheduleType = "interval",
	infinityScheduleHour = 9,
	infinityScheduleMinute = 0,
	infinityNextRunAt,
	infinitySavedPrompts = [],
	activeInfinityPromptId,
	setCachedStateField,
}: InfinitySettingsProps) => {
	const [localPrompt, setLocalPrompt] = useState(infinityPrompt)
	const [localInterval, setLocalInterval] = useState(infinityIntervalMinutes.toString())
	const [localScheduleHour, setLocalScheduleHour] = useState(infinityScheduleHour.toString().padStart(2, "0"))
	const [localScheduleMinute, setLocalScheduleMinute] = useState(infinityScheduleMinute.toString().padStart(2, "0"))
	const [newSavedPromptLabel, setNewSavedPromptLabel] = useState("")

	useEffect(() => {
		setLocalPrompt(infinityPrompt)
	}, [infinityPrompt])

	useEffect(() => {
		setLocalInterval(infinityIntervalMinutes.toString())
	}, [infinityIntervalMinutes])

	useEffect(() => {
		setLocalScheduleHour(infinityScheduleHour.toString().padStart(2, "0"))
	}, [infinityScheduleHour])

	useEffect(() => {
		setLocalScheduleMinute(infinityScheduleMinute.toString().padStart(2, "0"))
	}, [infinityScheduleMinute])

	const handlePromptChange = (value: string) => {
		setLocalPrompt(value)
		setCachedStateField("infinityPrompt", value)
	}

	const handleIntervalChange = (value: string) => {
		setLocalInterval(value)
		const parsed = parseInt(value, 10)
		const numValue = Number.isNaN(parsed) ? 5 : Math.max(1, parsed)
		setCachedStateField("infinityIntervalMinutes", numValue)
	}

	const handleScheduleHourChange = (value: string) => {
		setLocalScheduleHour(value)
		const parsed = parseInt(value, 10)
		const nextHour = Number.isNaN(parsed) ? 9 : Math.min(23, Math.max(0, parsed))
		setCachedStateField("infinityScheduleHour", nextHour)
	}

	const handleScheduleMinuteChange = (value: string) => {
		setLocalScheduleMinute(value)
		const parsed = parseInt(value, 10)
		const nextMinute = Number.isNaN(parsed) ? 0 : Math.min(59, Math.max(0, parsed))
		setCachedStateField("infinityScheduleMinute", nextMinute)
	}

	const handleToggleRunning = () => {
		vscode.postMessage({
			type: "toggleInfinity",
			enabled: !infinityIsRunning,
		})
	}

	const buildSavedPromptLabel = () => {
		const trimmedLabel = newSavedPromptLabel.trim()
		if (trimmedLabel) {
			return trimmedLabel
		}

		const trimmedPrompt = localPrompt.trim().replace(/\s+/g, " ")
		return trimmedPrompt.slice(0, 40) || "Saved Prompt"
	}

	const handleSavePrompt = () => {
		const trimmedPrompt = localPrompt.trim()
		if (!trimmedPrompt) {
			return
		}

		const nextPrompt = {
			id: `infinity-${Date.now()}`,
			label: buildSavedPromptLabel(),
			prompt: trimmedPrompt,
		}

		setCachedStateField("infinitySavedPrompts", [...infinitySavedPrompts, nextPrompt])
		setNewSavedPromptLabel("")
	}

	const handleSelectSavedPrompt = (savedPrompt: InfinitySavedPrompt) => {
		setCachedStateField("activeInfinityPromptId", savedPrompt.id)
		setCachedStateField("infinityPrompt", savedPrompt.prompt)
	}

	const handleDeleteSavedPrompt = (savedPromptId: string) => {
		const nextSavedPrompts = infinitySavedPrompts.filter((prompt) => prompt.id !== savedPromptId)
		setCachedStateField("infinitySavedPrompts", nextSavedPrompts)

		if (activeInfinityPromptId === savedPromptId) {
			setCachedStateField("activeInfinityPromptId", undefined)
		}
	}

	const activePromptText =
		infinitySavedPrompts.find((prompt) => prompt.id === activeInfinityPromptId)?.prompt ?? localPrompt

	const scheduleSummary = useMemo(() => {
		if (infinityScheduleType === "daily") {
			return `Daily at ${String(infinityScheduleHour).padStart(2, "0")}:${String(infinityScheduleMinute).padStart(2, "0")}`
		}

		if (infinityScheduleType === "hourly") {
			return `Hourly at minute ${String(infinityScheduleMinute).padStart(2, "0")}`
		}

		return `Every ${infinityIntervalMinutes} minute${infinityIntervalMinutes !== 1 ? "s" : ""}`
	}, [infinityIntervalMinutes, infinityScheduleHour, infinityScheduleMinute, infinityScheduleType])

	const nextRunLabel = infinityIsRunning && infinityNextRunAt
		? new Date(infinityNextRunAt).toLocaleString([], {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
		  })
		: null

	const savedPromptCountLabel = `${infinitySavedPrompts.length} saved prompt${infinitySavedPrompts.length !== 1 ? "s" : ""}`

	return (
		<div className="flex flex-col gap-6">
			<Section title="Infinity">
				<div className="flex flex-col gap-5">
					<div className="flex items-start gap-3 rounded-2xl border border-white/[0.05] bg-black/10 px-4 py-4">
						<div className="mt-0.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
							<Sparkles className="size-4 text-white/80" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center justify-between gap-3">
								<div className="text-sm font-medium text-white/90">Recurring workspace automation</div>
								<StandardTooltip content="Infinity allows you to schedule prompts that run automatically at regular intervals, creating new background chats each time the timer triggers.">
									<Info className="size-3.5 shrink-0 cursor-help text-vscode-descriptionForeground" />
								</StandardTooltip>
							</div>
							<p className="mt-1 text-sm leading-7 text-vscode-descriptionForeground">
								Set up recurring prompts that automatically execute at specified intervals. Perfect for monitoring, periodic checks, or continuous analysis.
							</p>
						</div>
					</div>

					<div className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
						<VSCodeCheckbox
							checked={infinityEnabled}
							onChange={(e: any) => setCachedStateField("infinityEnabled", e.target.checked)}
						/>
						<div className="flex-1">
							<div className="text-sm font-medium text-white/90">Enable Infinity</div>
							<div className="text-xs text-vscode-descriptionForeground">
								Run the selected prompt automatically in the background.
							</div>
						</div>
						<div
							className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
								infinityIsRunning
									? "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/20"
									: "bg-white/[0.04] text-vscode-descriptionForeground ring-1 ring-white/[0.06]"
							}`}>
							{infinityIsRunning ? "Live" : "Idle"}
						</div>
					</div>

					<div className={`flex flex-col gap-5 ${!infinityEnabled ? "pointer-events-none opacity-55" : ""}`}>
						<div className="rounded-[22px] border border-white/[0.05] bg-[#252525] px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
							<div className="flex items-center justify-between gap-3">
								<div className="mt-0.5 rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5">
									<MessageSquareQuote className="size-4 text-white/85" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-semibold tracking-[0.01em] text-white/95">Prompt Library</div>
								</div>
								<div className="shrink-0 rounded-full border border-white/[0.06] bg-black/20 px-2.5 py-1 text-[11px] font-medium tabular-nums text-vscode-descriptionForeground">
									{savedPromptCountLabel}
								</div>
							</div>

							<div className="mt-5 flex flex-col gap-3">
								<div className="flex flex-col gap-2">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
										Active Prompt
									</label>
									<VSCodeTextField
										value={localPrompt}
										placeholder="e.g., Check for code changes and summarize updates..."
										onInput={(e: any) => handlePromptChange(e.target.value)}
										className="w-full"
									/>
									<span className="text-xs text-vscode-descriptionForeground">
										{activeInfinityPromptId
											? "A saved prompt is currently active. Editing here updates the fallback draft."
											: "This draft runs if no saved prompt is checked."}
									</span>
								</div>

								<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
									<div className="flex flex-col gap-2">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
											Save As
										</label>
										<VSCodeTextField
											value={newSavedPromptLabel}
											placeholder="Optional saved prompt name"
											onInput={(e: any) => setNewSavedPromptLabel(e.target.value)}
											className="w-full"
										/>
									</div>
									<Button
										variant="outline"
										className="h-10 rounded-2xl border-white/[0.08] bg-white/[0.02] px-4 text-white/90 hover:bg-white/[0.05]"
										onClick={handleSavePrompt}
										disabled={!localPrompt.trim()}>
										<Save className="size-4" />
										Save Prompt
									</Button>
								</div>

								{infinitySavedPrompts.length > 0 ? (
									<div className="mt-1 flex flex-col gap-2.5">
										{infinitySavedPrompts.map((savedPrompt) => {
											const isActive = savedPrompt.id === activeInfinityPromptId

											return (
												<div
													key={savedPrompt.id}
													className={`group rounded-2xl border px-3.5 py-3 transition-all ${
														isActive
															? "border-emerald-400/30 bg-emerald-500/[0.07] shadow-[0_12px_30px_rgba(16,185,129,0.08)]"
															: "border-white/[0.06] bg-black/15 hover:border-white/[0.1] hover:bg-white/[0.025]"
													}`}>
													<div className="flex items-start gap-3">
														<button
															type="button"
															onClick={() => handleSelectSavedPrompt(savedPrompt)}
															className="flex flex-1 items-start gap-3 text-left">
															<Checkbox checked={isActive} onCheckedChange={() => handleSelectSavedPrompt(savedPrompt)} />
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-2">
																	<span className="truncate text-sm font-medium text-white/92">{savedPrompt.label}</span>
																	{isActive && (
																		<span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
																			Active
																		</span>
																	)}
																</div>
																<p className="mt-1 line-clamp-2 text-xs leading-5 text-vscode-descriptionForeground">
																	{savedPrompt.prompt}
																</p>
															</div>
														</button>
														<button
															type="button"
															onClick={() => handleDeleteSavedPrompt(savedPrompt.id)}
															className="rounded-xl p-2 text-vscode-descriptionForeground transition-colors hover:bg-white/[0.06] hover:text-white"
															aria-label={`Delete ${savedPrompt.label}`}>
															<Trash2 className="h-4 w-4" />
														</button>
													</div>
												</div>
											)
										})}
									</div>
								) : (
									<div className="mt-1 rounded-2xl border border-dashed border-white/[0.08] bg-black/10 px-4 py-4 text-sm leading-6 text-vscode-descriptionForeground">
										Save prompts here to build a reusable Infinity library. Check one saved prompt to make it the active automation.
									</div>
								)}
							</div>
						</div>

						<div className="rounded-[22px] border border-white/[0.05] bg-[#252525] px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
							<div className="flex items-start gap-3">
								<div className="mt-0.5 rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5">
									<CalendarClock className="size-4 text-white/85" />
								</div>
								<div className="flex-1">
									<div className="text-sm font-semibold tracking-[0.01em] text-white/95">Schedule</div>
									<div className="mt-1 text-xs leading-6 text-vscode-descriptionForeground">
										Pick a cadence for the active Infinity prompt. Daily and hourly modes stay aligned to specific clock times.
									</div>
								</div>
							</div>

							<div className="mt-5 flex flex-col gap-4">
								<div className="flex flex-col gap-2">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
										Schedule Type
									</label>
									<Select
										value={infinityScheduleType}
										onValueChange={(value) => setCachedStateField("infinityScheduleType", value)}>
										<SelectTrigger className="h-11 w-full rounded-2xl border-white/[0.08] bg-black/20 px-4 text-sm text-white/90">
											<SelectValue placeholder="Select a schedule" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="interval">Every X minutes</SelectItem>
											<SelectItem value="hourly">Hourly at a specific minute</SelectItem>
											<SelectItem value="daily">Daily at a specific time</SelectItem>
										</SelectContent>
									</Select>
								</div>

								{infinityScheduleType === "interval" && (
									<div className="flex flex-col gap-2">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
											Repeat Every
										</label>
										<div className="flex items-center gap-3">
											<Input
												value={localInterval}
												type="number"
												min="1"
												placeholder="5"
												onChange={(e) => handleIntervalChange(e.target.value)}
												className="h-10 w-32"
											/>
											<span className="text-sm text-vscode-descriptionForeground">minute(s)</span>
										</div>
										<span className="text-xs text-vscode-descriptionForeground">
											Best for short recurring checks and continuous monitoring.
										</span>
									</div>
								)}

								{infinityScheduleType === "hourly" && (
									<div className="flex flex-col gap-2">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
											Clock Minute
										</label>
										<div className="flex items-center gap-3">
											<Input
												value={localScheduleMinute}
												type="number"
												min="0"
												max="59"
												placeholder="00"
												onChange={(e) => handleScheduleMinuteChange(e.target.value)}
												className="h-10 w-24"
											/>
											<span className="text-sm text-vscode-descriptionForeground">past each hour</span>
										</div>
										<span className="text-xs text-vscode-descriptionForeground">
											Example: `15` runs at 10:15, 11:15, 12:15, and so on.
										</span>
									</div>
								)}

								{infinityScheduleType === "daily" && (
									<div className="flex flex-col gap-2">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-vscode-descriptionForeground">
											Daily Run Time
										</label>
										<div className="flex items-center gap-2">
											<Input
												value={localScheduleHour}
												type="number"
												min="0"
												max="23"
												placeholder="09"
												onChange={(e) => handleScheduleHourChange(e.target.value)}
												className="h-10 w-24"
											/>
											<span className="text-sm text-vscode-descriptionForeground">:</span>
											<Input
												value={localScheduleMinute}
												type="number"
												min="0"
												max="59"
												placeholder="00"
												onChange={(e) => handleScheduleMinuteChange(e.target.value)}
												className="h-10 w-24"
											/>
											<span className="text-sm text-vscode-descriptionForeground">local time</span>
										</div>
										<span className="text-xs text-vscode-descriptionForeground">
											Uses 24-hour time and fires once per day.
										</span>
									</div>
								)}
							</div>
						</div>

						<div className="rounded-[22px] border border-white/[0.05] bg-[#252525] px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
							<div className="flex items-start gap-3">
								<div className="mt-0.5 rounded-xl border border-white/[0.05] bg-white/[0.03] p-2.5">
									<Clock3 className="size-4 text-white/85" />
								</div>
								<div className="flex-1">
									<div className="text-sm font-semibold tracking-[0.01em] text-white/95">Live Status</div>
									<div className="mt-1 text-xs leading-6 text-vscode-descriptionForeground">
										Keep an eye on the current cadence and the next queued run without leaving settings.
									</div>
								</div>
							</div>

							<div className="mt-5 grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
								<Button
									variant={infinityIsRunning ? "outline" : "primary"}
									className={`h-11 rounded-2xl px-5 ${
										infinityIsRunning
											? "border-white/[0.08] bg-white/[0.02] text-white/92 hover:bg-white/[0.05]"
											: "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] shadow-[0_10px_25px_rgba(0,122,204,0.22)]"
									}`}
									onClick={handleToggleRunning}
									disabled={!activePromptText.trim()}>
									{infinityIsRunning ? (
										<>
											<Pause className="size-4" />
											Stop Infinity
										</>
									) : (
										<>
											<Play className="size-4" />
											Start Infinity
										</>
									)}
								</Button>

								<div className="rounded-2xl border border-white/[0.06] bg-black/15 px-4 py-3">
									<div className="text-sm font-medium text-white/92">{scheduleSummary}</div>
									<div className="mt-1 text-xs text-vscode-descriptionForeground">
										{nextRunLabel ? `Next queued run: ${nextRunLabel}` : "Start Infinity to schedule the next run."}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
