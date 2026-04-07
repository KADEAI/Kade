import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  memo,
  useCallback,
} from "react";
import { Check } from "lucide-react";
import styled, { keyframes, css } from "styled-components";
import { ToolMessageWrapper } from "./ToolMessageWrapper";
import { ToolError } from "./ToolError";
import { FileIcon } from "./FileIcon";
import { HeaderActionTooltip } from "./HeaderActionTooltip";
import { vscode } from "@/utils/vscode";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { useUndo } from "../../../hooks/useUndo";
import { getHighlighter, normalizeLanguage } from "@/utils/highlighter";
import { getLanguageFromPath } from "@/utils/getLanguageFromPath";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { triggerConfetti } from "../../../utils/confetti";
import { getVirtualizedLineWindow } from "./virtualizedToolContent";
import {
  toolHeaderBackgroundOverlayCss,
  useToolHeaderBackground,
} from "@/hooks/useToolHeaderBackground";
import { resolveToolFilePath } from "./filePathResolver";

// WriteToolProps moved below to include autoApprovalEnabled

const LARGE_WRITE_HIGHLIGHT_CHAR_LIMIT = 40000;
const LARGE_WRITE_HIGHLIGHT_LINE_LIMIT = 1200;
const HIGHLIGHT_CACHE_LIMIT = 64;
const highlightedBlockCache = new Map<string, React.ReactNode>();

const countLinesFast = (content: string) => {
  if (!content) return 0;

  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      lines++;
    }
  }

  return lines;
};

const setCachedHighlight = (
  cache: Map<string, React.ReactNode>,
  key: string,
  value: React.ReactNode,
) => {
  cache.set(key, value);

  if (cache.size > HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
};

// --- ANIMATIONS ---

const glowGreen = keyframes`
    from { filter: drop-shadow(0 0 1px var(--vscode-testing-iconPassed)); opacity: 0.7; }
    to { filter: drop-shadow(0 0 5px var(--vscode-testing-iconPassed)); opacity: 1; }
`;

const penWriting = keyframes`
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    25% { transform: translate(0.5px, -0.5px) rotate(2deg); }
    50% { transform: translate(0px, 0.5px) rotate(-1deg); }
    75% { transform: translate(1px, 0px) rotate(1.5deg); }
`;

const pulse = keyframes`
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(0.8); opacity: 0.7; }
    100% { transform: scale(1); opacity: 1; }
`;

const _checkmarkPop = keyframes`
    0% { transform: scale(0); opacity: 0; }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); opacity: 1; }
`;

const blink = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
`;

const _fastSlideDown = keyframes`
    0% { opacity: 0; transform: translateY(-10px) scale(0.98); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
`;

// Calm premium entrance for the card instead of an abrupt pop.
const sleekFadeIn = keyframes`
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

// Completion celebration - subtle glow pulse
const completionCelebration = keyframes`
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.985;
    }
`;

// Success glow effect
const successGlow = keyframes`
    0% {
        box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
    }
    50% {
        box-shadow: 0 0 8px 0 rgba(56, 189, 248, 0.08);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
    }
`;

const spin = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

const fileNameShimmer = keyframes`
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
`;

const GreySpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 1.5px solid rgba(140, 140, 140, 0.25);
  border-top-color: rgba(160, 160, 160, 0.8);
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
  flex-shrink: 0;
  transform: translateY(1px);
`;

const FileNameShimmer = styled.span`
  display: inline-block;
  background: linear-gradient(
    120deg,
    rgb(145, 145, 145) 40%,
    rgba(220, 220, 220, 0.95) 50%,
    rgb(145, 145, 145) 60%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ${fileNameShimmer} 2.5s linear infinite;
  transform: translateZ(0);
  backface-visibility: hidden;
`;

const _rotateCW = keyframes`
    from { transform: rotate(-180deg) scale(0.5); opacity: 0; }
    to { transform: rotate(0deg) scale(1); opacity: 1; }
`;

const _rotateCCW = keyframes`
    from { transform: rotate(180deg) scale(0.5); opacity: 0; }
    to { transform: rotate(0deg) scale(1); opacity: 1; }
`;

const markdownRainbowBorder = `
  conic-gradient(
    from var(--angle),
    transparent 0deg,
    transparent 52deg,
    rgba(255, 84, 178, 0.22) 66deg,
    rgba(255, 170, 76, 0.28) 78deg,
    rgba(255, 244, 123, 0.38) 88deg,
    rgba(104, 230, 154, 0.28) 98deg,
    rgba(88, 197, 255, 0.22) 110deg,
    transparent 124deg,
    transparent 214deg,
    rgba(111, 120, 255, 0.2) 228deg,
    rgba(181, 104, 255, 0.24) 240deg,
    rgba(255, 98, 202, 0.2) 252deg,
    transparent 266deg,
    transparent 360deg
  )
`;

// --- STYLED COMPONENTS ---

const WriteCardContainer = styled.div<{
  $isExpanded: boolean;
  $isUndone?: boolean;
  $isError?: boolean;
  $shouldAnimate?: boolean;
  $justCompleted?: boolean;
  $isActive?: boolean;
}>`
  display: flex;
  flex-direction: column;
  /* Clean, modern dark surface */

  /* No external border or shadow for seamless look */
  border: none;
  box-shadow: none;
  border-radius: 10.6px;
  overflow: hidden;
  margin-top: 1px;
  margin-bottom: 2px;
  width: 100%;
  transform: translateZ(0);
  backface-visibility: hidden;
  contain: layout style paint;
  will-change: transform, opacity;
  isolation: isolate;

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
      rgba(56, 189, 248, 0.18) 72deg,
      rgba(255, 255, 255, 0.42) 84deg,
      transparent 96deg,
      transparent 220deg,
      rgba(56, 189, 248, 0.14) 232deg,
      rgba(255, 255, 255, 0.3) 244deg,
      transparent 256deg,
      transparent 360deg
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: ${({ $isActive }) => ($isActive ? 1 : 0)};
    transition: opacity 0.18s ease;
    animation: rotateBorderVar 5.6s linear infinite;
    pointer-events: none;
    z-index: 4;
  }

  /* Sleek fade-in animation */
  ${({ $shouldAnimate }) =>
    $shouldAnimate &&
    css`
      animation: ${sleekFadeIn} 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `}

  /* Completion celebration */
    ${({ $justCompleted }) =>
    $justCompleted &&
    css`
      animation:
        ${completionCelebration} 0.24s ease-out both,
        ${successGlow} 0.45s ease-out both;
    `}

    ${({ $isUndone }) =>
    $isUndone &&
    css`
      opacity: 0.6;
      filter: grayscale(0.5);
      text-decoration: line-through;
    `}

    &:hover {
    box-shadow: none;
  }
`;

const CardHeader = styled.div<{
  $clickable: boolean;
  $isExpanded?: boolean;
  $isError?: boolean;
}>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10.6px;
  flex-shrink: 0;
  min-width: 0;

  /* Solid header - Slightly brighter for high-tech feel */
  background: ${({ $isError }) =>
    $isError ? "rgba(255, 70, 70, 0.12)" : "rgba(24, 24, 24, 1)"};

  /* Opaque mix: transparent borders fade at BL/BR joins vs the body below */
   border: 1.5px solid rgba(82, 82, 82, 0.22);
    color-mix(in srgb, var(--vscode-widget-border) 60%, var(--vscode-editor-background));
  /* Collapsed: full radius vs parent clip; expanded: top only + CardBody bottom radius. */
  border-radius: ${({ $isExpanded }) =>
    $isExpanded ? "10.6px 10.6px 0 0" : "10.6px"};

  /* Subtle top highlight for the metallic header treatment */
  box-shadow: inset 0 0px 0 rgba(255, 255, 255, 0);

  height: 33px !important;
  min-height: 33px !important;
  cursor: default;
  /* Avoid clipping the border at rounded corners; truncation lives on FileInfo. */
  overflow: visible;
  gap: 4px;
  z-index: 1;
  transition:
    background 0.15s ease,
    border-radius 0.2s ease;
  ${toolHeaderBackgroundOverlayCss}

  ${({ $isError }) =>
    $isError &&
    css`
      height: auto;
      min-height: 26px;
      padding: 3px 12px;
    `}

  ${({ $clickable }) =>
    $clickable &&
    css`
      cursor: pointer;
    `}
`;

// HeaderContent removed as it was causing nesting overflow issues

const TitleSection = styled.div<{
  $status: "writing" | "written" | "failed" | "normal";
}>`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex: 1;
  min-width: 0;

  .tool-title {
    color: ${({ $status }) =>
      $status === "writing"
        ? "var(--vscode-textLink-activeForeground)"
        : $status === "written"
          ? "var(--vscode-textLink-activeForeground)"
          : $status === "failed"
            ? "var(--vscode-errorForeground)"
            : "var(--vscode-textLink-activeForeground)"};
  }
`;

const _IconWrapper = styled.div<{ $isScanning: boolean }>`
  display: flex;
  align-items: center;
  color: var(--vscode-textLink-activeForeground);
  opacity: 0.9;

  ${({ $isScanning }) =>
    $isScanning &&
    css`
      animation:
        ${glowGreen} 1.5s infinite alternate,
        ${penWriting} 2s ease-in-out infinite;
      transform-origin: bottom right;
    `}
`;

const FileInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  min-width: 0;
  margin-top: 0px;
  flex: 1;
`;

const NewBadge = styled.span`
  display: inline-block;
  font-size: 9px;
  font-weight: 900;
  font-style: italic;
  background: linear-gradient(
    90deg,
    #4ade80 0%,
    #38bdf8 25%,
    #2dd4bf 50%,
    #38bdf8 75%,
    #4ade80 100%
  );
  background-size: 200% auto;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ${fileNameShimmer} 2s linear infinite;
  text-transform: lowercase;
  vertical-align: super;
  line-height: 0;
  margin-left: 2px;
  filter: drop-shadow(0 0 3px rgba(74, 222, 128, 0.4));
`;

const FileName = styled.span`
  font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
  font-size: 13px;
  font-weight: 500;
  line-height: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: color-mix(in srgb, var(--vscode-foreground) 51%, transparent);
  cursor: pointer;
  max-width: 100%;
  transition:
    color 0.2s ease,
    opacity 0.2s ease;

  &:hover {
    color: var(--vscode-textLink-foreground);
  }

  &:hover > span:first-child {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

const StatusSection = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 36px;
  justify-content: flex-end;
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

const ActionButton = styled.div<{
  $isError?: boolean;
  $clickable?: boolean;
  $isRedo?: boolean;
}>`
  ${hoverTooltipStyles}
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  cursor: ${({ $clickable }) => ($clickable ? "pointer" : "default")};
  transition:
    transform 0.2s ease,
    color 0.2s ease,
    filter 0.2s ease;
  position: relative;
  margin: 4px 0;
  pointer-events: auto;

  background: transparent;
  border: none;

  color: rgba(123, 123, 123, 0.7);

  &:hover {
    ${({ $clickable, $isRedo }) =>
      $clickable &&
      css`
        transform: scale(1.15);
        color: ${$isRedo ? "#4ade80" : "#ffb86c"};
        filter: drop-shadow(
          0 0 8px
            ${$isRedo ? "rgba(74, 222, 128, 0.4)" : "rgba(255, 184, 108, 0.4)"}
        );
      `}
  }

  &:active {
    transform: scale(0.95);
  }

  svg {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
  }

  ${({ $isError }) =>
    $isError &&
    css`
      color: var(--vscode-errorForeground);
      &:hover {
        filter: drop-shadow(0 0 6px rgba(248, 113, 113, 0.4));
      }
    `}

  ${({ $isRedo }) =>
    $isRedo &&
    css`
      color: #60a871;
    `}
`;

const AnimIcon = styled.div<{ $direction: "cw" | "ccw" }>`
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center;
  animation: ${({ $direction }) =>
      $direction === "cw" ? _rotateCW : _rotateCCW}
    0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
`;

const MiniDiffStats = styled.div`
  display: flex;
  gap: 6px;
  font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 700;
  opacity: 0.8;
`;

const StatAdd = styled.span`
  color: #3ab564;
`;

const PulseLoader = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--vscode-textLink-activeForeground);
  animation: ${pulse} 1.5s infinite ease-in-out;
`;

const CardBody = styled.div`
  background: var(--vscode-editor-background);
  border-radius: 0 0 10.6px 10.6px;
  overflow: hidden;
`;

const WriteView = styled.div`
  display: flex;
  flex-direction: column;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px);
  font-weight: var(--vscode-editor-font-weight, normal);
  border: none;
  overflow: hidden;
`;

const WriteScrollContainer = styled.div<{ $isStreaming?: boolean }>`
  display: flex;
  max-height: 96px; /* Restored to user-approved height */
  background-color: rgba(58, 64, 40, 0.99);
  position: relative;
  overflow: hidden;
  filter: brightness(1.1); /* Slightly lower brightness for better balance */

  ${({ $isStreaming }) =>
    $isStreaming &&
    css`
      &::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image: radial-gradient(
          circle,
          rgba(0, 0, 0, 0.45) 1px,
          transparent 1px
        );
        background-size: 4px 4px;
        background-position: 0 0;
        z-index: 2;
      }
    `}
`;

const GradientOverlay = styled.div<{ $isVisible: boolean }>`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: linear-gradient(
    to bottom,
    transparent,
    var(--vscode-editor-background)
  );
  pointer-events: none;
  z-index: 4;
  opacity: ${(props) => (props.$isVisible ? 1 : 0)};
  display: ${(props) => (props.$isVisible ? "block" : "none")};
`;

const WriteContent = styled.div.attrs({ className: "anchored-container" })`
  flex: 1;
  overflow: auto;
  position: relative;
  padding-top: 4px;
  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  &::-webkit-scrollbar-track {
    background-color: rgba(58, 64, 40, 0.99);
  }
  &::-webkit-scrollbar-thumb {
    background-color: color-mix(
      in srgb,
      var(--vscode-scrollbarSlider-background) 40%,
      transparent
    );
    border: 2px solid transparent;
    background-clip: content-box;
    border-radius: 10px;
  }
  &::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

const ContentText = styled.div`
  background-color: rgba(58, 64, 40, 0.99);
  color: #ffffff;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  font-weight: var(--vscode-editor-font-weight, normal);
  line-height: 1.45;
  margin: 0;
  padding: 1.4px 14px;
  white-space: pre-wrap;
  word-break: break-all;
  width: 100%;

  * {
    font-family: var(--vscode-editor-font-family) !important;
    font-size: 11px !important;
    font-weight: var(--vscode-editor-font-weight, normal) !important;
  }
`;

const TypingCursor = styled.span`
  display: inline-block;
  width: 6px;
  height: 15px;
  background-color: var(--vscode-editorCursor-foreground);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: ${blink} 1s step-end infinite;
`;

const _Chevron = styled.span<{ $isExpanded: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isExpanded }) =>
    $isExpanded ? "rotate(90deg)" : "rotate(0deg)"};
  margin-left: -2px;
`;

// --- MARKDOWN CARD ---

const MarkdownCardContainer = styled.div<{
  $shouldAnimate?: boolean;
  $isStreaming?: boolean;
}>`
  display: flex;
  align-items: center;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 12px;
  padding: 12px;
  margin-top: 5px;
  margin-bottom: 5px;
  position: relative;
  overflow: visible;
  box-shadow: none;
  isolation: isolate;

  ${({ $isStreaming }) =>
    $isStreaming &&
    css`
      &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: ${markdownRainbowBorder};
        -webkit-mask:
          linear-gradient(#fff 0 0) content-box,
          linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        animation: rotateBorderVar 5.6s linear infinite;
        pointer-events: none;
        z-index: 2;
      }
    `}

  &:hover {
    border-color: color-mix(in srgb, var(--vscode-widget-border) 80%, white);
  }
`;

const MdIconBox = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: color-mix(
    in srgb,
    var(--vscode-textLink-activeForeground) 10%,
    transparent
  );
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--vscode-textLink-activeForeground);
  margin-right: 12px;
`;

const MdInfo = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const MdFilename = styled.span`
  font-weight: 600;
  font-size: 13px;
  color: var(--vscode-foreground);
`;

const MdStats = styled.span`
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
`;

const MdOpenBtn = styled.button`
  background: transparent;
  border: 1px solid var(--vscode-button-backgroound);
  color: var(--vscode-textLink-foreground);
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: var(--vscode-list-hoverBackground);
  }
`;

// --- ERROR PANEL (Reused from EditTool mostly) ---
const ErrorBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.2s;
  background: #490808;
  color: #ff8d8d;
  border: 1px solid #7a1b1b;
  pointer-events: auto;
  &:hover {
    transform: scale(1.05);
    background: #5c0a0a;
  }
`;

const _UndoButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px;
  margin: 0 4px;
  border-radius: 4px;
  transition: all 0.2s;
  pointer-events: auto;
  user-select: none;

  &:hover {
    background: rgba(255, 100, 100, 0.2);
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const ErrorDetailsPanel = styled.div`
  background: #252526;
  border-top: 1px solid #454545;
  padding: 0;
`;
const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 100, 100, 0.1);
  color: #ff8d8d;
  font-size: 11px;
  font-weight: 600;
`;
const PanelContent = styled.div`
  padding: 8px 12px;
`;
const IssueItem = styled.div`
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  border-bottom: 1px solid rgba(80, 22, 22, 0.05);
  &:last-child {
    border-bottom: none;
  }
`;
const IssuePos = styled.div`
  color: #888;
  min-width: 50px;
`;
const IssueMsg = styled.div`
  color: #ccc;
  flex: 1;
`;
const ActionBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: var(--vscode-button-hoverBackground);
  }
`;

import { AnimatedAccordion } from "../../common/AnimatedAccordion";

// --- HIGHLIGHTING COMPONENT ---

const HighlightedBlock = memo(
  ({
    content,
    language,
    shouldHighlight,
  }: {
    content: string;
    language: string;
    shouldHighlight: boolean;
  }) => {
    const [elements, setElements] = useState<React.ReactNode>(content);

    // KILOCODE LIVE-STREAM FIX: Immediately show raw content when it updates
    // to prevent the UI from appearing frozen while waiting for the highlighter.
    useEffect(() => {
      setElements(content);
    }, [content]);

    useEffect(() => {
      if (!shouldHighlight || !content) {
        setElements(content);
        return;
      }

      let isMounted = true;
      let highlightTimeout: number | null = null;
      const highlight = async () => {
        try {
          const theme = document.body.className.toLowerCase().includes("light")
            ? "light-plus"
            : "dark-plus";
          const normalizedLanguage = normalizeLanguage(language);
          const cacheable = content.length <= 8000;
          const cacheKey = cacheable
            ? `${theme}:${normalizedLanguage}:${content}`
            : null;

          if (cacheKey) {
            const cachedResult = highlightedBlockCache.get(cacheKey);
            if (cachedResult) {
              setElements(cachedResult);
              return;
            }
          }

          const highlighter = await getHighlighter(language);
          if (!isMounted) return;

          const hast = await highlighter.codeToHast(content, {
            lang: normalizedLanguage,
            theme: theme,
            transformers: [
              {
                span(node) {
                  // Remove font-family from inline styles to let CSS handle it
                  if (node.properties.style) {
                    node.properties.style = (
                      node.properties.style as string
                    ).replace(/font-family:[^;]+;?/g, "");
                  }
                  return node;
                },
              },
            ],
          });

          if (!isMounted) return;

          // Unwrap the pre/code to avoid background styles.
          const pre = hast.children.find((n: any) => n.tagName === "pre");
          const code = pre
            ? (pre as any).children.find((n: any) => n.tagName === "code")
            : null;

          // Flatten children of the code element (lines and text nodes)
          const targetNodes = code ? (code as any).children : [];

          if (targetNodes.length > 0) {
            const reactElements = toJsxRuntime(
              { type: "element", tagName: "div", children: targetNodes } as any,
              {
                Fragment,
                jsx,
                jsxs,
              },
            );
            if (isMounted) {
              if (cacheKey) {
                setCachedHighlight(
                  highlightedBlockCache,
                  cacheKey,
                  reactElements,
                );
              }
              setElements(reactElements);
            }
          } else {
            if (isMounted) setElements(content);
          }
        } catch (e) {
          console.error("Highlight error:", e);
          if (isMounted) {
            setElements(content);
          }
        }
      };

      highlightTimeout = window.setTimeout(() => {
        void highlight();
      }, 16);

      return () => {
        isMounted = false;
        if (highlightTimeout !== null) {
          window.clearTimeout(highlightTimeout);
        }
      };
    }, [content, language, shouldHighlight]);

    return (
      <div
        style={{
          fontFamily:
            "var(--vscode-editor-font-family), 'Apple Color Emoji', monospace",
          fontSize: "11px",
          fontWeight: "var(--vscode-editor-font-weight, normal)",
        }}
      >
        {elements}
      </div>
    );
  },
);

export interface WriteToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  autoApprovalEnabled?: boolean; // kade_change: accept auto-approval setting
}

const WriteToolComponent: React.FC<WriteToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  autoApprovalEnabled,
}) => {
  const { collapseCodeToolsByDefault = false } = useExtensionState();
  const headerBackground = useToolHeaderBackground("write");
  const { isUndone, handleUndo, handleRedo } = useUndo(tool?.id);

  // kade_change: Handlers for manual permission buttons
  const [actionPending, setActionPending] = useState(false);
  const [actionFlash, setActionFlash] = useState<"undone" | "redone" | null>(
    null,
  );

  const handleAllow = useCallback(() => {
    setActionPending(true);
    vscode.postMessage({
      type: "askResponse",
      askResponse: "yesButtonClicked",
    });
  }, []);

  const handleDeny = useCallback(() => {
    setActionPending(true);
    vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" });
  }, []);

  const [isExpanded, setIsExpanded] = useState(!collapseCodeToolsByDefault);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Sticky: only animate on first mount, never re-trigger when isLastMessage flips
  const shouldAnimateOnceRef = useRef(isLastMessage && shouldAnimate);
  const didAnimate = shouldAnimateOnceRef.current;

  const filePath = useMemo(
    () => resolveToolFilePath(tool, toolResult),
    [tool, toolResult],
  );
  const fileName = useMemo(() => {
    if (!filePath) return "Unknown File";
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }, [filePath]);

  const isMarkdown = fileName.toLowerCase().endsWith(".md");
  const lastContentRef = useRef("");
  const content = useMemo(() => {
    // Prefer live streaming content from tool, otherwise fall back to final toolResult
    // kade_change: Support nested params.content for new parser structure, fallback to flat tool.content
    const streamingContent = tool.params?.content ?? tool.content;
    const rawCandidate =
      streamingContent ??
      (toolResult && toolResult.content ? toolResult.content : "") ??
      "";

    const hasText =
      typeof rawCandidate === "string" && rawCandidate.trim().length > 0;

    // Only replace the cache if the new payload is non-empty AND not shorter than what we already have
    // (prevents a late short payload from wiping most of the streamed content)
    if (hasText && rawCandidate.length >= lastContentRef.current.length) {
      lastContentRef.current = rawCandidate;
    }

    // If the incoming payload is empty/short, keep showing the cached content
    const effective = hasText
      ? rawCandidate
      : lastContentRef.current || rawCandidate || "";
    return effective;
  }, [tool.content, tool.params, toolResult]);

  const contentLineCount = useMemo(() => countLinesFast(content), [content]);
  const shouldRenderBody = isExpanded;

  const displayContent = useMemo(() => {
    if (!shouldRenderBody) {
      return "";
    }

    const trimmed = content.trim();
    if (trimmed.startsWith("@@") || trimmed.startsWith("diff --git")) {
      return content
        .split("\n")
        .filter(
          (line: string) =>
            !line.startsWith("@@") &&
            !line.startsWith("diff --git") &&
            !line.startsWith("index "),
        )
        .map((line: string) => (line.startsWith("+") ? line.slice(1) : line))
        .join("\n")
        .trimEnd();
    }
    return content.trimEnd();
  }, [content, shouldRenderBody]);

  const displayContentLineCount = useMemo(() => {
    if (!shouldRenderBody || !displayContent) {
      return 0;
    }

    return countLinesFast(displayContent);
  }, [displayContent, shouldRenderBody]);
  const displayLines = useMemo(() => {
    if (!shouldRenderBody || !displayContent) {
      return [];
    }

    return displayContent.split("\n");
  }, [displayContent, shouldRenderBody]);
  const contentWindow = useMemo(
    () =>
      getVirtualizedLineWindow({
        lineCount: displayLines.length,
        scrollTop,
      }),
    [displayLines.length, scrollTop],
  );
  const visibleContent = useMemo(() => {
    if (!shouldRenderBody) {
      return "";
    }

    if (!contentWindow.enabled) {
      return displayContent;
    }

    return displayLines
      .slice(contentWindow.start, contentWindow.end)
      .join("\n");
  }, [
    contentWindow.enabled,
    contentWindow.end,
    contentWindow.start,
    displayContent,
    displayLines,
    shouldRenderBody,
  ]);

  const contentStats = useMemo(() => {
    if (!content) return null;
    return {
      lines: contentLineCount,
      chars: content.length,
    };
  }, [content, contentLineCount]);

  // Sticky: once content has been shown, never hide it (prevents unmount/remount flicker)
  const hasContentViewRef = useRef(false);
  const hasContentViewRaw = !!content && !toolResult?.is_error;

  useEffect(() => {
    if (hasContentViewRaw) {
      hasContentViewRef.current = true;
    }
  }, [hasContentViewRaw]);

  const hasContentView = useMemo(() => {
    return hasContentViewRef.current || hasContentViewRaw;
  }, [hasContentViewRaw]);

  // kade_change: Hide permission buttons if auto-approved
  // Treat undefined as true (the default) to prevent button flash during initial render
  const isPermissionRequest =
    !toolResult && isLastMessage && autoApprovalEnabled === false;

  const errorMessage = useMemo(() => {
    if (!toolResult) return null;
    if (typeof toolResult.error === "string" && toolResult.error)
      return toolResult.error;

    const content =
      typeof toolResult?.content === "string"
        ? toolResult.content
        : Array.isArray(toolResult?.content)
          ? toolResult.content.map((c: any) => c.text).join("")
          : "";

    const hasErrorString =
      content.includes("The tool execution failed") ||
      content.includes("Could not find a unique match") ||
      content.includes("Permission denied") ||
      content.includes("Error:");

    return hasErrorString ? content : null;
  }, [toolResult]);

  const isError = useMemo(() => {
    if (toolResult?.is_error) return true;
    return !!errorMessage;
  }, [toolResult, errorMessage]);

  // Automatically expand on error
  useEffect(() => {
    if (isError) {
      setIsExpanded(true);
    }
  }, [isError]);

  const statusValue = useMemo(() => {
    if (isError) return "failed";
    if (isPermissionRequest) return "writing";
    return "written";
  }, [isError, isPermissionRequest]);

  // Ensure ToolError receives an object with is_error: true if we detected an error
  // Ensure ToolError receives an object with is_error: true and a STRING content
  const displayResult = useMemo(() => {
    if (!isError) return toolResult;

    const normalizedContent =
      errorMessage ||
      (typeof toolResult?.content === "string"
        ? toolResult.content
        : Array.isArray(toolResult?.content)
          ? toolResult.content
              .map((c: any) => c.text || JSON.stringify(c))
              .join("\n")
          : "Unknown Error");

    return {
      ...toolResult,
      is_error: true,
      content: normalizedContent,
    };
  }, [isError, toolResult, errorMessage]);

  // Errors
  const errors = useMemo(() => {
    if (!toolResult?.content) return [];
    const contentStr =
      typeof toolResult.content === "string"
        ? toolResult.content
        : Array.isArray(toolResult.content)
          ? toolResult.content.map((c: any) => c.text).join("")
          : "";

    const diagnostics: { line: number; message: string }[] = [];
    const diagnosticMatch = contentStr.match(
      /<diagnostic_summary>([\s\S]*?)<\/diagnostic_summary>/,
    );
    if (diagnosticMatch) {
      const diagLines = diagnosticMatch[1].split("\n");
      for (const line of diagLines) {
        const m = line.match(/\(line\s+(\d+).*?:\s*(.+)$/);
        if (m) diagnostics.push({ line: parseInt(m[1]), message: m[2].trim() });
      }
    }
    return diagnostics;
  }, [toolResult]);

  const handleContentScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    },
    [],
  );

  // Auto-scroll for streaming content
  // Sticky: once streaming ends, don't flip back to streaming state (prevents flash)
  const isStreamingRaw = !!(isLastMessage && !toolResult);
  const wasStreamingRef = useRef(false);
  const streamingEndedRef = useRef(false);

  useEffect(() => {
    if (isStreamingRaw) {
      wasStreamingRef.current = true;
    } else if (wasStreamingRef.current) {
      streamingEndedRef.current = true;
    }
  }, [isStreamingRaw]);

  // Once streaming has ended, never show streaming state again for this component instance
  const isStreaming = useMemo(() => {
    if (streamingEndedRef.current) return false;
    return isStreamingRaw;
  }, [isStreamingRaw]);

  const shouldHighlightContent = useMemo(() => {
    if (!shouldRenderBody || isStreaming || !displayContent) {
      return false;
    }

    return (
      displayContent.length <= LARGE_WRITE_HIGHLIGHT_CHAR_LIMIT &&
      displayContentLineCount <= LARGE_WRITE_HIGHLIGHT_LINE_LIMIT
    );
  }, [displayContent, displayContentLineCount, isStreaming, shouldRenderBody]);

  // Completion celebration state
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    if (!actionFlash) {
      return;
    }

    const timeoutId = window.setTimeout(() => setActionFlash(null), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [actionFlash]);
  const previousStreamingRef = useRef(isStreaming);

  useEffect(() => {
    // Trigger celebration when streaming just finished
    if (
      previousStreamingRef.current &&
      !isStreaming &&
      !isError &&
      toolResult
    ) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 320);
      return () => clearTimeout(timer);
    }
    previousStreamingRef.current = isStreaming;
  }, [isStreaming, isError, toolResult]);
  useEffect(() => {
    if (isStreaming && shouldRenderBody && contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
      });
    }
  }, [content, isStreaming, shouldRenderBody]);

  useEffect(() => {
    if (!contentWindow.enabled && scrollTop !== 0) {
      setScrollTop(0);
    }
  }, [contentWindow.enabled, scrollTop]);

  const sendErrorsToAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (errors.length === 0) return;
    let errorText = `Please fix these ${errors.length} error(s) in ${filePath}: \n\n`;
    errors.forEach((err, idx) => {
      errorText += `${idx + 1}. Line ${err.line}: ${err.message} \n`;
    });
    window.dispatchEvent(
      new CustomEvent("appendToChatInput", { detail: { text: errorText } }),
    );
    setShowErrorDetails(false);
  };

  if (!filePath && !isError) {
    return null;
  }

  return (
    <ToolMessageWrapper
      toolIcon="codicon-new-file"
      toolName="Write"
      /*
               Pass is_error: false to the wrapper to ensure our custom
               WriteCardContainer handles the error UI and expansion.
            */
      toolResult={toolResult ? { ...toolResult, is_error: false } : undefined}
      isCustomLayout={true}
      shouldAnimate={shouldAnimate}
      permissionState={isPermissionRequest ? "pending" : "allowed"}
      onAllow={handleAllow}
      onDeny={handleDeny}
      checkPending={actionPending}
    >
      {/* Markdown Card UI */}
      {isMarkdown ? (
        <MarkdownCardContainer
          $shouldAnimate={isLastMessage}
          $isStreaming={isStreaming}
        >
          <MdIconBox>
            <span className="codicon codicon-markdown"></span>
          </MdIconBox>
          <MdInfo>
            <MdFilename>{fileName}</MdFilename>
            {contentStats && <MdStats>{contentStats.lines} lines</MdStats>}
          </MdInfo>
          <MdOpenBtn
            onClick={() =>
              vscode.postMessage({ type: "openFile", text: filePath })
            }
          >
            Open
          </MdOpenBtn>
        </MarkdownCardContainer>
      ) : (
        <WriteCardContainer
          $isExpanded={isExpanded}
          $isUndone={isUndone}
          $isError={isError}
          $shouldAnimate={didAnimate}
          $justCompleted={justCompleted}
          $isActive={isStreaming || isPermissionRequest}
        >
          <CardHeader
            $clickable={hasContentView || isError}
            $isExpanded={isExpanded}
            $isError={isError}
            style={headerBackground.style}
            onClick={() =>
              (hasContentView || isError) && setIsExpanded(!isExpanded)
            }
          >
            <TitleSection $status={statusValue as any}>
              {/* Icons removed for simplistic look */}
              <FileInfo>
                {filePath && (
                  <div
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                      position: "relative",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      vscode.postMessage({ type: "openFile", text: filePath });
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        opacity: isStreaming ? 1 : 0,
                        transition: "opacity 0.15s ease-out",
                      }}
                    >
                      <GreySpinner />
                    </div>
                    <div
                      style={{
                        opacity: isStreaming ? 0 : 1,
                        transition: "opacity 0.15s ease-in",
                        transform: "translateY(-0.94px)",
                      }}
                    >
                      <FileIcon fileName={filePath} size={14} />
                    </div>
                  </div>
                )}
                <FileName
                  className="truncate"
                  style={{ fontWeight: 400 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({ type: "openFile", text: filePath });
                  }}
                >
                  <span
                    style={{ position: "relative", display: "inline-block" }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        opacity: isStreaming ? 1 : 0,
                        transition: "opacity 0.15s ease-out",
                      }}
                    >
                      <FileNameShimmer>{fileName}</FileNameShimmer>
                    </span>
                    <span
                      style={{
                        opacity: isStreaming ? 0 : 1,
                        transition: "opacity 0.15s ease-in",
                      }}
                    >
                      {fileName}
                    </span>
                  </span>
                  {tool.tool === "newFileCreated" && <NewBadge>new</NewBadge>}
                </FileName>
              </FileInfo>
            </TitleSection>

            <StatusSection>
              {errors.length > 0 && (
                <ErrorBadge
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowErrorDetails(!showErrorDetails);
                  }}
                >
                  <span className="codicon codicon-warning"></span>
                  <span>{errors.length}</span>
                </ErrorBadge>
              )}

              {contentStats && (
                <MiniDiffStats>
                  <StatAdd>+{contentStats.lines}</StatAdd>
                </MiniDiffStats>
              )}

              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    opacity: isLastMessage && !toolResult ? 1 : 0,
                    transition: "opacity 0.15s",
                    pointerEvents:
                      isLastMessage && !toolResult ? "auto" : "none",
                  }}
                >
                  <PulseLoader />
                </div>
                <div
                  style={{
                    opacity: isLastMessage && !toolResult ? 0 : 1,
                    transition: "opacity 0.15s",
                    pointerEvents:
                      isLastMessage && !toolResult ? "none" : "auto",
                  }}
                >
                  {isUndone ? (
                    <HeaderActionTooltip
                      content={actionFlash === "undone" ? "Reverted" : "Redo"}
                    >
                      <ActionButton
                        $clickable={true}
                        $isRedo={true}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionFlash("redone");
                          handleRedo();
                          triggerConfetti(e.clientX, e.clientY, "#4facff");
                        }}
                        aria-label={
                          actionFlash === "undone" ? "Reverted" : "Redo"
                        }
                      >
                        {actionFlash === "undone" ? (
                          <AnimIcon key="undone" $direction="cw">
                            <Check size={16} strokeWidth={2.2} />
                          </AnimIcon>
                        ) : (
                          <AnimIcon key="redo" $direction="cw">
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M21 7v6h-6" />
                              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                            </svg>
                          </AnimIcon>
                        )}
                      </ActionButton>
                    </HeaderActionTooltip>
                  ) : (
                    <HeaderActionTooltip
                      content={
                        isError
                          ? undefined
                          : actionFlash === "redone"
                            ? "Reapplied"
                            : "Undo"
                      }
                    >
                      <ActionButton
                        $isError={isError}
                        $clickable={!isError}
                        onClick={(e) => {
                          if (!isError) {
                            e.stopPropagation();
                            setActionFlash("undone");
                            handleUndo();
                            triggerConfetti(e.clientX, e.clientY, "#ffb86c");
                          }
                        }}
                        aria-label={
                          isError
                            ? undefined
                            : actionFlash === "redone"
                              ? "Reapplied"
                              : "Undo"
                        }
                        title={
                          isError
                            ? "The model performed a malformed write. LLMs are not perfect and may occasionally fail to generate correct content."
                            : undefined
                        }
                      >
                        {isError ? (
                          <span
                            className="codicon codicon-info"
                            style={{ color: "var(--vscode-editor-foreground)" }}
                          ></span>
                        ) : actionFlash === "redone" ? (
                          <AnimIcon key="redone" $direction="cw">
                            <Check size={16} strokeWidth={2.2} />
                          </AnimIcon>
                        ) : (
                          <AnimIcon key="undo" $direction="ccw">
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 7v6h6" />
                              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3l-3 2.7" />
                            </svg>
                          </AnimIcon>
                        )}
                      </ActionButton>
                    </HeaderActionTooltip>
                  )}
                </div>
              </div>
            </StatusSection>
          </CardHeader>

          <AnimatedAccordion
            isExpanded={isExpanded}
            unmountWhenCollapsed={true}
          >
            <CardBody>
              {hasContentView && (
                <WriteView>
                  <WriteScrollContainer $isStreaming={isStreaming}>
                    <GradientOverlay $isVisible={isStreaming} />
                    <WriteContent
                      ref={contentRef}
                      onScroll={handleContentScroll}
                    >
                      <ContentText>
                        {contentWindow.enabled &&
                          contentWindow.topSpacerHeight > 0 && (
                            <div
                              aria-hidden="true"
                              style={{ height: contentWindow.topSpacerHeight }}
                            />
                          )}
                        <HighlightedBlock
                          content={visibleContent}
                          language={getLanguageFromPath(filePath) || "txt"}
                          shouldHighlight={shouldHighlightContent}
                        />
                        {contentWindow.enabled &&
                          contentWindow.bottomSpacerHeight > 0 && (
                            <div
                              aria-hidden="true"
                              style={{
                                height: contentWindow.bottomSpacerHeight,
                              }}
                            />
                          )}
                        {isPermissionRequest &&
                          (!contentWindow.enabled ||
                            contentWindow.end === displayLines.length) && (
                            <TypingCursor />
                          )}
                      </ContentText>
                    </WriteContent>
                  </WriteScrollContainer>
                </WriteView>
              )}
              {isError && (
                <div style={{ padding: "0 8px" }}>
                  <ToolError toolResult={displayResult} />
                </div>
              )}
            </CardBody>
          </AnimatedAccordion>

          {/* Error Details Panel */}
          {showErrorDetails && errors.length > 0 && (
            <ErrorDetailsPanel>
              <PanelHeader>
                <span className="codicon codicon-warning"></span>
                <span
                  style={{
                    fontFamily: "Consolas, monospace",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  Found {errors.length} issues
                </span>
                <span
                  className="codicon codicon-close"
                  style={{ marginLeft: "auto", cursor: "pointer" }}
                  onClick={() => setShowErrorDetails(false)}
                ></span>
              </PanelHeader>
              <PanelContent>
                {errors.map((err, i) => (
                  <IssueItem key={i}>
                    <IssuePos>Line {err.line}</IssuePos>
                    <IssueMsg>{err.message}</IssueMsg>
                  </IssueItem>
                ))}
                <ActionBtn onClick={sendErrorsToAgent}>
                  <span className="codicon codicon-hubot"></span>
                  Fix all issues with Agent
                </ActionBtn>
              </PanelContent>
            </ErrorDetailsPanel>
          )}
        </WriteCardContainer>
      )}
    </ToolMessageWrapper>
  );
};

export const WriteTool = memo(WriteToolComponent);
