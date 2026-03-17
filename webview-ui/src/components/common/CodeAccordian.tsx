import { memo, useMemo } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { type ToolProgressStatus } from "@roo-code/types"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"

import { ToolUseBlock, ToolUseBlockHeader } from "./ToolUseBlock"
import CodeBlock from "../kilocode/common/CodeBlock" // kilocode_change
import { PathTooltip } from "../ui/PathTooltip"
import DiffView from "./DiffView"
import { cn } from "@/lib/utils"

interface CodeAccordianProps {
    path?: string
    code?: string
    language: string
    progressStatus?: ToolProgressStatus
    isLoading?: boolean
    isExpanded: boolean
    isFeedback?: boolean
    onToggleExpand: () => void
    header?: string
    onJumpToFile?: () => void
    // New props for diff stats
    diffStats?: { added: number; removed: number }
}

const CodeAccordian = ({
    path,
    code = "",
    language,
    progressStatus,
    isLoading,
    isExpanded,
    isFeedback,
    onToggleExpand,
    header,
    onJumpToFile,
    diffStats,
}: CodeAccordianProps) => {
    const inferredLanguage = useMemo(() => language ?? (path ? getLanguageFromPath(path) : "txt"), [path, language])
    const source = useMemo(() => String(code).trim() /*kilocode_change: coerce to string*/, [code])
    const hasHeader = Boolean(path || isFeedback || header)

    // Calculate stats from code if not provided (fallback)
    const derivedStats = useMemo(() => {
        if (diffStats && (diffStats.added > 0 || diffStats.removed > 0)) return diffStats

        if (inferredLanguage === "diff" && code) {
            const lines = code.split('\n')
            let added = 0
            let removed = 0
            for (const line of lines) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    added++
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    removed++
                }
            }
            if (added > 0 || removed > 0) return { added, removed }
        }

        return null
    }, [diffStats, code, inferredLanguage])

    const hasValidStats = Boolean(derivedStats && (derivedStats.added > 0 || derivedStats.removed > 0))

    return (
        <ToolUseBlock>
            {hasHeader && (
                <ToolUseBlockHeader onClick={onToggleExpand} className="group">
                    {isLoading && <VSCodeProgressRing className="size-3 mr-2" />}
                    {header ? (
                        <div className="flex items-center">
                            <span className="codicon codicon-server mr-1.5"></span>
                            <PathTooltip content={header}>
                                <span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2">{header}</span>
                            </PathTooltip>
                        </div>
                    ) : isFeedback ? (
                        <div className="flex items-center">
                            <span className={`codicon codicon-${isFeedback ? "feedback" : "codicon-output"} mr-1.5`} />
                            <span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl">
                                {isFeedback ? "User Edits" : "Console Logs"}
                            </span>
                        </div>
                    ) : (
                        <>
                            {path?.startsWith(".") && <span>.</span>}
                            <PathTooltip content={formatPathTooltip(path)}>
                                <span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
                                    {formatPathTooltip(path)}
                                </span>
                            </PathTooltip>
                        </>
                    )}
                    <div className="flex-grow-1" />
                    {/* Prefer diff stats over generic progress indicator if available */}
                    {hasValidStats ? (
                        <div className="flex items-center gap-2 mr-2">
                            <span className="text-xs font-medium text-vscode-charts-green bg-vscode-charts-green/20 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                +{derivedStats!.added}
                            </span>
                            <span className="text-xs font-medium text-vscode-charts-red bg-vscode-charts-red/20 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                -{derivedStats!.removed}
                            </span>
                        </div>
                    ) : (
                        progressStatus &&
                        progressStatus.text && (
                            <>
                                {progressStatus.icon && (
                                    <span className={`codicon codicon-${progressStatus.icon} mr-1`} />
                                )}
                                <span className="mr-1 ml-auto text-vscode-descriptionForeground">
                                    {progressStatus.text}
                                </span>
                            </>
                        )
                    )}
                    {onJumpToFile && path && (
                        <span
                            className="codicon codicon-link-external mr-1"
                            style={{ fontSize: 13.5 }}
                            onClick={(e) => {
                                e.stopPropagation()
                                onJumpToFile()
                            }}
                            aria-label={`Open file: ${path}`}
                        />
                    )}
                    {!onJumpToFile && (
                        <span
                            className={`opacity-0 group-hover:opacity-100 codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
                    )}
                </ToolUseBlockHeader>
            )}
            <div
                className={cn(
                    "grid transition-all duration-500 ease-in-out",
                    isExpanded || !hasHeader ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}>
                <div className="overflow-hidden">
                    <div className="overflow-x-auto overflow-y-auto max-h-[300px] max-w-full anchored-container">
                        {inferredLanguage === "diff" ? (
                            <DiffView source={source} filePath={path} />
                        ) : (
                            <CodeBlock source={source} language={inferredLanguage} />
                        )}
                    </div>
                </div>
            </div>
        </ToolUseBlock>
    )
}

export default memo(CodeAccordian)
