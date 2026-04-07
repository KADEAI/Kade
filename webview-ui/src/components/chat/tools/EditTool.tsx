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
import * as Diff from "diff";
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
import { getEditErrorMessage } from "./editToolUtils";
import { getVirtualizedLineWindow } from "./virtualizedToolContent";
import {
  toolHeaderBackgroundOverlayCss,
  useToolHeaderBackground,
} from "@/hooks/useToolHeaderBackground";
import { resolveToolFilePath } from "./filePathResolver";

const LARGE_EDIT_HIGHLIGHT_CHAR_LIMIT = 12000;
const LARGE_EDIT_HIGHLIGHT_LINE_LIMIT = 300;
const EDIT_LINE_HIGHLIGHT_CACHE_LIMIT = 512;
const highlightedLineCache = new Map<string, React.ReactNode>();

const setCachedHighlight = (
  cache: Map<string, React.ReactNode>,
  key: string,
  value: React.ReactNode,
) => {
  cache.set(key, value);

  if (cache.size > EDIT_LINE_HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
};

const getDiffLineType = (line: string): "add" | "remove" | "context" => {
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("+")) return "add";
  return "context";
};

interface RenderedDiffLine {
  key: string;
  type: "add" | "remove" | "context";
  content: string;
}

const getDiffStatsFromContent = (content: string) => {
  if (!content) {
    return null;
  }

  let added = 0;
  let removed = 0;

  for (const line of content.split("\n")) {
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("\\")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      added++;
    } else if (line.startsWith("-")) {
      removed++;
    }
  }

  if (added === 0 && removed === 0) {
    return null;
  }

  return { added, removed };
};

const getLineCount = (content: string | undefined) => {
  if (!content) {
    return 0;
  }

  return content.split("\n").length;
};

const getDiffStatsFromEdits = (edits: any[]) => {
  if (!Array.isArray(edits) || edits.length === 0) {
    return null;
  }

  let added = 0;
  let removed = 0;

  for (const edit of edits) {
    added += getLineCount(edit?.newText || "");
    removed += getLineCount(edit?.oldText || "");
  }

  if (added === 0 && removed === 0) {
    return null;
  }

  return { added, removed };
};

const getDiffStatsFromStructuredPatch = (structuredPatch: any) => {
  if (!Array.isArray(structuredPatch) || structuredPatch.length === 0) {
    return null;
  }

  let added = 0;
  let removed = 0;

  for (const hunk of structuredPatch) {
    for (const line of hunk?.lines || []) {
      if (
        line.startsWith("+++") ||
        line.startsWith("---") ||
        line.startsWith("\\")
      ) {
        continue;
      }

      if (line.startsWith("+")) {
        added++;
      } else if (line.startsWith("-")) {
        removed++;
      }
    }
  }

  if (added === 0 && removed === 0) {
    return null;
  }

  return { added, removed };
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

const fadeIn = keyframes`
    from { opacity: 0; }
    to { opacity: 1; }
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
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
    }
    50% {
        box-shadow: 0 0 10px 0 rgba(74, 222, 128, 0.08);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
    }
`;

const blink = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
`;

const rotateCW = keyframes`
    from { transform: rotate(-180deg) scale(0.5); opacity: 0; }
    to { transform: rotate(0deg) scale(1); opacity: 1; }
`;

const rotateCCW = keyframes`
    from { transform: rotate(180deg) scale(0.5); opacity: 0; }
    to { transform: rotate(0deg) scale(1); opacity: 1; }
`;

const _fastSlideDown = keyframes`
    0% { opacity: 0; transform: translateY(-10px) scale(0.98); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
`;

const spin = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

const fileNameShimmer = keyframes`
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
`;

// --- STYLED COMPONENTS ---

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

const EditCardContainer = styled.div<{
  $isExpanded: boolean;
  $isUndone?: boolean;
  $isError?: boolean;
  $shouldAnimate?: boolean;
  $justCompleted?: boolean;
  $isActive?: boolean;
}>`
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: 10.6px;
  overflow: hidden;
  margin-top: 1px;
  margin-bottom: 2px;
  width: 100%;

  /* Clean, modern dark surface */
  background: "rgba(201, 34, 34, 1)"
  );

  /* No external border or shadow for seamless look */
  border: none;
  box-shadow: none;

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
      rgba(74, 222, 128, 0.18) 72deg,
      rgba(255, 255, 255, 0.42) 84deg,
      transparent 96deg,
      transparent 220deg,
      rgba(74, 222, 128, 0.14) 232deg,
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

  ${({ $isUndone }) =>
    $isUndone &&
    css`
      opacity: 0.5;
      filter: grayscale(0.5);
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
  /* Collapsed: full radius so the card clip doesn’t slice the header’s bottom border
     (square bottom + parent overflow:hidden looked like faint BL/BR). Expanded: top
     only so the body stacks flush (CardBody has bottom radius). */
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
  $status: "editing" | "edited" | "failed" | "normal" | "error-subtle";
}>`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex: 1;
  min-width: 0;
  transition: all 0.4s ease;

  .tool-title {
    transition: color 0.4s ease;
    color: ${({ $status }) =>
      $status === "editing"
        ? "var(--vscode-charts-blue)"
        : $status === "edited"
          ? "var(--vscode-charts-green)"
          : $status === "failed"
            ? "var(--vscode-errorForeground)"
            : $status === "error-subtle"
              ? "var(--vscode-descriptionForeground)"
              : "var(--vscode-textLink-activeForeground)"};
  }
`;

const _IconWrapper = styled.div<{ $isScanning: boolean }>`
  display: flex;
  align-items: center;
  color: var(--vscode-testing-iconPassed);
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

const _AnimatedErrorWrapper = styled.div`
  position: relative;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.5s ease-out;
`;

const FileInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  min-width: 0;
  margin-top: 0px;
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  flex: 1;
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

const DryRunBadge = styled.span`
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 3px;
  letter-spacing: 0.5px;
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

  &:hover {
    transform: scale(1.05);
    background: #5c0a0a;
  }
`;

const PartialSuccessBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: rgba(255, 193, 7, 0.1);
  color: rgba(255, 193, 7, 0.85);
  border: 1px solid rgba(255, 193, 7, 0.2);
  letter-spacing: 0.3px;

  &:hover {
    background: rgba(255, 193, 7, 0.18);
    border-color: rgba(255, 193, 7, 0.35);
  }
`;

const ActionButton = styled.div<{
  $isError?: boolean;
  $clickable?: boolean;
  $isRedo?: boolean;
}>`
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
  animation: ${({ $direction }) => ($direction === "cw" ? rotateCW : rotateCCW)}
    0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  transform-origin: center;
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
const StatRemove = styled.span`
  color: #d65d5d;
`;

const PulseLoader = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--vscode-testing-iconPassed);
  animation: ${pulse} 1.5s infinite ease-in-out;
`;

const _ErrorView = styled.div`
  padding: 10px 15px;
  background: color-mix(
    in srgb,
    var(--vscode-errorForeground) 10%,
    transparent
  );
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent);
`;

const _ErrorIcon = styled.div`
  color: var(--vscode-errorForeground);
  font-size: 16px;
  margin-top: 2px;
  flex-shrink: 0;
`;

const _ErrorText = styled.div`
  white-space: pre-wrap;
  line-height: 1.5;
  user-select: text;
  overflow-x: auto;
`;

const CardBody = styled.div`
  background: var(--vscode-editor-background);
  border-radius: 0 0 10.6px 10.6px;
  overflow: hidden;
`;

const ReplaceOption = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--vscode-charts-orange);
  font-size: 11px;
  font-weight: 500;
  padding: 8px 12px;
  border-bottom: 1px dashed
    color-mix(in srgb, var(--vscode-widget-border) 40%, transparent);
`;

// --- DIFF VIEW COMPONENTS ---
const DiffView = styled.div`
  display: flex;
  flex-direction: column;
  font-family:
    var(--vscode-editor-font-family), "Consolas", "Courier New", monospace;
  font-size: 11px;
  border: none;
  overflow: visible;
`;

const DiffScrollContainer = styled.div<{ $isStreaming?: boolean }>`
  display: flex;
  max-height: 96px; /* Restored to user-approved height */
  background-color: rgb(30, 30, 30);
  position: relative;
  overflow: hidden; /* Changed from visible to hidden to prevent layout instability */
  filter: brightness(1.22); /* Boost entire block brightness */

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

const _DiffLineNumbers = styled.div`
  width: 50px;
  flex-shrink: 0;
  overflow: hidden;
  background-color: color-mix(
    in srgb,
    var(--vscode-editor-background) 95%,
    transparent
  );
  border-right: 1px solid var(--vscode-panel-border);
  padding-top: 0px;
`;

const _LineNumberItem = styled.div<{ $type: "add" | "remove" | "context" }>`
  height: 22px;
  line-height: 22px;
  padding: 0 8px;
  text-align: right;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  font-weight: var(--vscode-editor-font-weight, normal);
  user-select: none;
  opacity: 0.56;
  color: var(--vscode-editorLineNumber-foreground);

  ${({ $type }) =>
    $type === "add" &&
    css`
      background: rgba(74, 222, 128, 0.1);
    `}

  ${({ $type }) =>
    $type === "remove" &&
    css`
      background: rgba(248, 113, 113, 0.1);
    `}
`;

const overlayScrollbarStyles = css`
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none; /* Firefox hide */

  &::-webkit-scrollbar {
    display: none; /* Chrome/Safari hide */
  }
`;

const CustomScrollbarTrack = styled.div`
  position: absolute;
  top: 4px;
  right: 2px;
  bottom: 4px;
  width: 6px;
  z-index: 100;
  pointer-events: none;
`;

const CustomScrollbarThumb = styled.div<{ $top: number; $height: number }>`
  position: absolute;
  right: 0;
  width: 6px;
  background: rgba(140, 140, 140, 0.5);
  border-radius: 10px;
  top: ${({ $top }) => $top}%;
  height: ${({ $height }) => $height}%;
  transition: opacity 0.2s;
  opacity: 0.3;

  &:hover {
    opacity: 0.8;
  }
`;

const ScrollWrapper = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &:hover ${CustomScrollbarThumb} {
    opacity: 0.8;
  }
`;

const DiffContent = styled.div.attrs({ className: "anchored-container" })`
  flex: 1;
  position: relative;
  padding-top: 0px;
  ${overlayScrollbarStyles}
`;

const DiffLines = styled.div`
  background-color: rgb(30, 30, 30);
  width: 100%;
`;

const DiffLine = styled.div<{
  $type: "add" | "remove" | "context";
  $isStreaming?: boolean;
  $isUndone?: boolean;
}>`
  display: flex;
  font-family: var(--vscode-editor-font-family);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
  line-height: 1.45;
  padding: 1.4px 14px;
  font-weight: var(--vscode-editor-font-weight, normal);
  position: relative;
  transition: all 0.3s ease;

  ${({ $isUndone }) =>
    $isUndone &&
    css`
      text-decoration: line-through;
      opacity: 0.8;
    `}

  ${({ $type }) =>
    $type === "remove" &&
    css`
      &::before {
        content: "";
        position: absolute;
        inset: 0;
        right: 0;
        background-color: rgb(67, 19, 19);
        z-index: 0;
      }
      span {
        color: #ffffff;
        position: relative;
        z-index: 1;
      }
    `}

  ${({ $type }) =>
    $type === "add" &&
    css`
      &::before {
        content: "";
        position: absolute;
        inset: 0;
        right: 0;
        background-color: rgba(55, 63, 34, 0.99);
        z-index: 0;
      }
      span {
        color: #ffffff;
        position: relative;
        z-index: 1;
      }
    `}

    ${({ $type }) =>
    $type === "context" &&
    css`
      span {
        color: var(--vscode-editor-foreground);
        opacity: 0.6;
        position: relative;
        z-index: 1;
      }
    `}
`;

const _LinePrefix = styled.span`
  display: inline-block;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  user-select: none;
  opacity: 0.7;
  font-size: 11px;
`;

const LineContent = styled.span`
  flex: 1;
  padding-right: 0px;
`;

const _Chevron = styled.span<{ $isExpanded: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isExpanded }) =>
    $isExpanded ? "rotate(90deg)" : "rotate(0deg)"};
  margin-left: -2px;
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
  background: rgba(255, 100, 100, 0.67);
  color: #ff8d8d;
  font-size: 11px;
  font-weight: 900;
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

const RawDiffView = styled.div`
  display: flex;
  flex-direction: column;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px);
  font-weight: var(--vscode-editor-font-weight, normal);
  border: none;
  overflow: visible;
`;

const _RawDiffScrollContainer = styled.div`
  display: flex;
  max-height: 100px;
  background-color: #1f1f1f;
`;

const _RawDiffContent = styled.div.attrs({ className: "anchored-container" })`
  flex: 1;
  position: relative;
  padding-top: 4px;
  overflow: visible;
  ${overlayScrollbarStyles}
`;

const _RawDiffText = styled.pre`
  background-color: #1f1f1f;
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px);
  font-weight: var(--vscode-editor-font-weight, normal);
  line-height: 1.35;
  margin: 0;
  padding: 6px 16px;
  white-space: pre-wrap;
  word-break: break-all;
  width: 100%;
  position: relative;
  overflow: visible;

  /* Handle raw diff line backgrounds if they are prefixed with +/- */
  /* This is a bit tricky since raw diff text is one big block. */
  /* If the user specifically wants the colored blocks to bleed, we might need a different approach for raw view. */
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

const _StreamingEditContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #1f1f1f;
`;

const _StreamingBlock = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.1);
`;

const _StreamingLabel = styled.div<{ $type: "old" | "new" }>`
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  padding: 4px 10px;
  background: ${({ $type }) =>
    $type === "old" ? "rgb(67, 19, 19)" : "rgba(61, 69, 42)"};
  color: ${({ $type }) => ($type === "old" ? "#ff8d8d" : "#dcdcaa")};
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  gap: 6px;
`;

const _StreamingText = styled.div<{ $type: "old" | "new" }>`
  padding: 6px 16px;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px);
  font-weight: var(--vscode-editor-font-weight, normal);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: ${({ $type }) =>
    $type === "old" ? "rgba(255, 255, 255, 0.65)" : "#ffffff"};
`;

// --- HIGHLIGHTING COMPONENT ---
import { AnimatedAccordion } from "../../common/AnimatedAccordion";

const HighlightedLine = memo(
  ({
    content,
    language,
    shouldHighlight,
  }: {
    content: string;
    language: string;
    shouldHighlight: boolean;
  }) => {
    const [elements, setElements] = useState<React.ReactNode>(null);

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
          const cacheKey =
            content.length <= 400
              ? `${theme}:${normalizedLanguage}:${content}`
              : null;

          if (cacheKey) {
            const cachedResult = highlightedLineCache.get(cacheKey);
            if (cachedResult) {
              setElements(cachedResult);
              return;
            }
          }

          const highlighter = await getHighlighter(language);
          if (!isMounted) return;

          const hast = await highlighter.codeToHast(content || " ", {
            lang: normalizedLanguage,
            theme: theme,
            transformers: [
              {
                span(node) {
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

          // Shiki HAST structure: root -> pre -> code -> span.line -> [tokens]
          const pre = hast.children.find((n: any) => n.tagName === "pre");
          const code = pre
            ? (pre as any).children.find((n: any) => n.tagName === "code")
            : null;
          const line = code
            ? (code as any).children.find(
                (n: any) =>
                  n.tagName === "span" &&
                  n.properties?.className?.includes("line"),
              )
            : null;

          // We want the inner tokens.
          // If we found a line span, use ITS children.
          // If no line span (flat structure), use CODE's children.
          // Never use PRE or HAST to avoid background styles.
          const targetNodes = line
            ? (line as any).children
            : code
              ? (code as any).children
              : null;

          if (targetNodes) {
            const reactElements = toJsxRuntime(
              {
                type: "element",
                tagName: "span",
                children: targetNodes,
              } as any,
              {
                Fragment,
                jsx,
                jsxs,
              },
            );
            if (isMounted) {
              if (cacheKey) {
                setCachedHighlight(
                  highlightedLineCache,
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

    return <>{elements || <span>{content}</span>}</>;
  },
);

const _HighlightedBlock = memo(
  ({ content, language }: { content: string; language: string }) => {
    const [elements, setElements] = useState<React.ReactNode>(content);

    // KILOCODE LIVE-STREAM FIX: Immediately show raw content when it updates
    // to prevent the UI from appearing frozen while waiting for the highlighter.
    useEffect(() => {
      setElements(content);
    }, [content]);

    useEffect(() => {
      let isMounted = true;
      const highlight = async () => {
        try {
          const highlighter = await getHighlighter(language);
          if (!isMounted) return;

          const theme = document.body.className.toLowerCase().includes("light")
            ? "light-plus"
            : "dark-plus";
          const hast = await highlighter.codeToHast(content, {
            lang: normalizeLanguage(language),
            theme: theme,
            transformers: [
              {
                span(node) {
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

          // Wrap in a fragment-like container for toJsxRuntime
          // We use a safe 'span' or 'div' wrapper then unwrap it, or just use Fragment as root if possible?
          // toJsxRuntime expects a Node. We can pass a fake root.
          if (targetNodes.length > 0) {
            const reactElements = toJsxRuntime(
              { type: "element", tagName: "div", children: targetNodes } as any,
              {
                Fragment,
                jsx,
                jsxs,
              },
            );
            // The result will be a div. We want its children because the wrapper div might carry unwanted styles if we used a real node.
            // But here we constructed a clean div with no properties.
            // However, HighlightedBlock wraps result in a div with pre-wrap.
            // So returning a <div>...</div> is fine, as long as it has no background.
            if (isMounted) setElements(reactElements);
          } else {
            if (isMounted) setElements(content);
          }
        } catch (e) {
          console.error("Highlight error:", e);
        }
      };
      highlight();
      return () => {
        isMounted = false;
      };
    }, [content, language]);

    // Outer div handles whitespace - fixed height/min-height could go here if content is known
    return (
      <div style={{ whiteSpace: "pre-wrap", minHeight: "1.45em" }}>
        {elements || content}
      </div>
    );
  },
);

export interface EditToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  autoApprovalEnabled?: boolean; // kade_change: accept auto-approval setting
}

const EditToolComponent: React.FC<EditToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  autoApprovalEnabled,
}) => {
  const { collapseCodeToolsByDefault = false } = useExtensionState();
  const headerBackground = useToolHeaderBackground("edit");
  const { isUndone, handleUndo, handleRedo } = useUndo(tool?.id);
  const editInstanceKey = useMemo(() => {
    if (tool?.id) return `id:${tool.id}`;

    const fallbackPath = resolveToolFilePath(tool, toolResult);
    const fallbackEdits = Array.isArray(tool?.edits)
      ? tool.edits
      : Array.isArray(tool?.edit)
        ? tool.edit
        : Array.isArray(tool?.params?.edits)
          ? tool.params.edits
          : Array.isArray(tool?.params?.edit)
            ? tool.params.edit
            : Array.isArray(tool?.nativeArgs?.edits)
              ? tool.nativeArgs.edits
              : Array.isArray(tool?.nativeArgs?.edit)
                ? tool.nativeArgs.edit
                : [];
    const fallbackOld =
      tool?.oldText ||
      tool?.old_string ||
      tool?.params?.old_string ||
      tool?.params?.old_text ||
      "";
    const fallbackNew =
      tool?.newText ||
      tool?.new_string ||
      tool?.params?.new_string ||
      tool?.params?.new_text ||
      "";

    return `fallback:${fallbackPath}:${JSON.stringify(fallbackEdits)}:${fallbackOld}:${fallbackNew}`;
  }, [tool]);

  // kade_change: Handlers for manual permission buttons
  const [actionPending, setActionPending] = useState(false);
  const [actionFlash, setActionFlash] = useState<"undone" | "redone" | null>(
    null,
  );
  const [showPartialSuccessDetails, setShowPartialSuccessDetails] =
    useState(false);

  // Extract partial success info from tool
  const partialSuccess = useMemo(
    () => tool.partialSuccess,
    [tool.partialSuccess],
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

  // Sticky: only animate on first mount, never re-trigger when isLastMessage flips
  const shouldAnimateOnceRef = useRef(isLastMessage && shouldAnimate);
  const didAnimate = shouldAnimateOnceRef.current;

  // kade_change: Hide permission buttons if auto-approved
  // Treat undefined as true (the default) to prevent button flash during initial render
  const isPermissionRequest =
    !toolResult && isLastMessage && autoApprovalEnabled === false;

  const errorMessage = useMemo(
    () => getEditErrorMessage(toolResult),
    [toolResult],
  );

  const isError = useMemo(() => {
    return !!errorMessage;
  }, [errorMessage]);

  const [isExpanded, setIsExpanded] = useState(
    !collapseCodeToolsByDefault && !isError,
  );

  // Auto-collapse when error occurs
  useEffect(() => {
    if (isError) {
      setIsExpanded(false);
    }
  }, [isError]);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Refs for scrolling
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Derived States
  const filePath = useMemo(
    () => resolveToolFilePath(tool, toolResult),
    [tool, toolResult],
  );

  const fileName = useMemo(() => {
    if (!filePath) return "Unknown File";
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }, [filePath]);

  const replaceAll = tool.replace_all;
  const shouldRenderBody = isExpanded;
  const diffLanguage = useMemo(
    () => getLanguageFromPath(filePath) || "text",
    [filePath],
  );

  // Cache to prevent flickering when tool updates
  const lastRawContentRef = useRef("");

  // Normalize edits for VS Code diff view
  const normalizedEdits = useMemo(() => {
    // Support both `edits` and singular `edit` payload shapes across streaming/finalized tool blocks.
    const editsArray = Array.isArray(tool.edits)
      ? tool.edits
      : Array.isArray(tool.edit)
        ? tool.edit
        : Array.isArray(tool.params?.edits)
          ? tool.params.edits
          : Array.isArray(tool.params?.edit)
            ? tool.params.edit
            : Array.isArray(tool.nativeArgs?.edits)
              ? tool.nativeArgs.edits
              : Array.isArray(tool.nativeArgs?.edit)
                ? tool.nativeArgs.edit
                : [];

    if (editsArray.length > 0) {
      return editsArray.map((edit: any) => ({
        oldText: edit.oldText || edit.old_string || edit.old_text || "",
        newText: edit.newText || edit.new_string || edit.new_text || "",
        replaceAll: edit.replace_all || edit.replaceAll || false,
        start_line: edit.start_line,
        end_line: edit.end_line,
      }));
    }

    const oldText =
      tool.oldText ||
      tool.old_string ||
      tool.params?.old_string ||
      tool.params?.old_text;
    const newText =
      tool.newText ||
      tool.new_string ||
      tool.params?.new_string ||
      tool.params?.new_text;

    if (oldText !== undefined || newText !== undefined) {
      return [
        {
          oldText: oldText || "",
          newText: newText || "",
          replaceAll:
            tool.replace_all ||
            tool.replaceAll ||
            tool.params?.replace_all ||
            false,
        },
      ];
    }
    return [];
  }, [tool]);

  const rawContent = useMemo(() => {
    let str = "";

    // PRIORITY 1: Use normalizedEdits (structured Old/New content) for live streaming.
    // During streaming, tool.diff is just "applying X edit blocks" (useless status text),
    // but tool.edits contains the actual oldText/newText data we need to render.
    if (normalizedEdits && normalizedEdits.length > 0) {
      const hasContent = normalizedEdits.some(
        (e: any) => e.oldText || e.newText,
      );
      if (hasContent) {
        str = normalizedEdits
          .map((edit: any) => {
            let block = "";
            if (edit.oldText) {
              block += edit.oldText
                .split("\n")
                .map((l: string) => `-${l}`)
                .join("\n");
            }
            if (edit.newText !== undefined) {
              if (block) block += "\n";
              block += edit.newText
                .split("\n")
                .map((l: string) => `+${l}`)
                .join("\n");
            }
            return block;
          })
          .join("\n");
      }
    }

    // PRIORITY 2: Fall back to raw tool content (for unified diff strings, etc.)
    if (!str) {
      const rawSource = tool.content || tool.params?.edit || tool.edit;
      if (rawSource) {
        if (typeof rawSource === "string") {
          str = rawSource;
        } else if (Array.isArray(rawSource)) {
          str = rawSource
            .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
            .join("\n");
        } else {
          str = JSON.stringify(rawSource);
        }

        // --- Unified Tool Syntax Streaming Parser ---
        // If the stream contains Old: / New: markers, transform to +/- diff lines
        if (str.includes("Old") || str.includes("New:")) {
          const lines = str.split("\n");
          const transformed: string[] = [];
          let currentMode: "remove" | "add" | "context" = "context";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("Old")) {
              currentMode = "remove";
              continue;
            } else if (trimmed.startsWith("New:")) {
              currentMode = "add";
              continue;
            } else if (
              trimmed.startsWith("!") ||
              trimmed === "!!" ||
              trimmed === "!!!"
            ) {
              continue;
            }

            if (currentMode === "remove") transformed.push("-" + line);
            else if (currentMode === "add") transformed.push("+" + line);
            else transformed.push(" " + line);
          }
          str = transformed.join("\n");
        }
      }
    }

    // PRIORITY 3: Use tool.diff only if it's an actual diff (not the "applying X" status text)
    if (
      !str &&
      tool.diff &&
      typeof tool.diff === "string" &&
      !tool.diff.startsWith("applying")
    ) {
      str = tool.diff;
    }

    // Filter out "No newline at end of file" noise from display
    const result = str
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("\\") && !line.includes("No newline at end of file"),
      )
      .join("\n");

    if (result.trim()) lastRawContentRef.current = result;
    return result || lastRawContentRef.current;
  }, [tool, normalizedEdits]);

  // Automatically expand on error - preserved per user request
  useEffect(() => {
    if (isError) {
      setIsExpanded(true);
    }
  }, [isError]);

  // Structured Patch Logic
  const structuredPatch = useMemo(() => {
    if (isError) {
      return null;
    }

    // 1. Check toolResult (output from tool execution)
    if (toolResult?.structuredPatch) {
      return toolResult.structuredPatch;
    }

    // 2. Check content (unified diff string in toolResult or from chat)
    let content = "";
    if (tool.diff) content = tool.diff;
    else if (toolResult?.content && !isError) {
      content =
        typeof toolResult.content === "string"
          ? toolResult.content
          : Array.isArray(toolResult.content)
            ? toolResult.content.map((c: any) => c.text).join("")
            : "";
    }

    if (content) {
      // Handle ```diff blocks
      const diffText =
        content.match(/```diff\n([\s\S]*?)\n```/)?.[1] || content;
      try {
        const patch = Diff.parsePatch(diffText);
        let allHunks: any[] = [];
        patch.forEach((p) => (allHunks = allHunks.concat(p.hunks)));
        if (allHunks.length > 0) return allHunks;
      } catch {
        /* parse failure is expected for non-diff content */
      }
    }

    // 3. Fallback: Generate from input edits
    const editsArray = normalizedEdits;
    if (editsArray.length > 0) {
      let allHunks: any[] = [];
      editsArray.forEach((edit: any) => {
        const oldText = edit.oldText || "";
        const newText = edit.newText || "";
        if (oldText) {
          try {
            const patch = Diff.structuredPatch(
              "file",
              "file",
              oldText,
              newText,
              "",
              "",
              { context: 0 },
            );
            allHunks = allHunks.concat(patch.hunks);
          } catch (e) {
            console.error("Failed to generate patch for edit:", e);
          }
        }
      });
      if (allHunks.length > 0) return allHunks;
    }

    // 4. Fallback: old_string/new_string
    if (tool.old_string && tool.new_string) {
      const patch = Diff.structuredPatch(
        "file",
        "file",
        tool.old_string,
        tool.new_string,
        "",
        "",
        { context: 0 },
      );
      return patch.hunks;
    }

    return null;
  }, [tool, toolResult, isError, normalizedEdits]);

  // Sticky: once we've shown the diff view, keep showing it to prevent flash on finalization
  const hasDiffViewRaw =
    !!structuredPatch && structuredPatch.length > 0 && !isError;
  const hasDiffViewRef = useRef(false);

  useEffect(() => {
    if (shouldRenderBody && hasDiffViewRaw) {
      hasDiffViewRef.current = true;
    }
  }, [hasDiffViewRaw, shouldRenderBody]);

  const hasDiffView = useMemo(() => {
    if (!shouldRenderBody) {
      return false;
    }

    return hasDiffViewRef.current || hasDiffViewRaw;
  }, [hasDiffViewRaw, shouldRenderBody]);

  // Stats
  const diffStats = useMemo(() => {
    return (
      getDiffStatsFromStructuredPatch(structuredPatch) ||
      getDiffStatsFromEdits(normalizedEdits) ||
      getDiffStatsFromContent(rawContent)
    );
  }, [normalizedEdits, rawContent, structuredPatch]);

  // Status Text

  // Status Class for Color
  const statusClass = useMemo(() => {
    if (isError) return "error-subtle";
    if (isLastMessage && !toolResult) return "editing";
    return "edited";
  }, [toolResult, isLastMessage, isError]);

  // Error Parsing (Simple version)
  const errors = useMemo(() => {
    if (!toolResult?.content) return [];
    const content =
      typeof toolResult.content === "string"
        ? toolResult.content
        : Array.isArray(toolResult.content)
          ? toolResult.content.map((c: any) => c.text).join("")
          : "";

    // Basic scan for "ERROR (line X)" patterns or similar
    // Or rely on Diagnostic summary from tool output
    const diagnostics: { line: number; message: string }[] = [];
    const _lines = content.split("\n");

    // Heuristic: Parsing the <diagnostic_summary> tag if present
    const diagnosticMatch = content.match(
      /<diagnostic_summary>([\s\S]*?)<\/diagnostic_summary>/,
    );
    if (diagnosticMatch) {
      const diagLines = diagnosticMatch[1].split("\n");
      for (const line of diagLines) {
        const m = line.match(/\(line\s+(\d+).*?:\s*(.+)$/);
        if (m) {
          diagnostics.push({ line: parseInt(m[1]), message: m[2].trim() });
        }
      }
    }

    return diagnostics;
  }, [toolResult]);

  // Ensure ToolError receives an object with is_error: true and a STRING content
  const displayResult = useMemo(() => {
    if (!isError) return toolResult;

    // We MUST ensure content is a string for the ToolError component to render correctly.
    // The extension host often sends an array of objects, which breaks ToolError.
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

  // Custom scrollbar state
  const [scrollState, setScrollState] = useState({ top: 0, height: 100 });
  const handleContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const total = target.scrollHeight;
    const visible = target.clientHeight;
    const current = target.scrollTop;
    setScrollTop(current);

    if (total > visible) {
      setScrollState({
        top: (current / total) * 100,
        height: (visible / total) * 100,
      });
    }
  };

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

  // Lock diff view mode once streaming finishes to avoid view toggles/flicker
  const viewModeRef = useRef<"diff" | "raw" | null>(null);
  useEffect(() => {
    if (!isStreaming && shouldRenderBody && !viewModeRef.current) {
      viewModeRef.current = hasDiffViewRaw ? "diff" : "raw";
    }
  }, [isStreaming, hasDiffViewRaw, shouldRenderBody]);

  const showDiffView = useMemo(() => {
    if (viewModeRef.current) {
      return viewModeRef.current === "diff";
    }
    return hasDiffView;
  }, [hasDiffView]);

  const structuredDiffLines = useMemo<RenderedDiffLine[]>(() => {
    if (!shouldRenderBody || !structuredPatch) {
      return [];
    }

    return structuredPatch.flatMap((hunk: any, blockIndex: number) =>
      hunk.lines
        .filter((line: string) => {
          return (
            getDiffLineType(line) !== "context" &&
            !line.startsWith("\\") &&
            !line.includes("No newline at end of file")
          );
        })
        .map((line: string, lineIndex: number) => ({
          key: `${blockIndex}-${hunk.oldStart}-${hunk.newStart}-${lineIndex}`,
          type: getDiffLineType(line),
          content: line.substring(1),
        })),
    );
  }, [shouldRenderBody, structuredPatch]);

  const rawDiffLines = useMemo<RenderedDiffLine[]>(() => {
    if (!shouldRenderBody || !rawContent) {
      return [];
    }

    return rawContent
      .split("\n")
      .filter((line) => {
        const type = getDiffLineType(line);
        return (
          type !== "context" &&
          line.trim().length >
            (line.startsWith("+") ||
            line.startsWith("-") ||
            line.startsWith(" ")
              ? 1
              : 0)
        );
      })
      .map((line, index) => {
        const type = getDiffLineType(line);
        return {
          key: `${index}-${type}`,
          type,
          content:
            line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")
              ? line.substring(1)
              : line,
        };
      });
  }, [rawContent, shouldRenderBody]);

  const renderedDiffLineCount = useMemo(() => {
    if (!shouldRenderBody) {
      return 0;
    }

    if (showDiffView) {
      return structuredDiffLines.length;
    }

    return rawDiffLines.length;
  }, [
    rawDiffLines.length,
    shouldRenderBody,
    showDiffView,
    structuredDiffLines.length,
  ]);
  const diffWindow = useMemo(
    () =>
      getVirtualizedLineWindow({
        lineCount: renderedDiffLineCount,
        scrollTop,
      }),
    [renderedDiffLineCount, scrollTop],
  );
  const visibleStructuredDiffLines = useMemo(() => {
    if (!diffWindow.enabled) {
      return structuredDiffLines;
    }

    return structuredDiffLines.slice(diffWindow.start, diffWindow.end);
  }, [
    diffWindow.enabled,
    diffWindow.end,
    diffWindow.start,
    structuredDiffLines,
  ]);
  const visibleRawDiffLines = useMemo(() => {
    if (!diffWindow.enabled) {
      return rawDiffLines;
    }

    return rawDiffLines.slice(diffWindow.start, diffWindow.end);
  }, [diffWindow.enabled, diffWindow.end, diffWindow.start, rawDiffLines]);

  const shouldHighlightDiffLines = useMemo(() => {
    if (!shouldRenderBody || isStreaming || !rawContent) {
      return false;
    }

    return (
      rawContent.length <= LARGE_EDIT_HIGHLIGHT_CHAR_LIMIT &&
      renderedDiffLineCount <= LARGE_EDIT_HIGHLIGHT_LINE_LIMIT
    );
  }, [isStreaming, rawContent, renderedDiffLineCount, shouldRenderBody]);

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
    lastRawContentRef.current = "";
    hasDiffViewRef.current = false;
    wasStreamingRef.current = false;
    streamingEndedRef.current = false;
    viewModeRef.current = null;
    previousStreamingRef.current = false;

    setActionPending(false);
    setShowPartialSuccessDetails(false);
    setShowErrorDetails(false);
    setScrollTop(0);
    setScrollState({ top: 0, height: 100 });
    setJustCompleted(false);
    setIsExpanded(!collapseCodeToolsByDefault && !isError);
  }, [editInstanceKey, collapseCodeToolsByDefault, isError]);

  useEffect(() => {
    // Trigger celebration when streaming just finished
    if (
      previousStreamingRef.current &&
      !isStreaming &&
      !isError &&
      toolResult
    ) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 800);
      return () => clearTimeout(timer);
    }
    previousStreamingRef.current = isStreaming;
  }, [isStreaming, isError, toolResult]);
  useEffect(() => {
    if (isStreaming && shouldRenderBody && contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
          // Trigger manual scroll sync
          const e = { currentTarget: contentRef.current } as any;
          handleContentScroll(e);
        }
      });
    }
  }, [isStreaming, normalizedEdits, rawContent, shouldRenderBody]);

  const sendErrorsToAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (errors.length === 0) return;
    let errorText = `Please fix these ${errors.length} error(s) in ${filePath}:\n\n`;
    errors.forEach((err, idx) => {
      errorText += `${idx + 1}. Line ${err.line}: ${err.message}\n`;
    });

    window.dispatchEvent(
      new CustomEvent("appendToChatInput", { detail: { text: errorText } }),
    );
    setShowErrorDetails(false);
  };

  // Helper to calc continuous line numbers
  const _getLineNumber = (hunk: any, lineIndex: number) => {
    const currentLine = hunk.lines[lineIndex];
    if (currentLine.startsWith("-")) {
      let oldLine = hunk.oldStart;
      for (let i = 0; i < lineIndex; i++)
        if (!hunk.lines[i].startsWith("+")) oldLine++;
      return String(oldLine);
    } else {
      let newLine = hunk.newStart;
      for (let i = 0; i < lineIndex; i++)
        if (!hunk.lines[i].startsWith("-")) newLine++;
      return String(newLine);
    }
  };

  return (
    <ToolMessageWrapper
      toolIcon="codicon-edit"
      toolName="Edit"
      /*
               We pass a modified toolResult to the wrapper. If we let the wrapper see is_error: true,
               it will often hijack the UI and skip rendering our custom EditCardContainer.
               By handling the error state internally, we keep the beautiful custom UI.
            */
      toolResult={toolResult ? { ...toolResult, is_error: false } : undefined}
      isCustomLayout={true}
      shouldAnimate={shouldAnimate}
      permissionState={isPermissionRequest ? "pending" : "allowed"}
      onAllow={handleAllow}
      onDeny={handleDeny}
      checkPending={actionPending}
    >
      <EditCardContainer
        $isExpanded={isExpanded}
        $isUndone={isUndone}
        $isError={isError}
        $shouldAnimate={didAnimate}
        $justCompleted={justCompleted}
        $isActive={isStreaming || isPermissionRequest}
        style={
          justCompleted
            ? { transition: "box-shadow 120ms ease-out" }
            : undefined
        }
      >
        <CardHeader
          $clickable={true}
          $isExpanded={isExpanded}
          $isError={isError}
          style={headerBackground.style}
          onClick={() => {
            // Only toggle local expansion to show inline diff
            if (!isError) {
              setIsExpanded(!isExpanded);
            }
          }}
        >
          <TitleSection $status={statusClass}>
            {/* Icons removed for prohibited simplistic look */}
            <FileInfo>
              {filePath && (
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    position: "relative",
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
                  if (tool.id || normalizedEdits.length > 0) {
                    // Open real diff editor with tool ID for accurate snapshots.
                    // After finalization/formatting the UI may no longer retain
                    // normalized edit blocks, but the extension can still reconstruct
                    // the diff from the stored snapshot using toolId.
                    vscode.postMessage({
                      type: "openDiff",
                      text: filePath,
                      edits: normalizedEdits,
                      toolId: tool.id, // Pass tool ID for snapshot lookup
                    });
                  } else {
                    vscode.postMessage({ type: "openFile", text: filePath });
                  }
                }}
              >
                <span style={{ position: "relative", display: "inline-block" }}>
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
              </FileName>
              {replaceAll && <DryRunBadge>FULL REPLACE</DryRunBadge>}
              {partialSuccess && (
                <PartialSuccessBadge
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPartialSuccessDetails(!showPartialSuccessDetails);
                  }}
                  title="Click to see failed blocks"
                >
                  <span>
                    {partialSuccess.successCount}/{partialSuccess.totalCount}
                  </span>
                  <span className="codicon codicon-check"></span>
                </PartialSuccessBadge>
              )}
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

            {diffStats && !isError && (
              <MiniDiffStats>
                {diffStats.added > 0 && <StatAdd>+{diffStats.added}</StatAdd>}
                {diffStats.removed > 0 && (
                  <StatRemove>-{diffStats.removed}</StatRemove>
                )}
              </MiniDiffStats>
            )}

            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  opacity: isPermissionRequest && !toolResult ? 1 : 0,
                  transition: "opacity 0.15s",
                  pointerEvents:
                    isPermissionRequest && !toolResult ? "auto" : "none",
                }}
              >
                <PulseLoader />
              </div>
              <div
                style={{
                  opacity: isPermissionRequest && !toolResult ? 0 : 1,
                  transition: "opacity 0.15s",
                  pointerEvents:
                    isPermissionRequest && !toolResult ? "none" : "auto",
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
                        triggerConfetti(e.clientX, e.clientY, "#60a871");
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
                      $clickable={true}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionFlash("undone");
                        handleUndo();
                        triggerConfetti(
                          e.clientX,
                          e.clientY,
                          isError ? "#ff4646" : "#ffb86c",
                        );
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
                          ? "The model performed a malformed edit. LLMs are not perfect and may occasionally fail to generate precise patch instructions."
                          : undefined
                      }
                    >
                      {isError ? (
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

        {showPartialSuccessDetails && partialSuccess && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(255, 193, 7, 0.08)",
              borderTop: "1px solid rgba(255, 193, 7, 0.2)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "#ffc107",
                marginBottom: "8px",
              }}
            >
              ⚠️ Partial Success: {partialSuccess.successCount} of{" "}
              {partialSuccess.totalCount} blocks applied
            </div>
            <div style={{ fontSize: "11px", color: "#ccc" }}>
              {partialSuccess.failedBlocks.map(
                (
                  fb: {
                    blockIndex: number;
                    error: string;
                    oldTextPreview?: string;
                  },
                  idx: number,
                ) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: "6px",
                      paddingLeft: "8px",
                      borderLeft: "2px solid rgba(255, 193, 7, 0.3)",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#ff8d8d" }}>
                      Block {fb.blockIndex + 1} failed:
                    </div>
                    <div style={{ marginTop: "2px", opacity: 0.9 }}>
                      {fb.error}
                    </div>
                    {fb.oldTextPreview && (
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "10px",
                          opacity: 0.7,
                          fontFamily: "monospace",
                          whiteSpace: "pre-wrap",
                          userSelect: "text",
                          cursor: "copy",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(
                            fb.oldTextPreview || "",
                          );
                          triggerConfetti(e.clientX, e.clientY, "#4ade80");
                        }}
                        title="Click to copy full search text"
                      >
                        Search text: {fb.oldTextPreview}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        {/* Diff Body */}
        <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
          <CardBody>
            {!isError && (
              <>
                {replaceAll && (
                  <ReplaceOption>
                    <span className="codicon codicon-replace-all"></span>
                    <span>Full File Replacement</span>
                  </ReplaceOption>
                )}

                {showDiffView ? (
                  <DiffView>
                    <DiffScrollContainer $isStreaming={isStreaming}>
                      <GradientOverlay $isVisible={isStreaming} />
                      <ScrollWrapper>
                        <DiffContent
                          ref={contentRef}
                          onScroll={handleContentScroll}
                        >
                          <DiffLines>
                            {diffWindow.enabled &&
                              diffWindow.topSpacerHeight > 0 && (
                                <div
                                  aria-hidden="true"
                                  style={{ height: diffWindow.topSpacerHeight }}
                                />
                              )}
                            {visibleStructuredDiffLines.map((line) => (
                              <DiffLine
                                key={line.key}
                                $type={line.type}
                                $isStreaming={isStreaming}
                                $isUndone={isUndone}
                              >
                                <LineContent>
                                  <HighlightedLine
                                    content={line.content}
                                    language={diffLanguage}
                                    shouldHighlight={
                                      shouldHighlightDiffLines &&
                                      !diffWindow.enabled
                                    }
                                  />
                                </LineContent>
                              </DiffLine>
                            ))}
                            {diffWindow.enabled &&
                              diffWindow.bottomSpacerHeight > 0 && (
                                <div
                                  aria-hidden="true"
                                  style={{
                                    height: diffWindow.bottomSpacerHeight,
                                  }}
                                />
                              )}
                          </DiffLines>
                        </DiffContent>
                        <CustomScrollbarTrack>
                          <CustomScrollbarThumb
                            $top={scrollState.top}
                            $height={scrollState.height}
                          />
                        </CustomScrollbarTrack>
                      </ScrollWrapper>
                    </DiffScrollContainer>
                  </DiffView>
                ) : (
                  <RawDiffView>
                    <DiffScrollContainer $isStreaming={isStreaming}>
                      <GradientOverlay $isVisible={isStreaming} />
                      <ScrollWrapper>
                        <DiffContent
                          ref={contentRef}
                          onScroll={handleContentScroll}
                        >
                          <DiffLines>
                            {diffWindow.enabled &&
                              diffWindow.topSpacerHeight > 0 && (
                                <div
                                  aria-hidden="true"
                                  style={{ height: diffWindow.topSpacerHeight }}
                                />
                              )}
                            {visibleRawDiffLines.map((line) => (
                              <DiffLine
                                key={line.key}
                                $type={line.type}
                                $isStreaming={isStreaming}
                                $isUndone={isUndone}
                              >
                                <LineContent>
                                  <HighlightedLine
                                    content={line.content}
                                    language={diffLanguage}
                                    shouldHighlight={
                                      shouldHighlightDiffLines &&
                                      !diffWindow.enabled
                                    }
                                  />
                                </LineContent>
                              </DiffLine>
                            ))}
                            {diffWindow.enabled &&
                              diffWindow.bottomSpacerHeight > 0 && (
                                <div
                                  aria-hidden="true"
                                  style={{
                                    height: diffWindow.bottomSpacerHeight,
                                  }}
                                />
                              )}
                          </DiffLines>
                          {isPermissionRequest &&
                            (!diffWindow.enabled ||
                              diffWindow.end === rawDiffLines.length) && (
                              <TypingCursor />
                            )}
                        </DiffContent>
                        <CustomScrollbarTrack>
                          <CustomScrollbarThumb
                            $top={scrollState.top}
                            $height={scrollState.height}
                          />
                        </CustomScrollbarTrack>
                      </ScrollWrapper>
                    </DiffScrollContainer>
                  </RawDiffView>
                )}
              </>
            )}
          </CardBody>
        </AnimatedAccordion>

        {/* Error Details Panel */}
        {showErrorDetails && errors.length > 0 && (
          <ErrorDetailsPanel>
            <PanelHeader>
              <span className="codicon codicon-warning"></span>
              <span>
                Found {errors.length} issues in {fileName}
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
      </EditCardContainer>
    </ToolMessageWrapper>
  );
};

export const EditTool = memo(EditToolComponent);
