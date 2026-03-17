import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import ReactMarkdown from 'react-markdown';
import { ToolError } from './ToolError';
import { ToolHeader } from './ToolHeader';
import { AnimatedAccordion } from '../../common/AnimatedAccordion';

interface ResearchWebToolProps {
    tool: any;
    toolResult?: any;
    isLastMessage?: boolean;
    shouldAnimate?: boolean;
}

const MarkdownContainer = styled.div`
    font-size: 12px;
    opacity: 0.9;
    
    h1, h2, h3 { margin-top: 8px; font-weight: 600; }
    p { margin-bottom: 6px; }
    ul { padding-left: 16px; }
    strong, b { font-weight: bold; }
    em, i { font-style: italic; }
`;

export const ResearchWebTool: React.FC<ResearchWebToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const query = useMemo(() => tool.query || tool.params?.query || "", [tool]);

    const report = useMemo(() => {
        const result = toolResult || tool;
        if (!result?.content) return null;
        return typeof result.content === 'string'
            ? result.content
            : Array.isArray(result.content)
                ? result.content.map((c: any) => c.text).join('')
                : '';
    }, [toolResult, tool]);

    // Permission/Loading
    const isPermissionRequest = !report && isLastMessage;
    const status = toolResult?.is_error ? 'error' : isPermissionRequest ? 'running' : 'complete';

    const actionVerb = useMemo(() => {
        return isPermissionRequest ? "Web Researching" : "Web Researched";
    }, [isPermissionRequest]);

    const getFaviconUrl = (domain: string) => {
        return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    };

    const uniqueDomains = useMemo(() => {
        if (!report) return [];
        const regex = /https?:\/\/(?:www\.)?([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})\b/g;
        const matches = [...report.matchAll(regex)];
        const domains = matches.map(m => m[1]);
        return [...new Set(domains)].slice(0, 5);
    }, [report]);

    const canToggle = !!report || !!toolResult?.is_error;

    const toggleExpand = () => {
        if (canToggle) {
            setIsExpanded(!isExpanded);
        }
    };

    return (
        <div className={shouldAnimate ? "animate-tool-entry" : ""}>
            <ToolHeader
                toolName="research_web" // or web_search? keeping descriptive
                actionVerb={actionVerb}
                isPermissionRequest={isPermissionRequest}
                isError={toolResult?.is_error}
                status={status}
                isExpanded={isExpanded}
                onToggle={canToggle ? toggleExpand : undefined}
                details={
                    <span className="text-vscode-descriptionForeground opacity-50 truncate antialiased" title={query}>
                        "{query}"
                    </span>
                }
                extra={
                    !isPermissionRequest && uniqueDomains.length > 0 && (
                        <div className="flex items-center gap-1 ml-1">
                            {uniqueDomains.map((domain, i) => (
                                <img
                                    key={i}
                                    src={getFaviconUrl(domain)}
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

            {/* Content */}
            <AnimatedAccordion isExpanded={isExpanded}>
                <div className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]" style={{ fontFamily: 'var(--font-sans, var(--vscode-font-family))' }}>
                    {report && (
                        <div className="max-h-[300px] overflow-y-auto pr-2">
                            <MarkdownContainer>
                                <ReactMarkdown>{report}</ReactMarkdown>
                            </MarkdownContainer>
                        </div>
                    )}
                    {toolResult?.is_error && <ToolError toolResult={toolResult} />}
                </div>
            </AnimatedAccordion>
        </div>
    );
};
