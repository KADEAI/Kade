import { shouldHideToolFollowupErrorMessage } from "../toolFollowupErrorState";

describe("toolFollowupErrorState", () => {
  it("hides error rows that immediately follow a tool message", () => {
    const messages: any[] = [
      {
        type: "ask",
        ask: "tool",
        ts: 1000,
        text: JSON.stringify({ tool: "readFile", path: "README.md" }),
      },
      {
        type: "say",
        say: "error",
        ts: 1001,
        text: "The tool execution failed",
      },
    ];

    expect(
      shouldHideToolFollowupErrorMessage({
        messages,
        index: 1,
      }),
    ).toBe(true);
  });

  it("hides error rows when only tool-adjacent transport rows sit in between", () => {
    const messages: any[] = [
      {
        type: "ask",
        ask: "tool",
        ts: 1000,
        text: JSON.stringify({ tool: "readFile", path: "README.md" }),
      },
      {
        type: "say",
        say: "api_req_started",
        ts: 1001,
      },
      {
        type: "say",
        say: "reasoning",
        ts: 1002,
      },
      {
        type: "say",
        say: "error",
        ts: 1003,
        text: "The tool execution failed",
      },
    ];

    expect(
      shouldHideToolFollowupErrorMessage({
        messages,
        index: 3,
      }),
    ).toBe(true);
  });

  it("keeps KiloCode auth errors visible", () => {
    const messages: any[] = [
      {
        type: "ask",
        ask: "tool",
        ts: 1000,
        text: JSON.stringify({ tool: "readFile", path: "README.md" }),
      },
      {
        type: "say",
        say: "error",
        ts: 1001,
        text: "Cannot complete request.\n\nKiloCode token + baseUrl is required to fetch models",
      },
    ];

    expect(
      shouldHideToolFollowupErrorMessage({
        messages,
        index: 1,
        apiProvider: "kilocode",
      }),
    ).toBe(false);
  });

  it("hides consecutive generic error rows after a tool", () => {
    const messages: any[] = [
      {
        type: "ask",
        ask: "tool",
        ts: 1000,
        text: JSON.stringify({ tool: "readFile", path: "README.md" }),
      },
      {
        type: "say",
        say: "error",
        ts: 1001,
        text: "First tool failure",
      },
      {
        type: "say",
        say: "error",
        ts: 1002,
        text: "Second tool failure",
      },
    ];

    expect(
      shouldHideToolFollowupErrorMessage({
        messages,
        index: 2,
      }),
    ).toBe(true);
  });

  it("keeps unrelated standalone errors visible", () => {
    const messages: any[] = [
      {
        type: "say",
        say: "text",
        ts: 1000,
        text: "Working on it",
      },
      {
        type: "say",
        say: "error",
        ts: 1001,
        text: "The request failed",
      },
    ];

    expect(
      shouldHideToolFollowupErrorMessage({
        messages,
        index: 1,
      }),
    ).toBe(false);
  });
});
