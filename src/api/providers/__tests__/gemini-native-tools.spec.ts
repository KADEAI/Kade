import { describe, expect, it } from "vitest"

import { collectGeminiNativeFunctionDeclarations, toGeminiSchema } from "../gemini-native-tools"

describe("gemini native tool normalization", () => {
	it("rewrites json schema into gemini-compatible format", () => {
		expect(
			toGeminiSchema({
				type: "object",
				properties: {
					path: { type: "string" },
					options: {
						type: "array",
						items: { type: "object", properties: { recursive: { type: "boolean" } }, additionalProperties: false },
					},
				},
				required: ["path", "missing"],
				additionalProperties: false,
			}),
		).toEqual({
			type: "OBJECT",
			properties: {
				path: { type: "STRING" },
				options: {
					type: "ARRAY",
					items: {
						type: "OBJECT",
						properties: {
							recursive: { type: "BOOLEAN" },
						},
					},
				},
			},
			required: ["path"],
		})
	})

	it("accepts function, custom, plain, and functionDeclarations tool shapes", () => {
		const declarations = collectGeminiNativeFunctionDeclarations([
			{
				function: {
					name: "glob",
					description: "Match files",
					parameters: {
						type: "object",
						properties: {
							pattern: { type: "string" },
						},
					},
				},
			},
			{
				custom: {
					name: "read_file",
					description: "Read file",
					input_schema: {
						type: "object",
						properties: {
							path: { type: "string" },
						},
					},
				},
			},
			{
				name: "list_dir",
				description: "List dir",
				input_schema: {
					type: "object",
					properties: {
						dir: { type: "string" },
					},
				},
			},
			{
				functionDeclarations: [
					{
						name: "grep",
						description: "Search text",
						parametersJsonSchema: {
							type: "object",
							properties: {
								query: { type: "string" },
							},
						},
					},
				],
			},
		])

		expect(declarations.map((declaration) => declaration.name)).toEqual(["glob", "read_file", "list_dir", "grep"])
		expect(declarations[0].parameters).toEqual({
			type: "OBJECT",
			properties: {
				pattern: { type: "STRING" },
			},
		})
		expect(declarations[1].parameters).toEqual({
			type: "OBJECT",
			properties: {
				path: { type: "STRING" },
			},
		})
		expect(declarations[3].parameters).toEqual({
			type: "OBJECT",
			properties: {
				query: { type: "STRING" },
			},
		})
	})
})
