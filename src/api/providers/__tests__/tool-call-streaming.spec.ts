import { describe, expect, it } from "vitest"

import { OpenAiHandler } from "../openai"
import { OpenAiNativeHandler } from "../openai-native"

describe("tool call streaming completion", () => {
	it("emits tool_call_end for OpenAI chat-completions finish_reason=tool_calls", async () => {
		const handler = new OpenAiHandler({} as any)

		async function* stream() {
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_123",
									function: {
										name: "write",
										arguments: "{\"path\":\"demo.txt\",\"content\":\"hello\"}",
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			} as any
		}

		const chunks = []
		for await (const chunk of (handler as any).handleStreamResponse(stream())) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_123",
				name: "write",
				arguments: "{\"path\":\"demo.txt\",\"content\":\"hello\"}",
			},
			{
				type: "tool_call_end",
				id: "call_123",
			},
		])
	})

	it("emits tool_call_end for OpenAI Responses arguments.done events", async () => {
		const handler = new OpenAiNativeHandler({ openAiNativeApiKey: "test-key" } as any)

		const chunks = []
		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.function_call_arguments.done",
				call_id: "call_456",
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call_end",
				id: "call_456",
			},
		])
	})
})
