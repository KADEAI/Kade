// kade_change - new file: Local Whisper STT service that uses FFmpeg for audio capture
// Uses the same FFmpeg approach as OpenAI/Gemini to avoid webview microphone permission issues
import { STTEventEmitter } from "./types"
import { STTSegment } from "../../shared/sttContract"
import { FFmpegCaptureService } from "./FFmpegCaptureService"

/**
 * LocalWhisperSTTService - Captures audio via FFmpeg (like OpenAI/Gemini)
 * and sends it to the webview for Whisper transcription
 * 
 * Architecture:
 * Extension Host: FFmpeg → PCM16 audio → accumulate → on stop, send to webview
 * WebView: Receives audio → Whisper Web Worker → transcription → postMessage back
 */
export class LocalWhisperSTTService {
	private readonly emitter: STTEventEmitter
	private readonly postMessageToWebview: (message: any) => void
	private audioCapture: FFmpegCaptureService
	private isActive = false
	private sessionId: string | null = null
	private audioChunks: Buffer[] = []
	private modelId: string = "onnx-community/whisper-base"

	constructor(
		emitter: STTEventEmitter,
		postMessageToWebview: (message: any) => void
	) {
		this.emitter = emitter
		this.postMessageToWebview = postMessageToWebview
		this.audioCapture = new FFmpegCaptureService()
	}

	async start(modelId?: string, sessionId?: string): Promise<void> {
		if (this.isActive) {
			return
		}

		// Use provided session ID from STTService, or create our own
		this.sessionId = sessionId || `local-stt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
		this.isActive = true
		this.audioChunks = []
		this.modelId = modelId || "onnx-community/whisper-base"

		try {
			// Notify webview to initialize the whisper model
			this.postMessageToWebview({
				type: "localWhisper:init",
				sessionId: this.sessionId,
				modelId: this.modelId
			})

			// Start FFmpeg audio capture at 16kHz (Whisper's native sample rate)
			await this.audioCapture.start(16000)

			this.setupEventHandlers()

			// Don't emit onStarted here - let STTService do it with the unified session ID
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Failed to start local STT"
			this.emitter.onStopped("error", undefined, errorMessage)
			this.cleanup()
			throw error
		}
	}

	async stop(): Promise<string> {
		if (!this.isActive) {
			return ""
		}

		this.isActive = false

		try {
			await this.audioCapture.stop()

			// Send any remaining accumulated audio to webview for transcription
			if (this.audioChunks.length > 0) {
				const combinedAudio = Buffer.concat(this.audioChunks)
				const float32Audio = this.pcm16ToFloat32(combinedAudio)
				
				console.log(`🎙️ [LocalWhisperSTT] Sending final ${float32Audio.length} samples to webview for transcription`)
				
				this.postMessageToWebview({
					type: "localWhisper:transcribe",
					sessionId: this.sessionId,
					audio: Array.from(float32Audio)
				})
				this.audioChunks = []
			}

			// Emit stopped immediately so the UI updates (button becomes clickable again)
			// Transcription results will arrive asynchronously via handleWebviewMessage
			// and will call onComplete to insert text into the input
			this.emitter.onStopped("completed", "")
			this.cleanup()
			return ""
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Failed to stop"
			this.emitter.onStopped("error", undefined, errorMessage)
			this.cleanup()
			return ""
		}
	}

	cancel(): void {
		this.isActive = false
		this.audioCapture.stop().catch(() => {})
		this.cleanup()
		this.emitter.onStopped("cancelled")
	}

	/**
	 * Handle messages from webview (transcription results)
	 */
	handleWebviewMessage(message: any): void {
		if (message.sessionId !== this.sessionId) {
			return
		}

		switch (message.type) {
			case "localWhisper:modelLoading":
				console.log("🎙️ [LocalWhisperSTT] Model loading:", message.progress)
				break

			case "localWhisper:modelReady":
				console.log("🎙️ [LocalWhisperSTT] Model ready")
				break

			case "localWhisper:transcriptionUpdate":
				// Streaming update
				if (message.text) {
					const segments: STTSegment[] = [{ text: message.text, isPreview: true }]
					this.emitter.onTranscript(segments, false)
				}
				break

			case "localWhisper:transcriptionComplete": {
				// Final transcription result from webview worker
				const finalText = message.text?.trim() || ""
				if (finalText) {
					const segments: STTSegment[] = [{ text: finalText, isPreview: false }]
					this.emitter.onTranscript(segments, true)
				}
				// Don't emit onStopped here - it was already emitted in stop()
				// The transcript will be picked up by the webview via stt:transcript
				console.log("🎙️ [LocalWhisperSTT] Transcription complete:", finalText)
				break
			}

			case "localWhisper:error":
				console.error("🎙️ [LocalWhisperSTT] Error from webview:", message.error)
				// Only emit onStopped if we haven't already (still active)
				if (this.isActive) {
					this.emitter.onStopped("error", undefined, message.error)
					this.cleanup()
				}
				break
		}
	}

	isRecording(): boolean {
		return this.isActive
	}

	getSessionId(): string | null {
		return this.sessionId
	}

	private setupEventHandlers(): void {
		let chunkCount = 0
		let voicedChunks = 0
		const CHUNKS_PER_TRANSCRIPTION = 25 // Send audio every ~0.5 seconds (assuming 20ms chunks) for faster response
		const ENERGY_THRESHOLD = 0.01 // Minimum energy to consider as voice
		const MIN_VOICED_RATIO = 0.3 // At least 30% of chunks must have voice
		
		// Collect audio chunks and send periodically for transcription
		this.audioCapture.on("audioData", (buffer: Buffer) => {
			if (this.isActive) {
				this.audioChunks.push(Buffer.from(buffer))
				chunkCount++
			}
		})

		// Track voice activity via energy detection
		this.audioCapture.on("audioEnergy", (energy: number) => {
			if (this.isActive) {
				this.emitter.onVolume(energy)
				
				// Count chunks with voice activity
				if (energy > ENERGY_THRESHOLD) {
					voicedChunks++
				}
				
				// Send accumulated audio when we have enough chunks
				if (chunkCount >= CHUNKS_PER_TRANSCRIPTION) {
					const voicedRatio = voicedChunks / chunkCount
					
					// Only send if there's enough voice activity to avoid hallucination
					if (voicedRatio >= MIN_VOICED_RATIO) {
						const combinedAudio = Buffer.concat(this.audioChunks)
						const float32Audio = this.pcm16ToFloat32(combinedAudio)
						
						console.log(`🎙️ [LocalWhisperSTT] Sending ${float32Audio.length} samples (${Math.round(voicedRatio * 100)}% voiced)`)
						
						this.postMessageToWebview({
							type: "localWhisper:transcribe",
							sessionId: this.sessionId,
							audio: Array.from(float32Audio)
						})
					} else {
						console.log(`🎙️ [LocalWhisperSTT] Skipping silent chunk (${Math.round(voicedRatio * 100)}% voiced)`)
					}
					
					// Reset for next segment
					this.audioChunks = []
					chunkCount = 0
					voicedChunks = 0
				}
			}
		})

		// Handle errors
		this.audioCapture.on("error", (error: Error) => {
			console.error("🎙️ [LocalWhisperSTT] Audio capture error:", error)
			this.emitter.onStopped("error", undefined, error.message)
			this.cleanup()
		})
	}

	/**
	 * Convert PCM16 buffer to Float32Array for Whisper
	 */
	private pcm16ToFloat32(pcm16Buffer: Buffer): Float32Array {
		const numSamples = pcm16Buffer.length / 2 // 2 bytes per sample
		const float32Array = new Float32Array(numSamples)
		
		for (let i = 0; i < numSamples; i++) {
			// Read as signed 16-bit little-endian
			const sample = pcm16Buffer.readInt16LE(i * 2)
			// Normalize to -1.0 to 1.0
			float32Array[i] = sample / 32768.0
		}
		
		return float32Array
	}

	private cleanup(): void {
		this.isActive = false
		this.audioChunks = []
		this.sessionId = null
	}
}
