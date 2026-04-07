import type { ClineMessage } from "@roo-code/types";
import { KILOCODE_TOKEN_REQUIRED_ERROR } from "@roo/kilocode/errorUtils";

const TOOL_FOLLOWUP_ERROR_LOOKBACK = 5;

const IGNORABLE_PRECEDING_SAY_TYPES = new Set([
  "reasoning",
  "api_req_started",
  "api_req_finished",
  "api_req_retried",
  "api_req_deleted",
  "mcp_server_request_started",
]);

const IGNORABLE_PRECEDING_ASK_TYPES = new Set([
  "api_req_failed",
  "completion_result",
  "resume_task",
]);

export const isKiloCodeAuthErrorMessage = (
  apiProvider?: string,
  text?: string,
) =>
  apiProvider === "kilocode" &&
  typeof text === "string" &&
  text.includes(KILOCODE_TOKEN_REQUIRED_ERROR);

export const shouldHideToolFollowupErrorMessage = ({
  messages,
  index,
  apiProvider,
}: {
  messages: ClineMessage[];
  index: number;
  apiProvider?: string;
}) => {
  const message = messages[index];
  if (!message || message.type !== "say" || message.say !== "error") {
    return false;
  }

  if (isKiloCodeAuthErrorMessage(apiProvider, message.text)) {
    return false;
  }

  if (index <= 0) {
    return false;
  }

  for (
    let cursor = index - 1;
    cursor >= Math.max(0, index - TOOL_FOLLOWUP_ERROR_LOOKBACK);
    cursor--
  ) {
    const previousMessage = messages[cursor];
    if (!previousMessage || previousMessage.partial) {
      continue;
    }

    if (previousMessage.type === "ask" && previousMessage.ask === "tool") {
      return true;
    }

    if (previousMessage.type === "say" && previousMessage.say === "tool") {
      return true;
    }

    if (previousMessage.type === "say" && previousMessage.say === "error") {
      continue;
    }

    if (
      previousMessage.type === "say" &&
      IGNORABLE_PRECEDING_SAY_TYPES.has(previousMessage.say as string)
    ) {
      continue;
    }

    if (
      previousMessage.type === "ask" &&
      IGNORABLE_PRECEDING_ASK_TYPES.has(previousMessage.ask as string)
    ) {
      continue;
    }

    return false;
  }

  return false;
};
