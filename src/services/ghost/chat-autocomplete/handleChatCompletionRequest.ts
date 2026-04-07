import { ClineProvider } from "../../../core/webview/ClineProvider"
import { WebviewMessage } from "../../../shared/WebviewMessage"

/**
 * Handles a chat completion request from the webview.
 * Chat textarea autocomplete is intentionally disabled.
 */
export async function handleChatCompletionRequest(
	message: WebviewMessage & { type: "requestChatCompletion" },
	provider: ClineProvider,
	_getCurrentCwd: () => string,
): Promise<void> {
	await provider.postMessageToWebview({
		type: "chatCompletionResult",
		text: "",
		requestId: message.requestId || "",
	})
}
