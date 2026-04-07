import path from "path"
import os from "os"

import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import delay from "delay"

import type { ExperimentId } from "@roo-code/types"
import { DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT } from "@roo-code/types"

import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { EXPERIMENT_IDS, experiments as Experiments } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { defaultModeSlug, getModeBySlug, isToolAllowedForMode } from "../../shared/modes"
import { getFullModeDetails } from "../../shared/modeDetails"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { listFiles } from "../../services/glob/list-files"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { getGitStatus } from "../../utils/git"

import { Task } from "../task/Task"
import { formatReminderSection } from "./reminder"
import { getLineCounts, getDirectoryMetadata } from "../../services/ripgrep"

// kade_change start
import { OpenRouterHandler } from "../../api/providers/openrouter"
import { TelemetryService } from "@roo-code/telemetry"
import { t } from "../../i18n"
import { NativeOllamaHandler } from "../../api/providers/native-ollama"
import * as fs from "fs/promises"

// Multiplier for fetching extra files when filtering is enabled to ensure enough non-ignored files; only applied when showRooIgnoredFiles is false.
const FILE_LIST_OVER_FETCH_MULTIPLIER = 3

// PERF: Cache for expensive ripgrep operations to prevent freezing on large codebases
// These operations scan every file in the workspace and can take 10+ seconds on large repos
const workspaceMetadataCache = new Map<string, {
	fileLines: Map<string, number>,
	directoryMetadata: Map<string, { files: number, folders: number }>,
	timestamp: number
}>()
const WORKSPACE_METADATA_CACHE_TTL_MS = 60_000 // 60 seconds

function trimFileList(fileListStr: string, maxFiles: number) {
	let lines = fileListStr.split("")
	if (lines.length <= maxFiles) {
		return fileListStr
	}

	const lastLine = lines[lines.length - 1]
	if (lastLine.startsWith("(File list truncated.")) {
		// Remove last 3 items from lines (two empty lines and truncation message)
		lines = lines.slice(0, -3)
	}

	// Truncate lines to maxFiles
	lines = lines.slice(0, maxFiles)

	const truncationMsg =
		"(File list truncated. Use list_files on specific subdirectories if you need to explore further.)"

	return lines.join("") + "" + truncationMsg
}
// kade_change end

export async function getEnvironmentDetails(cline: Task, includeFileDetails: boolean = false) {
	let details = ""

	const clineProvider = cline.providerRef.deref()
	const state = await clineProvider?.getState()
	const {
		terminalOutputLineLimit = 500,
		terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
		maxWorkspaceFiles = 200,
	} = state ?? {}

	// It could be useful for cline to know if the user went from one or no
	// file to another between messages, so we always include this context.
	const visibleFilePaths = vscode.window.visibleTextEditors
		?.map((editor) => editor.document?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cline.cwd, absolutePath))
		.slice(0, maxWorkspaceFiles)

	// Filter paths through rooIgnoreController
	const allowedVisibleFiles = cline.rooIgnoreController
		? cline.rooIgnoreController.filterPaths(visibleFilePaths)
		: visibleFilePaths.map((p) => p.toPosix()).join("")

	if (allowedVisibleFiles) {
		details += ""
		details += `${allowedVisibleFiles}`
	}

	const { maxOpenTabsContext } = state ?? {}
	const maxTabs = maxOpenTabsContext ?? 20
	const openTabPaths = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputText)
		.map((tab) => (tab.input as vscode.TabInputText).uri.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cline.cwd, absolutePath).toPosix())
		.slice(0, maxTabs)

	// Filter paths through rooIgnoreController
	const allowedOpenTabs = cline.rooIgnoreController
		? cline.rooIgnoreController.filterPaths(openTabPaths)
		: openTabPaths.map((p) => p.toPosix()).join("")

	if (allowedOpenTabs) {
		details += "# Open Tabs"
		details += `${allowedOpenTabs}`
	}

	// Get task-specific and background terminals.
	const busyTerminals = [
		...TerminalRegistry.getTerminals(true, cline.taskId),
		...TerminalRegistry.getBackgroundTerminals(true),
	]

	const inactiveTerminals = [
		...TerminalRegistry.getTerminals(false, cline.taskId),
		...TerminalRegistry.getBackgroundTerminals(false),
	]

	if (busyTerminals.length > 0) {
		if (cline.didEditFile) {
			await delay(300) // Delay after saving file to let terminals catch up.
		}

		// Wait for terminals to cool down.
		await pWaitFor(() => busyTerminals.every((t) => !TerminalRegistry.isProcessHot(t.id)), {
			interval: 100,
			timeout: 5_000,
		}).catch(() => { })
	}

	// Reset, this lets us know when to wait for saved files to update terminals.
	cline.didEditFile = false

	// Waiting for updated diagnostics lets terminal output be the most
	// up-to-date possible.
	let terminalDetails = ""

	if (busyTerminals.length > 0) {
		// Terminals are cool, let's retrieve their output.
		terminalDetails += "# Actively Running Terminals"

		for (const busyTerminal of busyTerminals) {
			const cwd = busyTerminal.getCurrentWorkingDirectory()
			terminalDetails += `## Terminal ${busyTerminal.id} (Active)`
			terminalDetails += `### Working Directory: \`${cwd}\``
			terminalDetails += `### Original command: \`${busyTerminal.getLastCommand()}\``
			let newOutput = TerminalRegistry.getUnretrievedOutput(busyTerminal.id)

			if (newOutput) {
				newOutput = Terminal.compressTerminalOutput(
					newOutput,
					terminalOutputLineLimit,
					terminalOutputCharacterLimit,
				)
				terminalDetails += `## New Output${newOutput}`
			}
		}
	}

	// First check if any inactive terminals in this task have completed
	// processes with output.
	const terminalsWithOutput = inactiveTerminals.filter((terminal) => {
		const completedProcesses = terminal.getProcessesWithOutput()
		return completedProcesses.length > 0
	})

	// Only add the header if there are terminals with output.
	if (terminalsWithOutput.length > 0) {
		terminalDetails += "# Inactive Terminals with Completed Process Output"
		for (const inactiveTerminal of terminalsWithOutput) {
			let terminalOutputs: string[] = []

			// Get output from completed processes queue.
			const completedProcesses = inactiveTerminal.getProcessesWithOutput()

			for (const process of completedProcesses) {
				let output = process.getUnretrievedOutput()

				if (output) {
					output = Terminal.compressTerminalOutput(
						output,
						terminalOutputLineLimit,
						terminalOutputCharacterLimit,
					)
					terminalOutputs.push(`Command: \`${process.command}\`${output}`)
				}
			}

			// Clean the queue after retrieving output.
			inactiveTerminal.cleanCompletedProcessQueue()

			// Add this terminal's outputs to the details.
			if (terminalOutputs.length > 0) {
				const cwd = inactiveTerminal.getCurrentWorkingDirectory()
				terminalDetails += `## Terminal ${inactiveTerminal.id} (Inactive)`
				terminalDetails += `### Working Directory: \`${cwd}\``
				terminalOutputs.forEach((output) => {
					terminalDetails += `### New Output${output}`
				})
			}
		}
	}

	// console.log(`[Task#getEnvironmentDetails] terminalDetails: ${terminalDetails}`)

	// Add recently modified files section.
	const recentlyModifiedFiles = cline.fileContextTracker.getAndClearRecentlyModifiedFiles()

	if (recentlyModifiedFiles.length > 0) {
		details +=
			""
		for (const filePath of recentlyModifiedFiles) {
			details += `${filePath}`
		}
	}

	if (terminalDetails) {
		details += terminalDetails
	}

	// Get settings for time and cost display
	const { includeCurrentTime = true, includeCurrentCost = true, maxGitStatusFiles = 0 } = state ?? {}

	// Add current time information with timezone (if enabled).
	if (includeCurrentTime) {
		const now = new Date()

		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		const timeZoneOffset = -now.getTimezoneOffset() / 60 // Convert to hours and invert sign to match conventional notation
		const timeZoneOffsetHours = Math.floor(Math.abs(timeZoneOffset))
		const timeZoneOffsetMinutes = Math.abs(Math.round((Math.abs(timeZoneOffset) - timeZoneOffsetHours) * 60))
		const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : "-"}${timeZoneOffsetHours}:${timeZoneOffsetMinutes.toString().padStart(2, "0")}`
		details += `# Current TimeCurrent time in ISO 8601 UTC format: ${now.toISOString()}User time zone: ${timeZone}, UTC${timeZoneOffsetStr}`
	}

	// Add git status information (if enabled with maxGitStatusFiles > 0).
	if (maxGitStatusFiles > 0) {
		const gitStatus = await getGitStatus(cline.cwd, maxGitStatusFiles)
		if (gitStatus) {
			details += `# Git Status${gitStatus}`
		}
	}

	// Add context tokens information (if enabled).
	if (includeCurrentCost) {
		const { totalCost } = getApiMetrics(cline.clineMessages)
		details += `# Current Cost${totalCost !== null ? `$${totalCost.toFixed(2)}` : "(Not available)"}`
	}

	// kade_change start
	// Be sure to fetch the model information before we need it.
	if (cline.api instanceof OpenRouterHandler || ("fetchModel" in cline.api && cline.api.fetchModel)) {
		try {
			await (cline.api.fetchModel as () => Promise<unknown>)()
		} catch (e) {
			TelemetryService.instance.captureException(e, { context: "getEnvironmentDetails" })
			await cline.say(
				"error",
				t("kilocode:task.notLoggedInError", { error: e instanceof Error ? e.message : String(e) }),
			)
			return `## Environment Context${details.trim()}`
		}
	}
	// kade_change end

	const { id: modelId } = cline.api.getModel()

	// Add current mode and any mode-specific warnings.
	const {
		mode,
		customModes,
		customModePrompts,
		experiments = {} as Record<ExperimentId, boolean>,
		customInstructions: globalCustomInstructions,
		language,
	} = state ?? {}

	const modeDetails = await getFullModeDetails(mode ?? defaultModeSlug, customModes, customModePrompts, {
		cwd: cline.cwd,
		globalCustomInstructions,
		language: language ?? formatLanguage(vscode.env.language),
	})

	const currentMode = modeDetails.slug ?? mode // kade_change: don't try to use non-existent modes
	// Resolve and add tool protocol information
	const modelInfo = cline.api.getModel().info
	const toolProtocol = resolveToolProtocol(state?.apiConfiguration ?? {}, modelInfo)

	// Browser session status
	const isBrowserActive = cline.browserSession.isSessionActive()

	if (isBrowserActive) {
		// Build viewport info for status (prefer actual viewport if available, else fallback to configured setting)
		const configuredViewport = (state?.browserViewportSize as string | undefined) ?? "900x600"
		let configuredWidth: number | undefined
		let configuredHeight: number | undefined
		if (configuredViewport.includes("x")) {
			const parts = configuredViewport.split("x").map((v) => Number(v))
			configuredWidth = parts[0]
			configuredHeight = parts[1]
		}

		let actualWidth: number | undefined
		let actualHeight: number | undefined
		const vp = cline.browserSession.getViewportSize?.()
		if (vp) {
			actualWidth = vp.width
			actualHeight = vp.height
		}

		const width = actualWidth ?? configuredWidth
		const height = actualHeight ?? configuredHeight
		const viewportInfo = width && height ? `Current viewport size: ${width}x${height} pixels.` : ""

		details += `# Browser Session StatusActive - A browser session is currently open and ready for browser_action commands${viewportInfo}`
	}

	if (includeFileDetails) {
		const fileDetailsStart = details.length
		details += `# CWD (${cline.cwd.toPosix()}) Files`
		const isDesktop = arePathsEqual(cline.cwd, path.join(os.homedir(), "Desktop"))

		if (isDesktop) {
			// Don't want to immediately access desktop since it would show
			// permission popup.
			details += "(Desktop files not shown automatically. Use ls to explore if needed.)"
		} else {
			const maxFiles = maxWorkspaceFiles ?? 200

			// Early return for limit of 0
			if (maxFiles === 0) {
				details += ""
			} else {
				const { showRooIgnoredFiles = false } = state ?? {}

				// kade_change start: Parallelize heavy workspace operations
				const fetchLimit = showRooIgnoredFiles ? maxFiles : maxFiles * FILE_LIST_OVER_FETCH_MULTIPLIER

				// PERF: Check cache for expensive ripgrep operations
				// On large codebases, getLineCounts and getDirectoryMetadata can freeze the system
				const cached = workspaceMetadataCache.get(cline.cwd)
				const now = Date.now()
				const cacheValid = cached && (now - cached.timestamp) < WORKSPACE_METADATA_CACHE_TTL_MS

				let fileLines: Map<string, number>
				let directoryMetadata: Map<string, { files: number, folders: number }>

				if (cacheValid) {
					// Use cached metadata - skip expensive ripgrep scans
					fileLines = cached.fileLines
					directoryMetadata = cached.directoryMetadata
				} else {
					// Fetch fresh metadata and cache it
					const [newFileLines, newDirectoryMetadata] = await Promise.all([
						getLineCounts(cline.cwd).catch(err => {
							console.error("[getEnvironmentDetails] getLineCounts failed:", err)
							return new Map<string, number>()
						}),
						getDirectoryMetadata(cline.cwd).catch(err => {
							console.error("[getEnvironmentDetails] getDirectoryMetadata failed:", err)
							return new Map<string, { files: number, folders: number }>()
						})
					])
					fileLines = newFileLines
					directoryMetadata = newDirectoryMetadata
					workspaceMetadataCache.set(cline.cwd, { fileLines, directoryMetadata, timestamp: now })
				}

				// listFiles is fast, always fetch fresh
				const [listFilesResult] = await Promise.all([
					listFiles(cline.cwd, true, fetchLimit)
				])

				const [files, didHitLimit] = listFilesResult

				const result = formatResponse.formatFilesList(
					cline.cwd,
					files,
					didHitLimit,
					cline.rooIgnoreController,
					showRooIgnoredFiles,
					undefined,
					fileLines,
					directoryMetadata,
					didHitLimit,
				)

				if (!showRooIgnoredFiles) {
					// Trim because we over-fetched
					details += trimFileList(result, maxFiles)
				} else {
					details += result
				}
				// kade_change end
			}
		}
		cline.latestFileList = details.slice(fileDetailsStart)
	} else if (cline.latestFileList) {
		details += cline.latestFileList
	}

	const todoListEnabled =
		state && typeof state.apiConfiguration?.todoListEnabled === "boolean" ? state.apiConfiguration.todoListEnabled : true
	const reminderSection = formatReminderSection(
		cline.todoList,
		cline.luxurySpa.systemReminders,
		cline.luxurySpa.activeFileReads,
		todoListEnabled
	)
	return `${details.trim()}${reminderSection ? `${reminderSection}` : ''}`
}
