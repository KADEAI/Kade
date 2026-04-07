import type { ClineMessage } from "@roo-code/types";

const TRACKED_EDIT_TOOLS = new Set([
  "appliedDiff",
  "editedExistingFile",
  "newFileCreated",
  "insertContent",
  "searchAndReplace",
  "deleteFile",
]);

export const isTrackedEditTool = (toolName: string) =>
  TRACKED_EDIT_TOOLS.has(toolName);

const isToolMessage = (msg: Pick<ClineMessage, "type" | "ask" | "say">) =>
  (msg.type === "ask" && msg.ask === "tool") ||
  (msg.type === "say" && msg.say === "tool");

export type EditHistoryDiffTotals = {
  additions: number;
  deletions: number;
};

const getLineCount = (content: string | undefined) => {
  if (!content) {
    return 0;
  }

  return content.split("\n").length;
};

const getEditBlockDiffStats = (
  edits: unknown,
): EditHistoryDiffTotals | null => {
  if (!Array.isArray(edits) || edits.length === 0) {
    return null;
  }

  let additions = 0;
  let deletions = 0;

  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      continue;
    }

    const oldText =
      (edit as any).oldText ||
      (edit as any).old_string ||
      (edit as any).old_text ||
      "";
    const newText =
      (edit as any).newText ||
      (edit as any).new_string ||
      (edit as any).new_text ||
      "";

    additions += getLineCount(newText);
    deletions += getLineCount(oldText);
  }

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return { additions, deletions };
};

export const getEditToolDiffStats = (
  toolName: string,
  toolData: Record<string, any>,
): EditHistoryDiffTotals => {
  const diffStats = toolData.diffStats;
  let additions = diffStats?.added || 0;
  let deletions = diffStats?.removed || 0;

  if (additions === 0 && deletions === 0 && toolData.diff) {
    const lines = String(toolData.diff).split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
  }

  if (additions === 0 && deletions === 0) {
    const editBlockStats = getEditBlockDiffStats(toolData.edits);
    if (editBlockStats) {
      additions = editBlockStats.additions;
      deletions = editBlockStats.deletions;
    }
  }

  if (toolName === "newFileCreated" && additions === 0 && toolData.content) {
    additions = String(toolData.content).split("\n").length;
  }

  if (toolName === "deleteFile" && !toolData.stats && deletions === 0) {
    deletions = 1;
  }

  return { additions, deletions };
};

export const deriveEditHistoryDiffTotals = (
  clineMessages: Array<
    Pick<ClineMessage, "partial" | "type" | "ask" | "say" | "text">
  > = [],
): EditHistoryDiffTotals => {
  let additions = 0;
  let deletions = 0;
  const processedToolIds = new Set<string>();

  for (const msg of clineMessages) {
    if (msg.partial || !isToolMessage(msg) || !msg.text) {
      continue;
    }

    try {
      const toolData = JSON.parse(msg.text);
      const toolName = toolData.tool;
      const toolId =
        typeof toolData.id === "string" && toolData.id.length > 0
          ? toolData.id
          : undefined;

      if (!isTrackedEditTool(toolName)) {
        continue;
      }

      if (toolId && processedToolIds.has(toolId)) {
        continue;
      }

      if (toolId) {
        processedToolIds.add(toolId);
      }

      const stats = getEditToolDiffStats(toolName, toolData);
      additions += stats.additions;
      deletions += stats.deletions;
    } catch {
      // Ignore malformed tool payloads.
    }
  }

  return { additions, deletions };
};
