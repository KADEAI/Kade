import { describe, expect, it, vi } from "vitest"

import { TOOL_PROTOCOL } from "@roo-code/types"

import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import { createExecuteTool } from "../../../core/prompts/tools/native-tools/registry"

function schemaContainsComposition(schema: unknown): boolean {
	if (!schema || typeof schema !== "object") {
		return false
	}

	if (Array.isArray(schema)) {
		return schema.some((item) => schemaContainsComposition(item))
	}

	const record = schema as Record<string, unknown>
	if (
		(Array.isArray(record.oneOf) && record.oneOf.length > 0) ||
		(Array.isArray(record.anyOf) && record.anyOf.length > 0) ||
		(Array.isArray(record.allOf) && record.allOf.length > 0)
	) {
		return true
	}

	return Object.values(record).some((value) => schemaContainsComposition(value))
}

describe("OpenAiCodexHandler", () => {
	it("attaches native JSON tool schemas to Codex Responses requests", () => {
		const handler = new OpenAiCodexHandler({} as any)
		const model = handler.getModel()

		const body = (handler as any).buildRequestBody(model, [], "system prompt", undefined, {
			taskId: "task-123",
			toolProtocol: TOOL_PROTOCOL.JSON,
			parallelToolCalls: false,
			tools: [
				{
					name: "write",
					description: "Write a file",
					params: {
						path: "Target path",
						content: "File content",
					},
					required: ["path"],
				},
				{
					type: "function",
					function: {
						name: "mcp--filesystem--read_file",
						description: "Read a file from MCP",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string" },
								encoding: { type: "string" },
							},
							required: ["path"],
						},
					},
				},
			],
		})

		expect(body.parallel_tool_calls).toBe(false)
		expect(body.prompt_cache_key).toBe("task-123")
		expect(body.tools).toHaveLength(2)
		expect(body.tools[0]).toEqual({
			type: "function",
			name: "write",
			description: "Write a file",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Target path" },
					content: { type: "string", description: "File content" },
				},
				required: ["path", "content"],
				additionalProperties: false,
			},
			strict: true,
		})
		expect(body.tools[1]).toEqual({
			type: "function",
			name: "mcp--filesystem--read_file",
			description: "Read a file from MCP",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					encoding: { type: "string" },
				},
				required: ["path"],
				additionalProperties: false,
			},
			strict: false,
		})
	})

	it("omits batch from Codex tool payloads because its open object schema is invalid for strict Codex tools", () => {
		const handler = new OpenAiCodexHandler({} as any)
		const model = handler.getModel()

		const body = (handler as any).buildRequestBody(model, [], "system prompt", undefined, {
			taskId: "task-123",
			toolProtocol: TOOL_PROTOCOL.JSON,
			parallelToolCalls: true,
			tools: [
				{
					name: "batch",
					description: "Batch calls",
					input_schema: {
						type: "object",
						properties: {
							calls: {
								type: "array",
								items: {
									type: "object",
									properties: {
										name: { type: "string" },
										arguments: {
											type: "object",
											additionalProperties: true,
										},
									},
									required: ["name", "arguments"],
									additionalProperties: false,
								},
							},
						},
						required: ["calls"],
						additionalProperties: false,
					},
				},
				{
					name: "read",
					description: "Read file",
					params: {
						path: "File path",
					},
				},
			],
		})

		expect(body.parallel_tool_calls).toBe(true)
		expect(body.prompt_cache_key).toBe("task-123")
		expect(body.tools).toHaveLength(1)
		expect(body.tools[0].name).toBe("read")
	})

	it("downgrades composed router schemas for Codex compatibility", () => {
		const handler = new OpenAiCodexHandler({} as any)
		const model = handler.getModel()

		const body = (handler as any).buildRequestBody(model, [], "system prompt", undefined, {
			taskId: "task-123",
			toolProtocol: TOOL_PROTOCOL.JSON,
			parallelToolCalls: true,
			tools: [
				createExecuteTool({
					enabledCanonicalTools: new Set(["read", "bash", "edit", "write"]),
				}),
			],
		})

		expect(body.tools).toHaveLength(1)
		expect(body.tools[0].name).toBe("tool")
		expect(body.tools[0].strict).toBe(false)
		expect(schemaContainsComposition(body.tools[0].parameters)).toBe(false)
	})

	it("does not emit a duplicate legacy tool_call when arguments are already streamed", async () => {
		const handler = new OpenAiCodexHandler({} as any)
		const chunks = []

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.output_item.added",
				item: {
					type: "function_call",
					call_id: "call_123",
					name: "bash",
				},
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.function_call_arguments.delta",
				call_id: "call_123",
				delta: "{\"command\":\"echo hi\"}",
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "call_123",
					name: "bash",
					arguments: "{\"command\":\"echo hi\"}",
				},
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.function_call_arguments.done",
				call_id: "call_123",
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_123",
				name: "bash",
				arguments: "{\"command\":\"echo hi\"}",
			},
			{
				type: "tool_call_end",
				id: "call_123",
			},
		])
	})

	it("does not fabricate '{}' when a completed tool call has no argument payload", async () => {
		const handler = new OpenAiCodexHandler({} as any)
		const chunks = []

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "call_456",
					name: "execute",
				},
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call",
				id: "call_456",
				name: "execute",
				arguments: "",
			},
		])
	})

	it("still falls back to a legacy tool_call when Codex only sends output_item.done", async () => {
		const handler = new OpenAiCodexHandler({} as any)
		const chunks = []

		for await (const chunk of (handler as any).processEvent(
			{
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "call_456",
					name: "bash",
					arguments: "{\"command\":\"echo hi\"}",
				},
			},
			{} as any,
		)) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call",
				id: "call_456",
				name: "bash",
				arguments: "{\"command\":\"echo hi\"}",
			},
		])
	})

	it("forwards the task id as the Codex conversation and session cache key", async () => {
		const handler = new OpenAiCodexHandler({} as any)
		const create = vi.fn().mockResolvedValue({
			async *[Symbol.asyncIterator]() {},
		})
		;(handler as any).client = { responses: { create } }
		;(handler as any).clientAccessToken = "token"
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue(null)

		const stream = (handler as any).executeRequest(
			{ model: "gpt-5.4", input: [], stream: true, prompt_cache_key: "task-123" },
			handler.getModel(),
			"token",
			"task-123",
		)

		for await (const _chunk of stream) {
			// No-op: this request only exists to capture the SDK call shape.
		}

		expect(create).toHaveBeenCalledTimes(1)
		expect(create.mock.calls[0][1]?.headers).toMatchObject({
			session_id: "task-123",
			conversation_id: "task-123",
		})
	})
})
