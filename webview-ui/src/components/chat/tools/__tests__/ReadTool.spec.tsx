import React from "react";
import { render, screen } from "@/utils/test-utils";

import { ReadTool } from "../ReadTool";

vi.mock("@/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

describe("ReadTool", () => {
  it("renders completed reads for files with an extension", () => {
    render(
      <ReadTool
        tool={{ path: "/tmp/thread.rs" }}
        toolResult={{ content: "fn main() {}" }}
        isLastMessage={false}
      />,
    );

    expect(screen.getByText(/^Read$/i)).toBeInTheDocument();
    expect(screen.getByText(/thread\.rs/i)).toBeInTheDocument();
  });

  it("hides completed reads for extensionless file names", () => {
    const { container } = render(
      <ReadTool
        tool={{ path: "/tmp/thread" }}
        toolResult={{ content: "partial artifact" }}
        isLastMessage={false}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/^Read$/i)).not.toBeInTheDocument();
  });

  it("keeps in-progress extensionless reads visible while streaming", () => {
    render(<ReadTool tool={{ path: "/tmp/thread" }} isLastMessage />);

    expect(screen.getByText(/^Reading$/i)).toBeInTheDocument();
    expect(screen.getByText(/^thread$/i)).toBeInTheDocument();
  });

  it("does not render a line label from the truncate threshold in reason text", () => {
    render(
      <ReadTool
        tool={{ path: "/tmp/sample.txt", reason: "Read up to 800 lines" }}
        toolResult={{ content: "sample" }}
        isLastMessage={false}
      />,
    );

    expect(screen.getByText(/sample\.txt/i)).toBeInTheDocument();
    expect(screen.queryByText("#L800")).not.toBeInTheDocument();
  });

  it("renders explicit line ranges from reason text", () => {
    render(
      <ReadTool
        tool={{ path: "/tmp/sample.txt", reason: "Read lines 10-20" }}
        toolResult={{ content: "sample" }}
        isLastMessage={false}
      />,
    );

    expect(screen.getByText("#L10-20")).toBeInTheDocument();
  });
});
