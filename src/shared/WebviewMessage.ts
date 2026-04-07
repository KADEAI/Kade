import { z } from "zod";

import {
  type RooCodeSettings,
  type ProviderSettings,
  type PromptComponent,
  type ModeConfig,
  type InstallMarketplaceItemOptions,
  type MarketplaceItem,
  type ShareVisibility,
  type QueuedMessage,
  marketplaceItemSchema,
  // kade_change start
  CommitRange,
  HistoryItem,
  GlobalState,
  // kade_change end
} from "@roo-code/types";

import { Mode } from "./modes";

export type ClineAskResponse =
  | "yesButtonClicked"
  | "noButtonClicked"
  | "messageResponse"
  | "objectResponse"
  | "retry_clicked"; // kade_change: Added retry_clicked for payment required dialog

export type PromptMode = Mode | "enhance";

export type AudioType = "notification" | "celebration" | "progress_loop";

export interface UpdateTodoListPayload {
  todos: any[];
}

export type EditQueuedMessagePayload = Pick<
  QueuedMessage,
  "id" | "text" | "images"
>;

export type SendQueuedMessageNowPayload = Pick<QueuedMessage, "id">;

export type RemoveQueuedMessagePayload = Pick<QueuedMessage, "id">;

// kade_change start: Type-safe global state update message
export type GlobalStateValue<K extends keyof GlobalState> = GlobalState[K];
export type UpdateGlobalStateMessage<
  K extends keyof GlobalState = keyof GlobalState,
> = {
  type: "updateGlobalState";
  stateKey: K;
  stateValue: GlobalStateValue<K>;
};
// kade_change end: Type-safe global state update message

export interface WebviewMessage {
  type:
    | "antigravitySignIn"
    | "antigravitySignOut"
    | "zedSignIn"
    | "zedSignOut"
    | "geminiCliSignIn"
    | "geminiCliSignOut"
    | "checkKiroAuth"
    | "updateTodoList"
    | "deleteMultipleTasksWithIds"
    | "currentApiConfigName"
    | "saveApiConfiguration"
    | "upsertApiConfiguration"
    | "deleteApiConfiguration"
    | "loadApiConfiguration"
    | "loadApiConfigurationById"
    | "getProfileConfigurationForEditing" // kade_change: Request to get profile config without activating
    | "renameApiConfiguration"
    | "getListApiConfiguration"
    | "customInstructions"
    | "webviewDidLaunch"
    | "newTask"
    | "askResponse"
    | "terminalOperation"
    | "clearTask"
    | "didShowAnnouncement"
    | "selectImages"
    | "exportCurrentTask"
    | "shareCurrentTask"
    | "showTaskWithId"
    | "deleteTaskWithId"
    | "exportTaskWithId"
    | "importSettings"
    | "toggleToolAutoApprove"
    | "openExtensionSettings"
    | "openInBrowser"
    | "fetchOpenGraphData"
    | "checkIsImageUrl"
    | "exportSettings"
    | "resetState"
    | "flushRouterModels"
    | "requestRouterModels"
    | "requestOpenAiModels"
    | "requestOllamaModels"
    | "requestLmStudioModels"
    | "requestRooModels"
    | "requestRooCreditBalance"
    | "requestVsCodeLmModels"
    | "requestHuggingFaceModels"
    | "requestSapAiCoreModels" // kade_change
    | "requestSapAiCoreDeployments" // kade_change
    | "openImage"
    | "saveImage"
    | "openFile"
    | "newUntitledFile"
    | "openDiff"
    | "openMention"
    | "focusTerminal"
    | "cancelTask"
    | "cancelAutoApproval"
    | "updateVSCodeSetting"
    | "getVSCodeSetting"
    | "vsCodeSetting"
    | "updateCondensingPrompt"
    | "yoloGatekeeperApiConfigId" // kade_change: AI gatekeeper for YOLO mode
    | "playSound"
    | "playTts"
    | "stopTts"
    | "ttsEnabled"
    | "ttsSpeed"
    | "openKeyboardShortcuts"
    | "openMcpSettings"
    | "openProjectMcpSettings"
    | "restartMcpServer"
    | "refreshAllMcpServers"
    | "toggleToolAlwaysAllow"
    | "toggleAlwaysAllowAllTools"
    | "toggleToolEnabledForPrompt"
    | "toggleMcpServer"
    | "updateMcpTimeout"
    | "fuzzyMatchThreshold" // kade_change
    | "morphApiKey" // kade_change: Morph fast apply - global setting
    | "fastApplyModel" // kade_change: Fast Apply model selection
    | "fastApplyApiProvider" // kade_change: Fast Apply model api base url
    | "writeDelayMs" // kade_change
    | "diagnosticsEnabled" // kade_change
    | "enhancePrompt"
    | "enhancedPrompt"
    | "draggedImages"
    | "deleteMessage"
    | "deleteMessageConfirm"
    | "submitEditedMessage"
    | "editMessageConfirm"
    | "enableMcpServerCreation"
    | "remoteControlEnabled"
    | "taskSyncEnabled"
    | "searchCommits"
    | "setApiConfigPassword"
    | "mode"
    | "updatePrompt"
    | "getSystemPrompt"
    | "copySystemPrompt"
    | "systemPrompt"
    | "enhancementApiConfigId"
    | "commitMessageApiConfigId" // kade_change
    | "terminalCommandApiConfigId" // kade_change
    | "ghostServiceSettings" // kade_change
    | "stt:start" // kade_change: Start STT recording
    | "stt:stop" // kade_change: Stop STT recording
    | "stt:cancel" // kade_change: Cancel STT recording
    | "requestMicrophonePermission" // Request help with microphone permissions
    | "localWhisper:modelLoading" // Local Whisper model loading progress
    | "localWhisper:modelReady" // Local Whisper model ready
    | "localWhisper:transcriptionUpdate" // Local Whisper streaming transcription update
    | "localWhisper:transcriptionComplete" // Local Whisper transcription complete
    | "localWhisper:error" // Local Whisper error
    | "includeTaskHistoryInEnhance" // kade_change
    | "snoozeAutocomplete" // kade_change
    | "autoApprovalEnabled"
    | "subAgentToolEnabled"
    | "showSubAgentBanner" // kade_change
    | "requestEmptyStateBackgrounds"
    | "openEmptyStateBackgroundsFolder"
    | "yoloMode" // kade_change
    | "yoloMode" // kade_change
    | "yoloMode" // kade_change
    | "updateCustomMode"
    | "deleteCustomMode"
    | "setopenAiCustomModelInfo"
    | "openCustomModesSettings"
    | "checkpointDiff"
    | "checkpointRestore"
    | "requestCheckpointRestoreApproval"
    | "seeNewChanges" // kade_change
    | "deleteMcpServer"
    | "humanRelayResponse"
    | "humanRelayCancel"
    | "insertTextToChatArea" // kade_change
    | "codebaseIndexEnabled"
    | "telemetrySetting"
    | "testBrowserConnection"
    | "browserConnectionResult"
    | "allowVeryLargeReads" // kade_change
    | "showFeedbackOptions" // kade_change
    | "fetchMcpMarketplace" // kade_change
    | "silentlyRefreshMcpMarketplace" // kade_change
    | "fetchLatestMcpServersFromHub" // kade_change
    | "downloadMcp" // kade_change
    | "showSystemNotification" // kade_change
    | "showAutoApproveMenu" // kade_change
    | "disableBrowserHeadless" // kade_change
    | "reportBug" // kade_change
    | "profileButtonClicked" // kade_change
    | "fetchProfileDataRequest" // kade_change
    | "profileDataResponse" // kade_change
    | "fetchBalanceDataRequest" // kade_change
    | "shopBuyCredits" // kade_change
    | "balanceDataResponse" // kade_change
    | "updateProfileData" // kade_change
    | "condense" // kade_change
    | "toggleWorkflow" // kade_change
    | "refreshRules" // kade_change
    | "toggleRule" // kade_change
    | "createRuleFile" // kade_change
    | "deleteRuleFile" // kade_change
    | "searchFiles"
    | "toggleApiConfigPin"
    | "hasOpenedModeSelector"
    | "cloudButtonClicked"
    | "rooCloudSignIn"
    | "cloudLandingPageSignIn"
    | "rooCloudSignOut"
    | "rooCloudManualUrl"
    | "switchOrganization"
    | "condenseTaskContextRequest"
    | "requestIndexingStatus"
    | "startIndexing"
    | "cancelIndexing" // kade_change
    | "clearIndexData"
    | "indexingStatusUpdate"
    | "indexCleared"
    | "focusPanelRequest"
    | "clearUsageData" // kade_change
    | "getUsageData" // kade_change
    | "usageDataResponse" // kade_change
    | "showTaskTimeline" // kade_change
    | "sendMessageOnEnter" // kade_change
    | "showTimestamps" // kade_change
    | "hideCostBelowThreshold" // kade_change
    | "collapseCodeToolsByDefault"
    | "showVibeStyling"
    | "slidingWindowSize" // kade_change
    | "toggleInfinity"
    | "toggleTaskFavorite" // kade_change
    | "fixMermaidSyntax" // kade_change
    | "mermaidFixResponse" // kade_change
    | "openGlobalKeybindings" // kade_change
    | "getKeybindings" // kade_change
    | "setReasoningBlockCollapsed"
    | "setHistoryPreviewCollapsed" // kade_change
    | "openExternal"
    | "filterMarketplaceItems"
    | "checkKiroAuth"
    | "mcpButtonClicked"
    | "marketplaceButtonClicked"
    | "installMarketplaceItem"
    | "installMarketplaceItemWithParameters"
    | "cancelMarketplaceInstall"
    | "removeInstalledMarketplaceItem"
    | "marketplaceInstallResult"
    | "fetchMarketplaceData"
    | "fetchSkills"
    | "searchSkills"
    | "installSkill"
    | "skillsData"
    | "skillsSearchResults"
    | "skillInstallResult"
    | "fetchInstalledSkills"
    | "installedSkillsData"
    | "toggleSkill"
    | "switchTab"
    | "requestResourceMonitorData" // kade_change
    | "profileThresholds" // kade_change
    | "editMessage" // kade_change
    | "systemNotificationsEnabled" // kade_change
    | "dismissNotificationId" // kade_change
    | "tasksByIdRequest" // kade_change
    | "taskHistoryRequest" // kade_change
    | "updateGlobalState" // kade_change
    | "autoPurgeEnabled" // kade_change
    | "autoPurgeDefaultRetentionDays" // kade_change
    | "autoPurgeFavoritedTaskRetentionDays" // kade_change
    | "autoPurgeCompletedTaskRetentionDays" // kade_change
    | "autoPurgeIncompleteTaskRetentionDays" // kade_change
    | "manualPurge" // kade_change
    | "shareTaskSuccess" // kade_change
    | "exportMode"
    | "exportModeResult"
    | "importMode"
    | "importModeResult"
    | "checkRulesDirectory"
    | "checkRulesDirectoryResult"
    | "saveCodeIndexSettingsAtomic"
    | "requestCodeIndexSecretStatus"
    | "fetchKilocodeNotifications"
    | "requestCommands"
    | "openCommandFile"
    | "deleteCommand"
    | "createCommand"
    | "insertTextIntoTextarea"
    | "showMdmAuthRequiredNotification"
    | "imageGenerationSettings"
    | "kiloCodeImageApiKey" // kade_change
    | "queueMessage"
    | "removeQueuedMessage"
    | "editQueuedMessage"
    | "sendQueuedMessageNow"
    | "dismissUpsell"
    | "getDismissedUpsells"
    | "updateSettings"
    | "resetToDefaultProtocol"
    | "requestManagedIndexerState" // kade_change
    | "allowedCommands"
    | "deniedCommands"
    | "killBrowserSession"
    | "openBrowserSessionPanel"
    | "showBrowserSessionPanelAtStep"
    | "refreshBrowserSessionPanel"
    | "browserPanelDidLaunch"
    | "addTaskToHistory" // kade_change
    | "sessionShare" // kade_change
    | "shareTaskSession" // kade_change
    | "sessionFork" // kade_change
    | "sessionShow" // kade_change
    | "sessionSelect" // kade_change
    | "singleCompletion" // kade_change
    | "openDebugApiHistory"
    | "openDebugUiHistory"
    | "startDeviceAuth" // kade_change: Start device auth flow
    | "cancelDeviceAuth" // kade_change: Cancel device auth flow
    | "deviceAuthCompleteWithProfile" // kade_change: Device auth complete with specific profile
    | "requestChatCompletion" // kade_change: Request FIM completion for chat text area
    | "chatCompletionAccepted" // kade_change: User accepted a chat completion suggestion
    | "webviewDebug" // kade_change: Compact renderer-side debug forwarding
    | "request" // kade_change: generic request pattern
    | "command" // kade_change: generic command execution
    | "cliProxyLogin" // kade_change: CLI Proxy login
    | "requestCliProxyModels" // kade_change: Request CLI Proxy models
    | "cliProxyModels" // kade_change: Response with CLI Proxy models
    | "openAiCodexSignIn" // kade_change
    | "openAiCodexSignOut" // kade_change
    | "requestOpenAiCodexRateLimits" // kade_change
    | "claudeCodeSignIn" // kade_change
    | "claudeCodeSignOut" // kade_change
    | "requestClaudeCodeRateLimits" // kade_change
    | "claudeCodeRateLimits" // kade_change
    | "selectExternalFile"
    | "selectFolder";
  text?: string;
  provider?: string; // kade_change: CLI Proxy provider
  models?: any; // kade_change: models payload
  request?: { type: string; key: string; value?: any };
  command?: string;
  args?: any[];
  suggestionLength?: number; // kade_change: Length of accepted suggestion for telemetry
  completionRequestId?: string; // kade_change
  shareId?: string; // kade_change - for sessionFork
  sessionId?: string; // kade_change - for sessionSelect
  editedMessageContent?: string;
  tab?:
    | "settings"
    | "history"
    | "mcp"
    | "modes"
    | "chat"
    | "marketplace"
    | "cloud"
    | "auth"; // kade_change
  disabled?: boolean;
  context?: string;
  dataUri?: string;
  edits?: any[];
  toolId?: string;
  askResponse?: ClineAskResponse;
  apiConfiguration?: ProviderSettings;
  images?: string[];
  bool?: boolean;
  value?: number;
  stepIndex?: number;
  isLaunchAction?: boolean;
  forceShow?: boolean;
  commands?: string[];
  audioType?: AudioType;
  // kade_change begin
  notificationOptions?: {
    title?: string;
    subtitle?: string;
    message: string;
  };
  mcpId?: string;
  toolNames?: string[];
  autoApprove?: boolean;
  workflowPath?: string; // kade_change
  enableSubAgents?: boolean; // kade_change
  enabled?: boolean; // kade_change
  rulePath?: string; // kade_change
  isGlobal?: boolean; // kade_change
  filename?: string; // kade_change
  ruleType?: string; // kade_change
  notificationId?: string; // kade_change
  commandIds?: string[]; // kade_change: For getKeybindings
  // kade_change end
  serverName?: string;
  toolName?: string;
  alwaysAllow?: boolean;
  isEnabled?: boolean;
  alwaysAllowAll?: boolean;
  mode?: Mode;
  promptMode?: PromptMode;
  customPrompt?: PromptComponent;
  dataUrls?: string[];
  values?: Record<string, any>;
  query?: string;
  setting?: string;
  scope?: "task" | "global"; // kade_change: For scoping UI settings updates
  slug?: string;
  language?: string; // User's language for speech transcription (STT)
  modeConfig?: ModeConfig;
  timeout?: number;
  payload?: WebViewMessagePayload;
  source?: "global" | "project";
  requestId?: string;
  ids?: string[];
  hasSystemPromptOverride?: boolean;
  terminalOperation?: "continue" | "abort" | "stdin" | "ai_stdin_mode";
  executionId?: string;
  messageTs?: number;
  restoreCheckpoint?: boolean;
  historyPreviewCollapsed?: boolean;
  filters?: { type?: string; search?: string; tags?: string[] };
  settings?: any;
  url?: string; // For openExternal
  path?: string; // For checkKiroAuth custom path
  mpItem?: MarketplaceItem;
  mpInstallOptions?: InstallMarketplaceItemOptions;
  config?: Record<string, any>; // Add config to the payload
  skills?: any[]; // For skills data
  skillSource?: string; // For skill installation source (e.g., "owner/repo")
  skillId?: string; // For skill installation
  success?: boolean; // For skill installation result
  error?: string; // For error messages
  enabledSkills?: string[]; // For enabled skills list
  visibility?: ShareVisibility; // For share visibility
  hasContent?: boolean; // For checkRulesDirectoryResult
  checkOnly?: boolean; // For deleteCustomMode check
  upsellId?: string; // For dismissUpsell
  list?: string[]; // For dismissedUpsells response
  organizationId?: string | null; // For organization switching
  useProviderSignup?: boolean; // For rooCloudSignIn to use provider signup flow
  historyItem?: HistoryItem; // kade_change For addTaskToHistory
  codeIndexSettings?: {
    // Global state settings
    codebaseIndexEnabled: boolean;
    codebaseIndexQdrantUrl: string;
    codebaseIndexEmbedderProvider:
      | "openai"
      | "ollama"
      | "openai-compatible"
      | "gemini"
      | "mistral"
      | "vercel-ai-gateway"
      | "bedrock"
      | "openrouter";
    codebaseIndexVectorStoreProvider?: "lancedb" | "qdrant"; // kade_change
    codebaseIndexLancedbVectorStoreDirectory?: string; // kade_change
    codebaseIndexEmbedderBaseUrl?: string;
    codebaseIndexEmbedderModelId: string;
    codebaseIndexEmbedderModelDimension?: number; // Generic dimension for all providers
    codebaseIndexOpenAiCompatibleBaseUrl?: string;
    codebaseIndexBedrockRegion?: string;
    codebaseIndexBedrockProfile?: string;
    codebaseIndexSearchMaxResults?: number;
    codebaseIndexSearchMinScore?: number;
    // kade_change start
    codebaseIndexEmbeddingBatchSize?: number;
    codebaseIndexScannerMaxBatchRetries?: number;
    // kade_change end
    codebaseIndexOpenRouterSpecificProvider?: string; // OpenRouter provider routing
    codebaseIndexIncludePaths?: string[];

    // Secret settings
    codeIndexOpenAiKey?: string;
    codeIndexQdrantApiKey?: string;
    codebaseIndexOpenAiCompatibleApiKey?: string;
    codebaseIndexGeminiApiKey?: string;
    codebaseIndexMistralApiKey?: string;
    codebaseIndexVercelAiGatewayApiKey?: string;
    codebaseIndexOpenRouterApiKey?: string;
  };
  updatedSettings?: RooCodeSettings;
  subAgentApiConfiguration?: ProviderSettings;
}

// kade_change: Create discriminated union for type-safe messages
export type MaybeTypedWebviewMessage =
  | WebviewMessage
  | UpdateGlobalStateMessage;

// kade_change begin
export type OrganizationRole = "owner" | "admin" | "member";

export type UserOrganizationWithApiKey = {
  id: string;
  name: string;
  balance: number;
  role: OrganizationRole;
  apiKey: string;
};

export type ProfileData = {
  kilocodeToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string;
  };
  organizations?: UserOrganizationWithApiKey[];
};

export interface ProfileDataResponsePayload {
  success: boolean;
  data?: ProfileData;
  error?: string;
}

export interface BalanceDataResponsePayload {
  // New: Payload for balance data
  success: boolean;
  data?: any; // Replace 'any' with a more specific type if known for balance
  error?: string;
}

export interface SeeNewChangesPayload {
  commitRange: CommitRange;
}

export interface TasksByIdRequestPayload {
  requestId: string;
  taskIds: string[];
}

export interface TaskHistoryRequestPayload {
  requestId: string;
  workspace: "current" | "all";
  sort: "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant";
  favoritesOnly: boolean;
  pageIndex: number;
  search?: string;
  pageSize?: number; // Optional page size, defaults to 10
}

export interface TasksByIdResponsePayload {
  requestId: string;
  tasks: HistoryItem[];
}

export interface TaskHistoryResponsePayload {
  requestId: string;
  historyItems: HistoryItem[];
  pageIndex: number;
  pageCount: number;
}
// kade_change end

export const checkoutDiffPayloadSchema = z.object({
  ts: z.number().optional(),
  previousCommitHash: z.string().optional(),
  commitHash: z.string(),
  mode: z.enum(["full", "checkpoint", "from-init", "to-current"]),
});

export type CheckpointDiffPayload = z.infer<typeof checkoutDiffPayloadSchema>;

export const checkoutRestorePayloadSchema = z.object({
  ts: z.number(),
  commitHash: z.string(),
  mode: z.enum(["preview", "restore"]),
});

export type CheckpointRestorePayload = z.infer<
  typeof checkoutRestorePayloadSchema
>;

export const requestCheckpointRestoreApprovalPayloadSchema = z.object({
  commitHash: z.string(),
  checkpointTs: z.number(),
  messagesToRemove: z.number(),
  confirmationText: z.string(),
});

export type RequestCheckpointRestoreApprovalPayload = z.infer<
  typeof requestCheckpointRestoreApprovalPayloadSchema
>;

export interface IndexingStatusPayload {
  state: "Standby" | "Indexing" | "Indexed" | "Error";
  message: string;
}

export interface IndexClearedPayload {
  success: boolean;
  error?: string;
}

export const installMarketplaceItemWithParametersPayloadSchema = z.object({
  item: marketplaceItemSchema,
  parameters: z.record(z.string(), z.any()),
});

export type InstallMarketplaceItemWithParametersPayload = z.infer<
  typeof installMarketplaceItemWithParametersPayloadSchema
>;

export type WebViewMessagePayload =
  // kade_change start
  | ProfileDataResponsePayload
  | BalanceDataResponsePayload
  | SeeNewChangesPayload
  | TasksByIdRequestPayload
  | TaskHistoryRequestPayload
  | RequestCheckpointRestoreApprovalPayload
  // kade_change end
  | CheckpointDiffPayload
  | CheckpointRestorePayload
  | IndexingStatusPayload
  | IndexClearedPayload
  | InstallMarketplaceItemWithParametersPayload
  | UpdateTodoListPayload
  | EditQueuedMessagePayload
  | RemoveQueuedMessagePayload
  | SendQueuedMessageNowPayload;
