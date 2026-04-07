import * as vscode from "vscode"
import delay from "delay"

import type { CommandId } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { getCommand } from "../utils/commands"
import { ClineProvider } from "../core/webview/ClineProvider"
import { exportSettings } from "../core/config/importExport" // kade_change
import { ContextProxy } from "../core/config/ContextProxy"
import { focusPanel } from "../utils/focusPanel"

import { registerHumanRelayCallback, unregisterHumanRelayCallback, handleHumanRelayResponse } from "./humanRelay"
import { handleNewTask } from "./handleTask"
import { CodeIndexManager } from "../services/code-index/manager"
import { importSettingsWithFeedback } from "../core/config/importExport"
import { MdmService } from "../services/mdm/MdmService"
import { t } from "../i18n"
import { getAppUrl } from "@roo-code/types" // kade_change
import { generateTerminalCommand } from "../utils/terminalCommandGenerator" // kade_change
import { NativeAgentManagerProvider } from "../core/kilocode/native-agent-manager/NativeAgentManagerProvider"

/**
 * Helper to get the visible ClineProvider instance or log if not found.
 */
export function getVisibleProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const visibleProvider = ClineProvider.getVisibleInstance()
	if (!visibleProvider) {
		outputChannel.appendLine("Cannot find any visible Kilo Code instances.")
		return undefined
	}
	return visibleProvider
}

export function getSidebarProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const sidebarProvider = ClineProvider.getSidebarInstance()
	if (!sidebarProvider) {
		outputChannel.appendLine("Cannot find a visible Kilo Code sidebar instance.")
		return undefined
	}
	return sidebarProvider
}

export function getVisibleTabProviderOrLog(outputChannel: vscode.OutputChannel): ClineProvider | undefined {
	const tabProvider = ClineProvider.getVisibleTabInstance()
	if (!tabProvider) {
		outputChannel.appendLine("Cannot find a visible Kilo Code editor tab instance.")
		return undefined
	}
	return tabProvider
}

import { getPanel, setPanel, getTabPanel, getSidebarPanel } from "./panelUtils"

export type RegisterCommandOptions = {
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
}

// kade_change start - Agent Manager provider
let agentManagerProvider: NativeAgentManagerProvider | undefined

const registerAgentManager = (options: RegisterCommandOptions) => {
	const { context, outputChannel, provider } = options

	agentManagerProvider = new NativeAgentManagerProvider(context, outputChannel, provider)
	context.subscriptions.push(agentManagerProvider)
}
// kade_change end

export const registerCommands = (options: RegisterCommandOptions) => {
	const { context, outputChannel } = options

	// kade_change start
	registerAgentManager(options)
	// kade_change end

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}
}

const getCommandsMap = ({ context, outputChannel }: RegisterCommandOptions): Record<CommandId, any> => ({
	activationCompleted: () => { },
	// kade_change start
	agentManagerOpen: () => {
		agentManagerProvider?.openPanel()
	},
	// kade_change end
	cloudButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("cloud")

		visibleProvider.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
	},
	plusButtonClicked: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("plus")

		await visibleProvider.removeClineFromStack()
		await visibleProvider.refreshWorkspace()
		await visibleProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		// Send focusInput action immediately after chatButtonClicked
		// This ensures the focus happens after the view has switched
		await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
	},
	sidebarPlusButtonClicked: async () => {
		const sidebarProvider = getSidebarProviderOrLog(outputChannel)

		if (!sidebarProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("plus")

		await sidebarProvider.removeClineFromStack()
		await sidebarProvider.refreshWorkspace()
		await sidebarProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await sidebarProvider.postMessageToWebview({ type: "action", action: "focusInput" })
	},
	tabPlusButtonClicked: async () => {
		const tabProvider = getVisibleTabProviderOrLog(outputChannel)

		if (!tabProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("plus")

		await tabProvider.removeClineFromStack()
		await tabProvider.refreshWorkspace()
		await tabProvider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await tabProvider.postMessageToWebview({ type: "action", action: "focusInput" })
	},
	popoutButtonClicked: () => {
		TelemetryService.instance.captureTitleButtonClicked("popout")

		return openClineInNewTab({ context, outputChannel })
	},
	sidebarPopoutButtonClicked: () => {
		TelemetryService.instance.captureTitleButtonClicked("popout")

		return openClineInNewTab({ context, outputChannel })
	},
	tabPopoutButtonClicked: () => {
		TelemetryService.instance.captureTitleButtonClicked("popout")

		return openClineInNewTab({ context, outputChannel })
	},
	openInNewTab: () => openClineInNewTab({ context, outputChannel }),
	settingsButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("settings")

		visibleProvider.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
		// Also explicitly post the visibility message to trigger scroll reliably
		visibleProvider.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
	},
	sidebarSettingsButtonClicked: () => {
		const sidebarProvider = getSidebarProviderOrLog(outputChannel)

		if (!sidebarProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("settings")

		sidebarProvider.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
		sidebarProvider.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
	},
	tabSettingsButtonClicked: () => {
		const tabProvider = getVisibleTabProviderOrLog(outputChannel)

		if (!tabProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("settings")

		tabProvider.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })
		tabProvider.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
	},
	historyButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("history")

		visibleProvider.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
	},
	sidebarHistoryButtonClicked: () => {
		const sidebarProvider = getSidebarProviderOrLog(outputChannel)

		if (!sidebarProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("history")

		sidebarProvider.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
	},
	tabHistoryButtonClicked: () => {
		const tabProvider = getVisibleTabProviderOrLog(outputChannel)

		if (!tabProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("history")

		tabProvider.postMessageToWebview({ type: "action", action: "historyButtonClicked" })
	},
	// kade_change begin
	mcpButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("mcp")

		visibleProvider.postMessageToWebview({ type: "action", action: "mcpButtonClicked" })
	},
	sidebarMcpButtonClicked: () => {
		const sidebarProvider = getSidebarProviderOrLog(outputChannel)

		if (!sidebarProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("mcp")

		sidebarProvider.postMessageToWebview({ type: "action", action: "mcpButtonClicked" })
	},
	tabMcpButtonClicked: () => {
		const tabProvider = getVisibleTabProviderOrLog(outputChannel)

		if (!tabProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("mcp")

		tabProvider.postMessageToWebview({ type: "action", action: "mcpButtonClicked" })
	},
	promptsButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		TelemetryService.instance.captureTitleButtonClicked("prompts")

		visibleProvider.postMessageToWebview({ type: "action", action: "promptsButtonClicked" })
	},
	profileButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		visibleProvider.postMessageToWebview({ type: "action", action: "profileButtonClicked" })
	},
	helpButtonClicked: () => {
		vscode.env.openExternal(vscode.Uri.parse(getAppUrl()))
	},
	sidebarHelpButtonClicked: () => {
		vscode.env.openExternal(vscode.Uri.parse(getAppUrl()))
	},
	tabHelpButtonClicked: () => {
		vscode.env.openExternal(vscode.Uri.parse(getAppUrl()))
	},
	// kade_change end
	marketplaceButtonClicked: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return
		visibleProvider.postMessageToWebview({ type: "action", action: "marketplaceButtonClicked" })
	},
	showHumanRelayDialog: (params: { requestId: string; promptText: string }) => {
		const panel = getPanel()

		if (panel) {
			panel?.webview.postMessage({
				type: "showHumanRelayDialog",
				requestId: params.requestId,
				promptText: params.promptText,
			})
		}
	},
	registerHumanRelayCallback: registerHumanRelayCallback,
	unregisterHumanRelayCallback: unregisterHumanRelayCallback,
	handleHumanRelayResponse: handleHumanRelayResponse,
	newTask: handleNewTask,
	setCustomStoragePath: async () => {
		const { promptForCustomStoragePath } = await import("../utils/storage")
		await promptForCustomStoragePath()
	},
	importSettings: async (filePath?: string) => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) {
			return
		}

		await importSettingsWithFeedback(
			{
				providerSettingsManager: visibleProvider.providerSettingsManager,
				contextProxy: visibleProvider.contextProxy,
				customModesManager: visibleProvider.customModesManager,
				provider: visibleProvider,
			},
			filePath,
		)
	},
	focusPanel: async () => {
		try {
			await focusPanel(getTabPanel(), getSidebarPanel())
		} catch (error) {
			outputChannel.appendLine(`Error focusing panel: ${error}`)
		}
	},
	acceptInput: () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		visibleProvider.postMessageToWebview({ type: "acceptInput" })
	}, // kade_change begin
	focusChatInput: async () => {
		try {
			await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
			await delay(100)

			let visibleProvider = getVisibleProviderOrLog(outputChannel)

			if (!visibleProvider) {
				// If still no visible provider, try opening in a new tab
				const tabProvider = await openClineInNewTab({ context, outputChannel })
				await delay(100)
				visibleProvider = tabProvider
			}

			visibleProvider?.postMessageToWebview({
				type: "action",
				action: "focusChatInput",
			})
		} catch (error) {
			outputChannel.appendLine(`Error in focusChatInput: ${error}`)
		}
	},
	generateTerminalCommand: async () => await generateTerminalCommand({ outputChannel, context }), // kade_change
	exportSettings: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return

		await exportSettings({
			providerSettingsManager: visibleProvider.providerSettingsManager,
			contextProxy: visibleProvider.contextProxy,
		})
	},
	// Handle external URI - used by JetBrains plugin to forward auth tokens
	handleExternalUri: async (uriString: string) => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) {
			return
		}

		try {
			// Parse the URI string and create a VSCode URI object
			const uri = vscode.Uri.parse(uriString)

			// Import and use the existing handleUri function
			const { handleUri } = await import("./handleUri")
			await handleUri(uri)

			outputChannel.appendLine(`Successfully handled external URI: ${uriString}`)
		} catch (error) {
			outputChannel.appendLine(`Error handling external URI: ${uriString}, error: ${error}`)
		}
	},
	// kade_change end
	toggleAutoApprove: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)

		if (!visibleProvider) {
			return
		}

		visibleProvider.postMessageToWebview({
			type: "action",
			action: "toggleAutoApprove",
		})
	},
	requestMicrophonePermission: async () => {
		const message = "To enable voice recording, you need to allow microphone access in VS Code settings:\n\n" +
			"1. Open VS Code Settings (Ctrl/Cmd + ,)\n" +
			"2. Search for 'microphone'\n" +
			"3. Find 'Security: Workspace Trust' and ensure your workspace is trusted\n" +
			"4. Find 'Extensions: Allow Untrusted Workspaces' if needed\n" +
			"5. Reload VS Code after making changes\n\n" +
			"Alternatively, you can run the 'Developer: Reload Window' command."

		const result = await vscode.window.showInformationMessage(
			"Microphone Permission Required",
			{ modal: true },
			"Open Settings",
			"Reload Window"
		)

		if (result === "Open Settings") {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'microphone')
		} else if (result === "Reload Window") {
			await vscode.commands.executeCommand('workbench.action.reloadWindow')
		}
	},
})

export const openClineInNewTab = async ({ context, outputChannel }: Omit<RegisterCommandOptions, "provider">) => {
	// (This example uses webviewProvider activation event which is necessary to
	// deserialize cached webview, but since we use retainContextWhenHidden, we
	// don't need to use that event).
	// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	const contextProxy = await ContextProxy.getInstance(context)
	const codeIndexManager = CodeIndexManager.getInstance(context)

	// Get the existing MDM service instance to ensure consistent policy enforcement
	let mdmService: MdmService | undefined
	try {
		mdmService = MdmService.getInstance()
	} catch (error) {
		// MDM service not initialized, which is fine - extension can work without it
		mdmService = undefined
	}

	const tabProvider = new ClineProvider(context, outputChannel, "editor", contextProxy, mdmService)
	const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

	// Check if there are any visible text editors, otherwise open a new group
	// to the right.
	const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

	if (!hasVisibleEditors) {
		await vscode.commands.executeCommand("workbench.action.newGroupRight")
	}

	const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

	const newPanel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "Kade", targetCol, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [context.extensionUri],
	})

	// Save as tab type panel.
	setPanel(newPanel, "tab")

	newPanel.iconPath = {
		light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "sidebar-icon.png"),
		dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "sidebar-icon.png"),
	}

	await tabProvider.resolveWebviewView(newPanel)

	// Add listener for visibility changes to notify webview
	newPanel.onDidChangeViewState(
		(e) => {
			const panel = e.webviewPanel
			if (panel.visible) {
				panel.webview.postMessage({ type: "action", action: "didBecomeVisible" }) // Use the same message type as in SettingsView.tsx
			}
		},
		null, // First null is for `thisArgs`
		context.subscriptions, // Register listener for disposal
	)

	// Handle panel closing events.
	newPanel.onDidDispose(
		() => {
			setPanel(undefined, "tab")
		},
		null,
		context.subscriptions, // Also register dispose listener
	)

	// Move the editor to a new window first.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow")

	// Lock the editor group so clicking on files doesn't open them over the panel.
	await delay(100)
	await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

	return tabProvider
}
