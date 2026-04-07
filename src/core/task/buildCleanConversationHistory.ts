import { Anthropic } from "@anthropic-ai/sdk";

import type { ApiMessage } from "../task-persistence";

type ReasoningItemForRequest = {
  type: "reasoning";
  encrypted_content: string;
  id?: string;
  summary?: Record<string, unknown>[];
};

export function buildCleanConversationHistory(
  messages: ApiMessage[],
  preserveReasoning: boolean,
): Array<Anthropic.Messages.MessageParam | ReasoningItemForRequest> {
  const cleanConversationHistory: (
    | Anthropic.Messages.MessageParam
    | ReasoningItemForRequest
  )[] = [];

  for (const msg of messages) {
    if (msg.type === "reasoning") {
      if (msg.encrypted_content) {
        cleanConversationHistory.push({
          type: "reasoning",
          summary: msg.summary,
          encrypted_content: msg.encrypted_content,
          ...(msg.id ? { id: msg.id } : {}),
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const rawContent = msg.content;

      const contentArray: Anthropic.Messages.ContentBlockParam[] =
        Array.isArray(rawContent)
          ? (rawContent as Anthropic.Messages.ContentBlockParam[])
          : rawContent !== undefined
            ? ([
                {
                  type: "text",
                  text: rawContent,
                } satisfies Anthropic.Messages.TextBlockParam,
              ] as Anthropic.Messages.ContentBlockParam[])
            : [];

      const [first, ...rest] = contentArray;

      const hasEncryptedReasoning =
        first &&
        (first as any).type === "reasoning" &&
        "encrypted_content" in first;
      const hasPlainTextReasoning =
        first &&
        (first as any).type === "reasoning" &&
        "text" in first &&
        typeof (first as any).text === "string";

      if (hasEncryptedReasoning) {
        const reasoningBlock = first as unknown as {
          type: "reasoning";
          encrypted_content: string;
          id?: string;
        };

        cleanConversationHistory.push({
          role: "assistant",
          content: [
            {
              type: "reasoning",
              encrypted_content: reasoningBlock.encrypted_content,
              ...(reasoningBlock.id ? { id: reasoningBlock.id } : {}),
            } satisfies ReasoningItemForRequest,
            ...rest,
          ],
        } as any);
        continue;
      }

      if (hasPlainTextReasoning) {
        let assistantContent: Anthropic.Messages.MessageParam["content"];

        if (preserveReasoning) {
          assistantContent = contentArray;
        } else if (rest.length === 0) {
          assistantContent = "";
        } else if (rest.length === 1 && rest[0].type === "text") {
          assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam).text;
        } else {
          assistantContent = rest;
        }

        cleanConversationHistory.push({
          role: "assistant",
          content: assistantContent,
        } satisfies Anthropic.Messages.MessageParam);
        continue;
      }
    }

    if (msg.role) {
      cleanConversationHistory.push({
        role: msg.role,
        content: msg.content as
          | Anthropic.Messages.ContentBlockParam[]
          | string,
      });
    }
  }

  return cleanConversationHistory;
}
