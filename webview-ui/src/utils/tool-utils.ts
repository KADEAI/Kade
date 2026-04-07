import { ClineMessage } from "@roo-code/types";
import { ClineSayTool } from "@roo/ExtensionMessage";
import {
  getEditToolDiffStats,
  isTrackedEditTool,
} from "@roo/kilocode/editHistoryDiffTotals";

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  toolIds: string[];
  type: "create" | "edit" | "delete";
}

export const getFileChangesInRange = (
  messages: any[],
  startTs: number,
): FileChange[] => {
  const changes = new Map<string, FileChange>();
  const processedToolIds = new Set<string>();
  const index = messages.findIndex((m) => m.ts === startTs);
  if (index === -1) return [];

  for (let i = index; i < messages.length; i++) {
    const msg = messages[i];
    const isTool =
      (msg.type === "ask" && msg.ask === "tool") ||
      (msg.type === "say" && (msg as any).say === "tool");
    if (isTool) {
      try {
        const toolData = JSON.parse(msg.text || "{}");
        const toolName = toolData.tool;
        const filePath = toolData.path || toolData.file_path;

        if (isTrackedEditTool(toolName)) {
          if (!filePath) continue;

          const toolId =
            typeof toolData.id === "string" && toolData.id.length > 0
              ? toolData.id
              : undefined;

          if (toolId && processedToolIds.has(toolId)) {
            continue;
          }

          if (toolId) {
            processedToolIds.add(toolId);
          }

          const { additions, deletions } = getEditToolDiffStats(
            toolName,
            toolData,
          );

          const existing = changes.get(filePath);
          if (existing) {
            changes.set(filePath, {
              path: filePath,
              additions: existing.additions + additions,
              deletions: existing.deletions + deletions,
              toolIds: toolId
                ? [...existing.toolIds, toolId]
                : existing.toolIds,
              type: toolName === "deleteFile" ? "delete" : existing.type,
            });
          } else {
            changes.set(filePath, {
              path: filePath,
              additions,
              deletions,
              toolIds: toolId ? [toolId] : [],
              type:
                toolName === "deleteFile"
                  ? "delete"
                  : toolName === "newFileCreated"
                    ? "create"
                    : "edit",
            });
          }
        }
      } catch (e) {}
    }
  }

  return Array.from(changes.values());
};
