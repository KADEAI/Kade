import os from "os";
import * as path from "path";
import fs from "fs/promises";
import EventEmitter from "events";

import { Anthropic } from "@anthropic-ai/sdk";
import delay from "delay";
import axios from "axios";
import debounce from "lodash.debounce";
import pWaitFor from "p-wait-for";
import * as vscode from "vscode";

import {
  type TaskProviderLike,
  type TaskProviderEvents,
  type GlobalState,
  type ProviderName,
  type ProviderSettings,
  type RooCodeSettings,
  type ProviderSettingsEntry,
  type StaticAppProperties,
  type DynamicAppProperties,
  type CloudAppProperties,
  type TaskProperties,
  type GitProperties,
  type TelemetryProperties,
  type TelemetryPropertiesProvider,
  type CodeActionId,
  type CodeActionName,
  type TerminalActionId,
  type TerminalActionPromptType,
  type HistoryItem,
  type CloudUserInfo,
  type CloudOrganizationMembership,
  type CreateTaskOptions,
  type TokenUsage,
  type ToolUsage,
  RooCodeEventName,
  TelemetryEventName, // kilocode_change
  requestyDefaultModelId,
  openRouterDefaultModelId,
  glamaDefaultModelId, // kilocode_change
  DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
  DEFAULT_WRITE_DELAY_MS,
  ORGANIZATION_ALLOW_ALL,
  DEFAULT_MODES,
  DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
  getModelId,
} from "@roo-code/types";
import { TelemetryService } from "@roo-code/telemetry";
import {
  CloudService,
  BridgeOrchestrator,
  getRooCodeApiUrl,
} from "@roo-code/cloud";

import { Package } from "../../shared/package";
import { findLast } from "../../shared/array";
import { supportPrompt } from "../../shared/support-prompt";
import { GlobalFileNames } from "../../shared/globalFileNames";
import type {
  ExtensionMessage,
  ExtensionState,
  MarketplaceInstalledMetadata,
} from "../../shared/ExtensionMessage";
import { Mode, defaultModeSlug, getModeBySlug } from "../../shared/modes";
import { experimentDefault } from "../../shared/experiments";
import { formatLanguage } from "../../shared/language";
import { WebviewMessage } from "../../shared/WebviewMessage";
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels";
import { ProfileValidator } from "../../shared/ProfileValidator";

import { Terminal } from "../../integrations/terminal/Terminal";
import { downloadTask } from "../../integrations/misc/export-markdown";
import { getTheme } from "../../integrations/theme/getTheme";
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker";

import { McpHub } from "../../services/mcp/McpHub";
import { McpServerManager } from "../../services/mcp/McpServerManager";
import { MarketplaceManager } from "../../services/marketplace";
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService";
import { CodeIndexManager } from "../../services/code-index/manager";
import type { IndexProgressUpdate } from "../../services/code-index/interfaces/manager";
import { MdmService } from "../../services/mdm/MdmService";
import { SessionManager } from "../../shared/kilocode/cli-sessions/core/SessionManager";
import { TaskHistoryStorage } from "../../services/task-history/TaskHistoryStorage";

import { fileExistsAtPath } from "../../utils/fs";
import { setTtsEnabled, setTtsSpeed } from "../../utils/tts";
import { getWorkspaceGitInfo } from "../../utils/git";
import { getWorkspacePath } from "../../utils/path";
import { OrganizationAllowListViolationError } from "../../utils/errors";

import { setPanel } from "../../activate/panelUtils";

import { t } from "../../i18n";

import { buildApiHandler } from "../../api";
import {
  forceFullModelDetailsLoad,
  hasLoadedFullDetails,
} from "../../api/providers/fetchers/lmstudio";

import { ContextProxy } from "../config/ContextProxy";
import { getEnabledRules } from "./kilorules";
import { ProviderSettingsManager } from "../config/ProviderSettingsManager";
import { CustomModesManager } from "../config/CustomModesManager";
import { Task } from "../task/Task";
import { getSystemPromptFilePath } from "../prompts/sections/custom-system-prompt";

import { webviewMessageHandler } from "./webviewMessageHandler";
import { checkSpeechToTextAvailable } from "./speechToTextCheck"; // kilocode_change
import type { ClineMessage, TodoItem } from "@roo-code/types";
import {
  readApiMessages,
  saveApiMessages,
  saveTaskMessages,
} from "../task-persistence";
import { readTaskMessages } from "../task-persistence/taskMessages";
import { getNonce } from "./getNonce";
import { getUri } from "./getUri";
import { generateSystemPrompt } from "./generateSystemPrompt";
import { openAiCodexOAuthManager } from "../../integrations/openai-codex/oauth";
import { antigravityOAuthManager } from "../../integrations/antigravity/oauth";
import { claudeCodeOAuthManager } from "../../integrations/claude-code/oauth";
import { REQUESTY_BASE_URL } from "../../shared/utils/requesty";

import {
  geminiOAuthManager,
  GeminiOAuthManager,
} from "../../integrations/gemini/oauth";

//kilocode_change start
import {
  McpDownloadResponse,
  McpMarketplaceCatalog,
} from "../../shared/kilocode/mcp";
import { McpServer } from "../../shared/mcp";
import { OpenRouterHandler } from "../../api/providers";
import { stringifyError } from "../../shared/kilocode/errorUtils";
import isWsl from "is-wsl";
import { getKilocodeDefaultModel } from "../../api/providers/kilocode/getKilocodeDefaultModel";
import { getKiloCodeWrapperProperties } from "../../core/kilocode/wrapper";
import {
  getKilocodeConfig,
  KilocodeConfig,
} from "../../utils/kilo-config-file";
import { resolveToolProtocol } from "../../utils/resolveToolProtocol";
import { kilo_execIfExtension } from "../../shared/kilocode/cli-sessions/extension/session-manager-utils";
import { DeviceAuthHandler } from "../kilocode/webview/deviceAuthHandler";

export type ClineProviderState = Awaited<ReturnType<ClineProvider["getState"]>>;
// kilocode_change end

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

export type ClineProviderEvents = {
  clineCreated: [cline: Task];
};

interface PendingEditOperation {
  messageTs: number;
  editedContent: string;
  images?: string[];
  messageIndex: number;
  apiConversationHistoryIndex: number;
  timeoutId: NodeJS.Timeout;
  createdAt: number;
}

export class ClineProvider
  extends EventEmitter<TaskProviderEvents>
  implements
    vscode.WebviewViewProvider,
    TelemetryPropertiesProvider,
    TaskProviderLike
{
  // Used in package.json as the view's id. This value cannot be changed due
  // to how VSCode caches views based on their id, and updating the id would
  // break existing instances of the extension.
  public static readonly sideBarId = `${Package.name}.SidebarProvider`;
  public static readonly tabPanelId = `${Package.name}.TabPanelProvider`;
  private static activeInstances: Set<ClineProvider> = new Set();
  private disposables: vscode.Disposable[] = [];
  private webviewDisposables: vscode.Disposable[] = [];
  private view?: vscode.WebviewView | vscode.WebviewPanel;
  private clineStack: Task[] = [];
  private codeIndexStatusSubscription?: vscode.Disposable;
  private codeIndexManager?: CodeIndexManager;
  private _workspaceTracker?: WorkspaceTracker; // workSpaceTracker read-only for access outside this class
  protected mcpHub?: McpHub; // Change from private to protected
  private marketplaceManager: MarketplaceManager;
  private mdmService?: MdmService;
  private taskCreationCallback: (task: Task) => void;
  private taskEventListeners: WeakMap<Task, Array<() => void>> = new WeakMap();
  private currentWorkspacePath: string | undefined;
  private autoPurgeScheduler?: any; // kilocode_change - (Any) Prevent circular import
  private deviceAuthHandler?: DeviceAuthHandler; // kilocode_change - Device auth handler
  private infinityInterval?: NodeJS.Timeout;

  private recentTasksCache?: string[];
  private stateSnapshotPromise?: Promise<ClineProviderState>;
  private lastPostedStateSignature?: string;
  private lastPostedTaskId?: string;
  private isPostingState = false;
  private pendingPostStateRequest = false;
  private pendingOperations: Map<string, PendingEditOperation> = new Map();
  private runningTasks: Map<string, Task> = new Map(); // kilocode_change: track running tasks
  private savedHomeProfileName?: string; // kilocode_change: Stash the home page profile before entering a chat
  private static readonly PENDING_OPERATION_TIMEOUT_MS = 30000; // 30 seconds

  private cloudOrganizationsCache: CloudOrganizationMembership[] | null = null;
  private cloudOrganizationsCacheTimestamp: number | null = null;
  private static readonly CLOUD_ORGANIZATIONS_CACHE_DURATION_MS = 30 * 1000; // 30 seconds - increased from 5s to reduce network overhead

  private taskHistoryStorage?: TaskHistoryStorage; // kilocode_change: disk-based task history storage
  private taskHistoryStorageReady: Promise<void>; // kilocode_change: promise that resolves when storage is ready

  public isViewLaunched = false;
  public settingsImportedAt?: number;
  public readonly latestAnnouncementId =
    "dec-2025-v3.36.0-context-rewind-roo-provider"; // v3.36.0 Context Rewind & Roo Provider Improvements
  public readonly providerSettingsManager: ProviderSettingsManager;
  public readonly customModesManager: CustomModesManager;

  constructor(
    readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly renderContext: "sidebar" | "editor" = "sidebar",
    public readonly contextProxy: ContextProxy,
    mdmService?: MdmService,
  ) {
    super();
    this.currentWorkspacePath = getWorkspacePath();

    ClineProvider.activeInstances.add(this);

    this.mdmService = mdmService;
    this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES);

    // Start configuration loading (which might trigger indexing) in the background.
    // Don't await, allowing activation to continue immediately.

    // Register this provider with the telemetry service to enable it to add
    // properties like mode and provider.
    TelemetryService.instance.setProvider(this);

    this.providerSettingsManager = new ProviderSettingsManager(this.context);

    this.customModesManager = new CustomModesManager(this.context, async () => {
      await this.postStateToWebview();
    });

    this._workspaceTracker = new WorkspaceTracker(this);

    openAiCodexOAuthManager.initialize(this.context);
    antigravityOAuthManager.initialize(this.context);
    claudeCodeOAuthManager.initialize(this.context);

    // Initialize MCP Hub through the singleton manager

    McpServerManager.getInstance(this.context, this)
      .then((hub) => {
        this.mcpHub = hub;
        this.mcpHub.registerClient();
      })
      .catch((error) => {
        this.log(`Failed to initialize MCP Hub: ${error}`);
      });

    this.marketplaceManager = new MarketplaceManager(
      this.context,
      this.customModesManager,
    );

    // kilocode_change: Initialize disk-based task history storage eagerly
    // This must complete before any task operations to prevent writing to globalState
    this.taskHistoryStorageReady = this.initializeTaskHistoryStorage();

    // Forward <most> task events to the provider.
    // We do something fairly similar for the IPC-based API.
    this.taskCreationCallback = (instance: Task) => {
      this.emit(RooCodeEventName.TaskCreated, instance);

      // Create named listener functions so we can remove them later.
      const onTaskStarted = () => {
        this.debouncedPostStateToWebview(); // kilocode_change: debounce to avoid rapid state rebuilds
        this.emit(RooCodeEventName.TaskStarted, instance.taskId);
      };
      const onTaskCompleted = (
        taskId: string,
        tokenUsage: TokenUsage,
        toolUsage: ToolUsage,
      ) => {
        kilo_execIfExtension(() => {
          SessionManager.init()?.doSync(true);
        });

        this.runningTasks.delete(taskId); // kilocode_change
        this.debouncedPostStateToWebview(); // kilocode_change: debounce to avoid rapid state rebuilds
        return this.emit(
          RooCodeEventName.TaskCompleted,
          taskId,
          tokenUsage,
          toolUsage,
        ); // kilocode_change: return
      };
      const onTaskAborted = async () => {
        this.runningTasks.delete(instance.taskId); // kilocode_change
        this.debouncedPostStateToWebview(); // kilocode_change: debounce to avoid rapid state rebuilds
        this.emit(RooCodeEventName.TaskAborted, instance.taskId);

        // kilocode_change: Removed automatic rehydration on streaming failure.
        // This was causing "zombie" tasks to keep coming back to life every few minutes
        // when background network/API errors occurred. Users should manually retry.
      };
      const onTaskFocused = () =>
        this.emit(RooCodeEventName.TaskFocused, instance.taskId);
      const onTaskUnfocused = () =>
        this.emit(RooCodeEventName.TaskUnfocused, instance.taskId);
      const onTaskActive = (taskId: string) => {
        this.runningTasks.set(taskId, instance); // kilocode_change
        this.debouncedPostStateToWebview(); // kilocode_change: debounce to avoid rapid state rebuilds
        this.emit(RooCodeEventName.TaskActive, taskId);
      };
      const onTaskInteractive = (taskId: string) =>
        this.emit(RooCodeEventName.TaskInteractive, taskId);
      const onTaskResumable = (taskId: string) =>
        this.emit(RooCodeEventName.TaskResumable, taskId);
      const onTaskIdle = (taskId: string) => {
        this.runningTasks.delete(taskId); // kilocode_change
        this.debouncedPostStateToWebview(); // kilocode_change: debounce to avoid rapid state rebuilds
        this.emit(RooCodeEventName.TaskIdle, taskId);
      };
      const onTaskPaused = (taskId: string) =>
        this.emit(RooCodeEventName.TaskPaused, taskId);
      const onTaskUnpaused = (taskId: string) =>
        this.emit(RooCodeEventName.TaskUnpaused, taskId);
      const onTaskSpawned = (taskId: string) =>
        this.emit(RooCodeEventName.TaskSpawned, taskId);
      const onTaskUserMessage = (taskId: string) =>
        this.emit(RooCodeEventName.TaskUserMessage, taskId);
      const onTaskTokenUsageUpdated = (
        taskId: string,
        tokenUsage: TokenUsage,
        toolUsage: ToolUsage,
      ) =>
        this.emit(
          RooCodeEventName.TaskTokenUsageUpdated,
          taskId,
          tokenUsage,
          toolUsage,
        );
      const onModelChanged = () => this.postStateToWebview(); // kilocode_change: Listen for model changes in virtual quota fallback

      // Attach the listeners.
      instance.on(RooCodeEventName.TaskStarted, onTaskStarted);
      instance.on(RooCodeEventName.TaskCompleted, onTaskCompleted);
      instance.on(RooCodeEventName.TaskAborted, onTaskAborted);
      instance.on(RooCodeEventName.TaskFocused, onTaskFocused);
      instance.on(RooCodeEventName.TaskUnfocused, onTaskUnfocused);
      instance.on(RooCodeEventName.TaskActive, onTaskActive);
      instance.on(RooCodeEventName.TaskInteractive, onTaskInteractive);
      instance.on(RooCodeEventName.TaskResumable, onTaskResumable);
      instance.on(RooCodeEventName.TaskIdle, onTaskIdle);
      instance.on(RooCodeEventName.TaskPaused, onTaskPaused);
      instance.on(RooCodeEventName.TaskUnpaused, onTaskUnpaused);
      instance.on(RooCodeEventName.TaskSpawned, onTaskSpawned);
      instance.on(RooCodeEventName.TaskUserMessage, onTaskUserMessage);
      instance.on(
        RooCodeEventName.TaskTokenUsageUpdated,
        onTaskTokenUsageUpdated,
      );
      instance.on("modelChanged", onModelChanged); // kilocode_change: Listen for model changes in virtual quota fallback

      // Store the cleanup functions for later removal.
      this.taskEventListeners.set(instance, [
        () => instance.off(RooCodeEventName.TaskStarted, onTaskStarted),
        () => instance.off(RooCodeEventName.TaskCompleted, onTaskCompleted),
        () => instance.off(RooCodeEventName.TaskAborted, onTaskAborted),
        () => instance.off(RooCodeEventName.TaskFocused, onTaskFocused),
        () => instance.off(RooCodeEventName.TaskUnfocused, onTaskUnfocused),
        () => instance.off(RooCodeEventName.TaskActive, onTaskActive),
        () => instance.off(RooCodeEventName.TaskInteractive, onTaskInteractive),
        () => instance.off(RooCodeEventName.TaskResumable, onTaskResumable),
        () => instance.off(RooCodeEventName.TaskIdle, onTaskIdle),
        () => instance.off(RooCodeEventName.TaskUserMessage, onTaskUserMessage),
        () => instance.off(RooCodeEventName.TaskPaused, onTaskPaused),
        () => instance.off(RooCodeEventName.TaskUnpaused, onTaskUnpaused),
        () => instance.off(RooCodeEventName.TaskSpawned, onTaskSpawned),
        () =>
          instance.off(
            RooCodeEventName.TaskTokenUsageUpdated,
            onTaskTokenUsageUpdated,
          ),
        () => instance.off("modelChanged", onModelChanged), // kilocode_change: Clean up model change listener
      ]);
    };

    // Initialize Roo Code Cloud profile sync.
    if (CloudService.hasInstance()) {
      this.initializeCloudProfileSync().catch((error) => {
        this.log(`Failed to initialize cloud profile sync: ${error}`);
      });
    } else {
      this.log("CloudService not ready, deferring cloud profile sync");
    }

    // kilocode_change start - Initialize auto-purge scheduler
    this.initializeAutoPurgeScheduler();
    // kilocode_change end
    void this.resetInfinityRunningState();
  }

  // kilocode_change start
  /**
   * Initialize the auto-purge scheduler
   */
  private async initializeAutoPurgeScheduler() {
    try {
      const { AutoPurgeScheduler } = await import("../../services/auto-purge");
      this.autoPurgeScheduler = new AutoPurgeScheduler(
        this.contextProxy.globalStorageUri.fsPath,
      );

      // Start the scheduler with functions to get current settings and task history
      this.autoPurgeScheduler.start(
        async () => {
          const state = await this.getState();
          return {
            enabled: state.autoPurgeEnabled ?? false,
            defaultRetentionDays: state.autoPurgeDefaultRetentionDays ?? 30,
            favoritedTaskRetentionDays:
              state.autoPurgeFavoritedTaskRetentionDays ?? null,
            completedTaskRetentionDays:
              state.autoPurgeCompletedTaskRetentionDays ?? 30,
            incompleteTaskRetentionDays:
              state.autoPurgeIncompleteTaskRetentionDays ?? 7,
            lastRunTimestamp: state.autoPurgeLastRunTimestamp,
          };
        },
        async () => {
          return this.getTaskHistory();
        },
        () => this.getCurrentTask()?.taskId,
        async (taskId: string) => {
          // Remove task from state when purged
          await this.deleteTaskFromState(taskId);
        },
      );

      this.log("Auto-purge scheduler initialized");
    } catch (error) {
      this.log(
        `Failed to initialize auto-purge scheduler: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // kilocode_change end

  private async resetInfinityRunningState() {
    try {
      if (this.getGlobalState("infinityIsRunning")) {
        await this.updateGlobalState("infinityIsRunning", false);
      }
    } catch (error) {
      this.log(
        `Failed to reset Infinity running state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runInfinityTask() {
    const state = await this.getState();
    const prompt = this.resolveInfinityPrompt(state);

    if (!(state.infinityEnabled ?? false) || !prompt) {
      await this.stopInfinity(
        "Infinity stopped because it is disabled or missing a prompt.",
      );
      return;
    }

    try {
      await this.createTask(prompt, undefined, undefined, {
        background: true,
        initialStatus: "active",
      });
      await this.scheduleNextInfinityRun();
      await this.postStateToWebview();
    } catch (error) {
      this.log(
        `Infinity execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.stopInfinity(
        "Infinity stopped because a scheduled run failed.",
      );
    }
  }

  public async startInfinity() {
    const state = await this.getState();
    const prompt = this.resolveInfinityPrompt(state);

    if (!(state.infinityEnabled ?? false)) {
      throw new Error("Enable Infinity before starting it.");
    }

    if (!prompt) {
      throw new Error("Set an Infinity prompt before starting it.");
    }

    await this.stopInfinity();

    await this.updateGlobalState("infinityIsRunning", true);
    await this.scheduleNextInfinityRun();
    await this.postStateToWebview();
  }

  public async stopInfinity(notificationMessage?: string) {
    if (this.infinityInterval) {
      clearTimeout(this.infinityInterval);
      this.infinityInterval = undefined;
    }

    await this.updateGlobalState("infinityNextRunAt", undefined);
    await this.updateGlobalState("infinityIsRunning", false);

    await this.postStateToWebview();

    if (notificationMessage) {
      void vscode.window.showInformationMessage(notificationMessage);
    }
  }

  private resolveInfinityPrompt(
    state: Awaited<ReturnType<ClineProvider["getState"]>>,
  ): string {
    const savedPrompt = state.infinitySavedPrompts?.find(
      (prompt) => prompt.id === state.activeInfinityPromptId,
    );

    return (savedPrompt?.prompt ?? state.infinityPrompt ?? "").trim();
  }

  private async scheduleNextInfinityRun() {
    const state = await this.getState();
    if (!(state.infinityIsRunning ?? false)) {
      return;
    }

    if (this.infinityInterval) {
      clearTimeout(this.infinityInterval);
      this.infinityInterval = undefined;
    }

    const delayMs = this.getInfinityDelayMs(state, new Date());
    await this.updateGlobalState("infinityNextRunAt", Date.now() + delayMs);
    this.infinityInterval = setTimeout(() => {
      void this.runInfinityTask();
    }, delayMs);
  }

  private getInfinityDelayMs(
    state: Awaited<ReturnType<ClineProvider["getState"]>>,
    now: Date,
  ): number {
    const scheduleType = state.infinityScheduleType ?? "interval";
    const scheduleMinute = Math.min(59, Math.max(0, state.infinityScheduleMinute ?? 0));
    const scheduleHour = Math.min(23, Math.max(0, state.infinityScheduleHour ?? 9));

    if (scheduleType === "hourly") {
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setMinutes(scheduleMinute);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
      return Math.max(1000, next.getTime() - now.getTime());
    }

    if (scheduleType === "daily") {
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setHours(scheduleHour, scheduleMinute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return Math.max(1000, next.getTime() - now.getTime());
    }

    return Math.max(60_000, (Math.max(1, state.infinityIntervalMinutes ?? 5) * 60 * 1000));
  }

  /**
   * Override EventEmitter's on method to match TaskProviderLike interface
   */
  override on<K extends keyof TaskProviderEvents>(
    event: K,
    listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
  ): this {
    return super.on(event, listener as any);
  }

  /**
   * Override EventEmitter's off method to match TaskProviderLike interface
   */
  override off<K extends keyof TaskProviderEvents>(
    event: K,
    listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
  ): this {
    return super.off(event, listener as any);
  }

  /**
   * Initialize cloud profile synchronization
   */
  private async initializeCloudProfileSync() {
    try {
      // Check if authenticated and sync profiles
      if (
        CloudService.hasInstance() &&
        CloudService.instance.isAuthenticated()
      ) {
        await this.syncCloudProfiles();
      }

      // Set up listener for future updates
      if (CloudService.hasInstance()) {
        CloudService.instance.on(
          "settings-updated",
          this.handleCloudSettingsUpdate,
        );
      }
    } catch (error) {
      this.log(`Error in initializeCloudProfileSync: ${error}`);
    }
  }

  /**
   * Handle cloud settings updates
   */
  private handleCloudSettingsUpdate = async () => {
    try {
      await this.syncCloudProfiles();
    } catch (error) {
      this.log(`Error handling cloud settings update: ${error}`);
    }
  };

  /**
   * Synchronize cloud profiles with local profiles.
   */
  private async syncCloudProfiles() {
    try {
      const settings = CloudService.instance.getOrganizationSettings();

      if (!settings?.providerProfiles) {
        return;
      }

      const currentApiConfigName = this.getGlobalState("currentApiConfigName");

      const result = await this.providerSettingsManager.syncCloudProfiles(
        settings.providerProfiles,
        currentApiConfigName,
      );

      if (result.hasChanges) {
        // Update list.
        await this.updateGlobalState(
          "listApiConfigMeta",
          await this.providerSettingsManager.listConfig(),
        );

        if (result.activeProfileChanged && result.activeProfileId) {
          // Reload full settings for new active profile.
          const profile = await this.providerSettingsManager.getProfile({
            id: result.activeProfileId,
          });
          await this.activateProviderProfile({ name: profile.name });
        }

        await this.postStateToWebview();
      }
    } catch (error) {
      this.log(`Error syncing cloud profiles: ${error}`);
    }
  }

  /**
   * Initialize cloud profile synchronization when CloudService is ready
   * This method is called externally after CloudService has been initialized
   */
  public async initializeCloudProfileSyncWhenReady(): Promise<void> {
    try {
      if (
        CloudService.hasInstance() &&
        CloudService.instance.isAuthenticated()
      ) {
        await this.syncCloudProfiles();
      }

      if (CloudService.hasInstance()) {
        CloudService.instance.off(
          "settings-updated",
          this.handleCloudSettingsUpdate,
        );
        CloudService.instance.on(
          "settings-updated",
          this.handleCloudSettingsUpdate,
        );
      }
    } catch (error) {
      this.log(`Failed to initialize cloud profile sync when ready: ${error}`);
    }
  }

  // Adds a new Task instance to clineStack, marking the start of a new task.
  // The instance is pushed to the top of the stack (LIFO order).
  // When the task is completed, the top instance is removed, reactivating the
  // previous task.
  async addClineToStack(task: Task) {
    // Add this cline instance into the stack that represents the order of
    // all the called tasks.
    this.clineStack.push(task);
    task.emit(RooCodeEventName.TaskFocused);

    // Perform special setup provider specific tasks.
    await this.performPreparationTasks(task);

    // PERF: Don't block task startup on another getState() roundtrip.
    // The task initializes mode asynchronously with its own fallback.
    void this.getState().catch((error) => {
      this.log(
        `addClineToStack state warmup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async performPreparationTasks(cline: Task) {
    // LMStudio: We need to force model loading in order to read its context
    // size; we do it now since we're starting a task with that model selected.
    if (
      cline.apiConfiguration &&
      cline.apiConfiguration.apiProvider === "lmstudio"
    ) {
      try {
        if (!hasLoadedFullDetails(cline.apiConfiguration.lmStudioModelId!)) {
          await forceFullModelDetailsLoad(
            cline.apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234",
            cline.apiConfiguration.lmStudioModelId!,
          );
        }
      } catch (error) {
        this.log(`Failed to load full model details for LM Studio: ${error}`);
        vscode.window.showErrorMessage(error.message);
      }
    }
  }

  // Removes and destroys the top Cline instance (the current finished task),
  // activating the previous one (resuming the parent task).
  async removeClineFromStack() {
    if (this.clineStack.length === 0) {
      return;
    }

    // kilocode_change: Clear the stack immediately so that getCurrentTask() returns undefined
    // during the potentially slow abortion process. This prevents global profile activations
    // from "leaking" into tasks that are currently being closed.
    let task = this.clineStack.pop();

    if (task) {
      task.emit(RooCodeEventName.TaskUnfocused);

      // kilocode_change start - Do NOT abort task when removing from stack to allow background execution, UNLESS it's already completed or aborted
      const isRunning = this.runningTasks.has(task.taskId);
      if (!isRunning) {
        try {
          // Abort the task (if it's not already) and set isAbandoned to true so
          // all running promises will exit as well.
          await task.abortTask(true);
        } catch (e: any) {
          this.log(
            `[ClineProvider#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`,
          );
        }

        // Remove event listeners before clearing the reference.
        const cleanupFunctions = this.taskEventListeners.get(task);

        if (cleanupFunctions) {
          cleanupFunctions.forEach((cleanup) => cleanup());
          this.taskEventListeners.delete(task);
        }

        // Make sure no reference kept, once promises end it will be
        // garbage collected.
        task = undefined;
      }
      // kilocode_change end
    }
  }

  getTaskStackSize(): number {
    return this.clineStack.length;
  }

  public getCurrentTaskStack(): string[] {
    return this.clineStack.map((cline) => cline.taskId);
  }

  // Pending Edit Operations Management

  /**
   * Sets a pending edit operation with automatic timeout cleanup
   */
  public setPendingEditOperation(
    operationId: string,
    editData: {
      messageTs: number;
      editedContent: string;
      images?: string[];
      messageIndex: number;
      apiConversationHistoryIndex: number;
    },
  ): void {
    // Clear any existing operation with the same ID
    this.clearPendingEditOperation(operationId);

    // Create timeout for automatic cleanup
    const timeoutId = setTimeout(() => {
      this.clearPendingEditOperation(operationId);
      this.log(
        `[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`,
      );
    }, ClineProvider.PENDING_OPERATION_TIMEOUT_MS);

    // Store the operation
    this.pendingOperations.set(operationId, {
      ...editData,
      timeoutId,
      createdAt: Date.now(),
    });

    this.log(`[setPendingEditOperation] Set pending operation: ${operationId}`);
  }

  /**
   * Gets a pending edit operation by ID
   */
  private getPendingEditOperation(
    operationId: string,
  ): PendingEditOperation | undefined {
    return this.pendingOperations.get(operationId);
  }

  /**
   * Clears a specific pending edit operation
   */
  private clearPendingEditOperation(operationId: string): boolean {
    const operation = this.pendingOperations.get(operationId);
    if (operation) {
      clearTimeout(operation.timeoutId);
      this.pendingOperations.delete(operationId);
      this.log(
        `[clearPendingEditOperation] Cleared pending operation: ${operationId}`,
      );
      return true;
    }
    return false;
  }

  /**
   * Clears all pending edit operations
   */
  private clearAllPendingEditOperations(): void {
    for (const [operationId, operation] of this.pendingOperations) {
      clearTimeout(operation.timeoutId);
    }
    this.pendingOperations.clear();
    this.log(`[clearAllPendingEditOperations] Cleared all pending operations`);
  }

  /*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
  private clearWebviewResources() {
    while (this.webviewDisposables.length) {
      const x = this.webviewDisposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  async dispose() {
    this.log("Disposing ClineProvider...");

    // Clear all tasks from the stack.
    while (this.clineStack.length > 0) {
      await this.removeClineFromStack();
    }

    // kilocode_change start - Abort all running tasks
    for (const task of this.runningTasks.values()) {
      try {
        await task.abortTask(true);
      } catch (error) {
        this.log(`Failed to abort task ${task.taskId}: ${error}`);
      }
    }
    this.runningTasks.clear();
    // kilocode_change end

    this.log("Cleared all tasks");

    // Clear all pending edit operations to prevent memory leaks
    this.clearAllPendingEditOperations();
    this.log("Cleared pending operations");

    if (this.view && "dispose" in this.view) {
      this.view.dispose();
      this.log("Disposed webview");
    }

    this.clearWebviewResources();

    // Clean up cloud service event listener
    if (CloudService.hasInstance()) {
      CloudService.instance.off(
        "settings-updated",
        this.handleCloudSettingsUpdate,
      );
    }

    while (this.disposables.length) {
      const x = this.disposables.pop();

      if (x) {
        x.dispose();
      }
    }

    this._workspaceTracker?.dispose();
    this._workspaceTracker = undefined;
    await this.mcpHub?.unregisterClient();
    this.mcpHub = undefined;
    this.marketplaceManager?.cleanup();
    this.customModesManager?.dispose();

    // kilocode_change start - Stop auto-purge scheduler and device auth service
    if (this.autoPurgeScheduler) {
      this.autoPurgeScheduler.stop();
      this.autoPurgeScheduler = undefined;
    }
    await this.stopInfinity();
    // kilocode_change end

    // kilocode_change start - Flush task history to disk before shutdown
    if (this.taskHistoryStorage) {
      await this.taskHistoryStorage.flush();
      this.log("Flushed task history to disk");
    }
    // kilocode_change end

    this.log("Disposed all disposables");
    ClineProvider.activeInstances.delete(this);

    // Clean up any event listeners attached to this provider
    this.removeAllListeners();

    const { ResourceMonitorService } = await import(
      "../../services/resource-monitor/ResourceMonitorService"
    );
    ResourceMonitorService.getInstance().unregisterProvider(this);
    McpServerManager.unregisterProvider(this);
  }

  public static getVisibleInstance(): ClineProvider | undefined {
    return findLast(
      Array.from(this.activeInstances),
      (instance) => instance.view?.visible === true,
    );
  }

  public static async getInstance(): Promise<ClineProvider | undefined> {
    let visibleProvider = ClineProvider.getVisibleInstance();

    // If no visible provider, try to show the sidebar view
    if (!visibleProvider) {
      await vscode.commands.executeCommand(
        `${Package.name}.SidebarProvider.focus`,
      );
      // Wait briefly for the view to become visible
      await delay(100);
      visibleProvider = ClineProvider.getVisibleInstance();
    }

    // If still no visible provider, return
    if (!visibleProvider) {
      return;
    }

    return visibleProvider;
  }

  public static async isActiveTask(): Promise<boolean> {
    const visibleProvider = await ClineProvider.getInstance();

    if (!visibleProvider) {
      return false;
    }

    // Check if there is a cline instance in the stack (if this provider has an active task)
    if (visibleProvider.getCurrentTask()) {
      return true;
    }

    return false;
  }

  public static async handleCodeAction(
    command: CodeActionId,
    promptType: CodeActionName,
    params: Record<string, string | any[]>,
  ): Promise<void> {
    // Capture telemetry for code action usage
    TelemetryService.instance.captureCodeActionUsed(promptType);

    const visibleProvider = await ClineProvider.getInstance();

    if (!visibleProvider) {
      return;
    }

    const { customSupportPrompts } = await visibleProvider.getState();

    // TODO: Improve type safety for promptType.
    const prompt = supportPrompt.create(
      promptType,
      params,
      customSupportPrompts,
    );

    if (command === "addToContext") {
      await visibleProvider.postMessageToWebview({
        type: "invoke",
        invoke: "setChatBoxMessage",
        text: `${prompt}\n\n`,
      });
      await visibleProvider.postMessageToWebview({
        type: "action",
        action: "focusInput",
      });
      return;
    }

    //kilocode_change start
    if (command === "addToContextAndFocus") {
      // Capture telemetry for inline assist quick task
      TelemetryService.instance.captureEvent(
        TelemetryEventName.INLINE_ASSIST_QUICK_TASK,
      );

      let messageText = prompt;

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const fullContent = editor.document.getText();
        const filePath = params.filePath as string;

        messageText = `
For context, we are working within this file:

'${filePath}' (see below for file content)
<file_content path="${filePath}">
${fullContent}
</file_content>

Heed this prompt:

${prompt}
`;
      }

      await visibleProvider.postMessageToWebview({
        type: "invoke",
        invoke: "setChatBoxMessage",
        text: messageText,
      });
      await vscode.commands.executeCommand("kilo-code.focusChatInput");
      return;
    }
    // kilocode_change end

    await visibleProvider.createTask(prompt);
  }

  public static async handleTerminalAction(
    command: TerminalActionId,
    promptType: TerminalActionPromptType,
    params: Record<string, string | any[]>,
  ): Promise<void> {
    TelemetryService.instance.captureCodeActionUsed(promptType);

    const visibleProvider = await ClineProvider.getInstance();

    if (!visibleProvider) {
      return;
    }

    const { customSupportPrompts } = await visibleProvider.getState();
    const prompt = supportPrompt.create(
      promptType,
      params,
      customSupportPrompts,
    );

    if (command === "terminalAddToContext") {
      await visibleProvider.postMessageToWebview({
        type: "invoke",
        invoke: "setChatBoxMessage",
        text: `${prompt}\n\n`,
      });
      await visibleProvider.postMessageToWebview({
        type: "action",
        action: "focusInput",
      });
      return;
    }

    try {
      await visibleProvider.createTask(prompt);
    } catch (error) {
      if (error instanceof OrganizationAllowListViolationError) {
        // Errors from terminal commands seem to get swallowed / ignored.
        vscode.window.showErrorMessage(error.message);
      }

      throw error;
    }
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView | vscode.WebviewPanel,
  ) {
    this.view = webviewView;

    // kilocode_change start: extract constant inTabMode
    // Set panel reference according to webview type
    const inTabMode = "onDidChangeViewState" in webviewView;

    if (inTabMode) {
      setPanel(webviewView, "tab");
    } else if ("onDidChangeVisibility" in webviewView) {
      setPanel(webviewView, "sidebar");
    }
    // kilocode_change end

    // Initialize out-of-scope variables that need to receive persistent
    // global state values. Single getState() call instead of 3 separate ones.
    this.getState().then(
      ({
        terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
        terminalShellIntegrationDisabled = true, // kilocode_change: default
        terminalCommandDelay = 0,
        terminalZshClearEolMark = true,
        terminalZshOhMy = false,
        terminalZshP10k = false,
        terminalPowershellCounter = false,
        terminalZdotdir = false,
        ttsEnabled,
        ttsSpeed,
      }) => {
        Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout);
        Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled);
        Terminal.setCommandDelay(terminalCommandDelay);
        Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark);
        Terminal.setTerminalZshOhMy(terminalZshOhMy);
        Terminal.setTerminalZshP10k(terminalZshP10k);
        Terminal.setPowershellCounter(terminalPowershellCounter);
        Terminal.setTerminalZdotdir(terminalZdotdir);
        setTtsEnabled(ttsEnabled ?? false);
        setTtsSpeed(ttsSpeed ?? 1);
      },
    );

    // Set up webview options with proper resource roots
    const resourceRoots = [
      this.contextProxy.extensionUri,
      vscode.Uri.joinPath(this.contextProxy.extensionUri, "webview-ui"),
      vscode.Uri.joinPath(this.contextProxy.extensionUri, "assets"), // kilocode_change
    ];

    // Add workspace folders to allow access to workspace files
    if (vscode.workspace.workspaceFolders) {
      resourceRoots.push(
        ...vscode.workspace.workspaceFolders.map((folder) => folder.uri),
      );
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resourceRoots,
    };

    webviewView.webview.html =
      this.contextProxy.extensionMode === vscode.ExtensionMode.Development
        ? await this.getHMRHtmlContent(webviewView.webview)
        : await this.getHtmlContent(webviewView.webview);

    // Sets up an event listener to listen for messages passed from the webview view context
    // and executes code based on the message that is received.
    this.setWebviewMessageListener(webviewView.webview);

    // Initialize code index status subscription for the current workspace.
    this.updateCodeIndexStatusSubscription();

    // Listen for active editor changes to update code index status for the
    // current workspace.
    const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(
      () => {
        // Update subscription when workspace might have changed.
        this.updateCodeIndexStatusSubscription();
      },
    );
    this.webviewDisposables.push(activeEditorSubscription);

    // Listen for when the panel becomes visible.
    // https://github.com/microsoft/vscode-discussions/discussions/840
    if ("onDidChangeViewState" in webviewView) {
      // WebviewView and WebviewPanel have all the same properties except
      // for this visibility listener panel.
      const viewStateDisposable = webviewView.onDidChangeViewState(() => {
        if (this.view?.visible) {
          this.postMessageToWebview({
            type: "action",
            action: "didBecomeVisible",
          });
        }
      });

      this.webviewDisposables.push(viewStateDisposable);
    } else if ("onDidChangeVisibility" in webviewView) {
      // sidebar
      const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
        if (this.view?.visible) {
          this.postMessageToWebview({
            type: "action",
            action: "didBecomeVisible",
          });
        }
      });

      this.webviewDisposables.push(visibilityDisposable);
    }

    // Listen for when the view is disposed
    // This happens when the user closes the view or when the view is closed programmatically
    webviewView.onDidDispose(
      async () => {
        if (inTabMode) {
          this.log("Disposing ClineProvider instance for tab view");
          await this.dispose();
        } else {
          this.log("Clearing webview resources for sidebar view");
          this.clearWebviewResources();
          // Reset current workspace manager reference when view is disposed
          this.codeIndexManager = undefined;
        }
      },
      null,
      this.disposables,
    );

    // Listen for when color changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (e && e.affectsConfiguration("workbench.colorTheme")) {
          // Sends latest theme name to webview
          await this.postMessageToWebview({
            type: "theme",
            text: JSON.stringify(await getTheme()),
          });
        }
      },
    );
    this.webviewDisposables.push(configDisposable);

    // If the extension is starting a new session, clear previous task state.
    await this.removeClineFromStack();
  }

  private isRehydrating = false;

  public async createTaskWithHistoryItem(
    historyItem: HistoryItem & { rootTask?: Task; parentTask?: Task },
    options?: { startTask?: boolean },
  ) {
    this.isRehydrating = true;
    try {
      // Check if we're rehydrating the current task to avoid flicker
      const currentTask = this.getCurrentTask();
      const isRehydratingCurrentTask =
        currentTask && currentTask.taskId === historyItem.id;

      if (!isRehydratingCurrentTask) {
        await this.removeClineFromStack();
      }

      // If the history item has a saved mode, restore it and its associated API configuration.
      if (historyItem.mode) {
        // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] History item has mode: "${historyItem.mode}"`)
        // Validate that the mode still exists
        const customModes = await this.customModesManager.getCustomModes();
        const modeExists =
          getModeBySlug(historyItem.mode, customModes) !== undefined;

        if (!modeExists) {
          // Mode no longer exists, fall back to default mode.
          this.log(
            `Mode '${historyItem.mode}' from history no longer exists. Falling back to default mode '${defaultModeSlug}'.`,
          );
          historyItem.mode = defaultModeSlug;
        }

        await this.updateGlobalState("mode", historyItem.mode);

        // Load the saved API config for the restored mode if it exists.
        const savedConfigId =
          await this.providerSettingsManager.getModeConfigId(historyItem.mode);
        const listApiConfig = await this.providerSettingsManager.listConfig();
        // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] Mode "${historyItem.mode}" savedConfigId: "${savedConfigId}"`)

        // Update listApiConfigMeta first to ensure UI has latest data.
        await this.updateGlobalState("listApiConfigMeta", listApiConfig);

        // If this mode has a saved config, use it.
        if (savedConfigId) {
          const profile = listApiConfig.find(({ id }) => id === savedConfigId);
          // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] Found profile for savedConfigId: ${profile?.name ?? "NOT FOUND"}`)

          if (profile?.name) {
            try {
              // kilocode_change: DO NOT activate the profile if we already have a task-specific config.
              // Activating the profile here overwrites the global state, which can sometimes leak into the UI
              // if a debounced postStateToWebview is triggered by another event (like session sync).
              // The task-specific config is already loaded and will be passed to the Task constructor.
              if (!(historyItem as any).apiConfiguration) {
                // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] >>> SETTING GLOBAL PROFILE TO "${profile.name}" for mode "${historyItem.mode}" (SILENT) <<<`)
                await this.activateProviderProfile({
                  name: profile.name,
                  source: "task_switch",
                  silent: true,
                });
              } else {
                // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] Skipping profile activation because task already has specific config`)
              }
            } catch (error) {
              // Log the error but continue with task restoration.
              this.log(
                `Failed to restore API configuration for mode '${historyItem.mode}': ${
                  error instanceof Error ? error.message : String(error)
                }. Continuing with default configuration.`,
              );
              // The task will continue with the current/default configuration.
            }
          }
        } else {
          // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] No savedConfigId for mode "${historyItem.mode}" - using current global config`)
        }
      } else {
        // this.log(`[PERSISTENCE_DEBUG][createTaskWithHistoryItem] History item has NO mode saved`)
      }

      const state = await this.getState();
      const {
        diffEnabled: enableDiff,
        enableCheckpoints,
        checkpointTimeout,
        fuzzyMatchThreshold,
        experiments,
        cloudUserInfo,
        taskSyncEnabled,
      } = state;

      // kilocode_change start: Restore task-specific API configuration if available
      // We prioritize the history item's config to prevent "Sticky Models" from the global state.
      let apiConfiguration = (historyItem as any).apiConfiguration;

      if (!apiConfiguration) {
        this.log(
          `[createTaskWithHistoryItem] No task-specific config found for ${historyItem.id}, falling back to global state`,
        );
        apiConfiguration = state.apiConfiguration;
      }

      // this.log(`[createTaskWithHistoryItem] Rehydrating task ${historyItem.id}. Using config: ${apiConfiguration.apiProvider} / ${apiConfiguration.apiModelId || apiConfiguration.openRouterModelId || apiConfiguration.kilocodeModel}`)
      // kilocode_change end

      // kilocode_change: Check if there's already a running task with this ID.
      // If so, reuse it to preserve live clineMessages during streaming.
      // Only create a new task if there's no running instance.
      // This fixes the issue where switching to a streaming chat would show stale messages.
      let task: Task;
      const existingRunningTask = this.runningTasks.get(historyItem.id);
      // Reuse existing task if it hasn't been explicitly aborted
      // Don't check streaming status - that was causing infinite revival loops
      const canReuseExistingTask =
        existingRunningTask && !existingRunningTask.abort;

      if (existingRunningTask && !canReuseExistingTask) {
        this.log(
          `[createTaskWithHistoryItem] Discarding aborted task ${historyItem.id}.${existingRunningTask.instanceId}`,
        );
        this.runningTasks.delete(historyItem.id);
      }

      if (canReuseExistingTask && existingRunningTask) {
        this.log(
          `[createTaskWithHistoryItem] Reusing existing task ${historyItem.id}.${existingRunningTask.instanceId}`,
        );
        task = existingRunningTask;
        // Update the API configuration if the history item has a specific config
        // This ensures the model picker shows the correct model without losing live messages
        if ((historyItem as any).apiConfiguration) {
          task.updateApiConfiguration((historyItem as any).apiConfiguration);
        }
      } else {
        task = new Task({
          context: this.context,
          provider: this,
          apiConfiguration,
          enableDiff,
          enableCheckpoints,
          checkpointTimeout,
          fuzzyMatchThreshold,
          consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
          historyItem,
          experiments,
          rootTask: historyItem.rootTask,
          parentTask: historyItem.parentTask,
          taskNumber: historyItem.number,
          workspacePath: historyItem.workspace,
          onCreated: this.taskCreationCallback,
          startTask: options?.startTask ?? true,
          enableBridge: BridgeOrchestrator.isEnabled(
            cloudUserInfo,
            taskSyncEnabled,
          ),
          // Preserve the status from the history item to avoid overwriting it when the task saves messages
          initialStatus: historyItem.status,
        });
        this.runningTasks.set(task.taskId, task);
      }
      // kilocode_change end

      if (isRehydratingCurrentTask) {
        // Replace the current task in-place to avoid UI flicker
        const stackIndex = this.clineStack.length - 1;

        // Properly dispose of the old task to ensure garbage collection
        const oldTask = this.clineStack[stackIndex];

        // kilocode_change start - don't abort if it's the same task instance
        if (oldTask === task) {
          // kilocode_change: Even if reusing the same task instance, ensure its configuration
          // is synced with the history item's saved configuration to prevent "Sticky Reset".
          // We use updateApiConfiguration to ensure the internal AI handler is rebuilt.
          if ((historyItem as any).apiConfiguration) {
            task.updateApiConfiguration((historyItem as any).apiConfiguration);
          }
          task.emit(RooCodeEventName.TaskFocused);
          await this.postStateToWebview();
          return task;
        }
        // kilocode_change end

        // Abort the old task to stop running processes and mark as abandoned
        try {
          await oldTask.abortTask(true);
        } catch (e) {
          this.log(
            `[createTaskWithHistoryItem] abortTask() failed for old task ${oldTask.taskId}.${oldTask.instanceId}: ${e.message}`,
          );
        }

        // Remove event listeners from the old task
        const cleanupFunctions = this.taskEventListeners.get(oldTask);
        if (cleanupFunctions) {
          cleanupFunctions.forEach((cleanup) => cleanup());
          this.taskEventListeners.delete(oldTask);
        }

        // Replace the task in the stack
        this.clineStack[stackIndex] = task;
        task.emit(RooCodeEventName.TaskFocused);

        // Perform preparation tasks and set up event listeners
        await this.performPreparationTasks(task);

        this.log(
          `[createTaskWithHistoryItem] rehydrated task ${task.taskId}.${task.instanceId} in-place (flicker-free)`,
        );
      } else {
        await this.addClineToStack(task);

        this.log(
          `[createTaskWithHistoryItem] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
        );
      }

      // Check if there's a pending edit after checkpoint restoration
      const operationId = `task-${task.taskId}`;
      const pendingEdit = this.getPendingEditOperation(operationId);
      if (pendingEdit) {
        this.clearPendingEditOperation(operationId); // Clear the pending edit

        this.log(
          `[createTaskWithHistoryItem] Processing pending edit after checkpoint restoration`,
        );

        // Process the pending edit after a short delay to ensure the task is fully initialized
        setTimeout(async () => {
          try {
            // Find the message index in the restored state
            const { messageIndex, apiConversationHistoryIndex } = (() => {
              const messageIndex = task.clineMessages.findIndex(
                (msg) => msg.ts === pendingEdit.messageTs,
              );
              const apiConversationHistoryIndex =
                task.apiConversationHistory.findIndex(
                  (msg) => msg.ts === pendingEdit.messageTs,
                );
              return { messageIndex, apiConversationHistoryIndex };
            })();

            if (messageIndex !== -1) {
              // Remove the target message and all subsequent messages
              await task.overwriteClineMessages(
                task.clineMessages.slice(0, messageIndex),
              );

              if (apiConversationHistoryIndex !== -1) {
                await task.overwriteApiConversationHistory(
                  task.apiConversationHistory.slice(
                    0,
                    apiConversationHistoryIndex,
                  ),
                );
              }

              // Process the edited message
              await task.handleWebviewAskResponse(
                "messageResponse",
                pendingEdit.editedContent,
                pendingEdit.images,
              );
            }
          } catch (error) {
            this.log(
              `[createTaskWithHistoryItem] Error processing pending edit: ${error}`,
            );
          } finally {
            this.isRehydrating = false;
          }
        }, 100); // Small delay to ensure task is fully ready
      }

      return task;
    } catch (error) {
      this.log(`[createTaskWithHistoryItem] Error: ${error}`);
      throw error;
    } finally {
      this.isRehydrating = false;
    }
  }

  public async postMessageToWebview(message: ExtensionMessage) {
    // NOTE: Changing this? Update effects.ts in the cli too.
    kilo_execIfExtension(() => {
      if (message.type === "apiMessagesSaved" && message.payload) {
        const [taskId, filePath] = message.payload as [string, string];

        SessionManager.init()?.handleFileUpdate(
          taskId,
          "apiConversationHistoryPath",
          filePath,
        );
      } else if (message.type === "taskMessagesSaved" && message.payload) {
        const [taskId, filePath] = message.payload as [string, string];

        SessionManager.init()?.handleFileUpdate(
          taskId,
          "uiMessagesPath",
          filePath,
        );
      } else if (message.type === "taskMetadataSaved" && message.payload) {
        const [taskId, filePath] = message.payload as [string, string];

        SessionManager.init()?.handleFileUpdate(
          taskId,
          "taskMetadataPath",
          filePath,
        );
      } else if (message.type === "currentCheckpointUpdated") {
        SessionManager.init()?.doSync();
      }
    });

    await this.view?.webview.postMessage(message);
  }

  private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
    const { getVitePort } = await import("./getViteDevServerConfig");
    const localPort = getVitePort();
    const localServerUrl = `127.0.0.1:${localPort}`;

    // Check if local dev server is running.
    try {
      await axios.get(`http://${localServerUrl}`);
    } catch (error) {
      vscode.window.showErrorMessage(t("common:errors.hmr_not_running"));
      return this.getHtmlContent(webview);
    }

    const nonce = getNonce();

    // Get the OpenRouter base URL from configuration
    const { apiConfiguration } = await this.getState();
    const openRouterBaseUrl =
      apiConfiguration.openRouterBaseUrl || "https://openrouter.ai";
    // Extract the domain for CSP
    const openRouterDomain =
      openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] ||
      "https://openrouter.ai";

    const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.css",
    ]);

    const codiconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "codicons",
      "codicon.css",
    ]);
    const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "vscode-material-icons",
      "icons",
    ]);
    const imagesUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "images",
    ]);
    const providersUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "providers",
    ]); // kilocode_changes
    const iconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "icons",
    ]); // kilocode_change
    const audioUri = getUri(webview, this.contextProxy.extensionUri, [
      "webview-ui",
      "audio",
    ]);

    const file = "src/index.tsx";
    const scriptUri = `http://${localServerUrl}/${file}`;

    const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://${localServerUrl}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`;

    const csp = [
      "default-src 'none'",
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://127.0.0.1:${localPort} http://0.0.0.0:${localPort}`,
      `img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data: https://*.googleusercontent.com https://*.googleapis.com https://*.githubusercontent.com https://*.google.com https://icons.duckduckgo.com https://registry.npmmirror.com https://*.lobehub.com`, // kilocode_change: add google and ddg for favicons
      `media-src ${webview.cspSource} blob:`,
      `script-src 'unsafe-eval' ${webview.cspSource} https://* https://*.posthog.com https://us-assets.i.posthog.com http://${localServerUrl} http://127.0.0.1:${localPort} http://0.0.0.0:${localPort} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `connect-src ${webview.cspSource} ${openRouterDomain} https://* http://localhost:3000 https://*.posthog.com https://us.i.posthog.com https://us-assets.i.posthog.com https://api.requesty.ai https://chat-plugins.lobehub.com https://market.lobehub.com ws://${localServerUrl} ws://127.0.0.1:${localPort} ws://0.0.0.0:${localPort} http://${localServerUrl} http://127.0.0.1:${localPort} http://0.0.0.0:${localPort}`, // kilocode_change: add http://localhost:3000
      `worker-src blob:`, // kilocode_change: allow blob workers for local whisper
    ];

    return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.PROVIDERS_BASE_URI = "${providersUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
						window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}"
					</script>
					<title>Kilo Code</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`;
  }

  /**
   * Defines and returns the HTML that should be rendered within the webview panel.
   *
   * @remarks This is also the place where references to the React webview build files
   * are created and inserted into the webview HTML.
   *
   * @param webview A reference to the extension webview
   * @param extensionUri The URI of the directory containing the extension
   * @returns A template string literal containing the HTML that should be
   * rendered within the webview panel
   */
  private async getHtmlContent(webview: vscode.Webview): Promise<string> {
    // Get the local path to main script run in the webview,
    // then convert it to a uri we can use in the webview.

    // The CSS file from the React build output
    const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.css",
    ]);

    const scriptUri = getUri(webview, this.contextProxy.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.js",
    ]);
    const codiconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "codicons",
      "codicon.css",
    ]);
    const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "vscode-material-icons",
      "icons",
    ]);
    const imagesUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "images",
    ]);
    const providersUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "providers",
    ]); // kilocode_changes
    const iconsUri = getUri(webview, this.contextProxy.extensionUri, [
      "assets",
      "icons",
    ]); // kilocode_changes
    const audioUri = getUri(webview, this.contextProxy.extensionUri, [
      "webview-ui",
      "audio",
    ]);

    // Use a nonce to only allow a specific script to be run.
    /*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
    const nonce = getNonce();

    // Get the OpenRouter base URL from configuration
    const { apiConfiguration } = await this.getState();
    const openRouterBaseUrl =
      apiConfiguration.openRouterBaseUrl || "https://openrouter.ai";
    // Extract the domain for CSP
    const openRouterDomain =
      openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] ||
      "https://openrouter.ai";

    // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
    return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
			<meta http-equiv="Permissions-Policy" content="microphone=(self)">
			<!-- kilocode_change: add https://*.googleusercontent.com https://*.googleapis.com https://*.githubusercontent.com to img-src, https://*, http://localhost:3000 to connect-src -->
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://*.googleusercontent.com https://storage.googleapis.com https://*.githubusercontent.com https://img.clerk.com data: https://*.googleapis.com https://registry.npmmirror.com https://*.lobehub.com https://*.google.com https://icons.duckduckgo.com; media-src ${webview.cspSource} blob:; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' ${openRouterDomain} https://us-assets.i.posthog.com 'strict-dynamic'; connect-src ${webview.cspSource} https://* http://localhost:3000 https://api.requesty.ai https://us.i.posthog.com https://us-assets.i.posthog.com https://chat-plugins.lobehub.com https://market.lobehub.com; worker-src blob:;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.PROVIDERS_BASE_URI = "${providersUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
				window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}"
			</script>
            <title>Kilo Code</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
        </html>
      `;
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is received.
   *
   * @param webview A reference to the extension webview
   */
  private setWebviewMessageListener(webview: vscode.Webview) {
    const onReceiveMessage = async (message: WebviewMessage) =>
      webviewMessageHandler(this, message, this.marketplaceManager);

    const messageDisposable = webview.onDidReceiveMessage(onReceiveMessage);
    this.webviewDisposables.push(messageDisposable);
  }

  /* kilocode_change start */
  /**
   * Handle messages from CLI ExtensionHost
   * This method allows the CLI to send messages directly to the webviewMessageHandler
   */
  public async handleCLIMessage(message: WebviewMessage): Promise<void> {
    try {
      await webviewMessageHandler(this, message, this.marketplaceManager);
    } catch (error) {
      this.log(
        `Error handling CLI message: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
  /* kilocode_change end */

  /**
   * Handle switching to a new mode, including updating the associated API configuration
   * @param newMode The mode to switch to
   */
  public async handleModeSwitch(newMode: Mode) {
    const task = this.getCurrentTask();

    if (task) {
      TelemetryService.instance.captureModeSwitch(task.taskId, newMode);
      task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode);

      try {
        // Update the task history with the new mode first.
        const history = this.getTaskHistory();
        const taskHistoryItem = history.find((item) => item.id === task.taskId);

        if (taskHistoryItem) {
          taskHistoryItem.mode = newMode;
          await this.updateTaskHistory(taskHistoryItem);
        }

        // Only update the task's mode after successful persistence.
        (task as any)._taskMode = newMode;
      } catch (error) {
        // If persistence fails, log the error but don't update the in-memory state.
        this.log(
          `Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );

        // Optionally, we could emit an event to notify about the failure.
        // This ensures the in-memory state remains consistent with persisted state.
        throw error;
      }
    }

    await this.updateGlobalState("mode", newMode);

    this.emit(RooCodeEventName.ModeChanged, newMode);

    // Load the saved API config for the new mode if it exists.
    const savedConfigId =
      await this.providerSettingsManager.getModeConfigId(newMode);
    const listApiConfig = await this.providerSettingsManager.listConfig();

    // Update listApiConfigMeta first to ensure UI has latest data.
    await this.updateGlobalState("listApiConfigMeta", listApiConfig);

    // If this mode has a saved config, use it.
    if (savedConfigId) {
      const profile = listApiConfig.find(({ id }) => id === savedConfigId);

      if (profile?.name) {
        await this.activateProviderProfile({ name: profile.name });
      }
    } else {
      // If no saved config for this mode, save current config as default.
      const currentApiConfigName = this.getGlobalState("currentApiConfigName");

      if (currentApiConfigName) {
        const config = listApiConfig.find(
          (c) => c.name === currentApiConfigName,
        );

        if (config?.id) {
          await this.providerSettingsManager.setModeConfig(newMode, config.id);
        }
      }
    }

    await this.postStateToWebview();
  }

  // Provider Profile Management

  /**
   * Updates the current task's API handler.
   * Rebuilds when:
   * - provider or model changes, OR
   * - explicitly forced (e.g., user-initiated profile switch/save to apply changed settings like headers/baseUrl/tier).
   * Always synchronizes task.apiConfiguration with latest provider settings.
   * @param providerSettings The new provider settings to apply
   * @param options.forceRebuild Force rebuilding the API handler regardless of provider/model equality
   */
  private updateTaskApiHandlerIfNeeded(
    providerSettings: ProviderSettings,
    options: { forceRebuild?: boolean; source?: string } = {},
  ): void {
    if (options.source === "task_switch") return;

    // kilocode_change: If we're currently rehydrating a task, we MUST NOT allow
    // global profile activations to touch the task instance until it's fully ready.
    if (this.isRehydrating) return;

    const task = this.getCurrentTask();
    if (!task) return;

    const { forceRebuild = false } = options;

    // Determine if we need to rebuild using the previous configuration snapshot
    const prevConfig = task.apiConfiguration;
    const prevProvider = prevConfig?.apiProvider;
    const prevModelId = prevConfig ? getModelId(prevConfig) : undefined;
    const prevToolProtocol = prevConfig?.toolProtocol;
    const newProvider = providerSettings.apiProvider;
    const newModelId = getModelId(providerSettings);
    const newToolProtocol = providerSettings.toolProtocol;

    const needsRebuild =
      forceRebuild ||
      prevProvider !== newProvider ||
      prevModelId !== newModelId ||
      prevToolProtocol !== newToolProtocol;

    if (needsRebuild) {
      // Use updateApiConfiguration which handles both API handler rebuild and parser sync.
      // This is important when toolProtocol changes - the assistantMessageParser needs to be
      // created/destroyed to match the new protocol (XML vs native).
      // Note: updateApiConfiguration is declared async but has no actual async operations,
      // so we can safely call it without awaiting.
      task.updateApiConfiguration(providerSettings);
    } else {
      // No rebuild needed, just sync apiConfiguration
      (task as any).apiConfiguration = providerSettings;
      // kilocode_change: If this is the current task, we need to ensure the webview is notified
      // so the model picker updates.
      if (task === this.getCurrentTask()) {
        void this.postStateToWebview();
      }
    }
  }

  getProviderProfileEntries(): ProviderSettingsEntry[] {
    return this.contextProxy.getValues().listApiConfigMeta || [];
  }

  getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
    return this.getProviderProfileEntries().find(
      (profile) => profile.name === name,
    );
  }

  public hasProviderProfileEntry(name: string): boolean {
    return !!this.getProviderProfileEntry(name);
  }

  async upsertProviderProfile(
    name: string,
    providerSettings: ProviderSettings,
    activate: boolean = true,
    options: { source?: string } = {},
  ): Promise<string | undefined> {
    try {
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] ====== UPSERT PROFILE ======`)
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] Profile name: "${name}", activate: ${activate}`)
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] apiProvider: ${providerSettings.apiProvider}`)
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] model: ${providerSettings.apiModelId || providerSettings.openRouterModelId || (providerSettings as any).kilocodeModel || "NONE"}`)

      // TODO: Do we need to be calling `activateProfile`? It's not
      // clear to me what the source of truth should be; in some cases
      // we rely on the `ContextProxy`'s data store and in other cases
      // we rely on the `ProviderSettingsManager`'s data store. It might
      // be simpler to unify these two.
      const id = await this.providerSettingsManager.saveConfig(
        name,
        providerSettings,
      );
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] Saved to disk with id: "${id}"`)

      if (activate) {
        const { mode } = await this.getState();
        // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] Activating for mode: "${mode}"`)

        // These promises do the following:
        // 1. Adds or updates the list of provider profiles.
        // 2. Sets the current provider profile.
        // 3. Sets the current mode's provider profile.
        // 4. Copies the provider settings to the context.
        //
        // Note: 1, 2, and 4 can be done in one `ContextProxy` call:
        // this.contextProxy.setValues({ ...providerSettings, listApiConfigMeta: ..., currentApiConfigName: ... })
        // We should probably switch to that and verify that it works.
        // I left the original implementation in just to be safe.
        await Promise.all([
          this.updateGlobalState(
            "listApiConfigMeta",
            await this.providerSettingsManager.listConfig(),
          ),
          this.updateGlobalState("currentApiConfigName", name),
          this.providerSettingsManager.setModeConfig(mode, id),
          this.contextProxy.setProviderSettings(providerSettings),
        ]);

        // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] contextProxy updated. currentApiConfigName="${name}", apiProvider="${providerSettings.apiProvider}"`)

        // Change the provider for the current task.
        // TODO: We should rename `buildApiHandler` for clarity (e.g. `getProviderClient`).
        // kilocode_change: Wrap in try-catch so that OAuth providers without credentials
        // don't prevent state from being posted to webview (which causes settings to revert)
        try {
          const task = this.getCurrentTask();

          if (task) {
            task.api = buildApiHandler(providerSettings);
            // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] Rebuilt API handler for active task ${task.taskId}`)
          }

          this.updateTaskApiHandlerIfNeeded(providerSettings, {
            forceRebuild: true,
            source: options.source,
          });
        } catch (apiHandlerError) {
          this.log(
            `Non-fatal: Could not build API handler for provider ${providerSettings.apiProvider}: ${apiHandlerError instanceof Error ? apiHandlerError.message : String(apiHandlerError)}`,
          );
        }

        await TelemetryService.instance.updateIdentity(
          providerSettings.kilocodeToken ?? "",
        ); // kilocode_change
      } else {
        // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] NOT activating, only updating listApiConfigMeta`)
        await this.updateGlobalState(
          "listApiConfigMeta",
          await this.providerSettingsManager.listConfig(),
        );
      }

      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] About to postStateToWebview`)
      await this.postStateToWebview();
      // this.log(`[PERSISTENCE_DEBUG][upsertProviderProfile] ====== UPSERT PROFILE COMPLETE ======`)
      return id;
    } catch (error) {
      this.log(
        `Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
      );

      vscode.window.showErrorMessage(t("common:errors.create_api_config"));
      return undefined;
    }
  }

  async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
    const globalSettings = this.contextProxy.getValues();
    let profileToActivate: string | undefined =
      globalSettings.currentApiConfigName;

    if (profileToDelete.name === profileToActivate) {
      profileToActivate = this.getProviderProfileEntries().find(
        ({ name }) => name !== profileToDelete.name,
      )?.name;
    }

    if (!profileToActivate) {
      throw new Error("You cannot delete the last profile");
    }

    const entries = this.getProviderProfileEntries().filter(
      ({ name }) => name !== profileToDelete.name,
    );

    await this.contextProxy.setValues({
      ...globalSettings,
      currentApiConfigName: profileToActivate,
      listApiConfigMeta: entries,
    });

    await this.postStateToWebview();
  }

  async activateProviderProfile(options: {
    name?: string;
    id?: string;
    source?: string;
    silent?: boolean;
  }) {
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] ====== ACTIVATING PROFILE (silent: ${!!options.silent}) ======`)
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] Args: ${JSON.stringify(options)}`)
    const prevConfigName = await this.contextProxy.getValue(
      "currentApiConfigName",
    );
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] BEFORE - currentApiConfigName: ${prevConfigName}`)

    const { name, id, ...providerSettings } =
      await this.providerSettingsManager.activateProfile(options as any);

    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] Resolved profile name: "${name}", id: "${id}"`)
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] Profile apiProvider: ${providerSettings.apiProvider}`)
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] Profile model: ${providerSettings.apiModelId || providerSettings.openRouterModelId || (providerSettings as any).kilocodeModel || "NONE"}`)

    // See `upsertProviderProfile` for a description of what this is doing.
    await Promise.all([
      this.contextProxy.setValue(
        "listApiConfigMeta",
        await this.providerSettingsManager.listConfig(),
      ),
      this.contextProxy.setValue("currentApiConfigName", name),
      this.contextProxy.setProviderSettings(providerSettings),
    ]);

    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] AFTER - currentApiConfigName set to: "${name}"`)

    const { mode } = await this.getState();

    if (id) {
      await this.providerSettingsManager.setModeConfig(mode, id);
      // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] Set mode config for mode "${mode}" to profile id "${id}"`)
    }
    // Change the provider for the current task.
    this.updateTaskApiHandlerIfNeeded(providerSettings, {
      forceRebuild: true,
      source: options.source,
    });

    if (!options.silent) {
      await this.postStateToWebview();
    }
    await TelemetryService.instance.updateIdentity(
      providerSettings.kilocodeToken ?? "",
    ); // kilocode_change

    if (providerSettings.apiProvider) {
      this.emit(RooCodeEventName.ProviderProfileChanged, {
        name,
        provider: providerSettings.apiProvider,
      });
    }
    // this.log(`[PERSISTENCE_DEBUG][activateProviderProfile] ====== PROFILE ACTIVATION COMPLETE ======`)
  }

  async updateCustomInstructions(instructions?: string) {
    // User may be clearing the field.
    await this.updateGlobalState(
      "customInstructions",
      instructions || undefined,
    );
    await this.postStateToWebview();
  }

  // MCP

  async ensureMcpServersDirectoryExists(): Promise<string> {
    // Get platform-specific application data directory
    let mcpServersDir: string;
    if (process.platform === "win32") {
      // Windows: %APPDATA%\Kilo-Code\MCP
      mcpServersDir = path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "Kilo-Code",
        "MCP",
      );
    } else if (process.platform === "darwin") {
      // macOS: ~/Documents/Kilo-Code/MCP
      mcpServersDir = path.join(os.homedir(), "Documents", "Kilo-Code", "MCP");
    } else {
      // Linux: ~/.local/share/Kilo-Code/MCP
      mcpServersDir = path.join(
        os.homedir(),
        ".local",
        "share",
        "Kilo-Code",
        "MCP",
      );
    }

    try {
      await fs.mkdir(mcpServersDir, { recursive: true });
    } catch (error) {
      // Fallback to a relative path if directory creation fails
      return path.join(os.homedir(), ".kilocode", "mcp");
    }
    return mcpServersDir;
  }

  async ensureSettingsDirectoryExists(): Promise<string> {
    const { getSettingsDirectoryPath } = await import("../../utils/storage");
    const globalStoragePath = this.contextProxy.globalStorageUri.fsPath;
    return getSettingsDirectoryPath(globalStoragePath);
  }

  // OpenRouter

  async handleOpenRouterCallback(code: string) {
    let { apiConfiguration, currentApiConfigName = "default" } =
      await this.getState();

    let apiKey: string;

    try {
      const baseUrl =
        apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1";
      // Extract the base domain for the auth endpoint.
      const baseUrlDomain =
        baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai";
      const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, {
        code,
      });

      if (response.data && response.data.key) {
        apiKey = response.data.key;
      } else {
        throw new Error("Invalid response from OpenRouter API");
      }
    } catch (error) {
      this.log(
        `Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
      );

      throw error;
    }

    const newConfiguration: ProviderSettings = {
      ...apiConfiguration,
      apiProvider: "openrouter",
      openRouterApiKey: apiKey,
      openRouterModelId:
        apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
    };

    await this.upsertProviderProfile(currentApiConfigName, newConfiguration);
  }

  // kilocode_change: Glama

  async handleGlamaCallback(code: string) {
    let apiKey: string;

    try {
      const response = await axios.post(
        "https://glama.ai/api/gateway/v1/auth/exchange-code",
        { code },
      );

      if (response.data && response.data.apiKey) {
        apiKey = response.data.apiKey;
      } else {
        throw new Error("Invalid response from Glama API");
      }
    } catch (error) {
      this.log(
        `Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
      );

      throw error;
    }

    const { apiConfiguration, currentApiConfigName = "default" } =
      await this.getState();

    const newConfiguration: ProviderSettings = {
      ...apiConfiguration,
      apiProvider: "glama",
      glamaApiKey: apiKey,
      glamaModelId: apiConfiguration?.glamaModelId || glamaDefaultModelId,
    };

    await this.upsertProviderProfile(currentApiConfigName, newConfiguration);
  }
  // kilocode_change end

  // Requesty

  async handleRequestyCallback(code: string, baseUrl: string | null) {
    let { apiConfiguration } = await this.getState();

    const newConfiguration: ProviderSettings = {
      ...apiConfiguration,
      apiProvider: "requesty",
      requestyApiKey: code,
      requestyModelId:
        apiConfiguration?.requestyModelId || requestyDefaultModelId,
    };

    // set baseUrl as undefined if we don't provide one
    // or if it is the default requesty url
    if (!baseUrl || baseUrl === REQUESTY_BASE_URL) {
      newConfiguration.requestyBaseUrl = undefined;
    } else {
      newConfiguration.requestyBaseUrl = baseUrl;
    }

    const profileName = `Requesty (${new Date().toLocaleString()})`;
    await this.upsertProviderProfile(profileName, newConfiguration);
  }

  // kilocode_change start
  async handleKiloCodeCallback(token: string) {
    const kilocode: ProviderName = "kilocode";
    let { apiConfiguration, currentApiConfigName = "default" } =
      await this.getState();

    await this.upsertProviderProfile(currentApiConfigName, {
      ...apiConfiguration,
      apiProvider: "kilocode",
      kilocodeToken: token,
    });

    vscode.window.showInformationMessage("Kilo Code successfully configured!");

    if (this.getCurrentTask()) {
      this.getCurrentTask()!.api = buildApiHandler({
        apiProvider: kilocode,
        kilocodeToken: token,
      });
    }
  }
  // kilocode_change end

  // kilocode_change start - Device Auth Flow
  async startDeviceAuth() {
    if (!this.deviceAuthHandler) {
      this.deviceAuthHandler = new DeviceAuthHandler({
        postMessageToWebview: (msg) => this.postMessageToWebview(msg),
        log: (msg) => this.log(msg),
        showInformationMessage: (msg) =>
          vscode.window.showInformationMessage(msg),
      });
    }
    await this.deviceAuthHandler.startDeviceAuth();
  }

  cancelDeviceAuth() {
    this.deviceAuthHandler?.cancelDeviceAuth();
  }
  // kilocode_change end

  // Task history

  async getTaskWithId(
    id: string,
    kilo_withMessage = true, // kilocode_change session manager uses this method in the background
  ): Promise<{
    historyItem: HistoryItem;
    taskDirPath: string;
    apiConversationHistoryFilePath: string;
    uiMessagesFilePath: string;
    apiConversationHistory: Anthropic.MessageParam[];
  }> {
    const history = this.getTaskHistory();
    const historyItem = history.find((item) => item.id === id);

    if (historyItem) {
      const { getTaskDirectoryPath } = await import("../../utils/storage");
      const globalStoragePath = this.contextProxy.globalStorageUri.fsPath;
      const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id);
      const apiConversationHistoryFilePath = path.join(
        taskDirPath,
        GlobalFileNames.apiConversationHistory,
      );
      const uiMessagesFilePath = path.join(
        taskDirPath,
        GlobalFileNames.uiMessages,
      );
      const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath);

      if (fileExists) {
        const apiConversationHistory = JSON.parse(
          await fs.readFile(apiConversationHistoryFilePath, "utf8"),
        );

        // kilocode_change: The global state 'taskHistory' can be stale if a save is pending.
        // We must read the latest apiConfiguration directly from the metadata file on disk
        // to prevent the "Shared Provider Leak" when switching chats rapidly.
        try {
          const metadataPath = path.join(
            taskDirPath,
            GlobalFileNames.taskMetadata,
          );
          if (await fileExistsAtPath(metadataPath)) {
            const metadata = JSON.parse(
              await fs.readFile(metadataPath, "utf8"),
            );
            if (metadata.apiConfiguration) {
              (historyItem as any).apiConfiguration = metadata.apiConfiguration;
            }
          }
        } catch (e) {
          // this.log(`[PERSISTENCE_DEBUG] Failed to read fresh metadata for task ${id}: ${e.message}`)
        }

        return {
          historyItem,
          taskDirPath,
          apiConversationHistoryFilePath,
          uiMessagesFilePath,
          apiConversationHistory,
        };
      } else {
        if (kilo_withMessage) {
          vscode.window.showErrorMessage(
            `Task file not found for task ID: ${id} (file ${apiConversationHistoryFilePath})`,
          ); //kilocode_change show extra debugging information to debug task not found issues
        }
      }
    } else {
      if (kilo_withMessage) {
        vscode.window.showErrorMessage(
          `Task with ID: ${id} not found in history.`,
        ); // kilocode_change show extra debugging information to debug task not found issues
      }
    }

    // if we tried to get a task that doesn't exist, remove it from state
    // FIXME: this seems to happen sometimes when the json file doesnt save to disk for some reason
    // await this.deleteTaskFromState(id) // kilocode_change disable confusing behaviour
    await this.setTaskFileNotFound(id); // kilocode_change
    throw new Error("Task not found");
  }

  async showTaskWithId(id: string) {
    const prevTask = this.getCurrentTask();
    const prevState = await this.getState();
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] ====== ENTERING CHAT ${id} ======`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] Previous task: ${prevTask?.taskId ?? "NONE (home page)"}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] BEFORE switch - Global currentApiConfigName: ${prevState.currentApiConfigName}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] BEFORE switch - Global apiProvider: ${prevState.apiConfiguration?.apiProvider}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] BEFORE switch - Global model: ${prevState.apiConfiguration?.apiModelId || prevState.apiConfiguration?.openRouterModelId || (prevState.apiConfiguration as any)?.kilocodeModel || "NONE"}`)

    if (id !== this.getCurrentTask()?.taskId) {
      // kilocode_change: Stash the current home page profile before entering the chat.
      // This allows us to restore it when the user leaves the chat (clearTask).
      // ONLY stash if coming from home page (no task on stack) AND we don't already have a stash.
      if (!prevTask) {
        if (!this.savedHomeProfileName) {
          this.savedHomeProfileName = prevState.currentApiConfigName;
          // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] Stashed home profile: "${this.savedHomeProfileName}"`)
        } else {
          // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] Preserving stashed home profile: "${this.savedHomeProfileName}" (already set)`)
        }
      }

      // Non-current task.
      // Force reload from disk to ensure we have the latest persisted configuration.
      // This prevents the "Shared Provider Leak" where rapid switching might use stale global state.
      const { historyItem } = await this.getTaskWithId(id);
      // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] History item mode: ${historyItem.mode}`)
      // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] History item has apiConfiguration: ${!!(historyItem as any).apiConfiguration}`)
      if ((historyItem as any).apiConfiguration) {
        const hc = (historyItem as any).apiConfiguration;
        // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] History apiProvider: ${hc.apiProvider}, model: ${hc.apiModelId || hc.openRouterModelId || hc.kilocodeModel || "NONE"}`)
      }

      // If we have a task-specific config, we MUST ensure the global state doesn't overwrite it
      // during the brief window before the Task instance is fully initialized.
      await this.createTaskWithHistoryItem(historyItem); // Clears existing task.
      await this.postStateToWebview(); // kilocode_change: Ensure state is updated after switching
    }

    const afterState = await this.getState();
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] AFTER switch - Global currentApiConfigName: ${afterState.currentApiConfigName}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] AFTER switch - Global apiProvider: ${afterState.apiConfiguration?.apiProvider}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] AFTER switch - Global model: ${afterState.apiConfiguration?.apiModelId || afterState.apiConfiguration?.openRouterModelId || (afterState.apiConfiguration as any)?.kilocodeModel || "NONE"}`)
    // this.log(`[PERSISTENCE_DEBUG][showTaskWithId] ====== ENTER CHAT COMPLETE ======`)

    await this.postMessageToWebview({
      type: "action",
      action: "chatButtonClicked",
    });
  }

  async exportTaskWithId(id: string) {
    const { historyItem, apiConversationHistory } =
      await this.getTaskWithId(id);
    // Use the saved systemPrompt from history if available, otherwise regenerate it
    const systemPrompt =
      historyItem.systemPrompt ||
      (await generateSystemPrompt(this, {
        type: "invoke",
        invoke: "sendMessage",
        text: "",
        mode: historyItem.mode,
      } as any));
    await downloadTask(historyItem.ts, apiConversationHistory, systemPrompt);
  }

  /* Condenses a task's message history to use fewer tokens. */
  async condenseTaskContext(taskId: string) {
    let task: Task | undefined;
    for (let i = this.clineStack.length - 1; i >= 0; i--) {
      if (this.clineStack[i].taskId === taskId) {
        task = this.clineStack[i];
        break;
      }
    }
    if (!task) {
      throw new Error(`Task with id ${taskId} not found in stack`);
    }
    await task.condenseContext();
    await this.postMessageToWebview({
      type: "condenseTaskContextResponse",
      text: taskId,
    });
  }

  // this function deletes a task from task hidtory, and deletes it's checkpoints and delete the task folder
  async deleteTaskWithId(id: string) {
    try {
      // get the task directory full path
      const { taskDirPath } = await this.getTaskWithId(id);

      // kilocode_change start
      // Check if task is favorited
      const history = this.getTaskHistory();
      const task = history.find((item) => item.id === id);
      if (task?.isFavorited) {
        throw new Error(
          "Cannot delete a favorited task. Please unfavorite it first.",
        );
      }
      // kilocode_change end

      // remove task from stack if it's the current task
      if (id === this.getCurrentTask()?.taskId) {
        // Close the current task instance; delegation flows will be handled via metadata if applicable.
        await this.removeClineFromStack();
      }

      // kilocode_change start - Abort task if it's running
      const runningTask = this.runningTasks.get(id);
      if (runningTask) {
        try {
          await runningTask.abortTask(true);
        } catch (error) {
          this.log(`Failed to abort task ${id} during deletion: ${error}`);
        }
        this.runningTasks.delete(id);
      }
      // kilocode_change end

      // delete task from the task history state
      await this.deleteTaskFromState(id);

      // Delete associated shadow repository or branch.
      // TODO: Store `workspaceDir` in the `HistoryItem` object.
      const globalStorageDir = this.contextProxy.globalStorageUri.fsPath;
      const workspaceDir = this.cwd;

      try {
        await ShadowCheckpointService.deleteTask({
          taskId: id,
          globalStorageDir,
          workspaceDir,
        });
      } catch (error) {
        console.error(
          `[deleteTaskWithId${id}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // delete the entire task directory including checkpoints and all content
      try {
        await fs.rm(taskDirPath, { recursive: true, force: true });
        console.log(`[deleteTaskWithId${id}] removed task directory`);
      } catch (error) {
        console.error(
          `[deleteTaskWithId${id}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      // If task is not found, just remove it from state
      if (error instanceof Error && error.message === "Task not found") {
        await this.deleteTaskFromState(id);
        return;
      }
      throw error;
    }
  }

  async deleteTaskFromState(id: string) {
    // kilocode_change: Use disk-based storage if available
    if (this.taskHistoryStorage) {
      await this.taskHistoryStorage.delete(id);
      this.kiloCodeTaskHistoryVersion++;
      this.recentTasksCache = undefined;
      await this.postStateToWebview();
      return;
    }

    // Fallback to globalState during migration
    const taskHistory = this.getGlobalState("taskHistory") ?? [];
    const updatedTaskHistory = taskHistory.filter((task) => task.id !== id);
    await this.updateGlobalState("taskHistory", updatedTaskHistory);
    this.kiloCodeTaskHistoryVersion++;
    this.recentTasksCache = undefined;
    await this.postStateToWebview();
  }

  async refreshWorkspace() {
    this.currentWorkspacePath = getWorkspacePath();

    await kilo_execIfExtension(() => {
      if (this.currentWorkspacePath) {
        SessionManager.init()?.setWorkspaceDirectory(this.currentWorkspacePath);
      }
    });

    await this.postStateToWebview();
  }

  // Debounced version of postStateToWebview to prevent performance issues from rapid updates.
  // PERF: 500ms debounce with 2000ms maxWait to batch rapid file operations in large codebases.
  // This is critical for preventing lag during rapid edits/writes/undos.
  // getState() does 13+ async operations (cloud, OAuth, etc.) so we must batch aggressively.
  public debouncedPostStateToWebview = debounce(
    () => {
      // Skip if webview not visible - debounced calls can queue up during background operations
      if (this.view && !this.view.visible) {
        return Promise.resolve();
      }
      return this.postStateToWebview();
    },
    75,
    {
      leading: false,
      trailing: true,
      maxWait: 150,
    },
  );

  async postStateToWebview() {
    // PERF: Skip the expensive state rebuild when the webview is not visible.
    // Background tasks calling this repeatedly would waste CPU on building
    // 100+ fields of state, fetching cloud orgs, checking MCP servers, etc.
    // The state will be rebuilt when the webview becomes visible again.
    if (this.view && !this.view.visible) {
      return;
    }

    const state = await this.getStateToPostToWebview();
    // this.log(`[postStateToWebview] Posting state. Current Provider: ${state.apiConfiguration.apiProvider}, Model: ${state.apiConfiguration.apiModelId || (state.apiConfiguration as any).openRouterModelId || (state.apiConfiguration as any).kilocodeModel}`)
    this.postMessageToWebview({ type: "state", state });

    // Check MDM compliance and send user to account tab if not compliant
    // Only redirect if there's an actual MDM policy requiring authentication
    if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
      await this.postMessageToWebview({
        type: "action",
        action: "cloudButtonClicked",
      });
    }
  }

  // kilocode_change start
  async postRulesDataToWebview() {
    const workspacePath = this.cwd;
    if (workspacePath) {
      this.postMessageToWebview({
        type: "rulesData",
        ...(await getEnabledRules(
          workspacePath,
          this.contextProxy,
          this.context,
        )),
      });
    }
  }
  // kilocode_change end

  /**
	/**
	 * Fetches marketplace data on demand to avoid blocking main state updates
	 */
  async fetchMarketplaceData(search?: string) {
    try {
      const [marketplaceResult, marketplaceInstalledMetadata] =
        await Promise.all([
          this.marketplaceManager.getMarketplaceItems(search).catch((error) => {
            console.error("Failed to fetch marketplace items:", error);
            return {
              organizationMcps: [],
              marketplaceItems: [],
              errors: [error.message],
            };
          }),
          this.marketplaceManager.getInstallationMetadata().catch((error) => {
            console.error("Failed to fetch installation metadata:", error);
            return { project: {}, global: {} } as MarketplaceInstalledMetadata;
          }),
        ]);

      // Send marketplace data separately
      this.postMessageToWebview({
        type: "marketplaceData",
        organizationMcps: marketplaceResult.organizationMcps || [],
        marketplaceItems: marketplaceResult.marketplaceItems || [],
        marketplaceInstalledMetadata: marketplaceInstalledMetadata || {
          project: {},
          global: {},
        },
        errors: marketplaceResult.errors,
      });
    } catch (error) {
      console.error("Failed to fetch marketplace data:", error);

      // Send empty data on error to prevent UI from hanging
      this.postMessageToWebview({
        type: "marketplaceData",
        organizationMcps: [],
        marketplaceItems: [],
        marketplaceInstalledMetadata: { project: {}, global: {} },
        errors: [error instanceof Error ? error.message : String(error)],
      });

      // Show user-friendly error notification for network issues
      if (error instanceof Error && error.message.includes("timeout")) {
        vscode.window.showWarningMessage(
          "Marketplace data could not be loaded due to network restrictions. Core functionality remains available.",
        );
      }
    }
  }

  /**
   * Fetches skills from skills.sh
   */
  async fetchSkills(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const https = require('https')
      https.get('https://skills.sh/', (res: any) => {
        let data = ''
        res.on('data', (chunk: any) => data += chunk)
        res.on('end', () => {
          try {
            const startMarker = '\\"initialSkills\\":['
            const startIdx = data.indexOf(startMarker)
            if (startIdx === -1) {
              reject(new Error('Could not find initialSkills'))
              return
            }
            
            const endMarker = '],\\"totalSkills\\":'
            const endIdx = data.indexOf(endMarker, startIdx)
            if (endIdx === -1) {
              reject(new Error('Could not find end of initialSkills'))
              return
            }
            
            const jsonStart = startIdx + startMarker.length - 1
            const escapedJson = data.substring(jsonStart, endIdx + 1)
            const jsonStr = escapedJson.replace(/\\"/g, '"')
            
            const skills = JSON.parse(jsonStr)
            resolve(skills)
          } catch (err) {
            reject(err)
          }
        })
      }).on('error', reject)
    })
  }

  /**
   * Search skills using CLI
   */
  async searchSkills(query: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      const search = spawn('npx', ['skills', 'find', query], {
        shell: true
      })
      
      let output = ''
      
      search.stdout.on('data', (data: any) => {
        output += data.toString()
      })
      
      search.on('close', (code: number) => {
        if (code === 0) {
          try {
            // Strip ANSI codes
            const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')
            
            const lines = cleanOutput.split('\n')
            const skills: any[] = []
            
            lines.forEach(line => {
              // Match: owner/repo@skill-name [installs]
              const match = line.match(/([a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+)@([a-zA-Z0-9-_:]+)\s+([0-9.]+[KM]?)\s+installs/)
              if (match) {
                const [, source, skillId, installs] = match
                const installCount = installs.includes('K') 
                  ? parseFloat(installs) * 1000 
                  : installs.includes('M') 
                  ? parseFloat(installs) * 1000000 
                  : parseInt(installs)
                
                skills.push({
                  name: skillId,
                  source: source,
                  skillId: skillId,
                  installs: installCount
                })
              }
            })
            
            resolve(skills)
          } catch (err) {
            reject(err)
          }
        } else {
          reject(new Error('Search failed'))
        }
      })
    })
  }

  /**
   * Install a skill
   */
  async installSkill(source: string, skillId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      const repoUrl = `https://github.com/${source}.git`
      
      const install = spawn('npx', ['--yes', 'skills', 'add', '-y', '-g', repoUrl, skillId], {
        shell: true
      })
      
      let output = ''
      
      install.stdout.on('data', (data: any) => {
        output += data.toString()
      })
      
      install.stderr.on('data', (data: any) => {
        output += data.toString()
      })
      
      install.on('close', (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Installation failed with code ${code}`))
        }
      })
      
      install.on('error', reject)
    })
    }

    /**
    * Fetch installed skills from ~/.agents/skills/
    */
    async fetchInstalledSkills(): Promise<Array<{ id: string; name: string; path: string; content?: string }>> {
    return new Promise(async (resolve, reject) => {
    try {
    const { spawn } = require('child_process')
    const list = spawn('npx', ['skills', 'list', '-g'], {
    shell: true
    })

    let output = ''

    list.stdout.on('data', (data: any) => {
    output += data.toString()
    })

    list.on('close', async (code: number) => {
    if (code === 0) {
    try {
    // Strip ANSI codes
    const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = cleanOutput.split('\n')
    const skills: Array<{ id: string; name: string; path: string; content?: string }> = []

    for (const line of lines) {
      // Support both older indented output and newer plain output from `npx skills list -g`.
      // Format examples:
      // "  skill-name ~/.agents/skills/skill-name"
      // "skill-name ~/.agents/skills/skill-name"
      const match = line.match(/^\s*([a-zA-Z0-9-_]+)\s+(~\/\.agents\/skills\/[^\s]+)/)
      if (match) {
        const [, name, skillPath] = match
        const expandedSkillPath = skillPath.replace(/^~(?=\/)/, require('os').homedir())

        skills.push({
          id: name,
          name: name,
          path: expandedSkillPath,
        })
      }
    }

    resolve(skills)
    } catch (err) {
    reject(err)
    }
    } else {
    resolve([]) // Return empty array if no skills installed
    }
    })

    list.on('error', (err: any) => {
    console.error('Error listing skills:', err)
    resolve([]) // Return empty array on error
    })
    } catch (err: any) {
    reject(err)
    }
    })
    }

  /**
   * Checks if there is a file-based system prompt override for the given mode
   */
  async hasFileBasedSystemPromptOverride(mode: Mode): Promise<boolean> {
    const promptFilePath = getSystemPromptFilePath(this.cwd, mode);
    return await fileExistsAtPath(promptFilePath);
  }

  /**
   * Merges allowed commands from global state and workspace configuration
   * with proper validation and deduplication
   */
  private mergeAllowedCommands(globalStateCommands?: string[]): string[] {
    return this.mergeCommandLists(
      "allowedCommands",
      "allowed",
      globalStateCommands,
    );
  }

  /**
   * Merges denied commands from global state and workspace configuration
   * with proper validation and deduplication
   */
  private mergeDeniedCommands(globalStateCommands?: string[]): string[] {
    return this.mergeCommandLists(
      "deniedCommands",
      "denied",
      globalStateCommands,
    );
  }

  /**
   * Common utility for merging command lists from global state and workspace configuration.
   * Implements the Command Denylist feature's merging strategy with proper validation.
   *
   * @param configKey - VSCode workspace configuration key
   * @param commandType - Type of commands for error logging
   * @param globalStateCommands - Commands from global state
   * @returns Merged and deduplicated command list
   */
  private mergeCommandLists(
    configKey: "allowedCommands" | "deniedCommands",
    commandType: "allowed" | "denied",
    globalStateCommands?: string[],
  ): string[] {
    try {
      // Validate and sanitize global state commands
      const validGlobalCommands = Array.isArray(globalStateCommands)
        ? globalStateCommands.filter(
            (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
          )
        : [];

      // Get workspace configuration commands
      const workspaceCommands =
        vscode.workspace
          .getConfiguration(Package.name)
          .get<string[]>(configKey) || [];

      // Validate and sanitize workspace commands
      const validWorkspaceCommands = Array.isArray(workspaceCommands)
        ? workspaceCommands.filter(
            (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
          )
        : [];

      // Combine and deduplicate commands
      // Global state takes precedence over workspace configuration
      const mergedCommands = [
        ...new Set([...validGlobalCommands, ...validWorkspaceCommands]),
      ];

      return mergedCommands;
    } catch (error) {
      console.error(`Error merging ${commandType} commands:`, error);
      // Return empty array as fallback to prevent crashes
      return [];
    }
  }

  async getStateToPostToWebview(): Promise<ExtensionState> {
    const currentTask = this.getCurrentTask();
    const allowedCommands = (await this.contextProxy.getValue(
      "allowedCommands",
    )) as string[] | undefined;
    const deniedCommands = (await this.contextProxy.getValue(
      "deniedCommands",
    )) as string[] | undefined;
    const {
      apiConfiguration: globalApiConfiguration,
      customInstructions,
      alwaysAllowReadOnly,
      alwaysAllowReadOnlyOutsideWorkspace,
      alwaysAllowWrite,
      alwaysAllowWriteOutsideWorkspace,
      alwaysAllowWriteProtected,
      alwaysAllowDelete, // kilocode_change
      alwaysAllowExecute,
      alwaysAllowBrowser,
      alwaysAllowMcp,
      alwaysAllowModeSwitch,
      alwaysAllowSubtasks,
      alwaysAllowUpdateTodoList,
      allowedMaxRequests,
      allowedMaxCost,
      autoCondenseContext,
      autoCondenseContextPercent,
      soundEnabled,
      ttsEnabled,
      ttsSpeed,
      diffEnabled,
      enableCheckpoints,
      checkpointTimeout,
      // taskHistory, // kilocode_change
      soundVolume,
      browserViewportSize,
      screenshotQuality,
      remoteBrowserHost,
      remoteBrowserEnabled,
      cachedChromeHostUrl,
      writeDelayMs,
      terminalOutputLineLimit,
      terminalOutputCharacterLimit,
      terminalShellIntegrationTimeout,
      terminalShellIntegrationDisabled,
      terminalCommandDelay,
      terminalPowershellCounter,
      terminalZshClearEolMark,
      terminalZshOhMy,
      terminalZshP10k,
      terminalZdotdir,
      fuzzyMatchThreshold,
      // mcpEnabled,  // kilocode_change: always true
      enableMcpServerCreation,
      alwaysApproveResubmit,
      requestDelaySeconds,
      currentApiConfigName,
      listApiConfigMeta,
      pinnedApiConfigs,
      dismissedUpsells,
      mode,
      customModePrompts,
      customSupportPrompts,
      enhancementApiConfigId,
      commitMessageApiConfigId, // kilocode_change
      terminalCommandApiConfigId, // kilocode_change
      autoApprovalEnabled,
      customModes,
      experiments,
      maxOpenTabsContext,
      maxWorkspaceFiles,
      browserToolEnabled,
      disableBrowserHeadless, // kilocode_change
      telemetrySetting,
      showRooIgnoredFiles,
      language,
      showAutoApproveMenu, // kilocode_change
      showTaskTimeline, // kilocode_change
      sendMessageOnEnter, // kilocode_change
      showTimestamps, // kilocode_change
      hideCostBelowThreshold, // kilocode_change
      collapseCodeToolsByDefault,
      maxReadFileLine,
      maxImageFileSize,
      maxTotalImageSize,
      terminalCompressProgressBar,
      historyPreviewCollapsed,
      reasoningBlockCollapsed,
      enterBehavior,
      cloudUserInfo,
      cloudIsAuthenticated,
      sharingEnabled,
      organizationAllowList,
      organizationSettingsVersion,
      maxConcurrentFileReads,
      allowVeryLargeReads, // kilocode_change
      ghostServiceSettings, // kilocode_changes
      condensingApiConfigId,
      customCondensingPrompt,
      codebaseIndexConfig,
      codebaseIndexModels,
      profileThresholds,
      systemNotificationsEnabled, // kilocode_change
      dismissedNotificationIds, // kilocode_change
      morphApiKey, // kilocode_change
      fastApplyModel, // kilocode_change: Fast Apply model selection
      fastApplyApiProvider, // kilocode_change: Fast Apply model api base url
      alwaysAllowFollowupQuestions,
      followupAutoApproveTimeoutMs,
      includeDiagnosticMessages,
      maxDiagnosticMessages,
      includeTaskHistoryInEnhance,
      includeCurrentTime,
      includeCurrentCost,
      maxGitStatusFiles,
      taskSyncEnabled,
      remoteControlEnabled,
      imageGenerationProvider,
      openRouterImageApiKey,
      kiloCodeImageApiKey,
      openRouterImageGenerationSelectedModel,
      openRouterUseMiddleOutTransform,
      featureRoomoteControlEnabled,
      yoloMode, // kilocode_change
      yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
      isBrowserSessionActive,
      openAiCodexAccountId,
      openAiCodexAuthenticated,
      antigravityAuthenticated,
      antigravityEmail,
      antigravityProjectId,
      geminiCliAuthenticated,
      geminiCliEmail,
      geminiCliProjectId,
      sttProvider,
      sttModelId,
      autoPurgeEnabled,
      autoPurgeDefaultRetentionDays,
      autoPurgeFavoritedTaskRetentionDays,
      autoPurgeCompletedTaskRetentionDays,
      autoPurgeIncompleteTaskRetentionDays,
      autoPurgeLastRunTimestamp,
      infinityEnabled,
      infinityPrompt,
      infinityIntervalMinutes,
      infinityIsRunning,
      infinityScheduleType,
      infinityScheduleHour,
      infinityScheduleMinute,
      infinityNextRunAt,
      infinitySavedPrompts,
      activeInfinityPromptId,
      subAgentToolEnabled,
      showSubAgentBanner,
      proLicenseKey,
    } = await this.getState();

    // kilocode_change start: Use task-specific config for UI state if in a chat
    // This is the final piece of the "Shared Provider Leak" fix.
    // If a task is active, the UI MUST reflect that task's configuration,
    // not the global "Home" configuration, to prevent "Sticky Model" leaks
    // when switching between chats or from home to chat.
    const apiConfiguration =
      currentTask?.apiConfiguration || globalApiConfiguration;

    // kilocode_change start: Get active model for virtual quota fallback UI display
    const virtualQuotaActiveModel =
      apiConfiguration?.apiProvider === "virtual-quota-fallback" && currentTask
        ? currentTask.api.getModel()
        : undefined;
    // kilocode_change end

    // kilocode_change start - checkSpeechToTextAvailable (only when experiment enabled)
    let speechToTextStatus:
      | { available: boolean; reason?: "apiKeyMissing" | "ffmpegNotInstalled" }
      | undefined = undefined;
    if (experiments?.speechToText) {
      speechToTextStatus = await checkSpeechToTextAvailable(
        this.providerSettingsManager,
      );
    }
    // kilocode_change end - checkSpeechToTextAvailable

    let cloudOrganizations: CloudOrganizationMembership[] = [];

    try {
      if (!CloudService.instance.isCloudAgent) {
        const now = Date.now();

        if (
          this.cloudOrganizationsCache !== null &&
          this.cloudOrganizationsCacheTimestamp !== null &&
          now - this.cloudOrganizationsCacheTimestamp <
            ClineProvider.CLOUD_ORGANIZATIONS_CACHE_DURATION_MS
        ) {
          cloudOrganizations = this.cloudOrganizationsCache!;
        } else {
          cloudOrganizations =
            await CloudService.instance.getOrganizationMemberships();
          this.cloudOrganizationsCache = cloudOrganizations;
          this.cloudOrganizationsCacheTimestamp = now;
        }
      }
    } catch (error) {
      // Ignore this error.
    }

    const telemetryKey = process.env.KILOCODE_POSTHOG_API_KEY;
    const machineId = vscode.env.machineId;

    const mergedAllowedCommands = this.mergeAllowedCommands(allowedCommands);
    const mergedDeniedCommands = this.mergeDeniedCommands(deniedCommands);
    const cwd = this.cwd;

    // Check if there's a system prompt override for the current mode
    const currentMode = mode ?? defaultModeSlug;
    const hasSystemPromptOverride =
      await this.hasFileBasedSystemPromptOverride(currentMode);

    // kilocode_change start wrapper information
    const kiloCodeWrapperProperties = getKiloCodeWrapperProperties();
    // kilocode_change: Cache task history to avoid loading entire array on every state rebuild
    // This is critical for performance in large codebases with many tasks
    let taskHistory: HistoryItem[];
    let taskHistoryLength: number;
    if (this.kiloCodeTaskHistoryVersion === this.cachedTaskHistoryVersion) {
      // Use cached length - don't load the full array
      taskHistoryLength = this.cachedTaskHistoryLength;
      // Only load full array if we need currentTaskItem
      const currentTaskId = this.getCurrentTask()?.taskId;
      if (currentTaskId) {
        taskHistory = this.getTaskHistory();
      } else {
        taskHistory = [];
      }
    } else {
      taskHistory = this.getTaskHistory();
      taskHistoryLength = taskHistory.length;
      this.cachedTaskHistoryLength = taskHistory.length;
      this.cachedTaskHistoryVersion = this.kiloCodeTaskHistoryVersion;
    }
    this.kiloCodeTaskHistorySizeForTelemetryOnly = taskHistoryLength;
    // kilocode_change end

    return {
      version: this.context.extension?.packageJSON?.version ?? "",
      apiConfiguration,
      subAgentToolEnabled: subAgentToolEnabled ?? false,
      showSubAgentBanner: showSubAgentBanner !== false,
      proLicenseKey,
      customInstructions,
      alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
      alwaysAllowReadOnlyOutsideWorkspace:
        alwaysAllowReadOnlyOutsideWorkspace ?? false,
      alwaysAllowWrite: alwaysAllowWrite ?? true,
      alwaysAllowWriteOutsideWorkspace:
        alwaysAllowWriteOutsideWorkspace ?? false,
      alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? false,
      alwaysAllowDelete: alwaysAllowDelete ?? false, // kilocode_change
      alwaysAllowExecute: alwaysAllowExecute ?? true,
      alwaysAllowBrowser: alwaysAllowBrowser ?? true,
      alwaysAllowMcp: alwaysAllowMcp ?? true,
      alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? true,
      alwaysAllowSubtasks: alwaysAllowSubtasks ?? true,
      alwaysAllowUpdateTodoList: alwaysAllowUpdateTodoList ?? true,
      isBrowserSessionActive,
      yoloMode: yoloMode ?? false, // kilocode_change
      allowedMaxRequests,
      allowedMaxCost,
      autoCondenseContext: autoCondenseContext ?? true,
      autoCondenseContextPercent: autoCondenseContextPercent ?? 100,
      uriScheme: vscode.env.uriScheme,
      uiKind: vscode.UIKind[vscode.env.uiKind], // kilocode_change
      kiloCodeWrapperProperties, // kilocode_change wrapper information
      kilocodeDefaultModel: await getKilocodeDefaultModel(
        apiConfiguration.kilocodeToken,
        apiConfiguration.kilocodeOrganizationId,
      ),
      currentTaskItem: this.getCurrentTask()?.taskId
        ? (taskHistory || []).find(
            (item: HistoryItem) => item.id === this.getCurrentTask()?.taskId,
          )
        : undefined,
      clineMessages: this.getCurrentTask()?.clineMessages || [],
      currentTaskTodos: this.getCurrentTask()?.todoList || [],
      messageQueue: this.getCurrentTask()?.messageQueueService?.messages,
      taskHistoryFullLength: taskHistoryLength, // kilocode_change: use cached length
      taskHistoryVersion: this.kiloCodeTaskHistoryVersion, // kilocode_change
      soundEnabled: soundEnabled ?? false,
      ttsEnabled: ttsEnabled ?? false,
      ttsSpeed: ttsSpeed ?? 1.0,
      diffEnabled: diffEnabled ?? true,
      enableCheckpoints: enableCheckpoints ?? false,
      checkpointTimeout:
        checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
      shouldShowAnnouncement: false, // kilocode_change
      allowedCommands: mergedAllowedCommands,
      deniedCommands: mergedDeniedCommands,
      soundVolume: soundVolume ?? 0.5,
      browserViewportSize: browserViewportSize ?? "900x600",
      screenshotQuality: screenshotQuality ?? 75,
      remoteBrowserHost,
      remoteBrowserEnabled: remoteBrowserEnabled ?? false,
      cachedChromeHostUrl: cachedChromeHostUrl,
      writeDelayMs: writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
      terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
      terminalOutputCharacterLimit:
        terminalOutputCharacterLimit ?? DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
      terminalShellIntegrationTimeout:
        terminalShellIntegrationTimeout ??
        Terminal.defaultShellIntegrationTimeout,
      terminalShellIntegrationDisabled:
        terminalShellIntegrationDisabled ?? true,
      terminalCommandDelay: terminalCommandDelay ?? 0,
      terminalPowershellCounter: terminalPowershellCounter ?? false,
      terminalZshClearEolMark: terminalZshClearEolMark ?? true,
      terminalZshOhMy: terminalZshOhMy ?? false,
      terminalZshP10k: terminalZshP10k ?? false,
      terminalZdotdir: terminalZdotdir ?? false,
      fuzzyMatchThreshold: fuzzyMatchThreshold ?? 1.0,
      mcpEnabled: true, // kilocode_change: always true
      enableMcpServerCreation: enableMcpServerCreation ?? true,
      alwaysApproveResubmit: alwaysApproveResubmit ?? true,
      requestDelaySeconds: requestDelaySeconds ?? 10,
      currentApiConfigName: currentApiConfigName ?? "default",
      listApiConfigMeta: listApiConfigMeta ?? [],
      pinnedApiConfigs: pinnedApiConfigs ?? {},
      mode: mode ?? defaultModeSlug,
      customModePrompts: customModePrompts ?? {},
      customSupportPrompts: customSupportPrompts ?? {},
      enhancementApiConfigId,
      commitMessageApiConfigId, // kilocode_change
      terminalCommandApiConfigId, // kilocode_change
      autoApprovalEnabled: autoApprovalEnabled ?? true,
      customModes,
      experiments: experiments ?? experimentDefault,
      mcpServers: this.mcpHub?.getAllServers() ?? [],
      maxOpenTabsContext: maxOpenTabsContext ?? 20,
      maxWorkspaceFiles: maxWorkspaceFiles ?? 200,
      cwd,
      browserToolEnabled: browserToolEnabled ?? false,
      disableBrowserHeadless: disableBrowserHeadless ?? false, // kilocode_change
      telemetrySetting,
      telemetryKey,
      machineId,
      showRooIgnoredFiles: showRooIgnoredFiles ?? false,
      showAutoApproveMenu: showAutoApproveMenu ?? false, // kilocode_change
      showTaskTimeline: showTaskTimeline ?? true, // kilocode_change
      sendMessageOnEnter: sendMessageOnEnter ?? true, // kilocode_change
      showTimestamps: showTimestamps ?? false, // kilocode_change
      hideCostBelowThreshold, // kilocode_change
      collapseCodeToolsByDefault: collapseCodeToolsByDefault ?? false,
      language, // kilocode_change
      renderContext: this.renderContext,
      maxReadFileLine: maxReadFileLine ?? -1,
      maxImageFileSize: maxImageFileSize ?? 5,
      maxTotalImageSize: maxTotalImageSize ?? 20,
      maxConcurrentFileReads: maxConcurrentFileReads ?? 5,
      allowVeryLargeReads: allowVeryLargeReads ?? false, // kilocode_change
      settingsImportedAt: this.settingsImportedAt,
      terminalCompressProgressBar: terminalCompressProgressBar ?? true,
      hasSystemPromptOverride,
      historyPreviewCollapsed: historyPreviewCollapsed ?? false,
      reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
      enterBehavior: enterBehavior ?? "send",
      cloudUserInfo,
      cloudIsAuthenticated: cloudIsAuthenticated ?? false,
      cloudOrganizations,
      sharingEnabled: sharingEnabled ?? false,
      organizationAllowList,
      // kilocode_change start
      ghostServiceSettings: ghostServiceSettings,
      // kilocode_change end
      organizationSettingsVersion,
      condensingApiConfigId,
      customCondensingPrompt,
      yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
      codebaseIndexModels: codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
      codebaseIndexConfig: {
        codebaseIndexEnabled:
          codebaseIndexConfig?.codebaseIndexEnabled ?? false,
        codebaseIndexQdrantUrl:
          codebaseIndexConfig?.codebaseIndexQdrantUrl ??
          "http://localhost:6333",
        // kilocode_change start
        codebaseIndexVectorStoreProvider:
          codebaseIndexConfig?.codebaseIndexVectorStoreProvider ?? "qdrant",
        codebaseIndexLancedbVectorStoreDirectory:
          codebaseIndexConfig?.codebaseIndexLancedbVectorStoreDirectory,
        // kilocode_change end
        codebaseIndexEmbedderProvider:
          codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
        codebaseIndexEmbedderBaseUrl:
          codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
        codebaseIndexEmbedderModelId:
          codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
        codebaseIndexEmbedderModelDimension:
          codebaseIndexConfig?.codebaseIndexEmbedderModelDimension ?? 1536,
        codebaseIndexOpenAiCompatibleBaseUrl:
          codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
        codebaseIndexSearchMaxResults:
          codebaseIndexConfig?.codebaseIndexSearchMaxResults,
        codebaseIndexSearchMinScore:
          codebaseIndexConfig?.codebaseIndexSearchMinScore,
        // kilocode_change start
        codebaseIndexEmbeddingBatchSize:
          codebaseIndexConfig?.codebaseIndexEmbeddingBatchSize,
        codebaseIndexScannerMaxBatchRetries:
          codebaseIndexConfig?.codebaseIndexScannerMaxBatchRetries,
        // kilocode_change end
        codebaseIndexBedrockRegion:
          codebaseIndexConfig?.codebaseIndexBedrockRegion,
        codebaseIndexBedrockProfile:
          codebaseIndexConfig?.codebaseIndexBedrockProfile,
        codebaseIndexOpenRouterSpecificProvider:
          codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
        codebaseIndexIncludePaths:
          this.context.workspaceState.get<string[]>(
            "codebaseIndexIncludePaths",
          ) ?? [],
      },
      // Only set mdmCompliant if there's an actual MDM policy
      // undefined means no MDM policy, true means compliant, false means non-compliant
      mdmCompliant: this.mdmService?.requiresCloudAuth()
        ? this.checkMdmCompliance()
        : undefined,
      profileThresholds: profileThresholds ?? {},
      cloudApiUrl: getRooCodeApiUrl(),
      hasOpenedModeSelector:
        this.getGlobalState("hasOpenedModeSelector") ?? false,
      systemNotificationsEnabled: systemNotificationsEnabled ?? false, // kilocode_change
      dismissedNotificationIds: dismissedNotificationIds ?? [], // kilocode_change
      morphApiKey, // kilocode_change
      fastApplyModel: fastApplyModel ?? "auto", // kilocode_change: Fast Apply model selection
      fastApplyApiProvider: fastApplyApiProvider ?? "current", // kilocode_change: Fast Apply model api base url
      alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
      followupAutoApproveTimeoutMs: followupAutoApproveTimeoutMs ?? 60000,
      includeDiagnosticMessages: includeDiagnosticMessages ?? true,
      maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
      includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
      includeCurrentTime: includeCurrentTime ?? true,
      includeCurrentCost: includeCurrentCost ?? true,
      maxGitStatusFiles: maxGitStatusFiles ?? 0,
      slidingWindowSize:
        (this.getGlobalState("slidingWindowSize") as number) ?? 50, // kilocode_change
      taskSyncEnabled,
      remoteControlEnabled,
      imageGenerationProvider,
      openRouterImageApiKey,
      subAgentApiConfiguration: this.contextProxy.getValue(
        "subAgentApiConfiguration" as any,
      ) as any,
      // kilocode_change start - Auto-purge settings (use already-destructured values from getState above)
      autoPurgeEnabled,
      autoPurgeDefaultRetentionDays,
      autoPurgeFavoritedTaskRetentionDays,
      autoPurgeCompletedTaskRetentionDays,
      autoPurgeIncompleteTaskRetentionDays,
      autoPurgeLastRunTimestamp,
      infinityEnabled: infinityEnabled ?? false,
      infinityPrompt: infinityPrompt ?? "",
      infinityIntervalMinutes: Math.max(1, infinityIntervalMinutes ?? 5),
      infinityIsRunning: infinityIsRunning ?? false,
      infinityScheduleType: infinityScheduleType ?? "interval",
      infinityScheduleHour: infinityScheduleHour ?? 9,
      infinityScheduleMinute: infinityScheduleMinute ?? 0,
      infinityNextRunAt,
      infinitySavedPrompts: infinitySavedPrompts ?? [],
      activeInfinityPromptId,
      // kilocode_change end
      kiloCodeImageApiKey,
      openRouterImageGenerationSelectedModel,
      openRouterUseMiddleOutTransform,
      featureRoomoteControlEnabled,
      virtualQuotaActiveModel, // kilocode_change: Include virtual quota active model in state
      debug: vscode.workspace
        .getConfiguration(Package.name)
        .get<boolean>("debug", false),
      speechToTextStatus, // kilocode_change: Speech-to-text availability status with failure reason
      undoneToolIds:
        this.context.workspaceState.get<string[]>("claudix.undoneToolIds") ||
        [],
      acceptedToolIds:
        this.context.workspaceState.get<string[]>("claudix.acceptedToolIds") ||
        [],
      activeTaskIds: Array.from(this.runningTasks.keys()), // kilocode_change: track active tasks
      openAiCodexAccountId,
      openAiCodexAuthenticated,
      antigravityAuthenticated: antigravityAuthenticated ?? false,
      antigravityEmail,
      antigravityProjectId,
      geminiCliAuthenticated: geminiCliAuthenticated ?? false,
      geminiCliEmail,
      geminiCliProjectId,
      sttProvider,
      sttModelId,
    };
  }
  /**
   * Storage
   * https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
   * https://www.eliostruyf.com/devhack-code-extension-storage-options/
   */

  async getState(): Promise<
    Omit<
      ExtensionState,
      | "clineMessages"
      | "renderContext"
      | "hasOpenedModeSelector"
      | "version"
      | "shouldShowAnnouncement"
      | "hasSystemPromptOverride"
      | "taskHistoryFullLength"
      | "taskHistoryVersion"
    >
  > {
    const stateValues = this.contextProxy.getValues();
    const cloudService = CloudService.hasInstance()
      ? CloudService.instance
      : undefined;

    // Parallelize heavy async calls
    const [
      customModes,
      organizationAllowListResult,
      cloudUserInfoResult,
      cloudIsAuthenticatedResult,
      sharingEnabledResult,
      taskSyncEnabledResult,
      openAiCodexAccountId,
      openAiCodexAuthenticated,
      antigravityCredentials,
      antigravityProjectId,
      geminiCliCredentials,
      geminiCliProjectId,
      claudeCodeAuthenticated,
    ] = await Promise.allSettled([
      this.customModesManager.getCustomModes(),
      cloudService
        ? cloudService.getAllowList()
        : Promise.resolve(ORGANIZATION_ALLOW_ALL),
      Promise.resolve(cloudService?.getUserInfo() ?? null),
      Promise.resolve(cloudService?.isAuthenticated() ?? false),
      cloudService ? cloudService.canShareTask() : Promise.resolve(false),
      Promise.resolve(cloudService?.isTaskSyncEnabled() ?? false),
      openAiCodexOAuthManager.getAccountId(),
      openAiCodexOAuthManager.isAuthenticated(),
      antigravityOAuthManager.loadCredentials(),
      antigravityOAuthManager.getProjectId(),
      geminiOAuthManager.loadCredentials(),
      geminiOAuthManager.getProjectId(),
      claudeCodeOAuthManager.isAuthenticated(),
    ]);

    const customModesValue =
      customModes.status === "fulfilled" ? customModes.value : [];
    const organizationAllowList =
      organizationAllowListResult.status === "fulfilled"
        ? organizationAllowListResult.value
        : ORGANIZATION_ALLOW_ALL;
    const cloudUserInfo =
      cloudUserInfoResult.status === "fulfilled"
        ? cloudUserInfoResult.value
        : null;
    const cloudIsAuthenticated =
      cloudIsAuthenticatedResult.status === "fulfilled"
        ? cloudIsAuthenticatedResult.value
        : false;
    const sharingEnabled =
      sharingEnabledResult.status === "fulfilled"
        ? sharingEnabledResult.value
        : false;
    const taskSyncEnabled =
      taskSyncEnabledResult.status === "fulfilled"
        ? taskSyncEnabledResult.value
        : false;
    const antigravityCredentialsValue =
      antigravityCredentials.status === "fulfilled"
        ? antigravityCredentials.value
        : undefined;
    const geminiCliCredentialsValue =
      geminiCliCredentials.status === "fulfilled"
        ? geminiCliCredentials.value
        : undefined;

    // kilocode_change: Check if we have credentials for other providers to set a better default
    const antigravityAuth = antigravityCredentialsValue;
    const geminiCliAuth = geminiCliCredentialsValue;

    // Build the apiConfiguration object combining state values and secrets.
    // kilocode_change: Use current task's configuration if available for per-chat model persistence.
    // If we are in a task, we MUST use its configuration entirely to avoid the "Sticky Reset"
    // where the UI flips back to the global default during refreshes.
    // kilocode_change: Use current task's configuration if available for per-chat model persistence.
    // If we are in a task, we MUST use its configuration entirely.
    // kilocode_change: Check both the stack and the running tasks.
    // Sub-agents are often added to runningTasks but NOT the stack to avoid UI focus-stealing.
    // We want the UI to reflect the configuration of the task currently being "viewed" or "spawned".
    // kilocode_change: ONLY use the task that is actively on the stack (being viewed).
    // Do NOT fall back to runningTasks — those are background tasks whose config
    // should NOT pollute the home page UI state. This was the root cause of the
    // "Shared Provider Leak" where a background task's model would stick on the home page.
    const currentTask = this.getCurrentTask();

    // this.log(`[PERSISTENCE_DEBUG][getStateToPostToWebview] currentTask on stack: ${currentTask?.taskId ?? "NONE"}, runningTasks: ${this.runningTasks.size}`)

    // If we have an active task, its configuration is the absolute authority.
    // We do NOT fall back to global settings for any field if the task has a config.
    const providerSettings =
      currentTask?.apiConfiguration || this.contextProxy.getProviderSettings();

    // Determine apiProvider
    let apiProvider: ProviderName | undefined = providerSettings.apiProvider;

    // Only fall back to global state/defaults if we are NOT in an active task.
    // This prevents the "Sticky Reset" where global settings bleed into a sub-agent or chat.
    if (!currentTask) {
      if (!apiProvider) {
        apiProvider = stateValues.apiProvider;
      }

      if (!apiProvider) {
        if (antigravityAuth) {
          apiProvider = "antigravity";
        } else if (geminiCliAuth) {
          apiProvider = "gemini-cli";
        } else {
          apiProvider = "kilocode";
        }
      }
    }

    // Ensure apiProvider is set properly if not already in state
    if (!providerSettings.apiProvider) {
      providerSettings.apiProvider = apiProvider;
    }

    let organizationSettingsVersion: number = -1;
    try {
      if (CloudService.hasInstance()) {
        const settings = CloudService.instance.getOrganizationSettings();
        organizationSettingsVersion = settings?.version ?? -1;
      }
    } catch (error) {}

    // Get actual browser session state
    const isBrowserSessionActive =
      this.getCurrentTask()?.browserSession?.isSessionActive() ?? false;

    // Return the same structure as before.
    return {
      apiConfiguration: providerSettings,
      subAgentToolEnabled: stateValues.subAgentToolEnabled ?? false,
      showSubAgentBanner: stateValues.showSubAgentBanner !== false,
      proLicenseKey: stateValues.proLicenseKey,
      kilocodeDefaultModel: await getKilocodeDefaultModel(
        providerSettings.kilocodeToken,
        providerSettings.kilocodeOrganizationId,
        providerSettings,
      ),
      lastShownAnnouncementId: stateValues.lastShownAnnouncementId,
      customInstructions: stateValues.customInstructions,
      apiModelId: stateValues.apiModelId,
      alwaysAllowReadOnly: stateValues.alwaysAllowReadOnly ?? true,
      alwaysAllowReadOnlyOutsideWorkspace:
        stateValues.alwaysAllowReadOnlyOutsideWorkspace ?? false,
      alwaysAllowWrite: stateValues.alwaysAllowWrite ?? true,
      alwaysAllowWriteOutsideWorkspace:
        stateValues.alwaysAllowWriteOutsideWorkspace ?? false,
      alwaysAllowWriteProtected: stateValues.alwaysAllowWriteProtected ?? false,
      alwaysAllowDelete: stateValues.alwaysAllowDelete ?? false,
      alwaysAllowExecute: stateValues.alwaysAllowExecute ?? true,
      alwaysAllowBrowser: stateValues.alwaysAllowBrowser ?? true,
      alwaysAllowMcp: stateValues.alwaysAllowMcp ?? true,
      alwaysAllowModeSwitch: stateValues.alwaysAllowModeSwitch ?? true,
      alwaysAllowSubtasks: stateValues.alwaysAllowSubtasks ?? true,
      alwaysAllowFollowupQuestions:
        stateValues.alwaysAllowFollowupQuestions ?? false,
      alwaysAllowUpdateTodoList: stateValues.alwaysAllowUpdateTodoList ?? true,
      isBrowserSessionActive,
      yoloMode: stateValues.yoloMode ?? false, // kilocode_change
      followupAutoApproveTimeoutMs:
        stateValues.followupAutoApproveTimeoutMs ?? 60000,
      diagnosticsEnabled: stateValues.diagnosticsEnabled ?? true,
      allowedMaxRequests: stateValues.allowedMaxRequests,
      allowedMaxCost: stateValues.allowedMaxCost,
      autoCondenseContext: stateValues.autoCondenseContext ?? true,
      autoCondenseContextPercent: stateValues.autoCondenseContextPercent ?? 100,
      // taskHistory: stateValues.taskHistory ?? [], // kilocode_change
      allowedCommands: stateValues.allowedCommands,
      deniedCommands: stateValues.deniedCommands,
      soundEnabled: stateValues.soundEnabled ?? false,
      ttsEnabled: stateValues.ttsEnabled ?? false,
      ttsSpeed: stateValues.ttsSpeed ?? 1.0,
      diffEnabled: stateValues.diffEnabled ?? true,
      enableCheckpoints: stateValues.enableCheckpoints ?? false,
      checkpointTimeout:
        stateValues.checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
      soundVolume: stateValues.soundVolume,
      browserViewportSize: stateValues.browserViewportSize ?? "900x600",
      screenshotQuality: stateValues.screenshotQuality ?? 75,
      remoteBrowserHost: stateValues.remoteBrowserHost,
      remoteBrowserEnabled: stateValues.remoteBrowserEnabled ?? true,
      cachedChromeHostUrl: stateValues.cachedChromeHostUrl as
        | string
        | undefined,
      fuzzyMatchThreshold: stateValues.fuzzyMatchThreshold ?? 1.0,
      writeDelayMs: stateValues.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
      terminalOutputLineLimit: stateValues.terminalOutputLineLimit ?? 500,
      terminalOutputCharacterLimit:
        stateValues.terminalOutputCharacterLimit ??
        DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
      terminalShellIntegrationTimeout:
        stateValues.terminalShellIntegrationTimeout ??
        Terminal.defaultShellIntegrationTimeout,
      terminalShellIntegrationDisabled:
        stateValues.terminalShellIntegrationDisabled ?? true,
      terminalCommandDelay: stateValues.terminalCommandDelay ?? 0,
      terminalPowershellCounter: stateValues.terminalPowershellCounter ?? false,
      terminalZshClearEolMark: stateValues.terminalZshClearEolMark ?? true,
      terminalZshOhMy: stateValues.terminalZshOhMy ?? false,
      terminalZshP10k: stateValues.terminalZshP10k ?? false,
      terminalZdotdir: stateValues.terminalZdotdir ?? false,
      terminalCompressProgressBar:
        stateValues.terminalCompressProgressBar ?? true,
      mode: stateValues.mode ?? defaultModeSlug,
      language: stateValues.language ?? formatLanguage(vscode.env.language),
      mcpEnabled: true, // kilocode_change: always true
      enableMcpServerCreation: stateValues.enableMcpServerCreation ?? true,
      mcpServers: this.mcpHub?.getAllServers() ?? [],
      alwaysApproveResubmit: stateValues.alwaysApproveResubmit ?? true,
      requestDelaySeconds: Math.max(5, stateValues.requestDelaySeconds ?? 10),
      currentApiConfigName: stateValues.currentApiConfigName ?? "default",
      listApiConfigMeta: stateValues.listApiConfigMeta ?? [],
      pinnedApiConfigs: stateValues.pinnedApiConfigs ?? {},
      dismissedUpsells: stateValues.dismissedUpsells ?? [],
      modeApiConfigs:
        stateValues.modeApiConfigs ?? ({} as Record<Mode, string>),
      customModePrompts: stateValues.customModePrompts ?? {},
      customSupportPrompts: stateValues.customSupportPrompts ?? {},
      enhancementApiConfigId: stateValues.enhancementApiConfigId,
      commitMessageApiConfigId: stateValues.commitMessageApiConfigId, // kilocode_change
      terminalCommandApiConfigId: stateValues.terminalCommandApiConfigId, // kilocode_change
      // kilocode_change start
      ghostServiceSettings: stateValues.ghostServiceSettings,
      // kilocode_change end
      // kilocode_change start - Auto-purge settings
      autoPurgeEnabled: stateValues.autoPurgeEnabled ?? false,
      autoPurgeDefaultRetentionDays:
        stateValues.autoPurgeDefaultRetentionDays ?? 30,
      autoPurgeFavoritedTaskRetentionDays:
        stateValues.autoPurgeFavoritedTaskRetentionDays ?? null,
      autoPurgeCompletedTaskRetentionDays:
        stateValues.autoPurgeCompletedTaskRetentionDays ?? 30,
      autoPurgeIncompleteTaskRetentionDays:
        stateValues.autoPurgeIncompleteTaskRetentionDays ?? 7,
      autoPurgeLastRunTimestamp: stateValues.autoPurgeLastRunTimestamp,
      infinityEnabled: stateValues.infinityEnabled ?? false,
      infinityPrompt: stateValues.infinityPrompt ?? "",
      infinityIntervalMinutes: Math.max(
        1,
        stateValues.infinityIntervalMinutes ?? 5,
      ),
      infinityIsRunning: stateValues.infinityIsRunning ?? false,
      infinityScheduleType: stateValues.infinityScheduleType ?? "interval",
      infinityScheduleHour: stateValues.infinityScheduleHour ?? 9,
      infinityScheduleMinute: stateValues.infinityScheduleMinute ?? 0,
      infinityNextRunAt: stateValues.infinityNextRunAt,
      infinitySavedPrompts: stateValues.infinitySavedPrompts ?? [],
      activeInfinityPromptId: stateValues.activeInfinityPromptId,
      // kilocode_change end
      experiments: stateValues.experiments ?? experimentDefault,
      autoApprovalEnabled: stateValues.autoApprovalEnabled ?? true,
      customModes: customModesValue,
      maxOpenTabsContext: stateValues.maxOpenTabsContext ?? 20,
      maxWorkspaceFiles: stateValues.maxWorkspaceFiles ?? 200,
      openRouterUseMiddleOutTransform:
        stateValues.openRouterUseMiddleOutTransform,
      browserToolEnabled: stateValues.browserToolEnabled ?? false,
      telemetrySetting: stateValues.telemetrySetting || "unset",
      showRooIgnoredFiles: stateValues.showRooIgnoredFiles ?? false,
      disableBrowserHeadless: stateValues.disableBrowserHeadless ?? false, // kilocode_change
      showAutoApproveMenu: stateValues.showAutoApproveMenu ?? false, // kilocode_change
      showTaskTimeline: stateValues.showTaskTimeline ?? true, // kilocode_change
      sendMessageOnEnter: stateValues.sendMessageOnEnter ?? true, // kilocode_change
      showTimestamps: stateValues.showTimestamps ?? false, // kilocode_change
      hideCostBelowThreshold: stateValues.hideCostBelowThreshold ?? 0, // kilocode_change
      collapseCodeToolsByDefault: stateValues.collapseCodeToolsByDefault ?? false,
      maxReadFileLine: stateValues.maxReadFileLine ?? -1,
      maxImageFileSize: stateValues.maxImageFileSize ?? 5,
      maxTotalImageSize: stateValues.maxTotalImageSize ?? 20,
      maxConcurrentFileReads: stateValues.maxConcurrentFileReads ?? 5,
      allowVeryLargeReads: stateValues.allowVeryLargeReads ?? false, // kilocode_change
      systemNotificationsEnabled:
        stateValues.systemNotificationsEnabled ?? true, // kilocode_change
      dismissedNotificationIds: stateValues.dismissedNotificationIds ?? [], // kilocode_change
      morphApiKey: stateValues.morphApiKey, // kilocode_change
      fastApplyModel: stateValues.fastApplyModel ?? "auto", // kilocode_change: Fast Apply model selection
      fastApplyApiProvider: stateValues.fastApplyApiProvider ?? "current", // kilocode_change: Fast Apply model api config id
      historyPreviewCollapsed: stateValues.historyPreviewCollapsed ?? false,
      reasoningBlockCollapsed: stateValues.reasoningBlockCollapsed ?? true,
      enterBehavior: stateValues.enterBehavior ?? "send",
      subAgentApiConfiguration: this.contextProxy.getValue(
        "subAgentApiConfiguration" as any,
      ) as any,
      cloudUserInfo,
      cloudIsAuthenticated,
      sharingEnabled,
      organizationAllowList,
      organizationSettingsVersion,
      condensingApiConfigId: stateValues.condensingApiConfigId,
      customCondensingPrompt: stateValues.customCondensingPrompt,
      yoloGatekeeperApiConfigId: stateValues.yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
      codebaseIndexModels:
        stateValues.codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
      codebaseIndexConfig: {
        codebaseIndexEnabled:
          stateValues.codebaseIndexConfig?.codebaseIndexEnabled ?? false,
        codebaseIndexQdrantUrl:
          stateValues.codebaseIndexConfig?.codebaseIndexQdrantUrl ??
          "http://localhost:6333",
        codebaseIndexEmbedderProvider:
          stateValues.codebaseIndexConfig?.codebaseIndexEmbedderProvider ??
          "openai",
        // kilocode_change start
        codebaseIndexVectorStoreProvider:
          stateValues.codebaseIndexConfig?.codebaseIndexVectorStoreProvider ??
          "qdrant",
        codebaseIndexLancedbVectorStoreDirectory:
          stateValues.codebaseIndexConfig
            ?.codebaseIndexLancedbVectorStoreDirectory,
        // kilocode_change end
        codebaseIndexEmbedderBaseUrl:
          stateValues.codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
        codebaseIndexEmbedderModelId:
          stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
        codebaseIndexEmbedderModelDimension:
          stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension,
        codebaseIndexOpenAiCompatibleBaseUrl:
          stateValues.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
        codebaseIndexSearchMaxResults:
          stateValues.codebaseIndexConfig?.codebaseIndexSearchMaxResults,
        codebaseIndexSearchMinScore:
          stateValues.codebaseIndexConfig?.codebaseIndexSearchMinScore,
        // kilocode_change start
        codebaseIndexEmbeddingBatchSize:
          stateValues.codebaseIndexConfig?.codebaseIndexEmbeddingBatchSize,
        codebaseIndexScannerMaxBatchRetries:
          stateValues.codebaseIndexConfig?.codebaseIndexScannerMaxBatchRetries,
        // kilocode_change end
        codebaseIndexBedrockRegion:
          stateValues.codebaseIndexConfig?.codebaseIndexBedrockRegion,
        codebaseIndexBedrockProfile:
          stateValues.codebaseIndexConfig?.codebaseIndexBedrockProfile,
        codebaseIndexOpenRouterSpecificProvider:
          stateValues.codebaseIndexConfig
            ?.codebaseIndexOpenRouterSpecificProvider,
        codebaseIndexIncludePaths:
          this.context.workspaceState.get<string[]>(
            "codebaseIndexIncludePaths",
          ) ?? [],
      },
      profileThresholds: stateValues.profileThresholds ?? {},
      includeDiagnosticMessages: stateValues.includeDiagnosticMessages ?? true,
      maxDiagnosticMessages: stateValues.maxDiagnosticMessages ?? 50,
      includeTaskHistoryInEnhance:
        stateValues.includeTaskHistoryInEnhance ?? true,
      includeCurrentTime: stateValues.includeCurrentTime ?? true,
      includeCurrentCost: stateValues.includeCurrentCost ?? true,
      maxGitStatusFiles: stateValues.maxGitStatusFiles ?? 0,
      taskSyncEnabled,
      remoteControlEnabled: (() => {
        try {
          const cloudSettings = CloudService.instance.getUserSettings();
          return cloudSettings?.settings?.extensionBridgeEnabled ?? false;
        } catch (error) {
          console.error(
            `[getState] failed to get remote control setting from cloud: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      })(),
      imageGenerationProvider: stateValues.imageGenerationProvider,
      openRouterImageApiKey: stateValues.openRouterImageApiKey,
      kiloCodeImageApiKey: stateValues.kiloCodeImageApiKey,
      openRouterImageGenerationSelectedModel:
        stateValues.openRouterImageGenerationSelectedModel,
      featureRoomoteControlEnabled: (() => {
        try {
          const userSettings = CloudService.instance.getUserSettings();
          const hasOrganization = cloudUserInfo?.organizationId != null;
          return (
            hasOrganization ||
            (userSettings?.features?.roomoteControlEnabled ?? false)
          );
        } catch (error) {
          console.error(
            `[getState] failed to get featureRoomoteControlEnabled: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      })(),
      enabledSkills: stateValues.enabledSkills ?? [],
      openAiCodexAccountId:
        (openAiCodexAccountId.status === "fulfilled"
          ? openAiCodexAccountId.value
          : undefined) ?? undefined,
      openAiCodexAuthenticated:
        openAiCodexAuthenticated.status === "fulfilled"
          ? openAiCodexAuthenticated.value
          : false,
      antigravityAuthenticated:
        antigravityCredentials.status === "fulfilled"
          ? !!antigravityCredentials.value
          : false,
      antigravityEmail:
        (antigravityCredentials.status === "fulfilled"
          ? antigravityCredentials.value?.email
          : undefined) ?? undefined,
      antigravityProjectId:
        (antigravityProjectId.status === "fulfilled"
          ? antigravityProjectId.value
          : undefined) ?? undefined,
      geminiCliAuthenticated:
        geminiCliCredentials.status === "fulfilled"
          ? !!geminiCliCredentials.value
          : false,
      geminiCliEmail:
        (geminiCliCredentials.status === "fulfilled"
          ? geminiCliCredentials.value?.email
          : undefined) ?? undefined,
      geminiCliProjectId:
        (geminiCliProjectId.status === "fulfilled"
          ? geminiCliProjectId.value
          : undefined) ?? undefined,
      claudeCodeAuthenticated:
        claudeCodeAuthenticated.status === "fulfilled"
          ? claudeCodeAuthenticated.value
          : false,
      sttProvider: providerSettings.sttProvider,
      sttModelId: providerSettings.sttModelId,
    };
  }

  async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
    // kilocode_change: Wait for storage to be ready before using it
    await this.taskHistoryStorageReady;

    // Use disk-based storage if available
    if (this.taskHistoryStorage) {
      const history = await this.taskHistoryStorage.upsert(item);
      this.kiloCodeTaskHistoryVersion++;
      this.recentTasksCache = undefined;
      return history;
    }

    // Fallback to globalState during migration
    const history =
      (this.getGlobalState("taskHistory") as HistoryItem[] | undefined) || [];
    const existingItemIndex = history.findIndex((h) => h.id === item.id);

    if (existingItemIndex !== -1) {
      // Preserve existing metadata (e.g., delegation fields) unless explicitly overwritten.
      // This prevents loss of status/awaitingChildId/delegatedToId when tasks are reopened,
      // terminated, or when routine message persistence occurs.
      history[existingItemIndex] = {
        ...history[existingItemIndex],
        ...item,
      };
    } else {
      history.push(item);
    }

    await this.updateGlobalState("taskHistory", history);
    this.kiloCodeTaskHistoryVersion++;
    this.recentTasksCache = undefined;

    return history;
  }

  // ContextProxy

  // @deprecated - Use `ContextProxy#setValue` instead.
  private async updateGlobalState<K extends keyof GlobalState>(
    key: K,
    value: GlobalState[K],
  ) {
    await this.contextProxy.setValue(key, value);
  }

  // @deprecated - Use `ContextProxy#getValue` instead.
  private getGlobalState<K extends keyof GlobalState>(key: K) {
    return this.contextProxy.getValue(key);
  }

  public async setValue<K extends keyof RooCodeSettings>(
    key: K,
    value: RooCodeSettings[K],
  ) {
    await this.contextProxy.setValue(key, value);
  }

  public getValue<K extends keyof RooCodeSettings>(key: K) {
    return this.contextProxy.getValue(key);
  }

  public getValues() {
    return this.contextProxy.getValues();
  }

  public async setValues(values: RooCodeSettings) {
    await this.contextProxy.setValues(values);
  }

  // dev

  async resetState() {
    const answer = await vscode.window.showInformationMessage(
      t("common:confirmation.reset_state"),
      { modal: true },
      t("common:answers.yes"),
    );

    if (answer !== t("common:answers.yes")) {
      return;
    }

    // Logout from Kilo Code provider before resetting (same approach as ProfileView logout)
    const { apiConfiguration, currentApiConfigName = "default" } =
      await this.getState();
    if (apiConfiguration.kilocodeToken) {
      await this.upsertProviderProfile(currentApiConfigName, {
        ...apiConfiguration,
        kilocodeToken: "",
      });
    }

    await this.contextProxy.resetAllState();
    await this.providerSettingsManager.resetAllConfigs();
    await this.customModesManager.resetCustomModes();

    await this.removeClineFromStack();
    await this.postStateToWebview();
    await this.postMessageToWebview({
      type: "action",
      action: "chatButtonClicked",
    });
  }

  // logging

  public log(message: string) {
    this.outputChannel.appendLine(message);
    console.log(message);
  }

  // getters

  public get workspaceTracker(): WorkspaceTracker | undefined {
    return this._workspaceTracker;
  }

  get viewLaunched() {
    return this.isViewLaunched;
  }

  get messages() {
    return this.getCurrentTask()?.clineMessages || [];
  }

  public getMcpHub(): McpHub | undefined {
    return this.mcpHub;
  }

  /**
   * Check if the current state is compliant with MDM policy
   * @returns true if compliant or no MDM policy exists, false if MDM policy exists and user is non-compliant
   */
  public checkMdmCompliance(): boolean {
    if (!this.mdmService) {
      return true; // No MDM service, allow operation
    }

    const compliance = this.mdmService.isCompliant();

    if (!compliance.compliant) {
      return false;
    }

    return true;
  }

  public async remoteControlEnabled(enabled: boolean) {
    if (!enabled) {
      await BridgeOrchestrator.disconnect();
      return;
    }

    const userInfo = CloudService.instance.getUserInfo();

    if (!userInfo) {
      this.log(
        "[ClineProvider#remoteControlEnabled] Failed to get user info, disconnecting",
      );
      await BridgeOrchestrator.disconnect();
      return;
    }

    const config = await CloudService.instance.cloudAPI
      ?.bridgeConfig()
      .catch(() => undefined);

    if (!config) {
      this.log(
        "[ClineProvider#remoteControlEnabled] Failed to get bridge config",
      );
      return;
    }

    await BridgeOrchestrator.connectOrDisconnect(userInfo, enabled, {
      ...config,
      provider: this,
      sessionId: vscode.env.sessionId,
      isCloudAgent: CloudService.instance.isCloudAgent,
    });

    const bridge = BridgeOrchestrator.getInstance();

    if (bridge) {
      const currentTask = this.getCurrentTask();

      if (currentTask && !currentTask.enableBridge) {
        try {
          currentTask.enableBridge = true;
          await BridgeOrchestrator.subscribeToTask(currentTask);
        } catch (error) {
          const message = `[ClineProvider#remoteControlEnabled] BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`;
          this.log(message);
          console.error(message);
        }
      }
    } else {
      for (const task of this.clineStack) {
        if (task.enableBridge) {
          try {
            await BridgeOrchestrator.getInstance()?.unsubscribeFromTask(
              task.taskId,
            );
          } catch (error) {
            const message = `[ClineProvider#remoteControlEnabled] BridgeOrchestrator#unsubscribeFromTask() failed: ${error instanceof Error ? error.message : String(error)}`;
            this.log(message);
            console.error(message);
          }
        }
      }
    }
  }

  /**
   * Gets the CodeIndexManager for the current active workspace
   * @returns CodeIndexManager instance for the current workspace or the default one
   */
  public getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
    return CodeIndexManager.getInstance(this.context);
  }

  /**
   * Updates the code index status subscription to listen to the current workspace manager
   */
  private updateCodeIndexStatusSubscription(): void {
    // Get the current workspace manager
    const currentManager = this.getCurrentWorkspaceCodeIndexManager();

    // If the manager hasn't changed, no need to update subscription
    if (currentManager === this.codeIndexManager) {
      return;
    }

    // Dispose the old subscription if it exists
    if (this.codeIndexStatusSubscription) {
      this.codeIndexStatusSubscription.dispose();
      this.codeIndexStatusSubscription = undefined;
    }

    // Update the current workspace manager reference
    this.codeIndexManager = currentManager;

    // Subscribe to the new manager's progress updates if it exists
    if (currentManager) {
      this.codeIndexStatusSubscription = currentManager.onProgressUpdate(
        (update: IndexProgressUpdate) => {
          // Only send updates if this manager is still the current one
          if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
            // Get the full status from the manager to ensure we have all fields correctly formatted
            const fullStatus = currentManager.getCurrentStatus();
            this.postMessageToWebview({
              type: "indexingStatusUpdate",
              values: fullStatus,
            });
          }
        },
      );

      if (this.view) {
        this.webviewDisposables.push(this.codeIndexStatusSubscription);
      }

      // Send initial status for the current workspace
      this.postMessageToWebview({
        type: "indexingStatusUpdate",
        values: currentManager.getCurrentStatus(),
      });
    }
  }

  /**
   * TaskProviderLike, TelemetryPropertiesProvider
   */

  public getCurrentTask(): Task | undefined {
    if (this.clineStack.length === 0) {
      return undefined;
    }

    return this.clineStack[this.clineStack.length - 1];
  }

  public getRecentTasks(): string[] {
    if (this.recentTasksCache) {
      return this.recentTasksCache;
    }

    const history = this.getTaskHistory();
    const workspaceTasks: HistoryItem[] = [];

    for (const item of history) {
      if (!item.ts || !item.task || item.workspace !== this.cwd) {
        continue;
      }

      workspaceTasks.push(item);
    }

    if (workspaceTasks.length === 0) {
      this.recentTasksCache = [];
      return this.recentTasksCache;
    }

    workspaceTasks.sort((a, b) => b.ts - a.ts);
    let recentTaskIds: string[] = [];

    if (workspaceTasks.length >= 100) {
      // If we have at least 100 tasks, return tasks from the last 7 days.
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      for (const item of workspaceTasks) {
        // Stop when we hit tasks older than 7 days.
        if (item.ts < sevenDaysAgo) {
          break;
        }

        recentTaskIds.push(item.id);
      }
    } else {
      // Otherwise, return the most recent 100 tasks (or all if less than 100).
      recentTaskIds = workspaceTasks
        .slice(0, Math.min(100, workspaceTasks.length))
        .map((item) => item.id);
    }

    this.recentTasksCache = recentTaskIds;
    return this.recentTasksCache;
  }

  // When initializing a new task, (not from history but from a tool command
  // new_task) there is no need to remove the previous task since the new
  // task is a subtask of the previous one, and when it finishes it is removed
  // from the stack and the caller is resumed in this way we can have a chain
  // of tasks, each one being a sub task of the previous one until the main
  // task is finished.
  public async createTask(
    text?: string,
    images?: string[],
    parentTask?: Task,
    options: CreateTaskOptions = {},
    configuration: RooCodeSettings = {},
  ): Promise<Task> {
    if (configuration && !parentTask) {
      await this.setValues(configuration);

      if (configuration.allowedCommands) {
        await vscode.workspace
          .getConfiguration(Package.name)
          .update(
            "allowedCommands",
            configuration.allowedCommands,
            vscode.ConfigurationTarget.Global,
          );
      }

      if (configuration.deniedCommands) {
        await vscode.workspace
          .getConfiguration(Package.name)
          .update(
            "deniedCommands",
            configuration.deniedCommands,
            vscode.ConfigurationTarget.Global,
          );
      }

      if (configuration.commandExecutionTimeout !== undefined) {
        await vscode.workspace
          .getConfiguration(Package.name)
          .update(
            "commandExecutionTimeout",
            configuration.commandExecutionTimeout,
            vscode.ConfigurationTarget.Global,
          );
      }

      if (configuration.currentApiConfigName) {
        await this.setProviderProfile(configuration.currentApiConfigName);
      }
    }

    const state = await this.getState();
    const {
      organizationAllowList,
      diffEnabled: enableDiff,
      enableCheckpoints,
      checkpointTimeout,
      fuzzyMatchThreshold,
      experiments,
      cloudUserInfo,
      remoteControlEnabled,
    } = state;

    // kilocode_change: If a specific configuration was provided (like from RunSubAgentTool),
    // use it as an override for the new task's apiConfiguration.
    // We cast to any to bypass the strict ProviderSettings vs RooCodeSettings mapping.
    const apiConfiguration: ProviderSettings = {
      ...state.apiConfiguration,
      ...(configuration as any),
    };

    // Single-open-task invariant: always enforce for user-initiated top-level tasks
    let previousApiConversationHistory: any[] | undefined; // kilocode_change

    if (!parentTask && !options.background) {
      // kilocode_change start: Capture previous conversation history
      const currentTask = this.getCurrentTask();
      if (currentTask) {
        previousApiConversationHistory = currentTask.apiConversationHistory;
      }
      // kilocode_change end

      try {
        await this.removeClineFromStack();
      } catch {
        // Non-fatal
      }
    }

    if (
      !ProfileValidator.isProfileAllowed(
        apiConfiguration,
        organizationAllowList,
      )
    ) {
      throw new OrganizationAllowListViolationError(
        t("common:errors.violated_organization_allowlist"),
      );
    }

    const task = new Task({
      provider: this,
      context: this.context, // kilocode_change
      apiConfiguration,
      enableDiff,
      enableCheckpoints,
      checkpointTimeout,
      fuzzyMatchThreshold,
      consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
      task: text,
      images,
      experiments,
      rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
      parentTask,
      taskNumber: this.clineStack.length + 1,
      onCreated: this.taskCreationCallback,
      enableBridge: BridgeOrchestrator.isEnabled(
        cloudUserInfo,
        remoteControlEnabled,
      ),
      initialTodos: options.initialTodos,
      previousApiConversationHistory, // kilocode_change
      ...options,
    });

    if (options.background || (parentTask && options.initialStatus === "active")) {
      // For autonomous sub-agents, we don't want to switch the UI focus.
      // We just add it to the running tasks so it can execute in the background.
      this.runningTasks.set(task.taskId, task);
    } else {
      await this.addClineToStack(task);
    }

    this.log(
      `[createTask] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
    );

    return task;
  }

  public async cancelTask(taskId?: string): Promise<void> {
    const task = taskId ? this.runningTasks.get(taskId) : this.getCurrentTask();

    if (!task) {
      return;
    }

    console.log(
      `[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`,
    );

    const { historyItem, uiMessagesFilePath } = await this.getTaskWithId(
      task.taskId,
    );

    // Preserve parent and root task information for history item.
    const rootTask = task.rootTask;
    const parentTask = task.parentTask;

    // Mark this as a user-initiated cancellation so provider-only rehydration can occur
    task.abortReason = "user_cancelled";

    // Capture the current instance and ID to detect if rehydrate already occurred elsewhere
    const originalInstanceId = task.instanceId;
    const originalTaskId = task.taskId;

    if (!taskId || taskId === originalTaskId) {
      // Foreground cancel (Stop button in active chat).
      // We ONLY cancel the HTTP request to interrupt the streaming generation.
      // We DO NOT abort the task loop so it can continue waiting for the user's next message!
      task.interruptTask();
      // Keep it in runningTasks so the loop stays active.
      await this.postStateToWebview();
    } else {
      // Background full close/abort.
      // This is for explicitly closed chats or background tasks we don't want running anymore.
      task.abortReason = "user_cancelled";
      task.cancelCurrentRequest();
      task.abortTask();
      task.abandoned = true;
      this.runningTasks.delete(task.taskId);

      // Background wait for cleanup
      pWaitFor(
        () =>
          this.getCurrentTask()! === undefined ||
          this.getCurrentTask()!.isStreaming === false ||
          this.getCurrentTask()!.didFinishAbortingStream ||
          this.getCurrentTask()!.isWaitingForFirstChunk,
        {
          timeout: 3_000,
        },
      ).catch(() => {
        console.error("Failed to abort background task");
      });

      await this.postStateToWebview();
    }
  }

  // Clear the current task without treating it as a subtask.
  // This is used when the user cancels a task that is not a subtask.
  public async clearTask(): Promise<void> {
    const beforeState = await this.getState();
    // this.log(`[PERSISTENCE_DEBUG][clearTask] ====== EXITING CHAT ======`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] BEFORE clear - Stack size: ${this.clineStack.length}`)
    if (this.clineStack.length > 0) {
      const task = this.clineStack[this.clineStack.length - 1]!;
      // this.log(`[PERSISTENCE_DEBUG][clearTask] Clearing task: ${task.taskId}.${task.instanceId}`)
      // this.log(`[PERSISTENCE_DEBUG][clearTask] Task apiProvider: ${task.apiConfiguration?.apiProvider}`)
      // this.log(`[PERSISTENCE_DEBUG][clearTask] Task model: ${task.apiConfiguration?.apiModelId || task.apiConfiguration?.openRouterModelId || (task.apiConfiguration as any)?.kilocodeModel || "NONE"}`)
      console.log(
        `[clearTask] clearing task ${task.taskId}.${task.instanceId}`,
      );
      await this.removeClineFromStack();
    }
    // this.log(`[PERSISTENCE_DEBUG][clearTask] BEFORE clear - Global currentApiConfigName: ${beforeState.currentApiConfigName}`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] BEFORE clear - Global apiProvider: ${beforeState.apiConfiguration?.apiProvider}`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] BEFORE clear - Global model: ${beforeState.apiConfiguration?.apiModelId || beforeState.apiConfiguration?.openRouterModelId || (beforeState.apiConfiguration as any)?.kilocodeModel || "NONE"}`)

    // kilocode_change: Restore the home page profile that was stashed before entering the chat.
    // This prevents the "Shared Provider Leak" where the chat's profile sticks on the home page.
    if (this.savedHomeProfileName && this.clineStack.length === 0) {
      // this.log(`[PERSISTENCE_DEBUG][clearTask] >>> RESTORING HOME PROFILE: "${this.savedHomeProfileName}" <<<`)
      try {
        await this.activateProviderProfile({ name: this.savedHomeProfileName });
        // this.log(`[PERSISTENCE_DEBUG][clearTask] Home profile restored successfully`)
      } catch (error) {
        // this.log(`[PERSISTENCE_DEBUG][clearTask] Failed to restore home profile: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.savedHomeProfileName = undefined;
    }

    const afterState = await this.getState();
    // this.log(`[PERSISTENCE_DEBUG][clearTask] AFTER clear - Global currentApiConfigName: ${afterState.currentApiConfigName}`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] AFTER clear - Global apiProvider: ${afterState.apiConfiguration?.apiProvider}`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] AFTER clear - Global model: ${afterState.apiConfiguration?.apiModelId || afterState.apiConfiguration?.openRouterModelId || (afterState.apiConfiguration as any)?.kilocodeModel || "NONE"}`)
    // this.log(`[PERSISTENCE_DEBUG][clearTask] ====== EXIT CHAT COMPLETE ======`)
  }

  public resumeTask(taskId: string): void {
    // Use the existing showTaskWithId method which handles both current and
    // historical tasks.
    this.showTaskWithId(taskId).catch((error) => {
      this.log(`Failed to resume task ${taskId}: ${error.message}`);
    });
  }

  // Modes

  public async getModes(): Promise<{ slug: string; name: string }[]> {
    try {
      const customModes = await this.customModesManager.getCustomModes();
      return [...DEFAULT_MODES, ...customModes].map(({ slug, name }) => ({
        slug,
        name,
      }));
    } catch (error) {
      return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }));
    }
  }

  public async getMode(): Promise<string> {
    const { mode } = await this.getState();
    return mode;
  }

  public async setMode(mode: string): Promise<void> {
    await this.setValues({ mode });
  }

  // Provider Profiles

  public async getProviderProfiles(): Promise<
    { name: string; provider?: string }[]
  > {
    const { listApiConfigMeta = [] } = await this.getState();
    return listApiConfigMeta.map((profile) => ({
      name: profile.name,
      provider: profile.apiProvider,
    }));
  }

  public async getProviderProfile(): Promise<string> {
    const { currentApiConfigName = "default" } = await this.getState();
    return currentApiConfigName;
  }

  public async setProviderProfile(name: string): Promise<void> {
    await this.activateProviderProfile({ name });
  }

  // Telemetry

  private _appProperties?: StaticAppProperties;
  private _gitProperties?: GitProperties;

  private getAppProperties(): StaticAppProperties {
    if (!this._appProperties) {
      const packageJSON = this.context.extension?.packageJSON;
      // kilocode_change start
      const {
        kiloCodeWrapped,
        kiloCodeWrapper,
        kiloCodeWrapperCode,
        kiloCodeWrapperVersion,
        kiloCodeWrapperTitle,
      } = getKiloCodeWrapperProperties();
      // kilocode_change end

      this._appProperties = {
        appName: packageJSON?.name ?? Package.name,
        appVersion: packageJSON?.version ?? Package.version,
        vscodeVersion: vscode.version,
        platform: isWsl ? "wsl" /* kilocode_change */ : process.platform,
        // kilocode_change start
        editorName: kiloCodeWrapperTitle
          ? kiloCodeWrapperTitle
          : vscode.env.appName,
        wrapped: kiloCodeWrapped,
        wrapper: kiloCodeWrapper,
        wrapperCode: kiloCodeWrapperCode,
        wrapperVersion: kiloCodeWrapperVersion,
        wrapperTitle: kiloCodeWrapperTitle,
        machineId: vscode.env.machineId,
        // kilocode_change end
      };
    }

    return this._appProperties;
  }

  public get appProperties(): StaticAppProperties {
    return this._appProperties ?? this.getAppProperties();
  }

  private getCloudProperties(): CloudAppProperties {
    let cloudIsAuthenticated: boolean | undefined;

    try {
      if (CloudService.hasInstance()) {
        cloudIsAuthenticated = CloudService.instance.isAuthenticated();
      }
    } catch (error) {
      // Silently handle errors to avoid breaking telemetry collection.
      this.log(
        `[getTelemetryProperties] Failed to get cloud auth state: ${error}`,
      );
    }

    return {
      cloudIsAuthenticated,
    };
  }

  private async getTaskProperties(): Promise<
    DynamicAppProperties & TaskProperties
  > {
    const { language = "en", mode, apiConfiguration } = await this.getState();

    const task = this.getCurrentTask();
    const todoList = task?.todoList;
    let todos:
      | {
          total: number;
          completed: number;
          inProgress: number;
          pending: number;
        }
      | undefined;

    if (todoList && todoList.length > 0) {
      todos = {
        total: todoList.length,
        completed: todoList.filter((todo) => todo.status === "completed")
          .length,
        inProgress: todoList.filter((todo) => todo.status === "in_progress")
          .length,
        pending: todoList.filter((todo) => todo.status === "pending").length,
      };
    }

    return {
      language,
      mode,
      taskId: task?.taskId,
      parentTaskId: task?.parentTaskId,
      apiProvider: apiConfiguration?.apiProvider,
      diffStrategy: task?.diffStrategy?.getName(),
      isSubtask: task ? !!task.parentTaskId : undefined,
      ...(todos && { todos }),
      // kilocode_change start
      currentTaskSize: task?.clineMessages.length,
      taskHistorySize:
        this.kiloCodeTaskHistorySizeForTelemetryOnly || undefined,
      toolStyle: resolveToolProtocol(
        apiConfiguration,
        task?.api?.getModel().info,
      ),
      // kilocode_change end
    };
  }

  private async getGitProperties(): Promise<GitProperties> {
    if (!this._gitProperties) {
      this._gitProperties = await getWorkspaceGitInfo();
    }

    return this._gitProperties;
  }

  public get gitProperties(): GitProperties | undefined {
    return this._gitProperties;
  }

  // kilocode_change start
  private _kiloConfig: KilocodeConfig | null = null;
  public async getKiloConfig(): Promise<KilocodeConfig | null> {
    if (this._kiloConfig === null) {
      const { repositoryUrl } = await this.getGitProperties();
      this._kiloConfig = await getKilocodeConfig(this.cwd, repositoryUrl);
      console.log("getKiloConfig", this._kiloConfig);
    }
    return this._kiloConfig;
  }
  // kilocode_change end

  public async getTelemetryProperties(): Promise<TelemetryProperties> {
    // kilocode_change start
    const state = await this.getState();
    const { apiConfiguration, experiments } = state;
    const task = this.getCurrentTask();

    async function getModelId() {
      try {
        if (task?.api instanceof OpenRouterHandler) {
          return { modelId: (await task.api.fetchModel()).id };
        } else {
          return { modelId: task?.api?.getModel().id };
        }
      } catch (error) {
        return {
          modelException: stringifyError(error),
        };
      }
    }

    function getOpenRouter() {
      if (
        apiConfiguration &&
        (apiConfiguration.apiProvider === "openrouter" ||
          apiConfiguration.apiProvider === "kilocode")
      ) {
        return {
          openRouter: {
            sort: apiConfiguration.openRouterProviderSort,
            dataCollection: apiConfiguration.openRouterProviderDataCollection,
            specificProvider: apiConfiguration.openRouterSpecificProvider,
          },
        };
      }
      return {};
    }

    function getMemory() {
      try {
        return { memory: { ...process.memoryUsage() } };
      } catch (error) {
        return {
          memoryException: stringifyError(error),
        };
      }
    }

    const getFastApply = () => {
      try {
        return {
          fastApply: {
            morphFastApply: Boolean(experiments.morphFastApply),
            morphApiKey: Boolean(this.contextProxy.getValue("morphApiKey")),
            selectedModel:
              this.contextProxy.getValue("fastApplyModel") || "auto",
            fastApplyApiProvider:
              this.contextProxy.getValue("fastApplyApiProvider") || "current",
          },
        };
      } catch (error) {
        return {
          fastApplyException: stringifyError(error),
        };
      }
    };

    const getAutoApproveSettings = () => {
      try {
        return {
          autoApprove: {
            autoApprovalEnabled: !!state.autoApprovalEnabled,
            alwaysAllowBrowser: !!state.alwaysAllowBrowser,
            alwaysAllowExecute: !!state.alwaysAllowExecute,
            alwaysAllowFollowupQuestions: !!state.alwaysAllowFollowupQuestions,
            alwaysAllowMcp: !!state.alwaysAllowMcp,
            alwaysAllowModeSwitch: !!state.alwaysAllowModeSwitch,
            alwaysAllowReadOnly: !!state.alwaysAllowReadOnly,
            alwaysAllowReadOnlyOutsideWorkspace:
              !!state.alwaysAllowReadOnlyOutsideWorkspace,
            alwaysAllowSubtasks: !!state.alwaysAllowSubtasks,
            alwaysAllowUpdateTodoList: !!state.alwaysAllowUpdateTodoList,
            alwaysAllowWrite: !!state.alwaysAllowWrite,
            alwaysAllowWriteOutsideWorkspace:
              !!state.alwaysAllowWriteOutsideWorkspace,
            alwaysAllowWriteProtected: !!state.alwaysAllowWriteProtected,
            alwaysAllowDelete: !!state.alwaysAllowDelete, // kilocode_change
            alwaysApproveResubmit: !!state.alwaysApproveResubmit,
            yoloMode: !!state.yoloMode,
          },
        };
      } catch (error) {
        return {
          autoApproveException: stringifyError(error),
        };
      }
    };
    // kilocode_change end

    return {
      ...this.getAppProperties(),
      // ...this.getCloudProperties(), kilocode_change: disable
      // kilocode_change start
      ...(await getModelId()),
      ...getMemory(),
      ...getFastApply(),
      ...getOpenRouter(),
      ...getAutoApproveSettings(),
      // Add organization ID if available
      ...(apiConfiguration.kilocodeOrganizationId && {
        kilocodeOrganizationId: apiConfiguration.kilocodeOrganizationId,
      }),
      // kilocode_change end
      ...(await this.getTaskProperties()),
      ...(await this.getGitProperties()),
    };
  }

  // kilocode_change:
  // MCP Marketplace
  private async fetchMcpMarketplaceFromApi(
    silent: boolean = false,
  ): Promise<McpMarketplaceCatalog | undefined> {
    try {
      const response = await axios.get(
        "https://api.cline.bot/v1/mcp/marketplace",
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.data) {
        throw new Error("Invalid response from MCP marketplace API");
      }

      const catalog: McpMarketplaceCatalog = {
        items: (response.data || []).map((item: any) => ({
          ...item,
          githubStars: item.githubStars ?? 0,
          downloadCount: item.downloadCount ?? 0,
          tags: item.tags ?? [],
        })),
      };

      await this.updateGlobalState("mcpMarketplaceCatalog", catalog);
      return catalog;
    } catch (error) {
      console.error("Failed to fetch MCP marketplace:", error);
      if (!silent) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to fetch MCP marketplace";
        await this.postMessageToWebview({
          type: "mcpMarketplaceCatalog",
          error: errorMessage,
        });
        vscode.window.showErrorMessage(errorMessage);
      }
      return undefined;
    }
  }

  async silentlyRefreshMcpMarketplace() {
    try {
      const catalog = await this.fetchMcpMarketplaceFromApi(true);
      if (catalog) {
        await this.postMessageToWebview({
          type: "mcpMarketplaceCatalog",
          mcpMarketplaceCatalog: catalog,
        });
      }
    } catch (error) {
      console.error("Failed to silently refresh MCP marketplace:", error);
    }
  }

  async fetchMcpMarketplace(forceRefresh: boolean = false) {
    try {
      // Check if we have cached data
      const cachedCatalog = (await this.getGlobalState(
        "mcpMarketplaceCatalog",
      )) as McpMarketplaceCatalog | undefined;
      if (!forceRefresh && cachedCatalog?.items) {
        await this.postMessageToWebview({
          type: "mcpMarketplaceCatalog",
          mcpMarketplaceCatalog: cachedCatalog,
        });
        return;
      }

      const catalog = await this.fetchMcpMarketplaceFromApi(false);
      if (catalog) {
        await this.postMessageToWebview({
          type: "mcpMarketplaceCatalog",
          mcpMarketplaceCatalog: catalog,
        });
      }
    } catch (error) {
      console.error("Failed to handle cached MCP marketplace:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to handle cached MCP marketplace";
      await this.postMessageToWebview({
        type: "mcpMarketplaceCatalog",
        error: errorMessage,
      });
      vscode.window.showErrorMessage(errorMessage);
    }
  }

  async downloadMcp(mcpId: string) {
    try {
      // First check if we already have this MCP server installed
      const servers = this.mcpHub?.getServers() || [];
      const isInstalled = servers.some(
        (server: McpServer) => server.name === mcpId,
      );

      if (isInstalled) {
        throw new Error("This MCP server is already installed");
      }

      // Fetch server details from marketplace
      const response = await axios.post<McpDownloadResponse>(
        "https://api.cline.bot/v1/mcp/download",
        { mcpId },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      if (!response.data) {
        throw new Error("Invalid response from MCP marketplace API");
      }

      console.log("[downloadMcp] Response from download API", { response });

      const mcpDetails = response.data;

      // Validate required fields
      if (!mcpDetails.githubUrl) {
        throw new Error("Missing GitHub URL in MCP download response");
      }
      if (!mcpDetails.readmeContent) {
        throw new Error("Missing README content in MCP download response");
      }

      // Send details to webview
      await this.postMessageToWebview({
        type: "mcpDownloadDetails",
        mcpDownloadDetails: mcpDetails,
      });

      // Create task with context from README and added guidelines for MCP server installation
      const task = `Set up the MCP server from ${mcpDetails.githubUrl} while adhering to these MCP server installation rules:
- Use "${mcpDetails.mcpId}" as the server name in ${GlobalFileNames.mcpSettings}.
- Create the directory for the new MCP server before starting installation.
- Use commands aligned with the user's shell and operating system best practices.
- The following README may contain instructions that conflict with the user's OS, in which case proceed thoughtfully.
- Once installed, demonstrate the server's capabilities by using one of its tools.
Here is the project's README to help you get started:\n\n${mcpDetails.readmeContent}\n${mcpDetails.llmsInstallationContent}`;

      // Initialize task and show chat view
      await this.createTask(task);
      await this.postMessageToWebview({
        type: "action",
        action: "chatButtonClicked",
      });
    } catch (error) {
      console.error("Failed to download MCP:", error);
      let errorMessage = "Failed to download MCP";

      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          errorMessage = "Request timed out. Please try again.";
        } else if (error.response?.status === 404) {
          errorMessage = "MCP server not found in marketplace.";
        } else if (error.response?.status === 500) {
          errorMessage = "Internal server error. Please try again later.";
        } else if (!error.response && error.request) {
          errorMessage =
            "Network error. Please check your internet connection.";
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Show error in both notification and marketplace UI
      vscode.window.showErrorMessage(errorMessage);
      await this.postMessageToWebview({
        type: "mcpDownloadDetails",
        error: errorMessage,
      });
    }
  }
  // end kilocode_change

  // kilocode_change start
  // Add new methods for favorite functionality
  async toggleTaskFavorite(id: string) {
    const history = this.getTaskHistory();
    const item = history.find((h) => h.id === id);
    if (item) {
      await this.updateTaskHistory({ ...item, isFavorited: !item.isFavorited });
    }
    await this.postStateToWebview();
  }

  async getFavoriteTasks(): Promise<HistoryItem[]> {
    return this.getTaskHistory().filter((item) => item.isFavorited);
  }

  // Modify batch delete to respect favorites
  async deleteMultipleTasks(taskIds: string[]) {
    const history = this.getTaskHistory();
    const favoritedTaskIds = taskIds.filter(
      (id) => history.find((item) => item.id === id)?.isFavorited,
    );

    if (favoritedTaskIds.length > 0) {
      throw new Error(
        "Cannot delete favorited tasks. Please unfavorite them first.",
      );
    }

    for (const id of taskIds) {
      await this.deleteTaskWithId(id);
    }
  }

  async setTaskFileNotFound(id: string) {
    const history = this.getTaskHistory();
    const item = history.find((h) => h.id === id);
    if (item) {
      await this.updateTaskHistory({ ...item, fileNotfound: true });
    }
    await this.postStateToWebview();
  }

  private kiloCodeTaskHistoryVersion = 0;
  private kiloCodeTaskHistorySizeForTelemetryOnly = 0;
  private cachedTaskHistoryLength = 0;
  private cachedTaskHistoryVersion = -1;

  // kilocode_change start: Initialize task history storage eagerly
  private async initializeTaskHistoryStorage() {
    try {
      this.taskHistoryStorage = await TaskHistoryStorage.getInstance(
        this.context,
      );
      this.log("Task history storage initialized successfully");
    } catch (error) {
      this.log(`Failed to initialize TaskHistoryStorage: ${error}`);
    }
  }

  public getTaskHistory(): HistoryItem[] {
    // kilocode_change: Use disk-based storage if available, fallback to globalState during migration
    if (this.taskHistoryStorage) {
      return this.taskHistoryStorage.getAll();
    }
    return this.getGlobalState("taskHistory") || [];
  }
  // kilocode_change end

  public get cwd() {
    return this.currentWorkspacePath || getWorkspacePath();
  }

  /**
   * Delegate parent task and open child task.
   *
   * - Enforce single-open invariant
   * - Persist parent delegation metadata
   * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
   * - Create child as sole active and switch mode to child's mode
   */
  public async delegateParentAndOpenChild(params: {
    parentTaskId: string;
    message: string;
    initialTodos: TodoItem[];
    mode: string;
    yoloMode?: boolean;
    enableSubAgents?: boolean;
  }): Promise<Task> {
    const { parentTaskId, message, initialTodos, mode } = params;

    // Metadata-driven delegation is always enabled

    // 1) Get parent (must be current task)
    const parent = this.getCurrentTask();
    if (!parent) {
      throw new Error("[delegateParentAndOpenChild] No current task");
    }
    if (parent.taskId !== parentTaskId) {
      throw new Error(
        `[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
      );
    }
    // 2) Flush pending tool results to API history BEFORE disposing the parent.
    //    This is critical for native tool protocol: when tools are called before new_task,
    //    their tool_result blocks are in userMessageContent but not yet saved to API history.
    //    If we don't flush them, the parent's API conversation will be incomplete and
    //    cause 400 errors when resumed (missing tool_result for tool_use blocks).
    //
    //    NOTE: We do NOT pass the assistant message here because the assistant message
    //    is already added to apiConversationHistory by the normal flow in
    //    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
    //    flush the pending user message with tool_results.
    try {
      await parent.flushPendingToolResultsToHistory();
    } catch (error) {
      this.log(
        `[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 3) Enforce single-open invariant by closing/disposing the parent first
    //    This ensures we never have >1 tasks open at any time during delegation.
    //    Await abort completion to ensure clean disposal and prevent unhandled rejections.
    try {
      await this.removeClineFromStack();
    } catch (error) {
      this.log(
        `[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Non-fatal: proceed with child creation even if parent cleanup had issues
    }

    // 3) Switch provider mode to child's requested mode BEFORE creating the child task
    //    This ensures the child's system prompt and configuration are based on the correct mode.
    //    The mode switch must happen before createTask() because the Task constructor
    //    initializes its mode from provider.getState() during initializeTaskMode().
    try {
      await this.handleModeSwitch(mode as any);
    } catch (e) {
      this.log(
        `[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
          (e as Error)?.message ?? String(e)
        }`,
      );
    }

    // 4) Create child as sole active (parent reference preserved for lineage)
    // Pass initialStatus: "active" to ensure the child task's historyItem is created
    // with status from the start, avoiding race conditions where the task might
    // call attempt_completion before status is persisted separately.
    const child = await this.createTask(message, undefined, parent as any, {
      initialTodos,
      initialStatus: "active",
      yoloMode: params.yoloMode,
      enableSubAgents: params.enableSubAgents,
    });

    // 5) Persist parent delegation metadata
    try {
      const { historyItem } = await this.getTaskWithId(parentTaskId);
      const childIds = Array.from(
        new Set([...(historyItem.childIds ?? []), child.taskId]),
      );
      const updatedHistory: typeof historyItem = {
        ...historyItem,
        status: "delegated",
        delegatedToId: child.taskId,
        awaitingChildId: child.taskId,
        childIds,
      };
      await this.updateTaskHistory(updatedHistory);
    } catch (err) {
      this.log(
        `[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
    }

    // 6) Emit TaskDelegated (provider-level)
    try {
      this.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId);
    } catch {
      // non-fatal
    }

    return child;
  }

  /**
   * Reopen parent task from delegation with write-back and events.
   */
  public async reopenParentFromDelegation(params: {
    parentTaskId: string;
    childTaskId: string;
    completionResultSummary: string;
  }): Promise<void> {
    const { parentTaskId, childTaskId, completionResultSummary } = params;
    const globalStoragePath = this.contextProxy.globalStorageUri.fsPath;

    // 1) Load parent from history and current persisted messages
    const { historyItem } = await this.getTaskWithId(parentTaskId);

    let parentClineMessages: ClineMessage[] = [];
    try {
      parentClineMessages = await readTaskMessages({
        taskId: parentTaskId,
        globalStoragePath,
      });
    } catch {
      parentClineMessages = [];
    }

    let parentApiMessages: any[] = [];
    try {
      parentApiMessages = (await readApiMessages({
        taskId: parentTaskId,
        globalStoragePath,
      })) as any[];
    } catch {
      parentApiMessages = [];
    }

    // 2) Inject synthetic records: UI subtask_result and update API tool_result
    const ts = Date.now();

    // Defensive: ensure arrays
    if (!Array.isArray(parentClineMessages)) parentClineMessages = [];
    if (!Array.isArray(parentApiMessages)) parentApiMessages = [];

    const subtaskUiMessage: ClineMessage = {
      type: "say",
      say: "subtask_result",
      text: completionResultSummary,
      ts,
    };
    parentClineMessages.push(subtaskUiMessage);
    await saveTaskMessages({
      messages: parentClineMessages,
      taskId: parentTaskId,
      globalStoragePath,
    });

    // Find the tool_use_id from the last assistant message's new_task tool_use
    let toolUseId: string | undefined;
    for (let i = parentApiMessages.length - 1; i >= 0; i--) {
      const msg = parentApiMessages[i];
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.name === "new_task") {
            toolUseId = block.id;
            break;
          }
        }
        if (toolUseId) break;
      }
    }

    // The API expects: user → assistant (with tool_use) → user (with tool_result)
    // We need to add a NEW user message with the tool_result AFTER the assistant's tool_use
    // NOT add it to an existing user message
    if (toolUseId) {
      // Check if the last message is already a user message with a tool_result for this tool_use_id
      // (in case this is a retry or the history was already updated)
      const lastMsg = parentApiMessages[parentApiMessages.length - 1];
      let alreadyHasToolResult = false;
      if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
        for (const block of lastMsg.content) {
          if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
            // Update the existing tool_result content
            block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`;
            alreadyHasToolResult = true;
            break;
          }
        }
      }

      // If no existing tool_result found, create a NEW user message with the tool_result
      if (!alreadyHasToolResult) {
        parentApiMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolUseId,
              content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
            },
          ],
          ts,
        });
      }
    } else {
      // Fallback for XML protocol or when toolUseId couldn't be found:
      // Add a text block (not ideal but maintains backward compatibility)
      parentApiMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
          },
        ],
        ts,
      });
    }

    await saveApiMessages({
      messages: parentApiMessages as any,
      taskId: parentTaskId,
      globalStoragePath,
    });

    // 3) Update child metadata to "completed" status
    try {
      const { historyItem: childHistory } =
        await this.getTaskWithId(childTaskId);
      await this.updateTaskHistory({
        ...childHistory,
        status: "completed",
      });
    } catch (err) {
      this.log(
        `[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
    }

    // 4) Update parent metadata and persist BEFORE emitting completion event
    const childIds = Array.from(
      new Set([...(historyItem.childIds ?? []), childTaskId]),
    );
    const updatedHistory: typeof historyItem = {
      ...historyItem,
      status: "active",
      completedByChildId: childTaskId,
      completionResultSummary,
      awaitingChildId: undefined,
      childIds,
    };
    await this.updateTaskHistory(updatedHistory);

    // 5) Emit TaskDelegationCompleted (provider-level)
    try {
      this.emit(
        RooCodeEventName.TaskDelegationCompleted,
        parentTaskId,
        childTaskId,
        completionResultSummary,
      );
    } catch {
      // non-fatal
    }

    // 6) Close child instance if still open (single-open-task invariant)
    const current = this.getCurrentTask();
    if (current?.taskId === childTaskId) {
      await this.removeClineFromStack();
    }

    // 7) Reopen the parent from history as the sole active task (restores saved mode)
    //    IMPORTANT: startTask=false to suppress resume-from-history ask scheduling
    const parentInstance = await this.createTaskWithHistoryItem(
      updatedHistory,
      { startTask: false },
    );

    // 8) Inject restored histories into the in-memory instance before resuming
    if (parentInstance) {
      try {
        await parentInstance.overwriteClineMessages(parentClineMessages);
      } catch {
        // non-fatal
      }
      try {
        await parentInstance.overwriteApiConversationHistory(
          parentApiMessages as any,
        );
      } catch {
        // non-fatal
      }

      // Auto-resume parent without ask("resume_task")
      await parentInstance.resumeAfterDelegation();
    }

    // 9) Emit TaskDelegationResumed (provider-level)
    try {
      this.emit(
        RooCodeEventName.TaskDelegationResumed,
        parentTaskId,
        childTaskId,
      );
    } catch {
      // non-fatal
    }
  }

  /**
   * Convert a file path to a webview-accessible URI
   * This method safely converts file paths to URIs that can be loaded in the webview
   *
   * @param filePath - The absolute file path to convert
   * @returns The webview URI string, or the original file URI if conversion fails
   * @throws {Error} When webview is not available
   * @throws {TypeError} When file path is invalid
   */
  public convertToWebviewUri(filePath: string): string {
    try {
      const fileUri = vscode.Uri.file(filePath);

      // Check if we have a webview available
      if (this.view?.webview) {
        const webviewUri = this.view.webview.asWebviewUri(fileUri);
        return webviewUri.toString();
      }

      // Specific error for no webview available
      const error = new Error("No webview available for URI conversion");
      console.error(error.message);
      // Fallback to file URI if no webview available
      return fileUri.toString();
    } catch (error) {
      // More specific error handling
      if (error instanceof TypeError) {
        console.error("Invalid file path provided for URI conversion:", error);
      } else {
        console.error("Failed to convert to webview URI:", error);
      }
      // Return file URI as fallback
      return vscode.Uri.file(filePath).toString();
    }
  }
}
