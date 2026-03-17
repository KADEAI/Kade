import { ClineMessage } from "@roo-code/types"
import { ClineSayTool } from "@roo/ExtensionMessage"

export interface FileChange {
    path: string
    additions: number
    deletions: number
    toolIds: string[]
    type: "create" | "edit" | "delete"
}

export const getFileChangesInRange = (messages: any[], startTs: number): FileChange[] => {
    const changes = new Map<string, FileChange>()
    const index = messages.findIndex((m) => m.ts === startTs)
    if (index === -1) return []

    for (let i = index; i < messages.length; i++) {
        const msg = messages[i]
        const isTool = (msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && (msg as any).say === "tool")
        if (isTool) {
            try {
                const toolData = JSON.parse(msg.text || "{}")
                const toolName = toolData.tool
                const filePath = toolData.path || toolData.file_path

                if (["appliedDiff", "editedExistingFile", "newFileCreated", "insertContent", "searchAndReplace", "deleteFile"].includes(toolName)) {
                    if (!filePath) continue

                    const diffStats = toolData.diffStats
                    let additions = diffStats?.added || 0
                    let deletions = diffStats?.removed || 0

                    if (toolName === "newFileCreated" && additions === 0 && toolData.content) {
                        additions = toolData.content.split("\n").length
                    }

                    if (toolName === "deleteFile" && !toolData.stats && deletions === 0) {
                        deletions = 1
                    }

                    const existing = changes.get(filePath)
                    if (existing) {
                        changes.set(filePath, {
                            path: filePath,
                            additions: existing.additions + additions,
                            deletions: existing.deletions + deletions,
                            toolIds: toolData.id ? [...existing.toolIds, toolData.id] : existing.toolIds,
                            type: toolName === "deleteFile" ? "delete" : existing.type
                        })
                    } else {
                        changes.set(filePath, {
                            path: filePath,
                            additions,
                            deletions,
                            toolIds: toolData.id ? [toolData.id] : [],
                            type: toolName === "deleteFile" ? "delete" : (toolName === "newFileCreated" ? "create" : "edit")
                        })
                    }
                }
            } catch (e) { }
        }
    }

    return Array.from(changes.values())
}
