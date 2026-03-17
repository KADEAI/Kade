import React, { useMemo, useState, useEffect, useRef } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { AnimatedAccordion } from '../../common/AnimatedAccordion';
import { FileIcon } from './FileIcon';
import { vscode } from '@/utils/vscode';

interface FastContextToolProps {
    tool: any;
    toolResult?: any;
    isLastMessage?: boolean;
    shouldAnimate?: boolean;
}

interface FastContextOperation {
    type: 'grep' | 'read';
    label: string;
    path: string;
    status: 'running' | 'done' | 'error';
    durationMs?: number;
    resultCount?: number;
}

interface FastContextState {
    query: string;
    thinking: string;
    operations: FastContextOperation[];
    results: Array<{
        file: string;
        startLine: number;
        endLine: number;
        content: string;
        score: number;
    }>;
    status: 'running' | 'done';
}

const Container = styled.div`
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    margin: 4px 0;
    position: relative;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.03);

    &::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(165deg, rgba(37, 37, 37, 0.95) 0%, rgba(49, 49, 49, 0.7) 100%);
        backdrop-filter: blur(12px) saturate(180%);
        z-index: -1;
    }
`;

const Header = styled.div<{ $clickable: boolean }>`
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 13px;
    height: 36px;
    cursor: ${props => props.$clickable ? 'pointer' : 'default'};
    user-select: none;
    overflow: hidden;

    ${props => props.$clickable && css`
        &:hover {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.0) 0%, rgba(255, 255, 255, 0.02) 100%);
        }
    `}
`;

const shimmer = keyframes`
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
`;

const _slideIn = keyframes`
    from {
        opacity: 0;
        transform: translateX(-6px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
`;

const AnimatedRow = styled.div<{ $delay: number }>`
    /* animation removed — instant display prevents flash */
`;

const QueryLabel = styled.span<{ $isRunning: boolean }>`
    font-size: 13px;
    font-weight: 400;
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;

    ${props => props.$isRunning && css`
        background: linear-gradient(
            120deg,
            var(--vscode-descriptionForeground) 40%,
            var(--vscode-textLink-foreground) 50%,
            var(--vscode-descriptionForeground) 60%
        );
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: ${shimmer} 3s linear infinite;
    `}
`;

const QueryPreview = styled.span`
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
`;

const ScrollBody = styled.div.attrs({ className: "anchored-container" })`
    max-height: 120px;
    overflow-y: auto;
    padding: 2px 12px 6px;

    &::-webkit-scrollbar { width: 6px; }
    &::-webkit-scrollbar-track { background: transparent; }
    &::-webkit-scrollbar-thumb {
        background-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 50%, transparent);
        border-radius: 3px;
    }
`;

const OperationRow = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 0;
    font-size: 11.5px;
    line-height: 1.3;
    font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
`;

const OperationLabel = styled.span`
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
`;

const TimingBadge = styled.span`
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
    font-size: 10.5px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
`;

const ResultItem = styled.div`
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 1px 4px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11.5px;

    &:hover {
        background-color: var(--vscode-list-hoverBackground);
    }
`;

const StatusIcon: React.FC<{ status: 'running' | 'done' | 'error' }> = ({ status }) => {
    if (status === 'running') {
        return (
            <span
                className="codicon codicon-loading codicon-modifier-spin"
                style={{ fontSize: '11px', opacity: 0.5, flexShrink: 0 }}
            />
        );
    }
    if (status === 'error') {
        return (
            <span
                className="codicon codicon-error"
                style={{ fontSize: '11px', color: 'var(--vscode-testing-iconFailed)', flexShrink: 0 }}
            />
        );
    }
    return (
        <span
            className="codicon codicon-check"
            style={{ fontSize: '11px', color: 'var(--vscode-testing-iconPassed)', opacity: 0.7, flexShrink: 0 }}
        />
    );
};

export const FastContextTool: React.FC<FastContextToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const prevTotalRef = useRef(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const query = useMemo(() => {
        const raw = tool.query || '';
        return raw.startsWith('<') ? raw.replace(/^<+\s*/, '') : raw;
    }, [tool]);

    const state: FastContextState | null = useMemo(() => {
        try {
            const content = tool.content || toolResult?.content;
            if (typeof content === 'string' && content.startsWith('{')) {
                return JSON.parse(content);
            }
        } catch {
            // ignore parse errors
        }
        return null;
    }, [tool, toolResult]);

    const isRunning = useMemo(() => {
        if (!state) return !toolResult && isLastMessage;
        return state.status === 'running';
    }, [state, toolResult, isLastMessage]);

    const operations = state?.operations || [];
    const results = state?.results || [];
    const hasResults = results.length > 0;
    const hasContent = operations.length > 0 || hasResults;

    // Staggered reveal: when new items arrive, reveal them one by one
    const totalItems = operations.length + (hasResults && !isRunning ? results.length : 0);

    // Initialize visibleCount to totalItems to prevent re-animation on mount (e.g. scrolling back)
    // New items arriving after mount will still trigger the effect below and animate
    const [visibleCount, setVisibleCount] = useState(() => totalItems);
    useEffect(() => {
        if (totalItems <= prevTotalRef.current && totalItems <= visibleCount) {
            return;
        }
        // If items jumped (e.g. results appeared all at once), stagger them in
        if (totalItems > visibleCount) {
            let current = visibleCount;
            const interval = setInterval(() => {
                current++;
                setVisibleCount(current);
                window.dispatchEvent(new CustomEvent("tool-animate-height"));
                if (current >= totalItems) {
                    clearInterval(interval);
                }
            }, 60);
            prevTotalRef.current = totalItems;
            return () => clearInterval(interval);
        }
        prevTotalRef.current = totalItems;
    }, [totalItems, visibleCount]);

    // Auto-scroll to bottom while streaming/animating
    useEffect(() => {
        if (scrollRef.current && isExpanded) {
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            });
        }
    }, [visibleCount, isRunning, isExpanded]);

    const handleFileClick = (filePath: string, line?: number) => {
        vscode.postMessage({
            type: 'openFile',
            text: filePath,
            values: line ? { line } : undefined,
        });
    };

    const formatDuration = (ms?: number) => {
        if (ms === undefined) return '';
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const formatOperationLabel = (op: FastContextOperation) => {
        if (op.type === 'grep') {
            const pathParts = op.path.split(/[\\/]/);
            const shortPath = pathParts.length > 2
                ? pathParts.slice(-2).join('/')
                : pathParts.join('/');
            return `Grepped ${op.label} in ${shortPath}`;
        }
        return `Read ${op.label}`;
    };

    return (
        <Container className={shouldAnimate ? 'animate-tool-entry' : ''}>
            <Header
                $clickable={hasContent}
                onClick={() => hasContent && setIsExpanded(!isExpanded)}
            >
                {/* Search icon */}
                <span
                    className="codicon codicon-search"
                    style={{ fontSize: '14px', opacity: 0.7, flexShrink: 0 }}
                />

                {/* Title */}
                <QueryLabel $isRunning={!!isRunning}>
                    Fast Context
                </QueryLabel>

                {/* Query preview */}
                <QueryPreview title={query}>
                    {query.length > 30 ? query.slice(0, 30) + '...' : query}
                </QueryPreview>

                {/* Chevron */}
                {hasContent && (
                    <span
                        className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}
                        style={{ fontSize: '12px', opacity: 0.5, flexShrink: 0 }}
                    />
                )}
            </Header>

            <AnimatedAccordion isExpanded={isExpanded}>
                <ScrollBody ref={scrollRef}>
                    {/* Operations list */}
                    {operations.map((op, index) => {
                        if (index >= visibleCount) return null;
                        return (
                            <AnimatedRow key={index} $delay={0}>
                                <OperationRow>
                                    <StatusIcon status={op.status} />
                                    <OperationLabel title={formatOperationLabel(op)}>
                                        {formatOperationLabel(op)}
                                    </OperationLabel>
                                    {op.durationMs !== undefined && (
                                        <TimingBadge>{formatDuration(op.durationMs)}</TimingBadge>
                                    )}
                                </OperationRow>
                            </AnimatedRow>
                        );
                    })}

                    {/* Results inline after operations */}
                    {hasResults && !isRunning && results.map((result, index) => {
                        const globalIndex = operations.length + index;
                        if (globalIndex >= visibleCount) return null;
                        const filename = result.file.split(/[\\/]/).pop() || result.file;
                        return (
                            <AnimatedRow key={`r-${index}`} $delay={0}>
                                <ResultItem
                                    onClick={() => handleFileClick(result.file, result.startLine)}
                                >
                                    <FileIcon fileName={result.file} size={14} />
                                    <span style={{ color: 'var(--vscode-editor-foreground)', opacity: 0.9 }}>
                                        {filename}
                                    </span>
                                    <span style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.5, fontSize: '10.5px', fontFamily: 'var(--vscode-editor-font-family)' }}>
                                        :{result.startLine}-{result.endLine}
                                    </span>
                                </ResultItem>
                            </AnimatedRow>
                        );
                    })}
                </ScrollBody>
            </AnimatedAccordion>
        </Container>
    );
};
