import { describe, expect, it } from "vitest";

import { TOOL_PROTOCOL } from "@roo-code/types";
import { formatWriteHistoryPlaceholderBody } from "../../prompts/responses";

import {
  collectFailedToolUseIdsFromContentBlocks,
  serializeAssistantBlocksForTextProtocol,
  translateApiMessagesForUnifiedHistory,
} from "../unifiedHistoryTranslation";

describe("translateApiMessagesForUnifiedHistory", () => {
  it("rewrites native tool_use and tool_result blocks into unified text history", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_list_1",
              name: "list",
              input: { path: "zed" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_list_1",
              content: "[LIST for 'zed']\nTotal files: 4",
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(translated[0]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: '@list: "zed"',
        },
      ],
    });
    expect(translated[1]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "[LIST for 'zed']\nTotal files: 4",
        },
      ],
    });
  });

  it("rewrites native read aliases and grep batches into unified syntax", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_read_1",
              name: "read",
              input: {
                files: [
                  { path: "zed/zed-agent-issues.md" },
                  { path: "src/app.ts", lineRanges: [{ start: 1, end: 20 }] },
                ],
              },
            },
            {
              type: "tool_use",
              id: "call_grep_1",
              name: "grep",
              input: { query: ["agent", "edit"], path: "zed" },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      [
        '@read: "zed/zed-agent-issues.md"',
        '@read: "src/app.ts:1-20"',
        '@grep: "agent|edit" "zed"',
      ].join("\n"),
    );
  });

  it("rewrites native tool history into markdown fences for markdown protocol", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_list_1",
              name: "list",
              input: { path: "zed" },
            },
            {
              type: "tool_use",
              id: "call_grep_1",
              name: "grep",
              input: { pattern: "agent", path: "zed" },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.MARKDOWN,
    );

    expect((translated[0] as any).content[0].text).toBe(
      ["```ls", "zed", "```", "", "```grep", "agent zed", "```"].join("\n"),
    );
  });

  it("summarizes native write tool history without re-emitting executable tool syntax", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_write_1",
              name: "write",
              input: {
                path: "src/app.ts",
                content: "const a = 1\nconst b = 2",
              },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      `@write: "src/app.ts|${formatWriteHistoryPlaceholderBody("const a = 1\nconst b = 2")}"`,
    );
  });

  it("summarizes native edit tool history while preserving original edit headers", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_edit_1",
              name: "edit",
              input: {
                path: "src/app.ts",
                edit: [
                  "Search 10-12:",
                  "const a = 1",
                  "Replace:",
                  "const a = 2",
                  "Search 20:",
                  "const b = 1",
                  "Replace:",
                  "const b = 2",
                ].join("\n"),
              },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      [
        '@edit: "src/app.ts"',
        '"10-12|const a...→const a..."',
        '"20|const b...→const b..."',
      ].join("\n"),
    );
  });

  it("preserves native write tool bodies when the paired tool result failed", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_write_failed_1",
              name: "write",
              input: {
                path: "src/app.ts",
                content: "const a = 1\nconst b = 2",
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_write_failed_1",
              content:
                "The tool execution failed with the following error:\nMissing value for required parameter 'content'. Please retry with complete response.",
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      '@write: "src/app.ts|const a = 1\\nconst b = 2"',
    );
  });

  it("preserves shell stdin tool calls in unified history", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_shell_1",
              name: "bash",
              input: {
                stdin: "alice",
                execution_id: "exec-123",
              },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_shell_1",
              content: "Sent stdin to the running terminal process.",
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      '@bash: "--stdin alice --execution_id exec-123"',
    );
    expect((translated[1] as any).content[0].text).toBe(
      "[SHELL stdin 'alice' for 'exec-123']\nSent stdin to the running terminal process.",
    );
  });

  it("rewrites computer_action tool history into unified desktop syntax", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_desktop_1",
              name: "computer_action",
              input: { action: "get_screenshot" },
            },
            {
              type: "tool_use",
              id: "call_desktop_2",
              name: "computer_action",
              input: {
                action: "left_click",
                coordinate: "500,500",
              },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect((translated[0] as any).content[0].text).toBe(
      ['@desktop: "get_screenshot"', '@desktop: "left_click:500,500"'].join(
        "\n",
      ),
    );
  });

  it("rewrites computer_action tool history into markdown desktop fences", () => {
    const translated = translateApiMessagesForUnifiedHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_desktop_md_1",
              name: "computer_action",
              input: {
                action: "scroll",
                coordinate: "500,500",
                text: "down:500",
              },
            },
          ],
        },
      ] as any,
      TOOL_PROTOCOL.MARKDOWN,
    );

    expect((translated[0] as any).content[0].text).toBe(
      ["```desktop", "scroll:500,500:down:500", "```"].join("\n"),
    );
  });

  it("leaves native history unchanged when protocol is not unified", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_list_1",
            name: "list",
            input: { path: "zed" },
          },
        ],
      },
    ] as any;

    expect(
      translateApiMessagesForUnifiedHistory(messages, TOOL_PROTOCOL.JSON),
    ).toBe(messages);
  });

  it("serializes parsed wrapped tool_call blocks into canonical unified history", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "text",
          content:
            "I can see there's a `zed/` directory with many subdirectories. Let me explore further.",
          partial: false,
        },
        {
          type: "tool_use",
          name: "list",
          params: {},
          nativeArgs: { path: "." },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(text).toBe('@list: "."');
  });

  it("serializes parsed wrapped tool_call blocks into canonical markdown history", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          name: "list",
          params: {},
          nativeArgs: { path: "." },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.MARKDOWN,
    );

    expect(text).toBe(["```ls", "", "```"].join("\n"));
  });

  it("prefers preserved historyInput over normalized nativeArgs during serialization", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          name: "execute",
          params: {},
          nativeArgs: {
            calls: [],
            missingParamName: "commands",
          },
          historyInput: {
            commands: ["list ."],
          },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(text).toContain('[EXECUTE {"commands":["list ."]}]');
    expect(text).not.toContain('"commands":[]');
  });

  it("preserves grouped tool call strings in serialized history", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          name: "tool",
          params: {},
          nativeArgs: {
            calls: [],
            missingParamName: "calls",
          },
          historyInput: {
            calls: ["read:src/package.json:1-40", "grep:src:authservice"],
          },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(text).toContain(
      '[TOOL {"calls":["read:src/package.json:1-40","grep:src:authservice"]}]',
    );
    expect(text).not.toContain('"calls":[]');
  });

  it("summarizes successful writes without executable syntax during serialization", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          id: "call_write_success_1",
          name: "write",
          params: {
            path: "src/app.ts",
            content: "const a = 1\nconst b = 2",
          },
          nativeArgs: {
            path: "src/app.ts",
            content: "const a = 1\nconst b = 2",
            contentCloser: "etxt",
          },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(text).toBe(
      `@write: "src/app.ts|${formatWriteHistoryPlaceholderBody("const a = 1\nconst b = 2")}"`,
    );
  });

  it("summarizes successful edits without losing the original block headers during serialization", () => {
    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          id: "call_edit_success_1",
          name: "edit",
          params: {
            path: "src/app.ts",
            edit: [
              "Search 10-12:",
              "const a = 1",
              "Replace:",
              "const a = 2",
            ].join("\n"),
          },
          nativeArgs: {
            path: "src/app.ts",
            edit: [
              "otxt[10-12]:",
              "const a = 1",
              "ntxt:",
              "const a = 2",
            ].join("\n"),
            contentCloser: "etxt",
          },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
    );

    expect(text).toBe(
      [
        '@edit: "src/app.ts"',
        '"10-12|const a...→const a..."',
      ].join("\n"),
    );
  });

  it("preserves write bodies for failed text-protocol tool results during serialization", () => {
    const failedToolUseIds = collectFailedToolUseIdsFromContentBlocks([
      {
        type: "text",
        text: "[WRITE for 'src/app.ts']\nThe tool execution failed with the following error:\nMissing value for required parameter 'content'. Please retry with complete response.",
        _toolUseId: "call_write_failed_1",
        _toolUseIds: ["call_write_failed_1"],
      },
    ] as any);

    const text = serializeAssistantBlocksForTextProtocol(
      [
        {
          type: "tool_use",
          id: "call_write_failed_1",
          name: "write",
          params: {
            path: "src/app.ts",
            content: "const a = 1\nconst b = 2",
          },
          nativeArgs: {
            path: "src/app.ts",
            content: "const a = 1\nconst b = 2",
          },
          partial: false,
        },
      ] as any,
      TOOL_PROTOCOL.UNIFIED,
      {
        preserveToolInvocationBodyIds: failedToolUseIds,
      },
    );

    expect(text).toBe(
      '@write: "src/app.ts|const a = 1\\nconst b = 2"',
    );
  });

  it("matches failed tool ids when consolidated results use numbered separators", () => {
    const failedToolUseIds = collectFailedToolUseIdsFromContentBlocks([
      {
        type: "text",
        text: [
          "[READ for 'src/app.ts']",
          "ok",
          "",
          "===TOOL RESULT #2===",
          "",
          "[GREP for 'needle' in 'src']",
          "The tool execution failed with the following error:",
          "ripgrep exited with status 2.",
        ].join("\n"),
        _toolUseIds: ["call_read_1", "call_grep_1"],
      },
    ] as any);

    expect(Array.from(failedToolUseIds)).toEqual(["call_grep_1"]);
  });

  it("matches failed tool ids for execute batch parse errors", () => {
    const failedToolUseIds = collectFailedToolUseIdsFromContentBlocks([
      {
        type: "text",
        text: [
          '[EXECUTE {"commands":["list."]}]',
          "[1] execute",
          'Error: Unknown execute command "list.".',
          "Command: list.",
        ].join("\n"),
        _toolUseId: "call_execute_1",
        _toolUseIds: ["call_execute_1"],
      },
    ] as any);

    expect(Array.from(failedToolUseIds)).toEqual(["call_execute_1"]);
  });
});
