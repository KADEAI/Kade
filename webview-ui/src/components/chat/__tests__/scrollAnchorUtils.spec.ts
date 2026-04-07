import {
  getToolAnimateHeightDetail,
  shouldAdjustScrollForToolAnimation,
} from "../scrollAnchorUtils";

describe("scrollAnchorUtils", () => {
  it("returns undefined when no source element is provided", () => {
    expect(getToolAnimateHeightDetail()).toBeUndefined();
  });

  it("captures top and bottom from the source element", () => {
    const source = document.createElement("div");
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 24,
      top: 24,
      right: 0,
      bottom: 96,
      left: 0,
      width: 0,
      height: 72,
      toJSON: () => ({}),
    });

    expect(getToolAnimateHeightDetail(source)).toEqual({
      top: 24,
      bottom: 96,
      source,
    });
  });

  it("compensates scroll for animations that start inside the viewport", () => {
    expect(
      shouldAdjustScrollForToolAnimation({ top: 40, bottom: 120 }, 100, 600),
    ).toBe(true);
    expect(
      shouldAdjustScrollForToolAnimation({ top: 520, bottom: 620 }, 100, 600),
    ).toBe(true);
    expect(
      shouldAdjustScrollForToolAnimation({ top: 620, bottom: 720 }, 100, 600),
    ).toBe(false);
    expect(shouldAdjustScrollForToolAnimation(undefined, 100, 600)).toBe(false);
  });
});
