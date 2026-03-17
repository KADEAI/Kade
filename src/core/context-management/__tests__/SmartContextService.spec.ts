import { generateSmartContext } from "../SmartContextService"
import { ApiMessage } from "../../task-persistence/apiMessages"

describe("SmartContextService", () => {
    it("should handle empty messages", () => {
        const result = generateSmartContext([])
        expect(result).toEqual([])
    })

    it("should preserve the last user message intact", () => {
        const messages: ApiMessage[] = [
            { role: "user", content: "Hello", ts: 1000 },
            { role: "assistant", content: "Hi", ts: 2000 },
            { role: "user", content: "Last message", ts: 3000 }
        ]

        const result = generateSmartContext(messages)
        expect(result).toHaveLength(2)
        expect(result[1]).toEqual(messages[2])
    })

    it("should condense older messages and preserve recent window", () => {
        const messages: ApiMessage[] = []
        // Generate enough messages to push past the "recent" window
        // Recent window: 3 user, 6 assistant
        // We will create 10 user, 10 assistant pairs
        for (let i = 0; i < 10; i++) {
            messages.push({ role: "user", content: `User message ${i} ` + "word ".repeat(50), ts: 1000 + i })
            messages.push({ role: "assistant", content: `Assistant message ${i} ` + "word ".repeat(50), ts: 1000 + i })
        }
        // Add one final user message
        messages.push({ role: "user", content: "Final Trigger", ts: 9999 })

        const result = generateSmartContext(messages)

        expect(result).toHaveLength(2) // Summary + Last message
        const summary = result[0].content as string
        const lastMsg = result[1]

        expect(lastMsg.content).toBe("Final Trigger")
        expect(summary).toContain("Context Summary:")

        // Check recent user messages (last 3, indices 7, 8, 9 of user messages)
        // User message 9 is index 18 in full list
        // User message 7: "User message 7" -> Should have 200 words (full content is ~53 words here) - Actually our test content is short (53 words).
        // Let's verify string contains full content for recent messages
        expect(summary).toContain("User: User message 7")
        expect(summary).toContain("User: User message 8")
        expect(summary).toContain("User: User message 9")

        // Check older user messages (index 0)
        // Should be truncated. "User message 0" ...
        expect(summary).toContain("User: User message 0")

        // Smart Context Logic:
        // Recent User: Keep last 200 words. (Our messages are ~53 words, so they should be fully kept)
        // Older User: Keep first 30 words.

        // Check older truncated message length roughly
        // "User message 0 word word..."
        // We can't easily assert exact string without re-implementing logic, 
        // but we can check it doesn't contain the end if it was long enough.
    })

    it("should truncate long older messages", () => {
        const longText = "start " + "middle ".repeat(100) + " end"
        // 102 words approx
        // Older User: Keep first 30. Should contain "start" but not "end".

        const messages: ApiMessage[] = [
            { role: "user", content: longText, ts: 1 }, // Older (will be outside recent 3 if we add enough)
            { role: "assistant", content: "response", ts: 2 },
            // Fill recent buffer
            { role: "user", content: "recent 1", ts: 3 },
            { role: "assistant", content: "resp 1", ts: 4 },
            { role: "user", content: "recent 2", ts: 5 },
            { role: "assistant", content: "resp 2", ts: 6 },
            { role: "user", content: "recent 3", ts: 7 },
            { role: "assistant", content: "resp 3", ts: 8 },
            { role: "user", content: "Final", ts: 9 }
        ]

        const result = generateSmartContext(messages)
        const summary = result[0].content as string

        // Older User (message 0): Keep first 30 words.
        // Should have "start", should NOT have "end" (because it's at the end of 100 words)
        // Actually "middle ".repeat(100) is 100 words. Total 102.
        // First 30 words = "start" + 29 middles.
        // "end" is at word 102.

        expect(summary).toContain("User: start")
        expect(summary).not.toContain(" end\n") // " end" might appear if we aren't careful, but "end" is the last word.
    })

    it("should truncate long recent messages appropriately", () => {
        // Recent Assistant: Keep last 850 words.
        // Let's allow a very long message.
        const longText = "start " + "word ".repeat(1000) + " end"

        const messages: ApiMessage[] = [
            { role: "user", content: "One", ts: 1 },
            { role: "assistant", content: longText, ts: 2 }, // Recent (within last 6)
            { role: "user", content: "Final", ts: 3 }
        ]

        const result = generateSmartContext(messages)
        const summary = result[0].content as string

        // Assistant is recent. Keep LAST 850 words.
        // Should contain "end". Should NOT contain "start" (since total > 850).
        expect(summary).toContain("Assistant: ")
        expect(summary).toContain(" end")
        expect(summary).not.toContain("start ")
    })
})
