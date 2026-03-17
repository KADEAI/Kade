import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

interface Edit {
    oldText: string
    newText: string
    replaceAll?: boolean
}

function replaceLastOccurrence(haystack: string, needle: string, replacement: string) {
    if (!needle) {
        return haystack
    }

    const index = haystack.lastIndexOf(needle)
    if (index === -1) {
        return haystack
    }

    return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length)
}

async function deriveOriginalContentFromEdits(filePath: string, edits: Edit[]): Promise<string | undefined> {
    if (!edits?.length) {
        return undefined
    }

    let currentContent: string
    try {
        currentContent = await fs.readFile(filePath, "utf-8")
    } catch {
        return undefined
    }

    let reconstructed = currentContent

    // Reverse the applied edits so we approximate the pre-edit file state.
    for (let i = edits.length - 1; i >= 0; i--) {
        const edit = edits[i]
        const oldText = edit.oldText ?? ""
        const newText = edit.newText ?? ""

        if (edit.replaceAll) {
            if (newText) {
                reconstructed = reconstructed.split(newText).join(oldText)
            }
            continue
        }

        if (!newText && oldText) {
            reconstructed += oldText
            continue
        }

        if (!oldText && newText) {
            reconstructed = replaceLastOccurrence(reconstructed, newText, oldText)
            continue
        }

        if (newText) {
            reconstructed = replaceLastOccurrence(reconstructed, newText, oldText)
        }
    }

    return reconstructed
}

export async function openDiff(filePath: string, edits: Edit[], originalContent?: string, isProposed: boolean = false) {
    try {
        const uri = vscode.Uri.file(filePath)
        const fileName = path.basename(filePath)

        if (isProposed) {
            // PREVIEW MODE (Before apply):
            // Left: Current file on disk (Original)
            // Right: Proposed changes in temp file (Modified)
            const currentContent = await fs.readFile(filePath, "utf-8")
            const proposedContent = originalContent ?? currentContent // originalContent is used as "Proposed" here

            const leftUri = uri
            
            const tempDir = require('os').tmpdir()
            const modifiedFileName = `${Date.now()}_${fileName}.proposed`
            const tempFilePath = path.join(tempDir, modifiedFileName)
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(tempFilePath),
                Buffer.from(proposedContent, 'utf-8')
            )
            const rightUri = vscode.Uri.file(tempFilePath)

            await vscode.commands.executeCommand(
                "vscode.diff",
                leftUri,
                rightUri,
                `(Proposed) ${fileName}`
            )

            // Setup navigation & cleanup
            handleDiffNavigation(edits, proposedContent, rightUri)
            cleanupTempFile(rightUri)
            return
        }

        // REVIEW MODE (After apply):
        // Left: Original content in temp file
        // Right: Current file on disk (Modified)
        if (originalContent === undefined) {
            originalContent = await deriveOriginalContentFromEdits(filePath, edits)
        }

        if (originalContent === undefined) {
            vscode.window.showErrorMessage(`No edit history found for ${fileName}. Cannot show diff.`)
            return
        }

        const tempDir = require('os').tmpdir()
        const originalFileName = `${Date.now()}_${fileName}.original`
        const tempFilePath = path.join(tempDir, originalFileName)

        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(tempFilePath),
            Buffer.from(originalContent, 'utf-8')
        )

        const leftUri = vscode.Uri.file(tempFilePath)
        const rightUri = uri

        await vscode.commands.executeCommand(
            "vscode.diff",
            leftUri,
            rightUri,
            fileName
        )

        handleDiffNavigation(edits, originalContent, rightUri)
        cleanupTempFile(leftUri)

    } catch (e) {
        vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : String(e)}`)
    }
}

function handleDiffNavigation(edits: Edit[], referenceContent: string, targetUri: vscode.Uri) {
    if (!edits || edits.length === 0) return

    const firstEdit = edits[0]
    const oldText = (firstEdit.oldText || "").trim()

    if (oldText && referenceContent) {
        const lines = referenceContent.split('\n')
        let targetLine = -1

        // 1. Try exact match on cleaned lines
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(oldText)) {
                targetLine = i
                break
            }
        }

        // 2. Try matching first few lines of oldText if it's multi-line
        if (targetLine === -1 && oldText.includes('\n')) {
            const firstOldLine = oldText.split('\n')[0].trim()
            if (firstOldLine) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(firstOldLine)) {
                        targetLine = i
                        break
                    }
                }
            }
        }

        if (targetLine !== -1) {
            setTimeout(async () => {
                const editor = vscode.window.visibleTextEditors.find(
                    (candidate) => candidate.document.uri.fsPath === targetUri.fsPath
                )
                if (!editor) return

                const position = new vscode.Position(targetLine, 0)
                editor.selection = new vscode.Selection(position, position)
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                )
            }, 500)
        }
    }
}

function cleanupTempFile(uri: vscode.Uri) {
    setTimeout(() => {
        try {
            vscode.workspace.fs.delete(uri, { useTrash: false })
        } catch (e) {}
    }, 30000)
}
