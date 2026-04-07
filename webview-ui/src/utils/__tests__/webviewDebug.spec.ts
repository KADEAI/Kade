import { beforeEach, describe, expect, it, vi } from "vitest";

const { postMessage } = vi.hoisted(() => ({
  postMessage: vi.fn(),
}));

vi.mock("../vscode", () => ({
  vscode: {
    postMessage,
  },
}));

import {
  createWebviewDebugPayload,
  reportWebviewDebugEvent,
} from "../webviewDebug";

describe("webviewDebug", () => {
  beforeEach(() => {
    postMessage.mockReset();
    vi.restoreAllMocks();
  });

  it("summarizes large and circular payloads before posting to the extension", () => {
    const circular: Record<string, unknown> = {
      bigText: "x".repeat(800),
      items: Array.from({ length: 20 }, (_, index) => ({
        index,
        value: `item-${index}`,
      })),
    };
    circular.self = circular;

    reportWebviewDebugEvent({
      source: "ChatView",
      event: "partial_message_stuck_while_streaming",
      level: "warn",
      data: circular,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.type).toBe("webviewDebug");

    const payload = JSON.parse(message.text);
    expect(payload.source).toBe("ChatView");
    expect(payload.event).toBe("partial_message_stuck_while_streaming");
    expect(payload.data.bigText).toContain("<truncated");
    expect(payload.data.items.length).toBe(20);
    expect(payload.data.items.items).toHaveLength(12);
    expect(payload.data.self).toBe("[Circular]");
  });

  it("preserves key error details in the debug payload", () => {
    const payload = createWebviewDebugPayload({
      source: "ErrorBoundary",
      event: "react_error_boundary",
      level: "error",
      data: {
        error: new Error("renderer blew up"),
      },
    });

    expect(payload.level).toBe("error");
    expect(payload.data).toMatchObject({
      error: {
        name: "Error",
        message: "renderer blew up",
      },
    });
  });
});
