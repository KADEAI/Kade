// kilocode_change - new file: Gemini STT Client
import { EventEmitter } from "events"
import WebSocket from "ws"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { getGeminiApiKey } from "./utils/getGeminiCredentials"

// Types for Gemini Bidi Protocol
interface GeminiSetupMessage {
    setup: {
        model: string
        generation_config?: {
            response_modalities?: string[]
            speech_config?: {
                voice_config?: {
                    prebuilt_voice_config?: {
                        voice_name?: string
                    }
                }
            }
        }
    }
}

interface GeminiRealtimeInputMessage {
    realtime_input: {
        media_chunks: {
            mime_type: string
            data: string
        }[]
    }
}

interface GeminiClientContentMessage {
    client_content: {
        turns: {
            role: string
            parts: { text: string }[]
        }[]
        turn_complete: boolean
    }
}

interface GeminiServerContent {
    serverContent?: {
        modelTurn?: {
            parts?: { text?: string }[]
        }
        turnComplete?: boolean
        interrupted?: boolean
    }
    toolCallCancellation?: any
}

export interface GeminiSTTConfig {
    apiKey?: string
    model?: string
}

export class GeminiSTTClient extends EventEmitter {
    private ws: WebSocket | null = null
    private config: GeminiSTTConfig
    private providerSettingsManager: ProviderSettingsManager
    private isConnecting = false
    private isClosing = false

    private static readonly DEFAULT_MODEL = "models/gemini-2.0-flash-exp"

    constructor(providerSettingsManager: ProviderSettingsManager, config?: GeminiSTTConfig) {
        super()
        this.providerSettingsManager = providerSettingsManager
        this.config = config || {}
    }

    async connect(): Promise<void> {
        if (this.isConnecting) return
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return

        this.isConnecting = true
        this.isClosing = false

        try {
            if (!this.config.apiKey) {
                const apiKey = await getGeminiApiKey(this.providerSettingsManager)
                if (!apiKey) {
                    throw new Error("Gemini API key not found")
                }
                this.config.apiKey = apiKey
            }

            const host = "generativelanguage.googleapis.com"
            const path = "/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
            const url = `wss://${host}${path}?key=${this.config.apiKey}`

            this.ws = new WebSocket(url)

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Connection timeout")), 10000)

                this.ws!.on("open", () => {
                    clearTimeout(timeout)
                    this.sendSetupMessage()
                    resolve()
                })

                this.ws!.on("error", (err) => {
                    clearTimeout(timeout)
                    reject(err)
                })
            })

            this.ws!.on("message", (data) => this.handleMessage(data))
            this.ws!.on("close", () => {
                this.emit("disconnected")
                this.ws = null
            })

            this.isConnecting = false
            this.emit("connected")

        } catch (error) {
            this.isConnecting = false
            this.ws = null
            throw error
        }
    }

    private sendSetupMessage() {
        if (!this.ws) return

        const msg: any = {
            setup: {
                model: this.config.model || GeminiSTTClient.DEFAULT_MODEL,
                generation_config: {
                    response_modalities: ["TEXT"], // We only want text (transcription)
                },
                system_instruction: {
                    parts: [
                        { text: "You are a transcriber. Transcribe the user's speech exactly. Do not respond to it. Do not add punctuation unless necessary." }
                    ]
                }
            }
        }

        this.ws.send(JSON.stringify(msg))
    }

    sendAudioChunk(pcm16Buffer: Buffer): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const base64 = pcm16Buffer.toString("base64")
        const msg: GeminiRealtimeInputMessage = {
            realtime_input: {
                media_chunks: [{
                    mime_type: "audio/pcm",
                    data: base64
                }]
            }
        }

        this.ws.send(JSON.stringify(msg))
    }

    sendInputBufferCommit(): void {
        // Gemini processes continuously, but we can send an empty client_content 
        // with turn_complete=true to force a turn if needed, but for STT it might not be necessary.
        // However, adhering to the interface.
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const str = data.toString()
            const msg = JSON.parse(str) as GeminiServerContent

            if (msg.serverContent?.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.text) {
                        // Gemini sends generated text. For STT, this IS the transcription.
                        // We emit it as delta.
                        this.emit("transcriptionDelta", part.text)
                    }
                }
            }

            if (msg.serverContent?.turnComplete) {
                // Turn complete usually means the model finished generating.
                // Since we treat model output as transcription, this marks end of a segment.
                // However, STTService accumulates deltas. 
                // We can emit 'transcription' with empty string to trigger segment finalization if needed,
                // but STTService logic for 'transcription' event expects the FULL text of the segment.
                // Gemini streams parts. We might need to accumulate locally if we want to emit full text.
                // But STTService also accumulates 'delta'.
                // Actually, OpenAI 'transcription' event sends the *corrected* full text.
                // Gemini might not send a corrected full text at the end, just chunks.
                // So we rely on deltas.
            }
        } catch (error) {
            console.error("Error parsing Gemini message", error)
        }
    }

    async disconnect(): Promise<void> {
        this.isClosing = true
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }
}
