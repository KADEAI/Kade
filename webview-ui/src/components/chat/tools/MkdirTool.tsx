import React, { useState, useMemo } from 'react';
import styled from 'styled-components';
import { vscode } from '../../../utils/vscode';
import { ToolError } from './ToolError';
import { ToolHeader } from './ToolHeader';
import { FileIcon } from './FileIcon';
import { AnimatedAccordion } from '../../common/AnimatedAccordion';
import { useArtificialDelay } from './useArtificialDelay';

interface MkdirToolProps {
    tool: any
    toolResult?: any
    isLastMessage?: boolean
    shouldAnimate?: boolean
    autoApprovalEnabled?: boolean
}

const DirectoryList = styled.div`
    display: flex;
    flex-direction: column;
    width: 100%;
`;

const DirectoryItem = ({ path }: { path: string }) => {
    const filename = path.split(/[\\/]/).filter(Boolean).pop() || path;
    return (
        <div
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline font-mono"
            onClick={(e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'openFile', text: path });
            }}
            style={{ fontFamily: 'var(--vscode-editor-font-family)', fontSize: 'var(--codex-chat-code-font-size, 13px)' }}
        >
            <div className="flex items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
                <FileIcon fileName={filename} isDirectory size={12} />
                <span style={{ color: 'var(--vscode-editor-foreground)' }}>{filename}</span>
            </div>
        </div>
    );
};

export const MkdirTool: React.FC<MkdirToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate, autoApprovalEnabled }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Content logic
    const { paths, displayPath, hasItems } = useMemo(() => {
        const result = toolResult || tool;
        const pathStr = tool.path || "";
        // backend handles splitting and trimming, but we do it again for robustness
        const relPaths = pathStr.split(",").map((p: string) => p.trim()).filter(Boolean);

        return {
            paths: relPaths,
            displayPath: relPaths[0] || "",
            hasItems: relPaths.length > 0
        };
    }, [tool, toolResult]);

    const isRunning = !!(!toolResult && isLastMessage);
    const showLoading = useArtificialDelay(isRunning);
    const isPermissionRequest = isRunning;

    const actionVerb = useMemo(() => {
        if (showLoading) return "Creating directories";
        const count = paths.length;
        return `Created ${count} ${count === 1 ? 'directory' : 'directories'}`;
    }, [showLoading, paths.length]);

    if (!hasItems && !toolResult?.is_error && !isLastMessage) {
        return null;
    }

    const toggleExpand = () => {
        if (hasItems || toolResult?.is_error) {
            setIsExpanded(!isExpanded);
        }
    };

    const canToggle = hasItems || !!toolResult?.is_error;

    return (
        <div className={shouldAnimate ? "animate-tool-entry" : ""}>
            <ToolHeader
                toolName="mkdir"
                actionVerb={actionVerb}
                isPermissionRequest={showLoading}
                isExpanded={isExpanded}
                onToggle={canToggle ? toggleExpand : undefined}
                details={
                    <span
                        className="text-vscode-descriptionForeground opacity-85 hover:opacity-100 hover:text-vscode-textLink-foreground hover:underline truncate leading-[1] align-baseline cursor-pointer"
                        title={displayPath}
                        onClick={(e) => {
                            e.stopPropagation();
                            vscode.postMessage({ type: 'openFile', text: displayPath });
                        }}
                    >
                        {displayPath}
                    </span>
                }
            />

            <AnimatedAccordion isExpanded={isExpanded}>
                <div
                    className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
                    style={{ fontFamily: 'var(--font-sans, var(--vscode-font-family))' }}>

                    {hasItems ? (
                        <DirectoryList>
                            <div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                                {paths.map((p: string, i: number) => (
                                    <DirectoryItem key={i} path={p} />
                                ))}
                            </div>
                        </DirectoryList>
                    ) : !isPermissionRequest && !toolResult?.is_error ? (
                        <div className="text-vscode-descriptionForeground opacity-60 italic text-xs px-1">
                            No directories created.
                        </div>
                    ) : null}

                    {toolResult?.is_error && <ToolError toolResult={toolResult} />}

                    {!showLoading && toolResult && typeof toolResult.content === 'string' && (
                        <div className="mt-2 text-xs opacity-60 font-mono whitespace-pre-wrap">
                            {toolResult.content}
                        </div>
                    )}
                </div>
            </AnimatedAccordion>
        </div>
    );
};
