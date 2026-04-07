import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Terminal,
  Copy,
  Check,
  ChevronRight,
  Square,
  Play,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import { vscode } from "@src/utils/vscode";
import { useExtensionState } from "@/context/ExtensionStateContext";
import styled, { keyframes, css, createGlobalStyle } from "styled-components";
import { motion } from "framer-motion";
import { AnimatedAccordion } from "../../components/common/AnimatedAccordion";
import {
  toolHeaderBackgroundOverlayCss,
  useToolHeaderBackground,
} from "@/hooks/useToolHeaderBackground";
import { extractBashCommandPreview } from "@/utils/extractBashCommandPreview";

const streamDown = keyframes`
  0% {
    transform: translateY(4px);
    opacity: 0.9;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
`;

const cardFadeIn = keyframes`
  0% {
    opacity: 0;
    transform: translateY(5px);
    filter: blur(3px) saturate(0.96);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0) saturate(1);
  }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const successBadgePop = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.82);
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
  }
  55% {
    opacity: 1;
    transform: scale(1.04);
    box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
  }
`;

const successCheckDraw = keyframes`
  0% {
    stroke-dashoffset: 1;
    opacity: 0.2;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
`;

const successRingPulse = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.82);
  }
  35% {
    opacity: 0.45;
  }
  100% {
    opacity: 0;
    transform: scale(1.25);
  }
`;

const successBadgeCore = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.68);

  &::before {
    content: "";
    position: absolute;
    inset: 1px;
    border-radius: inherit;
    background: transparent;
  }

  svg {
    position: relative;
    z-index: 1;
    width: 8px;
    height: 8px;
  }
`;

export const BashGlobalStyles = createGlobalStyle`
  @property --angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  @keyframes rotateBorderVar {
    from { --angle: 0deg; }
    to { --angle: 360deg; }
  }
`;

const BASH_CARD_RADIUS = "14px";

const CardContainer = styled(motion.article)<{
  $isRunning?: boolean;
  $isError?: boolean;
}>`
  position: relative;
  display: flex;
  flex-direction: column;
  --bash-card-radius: ${BASH_CARD_RADIUS};
  border-radius: 10px;
  overflow: visible;
  isolation: isolate;
  animation: ${cardFadeIn} 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
  box-shadow: none;
  margin-top: -1.1px;
  margin-bottom: -3.6px;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: conic-gradient(
      from var(--angle),
      transparent 0deg,
      transparent 60deg,
      rgba(255, 255, 255, 0.4) 72deg,
      transparent 84deg,
      transparent 220deg,
      rgba(255, 255, 255, 0.3) 232deg,
      transparent 244deg,
      transparent 360deg
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: ${({ $isRunning }) => ($isRunning ? 1 : 0)};
    transition: opacity 0.18s ease;
    animation: rotateBorderVar 5.6s linear infinite;
    pointer-events: none;
    z-index: 4;
  }

  &::after {
    display: none;
    content: "";
    position: absolute;
    inset: -28% auto auto -10%;
    width: 40%;
    height: 86px;
    background: radial-gradient(
      circle,
      ${({ $isError, $isRunning }) =>
          $isError
            ? "rgba(248, 113, 113, 0.15)"
            : $isRunning
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(255, 255, 255, 0.05)"}
        0%,
      transparent 70%
    );
    filter: blur(28px);
    pointer-events: none;
    z-index: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const CardFrame = styled.div`
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: none;
  z-index: 3;
`;

const InnerWrapper = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: inherit;
  overflow: visible;
  background: var(
    --vscode-sideBar-background,
    var(--vscode-editor-background, #1e1e1e)
  );
  backdrop-filter: none;
`;

const CardHeader = styled.div<{ $isExpanded?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 35px;
  padding: 6px 11px;
  cursor: pointer;
  background: transparent;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(255, 255, 255, 0.025);
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  border-bottom-left-radius: ${({ $isExpanded }) =>
    $isExpanded ? "0" : "inherit"};
  border-bottom-right-radius: ${({ $isExpanded }) =>
    $isExpanded ? "0" : "inherit"};
  border-bottom: ${({ $isExpanded }) =>
    $isExpanded
      ? "1px solid rgba(255, 255, 255, 0.06)"
      : "1px solid transparent"};
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
  ${toolHeaderBackgroundOverlayCss}

  &:hover {
    background: transparent;
  }
`;

const HeaderLead = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
  padding-right: 60px;
`;

const CommandIcon = styled.div`
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
`;

const CommandPreview = styled.span`
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.3;
  font-weight: 500;
  letter-spacing: -0.015em;
  color: rgba(194, 194, 194, 0.92);
  font-family: "SF Mono", "Menlo", var(--vscode-editor-font-family, monospace);
`;

const HeaderActions = styled.div<{ $alwaysVisible?: boolean }>`
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: ${({ $alwaysVisible }) => ($alwaysVisible ? 1 : 0)};
  pointer-events: ${({ $alwaysVisible }) => ($alwaysVisible ? "auto" : "none")};
  transition: opacity 0.18s ease;

  ${CardHeader}:hover & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
`;

const hoverTooltipStyles = css`
  &[data-tooltip] {
    position: relative;
  }

  &[data-tooltip]::before,
  &[data-tooltip]::after {
    position: absolute;
    left: 50%;
    pointer-events: none;
    opacity: 0;
    transition:
      opacity 0.16s ease,
      transform 0.16s ease;
    z-index: 8;
  }

  &[data-tooltip]::before {
    content: "";
    bottom: calc(100% + 2px);
    border-width: 4px;
    border-style: solid;
    border-color: rgba(10, 10, 10, 0.92) transparent transparent transparent;
    transform: translateX(-50%) translateY(2px);
  }

  &[data-tooltip]::after {
    content: attr(data-tooltip);
    bottom: calc(100% + 9px);
    transform: translateX(-50%) translateY(3px);
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(10, 10, 10, 0.92);
    color: rgba(255, 255, 255, 0.94);
    font-size: 10px;
    line-height: 1;
    letter-spacing: 0;
    white-space: nowrap;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  &[data-tooltip]:hover::before,
  &[data-tooltip]:hover::after,
  &[data-tooltip]:focus-visible::before,
  &[data-tooltip]:focus-visible::after {
    opacity: 1;
  }

  &[data-tooltip]:hover::before,
  &[data-tooltip]:focus-visible::before {
    transform: translateX(-50%) translateY(0);
  }

  &[data-tooltip]:hover::after,
  &[data-tooltip]:focus-visible::after {
    transform: translateX(-50%) translateY(0);
  }
`;

const ActionButton = styled.button`
  ${hoverTooltipStyles}
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  background: rgba(24, 24, 24, 0.38);
  backdrop-filter: blur(10px) saturate(1.15);
  -webkit-backdrop-filter: blur(10px) saturate(1.15);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    color: rgba(255, 255, 255, 0.88);
    background: rgba(34, 34, 34, 0.52);
    border-color: rgba(255, 255, 255, 0.12);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }
`;

const TerminalButton = styled(ActionButton)<{
  $variant?: "primary" | "danger";
}>`
  ${({ $variant }) =>
    $variant === "primary" &&
    css`
      &:hover:not(:disabled) {
        color: #9df0c8;
        background: rgba(16, 185, 129, 0.12);
        border-color: rgba(16, 185, 129, 0.2);
      }
    `}

  ${({ $variant }) =>
    $variant === "danger" &&
    css`
      &:hover:not(:disabled) {
        color: #ffb4ab;
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.2);
      }
    `}
`;

const ToggleIcon = styled(ChevronRight)<{ $isExpanded?: boolean }>`
  transition: transform 0.18s ease;
  transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`;

const TerminalView = styled.div.attrs({ className: "anchored-container" })<{
  $hasFooter?: boolean;
}>`
  font-size: 12px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.68);
  overflow-y: auto;
  max-height: 170px;
  padding: 10px 14px 10px;
  padding-right: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: var(
    --vscode-sideBar-background,
    var(--vscode-editor-background, #1e1e1e)
  );
  border-bottom-left-radius: ${({ $hasFooter }) =>
    $hasFooter ? "0" : "var(--bash-card-radius)"};
  border-bottom-right-radius: ${({ $hasFooter }) =>
    $hasFooter ? "0" : "var(--bash-card-radius)"};
  font-family: "SF Mono", "Menlo", var(--vscode-editor-font-family, monospace);
  font-feature-settings: "tnum";
  scrollbar-gutter: stable;

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.22);
  }
`;

const AccordionBody = styled.div`
  border-bottom-left-radius: var(--bash-card-radius);
  border-bottom-right-radius: var(--bash-card-radius);
  overflow: hidden;
`;

const OutputContent = styled.div<{ $isStreaming?: boolean }>`
  font-size: 11px;
  color: rgba(201, 201, 201, 1);
  white-space: pre-wrap;
  word-break: break-word;
  animation: ${({ $isStreaming }) =>
    $isStreaming
      ? css`
          ${streamDown} 0.24s cubic-bezier(0.22, 1, 0.36, 1)
        `
      : "none"};

  span {
    transition: color 0.2s ease;
    display: inline-block;
    vertical-align: middle;
    margin: 1px 0;
  }

  a {
    color: var(--vscode-textLink-foreground, #4ea1ff);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  a:hover {
    color: var(--vscode-textLink-activeForeground, #79b8ff);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 11px;
  font-style: italic;
`;

const StdinForm = styled.form`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  background: transparent;
  border-bottom-left-radius: var(--bash-card-radius);
  border-bottom-right-radius: var(--bash-card-radius);
`;

const StdinInput = styled.input`
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 1px;
  border-radius: 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-size: 10px;
  font-family: "SF Mono", "Menlo", var(--vscode-editor-font-family, monospace);

  &::placeholder {
    color: rgba(255, 255, 255, 0.24);
  }

  &:focus {
    outline: none;
    color: rgba(255, 255, 255, 0.92);
  }
`;

const StdinButton = styled.button`
  ${hoverTooltipStyles}
  height: 22px;
  min-width: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.96);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const LoadingIcon = styled(Loader2)`
  width: 12px;
  height: 12px;
  animation: ${spin} 1s linear infinite;
`;

const CompleteBadgeAnchor = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
`;

const CompleteBadge = styled.span`
  ${successBadgeCore}
`;

const AnimatedCompleteBadge = styled.span`
  ${successBadgeCore}
  pointer-events: none;
  animation: ${successBadgePop} 0.34s cubic-bezier(0.22, 1, 0.36, 1);

  &::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    border: 1px solid rgba(255, 255, 255, 0.14);
    opacity: 0;
    animation: ${successRingPulse} 0.45s 0.02s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .check-path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: ${successCheckDraw} 0.26s 0.08s cubic-bezier(0.22, 1, 0.36, 1)
      forwards;
  }
`;

function ansiToHtml(str: string): string {
  if (!str) return "";

  const linkifyText = (text: string): string =>
    text.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      const trailingMatch = url.match(/[),.;!?]+$/);
      const trailing = trailingMatch?.[0] ?? "";
      const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;

      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
    });

  const colors: Record<number, string> = {
    30: "color: var(--vscode-terminal-ansiBlack)",
    31: "color: var(--vscode-terminal-ansiRed)",
    32: "color: var(--vscode-terminal-ansiGreen)",
    33: "color: var(--vscode-terminal-ansiYellow)",
    34: "color: var(--vscode-terminal-ansiBlue)",
    35: "color: var(--vscode-terminal-ansiMagenta)",
    36: "color: var(--vscode-terminal-ansiCyan)",
    37: "color: var(--vscode-terminal-ansiWhite)",
    90: "color: var(--vscode-terminal-ansiBrightBlack)",
    91: "color: var(--vscode-terminal-ansiBrightRed)",
    92: "color: var(--vscode-terminal-ansiBrightGreen)",
    93: "color: var(--vscode-terminal-ansiBrightYellow)",
    94: "color: var(--vscode-terminal-ansiBrightBlue)",
    95: "color: var(--vscode-terminal-ansiBrightMagenta)",
    96: "color: var(--vscode-terminal-ansiBrightCyan)",
    97: "color: var(--vscode-terminal-ansiBrightWhite)",
  };

  const html = str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  let currentColorStyle = "";
  let isBold = false;
  let isFaint = false;
  let isUnderline = false;
  let isInverted = false;

  let output = "";
  let lastIndex = 0;
  const regex = /\x1b\[([0-9;]*)m/g;
  let match;

  const renderText = (text: string): string => {
    if (!text) return "";

    const styles: string[] = [];
    if (currentColorStyle) styles.push(currentColorStyle);
    if (isBold) styles.push("font-weight: bold");
    if (isFaint) styles.push("opacity: 0.6");
    if (isUnderline) styles.push("text-decoration: underline");
    if (isInverted) styles.push("filter: invert(1)");

    const linkifiedText = linkifyText(text);

    if (styles.length > 0) {
      return `<span style="${styles.join("; ")}">${linkifiedText}</span>`;
    }

    return linkifiedText;
  };

  while ((match = regex.exec(html)) !== null) {
    const text = html.substring(lastIndex, match.index);
    if (text) {
      output += renderText(text);
    }

    const codes = match[1].split(";").map((c) => parseInt(c) || 0);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        currentColorStyle = "";
        isBold = false;
        isFaint = false;
        isUnderline = false;
        isInverted = false;
      } else if (colors[code]) {
        currentColorStyle = colors[code];
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isFaint = true;
      } else if (code === 3 || code === 4) {
        isUnderline = true;
      } else if (code === 7) {
        isInverted = true;
      } else if (code === 22) {
        isBold = false;
        isFaint = false;
      } else if (code === 23 || code === 24) {
        isUnderline = false;
      } else if (code === 39) {
        currentColorStyle = "";
      } else if (code === 38 && codes[i + 1] === 5) {
        const index = codes[i + 2];
        if (index < 16) {
          const base = index < 8 ? 30 + index : 90 + (index - 8);
          if (colors[base]) currentColorStyle = colors[base];
        } else {
          currentColorStyle = "color: #888";
        }
        i += 2;
      } else if (code === 38 && codes[i + 1] === 2) {
        const r = codes[i + 2];
        const g = codes[i + 3];
        const b = codes[i + 4];
        currentColorStyle = `color: rgb(${r},${g},${b})`;
        i += 4;
      }
    }
    lastIndex = regex.lastIndex;
  }

  const text = html.substring(lastIndex);
  if (text) {
    output += renderText(text);
  }

  return output;
}

interface BashProps {
  command: string;
  output?: string;
  isError?: boolean;
  isKey?: boolean;
  isRunning?: boolean;
  startCollapsedOnMount?: boolean;
  executionId?: string;
  isAskingToProceed?: boolean;
  allowOutputAutoScroll?: boolean;
}

function normalizeOutput(content: string): string {
  if (!content) return content;

  const half = Math.floor(content.length / 2);
  if (
    content.length % 2 === 0 &&
    content.slice(0, half) === content.slice(half)
  ) {
    content = content.slice(0, half);
  }

  const lines = content.split("\n");
  const deduped: string[] = [];
  for (const line of lines) {
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1] === line &&
      line.trim().length > 0
    ) {
      continue;
    }
    deduped.push(line);
  }

  return deduped
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/g, "")
    .replace(/\n+$/g, "");
}

export const Bash = ({
  command,
  output: initialOutput,
  isError,
  isKey,
  isRunning,
  startCollapsedOnMount = false,
  executionId,
  isAskingToProceed,
  allowOutputAutoScroll = true,
}: BashProps) => {
  const { collapseCodeToolsByDefault = false } = useExtensionState();
  const headerBackground = useToolHeaderBackground("bash");
  const [streamBuffer, setStreamBuffer] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [isProceeding, setIsProceeding] = useState(false);
  const [stdinValue, setStdinValue] = useState("");
  const [isSendingInput, setIsSendingInput] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [completionBadgeKey, setCompletionBadgeKey] = useState(0);
  const [isExpanded, setIsExpanded] = useState(() => {
    const isActive = Boolean(isRunning || isAskingToProceed);
    return !collapseCodeToolsByDefault && (isActive || !startCollapsedOnMount);
  });
  const prevIsActiveRef = useRef(Boolean(isRunning || isAskingToProceed));
  const collapseTimeoutRef = useRef<number | null>(null);
  const completionResetTimeoutRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const streamedCommandRef = useRef("");

  useEffect(() => {
    setIsAborting(false);
    setIsProceeding(false);
  }, [isRunning, isAskingToProceed]);

  useEffect(() => {
    if (!isRunning && !isAskingToProceed) {
      setIsSendingInput(false);
    }
  }, [isRunning, isAskingToProceed]);

  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current !== null) {
        window.clearTimeout(collapseTimeoutRef.current);
      }
      if (completionResetTimeoutRef.current !== null) {
        window.clearTimeout(completionResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (collapseCodeToolsByDefault) {
      prevIsActiveRef.current = Boolean(isRunning || isAskingToProceed);
      return;
    }

    const isActive = Boolean(isRunning || isAskingToProceed);
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }

    if (isActive) {
      if (completionResetTimeoutRef.current !== null) {
        window.clearTimeout(completionResetTimeoutRef.current);
        completionResetTimeoutRef.current = null;
      }
      setJustCompleted(false);
      setIsExpanded(true);
      return;
    }

    if (wasActive && !isActive) {
      if (!isError) {
        setJustCompleted(true);
        setCompletionBadgeKey((current) => current + 1);
        completionResetTimeoutRef.current = window.setTimeout(() => {
          setJustCompleted(false);
          completionResetTimeoutRef.current = null;
        }, 700);
      }
      collapseTimeoutRef.current = window.setTimeout(() => {
        setIsExpanded(false);
        collapseTimeoutRef.current = null;
      }, 1500);
    }
  }, [collapseCodeToolsByDefault, isRunning, isAskingToProceed, isError]);

  useEffect(() => {
    setStreamBuffer(normalizeOutput(initialOutput || ""));
  }, [initialOutput]);

  useEffect(() => {
    if (isRunning && allowOutputAutoScroll && outputRef.current) {
      const el = outputRef.current;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [streamBuffer, isRunning, allowOutputAutoScroll]);

  const outputHtml = useMemo(() => {
    let content = streamBuffer;
    if (content.includes("MCP error") && content.includes("AbortError")) {
      content = "";
    }
    return ansiToHtml(content);
  }, [streamBuffer]);

  const parsedCommand = useMemo(
    () => extractBashCommandPreview(command),
    [command],
  );

  const streamedCommand = useMemo(() => {
    if (!parsedCommand) {
      return streamedCommandRef.current;
    }

    const previousCommand = streamedCommandRef.current;
    const isSameStream =
      !previousCommand ||
      parsedCommand.startsWith(previousCommand) ||
      previousCommand.startsWith(parsedCommand);

    if (!isSameStream || parsedCommand.length >= previousCommand.length) {
      streamedCommandRef.current = parsedCommand;
    }

    return streamedCommandRef.current;
  }, [parsedCommand]);

  const cleanCommand = useMemo(() => {
    if (streamedCommand) {
      return streamedCommand;
    }

    const raw = (command || "").trim();
    if (!raw || raw.startsWith("Output:")) {
      const outputText =
        initialOutput || raw.replace(/^Output:\s*/i, "").trim();
      if (outputText) {
        const pingMatch = outputText.match(/^Pinging\s+([^\s\[]+)/i);
        if (pingMatch) return `ping ${pingMatch[1]}`;
      }
      return "";
    }
    return raw.split("\nOutput:")[0].trim();
  }, [command, initialOutput, streamedCommand]);

  const onCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(cleanCommand || command);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  const onStop = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsAborting(true);
    vscode.postMessage({
      type: "terminalOperation",
      terminalOperation: "abort",
      executionId,
    });
  };

  const onProceed = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsProceeding(true);
    vscode.postMessage({
      type: "terminalOperation",
      terminalOperation: "continue",
      executionId,
      text: cleanCommand || command,
    });
  };

  const onToggleExpand = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    setIsExpanded((current) => !current);
  };

  const canSendStdin = Boolean(executionId && (isRunning || isAskingToProceed));
  const onSubmitStdin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!executionId) {
      return;
    }

    setIsSendingInput(true);
    vscode.postMessage({
      type: "terminalOperation",
      terminalOperation: "stdin",
      executionId,
      text: `${stdinValue}\n`,
    });
    setStdinValue("");
    setIsSendingInput(false);
  };

  const emptyLabel = isRunning ? "Waiting for output..." : "No output";
  const showCompletedBadge = Boolean(
    !isRunning &&
      !isAskingToProceed &&
      !isError &&
      (cleanCommand || streamBuffer || initialOutput),
  );

  return (
    <CardContainer
      $isRunning={isRunning}
      $isError={isError}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <CardFrame aria-hidden="true" />
      <InnerWrapper>
        <CardHeader
          $isExpanded={isExpanded}
          style={headerBackground.style}
          onClick={() => onToggleExpand()}
        >
          <HeaderLead>
            <CommandIcon>
              <Terminal size={11} strokeWidth={2.1} />
            </CommandIcon>
            <CommandPreview>
              {cleanCommand || "Terminal command"}
            </CommandPreview>
            {showCompletedBadge && (
              <CompleteBadgeAnchor title="Command completed successfully">
                <CompleteBadge aria-hidden="true">
                  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2.2 6.2 4.8 8.6 9.8 3.6"
                      pathLength="1"
                      stroke="currentColor"
                      strokeOpacity="0.72"
                      strokeWidth="1.65"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </CompleteBadge>
                {justCompleted && (
                  <AnimatedCompleteBadge
                    key={completionBadgeKey}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        className="check-path"
                        d="M2.2 6.2 4.8 8.6 9.8 3.6"
                        pathLength="1"
                        stroke="currentColor"
                        strokeOpacity="0.84"
                        strokeWidth="1.65"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </AnimatedCompleteBadge>
                )}
              </CompleteBadgeAnchor>
            )}
          </HeaderLead>

          <HeaderActions
            $alwaysVisible={Boolean(isRunning || isAskingToProceed)}
            onClick={(event) => event.stopPropagation()}
          >
            {(isRunning || isAskingToProceed) && (
              <ActionGroup>
                <TerminalButton
                  $variant="primary"
                  onClick={onProceed}
                  disabled={isProceeding || isAborting}
                  data-tooltip="Proceed while running"
                  aria-label="Proceed while running"
                >
                  {isProceeding ? <LoadingIcon /> : <Play size={12} />}
                  <span className="sr-only">Proceed while running</span>
                </TerminalButton>

                <TerminalButton
                  $variant="danger"
                  onClick={onStop}
                  disabled={isAborting || isProceeding}
                  data-tooltip="Kill command"
                  aria-label="Kill command"
                >
                  {isAborting ? <LoadingIcon /> : <Square size={12} />}
                  <span className="sr-only">Kill command</span>
                </TerminalButton>
              </ActionGroup>
            )}

            <ActionGroup>
              <ActionButton
                onClick={onCopy}
                data-tooltip={isCopied ? "Copied command" : "Copy command"}
                aria-label={isCopied ? "Copied command" : "Copy command"}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                <span className="sr-only">Copy command</span>
              </ActionButton>

              <ActionButton
                onClick={onToggleExpand}
                aria-label={isExpanded ? "Close terminal" : "Expand terminal"}
              >
                <ToggleIcon size={10} $isExpanded={isExpanded} />
                <span className="sr-only">
                  {isExpanded ? "Close terminal" : "Expand terminal"}
                </span>
              </ActionButton>
            </ActionGroup>
          </HeaderActions>
        </CardHeader>

        <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
          <AccordionBody>
            <TerminalView
              ref={outputRef}
              data-testid="bash-output"
              $hasFooter={canSendStdin}
            >
              {outputHtml ? (
                <OutputContent
                  $isStreaming={isRunning}
                  dangerouslySetInnerHTML={{ __html: outputHtml }}
                />
              ) : (
                !isKey && (
                  <EmptyState>
                    <Terminal size={13} strokeWidth={2} />
                    {emptyLabel}
                  </EmptyState>
                )
              )}
            </TerminalView>
            {canSendStdin && (
              <StdinForm onSubmit={onSubmitStdin}>
                <StdinInput
                  data-testid="bash-stdin-input"
                  type="text"
                  value={stdinValue}
                  onChange={(event) => setStdinValue(event.target.value)}
                  placeholder="Send input and press Enter"
                  autoComplete="off"
                  spellCheck={false}
                />
                <StdinButton
                  type="submit"
                  disabled={isSendingInput}
                  data-tooltip="Send input"
                  aria-label="Send input"
                >
                  <CornerDownLeft size={12} />
                  <span className="sr-only">Send input</span>
                </StdinButton>
              </StdinForm>
            )}
          </AccordionBody>
        </AnimatedAccordion>
      </InnerWrapper>
    </CardContainer>
  );
};
