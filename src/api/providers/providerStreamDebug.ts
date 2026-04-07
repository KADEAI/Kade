import { TOOL_PROTOCOL } from "@roo-code/types"

type ProviderStreamDebugCollectorOptions = {
	providerName: string
	modelId: string
	toolProtocol?: string
}

const MAX_PREVIEW_LENGTH = 120
const MAX_RECENT_EVENTS = 16

const truncate = (value: string) =>
	value.length > MAX_PREVIEW_LENGTH ? `${value.slice(0, MAX_PREVIEW_LENGTH)}...` : value

export class ProviderStreamDebugCollector {
	private rawEventCounts: Record<string, number> = {}
	private recentEvents: string[] = []
	private sawText = false
	private sawReasoning = false
	private sawToolCall = false
	private sawUsage = false

	constructor(private readonly options: ProviderStreamDebugCollectorOptions) {}

	private pushEvent(event: string, preview?: string) {
		this.rawEventCounts[event] = (this.rawEventCounts[event] ?? 0) + 1
		this.recentEvents.push(preview ? `${event}:${truncate(preview)}` : event)
		if (this.recentEvents.length > MAX_RECENT_EVENTS) {
			this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS)
		}
	}

	recordReasoning(preview: string) {
		this.sawReasoning = true
		this.pushEvent("reasoning", preview)
	}

	recordText(preview: string) {
		this.sawText = true
		this.pushEvent("text", preview)
	}

	recordToolCall(name?: string, argumentsPreview?: string) {
		this.sawToolCall = true
		this.pushEvent(`tool_call:${name || "unknown"}`, argumentsPreview)
	}

	recordFinishReason(reason?: string | null) {
		if (reason) {
			this.pushEvent(`finish_reason:${reason}`)
		}
	}

	recordUsage(inputTokens?: number, outputTokens?: number) {
		this.sawUsage = true
		this.pushEvent("usage", `in=${inputTokens ?? 0}:out=${outputTokens ?? 0}`)
	}

	recordRaw(event: string, preview?: string) {
		this.pushEvent(event, preview)
	}

	buildSummary(extra?: Record<string, unknown>) {
		return {
			providerName: this.options.providerName,
			modelId: this.options.modelId,
			toolProtocol: this.options.toolProtocol,
			rawEventCounts: this.rawEventCounts,
			recentEvents: this.recentEvents,
			sawText: this.sawText,
			sawReasoning: this.sawReasoning,
			sawToolCall: this.sawToolCall,
			sawUsage: this.sawUsage,
			...(extra ?? {}),
		}
	}

	logEmptyNativeTurn(extra?: Record<string, unknown>): boolean {
		const toolProtocol = this.options.toolProtocol
		const isNativeToolMode =
			toolProtocol === TOOL_PROTOCOL.JSON || toolProtocol === "json" || toolProtocol === "native"

		if (!isNativeToolMode || this.sawText || this.sawToolCall) {
			return false
		}

		console.error(
			`[PROVIDER_STREAM_DEBUG] empty_native_turn ${JSON.stringify(this.buildSummary(extra))}`,
		)
		return true
	}
}
