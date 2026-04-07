import type { RemoveQueuedMessagePayload } from "../../shared/WebviewMessage";

type RemoveQueuedMessageLike = {
  payload?: RemoveQueuedMessagePayload | { id?: string };
  text?: string;
};

export function resolveQueuedMessageRemovalId(
  message: RemoveQueuedMessageLike,
): string | undefined {
  const fallbackText = message.text?.trim();
  if (message.payload?.id) {
    return message.payload.id;
  }

  return fallbackText ? fallbackText : undefined;
}
