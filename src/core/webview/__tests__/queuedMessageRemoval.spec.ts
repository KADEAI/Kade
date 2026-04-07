import { describe, expect, it } from "vitest";

import { resolveQueuedMessageRemovalId } from "../queuedMessageRemoval";

describe("resolveQueuedMessageRemovalId", () => {
  it("prefers payload id over text when both are present", () => {
    expect(
      resolveQueuedMessageRemovalId({
        payload: { id: "queued-2" } as any,
        text: "queued-1",
      }),
    ).toBe("queued-2");
  });

  it("falls back to trimmed text when payload id is missing", () => {
    expect(
      resolveQueuedMessageRemovalId({
        text: "  queued-legacy  ",
      }),
    ).toBe("queued-legacy");
  });

  it("returns undefined when neither id nor text is usable", () => {
    expect(resolveQueuedMessageRemovalId({ text: "   " })).toBeUndefined();
  });
});
