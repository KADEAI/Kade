import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import os from "os";
import crypto from "crypto";
import EventEmitter from "events";

import { AskIgnoredError } from "./AskIgnoredError";

import { Anthropic } from "@anthropic-ai/sdk";
import OpenAI from "openai";
import debounce from "lodash.debounce";
import delay from "delay";
import pWaitFor from "p-wait-for";
import { serializeError } from "serialize-error";
import { Package } from "../../shared/package";
import { formatToolInvocation } from "../tools/helpers/toolResultFormatting";

import {
  type TaskLike,
  type TaskMetadata,
  type TaskEvents,
  type ProviderSettings,
  type TokenUsage,
  type ToolUsage,
  type ToolName,
  type ContextCondense,
  type ContextTruncation,
  type ClineMessage,
  type ClineSay,
  type ClineAsk,
  type ToolProgressStatus,
  type HistoryItem,
  type CreateTaskOptions,
  type ModelInfo,
  RooCodeEventName,
  TelemetryEventName,
  TaskStatus,
  TodoItem,
  getApiProtocol,
  getModelId,
  isIdleAsk,
  isInteractiveAsk,
  isResumableAsk,
  isNativeProtocol,
  QueuedMessage,
  DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
  DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
  MAX_CHECKPOINT_TIMEOUT_SECONDS,
  MIN_CHECKPOINT_TIMEOUT_SECONDS,
  TOOL_PROTOCOL,
} from "@roo-code/types";
import { TelemetryService } from "@roo-code/telemetry";
import { CloudService, BridgeOrchestrator } from "@roo-code/cloud";
import {
  getApiRequestTimeout,
  getFirstChunkTimeout,
} from "../../api/providers/utils/timeout-config";
import { resolveToolProtocol } from "../../utils/resolveToolProtocol";

// api
import {
  ApiHandler,
  ApiHandlerCreateMessageMetadata,
  buildApiHandler,
} from "../../api";
import { ApiStream, GroundingSource } from "../../api/transform/stream";
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning";
import { VirtualQuotaFallbackHandler } from "../../api/providers/virtual-quota-fallback"; // kade_change: Import VirtualQuotaFallbackHandler for model change notifications

// shared
import { findLastIndex } from "../../shared/array";
import { combineApiRequests } from "../../shared/combineApiRequests";
import { combineCommandSequences } from "../../shared/combineCommandSequences";
import { t } from "../../i18n";
import {
  ClineApiReqCancelReason,
  ClineApiReqInfo,
  type ExtensionMessage,
  WAITING_FOR_USER_INPUT_TEXT,
} from "../../shared/ExtensionMessage";
import {
  getApiMetrics,
  hasTokenUsageChanged,
  hasToolUsageChanged,
} from "../../shared/getApiMetrics";
import { ClineAskResponse } from "../../shared/WebviewMessage";
import {
  defaultModeSlug,
  getModeBySlug,
  getGroupName,
} from "../../shared/modes";
import {
  DiffStrategy,
  type ToolUse,
  type ToolParamName,
  toolParamNames,
} from "../../shared/tools";
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments";
import { getModelMaxOutputTokens } from "../../shared/api";

// services
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher";
import { BrowserSession } from "../../services/browser/BrowserSession";
import { McpHub } from "../../services/mcp/McpHub";
import { McpServerManager } from "../../services/mcp/McpServerManager";
import { RepoPerTaskCheckpointService } from "../../services/checkpoints";

// integrations
import { DiffViewProvider } from "../../integrations/editor/DiffViewProvider";
import { findToolName } from "../../integrations/misc/export-markdown";
import { RooTerminalProcess } from "../../integrations/terminal/types";
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry";

// utils
import {
  calculateApiCostAnthropic,
  calculateApiCostOpenAI,
} from "../../shared/cost";
import { getWorkspacePath } from "../../utils/path";

// prompts
import { formatResponse } from "../prompts/responses";
import { SYSTEM_PROMPT } from "../prompts/system";
import { UNIFIED_TOOLS_PROMPT } from "../prompts/sections/unified-tools";
import { buildNativeToolsArray } from "./build-tools";

// core modules
import { ToolRepetitionDetector } from "../tools/ToolRepetitionDetector";
import { restoreTodoListForTask } from "../tools/UpdateTodoListTool";
import { FileContextTracker } from "../context-tracking/FileContextTracker";
import { RooIgnoreController } from "../ignore/RooIgnoreController";
import { RooProtectedController } from "../protect/RooProtectedController";
import {
  type AssistantMessageContent,
  presentAssistantMessage,
} from "../assistant-message";
import { AssistantMessageParser } from "../assistant-message/AssistantMessageParser";
import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser";
import { UnifiedToolCallParser } from "../assistant-message/UnifiedToolCallParser";
import { MarkdownToolCallParser } from "../assistant-message/MarkdownToolCallParser";
import { manageContext, willManageContext } from "../context-management";
import { ClineProvider } from "../webview/ClineProvider";
import { MultiSearchReplaceDiffStrategy } from "../diff/strategies/multi-search-replace";
import { MultiFileSearchReplaceDiffStrategy } from "../diff/strategies/multi-file-search-replace";
import {
  type ApiMessage,
  readApiMessages,
  saveApiMessages,
  readTaskMessages,
  saveTaskMessages,
  taskMetadata,
} from "../task-persistence";
import { getTaskDirectoryPath } from "../../utils/storage";
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails";
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling";
import {
  type CheckpointDiffOptions,
  type CheckpointRestoreOptions,
  getCheckpointService,
  checkpointSave,
  checkpointRestore,
  checkpointDiff,
} from "../checkpoints";
import { processKiloUserContentMentions } from "../mentions/processKiloUserContentMentions"; // kade_change
import { refreshWorkflowToggles } from "../context/instructions/workflows"; // kade_change
import { parseMentions } from "../mentions"; // kade_change
import { parseKiloSlashCommands } from "../slash-commands/kilo"; // kade_change
import { GlobalFileNames } from "../../shared/globalFileNames"; // kade_change
import { ensureLocalKilorulesDirExists } from "../context/instructions/kilo-rules"; // kade_change
import { processUserContentMentions } from "../mentions/processUserContentMentions";
import {
  getMessagesSinceLastSummary,
  summarizeConversation,
  getEffectiveApiHistory,
} from "../condense";
import { addLineNumbers } from "../../integrations/misc/extract-text";
import { MessageQueueService } from "../message-queue/MessageQueueService";

import {
  isAnyRecognizedKiloCodeError,
  isPaymentRequiredError,
} from "../../shared/kilocode/errorUtils";
import { getAppUrl } from "@roo-code/types";
import { mergeApiMessages, addOrMergeUserContent } from "./kilocode";
import { AutoApprovalHandler, checkAutoApproval } from "../auto-approval";
import { MessageManager } from "../message-manager";
import { validateAndFixToolResultIds } from "./validateToolResultIds";
import { AgentLoop } from "./AgentLoop";
import { LuxurySpa, LuxurySpaDelegate } from "./LuxurySpa";

const MAX_EXPONENTIAL_BACKOFF_SECONDS = 600; // 10 minutes
const DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000; // 5 seconds
const FORCED_CONTEXT_REDUCTION_PERCENT = 75; // Keep 75% of context (remove 25%) on context window errors
const MAX_CONTEXT_WINDOW_RETRIES = 3; // Maximum retries for context window errors

export interface TaskOptions extends CreateTaskOptions {
  context: vscode.ExtensionContext; // kade_change
  provider: ClineProvider;
  apiConfiguration: ProviderSettings;
  enableDiff?: boolean;
  enableCheckpoints?: boolean;
  checkpointTimeout?: number;
  enableBridge?: boolean;
  fuzzyMatchThreshold?: number;
  consecutiveMistakeLimit?: number;
  task?: string;
  images?: string[];
  historyItem?: HistoryItem;
  experiments?: Record<string, boolean>;
  startTask?: boolean;
  rootTask?: Task;
  parentTask?: Task;
  taskNumber?: number;
  onCreated?: (task: Task) => void;
  initialTodos?: TodoItem[];
  workspacePath?: string;
  /** Initial status for the task's history item (e.g., "active" for child tasks) */
  initialStatus?: "active" | "delegated" | "completed";
  enableSubAgents?: boolean;
  previousApiConversationHistory?: ApiMessage[]; // kade_change
  slidingWindowSize?: number; // kade_change
}

type UserContent = Array<Anthropic.ContentBlockParam>; // kade_change

export class Task
  extends EventEmitter<TaskEvents>
  implements TaskLike, LuxurySpaDelegate
{
  private context: vscode.ExtensionContext; // kade_change

  readonly taskId: string;
  private taskIsFavorited?: boolean; // kade_change
  readonly rootTaskId?: string;
  readonly parentTaskId?: string;
  childTaskId?: string;
  pendingNewTaskToolCallId?: string;

  // Luxury Spa Treatment handler
  public readonly luxurySpa: LuxurySpa;

  readonly instanceId: string;
  readonly metadata: TaskMetadata;

  todoList?: TodoItem[];
  lastEditBlocks?: any[]; // Temporary storage for last edit blocks

  readonly rootTask: Task | undefined;
  readonly parentTask: Task | undefined;
  readonly taskNumber: number;
  readonly workspacePath: string;

  /**
   * The mode associated with this task. Persisted across sessions
   * to maintain user context when reopening tasks from history.
   *
   * ## Lifecycle
   *
   * ### For new tasks:
   * 1. Initially `undefined` during construction
   * 2. Asynchronously initialized from provider state via `initializeTaskMode()`
   * 3. Falls back to `defaultModeSlug` if provider state is unavailable
   *
   * ### For history items:
   * 1. Immediately set from `historyItem.mode` during construction
   * 2. Falls back to `defaultModeSlug` if mode is not stored in history
   *
   * ## Important
   * This property should NOT be accessed directly until `taskModeReady` promise resolves.
   * Use `getTaskMode()` for async access or `taskMode` getter for sync access after initialization.
   *
   * @private
   * @see {@link getTaskMode} - For safe async access
   * @see {@link taskMode} - For sync access after initialization
   * @see {@link waitForModeInitialization} - To ensure initialization is complete
   */
  private _taskMode: string | undefined;

  /**
   * Promise that resolves when the task mode has been initialized.
   * This ensures async mode initialization completes before the task is used.
   *
   * ## Purpose
   * - Prevents race conditions when accessing task mode
   * - Ensures provider state is properly loaded before mode-dependent operations
   * - Provides a synchronization point for async initialization
   *
   * ## Resolution timing
   * - For history items: Resolves immediately (sync initialization)
   * - For new tasks: Resolves after provider state is fetched (async initialization)
   *
   * @private
   * @see {@link waitForModeInitialization} - Public method to await this promise
   */
  private taskModeReady: Promise<void>;

  public providerRef: WeakRef<ClineProvider>;
  private readonly globalStoragePath: string;
  abort: boolean = false;
  currentRequestAbortController?: AbortController;
  skipPrevResponseIdOnce: boolean = false;

  // TaskStatus
  idleAsk?: ClineMessage;
  resumableAsk?: ClineMessage;
  interactiveAsk?: ClineMessage;

  didFinishAbortingStream = false;
  abandoned = false;
  abortReason?: ClineApiReqCancelReason;
  isInitialized = false;
  isPaused: boolean = false;

  // API
  apiConfiguration: ProviderSettings;
  api: ApiHandler;
  private static lastGlobalApiRequestTime?: number;
  private autoApprovalHandler: AutoApprovalHandler;

  /**
   * Reset the global API request timestamp. This should only be used for testing.
   * @internal
   */
  static resetGlobalApiRequestTime(): void {
    Task.lastGlobalApiRequestTime = undefined;
  }

  toolRepetitionDetector: ToolRepetitionDetector;
  rooIgnoreController?: RooIgnoreController;
  rooProtectedController?: RooProtectedController;
  fileContextTracker: FileContextTracker;
  urlContentFetcher: UrlContentFetcher;
  terminalProcess?: RooTerminalProcess;

  // Computer User
  browserSession: BrowserSession;

  // Editing
  diffViewProvider: DiffViewProvider;
  diffStrategy?: DiffStrategy;
  diffEnabled: boolean = false;
  fuzzyMatchThreshold: number;
  didEditFile: boolean = false;

  // LLM Messages & Chat Messages
  apiConversationHistory: ApiMessage[] = [];
  clineMessages: ClineMessage[] = [];

  // Ask
  private askResponse?: ClineAskResponse;
  private askResponseText?: string;
  private askResponseImages?: string[];
  public lastMessageTs?: number;
  private _cachedSystemPrompt?: string;
  private _lastSystemPromptRefresh = 0;
  private readonly SYSTEM_PROMPT_CACHE_MS = 30_000; // Cache for 30 seconds
  private _processingAskTs?: number;
  private autoApprovalTimeoutRef?: NodeJS.Timeout;
  private queuedMessageTimeoutRef?: NodeJS.Timeout;

  // Tool Use
  consecutiveMistakeCount: number = 0;
  consecutiveMistakeLimit: number;
  consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map();
  toolUsage: ToolUsage = {};
  public slidingWindowSize?: number; // kade_change

  // Checkpoints
  enableCheckpoints: boolean;
  checkpointTimeout: number;
  checkpointService?: RepoPerTaskCheckpointService;
  checkpointServiceInitializing = false;

  // Task Bridge
  enableBridge: boolean;
  enableSubAgents: boolean;
  yoloMode: boolean;

  // Message Queue Service
  public readonly messageQueueService: MessageQueueService;
  private messageQueueStateChangedHandler: (() => void) | undefined;

  // Streaming
  isWaitingForFirstChunk = false;
  public isStreaming = false;
  public currentStreamingContentIndex = 0;
  public currentStreamingDidCheckpoint = false;
  public assistantMessageContent: AssistantMessageContent[] = [];
  public presentAssistantMessageLocked = false;
  public presentAssistantMessageHasPendingUpdates = false;
  public userMessageContent: (
    | Anthropic.TextBlockParam
    | Anthropic.ImageBlockParam
    | Anthropic.ToolResultBlockParam // kade_change
  )[] = [];
  public userMessageContentReady = false;
  public didRejectTool = false;
  public didAlreadyUseTool = false;
  public didToolFailInCurrentTurn = false;
  public didCompleteReadingStream = false;
  public assistantMessageParser?:
    | AssistantMessageParser
    | UnifiedToolCallParser
    | MarkdownToolCallParser;
  private providerProfileChangeListener?: (config: {
    name: string;
    provider?: string;
  }) => void;

  // Native tool call streaming state (track which index each tool is at)
  public streamingToolCallIndices: Map<string, number> = new Map();

  // Cached model info for current streaming session (set at start of each API request)
  // This prevents excessive getModel() calls during tool execution
  public cachedStreamingModel?: { id: string; info: ModelInfo };

  // Token Usage Cache
  private tokenUsageSnapshot?: TokenUsage;
  private tokenUsageSnapshotAt?: number;

  // Tool Usage Cache
  private toolUsageSnapshot?: ToolUsage;

  // Token Usage Throttling - Debounced emit function
  private readonly TOKEN_USAGE_EMIT_INTERVAL_MS = 500;
  private debouncedEmitTokenUsage: ReturnType<typeof debounce>;

  // kade_change: Cached task directory path to avoid repeated async lookups on every save
  private _cachedTaskDirPath?: string;

  // Cloud Sync Tracking
  private cloudSyncedMessageTimestamps: Set<number> = new Set();

  // Initial status for the task's history item (set at creation time to avoid race conditions)
  private readonly initialStatus?: "active" | "delegated" | "completed";

  // MessageManager for high-level message operations (lazy initialized)
  private _messageManager?: MessageManager;

  private didGenerateTitle = false;

  public latestEnvironmentDetails?: string; // kade_change
  public latestFileList?: string; // kade_change

  // kade_change: Debounced live titling to avoid updating task history on every single message
  private pendingLiveTitle?: string;
  private readonly debouncedLiveTitleUpdate = debounce(
    () => {
      const title = this.pendingLiveTitle;
      if (!title) return;
      const provider = this.providerRef.deref();
      if (!provider) return;
      const history = provider.getTaskHistory();
      const historyItem = history.find((h) => h.id === this.taskId);
      if (historyItem && historyItem.task !== title) {
        provider.updateTaskHistory({ ...historyItem, task: title });
      }
    },
    2000,
    { leading: false, trailing: true, maxWait: 2000 },
  );

  // PERF: Debounced save for partial messages during streaming.
  // Batches rapid disk writes into at most one every 500ms.
  private readonly debouncedSaveClineMessages = debounce(
    () => {
      this.saveClineMessages().catch((error) => {
        console.warn("Failed debounced save of cline messages:", error);
      });
    },
    500,
    { leading: false, trailing: true, maxWait: 1000 },
  );

  // PERF: Debounced taskMetadata computation during streaming.
  // taskMetadata is expensive (getSystemPrompt, disk I/O, token counting).
  // During streaming, defer to at most once every 3 seconds. Final call on trailing edge.
  private readonly debouncedTaskMetadataUpdate = debounce(
    () => {
      this.computeAndSaveTaskMetadata().catch((error) => {
        console.warn("Failed debounced task metadata update:", error);
      });
    },
    3000,
    { leading: false, trailing: true, maxWait: 5000 },
  );

  private async computeAndSaveTaskMetadata() {
    try {
      // kade_change: Cache system prompt to avoid UI jank from repeated heavy disk I/O
      const now = Date.now();
      if (
        !this._cachedSystemPrompt ||
        now - this._lastSystemPromptRefresh > this.SYSTEM_PROMPT_CACHE_MS
      ) {
        this._cachedSystemPrompt = await this.getSystemPrompt();
        this._lastSystemPromptRefresh = now;
      }
      const systemPrompt = this._cachedSystemPrompt ?? "";

      const { historyItem, tokenUsage } = await taskMetadata({
        taskId: this.taskId,
        rootTaskId: this.rootTaskId,
        parentTaskId: this.parentTaskId,
        taskNumber: this.taskNumber,
        messages: this.clineMessages,
        globalStoragePath: this.globalStoragePath,
        workspace: this.cwd,
        mode: this._taskMode || defaultModeSlug,
        initialStatus: this.initialStatus,
        fileEditCounts: this.luxurySpa.fileEditCounts,
        activeFileReads: Object.fromEntries(
          Array.from(this.luxurySpa.activeFileReads.entries()).map(([k, v]) => [
            k,
            v ?? null,
          ]),
        ),
        systemPrompt,
        apiConfiguration: this.apiConfiguration, // kade_change: Snapshot API config into history
      });

      this.debouncedEmitTokenUsage(tokenUsage, this.toolUsage);
      await this.providerRef.deref()?.updateTaskHistory(historyItem);
    } catch (error) {
      console.error("Failed to compute task metadata:", error);
    }
  }

  constructor(options: TaskOptions) {
    super();
    this.luxurySpa = new LuxurySpa(this);
    const {
      context,
      provider,
      apiConfiguration,
      enableDiff = false,
      enableCheckpoints = false,
      checkpointTimeout = DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
      enableBridge = false,
      fuzzyMatchThreshold = 1.0,
      consecutiveMistakeLimit = DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
      task,
      images,
      historyItem,
      experiments: experimentsConfig,
      startTask = true,
      rootTask,
      parentTask,
      taskNumber = -1,
      onCreated,
      initialTodos,
      workspacePath,
      initialStatus,
    } = options;
    this.context = context; // kade_change

    if (startTask && !task && !images && !historyItem) {
      throw new Error("Either historyItem or task/images must be provided");
    }

    if (
      !checkpointTimeout ||
      checkpointTimeout > MAX_CHECKPOINT_TIMEOUT_SECONDS ||
      checkpointTimeout < MIN_CHECKPOINT_TIMEOUT_SECONDS
    ) {
      throw new Error(
        "checkpointTimeout must be between " +
          MIN_CHECKPOINT_TIMEOUT_SECONDS +
          " and " +
          MAX_CHECKPOINT_TIMEOUT_SECONDS +
          " seconds",
      );
    }

    this.taskId = historyItem ? historyItem.id : crypto.randomUUID();
    this.taskIsFavorited = historyItem?.isFavorited; // kade_change
    this.rootTaskId = historyItem ? historyItem.rootTaskId : rootTask?.taskId;
    this.parentTaskId = historyItem
      ? historyItem.parentTaskId
      : parentTask?.taskId;
    this.childTaskId = undefined;

    this.metadata = {
      task: historyItem ? historyItem.task : task,
      images: historyItem ? [] : images,
    };

    // Normal use-case is usually retry similar history task with new workspace.
    this.workspacePath = parentTask
      ? parentTask.workspacePath
      : (workspacePath ??
        getWorkspacePath(path.join(os.homedir(), "Documents"))); // kade_change: use Documents instead of Desktop as default

    this.instanceId = crypto.randomUUID().slice(0, 8);
    this.taskNumber = -1;
    this.enableSubAgents =
      options.enableSubAgents ?? process.env.KILO_ENABLE_SUB_AGENTS === "true";

    this.rooIgnoreController = new RooIgnoreController(this.cwd);
    this.rooProtectedController = new RooProtectedController(this.cwd);
    this.fileContextTracker = new FileContextTracker(provider, this.taskId);

    this.rooIgnoreController.initialize().catch((error) => {
      console.error("Failed to initialize RooIgnoreController:", error);
    });

    this.apiConfiguration = apiConfiguration;
    this.slidingWindowSize = options.slidingWindowSize ?? 50; // kade_change: Init slidingWindowSize

    // Optimize: Use cached API handler when possible
    const configKey = JSON.stringify(apiConfiguration);
    const cachedHandler = Task.apiHandlerCache.get(configKey);
    if (cachedHandler) {
      this.api = cachedHandler;
      // Move to end to maintain LRU order (Map iterates in insertion order)
      Task.apiHandlerCache.delete(configKey);
      Task.apiHandlerCache.set(configKey, cachedHandler);
    } else {
      this.api = buildApiHandler(apiConfiguration);
      // Limit cache size to prevent memory leaks
      if (Task.apiHandlerCache.size >= 10) {
        const firstKey = Task.apiHandlerCache.keys().next().value;
        if (firstKey) {
          Task.apiHandlerCache.delete(firstKey);
        }
      }
      Task.apiHandlerCache.set(configKey, this.api);
    }
    // kade_change start: Listen for model changes in virtual quota fallback
    if (this.api instanceof VirtualQuotaFallbackHandler) {
      this.api.on("handlerChanged", () => {
        this.emit("modelChanged");
      });
    }
    // kade_change end
    this.autoApprovalHandler = new AutoApprovalHandler();

    this.urlContentFetcher = new UrlContentFetcher(provider.context);
    this.browserSession = new BrowserSession(
      provider.context,
      (isActive: boolean) => {
        // Add a message to indicate browser session status change
        this.say(
          "browser_session_status",
          isActive ? "Browser session opened" : "Browser session closed",
        );
        // Broadcast to browser panel
        this.broadcastBrowserSessionUpdate();

        // When a browser session becomes active, automatically open/reveal the Browser Session tab
        if (isActive) {
          try {
            // Lazy-load to avoid circular imports at module load time
            const {
              BrowserSessionPanelManager,
            } = require("../webview/BrowserSessionPanelManager");
            const providerRef = this.providerRef.deref();
            if (providerRef) {
              BrowserSessionPanelManager.getInstance(providerRef)
                .show()
                .catch(() => {});
            }
          } catch (err) {
            console.error(
              "[Task] Failed to auto-open Browser Session panel:",
              err,
            );
          }
        }
      },
      (screenshot: string) => {
        this.broadcastLiveScreenshot(screenshot);
      },
    );
    this.diffEnabled = enableDiff;
    this.fuzzyMatchThreshold = fuzzyMatchThreshold;
    this.consecutiveMistakeLimit =
      consecutiveMistakeLimit ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT;
    this.providerRef = new WeakRef(provider);
    // kade_change start: Handle CLI mode where globalStorageUri might not be properly set
    this.globalStoragePath =
      provider.context?.globalStorageUri?.fsPath ??
      this.getCliGlobalStoragePath();
    // kade_change end
    this.diffViewProvider = new DiffViewProvider(this.cwd, this);
    this.enableCheckpoints = enableCheckpoints;
    this.checkpointTimeout = checkpointTimeout;
    this.enableBridge = enableBridge;
    this.enableSubAgents = experimentsConfig?.enableSubAgents ?? false; // kade_change: check experiment first
    if (options.enableSubAgents !== undefined) {
      this.enableSubAgents = options.enableSubAgents;
    }
    this.yoloMode = options.yoloMode ?? false;

    this.parentTask = parentTask;
    this.taskNumber = taskNumber;
    this.initialStatus = initialStatus;

    // kade_change start: Initialize with previous conversation history if provided
    if (options.previousApiConversationHistory) {
      this.apiConversationHistory = [...options.previousApiConversationHistory];
    }
    // kade_change end

    // Store the task's mode when it's created.
    // For history items, use the stored mode; for new tasks, we'll set it
    // after getting state.
    if (historyItem) {
      this._taskMode = historyItem.mode || defaultModeSlug;
      this.taskModeReady = Promise.resolve();
      if ((historyItem as any).fileEditCounts) {
        this.luxurySpa.fileEditCounts = new Map(
          Object.entries((historyItem as any).fileEditCounts).map(
            ([key, value]) => [
              process.platform === "win32" ? key.toLowerCase() : key,
              value as number,
            ],
          ),
        );
      }
      if ((historyItem as any).activeFileReads) {
        // Support both new format (object with lineRanges) and legacy format (string array)
        const saved = (historyItem as any).activeFileReads;
        if (Array.isArray(saved)) {
          // Legacy format: string[]
          this.luxurySpa.activeFileReads = new Map(
            saved.map((f: string) => [f, undefined]),
          );
        } else if (typeof saved === "object") {
          // New format: Record<string, LineRange[] | null>
          // JSON converts undefined to null, so we handle it by mapping null back to undefined (full read)
          this.luxurySpa.activeFileReads = new Map(
            Object.entries(saved).map(([key, value]) => [
              key,
              value === null ? undefined : (value as any),
            ]),
          );
        }
      }
      TelemetryService.instance.captureTaskRestarted(this.taskId);
    } else {
      // For new tasks, don't set the mode yet - wait for async initialization.
      this._taskMode = undefined;
      this.taskModeReady = this.initializeTaskMode(provider);
      TelemetryService.instance.captureTaskCreated(this.taskId);
    }

    // Initialize the assistant message parser only for XML protocol.
    // For native protocol, tool calls come as tool_call chunks, not XML.
    // experiments is always provided via TaskOptions (defaults to experimentDefault in provider)
    const modelInfo = this.api.getModel().info;
    const toolProtocol = resolveToolProtocol(this.apiConfiguration, modelInfo);

    if (toolProtocol === "unified") {
      const unifiedParser = new UnifiedToolCallParser();
      this.populateMcpToolNames(unifiedParser, provider);
      this.assistantMessageParser = unifiedParser;
    } else if (toolProtocol === "markdown") {
      const markdownParser = new MarkdownToolCallParser();
      this.populateMcpToolNames(markdownParser, provider);
      this.assistantMessageParser = markdownParser;
    } else if (toolProtocol === "xml") {
      this.assistantMessageParser = new AssistantMessageParser();
    } else {
      this.assistantMessageParser = undefined;
    }

    this.messageQueueService = new MessageQueueService();

    this.messageQueueStateChangedHandler = () => {
      this.emit(RooCodeEventName.TaskUserMessage, this.taskId);
      this.providerRef.deref()?.debouncedPostStateToWebview();
      this.emit("modelChanged"); // kade_change: Emit modelChanged for virtual quota fallback UI updates
    };

    this.messageQueueService.on(
      "stateChanged",
      this.messageQueueStateChangedHandler,
    );

    // Listen for provider profile changes to update parser state
    this.setupProviderProfileChangeListener(provider);

    // Only set up diff strategy if diff is enabled.
    if (this.diffEnabled) {
      // Default to old strategy, will be updated if experiment is enabled.
      this.diffStrategy = new MultiSearchReplaceDiffStrategy(
        this.fuzzyMatchThreshold,
      );

      // Check experiment asynchronously and update strategy if needed.
      provider.getState().then((state) => {
        const isMultiFileApplyDiffEnabled = experiments.isEnabled(
          state.experiments ?? {},
          EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF,
        );

        if (isMultiFileApplyDiffEnabled) {
          this.diffStrategy = new MultiFileSearchReplaceDiffStrategy(
            this.fuzzyMatchThreshold,
          );
        }
      });
    }

    this.toolRepetitionDetector = new ToolRepetitionDetector(
      this.consecutiveMistakeLimit,
    );

    // Initialize todo list if provided
    if (initialTodos && initialTodos.length > 0) {
      this.todoList = initialTodos;
    }

    // Initialize debounced token usage emit function
    // Uses debounce with maxWait to achieve throttle-like behavior:
    // - leading: true  - Emit immediately on first call
    // - trailing: true - Emit final state when updates stop
    // - maxWait        - Ensures at most one emit per interval during rapid updates (throttle behavior)
    this.debouncedEmitTokenUsage = debounce(
      (tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
        const tokenChanged = hasTokenUsageChanged(
          tokenUsage,
          this.tokenUsageSnapshot,
        );
        const toolChanged = hasToolUsageChanged(
          toolUsage,
          this.toolUsageSnapshot,
        );

        if (tokenChanged || toolChanged) {
          this.emit(
            RooCodeEventName.TaskTokenUsageUpdated,
            this.taskId,
            tokenUsage,
            toolUsage,
          );
          this.tokenUsageSnapshot = tokenUsage;
          this.tokenUsageSnapshotAt = this.clineMessages.at(-1)?.ts;
          // kade_change: Shallow clone instead of JSON.parse(JSON.stringify()) for better perf
          // ToolUsage is Record<ToolName, {attempts, ...}> — one level deep
          this.toolUsageSnapshot = Object.fromEntries(
            Object.entries(toolUsage).map(([k, v]) => [k, { ...v }]),
          ) as ToolUsage;
        }
      },
      this.TOKEN_USAGE_EMIT_INTERVAL_MS,
      {
        leading: true,
        trailing: true,
        maxWait: this.TOKEN_USAGE_EMIT_INTERVAL_MS,
      },
    );

    onCreated?.(this);

    if (startTask) {
      if (task || images) {
        this.startTask(task, images);
      } else if (historyItem) {
        this.resumeTaskFromHistory();
      } else {
        throw new Error("Either historyItem or task/images must be provided");
      }
    }
  }

  // kade_change start
  private getContext(): vscode.ExtensionContext {
    const context = this.context;
    if (!context) {
      throw new Error("Unable to access extension context");
    }
    return context;
  }

  /**
   * Get global storage path for CLI mode when vscode context is not available.
   * Uses KiloCodePaths utility if available, otherwise falls back to home directory.
   */
  private getCliGlobalStoragePath(): string {
    // Try to use home directory based path for CLI mode
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
    const cliStoragePath = path.join(homeDir, ".kilocode", "cli", "global");

    // Ensure directory exists
    try {
      if (!fs.existsSync(cliStoragePath)) {
        fs.mkdirSync(cliStoragePath, { recursive: true });
      }
    } catch (error) {
      console.error(
        `[Task] Failed to create CLI storage path ${cliStoragePath}:`,
        error,
      );
    }

    return cliStoragePath;
  }
  // kade_change end
  /**
   * Initialize the task mode from the provider state.
   * This method handles async initialization with proper error handling.
   *
   * ## Flow
   * 1. Attempts to fetch the current mode from provider state
   * 2. Sets `_taskMode` to the fetched mode or `defaultModeSlug` if unavailable
   * 3. Handles errors gracefully by falling back to default mode
   * 4. Logs any initialization errors for debugging
   *
   * ## Error handling
   * - Network failures when fetching provider state
   * - Provider not yet initialized
   * - Invalid state structure
   *
   * All errors result in fallback to `defaultModeSlug` to ensure task can proceed.
   *
   * @private
   * @param provider - The ClineProvider instance to fetch state from
   * @returns Promise that resolves when initialization is complete
   */
  private async initializeTaskMode(provider: ClineProvider): Promise<void> {
    try {
      const state = await provider.getState();
      this._taskMode = state?.mode || defaultModeSlug;
    } catch (error) {
      // If there's an error getting state, use the default mode
      this._taskMode = defaultModeSlug;
      // Use the provider's log method for better error visibility
      const errorMessage = `Failed to initialize task mode: ${error instanceof Error ? error.message : String(error)}`;
      provider.log(errorMessage);
    }
  }

  /**
   * Populate MCP tool names on a UnifiedToolCallParser or MarkdownToolCallParser so it can recognize MCP tool calls.
   * Extracts tool names from all connected MCP servers in the format "serverName_toolName".
   */
  private populateMcpToolNames(
    parser: UnifiedToolCallParser | MarkdownToolCallParser,
    provider: ClineProvider,
  ): void {
    try {
      const mcpHub = provider.getMcpHub();
      if (!mcpHub) return;

      const servers = mcpHub.getServers();
      const mcpTools: Array<{
        compositeName: string;
        serverName: string;
        toolName: string;
      }> = [];

      for (const server of servers) {
        if (!server.tools) continue;
        for (const tool of server.tools) {
          if (tool.enabledForPrompt === false) continue;
          mcpTools.push({
            compositeName: `${server.name}_${tool.name}`,
            serverName: server.name,
            toolName: tool.name,
          });
        }
      }

      if (mcpTools.length > 0) {
        parser.setMcpToolNames(mcpTools);
      }
    } catch (error) {
      console.error(`[Task] Failed to populate MCP tool names:`, error);
    }
  }

  /**
   * Sets up a listener for provider profile changes to automatically update the parser state.
   * This ensures the XML/native protocol parser stays synchronized with the current model.
   *
   * @private
   * @param provider - The ClineProvider instance to listen to
   */
  private setupProviderProfileChangeListener(provider: ClineProvider): void {
    // Only set up listener if provider has the on method (may not exist in test mocks)
    if (typeof provider.on !== "function") {
      return;
    }

    this.providerProfileChangeListener = async () => {
      try {
        const newState = await provider.getState();
        if (newState?.apiConfiguration) {
          this.updateApiConfiguration(newState.apiConfiguration);
        }
      } catch (error) {
        console.error(
          `[Task#${this.taskId}.${this.instanceId}] Failed to update API configuration on profile change:`,
          error,
        );
      }
    };

    provider.on(
      RooCodeEventName.ProviderProfileChanged,
      this.providerProfileChangeListener,
    );
  }

  /**
   * Wait for the task mode to be initialized before proceeding.
   * This method ensures that any operations depending on the task mode
   * will have access to the correct mode value.
   *
   * ## When to use
   * - Before accessing mode-specific configurations
   * - When switching between tasks with different modes
   * - Before operations that depend on mode-based permissions
   *
   * ## Example usage
   * ```typescript
   * // Wait for mode initialization before mode-dependent operations
   * await task.waitForModeInitialization();
   * const mode = task.taskMode; // Now safe to access synchronously
   *
   * // Or use with getTaskMode() for a one-liner
   * const mode = await task.getTaskMode(); // Internally waits for initialization
   * ```
   *
   * @returns Promise that resolves when the task mode is initialized
   * @public
   */
  public async waitForModeInitialization(): Promise<void> {
    return this.taskModeReady;
  }

  /**
   * Get the task mode asynchronously, ensuring it's properly initialized.
   * This is the recommended way to access the task mode as it guarantees
   * the mode is available before returning.
   *
   * ## Async behavior
   * - Internally waits for `taskModeReady` promise to resolve
   * - Returns the initialized mode or `defaultModeSlug` as fallback
   * - Safe to call multiple times - subsequent calls return immediately if already initialized
   *
   * ## Example usage
   * ```typescript
   * // Safe async access
   * const mode = await task.getTaskMode();
   * console.log(`Task is running in ${mode} mode`);
   *
   * // Use in conditional logic
   * if (await task.getTaskMode() === 'architect') {
   *   // Perform architect-specific operations
   * }
   * ```
   *
   * @returns Promise resolving to the task mode string
   * @public
   */
  public async getTaskMode(): Promise<string> {
    await this.taskModeReady;
    return this._taskMode || defaultModeSlug;
  }

  /**
   * Get the task mode synchronously. This should only be used when you're certain
   * that the mode has already been initialized (e.g., after waitForModeInitialization).
   *
   * ## When to use
   * - In synchronous contexts where async/await is not available
   * - After explicitly waiting for initialization via `waitForModeInitialization()`
   * - In event handlers or callbacks where mode is guaranteed to be initialized
   *
   * ## Example usage
   * ```typescript
   * // After ensuring initialization
   * await task.waitForModeInitialization();
   * const mode = task.taskMode; // Safe synchronous access
   *
   * // In an event handler after task is started
   * task.on('taskStarted', () => {
   *   console.log(`Task started in ${task.taskMode} mode`); // Safe here
   * });
   * ```
   *
   * @throws {Error} If the mode hasn't been initialized yet
   * @returns The task mode string
   * @public
   */
  public get taskMode(): string {
    if (this._taskMode === undefined) {
      throw new Error(
        "Task mode accessed before initialization. Use getTaskMode() or wait for taskModeReady.",
      );
    }

    return this._taskMode;
  }

  static create(options: TaskOptions): [Task, Promise<void>] {
    const instance = new Task({ ...options, startTask: false });
    const { images, task, historyItem } = options;
    let promise;

    if (images || task) {
      promise = instance.startTask(task, images);
    } else if (historyItem) {
      promise = instance.resumeTaskFromHistory();
    } else {
      throw new Error("Either historyItem or task/images must be provided");
    }

    return [instance, promise];
  }

  // API Messages

  private async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
    return readApiMessages({
      taskId: this.taskId,
      globalStoragePath: this.globalStoragePath,
    });
  }

  public async addToApiConversationHistory(
    message: Anthropic.MessageParam,
    reasoning?: string,
  ) {
    // Capture the encrypted_content / thought signatures from the provider (e.g., OpenAI Responses API, Google GenAI) if present.
    // We only persist data reported by the current response body.
    const handler = this.api as ApiHandler & {
      getResponseId?: () => string | undefined;
      getEncryptedContent?: () =>
        | { encrypted_content: string; id?: string }
        | undefined;
      getThoughtSignature?: () => string | undefined;
      getSummary?: () => Record<string, unknown>[] | undefined;
      getReasoningDetails?: () => Record<string, unknown>[] | undefined;
    };

    if (message.role === "assistant") {
      const responseId = handler.getResponseId?.();
      const reasoningData = handler.getEncryptedContent?.();
      const thoughtSignature = handler.getThoughtSignature?.();
      const reasoningSummary = handler.getSummary?.();
      const reasoningDetails = handler.getReasoningDetails?.();

      // kade_change start: prevent consecutive same-role messages, this happens when returning from subtask
      const lastMessage = this.apiConversationHistory.at(-1);
      if (lastMessage && lastMessage.role === message.role) {
        this.apiConversationHistory[this.apiConversationHistory.length - 1] =
          mergeApiMessages(lastMessage, message);
        await this.saveApiConversationHistory();
        return;
      }
      // kade_change end

      // Start from the original assistant message
      const messageWithTs: any = {
        ...message,
        ...(responseId ? { id: responseId } : {}),
        ts: Date.now(),
      };

      // Store reasoning_details array if present (for models like Gemini 3)
      if (reasoningDetails) {
        messageWithTs.reasoning_details = reasoningDetails;
      }

      // Store reasoning: plain text (most providers) or encrypted (OpenAI Native)
      // Skip if reasoning_details already contains the reasoning (to avoid duplication)
      if (reasoning && !reasoningDetails) {
        const reasoningBlock = {
          type: "reasoning",
          text: reasoning,
          summary: reasoningSummary ?? ([] as Record<string, unknown>[]),
        };

        if (typeof messageWithTs.content === "string") {
          messageWithTs.content = [
            reasoningBlock,
            {
              type: "text",
              text: messageWithTs.content,
            } satisfies Anthropic.Messages.TextBlockParam,
          ];
        } else if (Array.isArray(messageWithTs.content)) {
          messageWithTs.content = [reasoningBlock, ...messageWithTs.content];
        } else if (!messageWithTs.content) {
          messageWithTs.content = [reasoningBlock];
        }
      } else if (reasoningData?.encrypted_content) {
        // OpenAI Native encrypted reasoning
        const reasoningBlock = {
          type: "reasoning",
          summary: [] as Record<string, unknown>[],
          encrypted_content: reasoningData.encrypted_content,
          ...(reasoningData.id ? { id: reasoningData.id } : {}),
        };

        if (typeof messageWithTs.content === "string") {
          messageWithTs.content = [
            reasoningBlock,
            {
              type: "text",
              text: messageWithTs.content,
            } satisfies Anthropic.Messages.TextBlockParam,
          ];
        } else if (Array.isArray(messageWithTs.content)) {
          messageWithTs.content = [reasoningBlock, ...messageWithTs.content];
        } else if (!messageWithTs.content) {
          messageWithTs.content = [reasoningBlock];
        }
      }

      // If we have a thought signature, append it as a dedicated content block
      // so it can be round-tripped in api_history.json and re-sent on subsequent calls.
      if (thoughtSignature) {
        const thoughtSignatureBlock = {
          type: "thoughtSignature",
          thoughtSignature,
        };

        if (typeof messageWithTs.content === "string") {
          messageWithTs.content = [
            {
              type: "text",
              text: messageWithTs.content,
            } satisfies Anthropic.Messages.TextBlockParam,
            thoughtSignatureBlock,
          ];
        } else if (Array.isArray(messageWithTs.content)) {
          messageWithTs.content = [
            ...messageWithTs.content,
            thoughtSignatureBlock,
          ];
        } else if (!messageWithTs.content) {
          messageWithTs.content = [thoughtSignatureBlock];
        }
      }

      this.apiConversationHistory.push(messageWithTs);
    } else {
      // kade_change: Luxury Spa Treatment - Prune bulky history to keep context clean
      this.pruneEnvironmentDetailsFromHistory();
      this.pruneTerminalOutputFromHistory();

      // For user messages, validate and fix tool_result IDs against the previous assistant message
      const validatedMessage = validateAndFixToolResultIds(
        message,
        this.apiConversationHistory,
      );
      const messageWithTs = { ...validatedMessage, ts: Date.now() };
      this.apiConversationHistory.push(messageWithTs);
    }

    await this.saveApiConversationHistory();

    // Attempt to generate or update the title
    if (this.apiConversationHistory.length >= 2) {
      this.generateSessionTitle().catch((error) => {
        console.error("[Task] Failed to generate session title:", error);
      });
    }
  }

  private async generateSessionTitle() {
    this.didGenerateTitle = true;
    const provider = this.providerRef.deref();
    if (!provider) return;

    // Use the first message as the title (no AI generation)
    const firstMessage = this.clineMessages.find((m) => m.text);
    let title = firstMessage?.text || "New Session";

    if (title.length > 80) {
      title = title.substring(0, 77) + "...";
    }

    // Update history item with the new title
    const freshHistory = provider.getTaskHistory();
    const freshItem = freshHistory.find((h) => h.id === this.taskId);

    if (freshItem) {
      await provider.updateTaskHistory({ ...freshItem, title });
    }
  }

  async overwriteApiConversationHistory(newHistory: ApiMessage[]) {
    this.apiConversationHistory = newHistory;
    await this.saveApiConversationHistory();
  }

  /**
   * Flush any pending tool results to the API conversation history.
   *
   * This is critical for native tool protocol when the task is about to be
   * delegated (e.g., via new_task). Before delegation, if other tools were
   * called in the same turn before new_task, their tool_result blocks are
   * accumulated in `userMessageContent` but haven't been saved to the API
   * history yet. If we don't flush them before the parent is disposed,
   * the API conversation will be incomplete and cause 400 errors when
   * the parent resumes (missing tool_result for tool_use blocks).
   *
   * NOTE: The assistant message is typically already in history by the time
   * tools execute (added in recursivelyMakeClineRequests after streaming completes).
   * So we usually only need to flush the pending user message with tool_results.
   */
  public async flushPendingToolResultsToHistory(): Promise<void> {
    // Only flush if there's actually pending content to save
    if (this.userMessageContent.length === 0) {
      return;
    }

    // Save the user message with tool_result blocks
    const userMessage: Anthropic.MessageParam = {
      role: "user",
      content: this.userMessageContent,
    };

    // Validate and fix tool_result IDs against the previous assistant message
    const validatedMessage = validateAndFixToolResultIds(
      userMessage,
      this.apiConversationHistory,
    );
    const userMessageWithTs = { ...validatedMessage, ts: Date.now() };
    this.apiConversationHistory.push(userMessageWithTs as ApiMessage);

    await this.saveApiConversationHistory();

    // Clear the pending content since it's now saved
    this.userMessageContent = [];
  }

  public async saveApiConversationHistory() {
    try {
      await saveApiMessages({
        messages: this.apiConversationHistory,
        taskId: this.taskId,
        globalStoragePath: this.globalStoragePath,
      });

      // kade_change start
      // Post directly to webview for CLI to react to file save.
      // This must not prevent saving history or emitting usage events if
      // storage is unavailable (e.g., during unit tests).
      try {
        if (!this._cachedTaskDirPath) {
          this._cachedTaskDirPath = await getTaskDirectoryPath(
            this.globalStoragePath,
            this.taskId,
          );
        }
        const filePath = path.join(
          this._cachedTaskDirPath,
          GlobalFileNames.apiConversationHistory,
        );
        const provider = this.providerRef.deref();
        if (provider) {
          await provider.postMessageToWebview({
            type: "apiMessagesSaved",
            payload: [this.taskId, filePath],
          });
        }
      } catch (error) {
        console.warn(
          "Failed to notify webview about saved API messages:",
          error,
        );
      }
      // kade_change end
    } catch (error) {
      // In the off chance this fails, we don't want to stop the task.
      console.error("Failed to save API conversation history:", error);
    }
  }

  // Cline Messages

  private async getSavedClineMessages(): Promise<ClineMessage[]> {
    return readTaskMessages({
      taskId: this.taskId,
      globalStoragePath: this.globalStoragePath,
    });
  }

  private async addToClineMessages(message: ClineMessage) {
    this.clineMessages.push(message);
    const provider = this.providerRef.deref();

    // kade_change: Live Assistant Heartbeat Titling (debounced to avoid per-message overhead)
    // PERF: Only process title for user-visible text messages, skip tool JSON, reasoning, api_req, etc.
    if (message.type === "say" && message.text && message.say === "text") {
      const text = message.text;
      // Fast pre-check: skip if text looks like JSON or XML (tool output)
      if (
        text.length > 5 &&
        text[0] !== "{" &&
        text[0] !== "<" &&
        text[0] !== "["
      ) {
        let clean = text
          .replace(/```[\s\S]*?```/g, "")
          .replace(/<tool_code>[\s\S]*?<\/tool_code>/g, "")
          .replace(/[*_`~]/g, "")
          .replace(/\s+/g, " ")
          .trim();

        if (clean.length > 5) {
          this.pendingLiveTitle =
            clean.substring(0, 40) + (clean.length > 40 ? "..." : "");
          this.debouncedLiveTitleUpdate();
        }
      }
    }

    // Debounce state updates to avoid performance issues from rapid message creation.
    provider?.debouncedPostStateToWebview();
    this.emit(RooCodeEventName.Message, { action: "created", message });

    // PERF: Skip the expensive saveClineMessages() for partial messages during streaming.
    // Partial messages are transient — they'll be overwritten milliseconds later.
    // The save will happen when the message is finalized (partial=false) or at stream end.
    if (message.partial !== true) {
      await this.saveClineMessages();
    } else {
      // For partial messages, use debounced save to batch disk writes
      this.debouncedSaveClineMessages();
    }

    // kade_change start: no cloud service
    // const shouldCaptureMessage = message.partial !== true && CloudService.isEnabled()

    // if (shouldCaptureMessage) {
    // 	CloudService.instance.captureEvent({
    // 		event: TelemetryEventName.TASK_MESSAGE,
    // 		properties: { taskId: this.taskId, message },
    // 	})
    // }
    // kade_change end
  }

  public async overwriteClineMessages(newMessages: ClineMessage[]) {
    this.clineMessages = newMessages;
    restoreTodoListForTask(this);
    await this.saveClineMessages();

    // When overwriting messages (e.g., during task resume), repopulate the cloud sync tracking Set
    // with timestamps from all non-partial messages to prevent re-syncing previously synced messages
    this.cloudSyncedMessageTimestamps.clear();
    for (const msg of newMessages) {
      if (msg.partial !== true) {
        this.cloudSyncedMessageTimestamps.add(msg.ts);
      }
    }
  }

  async updateClineMessage(message: ClineMessage) {
    const provider = this.providerRef.deref();
    // PERF: Skip webview post for partial message updates when webview is not visible.
    // Background tasks generate hundreds of partial updates per second — all wasted if not visible.
    const view = (provider as any)?.view;
    const isVisible = !view || view.visible !== false;
    if (isVisible) {
      await provider?.postMessageToWebview({
        type: "messageUpdated",
        clineMessage: message,
        taskId: this.taskId,
      });
    }
    this.emit(RooCodeEventName.Message, { action: "updated", message });

    // Check if we should sync to cloud and haven't already synced this message
    const shouldCaptureMessage =
      message.partial !== true && CloudService.isEnabled();
    const hasNotBeenSynced = !this.cloudSyncedMessageTimestamps.has(message.ts);

    // kade_change start: no cloud service
    // if (shouldCaptureMessage && hasNotBeenSynced) {
    // 	CloudService.instance.captureEvent({
    // 		event: TelemetryEventName.TASK_MESSAGE,
    // 		properties: { taskId: this.taskId, message },
    // 	})
    // 	// Track that this message has been synced to cloud
    // 	this.cloudSyncedMessageTimestamps.add(message.ts)
    // }
    // kade_change end
  }

  public async saveClineMessages() {
    try {
      await saveTaskMessages({
        messages: this.clineMessages,
        taskId: this.taskId,
        globalStoragePath: this.globalStoragePath,
      });

      // kade_change start
      // Post directly to webview for CLI to react to file save.
      // Keep this isolated so filesystem issues don't prevent token usage
      // updates (important for unit tests and degraded environments).
      try {
        if (!this._cachedTaskDirPath) {
          this._cachedTaskDirPath = await getTaskDirectoryPath(
            this.globalStoragePath,
            this.taskId,
          );
        }
        const filePath = path.join(
          this._cachedTaskDirPath,
          GlobalFileNames.uiMessages,
        );
        const provider = this.providerRef.deref();
        if (provider) {
          await provider.postMessageToWebview({
            type: "taskMessagesSaved",
            payload: [this.taskId, filePath],
          });
        }
      } catch (error) {
        console.warn(
          "Failed to notify webview about saved task messages:",
          error,
        );
      }
      // kade_change end

      // PERF: During active streaming (or before task init completes), defer
      // the expensive taskMetadata computation.
      // taskMetadata calls getSystemPrompt(), reads/writes disk, and computes
      // token usage. Running this on the very first chat row can delay time to
      // first token and make the initial send feel sluggish.
      if (this.isStreaming || !this.isInitialized) {
        this.debouncedTaskMetadataUpdate();
      } else {
        await this.computeAndSaveTaskMetadata();
      }
    } catch (error) {
      console.error("Failed to save messages:", error);
    }
  }

  private findMessageByTimestamp(ts: number): ClineMessage | undefined {
    for (let i = this.clineMessages.length - 1; i >= 0; i--) {
      if (this.clineMessages[i].ts === ts) {
        return this.clineMessages[i];
      }
    }

    return undefined;
  }

  async nextClineMessageTimestamp_kilocode() {
    const now = Date.now();
    const lastTs = this.clineMessages?.at(-1)?.ts ?? 0;
    return Math.max(now, lastTs + 1);
  }

  // Note that `partial` has three valid states true (partial message),
  // false (completion of partial message), undefined (individual complete
  // message).
  async ask(
    type: ClineAsk,
    text?: string,
    partial?: boolean,
    progressStatus?: ToolProgressStatus,
    isProtected?: boolean,
  ): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
    // If this Cline instance was aborted by the provider, then the only
    // thing keeping us alive is a promise still running in the background,
    // in which case we don't want to send its result to the webview as it
    // is attached to a new instance of Cline now. So we can safely ignore
    // the result of any active promises, and this class will be
    // deallocated. (Although we set Cline = undefined in provider, that
    // simply removes the reference to this instance, but the instance is
    // still alive until this promise resolves or rejects.)
    if (this.abort) {
      throw new Error(
        `[KiloCode#ask] task ${this.taskId}.${this.instanceId} aborted`,
      );
    }

    // Initialize with a fallback timestamp to ensure it's always defined
    let askTs: number = this.lastMessageTs || Date.now();

    if (partial !== undefined) {
      const lastMessage = this.clineMessages.at(-1);

      const isUpdatingPreviousPartial =
        lastMessage &&
        lastMessage.partial &&
        lastMessage.type === "ask" &&
        lastMessage.ask === type;

      if (partial) {
        if (isUpdatingPreviousPartial) {
          // Existing partial message, so update it.
          lastMessage.text = text;
          lastMessage.partial = partial;
          lastMessage.progressStatus = progressStatus;
          lastMessage.isProtected = isProtected;
          // TODO: Be more efficient about saving and posting only new
          // data or one whole message at a time so ignore partial for
          // saves, and only post parts of partial message instead of
          // whole array in new listener.
          this.updateClineMessage(lastMessage);
          // console.log("Task#ask: current ask promise was ignored (#1)")
          throw new AskIgnoredError("updating existing partial");
        } else {
          // This is a new partial message, so add it with partial
          // state.
          askTs = await this.nextClineMessageTimestamp_kilocode();
          this.lastMessageTs = askTs;
          console.log(`Task#ask: new partial ask -> ${type} @${askTs} `);
          await this.addToClineMessages({
            ts: askTs,
            type: "ask",
            ask: type,
            text,
            partial,
            isProtected,
          });
          // console.log("Task#ask: current ask promise was ignored (#2)")
          throw new AskIgnoredError("new partial");
        }
      } else {
        if (isUpdatingPreviousPartial) {
          // This is the complete version of a previously partial
          // message, so replace the partial with the complete version.
          this.askResponse = undefined;
          this.askResponseText = undefined;
          this.askResponseImages = undefined;

          // Bug for the history books:
          // In the webview we use the ts as the chatrow key for the
          // virtuoso list. Since we would update this ts right at the
          // end of streaming, it would cause the view to flicker. The
          // key prop has to be stable otherwise react has trouble
          // reconciling items between renders, causing unmounting and
          // remounting of components (flickering).
          // The lesson here is if you see flickering when rendering
          // lists, it's likely because the key prop is not stable.
          // So in this case we must make sure that the message ts is
          // never altered after first setting it.
          askTs = lastMessage.ts;
          console.log(
            `Task#ask: updating previous partial ask -> ${type} @${askTs} `,
          );
          this.lastMessageTs = askTs;
          lastMessage.text = text;
          lastMessage.partial = false;
          lastMessage.progressStatus = progressStatus;
          lastMessage.isProtected = isProtected;
          await this.saveClineMessages();
          this.updateClineMessage(lastMessage);
        } else {
          // kade_change: Check if there's an existing say("tool") message for the SAME tool
          // Match by tool name + path (not ID, since parser IDs get reset between turns)
          // If found, CONVERT it to ask("tool") instead of creating a new message
          let convertedExistingSay = false;
          if (type === "tool" && text) {
            try {
              const currentTool = JSON.parse(text);
              const currentToolName = currentTool?.tool;
              const currentToolPath = currentTool?.path;

              if (
                currentToolName &&
                (currentToolName === "newFileCreated" ||
                  currentToolName === "appliedDiff" ||
                  currentToolName === "editedExistingFile")
              ) {
                // Search backwards for a say("tool") with matching tool name + path
                for (let i = this.clineMessages.length - 1; i >= 0; i--) {
                  const msg = this.clineMessages[i];
                  if (
                    msg.type === "say" &&
                    msg.say === "tool" &&
                    msg.text &&
                    msg.partial === true
                  ) {
                    try {
                      const msgTool = JSON.parse(msg.text);
                      if (
                        msgTool?.tool === currentToolName &&
                        msgTool?.path === currentToolPath
                      ) {
                        // Found matching say("tool") - convert it to ask("tool")
                        this.askResponse = undefined;
                        this.askResponseText = undefined;
                        this.askResponseImages = undefined;
                        askTs = msg.ts; // Keep the original timestamp!
                        console.log(
                          `Task#ask: converting say("tool") to ask("tool") @${askTs} (${currentToolName} ${currentToolPath})`,
                        );
                        this.lastMessageTs = askTs;
                        msg.type = "ask";
                        msg.ask = type;
                        delete (msg as any).say;
                        msg.text = text;
                        msg.partial = false;
                        msg.progressStatus = progressStatus;
                        msg.isProtected = isProtected;
                        await this.saveClineMessages();
                        this.updateClineMessage(msg);
                        convertedExistingSay = true;
                        break;
                      }
                    } catch {
                      /* ignore parse errors */
                    }
                  }
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }

          if (!convertedExistingSay) {
            // This is a new and complete message, so add it like normal.
            this.askResponse = undefined;
            this.askResponseText = undefined;
            this.askResponseImages = undefined;
            askTs = await this.nextClineMessageTimestamp_kilocode(); // kade_change
            console.log(`Task#ask: new complete ask -> ${type} @${askTs} `);
            this.lastMessageTs = askTs;
            await this.addToClineMessages({
              ts: askTs,
              type: "ask",
              ask: type,
              text,
              isProtected,
            });
          }
        }
      }
    } else {
      // This is a new non-partial message, so add it like normal.
      this.askResponse = undefined;
      this.askResponseText = undefined;
      this.askResponseImages = undefined;
      askTs = await this.nextClineMessageTimestamp_kilocode(); // kade_change
      this.lastMessageTs = askTs;
      await this.addToClineMessages({
        ts: askTs,
        type: "ask",
        ask: type,
        text,
        isProtected,
      });
    }

    // kade_change start: YOLO mode auto-answer for follow-up questions
    // Check if this is a follow-up question with suggestions in YOLO mode
    if (type === "followup" && text && !partial) {
      try {
        const state = await this.providerRef.deref()?.getState();
        if (this.yoloMode || state?.yoloMode) {
          // Parse the follow-up JSON to extract suggestions
          const followUpData = JSON.parse(text);
          if (
            followUpData.suggest &&
            Array.isArray(followUpData.suggest) &&
            followUpData.suggest.length > 0
          ) {
            // Auto-select the first suggestion
            const firstSuggestion = followUpData.suggest[0];
            const autoAnswer = firstSuggestion.answer || firstSuggestion;

            // Immediately set the response as if the user clicked the first suggestion
            this.handleWebviewAskResponse(
              "messageResponse",
              autoAnswer,
              undefined,
            );

            // Return immediately with the auto-selected answer
            const result = {
              response: this.askResponse!,
              text: autoAnswer,
              images: undefined,
            };
            this.askResponse = undefined;
            this.askResponseText = undefined;
            this.askResponseImages = undefined;
            return result;
          }
        }
      } catch (error) {
        // If parsing fails or YOLO check fails, continue with normal flow
        console.warn(
          "Failed to auto-answer follow-up question in YOLO mode:",
          error,
        );
      }
    }
    // kade_change end
    let timeouts: NodeJS.Timeout[] = [];

    // kade_change start: YOLO mode auto-answer for tools
    if (this.yoloMode && !partial) {
      if (
        type === "tool" ||
        type === "command" ||
        type === "browser_action_launch" ||
        type === "use_mcp_server"
      ) {
        this.approveAsk();
      }
    }
    // kade_change end

    // Automatically approve if the ask according to the user's settings.
    const provider = this.providerRef.deref();
    const state = provider ? await provider.getState() : undefined;
    const approval = await checkAutoApproval({
      state,
      ask: type,
      text,
      isProtected,
    });

    if (approval.decision === "approve") {
      this.approveAsk();
    } else if (approval.decision === "deny") {
      this.denyAsk();
    } else if (approval.decision === "timeout") {
      // Store the auto-approval timeout so it can be cancelled if user interacts
      this.autoApprovalTimeoutRef = setTimeout(() => {
        const { askResponse, text, images } = approval.fn();
        this.handleWebviewAskResponse(askResponse, text, images);
        this.autoApprovalTimeoutRef = undefined;
      }, approval.timeout);
      timeouts.push(this.autoApprovalTimeoutRef);
    }

    // The state is mutable if the message is complete and the task will
    // block (via the `pWaitFor`).
    const isBlocking = !(
      this.askResponse !== undefined || this.lastMessageTs !== askTs
    );
    const isMessageQueued = !this.messageQueueService.isEmpty();

    const isStatusMutable =
      !partial && isBlocking && !isMessageQueued && approval.decision === "ask";

    if (isBlocking) {
      // console.log(`Task#ask will block -> type: ${type} `)
    }

    if (isStatusMutable) {
      // console.log(`Task#ask: status is mutable -> type: ${type} `)
      const statusMutationTimeout = 2_000;

      if (isInteractiveAsk(type)) {
        timeouts.push(
          setTimeout(() => {
            const message = this.findMessageByTimestamp(askTs);

            if (message) {
              this.interactiveAsk = message;
              this.emit(RooCodeEventName.TaskInteractive, this.taskId);
              provider?.postMessageToWebview({ type: "interactionRequired" });
            }
          }, statusMutationTimeout),
        );
      } else if (isResumableAsk(type)) {
        timeouts.push(
          setTimeout(() => {
            const message = this.findMessageByTimestamp(askTs);

            if (message) {
              this.resumableAsk = message;
              this.emit(RooCodeEventName.TaskResumable, this.taskId);
            }
          }, statusMutationTimeout),
        );
      } else if (isIdleAsk(type)) {
        timeouts.push(
          setTimeout(() => {
            const message = this.findMessageByTimestamp(askTs);

            if (message) {
              this.idleAsk = message;
              this.emit(RooCodeEventName.TaskIdle, this.taskId);
            }
          }, statusMutationTimeout),
        );
      }
    } else if (isMessageQueued) {
      console.log(`Task#ask: will process message queue -> type: ${type} `);

      const message = this.messageQueueService.dequeueMessage();

      if (message) {
        // Check if this is a tool approval ask that needs to be handled.
        if (
          type === "tool" ||
          type === "command" ||
          type === "browser_action_launch" ||
          type === "use_mcp_server"
        ) {
          // For tool approvals, we need to approve first, then send
          // the message if there's text/images.
          this.handleWebviewAskResponse(
            "yesButtonClicked",
            message.text,
            message.images,
          );
        } else {
          // For other ask types (like followup or command_output), fulfill the ask
          // directly.
          this.handleWebviewAskResponse(
            "messageResponse",
            message.text,
            message.images,
          );
        }
      }
    }

    // Wait for askResponse to be set
    await pWaitFor(
      () => this.askResponse !== undefined || this.lastMessageTs !== askTs,
      { interval: 100 },
    );

    if (this.lastMessageTs !== askTs) {
      // Could happen if we send multiple asks in a row i.e. with
      // command_output. It's important that when we know an ask could
      // fail, it is handled gracefully.
      console.log("Task#ask: current ask promise was ignored");
      throw new AskIgnoredError("superseded");
    }

    const result = {
      response: this.askResponse!,
      text: this.askResponseText,
      images: this.askResponseImages,
    };
    this.askResponse = undefined;
    this.askResponseText = undefined;
    this.askResponseImages = undefined;

    // Cancel the timeouts if they are still running.
    timeouts.forEach((timeout) => clearTimeout(timeout));

    // Switch back to an active state.
    if (this.idleAsk || this.resumableAsk || this.interactiveAsk) {
      this.idleAsk = undefined;
      this.resumableAsk = undefined;
      this.interactiveAsk = undefined;
      this.emit(RooCodeEventName.TaskActive, this.taskId);
    }

    this.emit(RooCodeEventName.TaskAskResponded);
    return result;
  }

  handleWebviewAskResponse(
    askResponse: ClineAskResponse,
    text?: string,
    images?: string[],
  ) {
    // kade_change: Prevent "Ghost Message" race condition where rapid clicks trigger duplicate tools
    if (this._processingAskTs === this.lastMessageTs) {
      console.warn(
        `[Task#${this.taskId}] Ignoring duplicate response for timestamp ${this.lastMessageTs}`,
      );
      return;
    }
    this._processingAskTs = this.lastMessageTs;

    // Clear any pending auto-approval timeout when user responds
    this.cancelAutoApprovalTimeout();

    this.askResponseText = text;
    this.askResponseImages = images;

    // kade_change start
    // the askResponse assignment needs to happen last to avoid the async
    // callbacks triggering before we assign the data above
    this.askResponse = askResponse; // this triggers async callbacks
    // kade_change end

    // Create a checkpoint whenever the user sends a message.
    // Use allowEmpty=true to ensure a checkpoint is recorded even if there are no file changes.
    // Suppress the checkpoint_saved chat row for this particular checkpoint to keep the timeline clean.
    if (askResponse === "messageResponse") {
      void this.checkpointSave(false, true);
    }

    // Mark the last follow-up question as answered
    if (
      askResponse === "messageResponse" ||
      askResponse === "yesButtonClicked"
    ) {
      // Find the last unanswered follow-up message using findLastIndex
      const lastFollowUpIndex = findLastIndex(
        this.clineMessages,
        (msg) =>
          msg.type === "ask" && msg.ask === "followup" && !msg.isAnswered,
      );

      if (lastFollowUpIndex !== -1) {
        // Mark this follow-up as answered
        this.clineMessages[lastFollowUpIndex].isAnswered = true;
        // Save the updated messages
        this.saveClineMessages().catch((error) => {
          console.error("Failed to save answered follow-up state:", error);
        });
      }
    }
  }

  /**
   * Cancel any pending auto-approval timeout.
   * Called when user interacts (types, clicks buttons, etc.) to prevent the timeout from firing.
   */
  public cancelAutoApprovalTimeout(): void {
    if (this.autoApprovalTimeoutRef) {
      clearTimeout(this.autoApprovalTimeoutRef);
      this.autoApprovalTimeoutRef = undefined;
    }
  }

  public cancelQueuedMessageTimeout(): void {
    if (this.queuedMessageTimeoutRef) {
      clearTimeout(this.queuedMessageTimeoutRef);
      this.queuedMessageTimeoutRef = undefined;
    }
  }

  public approveAsk({
    text,
    images,
  }: { text?: string; images?: string[] } = {}) {
    this.handleWebviewAskResponse("yesButtonClicked", text, images);
  }

  public denyAsk({ text, images }: { text?: string; images?: string[] } = {}) {
    this.handleWebviewAskResponse("noButtonClicked", text, images);
  }

  /**
   * Updates the API configuration and reinitializes the parser based on the new tool protocol.
   * This should be called when switching between models/profiles with different tool protocols
   * to prevent the parser from being left in an inconsistent state.
   *
   * @param newApiConfiguration - The new API configuration to use
   */
  public updateApiConfiguration(newApiConfiguration: ProviderSettings): void {
    // Update the configuration and rebuild the API handler
    this.apiConfiguration = newApiConfiguration;

    // kade_change: Ensure the updated configuration is persisted to history immediately
    this.computeAndSaveTaskMetadata().catch((error) => {
      console.warn("Failed to save task metadata after config update:", error);
    });

    // Optimize: Use cached API handler when possible
    const configKey = JSON.stringify(newApiConfiguration);
    const cachedHandler = Task.apiHandlerCache.get(configKey);
    if (cachedHandler) {
      this.api = cachedHandler;
    } else {
      this.api = buildApiHandler(newApiConfiguration);
      // Limit cache size to prevent memory leaks
      if (Task.apiHandlerCache.size >= 10) {
        const firstKey = Task.apiHandlerCache.keys().next().value;
        if (firstKey) {
          Task.apiHandlerCache.delete(firstKey);
        }
      }
      Task.apiHandlerCache.set(configKey, this.api);
    }

    // Determine what the tool protocol should be
    const modelInfo = this.api.getModel().info;
    const protocol = resolveToolProtocol(this.apiConfiguration, modelInfo);
    // Check if we need to switch parser
    const currentParserIsXml =
      this.assistantMessageParser instanceof AssistantMessageParser;
    const currentParserIsUnified =
      this.assistantMessageParser instanceof UnifiedToolCallParser;
    const currentParserIsMarkdown =
      this.assistantMessageParser instanceof MarkdownToolCallParser;
    const currentParserIsUndefined = !this.assistantMessageParser;

    const targetProtocol = resolveToolProtocol(
      this.apiConfiguration,
      modelInfo,
    );

    // Create unified parser if needed
    if (targetProtocol === "unified") {
      if (!currentParserIsUnified) {
        if (this.assistantMessageParser) this.assistantMessageParser.reset(); // likely redundant but safe
        const unifiedParser = new UnifiedToolCallParser();
        const provider = this.providerRef.deref();
        if (provider) this.populateMcpToolNames(unifiedParser, provider);
        this.assistantMessageParser = unifiedParser;
      } else if (this.assistantMessageParser instanceof UnifiedToolCallParser) {
        // Refresh MCP tool names on existing parser in case servers changed
        const provider = this.providerRef.deref();
        if (provider)
          this.populateMcpToolNames(this.assistantMessageParser, provider);
      }
      return;
    }

    // Create markdown parser if needed
    if (targetProtocol === "markdown") {
      if (!currentParserIsMarkdown) {
        if (this.assistantMessageParser) this.assistantMessageParser.reset();
        const markdownParser = new MarkdownToolCallParser();
        const provider = this.providerRef.deref();
        if (provider) this.populateMcpToolNames(markdownParser, provider);
        this.assistantMessageParser = markdownParser;
      } else if (
        this.assistantMessageParser instanceof MarkdownToolCallParser
      ) {
        // Refresh MCP tool names on existing parser in case servers changed
        const provider = this.providerRef.deref();
        if (provider)
          this.populateMcpToolNames(this.assistantMessageParser, provider);
      }
      return;
    }

    // Create XML parser if needed
    if (targetProtocol === "xml") {
      if (!currentParserIsXml) {
        if (this.assistantMessageParser) this.assistantMessageParser.reset();
        this.assistantMessageParser = new AssistantMessageParser();
      }
      return;
    }

    // Fallback to Native (undefined parser)
    if (targetProtocol === "native") {
      if (!currentParserIsUndefined && this.assistantMessageParser) {
        this.assistantMessageParser.reset();
        this.assistantMessageParser = undefined;
      }
      return;
    }
  }

  // Cache for API handler instances to reduce rebuild overhead
  private static apiHandlerCache = new Map<string, ApiHandler>();

  public async submitUserMessage(
    text: string,
    images?: string[],
    mode?: string,
    providerProfile?: string,
  ): Promise<void> {
    try {
      // Fast-path validation
      text = (text ?? "").trim();
      images = images ?? [];

      if (text.length === 0 && images.length === 0) {
        return;
      }

      const provider = this.providerRef.deref();
      if (!provider) {
        console.error("[Task#submitUserMessage] Provider reference lost");
        return;
      }

      // Optimize: Parallel mode and profile updates
      const updates: Promise<void>[] = [];
      if (mode) {
        updates.push(provider.setMode(mode));
      }

      if (providerProfile) {
        updates.push(
          (async () => {
            await provider.setProviderProfile(providerProfile);

            // Update this task's API configuration to match the new profile
            // This ensures the parser state is synchronized with the selected model
            const newState = await provider.getState();
            if (newState?.apiConfiguration) {
              this.updateApiConfiguration(newState.apiConfiguration);
            }
          })(),
        );
      }

      // Execute updates in parallel to reduce latency
      if (updates.length > 0) {
        await Promise.all(updates);
      }

      this.emit(RooCodeEventName.TaskUserMessage, this.taskId);

      provider.postMessageToWebview({
        type: "invoke",
        invoke: "sendMessage",
        text,
        images,
      });
    } catch (error) {
      console.error(
        "[Task#submitUserMessage] Failed to submit user message:",
        error,
      );
    }
  }

  async handleTerminalOperation(terminalOperation: "continue" | "abort") {
    if (terminalOperation === "continue") {
      // First, signal the terminal process itself to move to background
      this.terminalProcess?.continue();
      // Then unblock any pending task.ask("command_output") that is waiting for a response.
      // Without this, the task stays frozen even though the process continues running.
      // Only unblock if there actually IS a pending ask (askResponse not yet set).
      if (this.askResponse === undefined) {
        this.handleWebviewAskResponse("yesButtonClicked");
      }
    } else if (terminalOperation === "abort") {
      // Send the kill signal to the terminal process
      this.terminalProcess?.abort();
      // Unblock any pending task.ask("command_output") so the task loop
      // can detect the abort and terminate cleanly instead of hanging.
      if (this.askResponse === undefined) {
        this.handleWebviewAskResponse("noButtonClicked");
      }
    }
  }

  public async condenseContext(): Promise<void> {
    const systemPrompt = await this.getSystemPrompt();

    // Get condensing configuration
    const state = await this.providerRef.deref()?.getState();
    // These properties may not exist in the state type yet, but are used for condensing configuration
    const customCondensingPrompt = state?.customCondensingPrompt;
    const condensingApiConfigId = state?.condensingApiConfigId;
    const listApiConfigMeta = state?.listApiConfigMeta;

    // Determine API handler to use
    let condensingApiHandler: ApiHandler | undefined;
    if (
      condensingApiConfigId &&
      listApiConfigMeta &&
      Array.isArray(listApiConfigMeta)
    ) {
      // Find matching config by ID
      const matchingConfig = listApiConfigMeta.find(
        (config) => config.id === condensingApiConfigId,
      );
      if (matchingConfig) {
        const profile = await this.providerRef
          .deref()
          ?.providerSettingsManager.getProfile({
            id: condensingApiConfigId,
          });
        // Ensure profile and apiProvider exist before trying to build handler
        if (profile && profile.apiProvider) {
          condensingApiHandler = buildApiHandler(profile);
        }
      }
    }

    const { contextTokens: prevContextTokens } = this.getTokenUsage();

    // Determine if we're using native tool protocol for proper message handling
    const modelInfo = this.api.getModel().info;
    const protocol = resolveToolProtocol(this.apiConfiguration, modelInfo);
    const useNativeTools = isNativeProtocol(protocol);

    const {
      messages,
      summary,
      cost,
      newContextTokens = 0,
      error,
      condenseId,
    } = await summarizeConversation(
      this.apiConversationHistory,
      this.api, // Main API handler (fallback)
      systemPrompt, // Default summarization prompt (fallback)
      this.taskId,
      prevContextTokens,
      false, // manual trigger
      customCondensingPrompt, // User's custom prompt
      condensingApiHandler, // Specific handler for condensing
      useNativeTools, // Pass native tools flag for proper message handling
    );
    if (error) {
      this.say(
        "condense_context_error",
        error,
        undefined /* images */,
        false /* partial */,
        undefined /* checkpoint */,
        undefined /* progressStatus */,
        { isNonInteractive: true } /* options */,
      );
      return;
    }
    await this.overwriteApiConversationHistory(messages);

    const contextCondense: ContextCondense = {
      summary,
      cost,
      newContextTokens,
      prevContextTokens,
      condenseId: condenseId!,
    };
    await this.say(
      "condense_context",
      undefined /* text */,
      undefined /* images */,
      false /* partial */,
      undefined /* checkpoint */,
      undefined /* progressStatus */,
      { isNonInteractive: true } /* options */,
      contextCondense,
    );

    // Process any queued messages after condensing completes
    this.processQueuedMessages();
  }

  async say(
    type: ClineSay,
    text?: string,
    images?: string[],
    partial?: boolean,
    checkpoint?: Record<string, unknown>,
    progressStatus?: ToolProgressStatus,
    options: {
      isNonInteractive?: boolean;
      skipSave?: boolean; // kade_change: allow skipping save for high-freq updates
      metadata?: Record<string, unknown>; // kade_change
    } = {},
    contextCondense?: ContextCondense,
    contextTruncation?: ContextTruncation,
  ): Promise<undefined> {
    if (this.abort) {
      throw new Error(
        `[Kilo Code#say] task ${this.taskId}.${this.instanceId} aborted`,
      );
    }

    if (partial !== undefined) {
      const lastMessage = this.clineMessages.at(-1);

      let isUpdatingPreviousPartial =
        lastMessage &&
        lastMessage.partial &&
        lastMessage.type === "say" &&
        lastMessage.say === type;

      // kade_change: For tool messages, we must also check that the tool ID matches
      // Otherwise, multiple tool operations (e.g., 4 edits) would overwrite each other's messages
      if (
        isUpdatingPreviousPartial &&
        type === "tool" &&
        text &&
        lastMessage?.text
      ) {
        try {
          const currentToolId = JSON.parse(text)?.id;
          const lastToolId = JSON.parse(lastMessage.text)?.id;
          // If both have IDs but they don't match, this is a DIFFERENT tool operation
          if (currentToolId && lastToolId && currentToolId !== lastToolId) {
            isUpdatingPreviousPartial = false;
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (partial) {
        if (isUpdatingPreviousPartial && lastMessage) {
          // Existing partial message, so update it.
          lastMessage.text = text;
          lastMessage.images = images;
          lastMessage.partial = partial;
          lastMessage.progressStatus = progressStatus;
          if (options.metadata) {
            lastMessage.metadata = Object.assign(
              lastMessage.metadata ?? {},
              options.metadata,
            );
          }
          this.updateClineMessage(lastMessage);
        } else {
          // This is a new partial message, so add it with partial state.
          const sayTs = await this.nextClineMessageTimestamp_kilocode();

          // Passive updates like reasoning chunks or partial text should NOT supersede active 'ask' calls.
          // We only update lastMessageTs for complete, interactive outcome messages.
          if (
            !partial &&
            !options.isNonInteractive &&
            type !== "reasoning" &&
            type !== "thought"
          ) {
            this.lastMessageTs = sayTs;
          }

          await this.addToClineMessages({
            ts: sayTs,
            type: "say",
            say: type,
            text,
            images,
            partial,
            contextCondense,
            contextTruncation,
            metadata: options.metadata,
          });
        }
      } else {
        // New now have a complete version of a previously partial message.
        // This is the complete version of a previously partial
        // message, so replace the partial with the complete version.
        if (isUpdatingPreviousPartial && lastMessage) {
          if (!options.isNonInteractive) {
            this.lastMessageTs = lastMessage.ts;
          }

          lastMessage.text = text;
          lastMessage.images = images;
          lastMessage.partial = false;
          lastMessage.progressStatus = progressStatus;
          // kade_change start
          if (options.metadata) {
            lastMessage.metadata = Object.assign(
              lastMessage.metadata ?? {},
              options.metadata,
            );
          }
          // kade_change end

          // Instead of streaming partialMessage events, we do a save
          // and post like normal to persist to disk.
          // PERF: Fire-and-forget save to avoid blocking the agent loop.
          // Tool results (grep, read, ls) should not wait for disk I/O.
          if (!options.skipSave) {
            this.saveClineMessages().catch((error) => {
              console.warn("Failed to save complete tool message:", error);
            });
          }

          // More performant than an entire `postStateToWebview`.
          this.updateClineMessage(lastMessage!);
        } else {
          // This is a new and complete message, so add it like normal.
          const sayTs = await this.nextClineMessageTimestamp_kilocode();

          if (!options.isNonInteractive) {
            this.lastMessageTs = sayTs;
          }

          await this.addToClineMessages({
            ts: sayTs,
            type: "say",
            say: type,
            text,
            images,
            contextCondense,
            metadata: options.metadata, // kilocode_csouhange
            contextTruncation,
          });
        }
      }
    } else {
      // This is a new non-partial message, so add it like normal.
      const sayTs = await this.nextClineMessageTimestamp_kilocode();

      // A "non-interactive" message is a message is one that the user
      // does not need to respond to. We don't want these message types
      // to trigger an update to `lastMessageTs` since they can be created
      // asynchronously and could interrupt a pending ask.
      if (!options.isNonInteractive) {
        this.lastMessageTs = sayTs;
      }

      await this.addToClineMessages({
        ts: sayTs,
        type: "say",
        say: type,
        text,
        images,
        checkpoint,
        contextCondense,
        metadata: options.metadata, // kade_change
        contextTruncation,
      });
    }

    // Broadcast browser session updates to panel when browser-related messages are added
    if (
      type === "browser_action" ||
      type === "browser_action_result" ||
      type === "browser_session_status"
    ) {
      this.broadcastBrowserSessionUpdate();
    }
  }

  async sayAndCreateMissingParamError(
    toolName: ToolName,
    paramName: string,
    relPath?: string,
  ) {
    const kilocodeExtraText = (() => {
      switch (toolName) {
        case "edit_file":
          return t("kilocode:task.disableEditFile") + " ";
        default:
          return "";
      }
    })();
    await this.say(
      "error",
      `Kilo Code tried to use ${toolName}${
        relPath ? ` for '${relPath.toPosix()}'` : ""
      } without value for required parameter '${paramName}'.${kilocodeExtraText}Retrying...`,
    );
    const modelInfo = this.api.getModel().info;
    const state = await this.providerRef.deref()?.getState();
    const toolProtocol = resolveToolProtocol(this.apiConfiguration, modelInfo);
    return formatResponse.toolError(
      formatResponse.missingToolParameterError(paramName, toolProtocol),
    );
  }

  // Lifecycle
  // Start / Resume / Abort / Dispose

  private async startTask(task?: string, images?: string[]): Promise<void> {
    if (this.enableBridge) {
      try {
        await BridgeOrchestrator.subscribeToTask(this);
      } catch (error) {
        console.error(
          `[Task#startTask]BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)} `,
        );
      }
    }

    // `conversationHistory` (for API) and `clineMessages` (for webview)
    // need to be in sync.
    // If the extension process were killed, then on restart the
    // `clineMessages` might not be empty, so we need to set it to [] when
    // we create a new Cline client (otherwise webview would show stale
    // messages from previous session).
    this.clineMessages = [];
    this.apiConversationHistory = [];

    // The todo list is already set in the constructor if initialTodos were provided
    // No need to add any messages - the todoList property is already set

    this.providerRef.deref()?.debouncedPostStateToWebview();

    // PERF: Do not block first model request on initial task chat-row persistence.
    // Persist the "task" row in the background so first-token latency is lower.
    void this.say("task", task, images).catch((error) => {
      console.error("Failed to persist initial task message:", error);
    });
    this.isInitialized = true;

    let imageBlocks: Anthropic.ImageBlockParam[] =
      formatResponse.imageBlocks(images);

    // Task starting
    // kade_change start: Use <initial_request> instead of <task>
    // The old <task> wrapper implied this was THE GOAL to pursue forever.
    // The new framing treats it as the user's first message in a conversation.
    // PERF: Start the first loop immediately instead of yielding to setTimeout(0).
    // The zero-timeout introduces variable event-loop delay under load and makes
    // the first send feel inconsistent.
    void this.initiateTaskLoop([
      {
        type: "text",
        text: `<initial_request>\n${task} \n </initial_request>`,
      },
      ...imageBlocks,
    ]).catch((error) => {
      // Swallow loop rejection when the task was intentionally abandoned/aborted
      // during delegation or user cancellation to prevent unhandled rejections.
      if (this.abandoned === true || this.abortReason === "user_cancelled") {
        return;
      }
      throw error;
    });
    // kade_change end
    // kade_change end
  }

  private async resumeTaskFromHistory() {
    if (this.enableBridge) {
      try {
        await BridgeOrchestrator.subscribeToTask(this);
      } catch (error) {
        console.error(
          `[Task#resumeTaskFromHistory] BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const modifiedClineMessages = await this.getSavedClineMessages();

    // Remove any resume messages that may have been added before.
    const lastRelevantMessageIndex = findLastIndex(
      modifiedClineMessages,
      (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
    );

    if (lastRelevantMessageIndex !== -1) {
      modifiedClineMessages.splice(lastRelevantMessageIndex + 1);
    }

    // Remove any trailing reasoning-only UI messages that were not part of the persisted API conversation
    while (modifiedClineMessages.length > 0) {
      const last = modifiedClineMessages[modifiedClineMessages.length - 1];
      if (last.type === "say" && last.say === "reasoning") {
        modifiedClineMessages.pop();
      } else {
        break;
      }
    }

    // Since we don't use `api_req_finished` anymore, we need to check if the
    // last `api_req_started` has a cost value, if it doesn't and no
    // cancellation reason to present, then we remove it since it indicates
    // an api request without any partial content streamed.
    const lastApiReqStartedIndex = findLastIndex(
      modifiedClineMessages,
      (m) => m.type === "say" && m.say === "api_req_started",
    );

    if (lastApiReqStartedIndex !== -1) {
      const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex];
      const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(
        lastApiReqStarted.text || "{}",
      );

      if (cost === undefined && cancelReason === undefined) {
        modifiedClineMessages.splice(lastApiReqStartedIndex, 1);
      }
    }

    await this.overwriteClineMessages(modifiedClineMessages);
    this.clineMessages = await this.getSavedClineMessages();

    // Now present the cline messages to the user and ask if they want to
    // resume (NOTE: we ran into a bug before where the
    // apiConversationHistory wouldn't be initialized when opening a old
    // task, and it was because we were waiting for resume).
    // This is important in case the user deletes messages without resuming
    // the task first.
    this.apiConversationHistory = await this.getSavedApiConversationHistory();

    const lastClineMessage = this.clineMessages
      .slice()
      .reverse()
      .find(
        (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
      ); // Could be multiple resume tasks.

    let askType: ClineAsk;
    if (lastClineMessage?.ask === "completion_result") {
      askType = "resume_completed_task";
    } else {
      askType = "resume_task";
    }

    this.isInitialized = true;

    const { response, text, images } = await this.ask(askType); // Calls `postStateToWebview`.

    let responseText: string | undefined;
    let responseImages: string[] | undefined;

    if (response === "messageResponse") {
      await this.say("user_feedback", text, images);
      responseText = text;
      responseImages = images;
    }

    // Make sure that the api conversation history can be resumed by the API,
    // even if it goes out of sync with cline messages.
    let existingApiConversationHistory: ApiMessage[] =
      await this.getSavedApiConversationHistory();

    // v2.0 xml tags refactor caveat: since we don't use tools anymore for XML protocol,
    // we need to replace all tool use blocks with a text block since the API disallows
    // conversations with tool uses and no tool schema.
    // For native protocol, we preserve tool_use and tool_result blocks as they're expected by the API.
    const state = await this.providerRef.deref()?.getState();
    const protocol = resolveToolProtocol(
      this.apiConfiguration,
      this.api.getModel().info,
    );
    const useNative = isNativeProtocol(protocol);

    // Only convert tool blocks to text for XML protocol
    // For native protocol, the API expects proper tool_use/tool_result structure
    if (!useNative) {
      // kade_change start
      // const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
      // 	if (Array.isArray(message.content)) {
      // 		const newContent = message.content.map((block) => {
      // 			if (block.type === "tool_use") {
      // 				// Format tool invocation based on protocol
      // 				const params = block.input as Record<string, any>
      // 				const formattedText = formatToolInvocation(block.name, params, protocol)
      // 				return {
      // 					type: "text",
      // 					text: formattedText,
      // 				} as Anthropic.Messages.TextBlockParam
      // 			} else if (block.type === "tool_result") {
      // 				// Convert block.content to text block array, removing images
      // 				const contentAsTextBlocks = Array.isArray(block.content)
      // 					? block.content.filter((item) => item.type === "text")
      // 					: [{ type: "text", text: block.content }]
      // 				const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n")
      // 				const toolName = findToolName(block.tool_use_id, existingApiConversationHistory)
      // 				return {
      // 					type: "text",
      // 					text: `[${toolName} Result]\n\n${textContent}`,
      // 				} as Anthropic.Messages.TextBlockParam
      // 			}
      // 			return block
      // 		})
      // 		return { ...message, content: newContent }
      // 	}
      // 	return message
      // })
      // existingApiConversationHistory = conversationWithoutToolBlocks
      // kade_change end
    }

    // FIXME: remove tool use blocks altogether

    // if the last message is an assistant message, we need to check if there's tool use since every tool use has to have a tool response
    // if there's no tool use and only a text block, then we can just add a user message
    // (note this isn't relevant anymore since we use custom tool prompts instead of tool use blocks, but this is here for legacy purposes in case users resume old tasks)

    // if the last message is a user message, we can need to get the assistant message before it to see if it made tool calls, and if so, fill in the remaining tool responses with 'interrupted'

    let modifiedOldUserContent: Anthropic.Messages.ContentBlockParam[]; // either the last message if its user message, or the user message before the last (assistant) message
    let modifiedApiConversationHistory: ApiMessage[]; // need to remove the last user message to replace with new modified user message
    if (existingApiConversationHistory.length > 0) {
      const lastMessage =
        existingApiConversationHistory[
          existingApiConversationHistory.length - 1
        ];

      if (lastMessage.role === "assistant") {
        const content = Array.isArray(lastMessage.content)
          ? lastMessage.content
          : [{ type: "text", text: lastMessage.content }];
        const hasToolUse = content.some((block) => block.type === "tool_use");

        if (hasToolUse) {
          const toolUseBlocks = content.filter(
            (block) => block.type === "tool_use",
          ) as Anthropic.Messages.ToolUseBlock[];
          const toolResponses: Anthropic.ToolResultBlockParam[] =
            toolUseBlocks.map((block) => ({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                "Task was interrupted before this tool call could be completed.",
            }));
          modifiedApiConversationHistory = [...existingApiConversationHistory]; // no changes
          modifiedOldUserContent = [...toolResponses];
        } else {
          modifiedApiConversationHistory = [...existingApiConversationHistory];
          modifiedOldUserContent = [];
        }
      } else if (lastMessage.role === "user") {
        const previousAssistantMessage: ApiMessage | undefined =
          existingApiConversationHistory[
            existingApiConversationHistory.length - 2
          ];

        const existingUserContent: Anthropic.Messages.ContentBlockParam[] =
          Array.isArray(lastMessage.content)
            ? lastMessage.content
            : [{ type: "text", text: lastMessage.content }];
        if (
          previousAssistantMessage &&
          previousAssistantMessage.role === "assistant"
        ) {
          const assistantContent = Array.isArray(
            previousAssistantMessage.content,
          )
            ? previousAssistantMessage.content
            : [{ type: "text", text: previousAssistantMessage.content }];

          const toolUseBlocks = assistantContent.filter(
            (block) => block.type === "tool_use",
          ) as Anthropic.Messages.ToolUseBlock[];

          if (toolUseBlocks.length > 0) {
            const existingToolResults = existingUserContent.filter(
              (block) => block.type === "tool_result",
            ) as Anthropic.ToolResultBlockParam[];

            const missingToolResponses: Anthropic.ToolResultBlockParam[] =
              toolUseBlocks
                .filter(
                  (toolUse) =>
                    !existingToolResults.some(
                      (result) => result.tool_use_id === toolUse.id,
                    ),
                )
                .map((toolUse) => ({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content:
                    "Task was interrupted before this tool call could be completed.",
                }));

            modifiedApiConversationHistory =
              existingApiConversationHistory.slice(0, -1); // removes the last user message
            modifiedOldUserContent = [
              ...existingUserContent,
              ...missingToolResponses,
            ];
          } else {
            modifiedApiConversationHistory =
              existingApiConversationHistory.slice(0, -1);
            modifiedOldUserContent = [...existingUserContent];
          }
        } else {
          modifiedApiConversationHistory = existingApiConversationHistory.slice(
            0,
            -1,
          );
          modifiedOldUserContent = [...existingUserContent];
        }
      } else {
        throw new Error(
          "Unexpected: Last message is not a user or assistant message",
        );
      }
    } else {
      // Empty API conversation history - this can happen when restoring an empty session
      // (e.g., a session created but not yet used). Treat it like a fresh start.
      modifiedApiConversationHistory = [];
      modifiedOldUserContent = [];
    }

    // kade_change start: Safety Net for "Amnesia"
    // Check if the last UI message is a user feedback that is MISSING from the API history.
    // This happens if the user sends a message, and the window reloads/crashes before it is saved to apiConversationHistory.
    const lastClineMsg =
      modifiedClineMessages[modifiedClineMessages.length - 1];
    if (
      lastClineMsg &&
      lastClineMsg.type === "say" &&
      lastClineMsg.say === "user_feedback" &&
      lastClineMsg.text
    ) {
      const lastApiMsg =
        modifiedApiConversationHistory.length > 0
          ? modifiedApiConversationHistory[
              modifiedApiConversationHistory.length - 1
            ]
          : null;

      // If the last API message is an assistant message (meaning the user message is missing),
      // OR if the pending user content is empty (meaning we didn't extract it from history),
      // AND the text doesn't match the last API message content.
      const isMissing = !lastApiMsg || lastApiMsg.role === "assistant";

      if (isMissing) {
        const alreadyPending = modifiedOldUserContent.some(
          (block) =>
            block.type === "text" &&
            (block.text as string).includes(lastClineMsg.text!),
        );

        if (!alreadyPending) {
          console.log(
            "[Task#resumeTaskFromHistory] Recovering missing user message from UI history:",
            lastClineMsg.text,
          );
          // Recover text
          modifiedOldUserContent.push({
            type: "text",
            text: lastClineMsg.text,
          });
          // Recover images
          if (lastClineMsg.images && lastClineMsg.images.length > 0) {
            modifiedOldUserContent.push(
              ...formatResponse.imageBlocks(lastClineMsg.images),
            );
          }
        }
      }
    }
    // kade_change end

    let newUserContent: Anthropic.Messages.ContentBlockParam[] = [
      ...modifiedOldUserContent,
    ];

    const agoText = ((): string => {
      const timestamp = lastClineMessage?.ts ?? Date.now();
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return `${days} day${days > 1 ? "s" : ""} ago`;
      }
      if (hours > 0) {
        return `${hours} hour${hours > 1 ? "s" : ""} ago`;
      }
      if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
      }
      return "just now";
    })();

    if (responseText) {
      // kade_change start
      newUserContent = addOrMergeUserContent(newUserContent, [
        {
          type: "text",
          text: `${responseText}`,
        },
      ]);
      // kade_change end
    }

    if (responseImages && responseImages.length > 0) {
      newUserContent = addOrMergeUserContent(
        newUserContent,
        formatResponse.imageBlocks(responseImages),
      ); // kade_change
    }

    // Ensure we have at least some content to send to the API.
    // If newUserContent is empty, add a minimal resumption message.
    if (newUserContent.length === 0) {
      newUserContent.push({
        type: "text",
        text: "[TASK RESUMPTION] Resuming task...",
      });
    }

    await this.overwriteApiConversationHistory(modifiedApiConversationHistory);

    // Task resuming from history item.
    await this.initiateTaskLoop(newUserContent);
  }

  /**
   * Cancels the current HTTP request if one is in progress.
   * This immediately aborts the underlying stream rather than waiting for the next chunk.
   */
  public cancelCurrentRequest(): void {
    if (this.currentRequestAbortController) {
      console.log(
        `[Task#${this.taskId}.${this.instanceId}] Aborting current HTTP request`,
      );
      this.currentRequestAbortController.abort();
      this.currentRequestAbortController = undefined;
    }
  }

  /**
   * Force emit a final token usage update, ignoring throttle.
   * Called before task completion or abort to ensure final stats are captured.
   * Triggers the debounce with current values and immediately flushes to ensure emit.
   */
  public emitFinalTokenUsageUpdate(): void {
    const tokenUsage = this.getTokenUsage();
    this.debouncedEmitTokenUsage(tokenUsage, this.toolUsage);
    this.debouncedEmitTokenUsage.flush();
  }

  /**
   * Interrupts the current task execution (e.g. streaming, tool execution, or waiting for approval).
   * Unlike abortTask, this does NOT set this.abort to true, allowing the task loop to stay alive.
   */
  public interruptTask(): void {
    try {
      this.cancelCurrentRequest();
    } catch (error) {
      console.error("Error cancelling current request:", error);
    }

    try {
      if (this.terminalProcess) {
        this.terminalProcess.abort();
        // We do not set it to undefined here because executeCommandTool still needs to handle the cleanup
      }
      TerminalRegistry.releaseTerminalsForTask(this.taskId);
    } catch (error) {
      console.error("Error releasing terminals:", error);
    }

    try {
      this.urlContentFetcher?.closeBrowser();
    } catch (error) {
      console.error("Error closing URL content fetcher browser:", error);
    }

    try {
      this.browserSession?.closeBrowser();
    } catch (error) {
      console.error("Error closing browser session:", error);
    }

    // Unblock any pending user input (like approval prompts or waiting on commands)
    if (this.askResponse === undefined) {
      this.handleWebviewAskResponse("messageResponse", "[Response interrupted by user]");
    }
  }

  public async abortTask(isAbandoned = false) {
    // Aborting task

    // Will stop any autonomously running promises.
    if (isAbandoned) {
      this.abandoned = true;
    }

    this.abort = true;

    // Force final token usage update before abort event
    this.emitFinalTokenUsageUpdate();

    this.emit(RooCodeEventName.TaskAborted);

    try {
      this.dispose(); // Call the centralized dispose method
    } catch (error) {
      console.error(
        `Error during task ${this.taskId}.${this.instanceId} disposal:`,
        error,
      );
      // Don't rethrow - we want abort to always succeed
    }
    // kade_change: Do not await message saving during abort to keep it snappy.
    // The disposal and abort flags are already set.
    this.saveClineMessages().catch((error) => {
      console.error(
        `[Task#abortTask] Error saving messages for ${this.taskId}.${this.instanceId}:`,
        error,
      );
    });
  }

  public dispose(): void {
    console.log(
      `[Task#dispose] disposing task ${this.taskId}.${this.instanceId}`,
    );

    // Cancel any in-progress HTTP request
    try {
      this.cancelCurrentRequest();
    } catch (error) {
      console.error("Error cancelling current request:", error);
    }

    // Remove provider profile change listener
    try {
      if (this.providerProfileChangeListener) {
        const provider = this.providerRef.deref();
        if (provider) {
          provider.off(
            RooCodeEventName.ProviderProfileChanged,
            this.providerProfileChangeListener,
          );
        }
        this.providerProfileChangeListener = undefined;
      }
    } catch (error) {
      console.error("Error removing provider profile change listener:", error);
    }

    // Dispose message queue and remove event listeners.
    try {
      if (this.messageQueueStateChangedHandler) {
        this.messageQueueService.removeListener(
          "stateChanged",
          this.messageQueueStateChangedHandler,
        );
        this.messageQueueStateChangedHandler = undefined;
      }

      this.messageQueueService.dispose();
    } catch (error) {
      console.error("Error disposing message queue:", error);
    }

    // Remove all event listeners to prevent memory leaks.
    try {
      this.removeAllListeners();
    } catch (error) {
      console.error("Error removing event listeners:", error);
    }

    if (this.enableBridge) {
      BridgeOrchestrator.getInstance()
        ?.unsubscribeFromTask(this.taskId)
        .catch((error) =>
          console.error(
            `[Task#dispose] BridgeOrchestrator#unsubscribeFromTask() failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    // Release any terminals associated with this task.
    try {
      // Release any terminals associated with this task.
      TerminalRegistry.releaseTerminalsForTask(this.taskId);
    } catch (error) {
      console.error("Error releasing terminals:", error);
    }

    try {
      this.urlContentFetcher.closeBrowser();
    } catch (error) {
      console.error("Error closing URL content fetcher browser:", error);
    }

    try {
      this.browserSession.closeBrowser();
    } catch (error) {
      console.error("Error closing browser session:", error);
    }
    // Also close the Browser Session panel when the task is disposed
    try {
      const provider = this.providerRef.deref();
      if (provider) {
        const {
          BrowserSessionPanelManager,
        } = require("../webview/BrowserSessionPanelManager");
        BrowserSessionPanelManager.getInstance(provider).dispose();
      }
    } catch (error) {
      console.error("Error closing browser session panel:", error);
    }

    try {
      if (this.rooIgnoreController) {
        this.rooIgnoreController.dispose();
        this.rooIgnoreController = undefined;
      }

      // Cancel all debounced functions to prevent memory leaks and background execution after disposal
      try {
        this.debouncedEmitTokenUsage?.cancel();
        this.debouncedLiveTitleUpdate?.cancel();
        this.debouncedSaveClineMessages?.cancel();
        this.debouncedTaskMetadataUpdate?.cancel();
      } catch (error) {
        console.error(
          "Error cancelling debounced functions during Task disposal:",
          error,
        );
      }

      // Cancel any pending queued message timeouts
      this.cancelQueuedMessageTimeout();
    } catch (error) {
      console.error("Error disposing RooIgnoreController:", error);
      // This is the critical one for the leak fix.
    }

    try {
      this.fileContextTracker.dispose();
    } catch (error) {
      console.error("Error disposing file context tracker:", error);
    }

    try {
      // If we're not streaming then `abortStream` won't be called.
      if (this.isStreaming && this.diffViewProvider.isEditing) {
        this.diffViewProvider.revertChanges().catch(console.error);
      }
    } catch (error) {
      console.error("Error reverting diff changes:", error);
    }
  }

  // Subtasks
  // Spawn / Wait / Complete

  public async startSubtask(
    message: string,
    initialTodos: TodoItem[],
    mode: string,
  ) {
    const provider = this.providerRef.deref();

    if (!provider) {
      throw new Error("Provider not available");
    }

    const child = await (provider as any).delegateParentAndOpenChild({
      parentTaskId: this.taskId,
      message,
      initialTodos,
      mode,
    });
    return child;
  }

  /**
   * Resume parent task after delegation completion without showing resume ask.
   * Used in metadata-driven subtask flow.
   *
   * This method:
   * - Clears any pending ask states
   * - Resets abort and streaming flags
   * - Ensures next API call includes full context
   * - Immediately continues task loop without user interaction
   */
  public async resumeAfterDelegation(): Promise<void> {
    // Clear any ask states that might have been set during history load
    this.idleAsk = undefined;
    this.resumableAsk = undefined;
    this.interactiveAsk = undefined;

    // Reset abort and streaming state to ensure clean continuation
    this.abort = false;
    this.abandoned = false;
    this.abortReason = undefined;
    this.didFinishAbortingStream = false;
    this.isStreaming = false;
    this.isWaitingForFirstChunk = false;

    // Ensure next API call includes full context after delegation
    this.skipPrevResponseIdOnce = true;

    // Mark as initialized and active
    this.isInitialized = true;
    this.emit(RooCodeEventName.TaskActive, this.taskId);

    // Load conversation history if not already loaded
    if (this.apiConversationHistory.length === 0) {
      this.apiConversationHistory = await this.getSavedApiConversationHistory();
    }

    // Add environment details to the existing last user message (which contains the tool_result)
    // This avoids creating a new user message which would cause consecutive user messages
    const environmentDetails = await getEnvironmentDetails(this, true);
    let lastUserMsgIndex = -1;
    for (let i = this.apiConversationHistory.length - 1; i >= 0; i--) {
      if (this.apiConversationHistory[i].role === "user") {
        lastUserMsgIndex = i;
        break;
      }
    }
    if (lastUserMsgIndex >= 0) {
      const lastUserMsg = this.apiConversationHistory[lastUserMsgIndex];
      if (Array.isArray(lastUserMsg.content)) {
        // Remove any existing environment context blocks before adding fresh ones
        const contentWithoutEnvDetails = lastUserMsg.content.filter(
          (block: Anthropic.Messages.ContentBlockParam) => {
            if (block.type === "text" && typeof block.text === "string") {
              const trimmed = block.text.trim();
              // Check for both new markdown format and old XML format for backward compatibility
              const isEnvironmentDetailsBlock =
                trimmed.startsWith("## Environment Context") ||
                (trimmed.startsWith("<environment_details>") &&
                  trimmed.endsWith("</environment_details>"));
              return !isEnvironmentDetailsBlock;
            }
            return true;
          },
        );
        // Add fresh environment details
        lastUserMsg.content = [
          ...contentWithoutEnvDetails,
          { type: "text" as const, text: environmentDetails },
        ];
      }
    }

    // Save the updated history
    await this.saveApiConversationHistory();

    // Continue task loop - pass empty array to signal no new user content needed
    // The initiateTaskLoop will handle this by skipping user message addition
    await this.initiateTaskLoop([]);
  }

  // Task Loop

  private async initiateTaskLoop(
    userContent: Anthropic.Messages.ContentBlockParam[],
  ): Promise<void> {
    // Kicks off the checkpoints initialization process in the background.
    getCheckpointService(this);

    let nextUserContent = userContent;
    let includeFileDetails = true;

    this.emit(RooCodeEventName.TaskStarted);

    while (!this.abort) {
      this.emit(RooCodeEventName.TaskActive, this.taskId); // kade_change: signal active processing
      const didEndLoop = await this.recursivelyMakeClineRequests(
        nextUserContent,
        includeFileDetails,
      );
      this.emit(RooCodeEventName.TaskIdle, this.taskId); // kade_change: signal idle/waiting
      includeFileDetails = false; // We only need file details the first time.

      // After each assistant turn, either end the loop or wait for the next real user message.
      if (didEndLoop) {
        break;
      } else {
        await this.say("api_req_finished");
        this.askResponse = undefined;
        this.askResponseText = undefined;
        this.askResponseImages = undefined;

        let didTimeoutWaitingForUser = false;
        try {
          await pWaitFor(() => this.askResponse !== undefined || this.abort, {
            interval: 100,
            timeout: 600_000, // 10 minute safety watchdog
          });
        } catch (error) {
          console.warn(
            `[Task#${this.taskId}] pWaitFor timeout reached while waiting for user input. Ending idle wait.`,
          );
          didTimeoutWaitingForUser = true;
        }

        if (this.abort || didTimeoutWaitingForUser) {
          break;
        }

        const text = this.askResponseText;
        const images = this.askResponseImages;

        this.askResponse = undefined;
        this.askResponseText = undefined;
        this.askResponseImages = undefined;

        // Add the actual user response to history
        await this.say("user_feedback", text, images);

        // Update nextUserContent
        nextUserContent = [
          { type: "text", text: text ?? "" },
          ...formatResponse.imageBlocks(images),
        ];

      }
    }
    // Ensure thinking indicator is cleared when task loop completes
    await this.say("api_req_finished");
  }

  public async recursivelyMakeClineRequests(
    userContent: Anthropic.Messages.ContentBlockParam[],
    includeFileDetails: boolean = false,
  ): Promise<boolean> {
    return new AgentLoop(this).run(userContent, includeFileDetails);
  }

  // kade_change start
  public async loadContext(
    userContent: UserContent,
    includeFileDetails: boolean = false,
  ): Promise<[UserContent, string, boolean]> {
    // Track if we need to check clinerulesFile
    let needsClinerulesFileCheck = false;

    // bookmark
    const { localWorkflowToggles, globalWorkflowToggles } =
      await refreshWorkflowToggles(this.getContext(), this.cwd);

    const processUserContent = async () => {
      // This is a temporary solution to dynamically load context mentions from tool results. It checks for the presence of tags that indicate that the tool was rejected and feedback was provided (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions). However if we allow multiple tools responses in the future, we will need to parse mentions specifically within the user content tags.
      // (Note: this caused the @/ import alias bug where file contents were being parsed as well, since v2 converted tool results to text blocks)
      return await Promise.all(
        userContent.map(async (block) => {
          if (block.type === "text") {
            // We need to ensure any user generated content is wrapped in one of these tags so that we know to parse mentions
            // FIXME: Only parse text in between these tags instead of the entire text block which may contain other tool results. This is part of a larger issue where we shouldn't be using regex to parse mentions in the first place (ie for cases where file paths have spaces)
            if (
              block.text.includes("<feedback>") ||
              block.text.includes("<answer>") ||
              block.text.includes("<task>") ||
              block.text.includes("<initial_request>") || // kade_change: new wrapper for user requests
              block.text.includes("<user_message>")
            ) {
              const parsedText = await parseMentions(
                block.text,
                this.cwd,
                this.urlContentFetcher,
                this.fileContextTracker,
              );

              // when parsing slash commands, we still want to allow the user to provide their desired context
              const { processedText, needsRulesFileCheck: needsCheck } =
                await parseKiloSlashCommands(
                  parsedText,
                  localWorkflowToggles,
                  globalWorkflowToggles,
                );

              if (needsCheck) {
                needsClinerulesFileCheck = true;
              }

              // kade_change: Track mentions in activeFileReads so they get the "Luxury Spa Treatment" (turn-by-turn refresh)
              const mentionRegex =
                /\[read_file\s+for\s+'(.*?)'\]\s+Result\s+\(id:\s+\[mention\]\):/g;
              let mentionMatch;
              while (
                (mentionMatch = mentionRegex.exec(processedText)) !== null
              ) {
                const filePath = mentionMatch[1];
                this.luxurySpa.mergeLineRanges(filePath, undefined);
              }

              return {
                ...block,
                text: processedText,
              };
            }
          }
          return block;
        }),
      );
    };

    // Run initial promises in parallel
    const [processedUserContent, environmentDetails] = await Promise.all([
      processUserContent(),
      getEnvironmentDetails(this, includeFileDetails),
    ]);
    // const [parsedUserContent, environmentDetails, clinerulesError] = await this.loadContext(
    // 	userContent,
    // 	includeFileDetails,
    // )

    // After processing content, check clinerulesData if needed
    let clinerulesError = false;
    if (needsClinerulesFileCheck) {
      clinerulesError = await ensureLocalKilorulesDirExists(
        this.cwd,
        GlobalFileNames.kiloRules,
      );
    }

    // Return all results
    this.latestEnvironmentDetails = environmentDetails; // kade_change
    return [processedUserContent, environmentDetails, clinerulesError];
  }
  // kade_change end

  /**
   * Invalidate the cached system prompt to force regeneration on next use.
   * Call this when settings that affect the system prompt are changed (e.g., enabled skills).
   */
  public invalidateSystemPromptCache(): void {
    this._cachedSystemPrompt = undefined;
    this._lastSystemPromptRefresh = 0;
  }

  /*private kade_change*/ async getSystemPrompt(): Promise<string> {
    const { mcpEnabled } = (await this.providerRef.deref()?.getState()) ?? {};
    let mcpHub: McpHub | undefined;
    if (mcpEnabled ?? true) {
      const provider = this.providerRef.deref();

      if (!provider) {
        throw new Error("Provider reference lost during view transition");
      }

      // Wait for MCP hub initialization through McpServerManager
      mcpHub = await McpServerManager.getInstance(provider.context, provider);

      if (!mcpHub) {
        throw new Error("Failed to get MCP hub from server manager");
      }

      // Wait for MCP servers to be connected before generating system prompt
      await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(
        () => {
          console.error("MCP servers failed to connect in time");
        },
      );
    }

    const rooIgnoreInstructions = this.rooIgnoreController?.getInstructions();

    const state = await this.providerRef.deref()?.getState();

    const {
      browserViewportSize,
      mode,
      customModes,
      customModePrompts,
      customInstructions,
      experiments,
      enableMcpServerCreation,
      browserToolEnabled,
      language,
      maxConcurrentFileReads,
      maxReadFileLine,
      apiConfiguration,
      enabledSkills,
    } = state ?? {};

    // Fetch installed skills
    const installedSkills = await this.providerRef.deref()?.fetchInstalledSkills() ?? [];

    return await (async () => {
      const provider = this.providerRef.deref();

      if (!provider) {
        throw new Error("Provider not available");
      }

      // Align browser tool enablement with generateSystemPrompt: require model image support,
      // mode to include the browser group, and the user setting to be enabled.
      const modeConfig = getModeBySlug(mode ?? defaultModeSlug, customModes);
      const modeSupportsBrowser =
        modeConfig?.groups.some((group) => getGroupName(group) === "browser") ??
        false;

      // Check if model supports browser capability (images)
      const modelInfo = this.api.getModel().info;
      const modelSupportsBrowser = (modelInfo as any)?.supportsImages === true;

      const canUseBrowserTool =
        modelSupportsBrowser &&
        modeSupportsBrowser &&
        (browserToolEnabled ?? true);

      // Resolve the tool protocol based on profile, model, and provider settings
      const toolProtocol = resolveToolProtocol(
        apiConfiguration ?? this.apiConfiguration,
        modelInfo,
      );

      let prompt = await SYSTEM_PROMPT(
        provider.context,
        this.cwd,
        canUseBrowserTool,
        mcpHub,
        this.diffStrategy,
        browserViewportSize ?? "900x600",
        mode ?? defaultModeSlug,
        customModePrompts,
        customModes,
        customInstructions,
        this.diffEnabled,
        { ...experiments, enableSubAgents: this.enableSubAgents },
        enableMcpServerCreation,
        language,
        rooIgnoreInstructions,
        maxReadFileLine !== -1,
        {
          maxConcurrentFileReads: maxConcurrentFileReads ?? 5,
          todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
          subAgentToolEnabled:
            (apiConfiguration as any)?.subAgentToolEnabled ??
            (this.apiConfiguration as any)?.subAgentToolEnabled ??
            true,
          useAgentRules:
            vscode.workspace
              .getConfiguration(Package.name)
              .get<boolean>("useAgentRules") ?? true,
          newTaskRequireTodos: vscode.workspace
            .getConfiguration(Package.name)
            .get<boolean>("newTaskRequireTodos", false),
          toolProtocol,
          unifiedFormatVariant:
            (apiConfiguration ?? this.apiConfiguration)?.unifiedFormatVariant ??
            vscode.workspace
              .getConfiguration(Package.name)
              .get<
                "simple" | "structured"
              >("unifiedFormatVariant", "structured"),
          isStealthModel: modelInfo?.isStealthModel,
          disableBatchToolUse: (apiConfiguration ?? this.apiConfiguration)
            ?.disableBatchToolUse,
          maxToolCalls: (apiConfiguration ?? this.apiConfiguration)
            ?.maxToolCalls,
          minimalSystemPrompt: (apiConfiguration ?? this.apiConfiguration)
            ?.minimalSystemPrompt,
        },
        undefined, // todoList
        this.api.getModel().id,
        // kade_change start
        state,
        enabledSkills,
        installedSkills,
        // kade_change end
      );

      // kade_change: Dynamic Context Injection
      const dynamicReminders = [];

      if (this.luxurySpa.systemReminders.length > 0) {
        dynamicReminders.push("## Recent Edit Reminders");
        dynamicReminders.push(...this.luxurySpa.systemReminders);
      }

      if (this.luxurySpa.activeFileReads.size > 0) {
        dynamicReminders.push("## Files Currently Read in Context");
        dynamicReminders.push(
          ...Array.from(this.luxurySpa.activeFileReads.entries()).map(
            ([f, ranges]) => {
              if (ranges && ranges.length > 0) {
                const rangeStr = ranges
                  .map((r: any) => `${r.start}-${r.end}`)
                  .join(", ");
                return `- ${f} (lines ${rangeStr})`;
              }
              return `- ${f}`;
            },
          ),
        );
      }

      if (dynamicReminders.length > 0) {
        prompt += "\n" + dynamicReminders.join("\n");
      }

      // kade_change: Inject latest environment details into system prompt
      if (this.latestEnvironmentDetails) {
        prompt += "\n" + this.latestEnvironmentDetails;
      }

      return prompt;
    })();
  }

  private getCurrentProfileId(state: any): string {
    return (
      state?.listApiConfigMeta?.find(
        (profile: any) => profile.name === state?.currentApiConfigName,
      )?.id ?? "default"
    );
  }

  private async handleContextWindowExceededError(): Promise<void> {
    const state = await this.providerRef.deref()?.getState();
    const { profileThresholds = {} } = state ?? {};

    const { contextTokens } = this.getTokenUsage();
    // kade_change start: Initialize virtual quota fallback handler
    if (this.api instanceof VirtualQuotaFallbackHandler) {
      await this.api.initialize();
    }
    // kade_change end
    const modelInfo = this.api.getModel().info;

    const maxTokens = getModelMaxOutputTokens({
      modelId: this.api.getModel().id,
      model: modelInfo,
      settings: this.apiConfiguration,
    });

    const contextWindow = this.api.contextWindow ?? modelInfo.contextWindow; // kade_change: Use contextWindow from API handler if available

    // Get the current profile ID using the helper method
    const currentProfileId = this.getCurrentProfileId(state);

    // Log the context window error for debugging
    console.warn(
      `[Task#${this.taskId}] Context window exceeded for model ${this.api.getModel().id}. ` +
        `Current tokens: ${contextTokens}, Context window: ${contextWindow}. ` +
        `Forcing truncation to ${FORCED_CONTEXT_REDUCTION_PERCENT}% of current context.`,
    );

    // Determine if we're using native tool protocol for proper message handling
    const protocol = resolveToolProtocol(this.apiConfiguration, modelInfo);
    const useNativeTools = isNativeProtocol(protocol);

    // Send condenseTaskContextStarted to show in-progress indicator
    await this.providerRef
      .deref()
      ?.postMessageToWebview({
        type: "condenseTaskContextStarted",
        text: this.taskId,
      });

    // Force aggressive truncation by keeping only 75% of the conversation history
    const truncateResult = await manageContext({
      messages: this.apiConversationHistory,
      totalTokens: contextTokens || 0,
      maxTokens,
      contextWindow,
      apiHandler: this.api,
      autoCondenseContext: true,
      autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT,
      systemPrompt: await this.getSystemPrompt(),
      taskId: this.taskId,
      profileThresholds,
      currentProfileId,
      useNativeTools,
    });

    if (truncateResult.messages !== this.apiConversationHistory) {
      await this.overwriteApiConversationHistory(truncateResult.messages);
    }

    if (truncateResult.summary) {
      const {
        summary,
        cost,
        prevContextTokens,
        newContextTokens = 0,
      } = truncateResult;
      const contextCondense: ContextCondense = {
        summary,
        cost,
        newContextTokens,
        prevContextTokens,
      };
      await this.say(
        "condense_context",
        undefined /* text */,
        undefined /* images */,
        false /* partial */,
        undefined /* checkpoint */,
        undefined /* progressStatus */,
        { isNonInteractive: true } /* options */,
        contextCondense,
      );
    } else if (truncateResult.truncationId) {
      // Sliding window truncation occurred (fallback when condensing fails or is disabled)
      const contextTruncation: ContextTruncation = {
        truncationId: truncateResult.truncationId,
        messagesRemoved: truncateResult.messagesRemoved ?? 0,
        prevContextTokens: truncateResult.prevContextTokens,
        newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
      };
      await this.say(
        "sliding_window_truncation",
        undefined /* text */,
        undefined /* images */,
        false /* partial */,
        undefined /* checkpoint */,
        undefined /* progressStatus */,
        { isNonInteractive: true } /* options */,
        undefined /* contextCondense */,
        contextTruncation,
      );
    }

    // Notify webview that context management is complete (removes in-progress spinner)
    await this.providerRef
      .deref()
      ?.postMessageToWebview({
        type: "condenseTaskContextResponse",
        text: this.taskId,
      });
  }

  public async *attemptApiRequest(retryAttempt: number = 0): ApiStream {
    const state = await this.providerRef.deref()?.getState();

    const {
      apiConfiguration,
      autoApprovalEnabled,
      alwaysApproveResubmit,
      requestDelaySeconds,
      mode,
      autoCondenseContext = true,
      autoCondenseContextPercent = 100,
      profileThresholds = {},
    } = state ?? {};

    // Get condensing configuration for automatic triggers.
    const customCondensingPrompt = state?.customCondensingPrompt;
    const condensingApiConfigId = state?.condensingApiConfigId;
    const listApiConfigMeta = state?.listApiConfigMeta;

    // Determine API handler to use for condensing.
    let condensingApiHandler: ApiHandler | undefined;

    if (
      condensingApiConfigId &&
      listApiConfigMeta &&
      Array.isArray(listApiConfigMeta)
    ) {
      // Find matching config by ID
      const matchingConfig = listApiConfigMeta.find(
        (config) => config.id === condensingApiConfigId,
      );

      if (matchingConfig) {
        const profile = await this.providerRef
          .deref()
          ?.providerSettingsManager.getProfile({
            id: condensingApiConfigId,
          });

        // Ensure profile and apiProvider exist before trying to build handler.
        if (profile && profile.apiProvider) {
          condensingApiHandler = buildApiHandler(profile);
        }
      }
    }

    let rateLimitDelay = 0;

    // Use the shared timestamp so that subtasks respect the same rate-limit
    // window as their parent tasks.
    if (Task.lastGlobalApiRequestTime) {
      const now = performance.now();
      const timeSinceLastRequest = now - Task.lastGlobalApiRequestTime;
      const rateLimit = apiConfiguration?.rateLimitSeconds || 0;
      rateLimitDelay = Math.ceil(
        Math.min(
          rateLimit,
          Math.max(0, rateLimit * 1000 - timeSinceLastRequest) / 1000,
        ),
      );
    }

    // Only show rate limiting message if we're not retrying. If retrying, we'll include the delay there.
    if (rateLimitDelay > 0 && retryAttempt === 0) {
      // Show countdown timer
      for (let i = rateLimitDelay; i > 0; i--) {
        const delayMessage = `Rate limiting for ${i} seconds...`;
        await this.say("api_req_retry_delayed", delayMessage, undefined, true);
        await delay(1000);
      }
    }

    // Update last request time before making the request so that subsequent
    // requests — even from new subtasks — will honour the provider's rate-limit.
    Task.lastGlobalApiRequestTime = performance.now();

    const systemPrompt = await this.getSystemPrompt();
    const { contextTokens } = this.getTokenUsage();

    if (contextTokens) {
      // kade_change start: Initialize and adjust virtual quota fallback handler
      if (this.api instanceof VirtualQuotaFallbackHandler) {
        await this.api.initialize();
        await this.api.adjustActiveHandler("Pre-Request Adjustment");
      }
      // kade_change end
      const modelInfo = this.api.getModel().info;

      const maxTokens = getModelMaxOutputTokens({
        modelId: this.api.getModel().id,
        model: modelInfo,
        settings: this.apiConfiguration,
      });

      const contextWindow = this.api.contextWindow ?? modelInfo.contextWindow; // kade_change

      // Get the current profile ID using the helper method
      const currentProfileId = this.getCurrentProfileId(state);

      // Determine if we're using native tool protocol for proper message handling
      const modelInfoForProtocol = this.api.getModel().info;
      const protocol = resolveToolProtocol(
        this.apiConfiguration,
        modelInfoForProtocol,
      );
      const useNativeTools =
        isNativeProtocol(protocol) || protocol === "unified";

      // Check if context management will likely run (threshold check)
      // This allows us to show an in-progress indicator to the user
      // We use the centralized willManageContext helper to avoid duplicating threshold logic
      const lastMessage =
        this.apiConversationHistory[this.apiConversationHistory.length - 1];
      const lastMessageContent = lastMessage?.content;
      let lastMessageTokens = 0;
      if (lastMessageContent) {
        lastMessageTokens = Array.isArray(lastMessageContent)
          ? await this.api.countTokens(lastMessageContent)
          : await this.api.countTokens([
              { type: "text", text: lastMessageContent as string },
            ]);
      }

      const contextManagementWillRun = willManageContext({
        totalTokens: contextTokens,
        contextWindow,
        maxTokens,
        autoCondenseContext,
        autoCondenseContextPercent,
        profileThresholds,
        currentProfileId,
        lastMessageTokens,
      });

      // Send condenseTaskContextStarted BEFORE manageContext to show in-progress indicator
      // This notification must be sent here (not earlier) because the early check uses stale token count
      // (before user message is added to history), which could incorrectly skip showing the indicator
      if (contextManagementWillRun && autoCondenseContext) {
        await this.providerRef
          .deref()
          ?.postMessageToWebview({
            type: "condenseTaskContextStarted",
            text: this.taskId,
          });
      }

      const truncateResult = await manageContext({
        messages: this.apiConversationHistory,
        totalTokens: contextTokens,
        maxTokens,
        contextWindow,
        apiHandler: this.api,
        autoCondenseContext,
        autoCondenseContextPercent,
        systemPrompt,
        taskId: this.taskId,
        customCondensingPrompt,
        condensingApiHandler,
        profileThresholds,
        currentProfileId,
        useNativeTools,
      });
      if (truncateResult.messages !== this.apiConversationHistory) {
        await this.overwriteApiConversationHistory(truncateResult.messages);
      }
      if (truncateResult.error) {
        await this.say("condense_context_error", truncateResult.error);
      } else if (truncateResult.summary) {
        const {
          summary,
          cost,
          prevContextTokens,
          newContextTokens = 0,
          condenseId,
        } = truncateResult;
        const contextCondense: ContextCondense = {
          summary,
          cost,
          newContextTokens,
          prevContextTokens,
          condenseId,
        };
        await this.say(
          "condense_context",
          undefined /* text */,
          undefined /* images */,
          false /* partial */,
          undefined /* checkpoint */,
          undefined /* progressStatus */,
          { isNonInteractive: true } /* options */,
          contextCondense,
        );
      } else if (truncateResult.truncationId) {
        // Sliding window truncation occurred (fallback when condensing fails or is disabled)
        const contextTruncation: ContextTruncation = {
          truncationId: truncateResult.truncationId,
          messagesRemoved: truncateResult.messagesRemoved ?? 0,
          prevContextTokens: truncateResult.prevContextTokens,
          newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
        };
        await this.say(
          "sliding_window_truncation",
          undefined /* text */,
          undefined /* images */,
          false /* partial */,
          undefined /* checkpoint */,
          undefined /* progressStatus */,
          { isNonInteractive: true } /* options */,
          undefined /* contextCondense */,
          contextTruncation,
        );
      }

      // Notify webview that context management is complete (sets isCondensing = false)
      // This removes the in-progress spinner and allows the completed result to show
      if (contextManagementWillRun && autoCondenseContext) {
        await this.providerRef
          .deref()
          ?.postMessageToWebview({
            type: "condenseTaskContextResponse",
            text: this.taskId,
          });
      }
    }

    // Get the effective API history by filtering out condensed messages
    // This allows non-destructive condensing where messages are tagged but not deleted,
    // enabling accurate rewind operations while still sending condensed history to the API.
    // Get the effective API history by filtering out condensed messages
    // This allows non-destructive condensing where messages are tagged but not deleted,
    // enabling accurate rewind operations while still sending condensed history to the API.
    const effectiveHistory = getEffectiveApiHistory(
      this.apiConversationHistory,
    );

    // kade_change: Find the last user message before the summary to use as context anchor
    // This ensures we use the most recent user message instead of the very first one
    let lastUserMessageAnchor: ApiMessage | undefined;
    const lastSummaryIndex = this.apiConversationHistory
      .slice()
      .reverse()
      .findIndex((m) => m.isSummary);
    if (lastSummaryIndex !== -1) {
      const actualSummaryIndex =
        this.apiConversationHistory.length - 1 - lastSummaryIndex;
      lastUserMessageAnchor = this.apiConversationHistory
        .slice(0, actualSummaryIndex)
        .reverse()
        .find((m) => m.role === "user");
    }

    const messagesSinceLastSummary = getMessagesSinceLastSummary(
      effectiveHistory,
      lastUserMessageAnchor,
    );
    const messagesWithoutImages = maybeRemoveImageBlocks(
      messagesSinceLastSummary,
      this.api,
    );
    const cleanConversationHistory = this.buildCleanConversationHistory(
      messagesWithoutImages as ApiMessage[],
    );

    // kade_change start
    // Fetch project properties for KiloCode provider tracking
    const kiloConfig = this.providerRef.deref()?.getKiloConfig();
    // kade_change end

    // Check auto-approval limits
    const approvalResult = this.yoloMode
      ? { shouldProceed: true }
      : await this.autoApprovalHandler.checkAutoApprovalLimits(
          state,
          this.combineMessages(this.clineMessages.slice(1)),
          async (type, data) => this.ask(type, data),
        );

    if (!approvalResult.shouldProceed) {
      // User did not approve, task should be aborted
      throw new Error(
        "Auto-approval limit reached and user did not approve continuation",
      );
    }

    // Build complete tools array: native tools + dynamic MCP tools, filtered by mode restrictions
    const provider = this.providerRef.deref();
    if (!provider) {
      throw new Error("Provider reference lost during tool building");
    }

    const modelInfo = this.api.getModel().info;
    const toolProtocol = resolveToolProtocol(this.apiConfiguration, modelInfo);

    let allTools: any[] = [];
    // Only build native tools array when needed (not for text-based protocols)
    if (
      toolProtocol !== TOOL_PROTOCOL.UNIFIED &&
      toolProtocol !== TOOL_PROTOCOL.MARKDOWN
    ) {
      allTools = await buildNativeToolsArray({
        provider,
        cwd: this.cwd,
        mode,
        customModes: state?.customModes,
        experiments: state?.experiments,
        apiConfiguration,
        maxReadFileLine: state?.maxReadFileLine ?? -1,
        browserToolEnabled: state?.browserToolEnabled ?? true,
        // kade_change start
        state,
        // kade_change end
        modelInfo,
        diffEnabled: this.diffEnabled,
        enableSubAgents: this.enableSubAgents,
      });
    }

    // Determine if we should include native tools based on:
    // 1. Tool protocol is set to NATIVE
    // 2. Model supports native tools
    const shouldIncludeTools =
      toolProtocol === TOOL_PROTOCOL.MARKDOWN &&
      (modelInfo.supportsNativeTools ?? false);

    // Parallel tool calls are disabled - feature is on hold
    // Previously resolved from experiments.isEnabled(..., EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS)
    const parallelToolCallsEnabled = false;

    const metadata: ApiHandlerCreateMessageMetadata = {
      mode: mode,
      taskId: this.taskId,
      suppressPreviousResponseId: this.skipPrevResponseIdOnce,
      toolProtocol, // Include protocol for all requests
      // Include tools when using native protocol and model supports it
      ...(shouldIncludeTools
        ? {
            tools: allTools,
            tool_choice: "auto",
            parallelToolCalls: parallelToolCallsEnabled,
          }
        : toolProtocol !== TOOL_PROTOCOL.UNIFIED &&
            toolProtocol !== TOOL_PROTOCOL.MARKDOWN
          ? { tool_manifest: allTools }
          : {}), // In XML/Unified/Markdown mode, tool manifest is handled via system prompt
      projectId: (await kiloConfig)?.project?.id, // kade_change: pass projectId for backend tracking (ignored by other providers)
    };

    // Create an AbortController to allow cancelling the request mid-stream
    this.currentRequestAbortController = new AbortController();
    const abortSignal = this.currentRequestAbortController.signal;
    // Reset the flag after using it
    this.skipPrevResponseIdOnce = false;

    // The provider accepts reasoning items alongside standard messages; cast to the expected parameter type.
    const stream = this.api.createMessage(
      systemPrompt,
      cleanConversationHistory as unknown as Anthropic.Messages.MessageParam[],
      metadata,
    );
    const iterator = stream[Symbol.asyncIterator]();

    // Set up abort handling - store listener reference for cleanup
    // to avoid accumulating listeners on the AbortSignal
    const abortCleanupListener = () => {
      console.log(
        `[Task#${this.taskId}.${this.instanceId}] AbortSignal triggered for current request`,
      );
      this.currentRequestAbortController = undefined;
    };
    abortSignal.addEventListener("abort", abortCleanupListener);

    // Create a single abort promise/listener for racing with first chunk
    // to avoid accumulating listeners per attempt
    let firstChunkAbortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (abortSignal.aborted) {
        reject(new Error("Request cancelled by user"));
      } else {
        firstChunkAbortListener = () =>
          reject(new Error("Request cancelled by user"));
        abortSignal.addEventListener("abort", firstChunkAbortListener);
      }
    });

    const cleanupRequestResources = async (abortInFlight: boolean = false) => {
      if (
        abortInFlight &&
        this.currentRequestAbortController &&
        !abortSignal.aborted
      ) {
        this.currentRequestAbortController.abort();
      }

      abortSignal.removeEventListener("abort", abortCleanupListener);
      if (firstChunkAbortListener) {
        abortSignal.removeEventListener("abort", firstChunkAbortListener);
      }

      if (typeof iterator.return === "function") {
        try {
          await iterator.return(undefined);
        } catch {
          // ignore iterator cleanup failures during retry/abort cleanup
        }
      }

      if (this.currentRequestAbortController?.signal === abortSignal) {
        this.currentRequestAbortController = undefined;
      }
    };

    try {
      // Awaiting first chunk to see if it will throw an error.
      this.isWaitingForFirstChunk = true;

      // Race between the first chunk and the abort signal
      const firstChunkPromise = iterator.next();

      // Optimize: Use a faster timeout check for first chunk to reduce latency
      const firstChunk = await Promise.race([
        firstChunkPromise,
        abortPromise,
        // Add a shorter timeout specifically for first chunk to detect hanging connections
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("First chunk timeout")),
            getFirstChunkTimeout(),
          ),
        ),
      ]);
      yield firstChunk.value;
      this.isWaitingForFirstChunk = false;
    } catch (error) {
      this.isWaitingForFirstChunk = false;

      // If the Request was aborted (i.e. stop button), throw immediately so AgentLoop handles it cleanly
      if (
        error.name === "AbortError" ||
        error.message?.includes("Abort") ||
        error.message?.includes("cancelled by user")
      ) {
        throw error;
      }

      // Fast-path: Skip complex error processing for timeout errors
      if (error.message === "First chunk timeout") {
        console.warn(`[Task#${this.taskId}] First chunk timeout, retrying...`);
        await cleanupRequestResources(true);
        if (retryAttempt < 3) {
          yield* this.attemptApiRequest(retryAttempt + 1);
          return;
        }
        throw new Error("Connection timeout - please check your network");
      }

      // kade_change start
      if (
        apiConfiguration?.apiProvider === "kilocode" &&
        isAnyRecognizedKiloCodeError(error)
      ) {
        const { response } = await (isPaymentRequiredError(error)
          ? this.ask(
              "payment_required_prompt",
              JSON.stringify({
                title:
                  error.error?.title ?? t("kilocode:lowCreditWarning.title"),
                message:
                  error.error?.message ??
                  t("kilocode:lowCreditWarning.message"),
                balance: error.error?.balance ?? "0.00",
                buyCreditsUrl:
                  error.error?.buyCreditsUrl ?? getAppUrl("/profile"),
              }),
            )
          : this.ask(
              "invalid_model",
              JSON.stringify({
                modelId: apiConfiguration.kilocodeModel,
                error: {
                  status: error.status,
                  message: error.message,
                },
              }),
            ));
        this.currentRequestAbortController = undefined;
        const isContextWindowExceededError =
          checkContextWindowExceededError(error);

        if (response === "retry_clicked") {
          yield* this.attemptApiRequest(retryAttempt + 1);
        } else {
          // Handle other responses or cancellations if necessary
          // If the user cancels the dialog, we should probably abort.
          throw error; // Rethrow to signal failure upwards
        }
        return;
      }
      // kade_change end
      // note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.
      if (autoApprovalEnabled && alwaysApproveResubmit) {
        let errorMsg;

        if (error.error?.metadata?.raw) {
          errorMsg = JSON.stringify(error.error.metadata.raw, null, 2);
        } else if (error.message) {
          errorMsg = error.message;
        } else {
          errorMsg = "Unknown error";
        }

        // Apply shared exponential backoff and countdown UX
        await this.backoffAndAnnounce(retryAttempt, error, errorMsg);

        // CRITICAL: Check if task was aborted during the backoff countdown
        // This prevents infinite loops when users cancel during auto-retry
        // Without this check, the recursive call below would continue even after abort
        if (this.abort) {
          throw new Error(
            `[Task#attemptApiRequest] task ${this.taskId}.${this.instanceId} aborted during retry`,
          );
        }

        // Delegate generator output from the recursive call with
        // incremented retry count.
        yield* this.attemptApiRequest(retryAttempt + 1);

        return;
      } else {
        const { response } = await this.ask(
          "api_req_failed",
          error.message ?? JSON.stringify(serializeError(error), null, 2),
        );

        if (response !== "yesButtonClicked") {
          // This will never happen since if noButtonClicked, we will
          // clear current task, aborting this instance.
          throw new Error("API request failed");
        }

        await this.say("api_req_retried");

        // Delegate generator output from the recursive call.
        yield* this.attemptApiRequest();
        return;
      }
    }

    // No error, so we can continue to yield all remaining chunks.
    // (Needs to be placed outside of try/catch since it we want caller to
    // handle errors not with api_req_failed as that is reserved for first
    // chunk failures only.)
    // This delegates to another generator or iterable object. In this case,
    // it's saying "yield all remaining values from this iterator". This
    // effectively passes along all subsequent chunks from the original
    // stream.
    yield* iterator;

    // kade_change start
    if (apiConfiguration?.rateLimitAfter) {
      Task.lastGlobalApiRequestTime = performance.now();
    }
    // kade_change end

    await cleanupRequestResources();
  }

  // Shared exponential backoff for retries (first-chunk and mid-stream)
  private async backoffAndAnnounce(
    retryAttempt: number,
    error: any,
    header?: string,
  ): Promise<void> {
    try {
      const state = await this.providerRef.deref()?.getState();
      const baseDelay = state?.requestDelaySeconds || 5;

      let exponentialDelay = Math.min(
        Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
        MAX_EXPONENTIAL_BACKOFF_SECONDS,
      );

      // Respect provider rate limit window
      let rateLimitDelay = 0;
      const rateLimit = state?.apiConfiguration?.rateLimitSeconds || 0;
      if (Task.lastGlobalApiRequestTime && rateLimit > 0) {
        const elapsed = performance.now() - Task.lastGlobalApiRequestTime;
        rateLimitDelay = Math.ceil(
          Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000),
        );
      }

      // Prefer RetryInfo on 429 if present
      if (error?.status === 429) {
        const retryInfo = error?.errorDetails?.find(
          (d: Record<string, unknown>) =>
            d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
        );
        const match = retryInfo?.retryDelay?.match?.(/^(\d+)s$/);
        if (match) {
          exponentialDelay = Number(match[1]) + 1;
        }
      }

      const finalDelay = Math.max(exponentialDelay, rateLimitDelay);
      if (finalDelay <= 0) return;

      // Build header text; fall back to error message if none provided
      let headerText;
      if (error.status) {
        // This sets the message as just the error code, for which
        // ChatRow knows how to handle and use an i18n'd error string
        // In development, hardcode headerText to an HTTP status code to check it
        headerText = error.status;
      } else if (error?.message) {
        headerText = error.message;
      } else {
        headerText = "Unknown error";
      }

      headerText = headerText ? `${headerText}\n` : "";

      // Show countdown timer with exponential backoff
      for (let i = finalDelay; i > 0; i--) {
        // Check abort flag during countdown to allow early exit
        if (this.abort) {
          throw new Error(
            `[Task#${this.taskId}] Aborted during retry countdown`,
          );
        }

        await this.say(
          "api_req_retry_delayed",
          `${headerText}<retry_timer>${i}</retry_timer>`,
          undefined,
          true,
        );
        await delay(1000);
      }

      await this.say("api_req_retry_delayed", headerText, undefined, false);
    } catch (err) {
      console.error("Exponential backoff failed:", err);
    }
  }

  // Checkpoints

  public async checkpointSave(
    force: boolean = false,
    suppressMessage: boolean = false,
  ) {
    return checkpointSave(this, force, suppressMessage);
  }

  private buildCleanConversationHistory(
    messages: ApiMessage[],
  ): Array<
    | Anthropic.Messages.MessageParam
    | {
        type: "reasoning";
        encrypted_content: string;
        id?: string;
        summary?: Record<string, unknown>[];
      }
  > {
    type ReasoningItemForRequest = {
      type: "reasoning";
      encrypted_content: string;
      id?: string;
      summary?: Record<string, unknown>[];
    };

    const cleanConversationHistory: (
      | Anthropic.Messages.MessageParam
      | ReasoningItemForRequest
    )[] = [];

    for (const msg of messages) {
      // Standalone reasoning: send encrypted, skip plain text
      if (msg.type === "reasoning") {
        if (msg.encrypted_content) {
          cleanConversationHistory.push({
            type: "reasoning",
            summary: msg.summary,
            encrypted_content: msg.encrypted_content!,
            ...(msg.id ? { id: msg.id } : {}),
          });
        }
        continue;
      }

      // Preferred path: assistant message with embedded reasoning as first content block
      if (msg.role === "assistant") {
        const rawContent = msg.content;

        const contentArray: Anthropic.Messages.ContentBlockParam[] =
          Array.isArray(rawContent)
            ? (rawContent as Anthropic.Messages.ContentBlockParam[])
            : rawContent !== undefined
              ? ([
                  {
                    type: "text",
                    text: rawContent,
                  } satisfies Anthropic.Messages.TextBlockParam,
                ] as Anthropic.Messages.ContentBlockParam[])
              : [];

        const [first, ...rest] = contentArray;

        // Check if first content block is reasoning
        const hasEncryptedReasoning =
          first &&
          (first as any).type === "reasoning" &&
          "encrypted_content" in first;
        const hasPlainTextReasoning =
          first && (first as any).type === "reasoning" && "reasoning" in first;

        // Check if this message has reasoning_details (OpenRouter format for Gemini 3, etc.)
        const msgWithDetails = msg;
        if (
          msgWithDetails.reasoning_details &&
          Array.isArray(msgWithDetails.reasoning_details)
        ) {
          // Build the assistant message with reasoning_details
          let assistantContent: Anthropic.Messages.MessageParam["content"];

          if (contentArray.length === 0) {
            assistantContent = "";
          } else if (
            contentArray.length === 1 &&
            contentArray[0].type === "text"
          ) {
            assistantContent = (
              contentArray[0] as Anthropic.Messages.TextBlockParam
            ).text;
          } else {
            assistantContent = contentArray;
          }

          // Create message with reasoning_details property
          cleanConversationHistory.push({
            role: "assistant",
            content: assistantContent,
            reasoning_details: msgWithDetails.reasoning_details,
          } as any);

          continue;
        } else if (hasEncryptedReasoning) {
          const reasoningBlock = first as unknown as {
            type: "reasoning";
            encrypted_content: string;
            id?: string;
          };

          // Send as separate reasoning item (OpenAI Native)
          cleanConversationHistory.push({
            role: "assistant",
            content: [
              {
                type: "reasoning",
                encrypted_content: reasoningBlock.encrypted_content,
                ...(reasoningBlock.id ? { id: reasoningBlock.id } : {}),
              } satisfies ReasoningItemForRequest,
              ...rest,
            ],
          } as any);
          continue;
        } else if (hasPlainTextReasoning) {
          // Check if the model's preserveReasoning flag is set
          // If true, include the reasoning block in API requests
          // If false/undefined, strip it out (stored for history only, not sent back to API)
          const shouldPreserveForApi =
            this.api.getModel().info.preserveReasoning === true;
          let assistantContent: Anthropic.Messages.MessageParam["content"];

          if (shouldPreserveForApi) {
            // Include reasoning block in the content sent to API
            assistantContent = contentArray;
          } else {
            // Strip reasoning out - stored for history only, not sent back to API
            if (rest.length === 0) {
              assistantContent = "";
            } else if (rest.length === 1 && rest[0].type === "text") {
              assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam)
                .text;
            } else {
              assistantContent = rest;
            }
          }

          cleanConversationHistory.push({
            role: "assistant",
            content: assistantContent,
          } satisfies Anthropic.Messages.MessageParam);

          continue;
        }
      }

      // Default path for regular messages (no embedded reasoning)
      if (msg.role) {
        cleanConversationHistory.push({
          role: msg.role,
          content: msg.content as
            | Anthropic.Messages.ContentBlockParam[]
            | string,
        });
      }
    }

    return cleanConversationHistory;
  }
  public async checkpointRestore(options: CheckpointRestoreOptions) {
    return checkpointRestore(this, options);
  }

  public async checkpointDiff(options: CheckpointDiffOptions) {
    return checkpointDiff(this, options);
  }

  // Metrics

  public combineMessages(messages: ClineMessage[]) {
    return combineApiRequests(combineCommandSequences(messages));
  }

  public getTokenUsage(): TokenUsage {
    return getApiMetrics(this.combineMessages(this.clineMessages.slice(1)));
  }

  public recordToolUsage(toolName: ToolName) {
    if (!this.toolUsage[toolName]) {
      this.toolUsage[toolName] = { attempts: 0, failures: 0 };
    }

    this.toolUsage[toolName].attempts++;
  }

  public recordToolError(toolName: ToolName, error?: string) {
    if (!this.toolUsage[toolName]) {
      this.toolUsage[toolName] = { attempts: 0, failures: 0 };
    }

    this.toolUsage[toolName].failures++;

    if (error) {
      this.emit(RooCodeEventName.TaskToolFailed, this.taskId, toolName, error);
    }
    TelemetryService.instance.captureEvent(TelemetryEventName.TOOL_ERROR, {
      toolName,
      error,
    }); // kade_change
  }

  // Getters

  public get taskStatus(): TaskStatus {
    if (this.interactiveAsk) {
      return TaskStatus.Interactive;
    }

    if (this.resumableAsk) {
      return TaskStatus.Resumable;
    }

    if (this.idleAsk) {
      return TaskStatus.Idle;
    }

    return TaskStatus.Running;
  }

  public get taskAsk(): ClineMessage | undefined {
    return this.idleAsk || this.resumableAsk || this.interactiveAsk;
  }

  public get queuedMessages(): QueuedMessage[] {
    return this.messageQueueService.messages;
  }

  public get tokenUsage(): TokenUsage | undefined {
    if (this.tokenUsageSnapshot && this.tokenUsageSnapshotAt) {
      return this.tokenUsageSnapshot;
    }

    this.tokenUsageSnapshot = this.getTokenUsage();
    this.tokenUsageSnapshotAt = this.clineMessages.at(-1)?.ts;

    return this.tokenUsageSnapshot;
  }

  public get cwd() {
    return this.workspacePath;
  }

  /**
   * Provides convenient access to high-level message operations.
   * Uses lazy initialization - the MessageManager is only created when first accessed.
   * Subsequent accesses return the same cached instance.
   *
   * ## Important: Single Coordination Point
   *
   * **All MessageManager operations must go through this getter** rather than
   * instantiating `new MessageManager(task)` directly. This ensures:
   * - A single shared instance for consistent behavior
   * - Centralized coordination of all rewind/message operations
   * - Ability to add internal state or instrumentation in the future
   *
   * @example
   * ```typescript
   * // Correct: Use the getter
   * await task.messageManager.rewindToTimestamp(ts)
   *
   * // Incorrect: Do NOT create new instances directly
   * // const manager = new MessageManager(task) // Don't do this!
   * ```
   */
  get messageManager(): MessageManager {
    if (!this._messageManager) {
      this._messageManager = new MessageManager(this);
    }
    return this._messageManager;
  }

  /**
   * Broadcast browser session updates to the browser panel (if open)
   */
  private broadcastBrowserSessionUpdate(): void {
    const provider = this.providerRef.deref();
    if (!provider) {
      return;
    }

    try {
      const {
        BrowserSessionPanelManager,
      } = require("../webview/BrowserSessionPanelManager");
      const panelManager = BrowserSessionPanelManager.getInstance(provider);

      // Get browser session messages
      const browserSessionStartIndex = this.clineMessages.findIndex(
        (m) =>
          m.ask === "browser_action_launch" ||
          (m.say === "browser_session_status" && m.text?.includes("opened")),
      );

      const browserSessionMessages =
        browserSessionStartIndex !== -1
          ? this.clineMessages.slice(browserSessionStartIndex)
          : [];

      const isBrowserSessionActive =
        this.browserSession?.isSessionActive() ?? false;
      panelManager.updateBrowserSession(
        browserSessionMessages,
        isBrowserSessionActive,
      );
    } catch (error) {
      console.error(
        "[Task] Failed to broadcast browser session update:",
        error,
      );
    }
  }

  private broadcastLiveScreenshot(screenshot: string): void {
    const provider = this.providerRef.deref();
    if (!provider) return;

    try {
      const {
        BrowserSessionPanelManager,
      } = require("../webview/BrowserSessionPanelManager");
      const panelManager = BrowserSessionPanelManager.getInstance(provider);
      panelManager.updateLiveScreenshot(screenshot);
    } catch (error) {
      console.error("[Task] Failed to broadcast live screenshot:", error);
    }
  }

  /**
   * Process any queued messages by dequeuing and submitting them.
   * This ensures that queued user messages are sent when appropriate,
   * preventing them from getting stuck in the queue.
   *
   * @param context - Context string for logging (e.g., the calling tool name)
   */
  public processQueuedMessages(): void {
    try {
      if (!this.messageQueueService.isEmpty()) {
        const queued = this.messageQueueService.dequeueMessage();
        if (queued) {
          // Clear any existing timeout first
          this.cancelQueuedMessageTimeout();

          // Track the timeout so it can be cancelled on dispose
          this.queuedMessageTimeoutRef = setTimeout(() => {
            this.queuedMessageTimeoutRef = undefined;
            this.submitUserMessage(queued.text, queued.images).catch((err) =>
              console.error(`[Task] Failed to submit queued message:`, err),
            );
          }, 0);
        }
      }
    } catch (e) {
      console.error(`[Task] Queue processing error:`, e);
    }
  }

  // kade_change start: Dynamic Context Helpers
  public addSystemReminder(reminder: string, filePath?: string) {
    this.luxurySpa.addSystemReminder(reminder, filePath);
  }

  public async updateFileContext(
    filePath: string,
    lineRanges?: { start: number; end: number }[],
  ) {
    await this.luxurySpa.updateFileContext(filePath, lineRanges);
  }

  public async updateStaleReads(filePath: string) {
    await this.luxurySpa.updateStaleReads(filePath);
  }

  public stripFileContextSync(filePath: string) {
    this.luxurySpa.stripFileContextSync(filePath);
  }

  public pruneEnvironmentDetailsFromHistory() {
    this.luxurySpa.pruneEnvironmentDetailsFromHistory();
  }

  public pruneTerminalOutputFromHistory() {
    this.luxurySpa.pruneTerminalOutputFromHistory();
  }

  public async postStateToWebview() {
    const provider = this.providerRef.deref();
    if (provider) {
      await provider.postStateToWebview();
    }
  }
}
