import { safeWriteJson } from "../../utils/safeWriteJson";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import pWaitFor from "p-wait-for";
import * as vscode from "vscode";
// kade_change start
import axios from "axios";
import {
  fastApplyApiProviderSchema,
  getKiloUrlFromToken,
  isGlobalStateKey,
} from "@roo-code/types";
import { getAppUrl } from "@roo-code/types";
import {
  MaybeTypedWebviewMessage,
  ProfileData,
  SeeNewChangesPayload,
  TaskHistoryRequestPayload,
  TasksByIdRequestPayload,
  UpdateGlobalStateMessage,
} from "../../shared/WebviewMessage";
// kade_change end

import {
  type Language,
  type GlobalState,
  type ClineMessage,
  type TelemetrySetting,
  type UserSettingsConfig,
  TelemetryEventName,
  // kade_change start
  ghostServiceSettingsSchema,
  fastApplyModelSchema,
  // kade_change end
  DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
  RooCodeSettings,
  Experiments,
  ExperimentId,
} from "@roo-code/types";
import { CloudService } from "@roo-code/cloud";
import { TelemetryService } from "@roo-code/telemetry";

import { type ApiMessage } from "../task-persistence/apiMessages";
import { readTaskMessages, saveTaskMessages } from "../task-persistence";

import type { ClineProvider } from "./ClineProvider";
import { BrowserSessionPanelManager } from "./BrowserSessionPanelManager";
import { handleCheckpointRestoreOperation } from "./checkpointRestoreHandler";
import { changeLanguage, t } from "../../i18n";
import { Package } from "../../shared/package";
import {
  type RouterName,
  type ModelRecord,
  type RouterModels,
  toRouterName,
} from "../../shared/api";
import { MessageEnhancer } from "./messageEnhancer";

import {
  type WebviewMessage,
  type EditQueuedMessagePayload,
  type RemoveQueuedMessagePayload,
  type SendQueuedMessageNowPayload,
  checkoutDiffPayloadSchema,
  checkoutRestorePayloadSchema,
  requestCheckpointRestoreApprovalPayloadSchema,
} from "../../shared/WebviewMessage";
import { checkExistKey } from "../../shared/checkExistApiConfig";
import { experimentDefault } from "../../shared/experiments";
import { Terminal } from "../../integrations/terminal/Terminal";
import { openFile } from "../../integrations/misc/open-file";
import { openDiff } from "../../integrations/misc/open-diff";
import { openImage, saveImage } from "../../integrations/misc/image-handler";
import { selectImages } from "../../integrations/misc/process-images";
import { getTheme } from "../../integrations/theme/getTheme";
import {
  discoverChromeHostUrl,
  tryChromeHostUrl,
} from "../../services/browser/browserDiscovery";
import { searchWorkspaceFiles } from "../../services/search/file-search";
import { fileExistsAtPath } from "../../utils/fs";
import { playTts, setTtsEnabled, setTtsSpeed, stopTts } from "../../utils/tts";
import { showSystemNotification } from "../../integrations/notifications"; // kade_change
import { singleCompletionHandler } from "../../utils/single-completion-handler"; // kade_change
import { searchCommits } from "../../utils/git";
import {
  exportSettings,
  importSettingsWithFeedback,
} from "../config/importExport";
import { getOpenAiModels } from "../../api/providers/openai";
import { getVsCodeLmModels } from "../../api/providers/vscode-lm";
import { openMention } from "../mentions";
import { getWorkspacePath } from "../../utils/path";
import { arePathsEqual } from "../../utils/path";
import { Mode, defaultModeSlug } from "../../shared/modes";
import {
  getModels,
  flushModels,
} from "../../api/providers/fetchers/modelCache";
import { getZedModels } from "../../api/providers/fetchers/zed";
import { GetModelsOptions, ApiHandlerOptions } from "../../shared/api";
import { generateSystemPrompt } from "./generateSystemPrompt";
import { getCommand } from "../../utils/commands";
import {
  toggleWorkflow,
  toggleRule,
  createRuleFile,
  deleteRuleFile,
} from "./kilorules";
import { mermaidFixPrompt } from "../prompts/utilities/mermaid"; // kade_change
// kade_change start
import {
  editMessageHandler,
  fetchKilocodeNotificationsHandler,
  deviceAuthMessageHandler,
} from "../kilocode/webview/webviewMessageHandlerUtils";
import { GhostServiceManager } from "../../services/ghost/GhostServiceManager";
import { handleChatCompletionRequest } from "../../services/ghost/chat-autocomplete/handleChatCompletionRequest";
import { handleChatCompletionAccepted } from "../../services/ghost/chat-autocomplete/handleChatCompletionAccepted";
// kade_change end

const ALLOWED_VSCODE_SETTINGS = new Set(["terminal.integrated.inheritEnv"]);

import {
  MarketplaceManager,
  MarketplaceItemType,
} from "../../services/marketplace";
import { UsageTracker } from "../../utils/usage-tracker"; // kade_change
import { seeNewChanges } from "../checkpoints/kilocode/seeNewChanges"; // kade_change
import { getTaskHistory } from "../../shared/kilocode/getTaskHistory"; // kade_change
import { deriveEditHistoryDiffTotals } from "../../shared/kilocode/editHistoryDiffTotals";
import {
  fetchAndRefreshOrganizationModesOnStartup,
  refreshOrganizationModes,
} from "./kiloWebviewMessgeHandlerHelpers"; // kade_change
import { getSapAiCoreDeployments } from "../../api/providers/fetchers/sap-ai-core"; // kade_change
import { fetchOpenAiCodexRateLimitInfo } from "../../integrations/openai-codex/rate-limits";
import { openAiCodexOAuthManager } from "../../integrations/openai-codex/oauth";
import { antigravityOAuthManager } from "../../integrations/antigravity/oauth";
import { geminiOAuthManager } from "../../integrations/gemini/oauth";
import { claudeCodeOAuthManager } from "../../integrations/claude-code/oauth";
import { zedOAuthManager } from "../../integrations/zed/oauth";
import { fetchClaudeCodeRateLimitInfo } from "../../integrations/claude-code/rate-limits";
import { AutoPurgeScheduler } from "../../services/auto-purge"; // kade_change

import { setPendingTodoList } from "../tools/UpdateTodoListTool";
import { ManagedIndexer } from "../../services/code-index/managed/ManagedIndexer";
import { SessionManager } from "../../shared/kilocode/cli-sessions/core/SessionManager"; // kade_change
import { resolveQueuedMessageRemovalId } from "./queuedMessageRemoval";

export const webviewMessageHandler = async (
  provider: ClineProvider,
  message: MaybeTypedWebviewMessage, // kade_change switch to MaybeTypedWebviewMessage for better type-safety
  marketplaceManager?: MarketplaceManager,
) => {
  // Utility functions provided for concise get/update of global state via contextProxy API.
  const getGlobalState = <K extends keyof GlobalState>(key: K) =>
    provider.contextProxy.getValue(key);
  const updateGlobalState = async <K extends keyof GlobalState>(
    key: K,
    value: GlobalState[K],
  ) => {
    await provider.contextProxy.setValue(key, value);
  };

  const getCurrentCwd = () => {
    return provider.getCurrentTask()?.cwd || provider.cwd;
  };
  const getTargetViewColumn = () => provider.getViewColumn();
  const openFileInProviderColumn = (
    filePath: string,
    options?: {
      create?: boolean;
      content?: string;
      line?: number;
      endLine?: number;
    },
  ) =>
    openFile(filePath, {
      ...options,
      viewColumn: getTargetViewColumn(),
    });
  /**
   * Shared utility to find message indices based on timestamp.
   * When multiple messages share the same timestamp (e.g., after condense),
   * this function prefers non-summary messages to ensure user operations
   * target the intended message rather than the summary.
   */
  const findMessageIndices = (messageTs: number, currentCline: any) => {
    // Find the exact message by timestamp, not the first one after a cutoff
    const messageIndex = currentCline.clineMessages.findIndex(
      (msg: ClineMessage) => msg.ts === messageTs,
    );

    // Find all matching API messages by timestamp
    const allApiMatches = currentCline.apiConversationHistory
      .map((msg: ApiMessage, idx: number) => ({ msg, idx }))
      .filter(({ msg }: { msg: ApiMessage }) => msg.ts === messageTs);

    // Prefer non-summary message if multiple matches exist (handles timestamp collision after condense)
    const preferred =
      allApiMatches.find(({ msg }: { msg: ApiMessage }) => !msg.isSummary) ||
      allApiMatches[0];
    const apiConversationHistoryIndex = preferred?.idx ?? -1;

    return { messageIndex, apiConversationHistoryIndex };
  };

  /**
   * Fallback: find first API history index at or after a timestamp.
   * Used when the exact user message isn't present in apiConversationHistory (e.g., after condense).
   */
  const findFirstApiIndexAtOrAfter = (ts: number, currentCline: any) => {
    if (typeof ts !== "number") return -1;
    return currentCline.apiConversationHistory.findIndex(
      (msg: ApiMessage) =>
        typeof msg?.ts === "number" && (msg.ts as number) >= ts,
    );
  };

  /**
   * Handles message deletion operations with user confirmation
   */
  const handleDeleteOperation = async (messageTs: number): Promise<void> => {
    // Check if there's a checkpoint before this message
    const currentCline = provider.getCurrentTask();
    let hasCheckpoint = false;

    if (!currentCline) {
      await vscode.window.showErrorMessage(
        t("common:errors.message.no_active_task_to_delete"),
      );
      return;
    }

    const { messageIndex } = findMessageIndices(messageTs, currentCline);

    if (messageIndex !== -1) {
      // Find the last checkpoint before this message
      const checkpoints = currentCline.clineMessages.filter(
        (msg) => msg.say === "checkpoint_saved" && msg.ts > messageTs,
      );
      hasCheckpoint = checkpoints.length > 0;
    }

    // Send message to webview to show delete confirmation dialog
    await provider.postMessageToWebview({
      type: "showDeleteMessageDialog",
      messageTs,
      hasCheckpoint,
    });
  };

  /**
   * Handles confirmed message deletion from webview dialog
   */
  const handleDeleteMessageConfirm = async (
    messageTs: number,
    restoreCheckpoint?: boolean,
  ): Promise<void> => {
    const currentCline = provider.getCurrentTask();
    if (!currentCline) {
      console.error("[handleDeleteMessageConfirm] No current cline available");
      return;
    }

    const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(
      messageTs,
      currentCline,
    );
    // Determine API truncation index with timestamp fallback if exact match not found
    let apiIndexToUse = apiConversationHistoryIndex;
    const tsThreshold = currentCline.clineMessages[messageIndex]?.ts;
    if (apiIndexToUse === -1 && typeof tsThreshold === "number") {
      apiIndexToUse = findFirstApiIndexAtOrAfter(tsThreshold, currentCline);
    }

    if (messageIndex === -1) {
      await vscode.window.showErrorMessage(
        t("common:errors.message.message_not_found", { messageTs }),
      );
      return;
    }

    try {
      const targetMessage = currentCline.clineMessages[messageIndex];

      // If checkpoint restoration is requested, find and restore to the last checkpoint before this message
      if (restoreCheckpoint) {
        // Find the last checkpoint before this message
        const checkpoints = currentCline.clineMessages.filter(
          (msg) => msg.say === "checkpoint_saved" && msg.ts > messageTs,
        );

        const nextCheckpoint = checkpoints[0];

        if (nextCheckpoint && nextCheckpoint.text) {
          await handleCheckpointRestoreOperation({
            provider,
            currentCline,
            messageTs: targetMessage.ts!,
            messageIndex,
            checkpoint: { hash: nextCheckpoint.text },
            operation: "delete",
          });
        } else {
          // No checkpoint found before this message
          console.log(
            "[handleDeleteMessageConfirm] No checkpoint found before message",
          );
          vscode.window.showWarningMessage(
            "No checkpoint found before this message",
          );
        }
      } else {
        // For non-checkpoint deletes, preserve checkpoint associations for remaining messages
        // Store checkpoints from messages that will be preserved
        const preservedCheckpoints = new Map<number, any>();
        for (let i = 0; i < messageIndex; i++) {
          const msg = currentCline.clineMessages[i];
          if (msg?.checkpoint && msg.ts) {
            preservedCheckpoints.set(msg.ts, msg.checkpoint);
          }
        }

        // Delete this message and all subsequent messages using MessageManager
        await currentCline.messageManager.rewindToTimestamp(targetMessage.ts!, {
          includeTargetMessage: false,
        });

        // Restore checkpoint associations for preserved messages
        for (const [ts, checkpoint] of preservedCheckpoints) {
          const msgIndex = currentCline.clineMessages.findIndex(
            (msg) => msg.ts === ts,
          );
          if (msgIndex !== -1) {
            currentCline.clineMessages[msgIndex].checkpoint = checkpoint;
          }
        }

        // Save the updated messages with restored checkpoints
        await saveTaskMessages({
          messages: currentCline.clineMessages,
          taskId: currentCline.taskId,
          globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
        });

        // Update the UI to reflect the deletion
        await provider.debouncedPostStateToWebview();
      }
    } catch (error) {
      console.error("Error in delete message:", error);
      vscode.window.showErrorMessage(
        t("common:errors.message.error_deleting_message", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  /**
   * Handles message editing operations with user confirmation
   */
  const handleEditOperation = async (
    messageTs: number,
    editedContent: string,
    images?: string[],
  ): Promise<void> => {
    // Check if there's a checkpoint before this message
    const currentCline = provider.getCurrentTask();
    let hasCheckpoint = false;
    if (currentCline) {
      const { messageIndex } = findMessageIndices(messageTs, currentCline);
      if (messageIndex !== -1) {
        // Find the last checkpoint before this message
        const checkpoints = currentCline.clineMessages.filter(
          (msg) => msg.say === "checkpoint_saved" && msg.ts > messageTs,
        );

        hasCheckpoint = checkpoints.length > 0;
      } else {
        console.log(
          "[webviewMessageHandler] Edit - Message not found in clineMessages!",
        );
      }
    } else {
      console.log("[webviewMessageHandler] Edit - No currentCline available!");
    }

    // Send message to webview to show edit confirmation dialog
    await provider.postMessageToWebview({
      type: "showEditMessageDialog",
      messageTs,
      text: editedContent,
      hasCheckpoint,
      images,
    });
  };

  /**
   * Handles confirmed message editing from webview dialog
   */
  const handleEditMessageConfirm = async (
    messageTs: number,
    editedContent: string,
    restoreCheckpoint?: boolean,
    images?: string[],
  ): Promise<void> => {
    const currentCline = provider.getCurrentTask();
    if (!currentCline) {
      console.error("[handleEditMessageConfirm] No current cline available");
      return;
    }

    // Use findMessageIndices to find messages based on timestamp
    const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(
      messageTs,
      currentCline,
    );

    if (messageIndex === -1) {
      const errorMessage = t("common:errors.message.message_not_found", {
        messageTs,
      });
      console.error("[handleEditMessageConfirm]", errorMessage);
      await vscode.window.showErrorMessage(errorMessage);
      return;
    }

    try {
      const targetMessage = currentCline.clineMessages[messageIndex];

      // If checkpoint restoration is requested, find and restore to the last checkpoint before this message
      if (restoreCheckpoint) {
        // Find the last checkpoint before this message
        const checkpoints = currentCline.clineMessages.filter(
          (msg) => msg.say === "checkpoint_saved" && msg.ts > messageTs,
        );

        const nextCheckpoint = checkpoints[0];

        if (nextCheckpoint && nextCheckpoint.text) {
          await handleCheckpointRestoreOperation({
            provider,
            currentCline,
            messageTs: targetMessage.ts!,
            messageIndex,
            checkpoint: { hash: nextCheckpoint.text },
            operation: "edit",
            editData: {
              editedContent,
              images,
              apiConversationHistoryIndex,
            },
          });
          // The task will be cancelled and reinitialized by checkpointRestore
          // The pending edit will be processed in the reinitialized task
          return;
        } else {
          // No checkpoint found before this message
          console.log(
            "[handleEditMessageConfirm] No checkpoint found before message",
          );
          vscode.window.showWarningMessage(
            "No checkpoint found before this message",
          );
          // Continue with non-checkpoint edit
        }
      }

      // For non-checkpoint edits, remove the ORIGINAL user message being edited and all subsequent messages
      // Determine the correct starting index to delete from (prefer the last preceding user_feedback message)
      let deleteFromMessageIndex = messageIndex;
      let deleteFromApiIndex = apiConversationHistoryIndex;

      // Find the nearest preceding user message to ensure we replace the original, not just the assistant reply
      for (let i = messageIndex; i >= 0; i--) {
        const m = currentCline.clineMessages[i];
        if (m?.say === "user_feedback") {
          deleteFromMessageIndex = i;
          // Align API history truncation to the same user message timestamp if present
          const userTs = m.ts;
          if (typeof userTs === "number") {
            const apiIdx = currentCline.apiConversationHistory.findIndex(
              (am: ApiMessage) => am.ts === userTs,
            );
            if (apiIdx !== -1) {
              deleteFromApiIndex = apiIdx;
            }
          }
          break;
        }
      }

      // Timestamp fallback for API history when exact user message isn't present
      if (deleteFromApiIndex === -1) {
        const tsThresholdForEdit =
          currentCline.clineMessages[deleteFromMessageIndex]?.ts;
        if (typeof tsThresholdForEdit === "number") {
          deleteFromApiIndex = findFirstApiIndexAtOrAfter(
            tsThresholdForEdit,
            currentCline,
          );
        }
      }

      // Store checkpoints from messages that will be preserved
      const preservedCheckpoints = new Map<number, any>();
      for (let i = 0; i < deleteFromMessageIndex; i++) {
        const msg = currentCline.clineMessages[i];
        if (msg?.checkpoint && msg.ts) {
          preservedCheckpoints.set(msg.ts, msg.checkpoint);
        }
      }

      // Delete the original (user) message and all subsequent messages using MessageManager
      const rewindTs = currentCline.clineMessages[deleteFromMessageIndex]?.ts;
      if (rewindTs) {
        await currentCline.messageManager.rewindToTimestamp(rewindTs, {
          includeTargetMessage: false,
        });
      }

      // Restore checkpoint associations for preserved messages
      for (const [ts, checkpoint] of preservedCheckpoints) {
        const msgIndex = currentCline.clineMessages.findIndex(
          (msg) => msg.ts === ts,
        );
        if (msgIndex !== -1) {
          currentCline.clineMessages[msgIndex].checkpoint = checkpoint;
        }
      }

      // Save the updated messages with restored checkpoints
      await saveTaskMessages({
        messages: currentCline.clineMessages,
        taskId: currentCline.taskId,
        globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
      });

      // Update the UI to reflect the deletion
      await provider.debouncedPostStateToWebview();

      await currentCline.submitUserMessage(editedContent, images);
    } catch (error) {
      console.error("Error in edit message:", error);
      vscode.window.showErrorMessage(
        t("common:errors.message.error_editing_message", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  /**
   * Handles message modification operations (delete or edit) with confirmation dialog
   * @param messageTs Timestamp of the message to operate on
   * @param operation Type of operation ('delete' or 'edit')
   * @param editedContent New content for edit operations
   * @returns Promise<void>
   */
  const handleMessageModificationsOperation = async (
    messageTs: number,
    operation: "delete" | "edit",
    editedContent?: string,
    images?: string[],
  ): Promise<void> => {
    if (operation === "delete") {
      await handleDeleteOperation(messageTs);
    } else if (operation === "edit" && editedContent) {
      await handleEditOperation(messageTs, editedContent, images);
    }
  };

  if (
    message.type === "subAgentToolEnabled" &&
    typeof message.bool === "boolean"
  ) {
    await updateGlobalState("subAgentToolEnabled", message.bool);
    await provider.postStateToWebview();
  }

  if (
    message.type === "showSubAgentBanner" &&
    typeof message.bool === "boolean"
  ) {
    await updateGlobalState("showSubAgentBanner", message.bool);
    await provider.postStateToWebview();
  }

  switch (message.type) {
    case "webviewDebug":
      provider.log(`[WEBVIEW_DEBUG] ${message.text ?? "<empty>"}`);
      return;

    case "webviewDidLaunch":
      // Load custom modes first
      if (provider.customModesManager) {
        const customModes = await provider.customModesManager.getCustomModes();
        await updateGlobalState("customModes", customModes);
      }

      // kade_change start: Fetch organization modes on startup
      // Fetch organization modes on startup if an organization is selected
      await fetchAndRefreshOrganizationModesOnStartup(
        provider,
        updateGlobalState,
      );
      // kade_change end

      // Refresh workflow toggles
      const { refreshWorkflowToggles } = await import(
        "../context/instructions/workflows"
      ); // kade_change
      await refreshWorkflowToggles(provider.context, provider.cwd); // kade_change

      // kade_change start: Defer non-critical startup tasks to keep the UI responsive
      provider.debouncedPostStateToWebview();
      provider.postRulesDataToWebview();

      // Workspace tracking can be heavy, defer it slightly
      setTimeout(() => {
        provider.workspaceTracker?.initializeFilePaths();
      }, 1500);
      // kade_change end

      getTheme().then((theme) =>
        provider.postMessageToWebview({
          type: "theme",
          text: JSON.stringify(theme),
        }),
      );

      // If MCP Hub is already initialized, update the webview with
      // current server list.
      const mcpHub = provider.getMcpHub();

      if (mcpHub) {
        provider.postMessageToWebview({
          type: "mcpServers",
          mcpServers: mcpHub.getAllServers(),
        });
      }

      provider.providerSettingsManager
        .listConfig()
        .then(async (listApiConfig) => {
          if (!listApiConfig) {
            return;
          }

          if (listApiConfig.length === 1) {
            // Check if first time init then sync with exist config.
            if (!checkExistKey(listApiConfig[0])) {
              const { apiConfiguration } = await provider.getState();

              await provider.providerSettingsManager.saveConfig(
                listApiConfig[0].name ?? "default",
                apiConfiguration,
              );

              listApiConfig[0].apiProvider = apiConfiguration.apiProvider;
            }
          }

          const currentConfigName = getGlobalState("currentApiConfigName");

          if (currentConfigName) {
            if (
              !(await provider.providerSettingsManager.hasConfig(
                currentConfigName,
              ))
            ) {
              // Current config name not valid, get first config in list.
              const name = listApiConfig[0]?.name;
              await updateGlobalState("currentApiConfigName", name);

              if (name) {
                await provider.activateProviderProfile({ name });
                return;
              }
            }
          }

          await Promise.all([
            await updateGlobalState("listApiConfigMeta", listApiConfig),
            await provider.postMessageToWebview({
              type: "listApiConfig",
              listApiConfig,
            }),
          ]);
        })
        .catch((error) =>
          provider.log(
            `Error list api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          ),
        );

      // If user already opted in to telemetry, enable telemetry service
      provider.getStateToPostToWebview().then(async (/*kade_change*/ state) => {
        const { telemetrySetting } = state;
        const isOptedIn = telemetrySetting !== "disabled";
        TelemetryService.instance.updateTelemetryState(isOptedIn);
        await TelemetryService.instance.updateIdentity(
          state.apiConfiguration.kilocodeToken ?? "",
        ); // kade_change
      });

      // Initialize EditHistoryService
      try {
        const { EditHistoryService } = await import(
          "../../services/edit-history/EditHistoryService"
        );
        EditHistoryService.getInstance(provider.context);
      } catch (e) {
        console.error("Failed to initialize EditHistoryService:", e);
      }

      provider.isViewLaunched = true;
      break;
    case "newTask":
      // Initializing new instance of Cline will make sure that any
      // agentically running promises in old instance don't affect our new
      // task. This essentially creates a fresh slate for the new task.
      // PERF: reset chat UI immediately so first-send feels responsive.
      await provider.postMessageToWebview({
        type: "invoke",
        invoke: "newChat",
      });
      try {
        await provider.createTask(message.text, message.images, undefined, {
          enableSubAgents: message.enableSubAgents,
        });
        // Clear accepted tool IDs for the new task (non-blocking)
        void provider.context.workspaceState
          .update("claudix.acceptedToolIds", [])
          .then(undefined, (error: unknown) => {
            console.warn(
              "Failed to clear accepted tool IDs for new task:",
              error,
            );
          });
      } catch (error) {
        // Show error to user
        vscode.window.showErrorMessage(
          `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;

    // Handle generic requests (e.g., from useUndo)
    case "request":
      if (message.requestId && message.request) {
        const request = message.request as any;
        const reqType = request.type;
        const key = request.key;
        const value = request.value;
        let response: any;

        try {
          if (reqType === "getWorkspaceState") {
            response = provider.context.workspaceState.get(key);
            // If asking for undone IDs and not found, return empty array
            if (key === "claudix.undoneToolIds" && !response) {
              response = [];
            }
          } else if (reqType === "updateWorkspaceState") {
            await provider.context.workspaceState.update(key, value);
            await provider.debouncedPostStateToWebview();
            response = true;
          }
        } catch (e) {
          console.error(`Error handling request ${reqType}:`, e);
        }

        await provider.postMessageToWebview({
          type: "response",
          requestId: message.requestId,
          response,
        });
      }
      break;

    case "requestEmptyStateBackgrounds":
      try {
        const { folderPath, options } =
          await provider.listEmptyStateBackgroundOptions();
        await provider.postMessageToWebview({
          type: "emptyStateBackgrounds",
          requestId: message.requestId,
          values: {
            folderPath,
            options,
          },
        });
      } catch (error) {
        console.error("Failed to load empty state backgrounds:", error);
        await provider.postMessageToWebview({
          type: "emptyStateBackgrounds",
          requestId: message.requestId,
          values: {
            folderPath: provider.getEmptyStateBackgroundsDirectoryUri().fsPath,
            options: [],
          },
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;

    case "openEmptyStateBackgroundsFolder": {
      const folderUri = provider.getEmptyStateBackgroundsDirectoryUri();
      await fs.mkdir(folderUri.fsPath, { recursive: true });
      await vscode.commands.executeCommand("revealFileInOS", folderUri);
      break;
    }

    // Handle commands (e.g., undo edits)
    case "command":
      if (message.command === "claudix.undoEdits" && message.args) {
        try {
          console.log(
            "[webviewMessageHandler] Undo command received:",
            message.args,
          );
          const { EditHistoryService } = await import(
            "../../services/edit-history/EditHistoryService"
          );
          const toolUseIds = message.args[0]; // Expecting [[id1, id2...]] or [id]
          if (Array.isArray(toolUseIds)) {
            const revertedFiles =
              await EditHistoryService.getInstance().undo(toolUseIds);
            console.log(
              "[webviewMessageHandler] Undo successful, reverted:",
              revertedFiles,
            );
            // Kilo Code Change: Notification is now handled client-side in the webview for a better UX.
          }
        } catch (e) {
          console.error("[webviewMessageHandler] Undo failed:", e);
          vscode.window.showErrorMessage(
            `Undo failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } else if (message.command === "claudix.redoEdits" && message.args) {
        try {
          console.log(
            "[webviewMessageHandler] Redo command received:",
            message.args,
          );
          const { EditHistoryService } = await import(
            "../../services/edit-history/EditHistoryService"
          );
          const toolUseIds = message.args[0]; // Expecting [[id1, id2...]] or [id]
          if (Array.isArray(toolUseIds)) {
            const redoneFiles =
              await EditHistoryService.getInstance().redo(toolUseIds);
            console.log(
              "[webviewMessageHandler] Redo successful, redone:",
              redoneFiles,
            );
            // Kilo Code Change: Notification is now handled client-side in the webview for a better UX.
          }
        } catch (e) {
          console.error("[webviewMessageHandler] Redo failed:", e);
          vscode.window.showErrorMessage(
            `Redo failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } else if (message.command === "cliProxyLogin") {
        console.log("[webviewMessageHandler] Handling cliProxyLogin command");
        // Frontend sends: { type: "command", command: "cliProxyLogin", args: [provider] }
        const loginProvider =
          (message as any).args?.[0] || (message as any).provider;
        console.log(`[webviewMessageHandler] Provider: ${loginProvider}`);

        const args: string[] = [];
        if (loginProvider === "google") args.push("-login");
        else if (loginProvider === "antigravity")
          args.push("-antigravity-login");
        else if (loginProvider === "claude") args.push("-claude-login");
        else if (loginProvider === "codex") args.push("-codex-login");
        else if (loginProvider === "qwen") args.push("-qwen-login");
        else if (loginProvider === "iflow") args.push("-iflow-login");
        else {
          vscode.window.showErrorMessage(
            `Unknown login provider category: ${loginProvider}`,
          );
          console.error(
            `[webviewMessageHandler] Unknown provider: ${loginProvider}`,
          );
          return;
        }

        let executablePath = "";
        const cwd =
          (await provider.getState()).cwd ||
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
          "";
        console.log(`[webviewMessageHandler] Search CWD: ${cwd}`);

        const candidates = [
          path.join(cwd, "cliapiwindows", "cli-proxy-api.exe"),
          path.join(cwd, "cli-proxy-api.exe"),
          // Add a hardcoded generic path just in case for testing if user has it centralized?
          // No, rely on workspace.
        ];

        for (const candidate of candidates) {
          const exists = await fileExistsAtPath(candidate);
          console.log(
            `[webviewMessageHandler] Checking candidate: ${candidate} -> Exists: ${exists}`,
          );
          if (exists) {
            executablePath = candidate;
            break;
          }
        }

        if (!executablePath) {
          const msg = `CLI Proxy executable path could not be found. Searched in: ${candidates.join(", ")}`;
          console.error(`[webviewMessageHandler] ${msg}`);
          vscode.window.showErrorMessage(msg);
          return;
        }

        // Ensure config.yaml exists
        const exeDir = path.dirname(executablePath);
        const configPath = path.join(exeDir, "config.yaml");
        const configExamplePath = path.join(exeDir, "config.example.yaml");
        try {
          const configExists = await fileExistsAtPath(configPath);
          const exampleExists = await fileExistsAtPath(configExamplePath);
          if (!configExists && exampleExists) {
            console.log(
              `[webviewMessageHandler] Copying config.example.yaml to config.yaml`,
            );
            await fs.copyFile(configExamplePath, configPath);
            vscode.window.showInformationMessage(
              "Created default config.yaml for CLI Proxy.",
            );
          }
        } catch (e) {
          console.error(
            "[webviewMessageHandler] Failed to setup config.yaml:",
            e,
          );
        }

        try {
          console.log(
            `[webviewMessageHandler] Spawning: ${executablePath} with args: ${args.join(" ")}`,
          );
          const { spawn } = await import("child_process");
          vscode.window.showInformationMessage(
            `Launching CLI: ${executablePath} ${args.join(" ")}`,
          );

          const child = spawn(executablePath, args, {
            cwd: path.dirname(executablePath),
          });

          child.stdout.on("data", (data: any) => {
            console.log(`[CLI Proxy] stdout: ${data}`);
          });

          child.stderr.on("data", (data: any) => {
            console.error(`[CLI Proxy] stderr: ${data}`);
          });

          child.on("error", (err: any) => {
            console.error(`[CLI Proxy] Spawn error:`, err);
            vscode.window.showErrorMessage(
              `Failed to start CLI Proxy process: ${err.message}`,
            );
          });

          child.on("close", (code: any) => {
            console.log(`[CLI Proxy] Closed with code: ${code}`);
            if (code === 0)
              vscode.window.showInformationMessage(
                `Login flow for ${loginProvider} finished.`,
              );
            else
              vscode.window.showWarningMessage(
                `Login flow exited with code ${code}. Check output.`,
              );
          });
        } catch (err: any) {
          console.error(`[webviewMessageHandler] Catch error:`, err);
          vscode.window.showErrorMessage(
            `Exception spawning CLI Proxy: ${err.message}`,
          );
        }
      }
      break;

    case "cliProxyLogin": {
      const { apiConfiguration } = await provider.getState();
      const port = apiConfiguration.cliProxyPort || 20128; // 9Router default dashboard port
      const dashboardUrl = `http://localhost:${port}/dashboard`;

      console.log(
        `[webviewMessageHandler] Opening 9Router Dashboard: ${dashboardUrl}`,
      );
      vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
      break;
    }

    case "geminiCliSignIn": {
      try {
        const authUrl = geminiOAuthManager.startAuthorizationFlow();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        await geminiOAuthManager.waitForCallback();
        // Persist provider selection to active profile so settings don't glitch on fresh install
        const {
          apiConfiguration: geminiConfig,
          currentApiConfigName: geminiConfigName = "default",
        } = await provider.getState();
        await provider.upsertProviderProfile(geminiConfigName, {
          ...geminiConfig,
          apiProvider: "gemini-cli",
        });
        vscode.window.showInformationMessage(
          "Gemini CLI authentication successful",
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Gemini CLI authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    case "geminiCliSignOut": {
      try {
        await geminiOAuthManager.clearCredentials();
        await provider.postStateToWebview();
        vscode.window.showInformationMessage("Gemini CLI signed out");
      } catch (error) {
        vscode.window.showErrorMessage(
          `Gemini CLI sign out failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    case "claudeCodeSignIn": {
      try {
        const authUrl = claudeCodeOAuthManager.startAuthorizationFlow();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        await claudeCodeOAuthManager.waitForCallback();
        // Persist provider selection to active profile so settings don't glitch on fresh install
        const {
          apiConfiguration: claudeConfig,
          currentApiConfigName: claudeConfigName = "default",
        } = await provider.getState();
        await provider.upsertProviderProfile(claudeConfigName, {
          ...claudeConfig,
          apiProvider: "claude-code",
        });
        vscode.window.showInformationMessage(
          "Claude Code authentication successful",
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Claude Code authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    case "claudeCodeSignOut": {
      try {
        await claudeCodeOAuthManager.clearCredentials();
        await provider.postStateToWebview();
        vscode.window.showInformationMessage("Claude Code signed out");
      } catch (error) {
        vscode.window.showErrorMessage(
          `Claude Code sign out failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    case "requestClaudeCodeRateLimits": {
      try {
        const rateLimits = await fetchClaudeCodeRateLimitInfo();
        await provider.postMessageToWebview({
          type: "claudeCodeRateLimits",
          values: rateLimits,
        });
      } catch (error) {
        await provider.postMessageToWebview({
          type: "claudeCodeRateLimits",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

    case "requestCliProxyModels": {
      const { apiConfiguration } = await provider.getState();
      const port = apiConfiguration.cliProxyPort || 20128;
      const baseUrl = `http://localhost:${port}`;

      try {
        // Try fetching first
        const response = await axios.get(`${baseUrl}/v1/models`, {
          headers: (apiConfiguration as any).cliProxyApiKey
            ? {
                Authorization: `Bearer ${(apiConfiguration as any).cliProxyApiKey}`,
              }
            : {},
        });
        const models = response.data?.data?.reduce((acc: any, model: any) => {
          acc[model.id] = { id: model.id, info: model };
          return acc;
        }, {});
        await provider.postMessageToWebview({
          type: "cliProxyModels",
          cliProxyModels: models,
        });
      } catch (error) {
        console.log(
          "[webviewMessageHandler] 9Router not running or unauthorized, attempting to resolve...",
        );

        // If 401/403, we need an API Key
        if (
          axios.isAxiosError(error) &&
          (error.response?.status === 401 || error.response?.status === 403)
        ) {
          vscode.window.showErrorMessage(
            "9Router Error: Unauthorized. Please check your API Key in Advanced settings.",
          );
          return;
        }

        // Otherwise, attempt to start 9Router
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
        const routerPath = path.join(cwd, "9router-master");

        if (await fileExistsAtPath(routerPath)) {
          try {
            const { spawn } = await import("child_process");
            // Use pnpm run dev to start it
            const child = spawn("pnpm", ["run", "dev", "--", "-p", "20128"], {
              cwd: routerPath,
              detached: true,
              stdio: "ignore",
              shell: true,
            });
            child.unref();

            console.log(
              `[webviewMessageHandler] Starting 9Router in ${routerPath}`,
            );
            vscode.window.showInformationMessage(
              "Starting 9Router background server...",
            );

            // Wait for boot
            await new Promise((resolve) => setTimeout(resolve, 8000));

            // Try again once
            try {
              const response = await axios.get(`${baseUrl}/v1/models`, {
                headers: (apiConfiguration as any).cliProxyApiKey
                  ? {
                      Authorization: `Bearer ${(apiConfiguration as any).cliProxyApiKey}`,
                    }
                  : {},
              });
              const models = response.data?.data?.reduce(
                (acc: any, model: any) => {
                  acc[model.id] = { id: model.id, info: model };
                  return acc;
                },
                {},
              );
              await provider.postMessageToWebview({
                type: "cliProxyModels",
                cliProxyModels: models,
              });
              return;
            } catch (retryError) {
              console.error(
                "Failed to fetch models even after starting 9Router:",
                retryError,
              );
            }
          } catch (spawnError) {
            console.error("Failed to spawn 9Router:", spawnError);
          }
        }

        await provider.postMessageToWebview({
          type: "cliProxyModels",
          cliProxyModels: {},
        });
      }
      break;
    }

    // kade_change start
    case "condense":
      provider.getCurrentTask()?.handleWebviewAskResponse("yesButtonClicked");
      break;
    // kade_change end
    case "customInstructions":
      await provider.updateCustomInstructions(message.text);
      break;

    case "askResponse":
      if (message.enableSubAgents !== undefined) {
        const currentTask = provider.getCurrentTask();
        if (currentTask) {
          currentTask.enableSubAgents = message.enableSubAgents;
        }
      }
      provider
        .getCurrentTask()
        ?.handleWebviewAskResponse(
          message.askResponse!,
          message.text,
          message.images,
        );
      break;

    case "updateSettings":
      if (message.updatedSettings) {
        // kade_change: Separate Task-Local settings from Global Home Page defaults.
        const currentTask = provider.getCurrentTask();
        let needsRebuild = false;
        let shouldRescheduleInfinity = false;
        for (const [key, value] of Object.entries(message.updatedSettings)) {
          let settingValue: any = value;

          if (
            key === "infinityPrompt" ||
            key === "infinityIntervalMinutes" ||
            key === "infinityScheduleType" ||
            key === "infinityScheduleHour" ||
            key === "infinityScheduleMinute" ||
            key === "infinitySavedPrompts" ||
            key === "activeInfinityPromptId"
          ) {
            shouldRescheduleInfinity = true;
          }

          // 1. If we are in a task, update the task's local brain.
          if (currentTask && key in currentTask.apiConfiguration) {
            (currentTask.apiConfiguration as any)[key] = value;
            if (
              key === "apiProvider" ||
              key === "apiModelId" ||
              key === "openRouterModelId" ||
              key === "kilocodeModel"
            ) {
              needsRebuild = true;
              // provider.log(`[PERSISTENCE_DEBUG][updateSettings] Task-local API field changed: ${key} = ${value}`)
            }
          }

          // 2. ONLY update the global Home Page default if we are NOT in a task.
          // This prevents "pollution" where chat models bleed onto the home page.
          const isApiField =
            key === "apiProvider" ||
            key === "apiModelId" ||
            key === "openRouterModelId" ||
            key === "kilocodeModel";
          if (!currentTask || !isApiField) {
            // Handle special cases with side effects
            if (key === "subAgentApiConfiguration") {
              provider.log(
                `[webviewMessageHandler] Updating subAgentApiConfiguration: ${JSON.stringify(value)}`,
              );
              await provider.contextProxy.setValue(
                "subAgentApiConfiguration" as any,
                value,
              );
            } else if (key === "language") {
              settingValue = value ?? "en";
              changeLanguage(settingValue as Language);
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "allowedCommands") {
              const commands = value ?? [];
              settingValue = Array.isArray(commands)
                ? commands.filter(
                    (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
                  )
                : [];
              await vscode.workspace
                .getConfiguration(Package.name)
                .update(
                  "allowedCommands",
                  settingValue,
                  vscode.ConfigurationTarget.Global,
                );
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "deniedCommands") {
              const commands = value ?? [];
              settingValue = Array.isArray(commands)
                ? commands.filter(
                    (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
                  )
                : [];
              await vscode.workspace
                .getConfiguration(Package.name)
                .update(
                  "deniedCommands",
                  settingValue,
                  vscode.ConfigurationTarget.Global,
                );
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "ttsEnabled") {
              settingValue = value ?? true;
              setTtsEnabled(settingValue as boolean);
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "ttsSpeed") {
              settingValue = value ?? 1.0;
              setTtsSpeed(settingValue as number);
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "terminalShellIntegrationTimeout") {
              if (value !== undefined) {
                Terminal.setShellIntegrationTimeout(value as number);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalShellIntegrationDisabled") {
              if (value !== undefined) {
                Terminal.setShellIntegrationDisabled(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalCommandDelay") {
              if (value !== undefined) {
                Terminal.setCommandDelay(value as number);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalPowershellCounter") {
              if (value !== undefined) {
                Terminal.setPowershellCounter(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalZshClearEolMark") {
              if (value !== undefined) {
                Terminal.setTerminalZshClearEolMark(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalZshOhMy") {
              if (value !== undefined) {
                Terminal.setTerminalZshOhMy(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalZshP10k") {
              if (value !== undefined) {
                Terminal.setTerminalZshP10k(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalZdotdir") {
              if (value !== undefined) {
                Terminal.setTerminalZdotdir(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "terminalCompressProgressBar") {
              if (value !== undefined) {
                Terminal.setCompressProgressBar(value as boolean);
              }
              await provider.contextProxy.setValue(key as any, value);
            } else if (key === "mcpEnabled") {
              settingValue = value ?? true;
              const mcpHub = provider.getMcpHub();
              if (mcpHub) {
                await mcpHub.handleMcpEnabledChange(settingValue as boolean);
              }
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "experiments") {
              if (!value) {
                continue;
              }
              settingValue = {
                ...(getGlobalState("experiments") ?? experimentDefault),
                ...(value as Record<ExperimentId, boolean>),
              };
              await provider.contextProxy.setValue(key as any, settingValue);
            } else if (key === "customSupportPrompts") {
              if (!value) {
                continue;
              }
              await provider.contextProxy.setValue(key as any, value);
            } else {
              await provider.contextProxy.setValue(key as any, value);
            }

            // Invalidate system prompt cache if settings that affect it are changed
            if (
              currentTask &&
              (key === "enabledSkills" || key === "showVibeStyling")
            ) {
              currentTask.invalidateSystemPromptCache();
            }
          } else {
            // provider.log(`[PERSISTENCE_DEBUG][updateSettings] BLOCKED global update for API field "${key}" = "${value}" (inside task)`)
          }

          // 3. Rebuild the active task's handler if its local brain changed.
        if (needsRebuild && currentTask) {
          currentTask.updateApiConfiguration(currentTask.apiConfiguration);
        }
      }

      const latestState = await provider.getState();
      if (shouldRescheduleInfinity && latestState.infinityIsRunning) {
        await provider.startInfinity();
      }

        await provider.debouncedPostStateToWebview();
        // provider.log(`[PERSISTENCE_DEBUG][updateSettings] ====== UPDATE SETTINGS COMPLETE ======`)
      }

      break;

    case "openDiff":
      if (message.text) {
        let filePath: string = message.text;
        if (!path.isAbsolute(filePath)) {
          filePath = path.join(getCurrentCwd(), filePath);
        }

        // If we have a toolId, use the actual snapshot for accurate diff
        if (message.toolId) {
          try {
            const { EditHistoryService } = await import(
              "../../services/edit-history/EditHistoryService"
            );
            const snapshots = EditHistoryService.getInstance().getSnapshots(
              message.toolId,
            );
            const snapshot = snapshots.find((s) =>
              arePathsEqual(s.filePath, filePath),
            );

            if (snapshot) {
              // Use the actual snapshot content (original) vs current file
              // Pass message.edits to allow navigation/scrolling to the first edit
              await openDiff(
                filePath,
                message.edits || [],
                snapshot.originalContent,
              );
            } else {
              // Check if it's a currently active edit (PREVIEW)
              const currentTask = provider.getCurrentTask();
              if (currentTask) {
                const diffProvider = currentTask.diffViewProvider;
                const activeRelPath = diffProvider.getRelPath();
                const activeNewContent = diffProvider.getNewContent();

                if (
                  activeRelPath &&
                  arePathsEqual(
                    path.resolve(getCurrentCwd(), activeRelPath),
                    filePath,
                  )
                ) {
                  // It's the currently active edit! Show as proposed.
                  await openDiff(
                    filePath,
                    message.edits || [],
                    activeNewContent,
                    true,
                  );
                } else if (message.edits) {
                  // Fallback to edit-based diff
                  await openDiff(filePath, message.edits);
                }
              } else if (message.edits) {
                // Fallback to edit-based diff if snapshot not found
                await openDiff(filePath, message.edits);
              }
            }
          } catch (e) {
            console.error("Failed to get snapshot for diff:", e);
            // Fallback to edit-based diff
            if (message.edits) {
              await openDiff(filePath, message.edits);
            }
          }
        } else if (message.edits) {
          // No toolId, use edit-based diff (legacy)
          await openDiff(filePath, message.edits);
        }
      }
      break;

    case "terminalOperation":
      if (message.terminalOperation) {
        provider
          .getCurrentTask()
          ?.handleTerminalOperation(
            message.terminalOperation,
            message.executionId,
            message.text,
          );
      }
      break;
    case "clearTask":
      // Clear task resets the current session. Delegation flows are
      // handled via metadata; parent resumption occurs through
      // reopenParentFromDelegation, not via finishSubTask.
      await provider.clearTask();
      await provider.debouncedPostStateToWebview();
      break;
    case "didShowAnnouncement":
      await updateGlobalState(
        "lastShownAnnouncementId",
        provider.latestAnnouncementId,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "selectImages":
      const images = await selectImages();
      await provider.postMessageToWebview({
        type: "selectedImages",
        images,
        context: message.context,
        messageTs: message.messageTs,
      });
      break;
    case "exportCurrentTask":
      const currentTaskId = provider.getCurrentTask()?.taskId;
      if (currentTaskId) {
        provider.exportTaskWithId(currentTaskId);
      }
      break;
    case "shareCurrentTask":
      const shareTaskId = provider.getCurrentTask()?.taskId;
      const clineMessages = provider.getCurrentTask()?.clineMessages;

      if (!shareTaskId) {
        vscode.window.showErrorMessage(t("common:errors.share_no_active_task"));
        break;
      }

      try {
        const visibility = message.visibility || "organization";
        const result = await CloudService.instance.shareTask(
          shareTaskId,
          visibility,
        );

        if (result.success && result.shareUrl) {
          // Show success notification
          const messageKey =
            visibility === "public"
              ? "common:info.public_share_link_copied"
              : "common:info.organization_share_link_copied";
          vscode.window.showInformationMessage(t(messageKey));

          // Send success feedback to webview for inline display
          await provider.postMessageToWebview({
            type: "shareTaskSuccess",
            visibility,
            text: result.shareUrl,
          });
        } else {
          // Handle error
          const errorMessage = result.error || "Failed to create share link";
          if (errorMessage.includes("Authentication")) {
            vscode.window.showErrorMessage(
              t("common:errors.share_auth_required"),
            );
          } else if (errorMessage.includes("sharing is not enabled")) {
            vscode.window.showErrorMessage(
              t("common:errors.share_not_enabled"),
            );
          } else if (errorMessage.includes("not found")) {
            vscode.window.showErrorMessage(
              t("common:errors.share_task_not_found"),
            );
          } else {
            vscode.window.showErrorMessage(errorMessage);
          }
        }
      } catch (error) {
        provider.log(`[shareCurrentTask] Unexpected error: ${error}`);
        vscode.window.showErrorMessage(t("common:errors.share_task_failed"));
      }
      break;
    case "showTaskWithId":
      provider.showTaskWithId(message.text!);
      break;
    case "condenseTaskContextRequest":
      provider.condenseTaskContext(message.text!);
      break;
    case "deleteTaskWithId":
      provider.deleteTaskWithId(message.text!);
      break;
    case "deleteMultipleTasksWithIds": {
      const ids = message.ids;

      if (Array.isArray(ids)) {
        // Process in batches of 20 (or another reasonable number)
        const batchSize = 20;
        const results = [];

        // Only log start and end of the operation
        console.log(`Batch deletion started: ${ids.length} tasks total`);

        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);

          const batchPromises = batch.map(async (id) => {
            try {
              await provider.deleteTaskWithId(id);
              return { id, success: true };
            } catch (error) {
              // Keep error logging for debugging purposes
              console.log(
                `Failed to delete task ${id}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return { id, success: false };
            }
          });

          // Process each batch in parallel but wait for completion before starting the next batch
          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          // Update the UI after each batch to show progress
          await provider.debouncedPostStateToWebview();
        }

        // Log final results
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;
        console.log(
          `Batch deletion completed: ${successCount}/${ids.length} tasks successful, ${failCount} tasks failed`,
        );
      }
      break;
    }
    case "exportTaskWithId":
      provider.exportTaskWithId(message.text!);
      break;
    case "importSettings": {
      await importSettingsWithFeedback({
        providerSettingsManager: provider.providerSettingsManager,
        contextProxy: provider.contextProxy,
        customModesManager: provider.customModesManager,
        provider: provider,
      });

      break;
    }
    case "exportSettings":
      await exportSettings({
        providerSettingsManager: provider.providerSettingsManager,
        contextProxy: provider.contextProxy,
      });

      break;
    case "resetState":
      await provider.resetState();
      break;
    case "flushRouterModels":
      const routerNameFlush: RouterName = toRouterName(message.text);
      await flushModels(routerNameFlush, true);
      break;
    case "requestRouterModels":
      const { apiConfiguration, zedAuthenticated } = await provider.getState();

      // Optional single provider filter from webview
      const requestedProvider = message?.values?.provider;
      const providerFilter = requestedProvider
        ? toRouterName(requestedProvider)
        : undefined;

      const routerModels: Record<RouterName, ModelRecord> = providerFilter
        ? ({} as Record<RouterName, ModelRecord>)
        : ({
            // kade_change start
            ovhcloud: {},
            inception: {},
            kilocode: {},
            gemini: {},
            antigravity: {}, // kade_change
            zed: {},
            // kade_change end
            openrouter: {},
            kiro: {}, // kade_change
            "vercel-ai-gateway": {},
            huggingface: {},
            litellm: {},
            deepinfra: {},
            "io-intelligence": {},
            requesty: {},
            unbound: {},
            glama: {}, // kade_change
            ollama: {},
            lmstudio: {},
            roo: {},
            synthetic: {}, // kade_change
            "sap-ai-core": {}, // kade_change
            chutes: {},
            "nano-gpt": {}, // kade_change
            opencode: {}, // kade_change
            "cli-proxy": {}, // kade_change
            apertis: {},
            aihubmix: {},
            bluesminds: {},
            corethink: {},
            poe: {},
            zenmux: {},
          } as RouterModels);

      const safeGetModels = async (
        options: GetModelsOptions,
      ): Promise<ModelRecord> => {
        try {
          if (options.provider === "zed") {
            return await getZedModels(true);
          }
          return await getModels(options);
        } catch (error) {
          console.error(
            `Failed to fetch models in webviewMessageHandler requestRouterModels for ${options.provider}:`,
            error,
          );

          throw error; // Re-throw to be caught by Promise.allSettled.
        }
      };

      // kade_change start: openrouter auth, kilocode provider
      const openRouterApiKey =
        apiConfiguration.openRouterApiKey || message?.values?.openRouterApiKey;
      const openRouterBaseUrl =
        apiConfiguration.openRouterBaseUrl ||
        message?.values?.openRouterBaseUrl;

      // Base candidates (only those handled by this aggregate fetcher)
      const candidates: { key: RouterName; options: GetModelsOptions }[] = [
        {
          key: "openrouter",
          options: {
            provider: "openrouter",
            apiKey: openRouterApiKey,
            baseUrl: openRouterBaseUrl,
          },
        },
        {
          key: "aihubmix",
          options: {
            provider: "aihubmix",
            apiKey: apiConfiguration.aihubmixApiKey,
            baseUrl: apiConfiguration.aihubmixBaseUrl,
          } as any,
        },
        {
          key: "bluesminds",
          options: {
            provider: "bluesminds",
            apiKey: apiConfiguration.bluesmindsApiKey,
            baseUrl: apiConfiguration.bluesmindsBaseUrl,
          } as any,
        },
        {
          key: "corethink",
          options: {
            provider: "corethink",
            apiKey: apiConfiguration.corethinkApiKey,
            baseUrl: apiConfiguration.corethinkBaseUrl,
          } as any,
        },
        {
          key: "gemini",
          options: {
            provider: "gemini",
            apiKey: apiConfiguration.geminiApiKey,
            baseUrl: apiConfiguration.googleGeminiBaseUrl,
          },
        },
        {
          key: "zed",
          options: {
            provider: "zed",
          },
        },
        {
          key: "requesty",
          options: {
            provider: "requesty",
            apiKey: apiConfiguration.requestyApiKey,
            baseUrl: apiConfiguration.requestyBaseUrl,
          },
        },
        { key: "glama", options: { provider: "glama" } }, // kade_change
        { key: "opencode", options: { provider: "opencode" } }, // kade_change
        {
          key: "unbound",
          options: {
            provider: "unbound",
            apiKey: apiConfiguration.unboundApiKey,
          },
        },
        {
          key: "kilocode",
          options: {
            provider: "kilocode",
            kilocodeToken: apiConfiguration.kilocodeToken,
            kilocodeOrganizationId: apiConfiguration.kilocodeOrganizationId,
          },
        },
        {
          key: "ollama",
          options: {
            provider: "ollama",
            baseUrl: apiConfiguration.ollamaBaseUrl,
          },
        },
        {
          key: "vercel-ai-gateway",
          options: { provider: "vercel-ai-gateway" },
        },
        {
          key: "deepinfra",
          options: {
            provider: "deepinfra",
            apiKey: apiConfiguration.deepInfraApiKey,
            baseUrl: apiConfiguration.deepInfraBaseUrl,
          },
        },
        // kade_change start
        {
          key: "nano-gpt",
          options: {
            provider: "nano-gpt",
            apiKey: apiConfiguration.nanoGptApiKey,
            nanoGptModelList: apiConfiguration.nanoGptModelList,
          },
        },
        // kade_change end
        {
          key: "ovhcloud",
          options: {
            provider: "ovhcloud",
            apiKey: apiConfiguration.ovhCloudAiEndpointsApiKey,
            baseUrl: apiConfiguration.ovhCloudAiEndpointsBaseUrl,
          },
        },
        {
          key: "inception",
          options: {
            provider: "inception",
            apiKey: apiConfiguration.inceptionLabsApiKey,
            baseUrl: apiConfiguration.inceptionLabsBaseUrl,
          },
        },
        {
          key: "synthetic",
          options: {
            provider: "synthetic",
            apiKey: apiConfiguration.syntheticApiKey,
          },
        }, // kade_change
        {
          key: "roo",
          options: {
            provider: "roo",
            baseUrl:
              process.env.ROO_CODE_PROVIDER_URL ??
              "https://api.roocode.com/proxy",
            apiKey: CloudService.hasInstance()
              ? CloudService.instance.authService?.getSessionToken()
              : undefined,
          },
        },
        {
          key: "chutes",
          options: {
            provider: "chutes",
            apiKey: apiConfiguration.chutesApiKey,
          },
        },
      ];
      // kade_change end

      // IO Intelligence is conditional on api key
      if (apiConfiguration.ioIntelligenceApiKey) {
        candidates.push({
          key: "io-intelligence",
          options: {
            provider: "io-intelligence",
            apiKey: apiConfiguration.ioIntelligenceApiKey,
          },
        });
      }

      // LiteLLM is conditional on baseUrl+apiKey
      const litellmApiKey =
        apiConfiguration.litellmApiKey || message?.values?.litellmApiKey;
      const litellmBaseUrl =
        apiConfiguration.litellmBaseUrl || message?.values?.litellmBaseUrl;

      if (litellmApiKey && litellmBaseUrl) {
        // If explicit credentials are provided in message.values (from Refresh Models button),
        // flush the cache first to ensure we fetch fresh data with the new credentials
        if (message?.values?.litellmApiKey || message?.values?.litellmBaseUrl) {
          await flushModels("litellm", true);
        }

        candidates.push({
          key: "litellm",
          options: {
            provider: "litellm",
            apiKey: litellmApiKey,
            baseUrl: litellmBaseUrl,
          },
        });
      }

      // Apply single provider filter if specified
      const modelFetchPromises = providerFilter
        ? candidates.filter(({ key }) => {
            if (key !== providerFilter) {
              return false;
            }
            if (key === "zed") {
              return !!zedAuthenticated;
            }
            return true;
          })
        : candidates.filter(({ key }) => {
            // kade_change: Only fetch models if tokens are present to avoid errors
            if (key === "kilocode") {
              return !!apiConfiguration.kilocodeToken;
            }
            if (key === "zed") {
              return !!zedAuthenticated;
            }
            // if (key === "glama") {
            // 	return !!apiConfiguration.glamaApiKey
            // }
            return true;
          });

      const results = await Promise.allSettled(
        modelFetchPromises.map(async ({ key, options }) => {
          const models = await safeGetModels(options);
          return { key, models }; // The key is `ProviderName` here.
        }),
      );

      results.forEach((result, index) => {
        const routerName = modelFetchPromises[index].key;

        if (result.status === "fulfilled") {
          routerModels[routerName] = result.value.models;

          // Ollama and LM Studio settings pages still need these events. They are not fetched here.
        } else {
          // Handle rejection: Post a specific error message for this provider.
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.error(
            `Error fetching models for ${routerName}:`,
            result.reason,
          );

          routerModels[routerName] = {}; // Ensure it's an empty object in the main routerModels message.

          provider.postMessageToWebview({
            type: "singleRouterModelFetchResponse",
            success: false,
            error: errorMessage,
            values: { provider: routerName },
          });
        }
      });

      provider.postMessageToWebview({
        type: "routerModels",
        routerModels,
        values: providerFilter ? { provider: requestedProvider } : undefined,
      });
      break;
    case "requestOllamaModels": {
      // Specific handler for Ollama models only.
      const { apiConfiguration: ollamaApiConfig } = await provider.getState();
      try {
        // Flush cache and refresh to ensure fresh models.
        await flushModels("ollama", true);

        const ollamaModels = await getModels({
          provider: "ollama",
          baseUrl: ollamaApiConfig.ollamaBaseUrl,
          apiKey: ollamaApiConfig.ollamaApiKey,
          numCtx: ollamaApiConfig.ollamaNumCtx, // kade_change
        });

        if (Object.keys(ollamaModels).length > 0) {
          provider.postMessageToWebview({
            type: "ollamaModels",
            ollamaModels: ollamaModels,
          });
        }
      } catch (error) {
        // Silently fail - user hasn't configured Ollama yet
        console.debug("Ollama models fetch failed:", error);
      }
      break;
    }
    case "requestLmStudioModels": {
      // Specific handler for LM Studio models only.
      const { apiConfiguration: lmStudioApiConfig } = await provider.getState();
      try {
        // Flush cache and refresh to ensure fresh models.
        await flushModels("lmstudio", true);

        const lmStudioModels = await getModels({
          provider: "lmstudio",
          baseUrl: lmStudioApiConfig.lmStudioBaseUrl,
        });

        if (Object.keys(lmStudioModels).length > 0) {
          provider.postMessageToWebview({
            type: "lmStudioModels",
            lmStudioModels: lmStudioModels,
          });
        }
      } catch (error) {
        // Silently fail - user hasn't configured LM Studio yet.
        console.debug("LM Studio models fetch failed:", error);
      }
      break;
    }
    case "requestRooModels": {
      // Specific handler for Roo models only - flushes cache to ensure fresh auth token is used
      try {
        // Flush cache and refresh to ensure fresh models with current auth state
        await flushModels("roo", true);

        const rooModels = await getModels({
          provider: "roo",
          baseUrl:
            process.env.ROO_CODE_PROVIDER_URL ??
            "https://api.roocode.com/proxy",
          apiKey: CloudService.hasInstance()
            ? CloudService.instance.authService?.getSessionToken()
            : undefined,
        });

        // Always send a response, even if no models are returned
        provider.postMessageToWebview({
          type: "singleRouterModelFetchResponse",
          success: true,
          values: { provider: "roo", models: rooModels },
        });
      } catch (error) {
        // Send error response
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.postMessageToWebview({
          type: "singleRouterModelFetchResponse",
          success: false,
          error: errorMessage,
          values: { provider: "roo" },
        });
      }
      break;
    }
    case "requestRooCreditBalance": {
      // Fetch Roo credit balance using CloudAPI
      const requestId = message.requestId;
      try {
        if (!CloudService.hasInstance() || !CloudService.instance.cloudAPI) {
          throw new Error("Cloud service not available");
        }

        const balance = await CloudService.instance.cloudAPI.creditBalance();

        provider.postMessageToWebview({
          type: "rooCreditBalance",
          requestId,
          values: { balance },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.postMessageToWebview({
          type: "rooCreditBalance",
          requestId,
          values: { error: errorMessage },
        });
      }
      break;
    }
    case "requestOpenAiModels":
      if (message?.values?.baseUrl && message?.values?.apiKey) {
        const openAiModels = await getOpenAiModels(
          message?.values?.baseUrl,
          message?.values?.apiKey,
          message?.values?.openAiHeaders,
        );

        provider.postMessageToWebview({ type: "openAiModels", openAiModels });
      }

      break;
    case "requestVsCodeLmModels":
      const vsCodeLmModels = await getVsCodeLmModels();
      // TODO: Cache like we do for OpenRouter, etc?
      provider.postMessageToWebview({ type: "vsCodeLmModels", vsCodeLmModels });
      break;
    case "requestHuggingFaceModels":
      // TODO: Why isn't this handled by `requestRouterModels` above?
      try {
        const { getHuggingFaceModelsWithMetadata } = await import(
          "../../api/providers/fetchers/huggingface"
        );
        const huggingFaceModelsResponse =
          await getHuggingFaceModelsWithMetadata();

        provider.postMessageToWebview({
          type: "huggingFaceModels",
          huggingFaceModels: huggingFaceModelsResponse.models,
        });
      } catch (error) {
        console.error("Failed to fetch Hugging Face models:", error);
        provider.postMessageToWebview({
          type: "huggingFaceModels",
          huggingFaceModels: [],
        });
      }
      break;
    // kade_change start
    case "requestSapAiCoreModels": {
      // Specific handler for SAP AI Core models only.
      if (message?.values?.sapAiCoreServiceKey) {
        try {
          // Flush cache first to ensure fresh models.
          await flushModels("sap-ai-core");

          const sapAiCoreModels = await getModels({
            provider: "sap-ai-core",
            sapAiCoreServiceKey: message?.values?.sapAiCoreServiceKey,
            sapAiCoreResourceGroup: message?.values?.sapAiCoreResourceGroup,
            sapAiCoreUseOrchestration:
              message?.values?.sapAiCoreUseOrchestration,
          });

          if (Object.keys(sapAiCoreModels).length > 0) {
            provider.postMessageToWebview({
              type: "sapAiCoreModels",
              sapAiCoreModels: sapAiCoreModels,
            });
          }
        } catch (error) {
          console.error("SAP AI Core models fetch failed:", error);
        }
      }
      break;
    }
    case "requestSapAiCoreDeployments": {
      if (message?.values?.sapAiCoreServiceKey) {
        try {
          const sapAiCoreDeployments = await getSapAiCoreDeployments(
            message?.values?.sapAiCoreServiceKey,
            message?.values?.sapAiCoreResourceGroup,
          );

          if (Object.keys(sapAiCoreDeployments).length > 0) {
            provider.postMessageToWebview({
              type: "sapAiCoreDeployments",
              sapAiCoreDeployments: sapAiCoreDeployments,
            });
          }
        } catch (error) {
          console.error("SAP AI Core deployments fetch failed:", error);
        }
      }
      break;
    }
    // kade_change end
    case "openImage":
      openImage(message.text!, { values: message.values });
      break;
    case "saveImage":
      saveImage(message.dataUri!);
      break;
    case "openFile":
      let filePath: string = message.text ?? "";

      // kade_change: Handle potential leading slashes on Windows for project-relative paths
      // (e.g. /src/foo.ts coming from a chat mention should be treated as relative)
      if (os.platform() === "win32") {
        // If it starts with / or \ but NOT a drive letter, strip it so it becomes relative
        if (/^[\\\/]/.test(filePath) && !/^[a-zA-Z]:/.test(filePath)) {
          filePath = filePath.replace(/^[\\\/]+/, "");
        }
      }

      if (!path.isAbsolute(filePath)) {
        const fullPath = path.join(getCurrentCwd(), filePath);
        if (await fileExistsAtPath(fullPath)) {
          filePath = fullPath;
        }
      }
      openFileInProviderColumn(
        filePath,
        message.values as {
          create?: boolean;
          content?: string;
          line?: number;
          endLine?: number;
        },
      );
      break;
    case "newUntitledFile":
      {
        const document = await vscode.workspace.openTextDocument({
          language: "plaintext",
          content: "",
        });

        await vscode.window.showTextDocument(document, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
        });
      }
      break;
    case "openMention":
      openMention(getCurrentCwd(), message.text, getTargetViewColumn());
      break;
    case "focusTerminal":
      await vscode.commands.executeCommand("workbench.action.terminal.focus");
      break;
    case "openExternal":
      if (message.url) {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
      break;
    case "checkpointDiff":
      const result = checkoutDiffPayloadSchema.safeParse(message.payload);

      if (result.success) {
        await provider.getCurrentTask()?.checkpointDiff(result.data);
      }

      break;
    // kade_change start
    case "seeNewChanges":
      const task = provider.getCurrentTask();
      if (task && message.payload && message.payload) {
        await seeNewChanges(
          task,
          (message.payload as SeeNewChangesPayload).commitRange,
        );
      }
      break;
    case "tasksByIdRequest": {
      const request = message.payload as TasksByIdRequestPayload;
      await provider.postMessageToWebview({
        type: "tasksByIdResponse",
        payload: {
          requestId: request.requestId,
          tasks: provider
            .getTaskHistory()
            .filter((task) => request.taskIds.includes(task.id)),
        },
      });
      break;
    }
    case "taskHistoryRequest": {
      const payload = getTaskHistory(
        provider.getTaskHistory(),
        provider.cwd,
        message.payload as TaskHistoryRequestPayload,
      );
      const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath;
      const historyItems = await Promise.all(
        payload.historyItems.map(async (item) => {
          if (
            typeof item.diffAdditions === "number" ||
            typeof item.diffDeletions === "number"
          ) {
            return item;
          }

          const messages = await readTaskMessages({
            taskId: item.id,
            globalStoragePath,
          });
          const diffTotals = deriveEditHistoryDiffTotals(messages);

          if (diffTotals.additions === 0 && diffTotals.deletions === 0) {
            return item;
          }

          return {
            ...item,
            diffAdditions: diffTotals.additions,
            diffDeletions: diffTotals.deletions,
          };
        }),
      );

      await provider.postMessageToWebview({
        type: "taskHistoryResponse",
        payload: {
          ...payload,
          historyItems,
        },
      });
      break;
    }
    // kade_change end
    case "requestCheckpointRestoreApproval": {
      const result = requestCheckpointRestoreApprovalPayloadSchema.safeParse(
        message.payload,
      );

      if (result.success) {
        const { commitHash, checkpointTs, messagesToRemove, confirmationText } =
          result.data;
        const task = provider.getCurrentTask();

        if (task) {
          const askMessage = {
            ts: Date.now(),
            type: "ask" as const,
            ask: "checkpoint_restore" as const,
            text: JSON.stringify({
              commitHash,
              checkpointTs,
              messagesToRemove,
              confirmationText,
            }),
          };

          task.clineMessages.push(askMessage);
          await provider.debouncedPostStateToWebview();
        }
      }

      break;
    }
    case "checkpointRestore": {
      const result = checkoutRestorePayloadSchema.safeParse(message.payload);

      if (result.success) {
        await provider.cancelTask();

        try {
          await pWaitFor(
            () => provider.getCurrentTask()?.isInitialized === true,
            { timeout: 3_000 },
          );
        } catch (error) {
          vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"));
        }

        try {
          await provider.getCurrentTask()?.checkpointRestore(result.data);
        } catch (error) {
          vscode.window.showErrorMessage(t("common:errors.checkpoint_failed"));
        }
      }

      break;
    }
    case "cancelTask":
      await provider.cancelTask();
      break;
    case "cancelAutoApproval":
      // Cancel any pending auto-approval timeout for the current task
      provider.getCurrentTask()?.cancelAutoApprovalTimeout();
      break;
    case "killBrowserSession":
      {
        const task = provider.getCurrentTask();
        if (task?.browserSession) {
          await task.browserSession.closeBrowser();
          await provider.debouncedPostStateToWebview();
        }
      }
      break;
    case "openBrowserSessionPanel":
      {
        // Toggle the Browser Session panel (open if closed, close if open)
        const panelManager = BrowserSessionPanelManager.getInstance(provider);
        await panelManager.toggle();
      }
      break;
    case "showBrowserSessionPanelAtStep":
      {
        const panelManager = BrowserSessionPanelManager.getInstance(provider);

        // If this is a launch action, reset the manual close flag
        if (message.isLaunchAction) {
          panelManager.resetManualCloseFlag();
        }

        // Show panel if:
        // 1. Manual click (forceShow) - always show
        // 2. Launch action - always show and reset flag
        // 3. Auto-open for non-launch action - only if user hasn't manually closed
        if (
          message.forceShow ||
          message.isLaunchAction ||
          panelManager.shouldAllowAutoOpen()
        ) {
          // Ensure panel is shown and populated
          await panelManager.show();

          // Navigate to a specific step if provided
          // For launch actions: navigate to step 0
          // For manual clicks: navigate to the clicked step
          // For auto-opens of regular actions: don't navigate, let BrowserSessionRow's
          // internal auto-advance logic handle it (only advances if user is on most recent step)
          if (typeof message.stepIndex === "number" && message.stepIndex >= 0) {
            await panelManager.navigateToStep(message.stepIndex);
          }
        }
      }
      break;
    case "refreshBrowserSessionPanel":
      {
        // Re-send the latest browser session snapshot to the panel
        const panelManager = BrowserSessionPanelManager.getInstance(provider);
        const task = provider.getCurrentTask();
        if (task) {
          const messages = task.clineMessages || [];
          const browserSessionStartIndex = messages.findIndex(
            (m) =>
              m.ask === "browser_action_launch" ||
              (m.say === "browser_session_status" &&
                m.text?.includes("opened")),
          );
          const browserSessionMessages =
            browserSessionStartIndex !== -1
              ? messages.slice(browserSessionStartIndex)
              : [];
          const isBrowserSessionActive =
            task.browserSession?.isSessionActive() ?? false;
          await panelManager.updateBrowserSession(
            browserSessionMessages,
            isBrowserSessionActive,
          );
        }
      }
      break;
    case "allowedCommands": {
      // Validate and sanitize the commands array
      const commands = message.commands ?? [];
      const validCommands = Array.isArray(commands)
        ? commands.filter(
            (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
          )
        : [];

      await updateGlobalState("allowedCommands", validCommands);

      // Also update workspace settings.
      await vscode.workspace
        .getConfiguration(Package.name)
        .update(
          "allowedCommands",
          validCommands,
          vscode.ConfigurationTarget.Global,
        );

      break;
    }
    case "deniedCommands": {
      // Validate and sanitize the commands array
      const commands = message.commands ?? [];
      const validCommands = Array.isArray(commands)
        ? commands.filter(
            (cmd) => typeof cmd === "string" && cmd.trim().length > 0,
          )
        : [];

      await updateGlobalState("deniedCommands", validCommands);

      // Also update workspace settings.
      await vscode.workspace
        .getConfiguration(Package.name)
        .update(
          "deniedCommands",
          validCommands,
          vscode.ConfigurationTarget.Global,
        );

      break;
    }
    case "openCustomModesSettings": {
      if (!provider.customModesManager) {
        return;
      }
      const customModesFilePath =
        await provider.customModesManager.getCustomModesFilePath();

      if (customModesFilePath) {
        openFileInProviderColumn(customModesFilePath);
      }

      break;
    }
    case "openKeyboardShortcuts": {
      // Open VSCode keyboard shortcuts settings and optionally filter to show the Roo Code commands
      const searchQuery = message.text || "";
      if (searchQuery) {
        // Open with a search query pre-filled
        await vscode.commands.executeCommand(
          "workbench.action.openGlobalKeybindings",
          searchQuery,
        );
      } else {
        // Just open the keyboard shortcuts settings
        await vscode.commands.executeCommand(
          "workbench.action.openGlobalKeybindings",
        );
      }
      break;
    }
    case "openMcpSettings": {
      const mcpSettingsFilePath = await provider
        .getMcpHub()
        ?.getMcpSettingsFilePath();

      if (mcpSettingsFilePath) {
        openFileInProviderColumn(mcpSettingsFilePath);
      }

      break;
    }
    case "openProjectMcpSettings": {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage(t("common:errors.no_workspace"));
        return;
      }

      const workspaceFolder = getCurrentCwd();
      const rooDir = path.join(workspaceFolder, ".kilocode");
      const mcpPath = path.join(rooDir, "mcp.json");

      try {
        await fs.mkdir(rooDir, { recursive: true });
        const exists = await fileExistsAtPath(mcpPath);

        if (!exists) {
          await safeWriteJson(mcpPath, { mcpServers: {} });
        }

        openFileInProviderColumn(mcpPath);
      } catch (error) {
        vscode.window.showErrorMessage(
          t("mcp:errors.create_json", { error: `${error}` }),
        );
      }

      break;
    }
    case "deleteMcpServer": {
      if (!message.serverName) {
        break;
      }

      try {
        provider.log(`Attempting to delete MCP server: ${message.serverName}`);
        await provider
          .getMcpHub()
          ?.deleteServer(
            message.serverName,
            message.source as "global" | "project",
          );
        provider.log(`Successfully deleted MCP server: ${message.serverName}`);

        // Refresh the webview state
        await provider.debouncedPostStateToWebview();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.log(`Failed to delete MCP server: ${errorMessage}`);
        // Error messages are already handled by McpHub.deleteServer
      }
      break;
    }
    case "openAiCodexSignIn": {
      try {
        const authUrl = openAiCodexOAuthManager.startAuthorizationFlow();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));

        openAiCodexOAuthManager
          .waitForCallback()
          .then(async () => {
            // Persist provider selection to active profile so settings don't glitch on fresh install
            const {
              apiConfiguration: codexConfig,
              currentApiConfigName: codexConfigName = "default",
            } = await provider.getState();
            await provider.upsertProviderProfile(codexConfigName, {
              ...codexConfig,
              apiProvider: "openai-codex",
            });
            vscode.window.showInformationMessage(
              t("settings:providers.openAiCodex.authSuccess", {
                defaultValue: "Successfully authenticated with OpenAI Codex",
              }),
            );
          })
          .catch((error) => {
            provider.log(`OpenAI Codex OAuth callback failed: ${error}`);
            // Don't show error if it's just a timeout (user might have closed the browser)
            if (!String(error).includes("timed out")) {
              vscode.window.showErrorMessage(
                t("settings:providers.openAiCodex.authError", {
                  error: error instanceof Error ? error.message : String(error),
                  defaultValue: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
                }),
              );
            }
          });
      } catch (error) {
        provider.log(`OpenAI Codex OAuth failed: ${error}`);
        vscode.window.showErrorMessage(
          t("settings:providers.openAiCodex.authError", {
            error: error instanceof Error ? error.message : String(error),
            defaultValue: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
        );
      }
      break;
    }
    case "openAiCodexSignOut": {
      try {
        await openAiCodexOAuthManager.clearCredentials();
        vscode.window.showInformationMessage("Signed out from OpenAI Codex");
        await provider.debouncedPostStateToWebview();
      } catch (error) {
        provider.log(`OpenAI Codex sign out failed: ${error}`);
        vscode.window.showErrorMessage("OpenAI Codex sign out failed.");
      }
      break;
    }
    case "antigravitySignIn": {
      try {
        const authUrl = antigravityOAuthManager.startAuthorizationFlow();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        await antigravityOAuthManager.waitForCallback();
        // Persist provider selection to active profile so settings don't glitch on fresh install
        const {
          apiConfiguration: antigravityConfig,
          currentApiConfigName: antigravityConfigName = "default",
        } = await provider.getState();
        await provider.upsertProviderProfile(antigravityConfigName, {
          ...antigravityConfig,
          apiProvider: "antigravity",
        });
        vscode.window.showInformationMessage(
          t("settings:providers.antigravity.authSuccess", {
            defaultValue: "Successfully authenticated with Google Gemini",
          }),
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          t("settings:providers.antigravity.authError", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      break;
    }
    case "antigravitySignOut": {
      await antigravityOAuthManager.clearCredentials();
      await provider.debouncedPostStateToWebview();
      break;
    }
    case "zedSignIn": {
      try {
        const authUrl = await zedOAuthManager.startAuthorizationFlow();
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        await zedOAuthManager.waitForCallback();
        const {
          apiConfiguration: zedConfig,
          currentApiConfigName: zedConfigName = "default",
        } = await provider.getState();
        await provider.upsertProviderProfile(zedConfigName, {
          ...zedConfig,
          apiProvider: "zed",
        });
        await provider.postStateToWebview();
        try {
          const zedModels = await getZedModels(true);
          await provider.postMessageToWebview({
            type: "routerModels",
            routerModels: { zed: zedModels } as RouterModels,
            values: { provider: "zed" },
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          provider.log(`Failed to fetch Zed models after sign-in: ${errorMessage}`);
          await provider.postMessageToWebview({
            type: "singleRouterModelFetchResponse",
            success: false,
            error: errorMessage,
            values: { provider: "zed" },
          });
        }
        vscode.window.showInformationMessage("Successfully authenticated with Zed");
      } catch (error) {
        vscode.window.showErrorMessage(
          `Zed authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    case "zedSignOut": {
      await zedOAuthManager.clearCredentials();
      await flushModels("zed", true);
      await provider.postStateToWebview();
      await provider.postMessageToWebview({
        type: "routerModels",
        routerModels: { zed: {} } as RouterModels,
        values: { provider: "zed" },
      });
      break;
    }
    // Note: geminiCliSignIn and geminiCliSignOut are handled above (lines ~769-795)

    case "requestOpenAiCodexRateLimits": {
      try {
        const accessToken = await openAiCodexOAuthManager.getAccessToken();
        if (!accessToken) {
          await provider.postMessageToWebview({
            type: "openAiCodexRateLimits",
            error: "Not authenticated",
          });
          break;
        }
        const accountId = await openAiCodexOAuthManager.getAccountId();
        const rateLimits = await fetchOpenAiCodexRateLimitInfo(accessToken, {
          accountId,
        });
        await provider.postMessageToWebview({
          type: "openAiCodexRateLimits",
          values: rateLimits,
        });
      } catch (error) {
        provider.log(`OpenAI Codex rate limit request failed: ${error}`);
        await provider.postMessageToWebview({
          type: "openAiCodexRateLimits",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
    case "restartMcpServer": {
      try {
        await provider
          .getMcpHub()
          ?.restartConnection(
            message.text!,
            message.source as "global" | "project",
          );
      } catch (error) {
        provider.log(
          `Failed to retry connection for ${message.text}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
      }
      break;
    }
    case "toggleToolAlwaysAllow": {
      try {
        await provider
          .getMcpHub()
          ?.toggleToolAlwaysAllow(
            message.serverName!,
            message.source as "global" | "project",
            message.toolName!,
            Boolean(message.alwaysAllow),
          );
      } catch (error) {
        provider.log(
          `Failed to toggle auto-approve for tool ${message.toolName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
      }
      break;
    }
    case "toggleToolEnabledForPrompt": {
      try {
        await provider
          .getMcpHub()
          ?.toggleToolEnabledForPrompt(
            message.serverName!,
            message.source as "global" | "project",
            message.toolName!,
            Boolean(message.isEnabled),
          );
      } catch (error) {
        provider.log(
          `Failed to toggle enabled for prompt for tool ${message.toolName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
      }
      break;
    }
    case "toggleAlwaysAllowAllTools": {
      try {
        await provider
          .getMcpHub()
          ?.toggleAlwaysAllowAllTools(
            message.serverName!,
            message.source as "global" | "project",
            Boolean(message.alwaysAllowAll),
          );
      } catch (error) {
        provider.log(
          `Failed to toggle always allow all for server ${message.serverName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
      }
      break;
    }
    case "toggleMcpServer": {
      try {
        await provider
          .getMcpHub()
          ?.toggleServerDisabled(
            message.serverName!,
            message.disabled!,
            message.source as "global" | "project",
          );
      } catch (error) {
        provider.log(
          `Failed to toggle MCP server ${message.serverName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
      }
      break;
    }
    case "enableMcpServerCreation":
      await updateGlobalState("enableMcpServerCreation", message.bool ?? true);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change begin
    case "openGlobalKeybindings":
      vscode.commands.executeCommand(
        "workbench.action.openGlobalKeybindings",
        message.text ?? "kilo-code.",
      );
      break;
    case "showSystemNotification":
      const isSystemNotificationsEnabled =
        getGlobalState("systemNotificationsEnabled") ?? true;
      if (!isSystemNotificationsEnabled && !message.alwaysAllow) {
        break;
      }
      if (message.notificationOptions) {
        showSystemNotification(message.notificationOptions);
      }
      break;
    case "systemNotificationsEnabled":
      const systemNotificationsEnabled = message.bool ?? true;
      await updateGlobalState(
        "systemNotificationsEnabled",
        systemNotificationsEnabled,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "openInBrowser":
      if (message.url) {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
      break;
    // kade_change end
    case "remoteControlEnabled":
      try {
        await CloudService.instance.updateUserSettings({
          extensionBridgeEnabled: message.bool ?? false,
        });
      } catch (error) {
        provider.log(
          `CloudService#updateUserSettings failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;

    case "taskSyncEnabled":
      const enabled = message.bool ?? false;
      const updatedSettings: Partial<UserSettingsConfig> = {
        taskSyncEnabled: enabled,
      };

      // If disabling task sync, also disable remote control.
      if (!enabled) {
        updatedSettings.extensionBridgeEnabled = false;
      }

      try {
        await CloudService.instance.updateUserSettings(updatedSettings);
      } catch (error) {
        provider.log(`Failed to update cloud settings for task sync: ${error}`);
      }

      break;

    case "refreshAllMcpServers": {
      const mcpHub = provider.getMcpHub();

      if (mcpHub) {
        await mcpHub.refreshAllConnections();
      }

      break;
    }

    case "ttsEnabled":
      const ttsEnabled = message.bool ?? true;
      await updateGlobalState("ttsEnabled", ttsEnabled);
      setTtsEnabled(ttsEnabled);
      await provider.debouncedPostStateToWebview();
      break;
    case "ttsSpeed":
      const ttsSpeed = message.value ?? 1.0;
      await updateGlobalState("ttsSpeed", ttsSpeed);
      setTtsSpeed(ttsSpeed);
      await provider.debouncedPostStateToWebview();
      break;
    case "playTts":
      if (message.text) {
        playTts(message.text, {
          onStart: () =>
            provider.postMessageToWebview({
              type: "ttsStart",
              text: message.text,
            }),
          onStop: () =>
            provider.postMessageToWebview({
              type: "ttsStop",
              text: message.text,
            }),
        });
      }

      break;
    case "stopTts":
      stopTts();
      break;

    case "testBrowserConnection":
      // If no text is provided, try auto-discovery
      if (!message.text) {
        // Use testBrowserConnection for auto-discovery
        const chromeHostUrl = await discoverChromeHostUrl();

        if (chromeHostUrl) {
          // Send the result back to the webview
          await provider.postMessageToWebview({
            type: "browserConnectionResult",
            success: !!chromeHostUrl,
            text: `Auto-discovered and tested connection to Chrome: ${chromeHostUrl}`,
            values: { endpoint: chromeHostUrl },
          });
        } else {
          await provider.postMessageToWebview({
            type: "browserConnectionResult",
            success: false,
            text: "No Chrome instances found on the network. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
          });
        }
      } else {
        // Test the provided URL
        const customHostUrl = message.text;
        const hostIsValid = await tryChromeHostUrl(message.text);

        // Send the result back to the webview
        await provider.postMessageToWebview({
          type: "browserConnectionResult",
          success: hostIsValid,
          text: hostIsValid
            ? `Successfully connected to Chrome: ${customHostUrl}`
            : "Failed to connect to Chrome",
        });
      }
      break;
    // kade_change start
    case "morphApiKey":
      await updateGlobalState("morphApiKey", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    case "fastApplyModel": {
      const nextModel =
        fastApplyModelSchema.safeParse(message.text).data ?? "auto";
      await updateGlobalState("fastApplyModel", nextModel);
      await provider.debouncedPostStateToWebview();
      break;
    }
    case "fastApplyApiProvider": {
      const nextProvider =
        fastApplyApiProviderSchema.safeParse(message.text).data ?? "current";
      await updateGlobalState("fastApplyApiProvider", nextProvider);
      await provider.debouncedPostStateToWebview();
      break;
    }
    // kade_change end
    case "updateVSCodeSetting": {
      const { setting, value } = message;

      if (setting !== undefined && value !== undefined) {
        if (ALLOWED_VSCODE_SETTINGS.has(setting)) {
          await vscode.workspace
            .getConfiguration()
            .update(setting, value, true);
        } else {
          vscode.window.showErrorMessage(
            `Cannot update restricted VSCode setting: ${setting}`,
          );
        }
      }

      break;
    }
    case "getVSCodeSetting":
      const { setting } = message;

      if (setting) {
        try {
          await provider.postMessageToWebview({
            type: "vsCodeSetting",
            setting,
            value: vscode.workspace.getConfiguration().get(setting),
          });
        } catch (error) {
          console.error(
            `Failed to get VSCode setting ${message.setting}:`,
            error,
          );

          await provider.postMessageToWebview({
            type: "vsCodeSetting",
            setting,
            error: `Failed to get setting: ${error.message}`,
            value: undefined,
          });
        }
      }

      break;

    case "mode":
      await provider.handleModeSwitch(message.text as Mode);
      break;
    case "updatePrompt":
      if (message.promptMode && message.customPrompt !== undefined) {
        const existingPrompts = getGlobalState("customModePrompts") ?? {};
        const updatedPrompts = {
          ...existingPrompts,
          [message.promptMode]: message.customPrompt,
        };
        await updateGlobalState("customModePrompts", updatedPrompts);
        const currentState = await provider.getStateToPostToWebview();
        const stateWithPrompts = {
          ...currentState,
          customModePrompts: updatedPrompts,
          hasOpenedModeSelector: currentState.hasOpenedModeSelector ?? false,
        };
        provider.postMessageToWebview({
          type: "state",
          state: stateWithPrompts,
        });

        if (TelemetryService.hasInstance()) {
          // Determine which setting was changed by comparing objects
          const oldPrompt = existingPrompts[message.promptMode] || {};
          const newPrompt = message.customPrompt;
          const changedSettings = Object.keys(newPrompt).filter(
            (key) =>
              JSON.stringify((oldPrompt as Record<string, unknown>)[key]) !==
              JSON.stringify((newPrompt as Record<string, unknown>)[key]),
          );

          if (changedSettings.length > 0) {
            TelemetryService.instance.captureModeSettingChanged(
              changedSettings[0],
            );
          }
        }
      }
      break;
    case "deleteMessage": {
      if (!provider.getCurrentTask()) {
        await vscode.window.showErrorMessage(
          t("common:errors.message.no_active_task_to_delete"),
        );
        break;
      }

      if (typeof message.value !== "number" || !message.value) {
        await vscode.window.showErrorMessage(
          t("common:errors.message.invalid_timestamp_for_deletion"),
        );
        break;
      }

      await handleMessageModificationsOperation(message.value, "delete");
      break;
    }
    case "submitEditedMessage": {
      if (
        provider.getCurrentTask() &&
        typeof message.value === "number" &&
        message.value &&
        message.editedMessageContent
      ) {
        await handleMessageModificationsOperation(
          message.value,
          "edit",
          message.editedMessageContent,
          message.images,
        );
      }
      break;
    }

    case "hasOpenedModeSelector":
      await updateGlobalState("hasOpenedModeSelector", message.bool ?? true);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change start
    case "kiloCodeImageApiKey":
      await provider.contextProxy.setValue("kiloCodeImageApiKey", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    case "showAutoApproveMenu":
      await updateGlobalState("showAutoApproveMenu", message.bool ?? true);
      await provider.debouncedPostStateToWebview();
      break;
    case "disableBrowserHeadless":
      await updateGlobalState("disableBrowserHeadless", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    case "showTaskTimeline":
      await updateGlobalState("showTaskTimeline", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change start
    case "sendMessageOnEnter":
      await updateGlobalState("sendMessageOnEnter", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end
    case "showTimestamps":
      await updateGlobalState("showTimestamps", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    case "toggleInfinity":
      try {
        if (message.enabled) {
          await provider.startInfinity();
        } else {
          await provider.stopInfinity();
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        await provider.stopInfinity();
      }
      break;
    case "hideCostBelowThreshold":
      await updateGlobalState("hideCostBelowThreshold", message.value);
      await provider.debouncedPostStateToWebview();
      break;
    case "collapseCodeToolsByDefault":
      await updateGlobalState(
        "collapseCodeToolsByDefault",
        message.bool ?? false,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "showVibeStyling":
      provider.debouncedPostStateToWebview.cancel();
      await updateGlobalState("showVibeStyling", message.bool === true);
      // Invalidate system prompt cache so the next model turn uses the updated setting
      const currentTask = provider.getCurrentTask();
      if (currentTask) {
        currentTask.invalidateSystemPromptCache();
      }
      await provider.postStateToWebview();
      break;
    case "allowVeryLargeReads":
      await updateGlobalState("allowVeryLargeReads", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    case "slidingWindowSize":
      await updateGlobalState("slidingWindowSize", message.value);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end

    case "setReasoningBlockCollapsed":
      await updateGlobalState("reasoningBlockCollapsed", message.bool ?? true);
      // No need to call postStateToWebview here as the UI already updated optimistically
      break;
    case "setHistoryPreviewCollapsed":
      await updateGlobalState("historyPreviewCollapsed", message.bool ?? false);
      // No need to call postStateToWebview here as the UI already updated optimistically
      break;
    case "toggleApiConfigPin":
      if (message.text) {
        const currentPinned = getGlobalState("pinnedApiConfigs") ?? {};
        const updatedPinned: Record<string, boolean> = { ...currentPinned };

        if (currentPinned[message.text]) {
          delete updatedPinned[message.text];
        } else {
          updatedPinned[message.text] = true;
        }

        await updateGlobalState("pinnedApiConfigs", updatedPinned);
        await provider.debouncedPostStateToWebview();
      }
      break;
    case "enhancementApiConfigId":
      await updateGlobalState("enhancementApiConfigId", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change start - commitMessageApiConfigId
    case "commitMessageApiConfigId":
      await updateGlobalState("commitMessageApiConfigId", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end - commitMessageApiConfigId
    // kade_change start - terminalCommandApiConfigId
    case "terminalCommandApiConfigId":
      await updateGlobalState("terminalCommandApiConfigId", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end - terminalCommandApiConfigId
    // kade_change start - ghostServiceSettings
    case "ghostServiceSettings":
      if (!message.values) {
        return;
      }
      // Validate ghostServiceSettings structure
      const ghostServiceSettings = ghostServiceSettingsSchema.parse(
        message.values,
      );
      await updateGlobalState("ghostServiceSettings", ghostServiceSettings);
      await provider.debouncedPostStateToWebview();
      vscode.commands.executeCommand("kilo-code.ghost.reload");
      break;
    case "snoozeAutocomplete":
      if (typeof message.value === "number" && message.value > 0) {
        await GhostServiceManager.getInstance()?.snooze(message.value);
      } else {
        await GhostServiceManager.getInstance()?.unsnooze();
      }
      break;
    // kade_change end
    // kade_change start: AI gatekeeper for YOLO mode
    case "yoloGatekeeperApiConfigId":
      await updateGlobalState("yoloGatekeeperApiConfigId", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end
    case "updateCondensingPrompt":
      // Store the condensing prompt in customSupportPrompts["CONDENSE"]
      // instead of customCondensingPrompt.
      const currentSupportPrompts =
        getGlobalState("customSupportPrompts") ?? {};
      const updatedSupportPrompts = {
        ...currentSupportPrompts,
        CONDENSE: message.text,
      };
      await updateGlobalState("customSupportPrompts", updatedSupportPrompts);
      // Also update the old field for backward compatibility during migration.
      await updateGlobalState("customCondensingPrompt", message.text);
      await provider.debouncedPostStateToWebview();
      break;
    case "autoApprovalEnabled":
      await updateGlobalState("autoApprovalEnabled", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change start: yolo mode
    case "yoloMode":
      await updateGlobalState("yoloMode", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    // kade_change end
    case "enhancePrompt":
      if (message.text) {
        try {
          const state = await provider.getState();

          const {
            apiConfiguration,
            customSupportPrompts,
            listApiConfigMeta = [],
            enhancementApiConfigId,
            includeTaskHistoryInEnhance,
          } = state;

          const currentCline = provider.getCurrentTask();

          const result = await MessageEnhancer.enhanceMessage({
            text: message.text,
            apiConfiguration,
            customSupportPrompts,
            listApiConfigMeta,
            enhancementApiConfigId,
            includeTaskHistoryInEnhance,
            currentClineMessages: currentCline?.clineMessages,
            providerSettingsManager: provider.providerSettingsManager,
          });

          if (result.success && result.enhancedText) {
            MessageEnhancer.captureTelemetry(
              currentCline?.taskId,
              includeTaskHistoryInEnhance,
            );
            await provider.postMessageToWebview({
              type: "enhancedPrompt",
              text: result.enhancedText,
            });
          } else {
            throw new Error(result.error || "Unknown error");
          }
        } catch (error) {
          provider.log(
            `Error enhancing prompt: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );

          TelemetryService.instance.captureException(error, {
            context: "enhance_prompt",
          }); // kade_change
          vscode.window.showErrorMessage(t("common:errors.enhance_prompt"));
          await provider.postMessageToWebview({ type: "enhancedPrompt" });
        }
      }
      break;
    case "getSystemPrompt":
      try {
        const systemPrompt = await generateSystemPrompt(provider, message);

        await provider.postMessageToWebview({
          type: "systemPrompt",
          text: systemPrompt,
          mode: message.mode,
        });
      } catch (error) {
        provider.log(
          `Error getting system prompt:  ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(t("common:errors.get_system_prompt"));
      }
      break;
    case "copySystemPrompt":
      try {
        const systemPrompt = await generateSystemPrompt(provider, message);

        await vscode.env.clipboard.writeText(systemPrompt);
        await vscode.window.showInformationMessage(
          t("common:info.clipboard_copy"),
        );
      } catch (error) {
        provider.log(
          `Error getting system prompt:  ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(t("common:errors.get_system_prompt"));
      }
      break;
    case "searchCommits": {
      const cwd = getCurrentCwd();
      if (cwd) {
        try {
          const commits = await searchCommits(message.query || "", cwd);
          await provider.postMessageToWebview({
            type: "commitSearchResults",
            commits,
          });
        } catch (error) {
          provider.log(
            `Error searching commits: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
          vscode.window.showErrorMessage(t("common:errors.search_commits"));
        }
      }
      break;
    }
    // kade_change start
    case "showFeedbackOptions": {
      const githubIssuesText = t("common:feedback.githubIssues");
      const discordText = t("common:feedback.discord");
      const customerSupport = t("common:feedback.customerSupport");

      const answer = await vscode.window.showInformationMessage(
        t("common:feedback.description"),
        { modal: true },
        githubIssuesText,
        discordText,
        customerSupport,
      );

      if (answer === githubIssuesText) {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://github.com/Kilo-Org/kilocode/issues"),
        );
      } else if (answer === discordText) {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://discord.gg/fxrhCFGhkP"),
        );
      } else if (answer === customerSupport) {
        await vscode.env.openExternal(vscode.Uri.parse(getAppUrl("/support")));
      }
      break;
    }
    // kade_change end
    case "searchFiles": {
      const workspacePath = getCurrentCwd();

      if (!workspacePath) {
        // Handle case where workspace path is not available
        await provider.postMessageToWebview({
          type: "fileSearchResults",
          results: [],
          requestId: message.requestId,
          error: "No workspace path available",
        });
        break;
      }
      try {
        // Call file search service with query from message
        const results = await searchWorkspaceFiles(
          message.query || "",
          workspacePath,
          20, // Use default limit, as filtering is now done in the backend
        );

        // Send results back to webview
        await provider.postMessageToWebview({
          type: "fileSearchResults",
          results,
          requestId: message.requestId,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Send error response to webview
        await provider.postMessageToWebview({
          type: "fileSearchResults",
          results: [],
          error: errorMessage,
          requestId: message.requestId,
        });
      }
      break;
    }
    case "updateTodoList": {
      const payload = message.payload as { todos?: any[] };
      const todos = payload?.todos;
      if (Array.isArray(todos)) {
        await setPendingTodoList(todos);
      }
      break;
    }
    case "saveApiConfiguration":
      if (message.text && message.apiConfiguration) {
        try {
          await provider.providerSettingsManager.saveConfig(
            message.text,
            message.apiConfiguration,
          );
          const listApiConfig =
            await provider.providerSettingsManager.listConfig();
          await updateGlobalState("listApiConfigMeta", listApiConfig);
          vscode.commands.executeCommand("kilo-code.ghost.reload"); // kade_change: Reload ghost model when API provider settings change
        } catch (error) {
          provider.log(
            `Error save api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
          vscode.window.showErrorMessage(t("common:errors.save_api_config"));
        }
      }
      break;
    case "upsertApiConfiguration":
      // kade_change start: check for kilocodeToken change to remove organizationId and fetch organization modes
      if (message.text && message.apiConfiguration) {
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] ====== UPSERT CONFIG ======`)
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Profile name: "${message.text}"`)
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Scope: "${message.scope || "NONE (default global)"}"`)
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] apiProvider: ${message.apiConfiguration.apiProvider}`)
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] model: ${message.apiConfiguration.apiModelId || message.apiConfiguration.openRouterModelId || (message.apiConfiguration as any).kilocodeModel || "NONE"}`)

        let configToSave = message.apiConfiguration;
        let organizationChanged = false;

        try {
          const { ...currentConfig } =
            await provider.providerSettingsManager.getProfile({
              name: message.text,
            });
          // Only clear organization ID if we actually had a kilocode token before and it's different now
          const hadPreviousToken = currentConfig.kilocodeToken !== undefined;
          const hasNewToken =
            message.apiConfiguration.kilocodeToken !== undefined;
          const tokensAreDifferent =
            currentConfig.kilocodeToken !==
            message.apiConfiguration.kilocodeToken;

          if (hadPreviousToken && hasNewToken && tokensAreDifferent) {
            configToSave = {
              ...message.apiConfiguration,
              kilocodeOrganizationId: undefined,
            };
            await updateGlobalState(
              "hasPerformedOrganizationAutoSwitch",
              undefined,
            );
          }

          organizationChanged =
            currentConfig.kilocodeOrganizationId !==
            message.apiConfiguration.kilocodeOrganizationId;

          if (organizationChanged) {
            // Fetch organization-specific custom modes
            await refreshOrganizationModes(
              message,
              provider,
              updateGlobalState,
            );

            // Flush and refetch models
            await flushModels("kilocode");
            const models = await getModels({
              provider: "kilocode",
              kilocodeOrganizationId:
                message.apiConfiguration.kilocodeOrganizationId,
              kilocodeToken: message.apiConfiguration.kilocodeToken,
            });
            provider.postMessageToWebview({
              type: "routerModels",
              routerModels: { kilocode: models } as Record<
                RouterName,
                ModelRecord
              >,
            });
          }
        } catch (error) {
          // Config might not exist yet, that's fine
        }

        // kade_change start: If we're updating the active profile, we need to activate it to ensure it's persisted
        const currentApiConfigName = getGlobalState("currentApiConfigName");
        const isActiveProfile = message.text === currentApiConfigName;
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] currentApiConfigName (global): "${currentApiConfigName}"`)
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] isActiveProfile: ${isActiveProfile}`)

        // kade_change: Sync the active task's configuration with the new profile settings
        const currentTask = provider.getCurrentTask();
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Has currentTask: ${!!currentTask}`)
        if (currentTask) {
          // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Current task ID: ${currentTask.taskId}`)
          // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Current task apiProvider: ${currentTask.apiConfiguration?.apiProvider}`)
        }

        if (currentTask && (isActiveProfile || message.scope === "task")) {
          // Use updateApiConfiguration to ensure the internal AI handler is rebuilt
          // and the changes are reflected in execution immediately.
          // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] Updating task-local config (task ${currentTask.taskId})`)
          currentTask.updateApiConfiguration({
            ...currentTask.apiConfiguration,
            ...configToSave,
          });
        }

        if (message.scope !== "task") {
          // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] >>> SAVING TO GLOBAL PROFILE (scope is NOT task) <<<`)
          await provider.upsertProviderProfile(
            message.text,
            configToSave,
            isActiveProfile,
          ); // Activate if it's the current active profile
        } else {
          // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] >>> SAVING TO TASK-LOCAL HISTORY (scope is "task") <<<`)
          // Persist task-local config through the provider so disk-backed task history stays authoritative.
          // Writing the full taskHistory array into globalState here regresses the storage migration and
          // causes VS Code's extension state to balloon again as chat count grows.
          if (currentTask) {
            const history = provider.getTaskHistory();
            const taskHistoryItem = history.find(
              (item) => item.id === currentTask.taskId,
            );
            if (taskHistoryItem) {
              await provider.updateTaskHistory({
                ...taskHistoryItem,
                apiConfiguration: {
                  ...currentTask.apiConfiguration,
                  ...configToSave,
                },
              } as any);
            }
          }
        }
        vscode.commands.executeCommand("kilo-code.ghost.reload");
        // provider.log(`[PERSISTENCE_DEBUG][upsertApiConfiguration] ====== UPSERT COMPLETE ======`)
        // kade_change end
      }
      // kade_change end: check for kilocodeToken change to remove organizationId and fetch organization modes
      break;
    case "renameApiConfiguration":
      if (message.values && message.apiConfiguration) {
        try {
          const { oldName, newName } = message.values;

          if (oldName === newName) {
            break;
          }

          // Load the old configuration to get its ID.
          const { id } = await provider.providerSettingsManager.getProfile({
            name: oldName,
          });

          // Create a new configuration with the new name and old ID.
          await provider.providerSettingsManager.saveConfig(newName, {
            ...message.apiConfiguration,
            id,
          });

          // Delete the old configuration.
          await provider.providerSettingsManager.deleteConfig(oldName);

          // Re-activate to update the global settings related to the
          // currently activated provider profile.
          await provider.activateProviderProfile({ name: newName });

          // kade_change: Reload ghost model when API provider settings change
          vscode.commands.executeCommand("kilo-code.ghost.reload");
        } catch (error) {
          provider.log(
            `Error rename api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );

          vscode.window.showErrorMessage(t("common:errors.rename_api_config"));
        }
      }
      break;
    case "loadApiConfiguration":
      if (message.text) {
        try {
          await provider.activateProviderProfile({ name: message.text });
        } catch (error) {
          provider.log(
            `Error load api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
          vscode.window.showErrorMessage(t("common:errors.load_api_config"));
        }
      }
      break;
    case "loadApiConfigurationById":
      if (message.text) {
        try {
          await provider.activateProviderProfile({ id: message.text });
        } catch (error) {
          provider.log(
            `Error load api configuration by ID: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
          vscode.window.showErrorMessage(t("common:errors.load_api_config"));
        }
      }
      break;
    // kade_change start: Load profile configuration for editing without activating
    case "getProfileConfigurationForEditing":
      if (message.text) {
        const { name: _, ...profileConfig } =
          await provider.providerSettingsManager.getProfile({
            name: message.text,
          });
        // Send the configuration back to the webview without activating it
        await provider.postMessageToWebview({
          type: "profileConfigurationForEditing",
          text: message.text,
          apiConfiguration: profileConfig,
        });
      }
      break;
    // kade_change end
    case "deleteApiConfiguration":
      if (message.text) {
        const answer = await vscode.window.showInformationMessage(
          t("common:confirmation.delete_config_profile"),
          { modal: true },
          t("common:answers.yes"),
        );

        if (answer !== t("common:answers.yes")) {
          break;
        }

        const oldName = message.text;

        const newName = (
          await provider.providerSettingsManager.listConfig()
        ).filter((c) => c.name !== oldName)[0]?.name;

        if (!newName) {
          vscode.window.showErrorMessage(t("common:errors.delete_api_config"));
          return;
        }

        try {
          await provider.providerSettingsManager.deleteConfig(oldName);
          await provider.activateProviderProfile({ name: newName });

          // kade_change: Reload ghost model when API provider settings change
          vscode.commands.executeCommand("kilo-code.ghost.reload");
        } catch (error) {
          provider.log(
            `Error delete api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );

          vscode.window.showErrorMessage(t("common:errors.delete_api_config"));
        }
      }
      break;
    case "deleteMessageConfirm":
      if (!message.messageTs) {
        await vscode.window.showErrorMessage(
          t("common:errors.message.cannot_delete_missing_timestamp"),
        );
        break;
      }

      if (typeof message.messageTs !== "number") {
        await vscode.window.showErrorMessage(
          t("common:errors.message.cannot_delete_invalid_timestamp"),
        );
        break;
      }

      await handleDeleteMessageConfirm(
        message.messageTs,
        message.restoreCheckpoint,
      );
      break;
    case "editMessageConfirm":
      if (message.messageTs && message.text) {
        await handleEditMessageConfirm(
          message.messageTs,
          message.text,
          message.restoreCheckpoint,
          message.images,
        );
      }
      break;
    case "getListApiConfiguration":
      try {
        const listApiConfig =
          await provider.providerSettingsManager.listConfig();
        await updateGlobalState("listApiConfigMeta", listApiConfig);
        provider.postMessageToWebview({ type: "listApiConfig", listApiConfig });
      } catch (error) {
        provider.log(
          `Error get list api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(t("common:errors.list_api_config"));
      }
      break;

    case "updateMcpTimeout":
      if (message.serverName && typeof message.timeout === "number") {
        try {
          await provider
            .getMcpHub()
            ?.updateServerTimeout(
              message.serverName,
              message.timeout,
              message.source as "global" | "project",
            );
        } catch (error) {
          provider.log(
            `Failed to update timeout for ${message.serverName}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
          );
          vscode.window.showErrorMessage(
            t("common:errors.update_server_timeout"),
          );
        }
      }
      break;
    case "updateCustomMode":
      if (message.modeConfig) {
        try {
          // Check if this is a new mode or an update to an existing mode
          const existingModes = provider.customModesManager
            ? await provider.customModesManager.getCustomModes()
            : [];
          const isNewMode = !existingModes.some(
            (mode) => mode.slug === message.modeConfig?.slug,
          );

          await provider.customModesManager.updateCustomMode(
            message.modeConfig.slug,
            message.modeConfig,
          );
          // Update state after saving the mode
          const customModes = provider.customModesManager
            ? await provider.customModesManager.getCustomModes()
            : [];
          await updateGlobalState("customModes", customModes);
          await updateGlobalState("mode", message.modeConfig.slug);
          await provider.debouncedPostStateToWebview();

          // Track telemetry for custom mode creation or update
          if (TelemetryService.hasInstance()) {
            if (isNewMode) {
              // This is a new custom mode
              TelemetryService.instance.captureCustomModeCreated(
                message.modeConfig.slug,
                message.modeConfig.name,
              );
            } else {
              // Determine which setting was changed by comparing objects
              const existingMode = existingModes.find(
                (mode) => mode.slug === message.modeConfig?.slug,
              );
              const changedSettings = existingMode
                ? Object.keys(message.modeConfig).filter(
                    (key) =>
                      JSON.stringify(
                        (existingMode as Record<string, unknown>)[key],
                      ) !==
                      JSON.stringify(
                        (message.modeConfig as Record<string, unknown>)[key],
                      ),
                  )
                : [];

              if (changedSettings.length > 0) {
                TelemetryService.instance.captureModeSettingChanged(
                  changedSettings[0],
                );
              }
            }
          }
        } catch (error) {
          // Error already shown to user by updateCustomMode
          // Just prevent unhandled rejection and skip state updates
        }
      }
      break;
    case "deleteCustomMode":
      if (message.slug) {
        if (!provider.customModesManager) {
          return;
        }
        // Get the mode details to determine source and rules folder path
        const customModes = await provider.customModesManager.getCustomModes();
        const modeToDelete = customModes.find(
          (mode) => mode.slug === message.slug,
        );

        if (!modeToDelete) {
          break;
        }

        // Determine the scope based on source (project or global)
        const scope = modeToDelete.source || "global";

        // Determine the rules folder path
        let rulesFolderPath: string;
        if (scope === "project") {
          const workspacePath = getWorkspacePath();
          if (workspacePath) {
            rulesFolderPath = path.join(
              workspacePath,
              ".roo",
              `rules-${message.slug}`,
            );
          } else {
            rulesFolderPath = path.join(".roo", `rules-${message.slug}`);
          }
        } else {
          // Global scope - use OS home directory
          const homeDir = os.homedir();
          rulesFolderPath = path.join(homeDir, ".roo", `rules-${message.slug}`);
        }

        // Check if the rules folder exists
        const rulesFolderExists = await fileExistsAtPath(rulesFolderPath);

        // If this is a check request, send back the folder info
        if (message.checkOnly) {
          await provider.postMessageToWebview({
            type: "deleteCustomModeCheck",
            slug: message.slug,
            rulesFolderPath: rulesFolderExists ? rulesFolderPath : undefined,
          });
          break;
        }

        // Delete the mode
        await provider.customModesManager.deleteCustomMode(message.slug);

        // Delete the rules folder if it exists
        if (rulesFolderExists) {
          try {
            await fs.rm(rulesFolderPath, { recursive: true, force: true });
            provider.log(
              `Deleted rules folder for mode ${message.slug}: ${rulesFolderPath}`,
            );
          } catch (error) {
            provider.log(
              `Failed to delete rules folder for mode ${message.slug}: ${error}`,
            );
            // Notify the user about the failure
            vscode.window.showErrorMessage(
              t("common:errors.delete_rules_folder_failed", {
                rulesFolderPath,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            // Continue with mode deletion even if folder deletion fails
          }
        }

        // Switch back to default mode after deletion
        await updateGlobalState("mode", defaultModeSlug);
        await provider.debouncedPostStateToWebview();
      }
      break;
    case "exportMode":
      if (message.slug) {
        try {
          // Get custom mode prompts to check if built-in mode has been customized
          const customModePrompts = getGlobalState("customModePrompts") || {};
          const customPrompt = customModePrompts[message.slug];

          // Export the mode with any customizations merged directly
          const result = await provider.customModesManager.exportModeWithRules(
            message.slug,
            customPrompt,
          );

          if (result.success && result.yaml) {
            // Get last used directory for export
            const lastExportPath = getGlobalState("lastModeExportPath");
            let defaultUri: vscode.Uri;

            if (lastExportPath) {
              // Use the directory from the last export
              const lastDir = path.dirname(lastExportPath);
              defaultUri = vscode.Uri.file(
                path.join(lastDir, `${message.slug}-export.yaml`),
              );
            } else {
              // Default to workspace or home directory
              const workspaceFolders = vscode.workspace.workspaceFolders;
              if (workspaceFolders && workspaceFolders.length > 0) {
                defaultUri = vscode.Uri.file(
                  path.join(
                    workspaceFolders[0].uri.fsPath,
                    `${message.slug}-export.yaml`,
                  ),
                );
              } else {
                defaultUri = vscode.Uri.file(`${message.slug}-export.yaml`);
              }
            }

            // Show save dialog
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri,
              filters: {
                "YAML files": ["yaml", "yml"],
              },
              title: "Save mode export",
            });

            if (saveUri && result.yaml) {
              // Save the directory for next time
              await updateGlobalState("lastModeExportPath", saveUri.fsPath);

              // Write the file to the selected location
              await fs.writeFile(saveUri.fsPath, result.yaml, "utf-8");

              // Send success message to webview
              provider.postMessageToWebview({
                type: "exportModeResult",
                success: true,
                slug: message.slug,
              });

              // Show info message
              vscode.window.showInformationMessage(
                t("common:info.mode_exported", { mode: message.slug }),
              );
            } else {
              // User cancelled the save dialog
              provider.postMessageToWebview({
                type: "exportModeResult",
                success: false,
                error: "Export cancelled",
                slug: message.slug,
              });
            }
          } else {
            // Send error message to webview
            provider.postMessageToWebview({
              type: "exportModeResult",
              success: false,
              error: result.error,
              slug: message.slug,
            });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          provider.log(
            `Failed to export mode ${message.slug}: ${errorMessage}`,
          );

          // Send error message to webview
          provider.postMessageToWebview({
            type: "exportModeResult",
            success: false,
            error: errorMessage,
            slug: message.slug,
          });
        }
      }
      break;
    case "importMode":
      try {
        // Get last used directory for import
        const lastImportPath = getGlobalState("lastModeImportPath");
        let defaultUri: vscode.Uri | undefined;

        if (lastImportPath) {
          // Use the directory from the last import
          const lastDir = path.dirname(lastImportPath);
          defaultUri = vscode.Uri.file(lastDir);
        } else {
          // Default to workspace or home directory
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            defaultUri = vscode.Uri.file(workspaceFolders[0].uri.fsPath);
          }
        }

        // Show file picker to select YAML file
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          defaultUri,
          filters: {
            "YAML files": ["yaml", "yml"],
          },
          title: "Select mode export file to import",
        });

        if (fileUri && fileUri[0]) {
          // Save the directory for next time
          await updateGlobalState("lastModeImportPath", fileUri[0].fsPath);

          // Read the file content
          const yamlContent = await fs.readFile(fileUri[0].fsPath, "utf-8");

          // Import the mode with the specified source level
          const result = await provider.customModesManager.importModeWithRules(
            yamlContent,
            message.source || "project", // Default to project if not specified
          );

          if (result.success) {
            // Update state after importing
            const customModes =
              await provider.customModesManager.getCustomModes();
            await updateGlobalState("customModes", customModes);
            await provider.debouncedPostStateToWebview();

            // Send success message to webview, include the imported slug so UI can switch
            provider.postMessageToWebview({
              type: "importModeResult",
              success: true,
              slug: result.slug,
            });

            // Show success message
            vscode.window.showInformationMessage(
              t("common:info.mode_imported"),
            );
          } else {
            // Send error message to webview
            provider.postMessageToWebview({
              type: "importModeResult",
              success: false,
              error: result.error,
            });

            // Show error message
            vscode.window.showErrorMessage(
              t("common:errors.mode_import_failed", { error: result.error }),
            );
          }
        } else {
          // User cancelled the file dialog - reset the importing state
          provider.postMessageToWebview({
            type: "importModeResult",
            success: false,
            error: "cancelled",
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.log(`Failed to import mode: ${errorMessage}`);

        // Send error message to webview
        provider.postMessageToWebview({
          type: "importModeResult",
          success: false,
          error: errorMessage,
        });

        // Show error message
        vscode.window.showErrorMessage(
          t("common:errors.mode_import_failed", { error: errorMessage }),
        );
      }
      break;
    case "checkRulesDirectory":
      if (message.slug) {
        const hasContent =
          await provider.customModesManager.checkRulesDirectoryHasContent(
            message.slug,
          );

        provider.postMessageToWebview({
          type: "checkRulesDirectoryResult",
          slug: message.slug,
          hasContent: hasContent,
        });
      }
      break;
    case "humanRelayResponse":
      if (message.requestId && message.text) {
        vscode.commands.executeCommand(getCommand("handleHumanRelayResponse"), {
          requestId: message.requestId,
          text: message.text,
          cancelled: false,
        });
      }
      break;

    case "humanRelayCancel":
      if (message.requestId) {
        vscode.commands.executeCommand(getCommand("handleHumanRelayResponse"), {
          requestId: message.requestId,
          cancelled: true,
        });
      }
      break;

    // kade_change_start
    case "fetchProfileDataRequest":
      try {
        const { apiConfiguration, currentApiConfigName } =
          await provider.getState();
        const kilocodeToken = apiConfiguration?.kilocodeToken;

        if (!kilocodeToken) {
          provider.log("KiloCode token not found in extension state.");
          provider.postMessageToWebview({
            type: "profileDataResponse",
            payload: {
              success: false,
              error: "KiloCode API token not configured.",
            },
          });
          break;
        }

        // Changed to /api/profile
        const headers: Record<string, string> = {
          Authorization: `Bearer ${kilocodeToken}`,
          "Content-Type": "application/json",
        };

        // Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
        if (
          apiConfiguration.kilocodeTesterWarningsDisabledUntil &&
          apiConfiguration.kilocodeTesterWarningsDisabledUntil > Date.now()
        ) {
          headers["X-KILOCODE-TESTER"] = "SUPPRESS";
        }

        const url = getKiloUrlFromToken(
          "https://api.kilo.ai/api/profile",
          kilocodeToken,
        );
        const response = await axios.get<Omit<ProfileData, "kilocodeToken">>(
          url,
          { headers },
        );

        // Go back to Personal when no longer part of the current set organization
        const organizationExists = (response.data.organizations ?? []).some(
          ({ id }) => id === apiConfiguration?.kilocodeOrganizationId,
        );
        if (apiConfiguration?.kilocodeOrganizationId && !organizationExists) {
          provider.upsertProviderProfile(currentApiConfigName ?? "default", {
            ...apiConfiguration,
            kilocodeOrganizationId: undefined,
          });
        }

        try {
          // Skip auto-switch in YOLO mode (cloud agents, CI) to prevent usage billing issues
          const shouldAutoSwitch =
            !getGlobalState("yoloMode") &&
            response.data.organizations &&
            response.data.organizations.length > 0 &&
            !apiConfiguration.kilocodeOrganizationId &&
            !getGlobalState("hasPerformedOrganizationAutoSwitch");

          if (shouldAutoSwitch) {
            const firstOrg = response.data.organizations![0];
            provider.log(
              `[Auto-switch] Performing automatic organization switch to: ${firstOrg.name} (${firstOrg.id})`,
            );

            const upsertMessage: WebviewMessage = {
              type: "upsertApiConfiguration",
              text: currentApiConfigName ?? "default",
              apiConfiguration: {
                ...apiConfiguration,
                kilocodeOrganizationId: firstOrg.id,
              },
            };

            await webviewMessageHandler(provider, upsertMessage);
            await updateGlobalState("hasPerformedOrganizationAutoSwitch", true);

            vscode.window.showInformationMessage(
              `Automatically switched to organization: ${firstOrg.name}`,
            );

            provider.log(
              `[Auto-switch] Successfully switched to organization: ${firstOrg.name}`,
            );
          }
        } catch (error) {
          provider.log(
            `[Auto-switch] Error during automatic organization switch: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        provider.postMessageToWebview({
          type: "profileDataResponse",
          payload: { success: true, data: { kilocodeToken, ...response.data } },
        });
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          "Failed to fetch general profile data from backend.";
        provider.log(`Error fetching general profile data: ${errorMessage}`);
        provider.postMessageToWebview({
          type: "profileDataResponse",
          payload: { success: false, error: errorMessage },
        });
      }
      break;
    case "fetchBalanceDataRequest": // New handler
      try {
        const { apiConfiguration } = await provider.getState();
        const { kilocodeToken, kilocodeOrganizationId } =
          apiConfiguration ?? {};

        if (!kilocodeToken) {
          provider.log(
            "KiloCode token not found in extension state for balance data.",
          );
          provider.postMessageToWebview({
            type: "balanceDataResponse", // New response type
            payload: {
              success: false,
              error: "KiloCode API token not configured.",
            },
          });
          break;
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${kilocodeToken}`,
          "Content-Type": "application/json",
        };

        if (kilocodeOrganizationId) {
          headers["X-KiloCode-OrganizationId"] = kilocodeOrganizationId;
        }

        // Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
        if (
          apiConfiguration.kilocodeTesterWarningsDisabledUntil &&
          apiConfiguration.kilocodeTesterWarningsDisabledUntil > Date.now()
        ) {
          headers["X-KILOCODE-TESTER"] = "SUPPRESS";
        }

        const url = getKiloUrlFromToken(
          "https://api.kilo.ai/api/profile/balance",
          kilocodeToken,
        );
        const response = await axios.get(url, { headers });
        provider.postMessageToWebview({
          type: "balanceDataResponse", // New response type
          payload: { success: true, data: response.data },
        });
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          "Failed to fetch balance data from backend.";
        provider.log(`Error fetching balance data: ${errorMessage}`);
        provider.postMessageToWebview({
          type: "balanceDataResponse", // New response type
          payload: { success: false, error: errorMessage },
        });
      }
      break;
    case "shopBuyCredits": // New handler
      try {
        const { apiConfiguration } = await provider.getState();
        const kilocodeToken = apiConfiguration?.kilocodeToken;
        if (!kilocodeToken) {
          provider.log(
            "KiloCode token not found in extension state for buy credits.",
          );
          break;
        }
        const credits = message.values?.credits || 50;
        const uriScheme = message.values?.uriScheme || "vscode";
        const uiKind = message.values?.uiKind || "Desktop";
        const source = uiKind === "Web" ? "web" : uriScheme;

        const url = getKiloUrlFromToken(
          `https://api.kilo.ai/payments/topup?origin=extension&source=${source}&amount=${credits}`,
          kilocodeToken,
        );
        const response = await axios.post(
          url,
          {},
          {
            headers: {
              Authorization: `Bearer ${kilocodeToken}`,
              "Content-Type": "application/json",
            },
            maxRedirects: 0, // Prevent axios from following redirects automatically
            validateStatus: (status) => status < 400, // Accept 3xx status codes
          },
        );
        if (response.status !== 303 || !response.headers.location) {
          return;
        }
        await vscode.env.openExternal(
          vscode.Uri.parse(response.headers.location),
        );
      } catch (error: any) {
        const errorMessage = error?.message || "Unknown error";
        const errorStack = error?.stack ? ` Stack: ${error.stack}` : "";
        provider.log(
          `Error redirecting to payment page: ${errorMessage}.${errorStack}`,
        );
        provider.postMessageToWebview({
          type: "updateProfileData",
        });
      }
      break;

    case "fetchMcpMarketplace": {
      await provider.fetchMcpMarketplace(message.bool);
      break;
    }

    case "downloadMcp": {
      if (message.mcpId) {
        await provider.downloadMcp(message.mcpId);
      }
      break;
    }

    case "silentlyRefreshMcpMarketplace": {
      await provider.silentlyRefreshMcpMarketplace();
      break;
    }

    case "toggleWorkflow": {
      if (
        message.workflowPath &&
        typeof message.enabled === "boolean" &&
        typeof message.isGlobal === "boolean"
      ) {
        await toggleWorkflow(
          message.workflowPath,
          message.enabled,
          message.isGlobal,
          provider.contextProxy,
          provider.context,
        );
        await provider.postRulesDataToWebview();
      }
      break;
    }

    case "refreshRules": {
      await provider.postRulesDataToWebview();
      break;
    }

    case "toggleRule": {
      if (
        message.rulePath &&
        typeof message.enabled === "boolean" &&
        typeof message.isGlobal === "boolean"
      ) {
        await toggleRule(
          message.rulePath,
          message.enabled,
          message.isGlobal,
          provider.contextProxy,
          provider.context,
        );
        await provider.postRulesDataToWebview();
      }
      break;
    }

    case "createRuleFile": {
      if (
        message.filename &&
        typeof message.isGlobal === "boolean" &&
        (message.ruleType === "rule" || message.ruleType === "workflow")
      ) {
        try {
          await createRuleFile(
            message.filename,
            message.isGlobal,
            message.ruleType,
          );
        } catch (error) {
          console.error("Error creating rule file:", error);
          vscode.window.showErrorMessage(
            t("kilocode:rules.errors.failedToCreateRuleFile"),
          );
        }
        await provider.postRulesDataToWebview();
      }
      break;
    }

    case "deleteRuleFile": {
      if (message.rulePath) {
        try {
          await deleteRuleFile(message.rulePath);
        } catch (error) {
          console.error("Error deleting rule file:", error);
          vscode.window.showErrorMessage(
            t("kilocode:rules.errors.failedToDeleteRuleFile"),
          );
        }
        await provider.postRulesDataToWebview();
      }
      break;
    }

    case "reportBug":
      provider.getCurrentTask()?.handleWebviewAskResponse("yesButtonClicked");
      break;
    // end kade_change
    case "telemetrySetting": {
      const telemetrySetting = message.text as TelemetrySetting;
      const previousSetting = getGlobalState("telemetrySetting") || "unset";
      const isOptedIn = telemetrySetting !== "disabled";
      const wasPreviouslyOptedIn = previousSetting !== "disabled";

      // If turning telemetry OFF, fire event BEFORE disabling
      if (
        wasPreviouslyOptedIn &&
        !isOptedIn &&
        TelemetryService.hasInstance()
      ) {
        TelemetryService.instance.captureTelemetrySettingsChanged(
          previousSetting,
          telemetrySetting,
        );
      }

      // Update the telemetry state
      await updateGlobalState("telemetrySetting", telemetrySetting);

      // If telemetry is set (enabled or disabled), we can also dismiss all first install banners
      // to avoid redundancy, as the carousel is tied to "unset" state in EmptyState.tsx
      if (telemetrySetting !== "unset") {
        const currentDismissed = getGlobalState("dismissedUpsells") || [];
        const firstInstallUpsells = [
          "welcome",
          "provider",
          "toolProtocol",
          "telemetry",
        ].map((id) => `first_install_${id}`);
        const updatedDismissed = Array.from(
          new Set([...currentDismissed, ...firstInstallUpsells]),
        );
        await updateGlobalState("dismissedUpsells", updatedDismissed);
      }

      if (TelemetryService.hasInstance()) {
        TelemetryService.instance.updateTelemetryState(isOptedIn);
      }

      // If turning telemetry ON, fire event AFTER enabling
      if (
        !wasPreviouslyOptedIn &&
        isOptedIn &&
        TelemetryService.hasInstance()
      ) {
        TelemetryService.instance.captureTelemetrySettingsChanged(
          previousSetting,
          telemetrySetting,
        );
      }

      TelemetryService.instance.updateTelemetryState(isOptedIn);
      await provider.debouncedPostStateToWebview();
      break;
    }
    case "cloudButtonClicked": {
      // Navigate to the cloud tab.
      provider.postMessageToWebview({
        type: "action",
        action: "cloudButtonClicked",
      });
      break;
    }
    case "rooCloudSignIn": {
      try {
        TelemetryService.instance.captureEvent(
          TelemetryEventName.AUTHENTICATION_INITIATED,
        );
        // Use provider signup flow if useProviderSignup is explicitly true
        await CloudService.instance.login(
          undefined,
          message.useProviderSignup ?? false,
        );
      } catch (error) {
        provider.log(`AuthService#login failed: ${error}`);
        vscode.window.showErrorMessage("Sign in failed.");
      }

      break;
    }
    case "cloudLandingPageSignIn": {
      try {
        const landingPageSlug = message.text || "supernova";
        TelemetryService.instance.captureEvent(
          TelemetryEventName.AUTHENTICATION_INITIATED,
        );
        await CloudService.instance.login(landingPageSlug);
      } catch (error) {
        provider.log(`CloudService#login failed: ${error}`);
        vscode.window.showErrorMessage("Sign in failed.");
      }
      break;
    }
    case "rooCloudSignOut": {
      try {
        await CloudService.instance.logout();
        New: provider.postMessageToWebview({
          type: "authenticatedUser",
          userInfo: undefined,
        });
      } catch (error) {
        provider.log(`AuthService#logout failed: ${error}`);
        vscode.window.showErrorMessage("Sign out failed.");
      }

      break;
    }
    case "rooCloudManualUrl": {
      try {
        if (!message.text) {
          vscode.window.showErrorMessage(t("common:errors.manual_url_empty"));
          break;
        }

        // Parse the callback URL to extract parameters
        const callbackUrl = message.text.trim();
        const uri = vscode.Uri.parse(callbackUrl);

        if (!uri.query) {
          throw new Error(t("common:errors.manual_url_no_query"));
        }

        const query = new URLSearchParams(uri.query);
        const code = query.get("code");
        const state = query.get("state");
        const organizationId = query.get("organizationId");

        if (!code || !state) {
          throw new Error(t("common:errors.manual_url_missing_params"));
        }

        // Reuse the existing authentication flow
        await CloudService.instance.handleAuthCallback(
          code,
          state,
          organizationId === "null" ? null : organizationId,
        );
      } catch (error) {
        provider.log(`ManualUrl#handleAuthCallback failed: ${error}`);
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("common:errors.manual_url_auth_failed");

        // Show error message through VS Code UI
        vscode.window.showErrorMessage(
          `${t("common:errors.manual_url_auth_error")}: ${errorMessage}`,
        );
      }

      break;
    }
    case "switchOrganization": {
      try {
        const organizationId = message.organizationId ?? null;

        // Switch to the new organization context
        await CloudService.instance.switchOrganization(organizationId);

        // Refresh the state to update UI
        await provider.debouncedPostStateToWebview();

        // Send success response back to webview
        await provider.postMessageToWebview({
          type: "organizationSwitchResult",
          success: true,
          organizationId: organizationId,
        });
      } catch (error) {
        provider.log(`Organization switch failed: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Send error response back to webview
        await provider.postMessageToWebview({
          type: "organizationSwitchResult",
          success: false,
          error: errorMessage,
          organizationId: message.organizationId ?? null,
        });

        vscode.window.showErrorMessage(
          `Failed to switch organization: ${errorMessage}`,
        );
      }
      break;
    }

    case "saveCodeIndexSettingsAtomic": {
      if (!message.codeIndexSettings) {
        break;
      }

      const settings = message.codeIndexSettings;

      try {
        // Check if embedder provider has changed
        const currentConfig = getGlobalState("codebaseIndexConfig") || {};
        const embedderProviderChanged =
          currentConfig.codebaseIndexEmbedderProvider !==
          settings.codebaseIndexEmbedderProvider;

        // Save global state settings atomically
        const globalStateConfig = {
          ...currentConfig,
          codebaseIndexEnabled: settings.codebaseIndexEnabled,
          codebaseIndexQdrantUrl: settings.codebaseIndexQdrantUrl,
          codebaseIndexEmbedderProvider: settings.codebaseIndexEmbedderProvider,
          // kade_change start
          codebaseIndexVectorStoreProvider:
            settings.codebaseIndexVectorStoreProvider,
          codebaseIndexLancedbVectorStoreDirectory:
            settings.codebaseIndexLancedbVectorStoreDirectory,
          // kade_change end
          codebaseIndexEmbedderBaseUrl: settings.codebaseIndexEmbedderBaseUrl,
          codebaseIndexEmbedderModelId: settings.codebaseIndexEmbedderModelId,
          codebaseIndexEmbedderModelDimension:
            settings.codebaseIndexEmbedderModelDimension, // Generic dimension
          codebaseIndexOpenAiCompatibleBaseUrl:
            settings.codebaseIndexOpenAiCompatibleBaseUrl,
          codebaseIndexBedrockRegion: settings.codebaseIndexBedrockRegion,
          codebaseIndexBedrockProfile: settings.codebaseIndexBedrockProfile,
          codebaseIndexSearchMaxResults: settings.codebaseIndexSearchMaxResults,
          codebaseIndexSearchMinScore: settings.codebaseIndexSearchMinScore,
          // kade_change start
          codebaseIndexEmbeddingBatchSize:
            settings.codebaseIndexEmbeddingBatchSize,
          codebaseIndexScannerMaxBatchRetries:
            settings.codebaseIndexScannerMaxBatchRetries,
          // kade_change end
          codebaseIndexOpenRouterSpecificProvider:
            settings.codebaseIndexOpenRouterSpecificProvider,
        };

        // Save global state first
        await updateGlobalState("codebaseIndexConfig", globalStateConfig);

        // Save include paths to workspace state (project-specific)
        if (settings.codebaseIndexIncludePaths !== undefined) {
          await provider.context.workspaceState.update(
            "codebaseIndexIncludePaths",
            settings.codebaseIndexIncludePaths,
          );
        }

        // kade_change start: Update the batch size in the running scanner and file watcher
        if (settings.codebaseIndexEmbeddingBatchSize !== undefined) {
          const currentCodeIndexManager =
            provider.getCurrentWorkspaceCodeIndexManager();
          if (currentCodeIndexManager) {
            currentCodeIndexManager.updateBatchSegmentThreshold(
              settings.codebaseIndexEmbeddingBatchSize,
            );
          }
        }
        // kade_change end

        // Save secrets directly using context proxy
        if (settings.codeIndexOpenAiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codeIndexOpenAiKey",
            settings.codeIndexOpenAiKey,
          );
        }
        if (settings.codeIndexQdrantApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codeIndexQdrantApiKey",
            settings.codeIndexQdrantApiKey,
          );
        }
        if (settings.codebaseIndexOpenAiCompatibleApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codebaseIndexOpenAiCompatibleApiKey",
            settings.codebaseIndexOpenAiCompatibleApiKey,
          );
        }
        if (settings.codebaseIndexGeminiApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codebaseIndexGeminiApiKey",
            settings.codebaseIndexGeminiApiKey,
          );
        }
        if (settings.codebaseIndexMistralApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codebaseIndexMistralApiKey",
            settings.codebaseIndexMistralApiKey,
          );
        }
        if (settings.codebaseIndexVercelAiGatewayApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codebaseIndexVercelAiGatewayApiKey",
            settings.codebaseIndexVercelAiGatewayApiKey,
          );
        }
        if (settings.codebaseIndexOpenRouterApiKey !== undefined) {
          await provider.contextProxy.storeSecret(
            "codebaseIndexOpenRouterApiKey",
            settings.codebaseIndexOpenRouterApiKey,
          );
        }

        // Send success response first - settings are saved regardless of validation
        await provider.postMessageToWebview({
          type: "codeIndexSettingsSaved",
          success: true,
          settings: globalStateConfig,
        });

        // Update webview state
        await provider.debouncedPostStateToWebview();

        // Then handle validation and initialization for the current workspace
        const currentCodeIndexManager =
          provider.getCurrentWorkspaceCodeIndexManager();
        if (currentCodeIndexManager) {
          // If embedder provider changed, perform proactive validation
          if (embedderProviderChanged) {
            try {
              // Force handleSettingsChange which will trigger validation
              await currentCodeIndexManager.handleSettingsChange();
            } catch (error) {
              // Validation failed - the error state is already set by handleSettingsChange
              provider.log(
                `Embedder validation failed after provider change: ${error instanceof Error ? error.message : String(error)}`,
              );
              // Send validation error to webview
              await provider.postMessageToWebview({
                type: "indexingStatusUpdate",
                values: currentCodeIndexManager.getCurrentStatus(),
              });
              // Exit early - don't try to start indexing with invalid configuration
              break;
            }
          } else {
            // No provider change, just handle settings normally
            try {
              await currentCodeIndexManager.handleSettingsChange();
            } catch (error) {
              // Log but don't fail - settings are saved
              provider.log(
                `Settings change handling error: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          // Wait a bit more to ensure everything is ready
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Auto-start indexing if now enabled and configured
          if (
            currentCodeIndexManager.isFeatureEnabled &&
            currentCodeIndexManager.isFeatureConfigured
          ) {
            if (!currentCodeIndexManager.isInitialized) {
              try {
                await currentCodeIndexManager.initialize(provider.contextProxy);
                provider.log(
                  `Code index manager initialized after settings save`,
                );
              } catch (error) {
                provider.log(
                  `Code index initialization failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                // Send error status to webview
                await provider.postMessageToWebview({
                  type: "indexingStatusUpdate",
                  values: currentCodeIndexManager.getCurrentStatus(),
                });
              }
            }
          }
        } else {
          // No workspace open - send error status
          provider.log(
            "Cannot save code index settings: No workspace folder open",
          );
          await provider.postMessageToWebview({
            type: "indexingStatusUpdate",
            values: {
              systemStatus: "Error",
              message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
              processedItems: 0,
              totalItems: 0,
              currentItemUnit: "items",
            },
          });
        }
      } catch (error) {
        provider.log(
          `Error saving code index settings: ${error.message || error}`,
        );
        await provider.postMessageToWebview({
          type: "codeIndexSettingsSaved",
          success: false,
          error: error.message || "Failed to save settings",
        });
      }
      break;
    }

    case "requestIndexingStatus": {
      const manager = provider.getCurrentWorkspaceCodeIndexManager();
      if (!manager) {
        // No workspace open - send error status
        provider.postMessageToWebview({
          type: "indexingStatusUpdate",
          values: {
            systemStatus: "Error",
            message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
            processedItems: 0,
            totalItems: 0,
            currentItemUnit: "items",
            workerspacePath: undefined,
          },
        });
        return;
      }

      const status = manager
        ? manager.getCurrentStatus()
        : {
            systemStatus: "Standby",
            message: "No workspace folder open",
            processedItems: 0,
            totalItems: 0,
            currentItemUnit: "items",
            workspacePath: undefined,
          };

      provider.postMessageToWebview({
        type: "indexingStatusUpdate",
        values: status,
      });
      break;
    }
    case "requestCodeIndexSecretStatus": {
      // Check if secrets are set using the VSCode context directly for async access
      const hasOpenAiKey =
        !!(await provider.context.secrets.get("codeIndexOpenAiKey"));
      const hasQdrantApiKey = !!(await provider.context.secrets.get(
        "codeIndexQdrantApiKey",
      ));
      const hasOpenAiCompatibleApiKey = !!(await provider.context.secrets.get(
        "codebaseIndexOpenAiCompatibleApiKey",
      ));
      const hasGeminiApiKey = !!(await provider.context.secrets.get(
        "codebaseIndexGeminiApiKey",
      ));
      const hasMistralApiKey = !!(await provider.context.secrets.get(
        "codebaseIndexMistralApiKey",
      ));
      const hasVercelAiGatewayApiKey = !!(await provider.context.secrets.get(
        "codebaseIndexVercelAiGatewayApiKey",
      ));
      const hasOpenRouterApiKey = !!(await provider.context.secrets.get(
        "codebaseIndexOpenRouterApiKey",
      ));

      provider.postMessageToWebview({
        type: "codeIndexSecretStatus",
        values: {
          hasOpenAiKey,
          hasQdrantApiKey,
          hasOpenAiCompatibleApiKey,
          hasGeminiApiKey,
          hasMistralApiKey,
          hasVercelAiGatewayApiKey,
          hasOpenRouterApiKey,
        },
      });
      break;
    }
    case "startIndexing": {
      try {
        const manager = provider.getCurrentWorkspaceCodeIndexManager();
        if (!manager) {
          // No workspace open - send error status
          provider.postMessageToWebview({
            type: "indexingStatusUpdate",
            values: {
              systemStatus: "Error",
              message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
              processedItems: 0,
              totalItems: 0,
              currentItemUnit: "items",
            },
          });
          provider.log("Cannot start indexing: No workspace folder open");
          return;
        }
        if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
          // Mimic extension startup behavior: initialize first, which will
          // check if Qdrant container is active and reuse existing collection
          await manager.initialize(provider.contextProxy);

          // Only call startIndexing if we're in a state that requires it
          // (e.g., Standby or Error). If already Indexed or Indexing, the
          // initialize() call above will have already started the watcher.
          const currentState = manager.state;
          if (currentState === "Standby" || currentState === "Error") {
            // startIndexing now handles error recovery internally
            manager.startIndexing();

            // If startIndexing recovered from error, we need to reinitialize
            if (!manager.isInitialized) {
              await manager.initialize(provider.contextProxy);
              // Try starting again after initialization
              if (manager.state === "Standby" || manager.state === "Error") {
                manager.startIndexing();
              }
            }
          }
        }
      } catch (error) {
        provider.log(
          `Error starting indexing: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    // kade_change start
    case "cancelIndexing": {
      try {
        const manager = provider.getCurrentWorkspaceCodeIndexManager();
        if (!manager) {
          provider.postMessageToWebview({
            type: "indexingStatusUpdate",
            values: {
              systemStatus: "Error",
              message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
              processedItems: 0,
              totalItems: 0,
              currentItemUnit: "items",
            },
          });
          provider.log("Cannot cancel indexing: No workspace folder open");
          return;
        }
        if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
          manager.cancelIndexing();
          // Immediately reflect updated status to UI
          provider.postMessageToWebview({
            type: "indexingStatusUpdate",
            values: manager.getCurrentStatus(),
          });
        }
      } catch (error) {
        provider.log(
          `Error canceling indexing: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      break;
    }
    // kade_change end
    case "clearIndexData": {
      try {
        const manager = provider.getCurrentWorkspaceCodeIndexManager();
        if (!manager) {
          provider.log("Cannot clear index data: No workspace folder open");
          provider.postMessageToWebview({
            type: "indexCleared",
            values: {
              success: false,
              error: t("embeddings:orchestrator.indexingRequiresWorkspace"),
            },
          });
          return;
        }

        // kade_change start
        // Clear any prior error banner in UI even if config is still invalid.
        manager.clearErrorState();
        provider.postMessageToWebview({
          type: "indexingStatusUpdate",
          values: manager.getCurrentStatus(),
        });
        // kade_change end

        await manager.clearIndexData();
        provider.postMessageToWebview({
          type: "indexCleared",
          values: { success: true },
        });
      } catch (error) {
        provider.log(
          `Error clearing index data: ${error instanceof Error ? error.message : String(error)}`,
        );
        provider.postMessageToWebview({
          type: "indexCleared",
          values: {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      break;
    }
    // kade_change start - add clearUsageData
    case "clearUsageData": {
      try {
        const usageTracker = UsageTracker.getInstance();
        await usageTracker.clearAllUsageData();
        vscode.window.showInformationMessage(
          "Usage data has been successfully cleared.",
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.log(`Error clearing usage data: ${errorMessage}`);
        vscode.window.showErrorMessage(
          `Failed to clear usage data: ${errorMessage}`,
        );
      }
      break;
    }
    // kade_change start - add getUsageData
    case "getUsageData": {
      if (message.text) {
        try {
          const usageTracker = UsageTracker.getInstance();
          const usageData = usageTracker.getAllUsage(message.text);
          await provider.postMessageToWebview({
            type: "usageDataResponse",
            text: message.text,
            values: usageData,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          provider.log(`Error getting usage data: ${errorMessage}`);
        }
      }
      break;
    }
    // kade_change end - add getUsageData
    // kade_change start - add toggleTaskFavorite
    case "toggleTaskFavorite":
      if (message.text) {
        await provider.toggleTaskFavorite(message.text);
      }
      break;
    // kade_change start - add fixMermaidSyntax
    case "fixMermaidSyntax":
      if (message.text && message.requestId) {
        try {
          const { apiConfiguration } = await provider.getState();

          const prompt = mermaidFixPrompt(
            message.values?.error || "Unknown syntax error",
            message.text,
          );

          const fixedCode = await singleCompletionHandler(
            apiConfiguration,
            prompt,
          );

          provider.postMessageToWebview({
            type: "mermaidFixResponse",
            requestId: message.requestId,
            success: true,
            fixedCode: fixedCode?.trim() || null,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to fix Mermaid syntax";
          provider.log(`Error fixing Mermaid syntax: ${errorMessage}`);

          provider.postMessageToWebview({
            type: "mermaidFixResponse",
            requestId: message.requestId,
            success: false,
            error: errorMessage,
          });
        }
      }
      break;
    // kade_change end
    case "focusPanelRequest": {
      // Execute the focusPanel command to focus the WebView
      await vscode.commands.executeCommand(getCommand("focusPanel"));
      break;
    }
    case "filterMarketplaceItems": {
      if (marketplaceManager && message.filters) {
        try {
          // If there's a search term, we need to fetch remote results
          // Always fetch marketplace data (which handles both search and local filtering via cache)
          // This ensures the webview receives a 'marketplaceData' message, which clears the 'isFetching' state.
          await provider.fetchMarketplaceData(message.filters.search);
        } catch (error) {
          console.error("Marketplace: Error filtering items:", error);
          vscode.window.showErrorMessage("Failed to filter marketplace items");
        }
      }
      break;
    }

    case "fetchMarketplaceData": {
      // Fetch marketplace data on demand
      await provider.fetchMarketplaceData();
      break;
    }
    case "fetchSkills": {
      try {
        const skills = await provider.fetchSkills();
        await provider.postMessageToWebview({
          type: "skillsData",
          skills: skills,
        });
      } catch (error) {
        console.error("Error fetching skills:", error);
        await provider.postMessageToWebview({
          type: "skillsData",
          skills: [],
          error:
            error instanceof Error ? error.message : "Failed to fetch skills",
        });
      }
      break;
    }
    case "searchSkills": {
      try {
        const query = message.query || "";
        const skills = await provider.searchSkills(query);
        await provider.postMessageToWebview({
          type: "skillsSearchResults",
          skills: skills,
          query: query,
        });
      } catch (error) {
        console.error("Error searching skills:", error);
        await provider.postMessageToWebview({
          type: "skillsSearchResults",
          skills: [],
          query: message.query || "",
          error:
            error instanceof Error ? error.message : "Failed to search skills",
        });
      }
      break;
    }
    case "installSkill": {
      try {
        const { skillSource, skillId } = message;
        if (!skillSource || !skillId) {
          throw new Error("Missing skillSource or skillId");
        }
        await provider.installSkill(skillSource, skillId);
        await provider.postMessageToWebview({
          type: "skillInstallResult",
          success: true,
          skillSource: skillSource,
          skillId: skillId,
        });
      } catch (error) {
        console.error("Error installing skill:", error);
        await provider.postMessageToWebview({
          type: "skillInstallResult",
          success: false,
          skillSource: message.skillSource,
          skillId: message.skillId,
          error:
            error instanceof Error ? error.message : "Failed to install skill",
        });
      }
      break;
    }
    case "fetchInstalledSkills": {
      try {
        const installedSkills = await provider.fetchInstalledSkills();
        await provider.postMessageToWebview({
          type: "installedSkillsData",
          installedSkills: installedSkills,
          enabledSkills: (await provider.getState()).enabledSkills || [],
        });
      } catch (error) {
        console.error("Error fetching installed skills:", error);
        await provider.postMessageToWebview({
          type: "installedSkillsData",
          installedSkills: [],
          enabledSkills: [],
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch installed skills",
        });
      }
      break;
    }
    case "toggleSkill": {
      // Deprecated: Skills now toggle via updateSettings message
      // Keeping for backwards compatibility but no-op
      break;
    }

    case "installMarketplaceItem": {
      if (marketplaceManager && message.mpItem && message.mpInstallOptions) {
        try {
          const configFilePath =
            await marketplaceManager.installMarketplaceItem(
              message.mpItem,
              message.mpInstallOptions,
            );
          await provider.debouncedPostStateToWebview();
          console.log(
            `Marketplace item installed and config file opened: ${configFilePath}`,
          );

          // Send success message to webview
          provider.postMessageToWebview({
            type: "marketplaceInstallResult",
            success: true,
            slug: message.mpItem.id,
          });
        } catch (error) {
          console.error(`Error installing marketplace item: ${error}`);
          // Send error message to webview
          provider.postMessageToWebview({
            type: "marketplaceInstallResult",
            success: false,
            error: error instanceof Error ? error.message : String(error),
            slug: message.mpItem.id,
          });
        }
      }
      break;
    }

    case "removeInstalledMarketplaceItem": {
      if (marketplaceManager && message.mpItem && message.mpInstallOptions) {
        try {
          await marketplaceManager.removeInstalledMarketplaceItem(
            message.mpItem,
            message.mpInstallOptions,
          );
          await provider.debouncedPostStateToWebview();

          // Send success message to webview
          provider.postMessageToWebview({
            type: "marketplaceRemoveResult",
            success: true,
            slug: message.mpItem.id,
          });
        } catch (error) {
          console.error(`Error removing marketplace item: ${error}`);

          // Show error message to user
          vscode.window.showErrorMessage(
            `Failed to remove marketplace item: ${error instanceof Error ? error.message : String(error)}`,
          );

          // Send error message to webview
          provider.postMessageToWebview({
            type: "marketplaceRemoveResult",
            success: false,
            error: error instanceof Error ? error.message : String(error),
            slug: message.mpItem.id,
          });
        }
      } else {
        // MarketplaceManager not available or missing required parameters
        const errorMessage = !marketplaceManager
          ? "Marketplace manager is not available"
          : "Missing required parameters for marketplace item removal";
        console.error(errorMessage);

        vscode.window.showErrorMessage(errorMessage);

        if (message.mpItem?.id) {
          provider.postMessageToWebview({
            type: "marketplaceRemoveResult",
            success: false,
            error: errorMessage,
            slug: message.mpItem.id,
          });
        }
      }
      break;
    }

    case "installMarketplaceItemWithParameters": {
      if (
        marketplaceManager &&
        message.payload &&
        "item" in message.payload &&
        "parameters" in message.payload
      ) {
        try {
          const configFilePath =
            await marketplaceManager.installMarketplaceItem(
              message.payload.item,
              {
                parameters: message.payload.parameters,
              },
            );

          console.log(
            `Marketplace item with parameters installed and config file opened: ${configFilePath}`,
          );
        } catch (error) {
          console.error(
            `Error installing marketplace item with parameters: ${error}`,
          );
          vscode.window.showErrorMessage(
            `Failed to install marketplace item: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      break;
    }

    case "switchTab": {
      if (message.tab) {
        // Capture tab shown event for all switchTab messages (which are user-initiated)
        if (TelemetryService.hasInstance()) {
          TelemetryService.instance.captureTabShown(message.tab);
        }

        await provider.postMessageToWebview({
          type: "action",
          action: "switchTab",
          tab: message.tab,
          values: message.values,
        });
      }
      break;
    }
    // kade_change start
    case "editMessage": {
      await editMessageHandler(provider, message);
      break;
    }
    case "fetchKilocodeNotifications": {
      await fetchKilocodeNotificationsHandler(provider);
      break;
    }
    case "dismissNotificationId": {
      if (!message.notificationId) {
        break;
      }

      const dismissedNotificationIds =
        getGlobalState("dismissedNotificationIds") || [];

      await updateGlobalState("dismissedNotificationIds", [
        ...dismissedNotificationIds,
        message.notificationId,
      ]);
      await provider.debouncedPostStateToWebview();
      break;
    }
    // kade_change start
    case "requestResourceMonitorData": {
      const { ResourceMonitorService } = await import(
        "../../services/resource-monitor/ResourceMonitorService"
      );
      ResourceMonitorService.getInstance().registerProvider(provider);
      await ResourceMonitorService.getInstance().broadcastSnapshot();
      break;
    }
    // kade_change end
    // kade_change start: Type-safe global state handler
    case "updateGlobalState": {
      const { stateKey, stateValue } = message as UpdateGlobalStateMessage;
      if (
        stateKey !== undefined &&
        stateValue !== undefined &&
        isGlobalStateKey(stateKey)
      ) {
        await updateGlobalState(stateKey, stateValue);
        await provider.debouncedPostStateToWebview();
      }
      break;
    }
    // kade_change start: STT (Speech-to-Text) handlers
    case "stt:start":
    case "stt:stop":
    case "stt:cancel": {
      const { handleSTTCommand } = await import("./sttHandlers");
      await handleSTTCommand(provider, message as any);
      break;
    }
    // Local Whisper transcription results from webview
    case "localWhisper:modelLoading":
    case "localWhisper:modelReady":
    case "localWhisper:transcriptionUpdate":
    case "localWhisper:transcriptionComplete":
    case "localWhisper:error": {
      const { handleLocalWhisperMessage } = await import("./sttHandlers");
      handleLocalWhisperMessage(provider, message as any);
      break;
    }
    // kade_change end: Type-safe global state handler
    case "insertTextToChatArea":
      provider.postMessageToWebview({
        type: "insertTextToChatArea",
        text: message.text,
      });
      break;
    case "requestCommands": {
      try {
        const { getCommands } = await import("../../services/command/commands");
        const commands = await getCommands(getCurrentCwd());

        // Convert to the format expected by the frontend
        const commandList = commands.map((command) => ({
          name: command.name,
          source: command.source,
          filePath: command.filePath,
          description: command.description,
          argumentHint: command.argumentHint,
        }));

        await provider.postMessageToWebview({
          type: "commands",
          commands: commandList,
        });
      } catch (error) {
        provider.log(
          `Error fetching commands: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        // Send empty array on error
        await provider.postMessageToWebview({
          type: "commands",
          commands: [],
        });
      }
      break;
    }
    case "getKeybindings": {
      try {
        const { getKeybindingsForCommands } = await import(
          "../../utils/keybindings"
        );
        const keybindings = await getKeybindingsForCommands(
          message.commandIds ?? [],
        );

        await provider.postMessageToWebview({
          type: "keybindingsResponse",
          keybindings,
        });
      } catch (error) {
        await provider.postMessageToWebview({
          type: "keybindingsResponse",
          keybindings: {},
        });
      }
      break;
    } // kade_change start: Chat text area FIM autocomplete
    case "requestChatCompletion": {
      await handleChatCompletionRequest(
        message as WebviewMessage & { type: "requestChatCompletion" },
        provider,
        getCurrentCwd,
      );
      break;
    }
    case "chatCompletionAccepted": {
      handleChatCompletionAccepted(
        message as WebviewMessage & { type: "chatCompletionAccepted" },
      );
      break;
    }
    // kade_change end: Chat text area FIM autocomplete
    case "openCommandFile": {
      try {
        if (message.text) {
          const { getCommand } = await import(
            "../../services/command/commands"
          );
          const command = await getCommand(getCurrentCwd(), message.text);

          if (command && command.filePath) {
            openFileInProviderColumn(command.filePath);
          } else {
            vscode.window.showErrorMessage(
              t("common:errors.command_not_found", { name: message.text }),
            );
          }
        }
      } catch (error) {
        provider.log(
          `Error opening command file: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(t("common:errors.open_command_file"));
      }
      break;
    }
    case "deleteCommand": {
      try {
        if (message.text && message.values?.source) {
          const { getCommand } = await import(
            "../../services/command/commands"
          );
          const command = await getCommand(getCurrentCwd(), message.text);

          if (command && command.filePath) {
            // Delete the command file
            await fs.unlink(command.filePath);
            provider.log(`Deleted command file: ${command.filePath}`);
          } else {
            vscode.window.showErrorMessage(
              t("common:errors.command_not_found", { name: message.text }),
            );
          }
        }
      } catch (error) {
        provider.log(
          `Error deleting command: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(t("common:errors.delete_command"));
      }
      break;
    }
    case "createCommand": {
      try {
        const source = message.values?.source as "global" | "project";
        const fileName = message.text; // Custom filename from user input

        if (!source) {
          provider.log("Missing source for createCommand");
          break;
        }

        // Determine the commands directory based on source
        let commandsDir: string;
        if (source === "global") {
          const globalConfigDir = path.join(os.homedir(), ".roo");
          commandsDir = path.join(globalConfigDir, "commands");
        } else {
          if (!vscode.workspace.workspaceFolders?.length) {
            vscode.window.showErrorMessage(t("common:errors.no_workspace"));
            return;
          }
          // Project commands
          const workspaceRoot = getCurrentCwd();
          if (!workspaceRoot) {
            vscode.window.showErrorMessage(
              t("common:errors.no_workspace_for_project_command"),
            );
            break;
          }
          commandsDir = path.join(workspaceRoot, ".roo", "commands");
        }

        // Ensure the commands directory exists
        await fs.mkdir(commandsDir, { recursive: true });

        // Use provided filename or generate a unique one
        let commandName: string;
        if (fileName && fileName.trim()) {
          let cleanFileName = fileName.trim();

          // Strip leading slash if present
          if (cleanFileName.startsWith("/")) {
            cleanFileName = cleanFileName.substring(1);
          }

          // Remove .md extension if present BEFORE slugification
          if (cleanFileName.toLowerCase().endsWith(".md")) {
            cleanFileName = cleanFileName.slice(0, -3);
          }

          // Slugify the command name: lowercase, replace spaces with dashes, remove special characters
          commandName = cleanFileName
            .toLowerCase()
            .replace(/\s+/g, "-") // Replace spaces with dashes
            .replace(/[^a-z0-9-]/g, "") // Remove special characters except dashes
            .replace(/-+/g, "-") // Replace multiple dashes with single dash
            .replace(/^-|-$/g, ""); // Remove leading/trailing dashes

          // Ensure we have a valid command name
          if (!commandName || commandName.length === 0) {
            commandName = "new-command";
          }
        } else {
          // Generate a unique command name
          commandName = "new-command";
          let counter = 1;
          let filePath = path.join(commandsDir, `${commandName}.md`);

          while (
            await fs
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            commandName = `new-command-${counter}`;
            filePath = path.join(commandsDir, `${commandName}.md`);
            counter++;
          }
        }

        const filePath = path.join(commandsDir, `${commandName}.md`);

        // Check if file already exists
        if (
          await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)
        ) {
          vscode.window.showErrorMessage(
            t("common:errors.command_already_exists", { commandName }),
          );
          break;
        }

        // Create the command file with template content
        const templateContent = t("common:errors.command_template_content");

        await fs.writeFile(filePath, templateContent, "utf8");
        provider.log(`Created new command file: ${filePath}`);

        // Open the new file in the editor
        openFileInProviderColumn(filePath);

        // Refresh commands list
        const { getCommands } = await import("../../services/command/commands");
        const commands = await getCommands(getCurrentCwd() || "");
        const commandList = commands.map((command) => ({
          name: command.name,
          source: command.source,
          filePath: command.filePath,
          description: command.description,
          argumentHint: command.argumentHint,
        }));
        await provider.postMessageToWebview({
          type: "commands",
          commands: commandList,
        });
      } catch (error) {
        provider.log(
          `Error creating command: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
        );
        vscode.window.showErrorMessage(
          t("common:errors.create_command_failed"),
        );
      }
      break;
    }

    case "insertTextIntoTextarea": {
      const text = message.text;
      if (text) {
        // Send message to insert text into the chat textarea
        await provider.postMessageToWebview({
          type: "insertTextIntoTextarea",
          text: text,
        });
      }
      break;
    }
    case "showMdmAuthRequiredNotification": {
      // Show notification that organization requires authentication
      vscode.window.showWarningMessage(
        t("common:mdm.info.organization_requires_auth"),
      );
      break;
    }

    // kade_change start - Auto-purge settings handlers
    case "autoPurgeEnabled":
      await updateGlobalState("autoPurgeEnabled", message.bool ?? false);
      await provider.debouncedPostStateToWebview();
      break;
    case "autoPurgeDefaultRetentionDays":
      await updateGlobalState(
        "autoPurgeDefaultRetentionDays",
        message.value ?? 30,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "autoPurgeFavoritedTaskRetentionDays":
      await updateGlobalState(
        "autoPurgeFavoritedTaskRetentionDays",
        message.value ?? null,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "autoPurgeCompletedTaskRetentionDays":
      await updateGlobalState(
        "autoPurgeCompletedTaskRetentionDays",
        message.value ?? 30,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "autoPurgeIncompleteTaskRetentionDays":
      await updateGlobalState(
        "autoPurgeIncompleteTaskRetentionDays",
        message.value ?? 7,
      );
      await provider.debouncedPostStateToWebview();
      break;
    case "manualPurge":
      try {
        const state = await provider.getState();
        const autoPurgeSettings = {
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

        if (!autoPurgeSettings.enabled) {
          vscode.window.showWarningMessage(
            "Auto-purge is disabled. Please enable it in settings first.",
          );
          break;
        }

        const scheduler = new AutoPurgeScheduler(
          provider.contextProxy.globalStorageUri.fsPath,
        );
        const currentTaskId = provider.getCurrentTask()?.taskId;

        await scheduler.triggerManualPurge(
          autoPurgeSettings,
          provider.getTaskHistory(),
          currentTaskId,
          async (taskId: string) => {
            // Remove task from state when purged
            await provider.deleteTaskFromState(taskId);
          },
        );

        // Update last run timestamp
        await updateGlobalState("autoPurgeLastRunTimestamp", Date.now());
        await provider.debouncedPostStateToWebview();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.log(`Error in manual purge: ${errorMessage}`);
        vscode.window.showErrorMessage(`Manual purge failed: ${errorMessage}`);
      }
      break;

    // kade_change end

    /**
     * Chat Message Queue
     */

    case "queueMessage": {
      provider
        .getCurrentTask()
        ?.messageQueueService.addMessage(message.text ?? "", message.images);
      break;
    }
    case "sendQueuedMessageNow": {
      const task = provider.getCurrentTask();
      const messageId = (
        message.payload as SendQueuedMessageNowPayload | undefined
      )?.id;

      if (!task || !messageId) {
        break;
      }

      task.messageQueueService.moveMessageToFront(messageId);

      if (
        task.isStreaming ||
        !!task.terminalProcess ||
        task.taskAsk?.ask === "command_output"
      ) {
        await provider.cancelTask();
      } else if (!task.taskAsk) {
        task.consumeQueuedMessage(messageId);
      }

      break;
    }
    case "removeQueuedMessage": {
      const task = provider.getCurrentTask();
      const queuedMessageId = resolveQueuedMessageRemovalId(
        message as {
          payload?: RemoveQueuedMessagePayload;
          text?: string;
        },
      );

      if (!queuedMessageId) {
        break;
      }

      task?.messageQueueService.removeMessage(queuedMessageId);
      break;
    }
    case "editQueuedMessage": {
      if (message.payload) {
        const { id, text, images } =
          message.payload as EditQueuedMessagePayload;
        provider
          .getCurrentTask()
          ?.messageQueueService.updateMessage(id, text, images);
      }

      break;
    }

    case "dismissUpsell": {
      if (message.upsellId) {
        try {
          // Get current list of dismissed upsells
          const dismissedUpsells = getGlobalState("dismissedUpsells") || [];

          // Add the new upsell ID if not already present
          let updatedList = dismissedUpsells;
          if (!dismissedUpsells.includes(message.upsellId)) {
            updatedList = [...dismissedUpsells, message.upsellId];
            await updateGlobalState("dismissedUpsells", updatedList);
          }

          // Send updated list back to webview (use the already computed updatedList)
          await provider.postMessageToWebview({
            type: "dismissedUpsells",
            list: updatedList,
          });
        } catch (error) {
          // Fail silently as per Bruno's comment - it's OK to fail silently in this case
          provider.log(
            `Failed to dismiss upsell: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      break;
    }
    case "getDismissedUpsells": {
      // Send the current list of dismissed upsells to the webview
      const dismissedUpsells = getGlobalState("dismissedUpsells") || [];
      await provider.postMessageToWebview({
        type: "dismissedUpsells",
        list: dismissedUpsells,
      });
      break;
    }
    // kade_change start
    case "addTaskToHistory": {
      if (message.historyItem) {
        await provider.updateTaskHistory(message.historyItem);
        await provider.debouncedPostStateToWebview();
      }
      break;
    }
    case "sessionShow": {
      try {
        const sessionService = SessionManager.init();

        if (!sessionService?.sessionId) {
          vscode.window.showErrorMessage(
            "No active session. Start a new task to create a session.",
          );
          break;
        }

        vscode.window.showInformationMessage(
          `Session ID: ${sessionService.sessionId}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to copy session ID: ${errorMessage}`,
        );
      }
      break;
    }
    case "sessionShare": {
      try {
        const sessionService = SessionManager.init();

        const sessionId = message.sessionId || sessionService?.sessionId;

        if (!sessionId) {
          vscode.window.showErrorMessage(
            "No active session. Start a new task to create a session.",
          );
          break;
        }

        const result = await sessionService?.shareSession(sessionId);

        if (!result) {
          throw new Error("SessionManager not initialized");
        }

        const shareUrl = `https://app.kilo.ai/share/${result.share_id}`;

        // Copy URL to clipboard and show success notification
        await vscode.env.clipboard.writeText(shareUrl);
        vscode.window.showInformationMessage(
          t("common:info.session_share_link_copied_with_url", {
            url: shareUrl,
          }),
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to share session: ${errorMessage}`,
        );
      }
      break;
    }
    case "shareTaskSession": {
      try {
        if (!message.text) {
          vscode.window.showErrorMessage(
            "Task ID is required for sharing a task session",
          );
          break;
        }

        const taskId = message.text;
        const sessionService = SessionManager.init();

        const sessionId = await sessionService?.getSessionFromTask(
          taskId,
          provider,
        );

        const result = await sessionService?.shareSession(sessionId);

        if (!result) {
          throw new Error("SessionManager not initialized");
        }

        const shareUrl = `https://app.kilo.ai/share/${result.share_id}`;

        await vscode.env.clipboard.writeText(shareUrl);
        vscode.window.showInformationMessage(
          t("common:info.session_share_link_copied_with_url", {
            url: shareUrl,
          }),
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to share task session: ${errorMessage}`,
        );
      }
      break;
    }
    case "sessionFork": {
      try {
        if (!message.shareId) {
          vscode.window.showErrorMessage(
            "ID is required for forking a session",
          );
          break;
        }

        const sessionService = SessionManager.init();

        await provider.clearTask();

        await sessionService?.forkSession(message.shareId, true);

        vscode.window.showInformationMessage(
          `Session forked successfully from ${message.shareId}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to fork session: ${errorMessage}`,
        );
      }
      break;
    }
    case "sessionSelect": {
      try {
        if (!message.sessionId) {
          vscode.window.showErrorMessage(
            "Session ID is required for selecting a session",
          );
          break;
        }

        const sessionService = SessionManager.init();

        await provider.clearTask();

        await sessionService?.restoreSession(message.sessionId, true);

        await provider.debouncedPostStateToWebview();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to restore session: ${errorMessage}`,
        );
      }
      break;
    }
    case "singleCompletion": {
      try {
        const { text, completionRequestId } = message;

        if (!completionRequestId) {
          throw new Error("Missing completionRequestId");
        }

        if (!text) {
          throw new Error("Missing prompt text");
        }

        // Always use current configuration
        const config = (await provider.getState()).apiConfiguration;

        // Call the single completion handler
        const result = await singleCompletionHandler(config, text);

        // Send success response
        await provider.postMessageToWebview({
          type: "singleCompletionResult",
          completionRequestId,
          completionText: result,
          success: true,
        });
      } catch (error) {
        // Send error response
        await provider.postMessageToWebview({
          type: "singleCompletionResult",
          completionRequestId: message.completionRequestId,
          completionError:
            error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
      break;
    }
    // kade_change end
    // kade_change start - ManagedIndexer state
    case "requestManagedIndexerState": {
      ManagedIndexer.getInstance()?.sendStateToWebview();
      break;
    }
    // kade_change end

    case "openDebugApiHistory":
    case "openDebugUiHistory": {
      const currentTask = provider.getCurrentTask();
      if (!currentTask) {
        vscode.window.showErrorMessage("No active task to view history for");
        break;
      }

      try {
        const { getTaskDirectoryPath } = await import("../../utils/storage");
        const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath;
        const taskDirPath = await getTaskDirectoryPath(
          globalStoragePath,
          currentTask.taskId,
        );

        const fileName =
          message.type === "openDebugApiHistory"
            ? "api_conversation_history.json"
            : "ui_messages.json";
        const sourceFilePath = path.join(taskDirPath, fileName);

        // Check if file exists
        if (!(await fileExistsAtPath(sourceFilePath))) {
          vscode.window.showErrorMessage(`File not found: ${fileName}`);
          break;
        }

        // Read the source file
        const content = await fs.readFile(sourceFilePath, "utf8");
        let jsonContent: unknown;

        try {
          jsonContent = JSON.parse(content);
        } catch {
          vscode.window.showErrorMessage(`Failed to parse ${fileName}`);
          break;
        }

        // Prettify the JSON
        const prettifiedContent = JSON.stringify(jsonContent, null, 2);

        // Create a temporary file
        const tmpDir = os.tmpdir();
        const timestamp = Date.now();
        const tempFileName = `roo-debug-${message.type === "openDebugApiHistory" ? "api" : "ui"}-${currentTask.taskId.slice(0, 8)}-${timestamp}.json`;
        const tempFilePath = path.join(tmpDir, tempFileName);

        await fs.writeFile(tempFilePath, prettifiedContent, "utf8");

        // Open the temp file in VS Code
        const doc = await vscode.workspace.openTextDocument(tempFilePath);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        provider.log(`Error opening debug history: ${errorMessage}`);
        vscode.window.showErrorMessage(
          `Failed to open debug history: ${errorMessage}`,
        );
      }
      break;
    }

    // kade_change start - Device Auth handlers
    case "startDeviceAuth":
    case "cancelDeviceAuth":
    case "deviceAuthCompleteWithProfile": {
      await deviceAuthMessageHandler(provider, message);
      break;
    }
    // kade_change end
    case "selectFolder": {
      const options: vscode.OpenDialogOptions = {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder to Index",
      };

      const folderUri = await vscode.window.showOpenDialog(options);
      if (folderUri && folderUri[0]) {
        let relativePath = vscode.workspace.asRelativePath(folderUri[0]);
        // Ensure path is clean and uses forward slashes
        relativePath = relativePath.replace(/\\/g, "/");
        await provider.postMessageToWebview({
          type: "vsCodeSetting",
          setting: "selectedFolder",
          value: relativePath,
        });
      }
      break;
    }
    case "requestMicrophonePermission":
      // Execute the VS Code command to help user enable microphone permissions
      await vscode.commands.executeCommand(
        "kilo-code.requestMicrophonePermission",
      );
      break;
    default: {
      // console.log(`Unhandled message type: ${message.type}`)
      //
      // Currently unhandled:
      //
      // "currentApiConfigName" |
      // "codebaseIndexEnabled" |
      // "enhancedPrompt" |
      // "systemPrompt" |
      // "exportModeResult" |
      // "importModeResult" |
      // "checkRulesDirectoryResult" |
      // "browserConnectionResult" |
      // "vsCodeSetting" |
      // "indexingStatusUpdate" |
      // "indexCleared" |
      // "marketplaceInstallResult" |
      // "shareTaskSuccess" |
      // "playSound" |
      // "draggedImages" |
      // "setApiConfigPassword" |
      // "setopenAiCustomModelInfo" |
      // "marketplaceButtonClicked" |
      // "cancelMarketplaceInstall" |
      // "imageGenerationSettings"
      break;
    }
  }
};
