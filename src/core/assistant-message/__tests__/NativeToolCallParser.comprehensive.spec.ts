import { describe, expect, it } from "vitest"

import { NativeToolCallParser } from "../NativeToolCallParser"
import { nativeToolRegistry } from "../../prompts/tools/native-tools/registry"

type ParseCase = {
	name: string
	args: Record<string, unknown>
	expectedName?: string
	expectedNativeArgs?: Record<string, unknown>
	expectedOriginalName?: string
}

const registryParseCases: ParseCase[] = [
	{
		name: "execute",
		args: {
			commands: [
				"read src/app.ts:H20",
				'grep "foo" src',
				'bash "pnpm test" src',
			],
		},
		expectedName: "batch",
		expectedOriginalName: "execute",
		expectedNativeArgs: {
			calls: [
				{ name: "read", arguments: { files: ["src/app.ts:H20"] } },
				{ name: "grep", arguments: { query: "foo", path: "src" } },
				{ name: "bash", arguments: { command: "pnpm test", cwd: "src" } },
			],
		},
	},
]

const parserExtraCases: ParseCase[] = [
    {
        name: "attempt_completion",
        args: {
            result: "done",
        },
        expectedNativeArgs: {
            result: "done",
        },
    },
    {
        name: "batch",
        args: {
            calls: [
                { name: "list", arguments: { path: "src" } },
                { name: "grep", arguments: { query: "AuthService", path: "src" } },
            ],
        },
        expectedNativeArgs: {
            calls: [
                { name: "list", arguments: { path: "src" } },
                { name: "grep", arguments: { query: "AuthService", path: "src" } },
            ],
        },
    },

    {
        name: "run_slash_command",
        args: {
            command: "/compact",
            args: "--fast",
        },
        expectedNativeArgs: {
            command: "/compact",
            args: "--fast",
        },
    },
    {
        name: "switch_mode",
        args: {
            mode_slug: "architect",
            reason: "Need planning mode",
        },
        expectedNativeArgs: {
            mode_slug: "architect",
            reason: "Need planning mode",
        },
    },
    {
        name: "use_mcp_tool",
        args: {
            server_name: "filesystem",
            tool_name: "read_file",
            arguments: { path: "README.md" },
        },
        expectedNativeArgs: {
            server_name: "filesystem",
            tool_name: "read_file",
            arguments: { path: "README.md" },
        },
    },
    {
        name: "write_file",
        args: {
            path: "alias.txt",
            write: "via alias",
        },
        expectedName: "write",
        expectedOriginalName: "write_file",
        expectedNativeArgs: {
            path: "alias.txt",
            content: "via alias",
        },
    },
    {
        name: "read",
        args: {
            path: "fifty_lines.txt:L1-5",
        },
        expectedNativeArgs: {
            files: [{ path: "fifty_lines.txt", lineRanges: [{ start: 1, end: 5 }] }],
        },
    },
    {
        name: "list_files",
        args: {
            path: "src",
            recursive: false,
        },
        expectedName: "list",
        expectedOriginalName: "list_files",
        expectedNativeArgs: {
            path: "src",
            recursive: false,
        },
    },
    {
        name: "edit",
        args: {
            path: "src/app.ts",
            edit: [
                "oldText 10-12:\nfoo\nnewText:\nbar",
                "Search:\nbaz\nReplace:\nqux",
            ],
        },
        expectedNativeArgs: {
            path: "src/app.ts",
            edit: [
                { lineRange: "10-12", oldText: "foo", newText: "bar" },
                { oldText: "baz", newText: "qux" },
            ],
        },
    },
]

const partialCases: Array<{
    name: string
    chunk: string
    expectedName?: string
    expectedOriginalName?: string
    expectedNativeArgs: Record<string, unknown>
}> = [
    {
        name: "read",
        chunk: '{"files":["src/app.ts:L1-20"]',
        expectedNativeArgs: {
            files: [{ path: "src/app.ts", lineRanges: [{ start: 1, end: 20 }] }],
        },
    },
    {
        name: "read",
        chunk: '{"path":"fifty_lines.txt:L1-5"',
        expectedNativeArgs: {
            files: [{ path: "fifty_lines.txt", lineRanges: [{ start: 1, end: 5 }] }],
        },
    },
    {
        name: "edit",
        chunk: '{"path":"src/app.ts","edit":[{"lineRange":"10-12","oldText":"foo","newText":"bar"}]',
        expectedNativeArgs: {
            path: "src/app.ts",
            edit: [{ lineRange: "10-12", oldText: "foo", newText: "bar" }],
        },
    },
    {
        name: "edit",
        chunk: '{"path":"src/app.ts","edit":["oldText 10-12:\\nfoo\\nnewText:\\nbar"]',
        expectedNativeArgs: {
            path: "src/app.ts",
            edit: [{ lineRange: "10-12", oldText: "foo", newText: "bar" }],
        },
    },
    {
        name: "write",
        chunk: '{"path":"notes.txt","write":"hello"',
        expectedNativeArgs: {
            path: "notes.txt",
            content: "hello",
        },
    },
    {
        name: "ask",
        chunk: '{"query":"auth flow","path":"src"',
        expectedNativeArgs: {
            query: "auth flow",
            path: "src",
        },
    },
    {
        name: "bash",
        chunk: '{"command":"pnpm test","cwd":"src"',
        expectedNativeArgs: {
            command: "pnpm test",
            cwd: "src",
        },
    },
    {
        name: "web",
        chunk: '{"query":"parser coverage","allowed_domains":["example.com"]',
        expectedNativeArgs: {
            query: "parser coverage",
            allowed_domains: ["example.com"],
        },
    },
    {
        name: "fetch",
        chunk: '{"url":"https://example.com","include_links":true',
        expectedNativeArgs: {
            url: "https://example.com",
            include_links: true,
        },
    },
    {
        name: "agent",
        chunk: '{"prompt":"Inspect parser","mode":"code"',
        expectedNativeArgs: {
            prompt: "Inspect parser",
            mode: "code",
        },
    },
    {
        name: "browser_action",
        chunk: '{"action":"type","text":"hello","path":"shot.png"',
        expectedNativeArgs: {
            action: "type",
            text: "hello",
            path: "shot.png",
        },
    },
    {
        name: "generate_image",
        chunk: '{"prompt":"diagram","path":"out.png"',
        expectedNativeArgs: {
            prompt: "diagram",
            path: "out.png",
        },
    },
    {
        name: "grep",
        chunk: '{"query":"AuthService","path":"src"',
        expectedNativeArgs: {
            query: "AuthService",
            path: "src",
        },
    },
    {
        name: "glob",
        chunk: '{"pattern":"*.ts","path":"src"',
        expectedNativeArgs: {
            pattern: "*.ts",
            path: "src",
        },
    },
    {
        name: "list",
        chunk: '{"path":"src","recursive":true',
        expectedNativeArgs: {
            path: "src",
            recursive: true,
        },
    },
    {
        name: "tools",
        chunk: '{"tools":[{"read":["src/app.ts:H20"]},{"fetch":"https://example.com","include_links":true},{"bash":"pnpm test","path":"src"}]',
        expectedName: "batch",
        expectedOriginalName: "tools",
        expectedNativeArgs: {
            calls: [
                { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                { name: "fetch", arguments: { url: "https://example.com", include_links: true } },
                { name: "bash", arguments: { command: "pnpm test", cwd: "src" } },
            ],
        },
    },
    {
        name: "content",
        chunk: '{"content":[{"path":"notes.txt","write":"hello"}]',
        expectedName: "batch",
        expectedOriginalName: "content",
        expectedNativeArgs: {
            calls: [{ name: "write", arguments: { path: "notes.txt", content: "hello" } }],
        },
    },
    {
        name: "switch_mode",
        chunk: '{"mode_slug":"architect","reason":"need planning"',
        expectedNativeArgs: {
            mode_slug: "architect",
            reason: "need planning",
        },
    },
    {
        name: "todo",
        chunk: '{"todos":"- [ ] parser coverage"',
        expectedNativeArgs: {
            todos: "- [ ] parser coverage",
        },
    },
    {
        name: "use_mcp_tool",
        chunk: '{"server_name":"filesystem","tool_name":"read_file","arguments":{"path":"README.md"}}',
        expectedNativeArgs: {
            server_name: "filesystem",
            tool_name: "read_file",
            arguments: { path: "README.md" },
        },
    },
    {
        name: "access_mcp_resource",
        chunk: '{"server_name":"filesystem","uri":"file:///tmp/demo.txt"',
        expectedNativeArgs: {
            server_name: "filesystem",
            uri: "file:///tmp/demo.txt",
        },
    },
]

describe("NativeToolCallParser comprehensive coverage", () => {
	it("keeps registry tool coverage in sync with the comprehensive parser cases", () => {
		const coveredRegistryNames = registryParseCases.map((testCase) => testCase.name).sort()
		expect(coveredRegistryNames).toEqual(Object.keys(nativeToolRegistry).sort())
	})

	for (const testCase of registryParseCases) {
		it(`parses registry tool '${testCase.name}'`, () => {
			const toolUse = NativeToolCallParser.parseToolCall({
				id: `call_${testCase.name}`,
				name: testCase.name as any,
				arguments: JSON.stringify(testCase.args),
			})

			expect(toolUse).toMatchObject({
				type: "tool_use",
				name: testCase.expectedName ?? testCase.name,
				partial: false,
				nativeArgs: testCase.expectedNativeArgs,
				...(testCase.expectedOriginalName ? { originalName: testCase.expectedOriginalName } : {}),
			})
		})
	}

	for (const testCase of parserExtraCases) {
		it(`parses parser-only or alias tool '${testCase.name}'`, () => {
			const toolUse = NativeToolCallParser.parseToolCall({
				id: `call_${testCase.name}`,
				name: testCase.name as any,
				arguments: JSON.stringify(testCase.args),
			})

			expect(toolUse).toMatchObject({
				type: "tool_use",
				name: testCase.expectedName ?? testCase.name,
				partial: false,
				nativeArgs: testCase.expectedNativeArgs,
				...(testCase.expectedOriginalName ? { originalName: testCase.expectedOriginalName } : {}),
			})
		})
	}

	for (const testCase of partialCases) {
		it(`streams partial native args for '${testCase.name}'`, () => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.startStreamingToolCall(`call_partial_${testCase.name}`, testCase.name)

			const toolUse = NativeToolCallParser.processStreamingChunk(`call_partial_${testCase.name}`, testCase.chunk)

            expect(toolUse).toMatchObject({
                type: "tool_use",
                name: testCase.expectedName ?? testCase.name,
                partial: true,
                nativeArgs: testCase.expectedNativeArgs,
                ...(testCase.expectedOriginalName ? { originalName: testCase.expectedOriginalName } : {}),
            })
		})
	}

	it("drops incomplete final edit calls that only contain a lineRange hint", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_edit_incomplete_line_range_only",
			name: "edit",
			arguments: JSON.stringify({
				path: "src/app.ts",
				edit: [{ lineRange: "10-12" }],
			}),
		})

		expect(toolUse).toBeNull()
	})

	it("drops incomplete streamed edit blocks until real edit content arrives", () => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.startStreamingToolCall("call_partial_edit_line_range_only", "edit")

		const toolUse = NativeToolCallParser.processStreamingChunk(
			"call_partial_edit_line_range_only",
			'{"path":"src/app.ts","edit":[{"lineRange":"10-12"}]',
		)

		expect(toolUse).toBeNull()
	})
})
