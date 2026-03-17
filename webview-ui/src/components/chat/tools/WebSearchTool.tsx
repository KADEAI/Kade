import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { ToolError } from './ToolError';
import { ToolHeader } from './ToolHeader';

interface WebSearchToolProps {
    tool: any;
    toolResult?: any;
    isLastMessage?: boolean;
    shouldAnimate?: boolean;
}

import { AnimatedAccordion } from '../../common/AnimatedAccordion';

const ResultLink = styled.a`
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    font-weight: 500;
    &:hover {
        text-decoration: underline;
    }
`;

const CollapsibleContent = styled.div`
    overflow: hidden;
    min-height: 0;
`;

const ScrollableResults = styled.div`
    max-height: 250px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
    
    &::-webkit-scrollbar {
        width: 8px;
        height: 8px;
    }
    &::-webkit-scrollbar-track {
        background: transparent;
    }
    &::-webkit-scrollbar-thumb {
        background-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 50%, transparent);
        border-radius: 4px;
        border: 2px solid transparent;
        background-clip: content-box;
    }
    &::-webkit-scrollbar-thumb:hover {
        background-color: var(--vscode-scrollbarSlider-hoverBackground);
    }
`;

export const WebSearchTool: React.FC<WebSearchToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const query = useMemo(() => tool.query || tool.params?.query || "", [tool]);
    const allowedDomains = useMemo(() => tool.allowed_domains || tool.params?.allowed_domains || [], [tool]);
    const blockedDomains = useMemo(() => tool.blocked_domains || tool.params?.blocked_domains || [], [tool]);

    const results = useMemo(() => {
        if (!toolResult?.content) return [];
        const content = typeof toolResult.content === 'string'
            ? toolResult.content
            : Array.isArray(toolResult.content)
                ? (toolResult.content.map((c: any) => c.text).join(''))
                : '';

        if (!content) return [];

        try {
            const parsed = JSON.parse(content);
            if (parsed.results && Array.isArray(parsed.results)) {
                return parsed.results;
            }
        } catch { }

        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                if (parsed.results && Array.isArray(parsed.results)) {
                    return parsed.results;
                }
            } catch { }
        }

        const resultsArr: any[] = [];
        let currentResult: any = null;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Handle bulleted format: - title: "..."
            const titleMatch = line.match(/^-\s+title:\s*"(.*)"$/i) || line.match(/^\d+\.\s+(.+)$/);
            if (titleMatch) {
                if (currentResult && currentResult.title) resultsArr.push(currentResult);
                currentResult = { title: titleMatch[1].trim(), url: '', description: '' };
                continue;
            }

            if (currentResult) {
                if (line.startsWith('url:')) {
                    currentResult.url = line.replace(/^url:\s*"/i, '').replace(/"$/, '').trim();
                } else if (line.startsWith('description:')) {
                    currentResult.description = line.replace(/^description:\s*"/i, '').replace(/"$/, '').trim();
                } else if (line.startsWith('URL:')) {
                    currentResult.url = line.replace('URL:', '').trim();
                } else if (line.startsWith('Summary:')) {
                    currentResult.description = line.replace('Summary:', '').trim();
                }
            }
        }
        if (currentResult && currentResult.title) resultsArr.push(currentResult);
        
        if (resultsArr.length > 0) return resultsArr;
        return [];
    }, [toolResult]);

    const hasResults = results.length > 0;
    const content = toolResult?.content; // Check for any content presence

    // Permission/Loading Logic
    const isPermissionRequest = !content && isLastMessage;
    const status = toolResult?.is_error ? 'error' : isPermissionRequest ? 'running' : 'complete';

    const actionVerb = useMemo(() => {
        return isPermissionRequest ? "Searching" : "Searched";
    }, [isPermissionRequest]);

    const canToggle = hasResults || toolResult?.is_error || (!!content && !isPermissionRequest);

    const toggleExpand = () => {
        if (canToggle) {
            setIsExpanded(!isExpanded);
        }
    };

    const getFaviconUrl = (url: string) => {
        try {
            let urlStr = url;
            if (!urlStr.startsWith('http')) {
                urlStr = 'https://' + urlStr;
            }
            const domain = new URL(urlStr).hostname;
            return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
        } catch {
            return '';
        }
    };

    const uniqueDomains = useMemo(() => {
        if (!results.length) return [];
        const domains = new Set<string>();
        const list: string[] = [];

        for (const result of results) {
            try {
                let urlStr = result.url;
                if (!urlStr.startsWith('http')) urlStr = 'https://' + urlStr;
                const hostname = new URL(urlStr).hostname;
                if (!domains.has(hostname)) {
                    domains.add(hostname);
                    list.push(hostname);
                    if (list.length >= 5) break;
                }
            } catch { }
        }
        return list;
    }, [results]);

    return (
        <div className={shouldAnimate ? "animate-tool-entry" : ""}>
            <ToolHeader
                toolName="web_search"
                actionVerb={actionVerb}
                isPermissionRequest={isPermissionRequest}
                isError={toolResult?.is_error}
                status={status}
                isExpanded={isExpanded}
                onToggle={canToggle ? toggleExpand : undefined}
                details={
                    <span className="text-vscode-descriptionForeground opacity-75 truncate antialiased">
                        "{query}"
                    </span>
                }
                extra={
                    !isPermissionRequest && uniqueDomains.length > 0 && (
                        <div className="flex items-center gap-1 ml-1 opacity-60">
                            {uniqueDomains.map(domain => (
                                <img
                                    key={domain}
                                    src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
                                    alt={domain}
                                    title={domain}
                                    className="w-3.5 h-3.5 rounded-sm"
                                    onError={(e) => e.currentTarget.style.display = 'none'}
                                />
                            ))}
                        </div>
                    )
                }
            />

            <AnimatedAccordion isExpanded={isExpanded}>
                <div className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]" style={{ fontFamily: 'var(--font-sans, var(--vscode-font-family))' }}>
                    <ScrollableResults className="flex flex-col gap-3">
                        {allowedDomains.length > 0 && (
                            <div className="text-xs text-vscode-descriptionForeground">
                                Allowed: {allowedDomains.join(', ')}
                            </div>
                        )}
                        {blockedDomains.length > 0 && (
                            <div className="text-xs text-vscode-inputValidation-errorForeground">
                                Blocked: {blockedDomains.join(', ')}
                            </div>
                        )}

                        {results.map((result: any, i: number) => (
                            <div key={i} className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    {/* Favicon in Result List */}
                                    {getFaviconUrl(result.url) && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={getFaviconUrl(result.url)}
                                            alt=""
                                            className="w-3.5 h-3.5 rounded-sm"
                                            onError={(e) => e.currentTarget.style.display = 'none'}
                                        />
                                    )}
                                    <ResultLink href={result.url} target="_blank" className="text-xs truncate block">
                                        {result.title}
                                    </ResultLink>
                                </div>
                                <div className="text-[11px] opacity-60 truncate ml-5.5">{result.url}</div>
                                {result.description && (
                                    <div className="text-[11px] opacity-80 line-clamp-2 ml-5.5">
                                        {result.description}
                                    </div>
                                )}
                            </div>
                        ))}

                        {results.length === 0 && !isPermissionRequest && content && (
                            <div className="text-xs opacity-60 italic">No results found.</div>
                        )}

                        {toolResult?.is_error && <ToolError toolResult={toolResult} />}
                    </ScrollableResults>
                </div>
            </AnimatedAccordion>
        </div>
    );
};
