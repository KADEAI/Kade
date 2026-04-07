import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEvent } from "react-use";
import debounce from "debounce";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type DataWithScrollModifier,
  type VirtuosoMessageListMethods,
  type VirtuosoMessageListProps,
} from "@virtuoso.dev/message-list";
import removeMd from "remove-markdown";
import { VSCodeButton as Button } from "@vscode/webview-ui-toolkit/react"; // kade_change: do not use rounded Roo buttons
import useSound from "use-sound";
import { LRUCache } from "lru-cache";
// import { Trans } from "react-i18next"

import { useDebounceEffect } from "@src/utils/useDebounceEffect";
import { appendImages } from "@src/utils/imageUtils";
import { convertToMentionPath } from "@/utils/path-mentions";

import type { ClineAsk, ClineMessage } from "@roo-code/types";

import {
  ClineSayTool,
  ExtensionMessage,
  WAITING_FOR_USER_INPUT_TEXT,
} from "@roo/ExtensionMessage";
import { findLast, findLastIndex } from "@roo/array";
import { safeJsonParse } from "@roo/safeJsonParse";
import { SuggestionItem } from "@roo-code/types";
import { combineApiRequests } from "@roo/combineApiRequests";
import { combineCommandSequences } from "@roo/combineCommandSequences";
import { getApiMetrics } from "@roo/getApiMetrics";
import { AudioType } from "@roo/WebviewMessage";
import { getAllModes } from "@roo/modes";
import { ProfileValidator } from "@roo/ProfileValidator";
import { getLatestTodo } from "@roo/todo";

import { vscode } from "@src/utils/vscode";
import { reportWebviewDebugEvent } from "@src/utils/webviewDebug";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { useExtensionState } from "../../context/ExtensionStateContext";
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel";
// import RooHero from "@src/components/welcome/RooHero" // kade_change: unused
// import RooTips from "@src/components/welcome/RooTips" // kade_change: unused
import { StandardTooltip } from "@src/components/ui";

// import VersionIndicator from "../common/VersionIndicator" // kade_change: unused
import { OrganizationSelector } from "../kilocode/common/OrganizationSelector";
// import { useTaskSearch } from "../history/useTaskSearch" // kade_change: unused
// import { CloudUpsellDialog } from "@src/components/cloud/CloudUpsellDialog" // kade_change: unused

// import TelemetryBanner from "../common/TelemetryBanner" // kade_change: unused
import HistoryDropdown from "../history/HistoryDropdown";
import HistoryDropdownTopView from "../history/HistoryDropdownTopView";
import Announcement from "./Announcement";
import BrowserActionRow from "./BrowserActionRow";
import BrowserSessionStatusRow from "./BrowserSessionStatusRow";
import ToolActivitySummaryRow from "./ToolActivitySummaryRow";
import ChatRow, {
  MemoizedChatRowContent,
  clearToolResultCache,
  setMessageStore,
  setExtensionStateStore,
} from "./ChatRow";
import { VirtualChatList, clearVirtualHeightCache } from "./VirtualChatRow";
import { ChatTextArea } from "./ChatTextArea";
// import TaskHeader from "./TaskHeader"// kade_change
// import KiloTaskHeader from "../kilocode/KiloTaskHeader" // kade_change: unused
// import AutoApproveMenu from "./AutoApproveMenu" // kade_change: unused
// import BottomControls from "../kilocode/BottomControls" // kade_change: unused
// import SystemPromptWarning from "./SystemPromptWarning" // kade_change: unused
// import ProfileViolationWarning from "./ProfileViolationWarning" kade_change: unused
import { ChatScrollDebugger } from "./ChatScrollDebugger";
import { CheckpointWarning } from "./CheckpointWarning";
import { useEmptyStateBackgrounds } from "@/hooks/useEmptyStateBackgrounds";
// import { IdeaSuggestionsBox } from "../kilocode/chat/IdeaSuggestionsBox" // kade_change
// import { KilocodeNotifications } from "../kilocode/KilocodeNotifications" // kade_change: unused
import { Upload, FileText, ImageIcon } from "lucide-react";
import { QueuedMessages } from "./QueuedMessages";
import { EditHistoryTracker } from "./EditHistoryTracker";
import { EmptyState } from "./empty/EmptyState";
import { useStreamingScrollPin } from "./hooks/useStreamingScrollPin";
import {
  shouldFollowStreamingOutput,
  shouldRetainStreamingPin,
} from "./scrollPinUtils";
import {
  filterResolvedOptimisticUserMessages,
  getUserRenderableMessageSignature,
  getUserRenderableRowId,
} from "./chatMessageMatching";
import { clearChatToolParseCache, parseCachedTool } from "./chatToolParseCache";
import {
  CHAT_SCROLL_ANCHOR_ADJUST_EVENT,
  shouldAdjustScrollForToolAnimation,
  type ToolAnimateHeightDetail,
} from "./scrollAnchorUtils";
import {
  buildToolActivitySummaryText,
  getToolActivitySummaryRunning,
} from "./toolActivitySummaryUtils";
import {
  normalizeToolActivityName,
  TOOL_ACTIVITY_SUMMARY_TOOL_NAMES,
} from "./toolActivityLabels";
import { formatToolActivitySearchSubject } from "./toolActivityTargetFormatting";
import { RENDERABLE_TOOL_TYPES } from "./apiRequestRowState";
import { shouldHideToolFollowupErrorMessage } from "./toolFollowupErrorState";
// import { buildDocLink } from "@/utils/docLinks"
// import DismissibleUpsell from "../common/DismissibleUpsell" // kade_change: unused
// import { useCloudUpsell } from "@src/hooks/useCloudUpsell" // kade_change: unused
// import { Cloud } from "lucide-react" // kade_change: unused

export interface ChatViewProps {
  isHidden: boolean;
  showAnnouncement: boolean;
  hideAnnouncement: () => void;
  historyViewType?: "dropdown" | "dropdown-top" | "view"; // kade_change
  layout?: "fullscreen" | "embedded";
}

export interface ChatViewRef {
  acceptInput: () => void;
  toggleHistory: () => void;
  focusInput: () => void; // kade_change
}

type OptimisticUserMessage = ClineMessage & { __optimistic: true };
const TOOL_ACTIVITY_SUMMARY_SAY = "tool_activity_summary";
const FORCE_STABLE_CHAT_LIST = false;
const BOTTOM_OFFSET_THRESHOLD = 60;
const VIRTUOSO_VIEWPORT_OVERSCAN = 1200;
const SMOOTH_BOTTOM_ANCHOR_DURATION_MS = 220;
const USER_WHEEL_SCROLL_RELEASE_WINDOW_MS = 450;
const RENDERABLE_ASK_ROW_TYPES = new Set([
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
const NON_RENDERABLE_SAY_ROW_TYPES = new Set([
  "api_req_finished",
  "api_req_retried",
  "api_req_deleted",
  "mcp_server_request_started",
  "command",
]);

interface ToolActivitySummaryEntry {
  id: string;
  label: string;
  filePath?: string;
  isDirectory?: boolean;
}

interface ToolActivitySummaryMetadata {
  summaryText: string;
  running: boolean;
  entries: ToolActivitySummaryEntry[];
}

interface ToolActivitySummaryMessage
  extends Omit<ClineMessage, "type" | "say" | "metadata"> {
  type: "say";
  say: typeof TOOL_ACTIVITY_SUMMARY_SAY;
  metadata: ToolActivitySummaryMetadata;
}

type ChatRenderRow =
  | {
      id: string;
      kind: "message";
      message: ClineMessage;
      isStreaming: boolean;
    }
  | {
      id: string;
      kind: typeof TOOL_ACTIVITY_SUMMARY_SAY;
      message: ToolActivitySummaryMessage;
      summary: ToolActivitySummaryMetadata;
      groupedMessages: Array<{
        id: string;
        message: ClineMessage;
        isStreaming: boolean;
      }>;
      isStreaming: boolean;
    };

const basename = (value?: string) => {
  if (!value) return "";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
};

const assignRef = <T,>(ref: React.Ref<T> | undefined, value: T | null) => {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as React.MutableRefObject<T | null>).current = value;
};

const stringifySearchTarget = (
  value?: string,
  fallback = "search",
  path?: string,
) => {
  const trimmed = (value || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return basename(path) || fallback;
  return trimmed.length > 92 ? `${trimmed.slice(0, 89)}...` : trimmed;
};

const normalizeToolActivityLabel = (value?: string) =>
  (value || "").replace(/\s+/g, " ").trim();

const getToolActivityEntrySignature = (entry: {
  label: string;
  filePath?: string;
  isDirectory?: boolean;
}) => {
  const normalizedLabel = normalizeToolActivityLabel(entry.label);
  const normalizedPath = (entry.filePath || "").trim();
  return `${normalizedLabel}::${normalizedPath}::${entry.isDirectory ? "dir" : "file"}`;
};

const getToolSignature = (tool: ClineSayTool) => {
  const toolWithPathAliases = tool as ClineSayTool & {
    file_path?: string;
    target_file?: string;
  };

  const rawPath =
    tool.path ??
    toolWithPathAliases.file_path ??
    toolWithPathAliases.target_file ??
    tool.source ??
    tool.destination ??
    "";

  const normalizedToolName = normalizeToolActivityName(tool.tool as string);

  if (normalizedToolName === "readFile") {
    const startLine = (tool as any).lineNumber ?? "";
    const endLine = (tool as any).endLine ?? "";
    const reason = tool.reason ?? "";

    return [rawPath, startLine, endLine, reason].join("|");
  }

  return [tool.tool ?? "", rawPath, tool.mode ?? ""].join("|");
};

const getMutableToolRowFamily = (toolName?: string) => {
  switch (toolName) {
    case "editedExistingFile":
    case "appliedDiff":
    case "insertContent":
    case "searchAndReplace":
    case "newFileCreated":
    case "deleteFile":
    case "moveFile":
    case "mkdir":
    case "wrap":
      return "file-mutation";
    default:
      return null;
  }
};

const dedupeToolActivityEntries = (tools: ClineSayTool[]) => {
  const seen = new Set<string>();
  const dedupedTools: ClineSayTool[] = [];

  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    const dedupKey = getToolActivityEntrySignature(
      buildToolActivityEntry(tool, index),
    );
    if (seen.has(dedupKey)) {
      continue;
    }
    seen.add(dedupKey);
    dedupedTools.push(tool);
  }

  return dedupedTools;
};

const buildToolActivityEntry = (
  tool: ClineSayTool,
  index: number,
): ToolActivitySummaryEntry => {
  const rawToolName = tool.tool as string;
  const toolName = normalizeToolActivityName(rawToolName);
  const path =
    tool.path ||
    (tool as any).file_path ||
    (tool as any).target_file ||
    (tool as any).notebook_path ||
    "";

  switch (toolName) {
    case "readFile":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Read ${basename(path) || "file"}`,
        filePath: path || undefined,
      };
    case "listDirTopLevel":
    case "listDirRecursive":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Explored ${basename(path) || path || "directory"}`,
        filePath: path || undefined,
        isDirectory: true,
      };
    case "grep":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Searched ${formatToolActivitySearchSubject(
          (tool as any).regex || (tool as any).pattern,
          path,
        )}`,
      };
    case "glob":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Searched ${formatToolActivitySearchSubject(
          (tool as any).pattern || (tool as any).glob || (tool as any).query,
          path,
        )}`,
      };
    case "web":
    case "research_web":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Searched ${formatToolActivitySearchSubject(
          (tool as any).query || (tool as any).searchTerm,
          path,
        )}`,
      };
    case "fetch":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Read ${stringifySearchTarget((tool as any).url || path, "web page")}`,
      };
    case "fetchInstructions":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: `Read ${basename(path) || "instructions"}`,
        filePath: path || undefined,
      };
    case "fastContext":
      return {
        id: `${tool.id || toolName}-${index}`,
        label: "Gathered context",
      };
    default:
      return {
        id: `${tool.id || rawToolName}-${index}`,
        label: `Used ${rawToolName}`,
      };
  }
};

const isToolMessage = (message: Pick<ClineMessage, "ask" | "say">) =>
  message.ask === "tool" || message.say === "tool";

export const MAX_IMAGES_PER_MESSAGE = 20; // This is the Anthropic limit.

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

const ChatViewComponent: React.ForwardRefRenderFunction<
  ChatViewRef,
  ChatViewProps
> = (
  {
    isHidden,
    showAnnouncement,
    hideAnnouncement,
    historyViewType,
    layout = "fullscreen",
  },
  ref,
) => {
  const isMountedRef = useRef(true);
  const stuckPartialDebugKeyRef = useRef<string | null>(null);

  const [audioBaseUri] = useState(() => {
    const w = window as any;
    return w.AUDIO_BASE_URI || "";
  });

  const { t } = useAppTranslation();
  const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`;

  const {
    clineMessages: messages,
    currentTaskItem,
    currentTaskIsStreaming,
    currentTaskTodos,
    // taskHistoryFullLength, // kade_change: unused
    // taskHistoryVersion, // kade_change: unused
    showTaskTimeline, // Sync to module-level store for ChatRow
    apiConfiguration,
    organizationAllowList,
    mode,
    setMode,
    alwaysAllowModeSwitch,
    // showAutoApproveMenu, // kade_change: unused
    enableCheckpoints, // kade_change
    alwaysAllowUpdateTodoList,
    customModes,
    telemetrySetting,
    // hasSystemPromptOverride, // kade_change: unused
    historyPreviewCollapsed, // kade_change
    reasoningBlockCollapsed, // kade_change
    soundEnabled,
    soundVolume,
    // cloudIsAuthenticated, // kade_change
    messageQueue = [],
    sendMessageOnEnter, // kade_change
    isBrowserSessionActive,
    experiments, // kade_change
    alwaysAllowReadOnly,
    alwaysAllowWrite,
    alwaysAllowDelete, // kade_change
    alwaysAllowExecute,
    alwaysAllowBrowser,
    alwaysAllowMcp,
    alwaysAllowSubtasks,
    autoApprovalEnabled,
    cwd,
    mcpServers,
    currentCheckpoint,
    showTimestamps,
    filePaths,
    hideCostBelowThreshold,
    chatBackground,
    chatBackgroundUri,
  } = useExtensionState();
  const { options: backgroundOptions } = useEmptyStateBackgrounds();

  const [enableSubAgents, setEnableSubAgents] = useState(
    experiments?.enableSubAgents ?? false,
  );
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<
    OptimisticUserMessage[]
  >([]);
  const resolvedChatBackgroundUri = useMemo(() => {
    if (chatBackgroundUri) {
      return chatBackgroundUri;
    }

    if (!chatBackground) {
      return undefined;
    }

    return backgroundOptions.find((option) => option.file === chatBackground)
      ?.uri;
  }, [backgroundOptions, chatBackground, chatBackgroundUri]);

  useEffect(() => {
    if (experiments?.enableSubAgents !== undefined) {
      setEnableSubAgents(experiments.enableSubAgents);
    }
  }, [experiments?.enableSubAgents]);

  const visibleOptimisticUserMessages = useMemo(
    () =>
      filterResolvedOptimisticUserMessages(optimisticUserMessages, messages),
    [optimisticUserMessages, messages],
  );

  useEffect(() => {
    setOptimisticUserMessages((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      if (
        prev.length === visibleOptimisticUserMessages.length &&
        prev.every(
          (message, index) => message === visibleOptimisticUserMessages[index],
        )
      ) {
        return prev;
      }

      return visibleOptimisticUserMessages;
    });
  }, [visibleOptimisticUserMessages]);

  useEffect(() => {
    if (messages.length === 0) {
      setOptimisticUserMessages([]);
    }
  }, [messages.length]);

  const messagesRef = useRef(messages);
  const modifiedMessagesRef = useRef<ClineMessage[]>([]);
  const renderRowsRef = useRef<ChatRenderRow[]>([]);
  const stableRenderTsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    messagesRef.current = messages;
    // Update the module-level message store for ChatRow cross-message lookups
    // This doesn't trigger re-renders because ChatRow reads from the store directly
    setMessageStore(messages);
  }, [messages]);

  // Sync all extension state values to module-level store so ChatRow can read without useExtensionState
  // This is CRITICAL - without this, ChatRow would subscribe to context and re-render on ANY change
  useEffect(() => {
    setExtensionStateStore({
      showTaskTimeline: showTaskTimeline ?? false,
      mcpServers: mcpServers ?? [],
      alwaysAllowMcp: alwaysAllowMcp ?? false,
      currentCheckpoint: currentCheckpoint,
      mode: mode ?? "code",
      apiConfiguration: apiConfiguration ?? {},
      showTimestamps: showTimestamps ?? false,
      filePaths: filePaths ?? [],
      cwd: cwd ?? "",
      alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
      alwaysAllowWrite: alwaysAllowWrite ?? false,
      alwaysAllowExecute: alwaysAllowExecute ?? false,
      alwaysAllowBrowser: alwaysAllowBrowser ?? false,
      alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? false,
      alwaysAllowSubtasks: alwaysAllowSubtasks ?? false,
      autoApprovalEnabled: autoApprovalEnabled ?? false,
      hideCostBelowThreshold: hideCostBelowThreshold ?? 0,
    });
  }, [
    showTaskTimeline,
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
    hideCostBelowThreshold,
  ]);

  // Leaving this less safe version here since if the first message is not a
  // task, then the extension is in a bad state and needs to be debugged (see
  // Cline.abort).
  const task = useMemo(() => messages.at(0), [messages]);

  // kade_change start
  // Initialize expanded state based on the persisted setting (default to expanded if undefined)
  const [isExpanded, setIsExpanded] = useState(
    historyPreviewCollapsed === undefined ? true : !historyPreviewCollapsed,
  );

  // const toggleExpanded = useCallback(() => {
  // 	const newState = !isExpanded
  // 	setIsExpanded(newState)
  // 	// Send message to extension to persist the new collapsed state
  // 	vscode.postMessage({ type: "setHistoryPreviewCollapsed", bool: !newState })
  // }, [isExpanded])
  // kade_change end: unused

  const latestTodos = useMemo(() => {
    // First check if we have initial todos from the state (for new subtasks)
    if (currentTaskTodos && currentTaskTodos.length > 0) {
      // Check if there are any todo updates in messages
      const messageBasedTodos = getLatestTodo(messages);
      // If there are message-based todos, they take precedence (user has updated them)
      if (messageBasedTodos && messageBasedTodos.length > 0) {
        return messageBasedTodos;
      }
      // Otherwise use the initial todos from state
      return currentTaskTodos;
    }
    // Fall back to extracting from messages
    return getLatestTodo(messages);
  }, [messages, currentTaskTodos]);

  const modifiedMessages = useMemo(() => {
    // Skip expensive processing if messages array is empty
    if (messages.length === 0) return [];
    return combineApiRequests(combineCommandSequences(messages.slice(0)));
  }, [messages]);

  const isLastPartialReadTool = useMemo(() => {
    const lastMessage = modifiedMessages.at(-1);
    if (
      !lastMessage?.partial ||
      !lastMessage.text ||
      (lastMessage.ask !== "tool" && lastMessage.say !== "tool")
    ) {
      return false;
    }

    const tool = parseCachedTool(lastMessage.text);
    return normalizeToolActivityName(tool?.tool as string) === "readFile";
  }, [modifiedMessages]);

  // Keep ref in sync for itemContent callback to use without causing re-renders
  useEffect(() => {
    modifiedMessagesRef.current = modifiedMessages;
  }, [modifiedMessages]);

  // Has to be after api_req_finished are all reduced into api_req_started messages.
  const apiMetrics = useMemo(
    () => getApiMetrics(modifiedMessages),
    [modifiedMessages],
  );
  const hasCheckpointMessage = useMemo(
    () =>
      modifiedMessages.some((message) => message.say === "checkpoint_saved"),
    [modifiedMessages],
  );

  const [inputValue, setInputValue] = useState("");
  const inputValueRef = useRef(inputValue);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [sendingDisabled, setSendingDisabled] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [chatAreaHeight, setChatAreaHeight] = useState(0); // kade_change
  const chatAreaRef = useRef<HTMLDivElement>(null); // kade_change
  const chatShellStyle = useMemo(
    () =>
      ({
        "--chat-area-height": `${chatAreaHeight}px`,
        ...(resolvedChatBackgroundUri
          ? {
              backgroundImage: `url("${resolvedChatBackgroundUri}")`,
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "cover",
            }
          : {}),
      }) as any,
    [chatAreaHeight, resolvedChatBackgroundUri],
  );

  // kade_change start: Measure chat area height for glass layout
  useLayoutEffect(() => {
    if (!chatAreaRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Round the height to prevent sub-pixel jitter from triggering re-renders
        const newHeight = Math.round(entry.contentRect.height);
        setChatAreaHeight((prev) =>
          Math.abs(prev - newHeight) > 1 ? newHeight : prev,
        );
      }
    });
    observer.observe(chatAreaRef.current);
    return () => observer.disconnect();
  }, []);
  // kade_change end

  // We need to hold on to the ask because useEffect > lastMessage will always
  // let us know when an ask comes in and handle it, but by the time
  // handleMessage is called, the last message might not be the ask anymore
  // (it could be a say that followed).
  const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined);
  const [enableButtons, setEnableButtons] = useState<boolean>(false);
  const [primaryButtonText, setPrimaryButtonText] = useState<
    string | undefined
  >(undefined);
  const [secondaryButtonText, setSecondaryButtonText] = useState<
    string | undefined
  >(undefined);
  const [didClickCancel, setDidClickCancel] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const messageListRef =
    useRef<VirtuosoMessageListMethods<ChatRenderRow, unknown>>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const prevExpandedRowsRef = useRef<Record<number, boolean>>();
  const expandedRowsRef = useRef<Record<number, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickyFollowRef = useRef<boolean>(false);
  const smoothBottomAnchorUntilRef = useRef(0);
  const smoothBottomAnchorRafRef = useRef<number | null>(null);
  const userWheelReleaseUntilRef = useRef(0);
  const {
    scrollerRef: streamingScrollerRef,
    scrollerElRef: streamingScrollerElRef,
    pinnedRef: streamingPinnedRef,
    setPinned: setStreamingPinned,
    forcePin: forcePinToBottom,
    syncPinnedFromScroll: syncStreamingPinnedFromScroll,
  } = useStreamingScrollPin({
    pinSuppressedUntilRef: smoothBottomAnchorUntilRef,
    shouldReleasePinFromScroll: () =>
      !isStreaming || performance.now() < userWheelReleaseUntilRef.current,
  });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const showScrollToBottomRef = useRef(showScrollToBottom);
  const isAtBottomRef = useRef(isAtBottom);
  const lastTtsRef = useRef<string>("");
  const [wasStreaming, setWasStreaming] = useState<boolean>(false);
  const [checkpointWarning, setCheckpointWarning] = useState<
    { type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number } | undefined
  >(undefined);
  const [isCondensing, setIsCondensing] = useState<boolean>(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [zeroSizedRowTs, setZeroSizedRowTs] = useState<Set<number>>(new Set());
  const [isTaskSwitching, setIsTaskSwitching] = useState(false);
  const taskSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [pendingSwitchTaskId, setPendingSwitchTaskId] = useState<string | null>(
    null,
  );
  const prevMessageListRowsRef = useRef<ChatRenderRow[]>([]);
  const prevMessageListTaskTsRef = useRef<number | undefined>(undefined);
  const messageListLicenseKey =
    ((import.meta as any).env?.VITE_VIRTUOSO_MESSAGE_LIST_LICENSE_KEY as
      | string
      | undefined) ?? "";
  const shouldUseMessageList = false;
  const everVisibleMessagesTsRef = useRef<LRUCache<number, boolean>>(
    new LRUCache({
      max: 100,
      ttl: 1000 * 60 * 5,
    }),
  );
  const autoApproveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userRespondedRef = useRef<boolean>(false);
  const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(
    null,
  );

  const clineAskRef = useRef(clineAsk);
  useEffect(() => {
    clineAskRef.current = clineAsk;
  }, [clineAsk]);

  useEffect(() => {
    clineAskRef.current = clineAsk;
  }, [clineAsk]);

  // kade_change: Auto-approve delay handling
  const toolAutoApproveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (toolAutoApproveTimerRef.current) {
        clearTimeout(toolAutoApproveTimerRef.current);
        toolAutoApproveTimerRef.current = null;
      }
    };
  }, []);

  // Clear timer when clineAsk changes (new ask arrived)
  useEffect(() => {
    // Clear any pending timer when a new ask arrives
    if (toolAutoApproveTimerRef.current) {
      clearTimeout(toolAutoApproveTimerRef.current);
      toolAutoApproveTimerRef.current = null;
    }
  }, [clineAsk]);

  const shouldAutoApproveTool = useCallback(
    (tool: ClineSayTool): boolean => {
      if (!autoApprovalEnabled) return false;

      // kade_change: Mirror backend checkAutoApproval logic so the
      // approve button never flashes for tools that will be auto-approved.
      const name = tool.tool as string;

      // Read-only tools (matches isReadOnlyToolAction in backend)
      if (
        [
          "readFile",
          "listFiles",
          "listFilesTopLevel",
          "listFilesRecursive",
          "searchFiles",
          "grep",
          "glob",
          "listDirTopLevel",
          "listDirRecursive",
          "codebaseSearch",
          "fastContext",
          "runSlashCommand",
        ].includes(name)
      ) {
        return !!alwaysAllowReadOnly;
      }

      // Write tools (matches isWriteToolAction in backend)
      if (
        [
          "editedExistingFile",
          "appliedDiff",
          "newFileCreated",
          "generateImage",
        ].includes(name)
      ) {
        return !!alwaysAllowWrite;
      }

      // Delete tool
      if (name === "deleteFile") {
        return !!alwaysAllowDelete;
      }

      // Web tools (backend maps these to alwaysAllowBrowser)
      if (["web", "fetch", "research_web"].includes(name)) {
        return !!alwaysAllowBrowser;
      }

      // Mode switch
      if (name === "switchMode") {
        return !!alwaysAllowModeSwitch;
      }

      // Subtask tools
      if (["newTask", "finishTask", "agent"].includes(name)) {
        return !!alwaysAllowSubtasks;
      }

      // Todo list
      if (name === "updateTodoList") {
        return !!alwaysAllowUpdateTodoList;
      }

      // fetchInstructions (backend checks content for create_mode / create_mcp_server)
      if (name === "fetchInstructions") {
        if (tool.content === "create_mode") return !!alwaysAllowModeSwitch;
        if (tool.content === "create_mcp_server") return !!alwaysAllowMcp;
      }

      return false;
    },
    [
      autoApprovalEnabled,
      alwaysAllowReadOnly,
      alwaysAllowWrite,
      alwaysAllowDelete,
      alwaysAllowBrowser,
      alwaysAllowModeSwitch,
      alwaysAllowSubtasks,
      alwaysAllowMcp,
      alwaysAllowUpdateTodoList,
    ],
  );

  // kade_change start: unused
  // const {
  // 	isOpen: isUpsellOpen,
  // 	openUpsell,
  // 	closeUpsell,
  // 	handleConnect,
  // } = useCloudUpsell({
  // 	autoOpenOnAuth: false,
  // })
  // kade_change end

  // Keep inputValueRef in sync with inputValue state
  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  // Compute whether auto-approval is paused (user is typing in a followup)
  const isFollowUpAutoApprovalPaused = useMemo(() => {
    return !!(
      inputValue &&
      inputValue.trim().length > 0 &&
      clineAsk === "followup"
    );
  }, [inputValue, clineAsk]);

  // Cancel auto-approval timeout when user starts typing
  useEffect(() => {
    // Only send cancel if there's actual input (user is typing)
    // and we have a pending follow-up question
    if (isFollowUpAutoApprovalPaused) {
      vscode.postMessage({ type: "cancelAutoApproval" });
    }
  }, [isFollowUpAutoApprovalPaused]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isProfileDisabled = useMemo(
    () =>
      !!apiConfiguration &&
      !ProfileValidator.isProfileAllowed(
        apiConfiguration,
        organizationAllowList,
      ),
    [apiConfiguration, organizationAllowList],
  );

  // UI layout depends on the last 2 messages (since it relies on the content
  // of these messages, we are deep comparing) i.e. the button state after
  // hitting button sets enableButtons to false,  and this effect otherwise
  // would have to true again even if messages didn't change.
  const lastMessage = useMemo(() => messages.at(-1), [messages]);
  const secondLastMessage = useMemo(() => messages.at(-2), [messages]);

  const volume = typeof soundVolume === "number" ? soundVolume : 0.5;
  const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, {
    volume,
    soundEnabled,
  });
  const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, {
    volume,
    soundEnabled,
  });
  const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, {
    volume,
    soundEnabled,
  });

  const playSound = useCallback(
    (audioType: AudioType) => {
      if (!soundEnabled) {
        return;
      }

      switch (audioType) {
        case "notification":
          playNotification();
          break;
        case "celebration":
          playCelebration();
          break;
        case "progress_loop":
          playProgressLoop();
          break;
        default:
          console.warn(`Unknown audio type: ${audioType}`);
      }
    },
    [soundEnabled, playNotification, playCelebration, playProgressLoop],
  );

  function playTts(text: string) {
    vscode.postMessage({ type: "playTts", text });
  }

  useEffect(() => {
    // if last message is an ask, show user ask UI
    // if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
    // basically as long as a task is active, the conversation history will be persisted
    if (lastMessage) {
      switch (lastMessage.type) {
        case "ask":
          // Reset user response flag when a new ask arrives to allow auto-approval
          userRespondedRef.current = false;
          const isPartial = lastMessage.partial === true;
          switch (lastMessage.ask) {
            case "api_req_failed":
              playSound("progress_loop");
              setSendingDisabled(true);
              setClineAsk("api_req_failed");
              setEnableButtons(true);
              setPrimaryButtonText(t("chat:retry.title"));
              setSecondaryButtonText(t("chat:startNewTask.title"));
              break;
            case "mistake_limit_reached":
              playSound("progress_loop");
              setSendingDisabled(false);
              setClineAsk("mistake_limit_reached");
              setEnableButtons(true);
              setPrimaryButtonText(t("chat:proceedAnyways.title"));
              setSecondaryButtonText(t("chat:startNewTask.title"));
              break;
            case "followup":
              setSendingDisabled(isPartial);
              setClineAsk("followup");
              // setting enable buttons to `false` would trigger a focus grab when
              // the text area is enabled which is undesirable.
              // We have no buttons for this tool, so no problem having them "enabled"
              // to workaround this issue.  See #1358.
              setEnableButtons(true);
              setPrimaryButtonText(undefined);
              setSecondaryButtonText(undefined);
              break;
            case "tool":
              const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool;
              // kade_change: Auto-save generated images
              if (tool.tool === "generateImage") {
                setSendingDisabled(isPartial);
                if (!isPartial) {
                  vscode.postMessage({
                    type: "askResponse",
                    askResponse: "yesButtonClicked",
                  });
                }
                break;
              }

              setSendingDisabled(isPartial);
              setClineAsk("tool");

              // Only show buttons if NOT auto-approving and NOT partial
              if (!isPartial && !shouldAutoApproveTool(tool)) {
                if (userRespondedRef.current) {
                  break;
                }

                setEnableButtons(true);
                switch (tool.tool as string) {
                  case "editedExistingFile":
                  case "appliedDiff":
                  case "newFileCreated":
                  case "generateImage":
                    // kade_change: Don't show Save button in chat input
                    break;
                  case "finishTask":
                    setPrimaryButtonText(t("chat:completeSubtaskAndReturn"));
                    setSecondaryButtonText(undefined);
                    break;
                  case "readFile":
                    if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
                      setPrimaryButtonText(t("chat:read-batch.approve.title"));
                      setSecondaryButtonText(t("chat:read-batch.deny.title"));
                    } else {
                      setPrimaryButtonText(t("chat:approve.title"));
                      setSecondaryButtonText(undefined); // kade_change: remove reject button
                    }
                    break;
                  default:
                    setPrimaryButtonText(t("chat:approve.title"));
                    setSecondaryButtonText(undefined); // kade_change: remove reject button
                    break;
                }
              }
              break;
            case "browser_action_launch":
              // kade_change: Auto-approve browser actions
              if (!isPartial) {
                vscode.postMessage({
                  type: "askResponse",
                  askResponse: "yesButtonClicked",
                });
              } else {
                setSendingDisabled(isPartial);
                setClineAsk("browser_action_launch");

                const showBrowserButtons = () => {
                  // Check if user has already responded before showing buttons
                  if (userRespondedRef.current) {
                    return;
                  }
                  setEnableButtons(!isPartial);
                  setPrimaryButtonText(t("chat:approve.title"));
                  setSecondaryButtonText(undefined); // kade_change: remove reject button
                };

                // kade_change: When auto-approve is enabled, don't show buttons at all.
                if (!(autoApprovalEnabled && alwaysAllowBrowser)) {
                  showBrowserButtons();
                }
              }
              break;
            case "command":
              setSendingDisabled(isPartial);
              setClineAsk("command");

              const showCommandButtons = () => {
                // Check if user has already responded before showing buttons
                if (userRespondedRef.current) {
                  return;
                }
                setEnableButtons(!isPartial);
                setPrimaryButtonText(t("chat:runCommand.title"));
                setSecondaryButtonText(undefined); // kade_change: remove reject button
              };

              // kade_change: When auto-approve is enabled, don't show buttons at all.
              // The backend will auto-approve. If it rejects (denied command), a new ask arrives.
              if (!(autoApprovalEnabled && alwaysAllowExecute)) {
                showCommandButtons();
              }
              break;
            case "command_output":
              setSendingDisabled(false);
              setClineAsk("command_output");
              setEnableButtons(true);
              // setEnableButtons(true) // Duplicate removed
              setPrimaryButtonText(undefined);
              setSecondaryButtonText(undefined);
              break;
            case "use_mcp_server":
              setSendingDisabled(isPartial);
              setClineAsk("use_mcp_server");

              const showMcpButtons = () => {
                // Check if user has already responded before showing buttons
                if (userRespondedRef.current) {
                  return;
                }
                setEnableButtons(!isPartial);
                setPrimaryButtonText(t("chat:approve.title"));
                setSecondaryButtonText(undefined); // kade_change: remove reject button
              };

              // kade_change: When auto-approve is enabled, don't show buttons at all.
              if (!(autoApprovalEnabled && alwaysAllowMcp)) {
                showMcpButtons();
              }
              break;
            case "completion_result":
              // Extension waiting for feedback, but we can just present a new task button.
              // Only play celebration sound if there are no queued messages.
              if (!isPartial && messageQueue.length === 0) {
                playSound("celebration");
              }
              setSendingDisabled(isPartial);
              setClineAsk("completion_result");
              setEnableButtons(false); // kade_change: remove start new task button
              setPrimaryButtonText(undefined); // kade_change: remove start new task button
              setSecondaryButtonText(undefined);
              break;
            case "resume_task":
              setSendingDisabled(false);
              setClineAsk("resume_task");
              setEnableButtons(true);
              // For completed subtasks, show "Start New Task" instead of "Resume"
              // A subtask is considered completed if:
              // - It has a parentTaskId AND
              // - Its messages contain a completion_result (either ask or say)
              const isCompletedSubtask =
                currentTaskItem?.parentTaskId &&
                messages.some(
                  (msg) =>
                    msg.ask === "completion_result" ||
                    msg.say === "completion_result",
                );
              if (isCompletedSubtask) {
                setPrimaryButtonText(undefined); // kade_change: remove start new task button
                setSecondaryButtonText(undefined);
              } else {
                // kade_change: remove continue button - too annoying
                setPrimaryButtonText(undefined);
                setSecondaryButtonText(undefined);
              }
              setDidClickCancel(false); // special case where we reset the cancel button state
              break;
            case "resume_completed_task":
              setSendingDisabled(false);
              setClineAsk("resume_completed_task");
              setEnableButtons(false); // kade_change: remove start new task button
              setPrimaryButtonText(undefined); // kade_change: remove start new task button
              setSecondaryButtonText(undefined);
              setDidClickCancel(false);
              break;
            // kade_change begin
            case "report_bug":
              if (!isPartial) {
                playSound("notification");
              }
              setSendingDisabled(isPartial);
              setClineAsk("report_bug");
              setEnableButtons(!isPartial);
              setPrimaryButtonText(t("chat:reportBug.title"));
              break;
            case "condense":
              setSendingDisabled(isPartial);
              setClineAsk("condense");
              setEnableButtons(!isPartial);
              setPrimaryButtonText(
                t("kilocode:chat.condense.condenseConversation"),
              );
              setSecondaryButtonText(undefined);
              break;
            // kade_change end
          }
          break;
        case "say":
          // Don't want to reset since there could be a "say" after
          // an "ask" while ask is waiting for response.
          switch (lastMessage.say) {
            case "api_req_retry_delayed":
              setSendingDisabled(true);
              break;
            case "api_req_started":
              // If a new API request is starting, the previous ask was handled
              // (either by user action or auto-approval) - clear button state
              setClineAsk(undefined);
              setEnableButtons(false);
              setPrimaryButtonText(undefined);
              setSecondaryButtonText(undefined);
              if (secondLastMessage?.ask === "command_output") {
                setSendingDisabled(true);
                setSelectedImages([]);
              }
              break;
            case "api_req_finished":
              setSendingDisabled(false);
              break;
            case "error":
            case "text":
            case "browser_action":
            case "browser_action_result":
            case "command_output":
            case "mcp_server_request_started":
            case "mcp_server_response":
            case "completion_result":
              break;
          }
          break;
      }
    }
  }, [lastMessage, secondLastMessage]);

  useEffect(() => {
    if (
      currentTaskIsStreaming === false &&
      lastMessage?.say !== "command_output"
    ) {
      setSendingDisabled(false);
    }
  }, [currentTaskIsStreaming, lastMessage]);

  const isStreaming = useMemo(() => {
    if (currentTaskIsStreaming === false) {
      const lastMsg = modifiedMessages.at(-1);
      if (lastMsg?.say !== "command_output" && lastMsg?.partial !== true) {
        return false;
      }
    }

    // Checking clineAsk isn't enough since messages effect may be called
    // again for a tool for example, set clineAsk to its value, and if the
    // next message is not an ask then it doesn't reset. This is likely due
    // to how much more often we're updating messages as compared to before,
    // and should be resolved with optimizations as it's likely a rendering
    // bug. But as a final guard for now, the cancel button will show if the
    // last message is not an ask.
    const lastMsg = modifiedMessages.at(-1);
    if (lastMsg?.say === "command_output") {
      return true;
    }

    const isLastAsk = !!lastMsg?.ask;

    const isToolCurrentlyAsking =
      isLastAsk &&
      clineAsk !== undefined &&
      enableButtons &&
      primaryButtonText !== undefined;

    if (isToolCurrentlyAsking) {
      return false;
    }

    // kade_change: Check raw messages for explicit finish signal
    // regardless of whether combineApiRequests has merged cost yet.
    // We use findLastIndex to find the absolute last relevant signal.
    // If the last 'api_req_finished' is after the last 'api_req_started', we are done.
    {
      const lastStartedIndex = findLastIndex(
        messages,
        (m: ClineMessage) => m.say === "api_req_started",
      );
      const lastFinishedIndex = findLastIndex(
        messages,
        (m: ClineMessage) => m.say === "api_req_finished",
      );

      if (lastStartedIndex !== -1 && lastFinishedIndex > lastStartedIndex) {
        return false;
      }
    }

    const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true;

    if (isLastMessagePartial) {
      return true;
    } else {
      const lastApiReqStarted = findLast(
        modifiedMessages,
        (message: ClineMessage) => message.say === "api_req_started",
      );

      if (
        lastApiReqStarted &&
        lastApiReqStarted.text !== null &&
        lastApiReqStarted.text !== undefined &&
        lastApiReqStarted.say === "api_req_started"
      ) {
        const cost = JSON.parse(lastApiReqStarted.text).cost;

        if (cost === undefined) {
          return true; // API request has not finished yet.
        }
      }
    }

    return false;
  }, [
    currentTaskIsStreaming,
    modifiedMessages,
    clineAsk,
    enableButtons,
    primaryButtonText,
    messages,
  ]);

  useEffect(() => {
    if (currentTaskIsStreaming === false && lastMessage?.partial === true) {
      reportWebviewDebugEvent({
        source: "ChatView",
        event: "stream_ended_with_partial_message",
        level: "warn",
        data: {
          taskId: currentTaskItem?.id,
          ts: lastMessage.ts,
          type: lastMessage.type,
          ask: lastMessage.ask,
          say: lastMessage.say,
          textPreview:
            typeof lastMessage.text === "string"
              ? lastMessage.text.slice(0, 240)
              : undefined,
          metadata: lastMessage.metadata,
          messageCount: messages.length,
          modifiedMessageCount: modifiedMessages.length,
          queueLength: messageQueue.length,
        },
      });
    }
  }, [
    currentTaskIsStreaming,
    currentTaskItem?.id,
    lastMessage,
    messageQueue.length,
    messages.length,
    modifiedMessages.length,
  ]);

  useEffect(() => {
    const lastPartialMessage = modifiedMessages.at(-1);
    const isDebugStreaming =
      currentTaskIsStreaming !== false ||
      lastPartialMessage?.say === "command_output" ||
      lastPartialMessage?.partial === true;

    if (!isDebugStreaming || lastPartialMessage?.partial !== true) {
      stuckPartialDebugKeyRef.current = null;
      return;
    }

    const debugKey = `${currentTaskItem?.id || "no-task"}:${lastPartialMessage.ts}:${lastPartialMessage.ask || lastPartialMessage.say || lastPartialMessage.type}`;

    if (stuckPartialDebugKeyRef.current === debugKey) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const latestMessage = modifiedMessages.at(-1);
      if (
        latestMessage?.partial === true &&
        latestMessage.ts === lastPartialMessage.ts &&
        currentTaskIsStreaming !== false
      ) {
        stuckPartialDebugKeyRef.current = debugKey;
        reportWebviewDebugEvent({
          source: "ChatView",
          event: "partial_message_stuck_while_streaming",
          level: "warn",
          data: {
            taskId: currentTaskItem?.id,
            currentTaskIsStreaming,
            isStreaming: isDebugStreaming,
            ts: latestMessage.ts,
            type: latestMessage.type,
            ask: latestMessage.ask,
            say: latestMessage.say,
            textPreview:
              typeof latestMessage.text === "string"
                ? latestMessage.text.slice(0, 240)
                : undefined,
            metadata: latestMessage.metadata,
            messageCount: messages.length,
            modifiedMessageCount: modifiedMessages.length,
            queueLength: messageQueue.length,
          },
        });
      }
    }, 15000);

    return () => window.clearTimeout(timeout);
  }, [
    currentTaskIsStreaming,
    currentTaskItem?.id,
    messageQueue.length,
    messages.length,
    modifiedMessages,
  ]);

  // Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
  useEffect(() => {
    if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
      const hasCompletionResult = messages.some(
        (msg) =>
          msg.ask === "completion_result" || msg.say === "completion_result",
      );
      if (hasCompletionResult) {
        setPrimaryButtonText(undefined); // kade_change: remove start new task button
        setSecondaryButtonText(undefined);
      }
    }
  }, [
    clineAsk,
    currentTaskItem?.parentTaskId,
    messages,
    t,
    alwaysAllowBrowser,
    alwaysAllowExecute,
    alwaysAllowMcp,
    autoApprovalEnabled,
    messageQueue.length,
    playSound,
    shouldAutoApproveTool,
  ]);

  useEffect(() => {
    if (messages.length === 0) {
      setSendingDisabled(false);
      setClineAsk(undefined);
      setEnableButtons(false);
      setPrimaryButtonText(undefined);
      setSecondaryButtonText(undefined);
    }
  }, [messages.length]);

  useEffect(() => {
    // Reset UI states only when task changes
    setExpandedRows({});
    everVisibleMessagesTsRef.current.clear(); // Clear for new task
    clearToolResultCache(); // Clear tool result cache to prevent stale results
    clearChatToolParseCache();
    clearVirtualHeightCache(); // Clear virtual row height cache for new task
    stableRenderTsRef.current.clear();
    setCurrentFollowUpTs(null); // Clear follow-up answered state for new task
    setIsCondensing(false); // Reset condensing state when switching tasks
    // Note: sendingDisabled is not reset here as it's managed by message effects

    // Clear any pending auto-approval timeout from previous task
    if (autoApproveTimeoutRef.current) {
      clearTimeout(autoApproveTimeoutRef.current);
      autoApproveTimeoutRef.current = null;
    }
    // Reset user response flag for new task
    userRespondedRef.current = false;
  }, [task?.ts]);

  // kade_change: Initial scroll to bottom when entering a chat
  useEffect(() => {
    if (!task?.ts) return;

    // Wait for the DOM to render messages, then scroll to bottom.
    // We scroll to a large sentinel value instead of el.scrollHeight so the
    // browser always clamps to the true bottom even if content (e.g. footer
    // spacer, lazy images) finishes laying out after our scroll call fires.
    let raf1: number;
    let raf2: number;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const el = streamingScrollerElRef.current as HTMLElement | null;
        if (!el) return;
        // Instantly jump to the bottom without the jarring smooth scroll bounce
        if (typeof el.scrollTo === "function") {
          el.scrollTo({ top: 999999999, behavior: "auto" });
        } else {
          el.scrollTop = 999999999;
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.ts]);

  useEffect(() => {
    if (isHidden) {
      everVisibleMessagesTsRef.current.clear();
    }
  }, [isHidden]);

  useEffect(() => {
    const cache = everVisibleMessagesTsRef.current;
    return () => {
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const handleTaskSwitchStart = (event: Event) => {
      const customEvent = event as CustomEvent<{ taskId?: string }>;
      const targetTaskId = customEvent.detail?.taskId ?? null;
      setIsTaskSwitching(true);
      setPendingSwitchTaskId(targetTaskId);
      if (taskSwitchTimeoutRef.current) {
        clearTimeout(taskSwitchTimeoutRef.current);
      }
      taskSwitchTimeoutRef.current = setTimeout(() => {
        setIsTaskSwitching(false);
        setPendingSwitchTaskId(null);
        taskSwitchTimeoutRef.current = null;
      }, 2500);
    };

    window.addEventListener("chat-task-switch-start", handleTaskSwitchStart);
    return () => {
      window.removeEventListener(
        "chat-task-switch-start",
        handleTaskSwitchStart,
      );
      if (taskSwitchTimeoutRef.current) {
        clearTimeout(taskSwitchTimeoutRef.current);
        taskSwitchTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingSwitchTaskId) {
      return;
    }
    if (currentTaskItem?.id === pendingSwitchTaskId) {
      // Destination metadata observed; keep switching active until task mount effect completes.
      setIsTaskSwitching(true);
    }
  }, [currentTaskItem?.id, pendingSwitchTaskId]);

  useEffect(() => {
    if (
      !task ||
      !pendingSwitchTaskId ||
      currentTaskItem?.id !== pendingSwitchTaskId
    ) {
      return;
    }
    // Destination task is mounted; clear switching on next frame to avoid a flash frame.
    const raf = window.requestAnimationFrame(() => {
      setIsTaskSwitching(false);
      setPendingSwitchTaskId(null);
      if (taskSwitchTimeoutRef.current) {
        clearTimeout(taskSwitchTimeoutRef.current);
        taskSwitchTimeoutRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [task, currentTaskItem?.id, pendingSwitchTaskId]);

  useEffect(() => {
    // Guard against any stale switching state leaking into normal homepage transitions.
    if (!pendingSwitchTaskId && !task && isTaskSwitching) {
      setIsTaskSwitching(false);
    }
  }, [pendingSwitchTaskId, task, isTaskSwitching]);

  useEffect(() => {
    expandedRowsRef.current = expandedRows;
  }, [expandedRows]);

  useEffect(() => {
    const prev = prevExpandedRowsRef.current;
    let wasAnyRowExpandedByUser = false;
    if (prev) {
      // Check if any row transitioned from false/undefined to true
      for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
        const ts = Number(tsKey);
        if (isExpanded && !(prev[ts] ?? false)) {
          wasAnyRowExpandedByUser = true;
          break;
        }
      }
    }

    // Expanding a row indicates the user is browsing; disable sticky follow
    if (wasAnyRowExpandedByUser) {
      stickyFollowRef.current = false;
    }

    prevExpandedRowsRef.current = expandedRows; // Store current state for next comparison
  }, [expandedRows]);

  // Scrollbar visibility logic
  const [isScrollbarActive, setIsScrollbarActive] = useState(false);
  const isScrollbarActiveRef = useRef(false);
  const scrollbarTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollbarResetRef = useRef<number>(0);

  const showScrollbar = useCallback(() => {
    const now = Date.now();

    // Only trigger a re-render if the scrollbar isn't already visible
    if (!isScrollbarActiveRef.current) {
      setIsScrollbarActive(true);
      isScrollbarActiveRef.current = true;
    }

    // Throttle the timeout reset to once every 100ms to keep scrolling buttery smooth
    if (now - lastScrollbarResetRef.current > 100) {
      if (scrollbarTimeoutRef.current) {
        clearTimeout(scrollbarTimeoutRef.current);
      }

      scrollbarTimeoutRef.current = setTimeout(() => {
        setIsScrollbarActive(false);
        isScrollbarActiveRef.current = false;
        scrollbarTimeoutRef.current = null;
      }, 2000);

      lastScrollbarResetRef.current = now;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scrollbarTimeoutRef.current) {
        clearTimeout(scrollbarTimeoutRef.current);
      }
    };
  }, []);

  const handleScrollAreaInteraction = useCallback(() => {
    showScrollbar();
  }, [showScrollbar]);

  const updateBottomState = useCallback((atBottom: boolean) => {
    const shouldTreatAsPinned =
      !atBottom && (stickyFollowRef.current || streamingPinnedRef.current);
    const resolvedAtBottom = atBottom || shouldTreatAsPinned;

    if (isAtBottomRef.current !== resolvedAtBottom) {
      isAtBottomRef.current = resolvedAtBottom;
      setIsAtBottom(resolvedAtBottom);
    }

    const shouldShowScrollToBottom = !resolvedAtBottom;
    if (showScrollToBottomRef.current !== shouldShowScrollToBottom) {
      showScrollToBottomRef.current = shouldShowScrollToBottom;
      setShowScrollToBottom(shouldShowScrollToBottom);
    }
  }, []);

  const shouldAllowStreamingRelease = useCallback(
    () => !isStreaming || performance.now() < userWheelReleaseUntilRef.current,
    [isStreaming],
  );

  const markFollowUpAsAnswered = useCallback(() => {
    const lastFollowUpMessage = messagesRef.current.findLast(
      (msg: ClineMessage) => msg.ask === "followup",
    );
    if (lastFollowUpMessage) {
      setCurrentFollowUpTs(lastFollowUpMessage.ts);
    }
  }, []);

  const handleChatReset = useCallback(() => {
    // Clear any pending auto-approval timeout
    if (autoApproveTimeoutRef.current) {
      clearTimeout(autoApproveTimeoutRef.current);
      autoApproveTimeoutRef.current = null;
    }
    // Reset user response flag for new message
    userRespondedRef.current = false;

    // Only reset message-specific state, preserving mode.
    setInputValue("");
    setSendingDisabled(true);
    setSelectedImages([]);
    setClineAsk(undefined);
    setEnableButtons(false);
    // Do not reset mode here as it should persist.
    // setPrimaryButtonText(undefined)
    // setSecondaryButtonText(undefined)
  }, []);

  /**
   * Handles sending messages to the extension
   * @param text - The message text to send
   * @param images - Array of image data URLs to send with the message
   */
  const scrollToRenderRowIndex = useCallback(
    (
      index: number | "LAST",
      align: "start" | "center" | "end" | "start-no-overflow" = "end",
      behavior: "auto" | "smooth" | "instant" = "auto",
    ) => {
      if (shouldUseMessageList) {
        messageListRef.current?.scrollToItem({
          index,
          align,
          behavior,
        });
        return;
      }

      virtuosoRef.current?.scrollToIndex({
        index,
        align: align === "start-no-overflow" ? "start" : align,
        behavior: behavior === "instant" ? "auto" : behavior,
      });
    },
    [shouldUseMessageList],
  );

  // kade_change: Manual scroll helpers
  const manualScrollToBottom = useCallback(
    (behavior: "auto" | "smooth" | "instant" = "auto") => {
      scrollToRenderRowIndex("LAST", "end", behavior);
    },
    [scrollToRenderRowIndex],
  );

  const animateBottomAnchorToBottom = useCallback(
    (durationMs = SMOOTH_BOTTOM_ANCHOR_DURATION_MS) => {
      const scroller =
        streamingScrollerElRef.current ??
        stableListRef.current ??
        scrollRootRef.current;
      if (!scroller) {
        return false;
      }

      const startScrollTop = scroller.scrollTop;
      const startMaxScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );
      const initialDistance = startMaxScrollTop - startScrollTop;
      if (initialDistance <= 1) {
        return false;
      }

      if (smoothBottomAnchorRafRef.current !== null) {
        cancelAnimationFrame(smoothBottomAnchorRafRef.current);
        smoothBottomAnchorRafRef.current = null;
      }

      const startTime = performance.now();
      smoothBottomAnchorUntilRef.current = startTime + durationMs;
      updateBottomState(true);

      const tick = (now: number) => {
        const liveScroller =
          streamingScrollerElRef.current ??
          stableListRef.current ??
          scrollRootRef.current;
        if (!liveScroller) {
          smoothBottomAnchorUntilRef.current = 0;
          smoothBottomAnchorRafRef.current = null;
          return;
        }

        const liveMaxScrollTop = Math.max(
          0,
          liveScroller.scrollHeight - liveScroller.clientHeight,
        );
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        liveScroller.scrollTop =
          startScrollTop + (liveMaxScrollTop - startScrollTop) * eased;

        if (progress < 1) {
          smoothBottomAnchorRafRef.current = requestAnimationFrame(tick);
          return;
        }

        liveScroller.scrollTop = liveMaxScrollTop;
        smoothBottomAnchorUntilRef.current = 0;
        smoothBottomAnchorRafRef.current = null;
        stablePrevScrollHeightRef.current = liveScroller.scrollHeight;
        stableWasAtBottomRef.current = true;
      };

      smoothBottomAnchorRafRef.current = requestAnimationFrame(tick);
      return true;
    },
    [streamingScrollerElRef, updateBottomState],
  );

  // const smoothScrollToBottom = useCallback(() => {
  // 	if (virtuosoRef.current) {
  // 		virtuosoRef.current.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" })
  // 	}
  // }, [])
  // kade_change: unused

  // const scrollToMessageTop = useCallback((index: number) => {
  // 	if (virtuosoRef.current) {
  // 		virtuosoRef.current.scrollToIndex({ index, align: "start", behavior: "smooth" })
  // 	}
  // }, [])
  // kade_change: unused

  // handleScroll is handled by Virtuoso's atBottomStateChange

  useLayoutEffect(() => {
    if (!isStreaming || wasStreaming || showScrollToBottomRef.current) {
      return;
    }

    const scroller =
      streamingScrollerElRef.current ??
      stableListRef.current ??
      scrollRootRef.current;
    if (!scroller) {
      return;
    }

    const hadBottomOwnership =
      stickyFollowRef.current ||
      streamingPinnedRef.current ||
      isAtBottomRef.current ||
      stableWasAtBottomRef.current;
    if (!hadBottomOwnership) {
      return;
    }

    animateBottomAnchorToBottom();
  }, [
    animateBottomAnchorToBottom,
    isStreaming,
    streamingPinnedRef,
    streamingScrollerElRef,
    wasStreaming,
  ]);

  /**
   * Handles sending messages to the extension
   * @param text - The message text to send
   * @param images - Array of image data URLs to send with the message
   */
  const handleSendMessage = useCallback(
    (text: string, images: string[]) => {
      text = text.trim();
      setDidClickCancel(false);

      if (text || images.length > 0) {
        const hasPendingAsk =
          clineAskRef.current !== undefined && clineAskRef.current !== null;

        // Queue message if:
        // - Task is busy (sendingDisabled)
        // - API request in progress (isStreaming)
        // - Queue has items (preserve message order during drain)
        // But if the backend is actively waiting for an ask response, send it
        // immediately instead of parking it in the queue.
        if (
          !hasPendingAsk &&
          (sendingDisabled || isStreaming || messageQueue.length > 0)
        ) {
          try {
            console.log("queueMessage", text, images);
            vscode.postMessage({ type: "queueMessage", text, images });
            setInputValue("");
            setSelectedImages([]);
          } catch (error) {
            console.error(
              `Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          return;
        }

        // Mark that user has responded - this prevents any pending auto-approvals.
        userRespondedRef.current = true;

        // New user turns should establish their own viewport position.
        // Pre-pinning to bottom here creates the visible "spawn low, then move"
        // flash against the composer spacer and can suppress the entry animation.
        stickyFollowRef.current = false;
        setStreamingPinned(false);

        setOptimisticUserMessages((prev) => [
          ...prev,
          {
            ts: Date.now() + prev.length,
            type: "say",
            say: messagesRef.current.length === 0 ? "task" : "user_feedback",
            text,
            images,
            __optimistic: true,
          },
        ]);

        if (messagesRef.current.length === 0) {
          vscode.postMessage({
            type: "newTask",
            text,
            images,
            enableSubAgents,
          });
        } else if (clineAskRef.current) {
          if (clineAskRef.current === "followup") {
            markFollowUpAsAnswered();
          }

          // Use clineAskRef.current
          switch (
            clineAskRef.current // Use clineAskRef.current
          ) {
            case "followup":
            case "tool":
            case "browser_action_launch":
            case "command": // User can provide feedback to a tool or command use.
            case "command_output": // User can send input to command stdin.
            case "use_mcp_server":
            case "completion_result": // If this happens then the user has feedback for the completion result.
            case "resume_task":
            case "resume_completed_task":
            case "mistake_limit_reached":
              vscode.postMessage({
                type: "askResponse",
                askResponse: "messageResponse",
                text,
                images,
                enableSubAgents,
              });
              break;
            // There is no other case that a textfield should be enabled.
          }
        } else {
          // This is a new message in an ongoing task.
          vscode.postMessage({
            type: "askResponse",
            askResponse: "messageResponse",
            text,
            images,
            enableSubAgents,
          });
        }

        handleChatReset();
      }
    },
    [
      handleChatReset,
      markFollowUpAsAnswered,
      sendingDisabled,
      isStreaming,
      messageQueue.length,
      enableSubAgents,
      streamingPinnedRef,
    ], // messagesRef and clineAskRef are stable
  );

  const handleSetChatBoxMessage = useCallback(
    (text: string, images: string[]) => {
      // Avoid nested template literals by breaking down the logic
      let newValue = text;

      if (inputValue !== "") {
        newValue = inputValue + " " + text;
      }

      setInputValue(newValue);
      setSelectedImages([...selectedImages, ...images]);
    },
    [inputValue, selectedImages],
  );

  const startNewTask = useCallback(
    () => vscode.postMessage({ type: "clearTask" }),
    [],
  );

  // This logic depends on the useEffect[messages] above to set clineAsk,
  // after which buttons are shown and we then send an askResponse to the
  // extension.
  const handlePrimaryButtonClick = useCallback(
    (text?: string, images?: string[]) => {
      // Mark that user has responded
      userRespondedRef.current = true;

      const trimmedInput = text?.trim();

      switch (clineAsk) {
        case "api_req_failed":
        case "command":
        case "tool":
        case "browser_action_launch":
        case "use_mcp_server":
        case "mistake_limit_reached":
        case "report_bug":
          // Only send text/images if they exist
          if (trimmedInput || (images && images.length > 0)) {
            vscode.postMessage({
              type: "askResponse",
              askResponse: "yesButtonClicked",
              text: trimmedInput,
              images: images,
            });
            // Clear input state after sending
            setInputValue("");
            setSelectedImages([]);
          } else {
            vscode.postMessage({
              type: "askResponse",
              askResponse: "yesButtonClicked",
            });
          }
          break;
        case "resume_task":
          // For completed subtasks (tasks with a parentTaskId and a completion_result),
          // start a new task instead of resuming since the subtask is done
          const isCompletedSubtaskForClick =
            currentTaskItem?.parentTaskId &&
            messagesRef.current.some(
              (msg) =>
                msg.ask === "completion_result" ||
                msg.say === "completion_result",
            );
          if (isCompletedSubtaskForClick) {
            startNewTask();
          } else {
            // Only send text/images if they exist
            if (trimmedInput || (images && images.length > 0)) {
              vscode.postMessage({
                type: "askResponse",
                askResponse: "yesButtonClicked",
                text: trimmedInput,
                images: images,
              });
              // Clear input state after sending
              setInputValue("");
              setSelectedImages([]);
            } else {
              vscode.postMessage({
                type: "askResponse",
                askResponse: "yesButtonClicked",
              });
            }
          }
          break;
        case "completion_result":
        case "resume_completed_task":
          // Waiting for feedback, but we can just present a new task button
          startNewTask();
          break;
        case "command_output":
          vscode.postMessage({
            type: "terminalOperation",
            terminalOperation: "continue",
          });
          break;
        // kade_change start
        case "condense":
          vscode.postMessage({
            type: "condense",
            text: lastMessage?.text,
          });
          break;
        // kade_change end
      }

      setSendingDisabled(true);
      setClineAsk(undefined);
      setEnableButtons(false);
      setPrimaryButtonText(undefined);
      setSecondaryButtonText(undefined);
    },
    [clineAsk, startNewTask, currentTaskItem?.parentTaskId, lastMessage?.text], // kade_change: add lastMessage?.text
  );

  const handleSecondaryButtonClick = useCallback(
    (text?: string, images?: string[]) => {
      // Mark that user has responded
      userRespondedRef.current = true;

      const trimmedInput = text?.trim();

      if (clineAsk === "command_output") {
        vscode.postMessage({
          type: "terminalOperation",
          terminalOperation: "abort",
        });
        setSendingDisabled(true);
        setClineAsk(undefined);
        setEnableButtons(false);
        setPrimaryButtonText(undefined);
        setSecondaryButtonText(undefined);
        return;
      }

      if (isStreaming) {
        vscode.postMessage({ type: "cancelTask" });
        setDidClickCancel(true);
        return;
      }

      switch (clineAsk) {
        case "api_req_failed":
        case "mistake_limit_reached":
        case "resume_task":
          startNewTask();
          break;
        case "command":
        case "tool":
        case "browser_action_launch":
        case "use_mcp_server":
          // Only send text/images if they exist
          if (trimmedInput || (images && images.length > 0)) {
            vscode.postMessage({
              type: "askResponse",
              askResponse: "noButtonClicked",
              text: trimmedInput,
              images: images,
            });
            // Clear input state after sending
            setInputValue("");
            setSelectedImages([]);
          } else {
            // Responds to the API with a "This operation failed" and lets it try again
            vscode.postMessage({
              type: "askResponse",
              askResponse: "noButtonClicked",
            });
          }
          break;
      }
      setSendingDisabled(true);
      setClineAsk(undefined);
      setEnableButtons(false);
      setPrimaryButtonText(undefined);
      setSecondaryButtonText(undefined);
    },
    [clineAsk, startNewTask, isStreaming],
  );

  const handleTaskCloseButtonClick = useCallback(
    () => startNewTask(),
    [startNewTask],
  ); // kade_change

  const { info: model } = useSelectedModel(apiConfiguration);

  const selectImages = useCallback(
    () => vscode.postMessage({ type: "selectImages" }),
    [],
  );

  const shouldDisableImages =
    !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE;

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      const message: ExtensionMessage = e.data;

      switch (message.type) {
        case "action":
          switch (message.action!) {
            case "didBecomeVisible":
              if (!isHidden && !sendingDisabled && !enableButtons) {
                textAreaRef.current?.focus();
              }
              break;
            case "focusInput":
              textAreaRef.current?.focus();
              break;
          }
          break;
        case "selectedImages":
          // Only handle selectedImages if it's not for editing context
          // When context is "edit", ChatRow will handle the images
          if (message.context !== "edit") {
            setSelectedImages((prevImages: string[]) =>
              appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
            );
          }
          break;
        case "invoke":
          switch (message.invoke!) {
            case "newChat":
              handleChatReset();
              break;
            case "sendMessage":
              handleSendMessage(message.text ?? "", message.images ?? []);
              break;
            case "setChatBoxMessage":
              handleSetChatBoxMessage(message.text ?? "", message.images ?? []);
              break;
            case "primaryButtonClick":
              handlePrimaryButtonClick(
                message.text ?? "",
                message.images ?? [],
              );
              break;
            case "secondaryButtonClick":
              handleSecondaryButtonClick(
                message.text ?? "",
                message.images ?? [],
              );
              break;
          }
          break;
        case "condenseTaskContextStarted":
          // Handle both manual and automatic condensation start
          // We don't check the task ID because:
          // 1. There can only be one active task at a time
          // 2. Task switching resets isCondensing to false (see useEffect with task?.ts dependency)
          // 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
          if (message.text) {
            setIsCondensing(true);
            // Note: sendingDisabled is only set for manual condensation via handleCondenseContext
            // Automatic condensation doesn't disable sending since the task is already running
          }
          break;
        case "condenseTaskContextResponse":
          // Same reasoning as above - we trust this is for the current task
          if (message.text) {
            if (isCondensing && sendingDisabled) {
              setSendingDisabled(false);
            }
            setIsCondensing(false);
          }
          break;
        case "checkpointInitWarning":
          setCheckpointWarning(message.checkpointWarning);
          break;
        case "interactionRequired":
          playSound("notification");
          break;
      }
      // textAreaRef.current is not explicitly required here since React
      // guarantees that ref will be stable across re-renders, and we're
      // not using its value but its reference.
    },
    [
      isCondensing,
      isHidden,
      sendingDisabled,
      enableButtons,
      handleChatReset,
      handleSendMessage,
      handleSetChatBoxMessage,
      handlePrimaryButtonClick,
      handleSecondaryButtonClick,
      setCheckpointWarning,
      playSound,
    ],
  );

  useEvent("message", handleMessage);

  // Simple message processing with lightweight tool dedup (per tool.id; keep latest, reuse first ts for stability)
  const visibleMessages = useMemo(() => {
    // Pre-pass: record the latest occurrence for each logical tool row.
    // Prefer `tool.id` when available. If a streamed tool snapshot doesn't have a stable id yet,
    // fall back to turn + tool signature + occurrence order so repeated `E path.txt` calls in the
    // same assistant turn still collapse to one live row each.
    // Do not mutate message timestamps here: Virtuoso and downstream row lookup logic rely
    // on message.ts staying immutable for the life of a message object.
    const toolIdentityByIndex = new Map<number, string>();
    const lastIndexByToolIdentity = new Map<string, number>();
    let currentTurnTs = 0;
    const occurrenceByTurnAndSignature = new Map<string, number>();

    for (let i = 0; i < modifiedMessages.length; i++) {
      const msg = modifiedMessages[i];
      if (msg.say === "api_req_started") {
        currentTurnTs = msg.ts;
        occurrenceByTurnAndSignature.clear();
      }

      if ((msg.ask === "tool" || msg.say === "tool") && msg.text) {
        const tool = parseCachedTool(msg.text);
        if (tool) {
          let identity: string;
          const normalizedToolName = normalizeToolActivityName(
            tool.tool as string,
          );

          if (normalizedToolName === "readFile") {
            identity = tool.id
              ? `id:${tool.id}`
              : `read:${currentTurnTs}:${getToolSignature(tool)}`;
          } else if (tool.id) {
            identity = `id:${tool.id}`;
          } else {
            const mutableToolFamily =
              getMutableToolRowFamily(normalizedToolName);
            const signature = mutableToolFamily
              ? `mutable:${mutableToolFamily}`
              : `${currentTurnTs}:${getToolSignature(tool)}`;
            const occurrence = occurrenceByTurnAndSignature.get(signature) ?? 0;
            occurrenceByTurnAndSignature.set(signature, occurrence + 1);
            identity = `sig:${signature}:${occurrence}`;
          }

          toolIdentityByIndex.set(i, identity);
          lastIndexByToolIdentity.set(identity, i);
        }
      }
    }

    return modifiedMessages.filter((message, index) => {
      // Only filter obvious noise and duplicates
      const text = (message.text || "").trim();

      // Filter protocol noise
      if (
        text === "Result:" ||
        text.startsWith("[bash for") ||
        text === "---" ||
        text === "***"
      )
        return false;
      if (
        message.say === "text" &&
        text === "" &&
        !message.images?.length &&
        !message.partial
      )
        return false;

      // Lightweight dedup: keep the latest snapshot per logical tool row.
      // CRITICAL: We filter out earlier snapshots but the LATEST message object
      // might have a different reference. This is fine as long as its `ts` is stable.
      if ((message.ask === "tool" || message.say === "tool") && message.text) {
        const identity = toolIdentityByIndex.get(index);
        if (identity) {
          const lastIndex = lastIndexByToolIdentity.get(identity);
          if (lastIndex !== index) return false;
        }
      }

      // Filter system messages
      if (
        [
          "api_req_finished",
          "api_req_retried",
          "checkpoint_saved",
          "api_req_deleted",
        ].includes(message.say as string)
      )
        return false;

      if (
        shouldHideToolFollowupErrorMessage({
          messages: modifiedMessages,
          index,
          apiProvider: apiConfiguration?.apiProvider,
        })
      ) {
        return false;
      }

      return true;
    });
  }, [apiConfiguration?.apiProvider, modifiedMessages]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const cache = everVisibleMessagesTsRef.current;
      const currentMessageIds = new Set(
        modifiedMessages.map((m: ClineMessage) => m.ts),
      );
      const viewportMessages = visibleMessages.slice(
        Math.max(0, visibleMessages.length - 150),
      );
      const viewportMessageIds = new Set(
        viewportMessages.map((m: ClineMessage) => m.ts),
      );

      cache.forEach((_value: boolean, key: number) => {
        if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
          cache.delete(key);
        }
      });
    }, 60000);

    return () => clearInterval(cleanupInterval);
  }, [modifiedMessages, visibleMessages]);

  useDebounceEffect(
    () => {
      if (!isHidden && !sendingDisabled && !enableButtons) {
        textAreaRef.current?.focus();
      }
    },
    50,
    [isHidden, sendingDisabled, enableButtons],
  );

  useEffect(() => {
    // This ensures the first message is not read, future user messages are
    // labeled as `user_feedback`.
    if (lastMessage && messages.length > 1) {
      if (
        lastMessage.text && // has text
        (lastMessage.say === "text" ||
          lastMessage.say === "completion_result") && // is a text message
        !lastMessage.partial && // not a partial message
        typeof lastMessage.text === "string" && // kade_change: is a string
        !lastMessage.text.startsWith("{") // not a json object
      ) {
        let text = lastMessage?.text || "";
        const mermaidRegex = /```mermaid[\s\S]*?```/g;
        // remove mermaid diagrams from text
        text = text.replace(mermaidRegex, "");
        // remove markdown from text
        text = removeMd(text);

        // ensure message is not a duplicate of last read message
        if (text !== lastTtsRef.current) {
          try {
            playTts(text);
            lastTtsRef.current = text;
          } catch (error) {
            console.error("Failed to execute text-to-speech:", error);
          }
        }
      }
    }

    // Update previous value.
    setWasStreaming(isStreaming);
  }, [isStreaming, lastMessage, wasStreaming, messages.length]);

  // Compute current browser session messages for the top banner (not grouped into chat stream)
  // Find the FIRST browser session from the beginning to show ALL sessions
  const browserSessionStartIndex = useMemo(() => {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].ask === "browser_action_launch") {
        return i;
      }
    }
    return -1;
  }, [messages]);

  const _browserSessionMessages = useMemo<ClineMessage[]>(() => {
    if (browserSessionStartIndex === -1) return [];
    return messages.slice(browserSessionStartIndex);
  }, [browserSessionStartIndex, messages]);

  // Show globe toggle only when in a task that has a browser session (active or inactive)
  const showBrowserDockToggle = useMemo(
    () =>
      Boolean(
        task && (browserSessionStartIndex !== -1 || isBrowserSessionActive),
      ),
    [task, browserSessionStartIndex, isBrowserSessionActive],
  );

  const isBrowserSessionMessage = useCallback(
    (message: ClineMessage): boolean => {
      const kind =
        message.type || (message.ask ? "ask" : message.say ? "say" : undefined);

      // Only the launch ask should be hidden from chat (it's shown in the drawer header)
      if (kind === "ask" && message.ask === "browser_action_launch") {
        return true;
      }
      // browser_action_result messages are paired with browser_action and should not appear independently
      if (kind === "say" && message.say === "browser_action_result") {
        return true;
      }
      // browser_action messages are paired with browser_action_result and should not appear independently
      if (kind === "say" && message.say === "browser_action") {
        return true;
      }
      return false;
    },
    [],
  );

  const isNonRenderableRowMessage = useCallback(
    (message: ClineMessage): boolean => {
      const kind =
        message.type || (message.ask ? "ask" : message.say ? "say" : undefined);

      // Unknown shape - avoid leaking empty row shells into Virtuoso.
      if (!kind) {
        return true;
      }

      if (kind === "ask") {
        // Unknown ask variants render null in ChatRow.
        if (!RENDERABLE_ASK_ROW_TYPES.has(message.ask as string)) {
          return true;
        }

        // Empty completion_result ask rows render null.
        if (message.ask === "completion_result" && !message.text) {
          return true;
        }

        // Tool asks only render for a known subset in ChatRow's tool switch.
        if (message.ask === "tool") {
          const tool = parseCachedTool(message.text);
          return (
            !tool || !RENDERABLE_TOOL_TYPES.has((tool.tool as string) || "")
          );
        }

        return false;
      }

      if (kind !== "say") {
        return false;
      }

      // These say-types are intentionally non-visual in ChatRow and create
      // zero-height ghost rows if they reach Virtuoso.
      if (NON_RENDERABLE_SAY_ROW_TYPES.has(message.say as string)) {
        return true;
      }

      // say:"tool" rows: let any renderable tool's partial streaming state render.
      if (message.say === "tool") {
        const tool = parseCachedTool(message.text);
        if (tool?.tool === "runSlashCommand") return false;
        return !tool || !RENDERABLE_TOOL_TYPES.has((tool.tool as string) || "");
      }

      return false;
    },
    [],
  );

  const groupedMessages = useMemo(() => {
    // Keep only messages that can render to non-zero visual rows.
    const filtered: ClineMessage[] = visibleMessages.filter(
      (msg) => !isBrowserSessionMessage(msg) && !isNonRenderableRowMessage(msg),
    );

    // Defensive de-duplication:
    // - tool rows are de-duped by logical tool.id when available
    // - all other rows are de-duped by timestamp
    const seenTs = new Set<number>();
    const seenToolIds = new Set<string>();
    const result: ClineMessage[] = [];
    for (const msg of filtered) {
      if ((msg.ask === "tool" || msg.say === "tool") && msg.text) {
        const tool = parseCachedTool(msg.text);
        if (!tool) {
          if (seenTs.has(msg.ts)) continue;
        } else if (tool.id) {
          if (seenToolIds.has(tool.id)) continue;
          seenToolIds.add(tool.id);
        } else if (seenTs.has(msg.ts)) {
          continue;
        }
      } else if (seenTs.has(msg.ts)) {
        continue;
      }

      seenTs.add(msg.ts);
      result.push(msg);
    }

    if (visibleOptimisticUserMessages.length > 0) {
      result.push(...visibleOptimisticUserMessages);
    }

    if (isCondensing) {
      result.push({
        type: "say",
        say: "condense_context",
        ts: Date.now(),
        partial: true,
      } as any);
    }
    return result;
  }, [
    isCondensing,
    visibleMessages,
    isBrowserSessionMessage,
    isNonRenderableRowMessage,
    visibleOptimisticUserMessages,
  ]);

  const renderRows = useMemo(() => {
    const getStableRenderTs = (rowId: string, fallbackTs: number) => {
      const stableTs = stableRenderTsRef.current.get(rowId);
      if (stableTs !== undefined) {
        return stableTs;
      }
      stableRenderTsRef.current.set(rowId, fallbackTs);
      return fallbackTs;
    };

    const buildToolRowId = (
      tool: ClineSayTool,
      turnTs: number,
      occurrenceByTurnAndSignature: Map<string, number>,
    ) => {
      const normalizedToolName = normalizeToolActivityName(tool.tool as string);

      if (normalizedToolName === "readFile") {
        return tool.id
          ? `tool:id:${tool.id}`
          : `tool:read:${turnTs}:${getToolSignature(tool)}`;
      }

      if (tool.id) {
        return `tool:id:${tool.id}`;
      }

      const mutableToolFamily = getMutableToolRowFamily(normalizedToolName);
      const signature = mutableToolFamily
        ? `mutable:${mutableToolFamily}`
        : `${turnTs}:${getToolSignature(tool)}`;
      const occurrence = occurrenceByTurnAndSignature.get(signature) ?? 0;
      occurrenceByTurnAndSignature.set(signature, occurrence + 1);
      return `tool:sig:${signature}:${occurrence}`;
    };

    const rows: ChatRenderRow[] = [];
    let currentTurnTs = 0;
    const occurrenceByTurnAndSignature = new Map<string, number>();
    const userMessageOccurrences = new Map<string, number>();
    const assistantMessageOccurrences = new Map<string, number>();

    for (let i = 0; i < groupedMessages.length; i++) {
      const message = groupedMessages[i];

      if (message.say === "api_req_started") {
        currentTurnTs = message.ts;
        occurrenceByTurnAndSignature.clear();
        assistantMessageOccurrences.clear();
      }

      if (message.type === "ask" && message.ask === "tool" && message.text) {
        const segmentMessages: ClineMessage[] = [];
        const segmentTools: ClineSayTool[] = [];
        const segmentRowIds: string[] = [];
        let segmentTurnTs = currentTurnTs;
        let cursor = i;

        while (cursor < groupedMessages.length) {
          const candidate = groupedMessages[cursor];
          if (
            !(
              candidate.type === "ask" &&
              candidate.ask === "tool" &&
              candidate.text
            )
          ) {
            break;
          }

          const parsedTool = parseCachedTool(candidate.text);
          if (
            !parsedTool ||
            !TOOL_ACTIVITY_SUMMARY_TOOL_NAMES.has(
              (parsedTool.tool as string) || "",
            )
          ) {
            break;
          }

          segmentMessages.push(candidate);
          segmentTools.push(parsedTool);
          segmentRowIds.push(
            buildToolRowId(
              parsedTool,
              segmentTurnTs,
              occurrenceByTurnAndSignature,
            ),
          );
          cursor += 1;
        }

        const segmentHasFollowingBoundary = cursor < groupedMessages.length;
        const shouldSummarizeSegment = segmentMessages.length > 1;

        if (shouldSummarizeSegment) {
          const summarizedTools = dedupeToolActivityEntries(segmentTools);
          const running = getToolActivitySummaryRunning({
            hasFollowingBoundary: segmentHasFollowingBoundary,
            isStreaming,
            segmentMessages,
          });
          const summaryText = buildToolActivitySummaryText(
            summarizedTools,
            running,
          );
          const entries = summarizedTools
            .map((tool, entryIndex) => buildToolActivityEntry(tool, entryIndex))
            .filter((entry, entryIndex, allEntries) => {
              const signature = getToolActivityEntrySignature(entry);
              return (
                allEntries.findIndex(
                  (candidate) =>
                    getToolActivityEntrySignature(candidate) === signature,
                ) === entryIndex
              );
            });

          const summaryRowId = `tool-summary:${segmentRowIds[0]}`;
          const summaryMessage: ToolActivitySummaryMessage = {
            ...segmentMessages[0],
            type: "say",
            say: TOOL_ACTIVITY_SUMMARY_SAY,
            text: summaryText,
            metadata: {
              summaryText,
              running,
              entries,
            },
          };

          rows.push({
            id: summaryRowId,
            kind: TOOL_ACTIVITY_SUMMARY_SAY,
            message: summaryMessage,
            summary: summaryMessage.metadata,
            groupedMessages: segmentMessages.map(
              (segmentMessage, segmentIndex) => {
                const rowId = segmentRowIds[segmentIndex];
                const stableTs = getStableRenderTs(rowId, segmentMessage.ts);
                const renderMessage =
                  stableTs === segmentMessage.ts
                    ? segmentMessage
                    : { ...segmentMessage, ts: stableTs };

                return {
                  id: rowId,
                  message: renderMessage,
                  isStreaming: Boolean(segmentMessage.partial),
                };
              },
            ),
            isStreaming: running,
          });

          i = cursor - 1;
          continue;
        }
      }

      let rowId = `message:${message.type}:${message.ask ?? message.say ?? "unknown"}:${message.ts}`;
      let renderMessage = message;
      const isTrailingPartialAssistantMessage =
        i === groupedMessages.length - 1 &&
        message.partial === true &&
        message.type === "say" &&
        ![
          "tool",
          "reasoning",
          "api_req_started",
          "browser_action",
          "browser_action_result",
          "browser_session_status",
          "user_feedback",
          "user_feedback_diff",
          "task",
          "checkpoint_saved",
        ].includes(message.say || "");
      const userRenderableSignature =
        getUserRenderableMessageSignature(message);

      if (userRenderableSignature) {
        const occurrence =
          userMessageOccurrences.get(userRenderableSignature) ?? 0;
        userMessageOccurrences.set(userRenderableSignature, occurrence + 1);
        rowId = getUserRenderableRowId(message, occurrence) ?? rowId;
        const stableTs = getStableRenderTs(rowId, message.ts);
        if (stableTs !== message.ts) {
          renderMessage = { ...message, ts: stableTs };
        }
      } else if (isToolMessage(message) && message.text) {
        const parsedTool = parseCachedTool(message.text);
        if (parsedTool) {
          rowId = buildToolRowId(
            parsedTool,
            currentTurnTs,
            occurrenceByTurnAndSignature,
          );
          const stableTs = getStableRenderTs(rowId, message.ts);
          if (stableTs !== message.ts) {
            renderMessage = { ...message, ts: stableTs };
          }
        }
      } else if (message.type === "say" && message.say === "text") {
        const assistantOccurrenceKey = `${currentTurnTs}:${message.say}`;
        const occurrence =
          assistantMessageOccurrences.get(assistantOccurrenceKey) ?? 0;
        assistantMessageOccurrences.set(assistantOccurrenceKey, occurrence + 1);
        rowId = `assistant:${assistantOccurrenceKey}:${occurrence}`;
        const stableTs = getStableRenderTs(rowId, message.ts);
        if (stableTs !== message.ts) {
          renderMessage = { ...message, ts: stableTs };
        }
      } else if (isTrailingPartialAssistantMessage) {
        // Keep the single live assistant row stable while chunks stream in.
        rowId = `stream:assistant:${task?.ts ?? currentTurnTs}:${
          message.say ?? "unknown"
        }`;
        const stableTs = getStableRenderTs(rowId, message.ts);
        if (stableTs !== message.ts) {
          renderMessage = { ...message, ts: stableTs };
        }
      }

      rows.push({
        id: rowId,
        kind: "message",
        message: renderMessage,
        isStreaming: Boolean(message.partial),
      });
    }

    return rows;
  }, [groupedMessages, isStreaming, task?.ts]);

  useEffect(() => {
    renderRowsRef.current = renderRows;
  }, [renderRows]);

  const lastCommandMessageTs = useMemo(() => {
    for (let index = renderRows.length - 1; index >= 0; index--) {
      const row = renderRows[index];
      if (row.kind === "message" && row.message.ask === "command") {
        return row.message.ts;
      }
    }

    return null;
  }, [renderRows]);

  useEffect(() => {
    const handleZeroSizedRow = (event: Event) => {
      const customEvent = event as CustomEvent<{ ts?: number }>;
      const ts = customEvent.detail?.ts;
      if (typeof ts !== "number" || !Number.isFinite(ts)) {
        return;
      }
      setZeroSizedRowTs((prev) => {
        if (prev.has(ts)) return prev;
        const next = new Set(prev);
        next.add(ts);
        return next;
      });
    };

    window.addEventListener("chat-row-zero-size", handleZeroSizedRow);
    return () =>
      window.removeEventListener("chat-row-zero-size", handleZeroSizedRow);
  }, []);

  useEffect(() => {
    // Task switched or list rebuilt from scratch: clear stale zero-size blacklist.
    setZeroSizedRowTs(new Set());
  }, [task?.ts]);

  // Bottom-pinning during streaming is handled by Virtuoso's followOutput
  // and the MutationObserver in useStreamingScrollPin. Adding manual
  // scrollToBottom calls here creates competing scroll adjustments that
  // cause visible jank.
  useEffect(() => {
    // When streaming starts or new messages arrive, just ensure the
    // pinned state is set. The actual scroll adjustment is done by
    // followOutput + MutationObserver, not by imperative scrollToIndex.
    if (stickyFollowRef.current || (isStreaming && !showScrollToBottom)) {
      setStreamingPinned(true);
    }
  }, [renderRows.length, isStreaming, showScrollToBottom]);

  // scrolling

  const scrollToBottomSmooth = useMemo(
    () =>
      debounce(() => manualScrollToBottom(), 10, {
        immediate: true,
      }),
    [manualScrollToBottom],
  );
  const bottomMagnetRafRef = useRef<number | null>(null);
  const bottomMagnetUntilRef = useRef(0);

  const extendBottomMagnet = useCallback((durationMs = 1200) => {
    bottomMagnetUntilRef.current = Math.max(
      bottomMagnetUntilRef.current,
      performance.now() + durationMs,
    );
  }, []);

  const releaseBottomMagnet = useCallback(() => {
    bottomMagnetUntilRef.current = 0;
  }, []);

  useLayoutEffect(() => {
    if (!isLastPartialReadTool || showScrollToBottomRef.current) {
      return;
    }

    const scroller =
      streamingScrollerElRef.current ??
      stableListRef.current ??
      scrollRootRef.current;
    if (!scroller) {
      return;
    }

    const hadBottomOwnership =
      stickyFollowRef.current ||
      streamingPinnedRef.current ||
      isAtBottomRef.current ||
      stableWasAtBottomRef.current;
    if (!hadBottomOwnership) {
      return;
    }

    setStreamingPinned(true);
    extendBottomMagnet(900);
    forcePinToBottom();
    stablePrevScrollHeightRef.current = scroller.scrollHeight;
    stableWasAtBottomRef.current = true;
    updateBottomState(true);
  }, [
    extendBottomMagnet,
    forcePinToBottom,
    isLastPartialReadTool,
    streamingPinnedRef,
    streamingScrollerElRef,
    updateBottomState,
  ]);

  const handleScrollerDistanceFromBottom = useCallback(
    (distanceFromBottom: number, scrollHeight: number) => {
      const atBottom = distanceFromBottom <= BOTTOM_OFFSET_THRESHOLD;
      const userInitiatedRelease = shouldAllowStreamingRelease();

      stablePrevScrollHeightRef.current = scrollHeight;
      stableWasAtBottomRef.current = atBottom;

      const streamingPinned = syncStreamingPinnedFromScroll(distanceFromBottom);
      const retainStreamingPinOptions = {
        isStreaming,
        stickyFollow: stickyFollowRef.current,
        streamingPinned,
        distanceFromBottom,
        bottomOffsetThreshold: BOTTOM_OFFSET_THRESHOLD,
        userInitiatedRelease,
      };
      const retainStreamingPin = shouldRetainStreamingPin(
        retainStreamingPinOptions,
      );

      if (!atBottom && !retainStreamingPin) {
        stickyFollowRef.current = false;
        setStreamingPinned(false);
        releaseBottomMagnet();
        updateBottomState(false);
        return;
      }

      updateBottomState(atBottom);
    },
    [
      isStreaming,
      releaseBottomMagnet,
      shouldAllowStreamingRelease,
      syncStreamingPinnedFromScroll,
      updateBottomState,
    ],
  );

  const preserveAnimatedScrollAnchor = useCallback(
    (detail?: { top: number; bottom: number }) => {
      const scroller =
        streamingScrollerElRef.current ??
        stableListRef.current ??
        scrollRootRef.current;
      if (!scroller) {
        return;
      }

      const prevScrollHeight =
        stablePrevScrollHeightRef.current || scroller.scrollHeight;
      const nextScrollHeight = scroller.scrollHeight;
      const delta = nextScrollHeight - prevScrollHeight;
      const isActuallyAtBottom =
        nextScrollHeight - scroller.scrollTop - scroller.clientHeight <=
        BOTTOM_OFFSET_THRESHOLD;
      const hadBottomOwnership =
        stickyFollowRef.current ||
        streamingPinnedRef.current ||
        isAtBottomRef.current ||
        stableWasAtBottomRef.current;
      // KILOCODE FIX: Determine bottom state explicitly
      const animatedDetailNeedsViewportPreservation =
        !!detail && !isActuallyAtBottom;

      // If we are streaming and we were previously pinned, or if we are at the bottom, stay pinned.
      // Do not use the detail alone to unpin if we are actively streaming.
      const shouldPinBottom =
        (hadBottomOwnership || (isStreaming && streamingPinnedRef.current)) &&
        !showScrollToBottom;

      setStreamingPinned(shouldPinBottom);

      if (shouldPinBottom) {
        extendBottomMagnet();
        if (!isStreaming) {
          forcePinToBottom();
        }
      } else if (
        delta !== 0 &&
        shouldAdjustScrollForToolAnimation(
          detail,
          scroller.getBoundingClientRect().top,
        )
      ) {
        scroller.scrollTop += delta;
      }

      stablePrevScrollHeightRef.current = scroller.scrollHeight;
      stableWasAtBottomRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        BOTTOM_OFFSET_THRESHOLD;
    },
    [
      forcePinToBottom,
      isStreaming,
      showScrollToBottom,
      streamingPinnedRef,
      streamingScrollerElRef,
      extendBottomMagnet,
    ],
  );

  const stableLastAnchorDetailRef = useRef<ToolAnimateHeightDetail | undefined>(
    undefined,
  );
  useEffect(() => {
    const handleToolAnimateHeight = (
      event: Event | CustomEvent<ToolAnimateHeightDetail>,
    ) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      stableLastAnchorDetailRef.current = detail;
      preserveAnimatedScrollAnchor(detail);
    };
    window.addEventListener(
      CHAT_SCROLL_ANCHOR_ADJUST_EVENT,
      handleToolAnimateHeight,
    );
    return () =>
      window.removeEventListener(
        CHAT_SCROLL_ANCHOR_ADJUST_EVENT,
        handleToolAnimateHeight,
      );
  }, [preserveAnimatedScrollAnchor]);

  // NOTE: The tool-animate-height handler above uses forcePinToBottom()
  // for accordion expand/collapse events because those are discrete,
  // one-shot events that need immediate synchronous scroll adjustment.
  // The MutationObserver + ResizeObserver handle continuous streaming.

  useEffect(() => {
    const tick = () => {
      bottomMagnetRafRef.current = null;

      const scroller =
        streamingScrollerElRef.current ??
        stableListRef.current ??
        scrollRootRef.current;
      if (!scroller) {
        return;
      }

      const baseMagnetActive =
        stickyFollowRef.current ||
        streamingPinnedRef.current ||
        (isStreaming && !showScrollToBottomRef.current);
      if (baseMagnetActive) {
        extendBottomMagnet();
      }

      const shouldMagnet =
        baseMagnetActive ||
        (performance.now() < bottomMagnetUntilRef.current &&
          !showScrollToBottomRef.current);

      if (!shouldMagnet) {
        return;
      }

      if (performance.now() < smoothBottomAnchorUntilRef.current) {
        bottomMagnetRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      if (maxScrollTop > 0 && maxScrollTop - scroller.scrollTop > 1) {
        scroller.scrollTop = scroller.scrollHeight;
        stablePrevScrollHeightRef.current = scroller.scrollHeight;
        stableWasAtBottomRef.current = true;
        if (!isAtBottomRef.current) {
          updateBottomState(true);
        }
      }

      bottomMagnetRafRef.current = requestAnimationFrame(tick);
    };

    bottomMagnetRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (bottomMagnetRafRef.current !== null) {
        cancelAnimationFrame(bottomMagnetRafRef.current);
        bottomMagnetRafRef.current = null;
      }
      if (smoothBottomAnchorRafRef.current !== null) {
        cancelAnimationFrame(smoothBottomAnchorRafRef.current);
        smoothBottomAnchorRafRef.current = null;
      }
      smoothBottomAnchorUntilRef.current = 0;
      if (
        scrollToBottomSmooth &&
        typeof (scrollToBottomSmooth as any).cancel === "function"
      ) {
        (scrollToBottomSmooth as any).cancel();
      }
    };
  }, [
    extendBottomMagnet,
    isStreaming,
    scrollToBottomSmooth,
    streamingScrollerElRef,
    updateBottomState,
  ]);

  const scrollToBottomAuto = useCallback(() => {
    // Use instant behavior to prevent the "bounce" during layout shifts like typing
    manualScrollToBottom("instant");
  }, [manualScrollToBottom]);

  // kade_change start
  // Animated "blink" to highlight a specific message. Used by the TaskTimeline
  const highlightClearTimerRef = useRef<NodeJS.Timeout | undefined>();
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<
    number | null
  >(null);
  const handleMessageClick = useCallback((index: number) => {
    setHighlightedMessageIndex(index);
    // The actual scrolling and timer logic is now handled by the useEffect below
  }, []);

  useEffect(() => {
    if (highlightedMessageIndex === null) return;
    const index = highlightedMessageIndex;

    scrollToRenderRowIndex(index, "end", "smooth");

    // Clear existing timer if present
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
    }
    highlightClearTimerRef.current = setTimeout(() => {
      setHighlightedMessageIndex(null);
      highlightClearTimerRef.current = undefined;
    }, 1000);
  }, [highlightedMessageIndex, scrollToRenderRowIndex]);

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightClearTimerRef.current) {
        clearTimeout(highlightClearTimerRef.current);
      }
    };
  }, []);
  // kade_change end

  const handleSetExpandedRow = useCallback(
    (ts: number, currentExpanded?: boolean) => {
      setExpandedRows((prev: Record<number, boolean>) => {
        const newState = !currentExpanded;
        if (prev[ts] === newState) return prev;
        return {
          ...prev,
          [ts]: newState,
        };
      });
    },
    [],
  );

  // Scroll when user toggles certain rows.
  const toggleRowExpansion = useCallback(
    (ts: number, currentExpanded?: boolean) => {
      handleSetExpandedRow(ts, currentExpanded);
    },
    [handleSetExpandedRow],
  );

  const handleRowHeightChange = useCallback((_isTaller: boolean) => {
    // Height changes are handled by the streaming scroll pin hook
    // (MutationObserver + rAF) and Virtuoso's followOutput.
    // Adding manual scrollToIndex here creates competing scroll
    // adjustments that cause visible jank.
  }, []);

  // Disable sticky follow when user scrolls up inside the chat container
  // Virtuoso handles this internaly mostly, but we keep this for wheel events on window
  const handleWheel = useCallback(
    (event: Event) => {
      const wheelEvent = event as WheelEvent;
      const eventTarget = wheelEvent.target;
      const scroller =
        streamingScrollerElRef.current ??
        stableListRef.current ??
        scrollRootRef.current;
      if (!(eventTarget instanceof Node) || !scroller?.contains(eventTarget)) {
        return;
      }

      // KILOCODE FIX: If user scrolls up (deltaY < 0), immediately release the scroll lock.
      if (wheelEvent.deltaY < 0) {
        userWheelReleaseUntilRef.current =
          performance.now() + USER_WHEEL_SCROLL_RELEASE_WINDOW_MS;
        stickyFollowRef.current = false;
        setStreamingPinned(false);
        releaseBottomMagnet();
        return;
      }

      if (wheelEvent.deltaY > 0) {
        userWheelReleaseUntilRef.current = 0;
      }
    },
    [releaseBottomMagnet],
  );
  useEvent("wheel", handleWheel, window, { passive: true });

  // Also disable sticky follow when the chat container is scrolled away from bottom
  // Handled by Virtuoso atBottomStateChange

  //kade_change
  // Effect to clear checkpoint warning when messages appear or task changes
  useEffect(() => {
    if (isHidden || !task) {
      setCheckpointWarning(undefined);
    }
  }, [modifiedMessages.length, isStreaming, isHidden, task]);

  const placeholderText =
    messageQueue.length > 0
      ? t("chat:queuedMessages.inputPlaceholder")
      : task
        ? t("chat:typeMessage")
        : t("chat:typeTask");

  const switchToMode = useCallback(
    (modeSlug: string): void => {
      // Update local state and notify extension to sync mode change.
      setMode(modeSlug);

      // Send the mode switch message.
      vscode.postMessage({ type: "mode", text: modeSlug });
    },
    [setMode],
  );

  const handleSuggestionClickInRow = useCallback(
    (suggestion: SuggestionItem, event?: React.MouseEvent) => {
      // Mark that user has responded if this is a manual click (not auto-approval)
      if (event) {
        userRespondedRef.current = true;
      }

      // Mark the current follow-up question as answered when a suggestion is clicked
      if (clineAsk === "followup" && !event?.shiftKey) {
        markFollowUpAsAnswered();
      }

      // Check if we need to switch modes
      if (suggestion.mode) {
        // Only switch modes if it's a manual click (event exists) or auto-approval is allowed
        const isManualClick = !!event;
        if (isManualClick || alwaysAllowModeSwitch) {
          // Switch mode without waiting
          switchToMode(suggestion.mode);
        }
      }

      if (event?.shiftKey) {
        // Always append to existing text, don't overwrite
        setInputValue((currentValue: string) => {
          return currentValue !== ""
            ? `${currentValue} \n${suggestion.answer}`
            : suggestion.answer;
        });
      } else {
        // Don't clear the input value when sending a follow-up choice
        // The message should be sent but the text area should preserve what the user typed
        const preservedInput = inputValueRef.current;
        handleSendMessage(suggestion.answer, []);
        // Restore the input value after sending
        setInputValue(preservedInput);
      }
    },
    [
      handleSendMessage,
      setInputValue,
      switchToMode,
      alwaysAllowModeSwitch,
      clineAsk,
      markFollowUpAsAnswered,
    ],
  );

  const handleBatchFileResponse = useCallback(
    (response: { [key: string]: boolean }) => {
      // Handle batch file response, e.g., for file uploads
      vscode.postMessage({
        type: "askResponse",
        askResponse: "objectResponse",
        text: JSON.stringify(response),
      });
    },
    [],
  );

  // kade_change start: Virtuoso Footer for bottom spacing
  // Keep footer spacer in sync with composer height.
  // A stale footer height can look like random extra chat padding until remount.
  const footerSpacerHeight = useMemo(() => {
    const clampedChatAreaHeight = Math.max(0, Math.min(chatAreaHeight, 600));
    return clampedChatAreaHeight + 130;
  }, [chatAreaHeight]);

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () => (
        <div
          style={{
            height: footerSpacerHeight,
            minHeight: footerSpacerHeight,
          }}
        >
          <div className="scroll-anchor" style={{ height: "1px" }} />
        </div>
      ),
    }),
    [footerSpacerHeight],
  );
  // kade_change end

  const itemContent = useCallback(
    (index: number, row: ChatRenderRow) => {
      const currentModifiedMessages = modifiedMessagesRef.current;
      const currentExpandedRows = expandedRowsRef.current;
      const currentRenderRows = renderRowsRef.current;
      const isLastRow = index === currentRenderRows.length - 1;

      if (row.kind === TOOL_ACTIVITY_SUMMARY_SAY) {
        return (
          <ToolActivitySummaryRow
            key={row.id}
            data={row.summary}
            shouldAnimate={isLastRow}
          >
            {row.groupedMessages
              .filter(
                (groupedRow) =>
                  !(
                    groupedRow.message.type === "say" &&
                    groupedRow.message.say === "error"
                  ),
              )
              .map((groupedRow) => (
              <MemoizedChatRowContent
                key={groupedRow.id}
                message={groupedRow.message}
                isExpanded={
                  currentExpandedRows[groupedRow.message.ts] !== undefined
                    ? currentExpandedRows[groupedRow.message.ts]
                    : groupedRow.message.say === "reasoning"
                      ? isLastRow && groupedRow.isStreaming
                        ? true
                        : !reasoningBlockCollapsed
                      : !historyPreviewCollapsed
                }
                isLast={false}
                isStreaming={groupedRow.isStreaming}
                onToggleExpand={toggleRowExpansion}
                onSuggestionClick={handleSuggestionClickInRow}
                onBatchFileResponse={handleBatchFileResponse}
                onFollowUpUnmount={undefined}
                enableCheckpoints={enableCheckpoints}
                isFollowUpAnswered={false}
                isFollowUpAutoApprovalPaused={false}
                isAskingToProceed={false}
                showResponseActions={false}
                allowCommandAutoScroll={!showScrollToBottom}
                compactToolSpacing
              />
            ))}
          </ToolActivitySummaryRow>
        );
      }

      const messageOrGroup = row.message;

      if (
        messageOrGroup.type === "say" &&
        messageOrGroup.say === "browser_action"
      ) {
        // Find the corresponding result message by looking for the next browser_action_result after this action's timestamp
        const nextMessage = currentModifiedMessages.find(
          (m) => m.ts > messageOrGroup.ts && m.say === "browser_action_result",
        );

        // Calculate action index and total count
        const browserActions = currentModifiedMessages.filter(
          (m) => m.say === "browser_action",
        );
        const actionIndex =
          browserActions.findIndex((m) => m.ts === messageOrGroup.ts) + 1;
        const totalActions = browserActions.length;

        return (
          <BrowserActionRow
            key={row.id}
            message={messageOrGroup}
            nextMessage={nextMessage}
            actionIndex={actionIndex}
            totalActions={totalActions}
          />
        );
      }

      // browser_action_result messages are handled by the preceding browser_action row
      if (
        messageOrGroup.type === "say" &&
        messageOrGroup.say === "browser_action_result"
      ) {
        return null;
      }

      // Check if this is a browser session status message
      if (
        messageOrGroup.type === "say" &&
        messageOrGroup.say === "browser_session_status"
      ) {
        return (
          <BrowserSessionStatusRow
            key={messageOrGroup.ts}
            message={messageOrGroup}
          />
        );
      }

      // kade_change: Check if asking to proceed
      // Use ref to avoid callback recreation
      const isLastCommand =
        messageOrGroup.ask === "command" &&
        messageOrGroup.ts === lastCommandMessageTs;

      // regular message
      return (
        <ChatRow
          key={row.id}
          message={messageOrGroup}
          isExpanded={
            currentExpandedRows[messageOrGroup.ts] !== undefined
              ? currentExpandedRows[messageOrGroup.ts]
              : messageOrGroup.say === "reasoning"
                ? isLastRow && isStreaming
                  ? true
                  : !reasoningBlockCollapsed
                : !historyPreviewCollapsed
          }
          onToggleExpand={toggleRowExpansion}
          isLast={isLastRow && !didClickCancel}
          onHeightChange={handleRowHeightChange}
          isStreaming={isLastRow ? isStreaming : false}
          onSuggestionClick={handleSuggestionClickInRow} // This was already stabilized
          onBatchFileResponse={handleBatchFileResponse}
          highlighted={highlightedMessageIndex === index} // kade_change: add highlight prop
          enableCheckpoints={enableCheckpoints} // kade_change
          isFollowUpAnswered={
            messageOrGroup.isAnswered === true ||
            messageOrGroup.ts === currentFollowUpTs
          }
          isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
          editable={
            messageOrGroup.type === "ask" &&
            messageOrGroup.ask === "tool" &&
            (() => {
              const tool: any =
                parseCachedTool(messageOrGroup.text) ??
                (messageOrGroup.text?.includes("updateTodoList")
                  ? { tool: "updateTodoList" }
                  : {});
              if (tool.tool === "updateTodoList" && alwaysAllowUpdateTodoList) {
                return false;
              }
              return (
                tool.tool === "updateTodoList" &&
                enableButtons &&
                !!primaryButtonText
              );
            })()
          }
          hasCheckpoint={hasCheckpointMessage}
          isAskingToProceed={isLastCommand && clineAsk === "command_output"}
          allowCommandAutoScroll={!showScrollToBottom}
          showResponseActions={(() => {
            const type =
              messageOrGroup.type === "ask"
                ? messageOrGroup.ask
                : messageOrGroup.say;
            const isAssistantText =
              ["text", "completion_result", "followup"].includes(
                type as string,
              ) ||
              (messageOrGroup.type === "say" &&
                ![
                  "user_feedback",
                  "user_feedback_diff",
                  "task",
                  "tool",
                  "api_req_started",
                  "reasoning",
                  "checkpoint_saved",
                  "browser_session_status",
                ].includes(messageOrGroup.say || ""));

            if (!isAssistantText) return false;

            const nextMsg = currentRenderRows[index + 1]?.message;
            if (!nextMsg) return true;

            return (
              nextMsg.type === "say" &&
              ["user_feedback", "user_feedback_diff", "task"].includes(
                nextMsg.say || "",
              )
            );
          })()}
        />
      );
    },
    [
      toggleRowExpansion,
      // REMOVED: modifiedMessages, groupedMessages - now uses refs to avoid callback recreation
      handleRowHeightChange,
      isStreaming,
      handleSuggestionClickInRow,
      handleBatchFileResponse,
      hasCheckpointMessage,
      highlightedMessageIndex, // kade_change: add highlightedMessageIndex
      enableCheckpoints, // kade_change
      currentFollowUpTs,
      isFollowUpAutoApprovalPaused,
      alwaysAllowUpdateTodoList,
      enableButtons,
      primaryButtonText,
      clineAsk,
      historyPreviewCollapsed,
      lastCommandMessageTs,
      reasoningBlockCollapsed,
    ],
  );

  const messageListData = useMemo<DataWithScrollModifier<ChatRenderRow>>(() => {
    const previousRows = prevMessageListRowsRef.current;
    const previousIds = previousRows.map((row) => row.id);
    const nextIds = renderRows.map((row) => row.id);

    if (renderRows.length === 0) {
      prevMessageListRowsRef.current = renderRows;
      prevMessageListTaskTsRef.current = task?.ts;
      return { data: renderRows };
    }

    const appended =
      previousIds.length > 0 &&
      nextIds.length >= previousIds.length &&
      previousIds.every((id, index) => nextIds[index] === id);
    const sameItemsChanged =
      previousIds.length === nextIds.length &&
      previousIds.every((id, index) => nextIds[index] === id);

    let scrollModifier: DataWithScrollModifier<ChatRenderRow>["scrollModifier"];

    if (appended) {
      scrollModifier = {
        type: "auto-scroll-to-bottom",
        autoScroll: ({ atBottom, scrollInProgress }) => {
          const shouldFollow =
            stickyFollowRef.current ||
            (isStreaming && (atBottom || streamingPinnedRef.current));
          if (!shouldFollow) {
            return false;
          }

          if (isStreaming && !wasStreaming && !showScrollToBottomRef.current) {
            return false;
          }

          return {
            index: "LAST",
            align: "end",
            behavior: atBottom || scrollInProgress ? "auto" : "smooth",
          };
        },
      };
    } else if (sameItemsChanged && isStreaming && !showScrollToBottom) {
      scrollModifier = {
        type: "items-change",
        behavior: "auto",
      };
    }

    prevMessageListRowsRef.current = renderRows;
    prevMessageListTaskTsRef.current = task?.ts;

    return {
      data: renderRows,
      scrollModifier,
    };
  }, [
    isStreaming,
    renderRows,
    showScrollToBottom,
    task?.ts,
    streamingPinnedRef,
    wasStreaming,
  ]);

  const messageListKey = useMemo(
    () => `message-list:${task?.ts ?? "no-task"}`,
    [task?.ts],
  );

  const MessageListItem = useMemo<
    NonNullable<VirtuosoMessageListProps<ChatRenderRow, unknown>["ItemContent"]>
  >(
    () =>
      function MessageListItem({ data, index }) {
        return <div style={{ minHeight: 1 }}>{itemContent(index, data)}</div>;
      },
    [itemContent],
  );

  const MessageListFooter = useMemo<
    NonNullable<VirtuosoMessageListProps<ChatRenderRow, unknown>["Footer"]>
  >(
    () =>
      function MessageListFooter() {
        return (
          <div
            style={{
              height: footerSpacerHeight,
              minHeight: footerSpacerHeight,
            }}
          >
            <div className="scroll-anchor" style={{ height: "1px" }} />
          </div>
        );
      },
    [footerSpacerHeight],
  );

  const MessageListScrollElement = useMemo<
    NonNullable<
      VirtuosoMessageListProps<ChatRenderRow, unknown>["ScrollElement"]
    >
  >(
    () =>
      forwardRef(function MessageListScrollElement(
        {
          context: _context,
          ...props
        }: React.HTMLProps<HTMLDivElement> & { context?: unknown },
        ref: React.Ref<HTMLDivElement>,
      ) {
        return (
          <div
            {...props}
            ref={(el) => {
              assignRef(ref, el);
              streamingScrollerRef(el);
              scrollRootRef.current = el;
            }}
          />
        );
      }),
    [streamingScrollerRef],
  );

  // Function to handle mode switching
  const switchToNextMode = useCallback(() => {
    const allModes = getAllModes(customModes);
    const currentModeIndex = allModes.findIndex((m) => m.slug === mode);
    const nextModeIndex = (currentModeIndex + 1) % allModes.length;
    // Update local state and notify extension to sync mode change
    switchToMode(allModes[nextModeIndex].slug);
  }, [mode, customModes, switchToMode]);

  // Function to handle switching to previous mode
  const switchToPreviousMode = useCallback(() => {
    const allModes = getAllModes(customModes);
    const currentModeIndex = allModes.findIndex((m) => m.slug === mode);
    const previousModeIndex =
      (currentModeIndex - 1 + allModes.length) % allModes.length;
    // Update local state and notify extension to sync mode change
    switchToMode(allModes[previousModeIndex].slug);
  }, [mode, customModes, switchToMode]);

  // Add keyboard event handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check for Command/Ctrl + Period (with or without Shift)
      // Using event.key to respect keyboard layouts (e.g., Dvorak)
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault(); // Prevent default browser behavior

        if (event.shiftKey) {
          // Shift + Period = Previous mode
          switchToPreviousMode();
        } else {
          // Just Period = Next mode
          switchToNextMode();
        }
      }
    },
    [switchToNextMode, switchToPreviousMode],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]); // kade_change

  useImperativeHandle(ref, () => ({
    toggleHistory: () => {
      setShowHistoryDropdown((prev) => !prev);
    },
    acceptInput: () => {
      if (enableButtons && primaryButtonText) {
        handlePrimaryButtonClick(inputValue, selectedImages);
      } else if (
        !sendingDisabled &&
        !isProfileDisabled &&
        (inputValue.trim() || selectedImages.length > 0)
      ) {
        handleSendMessage(inputValue, selectedImages);
      }
    },
    // kade_change start
    focusInput: () => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
      }
    },
    // kade_change end
  }));

  const handleCondenseContext = (taskId: string) => {
    if (isCondensing || sendingDisabled) {
      return;
    }
    setIsCondensing(true);
    setSendingDisabled(true);
    vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId });
  };

  // kade_change: only show footer if we have the scroll button. Action buttons are now in ChatTextArea.
  const areButtonsVisible = showScrollToBottom;

  const showTelemetryBanner = telemetrySetting === "unset"; // kade_change

  const SCROLL_DEBUG = false; // Disabled debug overlay
  const stableListRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const stablePrevScrollHeightRef = useRef(0);
  const stableWasAtBottomRef = useRef(true);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  const virtualRowKeys = useMemo(
    () => renderRows.map((row) => row.id),
    [renderRows],
  );

  const virtualRowStreamingStates = useMemo(
    () => renderRows.map((row) => row.isStreaming),
    [renderRows],
  );

  const renderRow = useCallback(
    (index: number) => {
      const item = renderRowsRef.current[index];
      if (!item) return null;
      return itemContent(index, item);
    },
    [itemContent],
  );

  // kade_change start: Full-view drag-and-drop
  const [isDraggingOverView, setIsDraggingOverView] = useState(false);
  const dragCounterRef = useRef(0);

  const handleViewDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDraggingOverView(true);
    }
  }, []);

  const handleViewDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOverView(false);
    }
  }, []);

  const handleViewDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleViewDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOverView(false);

      // Check for text/URI data (file paths from VS Code explorer, tabs, etc.)
      const textFieldList = e.dataTransfer.getData("text");
      const textUriList = e.dataTransfer.getData(
        "application/vnd.code.uri-list",
      );
      const text = textFieldList || textUriList;

      if (text) {
        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
        if (lines.length > 0) {
          let mentions = "";
          for (let i = 0; i < lines.length; i++) {
            const mentionText = convertToMentionPath(lines[i], cwd);
            mentions += mentionText;
            if (i < lines.length - 1) mentions += " ";
          }
          setInputValue((prev) => {
            const separator = prev && !prev.endsWith(" ") ? " " : "";
            return prev + separator + mentions + " ";
          });
          textAreaRef.current?.focus();
        }
        return;
      }

      // Check for dropped files (images from Finder, desktop, etc.)
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const acceptedImageTypes = ["png", "jpeg", "webp"];
        const imageFiles = files.filter((file) => {
          const [type, subtype] = file.type.split("/");
          return type === "image" && acceptedImageTypes.includes(subtype);
        });
        const nonImageFiles = files.filter((file) => {
          const [type, subtype] = file.type.split("/");
          return !(type === "image" && acceptedImageTypes.includes(subtype));
        });

        // Handle image files — add as attachments
        if (imageFiles.length > 0 && !shouldDisableImages) {
          const imagePromises = imageFiles.map((file) => {
            return new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (reader.error) {
                  console.error("Error reading file", reader.error);
                  resolve(null);
                } else {
                  const result = reader.result;
                  resolve(typeof result === "string" ? result : null);
                }
              };
              reader.readAsDataURL(file);
            });
          });
          const imageDataArray = await Promise.all(imagePromises);
          const dataUrls = imageDataArray.filter(
            (url): url is string => url !== null,
          );
          if (dataUrls.length > 0) {
            setSelectedImages((prev) =>
              [...prev, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
            );
            if (typeof vscode !== "undefined") {
              vscode.postMessage({ type: "draggedImages", dataUrls });
            }
          }
        }

        // Handle non-image files — insert as @mentions using Electron's File.path
        if (nonImageFiles.length > 0) {
          const paths = nonImageFiles
            .map((file) => (file as any).path as string | undefined)
            .filter((p): p is string => !!p);
          if (paths.length > 0) {
            let mentions = "";
            for (let i = 0; i < paths.length; i++) {
              mentions += convertToMentionPath(paths[i], cwd);
              if (i < paths.length - 1) mentions += " ";
            }
            setInputValue((prev) => {
              const separator = prev && !prev.endsWith(" ") ? " " : "";
              return prev + separator + mentions + " ";
            });
            textAreaRef.current?.focus();
          }
        }
      }
    },
    [cwd, setInputValue, shouldDisableImages, setSelectedImages],
  );
  // kade_change end: Full-view drag-and-drop

  useEffect(() => {
    if (!FORCE_STABLE_CHAT_LIST) return;
    const el = stableListRef.current;
    if (!el) return;

    const isAtBottomNow = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <=
      BOTTOM_OFFSET_THRESHOLD;
    stableWasAtBottomRef.current = isAtBottomNow();
    stablePrevScrollHeightRef.current = el.scrollHeight;
    const applyAnchor = () => {
      const prev = stablePrevScrollHeightRef.current;
      const next = el.scrollHeight;
      const delta = next - prev;
      if (delta === 0) return;

      // KILOCODE FIX: If user has scrolled up, do not pin.
      const isActuallyAtBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <=
        BOTTOM_OFFSET_THRESHOLD;
      const hadBottomOwnership =
        stickyFollowRef.current ||
        streamingPinnedRef.current ||
        isAtBottomRef.current ||
        stableWasAtBottomRef.current;
      const shouldPinBottom =
        (hadBottomOwnership || isActuallyAtBottom) &&
        isStreaming &&
        !showScrollToBottom &&
        (!stableLastAnchorDetailRef.current ||
          shouldAdjustScrollForToolAnimation(
            stableLastAnchorDetailRef.current,
            el.getBoundingClientRect().top,
          ));

      if (shouldPinBottom) {
        el.scrollTop = el.scrollHeight;
      } else {
        // Global anchor rule: preserve viewport on content height changes.
        el.scrollTop += delta;
      }

      stablePrevScrollHeightRef.current = el.scrollHeight;
      stableWasAtBottomRef.current = isAtBottomNow();
    };

    let raf = 0;
    const scheduleAnchor = () => {
      const isActuallyAtBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <=
        BOTTOM_OFFSET_THRESHOLD;
      const hadBottomOwnership =
        stickyFollowRef.current ||
        streamingPinnedRef.current ||
        isAtBottomRef.current ||
        stableWasAtBottomRef.current;
      const shouldPinBottom =
        (hadBottomOwnership || (isStreaming && isActuallyAtBottom)) &&
        !showScrollToBottom &&
        (!stableLastAnchorDetailRef.current ||
          shouldAdjustScrollForToolAnimation(
            stableLastAnchorDetailRef.current,
            el.getBoundingClientRect().top,
          ));
      if (!shouldPinBottom) {
        // User is browsing away from bottom — skip anchor adjustments to avoid jitter.
        return;
      }

      // Immediate pin to avoid visible "below-anchor" overflow during fast bursts.
      el.scrollTop = el.scrollHeight;
      stablePrevScrollHeightRef.current = el.scrollHeight;
      stableWasAtBottomRef.current = true;

      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        applyAnchor();
      });
    };

    const mutationObserver = new MutationObserver(scheduleAnchor);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // Frame-synced pin loop while streaming/sticky-follow is active.
    let pinRaf = 0;
    const pinLoop = () => {
      // KILOCODE FIX: Only pin if we are genuinely at the bottom or in sticky mode,
      // AND the user hasn't manually scrolled away.
      const isActuallyAtBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <=
        BOTTOM_OFFSET_THRESHOLD;

      const magnetActive = performance.now() < bottomMagnetUntilRef.current;
      const hadBottomOwnership =
        stickyFollowRef.current ||
        streamingPinnedRef.current ||
        isAtBottomRef.current ||
        stableWasAtBottomRef.current;
      const shouldPinBottom =
        (hadBottomOwnership ||
          (isStreaming && isActuallyAtBottom) ||
          magnetActive) &&
        !showScrollToBottom &&
        (!stableLastAnchorDetailRef.current ||
          shouldAdjustScrollForToolAnimation(
            stableLastAnchorDetailRef.current,
            el.getBoundingClientRect().top,
          ));

      if (shouldPinBottom) {
        // Use scrollTo with top: scrollHeight to let the browser handle the clamping
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        stablePrevScrollHeightRef.current = el.scrollHeight;
        stableWasAtBottomRef.current = true;
      } else if (isStreaming && !isActuallyAtBottom) {
        setStreamingPinned(false);
      }
      pinRaf = window.requestAnimationFrame(pinLoop);
    };
    pinRaf = window.requestAnimationFrame(pinLoop);

    return () => {
      mutationObserver.disconnect();
      if (pinRaf) window.cancelAnimationFrame(pinRaf);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [FORCE_STABLE_CHAT_LIST, isStreaming, showScrollToBottom]);

  const hasPendingSwitch = !!pendingSwitchTaskId;
  const showTaskShell = !!task || (hasPendingSwitch && isTaskSwitching);
  const showTaskTransitionLoader = hasPendingSwitch && isTaskSwitching;
  const isModalHistoryDropdownOpen =
    showHistoryDropdown && historyViewType !== "dropdown-top";

  return (
    <div
      data-testid="chat-view"
      className={
        isHidden
          ? "hidden"
          : `${layout === "embedded" ? "relative h-full min-h-0 min-w-0 w-full" : "fixed top-0 left-0 right-0 bottom-0"} flex flex-col overflow-hidden ${!showTaskShell ? "empty-state-active" : ""} ${isModalHistoryDropdownOpen ? "history-dropdown-open" : ""}`
      }
      onDragEnter={handleViewDragEnter}
      onDragLeave={handleViewDragLeave}
      onDragOver={handleViewDragOver}
      onDrop={handleViewDrop}
    >
      {/* kade_change start: Full-view drop overlay */}
      {isDraggingOverView && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-vscode-focusBorder bg-vscode-editor-background/80">
            <Upload className="w-10 h-10 text-vscode-focusBorder" />
            <div className="text-base font-medium text-vscode-foreground">
              Drop here
            </div>
            <div className="flex gap-4 text-xs text-vscode-descriptionForeground">
              <span className="flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> Images → attach
              </span>
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> Files → @mention
              </span>
            </div>
          </div>
        </div>
      )}
      {/* kade_change end: Full-view drop overlay */}
      {SCROLL_DEBUG && (
        <ChatScrollDebugger
          virtuosoRef={virtuosoRef}
          scrollContainerRef={scrollContainerRef}
          isAtBottom={isAtBottom}
          stickyFollow={stickyFollowRef.current}
          isStreaming={isStreaming}
          itemCount={renderRows.length}
          chatAreaHeight={chatAreaHeight}
        />
      )}
      {(showAnnouncement || showAnnouncementModal) && (
        <Announcement
          hideAnnouncement={() => {
            if (showAnnouncementModal) {
              setShowAnnouncementModal(false);
            }
            if (showAnnouncement) {
              hideAnnouncement();
            }
          }}
        />
      )}
      {showTaskShell ? (
        <>
          {showHistoryDropdown && historyViewType !== "dropdown-top" && (
            <HistoryDropdown onClose={() => setShowHistoryDropdown(false)} />
          )}
          {/* kade_change start */}
          {/* <TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						contextTokens={apiMetrics.contextTokens}
						buttonsDisabled={sendingDisabled}
						handleCondenseContext={handleCondenseContext}
						todos={latestTodos}
					/> */}
          {/* kade_change: KiloTaskHeader moved to ChatTextArea */}
          {/* kade_change start */}

          {checkpointWarning && (
            <div className="px-3">
              <CheckpointWarning warning={checkpointWarning} />
            </div>
          )}
        </>
      ) : (
        <div
          className={`flex-1 min-h-0 relative ${isModalHistoryDropdownOpen ? "history-dropdown-blur-target" : ""}`}
        >
          {showHistoryDropdown &&
            (historyViewType === "dropdown-top" ? (
              <HistoryDropdownTopView
                onClose={() => setShowHistoryDropdown(false)}
              />
            ) : (
              <HistoryDropdown onClose={() => setShowHistoryDropdown(false)} />
            ))}
          <EmptyState
            onSelectPrompt={(text) => {
              setInputValue(text);
              textAreaRef.current?.focus();
            }}
          />
          {!showTelemetryBanner && (
            <div
              className="absolute top-2 right-3 z-30"
              style={{ transform: "translateZ(80px)" }}
            >
              <OrganizationSelector />
            </div>
          )}
        </div>
      )}

      {showTaskTransitionLoader && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center pointer-events-none">
          <div style={{ marginTop: "-93px" }}>
            <div
              className="w-7 h-7 rounded-full animate-spin"
              style={{
                borderWidth: "2px",
                borderStyle: "solid",
                borderColor: "rgba(255, 255, 255, 0.22)",
                borderTopColor: "#ffffff",
              }}
            />
          </div>
        </div>
      )}

      {/*
			// Flex layout explanation:
			// 1. Content div above uses flex: "1 1 0" to:
			//    - Grow to fill available space (flex-grow: 1)
			//    - Shrink when AutoApproveMenu needs space (flex-shrink: 1)
			//    - Start from zero size (flex-basis: 0) to ensure proper distribution
			//    minHeight: 0 allows it to shrink below its content height
			//
			// 2. AutoApproveMenu uses flex: "0 1 auto" to:
			//    - Not grow beyond its content (flex-grow: 0)
			//    - Shrink when viewport is small (flex-shrink: 1)
			//    - Use its content size as basis (flex-basis: auto)
			//    This ensures it takes its natural height when there's space
			//    but becomes scrollable when the viewport is too small
			*/}

      {showTaskShell && !showTaskTransitionLoader && (
        <>
          <div
            className={`grow flex flex-col min-h-0 relative px-[1px] ${isScrollbarActive ? "scrollbar-visible" : ""} ${isModalHistoryDropdownOpen ? "history-dropdown-blur-target" : ""}`}
            style={chatShellStyle}
          >
            {showHistoryDropdown && historyViewType === "dropdown-top" && (
              <div className="absolute top-[6px] left-0 right-0 z-20 pointer-events-none">
                <div className="pointer-events-auto">
                  <HistoryDropdownTopView
                    onClose={() => setShowHistoryDropdown(false)}
                  />
                </div>
              </div>
            )}
            {/* Prestigious bottom fade gradient removed to fix phantom lines */}
            {FORCE_STABLE_CHAT_LIST ? (
              <div
                ref={(el) => {
                  stableListRef.current = el;
                  streamingScrollerRef(el);
                  scrollRootRef.current = el;
                  setScrollEl(el);
                }}
                className={`w-full h-full scrollable overflow-y-auto allow-select`}
                style={{
                  overflowAnchor: "none",
                  // GPU acceleration for smooth scrolling
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                  // Containment for performance
                  contain: "layout style",
                }}
                onScroll={(event) => {
                  handleScrollAreaInteraction();
                  const target = event.currentTarget;
                  const distanceFromBottom =
                    target.scrollHeight -
                    target.scrollTop -
                    target.clientHeight;
                  handleScrollerDistanceFromBottom(
                    distanceFromBottom,
                    target.scrollHeight,
                  );
                }}
              >
                <VirtualChatList
                  rowKeys={virtualRowKeys}
                  rowStreamingStates={virtualRowStreamingStates}
                  scrollEl={scrollEl}
                  isStreaming={isStreaming}
                  renderRow={renderRow}
                  footerHeight={footerSpacerHeight}
                />
              </div>
            ) : shouldUseMessageList ? (
              <VirtuosoMessageListLicense licenseKey={messageListLicenseKey}>
                <VirtuosoMessageList
                  key={messageListKey}
                  ref={messageListRef}
                  className={`w-full h-full will-change-transform scrollable virtuoso-smooth-items`}
                  data={messageListData}
                  initialLocation={{ index: "LAST", align: "end" }}
                  itemIdentity={(row) => row.id}
                  computeItemKey={({ data }) => data.id}
                  ItemContent={MessageListItem}
                  Footer={MessageListFooter}
                  ScrollElement={MessageListScrollElement}
                  increaseViewportBy={VIRTUOSO_VIEWPORT_OVERSCAN}
                  onScroll={(location) => {
                    handleScrollAreaInteraction();
                    handleScrollerDistanceFromBottom(
                      location.bottomOffset,
                      location.scrollHeight,
                    );
                  }}
                />
              </VirtuosoMessageListLicense>
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                scrollerRef={streamingScrollerRef}
                className={`w-full h-full will-change-transform scrollable virtuoso-smooth-items`}
                onScroll={(event) => {
                  handleScrollAreaInteraction();
                  const target = event.currentTarget as HTMLElement;
                  const distanceFromBottom =
                    target.scrollHeight -
                    target.scrollTop -
                    target.clientHeight;
                  handleScrollerDistanceFromBottom(
                    distanceFromBottom,
                    target.scrollHeight,
                  );
                }}
                data={renderRows}
                components={virtuosoComponents}
                itemContent={itemContent}
                computeItemKey={(_index, item) => item.id}
                increaseViewportBy={VIRTUOSO_VIEWPORT_OVERSCAN}
                atBottomStateChange={(atBottom) => {
                  if (
                    !atBottom &&
                    isStreaming &&
                    (stickyFollowRef.current || streamingPinnedRef.current) &&
                    !shouldAllowStreamingRelease()
                  ) {
                    return;
                  }

                  updateBottomState(atBottom);
                  // Only disengage the scroll pin when the user
                  // has genuinely scrolled away. During streaming,
                  // Virtuoso can transiently report atBottom=false
                  // when content grows faster than the rAF pin can
                  // keep up — disengaging here would cause the
                  // scroll to suddenly stop following.
                  if (!atBottom && !isStreaming) {
                    stickyFollowRef.current = false;
                    setStreamingPinned(false);
                    releaseBottomMagnet();
                  }
                }}
                atBottomThreshold={BOTTOM_OFFSET_THRESHOLD}
                followOutput={(isAtBottom) => {
                  const shouldFollow = shouldFollowStreamingOutput({
                    isStreaming,
                    isAtBottom,
                    streamingPinned: streamingPinnedRef.current,
                    hadBottomOwnership:
                      stickyFollowRef.current ||
                      streamingPinnedRef.current ||
                      isAtBottomRef.current ||
                      stableWasAtBottomRef.current,
                    showScrollToBottom: showScrollToBottomRef.current,
                  });
                  setStreamingPinned(shouldFollow);
                  if (shouldFollow) {
                    updateBottomState(true);
                    if (
                      isStreaming &&
                      !wasStreaming &&
                      !showScrollToBottomRef.current
                    ) {
                      return false;
                    }
                    return "auto";
                  }
                  return false;
                }}
              />
            )}
          </div>
        </>
      )}

      <div
        ref={chatAreaRef}
        className="absolute left-0 right-0 z-[100]"
        style={{ bottom: layout === "embedded" ? 0 : "-0.4%" }}
      >
        {showTaskShell && !showTaskTransitionLoader && (
          <>
            {areButtonsVisible && (
              <div
                className={`flex h-9 items-center mb-1 px-[15px] ${
                  showScrollToBottom
                    ? "opacity-0 pointer-events-none" // kade_change: hide scroll to bottom
                    : enableButtons || (isStreaming && !didClickCancel)
                      ? "opacity-100"
                      : "opacity-50"
                }`}
              >
                {showScrollToBottom ? (
                  <StandardTooltip content={t("chat:scrollToBottom")}>
                    <Button
                      className="flex-[2]"
                      onClick={() => {
                        // Engage sticky follow until user scrolls up
                        userWheelReleaseUntilRef.current = 0;
                        stickyFollowRef.current = true;
                        setStreamingPinned(true);
                        extendBottomMagnet();
                        // Pin immediately to avoid lag during fast streaming
                        manualScrollToBottom();
                        // Hide button immediately to prevent flash
                        updateBottomState(true);
                      }}
                    >
                      <span className="codicon codicon-chevron-down"></span>
                    </Button>
                  </StandardTooltip>
                ) : null}
              </div>
            )}
          </>
        )}

        <QueuedMessages
          queue={messageQueue}
          onRemove={(messageId) => {
            vscode.postMessage({
              type: "removeQueuedMessage",
              payload: { id: messageId },
            });
          }}
          onUpdate={(messageId, newText) => {
            const queuedMessage = messageQueue.find(({ id }) => id === messageId);
            if (!queuedMessage) {
              return;
            }

            vscode.postMessage({
              type: "editQueuedMessage",
              payload: {
                id: messageId,
                text: newText,
                images: queuedMessage.images,
              },
            });
          }}
          onSendNow={(messageId) => {
            vscode.postMessage({
              type: "sendQueuedMessageNow",
              payload: {
                id: messageId,
              },
            });
          }}
        />
        <EditHistoryTracker />
        <ChatTextArea
          ref={textAreaRef}
          inputValue={inputValue}
          setInputValue={setInputValue}
          sendingDisabled={sendingDisabled || isProfileDisabled}
          selectApiConfigDisabled={
            sendingDisabled && clineAsk !== "api_req_failed"
          }
          placeholderText={placeholderText}
          selectedImages={selectedImages}
          setSelectedImages={setSelectedImages}
          onSend={() => handleSendMessage(inputValue, selectedImages)}
          onSelectImages={selectImages}
          shouldDisableImages={shouldDisableImages}
          onHeightChange={() => {
            if (isAtBottomRef.current) {
              scrollToBottomAuto();
            }
          }}
          mode={mode}
          setMode={setMode}
          modeShortcutText={modeShortcutText}
          sendMessageOnEnter={sendMessageOnEnter} // kade_change
          showBrowserDockToggle={showBrowserDockToggle}
          // kade_change start: Props for KiloTaskHeader inside ChatTextArea
          task={task}
          tokensIn={apiMetrics.totalTokensIn}
          tokensOut={apiMetrics.totalTokensOut}
          cacheWrites={apiMetrics.totalCacheWrites}
          cacheReads={apiMetrics.totalCacheReads}
          totalCost={apiMetrics.totalCost}
          contextTokens={apiMetrics.contextTokens}
          contextWindow={model?.contextWindow}
          handleCondenseContext={handleCondenseContext}
          onCloseTask={handleTaskCloseButtonClick}
          groupedMessages={groupedMessages}
          onMessageClick={handleMessageClick}
          todos={latestTodos}
          isStreaming={isStreaming} // kade_change
          enableSubAgents={enableSubAgents}
          setEnableSubAgents={setEnableSubAgents}
          onStop={() => handleSecondaryButtonClick()} // kade_change
          // kade_change: pass button props
          primaryButtonText={primaryButtonText}
          secondaryButtonText={secondaryButtonText}
          enableButtons={enableButtons}
          primaryButtonVariant={
            clineAsk === "resume_task" ? "minimal" : "default"
          }
          onPrimaryButtonClick={(text, images) =>
            handlePrimaryButtonClick(text, images)
          }
          onSecondaryButtonClick={(text, images) =>
            handleSecondaryButtonClick(text, images)
          }
          // kade_change end
          // kade_change end
        />
      </div>
      {/* kade_change: added settings toggle the profile and model selection */}
      {/* <BottomControls showApiConfig /> */}
      {/* kade_change: end */}

      {/* kade_change: disable {isProfileDisabled && (
				<div className="px-3">
					<ProfileViolationWarning />
				</div>
			)} */}

      <div id="roo-portal" />
      {/* kade_change: disable  */}
      {/* <CloudUpsellDialog open={isUpsellOpen} onOpenChange={closeUpsell} onConnect={handleConnect} /> */}
    </div>
  );
};

const ChatView = forwardRef(ChatViewComponent);

export default ChatView;
