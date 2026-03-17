
import React, { useState } from "react"
import { Copy, ThumbsDown, ThumbsUp, Check } from "lucide-react"
import { useCopyToClipboard } from "react-use"

import styled, { css, keyframes } from "styled-components"

// Spring bounce for icon clicks
const iconBounce = keyframes`
	0% { transform: scale(1); }
	30% { transform: scale(1.35); }
	60% { transform: scale(0.9); }
	100% { transform: scale(1); }
`

// Spring pop-in for checkmark
const springPopIn = keyframes`
	0% { transform: scale(0); opacity: 0; }
	50% { transform: scale(1.25); opacity: 1; }
	100% { transform: scale(1); opacity: 1; }
`

// Slide-up reveal for the container
const containerReveal = keyframes`
	0% { opacity: 0; transform: translateY(5px); }
	100% { opacity: 1; transform: translateY(0); }
`

interface ResponseActionsProps {
    text: string
    className?: string
    copyClassName?: string
}

const ActionsContainer = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    animation: ${containerReveal} 0.3s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;

    &:hover .copy-btn {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(0);
    }
`

const ActionButton = styled.button<{ $active?: boolean; $variant?: 'helpful' | 'unhelpful'; $bouncing?: boolean }>`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 0.15s ease, color 0.15s ease, transform 0.1s ease;

    &:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-foreground);
        transform: scale(1.1);
    }

    &:active {
        transform: scale(0.92);
    }

    ${({ $bouncing }) => $bouncing && css`
        animation: ${iconBounce} 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    `}

    ${({ $active, $variant }) => $active && $variant === 'helpful' && css`
        color: var(--vscode-charts-green);
        background: color-mix(in srgb, var(--vscode-charts-green) 20%, transparent);

        &:hover {
             background: color-mix(in srgb, var(--vscode-charts-green) 30%, transparent);
             color: var(--vscode-charts-green);
        }
    `}

    ${({ $active, $variant }) => $active && $variant === 'unhelpful' && css`
        color: var(--vscode-errorForeground);
        background: color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent);

        &:hover {
             background: color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent);
             color: var(--vscode-errorForeground);
        }
    `}
`

const CheckIcon = styled.span`
    display: inline-flex;
    animation: ${springPopIn} 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
`

const CopyButton = styled(ActionButton)`
    opacity: 0;
    pointer-events: none;
    transform: translateX(4px);
    transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.15s ease, color 0.15s ease;
`

export const ResponseActions: React.FC<ResponseActionsProps> = ({ text, className, copyClassName }) => {
    const [state, copyToClipboard] = useCopyToClipboard()
    const [hasCopied, setHasCopied] = useState(false)
    const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | null>(null)
    const [bouncingFeedback, setBouncingFeedback] = useState<'helpful' | 'unhelpful' | null>(null)

    const handleCopy = () => {
        copyToClipboard(text)
        setHasCopied(true)
        setTimeout(() => setHasCopied(false), 2000)
    }

    const handleFeedback = (type: 'helpful' | 'unhelpful') => {
        if (feedback === type) {
            setFeedback(null)
        } else {
            setFeedback(type)
            // Trigger bounce animation
            setBouncingFeedback(type)
            setTimeout(() => setBouncingFeedback(null), 400)
        }
    }

    return (
        <ActionsContainer className={className}>
            <div className="flex items-center gap-1">
                <ActionButton
                    title="Helpful"
                    onClick={() => handleFeedback('helpful')}
                    $active={feedback === 'helpful'}
                    $variant="helpful"
                    $bouncing={bouncingFeedback === 'helpful'}
                >
                    <ThumbsUp size={12} />
                </ActionButton>
                <ActionButton
                    title="Unhelpful"
                    onClick={() => handleFeedback('unhelpful')}
                    $active={feedback === 'unhelpful'}
                    $variant="unhelpful"
                    $bouncing={bouncingFeedback === 'unhelpful'}
                >
                    <ThumbsDown size={12} />
                </ActionButton>
            </div>

            <CopyButton
                onClick={handleCopy}
                title="Copy response"
                className={`copy-btn ${copyClassName || ""}`}
            >
                {hasCopied ? (
                    <CheckIcon><Check size={14} /></CheckIcon>
                ) : (
                    <Copy size={12} />
                )}
            </CopyButton>
        </ActionsContainer>
    )
}
