import { describe, expect, it } from "vitest";

import { deriveEditHistoryState } from "../EditHistoryTracker";

const toolMessage = (payload: Record<string, unknown>) => ({
  partial: false,
  type: "say",
  say: "tool",
  text: JSON.stringify(payload),
});

describe("EditHistoryTracker", () => {
  it("aggregates active edits and separates undone edits", () => {
    const state = deriveEditHistoryState(
      [
        toolMessage({
          id: "tool-1",
          tool: "editedExistingFile",
          path: "/workspace/src/alpha.ts",
          diffStats: { added: 3, removed: 1 },
        }),
        toolMessage({
          id: "tool-2",
          tool: "appliedDiff",
          path: "/workspace/src/alpha.ts",
          diffStats: { added: 2, removed: 0 },
        }),
        toolMessage({
          id: "tool-3",
          tool: "newFileCreated",
          path: "/workspace/src/beta.ts",
          content: "one\ntwo",
        }),
        toolMessage({
          id: "tool-4",
          tool: "deleteFile",
          path: "/workspace/src/gamma.ts",
        }),
      ],
      new Set(["tool-2"]),
      new Set(["tool-4"]),
    );

    expect(state.fileChanges).toEqual([
      {
        path: "/workspace/src/alpha.ts",
        additions: 3,
        deletions: 1,
        toolIds: ["tool-1"],
        type: "edit",
      },
      {
        path: "/workspace/src/beta.ts",
        additions: 2,
        deletions: 0,
        toolIds: ["tool-3"],
        type: "create",
      },
    ]);

    expect(state.undoneChanges).toEqual([
      {
        path: "/workspace/src/gamma.ts",
        toolIds: ["tool-4"],
      },
    ]);

    expect(state.totalAdditions).toBe(5);
    expect(state.totalDeletions).toBe(1);
  });

  it("derives fallback stats from diff content when explicit stats are missing", () => {
    const state = deriveEditHistoryState(
      [
        toolMessage({
          id: "tool-1",
          tool: "searchAndReplace",
          path: "/workspace/src/delta.ts",
          diff: [
            "--- a/delta.ts",
            "+++ b/delta.ts",
            "@@",
            "-before",
            "+after",
            "+later",
          ].join("\n"),
        }),
      ],
      new Set(),
      new Set(),
    );

    expect(state.fileChanges).toEqual([
      {
        path: "/workspace/src/delta.ts",
        additions: 2,
        deletions: 1,
        toolIds: ["tool-1"],
        type: "edit",
      },
    ]);
    expect(state.totalAdditions).toBe(2);
    expect(state.totalDeletions).toBe(1);
  });

  it("deduplicates repeated tool messages with the same tool id", () => {
    const duplicatedPayload = {
      id: "tool-1",
      tool: "editedExistingFile",
      path: "/workspace/src/alpha.ts",
      diffStats: { added: 6, removed: 2 },
    };

    const state = deriveEditHistoryState(
      [toolMessage(duplicatedPayload), toolMessage(duplicatedPayload)],
      new Set(),
      new Set(),
    );

    expect(state.fileChanges).toEqual([
      {
        path: "/workspace/src/alpha.ts",
        additions: 6,
        deletions: 2,
        toolIds: ["tool-1"],
        type: "edit",
      },
    ]);
    expect(state.totalAdditions).toBe(6);
    expect(state.totalDeletions).toBe(2);
  });

  it("falls back to edit blocks when diff stats are missing", () => {
    const state = deriveEditHistoryState(
      [
        toolMessage({
          id: "tool-1",
          tool: "appliedDiff",
          path: "/workspace/src/alpha.ts",
          edits: [
            { oldText: "one\ntwo", newText: "one\ntwo\nthree" },
            { oldText: "before", newText: "after" },
          ],
        }),
      ],
      new Set(),
      new Set(),
    );

    expect(state.fileChanges).toEqual([
      {
        path: "/workspace/src/alpha.ts",
        additions: 4,
        deletions: 3,
        toolIds: ["tool-1"],
        type: "edit",
      },
    ]);
    expect(state.totalAdditions).toBe(4);
    expect(state.totalDeletions).toBe(3);
  });
});
