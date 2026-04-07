import { describe, expect, it } from "vitest";

import {
  stripChatToolFenceBlocks,
  stripSharedProtocolMarkdown,
} from "../markdownCleanup";

describe("markdownCleanup", () => {
  it("does not strip fenced typescript blocks when removing chat tool fences", () => {
    const markdown = [
      "Before",
      "```typescript",
      "const tracksFullFileRead = true;",
      "```",
      "",
      "```type",
      "{\"text\":\"hi\"}",
      "```",
      "After",
    ].join("\n");

    const cleaned = stripChatToolFenceBlocks(markdown);

    expect(cleaned).toContain("```typescript");
    expect(cleaned).toContain("const tracksFullFileRead = true;");
    expect(cleaned).not.toContain('{"text":"hi"}');
    expect(cleaned).toContain("Before");
    expect(cleaned).toContain("After");
  });

  it("still strips exact generic protocol fences", () => {
    const markdown = [
      "Visible intro",
      "```cmd",
      "echo hi",
      "```",
      "Visible outro",
    ].join("\n");

    const cleaned = stripSharedProtocolMarkdown(markdown);

    expect(cleaned).toContain("Visible intro");
    expect(cleaned).toContain("Visible outro");
    expect(cleaned).not.toContain("```cmd");
    expect(cleaned).not.toContain("echo hi");
  });
});
