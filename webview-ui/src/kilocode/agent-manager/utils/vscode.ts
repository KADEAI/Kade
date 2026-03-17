
import { vscode as sharedVscode } from "../../../utils/vscode"

/**
 * VS Code webview API wrapper for Agent Manager
 * 
 * Redirects to the shared singleton instance to avoid "An instance of the VS Code API has already been acquired" error.
 */

interface VSCodeApi {
	postMessage: (message: unknown) => void
	getState: () => unknown
	setState: (state: unknown) => void
}

export function getVSCodeApi(): VSCodeApi {
	return {
		postMessage: (message: unknown) => sharedVscode.postMessage(message as any),
		getState: () => sharedVscode.getState(),
		setState: (state: unknown) => sharedVscode.setState(state),
	}
}

export const vscode = {
	postMessage: (message: unknown) => sharedVscode.postMessage(message as any),
	getState: () => sharedVscode.getState(),
	setState: (state: unknown) => sharedVscode.setState(state),
}
