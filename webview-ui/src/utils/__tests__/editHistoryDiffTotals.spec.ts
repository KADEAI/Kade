import { describe, expect, it } from "vitest";

import { deriveEditHistoryDiffTotals } from "@roo/kilocode/editHistoryDiffTotals";

const toolMessage = (payload: Record<string, unknown>) => ({
  partial: false,
  type: "say" as const,
  say: "tool" as const,
  text: JSON.stringify(payload),
});

describe("deriveEditHistoryDiffTotals", () => {
  it("aggregates additions and deletions across tracked edit tools", () => {
    const totals = deriveEditHistoryDiffTotals([
      toolMessage({
        tool: "editedExistingFile",
        path: "/workspace/src/alpha.ts",
        diffStats: { added: 3, removed: 1 },
      }),
      toolMessage({
        tool: "newFileCreated",
        path: "/workspace/src/beta.ts",
        content: "one\ntwo\nthree",
      }),
      toolMessage({
        tool: "deleteFile",
        path: "/workspace/src/gamma.ts",
      }),
    ]);

    expect(totals).toEqual({
      additions: 6,
      deletions: 2,
    });
  });

  it("ignores malformed or untracked tool messages", () => {
    const totals = deriveEditHistoryDiffTotals([
      toolMessage({
        tool: "executeCommand",
        path: "/workspace/src/alpha.ts",
        diffStats: { added: 100, removed: 100 },
      }),
      {
        partial: false,
        type: "say" as const,
        say: "tool" as const,
        text: "{not-json",
      },
    ]);

    expect(totals).toEqual({
      additions: 0,
      deletions: 0,
    });
  });

  it("deduplicates repeated tool messages with the same tool id", () => {
    const duplicatedPayload = {
      id: "tool-1",
      tool: "editedExistingFile",
      path: "/workspace/src/alpha.ts",
      diffStats: { added: 8, removed: 3 },
    };

    const totals = deriveEditHistoryDiffTotals([
      toolMessage(duplicatedPayload),
      toolMessage(duplicatedPayload),
    ]);

    expect(totals).toEqual({
      additions: 8,
      deletions: 3,
    });
  });

  it("falls back to edit blocks when diff stats are missing", () => {
    const totals = deriveEditHistoryDiffTotals([
      toolMessage({
        id: "tool-1",
        tool: "appliedDiff",
        path: "/workspace/src/alpha.ts",
        edits: [
          { oldText: "one\ntwo", newText: "one\ntwo\nthree" },
          { oldText: "before", newText: "after" },
        ],
      }),
    ]);

    expect(totals).toEqual({
      additions: 4,
      deletions: 3,
    });
  });
});
