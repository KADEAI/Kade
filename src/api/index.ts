import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ProviderSettings, ModelInfo, ToolProtocol } from "@roo-code/types"

import { ApiStream } from "./transform/stream"

import {
	GlamaHandler, // kade_change
	AIHubMixHandler,
	BluesmindsHandler,
	AnthropicHandler,
	AwsBedrockHandler,
	CerebrasHandler,
	OpenRouterHandler,
	VertexHandler,
	AnthropicVertexHandler,
	OpenAiHandler,
	LmStudioHandler,
	GeminiHandler,
	OpenAiNativeHandler,
	DeepSeekHandler,
	MoonshotHandler,
	NanoGptHandler, // kade_change
	MistralHandler,
	VsCodeLmHandler,
	UnboundHandler,
	RequestyHandler,
	HumanRelayHandler,
	FakeAIHandler,
	XAIHandler,
	GroqHandler,
	HuggingFaceHandler,
	ChutesHandler,
	LiteLLMHandler,
	// kade_change start
	VirtualQuotaFallbackHandler,
	GeminiCliHandler,
	SyntheticHandler,
	OVHcloudAIEndpointsHandler,
	SapAiCoreHandler,
	// kade_change end
	ClaudeCodeHandler,
	CliProxyHandler,
	QwenCodeHandler,
	SambaNovaHandler,
	IOIntelligenceHandler,
	DoubaoHandler,
	ZAiHandler,
	FireworksHandler,
	RooHandler,
	FeatherlessHandler,
	VercelAiGatewayHandler,
	DeepInfraHandler,
	MiniMaxHandler,
	BasetenHandler,
	OpenAiCodexHandler,
	KiroHandler,
	ZedHandler,
} from "./providers"
// kade_change start
import { KilocodeOpenrouterHandler } from "./providers/kilocode-openrouter"
import { InceptionLabsHandler } from "./providers/inception"
import { OpenCodeHandler } from "./providers/opencode"
import { AntigravityHandler } from "./providers/antigravity"
// kade_change end
import { NativeOllamaHandler } from "./providers/native-ollama"

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export interface ApiHandlerCreateMessageMetadata {
	/**
	 * Task ID used for tracking and provider-specific features:
	 * - DeepInfra: Used as prompt_cache_key for caching
	 * - Roo: Sent as X-Roo-Task-ID header
	 * - Requesty: Sent as trace_id
	 * - Unbound: Sent in unbound_metadata
	 */
	taskId: string
	/**
	 * Current mode slug for provider-specific tracking:
	 * - Requesty: Sent in extra metadata
	 * - Unbound: Sent in unbound_metadata
	 */
	mode?: string
	suppressPreviousResponseId?: boolean
	/**
	 * Controls whether the response should be stored for 30 days in OpenAI's Responses API.
	 * When true (default), responses are stored and can be referenced in future requests
	 * using the previous_response_id for efficient conversation continuity.
	 * Set to false to opt out of response storage for privacy or compliance reasons.
	 * @default true
	 */
	store?: boolean
	// kade_change start
	/**
	 * KiloCode-specific: The project ID for the current workspace (derived from git origin remote).
	 * Used by KiloCodeOpenrouterHandler for backend tracking. Ignored by other providers.
	 * @kilocode-only
	 */
	projectId?: string
	// kade_change end
	/**
	 * Optional array of tool definitions to pass to the model.
	 * These should be canonical OpenAI ChatCompletionTool definitions.
	 * Provider adapters may translate them further for Anthropic, Gemini, or other APIs.
	 */
	tools?: any[]
	/**
	 * Controls which (if any) tool is called by the model.
	 * Can be "none", "auto", "required", or a specific tool choice.
	 */
	tool_choice?: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"]
	/**
	 * The tool protocol being used (XML or Native).
	 * Used by providers to determine whether to include native tool definitions.
	 */
	toolProtocol?: ToolProtocol
	/**
	 * Controls whether the model can return multiple tool calls in a single response.
	 * When true, parallel tool calls are enabled (OpenAI's parallel_tool_calls=true).
	 * When false (default), only one tool call is returned per response.
	 * Only applies when toolProtocol is "native".
	 */
	parallelToolCalls?: boolean
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	getModel(): { id: string; info: ModelInfo }

	/**
	 * Counts tokens for content blocks
	 * All providers extend BaseProvider which provides a default tiktoken implementation,
	 * but they can override this to use their native token counting endpoints
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number>

	contextWindow?: number // kade_change: Add contextWindow property for virtual quota fallback
}


export function buildApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration

	let handler: ApiHandler
	switch (apiProvider) {
		// kade_change start
		case "kilocode":
			handler = new KilocodeOpenrouterHandler(options); break
		case "gemini-cli":
			handler = new GeminiCliHandler(options); break
		case "virtual-quota-fallback":
			handler = new VirtualQuotaFallbackHandler(options); break
		// kade_change end
		case "anthropic":
			handler = new AnthropicHandler(options); break
		case "cli-proxy":
			handler = new CliProxyHandler(options); break
		case "claude-code":
			handler = new ClaudeCodeHandler(options); break
		// kade_change start
		case "glama":
			handler = new GlamaHandler(options); break
		// kade_change end
		case "openrouter":
			handler = new OpenRouterHandler(options); break
		case "bedrock":
			handler = new AwsBedrockHandler(options); break
		case "vertex":
			handler = options.apiModelId?.startsWith("claude")
				? new AnthropicVertexHandler(options)
				: new VertexHandler(options); break
		case "openai":
			handler = new OpenAiHandler(options); break
		case "ollama":
			handler = new NativeOllamaHandler(options); break
		case "lmstudio":
			handler = new LmStudioHandler(options); break
		case "gemini":
			handler = new GeminiHandler(options); break
		case "openai-native":
			handler = new OpenAiNativeHandler(options); break
		case "deepseek":
			handler = new DeepSeekHandler(options); break
		case "doubao":
			handler = new DoubaoHandler(options); break
		case "qwen-code":
			handler = new QwenCodeHandler(options); break
		case "moonshot":
			handler = new MoonshotHandler(options); break
		// kade_change start
		case "nano-gpt":
			handler = new NanoGptHandler(options); break
		// kade_change end
		case "vscode-lm":
			handler = new VsCodeLmHandler(options); break
		case "mistral":
			handler = new MistralHandler(options); break
		case "unbound":
			handler = new UnboundHandler(options); break
		case "requesty":
			handler = new RequestyHandler(options); break
		case "human-relay":
			handler = new HumanRelayHandler(); break
		case "fake-ai":
			handler = new FakeAIHandler(options); break
		case "xai":
			handler = new XAIHandler(options); break
		case "groq":
			handler = new GroqHandler(options); break
		case "deepinfra":
			handler = new DeepInfraHandler(options); break
		case "huggingface":
			handler = new HuggingFaceHandler(options); break
		case "chutes":
			handler = new ChutesHandler(options); break
		case "litellm":
			handler = new LiteLLMHandler(options); break
		case "cerebras":
			handler = new CerebrasHandler(options); break
		case "sambanova":
			handler = new SambaNovaHandler(options); break
		case "zai":
			handler = new ZAiHandler(options); break
		case "fireworks":
			handler = new FireworksHandler(options); break
		// kade_change start
		case "synthetic":
			handler = new SyntheticHandler(options); break
		case "inception":
			handler = new InceptionLabsHandler(options); break
		case "ovhcloud":
			handler = new OVHcloudAIEndpointsHandler(options); break
		case "sap-ai-core":
			handler = new SapAiCoreHandler(options); break
		case "opencode":
			handler = new OpenCodeHandler(options); break
		// kade_change end
		case "io-intelligence":
			handler = new IOIntelligenceHandler(options); break
		case "roo":
			// Never throw exceptions from provider constructors
			// The provider-proxy server will handle authentication and return appropriate error codes
			handler = new RooHandler(options); break
		case "featherless":
			handler = new FeatherlessHandler(options); break
		case "vercel-ai-gateway":
			handler = new VercelAiGatewayHandler(options); break
		case "minimax":
			handler = new MiniMaxHandler(options); break
		case "baseten":
			handler = new BasetenHandler(options); break
		case "openai-codex":
			handler = new OpenAiCodexHandler(options); break
		case "zed":
			handler = new ZedHandler(options); break
		case "kiro":
			handler = new KiroHandler(options); break
		case "antigravity": // kade_change
			handler = new AntigravityHandler(options); break
		case "apertis":
			// Assuming there is an ApertisHandler or falling back to Anthropic
			handler = new AnthropicHandler(options); break
		case "poe":
			// Assuming there is a PoeHandler or falling back to Anthropic
			handler = new AnthropicHandler(options); break
		case "aihubmix":
			handler = new AIHubMixHandler(options); break
		case "bluesminds":
			handler = new BluesmindsHandler(options); break
		case "corethink":
			handler = new AnthropicHandler(options); break
		case "zenmux":
			// Assuming there is a ZenMuxHandler or falling back to Anthropic
			handler = new AnthropicHandler(options); break
		default:
			apiProvider
			handler = new AnthropicHandler(options); break
	}

	return handler
}
