import type { ClineSayTool } from "@roo/ExtensionMessage";
import { safeJsonParse } from "@roo/safeJsonParse";

const MAX_TOOL_PARSE_CACHE_SIZE = 1500;
const toolParseCache = new Map<string, ClineSayTool | null>();

export function parseCachedTool(text?: string | null): ClineSayTool | null {
  if (!text) {
    return null;
  }

  const cached = toolParseCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  const parsed = safeJsonParse<ClineSayTool>(text) ?? null;
  toolParseCache.set(text, parsed);

  if (toolParseCache.size > MAX_TOOL_PARSE_CACHE_SIZE) {
    const oldestKey = toolParseCache.keys().next().value;
    if (oldestKey !== undefined) {
      toolParseCache.delete(oldestKey);
    }
  }

  return parsed;
}

export function clearChatToolParseCache() {
  toolParseCache.clear();
}
