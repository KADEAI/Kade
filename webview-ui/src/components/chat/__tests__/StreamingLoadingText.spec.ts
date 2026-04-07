import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkingStatusRotation,
  deriveAgentStatusLabel,
  pickStatusVariant,
  STATUS_VARIANTS,
  StreamingLoadingText,
  WORKING_STATUS_TRANSLATIONS,
  WORKING_TRANSLATION_INTERVAL_MS,
} from "../StreamingLoadingText";

describe("StreamingLoadingText", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps canonical read and list tool names to activity labels", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 1,
        text: "{}",
      },
      {
        type: "ask",
        ask: "tool",
        ts: 2,
        partial: true,
        text: JSON.stringify({ tool: "read", path: "src/App.tsx" }),
      },
      {
        type: "ask",
        ask: "tool",
        ts: 3,
        partial: true,
        text: JSON.stringify({ tool: "list", path: "src" }),
      },
    ] as any;

    expect(deriveAgentStatusLabel(messages, 1)).toBe("Reading files");
    expect(deriveAgentStatusLabel(messages, 2)).toBe("Reading files");
    expect(deriveAgentStatusLabel(messages, 3)).toBe("Exploring directories");
  });

  it("maps canonical instruction and context tool names to activity labels", () => {
    const messages = [
      {
        type: "say",
        say: "api_req_started",
        ts: 10,
        text: "{}",
      },
      {
        type: "ask",
        ask: "tool",
        ts: 11,
        partial: true,
        text: JSON.stringify({
          tool: "fetch_instructions",
          task: "repo rules",
        }),
      },
      {
        type: "ask",
        ask: "tool",
        ts: 12,
        partial: true,
        text: JSON.stringify({ tool: "fast_context", query: "router" }),
      },
    ] as any;

    expect(deriveAgentStatusLabel(messages, 11)).toBe("Reading instructions");
    expect(deriveAgentStatusLabel(messages, 12)).toBe("Gathering context");
  });

  it("keeps a 45-language working rotation", () => {
    expect(WORKING_STATUS_TRANSLATIONS).toHaveLength(45);
  });

  it("uses the approved static status variant pools", () => {
    expect(STATUS_VARIANTS["Reading files"]).toEqual([
      "Reading files",
      "Inspecting files",
      "Reviewing files",
      "Scanning files",
      "Checking files",
      "Analyzing files",
    ]);

    expect(STATUS_VARIANTS["Writing files"]).toEqual([
      "Writing files",
      "Creating files",
      "Saving files",
      "Saving changes",
    ]);

    expect(STATUS_VARIANTS["Reading web pages"]).toEqual([
      "Reading pages",
      "Fetching pages",
      "Reviewing pages",
      "Scanning pages",
    ]);
  });

  it("builds a shuffled rotation that always starts with Working", () => {
    const rotationA = buildWorkingStatusRotation(() => 0);
    const rotationB = buildWorkingStatusRotation(() => 0.999999);

    expect(rotationA[0]).toBe("Working");
    expect(rotationB[0]).toBe("Working");
    expect([...rotationA].sort()).toEqual([...WORKING_STATUS_TRANSLATIONS].sort());
    expect(rotationA).not.toEqual(rotationB);
  });

  it("picks deterministic static variants from each pool", () => {
    expect(pickStatusVariant("Running commands", () => 0)).toBe(
      "Running commands",
    );
    expect(pickStatusVariant("Running commands", () => 0.999999)).toBe(
      "Using terminal",
    );
    expect(pickStatusVariant("Searching the web", () => 0)).toBe(
      "Searching web",
    );
    expect(pickStatusVariant("Reading web pages", () => 0.999999)).toBe(
      "Scanning pages",
    );
  });

  it("cycles localized working labels while active", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const expectedRotation = buildWorkingStatusRotation(() => 0);

    render(
      React.createElement(StreamingLoadingText, {
        text: "working",
        active: true,
      }),
    );

    expect(screen.getByText("Working")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(WORKING_TRANSLATION_INTERVAL_MS);
    });

    expect(screen.getByText(expectedRotation[1])).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(
        WORKING_TRANSLATION_INTERVAL_MS * (expectedRotation.length - 1),
      );
    });

    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("randomizes static labels once and keeps them stable until status changes", () => {
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.999999)
      .mockReturnValueOnce(0);

    const { rerender } = render(
      React.createElement(StreamingLoadingText, {
        text: "Reading files",
        active: true,
      }),
    );

    expect(screen.getByText("Analyzing files")).toBeInTheDocument();

    rerender(
      React.createElement(StreamingLoadingText, {
        text: "Reading files",
        active: true,
        elapsedSeconds: 3,
      }),
    );

    expect(screen.getByText("Analyzing files")).toBeInTheDocument();

    rerender(
      React.createElement(StreamingLoadingText, {
        text: "Editing files",
        active: true,
      }),
    );

    expect(screen.getByText("Editing files")).toBeInTheDocument();
    expect(random).toHaveBeenCalledTimes(2);
  });
});
