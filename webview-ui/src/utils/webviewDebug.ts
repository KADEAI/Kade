import { vscode } from "./vscode";

type WebviewDebugLevel = "debug" | "info" | "warn" | "error";

type ReportWebviewDebugOptions = {
  source: string;
  event: string;
  level?: WebviewDebugLevel;
  data?: unknown;
};

const MAX_DEPTH = 4;
const MAX_KEYS = 20;
const MAX_ITEMS = 12;
const MAX_STRING_LENGTH = 500;

const truncateString = (value: string) =>
  value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...<truncated ${value.length - MAX_STRING_LENGTH} chars>`
    : value;

const summarizeValue = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: truncateString(value.stack || ""),
    };
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    return "[Object]";
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return {
        type: "array",
        length: value.length,
        items: value
          .slice(0, MAX_ITEMS)
          .map((item) => summarizeValue(item, depth + 1, seen)),
      };
    }

    const entries = Object.entries(value);
    const summarizedEntries = entries
      .slice(0, MAX_KEYS)
      .map(([key, entryValue]) => [
        key,
        summarizeValue(entryValue, depth + 1, seen),
      ]);

    return {
      ...Object.fromEntries(summarizedEntries),
      ...(entries.length > MAX_KEYS
        ? { __truncatedKeys: entries.length - MAX_KEYS }
        : {}),
    };
  }

  return String(value);
};

const safeJsonStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      source: "webviewDebug",
      event: "stringify_failed",
      level: "error",
      data: summarizeValue(error),
    });
  }
};

const getConsoleMethod = (level: WebviewDebugLevel) => {
  switch (level) {
    case "debug":
      return console.debug;
    case "info":
      return console.info;
    case "error":
      return console.error;
    case "warn":
    default:
      return console.warn;
  }
};

export const createWebviewDebugPayload = ({
  source,
  event,
  level = "warn",
  data,
}: ReportWebviewDebugOptions) => ({
  source,
  event,
  level,
  ts: new Date().toISOString(),
  location:
    typeof window !== "undefined"
      ? {
          href: window.location.href,
          pathname: window.location.pathname,
        }
      : undefined,
  data: summarizeValue(data),
});

export const reportWebviewDebugEvent = (options: ReportWebviewDebugOptions) => {
  const payload = createWebviewDebugPayload(options);
  const text = safeJsonStringify(payload);

  try {
    getConsoleMethod(payload.level)(`[WEBVIEW_DEBUG] ${text}`);
  } catch {
    // Ignore console failures; the extension post below is the important path.
  }

  try {
    vscode.postMessage({
      type: "webviewDebug",
      text,
    });
  } catch (error) {
    try {
      console.error(
        `[WEBVIEW_DEBUG_FALLBACK] ${safeJsonStringify(
          createWebviewDebugPayload({
            source: "webviewDebug",
            event: "postMessage_failed",
            level: "error",
            data: { originalPayload: payload, error },
          }),
        )}`,
      );
    } catch {
      // Ignore fallback logging failures as well.
    }
  }

  return payload;
};

const LIFECYCLE_DEBUG_INSTALLED_KEY = "__kiloWebviewLifecycleDebugInstalled";

export const installWebviewLifecycleDebugging = () => {
  if (typeof window === "undefined") {
    return;
  }

  const debugWindow = window as Window & {
    [LIFECYCLE_DEBUG_INSTALLED_KEY]?: boolean;
  };

  if (debugWindow[LIFECYCLE_DEBUG_INSTALLED_KEY]) {
    return;
  }
  debugWindow[LIFECYCLE_DEBUG_INSTALLED_KEY] = true;

  window.addEventListener("pagehide", (event) => {
    reportWebviewDebugEvent({
      source: "webviewLifecycle",
      event: "pagehide",
      level: "warn",
      data: {
        persisted: event.persisted,
        visibilityState: document.visibilityState,
      },
    });
  });

  window.addEventListener("beforeunload", () => {
    reportWebviewDebugEvent({
      source: "webviewLifecycle",
      event: "beforeunload",
      level: "warn",
      data: {
        visibilityState: document.visibilityState,
      },
    });
  });

  document.addEventListener("visibilitychange", () => {
    reportWebviewDebugEvent({
      source: "webviewLifecycle",
      event: "visibilitychange",
      level: "info",
      data: {
        visibilityState: document.visibilityState,
      },
    });
  });
};
