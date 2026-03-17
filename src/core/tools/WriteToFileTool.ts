import path from "path"
import delay from "delay"
import * as vscode from "vscode"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath, createDirectoriesForFile } from "../../utils/fs"
import { stripLineNumbers, everyLineHasLineNumbers } from "../../integrations/misc/extract-text"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { convertNewFileToUnifiedDiff, computeDiffStats, sanitizeUnifiedDiff } from "../diff/stats"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { trackContribution } from "../../services/contribution-tracking/ContributionTrackingService" // kade_change

interface WriteToFileParams {
	path: string
	content: string
}

export class WriteToFileTool extends BaseTool<"write_to_file"> {
	readonly name = "write_to_file" as const

	parseLegacy(params: Partial<Record<string, string>>): WriteToFileParams {
		return {
			path: params.path || "",
			content: params.content || "",
		}
	}

	async execute(params: WriteToFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError, askApproval, removeClosingTag } = callbacks
		const relPath = params.path
		let newContent = params.content


		// Guard against cross-call contamination: if another tool call currently owns
		// the streaming diff session, reset before executing this write.
		const activeToolCallId = task.diffViewProvider.getActiveStreamingToolCallId()
		if (
			task.diffViewProvider.isEditing &&
			callbacks.toolCallId &&
			activeToolCallId &&
			callbacks.toolCallId !== activeToolCallId
		) {
			await task.diffViewProvider.reset()
		}
		task.diffViewProvider.setActiveStreamingToolCallId(callbacks.toolCallId)

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "path"))
			await task.diffViewProvider.reset()
			return
		}

		if (newContent === undefined) {
			task.consecutiveMistakeCount++
			task.recordToolError("write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "content"))
			await task.diffViewProvider.reset()
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		let fileExists: boolean
		const absolutePath = path.resolve(task.cwd, relPath)

		// kade_change: Strongly prioritize cached editType from streaming if it exists.
		// This prevents the state from flipping from "create" to "modify" once the empty 
		// file is created on disk to support the VS Code Diff View.
		if (task.diffViewProvider.editType !== undefined) {
			fileExists = task.diffViewProvider.editType === "modify"
		} else {
			// If editType is lost but we have empty originalContent cached, it means we likely
			// created the file during streaming (or opened an empty one). Treat as new file.
			if (task.diffViewProvider.originalContent === "") {
				fileExists = false
			} else {
				const stats = await fs.stat(absolutePath).catch(() => null)
				fileExists = stats ? !stats.isDirectory() : false
			}
			task.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open, fs.readFile)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}
		// kade_change start
		if (typeof newContent !== "string") {
			console.warn(`[WriteToFileTool] converting incorrect model output ${typeof newContent} to string`)
			newContent = JSON.stringify(newContent, null, "\t")
		}
		// kade_change end

		if (newContent.endsWith("```")) {
			newContent = newContent.split("\n").slice(0, -1).join("\n")
		}

		if (!task.api.getModel().id.includes("claude")) {
			newContent = unescapeHtmlEntities(newContent)
		}


		const fullPath = relPath ? path.resolve(task.cwd, removeClosingTag("path", relPath)) : ""
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		// Capture snapshot for undo
		try {
			const { EditHistoryService } = await import("../../services/edit-history/EditHistoryService")
			// kade_change: If we already have a snapshot from handlePartial/open, use it!
			// This prevents the snapshot from capturing the "truncated" intermediate state
			// if Auto-Save happened between the start of streaming and the final execute.
			let originalContent: string | undefined = task.diffViewProvider.originalContent

			if (originalContent === undefined) {
				if (fileExists) {
					originalContent = await fs.readFile(absolutePath, "utf-8")
				}
			}

			if (EditHistoryService) {
				const tracker = await EditHistoryService.getInstance()
				if (tracker) {
					await tracker.captureBatchState(task.cwd, [{
						path: relPath,
						content: originalContent
					}], callbacks.toolCallId)
				}
			}
		} catch (e) {
			// console.error("Failed to capture snapshot:", e)
		}

		const sharedMessageProps: ClineSayTool = {
			tool: "newFileCreated",
			path: getReadablePath(task.cwd, removeClosingTag("path", relPath)),
			content: newContent,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
			id: callbacks.toolCallId,
		}

		try {
			task.consecutiveMistakeCount = 0

			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)

			if (isPreventFocusDisruptionEnabled) {
				task.diffViewProvider.editType = fileExists ? "modify" : "create"
				if (fileExists) {
					const absolutePath = path.resolve(task.cwd, relPath)
					task.diffViewProvider.originalContent = await fs.readFile(absolutePath, "utf-8")
				} else {
					task.diffViewProvider.originalContent = ""
				}

				let unified = fileExists
					? formatResponse.createPrettyPatch(relPath, task.diffViewProvider.originalContent, newContent)
					: convertNewFileToUnifiedDiff(newContent, relPath)
				unified = sanitizeUnifiedDiff(unified)
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					tool: "newFileCreated",
					content: unified,
					diff: unified,
					diffStats: computeDiffStats(unified) || undefined,
				} satisfies ClineSayTool)

				const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

				// kade_change start
				// Track contribution (fire-and-forget, never blocks user workflow)
				trackContribution({
					cwd: task.cwd,
					filePath: relPath,
					unifiedDiff: unified,
					status: didApprove ? "accepted" : "rejected",
					taskId: task.taskId,
					organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
					kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
				})
				// kade_change end

				if (!didApprove) {
					return
				}

				await task.diffViewProvider.saveDirectly(relPath, newContent, false, diagnosticsEnabled, writeDelayMs)
			} else {
				if (!task.diffViewProvider.isEditing) {
					const partialMessage = JSON.stringify(sharedMessageProps)
					await task.say("tool", partialMessage, undefined, true).catch(() => { })
					await task.diffViewProvider.open(relPath, true)
				}

				await task.diffViewProvider.update(
					everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
					true,
				)

				// Scroll immediately without delay for faster UI response
				task.diffViewProvider.scrollToFirstDiff()

				let unified = fileExists
					? formatResponse.createPrettyPatch(relPath, task.diffViewProvider.originalContent, newContent)
					: convertNewFileToUnifiedDiff(newContent, relPath)
				unified = sanitizeUnifiedDiff(unified)
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					tool: "newFileCreated",
					content: newContent,
					diff: unified,
					diffStats: computeDiffStats(unified) || undefined,
				} satisfies ClineSayTool)

				const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

				// kade_change start
				// Track contribution (fire-and-forget, never blocks user workflow)
				trackContribution({
					cwd: task.cwd,
					filePath: relPath,
					unifiedDiff: unified,
					status: didApprove ? "accepted" : "rejected",
					taskId: task.taskId,
					organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
					kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
				})
				// kade_change end

				if (!didApprove) {
					await task.diffViewProvider.revertChanges()
					return
				}

				await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
			}

			if (relPath) {
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			task.didEditFile = true

			// Capture modified state for Redo
			try {
				const { EditHistoryService } = await import("../../services/edit-history/EditHistoryService")
				if (callbacks.toolCallId) {
					const service = EditHistoryService.getInstance()
					service.updateModifiedState(callbacks.toolCallId, absolutePath, newContent)
				}
			} catch (e) {
				console.error("[WriteToFileTool] ❌ Failed to capture modified state:", e)
			}

			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, !fileExists, false)

			pushToolResult(message)

			await task.diffViewProvider.reset()

			task.processQueuedMessages()

			return
		} catch (error) {
			await handleError("writing file", error as Error)
			await task.diffViewProvider.reset()
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"write_to_file">): Promise<void> {
		const relPath: string | undefined = block.params.path
		let newContent: string | undefined = block.params.content

		if (!relPath || newContent === undefined) {
			return
		}

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isPreventFocusDisruptionEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
		)

		// Removed the check entirely to allow streaming to work always
		// Don't return early - always allow streaming to work

		let fileExists: boolean
		const absolutePath = path.resolve(task.cwd, relPath)

		// kade_change: Strongly prioritize cached editType from streaming if it exists.
		// This prevents the state from flipping from "create" to "modify" once the empty 
		// file is created on disk to support the VS Code Diff View.
		if (task.diffViewProvider.editType !== undefined) {
			fileExists = task.diffViewProvider.editType === "modify"
		} else {
			const stats = await fs.stat(absolutePath).catch(() => null)
			fileExists = stats ? !stats.isDirectory() : false
			task.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath!) || false
		const fullPath = absolutePath
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		// Hard boundary between streaming tool calls:
		// if another tool already owns the streaming diff session, ignore this partial
		// update until that session finishes. This prevents cross-file contamination.
		if (task.diffViewProvider.isEditing) {
			const activeToolCallId = task.diffViewProvider.getActiveStreamingToolCallId()
			const activeRelPath = task.diffViewProvider.getCurrentRelPath()
			const isDifferentTool = !!(block.id && activeToolCallId && block.id !== activeToolCallId)
			if (isDifferentTool) {
				return
			}
			// Same tool id should not change target file mid-stream; drop inconsistent updates.
			if (
				activeToolCallId &&
				block.id === activeToolCallId &&
				activeRelPath &&
				path.resolve(task.cwd, activeRelPath) !== absolutePath
			) {
				return
			}
		}

		task.diffViewProvider.setActiveStreamingToolCallId(block.id)

		const sharedMessageProps: ClineSayTool = {
			tool: "newFileCreated",
			path: getReadablePath(task.cwd, relPath!),
			content: newContent!,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
			id: block.id,
		}

		// Always stream partial content for better UX
		const partialMessage = JSON.stringify(sharedMessageProps)
		// For partial updates, we don't need to wait for user response
		task.ask("tool", partialMessage, block.partial).catch(() => { })

		if (newContent) {
			if (!task.diffViewProvider.isEditing) {
				await task.diffViewProvider.open(relPath!, true)
			}

			// Stream the content update immediately
			await task.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				false, // isPartial = true for streaming
			)
		}
	}
}

export const writeToFileTool = new WriteToFileTool()
