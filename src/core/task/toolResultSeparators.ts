export const LEGACY_CONSOLIDATED_TOOL_RESULT_SEPARATOR =
  "\n\n========== TOOL RESULT ==========\n\n";

const CONSOLIDATED_TOOL_RESULT_SPLIT_REGEX =
  /\n(?:\n)?(?:========== TOOL RESULT ==========|===TOOL RESULT #\d+===)\n\n/g;

export function splitConsolidatedToolResults(text: string): string[] {
  if (!text) {
    return [];
  }

  return text
    .split(CONSOLIDATED_TOOL_RESULT_SPLIT_REGEX)
    .filter((segment) => segment.length > 0);
}

export function formatConsolidatedToolResultSeparator(index: number): string {
  return `\n\n===TOOL RESULT #${index}===\n\n`;
}

export function appendConsolidatedToolResult(
  existingText: string,
  nextResult: string,
): string {
  if (!existingText) {
    return nextResult;
  }

  const nextIndex = splitConsolidatedToolResults(existingText).length + 1;
  return `${existingText}${formatConsolidatedToolResultSeparator(nextIndex)}${nextResult}`;
}
