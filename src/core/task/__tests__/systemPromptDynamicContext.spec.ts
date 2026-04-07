import { describe, expect, it } from "vitest";

import {
  appendDynamicSystemPromptContext,
  formatDynamicSystemPromptContext,
} from "../systemPromptDynamicContext";

describe("systemPromptDynamicContext", () => {
  it("formats reminders, active file reads, and environment details as separate sections", () => {
    const dynamicContext = formatDynamicSystemPromptContext(
      ["- touched src/app.ts", "- changed config"],
      new Map([
        ["src/app.ts", [{ start: 10, end: 20 }]],
        ["src/utils.ts", undefined],
      ]),
      "## Environment Context\ncwd: /repo",
    );

    expect(dynamicContext).toBe(
      [
        "## Recent Edit Reminders",
        "- touched src/app.ts",
        "- changed config",
        "",
        "## Files Currently Read in Context",
        "- src/app.ts (lines 10-20)",
        "- src/utils.ts",
        "",
        "## Environment Context",
        "cwd: /repo",
      ].join("\n"),
    );
  });

  it("appends dynamic context with clear separation from the base prompt", () => {
    const result = appendDynamicSystemPromptContext(
      "Base prompt instructions.",
      "## Recent Edit Reminders\n- touched src/app.ts",
    );

    expect(result).toBe(
      "Base prompt instructions.\n\n## Recent Edit Reminders\n- touched src/app.ts",
    );
  });

  it("returns the base prompt unchanged when there is no dynamic context", () => {
    expect(appendDynamicSystemPromptContext("Base prompt", "")).toBe("Base prompt");
  });
});
