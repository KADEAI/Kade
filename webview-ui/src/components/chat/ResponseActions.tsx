import React, { useState } from "react";
import { Copy, ThumbsDown, ThumbsUp, Check } from "lucide-react";
import { useCopyToClipboard } from "react-use";

import styled, { css, keyframes } from "styled-components";
import { StandardTooltip } from "../ui";

// Spring bounce for icon clicks
const iconBounce = keyframes`
	0% { transform: scale(1); }
	30% { transform: scale(1.35); }
	60% { transform: scale(0.9); }
	100% { transform: scale(1); }
`;

// Spring pop-in for checkmark
const springPopIn = keyframes`
	0% { transform: scale(0); opacity: 0; }
	50% { transform: scale(1.25); opacity: 1; }
	100% { transform: scale(1); opacity: 1; }
`;

// Slide-up reveal for the container
const containerReveal = keyframes`
	0% { opacity: 0; transform: translateY(5px); }
	100% { opacity: 1; transform: translateY(0); }
`;

interface ResponseActionsProps {
  text: string;
  className?: string;
  copyClassName?: string;
  sources?: ResponseActionSource[];
}

export interface ResponseActionSource {
  domain: string;
  url: string;
  title?: string;
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
`;

const ActionButton = styled.button<{
  $active?: boolean;
  $variant?: "helpful" | "unhelpful";
  $bouncing?: boolean;
}>`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--vscode-descriptionForeground);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.1s ease;

  &:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.92);
  }

  ${({ $bouncing }) =>
    $bouncing &&
    css`
      animation: ${iconBounce} 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    `}

  ${({ $active, $variant }) =>
    $active &&
    $variant === "helpful" &&
    css`
      color: var(--vscode-charts-green);
      background: color-mix(
        in srgb,
        var(--vscode-charts-green) 20%,
        transparent
      );

      &:hover {
        background: color-mix(
          in srgb,
          var(--vscode-charts-green) 30%,
          transparent
        );
        color: var(--vscode-charts-green);
      }
    `}

    ${({ $active, $variant }) =>
    $active &&
    $variant === "unhelpful" &&
    css`
      color: var(--vscode-errorForeground);
      background: color-mix(
        in srgb,
        var(--vscode-errorForeground) 20%,
        transparent
      );

      &:hover {
        background: color-mix(
          in srgb,
          var(--vscode-errorForeground) 30%,
          transparent
        );
        color: var(--vscode-errorForeground);
      }
    `}
`;

const CheckIcon = styled.span`
  display: inline-flex;
  animation: ${springPopIn} 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
`;

const CopyButton = styled(ActionButton)`
  opacity: 0;
  pointer-events: none;
  transform: translateX(4px);
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    background-color 0.15s ease,
    color 0.15s ease;
`;

const pillReveal = keyframes`
  0% {
    opacity: 0;
    transform: translateY(4px) scale(0.94);
    filter: blur(4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
`;

const SourcesPill = styled.button`
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 0 10px 0 8px;
  border-radius: 999px;
  border: 1px solid
    color-mix(in srgb, var(--vscode-textLink-foreground) 24%, transparent);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--vscode-editor-background) 72%, transparent),
    color-mix(
      in srgb,
      var(--vscode-textLink-foreground) 10%,
      var(--vscode-editor-background)
    )
  );
  box-shadow:
    inset 0 1px 0
      color-mix(in srgb, var(--vscode-editorWidget-border) 28%, transparent),
    0 10px 24px color-mix(in srgb, var(--vscode-widget-shadow) 16%, transparent);
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms ease,
    color 180ms ease,
    box-shadow 180ms ease;
  animation: ${pillReveal} 320ms cubic-bezier(0.22, 1, 0.36, 1) both;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      120deg,
      transparent 0%,
      color-mix(in srgb, white 14%, transparent) 42%,
      transparent 74%
    );
    transform: translateX(-130%);
    transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  &:hover {
    transform: translateY(-1px) scale(1.015);
    border-color: color-mix(
      in srgb,
      var(--vscode-textLink-foreground) 42%,
      transparent
    );
    color: var(--vscode-foreground);
    box-shadow:
      inset 0 1px 0
        color-mix(in srgb, var(--vscode-editorWidget-border) 38%, transparent),
      0 14px 30px
        color-mix(in srgb, var(--vscode-widget-shadow) 24%, transparent);

    &::before {
      transform: translateX(130%);
    }
  }

  &:focus-visible {
    outline: 1px solid
      color-mix(in srgb, var(--vscode-focusBorder) 85%, transparent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition:
      border-color 180ms ease,
      color 180ms ease,
      box-shadow 180ms ease;

    &::before {
      transition: none;
    }

    &:hover {
      transform: none;
    }
  }
`;

const SourceFaviconStack = styled.span`
  display: inline-flex;
  align-items: center;
  min-width: 28px;
`;

const SourceFaviconWrap = styled.span<{ $index: number }>`
  width: 14px;
  height: 14px;
  border-radius: 999px;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(
    in srgb,
    var(--vscode-editorWidget-border) 26%,
    transparent
  );
  border: 1px solid
    color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
  margin-left: ${({ $index }) => ($index === 0 ? "0" : "-4px")};
  box-shadow: 0 3px 8px
    color-mix(in srgb, var(--vscode-widget-shadow) 12%, transparent);
`;

const SourceFavicon = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const SourceLabel = styled.span`
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
`;

const SourceCount = styled.span`
  position: relative;
  z-index: 1;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--vscode-foreground);
  background: color-mix(
    in srgb,
    var(--vscode-textLink-foreground) 18%,
    transparent
  );
`;

const TooltipSources = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
`;

const TooltipHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`;

const TooltipTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--vscode-foreground);
`;

const TooltipMeta = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
`;

const TooltipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const TooltipItem = styled.div`
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
`;

const TooltipFavicon = styled.img`
  width: 14px;
  height: 14px;
  border-radius: 4px;
  margin-top: 1px;
`;

const TooltipText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const TooltipSourceTitle = styled.div`
  font-size: 11px;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TooltipSourceMeta = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ResponseActions: React.FC<ResponseActionsProps> = ({
  text,
  className,
  copyClassName,
  sources = [],
}) => {
  const [, copyToClipboard] = useCopyToClipboard();
  const [hasCopied, setHasCopied] = useState(false);
  const [feedback, setFeedback] = useState<"helpful" | "unhelpful" | null>(
    null,
  );
  const [bouncingFeedback, setBouncingFeedback] = useState<
    "helpful" | "unhelpful" | null
  >(null);
  const visibleSources = sources.slice(0, 6);
  const sourceDomains = [
    ...new Set(visibleSources.map((source) => source.domain)),
  ];

  const handleCopy = () => {
    copyToClipboard(text);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  const handleFeedback = (type: "helpful" | "unhelpful") => {
    if (feedback === type) {
      setFeedback(null);
    } else {
      setFeedback(type);
      // Trigger bounce animation
      setBouncingFeedback(type);
      setTimeout(() => setBouncingFeedback(null), 400);
    }
  };

  const getFaviconUrl = (domain: string) =>
    `https://icons.duckduckgo.com/ip3/${domain}.ico`;

  return (
    <ActionsContainer className={className}>
      <div className="flex items-center gap-1">
        <ActionButton
          type="button"
          title="Helpful"
          onClick={() => handleFeedback("helpful")}
          $active={feedback === "helpful"}
          $variant="helpful"
          $bouncing={bouncingFeedback === "helpful"}
        >
          <ThumbsUp size={12} />
        </ActionButton>
        <ActionButton
          type="button"
          title="Unhelpful"
          onClick={() => handleFeedback("unhelpful")}
          $active={feedback === "unhelpful"}
          $variant="unhelpful"
          $bouncing={bouncingFeedback === "unhelpful"}
        >
          <ThumbsDown size={12} />
        </ActionButton>
      </div>

      {visibleSources.length > 0 && (
        <StandardTooltip
          side="top"
          align="start"
          sideOffset={8}
          maxWidth={320}
          content={
            <TooltipSources>
              <TooltipHeader>
                <TooltipTitle>Web Sources</TooltipTitle>
                <TooltipMeta>
                  {visibleSources.length} source
                  {visibleSources.length === 1 ? "" : "s"}
                </TooltipMeta>
              </TooltipHeader>
              <TooltipList>
                {visibleSources.map((source) => (
                  <TooltipItem key={`${source.domain}-${source.url}`}>
                    <TooltipFavicon
                      src={getFaviconUrl(source.domain)}
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    <TooltipText>
                      <TooltipSourceTitle>
                        {source.title || source.domain}
                      </TooltipSourceTitle>
                      <TooltipSourceMeta>{source.domain}</TooltipSourceMeta>
                    </TooltipText>
                  </TooltipItem>
                ))}
              </TooltipList>
            </TooltipSources>
          }
        >
          <SourcesPill
            type="button"
            aria-label="Show web sources used in this response"
          >
            <SourceFaviconStack>
              {sourceDomains.slice(0, 3).map((domain, index) => (
                <SourceFaviconWrap key={domain} $index={index}>
                  <SourceFavicon
                    src={getFaviconUrl(domain)}
                    alt=""
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                </SourceFaviconWrap>
              ))}
            </SourceFaviconStack>
            <SourceLabel>Sources</SourceLabel>
            <SourceCount>{visibleSources.length}</SourceCount>
          </SourcesPill>
        </StandardTooltip>
      )}

      <CopyButton
        type="button"
        onClick={handleCopy}
        title="Copy response"
        className={`copy-btn ${copyClassName || ""}`}
      >
        {hasCopied ? (
          <CheckIcon>
            <Check size={14} />
          </CheckIcon>
        ) : (
          <Copy size={12} />
        )}
      </CopyButton>
    </ActionsContainer>
  );
};
