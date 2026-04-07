import React from "react";
import { fireEvent, render, screen } from "@/utils/test-utils";
import { GrepTool } from "../GrepTool";

vi.mock("@/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

describe("GrepTool", () => {
  it("does not render a completed grep row when no expandable content exists", () => {
    const { container } = render(
      <GrepTool
        tool={{ pattern: "zed", path: "samba" }}
        toolResult={{}}
        isLastMessage={false}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Searched/i)).not.toBeInTheDocument();
  });

  it("renders when grep results are available", () => {
    render(
      <GrepTool
        tool={{ pattern: "zed", path: "samba" }}
        toolResult={{ content: "src/foo.ts:12: const zed = true;" }}
        isLastMessage={false}
      />,
    );

    expect(screen.getByText(/Searched/i)).toBeInTheDocument();
    expect(screen.getByText("zed")).toBeInTheDocument();
  });

  it("highlights grep match markers inside expanded result rows", () => {
    render(
      <GrepTool
        tool={{ pattern: "edited", path: "sample.txt" }}
        toolResult={{
          content: "sample.txt:2:* This has been →edited← by the AI assistant.",
        }}
        isLastMessage={false}
      />,
    );

    fireEvent.click(screen.getByText(/Searched/i));

    const highlight = screen.getByText("→edited←");
    expect(highlight.tagName).toBe("MARK");
  });
});
