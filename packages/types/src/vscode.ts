import { z } from "zod"
import { kiloLanguages } from "./kilocode/kiloLanguages.js"

/**
 * CodeAction
 */

export const kiloCodeActionIds = ["addToContextAndFocus"] as const // kade_change
export const codeActionIds = [
	...kiloCodeActionIds, // kade_change
	"explainCode",
	"fixCode",
	"improveCode",
	"addToContext",
	"newTask",
] as const

export type CodeActionId = (typeof codeActionIds)[number]

export type CodeActionName = "EXPLAIN" | "FIX" | "IMPROVE" | "ADD_TO_CONTEXT" | "NEW_TASK"

/**
 * TerminalAction
 */

export const terminalActionIds = ["terminalAddToContext", "terminalFixCommand", "terminalExplainCommand"] as const

export type TerminalActionId = (typeof terminalActionIds)[number]

export type TerminalActionName = "ADD_TO_CONTEXT" | "FIX" | "EXPLAIN"

export type TerminalActionPromptType = `TERMINAL_${TerminalActionName}`

/**
 * Command
 */

export const commandIds = [
	"activationCompleted",

	"plusButtonClicked",
	"sidebarPlusButtonClicked",
	"tabPlusButtonClicked",
	"promptsButtonClicked",
	"mcpButtonClicked",
	"sidebarMcpButtonClicked",
	"tabMcpButtonClicked",

	"historyButtonClicked",
	"sidebarHistoryButtonClicked",
	"tabHistoryButtonClicked",
	"marketplaceButtonClicked",
	"popoutButtonClicked",
	"sidebarPopoutButtonClicked",
	"tabPopoutButtonClicked",
	"cloudButtonClicked",
	"settingsButtonClicked",
	"sidebarSettingsButtonClicked",
	"tabSettingsButtonClicked",
	"sidebarHelpButtonClicked",
	"tabHelpButtonClicked",

	"openInNewTab",
	"agentManagerOpen", // kade_change

	"showHumanRelayDialog",
	"registerHumanRelayCallback",
	"unregisterHumanRelayCallback",
	"handleHumanRelayResponse",

	"newTask",

	"setCustomStoragePath",
	"importSettings",

	// "focusInput", // kade_change
	"acceptInput",
	"profileButtonClicked", // kade_change
	"helpButtonClicked", // kade_change
	"focusChatInput", // kade_change
	"importSettings", // kade_change
	"exportSettings", // kade_change
	"generateTerminalCommand", // kade_change
	"handleExternalUri", // kade_change - for JetBrains plugin URL forwarding
	"focusPanel",
	"toggleAutoApprove",
	"requestMicrophonePermission",
] as const

export type CommandId = (typeof commandIds)[number]

/**
 * Language
 */

export const languages = [
	...kiloLanguages,
	"ca",
	"de",
	"en",
	"es",
	"fr",
	"hi",
	"id",
	"it",
	"ja",
	"ko",
	"nl",
	"pl",
	"pt-BR",
	"ru",
	"tr",
	"vi",
	"zh-CN",
	"zh-TW",
] as const

export const languagesSchema = z.enum(languages)

export type Language = z.infer<typeof languagesSchema>

export const isLanguage = (value: string): value is Language => languages.includes(value as Language)
