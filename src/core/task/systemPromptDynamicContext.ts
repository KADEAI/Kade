export function formatDynamicSystemPromptContext(
  systemReminders: string[],
  activeFileReads: Map<string, { start: number; end: number }[] | undefined>,
  latestEnvironmentDetails?: string,
): string {
  const sections: string[] = [];

  if (systemReminders.length > 0) {
    sections.push(
      ["## Recent Edit Reminders", ...systemReminders]
        .map((line) => line.trimEnd())
        .join("\n"),
    );
  }

  if (activeFileReads.size > 0) {
    const readLines = Array.from(activeFileReads.entries()).map(([filePath, ranges]) => {
      if (ranges && ranges.length > 0) {
        const rangeStr = ranges.map((range) => `${range.start}-${range.end}`).join(", ");
        return `- ${filePath} (lines ${rangeStr})`;
      }
      return `- ${filePath}`;
    });

    sections.push(["## Files Currently Read in Context", ...readLines].join("\n"));
  }

  if (latestEnvironmentDetails?.trim()) {
    sections.push(latestEnvironmentDetails.trim());
  }

  return sections.filter(Boolean).join("\n\n");
}

export function appendDynamicSystemPromptContext(prompt: string, dynamicContext: string): string {
  if (!dynamicContext.trim()) {
    return prompt;
  }

  return `${prompt.trimEnd()}\n\n${dynamicContext}`;
}
