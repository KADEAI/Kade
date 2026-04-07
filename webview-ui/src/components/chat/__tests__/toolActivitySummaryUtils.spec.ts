import { describe, expect, it } from "vitest";

import {
  buildToolActivitySummaryText,
  getToolActivitySummaryRunning,
} from "../toolActivitySummaryUtils";

describe("toolActivitySummaryUtils", () => {
  it("uses reading language for grouped file reads", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "readFile", path: "/workspace/src/alpha.ts" } as any,
          { tool: "readFile", path: "/workspace/src/beta.ts" } as any,
        ],
        true,
      ),
    ).toBe("Reading alpha.ts and beta.ts");
  });

  it("supports canonical read and list tool names in grouped summaries", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "read", path: "/workspace/src/alpha.ts" } as any,
          { tool: "read", path: "/workspace/src/beta.ts" } as any,
        ],
        true,
      ),
    ).toBe("Reading alpha.ts and beta.ts");

    expect(
      buildToolActivitySummaryText(
        [{ tool: "list", path: "/workspace/src" } as any],
        true,
      ),
    ).toBe("Exploring 1 directory");
  });

  it("keeps the file name when grouped reads collapse to one unique file", () => {
    expect(
      buildToolActivitySummaryText(
        [{ tool: "readFile", path: "/workspace/src/ChatView.tsx" } as any],
        false,
      ),
    ).toBe("Read ChatView.tsx");
  });

  it("uses named targets for grouped searches when they are available", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "glob", pattern: "**/*.ts" } as any,
          { tool: "grep", pattern: "command::new" } as any,
        ],
        false,
      ),
    ).toBe("Searched ts and command::new");
  });

  it("uses named actions for mixed directory and search activity", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "list", path: "/workspace/zed/crates" } as any,
          { tool: "glob", pattern: "**/*agent*" } as any,
        ],
        false,
      ),
    ).toBe("Explored crates and searched agent");
  });

  it("falls back to the searched path when the search target is missing", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "list", path: "/workspace/untitled folder" } as any,
          { tool: "glob", path: "/workspace/untitled folder 100" } as any,
        ],
        false,
      ),
    ).toBe("Explored untitled folder and searched untitled folder 100");
  });

  it("compounds adjacent mixed actions that share the same verb", () => {
    expect(
      buildToolActivitySummaryText(
        [
          { tool: "list", path: "/workspace/src" } as any,
          { tool: "list", path: "/workspace/webview-ui" } as any,
          { tool: "glob", pattern: "**/README.md" } as any,
        ],
        false,
      ),
    ).toBe("Explored src and webview-ui, and searched README.md");
  });

  it("keeps grouped summaries running while streaming at the end of the segment", () => {
    expect(
      getToolActivitySummaryRunning({
        hasFollowingBoundary: false,
        isStreaming: true,
        segmentMessages: [{ partial: false }, { partial: false }],
      }),
    ).toBe(true);
  });

  it("stops grouped summaries once the segment has ended", () => {
    expect(
      getToolActivitySummaryRunning({
        hasFollowingBoundary: true,
        isStreaming: false,
        segmentMessages: [{ partial: false }, { partial: false }],
      }),
    ).toBe(false);
  });
});
