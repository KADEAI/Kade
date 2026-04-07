import { describe, expect, it, vi } from "vitest"

import { NativeToolCallParser } from "../NativeToolCallParser"
import { listDirTool } from "../../tools/ListFilesTool"
import {
	HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
	formatEditHistoryPreview,
	formatWriteHistoryPlaceholderBody,
} from "../../prompts/responses"

describe("NativeToolCallParser", () => {
	it("parses native list calls without requiring a path", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_list_1",
			name: "list",
			arguments: JSON.stringify({ recursive: true }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "list",
			partial: false,
			nativeArgs: { recursive: true },
			params: { recursive: "true" },
		})
	})

	it("parses zero-arg native list calls when providers send an empty arguments string", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_list_empty_1",
			name: "list",
			arguments: "",
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "list",
			partial: false,
			params: {},
		})
		expect((toolUse as any)?.nativeArgs).toBeUndefined()
	})

	it("finalizes streamed zero-arg native list calls with no argument deltas", () => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.startStreamingToolCall("call_list_empty_stream_1", "list")

		const toolUse = NativeToolCallParser.finalizeStreamingToolCall("call_list_empty_stream_1")

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "list",
			partial: false,
			params: {},
		})
		expect((toolUse as any)?.nativeArgs).toBeUndefined()
	})

	it("parses native grep calls when path is omitted", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_grep_1",
			name: "grep",
			arguments: JSON.stringify({ query: ["auth", "login"], include_all: true }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "grep",
			partial: false,
			nativeArgs: {
				query: ["auth", "login"],
				include_all: true,
			},
		})
	})

	it("preserves native grep include and exclude arrays", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_grep_1b",
			name: "grep",
			arguments: JSON.stringify({
				query: "textarea",
				include: ["*.tsx", "*.ts", "*.jsx", "*.js"],
				exclude: ["*.spec.tsx", "*.test.tsx"],
			}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "grep",
			partial: false,
			nativeArgs: {
				query: "textarea",
				include: ["*.tsx", "*.ts", "*.jsx", "*.js"],
				exclude: ["*.spec.tsx", "*.test.tsx"],
			},
		})
	})

	it("normalizes the native grep pattern alias to query", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_grep_2",
			name: "grep",
			arguments: JSON.stringify({ pattern: "fn main", path: "." }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "grep",
			partial: false,
			nativeArgs: {
				query: "fn main",
				path: ".",
			},
		})
	})

	it("normalizes the native grep command alias to query", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_grep_3",
			name: "grep",
			arguments: JSON.stringify({ command: "agent", path: "zed" }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "grep",
			partial: false,
			params: {
				query: "agent",
				path: "zed",
			},
			nativeArgs: {
				query: "agent",
				path: "zed",
			},
		})
	})

	it("normalizes the native bash query alias to command", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_bash_1",
			name: "bash",
			arguments: JSON.stringify({ query: "ls -la", cwd: "." }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "bash",
			partial: false,
			params: {
				query: "ls -la",
				cwd: ".",
				command: "ls -la",
			},
			nativeArgs: {
				command: "ls -la",
				cwd: ".",
			},
		})
	})

	it("normalizes native read file targets with combined head and tail modifiers", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_read_combined_head_tail_1",
			name: "read",
			arguments: JSON.stringify({
				files: ["webview-ui/src/components/chat/ChatRow.tsx:H100,T100"],
			}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "read",
			partial: false,
			nativeArgs: {
				files: [
					{
						path: "webview-ui/src/components/chat/ChatRow.tsx",
						head: 100,
						tail: 100,
					},
				],
			},
		})
	})

	it("normalizes the native fetch query alias to url", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_fetch_1",
			name: "fetch",
			arguments: JSON.stringify({ query: "https://www.whitehouse.gov/live/" }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "fetch",
			partial: false,
			params: {
				query: "https://www.whitehouse.gov/live/",
				url: "https://www.whitehouse.gov/live/",
			},
			nativeArgs: {
				url: "https://www.whitehouse.gov/live/",
			},
		})
	})

	it("parses wrapped native read tool_call payloads with parameter=path", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_read_wrapped_1",
			name: "read",
			arguments: [
				"<tool_call>",
				"<function=read>",
				"<parameter=path>",
				"zed/zed-agent-issues.md",
				"</parameter>",
				"</function>",
				"</tool_call>",
			].join("\n"),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "read",
			partial: false,
			params: {
				path: "zed/zed-agent-issues.md",
			},
			nativeArgs: {
				files: [{ path: "zed/zed-agent-issues.md" }],
			},
		})
	})

	it("normalizes the native read file alias to path inside wrapped tool_call payloads", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_read_wrapped_2",
			name: "read",
			arguments: [
				"<tool_call>",
				"<function=read>",
				"<parameter=file>",
				"zed/zed-agent-issues.md",
				"</parameter>",
				"</function>",
				"</tool_call>",
			].join("\n"),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "read",
			partial: false,
			params: {
				path: "zed/zed-agent-issues.md",
			},
			nativeArgs: {
				files: [{ path: "zed/zed-agent-issues.md" }],
			},
		})
	})

	it("resolves list_dir to list", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_list_2",
			name: "list_dir" as any,
			arguments: JSON.stringify({ path: "src", recursive: true }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "list",
			originalName: "list_dir",
			partial: false,
			nativeArgs: {
				path: "src",
				recursive: true,
			},
		})
	})

	it("normalizes the native glob query alias to pattern", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_glob_1",
			name: "glob",
			arguments: JSON.stringify({ query: "*.ts", path: "src" }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "glob",
			partial: false,
			nativeArgs: {
				pattern: "*.ts",
				path: "src",
			},
		})
	})

    it("parses batch calls with nested tool arguments", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_batch_1",
            name: "batch",
            arguments: JSON.stringify({
                calls: [
                    { name: "list", arguments: { path: "src" } },
                    { name: "grep", arguments: { query: "AuthService", path: "src" } },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            partial: false,
            nativeArgs: {
                calls: [
                    { name: "list", arguments: { path: "src" } },
                    { name: "grep", arguments: { query: "AuthService", path: "src" } },
                ],
            },
        })
    })

    it("parses execute command arrays into canonical batch calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "read:src/app.ts:H20",
                    "grep:src:workspace|task",
                    "bash:src:pnpm test",
                    "edit src/app.ts\noldText 10-12:\nfoo\nnewText:\nbar",
                    "write:notes.txt|hello world",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                    { name: "grep", arguments: { query: "workspace|task", path: "src" } },
                    { name: "bash", arguments: { command: "pnpm test", cwd: "src" } },
                    { name: "edit", arguments: { path: "src/app.ts", edit: "oldText 10-12:\nfoo\nnewText:\nbar" } },
                    { name: "write", arguments: { path: "notes.txt", content: "hello world" } },
                ],
            },
        })
    })

    it("parses multiline colon-form execute write commands without truncating after the first line", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_multiline_write_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: [
                    [
                        "write:30lines.txt|Line 01: Morning light spills over the rooftop",
                        "Line 02: A train hums softly past the station",
                        "Line 03: Coffee steam curls through the kitchen air",
                    ].join("\n"),
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    {
                        name: "write",
                        arguments: {
                            path: "30lines.txt",
                            content: [
                                "Line 01: Morning light spills over the rooftop",
                                "Line 02: A train hums softly past the station",
                                "Line 03: Coffee steam curls through the kitchen air",
                            ].join("\n"),
                        },
                    },
                ],
            },
        })
    })

    it("reroutes malformed direct write calls carrying grouped tool DSL payloads", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_write_grouped_payload_1",
            name: "write" as any,
            arguments: JSON.stringify({
                calls: JSON.stringify([
                    [
                        "write:index.html|<!DOCTYPE html>",
                        "<html>",
                        "<body>Hello</body>",
                        "</html>",
                    ].join("\n"),
                ]),
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            historyInput: {
                calls: JSON.stringify([
                    [
                        "write:index.html|<!DOCTYPE html>",
                        "<html>",
                        "<body>Hello</body>",
                        "</html>",
                    ].join("\n"),
                ]),
            },
            nativeArgs: {
                calls: [
                    {
                        name: "write",
                        arguments: {
                            path: "index.html",
                            content: [
                                "<!DOCTYPE html>",
                                "<html>",
                                "<body>Hello</body>",
                                "</html>",
                            ].join("\n"),
                        },
                    },
                ],
            },
        })
    })

    it("parses colon-form execute DSL for find, list, bash, web, fetch, ask, and agent", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_colon_dsl_2",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "find:src:package.json",
                    "find:*.tsx",
                    "list:.",
                    "bash:src:npm run build",
                    "bash:pwd",
                    "web:python apps",
                    "fetch:https://example.com",
                    "ask:src:auth flow entrypoint",
                    "ask:auth flow entrypoint",
                    "agent:inspect the parser",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "glob", arguments: { pattern: "package.json", path: "src" } },
                    { name: "glob", arguments: { pattern: "*.tsx" } },
                    { name: "list", arguments: { path: "." } },
                    { name: "bash", arguments: { command: "npm run build", cwd: "src" } },
                    { name: "bash", arguments: { command: "pwd" } },
                    { name: "web", arguments: { query: "python apps" } },
                    { name: "fetch", arguments: { url: "https://example.com" } },
                    { name: "ask", arguments: { query: "auth flow entrypoint", path: "src" } },
                    { name: "ask", arguments: { query: "auth flow entrypoint" } },
                    { name: "agent", arguments: { prompt: "inspect the parser" } },
                ],
            },
        })
    })

    it("parses colon-form execute DSL for read, grep, and split edit blocks", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_colon_dsl_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "read:game.py:1-7",
                    "read:game.py:T20",
                    "grep:src/components:authservice",
                    "edit:game.py",
                    "1-3|oldText->Edited line",
                    "4-7|otherOld->Other line",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["game.py:L1-7"] } },
                    { name: "read", arguments: { files: ["game.py:T20"] } },
                    { name: "grep", arguments: { query: "authservice", path: "src/components" } },
                    {
                        name: "edit",
                        arguments: {
                            path: "game.py",
                            edit: [
                                { lineRange: "1-3", oldText: "oldText", newText: "Edited line" },
                                { lineRange: "4-7", oldText: "otherOld", newText: "Other line" },
                            ],
                        },
                    },
                ],
            },
        })
    })

    it("supports shell-style grep flags in execute commands", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_grep_flags_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "grep -r\nsend",
                    'grep -iw "authservice" in src',
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "grep", arguments: { query: "send" } },
                    {
                        name: "grep",
                        arguments: {
                            query: "authservice",
                            path: "src",
                            case_insensitive: true,
                            whole_word: true,
                        },
                    },
                ],
            },
        })
    })

    it("supports newline line-range specifiers in execute read commands", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_read_range_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "read webview-ui/src/kilocode.css\n350-360",
                    "read src/app.ts\nH20",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["webview-ui/src/kilocode.css:L350-360"] } },
                    { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                ],
            },
        })
    })

    it("supports shell-style find syntax in execute commands", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_find_shell_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    'find . -name "*.tsx"',
                    'find src -iname "*.css"',
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "glob", arguments: { pattern: "*.tsx", path: "." } },
                    {
                        name: "glob",
                        arguments: {
                            pattern: "*.css",
                            path: "src",
                            case_insensitive: true,
                        },
                    },
                ],
            },
        })
    })

    it("reports execute command parse errors without dropping valid siblings", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_invalid_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "read src/app.ts:H20",
                    "edit src/app.ts",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [{ name: "read", arguments: { files: ["src/app.ts:H20"] } }],
                missingParamName: "commands",
                parseErrors: [
                    {
                        index: 1,
                        command: "edit src/app.ts",
                        error: "edit requires at least one oldText/newText block.",
                    },
                ],
            },
        })
    })

    it("validates execute DSL lines with per-command schemas", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_schema_invalid_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "browser_action type",
                    "list .",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [{ name: "list", arguments: { path: "." } }],
                missingParamName: "commands",
                parseErrors: [
                    {
                        index: 0,
                        command: "browser_action type",
                        error: 'browser_action text is required when action is "type".',
                    },
                ],
            },
        })
    })

    it("parses find DSL commands as pattern first with optional path second", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_find_pattern_first_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: [
                    "find sample.txt",
                    "find package.json in src",
                    "find src -name tsconfig.json",
                    "find -iname README.md .",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    { name: "glob", arguments: { pattern: "sample.txt" } },
                    { name: "glob", arguments: { pattern: "package.json", path: "src" } },
                    { name: "glob", arguments: { pattern: "tsconfig.json", path: "src" } },
                    { name: "glob", arguments: { pattern: "README.md", path: ".", case_insensitive: true } },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("parses grep DSL commands with an explicit in-path separator", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_grep_in_path_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: [
                    'grep "workspace|task" in src',
                    'grep hello in sample.txt',
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    { name: "grep", arguments: { query: "workspace|task", path: "src" } },
                    { name: "grep", arguments: { query: "hello", path: "sample.txt" } },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("parses bash DSL commands with an explicit in-path separator", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_bash_in_path_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: [
                    'bash "pnpm test" in src',
                    "bash npm run build in src",
                    'bash pwd in .',
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    { name: "bash", arguments: { command: "pnpm test", cwd: "src" } },
                    { name: "bash", arguments: { command: "npm run build", cwd: "src" } },
                    { name: "bash", arguments: { command: "pwd", cwd: "." } },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("keeps multi-word bash commands intact when no cwd is provided", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_bash_multiword_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: ["bash ls -la", "bash npm install"],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    { name: "bash", arguments: { command: "ls -la" } },
                    { name: "bash", arguments: { command: "npm install" } },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("salvages malformed tool calls payloads by extracting DSL strings from calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_calls_shim_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: JSON.stringify([
                    {
                        arguments:
                            "edit ten_lines.txt\noldText 1-2:\nLine 1: The quick brown fox jumps over the lazy dog.\nLine 2: A journey of a thousand miles begins with a single step.\nnewText:\nLine 1: The quick brown fox jumps over the lazy dog 🦊\nLine 2: A journey of a thousand miles begins with a single step 👣",
                        path: "ten_lines.txt",
                    },
                ]),
                missingParamName: "calls",
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "ten_lines.txt",
                            edit: "oldText 1-2:\nLine 1: The quick brown fox jumps over the lazy dog.\nLine 2: A journey of a thousand miles begins with a single step.\nnewText:\nLine 1: The quick brown fox jumps over the lazy dog 🦊\nLine 2: A journey of a thousand miles begins with a single step 👣",
                        },
                    },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("salvages malformed tool calls payloads that already contain direct batch call objects", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tool_calls_direct_1",
            name: "tool" as any,
            arguments: JSON.stringify({
                calls: JSON.stringify([
                    {
                        name: "edit",
                        arguments: {
                            path: "ten_lines.txt",
                            edit: "oldText 1-2:\nLine 1: The quick brown fox jumps over the lazy dog.\nLine 2: A journey of a thousand miles begins with a single step.\nnewText:\nLine 1: The quick brown fox jumps over the lazy dog 🦊\nLine 2: A journey of a thousand miles begins with a single step 👣",
                        },
                    },
                ]),
                missingParamName: "tools",
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tool",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "ten_lines.txt",
                            edit: "oldText 1-2:\nLine 1: The quick brown fox jumps over the lazy dog.\nLine 2: A journey of a thousand miles begins with a single step.\nnewText:\nLine 1: The quick brown fox jumps over the lazy dog 🦊\nLine 2: A journey of a thousand miles begins with a single step 👣",
                        },
                    },
                ],
                missingParamName: "calls",
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("normalizes execute verbs with glued trailing punctuation", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_punctuated_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "list.",
                    'bash, "pwd"',
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    { name: "list", arguments: { path: "." } },
                    { name: "bash", arguments: { command: "pwd" } },
                ],
            },
        })
        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("recovers split execute edit commands across adjacent array items", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_split_edit_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "edit webview-ui/src/kilocode.css",
                    "oldText\n.kade-send-button:not(:disabled):hover {\n  transform: scale(1.1) translateY(-2px);\n}\nnewText\n.kade-send-button:not(:disabled):hover {\n  transform: scale(1.05) translateY(-1px);\n}",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "webview-ui/src/kilocode.css",
                            edit: "oldText\n.kade-send-button:not(:disabled):hover {\n  transform: scale(1.1) translateY(-2px);\n}\nnewText\n.kade-send-button:not(:disabled):hover {\n  transform: scale(1.05) translateY(-1px);\n}",
                        },
                    },
                ],
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("recovers split execute write commands across adjacent array items", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_split_write_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    "write sample.txt",
                    "This is a sample text file.\nIt contains multiple lines of example content.",
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    {
                        name: "write",
                        arguments: {
                            path: "sample.txt",
                            content: "This is a sample text file.\nIt contains multiple lines of example content.",
                        },
                    },
                ],
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

    it("recovers JSON-stringified execute commands embedded as array items", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_execute_json_wrapped_1",
            name: "execute" as any,
            arguments: JSON.stringify({
                commands: [
                    `["edit webview-ui/src/kilocode.css\noldText .kade-send-button:not(:disabled):hover {\n  transform: scale(1.1) translateY(-2px);\n  box-shadow: 0 4px 12px var(--kade-accent-glow);\n}\nnewText .kade-send-button:not(:disabled):hover {\n  transform: scale(1.05) translateY(-1px);\n  box-shadow: 0 2px 6px var(--kade-accent-glow);\n}"]`,
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "webview-ui/src/kilocode.css",
                        },
                    },
                ],
            },
        })

        expect((toolUse as any).nativeArgs?.parseErrors).toBeUndefined()
    })

	it("recovers execute payloads even when providers mislabel the tool name", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_execute_mislabeled_1",
			name: "list" as any,
            arguments: JSON.stringify({
                commands: '["list ."]',
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "execute",
            nativeArgs: {
                calls: [{ name: "list", arguments: { path: "." } }],
			},
		})
	})

	it("unwraps execute payloads nested inside a name/arguments envelope", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_execute_wrapped_1",
			name: "execute" as any,
			arguments: JSON.stringify({
				name: "execute",
				arguments: {
					commands: ["list ."],
				},
			}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "execute",
			nativeArgs: {
				calls: [{ name: "list", arguments: { path: "." } }],
			},
		})
	})

    it("preserves the original empty execute payload for history debugging", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_execute_empty_1",
			name: "execute" as any,
			arguments: JSON.stringify({}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "execute",
			historyInput: {},
			nativeArgs: {
				calls: [],
				missingParamName: "commands",
			},
		})
	})

	it("preserves successful grouped execute input for history serialization", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_execute_history_1",
			name: "tool" as any,
			arguments: JSON.stringify({
				calls: ["read:src/app.ts:H20", "grep:src:authservice"],
			}),
		}) as any

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "tool",
			historyInput: {
				calls: ["read:src/app.ts:H20", "grep:src:authservice"],
			},
			nativeArgs: {
				calls: [
					{ name: "read", arguments: { files: ["src/app.ts:H20"] } },
					{ name: "grep", arguments: { query: "authservice", path: "src" } },
				],
			},
		})
	})

	it("parses structured tool router object calls into batch calls", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_tool_json_1",
			name: "tool" as any,
			arguments: JSON.stringify({
				calls: [
					{ tool: "read", path: ["src/app.ts:H20"] },
					{ tool: "find", query: "*.ts", path: "src" },
					{ tool: "bash", query: "pwd", path: "src" },
					{
						tool: "edit",
						path: "src/app.ts",
						old: "const before = true",
						new: "const before = false",
						lines: "10-10",
					},
					{ tool: "write", path: "notes.txt", content: "hello" },
					{ tool: "ask", query: "auth flow entrypoint", path: "src" },
				],
			}),
		}) as any

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "tool",
			nativeArgs: {
				calls: [
					{ name: "read", arguments: { files: ["src/app.ts:H20"] } },
					{ name: "glob", arguments: { pattern: "*.ts", path: "src" } },
					{ name: "bash", arguments: { command: "pwd", cwd: "src" } },
					{
						name: "edit",
						arguments: {
							path: "src/app.ts",
							lineRange: "10-10",
							oldText: "const before = true",
							newText: "const before = false",
						},
					},
					{ name: "write", arguments: { path: "notes.txt", content: "hello" } },
					{ name: "ask", arguments: { query: "auth flow entrypoint", path: "src" } },
				],
				missingParamName: "calls",
			},
		})
	})

	it("prefers the explicit non-edit tool discriminator when strict schemas force unrelated fields to be present", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_tool_json_strict_noise_1",
			name: "tool" as any,
			arguments: JSON.stringify({
				calls: [
					{
						tool: "grep",
						query: ["auth", "login", "session"],
						path: ".",
						prompt: "",
						url: "",
						content: "",
						old: "",
						new: "",
						lines: "",
						edit: [],
						todos: "",
						action: "launch",
						coordinate: "",
						size: "",
						text: "",
						image: "",
						server_name: "",
						uri: "",
						mode: "",
						api_provider: "",
						model_id: "",
						stdin: "",
						execution_id: "",
						recursive: false,
						include: "",
						include_all: false,
						exclude: "",
						allowed_domains: [],
						blocked_domains: [],
						include_links: false,
					},
				],
			}),
		}) as any

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "tool",
			nativeArgs: {
				calls: [
					{
						name: "grep",
						arguments: {
							query: ["auth", "login", "session"],
							path: ".",
						},
					},
				],
				missingParamName: "calls",
			},
		})
	})

	it("accepts a top-level single tool action as a compatibility form", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_tool_json_direct_1",
			name: "tool" as any,
			arguments: JSON.stringify({
				tool: "grep",
				query: ["auth", "login", "session"],
				path: ".",
			}),
		}) as any

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "batch",
			originalName: "tool",
			nativeArgs: {
				calls: [
					{
						name: "grep",
						arguments: {
							query: ["auth", "login", "session"],
							path: ".",
						},
					},
				],
				missingParamName: "calls",
			},
		})
	})

	it("parses tools router calls into batch calls", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_tools_1",
			name: "tools" as any,
            arguments: JSON.stringify({
                tools: [
                    { tool: "read", path: ["src/app.ts:H20"] },
                    { tool: "grep", query: "foo", path: "src" },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tools",
            partial: false,
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                    { name: "grep", arguments: { query: "foo", path: "src" } },
                ],
            },
        })
    })

    it("parses compact nested object forms for tools router calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tools_1b",
            name: "tools" as any,
            arguments: JSON.stringify({
                tools: [
                    { find: { query: "ToolActivity", path: "webview-ui/src" } },
                    { grep: { query: "error|warning", path: ["src", "webview-ui/src"] } },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tools",
            nativeArgs: {
                calls: [
                    { name: "glob", arguments: { pattern: "ToolActivity", path: "webview-ui/src" } },
                    { name: "grep", arguments: { query: "error|warning", path: ["src", "webview-ui/src"] } },
                ],
            },
        })
    })

    it("normalizes alias-heavy tools router calls into canonical batch calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tools_aliases_1",
            name: "tools" as any,
            arguments: JSON.stringify({
                tools: [
                    { tool: "read_file", path: "src/app.ts:H20" },
                    { glob: { query: "*.ts", path: "src" } },
                    { tool: "list", path: "." },
                    { tool: "bash", query: "pwd", path: "src" },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tools",
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                    { name: "glob", arguments: { pattern: "*.ts", path: "src" } },
                    { name: "list", arguments: { path: "." } },
                    { name: "bash", arguments: { command: "pwd", cwd: "src" } },
                ],
            },
        })
    })

    it("normalizes tools router compatibility fields for discriminator, args containers, and path/query aliases", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_tools_compat_shapes_1",
            name: "tools" as any,
            arguments: JSON.stringify({
                tools: [
                    { name: "read", args: { file: "src/app.ts:H20" } },
                    { operation: "find", params: { pattern: "*.ts", dir: "src" } },
                    { tool: "web", question: "where is the vite config" },
                    { name: "fetch", input: { url: "https://example.com/docs" } },
                    { operation: "command", args: { cmd: "pwd", cwd: "src" } },
                    { name: "agent", params: { task: "inspect auth flow" } },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "tools",
            nativeArgs: {
                calls: [
                    { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                    { name: "glob", arguments: { pattern: "*.ts", path: "src" } },
                    { name: "web", arguments: { query: "where is the vite config" } },
                    { name: "fetch", arguments: { url: "https://example.com/docs" } },
                    { name: "bash", arguments: { command: "pwd", cwd: "src" } },
                    { name: "agent", arguments: { prompt: "inspect auth flow" } },
                ],
            },
        })
    })

    it("parses content router calls into batch calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_1",
            name: "content" as any,
            arguments: JSON.stringify({
                content: [
                    { tool: "edit", path: "src/app.ts", lines: "10-12", old: "a", new: "b" },
                    { tool: "write", path: "notes.txt", content: "hello" },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [
                    { name: "edit", arguments: { path: "src/app.ts", lineRange: "10-12", oldText: "a", newText: "b" } },
                    { name: "write", arguments: { path: "notes.txt", content: "hello" } },
                ],
            },
        })
    })

    it("normalizes content router aliases into canonical write and edit calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_aliases_1",
            name: "content" as any,
            arguments: JSON.stringify({
                content: [
                    {
                        tool: "edit_file",
                        path: "src/app.ts",
                        lineRange: "10-12",
                        oldText: "a",
                        newText: "b",
                    },
                    {
                        write_file: {
                            path: "notes.txt",
                            content: "hello",
                        },
                    },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "src/app.ts",
                            lineRange: "10-12",
                            oldText: "a",
                            newText: "b",
                        },
                    },
                    {
                        name: "write",
                        arguments: {
                            path: "notes.txt",
                            content: "hello",
                        },
                    },
                ],
            },
        })
    })

    it("prefers the explicit write discriminator when content items include nullable edit fields", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_write_with_nullable_edit_fields",
            name: "content" as any,
            arguments: JSON.stringify({
                content: [
                    {
                        tool: "write",
                        path: "notes.txt",
                        content: "hello",
                        oldText: null,
                        newText: null,
                        lineRange: null,
                        edit: null,
                    },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [{ name: "write", arguments: { path: "notes.txt", content: "hello" } }],
            },
        })
    })

    it("parses content router calls when content is a stringified compact array", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_2",
            name: "content" as any,
            arguments: JSON.stringify({
                content: JSON.stringify([{ path: "notes.txt", write: "hello" }]),
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [{ name: "write", arguments: { path: "notes.txt", content: "hello" } }],
            },
        })
    })

    it("parses content router calls when content is a single compact object", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_3",
            name: "content" as any,
            arguments: JSON.stringify({
                content: {
                    path: "src/app.ts",
                    edit: [{ oldText: "a", newText: "b" }],
                },
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [{ name: "edit", arguments: { path: "src/app.ts", edit: [{ oldText: "a", newText: "b" }] } }],
            },
        })
    })


    it("treats top-level calls as a compatibility alias for content router payloads", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_calls_alias",
            name: "content" as any,
            arguments: JSON.stringify({
                calls: [],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [],
                missingParamName: "content",
            },
        })
    })

    it("reports malformed path-only content router items as parser errors", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_invalid_path_only",
            name: "content" as any,
            arguments: JSON.stringify({
                content: [{ path: "snake-game.html" }],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [],
                missingParamName: "content",
                parseError:
                    'Invalid content router item. Each item must specify "tool": "write" or "edit", or include a write/edit payload.',
            },
        })
    })

    it("lifts nested edit object paths inside content router calls", () => {
        const toolUse = NativeToolCallParser.parseToolCall({
            id: "call_content_4",
            name: "content" as any,
            arguments: JSON.stringify({
                content: [
                    {
                        edit: {
                            path: "webview-ui/src/components/settings/ApiOptions.tsx",
                            oldText: "before",
                            newText: "after",
                            lineRange: { start: 869, end: 965 },
                        },
                    },
                ],
            }),
        })

        expect(toolUse).toMatchObject({
            type: "tool_use",
            name: "batch",
            originalName: "content",
            nativeArgs: {
                calls: [
                    {
                        name: "edit",
                        arguments: {
                            path: "webview-ui/src/components/settings/ApiOptions.tsx",
                            edit: {
                                oldText: "before",
                                newText: "after",
                                lineRange: { start: 869, end: 965 },
                            },
                        },
                    },
                ],
            },
        })
    })

	it("streams partial native edit arguments before the tool call is complete", () => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.startStreamingToolCall("call_edit_partial_1", "edit")

		const toolUse = NativeToolCallParser.processStreamingChunk(
			"call_edit_partial_1",
			'{"path":"src/app.ts","edit":[{"oldText":"before","newText":"after"}]',
		)

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "edit",
			partial: true,
			params: {
				path: "src/app.ts",
			},
			nativeArgs: {
				path: "src/app.ts",
				edit: [{ oldText: "before", newText: "after" }],
			},
		})
	})

	it("compacts successful native write history inputs", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("write", {
				path: "index.html",
				content: "<!doctype html>",
			}),
		).toEqual({
			path: "index.html",
			content: formatWriteHistoryPlaceholderBody("<!doctype html>"),
		})
	})

	it("compacts execute batch history inputs into command strings", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("execute", {
				calls: [
					{ name: "read", arguments: { files: ["src/app.ts:H20"] } },
					{ name: "grep", arguments: { query: "workspace|task", path: "src" } },
					{ name: "glob", arguments: { pattern: "package.json|tsconfig.json", path: "src" } },
					{ name: "bash", arguments: { command: "pnpm test", cwd: "src" } },
					{ name: "write", arguments: { path: "notes.txt", content: "hello world" } },
				],
			}),
		).toEqual({
			commands: [
				"read:src/app.ts:H20",
				"grep:src:workspace|task",
				"find:src:package.json|tsconfig.json",
				"bash:src:pnpm test",
				`write:notes.txt|${formatWriteHistoryPlaceholderBody("hello world")}`,
			],
		})
	})

	it("drops body-less execute write and edit history commands when compacting for the model", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory(
				"execute",
				{
					calls: [
						{ name: "write", arguments: { path: "sample.txt", content: "hello" } },
						{ name: "edit", arguments: { path: "src/app.ts", oldText: "a", newText: "b" } },
						{ name: "read", arguments: { files: ["src/app.ts:H20"] } },
					],
				},
				{ forModel: true },
			),
			).toEqual({
				commands: ["read:src/app.ts:H20"],
			})
	})

	it("preserves grouped tool inputs when model compaction would otherwise erase every call", () => {
		const input = {
			calls: [
				{
					name: "edit",
					arguments: {
						path: "src/app.ts",
						edit: ["not-an-object"],
					},
				},
			],
		}

		expect(
			NativeToolCallParser.compactToolInputForHistory("tool", input, {
				forModel: true,
			}),
		).toEqual(input)
	})

	it("compacts native execute command arrays without dropping valid string commands", () => {
		const compacted = NativeToolCallParser.compactToolInputForHistory("execute", {
			commands: [
				"read:src/app.ts:H20",
				"write:notes.txt|hello world",
				"edit:src/app.ts\noldText:\nfoo\nnewText:\nbar",
			],
		}) as { commands: string[] }

		expect(compacted.commands[0]).toBe("read:src/app.ts:H20")
		expect(compacted.commands[1]).toBe(
			`write:notes.txt|${formatWriteHistoryPlaceholderBody("hello world")}`,
		)
		expect(compacted.commands[2]).toContain("edit:src/app.ts")
		expect(compacted.commands[2]).toContain(HISTORY_CONTENT_PLACEMENT_PLACEHOLDER)
		expect(compacted.commands[2]).toContain("old:")
		expect(compacted.commands[2]).toContain("new:")
	})

	it("compacts grouped tool call string history without dropping preserved calls", () => {
		const compacted = NativeToolCallParser.compactToolInputForHistory("tool", {
			calls: [
				"read:src/app.ts:H20",
				"write:notes.txt|hello world",
			],
		}) as { calls: string[] }

		expect(compacted.calls).toEqual([
			"read:src/app.ts:H20",
			`write:notes.txt|${formatWriteHistoryPlaceholderBody("hello world")}`,
		])
	})

	it("drops native write bodies in model-facing history compaction", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory(
				"write",
				{
					path: "index.html",
					content: "<!doctype html>",
				},
				{ forModel: true },
			),
		).toEqual({
			path: "index.html",
		})
	})

	it("compacts successful native edit history inputs while preserving block structure", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("edit", {
				path: "src/app.ts",
				edit: [
					{ start_line: 10, end_line: 12, oldText: "before", newText: "after" },
					{ start_line: 20, end_line: 20, oldText: "left", newText: "right" },
				],
			}),
		).toEqual({
			path: "src/app.ts",
			edit: [
				{
					start_line: 10,
					end_line: 12,
					old: "before",
					new: "after",
				},
				{
					start_line: 20,
					end_line: 20,
					old: "left",
					new: "right",
				},
			],
		})
	})

	it("compacts successful native flat edit history inputs", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("edit", {
				path: "sample.txt",
				lineRange: "1-4",
				oldText: "before",
				newText: "after",
			}),
		).toEqual({
			path: "sample.txt",
			lineRange: "1-4",
			old: "before",
			new: "after",
		})
	})

	it("drops native edit bodies in model-facing history compaction", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory(
				"edit",
				{
					path: "sample.txt",
					lineRange: "1-4",
					oldText: "before",
					newText: "after",
				},
				{ forModel: true },
			),
		).toEqual({
			path: "sample.txt",
			lineRange: "1-4",
		})
	})

	it("compacts grouped native content-router history inputs recursively", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("content", {
				calls: [
					{
						name: "write",
						arguments: {
							path: "sample.txt",
							content: "real file body",
						},
					},
					{
						name: "edit",
						arguments: {
							path: "src/app.ts",
							lineRange: "10-12",
							oldText: "before",
							newText: "after",
						},
					},
				],
			}),
		).toEqual({
			content: [
				{
					path: "sample.txt",
					write: formatWriteHistoryPlaceholderBody("real file body"),
				},
				{
					path: "src/app.ts",
					lines: "10-12",
					old: formatEditHistoryPreview("before"),
					new: formatEditHistoryPreview("after"),
				},
			],
		})
	})

	it("preserves metadata in grouped native content-router history inputs", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("content", {
				calls: [
					{
						name: "write",
						arguments: {
							path: "sample.txt",
							content: "real file body",
							metadata: { source: "test" },
						},
					},
				],
			}),
		).toEqual({
			content: [
				{
					path: "sample.txt",
					write: formatWriteHistoryPlaceholderBody("real file body"),
					metadata: { source: "test" },
				},
			],
		})
	})

	it("compacts grouped native tools-router history inputs back into public router shape", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("tools", {
				calls: [
					{
						name: "bash",
						arguments: {
							command: "ls -la",
							cwd: ".",
						},
					},
					{
						name: "fetch",
						arguments: {
							url: "https://www.whitehouse.gov/live/",
						},
					},
					{
						name: "list",
						arguments: {
							path: ".",
						},
					},
					{
						name: "read",
						arguments: {
							files: [{ path: "src/app.ts", head: 20 }, "package.json"],
						},
					},
				],
			}),
		).toEqual({
			tools: [
				{
					bash: "ls -la",
					path: ".",
				},
				{
					fetch: "https://www.whitehouse.gov/live/",
				},
				{
					ls: ".",
				},
				{
					read: ["src/app.ts:H20", "package.json"],
				},
			],
		})
	})

	it("preserves metadata in grouped native tools-router history inputs", () => {
		expect(
			NativeToolCallParser.compactToolInputForHistory("tools", {
				calls: [
					{
						name: "fetch",
						arguments: {
							url: "https://example.com",
							metadata: { source: "test" },
						},
					},
				],
			}),
		).toEqual({
			tools: [
				{
					fetch: "https://example.com",
					metadata: { source: "test" },
				},
			],
		})
	})

	it("normalizes the native grep command alias during XML recovery streaming", () => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.startStreamingToolCall("call_grep_partial_1", "grep")

		const toolUse = NativeToolCallParser.processStreamingChunk(
			"call_grep_partial_1",
			[
				"<tool_call>",
				"<function=grep>",
				"<parameter=command>agent</parameter>",
				"<parameter=path>zed</parameter>",
				"</function>",
				"</tool_call>",
			].join("\n"),
		)

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "grep",
			partial: true,
			params: {
				query: "agent",
				path: "zed",
			},
			nativeArgs: {
				query: "agent",
				path: "zed",
			},
		})
	})

	it("normalizes top-level native edit fields into the canonical edit array", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_edit_flat_1",
			name: "edit",
			arguments: JSON.stringify({
				path: "seventy_lines.txt",
				lineRange: "20-50",
				oldText: "before",
				newText: "after",
			}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "edit",
			partial: false,
			nativeArgs: {
				path: "seventy_lines.txt",
				edit: [
					{
						lineRange: "20-50",
						oldText: "before",
						newText: "after",
					},
				],
			},
		})
	})

	it("ignores malformed top-level native edit args when only the lineRange survived", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_edit_flat_incomplete_1",
			name: "edit",
			arguments: JSON.stringify({
				path: "seventy_lines.txt",
				lineRange: "20-50",
			}),
		})

		expect(toolUse).toBeNull()
	})

	it("normalizes object lineRange hints inside native edit blocks", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_edit_object_range_1",
			name: "edit",
			arguments: JSON.stringify({
				path: "sample.txt",
				edit: [
					{
						lineRange: { start: 462, end: 476 },
						oldText: "before",
						newText: "after",
					},
				],
			}),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "edit",
			partial: false,
			nativeArgs: {
				path: "sample.txt",
				edit: [
					{
						lineRange: "462-476",
						oldText: "before",
						newText: "after",
					},
				],
			},
		})
	})


	it("ignores partial streamed native edit args when the block only contains lineRange", () => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.startStreamingToolCall("call_edit_partial_incomplete_1", "edit")

		const toolUse = NativeToolCallParser.processStreamingChunk(
			"call_edit_partial_incomplete_1",
			'{"path":"src/app.ts","edit":[{"lineRange":"10-12"}]',
		)

		expect(toolUse).toBeNull()
	})

	it("silently ignores provider placeholder arguments", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_list_placeholder_1",
			name: "list",
			arguments: JSON.stringify({ _placeholder: true }),
		})

		expect(toolUse).toMatchObject({
			type: "tool_use",
			name: "list",
			partial: false,
			params: {},
		})
		expect(warnSpy).not.toHaveBeenCalled()

		warnSpy.mockRestore()
	})
})

describe("ListDirTool.handlePartial", () => {
	it("renders a partial native list row from nativeArgs without a path", async () => {
		const say = vi.fn().mockResolvedValue(undefined)
		const task = {
			cwd: "/workspace",
			say,
		} as any

		await listDirTool.handlePartial(task, {
			type: "tool_use",
			name: "list",
			id: "call_list_partial_1",
			params: {},
			nativeArgs: { recursive: true },
			partial: true,
		} as any)

		expect(say).toHaveBeenCalledTimes(1)
		expect(say.mock.calls[0][0]).toBe("tool")
		expect(say.mock.calls[0][2]).toBeUndefined()
		expect(say.mock.calls[0][3]).toBe(true)
		expect(JSON.parse(say.mock.calls[0][1])).toMatchObject({
			tool: "listDirRecursive",
			path: "",
			id: "call_list_partial_1",
			content: "",
		})
	})
})
