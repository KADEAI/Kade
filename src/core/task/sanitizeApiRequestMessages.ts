import { Anthropic } from "@anthropic-ai/sdk";

const INTERNAL_REQUEST_KEYS = new Set(["_toolUseId", "_toolUseIds"]);

type ApiRequestMessage =
  | Anthropic.Messages.MessageParam
  | Record<string, unknown>;

function sanitizeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const sanitizedObject = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !INTERNAL_REQUEST_KEYS.has(key))
      .reduce<Record<string, unknown>>((result, [key, nestedValue]) => {
        result[key] = sanitizeValue(nestedValue);
        return result;
      }, {});

    return sanitizedObject as T;
  }

  return value;
}

export function sanitizeApiRequestMessages<T extends ApiRequestMessage[]>(
  messages: T,
): T {
  return sanitizeValue(messages);
}
