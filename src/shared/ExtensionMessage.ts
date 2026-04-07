import type {
  GlobalSettings,
  ProviderSettingsEntry,
  ProviderSettings,
  ModelInfo, // kade_change
  HistoryItem,
  ModeConfig,
  TelemetrySetting,
  Experiments,
  ClineMessage,
  MarketplaceItem,
  TodoItem,
  CloudUserInfo,
  CloudOrganizationMembership,
  OrganizationAllowList,
  ShareVisibility,
  QueuedMessage,
  FormatterAvailability,
  ToolHeaderBackgroundConfig,
} from "@roo-code/types";

import { GitCommit } from "../utils/git";

export const WAITING_FOR_USER_INPUT_TEXT = "Waiting for user input...";

import { McpServer } from "./mcp";
import { McpMarketplaceCatalog, McpDownloadResponse } from "./kilocode/mcp";
import { Mode } from "./modes";
import { ModelRecord, RouterModels } from "./api";
// kade_change start
import {
  ProfileDataResponsePayload,
  BalanceDataResponsePayload,
  TaskHistoryResponsePayload,
  TasksByIdResponsePayload,
} from "./WebviewMessage";
import { ClineRulesToggles } from "./cline-rules";
import { KiloCodeWrapperProperties } from "./kilocode/wrapper";
import { DeploymentRecord } from "../api/providers/fetchers/sap-ai-core";
import { STTSegment } from "./sttContract"; // kade_change: STT segment type
// kade_change end

// Command interface for frontend/backend communication
export interface Command {
  name: string;
  source: "global" | "project" | "built-in";
  filePath?: string;
  description?: string;
  argumentHint?: string;
}

// Type for marketplace installed metadata
export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>;
  global: Record<string, { type: string }>;
}

export interface EmptyStateBackgroundOption {
  file: string;
  label: string;
  uri: string;
}

// Indexing status types
export interface IndexingStatus {
  systemStatus: string;
  message?: string;
  processedItems: number;
  totalItems: number;
  currentItemUnit?: string;
  workspacePath?: string;
  gitBranch?: string; // Current git branch being indexed
  manifest?: {
    totalFiles: number;
    totalChunks: number;
    lastUpdated: string;
  };
}

export interface IndexingStatusUpdateMessage {
  type: "indexingStatusUpdate";
  values: IndexingStatus;
}

export interface LanguageModelChatSelector {
  vendor?: string;
  family?: string;
  version?: string;
  id?: string;
}

// Represents JSON data that is sent from extension to webview, called
// ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or
// 'settingsButtonClicked' or 'hello'. Webview will hold state.
export interface ExtensionMessage {
  type:
    | "action"
    | "state"
    | "selectedImages"
    | "theme"
    | "workspaceUpdated"
    | "invoke"
    | "messageUpdated"
    | "mcpServers"
    | "enhancedPrompt"
    | "commitSearchResults"
    | "listApiConfig"
    | "routerModels"
    | "openAiModels"
    | "ollamaModels"
    | "lmStudioModels"
    | "vsCodeLmModels"
    | "cliProxyModels" // kade_change: CLI Proxy models
    | "huggingFaceModels"
    | "sapAiCoreModels" // kade_change
    | "sapAiCoreDeployments" // kade_change
    | "vsCodeLmApiAvailable"
    | "updatePrompt"
    | "systemPrompt"
    | "autoApprovalEnabled"
    | "yoloMode" // kade_change
    | "updateCustomMode"
    | "deleteCustomMode"
    | "exportModeResult"
    | "importModeResult"
    | "checkRulesDirectoryResult"
    | "deleteCustomModeCheck"
    | "currentCheckpointUpdated"
    | "checkpointInitWarning"
    | "showHumanRelayDialog"
    | "humanRelayResponse"
    | "humanRelayCancel"
    | "insertTextToChatArea" // kade_change
    | "browserToolEnabled"
    | "computerUseToolEnabled"
    | "browserConnectionResult"
    | "remoteBrowserEnabled"
    | "ttsStart"
    | "ttsStop"
    | "maxReadFileLine"
    | "fileSearchResults"
    | "toggleApiConfigPin"
    | "mcpMarketplaceCatalog" // kade_change
    | "mcpDownloadDetails" // kade_change
    | "showSystemNotification" // kade_change
    | "openInBrowser" // kade_change
    | "acceptInput"
    | "focusChatInput" // kade_change
    | "stt:started" // kade_change: STT session started
    | "stt:transcript" // kade_change: STT transcript update
    | "stt:volume" // kade_change: STT volume level
    | "stt:stopped" // kade_change: STT session stopped
    | "setHistoryPreviewCollapsed"
    | "commandExecutionStatus"
    | "mcpExecutionStatus"
    | "vsCodeSetting"
    | "protocolReset"
    | "profileDataResponse" // kade_change
    | "balanceDataResponse" // kade_change
    | "updateProfileData" // kade_change
    | "profileConfigurationForEditing" // kade_change: Response with profile config for editing
    | "authenticatedUser"
    | "condenseTaskContextStarted"
    | "condenseTaskContextResponse"
    | "singleRouterModelFetchResponse"
    | "rooCreditBalance"
    | "indexingStatusUpdate"
    | "indexCleared"
    | "codebaseIndexConfig"
    | "rulesData" // kade_change
    | "marketplaceInstallResult"
    | "marketplaceRemoveResult"
    | "installedSkillsData"
    | "marketplaceData"
    | "mermaidFixResponse" // kade_change
    | "tasksByIdResponse" // kade_change
    | "taskHistoryResponse" // kade_change
    | "shareTaskSuccess"
    | "codeIndexSettingsSaved"
    | "codeIndexSecretStatus"
    | "showDeleteMessageDialog"
    | "showEditMessageDialog"
    | "kilocodeNotificationsResponse" // kade_change
    | "usageDataResponse" // kade_change
    | "resourceMonitorData" // kade_change
    | "keybindingsResponse" // kade_change
    | "autoPurgeEnabled" // kade_change
    | "autoPurgeDefaultRetentionDays" // kade_change
    | "autoPurgeFavoritedTaskRetentionDays" // kade_change
    | "autoPurgeCompletedTaskRetentionDays" // kade_change
    | "autoPurgeIncompleteTaskRetentionDays" // kade_change
    | "manualPurge" // kade_change
    | "commands"
    | "insertTextIntoTextarea"
    | "dismissedUpsells"
    | "interactionRequired"
    | "managedIndexerState" // kade_change
    | "managedIndexerEnabled" // kade_change
    | "browserSessionUpdate"
    | "browserLiveScreenshot"
    | "browserSessionNavigate"
    | "organizationSwitchResult"
    | "showTimestamps" // kade_change
    | "apiMessagesSaved" // kade_change: File save event for API messages
    | "taskMessagesSaved" // kade_change: File save event for task messages
    | "taskMetadataSaved" // kade_change: File save event for task metadata
    | "singleCompletionResult" // kade_change
    | "deviceAuthStarted" // kade_change: Device auth initiated
    | "deviceAuthPolling" // kade_change: Device auth polling update
    | "deviceAuthComplete" // kade_change: Device auth successful
    | "deviceAuthFailed" // kade_change: Device auth failed
    | "deviceAuthCancelled" // kade_change: Device auth cancelled
    | "chatCompletionResult" // kade_change: FIM completion result for chat text area
    | "openAiCodexRateLimits" // kade_change
    | "claudeCodeRateLimits" // kade_change
    | "request" // kade_change: for generic request/response pattern
    | "response" // kade_change: for generic request/response pattern
    | "command" // kade_change: for generic command execution
    | "skillsData"
    | "skillsSearchResults"
    | "skillInstallResult"
    | "installedSkillsData"
    | "emptyStateBackgrounds";
  text?: string;
  // kade_change start
  completionRequestId?: string; // Correlation ID from request
  completionText?: string; // The completed text
  completionError?: string; // Error message if failed
  response?: any;
  payload?:
    | ProfileDataResponsePayload
    | BalanceDataResponsePayload
    | TasksByIdResponsePayload
    | TaskHistoryResponsePayload
    | [string, string]; // For file save events [taskId, filePath]
  // kade_change end
  // Checkpoint warning message
  checkpointWarning?: {
    type: "WAIT_TIMEOUT" | "INIT_TIMEOUT";
    timeout: number;
  };
  action?:
    | "chatButtonClicked"
    | "settingsButtonClicked"
    | "historyButtonClicked"
    | "promptsButtonClicked" // kade_change
    | "profileButtonClicked" // kade_change
    | "marketplaceButtonClicked"
    | "mcpButtonClicked" // kade_change
    | "cloudButtonClicked"
    | "didBecomeVisible"
    | "focusInput"
    | "switchTab"
    | "focusChatInput" // kade_change
    | "toggleAutoApprove";
  invoke?:
    | "newChat"
    | "sendMessage"
    | "primaryButtonClick"
    | "secondaryButtonClick"
    | "setChatBoxMessage";
  state?: ExtensionState;
  screenshot?: string; // For browserLiveScreenshot
  images?: string[];
  filePaths?: string[];
  openedTabs?: Array<{
    label: string;
    isActive: boolean;
    path?: string;
  }>;
  clineMessage?: ClineMessage;
  routerModels?: RouterModels;
  subAgentApiConfiguration?: ProviderSettings;
  openAiModels?: string[];
  ollamaModels?: ModelRecord;
  lmStudioModels?: ModelRecord;
  cliProxyModels?: ModelRecord; // kade_change: CLI Proxy models
  vsCodeLmModels?: {
    vendor?: string;
    family?: string;
    version?: string;
    id?: string;
  }[];
  huggingFaceModels?: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    providers: Array<{
      provider: string;
      status: "live" | "staging" | "error";
      supports_tools?: boolean;
      supports_structured_output?: boolean;
      context_length?: number;
      pricing?: {
        input: number;
        output: number;
      };
    }>;
  }>;
  sapAiCoreModels?: ModelRecord; // kade_change
  sapAiCoreDeployments?: DeploymentRecord; // kade_change
  mcpServers?: McpServer[];
  commits?: GitCommit[];
  listApiConfig?: ProviderSettingsEntry[];
  apiConfiguration?: ProviderSettings; // kade_change: For profileConfigurationForEditing response
  mode?: Mode;
  customMode?: ModeConfig;
  slug?: string;
  success?: boolean;
  skills?: any[]; // For skills data
  skillSource?: string; // For skill installation
  skillId?: string; // For skill installation
  query?: string; // For skills search query
  values?: Record<string, any>;
  sessionId?: string; // kade_change: STT session ID
  segments?: STTSegment[]; // kade_change: STT transcript segments (complete state)
  isFinal?: boolean; // kade_change: STT transcript is final
  level?: number; // kade_change: STT volume level (0-1)
  reason?: "completed" | "cancelled" | "error"; // kade_change: STT stop reason
  taskId?: string; // kade_change: Task ID for message updates
  requestId?: string;
  promptText?: string;
  results?: { path: string; type: "file" | "folder"; label?: string }[];
  error?: string;
  mcpMarketplaceCatalog?: McpMarketplaceCatalog; // kade_change
  mcpDownloadDetails?: McpDownloadResponse; // kade_change
  notificationOptions?: {
    title?: string;
    subtitle?: string;
    message: string;
  }; // kade_change
  url?: string; // kade_change
  keybindings?: Record<string, string>; // kade_change
  setting?: string;
  value?: any;
  hasContent?: boolean; // For checkRulesDirectoryResult
  items?: MarketplaceItem[];
  userInfo?: CloudUserInfo;
  organizationAllowList?: OrganizationAllowList;
  tab?: string;
  // kade_change: Rules data
  globalRules?: ClineRulesToggles;
  localRules?: ClineRulesToggles;
  globalWorkflows?: ClineRulesToggles;
  localWorkflows?: ClineRulesToggles;
  marketplaceItems?: MarketplaceItem[];
  organizationMcps?: MarketplaceItem[];
  marketplaceInstalledMetadata?: MarketplaceInstalledMetadata;
  fixedCode?: string | null; // For mermaidFixResponse // kade_change
  errors?: string[];
  visibility?: ShareVisibility;
  rulesFolderPath?: string;
  settings?: any;
  messageTs?: number;
  hasCheckpoint?: boolean;
  context?: string;
  // kade_change start: Notifications
  notifications?: Array<{
    id: string;
    title: string;
    message: string;
    action?: {
      actionText: string;
      actionURL: string;
    };
  }>;
  // kade_change end
  commands?: Command[];
  queuedMessages?: QueuedMessage[];
  list?: string[]; // For dismissedUpsells
  organizationId?: string | null; // For organizationSwitchResult
  // kade_change start: Managed Indexer
  managedIndexerEnabled?: boolean;
  managedIndexerState?: Array<{
    workspaceFolderPath: string;
    workspaceFolderName: string;
    gitBranch: string | null;
    projectId: string | null;
    isIndexing: boolean;
    hasManifest: boolean;
    manifestFileCount: number;
    hasWatcher: boolean;
    error?: {
      type: string;
      message: string;
      timestamp: string;
      context?: {
        filePath?: string;
        branch?: string;
        operation?: string;
      };
    };
  }>; // kade_change end: Managed Indexer
  browserSessionMessages?: ClineMessage[]; // For browser session panel updates
  isBrowserSessionActive?: boolean; // For browser session panel updates
  stepIndex?: number; // For browserSessionNavigate: the target step index to display
  // kade_change start: Device auth data
  deviceAuthCode?: string;
  deviceAuthVerificationUrl?: string;
  deviceAuthExpiresIn?: number;
  deviceAuthTimeRemaining?: number;
  deviceAuthToken?: string;
  deviceAuthUserEmail?: string;
  deviceAuthError?: string;
  installedSkills?: Array<{
    id: string;
    name: string;
    path: string;
    content?: string;
  }>;
  enabledSkills?: string[];
  // kade_change end: Device auth data
}

export type ExtensionState = Pick<
  GlobalSettings,
  | "currentApiConfigName"
  | "listApiConfigMeta"
  | "pinnedApiConfigs"
  | "customInstructions"
  | "dismissedUpsells"
  | "emptyStateBackground"
  | "chatBackground"
  | "autoApprovalEnabled"
  | "proLicenseKey"
  | "yoloMode" // kade_change
  | "alwaysAllowReadOnly"
  | "alwaysAllowReadOnlyOutsideWorkspace"
  | "alwaysAllowWrite"
  | "alwaysAllowWriteOutsideWorkspace"
  | "alwaysAllowWriteProtected"
  | "alwaysAllowDelete" // kade_change
  | "alwaysAllowBrowser"
  | "alwaysApproveResubmit"
  | "alwaysAllowMcp"
  | "alwaysAllowModeSwitch"
  | "alwaysAllowSubtasks"
  | "alwaysAllowFollowupQuestions"
  | "alwaysAllowExecute"
  | "alwaysAllowUpdateTodoList"
  | "alwaysAllowWeb"
  | "followupAutoApproveTimeoutMs"
  | "deniedCommands"
  | "allowedCommands"
  | "alwaysAllowWeb"
  | "allowedMaxRequests"
  | "allowedMaxCost"
  | "browserToolEnabled"
  | "computerUseToolEnabled"
  | "browserViewportSize"
  | "showAutoApproveMenu" // kade_change
  | "disableBrowserHeadless" // kade_change
  | "hideCostBelowThreshold" // kade_change
  | "screenshotQuality"
  | "remoteBrowserEnabled"
  | "cachedChromeHostUrl"
  | "remoteBrowserHost"
  | "ttsEnabled"
  | "ttsSpeed"
  | "soundEnabled"
  | "soundVolume"
  | "maxConcurrentFileReads"
  | "allowVeryLargeReads" // kade_change
  | "terminalOutputLineLimit"
  | "terminalOutputCharacterLimit"
  | "terminalShellIntegrationTimeout"
  | "terminalShellIntegrationDisabled"
  | "terminalCommandDelay"
  | "terminalPowershellCounter"
  | "terminalZshClearEolMark"
  | "terminalZshOhMy"
  | "terminalZshP10k"
  | "terminalZdotdir"
  | "terminalCompressProgressBar"
  | "diagnosticsEnabled"
  | "diffEnabled"
  | "fuzzyMatchThreshold"
  | "morphApiKey" // kade_change: Morph fast apply - global setting
  | "fastApplyModel" // kade_change: Fast Apply model selection
  | "fastApplyApiProvider" // kade_change: Fast Apply model api base url
  // | "experiments" // Optional in GlobalSettings, required here.
  | "language"
  | "modeApiConfigs"
  | "customModePrompts"
  | "customSupportPrompts"
  | "enhancementApiConfigId"
  | "localWorkflowToggles" // kade_change
  | "globalRulesToggles" // kade_change
  | "localRulesToggles" // kade_change
  | "globalWorkflowToggles" // kade_change
  | "commitMessageApiConfigId" // kade_change
  | "terminalCommandApiConfigId" // kade_change
  | "dismissedNotificationIds" // kade_change
  | "ghostServiceSettings" // kade_change
  | "autoPurgeEnabled" // kade_change
  | "autoPurgeDefaultRetentionDays" // kade_change
  | "autoPurgeFavoritedTaskRetentionDays" // kade_change
  | "autoPurgeCompletedTaskRetentionDays" // kade_change
  | "autoPurgeIncompleteTaskRetentionDays" // kade_change
  | "autoPurgeLastRunTimestamp" // kade_change
  | "condensingApiConfigId"
  | "customCondensingPrompt"
  | "yoloGatekeeperApiConfigId" // kade_change: AI gatekeeper for YOLO mode
  | "codebaseIndexConfig"
  | "codebaseIndexModels"
  | "profileThresholds"
  | "systemNotificationsEnabled" // kade_change
  | "includeDiagnosticMessages"
  | "maxDiagnosticMessages"
  | "imageGenerationProvider"
  | "openRouterImageGenerationSelectedModel"
  | "includeTaskHistoryInEnhance"
  | "reasoningBlockCollapsed"
  | "enterBehavior"
  | "includeCurrentTime"
  | "includeCurrentCost"
  | "maxGitStatusFiles"
  | "slidingWindowSize" // kade_change
  | "infinityEnabled"
  | "infinityPrompt"
  | "infinityIntervalMinutes"
  | "infinityIsRunning"
  | "infinityScheduleType"
  | "infinityScheduleHour"
  | "infinityScheduleMinute"
  | "infinityNextRunAt"
  | "infinitySavedPrompts"
  | "activeInfinityPromptId"
  | "toolHeaderBackgrounds"
  | "formatterSettings"
> & {
  subAgentToolEnabled: boolean;
  showSubAgentBanner: boolean;
  showPromptSuggestions: boolean;
  emptyStateBackgroundUri?: string;
  chatBackgroundUri?: string;
  toolHeaderBackgroundUris?: ToolHeaderBackgroundConfig;
  showVibeStyling?: boolean;
  enabledSkills?: string[];
  allowedCommands?: string[];
  deniedCommands?: string[];
  alwaysAllowWeb?: boolean;
  version: string;
  clineMessages: ClineMessage[];
  activeTaskIds?: string[]; // kade_change: track active tasks
  currentTaskItem?: HistoryItem;
  currentTaskIsStreaming?: boolean;
  currentTaskTodos?: TodoItem[]; // Initial todos for the current task
  apiConfiguration: ProviderSettings;
  subAgentApiConfiguration?: ProviderSettings;
  uriScheme?: string;
  uiKind?: string; // kade_change

  kiloCodeWrapperProperties?: KiloCodeWrapperProperties; // kade_change: Wrapper information

  kilocodeDefaultModel: string;
  shouldShowAnnouncement: boolean;

  taskHistoryFullLength: number; // kade_change
  taskHistoryVersion: number; // kade_change

  writeDelayMs: number;
  requestDelaySeconds: number;

  enableCheckpoints: boolean;
  checkpointTimeout: number; // Timeout for checkpoint initialization in seconds (default: 15)
  maxOpenTabsContext: number; // Maximum number of VSCode open tabs to include in context (0-500)
  maxWorkspaceFiles: number; // Maximum number of files to include in current working directory details (0-500)
  showRooIgnoredFiles: boolean; // Whether to show .kilocodeignore'd files in listings
  maxReadFileLine: number; // Maximum number of lines to read from a file before truncating
  showAutoApproveMenu: boolean; // kade_change: Whether to show the auto-approve menu in the chat view
  maxImageFileSize: number; // Maximum size of image files to process in MB
  maxTotalImageSize: number; // Maximum total size for all images in a single read operation in MB

  experiments: Experiments; // Map of experiment IDs to their enabled state

  mcpEnabled: boolean;
  enableMcpServerCreation: boolean;

  mode: Mode;
  customModes: ModeConfig[];
  toolRequirements?: Record<string, boolean>; // Map of tool names to their requirements (e.g. {"apply_diff": true} if diffEnabled)

  cwd?: string; // Current working directory
  telemetrySetting: TelemetrySetting;
  telemetryKey?: string;
  machineId?: string;

  renderContext: "sidebar" | "editor";
  settingsImportedAt?: number;
  historyPreviewCollapsed?: boolean;
  showTaskTimeline?: boolean; // kade_change
  sendMessageOnEnter?: boolean; // kade_change
  hideCostBelowThreshold?: number; // kade_change
  formatterAvailability?: FormatterAvailability;
  collapseCodeToolsByDefault?: boolean;

  cloudUserInfo: CloudUserInfo | null;
  cloudIsAuthenticated: boolean;
  cloudApiUrl?: string;
  cloudOrganizations?: CloudOrganizationMembership[];
  sharingEnabled: boolean;
  organizationAllowList: OrganizationAllowList;
  organizationSettingsVersion?: number;

  isBrowserSessionActive: boolean; // Actual browser session state

  autoCondenseContext: boolean;
  autoCondenseContextPercent: number;
  marketplaceItems?: MarketplaceItem[];
  marketplaceInstalledMetadata?: {
    project: Record<string, any>;
    global: Record<string, any>;
  };
  skills?: any[]; // For skills data
  skillSource?: string; // For skill installation
  skillId?: string; // For skill installation
  success?: boolean; // For skill installation result
  error?: string; // For error messages
  query?: string; // For skills search query
  profileThresholds: Record<string, number>;
  hasOpenedModeSelector: boolean;
  openRouterImageApiKey?: string;
  kiloCodeImageApiKey?: string;
  openRouterUseMiddleOutTransform?: boolean;
  messageQueue?: QueuedMessage[];
  lastShownAnnouncementId?: string;
  apiModelId?: string;
  mcpServers?: McpServer[];
  hasSystemPromptOverride?: boolean;
  mdmCompliant?: boolean;
  remoteControlEnabled: boolean;
  taskSyncEnabled: boolean;
  featureRoomoteControlEnabled: boolean;
  virtualQuotaActiveModel?: { id: string; info: ModelInfo }; // kade_change: Add virtual quota active model for UI display
  showTimestamps?: boolean; // kade_change: Show timestamps in chat messages
  debug?: boolean;
  // kade_change start: STT Configuration
  sttModelId?: string; // For local model selection (e.g., "Xenova/whisper-tiny")
  sttProvider?: "openai" | "gemini" | "local";
  // kade_change end
  speechToTextStatus?: {
    available: boolean;
    reason?: "apiKeyMissing" | "ffmpegNotInstalled";
  }; // kade_change: Speech-to-text availability status with failure reason
  undoneToolIds?: string[]; // kade_change: List of tool IDs that have been undone
  acceptedToolIds?: string[]; // kade_change: List of tool IDs that have been accepted/reviewed
  openAiCodexAccountId?: string;
  openAiCodexAuthenticated?: boolean;
  antigravityAuthenticated?: boolean;
  antigravityEmail?: string;
  antigravityProjectId?: string;
  zedAuthenticated?: boolean;
  zedGithubLogin?: string;
  geminiCliAuthenticated?: boolean;
  geminiCliEmail?: string;
  geminiCliProjectId?: string;
  claudeCodeAuthenticated?: boolean;
  slidingWindowSize?: number; // kade_change
};

export interface ClineSayTool {
  tool: // Legacy/raw tool names that can still appear in saved tasks and partial tool payloads.
  | "read"
    | "edit"
    | "web"
    | "fetch"
    | "research_web"
    | "agent"
    // Canonical tool names emitted by the current extension/webview pipeline.
    | "editedExistingFile"
    | "appliedDiff"
    | "newFileCreated"
    | "codebaseSearch"
    | "readFile"
    | "insertContent"
    | "searchAndReplace"
    | "fetchInstructions"
    | "listDirTopLevel"
    | "listDirRecursive"
    | "grep"
    | "glob"
    | "switchMode"
    | "newTask"
    | "finishTask"
    | "generateImage"
    | "imageGenerated"
    | "runSlashCommand"
    | "updateTodoList"
    | "fastContext"
    | "attempt_completion"
    | "deleteFile" // kade_change: Handles both files and directories
    | "mkdir"
    | "moveFile"
    | "wrap"
    | "bash";
  path?: string;
  source?: string;
  destination?: string;
  isRename?: boolean;
  isCopy?: boolean;
  shouldDeleteSource?: boolean;
  diff?: string;
  content?: string;
  // Unified diff statistics computed by the extension
  diffStats?: { added: number; removed: number };
  regex?: string;
  filePattern?: string;
  pattern?: string;
  mode?: string;
  reason?: string;
  isOutsideWorkspace?: boolean;
  isProtected?: boolean;
  additionalFileCount?: number; // Number of additional files in the same read request
  lineNumber?: number;
  query?: string;
  effect?: string;
  emotion?: string;
  gui?: string;
  color?: string;
  bg?: string;
  border?: string;
  shadow?: string;
  style?: string;
  intensity?: string;
  // kade_change start: Directory stats - only present when deleting directories
  stats?: {
    files: number;
    directories: number;
    size: number;
    isComplete: boolean;
  };
  // kade_change end
  batchFiles?: Array<{
    path: string;
    lineSnippet: string;
    isOutsideWorkspace?: boolean;
    key: string;
    content?: string;
    lineRange?: { start: number; end: number };
  }>;
  batchDiffs?: Array<{
    path: string;
    changeCount: number;
    key: string;
    content: string;
    // Per-file unified diff statistics computed by the extension
    diffStats?: { added: number; removed: number };
    diffs?: Array<{
      content: string;
      startLine?: number;
    }>;
  }>;
  question?: string;
  // kade_change start
  fastApplyResult?: {
    description?: string;
    tokensIn?: number;
    tokensOut?: number;
    cost?: number;
  };
  // kade_change end
  imageData?: string; // Base64 encoded image data for generated images
  // Properties for runSlashCommand tool
  command?: string;
  args?: string;
  description?: string;
  id?: string;
  todos?: TodoItem[];
  edits?: Array<{ oldText: string; newText: string; replaceAll?: boolean }>;
  toolUseId?: string;
  // Partial success info for multi-block edits
  partialSuccess?: {
    successCount: number;
    totalCount: number;
    failedBlocks: Array<{
      blockIndex: number;
      error: string;
      oldTextPreview?: string;
    }>;
  };
}

// Must keep in sync with system prompt.
export const browserActions = [
  "launch",
  "click",
  "hover",
  "type",
  "press",
  "scroll_down",
  "scroll_up",
  "resize",
  "close",
  "screenshot",
] as const;

export type BrowserAction = (typeof browserActions)[number];

export interface ClineSayBrowserAction {
  action: BrowserAction;
  coordinate?: string;
  size?: string;
  text?: string;
  executedCoordinate?: string;
}

export type BrowserActionResult = {
  screenshot?: string;
  logs?: string;
  currentUrl?: string;
  currentMousePosition?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

export interface ClineAskUseMcpServer {
  serverName: string;
  type: "use_mcp_tool" | "access_mcp_resource";
  toolName?: string;
  arguments?: string;
  uri?: string;
  response?: string;
}

export interface ClineApiReqInfo {
  request?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  cost?: number;
  // kade_change
  usageMissing?: boolean;
  inferenceProvider?: string;
  // kade_change end
  cancelReason?: ClineApiReqCancelReason;
  streamingFailedMessage?: string;
  apiProtocol?: "anthropic" | "openai";
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled";
