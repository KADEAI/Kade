import type {
	GlobalSettings,
	ProviderSettingsEntry,
	ProviderSettings,
	ModelInfo, // kilocode_change
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
} from "@roo-code/types"

import { GitCommit } from "../utils/git"

export const WAITING_FOR_USER_INPUT_TEXT = "Waiting for user input..."

import { McpServer } from "./mcp"
import { McpMarketplaceCatalog, McpDownloadResponse } from "./kilocode/mcp"
import { Mode } from "./modes"
import { ModelRecord, RouterModels } from "./api"
// kilocode_change start
import {
	ProfileDataResponsePayload,
	BalanceDataResponsePayload,
	TaskHistoryResponsePayload,
	TasksByIdResponsePayload,
} from "./WebviewMessage"
import { ClineRulesToggles } from "./cline-rules"
import { KiloCodeWrapperProperties } from "./kilocode/wrapper"
import { DeploymentRecord } from "../api/providers/fetchers/sap-ai-core"
import { STTSegment } from "./sttContract" // kilocode_change: STT segment type
// kilocode_change end

// Command interface for frontend/backend communication
export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}

// Type for marketplace installed metadata
export interface MarketplaceInstalledMetadata {
	project: Record<string, { type: string }>
	global: Record<string, { type: string }>
}

// Indexing status types
export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
	gitBranch?: string // Current git branch being indexed
	manifest?: {
		totalFiles: number
		totalChunks: number
		lastUpdated: string
	}
}

export interface IndexingStatusUpdateMessage {
	type: "indexingStatusUpdate"
	values: IndexingStatus
}

export interface LanguageModelChatSelector {
	vendor?: string
	family?: string
	version?: string
	id?: string
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
	| "cliProxyModels" // kilocode_change: CLI Proxy models
	| "huggingFaceModels"
	| "sapAiCoreModels" // kilocode_change
	| "sapAiCoreDeployments" // kilocode_change
	| "vsCodeLmApiAvailable"
	| "updatePrompt"
	| "systemPrompt"
	| "autoApprovalEnabled"
	| "yoloMode" // kilocode_change
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
	| "insertTextToChatArea" // kilocode_change
	| "browserToolEnabled"
	| "browserConnectionResult"
	| "remoteBrowserEnabled"
	| "ttsStart"
	| "ttsStop"
	| "maxReadFileLine"
	| "fileSearchResults"
	| "toggleApiConfigPin"
	| "mcpMarketplaceCatalog" // kilocode_change
	| "mcpDownloadDetails" // kilocode_change
	| "showSystemNotification" // kilocode_change
	| "openInBrowser" // kilocode_change
	| "acceptInput"
	| "focusChatInput" // kilocode_change
	| "stt:started" // kilocode_change: STT session started
	| "stt:transcript" // kilocode_change: STT transcript update
	| "stt:volume" // kilocode_change: STT volume level
	| "stt:stopped" // kilocode_change: STT session stopped
	| "setHistoryPreviewCollapsed"
	| "commandExecutionStatus"
	| "mcpExecutionStatus"
	| "vsCodeSetting"
	| "protocolReset"
	| "profileDataResponse" // kilocode_change
	| "balanceDataResponse" // kilocode_change
	| "updateProfileData" // kilocode_change
	| "profileConfigurationForEditing" // kilocode_change: Response with profile config for editing
	| "authenticatedUser"
	| "condenseTaskContextStarted"
	| "condenseTaskContextResponse"
	| "singleRouterModelFetchResponse"
	| "rooCreditBalance"
	| "indexingStatusUpdate"
	| "indexCleared"
	| "codebaseIndexConfig"
	| "rulesData" // kilocode_change
	| "marketplaceInstallResult"
	| "marketplaceRemoveResult"
	| "installedSkillsData"
	| "marketplaceData"
	| "mermaidFixResponse" // kilocode_change
	| "tasksByIdResponse" // kilocode_change
	| "taskHistoryResponse" // kilocode_change
	| "shareTaskSuccess"
	| "codeIndexSettingsSaved"
	| "codeIndexSecretStatus"
	| "showDeleteMessageDialog"
	| "showEditMessageDialog"
	| "kilocodeNotificationsResponse" // kilocode_change
	| "usageDataResponse" // kilocode_change
	| "resourceMonitorData" // kilocode_change
	| "keybindingsResponse" // kilocode_change
	| "autoPurgeEnabled" // kilocode_change
	| "autoPurgeDefaultRetentionDays" // kilocode_change
	| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
	| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
	| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
	| "manualPurge" // kilocode_change
	| "commands"
	| "insertTextIntoTextarea"
	| "dismissedUpsells"
	| "interactionRequired"
	| "managedIndexerState" // kilocode_change
	| "managedIndexerEnabled" // kilocode_change
	| "browserSessionUpdate"
	| "browserLiveScreenshot"
	| "browserSessionNavigate"
	| "organizationSwitchResult"
	| "showTimestamps" // kilocode_change
	| "apiMessagesSaved" // kilocode_change: File save event for API messages
	| "taskMessagesSaved" // kilocode_change: File save event for task messages
	| "taskMetadataSaved" // kilocode_change: File save event for task metadata
	| "singleCompletionResult" // kilocode_change
	| "deviceAuthStarted" // kilocode_change: Device auth initiated
	| "deviceAuthPolling" // kilocode_change: Device auth polling update
	| "deviceAuthComplete" // kilocode_change: Device auth successful
	| "deviceAuthFailed" // kilocode_change: Device auth failed
	| "deviceAuthCancelled" // kilocode_change: Device auth cancelled
	| "chatCompletionResult" // kilocode_change: FIM completion result for chat text area
	| "openAiCodexRateLimits" // kilocode_change
	| "claudeCodeRateLimits" // kilocode_change
	| "request" // kilocode_change: for generic request/response pattern
	| "response" // kilocode_change: for generic request/response pattern
	| "command" // kilocode_change: for generic command execution
	| "skillsData"
	| "skillsSearchResults"
	| "skillInstallResult"
	| "installedSkillsData"
	text?: string
	// kilocode_change start
	completionRequestId?: string // Correlation ID from request
	completionText?: string // The completed text
	completionError?: string // Error message if failed
	response?: any
	payload?:
	| ProfileDataResponsePayload
	| BalanceDataResponsePayload
	| TasksByIdResponsePayload
	| TaskHistoryResponsePayload
	| [string, string] // For file save events [taskId, filePath]
	// kilocode_change end
	// Checkpoint warning message
	checkpointWarning?: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	action?:
	| "chatButtonClicked"
	| "settingsButtonClicked"
	| "historyButtonClicked"
	| "promptsButtonClicked" // kilocode_change
	| "profileButtonClicked" // kilocode_change
	| "marketplaceButtonClicked"
	| "mcpButtonClicked" // kilocode_change
	| "cloudButtonClicked"
	| "didBecomeVisible"
	| "focusInput"
	| "switchTab"
	| "focusChatInput" // kilocode_change
	| "toggleAutoApprove"
	invoke?: "newChat" | "sendMessage" | "primaryButtonClick" | "secondaryButtonClick" | "setChatBoxMessage"
	state?: ExtensionState
	screenshot?: string // For browserLiveScreenshot
	images?: string[]
	filePaths?: string[]
	openedTabs?: Array<{
		label: string
		isActive: boolean
		path?: string
	}>
	clineMessage?: ClineMessage
	routerModels?: RouterModels
	subAgentApiConfiguration?: ProviderSettings
	openAiModels?: string[]
	ollamaModels?: ModelRecord
	lmStudioModels?: ModelRecord
	cliProxyModels?: ModelRecord // kilocode_change: CLI Proxy models
	vsCodeLmModels?: { vendor?: string; family?: string; version?: string; id?: string }[]
	huggingFaceModels?: Array<{
		id: string
		object: string
		created: number
		owned_by: string
		providers: Array<{
			provider: string
			status: "live" | "staging" | "error"
			supports_tools?: boolean
			supports_structured_output?: boolean
			context_length?: number
			pricing?: {
				input: number
				output: number
			}
		}>
	}>
	sapAiCoreModels?: ModelRecord // kilocode_change
	sapAiCoreDeployments?: DeploymentRecord // kilocode_change
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	apiConfiguration?: ProviderSettings // kilocode_change: For profileConfigurationForEditing response
	mode?: Mode
	customMode?: ModeConfig
	slug?: string
	success?: boolean
	skills?: any[] // For skills data
	skillSource?: string // For skill installation
	skillId?: string // For skill installation
	query?: string // For skills search query
	values?: Record<string, any>
	sessionId?: string // kilocode_change: STT session ID
	segments?: STTSegment[] // kilocode_change: STT transcript segments (complete state)
	isFinal?: boolean // kilocode_change: STT transcript is final
	level?: number // kilocode_change: STT volume level (0-1)
	reason?: "completed" | "cancelled" | "error" // kilocode_change: STT stop reason
	taskId?: string // kilocode_change: Task ID for message updates
	requestId?: string
	promptText?: string
	results?: { path: string; type: "file" | "folder"; label?: string }[]
	error?: string
	mcpMarketplaceCatalog?: McpMarketplaceCatalog // kilocode_change
	mcpDownloadDetails?: McpDownloadResponse // kilocode_change
	notificationOptions?: {
		title?: string
		subtitle?: string
		message: string
	} // kilocode_change
	url?: string // kilocode_change
	keybindings?: Record<string, string> // kilocode_change
	setting?: string
	value?: any
	hasContent?: boolean // For checkRulesDirectoryResult
	items?: MarketplaceItem[]
	userInfo?: CloudUserInfo
	organizationAllowList?: OrganizationAllowList
	tab?: string
	// kilocode_change: Rules data
	globalRules?: ClineRulesToggles
	localRules?: ClineRulesToggles
	globalWorkflows?: ClineRulesToggles
	localWorkflows?: ClineRulesToggles
	marketplaceItems?: MarketplaceItem[]
	organizationMcps?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	fixedCode?: string | null // For mermaidFixResponse // kilocode_change
	errors?: string[]
	visibility?: ShareVisibility
	rulesFolderPath?: string
	settings?: any
	messageTs?: number
	hasCheckpoint?: boolean
	context?: string
	// kilocode_change start: Notifications
	notifications?: Array<{
		id: string
		title: string
		message: string
		action?: {
			actionText: string
			actionURL: string
		}
	}>
	// kilocode_change end
	commands?: Command[]
	queuedMessages?: QueuedMessage[]
	list?: string[] // For dismissedUpsells
	organizationId?: string | null // For organizationSwitchResult
	// kilocode_change start: Managed Indexer
	managedIndexerEnabled?: boolean
	managedIndexerState?: Array<{
		workspaceFolderPath: string
		workspaceFolderName: string
		gitBranch: string | null
		projectId: string | null
		isIndexing: boolean
		hasManifest: boolean
		manifestFileCount: number
		hasWatcher: boolean
		error?: {
			type: string
			message: string
			timestamp: string
			context?: {
				filePath?: string
				branch?: string
				operation?: string
			}
		}
	}> // kilocode_change end: Managed Indexer
	browserSessionMessages?: ClineMessage[] // For browser session panel updates
	isBrowserSessionActive?: boolean // For browser session panel updates
	stepIndex?: number // For browserSessionNavigate: the target step index to display
	// kilocode_change start: Device auth data
	deviceAuthCode?: string
	deviceAuthVerificationUrl?: string
	deviceAuthExpiresIn?: number
	deviceAuthTimeRemaining?: number
	deviceAuthToken?: string
	deviceAuthUserEmail?: string
	deviceAuthError?: string
	installedSkills?: Array<{ id: string; name: string; path: string; content?: string }>
	enabledSkills?: string[]
	// kilocode_change end: Device auth data
}

export type ExtensionState = Pick<
	GlobalSettings,
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiConfigs"
	| "customInstructions"
	| "dismissedUpsells"
	| "autoApprovalEnabled"
	| "proLicenseKey"
	| "yoloMode" // kilocode_change
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowDelete" // kilocode_change
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
	| "browserViewportSize"
	| "showAutoApproveMenu" // kilocode_change
	| "disableBrowserHeadless" // kilocode_change
	| "hideCostBelowThreshold" // kilocode_change
	| "screenshotQuality"
	| "remoteBrowserEnabled"
	| "cachedChromeHostUrl"
	| "remoteBrowserHost"
	| "ttsEnabled"
	| "ttsSpeed"
	| "soundEnabled"
	| "soundVolume"
	| "maxConcurrentFileReads"
	| "allowVeryLargeReads" // kilocode_change
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
	| "morphApiKey" // kilocode_change: Morph fast apply - global setting
	| "fastApplyModel" // kilocode_change: Fast Apply model selection
	| "fastApplyApiProvider" // kilocode_change: Fast Apply model api base url
	// | "experiments" // Optional in GlobalSettings, required here.
	| "language"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "localWorkflowToggles" // kilocode_change
	| "globalRulesToggles" // kilocode_change
	| "localRulesToggles" // kilocode_change
	| "globalWorkflowToggles" // kilocode_change
	| "commitMessageApiConfigId" // kilocode_change
	| "terminalCommandApiConfigId" // kilocode_change
	| "dismissedNotificationIds" // kilocode_change
	| "ghostServiceSettings" // kilocode_change
	| "autoPurgeEnabled" // kilocode_change
	| "autoPurgeDefaultRetentionDays" // kilocode_change
	| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
	| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
	| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
	| "autoPurgeLastRunTimestamp" // kilocode_change
	| "condensingApiConfigId"
	| "customCondensingPrompt"
	| "yoloGatekeeperApiConfigId" // kilocode_change: AI gatekeeper for YOLO mode
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
	| "systemNotificationsEnabled" // kilocode_change
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
	| "slidingWindowSize" // kilocode_change
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
> & {
	subAgentToolEnabled: boolean
	showSubAgentBanner: boolean
	enabledSkills?: string[]
	allowedCommands?: string[]
	deniedCommands?: string[]
	alwaysAllowWeb?: boolean
	version: string
	clineMessages: ClineMessage[]
	activeTaskIds?: string[] // kilocode_change: track active tasks
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	apiConfiguration: ProviderSettings
	subAgentApiConfiguration?: ProviderSettings
	uriScheme?: string
	uiKind?: string // kilocode_change

	kiloCodeWrapperProperties?: KiloCodeWrapperProperties // kilocode_change: Wrapper information

	kilocodeDefaultModel: string
	shouldShowAnnouncement: boolean

	taskHistoryFullLength: number // kilocode_change
	taskHistoryVersion: number // kilocode_change

	writeDelayMs: number
	requestDelaySeconds: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint initialization in seconds (default: 15)
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .kilocodeignore'd files in listings
	maxReadFileLine: number // Maximum number of lines to read from a file before truncating
	showAutoApproveMenu: boolean // kilocode_change: Whether to show the auto-approve menu in the chat view
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean
	enableMcpServerCreation: boolean

	mode: Mode
	customModes: ModeConfig[]
	toolRequirements?: Record<string, boolean> // Map of tool names to their requirements (e.g. {"apply_diff": true} if diffEnabled)

	cwd?: string // Current working directory
	telemetrySetting: TelemetrySetting
	telemetryKey?: string
	machineId?: string

	renderContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean
	showTaskTimeline?: boolean // kilocode_change
	sendMessageOnEnter?: boolean // kilocode_change
	hideCostBelowThreshold?: number // kilocode_change
	collapseCodeToolsByDefault?: boolean

	cloudUserInfo: CloudUserInfo | null
	cloudIsAuthenticated: boolean
	cloudApiUrl?: string
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion?: number

	isBrowserSessionActive: boolean // Actual browser session state

	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	marketplaceItems?: MarketplaceItem[]
	marketplaceInstalledMetadata?: { project: Record<string, any>; global: Record<string, any> }
	skills?: any[] // For skills data
	skillSource?: string // For skill installation
	skillId?: string // For skill installation
	success?: boolean // For skill installation result
	error?: string // For error messages
	query?: string // For skills search query
	profileThresholds: Record<string, number>
	hasOpenedModeSelector: boolean
	openRouterImageApiKey?: string
	kiloCodeImageApiKey?: string
	openRouterUseMiddleOutTransform?: boolean
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	hasSystemPromptOverride?: boolean
	mdmCompliant?: boolean
	remoteControlEnabled: boolean
	taskSyncEnabled: boolean
	featureRoomoteControlEnabled: boolean
	virtualQuotaActiveModel?: { id: string; info: ModelInfo } // kilocode_change: Add virtual quota active model for UI display
	showTimestamps?: boolean // kilocode_change: Show timestamps in chat messages
	debug?: boolean
	// kilocode_change start: STT Configuration
	sttModelId?: string // For local model selection (e.g., "Xenova/whisper-tiny")
	sttProvider?: "openai" | "gemini" | "local"
	// kilocode_change end
	speechToTextStatus?: { available: boolean; reason?: "apiKeyMissing" | "ffmpegNotInstalled" } // kilocode_change: Speech-to-text availability status with failure reason
	undoneToolIds?: string[] // kilocode_change: List of tool IDs that have been undone
	acceptedToolIds?: string[] // kilocode_change: List of tool IDs that have been accepted/reviewed
	openAiCodexAccountId?: string
	openAiCodexAuthenticated?: boolean
	antigravityAuthenticated?: boolean
	antigravityEmail?: string
	antigravityProjectId?: string
	geminiCliAuthenticated?: boolean
	geminiCliEmail?: string
	geminiCliProjectId?: string
	claudeCodeAuthenticated?: boolean
	slidingWindowSize?: number // kilocode_change
}


export interface ClineSayTool {
	tool:
	| "editedExistingFile"
	| "appliedDiff"
	| "newFileCreated"
	| "codebaseSearch"
	| "readFile"
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
	| "deleteFile" // kilocode_change: Handles both files and directories
	| "mkdir"
	| "moveFile"
	| "wrap"
	| "execute_command"
	path?: string
	source?: string
	destination?: string
	isRename?: boolean
	isCopy?: boolean
	shouldDeleteSource?: boolean
	diff?: string
	content?: string
	// Unified diff statistics computed by the extension
	diffStats?: { added: number; removed: number }
	regex?: string
	filePattern?: string
	pattern?: string
	mode?: string
	reason?: string
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	additionalFileCount?: number // Number of additional files in the same read_file request
	lineNumber?: number
	query?: string
	effect?: string
	emotion?: string
	gui?: string
	color?: string
	bg?: string
	border?: string
	shadow?: string
	style?: string
	intensity?: string
	// kilocode_change start: Directory stats - only present when deleting directories
	stats?: {
		files: number
		directories: number
		size: number
		isComplete: boolean
	}
	// kilocode_change end
	batchFiles?: Array<{
		path: string
		lineSnippet: string
		isOutsideWorkspace?: boolean
		key: string
		content?: string
		lineRange?: { start: number; end: number }
	}>
	batchDiffs?: Array<{
		path: string
		changeCount: number
		key: string
		content: string
		// Per-file unified diff statistics computed by the extension
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>
	question?: string
	// kilocode_change start
	fastApplyResult?: {
		description?: string
		tokensIn?: number
		tokensOut?: number
		cost?: number
	}
	// kilocode_change end
	imageData?: string // Base64 encoded image data for generated images
	// Properties for runSlashCommand tool
	command?: string
	args?: string
	description?: string
	id?: string
	edits?: Array<{ oldText: string; newText: string; replaceAll?: boolean }>
	toolUseId?: string
	// Partial success info for multi-block edits
	partialSuccess?: {
		successCount: number
		totalCount: number
		failedBlocks: Array<{
			blockIndex: number
			error: string
			oldTextPreview?: string
		}>
	}
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
] as const

export type BrowserAction = (typeof browserActions)[number]

export interface ClineSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	size?: string
	text?: string
	executedCoordinate?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
	viewportWidth?: number
	viewportHeight?: number
}

export interface ClineAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
	response?: string
}

export interface ClineApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	// kilocode_change
	usageMissing?: boolean
	inferenceProvider?: string
	// kilocode_change end
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
	apiProtocol?: "anthropic" | "openai"
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled"
