import { describe, expect, it } from "vitest";

import {
  appendConsolidatedToolResult,
  formatConsolidatedToolResultSeparator,
  splitConsolidatedToolResults,
} from "../toolResultSeparators";

describe("toolResultSeparators", () => {
  it("appends numbered minimal separators for additional tool results", () => {
    const first = "[READ for 'src/app.ts']\ncontent";
    const second = "[GREP for 'needle' in 'src']\nmatches";

    const combined = appendConsolidatedToolResult(first, second);

    expect(combined).toContain("===TOOL RESULT #2===");
    expect(splitConsolidatedToolResults(combined)).toEqual([first, second]);
  });

  it("increments numbered separators beyond the second result", () => {
    const first = "[WRITE for 'file1.txt']\none";
    const second = "[WRITE for 'file2.txt']\ntwo";
    const third = "[WRITE for 'file3.txt']\nthree";

    const combined = appendConsolidatedToolResult(
      appendConsolidatedToolResult(first, second),
      third,
    );

    expect(combined).toContain("===TOOL RESULT #2===");
    expect(combined).toContain("===TOOL RESULT #3===");
    expect(splitConsolidatedToolResults(combined)).toEqual([
      first,
      second,
      third,
    ]);
  });

  it("parses both legacy and numbered separator formats", () => {
    const legacy =
      "[READ for 'a']\none\n\n========== TOOL RESULT ==========\n\n[GREP for 'b']\ntwo";
    const numbered =
      `[READ for 'a']\none${formatConsolidatedToolResultSeparator(2)}[GREP for 'b']\ntwo`;
    const historicalSingleNewlineNumbered =
      "[READ for 'a']\none\n===TOOL RESULT #2===\n\n[GREP for 'b']\ntwo";

    expect(splitConsolidatedToolResults(legacy)).toEqual([
      "[READ for 'a']\none",
      "[GREP for 'b']\ntwo",
    ]);
    expect(splitConsolidatedToolResults(numbered)).toEqual([
      "[READ for 'a']\none",
      "[GREP for 'b']\ntwo",
    ]);
    expect(splitConsolidatedToolResults(historicalSingleNewlineNumbered)).toEqual(
      ["[READ for 'a']\none", "[GREP for 'b']\ntwo"],
    );
  });
});
