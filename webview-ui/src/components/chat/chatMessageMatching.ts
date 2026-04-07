import type { ClineMessage } from "@roo-code/types";

type UserRenderableMessage = Pick<ClineMessage, "say" | "text" | "images">;

function hashRenderableMessageSignature(signature: string): string {
  let hash = 2166136261;

  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function getUserRenderableMessageSignature(
  message: UserRenderableMessage,
): string | null {
  if (message.say !== "task" && message.say !== "user_feedback") {
    return null;
  }

  if (!message.text && !message.images?.length) {
    return null;
  }

  return JSON.stringify({
    say: message.say,
    text: message.text ?? "",
    images: message.images ?? [],
  });
}

export function getUserRenderableRowId(
  message: UserRenderableMessage,
  occurrence: number,
): string | null {
  const signature = getUserRenderableMessageSignature(message);
  if (!signature) {
    return null;
  }

  return `message:user:${hashRenderableMessageSignature(signature)}:${occurrence}`;
}

export function filterResolvedOptimisticUserMessages<
  T extends UserRenderableMessage,
>(optimisticMessages: T[], actualMessages: ClineMessage[]): T[] {
  if (optimisticMessages.length === 0) {
    return optimisticMessages;
  }

  const actualCounts = new Map<string, number>();

  for (const message of actualMessages) {
    const signature = getUserRenderableMessageSignature(message);
    if (!signature) {
      continue;
    }

    actualCounts.set(signature, (actualCounts.get(signature) ?? 0) + 1);
  }

  return optimisticMessages.filter((message) => {
    const signature = getUserRenderableMessageSignature(message);
    if (!signature) {
      return true;
    }

    const count = actualCounts.get(signature) ?? 0;
    if (count === 0) {
      return true;
    }

    actualCounts.set(signature, count - 1);
    return false;
  });
}
