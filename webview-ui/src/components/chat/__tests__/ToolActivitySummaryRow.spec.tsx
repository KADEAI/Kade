import React from "react";
import { act, render, screen } from "@/utils/test-utils";

import ToolActivitySummaryRow from "../ToolActivitySummaryRow";

vi.mock("../tools/FileIcon", () => ({
  FileIcon: ({ fileName }: { fileName: string }) => (
    <span data-testid="file-icon">{fileName}</span>
  ),
}));

describe("ToolActivitySummaryRow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes repeated visible entries even when tool ids are reused", () => {
    render(
      <ToolActivitySummaryRow
        data={{
          summaryText: "Explored 2 files",
          running: true,
          entries: [
            {
              id: "tool-1",
              label: "Explored 2 files",
              filePath: "/tmp/a.md",
            },
            {
              id: "tool-1",
              label: "Explored   2   files",
              filePath: "/tmp/a.md",
            },
            {
              id: "tool-1",
              label: "Explored 2 files",
              filePath: "/tmp/a.md",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByTitle("Explored 2 files")).toHaveLength(1);
  });

  it("renders custom expanded content when children are provided", () => {
    render(
      <ToolActivitySummaryRow
        data={{
          summaryText: "Explored 2 files",
          running: true,
          entries: [],
        }}
      >
        <div>Read alpha.ts</div>
        <div>Read beta.ts</div>
      </ToolActivitySummaryRow>,
    );

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Read alpha.ts")).toBeInTheDocument();
    expect(screen.getByText("Read beta.ts")).toBeInTheDocument();
  });

  it("renders the completed checkmark after the summary label", () => {
    render(
      <ToolActivitySummaryRow
        data={{
          summaryText: "Read ChatView.tsx",
          running: false,
          entries: [],
        }}
      />,
    );

    const button = screen.getByRole("button");
    const leftGroup = button.firstElementChild as HTMLElement;

    expect(leftGroup.lastElementChild).toHaveClass("codicon", "codicon-check");
  });

  it("reveals grouped tool rows one by one and collapses after the run finishes", async () => {
    vi.useFakeTimers();

    const { rerender, container } = render(
      <ToolActivitySummaryRow
        shouldAnimate
        data={{
          summaryText: "Explored 3 files",
          running: true,
          entries: [],
        }}
      >
        <div>Read alpha.ts</div>
        <div>Read beta.ts</div>
        <div>Read gamma.ts</div>
      </ToolActivitySummaryRow>,
    );

    expect(screen.queryByText("Read alpha.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("Read beta.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("Read gamma.ts")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("Read alpha.ts")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Read beta.ts")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("Read beta.ts")).toBeInTheDocument();
    expect(screen.queryByText("Read gamma.ts")).not.toBeInTheDocument();

    rerender(
      <ToolActivitySummaryRow
        shouldAnimate
        data={{
          summaryText: "Explored 3 files",
          running: false,
          entries: [],
        }}
      >
        <div>Read alpha.ts</div>
        <div>Read beta.ts</div>
        <div>Read gamma.ts</div>
      </ToolActivitySummaryRow>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("Read gamma.ts")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(container.querySelector(".codicon-chevron-right")).toBeTruthy();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
