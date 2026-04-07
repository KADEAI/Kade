import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { keyframes, css } from "styled-components";
import { useCopyToClipboard } from "react-use";
import { useTranslation, Trans } from "react-i18next";
// Removed: import deepEqual from "fast-deep-equal" - using custom comparison now
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react";

import type {
  ClineMessage,
  FollowUpData,
  SuggestionItem,
} from "@roo-code/types";
import { Mode } from "@roo/modes";

import {
  ClineApiReqInfo,
  ClineAskUseMcpServer,
  ClineSayTool,
} from "@roo/ExtensionMessage";
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences";
import { safeJsonParse } from "@roo/safeJsonParse";

// REMOVED: useExtensionState - caused ALL ChatRows to re-render on ANY state change
// Now uses module-level getExtensionStateStore() instead
import { findMatchingResourceOrTemplate } from "@src/utils/mcp";
import { vscode } from "@src/utils/vscode";
import { formatPathTooltip } from "@src/utils/formatPathTooltip";

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock";
import {
  ListDirTool,
  MkdirTool,
  GrepTool,
  GlobTool,
  FastContextTool,
  WrapTool,
  MoveFileTool,
  RunSubAgentTool,
} from "./tools";
import UpdateTodoListToolBlock from "./UpdateTodoListToolBlock";
import { TodoChangeDisplay } from "./TodoChangeDisplay";
import CodeAccordian from "../common/CodeAccordian";
import MarkdownBlock from "../common/MarkdownBlock";
import {
  ReasoningBlock,
  splitThinkingContent,
  stripThinkingTags,
} from "./ReasoningBlock";
import Thumbnails from "../common/Thumbnails";
import ImageBlock from "../common/ImageBlock";
import ErrorRow from "./ErrorRow";

import McpResourceRow from "../mcp/McpResourceRow";

import { Mention } from "./Mention";
import { CheckpointSaved } from "./checkpoints/CheckpointSaved";
import { FollowUpSuggest } from "./FollowUpSuggest";
import { BatchFilePermission } from "./BatchFilePermission";
import { BatchDiffApproval } from "./BatchDiffApproval";
import { ProgressIndicator } from "./ProgressIndicator";
import { SleekProgressIndicator } from "./SleekProgressIndicator";
import { AdvancedThinkingIndicator } from "./AdvancedThinkingIndicator";
import { Markdown } from "./Markdown";
import { CommandExecution } from "./CommandExecution";
import { CommandExecutionError } from "./CommandExecutionError";
import ReportBugPreview from "./ReportBugPreview";

import { DiffEditRow } from "./DiffEditRow";

import { AutoApprovedRequestLimitWarning } from "./AutoApprovedRequestLimitWarning";
import {
  InProgressRow,
  CondensationResultRow,
  CondensationErrorRow,
  TruncationResultRow,
} from "./context-management";
import CodebaseSearchResultsDisplay from "./CodebaseSearchResultsDisplay";
import { appendImages } from "@src/utils/imageUtils";
import { McpExecution } from "./McpExecution";
import { ChatTextArea } from "./ChatTextArea";
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView";
import { useSelectedModel } from "../ui/hooks/useSelectedModel";
import {
  Eye,
  FileDiff,
  ListTree,
  User,
  Edit,
  Trash2,
  MessageCircle,
  Repeat2,
  RefreshCcw,
  FilePlus,
  FolderTree,
  TerminalSquare,
  PocketKnife,
  MessageCircleQuestionMark,
  SquareArrowOutUpRight,
  FileCode2,
  Undo2,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SeeNewChangesButtons } from "./kilocode/SeeNewChangesButtons";
import { PathTooltip } from "../ui/PathTooltip";
import { ReadTool } from "./tools/ReadTool";
import { FlashFixWrapper } from "./tools/FlashFixWrapper";
import { WriteTool } from "./tools/WriteTool";
import { EditTool } from "./tools/EditTool";
import { WebSearchTool } from "./tools/WebSearchTool";
import { WebFetchTool } from "./tools/WebFetchTool";
import { ResearchWebTool } from "./tools/ResearchWebTool";
import { McpTool } from "./tools/McpTool";

// kade_change start
import { LowCreditWarning } from "../kilocode/chat/LowCreditWarning";
import { NewTaskPreview } from "../kilocode/chat/NewTaskPreview";
import { KiloChatRowGutterBar } from "../kilocode/chat/KiloChatRowGutterBar";
import { StandardTooltip } from "../ui";
import { FastApplyChatDisplay } from "./kilocode/FastApplyChatDisplay";
import { InvalidModelWarning } from "../kilocode/chat/InvalidModelWarning";
import { formatFileSize } from "@/lib/formatting-utils";
import ChatTimestamps from "./ChatTimestamps";
import { removeLeadingNonAlphanumeric } from "@/utils/removeLeadingNonAlphanumeric";
import { ToolHeader } from "./tools/ToolHeader";
// kade_change end
// kade_change end
import { ResponseActions, type ResponseActionSource } from "./ResponseActions";
import {
  deriveAgentStatusLabel,
  StreamingLoadingText,
} from "./StreamingLoadingText";
import {
  RENDERABLE_TOOL_TYPES,
  shouldSuppressApiRequestRowForToolTurn,
} from "./apiRequestRowState";
import { parseCachedTool } from "./chatToolParseCache";
import {
  isKiloCodeAuthErrorMessage,
  shouldHideToolFollowupErrorMessage,
} from "./toolFollowupErrorState";
import {
  extractBashCommandPreview,
  isBashToolPayload,
} from "@/utils/extractBashCommandPreview";
import {
  stripChatToolFenceBlocks,
  stripSharedProtocolMarkdown,
} from "./markdownCleanup";

const SmoothStreamingStatus = ({
  visible,
  text,
}: {
  visible: boolean;
  text: string;
}) => {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="block text-[13px] leading-normal anchored-container"
      aria-hidden={false}
    >
      <StreamingLoadingText text={text} compact active animateOnMount />
    </div>
  );
};

// --- MODULE-LEVEL STORES (persist across remounts, don't trigger re-renders) ---
const animatedTs = new Set<number>();

// MESSAGE STORE: Holds current messages for cross-message lookups WITHOUT prop drilling
// This is the KEY fix - ChatRow doesn't receive clineMessages as prop anymore
// Instead it reads from this store which is updated by ChatView via ref
let messageStoreRef: ClineMessage[] = [];
const tsToIndexMap: Map<number, number> = new Map();

// Extension state store - ChatRowContent reads these instead of calling useExtensionState
// This prevents re-renders when ANY extension state changes
interface ExtensionStateStore {
  showTaskTimeline: boolean;
  mcpServers: any[];
  alwaysAllowMcp: boolean;
  currentCheckpoint: string | undefined;
  mode: string;
  apiConfiguration: any;
  showTimestamps: boolean;
  filePaths: string[];
  cwd: string;
  alwaysAllowReadOnly: boolean;
  alwaysAllowWrite: boolean;
  alwaysAllowExecute: boolean;
  alwaysAllowBrowser: boolean;
  alwaysAllowModeSwitch: boolean;
  alwaysAllowSubtasks: boolean;
  autoApprovalEnabled: boolean;
  hideCostBelowThreshold: number;
}

let extensionStateStore: ExtensionStateStore = {
  showTaskTimeline: false,
  mcpServers: [],
  alwaysAllowMcp: false,
  currentCheckpoint: undefined,
  mode: "code",
  apiConfiguration: {},
  showTimestamps: false,
  filePaths: [],
  cwd: "",
  alwaysAllowReadOnly: false,
  alwaysAllowWrite: false,
  alwaysAllowExecute: false,
  alwaysAllowBrowser: false,
  alwaysAllowModeSwitch: false,
  alwaysAllowSubtasks: false,
  autoApprovalEnabled: false,
  hideCostBelowThreshold: 0,
};

export function setMessageStore(messages: ClineMessage[]) {
  messageStoreRef = messages;
  tsToIndexMap.clear();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message.ts !== "number") {
      continue;
    }
    tsToIndexMap.set(message.ts, i);
  }
}

export function getMessageStore(): ClineMessage[] {
  return messageStoreRef;
}

export function getMessageIndex(ts: number): number {
  return tsToIndexMap.get(ts) ?? -1;
}

export function setExtensionStateStore(state: Partial<ExtensionStateStore>) {
  extensionStateStore = { ...extensionStateStore, ...state };
}

export function getExtensionStateStore(): ExtensionStateStore {
  return extensionStateStore;
}

// Legacy exports for backward compatibility
export function setShowTaskTimeline(value: boolean) {
  extensionStateStore.showTaskTimeline = value;
}

export function getShowTaskTimeline(): boolean {
  return extensionStateStore.showTaskTimeline;
}

// Tool result cache: once a tool result is found, it's cached forever for that message
// This prevents oscillation where toolResult temporarily becomes undefined during re-renders
interface CachedToolResult {
  type: string;
  content: string;
  is_error: boolean;
}
const toolResultCache = new Map<number, CachedToolResult>();

// Tool component selection cache: prevents flashing when tool properties change during streaming
// Key: message.ts, Value: 'edit' | 'write' | 'read' etc.
const toolComponentCache = new Map<number, string>();

function getReadToolSignature(tool: any, toolResult: any) {
  const toolId = tool?.id ?? toolResult?.id;
  if (toolId) {
    return `id:${String(toolId).trim()}`;
  }

  const rawPath = tool?.path || tool?.file_path || tool?.notebook_path || "";
  const startLine = tool?.lineNumber ?? toolResult?.lineNumber ?? "";
  const endLine = tool?.endLine ?? toolResult?.endLine ?? "";
  return [
    rawPath.trim(),
    String(startLine).trim(),
    String(endLine).trim(),
  ].join("\u241f");
}

function isDuplicateReadToolInCurrentTurn(
  messageTs: number,
  currentSignature: string,
  messages: ClineMessage[],
) {
  const messageIndex = messages.findIndex(
    (message) => message?.ts === messageTs,
  );
  if (messageIndex === -1) {
    return false;
  }

  for (let i = messageIndex + 1; i < messages.length; i++) {
    const nextMessage = messages[i];
    if (!nextMessage) {
      continue;
    }

    // Stop once we leave the current assistant turn.
    if (nextMessage.say === "api_req_started") {
      return false;
    }

    if (nextMessage.type === "ask" && nextMessage.ask !== "tool") {
      return false;
    }

    if (
      nextMessage.type !== "ask" ||
      nextMessage.ask !== "tool" ||
      !nextMessage.text
    ) {
      continue;
    }

    const nextTool = parseCachedTool(nextMessage.text);
    if (
      nextTool &&
      (nextTool.tool === "readFile" || nextTool.tool === "read") &&
      getReadToolSignature(nextTool, nextTool) === currentSignature
    ) {
      return true;
    }
  }

  return false;
}

// Export function to clear cache when task changes
export function clearToolResultCache() {
  toolResultCache.clear();
  toolComponentCache.clear();
  animatedTs.clear();
  messageStoreRef = [];
}
const userMessageFadeIn = keyframes`
    0% {
        opacity: 0;
        transform: scale(0.985);
        filter: blur(4px) saturate(0.9);
    }
    100% {
        opacity: 1;
        transform: scale(1);
        filter: saturate(1);
    }
`;

const userMessageGradientSweep = keyframes`
    0% {
        background-position: 0 0, 140% 0;
    }
    100% {
        background-position: 0 0, -60% 0;
    }
`;

// Single-pass shimmer sweep for task completion — the "reward" moment
const completionShimmer = keyframes`
	0% { background-position: 200% center; }
	100% { background-position: -200% center; }
`;

// Smooth assistant message entrance with left-to-right slide
const assistantMessageEntry = keyframes`
    0% {
        opacity: 0;
        transform: translate3d(0, 12px, 0) scale(0.985);
        filter: blur(10px);
    }
    60% {
        opacity: 1;
    }
    100% {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        filter: blur(0);
    }
`;

const AssistantMessageContainer = styled.div<{ $isNew?: boolean }>`
  width: 100%;
  max-width: 100%;
  backface-visibility: hidden;
  transform-origin: top left;

  ${({ $isNew }) =>
    $isNew &&
    css`
      animation: ${assistantMessageEntry} 0.48s cubic-bezier(0.16, 1, 0.3, 1)
        both;
      will-change: opacity, transform, filter;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `}
`;

// Wraps completion result text with a single-pass shimmer sweep
export const CompletionShimmerWrapper = styled.div<{ $active?: boolean }>`
  ${({ $active }) =>
    $active &&
    css`
      & p,
      & li,
      & h1,
      & h2,
      & h3,
      & h4,
      & span {
        background: linear-gradient(
          90deg,
          var(--vscode-foreground) 20%,
          var(--vscode-charts-green) 50%,
          var(--vscode-foreground) 80%
        );
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: ${completionShimmer} 1.2s cubic-bezier(0.4, 0, 0.2, 1) 0.1s 1
          forwards;
      }
    `}
`;

const FloatingPillControls = styled.div`
  position: absolute;
  top: -14px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background-color: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translateY(6px) scale(0.92);
  /* Slow spring in, fast fade out — asymmetric timing is a known dopamine pattern */
  transition:
    opacity 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 10;

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 4px;
    border-radius: 50%;
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    transition:
      background-color 0.12s ease,
      color 0.12s ease,
      transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);

    &:hover {
      background-color: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
      transform: scale(1.15);
    }

    &:active {
      transform: scale(0.88);
      transition-duration: 0.08s;
    }
  }
`;

// Soft glow on send to keep the entrance feeling calm instead of punchy.
const sendShadowPulse = keyframes`
	0% { box-shadow: 0 1px 6px rgba(0, 0, 0, 0.14), inset 0 0 0 1px rgba(255, 255, 255, 0.03); }
	40% { box-shadow: 0 3px 14px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 0 0 1px rgba(255, 255, 255, 0.05); }
	100% { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.04); }
`;

const UserMessageBubble = styled.div<{
  $isEditing: boolean;
  $isNew?: boolean;
  $isLarge?: boolean;
}>`
  max-width: ${({ $isEditing }) =>
    $isEditing
      ? "100%"
      : "var(--chat-user-bubble-max-width, 88%)"};
  padding: ${({ $isEditing }) => ($isEditing ? "0" : "6.9px 12.1px")};
  background: ${({ $isEditing }) =>
    $isEditing
      ? "transparent"
      : "linear-gradient(0deg, color-mix(in srgb, var(--vscode-input-background) 50%, var(--vscode-editor-background)), color-mix(in srgb, var(--vscode-input-background) 30%, var(--vscode-editor-background)))"};
  border: 0.5px solid rgba(119, 119, 119, 0.15);
  border-radius: 11px;
  position: relative;
  box-shadow: ${({ $isEditing }) =>
    $isEditing ? "none" : "0 2px 8px rgba(0, 0, 0, 0.16)"};
  transition: box-shadow 0.2s ease;
  word-break: break-word;
  user-select: text;
  cursor: default;

  &:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);

    & ${FloatingPillControls} {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  ${({ $isLarge }) =>
    $isLarge &&
    css`
      max-width: var(--chat-user-bubble-large-max-width, 600px);
      width: 100%;
      margin-left: auto;
      text-align: left;
    `}

  ${({ $isNew }) =>
    $isNew &&
    css`
      background-image:
        linear-gradient(
          0deg,
          color-mix(
            in srgb,
            var(--vscode-input-background) 50%,
            var(--vscode-editor-background)
          ),
          color-mix(
            in srgb,
            var(--vscode-input-background) 50%,
            var(--vscode-editor-background)
          )
        ),
        linear-gradient(
          115deg,
          rgba(255, 255, 255, 0) 12%,
          rgba(255, 255, 255, 0.08) 32%,
          rgba(255, 255, 255, 0.22) 50%,
          rgba(255, 255, 255, 0.06) 68%,
          rgba(255, 255, 255, 0) 88%
        );
      background-repeat: no-repeat;
      background-size:
        100% 100%,
        220% 100%;
      background-position:
        0 0,
        140% 0;
      animation:
        ${userMessageFadeIn} 0.28s cubic-bezier(0.22, 1, 0.36, 1) forwards,
        ${userMessageGradientSweep} 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards,
        ${sendShadowPulse} 0.42s ease-out 0.04s 1 forwards;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `}
`;

// Helper function to get previous todos before a specific message
function getPreviousTodos(
  messages: ClineMessage[],
  currentMessageTs: number,
): any[] {
  // Find the previous updateTodoList message before the current one
  const previousUpdateIndex = messages
    .slice()
    .reverse()
    .findIndex((msg) => {
      if (msg.ts >= currentMessageTs) return false;
      if (msg.type === "ask" && msg.ask === "tool") {
        const tool = parseCachedTool(msg.text);
        return tool?.tool === "updateTodoList";
      }
      return false;
    });

  if (previousUpdateIndex !== -1) {
    const previousMessage = messages.slice().reverse()[previousUpdateIndex];
    return parseCachedTool(previousMessage.text)?.todos || [];
  }

  // If no previous updateTodoList message, return empty array
  return [];
}

function normalizePotentialUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/g, "");
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
}

function getDomainFromUrl(value: string): string | null {
  const normalized = normalizePotentialUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

function extractSourcesFromRawUrls(content: string): ResponseActionSource[] {
  if (!content) return [];

  const urlMatches = content.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const uniqueSources = new Map<string, ResponseActionSource>();

  for (const url of urlMatches) {
    const normalizedUrl = normalizePotentialUrl(url);
    const domain = normalizedUrl ? getDomainFromUrl(normalizedUrl) : null;

    if (!normalizedUrl || !domain || uniqueSources.has(normalizedUrl)) {
      continue;
    }

    uniqueSources.set(normalizedUrl, {
      domain,
      url: normalizedUrl,
      title: domain,
    });
  }

  return Array.from(uniqueSources.values());
}

function getToolContentText(tool: any): string {
  if (typeof tool?.content === "string") {
    return tool.content;
  }

  if (Array.isArray(tool?.content)) {
    return tool.content.map((part: any) => part?.text || "").join("");
  }

  return "";
}

function resolveToolMessageContent(
  messages: ClineMessage[],
  toolMessage: ClineMessage,
  parsedTool: any,
): string {
  const directContent = getToolContentText(parsedTool);
  if (directContent) {
    return directContent;
  }

  const cached = toolResultCache.get(toolMessage.ts);
  if (cached?.content) {
    return cached.content;
  }

  const messageIndex = getMessageIndex(toolMessage.ts);
  if (messageIndex === -1) {
    return "";
  }

  for (let i = 1; i <= 5; i++) {
    if (messageIndex + i >= messages.length) {
      break;
    }

    const nextMessage = messages[messageIndex + i];
    if (!nextMessage?.text) {
      continue;
    }

    const isToolStateMessage =
      nextMessage.say === "tool" ||
      nextMessage.ask === "tool" ||
      nextMessage.partial === true;

    const isApiMetadata =
      nextMessage.text.startsWith("{") &&
      (nextMessage.text.includes('"apiProtocol"') ||
        nextMessage.text.includes('"cost"'));

    const isReasoning = nextMessage.say === "reasoning";

    if (!isToolStateMessage && !isApiMetadata && !isReasoning) {
      const isError =
        nextMessage.text.includes("The tool execution failed") ||
        nextMessage.text.startsWith("errors.geminiCli");

      const result: CachedToolResult = {
        type: "tool_result",
        content: nextMessage.text,
        is_error: isError,
      };

      toolResultCache.set(toolMessage.ts, result);
      return result.content;
    }
  }

  return "";
}

function parseWebSearchResponseSources(
  content: string,
): ResponseActionSource[] {
  if (!content) return [];

  const addSource = (
    list: ResponseActionSource[],
    url: string,
    title?: string,
  ) => {
    const normalizedUrl = normalizePotentialUrl(url);
    const domain = normalizedUrl ? getDomainFromUrl(normalizedUrl) : null;
    if (!normalizedUrl || !domain) return;

    list.push({
      domain,
      url: normalizedUrl,
      title: title?.trim() || domain,
    });
  };

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed?.results)) {
      const sources: ResponseActionSource[] = [];
      for (const result of parsed.results) {
        addSource(sources, result?.url || "", result?.title);
      }
      if (sources.length > 0) return sources;
    }
  } catch {}

  const jsonMatch =
    content.match(/```json\n([\s\S]*?)\n```/) || content.match(/(\{[\s\S]*\})/);

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed?.results)) {
        const sources: ResponseActionSource[] = [];
        for (const result of parsed.results) {
          addSource(sources, result?.url || "", result?.title);
        }
        if (sources.length > 0) return sources;
      }
    } catch {}
  }

  const fallbackSources: ResponseActionSource[] = [];
  let currentTitle = "";
  const lines = content.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const titleMatch =
      line.match(/^-\s+title:\s*"(.*)"$/i) || line.match(/^\d+\.\s+(.+)$/);

    if (titleMatch) {
      currentTitle = titleMatch[1].trim();
      continue;
    }

    if (line.startsWith("url:")) {
      addSource(
        fallbackSources,
        line
          .replace(/^url:\s*"?/i, "")
          .replace(/"$/, "")
          .trim(),
        currentTitle,
      );
      continue;
    }

    if (line.startsWith("URL:")) {
      addSource(fallbackSources, line.replace("URL:", "").trim(), currentTitle);
    }
  }

  if (fallbackSources.length > 0) {
    return fallbackSources;
  }

  return extractSourcesFromRawUrls(content);
}

function parseResearchWebSources(content: string): ResponseActionSource[] {
  return extractSourcesFromRawUrls(content);
}

function getResponseSourcesForMessage(
  messages: ClineMessage[],
  currentMessageTs: number,
): ResponseActionSource[] {
  const currentIndex = getMessageIndex(currentMessageTs);
  if (currentIndex <= 0) return [];

  const uniqueSources = new Map<string, ResponseActionSource>();

  for (let i = currentIndex - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (!candidate) continue;

    const isHardConversationBoundary =
      (candidate.type === "say" &&
        (candidate.say === "task" ||
          candidate.say === "user_feedback" ||
          candidate.say === "user_feedback_diff")) ||
      (candidate.type === "ask" &&
        candidate.ask !== "tool" &&
        candidate.ask !== "completion_result" &&
        candidate.ask !== "followup");

    if (isHardConversationBoundary) {
      break;
    }

    const isToolMessage =
      (candidate.type === "ask" && candidate.ask === "tool") ||
      (candidate.type === "say" && candidate.say === "tool");

    if (isToolMessage) {
      const parsedTool = parseCachedTool(candidate.text);
      const content = resolveToolMessageContent(
        messages,
        candidate,
        parsedTool,
      );
      const sources =
        parsedTool?.tool === "web"
          ? parseWebSearchResponseSources(content)
          : parsedTool?.tool === "research_web"
            ? parseResearchWebSources(content)
            : [];

      for (const source of sources) {
        if (!uniqueSources.has(source.url)) {
          uniqueSources.set(source.url, source);
        }
      }

      continue;
    }

    const isTurnMetadata =
      candidate.say === "reasoning" ||
      candidate.say === "api_req_finished" ||
      candidate.say === "api_req_retried" ||
      candidate.say === "api_req_deleted" ||
      candidate.say === "browser_session_status" ||
      candidate.partial === true;

    if (!isTurnMetadata) {
      break;
    }
  }

  return Array.from(uniqueSources.values()).slice(0, 6);
}

// kade_change end

interface ChatRowProps {
  message: ClineMessage;
  isExpanded: boolean;
  isLast: boolean;
  isStreaming: boolean;
  onToggleExpand: (ts: number, currentExpanded?: boolean) => void;
  onHeightChange: (isTaller: boolean) => void;
  onSuggestionClick?: (
    suggestion: SuggestionItem,
    event?: React.MouseEvent,
  ) => void;
  onBatchFileResponse?: (response: { [key: string]: boolean }) => void;
  highlighted?: boolean; // kade_change: Add highlighted prop
  enableCheckpoints?: boolean; // kade_change
  onFollowUpUnmount?: () => void;
  isFollowUpAnswered?: boolean;
  isFollowUpAutoApprovalPaused?: boolean;
  editable?: boolean;
  hasCheckpoint?: boolean;
  isAskingToProceed?: boolean;
  showResponseActions?: boolean;
  allowCommandAutoScroll?: boolean;
  // REMOVED: clineMessages - now uses module-level messageStore to prevent re-renders
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {
  // clineMessages removed - now uses getMessageStore() internally
  compactToolSpacing?: boolean;
}

const RENDERABLE_ASK_TYPES = new Set([
  "mistake_limit_reached",
  "command",
  "use_mcp_server",
  "completion_result",
  "followup",
  "condense",
  "payment_required_prompt",
  "invalid_model",
  "report_bug",
  "auto_approval_max_req_reached",
  "tool",
]);

function shouldSkipChatRowShell(message: ClineMessage): boolean {
  if (message.type === "say") {
    if (
      message.say === "api_req_finished" ||
      message.say === "api_req_retried" ||
      message.say === "api_req_deleted" ||
      message.say === "mcp_server_request_started" ||
      message.say === "command" ||
      message.say === "browser_action"
    ) {
      return true;
    }

    if (message.say === "tool") {
      const tool = parseCachedTool(message.text);
      if (!tool) return true;
      if (RENDERABLE_TOOL_TYPES.has((tool.tool as string) || "")) return false;
      return true;
    }
  }

  if (message.type === "ask") {
    if (!RENDERABLE_ASK_TYPES.has(message.ask as string)) {
      return true;
    }

    if (message.ask === "completion_result" && !message.text) {
      return true;
    }

    if (message.ask === "tool") {
      const tool = parseCachedTool(message.text);
      return !tool || !RENDERABLE_TOOL_TYPES.has((tool.tool as string) || "");
    }
  }

  return false;
}

const ChatRow = memo(
  (props: ChatRowProps) => {
    const {
      highlighted,
      isExpanded,
      isLast,
      onHeightChange,
      message,
      isStreaming,
      showResponseActions,
    } = props;
    // REMOVED: useExtensionState() - it was causing ALL ChatRows to re-render on ANY state change
    // showTaskTimeline is now read from module-level store
    const showTaskTimeline = getShowTaskTimeline();
    // Store the previous height to compare with the current height
    // This allows us to detect changes without causing re-renders
    const rowRef = useRef<HTMLDivElement>(null);
    const prevHeightRef = useRef(0);
    const latestHeightRef = useRef(0);
    const zeroSizeTimerRef = useRef<number | null>(null);
    const hasStreamedContentRef = useRef(message.partial === true || isStreaming);

    const isApiReqStarted = message.say === "api_req_started";
    const isReasoning = message.say === "reasoning";
    const isCompletionResult =
      message.say === "completion_result" ||
      message.ask === "completion_result";
    const isNewMessage =
      isLast &&
      message.partial !== true &&
      !animatedTs.has(message.ts) &&
      Date.now() - message.ts < 10000;
    const shouldAnimateAssistantEntry =
      isNewMessage &&
      !hasStreamedContentRef.current &&
      !(message.ask === "tool" || message.say === "tool");

    useEffect(() => {
      if (message.partial === true || isStreaming) {
        hasStreamedContentRef.current = true;
      }
    }, [isStreaming, message.partial]);

    useEffect(() => {
      const row = rowRef.current;
      if (!row) {
        return;
      }

      const handleHeight = (height: number) => {
        // used for partials, command output, etc.
        // only force scroll if we are actively streaming
        const isInitialRender = prevHeightRef.current === 0;
        const delta = Math.abs(height - prevHeightRef.current);
        const isCommandOutput =
          message.say === "command_output" || message.ask === "command";

        if (
          isLast &&
          (isStreaming || isCommandOutput) &&
          height !== 0 &&
          height !== Infinity &&
          delta > 2
        ) {
          if (!isInitialRender) {
            onHeightChange(height > prevHeightRef.current);
            window.dispatchEvent(
              new CustomEvent("chat-height-change-log", {
                detail: {
                  delta: height - prevHeightRef.current,
                  index: message.ts,
                },
              }),
            );
          }
          prevHeightRef.current = height;
        } else if (height !== 0 && height !== Infinity) {
          prevHeightRef.current = height;
        }
        latestHeightRef.current = height;

        if (zeroSizeTimerRef.current !== null) {
          window.clearTimeout(zeroSizeTimerRef.current);
          zeroSizeTimerRef.current = null;
        }

        // If a row remains zero-height beyond initial mount, mark it for removal
        // from the Virtuoso data list.
        if (height === 0 && !message.partial) {
          zeroSizeTimerRef.current = window.setTimeout(() => {
            if (latestHeightRef.current === 0) {
              window.dispatchEvent(
                new CustomEvent("chat-row-zero-size", {
                  detail: { ts: message.ts },
                }),
              );
            }
          }, 180);
        }
      };

      handleHeight(row.getBoundingClientRect().height);

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        handleHeight(entry.contentRect.height);
      });

      observer.observe(row);

      return () => {
        observer.disconnect();
        if (zeroSizeTimerRef.current !== null) {
          window.clearTimeout(zeroSizeTimerRef.current);
          zeroSizeTimerRef.current = null;
        }
      };
    }, [
      isLast,
      isStreaming,
      message.ask,
      message.partial,
      message.say,
      message.ts,
      onHeightChange,
    ]);

    if (shouldSkipChatRowShell(message)) {
      return null;
    }

    return (
      <div
        ref={rowRef}
        className={cn(
          `anchored-container relative w-full ${highlighted ? "animate-message-highlight" : ""}`,
          isApiReqStarted ||
            isReasoning ||
            isCompletionResult ||
            message.say === "text"
            ? "py-0"
            : message.type === "ask" && message.ask === "tool"
              ? "py-0"
              : "py-1",
        )}
        style={{
          paddingLeft: "var(--chat-row-inline-padding, 16px)",
          paddingRight: "var(--chat-row-inline-padding-end, 10px)",
          // GPU acceleration for scroll stability
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
          // Containment to isolate layout calculations
          contain: "layout style",
        }}
      >
        {showTaskTimeline && <KiloChatRowGutterBar message={message} />}
        {message.type === "ask" ||
        (message.type === "say" &&
          message.say !== "task" &&
          message.say !== "user_feedback" &&
          message.say !== "user_feedback_diff") ? (
          <AssistantMessageContainer $isNew={shouldAnimateAssistantEntry}>
            <ChatRowContent
              message={message}
              isExpanded={isExpanded}
              isLast={isLast}
              isStreaming={isStreaming}
              onToggleExpand={props.onToggleExpand}
              onSuggestionClick={props.onSuggestionClick}
              onFollowUpUnmount={props.onFollowUpUnmount}
              onBatchFileResponse={props.onBatchFileResponse}
              enableCheckpoints={props.enableCheckpoints}
              isFollowUpAnswered={props.isFollowUpAnswered}
              isFollowUpAutoApprovalPaused={props.isFollowUpAutoApprovalPaused}
              isAskingToProceed={props.isAskingToProceed}
              showResponseActions={showResponseActions}
            />
          </AssistantMessageContainer>
        ) : (
          <ChatRowContent
            message={message}
            isExpanded={isExpanded}
            isLast={isLast}
            isStreaming={isStreaming}
            onToggleExpand={props.onToggleExpand}
            onSuggestionClick={props.onSuggestionClick}
            onFollowUpUnmount={props.onFollowUpUnmount}
            onBatchFileResponse={props.onBatchFileResponse}
            enableCheckpoints={props.enableCheckpoints}
            isFollowUpAnswered={props.isFollowUpAnswered}
            isFollowUpAutoApprovalPaused={props.isFollowUpAutoApprovalPaused}
            isAskingToProceed={props.isAskingToProceed}
            showResponseActions={showResponseActions}
          />
        )}
      </div>
    );
  },
  // Custom comparison - only re-render if message content actually changed
  (prevProps, nextProps) => {
    // If message timestamp is different, it's a different message - must re-render
    if (prevProps.message.ts !== nextProps.message.ts) return false;

    // If message text/partial/type changed, must re-render
    if (prevProps.message.text !== nextProps.message.text) return false;
    if (prevProps.message.partial !== nextProps.message.partial) return false;
    if (prevProps.message.type !== nextProps.message.type) return false;
    if (prevProps.message.ask !== nextProps.message.ask) return false;
    if (prevProps.message.say !== nextProps.message.say) return false;

    // Check other props that affect rendering
    if (prevProps.isLast !== nextProps.isLast) return false;
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    if (prevProps.isExpanded !== nextProps.isExpanded) return false;
    if (prevProps.highlighted !== nextProps.highlighted) return false;
    if (prevProps.showResponseActions !== nextProps.showResponseActions)
      return false;
    if (prevProps.allowCommandAutoScroll !== nextProps.allowCommandAutoScroll)
      return false;

    // REMOVED: lastModifiedMessage check - it changes on every message update causing all rows to re-render
    // The component will read from messageStore if it needs the latest message

    // IGNORE callback props - they're recreated but functionally equivalent
    // React will handle the callback updates without remounting

    // All checks passed - props are equal, skip re-render
    return true;
  },
);

export default ChatRow;

export const ChatRowContent = ({
  message,
  isExpanded,
  isLast,
  isStreaming,
  onToggleExpand,
  onSuggestionClick,
  onFollowUpUnmount,
  onBatchFileResponse,
  enableCheckpoints,
  isFollowUpAnswered,
  isFollowUpAutoApprovalPaused,
  isAskingToProceed,
  showResponseActions,
  allowCommandAutoScroll,
  compactToolSpacing = false,
}: ChatRowContentProps) => {
  // Read messages from module-level store instead of props to prevent re-renders
  const clineMessages = getMessageStore();
  const lastModifiedMessage = clineMessages[clineMessages.length - 1];
  const isNewMessage =
    isLast &&
    message.partial !== true &&
    !animatedTs.has(message.ts) &&
    Date.now() - message.ts < 10000;

  useEffect(() => {
    if (isNewMessage) {
      animatedTs.add(message.ts);
    }
  }, [isNewMessage, message.ts]);
  const { t, i18n } = useTranslation();

  // kade_change: use prop-based messages and only essential context
  // REMOVED: useExtensionState() - it was causing ALL ChatRows to re-render on ANY state change
  // Now reads from module-level store that ChatView keeps in sync
  const {
    mcpServers,
    alwaysAllowMcp,
    currentCheckpoint,
    mode,
    apiConfiguration,
    showTimestamps,
    filePaths,
    cwd,
    alwaysAllowReadOnly,
    alwaysAllowWrite,
    alwaysAllowExecute,
    alwaysAllowBrowser,
    alwaysAllowModeSwitch,
    alwaysAllowSubtasks,
    autoApprovalEnabled,
  } = getExtensionStateStore();

  // kade_change: Check if this message is redundant (error text already displayed)
  const isRedundant = useMemo(() => {
    const myIndex = getMessageIndex(message.ts);

    // Check for redundant tool result error text (handled by edit/write tools UI)
    if (message.text && message.text.includes("Result:") && myIndex > 0) {
      const prevMsg = clineMessages[myIndex - 1];
      if (
        prevMsg &&
        prevMsg.type === "ask" &&
        (prevMsg as any).ask === "tool_use"
      ) {
        const tool = parseCachedTool(prevMsg.text);
        if (
          tool &&
          (tool.tool === "appliedDiff" ||
            tool.tool === "edit" ||
            tool.tool === "newFileCreated")
        ) {
          if (
            message.text.startsWith(
              `[${tool.tool === "appliedDiff" || tool.tool === "newFileCreated" ? "edit" : tool.tool}`,
            )
          ) {
            return true;
          }
        }
      }
    }

    // NOTE: readFile de-duplication is handled in ChatView.tsx's visibleMessages filter
    // to avoid spacing issues when returning null here

    return false;
  }, [clineMessages, message.ts, message.text]);

  const shouldHideToolFollowupError = useMemo(() => {
    const messageIndex = getMessageIndex(message.ts);
    if (messageIndex === -1) {
      return false;
    }

    return shouldHideToolFollowupErrorMessage({
      messages: clineMessages,
      index: messageIndex,
      apiProvider: apiConfiguration?.apiProvider,
    });
  }, [apiConfiguration?.apiProvider, clineMessages, message.ts]);

  // NOTE: isRedundant check moved to after all hooks (React Rules of Hooks)

  // kade_change: Check if this is the latest task completed message
  const isLatestTaskCompleted = useMemo(() => {
    if (message.say !== "completion_result") return false;
    for (let i = clineMessages.length - 1; i >= 0; i--) {
      const msg = clineMessages[i];
      if (msg && msg.say === "completion_result") return msg.ts === message.ts;
    }
    return false;
  }, [clineMessages, message.say, message.ts]);
  const { info: model } = useSelectedModel(apiConfiguration);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.text || "");
  const [editMode, setEditMode] = useState<Mode>(mode || "code");
  const [editImages, setEditImages] = useState<string[]>([]);
  const [, copyToClipboard] = useCopyToClipboard();
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = useCallback(
    (text: string) => {
      copyToClipboard(text);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    },
    [copyToClipboard],
  );

  // Handle message events for image selection during edit mode
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (
        msg.type === "selectedImages" &&
        msg.context === "edit" &&
        msg.messageTs === message.ts &&
        isEditing
      ) {
        setEditImages((prevImages) =>
          appendImages(prevImages, msg.images, MAX_IMAGES_PER_MESSAGE),
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isEditing, message.ts]);

  // Memoized callback to prevent re-renders caused by inline arrow functions.
  const handleToggleExpand = useCallback(() => {
    onToggleExpand(message.ts, isExpanded);
  }, [onToggleExpand, message.ts, isExpanded]);

  // Handle edit button click
  const handleEditClick = useCallback(() => {
    setIsEditing(true);
    setEditedContent(message.text || "");
    setEditImages(message.images || []);
    setEditMode(mode || "code");
    // Edit mode is now handled entirely in the frontend
    // No need to notify the backend
  }, [message.text, message.images, mode]);

  // Handle cancel edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedContent(message.text || "");
    setEditImages(message.images || []);
    setEditMode(mode || "code");
  }, [message.text, message.images, mode]);

  // Handle save edit
  const handleSaveEdit = useCallback(() => {
    setIsEditing(false);
    vscode.postMessage({
      type: "submitEditedMessage",
      value: message.ts,
      editedMessageContent: editedContent,
      images: editImages,
    });
  }, [message.ts, editedContent, editImages]);

  // Handle image selection for editing
  const handleSelectImages = useCallback(() => {
    vscode.postMessage({
      type: "selectImages",
      context: "edit",
      messageTs: message.ts,
    });
  }, [message.ts]);

  // kade_change: usageMissing, inferenceProvider
  const [cost, usageMissing, apiReqCancelReason, apiReqStreamingFailedMessage] =
    useMemo(() => {
      if (
        message.text !== null &&
        message.text !== undefined &&
        message.say === "api_req_started"
      ) {
        const info = safeJsonParse<ClineApiReqInfo>(message.text);
        return [
          info?.cost,
          info?.usageMissing,
          info?.cancelReason,
          info?.streamingFailedMessage,
        ];
      }

      return [undefined, undefined, undefined];
    }, [message.text, message.say]);

  // kade_change start: hide cost display check
  // REMOVED: useExtensionState() - read from module-level store instead
  const { hideCostBelowThreshold } = getExtensionStateStore();
  const shouldShowCost = useMemo(() => {
    if (cost === undefined || cost === null || cost <= 0) return false;
    if (isExpanded) return true;
    const threshold = hideCostBelowThreshold ?? 0;
    return cost >= threshold;
  }, [cost, isExpanded, hideCostBelowThreshold]);
  // kade_change end: hide cost display check

  // When resuming task, last wont be api_req_failed but a resume_task
  // message, so api_req_started will show loading spinner. That's why we just
  // remove the last api_req_started that failed without streaming anything.
  const apiRequestFailedMessage =
    isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
      ? lastModifiedMessage?.text
      : undefined;

  // kade_change: Check if the error is the Gemini Clean 429 that the user wants to mask as loading
  const isGeminiRateLimitLoading =
    (apiRequestFailedMessage?.includes("Rate limit exceeded") &&
      apiRequestFailedMessage?.includes("Free tier limits")) ||
    (apiReqStreamingFailedMessage?.includes("Rate limit exceeded") &&
      apiReqStreamingFailedMessage?.includes("Free tier limits"));

  const isMcpServerResponding =
    isLast && lastModifiedMessage?.say === "mcp_server_request_started";

  const type = message.type === "ask" ? message.ask : message.say;

  const normalColor = "var(--vscode-foreground)";
  const errorColor = "var(--vscode-errorForeground)";
  const successColor = "var(--vscode-charts-green)";
  const cancelledColor = "var(--vscode-descriptionForeground)";

  // kade_change: Check if this message is followed by a masked Gemini retry
  const isNextMessageMaskedRetry = useMemo(() => {
    if (!isLast && clineMessages && message.say === "api_req_started") {
      const myIndex = getMessageIndex(message.ts);
      if (myIndex !== -1 && myIndex < clineMessages.length - 1) {
        const nextMsg = clineMessages[myIndex + 1];
        if (
          nextMsg &&
          nextMsg.say === "api_req_retry_delayed" &&
          nextMsg.text
        ) {
          return (
            nextMsg.text.includes("Rate limit exceeded") &&
            nextMsg.text.includes("Free tier limits")
          );
        }
      }
    }
    return false;
  }, [isLast, clineMessages, message.ts, message.say]);

  // kade_change: Check if this message is followed by a tool use (edit/write)
  const shouldSuppressApiRequestRow = useMemo(
    () =>
      message.say === "api_req_started"
        ? shouldSuppressApiRequestRowForToolTurn(clineMessages, message.ts)
        : false,
    [clineMessages, message.say, message.ts],
  );

  // kade_change: Check if this message is followed by a reasoning block
  const isNextMessageReasoning = useMemo(() => {
    const index = getMessageIndex(message.ts);
    if (
      index !== -1 &&
      index < clineMessages.length - 1 &&
      message.say === "api_req_started"
    ) {
      const nextMsg = clineMessages[index + 1];
      if (nextMsg && nextMsg.say === "reasoning") {
        return true;
      }
    }
    return false;
  }, [clineMessages, message.ts, message.say]);

  const shouldKeepApiRequestRowVisible = useMemo(() => {
    if (message.say !== "api_req_started") {
      return false;
    }

    if (shouldSuppressApiRequestRow) {
      return false;
    }

    const myIndex = getMessageIndex(message.ts);
    if (myIndex === -1) {
      return false;
    }

    const nextMsg = clineMessages[myIndex + 1];
    // If there's no next message yet and this is the last message, keep it visible (first message case)
    if (!nextMsg) {
      return isLast;
    }

    if (nextMsg.say === "reasoning") {
      return nextMsg.partial === true;
    }

    if (nextMsg.say === "api_req_retry_delayed") {
      return true;
    }

    if (nextMsg.type === "ask" && nextMsg.ask === "tool") {
      return nextMsg.partial === true;
    }

    if (nextMsg.type === "say" && nextMsg.say === "tool") {
      return nextMsg.partial === true;
    }

    if (nextMsg.type === "say" && nextMsg.say === "text") {
      return nextMsg.partial === true && !(nextMsg.text || "").trim();
    }

    return false;
  }, [
    clineMessages,
    message.say,
    message.ts,
    isLast,
    shouldSuppressApiRequestRow,
  ]);

  const liveStatusLabel = useMemo(() => {
    const fallback =
      message.say === "reasoning" ? t("chat:reasoning.thinking") : "Working";

    return deriveAgentStatusLabel(clineMessages, message.ts, fallback);
  }, [clineMessages, message.say, message.ts, t]);

  const showStreamingStatus = useMemo(() => {
    if (message.say !== "api_req_started") {
      return false;
    }

    if (shouldSuppressApiRequestRow) {
      return false;
    }

    return isLast || shouldKeepApiRequestRowVisible;
  }, [
    isLast,
    message.say,
    shouldKeepApiRequestRowVisible,
    shouldSuppressApiRequestRow,
  ]);

  // Find the assistant message that triggered this command
  const assistantCommand = useMemo(() => {
    if (message.ask !== "command") return undefined;
    const currentIndex = getMessageIndex(message.ts);
    if (currentIndex === -1) return undefined;

    // Look backwards for the assistant message with bash tool
    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = clineMessages[i];
      if (!msg) {
        continue;
      }

      const isToolMessage =
        (msg.type === "ask" && msg.ask === "tool") ||
        (msg.type === "say" && msg.say === "tool");

      if (!isToolMessage) {
        continue;
      }

      const toolData = parseCachedTool(msg.text);
      const isBashTool =
        toolData?.tool === "bash" || isBashToolPayload(msg.text);

      if (isBashTool) {
        const commandPreview =
          (typeof toolData?.command === "string" && toolData.command.trim()) ||
          extractBashCommandPreview(msg.text);

        if (commandPreview) {
          return commandPreview;
        }
      }
    }
    return undefined;
  }, [clineMessages, message.ts, message.ask]);

  const [icon, title] = useMemo(() => {
    switch (type) {
      case "error":
      case "mistake_limit_reached":
        return [null, null]; // These will be handled by ErrorRow component

      case "use_mcp_server":
        const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text);
        if (mcpServerUse === undefined) {
          return [null, null];
        }
        return [
          isMcpServerResponding ? (
            <ProgressIndicator />
          ) : (
            <span
              className="codicon codicon-server"
              style={{ color: normalColor, marginBottom: "-1.5px" }}
            ></span>
          ),
          <span style={{ color: normalColor, fontWeight: "bold" }}>
            {mcpServerUse.type === "use_mcp_tool"
              ? t("chat:mcp.wantsToUseTool", {
                  serverName: mcpServerUse.serverName,
                })
              : t("chat:mcp.wantsToAccessResource", {
                  serverName: mcpServerUse.serverName,
                })}
          </span>,
        ];
      case "completion_result":
        return [
          <span
            className="codicon codicon-check"
            style={{ color: successColor, marginBottom: "-1.5px" }}
          ></span>,
          <span style={{ color: successColor, fontWeight: "bold" }}>
            {t("chat:taskCompleted")}
          </span>,
        ];
      case "api_req_retry_delayed":
        return [];
      case "api_req_started":
        const getIconSpan = (iconName: string, color: string) => (
          <div
            style={{
              width: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className={`codicon codicon - ${iconName}`}
              style={{ color, fontSize: 16, marginBottom: "-1.5px" }}
            />
          </div>
        );
        return [
          apiReqCancelReason !== null && apiReqCancelReason !== undefined
            ? apiReqCancelReason === "user_cancelled"
              ? getIconSpan("error", cancelledColor)
              : getIconSpan("error", errorColor)
            : cost !== null && cost !== undefined
              ? // kade_change start: hide api req started and cost
                null
              : // kade_change end
                apiRequestFailedMessage && !isGeminiRateLimitLoading
                ? getIconSpan("error", errorColor)
                : // Minimalistic finish: no icon for streaming state
                  null,
          apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
            apiReqCancelReason === "user_cancelled" ? (
              <span style={{ color: normalColor, fontWeight: "bold" }}>
                {t("chat:apiRequest.cancelled")}
              </span>
            ) : (
              <span style={{ color: errorColor, fontWeight: "bold" }}>
                {t("chat:apiRequest.streamingFailed")}
              </span>
            )
          ) : cost !== null &&
            cost !== undefined ? null : apiRequestFailedMessage && // kade_change start: hide api req started and cost // kade_change end
            !isGeminiRateLimitLoading ? (
            <span style={{ color: errorColor }}>
              {t("chat:apiRequest.failed")}
            </span>
          ) : !isLast && !shouldKeepApiRequestRowVisible ? null : (
            <div style={{ fontFamily: '"Segoe WPC", "Segoe UI", sans-serif' }}>
              <SmoothStreamingStatus
                visible={showStreamingStatus}
                text={liveStatusLabel}
              />
            </div>
          ),
        ];
      case "followup":
        // kade_change: hide question icon and title
        return [null, null];
      default:
        return [null, null];
    }
  }, [
    type,
    message,
    isMcpServerResponding,
    apiReqCancelReason,
    cost,
    apiRequestFailedMessage,
    isLast,
    t,
    isGeminiRateLimitLoading,
    isNextMessageMaskedRetry,
    shouldSuppressApiRequestRow,
    shouldKeepApiRequestRowVisible,
    showStreamingStatus,
    liveStatusLabel,
  ]);

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "6px",
    wordBreak: "break-word",
  };

  const tool = useMemo(
    () =>
      message.ask === "tool" || (message.say as string) === "tool"
        ? parseCachedTool(message.text)
        : null,
    [message.ask, message.say, message.text],
  );

  // kade_change: Look ahead to find the result of this tool execution
  // Uses module-level cache to prevent oscillation during re-renders
  const toolResult = useMemo(() => {
    if (!tool) return undefined;

    // Check cache first - once found, a tool result is sticky
    const cached = toolResultCache.get(message.ts);
    if (cached) return cached;

    const myIndex = getMessageIndex(message.ts);

    if (myIndex !== -1) {
      // Scan forward for the result (limit to next few messages to avoid false positives)
      for (let i = 1; i <= 5; i++) {
        if (myIndex + i >= clineMessages.length) break;
        const nextMsg = clineMessages[myIndex + i];

        if (nextMsg && nextMsg.text) {
          // Skip tool-state messages (partial streaming tool payloads and tool permission/result wrappers)
          const isToolStateMessage =
            nextMsg.say === "tool" ||
            nextMsg.ask === "tool" ||
            nextMsg.partial === true;

          // Skip API metadata and reasoning blocks
          const isApiMetadata =
            nextMsg.text.startsWith("{") &&
            (nextMsg.text.includes('"apiProtocol"') ||
              nextMsg.text.includes('"cost"'));
          const isReasoning = nextMsg.say === "reasoning";

          if (!isToolStateMessage && !isApiMetadata && !isReasoning) {
            // Check if message contains "The tool execution failed"
            // Format: "[edit for 'file'] Result:\nThe tool execution failed..."
            const isError =
              nextMsg.text.includes("The tool execution failed") ||
              nextMsg.text.startsWith("errors.geminiCli");

            const result: CachedToolResult = {
              type: "tool_result",
              content: nextMsg.text,
              is_error: isError,
            };

            // Cache it so it never oscillates back to undefined
            toolResultCache.set(message.ts, result);
            return result;
          }
        }
      }
    }
    return undefined;
  }, [tool, clineMessages, message.ts]);

  // Unified diff content (provided by backend when relevant)
  const unifiedDiff = useMemo(() => {
    if (!tool) return undefined;
    return (tool.content ?? tool.diff) as string | undefined;
  }, [tool]);

  const followUpData = useMemo(() => {
    if (
      message.type === "ask" &&
      message.ask === "followup" &&
      !message.partial
    ) {
      return safeJsonParse<FollowUpData>(message.text);
    }
    return null;
  }, [message.type, message.ask, message.partial, message.text]);

  const responseSources = useMemo(
    () => getResponseSourcesForMessage(clineMessages, message.ts),
    [clineMessages, message.ts],
  );

  // Early return for redundant messages (placed after all hooks per React Rules of Hooks)
  if (isRedundant) {
    return null;
  }

  if (tool) {
    const toolIcon = (name: string) => (
      <span
        className={`codicon codicon - ${name}`}
        style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}
      ></span>
    );

    switch (tool.tool as string) {
      case "editedExistingFile":
      case "appliedDiff": {
        // Check if this is a batch diff request
        if (
          message.type === "ask" &&
          tool.batchDiffs &&
          Array.isArray(tool.batchDiffs)
        ) {
          return (
            <>
              <div style={headerStyle}>
                <FileDiff
                  className="w-4 shrink-0"
                  aria-label="Batch diff icon"
                />
                <span style={{ fontWeight: "bold" }}>
                  {t("chat:fileOperations.wantsToApplyBatchChanges")}
                </span>
              </div>
              <BatchDiffApproval files={tool.batchDiffs} ts={message.ts} />
            </>
          );
        }

        // STICKY component selection: once we choose edit or write, stick with it                // This prevents flash when tool properties change during streaming
        let componentType = toolComponentCache.get(message.ts);
        if (!componentType) {
          // KILOCODE LIVE-STREAM FIX:
          // 1. Check tool name first (most reliable)
          if (tool.tool === "newFileCreated") {
            componentType = "write";
          } else if (
            tool.tool === "editedExistingFile" ||
            tool.tool === "appliedDiff"
          ) {
            // 2. If we have content but no diff/edits, it's a write
            if (
              tool.content &&
              !tool.diff &&
              (!tool.edits || tool.edits.length === 0)
            ) {
              componentType = "write";
            } else if (tool.diff || (tool.edits && tool.edits.length > 0)) {
              componentType = "edit";
            }
          }

          // Only cache once we are CERTAIN or the tool is finished
          if (componentType || !message.partial) {
            componentType = componentType || "edit";
            toolComponentCache.set(message.ts, componentType);
          }
        }

        // Regular single file diff - use cached component type
        // KEY FIX: Use tool.id as key - message.ts changes when backend creates new messages
        // STABILIZE KEY: Use a combination of the tool type and the path to ensure
        // that even if IDs or timestamps shift slightly, the component stays mounted.
        if (componentType === "write") {
          return (
            <div className="pl-0">
              <FlashFixWrapper>
                <WriteTool
                  tool={tool}
                  toolResult={toolResult}
                  isLastMessage={isLast}
                  shouldAnimate={false}
                  autoApprovalEnabled={alwaysAllowWrite}
                />
              </FlashFixWrapper>
              {
                // kade_change start
                tool.fastApplyResult && (
                  <div className="border border-vscode-editorGroup-border rounded-lg mt-2 overflow-hidden bg-vscode-editor-background">
                    <FastApplyChatDisplay
                      fastApplyResult={tool.fastApplyResult}
                    />
                  </div>
                )
                // kade_change end
              }
            </div>
          );
        }

        return (
          <div className="pl-0">
            <FlashFixWrapper>
              <EditTool
                tool={tool}
                toolResult={toolResult}
                isLastMessage={isLast}
                shouldAnimate={false}
                autoApprovalEnabled={alwaysAllowWrite}
              />
            </FlashFixWrapper>

            {
              // kade_change start
              tool.fastApplyResult && (
                <div className="border border-vscode-editorGroup-border rounded-lg mt-2 overflow-hidden bg-vscode-editor-background">
                  <FastApplyChatDisplay
                    fastApplyResult={tool.fastApplyResult}
                  />
                </div>
              )
              // kade_change end
            }
          </div>
        );
      }
      case "insertContent":
        return (
          <>
            <div style={headerStyle}>
              {tool.isProtected ? (
                <span
                  className="codicon codicon-lock"
                  style={{
                    color: "var(--vscode-editorWarning-foreground)",
                    marginBottom: "-1.5px",
                  }}
                />
              ) : (
                <Edit className="w-4 shrink-0" aria-label="Insert icon" />
              )}
              <span style={{ fontWeight: "bold" }}>
                {tool.isProtected
                  ? t("chat:fileOperations.wantsToEditProtected")
                  : tool.isOutsideWorkspace
                    ? t("chat:fileOperations.wantsToEditOutsideWorkspace")
                    : tool.lineNumber === 0
                      ? t("chat:fileOperations.wantsToInsertAtEnd")
                      : t("chat:fileOperations.wantsToInsertWithLineNumber", {
                          lineNumber: tool.lineNumber,
                        })}
              </span>
            </div>
            <div className="pl-0">
              <CodeAccordian
                path={tool.path}
                code={unifiedDiff ?? tool.diff}
                language="diff"
                progressStatus={message.progressStatus}
                isLoading={message.partial}
                isExpanded={isExpanded}
                onToggleExpand={handleToggleExpand}
                diffStats={tool.diffStats}
              />
            </div>
          </>
        );
      case "searchAndReplace":
        return (
          <>
            <div style={headerStyle}>
              {tool.isProtected ? (
                <span
                  className="codicon codicon-lock"
                  style={{
                    color: "var(--vscode-editorWarning-foreground)",
                    marginBottom: "-1.5px",
                  }}
                />
              ) : (
                <RefreshCcw
                  className="w-4 shrink-0"
                  aria-label="Replace icon"
                />
              )}
              <span style={{ fontWeight: "bold" }}>
                {tool.isProtected && message.type === "ask"
                  ? t("chat:fileOperations.wantsToEditProtected")
                  : message.type === "ask"
                    ? t("chat:fileOperations.wantsToSearchReplace")
                    : t("chat:fileOperations.didSearchReplace")}
              </span>
            </div>
            <div className="pl-0">
              <CodeAccordian
                path={tool.path}
                code={unifiedDiff ?? tool.diff}
                language="diff"
                progressStatus={message.progressStatus}
                isLoading={message.partial}
                isExpanded={isExpanded}
                onToggleExpand={handleToggleExpand}
                diffStats={tool.diffStats}
              />
            </div>
          </>
        );
      case "codebaseSearch": {
        return null;
      }
      case "updateTodoList" as any: {
        const todos = (tool as any).todos || [];
        if (message.type === "ask") {
          return (
            <div className="mt-[-16px] mb-[-24px]">
              <UpdateTodoListToolBlock
                todos={todos}
                onChange={(newTodos) => {
                  vscode.postMessage({
                    type: "updateTodoList",
                    payload: { todos: newTodos },
                  });
                }}
              />
            </div>
          );
        }

        // Removed TodoChangeDisplay - only show the interactive UpdateTodoListToolBlock
        return null;
      }
      case "newFileCreated":
        return (
          <div className="pl-0">
            <FlashFixWrapper>
              <WriteTool
                tool={tool}
                toolResult={toolResult}
                isLastMessage={isLast}
                shouldAnimate={false}
                autoApprovalEnabled={alwaysAllowWrite}
              />
            </FlashFixWrapper>

            {
              // kade_change start
              tool.fastApplyResult && (
                <div className="border border-vscode-editorGroup-border rounded-lg mt-2 overflow-hidden bg-vscode-editor-background">
                  <FastApplyChatDisplay
                    fastApplyResult={tool.fastApplyResult}
                  />
                </div>
              )
              // kade_change end
            }
          </div>
        );
      case "web":
        return (
          <WebSearchTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "fetch":
        return (
          <WebFetchTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "research_web":
        return (
          <ResearchWebTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      // kade_change start

      case "deleteFile":
        return (
          <>
            <div style={headerStyle}>
              <Trash2 className="w-4 shrink-0" aria-label="Delete icon" />
              <span style={{ fontWeight: "bold" }}>
                {tool.stats
                  ? t("chat:fileOperations.wantsToDeleteDirectory")
                  : t("chat:fileOperations.wantsToDelete")}
              </span>
            </div>
            <div className="pl-0">
              <ToolUseBlock>
                <ToolUseBlockHeader className="group">
                  {tool.path?.startsWith(".") && <span>.</span>}
                  <span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
                    {removeLeadingNonAlphanumeric(tool.path ?? "") + "\u200E"}
                  </span>
                </ToolUseBlockHeader>
                {tool.stats && tool.stats.isComplete === true && (
                  <div
                    className="py-1.5 text-xs text-vscode-descriptionForeground"
                    style={{
                      borderTop: "1px solid var(--vscode-editorGroup-border)",
                    }}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1">
                        <span>📁</span>
                        <span>{tool.stats.directories}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span>📄</span>
                        <span>{tool.stats.files}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span>💾</span>
                        <span>{formatFileSize(tool.stats.size)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </ToolUseBlock>
            </div>
          </>
        );
      // kade_change end
      case "readFile": {
        const groupedMessages = getMessageStore();
        const readSignature = getReadToolSignature(tool, toolResult);
        if (
          isDuplicateReadToolInCurrentTurn(
            message.ts,
            readSignature,
            groupedMessages,
          )
        ) {
          return null;
        }

        // STICKY component selection for read tools
        let readComponentType = toolComponentCache.get(message.ts);
        const isBatchRequest =
          message.type === "ask" &&
          tool.batchFiles &&
          Array.isArray(tool.batchFiles);
        if (!readComponentType) {
          // Streaming batch reads may start without batchFiles in the partial JSON.
          // Only cache the fallback "read" component once the message is complete.
          if (isBatchRequest) {
            readComponentType = "batch-read";
          } else if (!message.partial) {
            readComponentType = "read";
          }

          if (readComponentType) {
            toolComponentCache.set(message.ts, readComponentType);
          }
        }

        if (readComponentType === "batch-read" || isBatchRequest) {
          return (
            <div className="pl-0">
              <BatchFilePermission
                files={tool.batchFiles || []}
                onPermissionResponse={(response) => {
                  onBatchFileResponse?.(response);
                }}
                ts={message?.ts}
                isLastMessage={isLast}
              />
            </div>
          );
        }

        // Regular single file read request
        return (
          <div className="pl-0">
            <ReadTool
              tool={tool}
              toolResult={toolResult}
              isLastMessage={isLast}
              shouldAnimate={isNewMessage}
              autoApprovalEnabled={alwaysAllowReadOnly}
              compactSpacing={compactToolSpacing}
            />
          </div>
        );
      }
      case "fetchInstructions":
        return (
          <>
            <div style={headerStyle}>
              {toolIcon("file-code")}
              <span style={{ fontWeight: "bold" }}>
                {t("chat:instructions.wantsToFetch")}
              </span>
            </div>
            <div className="pl-0">
              <CodeAccordian
                code={tool.content}
                language="markdown"
                isLoading={message.partial}
                isExpanded={isExpanded}
                onToggleExpand={handleToggleExpand}
              />
            </div>
          </>
        );
      case "listDirTopLevel":
        return (
          <ListDirTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "listDirRecursive":
        return (
          <ListDirTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "mkdir":
        return (
          <MkdirTool
            tool={tool}
            toolResult={toolResult}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            autoApprovalEnabled={alwaysAllowWrite}
          />
        );
      case "moveFile":
        return (
          <MoveFileTool
            tool={tool}
            toolResult={toolResult}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            autoApprovalEnabled={alwaysAllowWrite}
          />
        );
      case "grep":
        return (
          <GrepTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "glob":
        return (
          <GlobTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            compactSpacing={compactToolSpacing}
          />
        );
      case "fastContext":
        return (
          <FastContextTool
            tool={tool}
            toolResult={tool}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
          />
        );
      case "switchMode":
        return (
          <>
            <div style={headerStyle}>
              <PocketKnife
                className="w-4 shrink-0"
                aria-label="Switch mode icon"
              />
              <span style={{ fontWeight: "bold" }}>
                {message.type === "ask" ? (
                  <>
                    {tool.reason ? (
                      <Trans
                        i18nKey="chat:modes.wantsToSwitchWithReason"
                        components={{
                          code: (
                            <code className="font-medium">{tool.mode}</code>
                          ),
                        }}
                        values={{ mode: tool.mode, reason: tool.reason }}
                      />
                    ) : (
                      <Trans
                        i18nKey="chat:modes.wantsToSwitch"
                        components={{
                          code: (
                            <code className="font-medium">{tool.mode}</code>
                          ),
                        }}
                        values={{ mode: tool.mode }}
                      />
                    )}
                  </>
                ) : (
                  <>
                    {tool.reason ? (
                      <Trans
                        i18nKey="chat:modes.didSwitchWithReason"
                        components={{
                          code: (
                            <code className="font-medium">{tool.mode}</code>
                          ),
                        }}
                        values={{ mode: tool.mode, reason: tool.reason }}
                      />
                    ) : (
                      <Trans
                        i18nKey="chat:modes.didSwitch"
                        components={{
                          code: (
                            <code className="font-medium">{tool.mode}</code>
                          ),
                        }}
                        values={{ mode: tool.mode }}
                      />
                    )}
                  </>
                )}
              </span>
            </div>
          </>
        );
      case "newTask":
        return (
          <>
            <div style={headerStyle}>
              {toolIcon("tasklist")}
              <span style={{ fontWeight: "bold" }}>
                <Trans
                  i18nKey="chat:subtasks.wantsToCreate"
                  components={{ code: <code>{tool.mode}</code> }}
                  values={{ mode: tool.mode }}
                />
              </span>
            </div>
            <div
              style={{
                marginTop: "4px",
                backgroundColor: "var(--vscode-badge-background)",
                border: "1px solid var(--vscode-badge-background)",
                borderRadius: "4px 4px 0 0",
                overflow: "hidden",
                marginBottom: "2px",
              }}
            >
              <div
                style={{
                  padding: "9px 10px 9px 14px",
                  backgroundColor: "var(--vscode-badge-background)",
                  borderBottom: "1px solid var(--vscode-editorGroup-border)",
                  fontWeight: "bold",
                  fontSize: "var(--vscode-font-size)",
                  color: "var(--vscode-badge-foreground)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span className="codicon codicon-arrow-right"></span>
                {t("chat:subtasks.newTaskContent")}
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor: "var(--vscode-editor-background)",
                }}
              >
                <MarkdownBlock markdown={tool.content} />
              </div>
            </div>
          </>
        );
      case "agent":
        const subAgentIndex =
          clineMessages
            .slice(0, getMessageIndex(message.ts) + 1)
            .filter((msg) => {
              return parseCachedTool(msg.text)?.tool === "agent";
            }).length || 1;
        return (
          <RunSubAgentTool
            tool={tool}
            toolResult={toolResult}
            isLastMessage={isLast}
            shouldAnimate={isNewMessage}
            autoApprovalEnabled={autoApprovalEnabled}
            alwaysAllowSubtasks={alwaysAllowSubtasks}
            subAgentIndex={subAgentIndex}
          />
        );
      case "finishTask":
        return (
          <>
            <div style={headerStyle}>
              {toolIcon("check-all")}
              <span style={{ fontWeight: "bold" }}>
                {t("chat:subtasks.wantsToFinish")}
              </span>
            </div>
            <div
              style={{
                marginTop: "4px",
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-badge-background)",
                borderRadius: "4px",
                overflow: "hidden",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  padding: "9px 10px 9px 14px",
                  backgroundColor: "var(--vscode-badge-background)",
                  borderBottom: "1px solid var(--vscode-editorGroup-border)",
                  fontWeight: "bold",
                  fontSize: "var(--vscode-font-size)",
                  color: "var(--vscode-badge-foreground)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span className="codicon codicon-check"></span>
                {t("chat:subtasks.completionContent")}
              </div>
              <div
                style={{
                  padding: "16px 18px",
                  backgroundColor: "var(--vscode-editor-background)",
                }}
              >
                <MarkdownBlock
                  markdown={t("chat:subtasks.completionInstructions")}
                />
              </div>
            </div>
          </>
        );
      case "runSlashCommand": {
        const slashCommandInfo = tool;
        return (
          <>
            <div style={headerStyle}>
              {toolIcon("play")}
              <span style={{ fontWeight: "bold" }}>
                {message.type === "ask"
                  ? t("chat:slashCommand.wantsToRun")
                  : t("chat:slashCommand.didRun")}
              </span>
            </div>
            <div
              style={{
                marginTop: "4px",
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-editorGroup-border)",
                borderRadius: "4px",
                overflow: "hidden",
                cursor: "pointer",
              }}
              onClick={handleToggleExpand}
            >
              <ToolUseBlockHeader
                className="group"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span
                    style={{
                      fontWeight: "500",
                      fontSize: "var(--vscode-font-size)",
                    }}
                  >
                    /{slashCommandInfo.command}
                  </span>
                  {slashCommandInfo.source && (
                    <VSCodeBadge
                      style={{
                        fontSize: "calc(var(--vscode-font-size) - 2px)",
                      }}
                    >
                      {slashCommandInfo.source}
                    </VSCodeBadge>
                  )}
                </div>
                <span
                  className={`codicon codicon - chevron - ${isExpanded ? "up" : "down"} opacity - 0 group - hover: opacity - 100 transition - opacity duration - 200`}
                ></span>
              </ToolUseBlockHeader>
              {isExpanded &&
                (slashCommandInfo.args || slashCommandInfo.description) && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderTop: "1px solid var(--vscode-editorGroup-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {slashCommandInfo.args && (
                      <div>
                        <span style={{ fontWeight: "500" }}>Arguments: </span>
                        <span
                          style={{
                            color: "var(--vscode-descriptionForeground)",
                          }}
                        >
                          {slashCommandInfo.args}
                        </span>
                      </div>
                    )}
                    {slashCommandInfo.description && (
                      <div
                        style={{ color: "var(--vscode-descriptionForeground)" }}
                      >
                        {slashCommandInfo.description}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </>
        );
      }
      case "generateImage":
        return (
          <>
            <div style={headerStyle}>
              {tool.isProtected ? (
                <span
                  className="codicon codicon-lock"
                  style={{
                    color: "var(--vscode-editorWarning-foreground)",
                    marginBottom: "-1.5px",
                  }}
                />
              ) : (
                toolIcon("file-media")
              )}
              <span style={{ fontWeight: "bold" }}>
                {message.type === "ask"
                  ? tool.isProtected
                    ? t("chat:fileOperations.wantsToGenerateImageProtected")
                    : tool.isOutsideWorkspace
                      ? t(
                          "chat:fileOperations.wantsToGenerateImageOutsideWorkspace",
                        )
                      : t("chat:fileOperations.wantsToGenerateImage")
                  : t("chat:fileOperations.didGenerateImage")}
              </span>
            </div>
            {message.type === "ask" && (
              <div className="pl-0">
                <ToolUseBlock>
                  <div className="p-2">
                    <div className="mb-2 break-words">{tool.content}</div>
                    <div className="flex items-center gap-1 text-xs text-vscode-descriptionForeground">
                      {tool.path}
                    </div>
                  </div>
                </ToolUseBlock>
              </div>
            )}
          </>
        );
      case "wrap":
        return <WrapTool tool={tool} />;
      default:
        return null;
    }
  }

  switch (message.type) {
    case "say":
      switch (message.say) {
        case "diff_error":
          return (
            <ErrorRow
              type="diff_error"
              message={message.text || ""}
              expandable={true}
              showCopyButton={true}
            />
          );
        case "subtask_result":
          return (
            <div>
              <div
                style={{
                  marginTop: "0px",
                  backgroundColor: "var(--vscode-badge-background)",
                  border: "1px solid var(--vscode-badge-background)",
                  borderRadius: "0 0 4px 4px",
                  overflow: "hidden",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    padding: "9px 10px 9px 14px",
                    backgroundColor: "var(--vscode-badge-background)",
                    borderBottom: "1px solid var(--vscode-editorGroup-border)",
                    fontWeight: "bold",
                    fontSize: "var(--vscode-font-size)",
                    color: "var(--vscode-badge-foreground)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span className="codicon codicon-arrow-left"></span>
                  {t("chat:subtasks.resultContent")}
                </div>
                <div
                  style={{
                    padding: "12px 16px",
                    backgroundColor: "var(--vscode-editor-background)",
                  }}
                >
                  <MarkdownBlock markdown={message.text} />
                </div>
              </div>
            </div>
          );
        case "reasoning":
          const isReasoningStreaming =
            message.partial === true && isLast && isStreaming;
          const wasReasoningInterrupted =
            message.partial === true && !isReasoningStreaming;

          return (
            <div className="pl-0 markdown-no-top-margin">
              <ReasoningBlock
                content={message.text || ""}
                ts={message.ts}
                isStreaming={isReasoningStreaming}
                isLast={isLast}
                isCollapsed={!isExpanded}
                onToggle={handleToggleExpand}
                metadata={message.metadata as any}
                wasInterrupted={wasReasoningInterrupted}
              />
            </div>
          );
        case "api_req_started":
          // kade_change start: hide entire block when request is finished or when the turn has moved to reasoning/text
          // Also hide when there's an active reasoning block to prevent loading text appearing above thinking indicator
          if (
            (cost !== null &&
              cost !== undefined &&
              !apiReqCancelReason &&
              !apiRequestFailedMessage) ||
            shouldSuppressApiRequestRow ||
            (!isLast &&
              !isNextMessageMaskedRetry &&
              !shouldKeepApiRequestRowVisible) ||
            isNextMessageReasoning
          ) {
            return null;
          }
          // kade_change end
          // Determine if the API request is in progress
          const isApiRequestInProgress =
            (apiReqCancelReason === undefined &&
              apiRequestFailedMessage === undefined &&
              cost === undefined) ||
            isGeminiRateLimitLoading;

          return (
            <>
              <div
                className={`group text - sm transition - opacity ${
                  isApiRequestInProgress
                    ? "opacity-100"
                    : "opacity-40 hover:opacity-100"
                }`}
                style={{
                  ...headerStyle,
                  marginBottom:
                    ((cost === null || cost === undefined) &&
                      apiRequestFailedMessage) ||
                    apiReqStreamingFailedMessage
                      ? 10
                      : 0,
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexGrow: 1,
                  }}
                >
                  {icon}
                  {/* kade_change start */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexGrow: 1,
                    }}
                  >
                    {title}
                    {showTimestamps && <ChatTimestamps ts={message.ts} />}
                  </div>
                  {/* kade_change end */}
                </div>
                {/* kade_change: hide cost display
								<div
									className="text-xs text-vscode-dropdown-foreground border-vscode-dropdown-border/50 border px-1.5 py-0.5 rounded-lg"
									style={{ opacity: shouldShowCost ? 1 : 0 }}>
									${Number(cost || 0)?.toFixed(4)}
								</div>
								*/}
                {
                  // kade_change start
                  !cost && usageMissing && (
                    <StandardTooltip
                      content={t("kilocode:pricing.costUnknownDescription")}
                    >
                      <div className="flex items-center text-xs text-vscode-dropdown-foreground border-vscode-dropdown-border/50 border px-1.5 py-0.5 rounded-lg whitespace-nowrap">
                        <span className="codicon codicon-warning pr-1"></span>
                        {t("kilocode:pricing.costUnknown")}
                      </div>
                    </StandardTooltip>
                  )
                  // kade_change end
                }
              </div>
              {(((cost === null || cost === undefined) &&
                apiRequestFailedMessage &&
                !isGeminiRateLimitLoading) ||
                (apiReqStreamingFailedMessage &&
                  !isGeminiRateLimitLoading)) && (
                <ErrorRow
                  type="api_failure"
                  message={
                    apiRequestFailedMessage ||
                    apiReqStreamingFailedMessage ||
                    ""
                  }
                />
              )}
            </>
          );
        case "api_req_retry_delayed":
          let body = t(`chat: apiRequest.failed`);
          let retryInfo, rawError, code;
          if (message.text !== undefined) {
            // Suppress Antigravity FAILED_PRECONDITION errors - these are handled with retry logic
            if (
              message.text.includes("FAILED_PRECONDITION") &&
              message.text.includes("Precondition check failed")
            ) {
              // Don't show this error in chat - it's handled by retry logic
              return null;
            }

            // Try to show richer error message for that code, if available
            const potentialCode = parseInt(message.text.substring(0, 3));
            if (!isNaN(potentialCode) && potentialCode >= 400) {
              code = potentialCode;
              const stringForError = `chat: apiRequest.errorMessage.${code}`;
              if (i18n.exists(stringForError)) {
                body = t(stringForError);
                // Fill this out in upcoming PRs
                // Do not remove this
                // switch(code) {
                // 	case ERROR_CODE:
                // 		docsURL = ???
                // 		break;
                // }
              } else {
                body = t("chat:apiRequest.errorMessage.unknown");
              }
            } else if (message.text.indexOf("Connection error") === 0) {
              body = t("chat:apiRequest.errorMessage.connection");
            } else {
              body = message.text;
            }

            // kade_change: Hide the retry delay error row if it's the Gemini rate limit
            if (
              (body.includes("Rate limit exceeded") &&
                body.includes("Free tier limits")) ||
              (message.text.includes("Rate limit exceeded") &&
                message.text.includes("Free tier limits"))
            ) {
              // Use a tiny placeholder to keep the list structure if needed, or null.
              // However, we want the PREVIOUS api_req_started (loading spinner) to be visible.
              // If we return null here, this row disappears.
              return null;
            }

            // This isn't pretty, but since the retry logic happens at a lower level
            // and the message object is just a flat string, we need to extract the
            // retry information using this "tag" as a convention
            const retryTimerMatch = message.text.match(
              /<retry_timer>(.*?)<\/retry_timer>/,
            );
            const retryTimer =
              retryTimerMatch && retryTimerMatch[1]
                ? parseInt(retryTimerMatch[1], 10)
                : 0;
            rawError = message.text
              .replace(/<retry_timer>(.*?)<\/retry_timer>/, "")
              .trim();
            retryInfo = retryTimer > 0 && (
              <span
                className={cn(
                  "font-normal text-[11px] text-vscode-descriptionForeground cursor-default flex items-center gap-1 transition-all duration-1000 ml-1",
                  retryTimer === 0 ? "opacity-0" : "opacity-100",
                )}
              >
                <Repeat2 size={12} strokeWidth={1.5} />
                <span>{retryTimer}s</span>
              </span>
            );
          }
          return (
            <ErrorRow
              type="api_req_retry_delayed"
              message={body}
              additionalContent={retryInfo}
              errorDetails={rawError}
            />
          );
        case "api_req_finished":
        case "api_req_retried":
        case "api_req_deleted":
        case "mcp_server_request_started":
        case "command":
          return null; // we should never see this message type as a visible row
        case "text": {
          const sayText = message.text || "";
          const {
            reasoningContent,
            regularContent,
            reasoningIsStreaming,
          } = splitThinkingContent(sayText);
          // kade_change: surgically strip "cancer blocks" (redundant code echoes and protocol noise)
          const sayCleanText = stripChatToolFenceBlocks(
            stripSharedProtocolMarkdown(stripThinkingTags(regularContent)),
          ).trim();

          if (!reasoningContent && !sayCleanText && !message.images?.length) {
            return null;
          }

          return (
            <div className="w-full">
              <div
                className={cn(
                  "pl-0 markdown-no-top-margin w-full",
                  message.partial && "assistant-content is-streaming",
                )}
              >
                {reasoningContent && (
                  <div className="mb-1">
                    <ReasoningBlock
                      content={reasoningContent}
                      ts={message.ts}
                      isStreaming={!!message.partial && reasoningIsStreaming}
                      isLast={isLast}
                      isCollapsed={!isExpanded}
                      onToggle={handleToggleExpand}
                    />
                  </div>
                )}
                {sayCleanText && (
                  <Markdown
                    markdown={sayCleanText}
                    partial={message.partial}
                    stableId={`chat:${message.ts}`}
                  />
                )}
                {message.images && message.images.length > 0 && (
                  <div style={{ marginTop: "10px" }}>
                    {message.images.map((image, index) => (
                      <ImageBlock key={index} imageData={image} />
                    ))}
                  </div>
                )}
                {!message.partial && !isStreaming && showResponseActions && (
                  <ResponseActions
                    text={sayCleanText || ""}
                    copyClassName="mt-0 ml-45"
                    sources={responseSources}
                  />
                )}
              </div>
            </div>
          );
        }
        case "task":
        case "user_feedback": {
          const rawUserText = message.text || "";
          // kade_change: also strip protocol noise from user bubbles if it leaks there
          const cleanUserText = rawUserText
            .replace(
              /\[(?:bash|read|edit|write|grep|glob|ls) for[\s\S]*?\] Result:/g,
              "",
            )
            .replace(/Command:\s*[\s\S]*?\nOutput:[\s\S]*/i, "")
            .trim();

          if (!cleanUserText && !message.images?.length) return null;

          const lines = cleanUserText.match(/\n/g)?.length || 0;
          const isLargeUserMessage = cleanUserText.length > 45 || lines > 1;

          return (
            <div className="group flex flex-col my-0 w-full items-end">
              <UserMessageBubble
                $isEditing={isEditing}
                $isNew={isNewMessage}
                $isLarge={isLargeUserMessage}
              >
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <ChatTextArea
                      inputValue={editedContent}
                      setInputValue={setEditedContent}
                      sendingDisabled={false}
                      selectApiConfigDisabled={true}
                      placeholderText={t("chat:editMessage.placeholder")}
                      selectedImages={editImages}
                      setSelectedImages={setEditImages}
                      onSend={handleSaveEdit}
                      onSelectImages={handleSelectImages}
                      shouldDisableImages={!model?.supportsImages}
                      mode={editMode}
                      setMode={setEditMode}
                      modeShortcutText=""
                      isEditMode={true}
                      onCancel={handleCancelEdit}
                      onDelete={() => {
                        vscode.postMessage({
                          type: "deleteMessage",
                          value: message.ts,
                        });
                        handleCancelEdit();
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex justify-between relative">
                    <div
                      className={cn(
                        "flex-grow wrap-anywhere transition-colors",
                        isLargeUserMessage
                          ? "w-full max-h-48 overflow-y-auto overflow-x-hidden custom-scrollbar"
                          : "",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isStreaming) {
                          handleEditClick();
                        }
                      }}
                      title={t("chat:queuedMessages.clickToEdit")}
                    >
                      <Mention text={cleanUserText} withShadow />
                    </div>
                    <FloatingPillControls>
                      {isStreaming ? (
                        <div className="flex items-center justify-center w-[22px] h-[22px]">
                          <Loader2
                            size={14}
                            className="animate-spin text-vscode-descriptionForeground"
                          />
                        </div>
                      ) : (
                        <StandardTooltip
                          content={t("chat:queuedMessages.clickToEdit")}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick();
                            }}
                          >
                            <Edit size={14} />
                          </button>
                        </StandardTooltip>
                      )}
                      <StandardTooltip content={hasCopied ? "Copied!" : "Copy"}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(cleanUserText);
                          }}
                        >
                          {hasCopied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </StandardTooltip>
                      <StandardTooltip content={"Unsend"}>
                        <button
                          style={{
                            visibility:
                              isLast && isStreaming ? "hidden" : "visible",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                              type: "deleteMessage",
                              value: message.ts,
                            });
                          }}
                        >
                          <Undo2 size={14} />
                        </button>
                      </StandardTooltip>
                    </FloatingPillControls>
                  </div>
                )}
                {!isEditing && message.images && message.images.length > 0 && (
                  <Thumbnails
                    images={message.images}
                    style={{ marginTop: "8px" }}
                  />
                )}
              </UserMessageBubble>
            </div>
          );
        }
        case "user_feedback_diff":
          const tool = parseCachedTool(message.text);
          return (
            <div style={{ marginTop: -10, width: "100%" }}>
              <CodeAccordian
                code={tool?.diff}
                language="diff"
                isFeedback={true}
                isExpanded={isExpanded}
                onToggleExpand={handleToggleExpand}
              />
            </div>
          );
        case "error":
          if (compactToolSpacing) {
            return null;
          }
          // kade_change start: Show login button for KiloCode auth errors
          const isKiloCodeAuthError = isKiloCodeAuthErrorMessage(
            apiConfiguration?.apiProvider,
            message.text,
          );
          if (!isKiloCodeAuthError && shouldHideToolFollowupError) {
            return null;
          }
          return (
            <ErrorRow
              type="error"
              message={t("chat:error")}
              errorDetails={message.text || undefined}
              showLoginButton={isKiloCodeAuthError}
              onLoginClick={
                isKiloCodeAuthError
                  ? () => {
                      vscode.postMessage({
                        type: "switchTab",
                        tab: "auth",
                        values: { returnTo: "chat" },
                      });
                    }
                  : undefined
              }
            />
          );
        // kade_change end

        case "completion_result":
          const commitRange = message.metadata?.kiloCode?.commitRange;
          return (
            <>
              <CompletionShimmerWrapper
                $active={isLatestTaskCompleted && !message.partial}
              >
                <div
                  style={{ paddingTop: 0 }}
                  className="markdown-no-top-margin"
                >
                  <Markdown
                    markdown={message.text}
                    partial={message.partial}
                    filePaths={filePaths}
                    stableId={`chat:${message.ts}`}
                  />
                  {!message.partial && !isStreaming && showResponseActions && (
                    <ResponseActions
                      text={message.text || ""}
                      copyClassName="mt-1 ml-auto"
                      sources={responseSources}
                    />
                  )}
                </div>
              </CompletionShimmerWrapper>
              {!message.partial &&
                enableCheckpoints !== false &&
                commitRange && (
                  <SeeNewChangesButtons commitRange={commitRange} />
                )}
            </>
          );
        case "shell_integration_warning":
          return <CommandExecutionError />;
        case "command_output":
          return (
            <CommandExecution
              executionId={message.ts.toString()}
              text={message.text}
              isLast={isLast}
              allowOutputAutoScroll={allowCommandAutoScroll}
            />
          );
        case "checkpoint_saved":
          return (
            <CheckpointSaved
              ts={message.ts!}
              commitHash={message.text!}
              currentHash={currentCheckpoint}
              checkpoint={message.checkpoint}
            />
          );
        case "condense_context":
          // In-progress state
          if (message.partial) {
            return <InProgressRow eventType="condense_context" />;
          }
          // Completed state
          if (message.contextCondense) {
            return <CondensationResultRow data={message.contextCondense} />;
          }
          return null;
        case "condense_context_error":
          return <CondensationErrorRow errorText={message.text} />;
        case "sliding_window_truncation":
          // In-progress state
          if (message.partial) {
            return <InProgressRow eventType="sliding_window_truncation" />;
          }
          // Completed state
          if (message.contextTruncation) {
            return <TruncationResultRow data={message.contextTruncation} />;
          }
          return null;
        case "ask_result":
          let parsed: {
            content: {
              query?: string;
              results?: Array<{
                filePath: string;
                score: number;
                startLine: number;
                endLine: number;
                codeChunk: string;
              }>;
              queries?: Array<{
                query: string;
                results: Array<{
                  filePath: string;
                  score: number;
                  startLine: number;
                  endLine: number;
                  codeChunk: string;
                }>;
              }>;
            };
          } | null = null;

          try {
            if (message.text) {
              parsed = JSON.parse(message.text);
            }
          } catch (error) {
            console.error("Failed to parse codebaseSearch content:", error);
          }

          if (parsed && !parsed?.content) {
            console.error(
              "Invalid codebaseSearch content structure:",
              parsed.content,
            );
            return <div>Error displaying search results.</div>;
          }

          // Handle both single query (legacy/simple) and new multi-query structure
          let allResults: Array<{
            filePath: string;
            score: number;
            startLine: number;
            endLine: number;
            codeChunk: string;
            query?: string;
          }> = [];

          if (parsed?.content.queries) {
            allResults = parsed.content.queries.flatMap((q) =>
              q.results.map((r) => ({ ...r, query: q.query })),
            );
          } else if (parsed?.content.results) {
            allResults = parsed.content.results.map((r) => ({
              ...r,
              query: parsed?.content.query,
            }));
          }

          return (
            <div className="pl-0" style={{ marginTop: "-10px" }}>
              <CodebaseSearchResultsDisplay results={allResults} />
            </div>
          );
        case "user_edit_todos":
          return (
            <div className="mt-[-16px] mb-[-24px]">
              <UpdateTodoListToolBlock userEdited onChange={() => {}} />
            </div>
          );
        case "tool" as any:
          // Handle say tool messages
          const sayTool = parseCachedTool(message.text);
          if (!sayTool) return null;
          if ((sayTool.tool as any) === "bash") return null;

          switch (sayTool.tool) {
            case "runSlashCommand": {
              const slashCommandInfo = sayTool;
              return (
                <>
                  <div style={headerStyle}>
                    <span
                      className="codicon codicon-terminal-cmd"
                      style={{
                        color: "var(--vscode-foreground)",
                        marginBottom: "-1.5px",
                      }}
                    ></span>
                    <span style={{ fontWeight: "bold" }}>
                      {t("chat:slashCommand.didRun")}
                    </span>
                  </div>
                  <div className="pl-0">
                    <ToolUseBlock>
                      <ToolUseBlockHeader
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "4px",
                          padding: "10px 12px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            width: "100%",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: "500",
                              fontSize: "var(--vscode-font-size)",
                            }}
                          >
                            /{slashCommandInfo.command}
                          </span>
                          {slashCommandInfo.args && (
                            <span
                              style={{
                                color: "var(--vscode-descriptionForeground)",
                                fontSize: "var(--vscode-font-size)",
                              }}
                            >
                              {slashCommandInfo.args}
                            </span>
                          )}
                        </div>
                        {slashCommandInfo.description && (
                          <div
                            style={{
                              color: "var(--vscode-descriptionForeground)",
                              fontSize: "calc(var(--vscode-font-size) - 1px)",
                            }}
                          >
                            {slashCommandInfo.description}
                          </div>
                        )}
                        {slashCommandInfo.source && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <VSCodeBadge
                              style={{
                                fontSize: "calc(var(--vscode-font-size) - 2px)",
                              }}
                            >
                              {slashCommandInfo.source}
                            </VSCodeBadge>
                          </div>
                        )}
                      </ToolUseBlockHeader>
                    </ToolUseBlock>
                  </div>
                </>
              );
            }
            default:
              return null;
          }
        case "image":
          // Parse the JSON to get imageUri and imagePath
          const imageInfo = safeJsonParse<{
            imageUri: string;
            imagePath: string;
          }>(message.text || "{}");
          if (!imageInfo) {
            return null;
          }
          return (
            <div style={{ marginTop: "10px" }}>
              <ImageBlock
                imageUri={imageInfo.imageUri}
                imagePath={imageInfo.imagePath}
              />
            </div>
          );
        // kade_change start: upstream pr https://github.com/RooCodeInc/Roo-Code/pull/5452
        case "browser_action":
          return null;
        case "browser_action_result":
          // This should not normally be rendered here as browser_action_result messages
          // should be grouped into browser sessions and rendered by BrowserSessionRow.
          // If we see this, it means the message grouping logic has a bug.
          return (
            <>
              {title && (
                <div style={headerStyle}>
                  {icon}
                  {title}
                </div>
              )}
              <div style={{ paddingTop: 10 }}>
                <div
                  style={{
                    color: "var(--vscode-errorForeground)",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    padding: "8px",
                    backgroundColor: "var(--vscode-editor-background)",
                    border: "1px solid var(--vscode-editorError-border)",
                    borderRadius: "4px",
                    marginBottom: "8px",
                  }}
                >
                  ⚠️ Browser action result not properly grouped - this is a bug
                  in the message grouping logic
                </div>
                <Markdown
                  markdown={message.text}
                  partial={message.partial}
                  filePaths={filePaths}
                  cwd={cwd}
                  stableId={`chat:${message.ts}`}
                />
              </div>
            </>
          );
        // kade_change end
        default: {
          const defaultText = message.text || "";
          // kade_change: surgically strip "cancer blocks" (redundant code echoes and protocol noise)
          const defaultCleanText = stripSharedProtocolMarkdown(defaultText)
            .replace(/about:blank/gi, "") // per user request
            .trim();

          if (!defaultCleanText && !message.images?.length) {
            return null;
          }

          return (
            <>
              {title && (
                <div style={headerStyle}>
                  {icon}
                  {/* kade_change start */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexGrow: 1,
                    }}
                  >
                    {title}
                    {showTimestamps && <ChatTimestamps ts={message.ts} />}
                  </div>
                  {/* kade_change end */}
                </div>
              )}
              <div style={{ paddingTop: 10 }}>
                <Markdown
                  markdown={defaultCleanText}
                  partial={message.partial}
                  filePaths={filePaths}
                  cwd={cwd}
                  stableId={`chat:${message.ts}`}
                />
                {!message.partial && !isStreaming && showResponseActions && (
                  <ResponseActions
                    text={defaultCleanText || ""}
                    copyClassName="mt-1 ml-auto"
                    sources={responseSources}
                  />
                )}
              </div>
            </>
          );
        }
      }
    case "ask":
      switch (message.ask) {
        case "mistake_limit_reached":
          return <ErrorRow type="mistake_limit" message={message.text || ""} />;
        case "command":
          return (
            <CommandExecution
              executionId={message.ts.toString()}
              text={message.text}
              isAskingToProceed={isAskingToProceed}
              isLast={isLast}
              assistantCommand={assistantCommand}
              shouldAnimate={isNewMessage}
              allowOutputAutoScroll={allowCommandAutoScroll}
            />
          );
        case "use_mcp_server":
          // Parse the message text to get the MCP server request
          const messageJson = safeJsonParse<any>(message.text, {});

          // Extract the response field if it exists
          const { response, ...mcpServerRequest } = messageJson;

          // Create the useMcpServer object with the response field
          const useMcpServer: ClineAskUseMcpServer = {
            ...mcpServerRequest,
            response,
          };

          if (!useMcpServer) {
            return null;
          }

          const server = mcpServers.find(
            (server) => server.name === useMcpServer.serverName,
          );

          if (useMcpServer.type === "use_mcp_tool") {
            return (
              <McpTool
                executionId={message.ts.toString()}
                serverName={useMcpServer.serverName}
                toolName={useMcpServer.toolName}
                arguments={
                  useMcpServer.arguments !== "{}"
                    ? useMcpServer.arguments
                    : undefined
                }
                useMcpServer={useMcpServer}
                isLastMessage={isLast}
                shouldAnimate={isNewMessage}
              />
            );
          }

          return (
            <>
              <div style={headerStyle}>
                {icon}
                {title}
              </div>
              <div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2 mt-2">
                {useMcpServer.type === "access_mcp_resource" && (
                  <McpResourceRow
                    item={{
                      ...(findMatchingResourceOrTemplate(
                        useMcpServer.uri || "",
                        server?.resources,
                        server?.resourceTemplates,
                      ) || {
                        name: "",
                        mimeType: "",
                        description: "",
                      }),
                      uri: useMcpServer.uri || "",
                    }}
                  />
                )}
              </div>
            </>
          );
        case "completion_result":
          if (message.text) {
            return (
              <div style={{ paddingTop: 0 }} className="markdown-no-top-margin">
                <Markdown
                  markdown={message.text}
                  partial={message.partial}
                  filePaths={filePaths}
                  stableId={`chat:${message.ts}`}
                />
                {!message.partial && !isStreaming && showResponseActions && (
                  <ResponseActions
                    text={message.text || ""}
                    copyClassName="mt-1 ml-auto"
                    sources={responseSources}
                  />
                )}
              </div>
            );
          } else {
            return null; // Don't render anything when we get a completion_result ask without text
          }
        case "followup":
          if (followUpData || message.partial) {
            return (
              <div className="py-2">
                <div className="pl-0 flex flex-col gap-2">
                  <Markdown
                    markdown={
                      message.partial === true
                        ? message?.text
                        : followUpData?.question
                    }
                    filePaths={filePaths}
                  />
                  {!message.partial && !isStreaming && showResponseActions && (
                    <ResponseActions
                      text={followUpData?.question || message?.text || ""}
                      copyClassName="mt-1 ml-auto"
                      sources={responseSources}
                    />
                  )}
                  {/* kade_change: hide suggestions
								<FollowUpSuggest
									suggestions={followUpData?.suggest}
									onSuggestionClick={onSuggestionClick}
									ts={message?.ts}
									onCancelAutoApproval={onFollowUpUnmount}
									isAnswered={isFollowUpAnswered}
									isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
								/> */}
                </div>
              </div>
            );
          } else {
            return (
              <div className="group flex flex-col items-end my-2 px-[4px]">
                <UserMessageBubble $isEditing={isEditing} $isNew={isNewMessage}>
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <ChatTextArea
                        inputValue={editedContent}
                        setInputValue={setEditedContent}
                        sendingDisabled={false}
                        selectApiConfigDisabled={true}
                        placeholderText={t("chat:editMessage.placeholder")}
                        selectedImages={editImages}
                        setSelectedImages={setEditImages}
                        onSend={handleSaveEdit}
                        onSelectImages={handleSelectImages}
                        shouldDisableImages={!model?.supportsImages}
                        mode={editMode}
                        setMode={setEditMode}
                        modeShortcutText=""
                        isEditMode={true}
                        onCancel={handleCancelEdit}
                      />
                    </div>
                  ) : (
                    <div className="flex justify-between relative">
                      <div
                        className={cn(
                          "flex-grow wrap-anywhere transition-colors",
                          (message.text?.length ?? 0) > 50 &&
                            "max-h-48 overflow-y-auto overflow-x-hidden custom-scrollbar",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isStreaming) {
                            handleEditClick();
                          }
                        }}
                        title={t("chat:queuedMessages.clickToEdit")}
                      >
                        <Mention text={message.text} withShadow />
                      </div>
                      <FloatingPillControls>
                        {isStreaming ? (
                          <div className="flex items-center justify-center w-[22px] h-[22px]">
                            <Loader2
                              size={14}
                              className="animate-spin text-vscode-descriptionForeground"
                            />
                          </div>
                        ) : (
                          <StandardTooltip
                            content={t("chat:queuedMessages.clickToEdit")}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick();
                              }}
                            >
                              <Edit size={14} />
                            </button>
                          </StandardTooltip>
                        )}
                        <StandardTooltip
                          content={hasCopied ? "Copied!" : "Copy"}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(message.text || "");
                            }}
                          >
                            {hasCopied ? (
                              <Check size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </StandardTooltip>
                        <StandardTooltip content={"Unsend"}>
                          <button
                            style={{
                              visibility: isStreaming ? "hidden" : "visible",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              vscode.postMessage({
                                type: "deleteMessage",
                                value: message.ts,
                              });
                            }}
                          >
                            <Undo2 size={14} />
                          </button>
                        </StandardTooltip>
                      </FloatingPillControls>
                    </div>
                  )}
                  {!isEditing &&
                    message.images &&
                    message.images.length > 0 && (
                      <Thumbnails
                        images={message.images}
                        style={{ marginTop: "8px" }}
                      />
                    )}
                </UserMessageBubble>
              </div>
            );
          }

        // kade_change begin
        case "condense":
          return (
            <>
              <div style={headerStyle}>
                <span
                  className="codicon codicon-new-file"
                  style={{
                    color: normalColor,
                    marginBottom: "-1.5px",
                  }}
                ></span>
                <span style={{ color: normalColor, fontWeight: "bold" }}>
                  {t("kilocode:chat.condense.wantsToCondense")}
                </span>
              </div>
              <NewTaskPreview context={message.text || ""} />
            </>
          );

        case "payment_required_prompt": {
          return (
            <LowCreditWarning
              message={message}
              isOrganization={!!apiConfiguration.kilocodeOrganizationId}
            />
          );
        }
        case "invalid_model": {
          return <InvalidModelWarning message={message} isLast={isLast} />;
        }
        case "report_bug":
          return (
            <>
              <div style={headerStyle}>
                <span
                  className="codicon codicon-new-file"
                  style={{
                    color: normalColor,
                    marginBottom: "-1.5px",
                  }}
                ></span>
                <span style={{ color: normalColor, fontWeight: "bold" }}>
                  KiloCode wants to create a Github issue:
                </span>
              </div>
              <ReportBugPreview data={message.text || ""} />
            </>
          );
        // kade_change end
        case "auto_approval_max_req_reached": {
          return <AutoApprovedRequestLimitWarning message={message} />;
        }
        default:
          return null;
      }
  }
};

const areChatRowContentPropsEqual = (
  prevProps: ChatRowContentProps,
  nextProps: ChatRowContentProps,
) => {
  if (prevProps.message.ts !== nextProps.message.ts) return false;
  if (prevProps.message.text !== nextProps.message.text) return false;
  if (prevProps.message.partial !== nextProps.message.partial) return false;
  if (prevProps.message.type !== nextProps.message.type) return false;
  if (prevProps.message.ask !== nextProps.message.ask) return false;
  if (prevProps.message.say !== nextProps.message.say) return false;
  if (prevProps.isExpanded !== nextProps.isExpanded) return false;
  if (prevProps.isLast !== nextProps.isLast) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;
  if (prevProps.enableCheckpoints !== nextProps.enableCheckpoints) return false;
  if (prevProps.isFollowUpAnswered !== nextProps.isFollowUpAnswered)
    return false;
  if (
    prevProps.isFollowUpAutoApprovalPaused !==
    nextProps.isFollowUpAutoApprovalPaused
  )
    return false;
  if (prevProps.isAskingToProceed !== nextProps.isAskingToProceed)
    return false;
  if (prevProps.showResponseActions !== nextProps.showResponseActions)
    return false;
  if (prevProps.allowCommandAutoScroll !== nextProps.allowCommandAutoScroll)
    return false;
  if (prevProps.compactToolSpacing !== nextProps.compactToolSpacing)
    return false;

  return true;
};

export const MemoizedChatRowContent = memo(
  ChatRowContent,
  areChatRowContentPropsEqual,
);
