import { mkdtemp, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { describe, expect, it } from "vitest"
import { LuxurySpa } from "../LuxurySpa"
import {
	HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
	formatWriteHistoryPlaceholderBody,
} from "../../prompts/responses"

describe("LuxurySpa", () => {
    describe("blockRegex", () => {
        it("matches wrapped unified read blocks without consuming the next tool result", () => {
            const regex = new RegExp((LuxurySpa as any).blockRegex)
            const text = `Read result for src/app.ts
Read Content:
Lines 1-2:
1→const a = 1
2→const b = 2
EOF`
            const matches = Array.from(text.matchAll(regex))
            expect(matches.length).toBe(1)
        })
    })

    describe("structured edit detection", () => {
        it("detects compact unified @edit history blocks without relying on EOF", () => {
            const spa = new LuxurySpa({
                cwd: "/tmp",
                apiConversationHistory: [],
                clineMessages: [],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            } as any)

            const source = [
                '@edit: "src/app.ts"',
                '"1-3|Content placed in paired result below→Content placed in paired result below"',
                '@read: "src/app.ts[1-10]"',
            ].join("\n")

            const insideOffset = source.indexOf("Content placed in paired result below")
            const outsideOffset = source.lastIndexOf('@read: "src/app.ts[1-10]"')

            expect((spa as any).isOffsetInsideStructuredEditResult(source, insideOffset)).toBe(true)
            expect((spa as any).isOffsetInsideStructuredEditResult(source, outsideOffset)).toBe(false)
        })
    })

    describe("refreshContext", () => {
        it("respects requested line ranges during refresh and does not expand to full file", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "luxury-spa-ranged-preservation-"))
            try {
                const fullContent = "line 1\nline 2\nline 3\nline 4\nline 5"
                await writeFile(join(cwd, "main.ts"), fullContent, "utf8")

                const delegate = {
                    cwd,
                    apiConversationHistory: [
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 2-3:",
                                "2→old line 2",
                                "3→old line 3",
                                "EOF",
                            ].join("\n"),
                        },
                    ],
                    clineMessages: [],
                    saveApiConversationHistory: async () => {},
                    postStateToWebview: async () => {},
                    saveClineMessages: async () => {},
                }

                const spa = new LuxurySpa(delegate as any)
                // Track only lines 2-3
                spa.mergeLineRanges("main.ts", [{ start: 2, end: 3 }])

                await spa.refreshAllActiveContexts()

                const content = delegate.apiConversationHistory[0].content as string
                expect(content).toContain("Lines 2-3:")
                expect(content).toContain("2→line 2")
                expect(content).toContain("3→line 3")
                // Should not contain other lines
                expect(content).not.toContain("1→line 1")
                expect(content).not.toContain("4→line 4")
                expect(content).not.toContain("5→line 5")
            } finally {
                await rm(cwd, { recursive: true, force: true })
            }
        })

        it("does not widen tracked partial reads when edits only need refresh tracking", () => {
            const delegate = {
                cwd: "/tmp",
                apiConversationHistory: [],
                clineMessages: [],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            }

            const spa = new LuxurySpa(delegate as any)
            spa.mergeLineRanges("./main.ts", [{ start: 2, end: 3 }])

            spa.ensureTrackedFullRead("main.ts")

            expect(spa.hasTrackedRead("main.ts")).toBe(true)
            expect(spa.activeFileReads.get("main.ts")).toEqual([{ start: 2, end: 3 }])
        })

        it("does not downgrade a full read when a later partial read is tracked", () => {
            const delegate = {
                cwd: "/tmp",
                apiConversationHistory: [],
                clineMessages: [],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            }

            const spa = new LuxurySpa(delegate as any)
            spa.ensureTrackedFullRead("main.ts")

            spa.mergeLineRanges("./main.ts", [{ start: 2, end: 3 }])

            expect(spa.hasTrackedRead("main.ts")).toBe(true)
            expect(spa.activeFileReads.get("main.ts")).toBeUndefined()
        })

        it("tracks a full file read when edits touch an untracked file", () => {
            const delegate = {
                cwd: "/tmp",
                apiConversationHistory: [],
                clineMessages: [],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            }

            const spa = new LuxurySpa(delegate as any)

            spa.ensureTrackedFullRead("main.ts")

            expect(spa.hasTrackedRead("main.ts")).toBe(true)
            expect(spa.activeFileReads.has("main.ts")).toBe(true)
            expect(spa.activeFileReads.get("main.ts")).toBeUndefined()
        })

        it("marks lines touched across recent edits with content-anchored markers", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "luxury-spa-edited-markers-"))
            try {
                const fullContent = "new top line\nline 1 updated\nline 2 updated\nline 3 updated\nline 4"
                await writeFile(join(cwd, "main.ts"), fullContent, "utf8")

                const delegate = {
                    cwd,
                    apiConversationHistory: [
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 1-5:",
                                "1→old inserted line",
                                "2→line 1",
                                "3→old line 2",
                                "4→old line 3",
                                "5→line 4",
                                "EOF",
                            ].join("\n"),
                        },
                    ],
                    clineMessages: [],
                    saveApiConversationHistory: async () => {},
                    postStateToWebview: async () => {},
                    saveClineMessages: async () => {},
                }

                const spa = new LuxurySpa(delegate as any)
                spa.activeFileReads.set("main.ts", undefined)
                spa.fileEditCounts.set(join(cwd, "main.ts"), 1)
                spa.recordRecentEditBlocks("main.ts", [
                    {
                        index: 1,
                        status: "applied",
                        startLine: 1,
                        endLine: 1,
                        oldText: "",
                        newText: "new top line\n",
                    },
                ])
                spa.recordRecentEditBlocks("main.ts", [
                    {
                        index: 2,
                        status: "applied",
                        startLine: 2,
                        endLine: 3,
                        oldText: "line 2\nline 3\n",
                        newText: "line 2 updated\nline 3 updated\n",
                    },
                ])

                await spa.refreshAllActiveContexts()

                const content = delegate.apiConversationHistory[0].content as string
                expect(content).toContain("*1→new top line")
                expect(content).toContain("2→line 1 updated")
                expect(content).toContain("**3→line 2 updated")
                expect(content).toContain("**4→line 3 updated")
                expect(content).toContain("5→line 4")
                expect(content).toContain("most up-to-date file content")
                expect(content).toContain("Line numbers beginning with * mark added lines")
            } finally {
                await rm(cwd, { recursive: true, force: true })
            }
        })

        it("keeps only the last 10 edit batches when marking refreshed reads", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "luxury-spa-edit-window-"))
            try {
                const fullContent = Array.from({ length: 12 }, (_, index) => `line ${index + 1} updated`).join("\n")
                await writeFile(join(cwd, "main.ts"), fullContent, "utf8")

                const delegate = {
                    cwd,
                    apiConversationHistory: [
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 1-12:",
                                ...Array.from({ length: 12 }, (_, index) => `${index + 1}→old line ${index + 1}`),
                                "EOF",
                            ].join("\n"),
                        },
                    ],
                    clineMessages: [],
                    saveApiConversationHistory: async () => {},
                    postStateToWebview: async () => {},
                    saveClineMessages: async () => {},
                }

                const spa = new LuxurySpa(delegate as any)
                spa.activeFileReads.set("main.ts", undefined)
                spa.fileEditCounts.set(join(cwd, "main.ts"), 11)
                for (let line = 1; line <= 11; line++) {
                    spa.recordRecentEditBlocks("main.ts", [
                        {
                            index: line,
                            status: "applied",
                            startLine: line,
                            endLine: line,
                            oldText: `old line ${line}\n`,
                            newText: `line ${line} updated\n`,
                        },
                    ])
                }

                await spa.refreshAllActiveContexts()

                const content = delegate.apiConversationHistory[0].content as string
                expect(content).toContain("1→line 1 updated")
                expect(content).toContain("**2→line 2 updated")
                expect(content).toContain("**11→line 11 updated")
                expect(content).not.toContain("**1→line 1 updated")
            } finally {
                await rm(cwd, { recursive: true, force: true })
            }
        })

        it("keeps disjoint partial reads instead of stripping them as if a later partial read covered the whole file", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "luxury-spa-disjoint-partials-"))
            try {
                const fullContent = "line 1 updated\nline 2 updated\nline 3\nline 4 updated\nline 5 updated"
                await writeFile(join(cwd, "main.ts"), fullContent, "utf8")

                const delegate = {
                    cwd,
                    apiConversationHistory: [
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 1-2:",
                                "1→old line 1",
                                "2→old line 2",
                                "EOF",
                            ].join("\n"),
                        },
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 4-5:",
                                "4→old line 4",
                                "5→old line 5",
                                "EOF",
                            ].join("\n"),
                        },
                    ],
                    clineMessages: [],
                    saveApiConversationHistory: async () => {},
                    postStateToWebview: async () => {},
                    saveClineMessages: async () => {},
                }

                const spa = new LuxurySpa(delegate as any)
                spa.mergeLineRanges("main.ts", [
                    { start: 1, end: 2 },
                    { start: 4, end: 5 },
                ])

                await spa.refreshAllActiveContexts()

                expect(delegate.apiConversationHistory[0].content).toContain("Lines 1-2:")
                expect(delegate.apiConversationHistory[0].content).toContain("1→line 1 updated")
                expect(delegate.apiConversationHistory[0].content).toContain("2→line 2 updated")
                expect(delegate.apiConversationHistory[1].content).toContain("Lines 4-5:")
                expect(delegate.apiConversationHistory[1].content).toContain("4→line 4 updated")
                expect(delegate.apiConversationHistory[1].content).toContain("5→line 5 updated")
            } finally {
                await rm(cwd, { recursive: true, force: true })
            }
        })

        it("keeps unified read blocks refreshable across multiple edits by preserving EOF", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "luxury-spa-refreshable-unified-"))
            try {
                await writeFile(join(cwd, "main.ts"), "line 1\nline 2\nline 3", "utf8")

                const delegate = {
                    cwd,
                    apiConversationHistory: [
                        {
                            role: "user",
                            content: [
                                "Read result for main.ts",
                                "Read Content:",
                                "Lines 2-3:",
                                "2→old line 2",
                                "3→old line 3",
                                "EOF",
                            ].join("\n"),
                        },
                    ],
                    clineMessages: [],
                    saveApiConversationHistory: async () => {},
                    postStateToWebview: async () => {},
                    saveClineMessages: async () => {},
                }

                const spa = new LuxurySpa(delegate as any)
                spa.mergeLineRanges("main.ts", [{ start: 2, end: 3 }])

                await spa.refreshAllActiveContexts()
                expect(delegate.apiConversationHistory[0].content).toContain("EOF")
                expect(delegate.apiConversationHistory[0].content).toContain("2→line 2")

                await writeFile(join(cwd, "main.ts"), "line 1\nline 2 updated again\nline 3 updated again", "utf8")
                spa.markFilesDirty(["main.ts"])

                await spa.refreshAllActiveContexts()

                expect(delegate.apiConversationHistory[0].content).toContain("2→line 2 updated again")
                expect(delegate.apiConversationHistory[0].content).toContain("3→line 3 updated again")
                expect(delegate.apiConversationHistory[0].content).toContain("EOF")
            } finally {
                await rm(cwd, { recursive: true, force: true })
            }
        })
    })

    describe("native tool history compaction", () => {
        it("compacts successful native write and edit tool inputs before save", () => {
            const delegate = {
                cwd: "/tmp",
                apiConversationHistory: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "tool_use",
                                id: "call_write_1",
                                name: "write",
                                input: {
                                    path: "index.html",
                                    content: "<!doctype html>",
                                },
                            },
                            {
                                type: "tool_use",
                                id: "call_edit_1",
                                name: "edit",
                                input: {
                                    path: "src/app.ts",
                                    edit: [
                                        {
                                            start_line: 10,
                                            end_line: 12,
                                            oldText: "before",
                                            newText: "after",
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    {
                        role: "user",
                        content: [
                            { type: "tool_result", tool_use_id: "call_write_1", content: "ok" },
                            { type: "tool_result", tool_use_id: "call_edit_1", content: "ok" },
                        ],
                    },
                ],
                clineMessages: [
                    {
                        say: "tool",
                        text: JSON.stringify({
                            tool: "newFileCreated",
                            id: "call_write_1",
                            path: "index.html",
                            content: "<!doctype html>",
                            diff: "--- raw diff ---",
                        }),
                    },
                    {
                        say: "tool",
                        text: JSON.stringify({
                            tool: "appliedDiff",
                            id: "call_edit_1",
                            path: "src/app.ts",
                            diff: "--- raw edit diff ---",
                            edits: [
                                {
                                    oldText: "before",
                                    newText: "after",
                                },
                            ],
                        }),
                    },
                ],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            }

            const spa = new LuxurySpa(delegate as any)
            ;(spa as any).compactSuccessfulNativeToolHistory()

            const assistantContent = delegate.apiConversationHistory[0].content as any[]
            expect(assistantContent[0].input).toEqual({
                path: "index.html",
            })
            expect(assistantContent[1].input.edit[0]).toMatchObject({
                start_line: 10,
                end_line: 12,
            })
            expect(assistantContent[1].input.edit[0]).not.toHaveProperty("oldText")
            expect(assistantContent[1].input.edit[0]).not.toHaveProperty("newText")
            expect(JSON.parse(delegate.clineMessages[0].text as string)).toMatchObject({
                content: formatWriteHistoryPlaceholderBody("<!doctype html>"),
                diff: formatWriteHistoryPlaceholderBody("--- raw diff ---"),
            })
            expect(JSON.parse(delegate.clineMessages[1].text as string)).toMatchObject({
                diff: HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
                edits: [
                    {
                        oldText: HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
                        newText: HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
                    },
                ],
            })
        })

        it("drops execute write and edit command skeletons from model-facing assistant history", () => {
            const delegate = {
                cwd: "/tmp",
                apiConversationHistory: [
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "tool_use",
                                id: "call_execute_1",
                                name: "execute",
                                input: {
                                    calls: [
                                        { name: "write", arguments: { path: "sample.txt", content: "hello" } },
                                        { name: "edit", arguments: { path: "src/app.ts", oldText: "a", newText: "b" } },
                                        { name: "read", arguments: { files: ["src/app.ts:H20"] } },
                                    ],
                                },
                            },
                        ],
                    },
                    {
                        role: "user",
                        content: [{ type: "tool_result", tool_use_id: "call_execute_1", content: "ok" }],
                    },
                ],
                clineMessages: [],
                saveApiConversationHistory: async () => {},
                postStateToWebview: async () => {},
                saveClineMessages: async () => {},
            }

            const spa = new LuxurySpa(delegate as any)
            ;(spa as any).compactSuccessfulNativeToolHistory()

            const assistantContent = delegate.apiConversationHistory[0].content as any[]
            expect(assistantContent[0].input).toEqual({
                commands: ["read src/app.ts:H20"],
            })
        })
    })
})
