import React from 'react';
import styled, { css, keyframes } from 'styled-components';
import { useToolTheme } from '../../../context/ToolThemeContext';

type ToolHeaderStatus = 'running' | 'complete' | 'error';

interface ToolHeaderProps {
    toolName: string; // e.g., 'grep', 'read', 'web_search'
    actionVerb: string;
    details?: React.ReactNode;
    errorText?: string;
    extra?: React.ReactNode;
    isExpanded?: boolean;
    onToggle?: () => void;
    isPermissionRequest?: boolean;
    isError?: boolean;
    hasResults?: boolean;
    status?: ToolHeaderStatus;
    shouldAnimate?: boolean;
}

const headerFadeIn = keyframes`
    0% {
        opacity: 0;
    }
    100% {
        opacity: 1;
    }
`;

const Container = styled.div<{ $shouldAnimate?: boolean }>`
    display: block;
    font-size: 13.5px;
    line-height: normal;
    margin: 5px 0;
    margin-left: -0.14px;
    min-height: 22px;
    ${({ $shouldAnimate }) =>
        $shouldAnimate &&
        css`
            animation: ${headerFadeIn} 0.16s ease-out both;

            @media (prefers-reduced-motion: reduce) {
                animation: none;
            }
        `}
`;

const HeaderRow = styled.div<{ $canToggle: boolean }>`
    display: flex;
    align-items: center;
    gap: 4px 3px;
    min-width: 0;
    min-height: 22px;
    font-size: inherit;
    line-height: inherit;
    cursor: ${props => props.$canToggle ? 'pointer' : 'default'};
`;

const CombinedText = styled.span`
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
`;

const ShimmerSpan = styled.span`
    display: inline-block;
    font-weight: 500;
`;

const ActionText = styled.span<{ $color: string }>`
    display: inline;
    vertical-align: baseline;
    font-weight: 500;
    opacity: 0.9;
    line-height: 1;
    color: ${props => props.$color};
`;

const Details = styled.span`
    display: inline-block;
    vertical-align: baseline;
    opacity: 0.85;
    font-size: inherit;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 400px;
    min-width: 0;

    /* Force every nested arg node (icons/links/spans) onto the same text metrics. */
    & * {
        line-height: inherit;
        vertical-align: baseline;
    }
`;

const ErrorText = styled.span`
    display: inline-block;
    vertical-align: baseline;
    min-width: 0;
    max-width: 440px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-errorForeground);
    opacity: 0.88;
    font-size: inherit;
    line-height: 1;
`;

export const ToolHeader: React.FC<ToolHeaderProps> = ({
    toolName,
    actionVerb,
    details,
    errorText,
    extra,
    isExpanded,
    onToggle,
    isPermissionRequest,
    isError,
    hasResults,
    status,
    shouldAnimate = false,
}) => {
    const { theme } = useToolTheme();

    const canToggle = !!onToggle;
    const resolvedStatus: ToolHeaderStatus = status ?? (isError ? 'error' : isPermissionRequest ? 'running' : 'complete');

    const getToolIcon = (name: string) => {
        switch (name) {
            case 'read': return 'eye';
            case 'write': return 'file-add';
            case 'edit': return 'edit';
            case 'grep': return 'search';
            case 'list_dir': return 'folder-opened';
            case 'mkdir': return 'new-folder';
            case 'web_search': return 'search';
            case 'web_fetch': return 'link-external';
            case 'research_web': return 'search';
            case 'mcp': return 'plug';
            case 'browser': return 'browser';
            case 'mv': return 'move';
            case 'rename': return 'edit';
            case 'run_sub_agent': return 'layers';
            default: return 'tools';
        }
    };

    return (
        <Container $shouldAnimate={shouldAnimate} style={{ fontFamily: theme.fontFamily }}>
            <HeaderRow
                $canToggle={canToggle}
                onClick={onToggle}
                className={canToggle ? 'group' : undefined}
            >
                <CombinedText className="flex items-center gap-1.5">
                    {resolvedStatus === 'running' ? (
                        <ShimmerSpan className="font-normal antialiased loading-shimmer-pure-text">
                            {actionVerb}
                        </ShimmerSpan>
                    ) : (
                        <ActionText $color={theme.colors.description}>
                            {actionVerb}
                        </ActionText>
                    )}
                    {details && (
                        <>
                            {' '}
                            <Details className="group-hover:text-vscode-foreground transition-colors duration-150" style={{ color: theme.colors.description }}>
                                {details}
                            </Details>
                        </>
                    )}
                    {errorText && (
                        <ErrorText title={errorText}>
                            {details ? "• " : ""}
                            {errorText}
                        </ErrorText>
                    )}
                </CombinedText>

                {/* Extra (Counts, Favicons, etc) */}
                {extra}

                {/* Status/Toggle Icon + Tool Icon grouped together */}
                <div className="flex items-center gap-1 ml-1 shrink-0">
                    {resolvedStatus === 'running' ? (
                        <span
                            className="codicon codicon-loading codicon-modifier-spin opacity-50"
                            style={{ fontSize: '12px', color: theme.colors.description }}
                        />
                    ) : resolvedStatus === 'error' ? (
                        <span
                            className="codicon codicon-error opacity-70"
                            style={{ fontSize: '12px', color: 'var(--vscode-errorForeground)' }}
                        />
                    ) : canToggle ? (
                        <span
                            className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'} opacity-50`}
                            style={{ fontSize: '12px', color: theme.colors.description }}
                        />
                    ) : (
                        <span
                            className="codicon codicon-check opacity-50"
                            style={{ fontSize: '12px', color: theme.colors.description }}
                        />
                    )}
                    <span
                        className={`codicon codicon-${getToolIcon(toolName)} opacity-40`}
                        style={{ fontSize: '13px', color: theme.toolAccents[toolName] || theme.colors.description }}
                    />
                </div>
            </HeaderRow>
        </Container>
    );
};
