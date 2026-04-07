import type { ClineMessage } from "@roo-code/types";
import type { ClineSayTool } from "@roo/ExtensionMessage";
import { safeJsonParse } from "@roo/safeJsonParse";
import { normalizeToolActivityName } from "./toolActivityLabels";

export const RENDERABLE_TOOL_TYPES = new Set([
  "editedExistingFile",
  "appliedDiff",
  "insertContent",
  "searchAndReplace",
  "updateTodoList",
  "newFileCreated",
  "web",
  "fetch",
  "research_web",
  "deleteFile",
  "readFile",
  "fetchInstructions",
  "listDirTopLevel",
  "listDirRecursive",
  "grep",
  "glob",
  "fastContext",
  "switchMode",
  "newTask",
  "finishTask",
  "agent",
  "runSlashCommand",
  "generateImage",
  "mkdir",
  "wrap",
  "moveFile",
]);

const TOOL_ACTIVITY_PILL_TOOL_TYPES = new Set([
  "readFile",
  "fetchInstructions",
  "listDirTopLevel",
  "listDirRecursive",
  "grep",
  "glob",
  "fastContext",
]);

const looksLikeJsonObject = (text?: string) => {
  const trimmed = text?.trim();
  return !!trimmed && trimmed.startsWith("{");
};

const isRenderableToolPayload = (text?: string) => {
  if (!looksLikeJsonObject(text)) {
    return false;
  }

  const tool = safeJsonParse<ClineSayTool>(text);
  const normalizedToolName = normalizeToolActivityName(
    (tool?.tool as string) || "",
  );
  return (
    !!tool &&
    RENDERABLE_TOOL_TYPES.has(normalizedToolName || (tool.tool as string) || "")
  );
};

const getRenderableToolType = (
  message: Pick<ClineMessage, "type" | "ask" | "say" | "text">,
) => {
  if (
    !(
      (message.type === "ask" && message.ask === "tool") ||
      (message.type === "say" && message.say === "tool")
    )
  ) {
    return null;
  }

  if (!looksLikeJsonObject(message.text)) {
    return null;
  }

  const text = message.text;
  const tool = safeJsonParse<ClineSayTool>(text);
  if (!tool) {
    return null;
  }

  const rawToolName = (tool.tool as string) || "";
  const normalizedToolName =
    normalizeToolActivityName(rawToolName) || rawToolName;

  if (!RENDERABLE_TOOL_TYPES.has(normalizedToolName)) {
    return null;
  }

  return normalizedToolName;
};

export function isRenderableToolMessage(
  message: Pick<ClineMessage, "type" | "ask" | "say" | "text">,
) {
  if (!message.text) {
    return false;
  }

  if (message.type === "ask" && message.ask === "tool") {
    return isRenderableToolPayload(message.text);
  }

  if (message.type === "say" && message.say === "tool") {
    return isRenderableToolPayload(message.text);
  }

  return false;
}

export function shouldSuppressApiRequestRowForToolTurn(
  messages: ClineMessage[],
  apiRequestTs: number,
) {
  const apiRequestIndex = messages.findIndex(
    (message) =>
      message.say === "api_req_started" && message.ts === apiRequestTs,
  );

  if (apiRequestIndex === -1) {
    return false;
  }

  for (let index = apiRequestIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    if (message.say === "api_req_started") {
      break;
    }

    const renderableToolType = getRenderableToolType(message);
    if (renderableToolType) {
      if (TOOL_ACTIVITY_PILL_TOOL_TYPES.has(renderableToolType)) {
        continue;
      }

      return true;
    }

    if (message.type === "say") {
      if (
        message.say === "reasoning" ||
        message.say === "mcp_server_request_started" ||
        message.say === "api_req_retry_delayed" ||
        message.say === "api_req_finished" ||
        message.say === "api_req_retried" ||
        message.say === "api_req_deleted"
      ) {
        continue;
      }

      if (
        message.say === "text" &&
        (message.partial || !(message.text || "").trim())
      ) {
        continue;
      }

      break;
    }

    if (message.type === "ask" && message.ask !== "tool") {
      break;
    }
  }

  return false;
}
