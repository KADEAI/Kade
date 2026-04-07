import { describe, expect, it } from "vitest"

import { normalizeToolsToOpenAI } from "./converters"
import { createExecuteTool, resolveToolsRouterOperation } from "./registry"

describe("native tools OpenAI normalization", () => {
	it("preserves the structured tool(calls: object[]) schema", () => {
		const [tool] = normalizeToolsToOpenAI([
			createExecuteTool({
				enabledCanonicalTools: new Set(["read", "grep", "bash"]),
			}),
		])

		const schema = (tool as any).function.parameters

		expect((tool as any).function.name).toBe("tool")
		expect((tool as any).function.strict).toBe(false)
		expect(schema.required).toEqual(["calls"])
		expect(schema.properties.calls.type).toBe("array")
		expect(schema.properties.calls.minItems).toBe(1)
		expect(schema.properties.calls.items.type).toBe("object")
		expect(schema.properties.calls.items.required).toEqual(["tool"])
		expect(schema.properties.calls.items.properties.tool.type).toBe("string")
		expect(schema.properties.calls.items.properties.tool.enum).toEqual([
			"read",
			"grep",
			"bash",
			"agent",
		])
		expect(schema.properties.calls.items.properties.path.type).toEqual([
			"string",
			"array",
			"null",
		])
		expect(schema.properties.calls.items.properties.query.type).toEqual([
			"string",
			"array",
			"null",
		])
		expect(schema.properties.calls.items.properties.stdin).toBeUndefined()
		expect(schema.properties.calls.items.properties.execution_id).toBeUndefined()
		expect(schema.properties.calls.items.properties.todos).toBeUndefined()
		expect(schema.properties.calls.items.properties.action).toBeUndefined()
		expect(schema.properties.content).toBeUndefined()
	})

	it("tells the model to use structured JSON call objects for edits and writes", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["edit", "write", "todo"]),
		})

		expect(tool.description).toContain("Description:")
		expect(tool.description).toContain("Syntax:")
		expect(tool.description).toContain("Examples:")
		expect(tool.description).toContain(
			"The calls array uses standard JSON objects.",
		)
		expect(tool.description).toContain(
			"Each calls item must be an object with a tool field",
		)
		expect(tool.description).toContain(
			"prefer flat old/new/lines fields",
		)
		expect((tool.params as any).calls.description).toContain(
			"Ordered JSON tool calls",
		)
		expect((tool.params as any).calls.items.properties.edit.description).toContain(
			"Structured edit payload",
		)
		expect((tool.params as any).calls.items.properties.old.type).toEqual([
			"string",
			"null",
		])
		expect((tool.params as any).calls.items.properties.new.type).toEqual([
			"string",
			"null",
		])
		expect((tool.params as any).calls.items.properties.lines.type).toEqual([
			"string",
			"null",
		])
		expect((tool.params as any).calls.items.properties.query).toBeUndefined()
		expect((tool.params as any).calls.items.properties.prompt).toBeDefined()
		expect((tool.params as any).calls.items.properties.todos).toBeDefined()
	})

	it("tells the model to use '.' when listing the current working directory", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["list"]),
		})

		expect(tool.description).toContain(
			`{ "tool": "read", "path": ["src/app.ts:L10-40", "package.json:H20"] }`,
		)
		expect((tool.params as any).calls.items.properties.path.description).toContain(
			"use '.' for the current working directory",
		)
		expect((tool.params as any).calls.items.properties.tool.enum).toEqual([
			"list",
			"agent",
		])
		expect((tool.params as any).calls.items.properties.recursive).toBeDefined()
		expect((tool.params as any).calls.items.properties.include).toBeUndefined()
	})

	it("always advertises agent in the tool router description", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["read", "grep", "list"]),
		})

		expect(tool.description).toContain("Enabled commands: read, grep, list, agent.")
		expect(tool.description).toContain("Do not call read, grep, list, agent directly.")
		expect(tool.description).toContain('"tool": "agent"')
		expect(tool.description).not.toContain("access_mcp_resource")
		expect(tool.description).not.toContain("browser_action")
		expect((tool.params as any).calls.items.properties.tool.enum).not.toContain(
			"generate_image",
		)
	})

	it("describes the router with JSON object syntax instead of the old DSL", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["bash", "web", "fetch", "ask", "agent", "write"]),
		})

		expect(tool.description).toContain('{ "tool": "bash", "query": "npm run build", "path": "apps/web" }')
		expect(tool.description).toContain('{ "tool": "fetch", "url": "https://example.com" }')
		expect(tool.description).toContain('{ "tool": "ask", "query": "auth flow entrypoint", "path": "src" }')
		expect(tool.description).toContain('{ "tool": "agent", "prompt": "analyze the current project structure" }')
		expect(tool.description).toContain('{ "tool": "write", "path": "notes.txt", "content": "build passed" }')
		expect(tool.description).toContain("Do not use DSL strings inside calls items.")
		expect(tool.description).not.toContain("bash:command or bash:optional path:command")
		expect((tool.params as any).calls.items.properties.stdin).toBeUndefined()
		expect((tool.params as any).calls.items.properties.execution_id).toBeUndefined()
		expect((tool.params as any).calls.items.properties.allowed_domains).toBeUndefined()
		expect((tool.params as any).calls.items.properties.blocked_domains).toBeUndefined()
		expect((tool.params as any).calls.items.properties.mode).toBeUndefined()
		expect((tool.params as any).calls.items.properties.api_provider).toBeUndefined()
		expect((tool.params as any).calls.items.properties.model_id).toBeUndefined()
	})

	it("makes grep and find JSON fields explicit", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["grep", "glob"]),
		})

		expect(tool.description).toContain('{ "tool": "grep", "query": ["auth", "login", "session"], "path": "src" }')
		expect(tool.description).toContain('{ "tool": "find", "query": "package.json,tsconfig.json", "path": "src" }')
		expect((tool.params as any).calls.items.properties.query.type).toEqual([
			"string",
			"array",
			"null",
		])
		expect((tool.params as any).calls.items.properties.include).toBeDefined()
		expect((tool.params as any).calls.items.properties.include_all).toBeUndefined()
		expect((tool.params as any).calls.items.properties.exclude).toBeUndefined()
	})

	it("makes read ranges explicit and includes edit/write JSON examples", () => {
		const tool = createExecuteTool({
			enabledCanonicalTools: new Set(["read", "edit", "write"]),
		})

		expect(tool.description).toContain('{ "tool": "read", "path": ["src/app.ts:L10-40", "package.json:H20"] }')
		expect(tool.description).toContain('{ "tool": "edit", "path": "src/app.ts", "old": "foo", "new": "bar", "lines": "10-12" }')
		expect(tool.description).toContain('{ "tool": "write", "path": "notes.txt", "content": "build passed" }')
		expect((tool.params as any).calls.items.properties.path.type).toEqual([
			"string",
			"array",
			"null",
		])
	})

	it("resolves uppercase LS to the ls router operation", () => {
		expect(resolveToolsRouterOperation("LS")).toBe("ls")
	})
})
