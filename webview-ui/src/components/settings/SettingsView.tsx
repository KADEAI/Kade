import React, {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { HistoryViewType } from "@/App" // kade_change
import {
	CheckCheck,
	SquareMousePointer,
	History, // kade_change
	Webhook,
	GitBranch,
	Bell,
	Database,
	SquareTerminal,
	FlaskConical,
	AlertTriangle,
	Globe,
	Info,
	Bot, // kade_change
	UserRound, // kade_change
	MessageSquare,
	Monitor,
	LucideIcon,
	// SquareSlash, // kade_change
	// Glasses, // kade_change
	Plug,
	Server,
	Users2,
	ArrowLeft,
	GitCommitVertical, // kade_change: Added for Checkpoints
	Zap, // kade_change: Added for Skills/Modes if needed
	Infinity, // kade_change: Added for Infinity
} from "lucide-react"

// kade_change
import { ensureBodyPointerEventsRestored } from "@/utils/fixPointerEvents"
import {
	type ProviderSettings,
	type ExperimentId,
	type TelemetrySetting,
	type ProfileType, // kade_change - autocomplete profile type system
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	ImageGenerationProvider,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ExtensionStateContextType, useExtensionState } from "../../context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
	AlertDialogHeader,
	AlertDialogFooter,
	Button,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	StandardTooltip,
} from "@src/components/ui"

import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import { SetCachedStateField, SetExperimentEnabled } from "./types"

import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"
import { AutoApproveSettings } from "./AutoApproveSettings"
import { BrowserSettings } from "./BrowserSettings"
import { CheckpointSettings } from "./CheckpointSettings"
import { DisplaySettings } from "./DisplaySettings" // kade_change
import { NotificationSettings } from "./NotificationSettings"
import { ContextManagementSettings } from "./ContextManagementSettings"
import { TerminalSettings } from "./TerminalSettings"
import { ExperimentalSettings } from "./ExperimentalSettings"
import { LanguageSettings } from "./LanguageSettings"
import { About } from "./About"
import { Section } from "./Section"
import PromptsSettings from "./PromptsSettings"
import McpView from "../kilocodeMcp/McpView" // kade_change
import deepEqual from "fast-deep-equal" // kade_change
import { GhostServiceSettingsView } from "../kilocode/settings/GhostServiceSettings" // kade_change
import { SlashCommandsSettings } from "./SlashCommandsSettings"
import { UISettings } from "./UISettings"
import ModesView from "../modes/ModesView"
import { SettingsSearch } from "./SettingsSearch"
import { SubAgentSettings } from "./SubAgentSettings"
import { SkillsSettings } from "./SkillsSettings"
import { InfinitySettings } from "./InfinitySettings"
import { useSearchIndexRegistry, SearchIndexProvider } from "./useSettingsSearch"
// import McpView from "../mcp/McpView" // kade_change: own view

export const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden bg-[#1e1e1e] font-sans"
export const settingsTabList =
	"w-52 data-[compact=true]:w-14 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden p-3 gap-1 bg-[#1e1e1e]"
export const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-10 px-3 py-2 box-border flex items-center rounded-lg text-vscode-foreground opacity-60 hover:opacity-100 hover:bg-white/[0.04] transition-all duration-200 data-[compact=true]:w-10 data-[compact=true]:px-0 data-[compact=true]:justify-center cursor-pointer"
export const settingsTabTriggerActive =
	"opacity-100 bg-white/[0.08] text-white font-medium shadow-sm cursor-default hover:bg-white/[0.08]"

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}
const sectionNames = [
	"providers",
	"autoApprove",
	"slashCommands",
	"browser",
	"checkpoints",
	"ghost", // kade_change
	"display", // kade_change
	"notifications",
	"contextManagement",
	"terminal",
	"modes",
	"subAgents",
	"skills",
	"infinity",
	"mcp",
	"prompts",
	"ui",
	"experimental",
	"language",
	"about",
] as const

export type SectionName = (typeof sectionNames)[number] // kade_change

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
	editingProfile?: string // kade_change - profile to edit
	historyViewType?: HistoryViewType // kade_change
	setHistoryViewType?: (value: HistoryViewType) => void // kade_change
}

// kade_change start - editingProfile
const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>((props, ref) => {
	const { onDone, targetSection, editingProfile, historyViewType, setHistoryViewType } = props
	// kade_change end - editingProfile
	const { t } = useAppTranslation()
	const [isSearchOpen, setIsSearchOpen] = useState(false)

	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, settingsImportedAt } = extensionState

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [activeTab, setActiveTab] = useState<SectionName>(
		targetSection && sectionNames.includes(targetSection as SectionName)
			? (targetSection as SectionName)
			: "providers",
	)

	const [editingApiConfigName, setEditingApiConfigName] = useState<string>(currentApiConfigName || "default") // kade_change: Track which profile is being edited separately from the active profile

	const scrollPositions = useRef<Record<SectionName, number>>(
		Object.fromEntries(sectionNames.map((s) => [s, 0])) as Record<SectionName, number>,
	)
	const contentRef = useRef<HTMLDivElement | null>(null)

	const prevApiConfigName = useRef(currentApiConfigName)
	const confirmDialogHandler = useRef<() => void>()

	const [cachedState, setCachedState] = useState(() => extensionState)

	// kade_change begin
	useEffect(() => {
		ensureBodyPointerEventsRestored()
	}, [isDiscardDialogShow])
	// kade_change end

	const {
		proLicenseKey,
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		allowedCommands,
		deniedCommands,
		allowedMaxRequests,
		allowedMaxCost,
		language,
		alwaysAllowBrowser,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysAllowWriteProtected,
		alwaysApproveResubmit,
		autoCondenseContext,
		autoCondenseContextPercent,
		browserToolEnabled,
		browserViewportSize,
		enableCheckpoints,
		checkpointTimeout,
		diffEnabled,
		experiments,
		morphApiKey, // kade_change
		fastApplyModel, // kade_change: Fast Apply model selection
		fastApplyApiProvider, // kade_change: Fast Apply model api base url
		fuzzyMatchThreshold,
		maxOpenTabsContext,
		maxWorkspaceFiles,
		mcpEnabled,
		requestDelaySeconds,
		remoteBrowserHost,
		screenshotQuality,
		soundEnabled,
		ttsEnabled,
		ttsSpeed,
		soundVolume,
		telemetrySetting,
		terminalOutputLineLimit,
		terminalOutputCharacterLimit,
		terminalShellIntegrationTimeout,
		terminalShellIntegrationDisabled, // Added from upstream
		terminalCommandDelay,
		terminalPowershellCounter,
		terminalZshClearEolMark,
		terminalZshOhMy,
		terminalZshP10k,
		terminalZdotdir,
		writeDelayMs,
		showRooIgnoredFiles,
		remoteBrowserEnabled,
		disableBrowserHeadless, // kade_change
		maxReadFileLine,
		showAutoApproveMenu, // kade_change
		showTaskTimeline, // kade_change
		sendMessageOnEnter, // kade_change
		showTimestamps, // kade_change
		hideCostBelowThreshold, // kade_change
		collapseCodeToolsByDefault,
		maxImageFileSize,
		maxTotalImageSize,
		terminalCompressProgressBar,
		maxConcurrentFileReads,
		allowVeryLargeReads, // kade_change
		terminalCommandApiConfigId, // kade_change
		condensingApiConfigId,
		customCondensingPrompt,
		customSupportPrompts,
		profileThresholds,
		systemNotificationsEnabled, // kade_change
		alwaysAllowFollowupQuestions,
		alwaysAllowUpdateTodoList,
		subAgentToolEnabled,
		showSubAgentBanner,
		enabledSkills,
		followupAutoApproveTimeoutMs,
		ghostServiceSettings, // kade_change
		// kade_change start - Auto-purge settings
		autoPurgeEnabled,
		autoPurgeDefaultRetentionDays,
		autoPurgeFavoritedTaskRetentionDays,
		autoPurgeCompletedTaskRetentionDays,
		autoPurgeIncompleteTaskRetentionDays,
		autoPurgeLastRunTimestamp,
		// kade_change end - Auto-purge settings
		includeDiagnosticMessages,
		maxDiagnosticMessages,
		includeTaskHistoryInEnhance,
		imageGenerationProvider,
		openRouterImageApiKey,
		kiloCodeImageApiKey,
		openRouterImageGenerationSelectedModel,
		reasoningBlockCollapsed,
		enterBehavior,
		includeCurrentTime,
		includeCurrentCost,
		maxGitStatusFiles,
		slidingWindowSize,
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
		subAgentApiConfiguration,
	} = cachedState

	const apiConfiguration = useMemo(() => cachedState.apiConfiguration ?? {}, [cachedState.apiConfiguration])

	useEffect(() => {
		// Update only when currentApiConfigName is changed.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration.
		if (prevApiConfigName.current === currentApiConfigName) {
			return
		}

		setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
		prevApiConfigName.current = currentApiConfigName
		setChangeDetected(false)
		// kade_change start - Don't reset editingApiConfigName if we have an editingProfile prop (from auth return)
		if (!editingProfile) {
			setEditingApiConfigName(currentApiConfigName || "default")
		}
		// kade_change end
	}, [currentApiConfigName, extensionState, editingProfile]) // kade_change

	// kade_change start: Set editing profile when prop changes (from auth return)
	useEffect(() => {
		if (editingProfile) {
			console.log("[SettingsView] Setting editing profile from prop:", editingProfile)
			setEditingApiConfigName(editingProfile)
			isLoadingProfileForEditing.current = true
			vscode.postMessage({
				type: "getProfileConfigurationForEditing",
				text: editingProfile,
			})
		}
	}, [editingProfile])
	// kade_change end

	// kade_change start
	const isLoadingProfileForEditing = useRef(false)
	const isSavingRef = useRef(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "profileConfigurationForEditing" && message.text === editingApiConfigName) {
				// Update cached state with the editing profile's configuration
				setCachedState((prevState) => ({
					...prevState,
					apiConfiguration: message.apiConfiguration,
				}))
				setChangeDetected(false)
				isLoadingProfileForEditing.current = false
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [editingApiConfigName])

	// Temporary way of making sure that the Settings view updates its local state properly when receiving
	// api keys from providers that support url callbacks. This whole Settings View needs proper with this local state thing later
	const { kilocodeToken, openRouterApiKey, glamaApiKey, requestyApiKey } = extensionState.apiConfiguration ?? {}
	useEffect(() => {
		setCachedState((prevCachedState) => ({
			...prevCachedState,
			apiConfiguration: {
				...prevCachedState.apiConfiguration,
				// Only set specific tokens/keys instead of spreading the entire
				// `prevCachedState.apiConfiguration` since it may contain unsaved changes
				kilocodeToken,
				openRouterApiKey,
				glamaApiKey,
				requestyApiKey,
			},
		}))
	}, [kilocodeToken, openRouterApiKey, glamaApiKey, requestyApiKey])

	useEffect(() => {
		// Only update if we're not already detecting changes
		// This prevents overwriting user changes that haven't been saved yet
		// Also skip if we're loading a profile for editing
		// If we are currently saving, we should accept the new extension state and reset the saving flag
		if ((!isChangeDetected || isSavingRef.current) && !isLoadingProfileForEditing.current) {
			if (isSavingRef.current) {
				isSavingRef.current = false
				setChangeDetected(false)
			}
			// When editing a different profile than the active one,
			// don't overwrite apiConfiguration from extensionState since it contains
			// the active profile's config, not the editing profile's config
			if (editingApiConfigName !== currentApiConfigName) {
				// Sync everything except apiConfiguration
				const { apiConfiguration: _, ...restOfExtensionState } = extensionState
				setCachedState((prevState) => ({
					...prevState,
					...restOfExtensionState,
				}))
			} else {
				// When editing the active profile, sync everything including apiConfiguration
				setCachedState(extensionState)
			}
		}
	}, [extensionState, isChangeDetected, editingApiConfigName, currentApiConfigName])
	// kade_change end

	// Bust the cache when settings are imported.
	useEffect(() => {
		if (settingsImportedAt) {
			setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
			setChangeDetected(false)
		}
	}, [settingsImportedAt, extensionState])

	const setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType> = useCallback((field, value) => {
		setCachedState((prevState) => {
			// kade_change start
			if (deepEqual(prevState[field], value)) {
				return prevState
			}
			// kade_change end

			setChangeDetected(true)
			return { ...prevState, [field]: value }
		})
	}, [])

	// kade_change start
	const setGhostServiceSettingsField = useCallback(
		<K extends keyof NonNullable<ExtensionStateContextType["ghostServiceSettings"]>>(
			field: K,
			value: NonNullable<ExtensionStateContextType["ghostServiceSettings"]>[K],
		) => {
			setCachedState((prevState) => {
				const currentSettings = prevState.ghostServiceSettings || {}
				if (currentSettings[field] === value) {
					return prevState
				}

				setChangeDetected(true)
				return {
					...prevState,
					ghostServiceSettings: {
						...currentSettings,
						[field]: value,
					},
				}
			})
		},
		[],
	)
	// kade_change end

	const setApiConfigurationField = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction: boolean = true) => {
			setCachedState((prevState) => {
				if (prevState.apiConfiguration?.[field] === value) {
					return prevState
				}

				const previousValue = prevState.apiConfiguration?.[field]

				// Only skip change detection for automatic initialization (not user actions)
				// This prevents the dirty state when the component initializes and auto-syncs values
				// Treat undefined, null, and empty string as uninitialized states
				const isInitialSync =
					!isUserAction &&
					(previousValue === undefined || previousValue === "" || previousValue === null) &&
					value !== undefined &&
					value !== "" &&
					value !== null

				if (!isInitialSync) {
					setChangeDetected(true)
				}
				return { ...prevState, apiConfiguration: { ...prevState.apiConfiguration, [field]: value } }
			})
		},
		[],
	)

	const setSubAgentApiConfigurationField = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => {
			setCachedState((prevState) => {
				const currentConfig = prevState.subAgentApiConfiguration || {}
				if (currentConfig[field] === value) {
					return prevState
				}
				setChangeDetected(true)
				return { 
					...prevState, 
					subAgentApiConfiguration: { ...currentConfig, [field]: value } 
				}
			})
		},
		[],
	)

	const setExperimentEnabled: SetExperimentEnabled = useCallback((id: ExperimentId, enabled: boolean) => {
		setCachedState((prevState) => {
			if (prevState.experiments?.[id] === enabled) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, experiments: { ...prevState.experiments, [id]: enabled } }
		})
	}, [])

	const setTelemetrySetting = useCallback((setting: TelemetrySetting) => {
		setCachedState((prevState) => {
			if (prevState.telemetrySetting === setting) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, telemetrySetting: setting }
		})
	}, [])

	const setImageGenerationProvider = useCallback((provider: ImageGenerationProvider) => {
		setCachedState((prevState) => {
			if (prevState.imageGenerationProvider !== provider) {
				setChangeDetected(true)
			}

			return { ...prevState, imageGenerationProvider: provider }
		})
	}, [])

	const setOpenRouterImageApiKey = useCallback((apiKey: string) => {
		setCachedState((prevState) => {
			if (prevState.openRouterImageApiKey !== apiKey) {
				setChangeDetected(true)
			}

			return { ...prevState, openRouterImageApiKey: apiKey }
		})
	}, [])

	const setKiloCodeImageApiKey = useCallback((apiKey: string) => {
		setCachedState((prevState) => {
			setChangeDetected(true)
			return { ...prevState, kiloCodeImageApiKey: apiKey }
		})
	}, [])

	const setSlidingWindowSize = useCallback((value: number) => {
		setCachedState((prevState) => {
			if (prevState.slidingWindowSize !== value) {
				setChangeDetected(true)
			}
			return { ...prevState, slidingWindowSize: value }
		})
	}, [])

	const setImageGenerationSelectedModel = useCallback((model: string) => {
		setCachedState((prevState) => {
			if (prevState.openRouterImageGenerationSelectedModel !== model) {
				setChangeDetected(true)
			}

			return { ...prevState, openRouterImageGenerationSelectedModel: model }
		})
	}, [])

	const setCustomSupportPromptsField = useCallback((prompts: Record<string, string | undefined>) => {
		setCachedState((prevState) => {
			const previousStr = JSON.stringify(prevState.customSupportPrompts)
			const newStr = JSON.stringify(prompts)

			if (previousStr === newStr) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, customSupportPrompts: prompts }
		})
	}, [])

	const isSettingValid = !errorMessage

	const handleSubmit = () => {
		if (isSettingValid) {
			isSavingRef.current = true
			vscode.postMessage({
				type: "updateSettings",
				updatedSettings: {
					language,
					alwaysAllowReadOnly: alwaysAllowReadOnly ?? undefined,
					alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? undefined,
					alwaysAllowWrite: alwaysAllowWrite ?? undefined,
					alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? undefined,
					alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? undefined,
					alwaysAllowExecute: alwaysAllowExecute ?? undefined,
					alwaysAllowBrowser: alwaysAllowBrowser ?? undefined,
					alwaysAllowMcp,
					alwaysAllowModeSwitch,
					allowedCommands: allowedCommands ?? [],
					deniedCommands: deniedCommands ?? [],
					// Note that we use `null` instead of `undefined` since `JSON.stringify`
					// will omit `undefined` when serializing the object and passing it to the
					// extension host. We may need to do the same for other nullable fields.
					allowedMaxRequests: allowedMaxRequests ?? null,
					allowedMaxCost: allowedMaxCost ?? null,
					autoCondenseContext,
					autoCondenseContextPercent,
					browserToolEnabled: browserToolEnabled ?? true,
					soundEnabled: soundEnabled ?? true,
					soundVolume: soundVolume ?? 0.5,
					ttsEnabled,
					ttsSpeed,
					diffEnabled: diffEnabled ?? true,
					enableCheckpoints: enableCheckpoints ?? false,
					checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
					browserViewportSize: browserViewportSize ?? "900x600",
					remoteBrowserHost: remoteBrowserEnabled ? remoteBrowserHost : undefined,
					remoteBrowserEnabled: remoteBrowserEnabled ?? false,
					disableBrowserHeadless: disableBrowserHeadless ?? false, // kade_change
					fuzzyMatchThreshold: fuzzyMatchThreshold ?? 1.0,
					writeDelayMs,
					screenshotQuality: screenshotQuality ?? 75,
					terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
					terminalOutputCharacterLimit: terminalOutputCharacterLimit ?? 50_000,
					terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? 30_000,
					terminalShellIntegrationDisabled,
					terminalCommandDelay,
					terminalPowershellCounter,
					terminalZshClearEolMark,
					terminalZshOhMy,
					terminalZshP10k,
					terminalZdotdir,
					terminalCompressProgressBar,
					mcpEnabled,
					alwaysApproveResubmit: alwaysApproveResubmit ?? false,
					requestDelaySeconds: requestDelaySeconds ?? 5,
					maxOpenTabsContext: Math.min(Math.max(0, maxOpenTabsContext ?? 20), 500),
					maxWorkspaceFiles: Math.min(Math.max(0, maxWorkspaceFiles ?? 200), 500),
					showRooIgnoredFiles: showRooIgnoredFiles ?? true,
					maxReadFileLine: maxReadFileLine ?? -1,
					maxImageFileSize: maxImageFileSize ?? 5,
					maxTotalImageSize: maxTotalImageSize ?? 20,
					maxConcurrentFileReads: cachedState.maxConcurrentFileReads ?? 5,
					includeDiagnosticMessages:
						includeDiagnosticMessages !== undefined ? includeDiagnosticMessages : true,
					maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
					alwaysAllowSubtasks,
					alwaysAllowUpdateTodoList,
					alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
					followupAutoApproveTimeoutMs,
					condensingApiConfigId: condensingApiConfigId || "",
					includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
					reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
					enterBehavior: enterBehavior ?? "send",
					includeCurrentTime: includeCurrentTime ?? true,
					includeCurrentCost: includeCurrentCost ?? true,
					maxGitStatusFiles: maxGitStatusFiles ?? 0,
					profileThresholds,
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
					imageGenerationProvider,
					openRouterImageApiKey,
					openRouterImageGenerationSelectedModel,
					experiments,
					customSupportPrompts,
					slidingWindowSize,
					subAgentApiConfiguration,
					subAgentToolEnabled,
					proLicenseKey,
					showSubAgentBanner,
					collapseCodeToolsByDefault,
					enabledSkills,
				} as any,
			})
			vscode.postMessage({ type: "subAgentToolEnabled", bool: subAgentToolEnabled })
			vscode.postMessage({ type: "showSubAgentBanner", bool: showSubAgentBanner })
			vscode.postMessage({ type: "ttsEnabled", bool: ttsEnabled })
			vscode.postMessage({ type: "ttsSpeed", value: ttsSpeed })
			vscode.postMessage({ type: "terminalCommandApiConfigId", text: terminalCommandApiConfigId || "" }) // kade_change
			vscode.postMessage({ type: "showAutoApproveMenu", bool: showAutoApproveMenu }) // kade_change
			vscode.postMessage({ type: "disableBrowserHeadless", bool: disableBrowserHeadless ?? false }) // kade_change
			vscode.postMessage({ type: "allowVeryLargeReads", bool: allowVeryLargeReads }) // kade_change
			vscode.postMessage({ type: "currentApiConfigName", text: currentApiConfigName })
			vscode.postMessage({ type: "showTaskTimeline", bool: showTaskTimeline }) // kade_change
			vscode.postMessage({ type: "sendMessageOnEnter", bool: sendMessageOnEnter }) // kade_change
			vscode.postMessage({ type: "showTimestamps", bool: showTimestamps }) // kade_change
			vscode.postMessage({ type: "hideCostBelowThreshold", value: hideCostBelowThreshold }) // kade_change
			vscode.postMessage({ type: "collapseCodeToolsByDefault", bool: collapseCodeToolsByDefault ?? false })
			vscode.postMessage({ type: "updateCondensingPrompt", text: customCondensingPrompt || "" })
			vscode.postMessage({ type: "setReasoningBlockCollapsed", bool: reasoningBlockCollapsed ?? true })
			vscode.postMessage({ type: "upsertApiConfiguration", text: editingApiConfigName, apiConfiguration, scope: "global" }) // kade_change: Save to editing profile instead of current active profile
			vscode.postMessage({ type: "telemetrySetting", text: telemetrySetting })
			vscode.postMessage({ type: "systemNotificationsEnabled", bool: systemNotificationsEnabled }) // kade_change
			vscode.postMessage({ type: "ghostServiceSettings", values: ghostServiceSettings }) // kade_change
			vscode.postMessage({ type: "morphApiKey", text: morphApiKey }) // kade_change
			vscode.postMessage({ type: "fastApplyModel", text: fastApplyModel }) // kade_change: Fast Apply model selection
			vscode.postMessage({ type: "fastApplyApiProvider", text: fastApplyApiProvider }) // kade_change: Fast Apply model api base url
			vscode.postMessage({ type: "kiloCodeImageApiKey", text: kiloCodeImageApiKey })
			vscode.postMessage({ type: "slidingWindowSize", value: slidingWindowSize })
			// kade_change start - Auto-purge settings
			vscode.postMessage({ type: "autoPurgeEnabled", bool: autoPurgeEnabled })
			vscode.postMessage({ type: "autoPurgeDefaultRetentionDays", value: autoPurgeDefaultRetentionDays })
			vscode.postMessage({
				type: "autoPurgeFavoritedTaskRetentionDays",
				value: autoPurgeFavoritedTaskRetentionDays ?? undefined,
			})
			vscode.postMessage({
				type: "autoPurgeCompletedTaskRetentionDays",
				value: autoPurgeCompletedTaskRetentionDays,
			})
			vscode.postMessage({
				type: "autoPurgeIncompleteTaskRetentionDays",
				value: autoPurgeIncompleteTaskRetentionDays,
			})
			// kade_change end - Auto-purge settings

			// kade_change: After saving, sync cachedState to extensionState without clobbering
			// the editing profile's apiConfiguration when editing a non-active profile.
			// COMMENTED OUT TO FIX BUG: This sync was overwriting local state with stale extensionState immediately after save.
			// if (editingApiConfigName !== currentApiConfigName) {
			// 	// Only sync non-apiConfiguration fields from extensionState
			// 	const { apiConfiguration: _, ...restOfExtensionState } = extensionState
			// 	setCachedState((prevState) => ({
			// 		...prevState,
			// 		...restOfExtensionState,
			// 	}))
			// } else {
			// 	// When editing the active profile, sync everything including apiConfiguration
			// 	setCachedState((prevState) => ({ ...prevState, ...extensionState }))
			// }
			// kade_change end
			// kade_change: Use isSavingRef to signal to the useEffect that the next
			// extensionState update should be accepted (and will reset isChangeDetected).
			// Also delay resetting isChangeDetected well past the debounce maxWait (300ms)
			// to prevent stale debounced state updates from overwriting the saved values.
			isSavingRef.current = true
			setTimeout(() => {
				setChangeDetected(false)
			}, 500)
		}
	}

	const checkUnsaveChanges = useCallback(
		(then: () => void) => {
			if (isChangeDetected) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[isChangeDetected],
	)

	useImperativeHandle(ref, () => ({ checkUnsaveChanges }), [checkUnsaveChanges])

	// kade_change start
	const onConfirmDialogResult = useCallback(
		(confirm: boolean) => {
			if (confirm) {
				// Discard changes: Reset state and flag
				setCachedState(extensionState) // Revert to original state
				setChangeDetected(false) // Reset change flag
				confirmDialogHandler.current?.() // Execute the pending action (e.g., tab switch)
			}
			// If confirm is false (Cancel), do nothing, dialog closes automatically
		},
		[setCachedState, setChangeDetected, extensionState], // Depend on extensionState to get the latest original state
	)

	// kade_change end


	// Handle tab changes with unsaved changes check
	const handleTabChange = useCallback(
		(newTab: SectionName) => {
			if (contentRef.current) {
				scrollPositions.current[activeTab] = contentRef.current.scrollTop
			}
			setActiveTab(newTab)
		},
		[activeTab],
	)

	useLayoutEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = scrollPositions.current[activeTab] ?? 0
		}
	}, [activeTab])

	// Store direct DOM element refs for each tab
	const tabRefs = useRef<Record<SectionName, HTMLButtonElement | null>>(
		Object.fromEntries(sectionNames.map((name) => [name, null])) as Record<SectionName, HTMLButtonElement | null>,
	)

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	const sections: { id: SectionName; icon: LucideIcon }[] = useMemo(
		() => [
			{ id: "providers", icon: Plug },
			{ id: "modes", icon: Users2 },
			{ id: "autoApprove", icon: CheckCheck },
			{ id: "subAgents", icon: UserRound },
			{ id: "skills", icon: Zap },
			{ id: "infinity", icon: Infinity },
			// { id: "slashCommands", icon: SquareSlash }, // kade_change: needs work to be re-introduced
			{ id: "browser", icon: SquareMousePointer },
			{ id: "checkpoints", icon: GitCommitVertical }, // kade_change: Updated to GitCommitVertical
			{ id: "display", icon: Monitor }, // kade_change
			{ id: "ghost" as const, icon: Bot }, // kade_change
			{ id: "notifications", icon: Bell },
			{ id: "contextManagement", icon: Database },
			{ id: "terminal", icon: SquareTerminal },
			{ id: "prompts", icon: MessageSquare },
			// { id: "ui", icon: Glasses }, // kade_change: we have our own display section
			{ id: "experimental", icon: FlaskConical },
			{ id: "language", icon: Globe },
			{ id: "mcp", icon: Server },
			{ id: "about", icon: Info },
		],
		[],
	)
	// Update target section logic to set active tab
	useEffect(() => {
		if (targetSection && sectionNames.includes(targetSection as SectionName)) {
			setActiveTab(targetSection as SectionName)
		}
	}, [targetSection]) // kade_change

	// kade_change start - Listen for messages to restore editing profile after auth
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (
				message.type === "action" &&
				message.action === "settingsButtonClicked" &&
				message.values?.editingProfile
			) {
				const profileToEdit = message.values.editingProfile as string
				console.log("[SettingsView] Restoring editing profile:", profileToEdit)
				setEditingApiConfigName(profileToEdit)
				// Request the profile's configuration for editing
				isLoadingProfileForEditing.current = true
				vscode.postMessage({
					type: "getProfileConfigurationForEditing",
					text: profileToEdit,
				})
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])
	// kade_change end

	// Function to scroll the active tab into view for vertical layout
	const scrollToActiveTab = useCallback(() => {
		const activeTabElement = tabRefs.current[activeTab]

		if (activeTabElement) {
			activeTabElement.scrollIntoView({
				behavior: "auto",
				block: "nearest",
			})
		}
	}, [activeTab])

	// Effect to scroll when the active tab changes
	useEffect(() => {
		scrollToActiveTab()
	}, [activeTab, scrollToActiveTab])

	// Effect to scroll when the webview becomes visible
	useLayoutEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "action" && message.action === "didBecomeVisible") {
				scrollToActiveTab()
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [scrollToActiveTab])

	// Search index registry - settings register themselves on mount
	const getSectionLabel = useCallback(
		(section: SectionName) => {
			if (section === "infinity") {
				return "Automations"
			}

			return t(`settings:sections.${section}`)
		},
		[t],
	)
	const { contextValue: searchContextValue, index: searchIndex } = useSearchIndexRegistry(getSectionLabel)

	// Track which tabs have been indexed (visited at least once)
	const [indexingTabIndex, setIndexingTabIndex] = useState(0)
	const initialTab = useRef<SectionName>(activeTab)
	const isIndexing = indexingTabIndex < sectionNames.length
	const isIndexingComplete = !isIndexing
	const tabTitlesRegistered = useRef(false)

	// Index all tabs by cycling through them on mount
	useLayoutEffect(() => {
		if (indexingTabIndex >= sectionNames.length) {
			// All tabs indexed, now register tab titles as searchable items
			if (!tabTitlesRegistered.current && searchContextValue) {
				sections.forEach(({ id }) => {
					const tabTitle = getSectionLabel(id)
					// Register each tab title as a searchable item
					// Using a special naming convention for tab titles: "tab-{sectionName}"
					searchContextValue.registerSetting({
						settingId: `tab-${id}`,
						section: id,
						label: tabTitle,
					})
				})
				tabTitlesRegistered.current = true
				// Return to initial tab
				setActiveTab(initialTab.current)
			}
			return
		}

		// Move to the next tab on next render
		setIndexingTabIndex((prev) => prev + 1)
	}, [getSectionLabel, indexingTabIndex, searchContextValue, sections])

	// Determine which tab content to render (for indexing or active display)
	const renderTab = isIndexing ? sectionNames[indexingTabIndex] : activeTab

	// Handle search navigation - switch to the correct tab and scroll to the element
	const handleSearchNavigate = useCallback(
		(section: SectionName, settingId: string) => {
			console.log("[SettingsView] Navigating to search result:", { section, settingId })
			// Switch to the correct tab
			handleTabChange(section)

			// Wait for the tab to render, then find element by settingId and scroll to it
			requestAnimationFrame(() => {
				setTimeout(() => {
					const element = document.querySelector(`[data-setting-id="${settingId}"]`)
					if (element) {
						element.scrollIntoView({ behavior: "smooth", block: "center" })

						// Add highlight animation
						element.classList.add("settings-highlight")
						setTimeout(() => {
							element.classList.remove("settings-highlight")
						}, 1500)
					}
				}, 100) // Small delay to ensure tab content is rendered
			})
		},
		[handleTabChange],
	)

	return (
		<Tab className="bg-[#1e1e1e] text-[#e4e4e7] font-sans">
			<TabHeader className="flex justify-between items-center gap-2 border-b border-white/[0.04] px-5 py-4 bg-[#1e1e1e]">
				<div className="flex items-center gap-2 grow">
					<StandardTooltip content={t("settings:header.doneButtonTooltip")}>
						<Button variant="ghost" className="px-2 hover:bg-white/[0.04] text-white/70 hover:text-white transition-colors" onClick={() => checkUnsaveChanges(onDone)}>
							<ArrowLeft className="w-4 h-4" />
							<span className="sr-only">{t("settings:common.done")}</span>
						</Button>
					</StandardTooltip>
					<h3 className="text-white/90 m-0 flex-shrink-0 flex items-center font-medium tracking-wide">
						{t("settings:header.title")}
						<span className="text-white/20 mx-3 text-sm font-light">/</span>
						<span className="text-white">
							{activeTab === "mcp"
								? t(`kilocode:settings.sections.mcp`)
								: activeTab === "ghost"
									? t(`kilocode:ghost.title`)
									: getSectionLabel(activeTab)}
						</span>
					</h3>
				</div>
				<div className="flex items-center gap-3 shrink-0">
					{isIndexingComplete && (
						<SettingsSearch index={searchIndex} onNavigate={handleSearchNavigate} sections={sections} />
					)}
					<StandardTooltip
						content={
							!isSettingValid
								? errorMessage
								: isChangeDetected
									? t("settings:header.saveButtonTooltip")
									: t("settings:header.nothingChangedTooltip")
						}>
						<Button
							variant={isSettingValid ? "primary" : "secondary"}
							className={cn(
								"px-6 transition-all duration-200 font-medium tracking-wide rounded-md",
								!isSettingValid && "!border-red-500/50 text-red-400",
								isSettingValid && isChangeDetected ? "bg-white text-black hover:bg-gray-100 shadow-[0_0_12px_rgba(255,255,255,0.2)]" : "bg-white/[0.04] text-white/50 border-white/[0.04] hover:bg-white/[0.08]"
							)}
							onClick={handleSubmit}
							disabled={!isChangeDetected || !isSettingValid}
							data-testid="save-button">
							{t("settings:common.save")}
						</Button>
					</StandardTooltip>
				</div>
			</TabHeader>

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={(value) => handleTabChange(value as SectionName)}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}
					data-testid="settings-tab-list">
					{sections.map(({ id, icon: Icon }) => {
						const isSelected = id === activeTab
						const onSelect = () => handleTabChange(id as SectionName)

						// Base TabTrigger component definition
						// We pass isSelected manually for styling, but onSelect is handled conditionally
						const triggerComponent = (
							<TabTrigger
								ref={(element) => (tabRefs.current[id as SectionName] = element)}
								value={id}
								isSelected={isSelected} // Pass manually for styling state
								className={cn(
									isSelected // Use manual isSelected for styling
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"cursor-pointer focus:ring-0", // Remove the focus ring styling
								)}
								data-testid={`tab-${id}`}
								data-compact={isCompactMode}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<Icon className="w-4 h-4" />
									<span className="tab-label flex items-center gap-2 w-full">
										{id === "mcp"
											? t(`kilocode:settings.sections.mcp`)
											: id === "ghost"
												? t(`kilocode:ghost.title`)
												: getSectionLabel(id)}
										{id === "subAgents" && (
											<span className="px-1.5 py-0.5 text-[9px] font-black bg-[#22c55e] text-black rounded-full ml-auto uppercase tracking-tighter shadow-[0_0_10px_rgba(34,197,94,0.3)]">
												NEW
											</span>
										)}
										{id === "skills" && (
											<span className="px-1.5 py-0.5 text-[9px] font-black bg-[#22c55e] text-black rounded-full ml-auto uppercase tracking-tighter shadow-[0_0_10px_rgba(34,197,94,0.3)]">
											NEW
											</span>
										)}
										{id === "infinity" && (
											<span className="px-1.5 py-0.5 text-[9px] font-black bg-[#22c55e] text-black rounded-full ml-auto uppercase tracking-tighter shadow-[0_0_10px_rgba(34,197,94,0.3)]">
												NEW
											</span>
										)}
									</span>
								</div>
							</TabTrigger>
						)

						if (isCompactMode) {
							// Wrap in Tooltip and manually add onClick to the trigger
							return (
								<TooltipProvider key={id} delayDuration={300}>
									<Tooltip>
										<TooltipTrigger asChild onClick={onSelect}>
											{/* Clone to avoid ref issues if triggerComponent itself had a key */}
											{React.cloneElement(triggerComponent)}
										</TooltipTrigger>
										<TooltipContent side="right" className="text-base">
											<div className="flex items-center gap-2">
												{id === "mcp"
													? t(`kilocode:settings.sections.mcp`)
													: id === "ghost"
														? t(`kilocode:ghost.title`)
														: getSectionLabel(id)}
												{id === "subAgents" && (
													<span className="px-1.5 py-0.5 text-[10px] font-black bg-[#22c55e] text-black rounded-full uppercase tracking-tighter">
														NEW
													</span>
												)}
												{id === "skills" && (
													<span className="px-1.5 py-0.5 text-[10px] font-black bg-[#22c55e] text-black rounded-full uppercase tracking-tighter">
														NEW
													</span>
												)}
												{id === "infinity" && (
													<span className="px-1.5 py-0.5 text-[10px] font-black bg-[#22c55e] text-black rounded-full uppercase tracking-tighter">
														NEW
													</span>
												)}
											</div>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)
						} else {
							// Render trigger directly; TabList will inject onSelect via cloning
							// Ensure the element passed to TabList has the key
							return React.cloneElement(triggerComponent, { key: id })
						}
					})}
				</TabList>

				{/* Content area */}
				<TabContent
					ref={contentRef}
					className={cn("p-0 flex-1 overflow-auto", isIndexing && "opacity-0")}
					data-testid="settings-content">
					<SearchIndexProvider value={searchContextValue}>
						{/* Providers Section */}
						{renderTab === "providers" && (
							<div>
								<Section>
									{/* kade_change start changes to allow for editting a non-active profile */}
									<ApiConfigManager
										currentApiConfigName={editingApiConfigName}
										activeApiConfigName={currentApiConfigName}
										listApiConfigMeta={listApiConfigMeta}
										onSelectConfig={(configName: string) => {
											checkUnsaveChanges(() => {
												setEditingApiConfigName(configName)
												// Set flag to prevent extensionState sync while loading
												isLoadingProfileForEditing.current = true
												// Request the profile's configuration for editing
												vscode.postMessage({
													type: "getProfileConfigurationForEditing",
													text: configName,
												})
											})
										}}
										onActivateConfig={(configName: string) => {
											vscode.postMessage({ type: "loadApiConfiguration", text: configName })
										}}
										onDeleteConfig={(configName: string) => {
											const isEditingProfile = configName === editingApiConfigName

											vscode.postMessage({ type: "deleteApiConfiguration", text: configName })

											// If deleting the editing profile, switch to another for editing
											if (isEditingProfile && listApiConfigMeta && listApiConfigMeta.length > 1) {
												const nextProfile = listApiConfigMeta.find((p) => p.name !== configName)
												if (nextProfile) {
													setEditingApiConfigName(nextProfile.name)
												}
											}
										}}
										onRenameConfig={(oldName: string, newName: string) => {
											vscode.postMessage({
												type: "renameApiConfiguration",
												values: { oldName, newName },
												apiConfiguration,
											})
											if (oldName === editingApiConfigName) {
												setEditingApiConfigName(newName)
											}
											// Update prevApiConfigName if renaming the active profile
											if (oldName === currentApiConfigName) {
												prevApiConfigName.current = newName
											}
										}}
										// kade_change start - autocomplete profile type system
										onUpsertConfig={(configName: string, profileType?: ProfileType) => {
											vscode.postMessage({
												type: "upsertApiConfiguration",
												text: configName,
												apiConfiguration: {
													...apiConfiguration,
													profileType: profileType || "chat",
												},
												scope: "global",
											})
											setEditingApiConfigName(configName)
										}}
									/>
									{/* kade_change end changes to allow for editting a non-active profile */}

									{/* kade_change start - pass editing profile name */}
									<ApiOptions
										uriScheme={uriScheme}
										apiConfiguration={apiConfiguration}
										setApiConfigurationField={setApiConfigurationField}
										errorMessage={errorMessage}
										setErrorMessage={setErrorMessage}
										currentApiConfigName={editingApiConfigName}
									/>
									{/* kade_change end - pass editing profile name */}
								</Section>
							</div>
						)}

						{/* Auto-Approve Section */}
						{renderTab === "autoApprove" && (
							<AutoApproveSettings
								showAutoApproveMenu={showAutoApproveMenu} // kade_change
								alwaysAllowReadOnly={alwaysAllowReadOnly}
								alwaysAllowReadOnlyOutsideWorkspace={alwaysAllowReadOnlyOutsideWorkspace}
								alwaysAllowWrite={alwaysAllowWrite}
								alwaysAllowWriteOutsideWorkspace={alwaysAllowWriteOutsideWorkspace}
								alwaysAllowWriteProtected={alwaysAllowWriteProtected}
								alwaysAllowBrowser={alwaysAllowBrowser}
								alwaysApproveResubmit={alwaysApproveResubmit}
								requestDelaySeconds={requestDelaySeconds}
								alwaysAllowMcp={alwaysAllowMcp}
								alwaysAllowModeSwitch={alwaysAllowModeSwitch}
								alwaysAllowSubtasks={alwaysAllowSubtasks}
								alwaysAllowExecute={alwaysAllowExecute}
								alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
								alwaysAllowUpdateTodoList={alwaysAllowUpdateTodoList}
								followupAutoApproveTimeoutMs={followupAutoApproveTimeoutMs}
								allowedCommands={allowedCommands}
								allowedMaxRequests={allowedMaxRequests ?? undefined}
								allowedMaxCost={allowedMaxCost ?? undefined}
								deniedCommands={deniedCommands}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Slash Commands Section */}
						{renderTab === "slashCommands" && <SlashCommandsSettings />}

						{/* Browser Section */}
						{renderTab === "browser" && (
							<BrowserSettings
								browserToolEnabled={browserToolEnabled}
								browserViewportSize={browserViewportSize}
								screenshotQuality={screenshotQuality}
								remoteBrowserHost={remoteBrowserHost}
								remoteBrowserEnabled={remoteBrowserEnabled}
								disableBrowserHeadless={disableBrowserHeadless} // kade_change
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Checkpoints Section */}
						{renderTab === "checkpoints" && (
							<CheckpointSettings
								enableCheckpoints={enableCheckpoints}
								checkpointTimeout={checkpointTimeout}
								setCachedStateField={setCachedStateField}
								// kade_change start
								autoPurgeEnabled={autoPurgeEnabled}
								autoPurgeDefaultRetentionDays={autoPurgeDefaultRetentionDays}
								autoPurgeFavoritedTaskRetentionDays={autoPurgeFavoritedTaskRetentionDays}
								autoPurgeCompletedTaskRetentionDays={autoPurgeCompletedTaskRetentionDays}
								autoPurgeIncompleteTaskRetentionDays={autoPurgeIncompleteTaskRetentionDays}
								autoPurgeLastRunTimestamp={autoPurgeLastRunTimestamp}
								onManualPurge={() => {
									vscode.postMessage({ type: "manualPurge" })
								}}
							// kade_change end
							/>
						)}

						{/* kade_change start display section */}
						{renderTab === "display" && (
							<DisplaySettings
								reasoningBlockCollapsed={reasoningBlockCollapsed ?? true}
								showTaskTimeline={showTaskTimeline}
								historyViewType={historyViewType} // kade_change
								setHistoryViewType={setHistoryViewType} // kade_change
								sendMessageOnEnter={sendMessageOnEnter}
								showTimestamps={cachedState.showTimestamps} // kade_change
								hideCostBelowThreshold={hideCostBelowThreshold}
								collapseCodeToolsByDefault={collapseCodeToolsByDefault}
								showSubAgentBanner={showSubAgentBanner}
								setCachedStateField={setCachedStateField}
							/>
						)}
						{renderTab === "ghost" && (
							<GhostServiceSettingsView
								ghostServiceSettings={ghostServiceSettings}
								onGhostServiceSettingsChange={setGhostServiceSettingsField}
							/>
						)}
						{/* kade_change end display section */}

						{/* Notifications Section */}
						{renderTab === "notifications" && (
							<NotificationSettings
								ttsEnabled={ttsEnabled}
								ttsSpeed={ttsSpeed}
								soundEnabled={soundEnabled}
								soundVolume={soundVolume}
								systemNotificationsEnabled={systemNotificationsEnabled}
								areSettingsCommitted={!isChangeDetected}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Context Management Section */}
						{renderTab === "contextManagement" && (
							<ContextManagementSettings
								autoCondenseContext={autoCondenseContext}
								autoCondenseContextPercent={autoCondenseContextPercent}
								listApiConfigMeta={listApiConfigMeta ?? []}
								maxOpenTabsContext={maxOpenTabsContext}
								maxWorkspaceFiles={maxWorkspaceFiles ?? 200}
								showRooIgnoredFiles={showRooIgnoredFiles}
								maxReadFileLine={maxReadFileLine}
								maxImageFileSize={maxImageFileSize}
								maxTotalImageSize={maxTotalImageSize}
								maxConcurrentFileReads={maxConcurrentFileReads}
								allowVeryLargeReads={allowVeryLargeReads /* kade_change */}
								profileThresholds={profileThresholds}
								includeDiagnosticMessages={includeDiagnosticMessages}
								maxDiagnosticMessages={maxDiagnosticMessages}
								writeDelayMs={writeDelayMs}
								includeCurrentTime={includeCurrentTime}
								includeCurrentCost={includeCurrentCost}
								maxGitStatusFiles={maxGitStatusFiles}
								slidingWindowSize={slidingWindowSize}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Terminal Section */}
						{renderTab === "terminal" && (
							<TerminalSettings
								terminalOutputLineLimit={terminalOutputLineLimit}
								terminalOutputCharacterLimit={terminalOutputCharacterLimit}
								terminalShellIntegrationTimeout={terminalShellIntegrationTimeout}
								terminalShellIntegrationDisabled={terminalShellIntegrationDisabled}
								terminalCommandDelay={terminalCommandDelay}
								terminalPowershellCounter={terminalPowershellCounter}
								terminalZshClearEolMark={terminalZshClearEolMark}
								terminalZshOhMy={terminalZshOhMy}
								terminalZshP10k={terminalZshP10k}
								terminalZdotdir={terminalZdotdir}
								terminalCompressProgressBar={terminalCompressProgressBar}
								terminalCommandApiConfigId={terminalCommandApiConfigId} // kade_change
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Modes Section */}
						{renderTab === "modes" && <ModesView />}

						{/* Sub-Agents Section */}
						{renderTab === "subAgents" && (
							<SubAgentSettings
								alwaysAllowSubtasks={alwaysAllowSubtasks}
								subAgentToolEnabled={subAgentToolEnabled ?? false}
								subAgentApiConfiguration={subAgentApiConfiguration}
								setCachedStateField={setCachedStateField}
								setSubAgentApiConfigurationField={setSubAgentApiConfigurationField}
								uriScheme={uriScheme}
								proLicenseKey={proLicenseKey}
							/>
						)}

						{/* Skills Section */}
						{renderTab === "skills" && (
							<SkillsSettings
								enabledSkills={enabledSkills}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Infinity Section */}
						{renderTab === "infinity" && (
							<InfinitySettings
								infinityEnabled={infinityEnabled}
								infinityPrompt={infinityPrompt}
								infinityIntervalMinutes={infinityIntervalMinutes}
								infinityIsRunning={infinityIsRunning}
								infinityScheduleType={infinityScheduleType}
								infinityScheduleHour={infinityScheduleHour}
								infinityScheduleMinute={infinityScheduleMinute}
								infinityNextRunAt={infinityNextRunAt}
								infinitySavedPrompts={infinitySavedPrompts}
								activeInfinityPromptId={activeInfinityPromptId}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* MCP Section */}
						{renderTab === "mcp" && <McpView />}

						{/* Prompts Section */}
						{renderTab === "prompts" && (
							<PromptsSettings
								customSupportPrompts={customSupportPrompts || {}}
								setCustomSupportPrompts={setCustomSupportPromptsField}
								includeTaskHistoryInEnhance={includeTaskHistoryInEnhance}
								setIncludeTaskHistoryInEnhance={(value) =>
									setCachedStateField("includeTaskHistoryInEnhance", value)
								}
							/>
						)}

						{/* UI Section */}
						{renderTab === "ui" && (
							<UISettings
								reasoningBlockCollapsed={reasoningBlockCollapsed ?? true}
								enterBehavior={enterBehavior ?? "send"}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Experimental Section */}
						{renderTab === "experimental" && (
							<ExperimentalSettings
								setExperimentEnabled={setExperimentEnabled}
								experiments={experiments}
								// kade_change start
								setCachedStateField={setCachedStateField}
								morphApiKey={morphApiKey}
								fastApplyModel={fastApplyModel}
								fastApplyApiProvider={fastApplyApiProvider}
								// kade_change end
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								imageGenerationProvider={imageGenerationProvider}
								openRouterImageApiKey={openRouterImageApiKey as string | undefined}
								kiloCodeImageApiKey={kiloCodeImageApiKey}
								openRouterImageGenerationSelectedModel={
									openRouterImageGenerationSelectedModel as string | undefined
								}
								setImageGenerationProvider={setImageGenerationProvider}
								setOpenRouterImageApiKey={setOpenRouterImageApiKey}
								setKiloCodeImageApiKey={setKiloCodeImageApiKey}
								setImageGenerationSelectedModel={setImageGenerationSelectedModel}
								currentProfileKilocodeToken={apiConfiguration.kilocodeToken}
							/>
						)}

						{/* Language Section */}
						{renderTab === "language" && (
							<LanguageSettings language={language || "en"} setCachedStateField={setCachedStateField} />
						)}



						{/* About Section */}
						{renderTab === "about" && (
							<About telemetrySetting={telemetrySetting} setTelemetrySetting={setTelemetrySetting} />
						)}
					</SearchIndexProvider>
				</TabContent>
			</div>

			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent className="w-[90%] max-w-[360px] sm:max-w-[440px] md:max-w-[520px] min-h-[240px] rounded-[40px] p-6 flex flex-col gap-2 items-center justify-center text-center border-vscode-panel-border shadow-2xl backdrop-blur-xl bg-vscode-editor-background/95">
					<AlertDialogHeader className="flex flex-col items-center gap-3 text-center">
						<AlertDialogTitle className="text-base flex flex-col items-center gap-2 text-center">
							<div className="p-2 bg-yellow-500/10 rounded-full">
								<AlertTriangle className="w-5 h-5 text-yellow-500" />
							</div>
							{t("settings:unsavedChangesDialog.title")}
						</AlertDialogTitle>
						<AlertDialogDescription className="text-xs leading-relaxed opacity-80 text-center">
							{t("settings:unsavedChangesDialog.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter className="flex-col gap-2 mt-4 w-full">
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)} className="w-full h-10 font-bold tracking-tight">
							{t("settings:unsavedChangesDialog.discardButton")}
						</AlertDialogAction>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)} className="w-full h-10 opacity-70 hover:opacity-100 transition-opacity">
							{t("settings:unsavedChangesDialog.cancelButton")}
						</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Tab>
	)
})

export default memo(SettingsView)
