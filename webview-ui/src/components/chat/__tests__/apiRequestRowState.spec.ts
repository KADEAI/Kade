import { describe, expect, it } from "vitest";

import {
  isRenderableToolMessage,
  shouldSuppressApiRequestRowForToolTurn,
} from "../apiRequestRowState";

describe("apiRequestRowState", () => {
  it("does not try to parse plain assistant text as tool json", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 1,
        text: JSON.stringify({}),
      },
      {
        type: "say",
        say: "text",
        ts: 2,
        text: "The user wants an explanation.",
        partial: true,
      },
    ] as any;

    expect(shouldSuppressApiRequestRowForToolTurn(messages, 1)).toBe(false);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("recognizes renderable tool ask messages", () => {
    expect(
      isRenderableToolMessage({
        type: "ask",
        ask: "tool",
        text: JSON.stringify({ tool: "readFile", path: "foo.ts" }),
      } as any),
    ).toBe(true);

    expect(
      isRenderableToolMessage({
        type: "say",
        say: "text",
        text: "plain assistant text",
      } as any),
    ).toBe(false);
  });

  it("recognizes canonical read tool asks as renderable", () => {
    expect(
      isRenderableToolMessage({
        type: "ask",
        ask: "tool",
        text: JSON.stringify({ tool: "read", path: "foo.ts" }),
      } as any),
    ).toBe(true);
  });

  it("suppresses the api request row once a tool turn starts after placeholders", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 1,
        text: JSON.stringify({}),
      },
      {
        type: "say",
        say: "text",
        ts: 2,
        text: "",
        partial: true,
      },
      {
        type: "ask",
        ask: "tool",
        ts: 3,
        text: JSON.stringify({ tool: "web", query: "needle" }),
      },
      {
        type: "say",
        say: "tool",
        ts: 4,
        text: JSON.stringify({ tool: "web", query: "needle" }),
      },
    ] as any;

    expect(shouldSuppressApiRequestRowForToolTurn(messages, 1)).toBe(true);
  });

  it("keeps the api request row visible for a single file-read tool turn", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 1,
        text: JSON.stringify({}),
      },
      {
        type: "ask",
        ask: "tool",
        ts: 2,
        partial: true,
        text: JSON.stringify({ tool: "readFile", path: "foo.ts" }),
      },
      {
        type: "say",
        say: "tool",
        ts: 3,
        partial: true,
        text: JSON.stringify({ tool: "readFile", path: "foo.ts" }),
      },
    ] as any;

    expect(shouldSuppressApiRequestRowForToolTurn(messages, 1)).toBe(false);
  });

  it("keeps the api request row visible for a single canonical directory tool turn", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 10,
        text: JSON.stringify({}),
      },
      {
        type: "ask",
        ask: "tool",
        ts: 11,
        partial: true,
        text: JSON.stringify({ tool: "list", path: "src" }),
      },
    ] as any;

    expect(shouldSuppressApiRequestRowForToolTurn(messages, 10)).toBe(false);
  });

  it("does not suppress the api request row for plain text turns", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 10,
        text: JSON.stringify({}),
      },
      {
        type: "say",
        say: "reasoning",
        ts: 11,
        text: "thinking",
        partial: true,
      },
      {
        type: "say",
        say: "text",
        ts: 12,
        text: "final answer",
      },
    ] as any;

    expect(shouldSuppressApiRequestRowForToolTurn(messages, 10)).toBe(false);
  });
});
