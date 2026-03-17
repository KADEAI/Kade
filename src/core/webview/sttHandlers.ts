// kilocode_change - new file: STT message handlers (replaces speechMessageHandlers.ts)
import type { ClineProvider } from "./ClineProvider"
import type { STTCommand, STTSegment } from "../../shared/sttContract"
import { STTService } from "../../services/stt"
import { STTEventEmitter } from "../../services/stt/types"
import { getOpenAiApiKey } from "../../services/stt/utils/getOpenAiCredentials"
import { getGeminiApiKey } from "../../services/stt/utils/getGeminiCredentials"
import { VisibleCodeTracker } from "../../services/ghost/context/VisibleCodeTracker"
import { extractCodeGlossary, formatGlossaryAsPrompt } from "../../services/stt/context/codeGlossaryExtractor"

/**
 * Map of ClineProvider -> STTService
 * WeakMap ensures cleanup when ClineProvider is garbage collected
 */
const servicesByProviderRef = new WeakMap<ClineProvider, STTService>()

/**
 * Get or create STTService for a provider
 */
function getService(clineProvider: ClineProvider): STTService {
	let service = servicesByProviderRef.get(clineProvider)

	if (!service) {
		const emitter: STTEventEmitter = {
			onStarted: (sessionId: string) => {
				clineProvider.postMessageToWebview({
					type: "stt:started",
					sessionId,
				})
			},

			onTranscript: (segments: STTSegment[], isFinal: boolean) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:transcript",
					sessionId,
					segments,
					isFinal,
				})
			},

			onVolume: (level: number) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:volume",
					sessionId,
					level,
				})
			},

			onStopped: (reason, text, error) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:stopped",
					sessionId,
					reason,
					text,
					error,
				})
			},
		}

		// Create code glossary with snapshotted rooIgnoreController
		const currentTask = clineProvider.getCurrentTask()
		const codeGlossary = new VisibleCodeGlossary(clineProvider.cwd, currentTask?.rooIgnoreController ?? null)

		// Pass postMessageToWebview for local whisper support
		const postMessageToWebview = (message: any) => clineProvider.postMessageToWebview(message)
		service = new STTService(emitter, clineProvider.providerSettingsManager, codeGlossary, postMessageToWebview)
		servicesByProviderRef.set(clineProvider, service)
	}

	return service
}

/**
 * Handle stt:start command
 */
export async function handleSTTStart(clineProvider: ClineProvider, language?: string): Promise<void> {
	const service = getService(clineProvider)
	const state = await clineProvider.getState()
	const sttProvider = state.sttProvider || (state.apiConfiguration?.apiProvider === "gemini" ? "gemini" : "openai")

	if (sttProvider === "gemini") {
		const apiKey = await getGeminiApiKey(clineProvider.providerSettingsManager)
		if (!apiKey) {
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId: "",
				reason: "error",
				error: "Gemini API key not configured. Please add a Gemini provider in settings.",
			})
			return
		}

		try {
			await service.start({ provider: "gemini", apiKey }, language)
		} catch (error) {
			console.error("Failed to start Gemini STT service:", error)
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId: "",
				reason: "error",
				error: error instanceof Error ? error.message : "Failed to start Gemini STT",
			})
		}
	} else if (sttProvider === "openai") {
		const apiKey = await getOpenAiApiKey(clineProvider.providerSettingsManager)
		if (!apiKey) {
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId: "",
				reason: "error",
				error: "OpenAI API key not configured. Please add an OpenAI provider in settings.",
			})
			return
		}

		try {
			// Service generates its own prompt from the code glossary
			await service.start({ provider: "openai", apiKey }, language)
		} catch (error) {
			console.error("Failed to start STT service:", error)
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId: "",
				reason: "error",
				error: error instanceof Error ? error.message : "Failed to start STT service",
			})
		}
	} else if (sttProvider === "local") {
		// Local Whisper - uses FFmpeg for audio capture (same as OpenAI/Gemini)
		// Audio is sent to webview for Whisper transcription
		const modelId = state.sttModelId || "onnx-community/whisper-base"
		
		try {
			await service.start({ provider: "local", modelId }, language)
		} catch (error) {
			console.error("Failed to start local Whisper STT service:", error)
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId: "",
				reason: "error",
				error: error instanceof Error ? error.message : "Failed to start local Whisper STT",
			})
		}
	}
}

/**
 * Handle stt:stop command
 */
export async function handleSTTStop(clineProvider: ClineProvider): Promise<void> {
	const service = getService(clineProvider)
	await service.stop()
}

/**
 * Handle stt:cancel command
 */
export async function handleSTTCancel(clineProvider: ClineProvider): Promise<void> {
	const service = getService(clineProvider)
	service.cancel()
}

/**
 * Handle local whisper messages from webview (transcription results)
 */
export function handleLocalWhisperMessage(clineProvider: ClineProvider, message: any): void {
	const service = servicesByProviderRef.get(clineProvider)
	if (service) {
		service.handleLocalWhisperMessage(message)
	}
}

/**
 * Unified handler for all STT commands
 */
export async function handleSTTCommand(clineProvider: ClineProvider, command: STTCommand): Promise<void> {
	switch (command.type) {
		case "stt:start":
			await handleSTTStart(clineProvider, command.language)
			break
		case "stt:stop":
			await handleSTTStop(clineProvider)
			break
		case "stt:cancel":
			await handleSTTCancel(clineProvider)
			break
	}
}

/**
 * VisibleCodeGlossary captures visible code and formats it
 * Snapshots the VisibleCodeTracker at construction for reuse during recording session
 */
class VisibleCodeGlossary {
	private tracker: VisibleCodeTracker

	constructor(cwd: string, rooIgnoreController: any) {
		this.tracker = new VisibleCodeTracker(cwd, rooIgnoreController)
	}

	async getGlossary(): Promise<string> {
		try {
			const visibleCode = await this.tracker.captureVisibleCode()
			const glossary = extractCodeGlossary(visibleCode)
			return formatGlossaryAsPrompt(glossary) || ""
		} catch (error) {
			// Non-critical failure - return empty string
			return ""
		}
	}
}
