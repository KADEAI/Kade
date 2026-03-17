import path from "path"
import fs from "fs" // Added fs import
import * as vscode from "vscode"
import { isBinaryFile } from "isbinaryfile"
import type { FileEntry, LineRange } from "@roo-code/types"
import { isNativeProtocol, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getModelMaxOutputTokens } from "../../shared/api"
import { t } from "../../i18n"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath, resolveRecursivePath } from "../../utils/path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"

import { extractTextFromFile, addLineNumbers, stripLineNumbers, getSupportedBinaryFormats } from "../../integrations/misc/extract-text"

import { parseXml } from "../../utils/xml"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
} from "./helpers/imageHelpers"
import { validateFileTokenBudget, truncateFileContent } from "./helpers/fileTokenBudget"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface FileResult {
	path: string
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	content?: string
	error?: string
	notice?: string
	lineRanges?: LineRange[]
	xmlContent?: string
	nativeContent?: string
	imageDataUrl?: string
	feedbackText?: string
	feedbackImages?: any[]
	head?: number
	tail?: number
}



async function preflightFileCheck(
	fileResult: FileResult,
	task: Task,
): Promise<{ error: string; xmlError: string } | null> {
	const relPath = fileResult.path

	// 1. Check for invalid line ranges
	if (fileResult.lineRanges) {
		for (const range of fileResult.lineRanges) {
			if (range.start > range.end) {
				const errorMsg = "Invalid line range: end line cannot be less than start line"
				await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
				return {
					error: `Error reading file: ${errorMsg}`,
					xmlError: `<error>Error reading file: ${errorMsg}</error>`,
				}
			}
			if (isNaN(range.start) || isNaN(range.end)) {
				const errorMsg = "Invalid line range values"
				await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
				return {
					error: `Error reading file: ${errorMsg}`,
					xmlError: `<error>Error reading file: ${errorMsg}</error>`,
				}
			}
		}
	}

	// 2. Check rooignore access
	const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
	if (!accessAllowed) {
		await task.say("rooignore_error", relPath)
		const errorMsg = formatResponse.rooIgnoreError(relPath)
		return {
			error: errorMsg,
			xmlError: `<error>${errorMsg}</error>`,
		}
	}

	return null // All checks passed
}


export class ReadFileTool extends BaseTool<"read_file"> {
	readonly name = "read_file" as const

	parseLegacy(params: Partial<Record<string, string>>): { files: FileEntry[] } {
		const argsXmlTag = params.args
		const legacyPath = params.path
		const legacyStartLineStr = params.start_line
		const legacyEndLineStr = params.end_line
		const headStr = params.head
		const tailStr = params.tail

		const fileEntries: FileEntry[] = []

		// XML args format
		if (argsXmlTag) {
			const parsed = parseXml(argsXmlTag) as any
			const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)

			for (const file of files) {
				if (!file.path) continue

				const fileEntry: FileEntry = {
					path: file.path,
					lineRanges: [],
				}

				if (file.line_range) {
					const ranges = Array.isArray(file.line_range) ? file.line_range : [file.line_range]
					for (const range of ranges) {
						const match = String(range).match(/(\d+)-(\d+)/)
						if (match) {
							const [, start, end] = match.map(Number)
							if (!isNaN(start) && !isNaN(end)) {
								fileEntry.lineRanges?.push({ start, end })
							}
						}
					}
				}
				fileEntries.push(fileEntry)
			}

			return { files: fileEntries }
		}

		// Simple single file path (new simplified schema & legacy compat)
		if (legacyPath) {
			const parts = legacyPath.split(",")

			for (const part of parts) {
				const trimmed = part.trim()
				if (!trimmed) continue

				let filePath = trimmed
				let ranges: LineRange[] = []

				// Match "path 10-20" or "path:10-20" (space or colon separator)
				const rangeMatch = trimmed.match(/^(.*?)(?::|\s+)(\d+)-(\d+)$/)

				if (rangeMatch) {
					filePath = rangeMatch[1].trim()
					const start = parseInt(rangeMatch[2], 10)
					const end = parseInt(rangeMatch[3], 10)
					if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
						ranges.push({ start, end })
					}
				}

				// Legacy start/end params (only apply to the first file if generic params are present and no inline range found)
				if (parts.length === 1 && ranges.length === 0 && legacyStartLineStr && legacyEndLineStr) {
					const start = parseInt(legacyStartLineStr, 10)
					const end = parseInt(legacyEndLineStr, 10)
					if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
						ranges.push({ start, end })
					}
				}

				if (filePath) {
					const entry: any = {
						path: filePath,
						lineRanges: ranges,
					}
					if (headStr && !isNaN(parseInt(headStr))) entry.head = parseInt(headStr)
					if (tailStr && !isNaN(parseInt(tailStr))) entry.tail = parseInt(tailStr)
					fileEntries.push(entry)
				}
			}
		}

		return { files: fileEntries }
	}

	async execute(params: { files: FileEntry[] }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult, toolProtocol } = callbacks
		const fileEntries = params?.files || []
		const modelInfo = task.api.getModel().info
		const protocol = resolveToolProtocol(task.apiConfiguration, modelInfo)
		const useNative = isNativeProtocol(protocol) || protocol === "unified" || protocol === "markdown"

		if (!fileEntries || fileEntries.length === 0) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "path")
			const errorResult = useNative ? `Error: ${errorMsg}` : `<files><error>${errorMsg}</error></files>`
			pushToolResult(errorResult)
			return
		}

		const supportsImages = modelInfo.supportsImages ?? false
		const pathNotices = new Map<string, string>()

		for (const entry of fileEntries) {
			const { resolvedPath, notice } = await resolveRecursivePath(task.cwd, entry.path)
			entry.path = resolvedPath
			if (notice) {
				pathNotices.set(resolvedPath, notice)
			}
		}

		const fileResults: FileResult[] = fileEntries.map((entry) => ({
			path: entry.path,
			status: "pending",
			lineRanges: entry.lineRanges,
			notice: pathNotices.get(entry.path),
			head: (entry as any).head,
			tail: (entry as any).tail,
		}))


		try {
			const filesToApprove: FileResult[] = []



			for (const fileResult of fileResults) {
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)

				// Convert head/tail to lineRanges early so UI gets the correct snippet and highlighting
				if ((!fileResult.lineRanges || fileResult.lineRanges.length === 0) && (fileResult.head || fileResult.tail)) {
					try {
						const totalLines = await countFileLines(fullPath)
						fileResult.lineRanges = []
						if (fileResult.head) {
							fileResult.lineRanges.push({ start: 1, end: Math.min(fileResult.head, totalLines) })
						}
						if (fileResult.tail) {
							const start = Math.max(1, totalLines - fileResult.tail + 1)
							const lastRange = fileResult.lineRanges[fileResult.lineRanges.length - 1]
							if (lastRange && start <= lastRange.end) {
								lastRange.end = totalLines
							} else {
								fileResult.lineRanges.push({ start, end: totalLines })
							}
						}
					} catch (error) {
						// Ignore errors here, they will be caught later during actual read
					}
				}

				const validationError = await preflightFileCheck(fileResult, task)
				if (validationError) {
					Object.assign(fileResult, {
						status: "blocked",
						error: validationError.error,
						xmlContent: `<file><path>${relPath}</path>${validationError.xmlError}</file>`,
						nativeContent: `File: ${relPath}\nError: ${validationError.error}`,
					})
					continue
				}

				if (fileResult.status === "pending") {
					filesToApprove.push(fileResult)
				}
			}

			if (filesToApprove.length > 1) {
				const { maxReadFileLine = -1 } = (await task.providerRef.deref()?.getState()) ?? {}

				const batchFiles = filesToApprove.map((fileResult) => {
					const relPath = fileResult.path
					const fullPath = path.resolve(task.cwd, relPath)
					const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

					let lineSnippet = ""
					if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
						const ranges = fileResult.lineRanges.map((range) =>
							t("tools:readFile.linesRange", { start: range.start, end: range.end }),
						)
						lineSnippet = ranges.join(", ")
					} else if (maxReadFileLine === 0) {
						lineSnippet = t("tools:readFile.definitionsOnly")
					} else if (maxReadFileLine > 0) {
						lineSnippet = t("tools:readFile.maxLines", { max: maxReadFileLine })
					}

					const readablePath = getReadablePath(task.cwd, relPath)
					const key = `${readablePath}${lineSnippet ? ` (${lineSnippet})` : ""}`

					return {
						path: readablePath,
						lineSnippet,
						isOutsideWorkspace,
						key,
						content: fullPath,
						lineRange: fileResult.lineRanges?.[0],
						head: fileResult.head,
						tail: fileResult.tail,
					}
				})

				const completeMessage = JSON.stringify({ tool: "readFile", batchFiles, id: callbacks.toolCallId } satisfies ClineSayTool)
				const { response, text, images } = await task.ask("tool", completeMessage, false)

				if (response === "yesButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					filesToApprove.forEach((fileResult) => {
						Object.assign(fileResult, {
							status: "approved",
							feedbackText: text,
							feedbackImages: images,
						})
					})
				} else if (response === "noButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					task.didRejectTool = true
					filesToApprove.forEach((fileResult) => {
						Object.assign(fileResult, {
							status: "denied",
							xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
							nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
							feedbackText: text,
							feedbackImages: images,
						})
					})
				} else {
					try {
						const individualPermissions = JSON.parse(text || "{}")
						let hasAnyDenial = false

						batchFiles.forEach((batchFile, index) => {
							const fileResult = filesToApprove[index]
							const approved = individualPermissions[batchFile.key] === true

							if (approved) {
								fileResult.status = "approved"
							} else {
								hasAnyDenial = true
								Object.assign(fileResult, {
									status: "denied",
									xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
									nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
								})
							}
						})

						if (hasAnyDenial) task.didRejectTool = true
					} catch (error) {
						console.error("Failed to parse individual permissions:", error)
						task.didRejectTool = true
						filesToApprove.forEach((fileResult) => {
							Object.assign(fileResult, {
								status: "denied",
								xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
								nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
							})
						})
					}
				}
			} else if (filesToApprove.length === 1) {
				const fileResult = filesToApprove[0]
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
				const { maxReadFileLine = -1 } = (await task.providerRef.deref()?.getState()) ?? {}

				let lineSnippet = ""
				if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
					const ranges = fileResult.lineRanges.map((range) =>
						t("tools:readFile.linesRange", { start: range.start, end: range.end }),
					)
					lineSnippet = ranges.join(", ")
				} else if (maxReadFileLine === 0) {
					lineSnippet = t("tools:readFile.definitionsOnly")
				} else if (maxReadFileLine > 0) {
					lineSnippet = t("tools:readFile.maxLines", { max: maxReadFileLine })
				}

				const completeMessageObj = {
					tool: "readFile",
					path: getReadablePath(task.cwd, relPath),
					isOutsideWorkspace,
					content: fullPath,
					reason: lineSnippet,
					lineNumber: fileResult.lineRanges?.[0]?.start,
					head: (fileEntries[0] as any)?.head,
					tail: (fileEntries[0] as any)?.tail,
					id: callbacks.toolCallId,
				}
				if (fileResult.lineRanges?.[0]?.end) {
					; (completeMessageObj as any).endLine = fileResult.lineRanges[0].end
				}
				const completeMessage = JSON.stringify(completeMessageObj)

				const { response, text, images } = await task.ask("tool", completeMessage, false)

				if (response !== "yesButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					task.didRejectTool = true
					Object.assign(fileResult, {
						status: "denied",
						xmlContent: `<file><path>${relPath}</path><status>Denied by user</status></file>`,
						nativeContent: `File: ${relPath}\nStatus: Denied by user`,
						feedbackText: text,
						feedbackImages: images,
					})
				} else {
					if (text) await task.say("user_feedback", text, images)
					Object.assign(fileResult, { status: "approved", feedbackText: text, feedbackImages: images })
				}
			}

			const imageMemoryTracker = new ImageMemoryTracker()
			const state = await task.providerRef.deref()?.getState()
			const {
				maxReadFileLine = -1,
				maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
				maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
			} = state ?? {}

			for (const fileResult of fileResults) {
				if (fileResult.status !== "approved") continue

				const entry = fileEntries.find((e) => e.path === fileResult.path)

				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)

				try {
					const [totalLines, isBinary] = await Promise.all([countFileLines(fullPath), isBinaryFile(fullPath)])

					if (isBinary) {
						const fileExtension = path.extname(relPath).toLowerCase()
						const supportedBinaryFormats = getSupportedBinaryFormats()

						if (isSupportedImageFormat(fileExtension)) {
							try {
								const validationResult = await validateImageForProcessing(
									fullPath,
									supportsImages,
									maxImageFileSize,
									maxTotalImageSize,
									imageMemoryTracker.getTotalMemoryUsed(),
								)

								if (!validationResult.isValid) {
									await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)
									Object.assign(fileResult, {
										xmlContent: `<file><path>${relPath}</path>\n<notice>${validationResult.notice}</notice>\n</file>`,
										nativeContent: `File: ${relPath}\nNote: ${validationResult.notice}`,
									})
									continue
								}

								const imageResult = await processImageFile(fullPath)
								imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)
								await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

								Object.assign(fileResult, {
									xmlContent: `<file><path>${relPath}</path>\n<notice>${imageResult.notice}</notice>\n</file>`,
									nativeContent: `File: ${relPath}\nNote: ${imageResult.notice}`,
									imageDataUrl: imageResult.dataUrl,
								})
								continue
							} catch (error) {
								const errorMsg = error instanceof Error ? error.message : String(error)
								Object.assign(fileResult, {
									status: "error",
									error: `Error reading image file: ${errorMsg}`,
									xmlContent: `<file><path>${relPath}</path><error>Error reading image file: ${errorMsg}</error></file>`,
									nativeContent: `File: ${relPath}\nError: Error reading image file: ${errorMsg}`,
								})
								await task.say("error", `Error reading image file ${relPath}: ${errorMsg}`)
								continue
							}
						}

						if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
							// Fall through to extractTextFromFile
						} else {
							const fileFormat = fileExtension.slice(1) || "bin"
							Object.assign(fileResult, {
								notice: `Binary file format: ${fileFormat}`,
								xmlContent: `<file><path>${relPath}</path>\n<binary_file format="${fileFormat}">Binary file - content not displayed</binary_file>\n</file>`,
								nativeContent: `File: ${relPath}\nBinary file (${fileFormat}) - content not displayed`,
							})
							continue
						}
					}

					if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
						const rangeResults: string[] = []
						const nativeRangeResults: string[] = []

						// 🔥 HOT CACHE: Read full file once and inject into LuxurySpa
						const fullFileContent = await fs.promises.readFile(fullPath, "utf8")
						const fullFileLines = fullFileContent.split(/\r?\n/)
						task.luxurySpa.injectFreshContent(relPath, fullFileLines)

						for (const range of fileResult.lineRanges) {
							// Read raw content
							const rawContent = await readLines(fullPath, range.end - 1, range.start - 1)
							const rawLines = rawContent.split(/\r?\n/)

							// Format with line numbers
							const finalContentLines = rawLines.map((line, idx) => `${range.start + idx}→${line}`)

							const nativeChunk = `Lines ${range.start}-${range.end}:\n` + finalContentLines.join("\n")

							// XML result remains simple unique-content
							const content = addLineNumbers(rawContent, range.start)
							const lineRangeAttr = ` lines="${range.start}-${range.end}"`
							let xmlChunk = `<content${lineRangeAttr}>\n${content}</content>`

							rangeResults.push(xmlChunk)
							nativeRangeResults.push(nativeChunk)
						}

						let xmlContent = `<file><path>${relPath}</path>\n${rangeResults.join("\n")}\n`
						let nativeContent = `File: ${relPath}\n${nativeRangeResults.join("\n\n")}`

						xmlContent += `</file>`

						Object.assign(fileResult, {
							xmlContent,
							nativeContent,
						})
						continue
					}

					if (maxReadFileLine > 0 && totalLines > maxReadFileLine) {
						let effectiveRange = `1-${maxReadFileLine}`

						// Read raw content
						const contentRaw = await readLines(fullPath, maxReadFileLine - 1, 0)
						const rawLines = contentRaw.split(/\r?\n/)

						// Add line numbers
						const finalContentLines = rawLines.map((line, idx) => `${idx + 1}→${line}`)
						const nativeContent = finalContentLines.join("\n")
						const content = addLineNumbers(contentRaw)

						let xmlInfo = `<content lines="${effectiveRange}">\n${content}</content>\n`
						let nativeInfo = `Lines 1-${maxReadFileLine}:\n${nativeContent}\n`

						let notice = `Showing only ${maxReadFileLine} of ${totalLines} total lines. Use line_range if you need to read more lines`

						xmlInfo += `<notice>${notice}</notice>\n`
						nativeInfo += `\nNote: ${notice}`

						Object.assign(fileResult, {
							xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
							nativeContent: `File: ${relPath}\n${nativeInfo}`,
						})

						continue
					}

					const { id: modelId, info: modelInfo } = task.api.getModel()
					const { contextTokens } = task.getTokenUsage()
					const contextWindow = modelInfo.contextWindow

					const maxOutputTokens =
						getModelMaxOutputTokens({
							modelId,
							model: modelInfo,
							settings: task.apiConfiguration,
						}) ?? ANTHROPIC_DEFAULT_MAX_TOKENS

					const budgetResult = await validateFileTokenBudget(
						fullPath,
						contextWindow - maxOutputTokens,
						contextTokens || 0,
					)

					let content = await extractTextFromFile(fullPath)
					// 🔥 HOT CACHE: Inject fresh content into LuxurySpa to avoid re-reading disk
					const rawFileContent = await fs.promises.readFile(fullPath, "utf8")
					const fileLines = rawFileContent.split(/\r?\n/)
					task.luxurySpa.injectFreshContent(relPath, fileLines)

					let xmlInfo = ""

					let nativeInfo = ""

					if (budgetResult.shouldTruncate && budgetResult.maxChars !== undefined) {
						const truncateResult = truncateFileContent(
							content,
							budgetResult.maxChars,
							content.length,
							budgetResult.isPreview,
						)
						content = truncateResult.content

						let displayedLines = content.length === 0 ? 0 : content.split(/\r?\n/).length
						if (displayedLines > 0 && content.endsWith("\n")) {
							displayedLines--
						}
						const lineRangeAttr = displayedLines > 0 ? ` lines="1-${displayedLines}"` : ""
						xmlInfo =
							content.length > 0 ? `<content${lineRangeAttr}>\n${content}</content>\n` : `<content/>`
						xmlInfo += `<notice>${truncateResult.notice}</notice>\n`

						if (content.length > 0) {
							// Format truncated content
							const truncRawLines = stripLineNumbers(content).split(/\r?\n/)
							const truncFinal = truncRawLines.map((line, idx) => `${idx + 1}→${line}`)
							nativeInfo = `Lines 1-${displayedLines}:\n${truncFinal.join("\n")}\n\nNote: ${truncateResult.notice}`
						} else {
							nativeInfo = `Note: ${truncateResult.notice}`
						}
					} else {
						const lineRangeAttr = ` lines="1-${totalLines}"`
						xmlInfo = totalLines > 0 ? `<content${lineRangeAttr}>\n${content}</content>\n` : `<content/>`

						if (totalLines === 0) {
							xmlInfo += `<notice>File is empty</notice>\n`
							nativeInfo = "Note: File is empty"
						} else {
							// Read raw content, ensuring we support binary/pdf via extractTextFromFile
							// but stripping the line numbers it adds to avoid double-numbering.
							const contentWithNumbers = await extractTextFromFile(fullPath)
							const rawLines = stripLineNumbers(contentWithNumbers).split(/\r?\n/)

							// Add line numbers with arrow separator
							const finalContentLines = rawLines.map((line, idx) => `${idx + 1}→${line}`)

							nativeInfo = `Lines 1-${totalLines}:\n${finalContentLines.join("\n")}`
						}
					}

					await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

					Object.assign(fileResult, {
						xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
						nativeContent: `File: ${relPath}\n${nativeInfo}`,
					})
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					Object.assign(fileResult, {
						status: "error",
						error: `Error reading file: ${errorMsg}`,
						xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
						nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
					})
					await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
				}
			}

			// Check if any files had errors or were blocked and mark the turn as failed
			const hasErrors = fileResults.some((result) => result.status === "error" || result.status === "blocked")
			if (hasErrors) {
				task.didToolFailInCurrentTurn = true
			}

			// Build final result based on protocol
			let finalResult: string
			if (useNative) {
				const nativeResults = fileResults
					.filter((result) => result.nativeContent)
					.map((result) => result.nativeContent)
				finalResult = nativeResults.join("\n\n---\n\n")
			} else {
				const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)
				finalResult = `<files>\n${xmlResults.join("\n")}\n</files>`
			}

			const fileImageUrls = fileResults
				.filter((result) => result.imageDataUrl)
				.map((result) => result.imageDataUrl as string)

			let statusMessage = ""
			let feedbackImages: any[] = []

			const deniedWithFeedback = fileResults.find((result) => result.status === "denied" && result.feedbackText)

			if (deniedWithFeedback && deniedWithFeedback.feedbackText) {
				statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
				feedbackImages = deniedWithFeedback.feedbackImages || []
			} else if (task.didRejectTool) {
				statusMessage = formatResponse.toolDenied()
			} else {
				const approvedWithFeedback = fileResults.find(
					(result) => result.status === "approved" && result.feedbackText,
				)

				if (approvedWithFeedback && approvedWithFeedback.feedbackText) {
					statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
					feedbackImages = approvedWithFeedback.feedbackImages || []
				}
			}

			const allImages = [...feedbackImages, ...fileImageUrls]

			const finalModelSupportsImages = task.api.getModel().info.supportsImages ?? false
			const imagesToInclude = finalModelSupportsImages ? allImages : []

			if (statusMessage || imagesToInclude.length > 0) {
				const result = formatResponse.toolResult(
					statusMessage || finalResult,
					imagesToInclude.length > 0 ? imagesToInclude : undefined,
				)

				if (typeof result === "string") {
					if (statusMessage) {
						pushToolResult(`${result}\n${finalResult}`)
					} else {
						pushToolResult(result)
					}
				} else {
					if (statusMessage) {
						const textBlock = { type: "text" as const, text: finalResult }
						pushToolResult([...result, textBlock])
					} else {
						pushToolResult(result)
					}
				}
			} else {
				pushToolResult(finalResult)
			}
		} catch (error) {
			const relPath = fileEntries[0]?.path || "unknown"
			const errorMsg = error instanceof Error ? error.message : String(error)

			if (fileResults.length > 0) {
				const firstResult = fileResults[0]
				Object.assign(firstResult, {
					status: "error",
					error: `Error reading file: ${errorMsg}`,
					xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
					nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
				})
			}

			await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)

			// Mark that a tool failed in this turn
			task.didToolFailInCurrentTurn = true

			// Build final error result based on protocol
			let errorResult: string
			if (useNative) {
				const nativeResults = fileResults
					.filter((result) => result.nativeContent)
					.map((result) => result.nativeContent)
				errorResult = nativeResults.join("\n\n---\n\n")
			} else {
				const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)
				errorResult = `<files>\n${xmlResults.join("\n")}\n</files>`
			}

			pushToolResult(errorResult)
		}
	}

	getReadFileToolDescription(blockName: string, blockParams: any): string
	getReadFileToolDescription(blockName: string, nativeArgs: { files: FileEntry[] }): string
	getReadFileToolDescription(blockName: string, second: any): string {
		// If native typed args ({ files: FileEntry[] }) were provided
		if (second && typeof second === "object" && "files" in second && Array.isArray(second.files)) {
			const paths = (second.files as FileEntry[]).map((f) => f?.path).filter(Boolean) as string[]
			if (paths.length === 0) {
				return `[${blockName} with no valid paths]`
			} else if (paths.length === 1) {
				return `[${blockName} for '${paths[0]}']`
			} else if (paths.length <= 3) {
				const pathList = paths.map((p) => `'${p}'`).join(", ")
				return `[${blockName} for ${pathList}]`
			} else {
				return `[${blockName} for ${paths.length} files]`
			}
		}

		// Fallback to legacy/XML or synthesized params
		const blockParams = second as any

		if (blockParams?.args) {
			try {
				const parsed = parseXml(blockParams.args) as any
				const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)
				const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]

				if (paths.length === 0) {
					return `[${blockName} with no valid paths]`
				} else if (paths.length === 1) {
					return `[${blockName} for '${paths[0]}']`
				} else if (paths.length <= 3) {
					const pathList = paths.map((p) => `'${p}'`).join(", ")
					return `[${blockName} for ${pathList}]`
				} else {
					return `[${blockName} for ${paths.length} files]`
				}
			} catch (error) {
				console.error("Failed to parse read_file args XML for description:", error)
				return `[${blockName} with unparsable args]`
			}
		} else if (blockParams?.path) {
			return `[${blockName} for '${blockParams.path}']`
		} else if (blockParams?.files) {
			// Back-compat: some paths may still synthesize params.files; try to parse if present
			try {
				const files = JSON.parse(blockParams.files)
				if (Array.isArray(files) && files.length > 0) {
					const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]
					if (paths.length === 1) {
						return `[${blockName} for '${paths[0]}']`
					} else if (paths.length <= 3) {
						const pathList = paths.map((p) => `'${p}'`).join(", ")
						return `[${blockName} for ${pathList}]`
					} else {
						return `[${blockName} for ${paths.length} files]`
					}
				}
			} catch (error) {
				console.error("Failed to parse native files JSON for description:", error)
				return `[${blockName} with unparsable files]`
			}
		}

		return `[${blockName} with missing path/args/files]`
	}

		override async handlePartial(task: Task, block: ToolUse<"read_file">): Promise<void> {
			if (!block.partial) {
				return
			}

			const argsXmlTag = block.params.args
			const legacyPath = block.params.path

		let filePath = ""
		let parsedLineSnippet = ""
		if (argsXmlTag) {
			const match = argsXmlTag.match(/<file>.*?<path>([^<]+)<\/path>/s)
			if (match) filePath = match[1]
		}
		if (!filePath && legacyPath) {
			// kade_change: Strip line range from legacy path (e.g. "flappy.html 1-260" → "flappy.html")
			// This mirrors parseLegacy behavior to prevent partial messages from having broken paths
			const rangeMatch = legacyPath.match(/^(.*?)(?::|\s+)(\d+)-(\d+)$/)
			if (rangeMatch) {
				filePath = rangeMatch[1].trim()
				const start = parseInt(rangeMatch[2], 10)
				const end = parseInt(rangeMatch[3], 10)
				if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
					parsedLineSnippet = t("tools:readFile.linesRange", { start, end })
				}
			} else {
				filePath = legacyPath
			}
		}

		if (!filePath && block.nativeArgs && "files" in block.nativeArgs && Array.isArray(block.nativeArgs.files)) {
			const files = block.nativeArgs.files
			if (files.length > 0 && files[0]?.path) {
				filePath = files[0].path
			}
		}

		// kade_change: Only show partial when we have a complete-looking path
		// This prevents showing intermediate partial paths like "av" when the full
		// path "av/sample.txt" is still streaming, which causes double display
		if (!filePath) {
			return
		}
		const hasExtension = /\.[a-zA-Z0-9]+$/.test(filePath)
		const hasPathSeparator = /[/\\]/.test(filePath)
		// Only send if path looks complete: has extension OR is a clear single filename
		// Skip if it looks like an incomplete path segment (short, no extension, no separator)
		if (!hasExtension && !hasPathSeparator && filePath.length < 5) {
			return
		}

		const fullPath = filePath ? path.resolve(task.cwd, filePath) : ""

		// Compute line range snippet for partial display
		let lineSnippet = parsedLineSnippet
		if (!lineSnippet && block.nativeArgs && "files" in block.nativeArgs && Array.isArray(block.nativeArgs.files)) {
			const fileEntry = block.nativeArgs.files[0]
			if (fileEntry?.lineRanges && fileEntry.lineRanges.length > 0) {
				lineSnippet = fileEntry.lineRanges
					.map((range: { start: number; end: number }) =>
						t("tools:readFile.linesRange", { start: range.start, end: range.end }),
					)
					.join(", ")
			}
		}

		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(task.cwd, filePath),
			isOutsideWorkspace: filePath ? isPathOutsideWorkspace(fullPath) : false,
			reason: lineSnippet || undefined,
			lineNumber: parsedLineSnippet ? parseInt(parsedLineSnippet.match(/\d+/)?.[0] || "") : undefined,
			id: block.id,
		}
		if (parsedLineSnippet) {
			const rangeMatch = parsedLineSnippet.match(/#L(\d+)-(\d+)/)
			if (rangeMatch) {
				; (sharedMessageProps as any).lineNumber = parseInt(rangeMatch[1])
					; (sharedMessageProps as any).endLine = parseInt(rangeMatch[2])
			}
		}
		const partialMessage = JSON.stringify({
			...sharedMessageProps,
			content: undefined,
		} satisfies ClineSayTool)
		await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
	}
}

export const readFileTool = new ReadFileTool()
