import type { Anthropic } from "@anthropic-ai/sdk"
import { StringDecoder } from "string_decoder"

import { type ModelInfo, type GeminiCliModelId, geminiCliDefaultModelId, geminiCliModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { t } from "../../i18n"

import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import type { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { geminiOAuthManager } from "../../integrations/gemini/oauth"

// Code Assist API Configuration
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

export class GeminiCliHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
	}

	private async callEndpoint(method: string, body: any, accessToken: string): Promise<any> {
		const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${accessToken}`,
				"User-Agent": `GeminiCLI/0.30.0/gemini-2.0-flash (${process.platform === "darwin" ? "darwin; arm64" : (process.platform === "win32" ? "windows; amd64" : "linux; amd64")}) (Pro)`,
				"x-goog-api-client": "ca-tf-v1",
				"Client-Metadata": JSON.stringify({
					ideType: "VSCODE",
					platform: process.platform === "darwin" ? "MACOS" : (process.platform === "win32" ? "WINDOWS" : "LINUX"),
					pluginType: "GEMINI",
					pluginVersion: "0.30.0"
				}),
			},
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorData: any
			try {
				errorData = JSON.parse(errorText)
			} catch {
				// ignore
			}
			console.error(`[GeminiCLI] Error calling ${method}:`, response.status, errorText)

			if (response.status === 429) {
				throw new Error(t("common:errors.geminiCli.rateLimitExceeded"))
			}
			if (response.status === 400 && errorData) {
				throw new Error(
					t("common:errors.geminiCli.badRequest", {
						details: JSON.stringify(errorData),
					}),
				)
			}
			throw new Error(t("common:errors.geminiCli.apiError", { error: `${response.status} - ${errorText}` }))
		}

		return await response.json()
	}

	/**
	 * Parse Server-Sent Events from a stream
	 */
	private async *parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
		const reader = stream.getReader()
		const decoder = new TextDecoder("utf-8")
		let buffer = ""

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") continue

						try {
							const parsed = JSON.parse(data)
							yield parsed
						} catch (e) {
							console.error("Error parsing SSE data:", e)
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}

		// Process any remaining buffer
		if (buffer && buffer.startsWith("data: ")) {
			const data = buffer.slice(6).trim()
			if (data !== "[DONE]") {
				try {
					yield JSON.parse(data)
				} catch (e) {
					console.error("Error parsing final SSE data:", e)
				}
			}
		}
	}

	async *createMessage(
		systemInstruction: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const accessToken = await geminiOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error(t("common:errors.geminiCli.authFailed"))
		}

		const projectId = await geminiOAuthManager.getProjectId()

		const { id: model, info, reasoning: thinkingConfig, maxTokens } = this.getModel()

		// Build tool ID to name map for Gemini message transformation
		const toolIdToName = new Map<string, string>()
		for (const m of messages) {
			if (Array.isArray(m.content)) {
				for (const part of m.content) {
					if (part.type === "tool_use") {
						toolIdToName.set(part.id, part.name)
					}
				}
			}
		}

		// Convert messages to Gemini format
		const contents = messages.flatMap((message) =>
			convertAnthropicMessageToGemini(message, {
				toolIdToName,
			}),
		)

		// Prepare request body for Code Assist API
		const requestBody: any = {
			model: model,
			request: {
				contents: [
					{
						role: "user",
						parts: [{ text: systemInstruction }],
					},
					...contents,
				],
				generationConfig: {
					temperature: this.options.modelTemperature ?? 0.7,
					maxOutputTokens: this.options.modelMaxTokens ?? maxTokens ?? 8192,
				},
				// Add session ID to match typical agent request structure if needed
				sessionId: metadata?.taskId ? `task-${metadata.taskId}` : `${Math.floor(Math.random() * 9_000_000_000_000_000_000)}`,
			},
		}

		if (projectId) {
			requestBody.project = projectId
		}

		// Add thinking config if applicable
		if (thinkingConfig) {
			requestBody.request.generationConfig.thinkingConfig = thinkingConfig
		}

		try {
			// Call Code Assist streaming endpoint using fetch
			const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${accessToken}`,
					"Accept": "text/event-stream",
					"User-Agent": `GeminiCLI/0.30.0/${model} (${process.platform === "darwin" ? "darwin; arm64" : (process.platform === "win32" ? "windows; amd64" : "linux; amd64")}) (Pro)`,
					"x-goog-api-client": "ca-tf-v1",
					"Client-Metadata": JSON.stringify({
						ideType: "VSCODE",
						platform: process.platform === "darwin" ? "MACOS" : (process.platform === "win32" ? "WINDOWS" : "LINUX"),
						pluginType: "GEMINI",
						pluginVersion: "0.30.0"
					}),
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok || !response.body) {
				const errorText = await response.text()
				if (response.status === 429) {
					throw new Error(t("common:errors.geminiCli.rateLimitExceeded"))
				}
				throw new Error(`${response.status} - ${errorText}`)
			}

			// Process the SSE stream
			let lastUsageMetadata: any = undefined

			for await (const jsonData of this.parseSSEStream(response.body)) {
				// Extract content from the response
				const responseData = jsonData.response || jsonData
				const candidate = responseData.candidates?.[0]

				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text) {
							// Check if this is a thinking/reasoning part
							if (part.thought === true) {
								yield {
									type: "reasoning",
									text: part.text,
								}
							} else {
								yield {
									type: "text",
									text: part.text,
								}
							}
						}
					}
				}

				// Store usage metadata for final reporting
				if (responseData.usageMetadata) {
					lastUsageMetadata = responseData.usageMetadata
				}

				// Check if this is the final chunk
				if (candidate?.finishReason) {
					break
				}
			}

			// Yield final usage information
			if (lastUsageMetadata) {
				const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
				const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
				const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
				const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					cacheReadTokens,
					reasoningTokens,
					totalCost: 0, // Free tier - all costs are 0
				}
			}
		} catch (error: any) {
			console.error("[GeminiCLI] API Error:", error)
			throw new Error(t("common:errors.geminiCli.apiError", { error: error.message }))
		}
	}

	override getModel() {
		const modelId = this.options.apiModelId
		// Handle :thinking suffix before checking if model exists
		const baseModelId = modelId?.endsWith(":thinking") ? modelId.replace(":thinking", "") : modelId
		let id =
			baseModelId && baseModelId in geminiCliModels ? (baseModelId as GeminiCliModelId) : geminiCliDefaultModelId
		const info: ModelInfo = geminiCliModels[id]
		const params = getModelParams({ format: "gemini", modelId: id, model: info, settings: this.options })

		// Return the cleaned model ID
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		const accessToken = await geminiOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error(t("common:errors.geminiCli.authFailed"))
		}

		const projectId = await geminiOAuthManager.getProjectId()

		try {
			const { id: model } = this.getModel()

			const requestBody: any = {
				model: model,
				request: {
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: this.options.modelTemperature ?? 0.7,
					},
					sessionId: `${Math.floor(Math.random() * 9_000_000_000_000_000_000)}`,
				},
			}

			if (projectId) {
				requestBody.project = projectId
			}

			const data = await this.callEndpoint("generateContent", requestBody, accessToken)

			// Extract text from response
			const rawData = data as any
			const responseData = rawData.response || rawData

			if (responseData.candidates && responseData.candidates.length > 0) {
				const candidate = responseData.candidates[0]
				if (candidate.content && candidate.content.parts) {
					const textParts = candidate.content.parts
						.filter((part: any) => part.text && !part.thought)
						.map((part: any) => part.text)
						.join("")
					return textParts
				}
			}

			return ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.geminiCli.completionError", { error: error.message }))
			}
			throw error
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// For OAuth/free tier, we can't use the token counting API
		// Fall back to the base provider's tiktoken implementation
		return super.countTokens(content)
	}
}
