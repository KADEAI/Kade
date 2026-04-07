import { describe, expect, it } from "vitest";

import { sanitizeApiRequestMessages } from "../sanitizeApiRequestMessages";

describe("sanitizeApiRequestMessages", () => {
  it("strips internal unified tool tracking ids from text blocks", () => {
    const sanitized = sanitizeApiRequestMessages([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "[READ for 'src/app.ts']\ncontent",
            _toolUseId: "unified_123_read_0",
            _toolUseIds: ["unified_123_read_0", "unified_123_read_1"],
          },
        ],
      },
    ] as any);

    expect((sanitized[0] as any).content[0]).toEqual({
      type: "text",
      text: "[READ for 'src/app.ts']\ncontent",
    });
  });

  it("preserves legitimate provider-facing ids and tool fields", () => {
    const sanitized = sanitizeApiRequestMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_abc123",
            name: "read",
            input: { path: "src/app.ts" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_abc123",
            content: "done",
          },
        ],
      },
    ] as any);

    expect((sanitized[0] as any).content[0]).toEqual({
      type: "tool_use",
      id: "call_abc123",
      name: "read",
      input: { path: "src/app.ts" },
    });
    expect((sanitized[1] as any).content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "call_abc123",
      content: "done",
    });
  });

  it("does not mutate the original messages", () => {
    const original = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "payload",
            _toolUseId: "unified_1_tool_0",
          },
        ],
      },
    ] as any;

    const sanitized = sanitizeApiRequestMessages(original);

    expect((original[0] as any).content[0]._toolUseId).toBe(
      "unified_1_tool_0",
    );
    expect((sanitized[0] as any).content[0]._toolUseId).toBeUndefined();
  });
});
