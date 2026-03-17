import React, { useMemo } from 'react';
import styled from 'styled-components';
import { extractToolErrorText, getToolErrorSummary } from './toolErrorUtils';

interface ToolErrorProps {
    toolResult?: any;
}

const ErrorContent = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-errorForeground);
    font-size: 13px;
    padding: 4px 0;
    font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif;

    .codicon {
        color: var(--vscode-errorForeground);
        flex-shrink: 0;
        font-size: 12px;
        opacity: 0.8;
    }

    .error-label {
        font-weight: normal;
        opacity: 0.8;
        antialiased: true;
    }

    .error-text {
        word-break: break-word;
        line-height: normal;
        opacity: 0.5;
        cursor: default;
        &:hover {
            opacity: 1;
            color: var(--vscode-textLink-foreground);
        }
    }
`;

export const ToolError: React.FC<ToolErrorProps> = ({ toolResult }) => {
    const errorContent = useMemo(() => {
        if (!toolResult || !toolResult.is_error) {
            return null;
        }

        return getToolErrorSummary(toolResult, 110);
    }, [toolResult]);

    const fullError = useMemo(() => extractToolErrorText(toolResult), [toolResult]);

    if (!errorContent) return null;

    return (
        <div className="flex items-center" style={{ margin: '2px 0' }}>
            <ErrorContent>
                <span className="codicon codicon-error"></span>
                <span className="error-label">Error</span>
                <span className="error-text truncate antialiased" title={fullError || errorContent}>
                    {errorContent}
                </span>
            </ErrorContent>
        </div>
    );
};
