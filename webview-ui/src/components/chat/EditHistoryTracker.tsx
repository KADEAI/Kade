import React, { useMemo, useState, useRef } from "react"
import styled from "styled-components"
import { AnimatePresence, motion } from "framer-motion"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { FileIcon } from "./tools/FileIcon"
import { vscode } from "../../utils/vscode"
import { ChevronDown, RotateCcw, CheckCircle2 } from "lucide-react"

const TrackerContainer = styled.div`
	display: flex;
	flex-direction: column;
	background: #1f1f1fff;
	border: 0.6px solid rgba(58, 58, 58, 0.36);
	border-radius: 9px;
	margin: 0 18px -18px 17.7px;
	overflow: hidden;
	box-shadow: 0 0px 0px rgba(78, 78, 78, 0.26);
`

const TrackerHeader = styled.div<{ $isExpanded: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 7px 10px;
	cursor: pointer;
	user-select: none;
	background: ${({ $isExpanded }) => ($isExpanded ? "rgba(255, 255, 255, 0.03)" : "transparent")};
	transition: background 0.2;
    z-index: 101; /* Ensure header is above the text area overlap if needed */
    position: relative;
	}
`

const FilesCount = styled.div`
	display: flex;
	align-items: center;
	padding-left: 2px;
	font-size: 12px;
	font-weight: 400;
	font-family: var(--vscode-system    -font-family);
	color: #cccccc;
    min-width: 0;
    flex: 1;
    align-self: stretch; /* Fill header height */

    .count-text {
        white-space: nowrap;
        margin-right: 6px;
    }

    .chevron {
        margin-left: 6px;
        opacity: 0.3;
        display: flex;
        align-items: center;
    }
`

const StatsSummary = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
`

const Actions = styled.div`
	position: relative;
	display: flex;
	align-items: center;
	gap: 6px;
	align-self: stretch; /* Fill header height */
`

const NotificationBubble = styled(motion.div)`
	position: absolute;
	bottom: 100%;
	right: 0;
	margin-bottom: 8px;
	background: #2a2d33;
	color: #d4d4d4;
	padding: 6px 12px;
	border-radius: 16px;
	font-size: 12px;
	font-weight: 500;
	box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
	white-space: nowrap;
	z-index: 10;
	display: flex;
	align-items: center;
	gap: 6px;
`

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" }>`
	display: flex;
	align-items: center;
	justify-content: center;
	background: ${({ $variant }) =>
        $variant === "primary" ? "#0078d4" : "#333333"};
	border: 0px solid rgba(255, 255, 255, 0.1);
	color: white;
	font-size: 11px;
	font-weight: 500;
	cursor: pointer;
	height: 24px;
	padding: 0 14px;
	border-radius: 4px;
	transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
	box-sizing: border-box;

	&:hover {
		background: ${({ $variant }) =>
        $variant === "primary" ? "#005a9e" : "#444444"};
		transform: translateY(-1px);
		box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
	}

	&:active {
		transform: translateY(0);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		filter: brightness(0.9);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}
`

const FilesList = styled.div`
	display: flex;
	flex-direction: column;
	max-height: 240px;
	overflow-y: auto;
	border-top: 0px solid rgba(255, 255, 255, 0.05);
	background: rgba(0, 0, 0, 0.15);

	&::-webkit-scrollbar {
		width: 4px;
	}

	&::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
		border-radius: 2px;
	}
`

const FileItem = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 16px;
	font-size: 12px;
	border-bottom: 0px solid rgba(255, 255, 255, 0.03);

	&:last-child {
		border-bottom: none;
	}
	}
`

const FileNameSection = styled.div`
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	flex: 1;
`

const FileName = styled.span`
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--vscode-foreground);
    opacity: 0.9;
	cursor: pointer;

	&:hover {
		text-decoration: underline;
        opacity: 1;
	}
`

const FileStats = styled.div`
	display: flex;
	align-items: center;
	gap: 10px;
	margin-left: 12px;
	flex-shrink: 0;
`

const Stat = styled.span<{ $type: "add" | "remove" }>`
	color: ${({ $type }) => ($type === "add" ? "#4ade80" : "#f87171")};
	font-weight: 500;
	font-size: 12px;
`

const UndoIcon = styled.div`
	cursor: pointer;
	opacity: 0.5;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 6px;
	border-radius: 4px;
    transition: all 0.2s;
    margin-left: 2px;

	&:hover {
		opacity: 1;
		background: rgba(255, 70, 70, 0.2);
        color: #ff5555;
	}
`

const DiffMeter = styled.div`
    display: flex;
    width: 32px;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 1px;
    overflow: hidden;
    margin-left: 8px;
    flex-shrink: 0;
`

const AdditionBar = styled.div<{ $percent: number }>`
    width: ${({ $percent }) => $percent}%;
    height: 100%;
    background: #4ade80;
    transition: width 0.3s ease;
`

const DeletionBar = styled.div<{ $percent: number }>`
    width: ${({ $percent }) => $percent}%;
    height: 100%;
    background: #f87171;
    transition: width 0.3s ease;
`

export const EditHistoryTracker: React.FC = () => {
    const { clineMessages, undoneToolIds = [], acceptedToolIds = [] } = useExtensionState()
    const [isExpanded, setIsExpanded] = useState(false)
    const [notification, setNotification] = useState<string | null>(null)
    const notificationTimer = useRef<NodeJS.Timeout | null>(null)

    const showNotification = (message: string) => {
        if (notificationTimer.current) {
            clearTimeout(notificationTimer.current)
        }
        setNotification(message)
        notificationTimer.current = setTimeout(() => {
            setNotification(null)
        }, 3000)
    }

    const fileChanges = useMemo(() => {
        const changes = new Map<string, { path: string; additions: number; deletions: number; toolIds: string[]; type: "create" | "edit" | "delete" }>()

        clineMessages.forEach((msg) => {
            if (msg.partial) return
            const isTool = (msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && (msg as any).say === "tool")
            if (isTool) {
                try {
                    const toolData = JSON.parse(msg.text || "{}")
                    const toolName = toolData.tool
                    const filePath = toolData.path || toolData.file_path

                    if (["appliedDiff", "editedExistingFile", "newFileCreated", "insertContent", "searchAndReplace", "deleteFile"].includes(toolName)) {
                        if (toolData.id && (undoneToolIds.includes(toolData.id) || acceptedToolIds.includes(toolData.id))) return
                        if (!filePath) return

                        const diffStats = toolData.diffStats
                        let additions = diffStats?.added || 0
                        let deletions = diffStats?.removed || 0

                        // Fallback: If stats are missing but diff is present, calculate them
                        if (additions === 0 && deletions === 0 && toolData.diff) {
                            const lines = toolData.diff.split("\n")
                            for (const line of lines) {
                                if (line.startsWith("+") && !line.startsWith("+++")) additions++
                                else if (line.startsWith("-") && !line.startsWith("---")) deletions++
                            }
                        }

                        // For new files, if added is 0, it might be a single line or content exists but stats missing
                        if (toolName === "newFileCreated" && additions === 0 && toolData.content) {
                            additions = toolData.content.split("\n").length
                        }

                        // For deleted files (not directories), show it as 1 deletion if stats missing
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
                } catch (_e) {
                    // Ignore parse errors
                }
            }
        })

        return Array.from(changes.values())
    }, [clineMessages, undoneToolIds, acceptedToolIds])

    const undoneChanges = useMemo(() => {
        const changes = new Map<string, { path: string; toolIds: string[] }>()
        clineMessages.forEach((msg) => {
            if (msg.partial) return
            const isTool = (msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && (msg as any).say === "tool")
            if (isTool) {
                try {
                    const toolData = JSON.parse(msg.text || "{}")
                    const toolName = toolData.tool
                    const filePath = toolData.path || toolData.file_path

                    if (["appliedDiff", "editedExistingFile", "newFileCreated", "insertContent", "searchAndReplace", "deleteFile"].includes(toolName)) {
                        if (!toolData.id || !undoneToolIds.includes(toolData.id)) return
                        if (!filePath) return

                        const existing = changes.get(filePath)
                        if (existing) {
                            changes.set(filePath, {
                                path: filePath,
                                toolIds: toolData.id ? [...existing.toolIds, toolData.id] : existing.toolIds,
                            })
                        } else {
                            changes.set(filePath, {
                                path: filePath,
                                toolIds: toolData.id ? [toolData.id] : [],
                            })
                        }
                    }
                } catch (_e) {
                    // Ignore parse errors
                }
            }
        })
        return Array.from(changes.values())
    }, [clineMessages, undoneToolIds])

    const totalAdditions = fileChanges.reduce((sum, f) => sum + f.additions, 0)
    const totalDeletions = fileChanges.reduce((sum, f) => sum + f.deletions, 0)

    const handleUndoAll = () => {
        const allToolIds = fileChanges.flatMap((f) => f.toolIds)
        if (allToolIds.length > 0) {
            vscode.postMessage({
                type: "command",
                command: "claudix.undoEdits",
                args: [allToolIds],
            })
            showNotification(`Undid edits for ${fileChanges.length} file(s)`)

            // Update workspace state to persist the undone IDs
            const newUndoneIds = Array.from(new Set([...undoneToolIds, ...allToolIds]))
            vscode.postMessage({
                type: "request",
                requestId: Date.now().toString(),
                request: {
                    type: "updateWorkspaceState",
                    key: "claudix.undoneToolIds",
                    value: newUndoneIds,
                },
            } as any)
        }
    }

    const handleAcceptAll = () => {
        const allToolIds = fileChanges.flatMap((f) => f.toolIds)
        if (allToolIds.length > 0) {
            // Update workspace state to persist the accepted IDs
            const newAcceptedIds = Array.from(new Set([...acceptedToolIds, ...allToolIds]))
            vscode.postMessage({
                type: "request",
                requestId: Date.now().toString(),
                request: {
                    type: "updateWorkspaceState",
                    key: "claudix.acceptedToolIds",
                    value: newAcceptedIds,
                },
            } as any)
            setIsExpanded(false)
        }
    }

    const handleRedoAll = () => {
        const allToolIds = undoneChanges.flatMap((f) => f.toolIds)
        if (allToolIds.length > 0) {
            vscode.postMessage({
                type: "command",
                command: "claudix.redoEdits",
                args: [allToolIds],
            })
            showNotification(`Redid edits for ${undoneChanges.length} file(s)`)

            const newUndoneIds = undoneToolIds.filter(id => !allToolIds.includes(id))
            vscode.postMessage({
                type: "request",
                requestId: Date.now().toString(),
                request: {
                    type: "updateWorkspaceState",
                    key: "claudix.undoneToolIds",
                    value: newUndoneIds,
                },
            } as any)
        }
    }

    const handleUndoFile = (toolIds: string[], path: string) => {
        vscode.postMessage({
            type: "command",
            command: "claudix.undoEdits",
            args: [toolIds],
        })
        showNotification(`Undid edits for ${path.split(/[\\/]/).pop()}`)

        const newUndoneIds = Array.from(new Set([...undoneToolIds, ...toolIds]))
        vscode.postMessage({
            type: "request",
            requestId: Date.now().toString(),
            request: {
                type: "updateWorkspaceState",
                key: "claudix.undoneToolIds",
                value: newUndoneIds,
            },
        } as any)
    }

    const handleOpenFile = (path: string) => {
        vscode.postMessage({ type: "openFile", text: path })
    }

    return (
        <>
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <filter id="smoke-effect">
                    <feTurbulence 
                        type="fractalNoise" 
                        baseFrequency="0.01" 
                        numOctaves="1" 
                        result="turbulence"
                        seed="2"
                    />
                    <feDisplacementMap 
                        in2="turbulence" 
                        in="SourceGraphic" 
                        scale="0"
                        xChannelSelector="R" 
                        yChannelSelector="G"
                    >
                        <animate 
                            attributeName="scale" 
                            dur="0.15s" 
                            values="0;5;10" 
                            fill="freeze"
                        />
                    </feDisplacementMap>
                    <feGaussianBlur stdDeviation="0">
                        <animate 
                            attributeName="stdDeviation" 
                            dur="0.15s" 
                            values="0;1;2" 
                            fill="freeze"
                        />
                    </feGaussianBlur>
                </filter>
            </svg>
            <AnimatePresence>
                {fileChanges.length > 0 && (
                    <motion.div
                        key="edit-history-tracker"
                        initial={{ opacity: 0, height: 0, scale: 0.9, marginBottom: -18 }}
                        animate={{ opacity: 1, height: "auto", scale: 1, marginBottom: -18 }}
                        exit={{ 
                            opacity: 0,
                            scale: 1,
                            filter: "url(#smoke-effect)",
                            height: 0,
                            marginBottom: 0,
                            marginTop: 0,
                            overflow: 'hidden'
                        }}
                        transition={{ 
                            duration: 0.1,
                            ease: "easeOut"
                        }}
                        style={{ position: 'relative', zIndex: 10, transformOrigin: 'center' }}
                    >
                        <TrackerContainer>
                        <TrackerHeader $isExpanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)}>
                <FilesCount>
                    <span className="count-text">
                        {fileChanges.length} {fileChanges.length === 1 ? "file" : "files"}
                    </span>
                    <StatsSummary>
                        {totalAdditions > 0 && <Stat $type="add">+{totalAdditions}</Stat>}
                        {totalDeletions > 0 && <Stat $type="remove">-{totalDeletions}</Stat>}
                    </StatsSummary>
                    <div className="chevron">
                        <ChevronDown size={14} style={{ transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)" }} />
                    </div>
                </FilesCount>

                <Actions onClick={(e) => e.stopPropagation()}>
                    <AnimatePresence>
                        {notification && (
                            <NotificationBubble
                                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                            >
                                <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                                {notification}
                            </NotificationBubble>
                        )}
                    </AnimatePresence>
                    {undoneChanges.length > 0 && (
                        <ActionButton $variant="secondary" onClick={handleRedoAll}>
                            Redo
                        </ActionButton>
                    )}
                    <ActionButton $variant="secondary" onClick={handleUndoAll}>
                        Reject all
                    </ActionButton>
                    <ActionButton $variant="primary" onClick={handleAcceptAll}>
                        Accept all
                    </ActionButton>
                </Actions>
            </TrackerHeader>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        <FilesList>
                            {fileChanges.map((file) => (
                                <FileItem key={file.path}>
                                    <FileNameSection>
                                        <FileIcon fileName={file.path} size={14} />
                                        <FileName title={file.path} onClick={() => handleOpenFile(file.path)}>
                                            {file.path.split(/[\\/]/).pop()}
                                        </FileName>
                                    </FileNameSection>

                                    <FileStats>
                                        {file.additions > 0 && <Stat $type="add">+{file.additions}</Stat>}
                                        {file.deletions > 0 && <Stat $type="remove">-{file.deletions}</Stat>}

                                        <DiffMeter title={`${file.additions} additions, ${file.deletions} deletions`}>
                                            {(() => {
                                                const total = file.additions + file.deletions;
                                                if (total === 0) return null;
                                                const addP = (file.additions / total) * 100;
                                                const delP = (file.deletions / total) * 100;
                                                return (
                                                    <>
                                                        <AdditionBar $percent={addP} />
                                                        <DeletionBar $percent={delP} />
                                                    </>
                                                );
                                            })()}
                                        </DiffMeter>

                                        <UndoIcon title="Undo changes for this file" onClick={() => handleUndoFile(file.toolIds, file.path)}>
                                            <RotateCcw size={14} />
                                        </UndoIcon>
                                    </FileStats>
                                </FileItem>
                            ))}
                        </FilesList>
                    </motion.div>
                )}
            </AnimatePresence>
        </TrackerContainer>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    )
}
