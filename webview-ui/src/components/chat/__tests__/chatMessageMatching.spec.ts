import { describe, expect, it } from "vitest";

import {
  filterResolvedOptimisticUserMessages,
  getUserRenderableMessageSignature,
  getUserRenderableRowId,
} from "../chatMessageMatching";

describe("chatMessageMatching", () => {
  it("filters optimistic user rows once the matching real message exists", () => {
    const optimistic = [
      {
        type: "say" as const,
        say: "user_feedback" as const,
        text: "Ship it",
        images: ["data:image/png;base64,abc"],
      },
    ];

    const actual = [
      {
        type: "say" as const,
        say: "user_feedback" as const,
        ts: 42,
        text: "Ship it",
        images: ["data:image/png;base64,abc"],
      },
    ];

    expect(filterResolvedOptimisticUserMessages(optimistic, actual)).toEqual(
      [],
    );
  });

  it("keeps unmatched optimistic duplicates visible until each real row arrives", () => {
    const optimistic = [
      {
        type: "say" as const,
        say: "user_feedback" as const,
        text: "Same text",
        images: [],
      },
      {
        type: "say" as const,
        say: "user_feedback" as const,
        text: "Same text",
        images: [],
      },
    ];

    const actual = [
      {
        type: "say" as const,
        say: "user_feedback" as const,
        ts: 100,
        text: "Same text",
        images: [],
      },
    ];

    expect(filterResolvedOptimisticUserMessages(optimistic, actual)).toEqual([
      optimistic[1],
    ]);
  });

  it("only signs renderable user messages", () => {
    expect(
      getUserRenderableMessageSignature({
        say: "text",
        text: "Assistant output",
      } as any),
    ).toBeNull();

    expect(
      getUserRenderableMessageSignature({
        say: "task",
        text: "Start here",
        images: [],
      } as any),
    ).toBe(JSON.stringify({ say: "task", text: "Start here", images: [] }));
  });

  it("builds stable user row ids from content and occurrence", () => {
    const optimisticMessage = {
      say: "user_feedback" as const,
      text: "Ship it",
      images: ["data:image/png;base64,abc"],
    };

    expect(getUserRenderableRowId(optimisticMessage as any, 0)).toBe(
      getUserRenderableRowId(
        {
          ...optimisticMessage,
          ts: 42,
        } as any,
        0,
      ),
    );
    expect(getUserRenderableRowId(optimisticMessage as any, 0)).not.toBe(
      getUserRenderableRowId(optimisticMessage as any, 1),
    );
  });
});
