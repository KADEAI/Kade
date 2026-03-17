import React, { useMemo } from 'react';
import styled, { keyframes, css } from 'styled-components';

interface ToolStatusIndicatorProps {
    state: 'success' | 'error' | 'pending' | null;
    className?: string;
}

const pulse = keyframes`
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.3;
    }
`;

const IndicatorContainer = styled.span<{ $state: string | null }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: var(--vscode-foreground);
        opacity: 0.3;

        ${({ $state }) => $state === 'success' && css`
            background-color: var(--vscode-testing-iconPassed);
            opacity: 1;
        `}

        ${({ $state }) => $state === 'error' && css`
            background-color: var(--vscode-testing-iconFailed);
            opacity: 1;
        `}

        ${({ $state }) => $state === 'pending' && css`
            background-color: var(--vscode-progressBar-background);
            opacity: 1;
            animation: ${pulse} 1.5s ease-in-out infinite;
        `}
    }
`;

export const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({ state, className }) => {
    return (
        <IndicatorContainer $state={state} className={className}>
            <span className="status-dot"></span>
        </IndicatorContainer>
    );
};
