import path from "path"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface MoveFileParams {
    source: string
    destination: string
    isRename?: boolean
    isCopy?: boolean
    shouldDeleteSource?: boolean
}

export class MoveFileTool extends BaseTool<"move_file"> {
    readonly name = "move_file" as const

    parseLegacy(params: Partial<Record<string, string>>): MoveFileParams {
        return {
            source: params.rename || params.source || params.from || params.path || "",
            destination: params.to || params.new || params.destination || "",
            isRename: !!params.rename || (params as any).isRename === true || (params as any).isRename === "true",
            isCopy: (params as any).copy === true || (params as any).copy === "true",
            shouldDeleteSource: (params as any).rm !== undefined,
        }
    }

    async execute(params: MoveFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { source: rawSource, destination: rawDest } = params
        const { askApproval, handleError, pushToolResult } = callbacks

        try {
            if (!rawSource) {
                task.consecutiveMistakeCount++
                task.recordToolError("move_file")
                task.didToolFailInCurrentTurn = true
                pushToolResult(await task.sayAndCreateMissingParamError("move_file", "source"))
                return
            }
            if (!rawDest) {
                task.consecutiveMistakeCount++
                task.recordToolError("move_file")
                task.didToolFailInCurrentTurn = true
                pushToolResult(await task.sayAndCreateMissingParamError("move_file", "destination"))
                return
            }

            task.consecutiveMistakeCount = 0

            // Split by comma
            const sources = rawSource.split(",").map(p => p.trim()).filter(p => p !== "")
            const destinations = rawDest.split(",").map(p => p.trim()).filter(p => p !== "")

            if (sources.length === 0) {
                pushToolResult("Error: No valid source paths provided.")
                return
            }

            // Determine move pairs
            const moves: { source: string; destination: string; absSource: string; absDest: string }[] = []

            if (sources.length > 1 && destinations.length === 1) {
                // Multiple sources to one directory (Move into)
                const relDest = destinations[0]
                const absDest = path.resolve(task.cwd, relDest)

                // If moving multiple files to one destination, the destination must be a directory
                // (or it will be created as one)
                for (const relSource of sources) {
                    const absSource = path.resolve(task.cwd, relSource)
                    const fileName = path.basename(absSource)
                    const finalAbsDest = path.join(absDest, fileName)
                    moves.push({
                        source: relSource,
                        destination: path.join(relDest, fileName),
                        absSource,
                        absDest: finalAbsDest
                    })
                }
            } else if (sources.length === destinations.length) {
                // 1-to-1 mapping (Rename or Move to specific path)
                for (let i = 0; i < sources.length; i++) {
                    const relSource = sources[i]
                    const relDest = destinations[i]
                    const absSource = path.resolve(task.cwd, relSource)
                    const absDest = path.resolve(task.cwd, relDest)
                    
                    // Check if destination is an existing directory
                    let finalAbsDest = absDest
                    let finalRelDest = relDest
                    try {
                        const destStat = await fs.stat(absDest)
                        if (destStat.isDirectory()) {
                            // Destination is a directory, move file into it
                            const fileName = path.basename(absSource)
                            finalAbsDest = path.join(absDest, fileName)
                            finalRelDest = path.join(relDest, fileName)
                        }
                    } catch {
                        // Destination doesn't exist, treat as rename/move to new path
                    }
                    
                    moves.push({
                        source: relSource,
                        destination: finalRelDest,
                        absSource,
                        absDest: finalAbsDest
                    })
                }
            } else {
                pushToolResult(`Error: Mismatch between number of sources (${sources.length}) and destinations (${destinations.length}). Either provide one destination directory (for 2+ sources) or the same number of destinations as sources.`)
                return
            }

            // Security check all moves
            for (const move of moves) {
                if (isPathOutsideWorkspace(move.absSource) || isPathOutsideWorkspace(move.absDest)) {
                    pushToolResult(`Error: Cannot move files outside of the workspace: ${move.source} -> ${move.destination}`)
                    return
                }
            }

            // UI Approval
            const sharedMessageProps: ClineSayTool = {
                tool: "moveFile",
                source: moves.map(m => getReadablePath(task.cwd, m.source)).join(", "),
                destination: moves.map(m => getReadablePath(task.cwd, m.destination)).join(", "),
                isRename: params.isRename,
                isCopy: params.isCopy,
                shouldDeleteSource: params.shouldDeleteSource,
            }

            const completeMessage = JSON.stringify({ ...sharedMessageProps, id: callbacks.toolCallId } satisfies ClineSayTool)
            
            // If --rm is used, it counts as a delete action for auto-approval purposes
            const approvalType = params.shouldDeleteSource ? "deleteFile" : "tool"
            const didApprove = await askApproval(approvalType as any, completeMessage)

            if (!didApprove) {
                pushToolResult("Move operation denied by user.")
                return
            }

            // Execute all moves/copies
            const results: string[] = []
            for (const move of moves) {
                try {
                    // Ensure destination parent directory exists
                    await fs.mkdir(path.dirname(move.absDest), { recursive: true })
                    
                    if (params.isCopy) {
                        await fs.cp(move.absSource, move.absDest, { recursive: true })
                        results.push(`Successfully copied ${move.source} to ${move.destination}`)
                        if (params.shouldDeleteSource) {
                            await fs.rm(move.absSource, { recursive: true, force: true })
                            results.push(`Deleted source ${move.source}`)
                        }
                    } else {
                        await fs.rename(move.absSource, move.absDest)
                        results.push(`Successfully moved/renamed ${move.source} to ${move.destination}`)
                    }

                    // Track changes
                    if (!params.isCopy) {
                        await task.fileContextTracker.trackFileContext(move.source, "roo_edited" as any)
                    }
                    await task.fileContextTracker.trackFileContext(move.destination, "roo_edited" as any)
                } catch (err) {
                    const action = params.isCopy ? "copy" : "move"
                    results.push(`Failed to ${action} ${move.source} to ${move.destination}: ${err.message}`)
                }
            }

            pushToolResult(results.join("\n"))
        } catch (error) {
            await handleError("moving/renaming files", error)
        }
    }

	    override async handlePartial(task: Task, block: ToolUse<"move_file">): Promise<void> {
	        if (!block.partial) {
	            return
	        }

	        const relSource: string | undefined = block.params.source
	        const relDest: string | undefined = block.params.destination
	        if (!relSource && !relDest) return

        const sharedMessageProps: ClineSayTool = {
            tool: "moveFile",
            source: this.removeClosingTag("source", relSource || "", block.partial),
            destination: this.removeClosingTag("destination", relDest || "", block.partial),
            isRename: !!(block.params as any).rename || (block.params as any).isRename === true || (block.params as any).isRename === "true",
            isCopy: (block.params as any).copy === true || (block.params as any).copy === "true",
            shouldDeleteSource: (block.params as any).rm !== undefined,
            id: block.id,
        }

        const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
        await task.say("tool", partialMessage, undefined, block.partial).catch(() => { })
    }
}

export const moveFileTool = new MoveFileTool()
