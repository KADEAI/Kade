import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { vscode } from '@/utils/vscode';
import { ToolError } from './ToolError';
import { FileIcon } from './FileIcon';
import { ToolHeader } from './ToolHeader';
import { useArtificialDelay } from './useArtificialDelay';

interface GrepToolProps {
    tool: any;
    toolResult?: any;
    isLastMessage?: boolean;
    shouldAnimate?: boolean;
}

import { AnimatedAccordion } from '../../common/AnimatedAccordion';

const ResultsList = styled.div`
    display: flex;
    flex-direction: column;
    width: 100%;
`;


const NoResults = styled.div`
    padding: 4px 8px;
    opacity: 0.6;
    font-style: italic;
    font-size: 11px;
`;

export const GrepTool: React.FC<GrepToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Search Params
    const pattern = useMemo(() => tool.regex || tool.pattern || '', [tool]);
    const cleanPath = (p: string) => {
        if (!p) return '';
        // Remove surrounding brackets if they wrap the entire path (e.g. "[lines.txt]")
        // logic: starts with [, ends with ], and doesn't look like a standard nextjs dynamic route (which usually ends in file extension)
        // actually, simpler heuristic: if it starts with [ and ends with ], strip them. 
        // We'll trust that files named exactly "[something]" are rare enough compared to the bug.
        if (p.startsWith('[') && p.endsWith(']')) {
            return p.slice(1, -1);
        }
        return p;
    };
    const searchPath = useMemo(() => cleanPath(tool.path || ''), [tool]);

    const detailsLabel = useMemo(() => {
        const normalizedPattern = pattern.trim();
        const normalizedPath = searchPath.trim();
        if (normalizedPattern && normalizedPath) {
            return `"${normalizedPattern}" in ${normalizedPath}`;
        }
        if (normalizedPattern) {
            return `"${normalizedPattern}"`;
        }
        if (normalizedPath) {
            return normalizedPath;
        }
        return '';
    }, [pattern, searchPath]);

    const content = useMemo(() => {
        return typeof toolResult?.content === 'string'
            ? toolResult.content
            : Array.isArray(toolResult?.content)
                ? (toolResult.content[0]?.text || '')
                : '';
    }, [toolResult]);

    const resultFiles = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n').filter((line: string) => line.trim());

        // State for tracking "current" file in a grouped list
        let currentFilePath = searchPath;

        return lines.map((line: string) => {
            const trimmed = line.trim();

            // 1. Try to match standard path:line:content (fallback)
            const fullMatch = trimmed.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):?(.*)$/);
            if (fullMatch) {
                currentFilePath = cleanPath(fullMatch[1]);
                return {
                    path: currentFilePath,
                    startLine: parseInt(fullMatch[2]),
                    label: fullMatch[3] || line,
                    fullLine: line
                };
            }

            // 2. Try to match line headers in grouped output (e.g., "  10: content")
            const lineMatch = trimmed.match(/^(\d+):?(.*)$/);
            if (lineMatch) {
                return {
                    path: currentFilePath,
                    startLine: parseInt(lineMatch[1]),
                    label: lineMatch[2] || line,
                    fullLine: line
                };
            }

            // 3. Otherwise, treat it as a new file header
            // Strip markdown header (##) and line count (|L###) from file paths
            let headerPath = trimmed;
            if (headerPath.startsWith('##')) {
                headerPath = headerPath.slice(2).trim();
            }
            if (headerPath.includes('|L')) {
                headerPath = headerPath.split('|L')[0].trim();
            }
            currentFilePath = cleanPath(headerPath);
            return {
                path: currentFilePath,
                label: line,
                fullLine: line,
                isHeader: true
            };
        }).filter((item: any) => !item.isHeader); // Hide headers from the result list as they're now handled statefully
    }, [content, searchPath]);

    const fileCount = resultFiles.length;
    const hasResults = fileCount > 0;
    const isRunning = !!(!content && isLastMessage && !toolResult?.is_error);
    const showLoading = useArtificialDelay(isRunning);
    const status = toolResult?.is_error ? 'error' : showLoading ? 'running' : 'complete';

    const actionVerb = useMemo(() => {
        return showLoading ? "Searching" : "Searched";
    }, [showLoading]);

    const toggleExpand = () => {
        if (content || toolResult?.is_error) {
            setIsExpanded(!isExpanded);
        }
    };

    const handleFileClick = (path: string, line?: number) => {
        vscode.postMessage({
            type: "openFile",
            text: path,
            values: {
                line: line
            }
        });
    };

    const canToggle = !!content || !!toolResult?.is_error;

    return (
        <div className={shouldAnimate ? "animate-tool-entry" : ""}>
            <ToolHeader
                toolName="grep"
                actionVerb={actionVerb}
                isPermissionRequest={showLoading}
                isError={toolResult?.is_error}
                status={status}
                isExpanded={isExpanded}
                onToggle={canToggle ? toggleExpand : undefined}
                details={detailsLabel}
                extra={
                    hasResults && (
                        <span className="text-vscode-descriptionForeground opacity-50 antialiased text-[11px]">
                            ({fileCount})
                        </span>
                    )
                }
            />

            <AnimatedAccordion isExpanded={isExpanded}>
                <div className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]" style={{ fontFamily: 'var(--font-sans, var(--vscode-font-family))' }}>
                    {searchPath && (
                        <div className="flex items-center gap-1.5 mb-0.5 opacity-80 text-[11px] px-1">
                            <span className="italic opacity-70">in</span>
                            <FileIcon fileName={searchPath} isDirectory size={16} />
                            <span className="text-vscode-editor-foreground font-medium truncate" title={searchPath}>
                                {searchPath}
                            </span>
                        </div>
                    )}

                    {/* Results header removed for clean look */}

                    {hasResults ? (
                        <ResultsList>
                            <div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                                {resultFiles.map((item: any, index: number) => {
                                    const filename = item.path.split(/[/\\]/).pop();

                                    return (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline font-mono"
                                            style={{ fontSize: '11px', fontFamily: 'var(--vscode-editor-font-family), "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", monospace' }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleFileClick(item.path, item.startLine);
                                            }}
                                        >
                                            <div className="flex items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
                                                <FileIcon fileName={item.path} size={16} />
                                                <span style={{ color: 'var(--vscode-editor-foreground)' }}>{filename}</span>
                                            </div>

                                            {item.startLine && (
                                                <span className="text-vscode-descriptionForeground opacity-60 font-mono text-[11px] whitespace-nowrap">
                                                    :{item.startLine}
                                                </span>
                                            )}

                                            <span className="text-vscode-descriptionForeground opacity-80 whitespace-pre ml-1 truncate">
                                                {item.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </ResultsList>
                    ) : !showLoading && !toolResult?.is_error ? (
                        <NoResults>No matching results found.</NoResults>
                    ) : null}

                    {toolResult?.is_error && (
                        <ToolError toolResult={toolResult} />
                    )}
                </div>
            </AnimatedAccordion>
        </div>
    );
};
