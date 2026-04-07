import { describe, expect, it } from "vitest";

import {
  TOOL_CONTENT_WINDOW_THRESHOLD,
  getVirtualizedLineWindow,
} from "../virtualizedToolContent";

describe("getVirtualizedLineWindow", () => {
  it("does not virtualize smaller payloads", () => {
    expect(
      getVirtualizedLineWindow({
        lineCount: TOOL_CONTENT_WINDOW_THRESHOLD,
        scrollTop: 0,
      }),
    ).toEqual({
      enabled: false,
      start: 0,
      end: TOOL_CONTENT_WINDOW_THRESHOLD,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("returns a fixed-size window once the payload crosses the threshold", () => {
    expect(
      getVirtualizedLineWindow({
        lineCount: TOOL_CONTENT_WINDOW_THRESHOLD + 1,
        scrollTop: 0,
      }),
    ).toEqual({
      enabled: true,
      start: 0,
      end: 60,
      topSpacerHeight: 0,
      bottomSpacerHeight: (TOOL_CONTENT_WINDOW_THRESHOLD + 1 - 60) * 19,
    });
  });

  it("slides the rendered window as the user scrolls", () => {
    expect(
      getVirtualizedLineWindow({
        lineCount: 400,
        scrollTop: 19 * 120,
      }),
    ).toEqual({
      enabled: true,
      start: 114,
      end: 174,
      topSpacerHeight: 114 * 19,
      bottomSpacerHeight: (400 - 174) * 19,
    });
  });

  it("clamps the window near the end of the payload", () => {
    expect(
      getVirtualizedLineWindow({
        lineCount: 250,
        scrollTop: 19 * 999,
      }),
    ).toEqual({
      enabled: true,
      start: 190,
      end: 250,
      topSpacerHeight: 190 * 19,
      bottomSpacerHeight: 0,
    });
  });
});
