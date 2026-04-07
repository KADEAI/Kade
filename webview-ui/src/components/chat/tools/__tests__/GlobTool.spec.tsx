import React from "react";
import { fireEvent, render, screen } from "@/utils/test-utils";
import { GlobTool } from "../GlobTool";

vi.mock("@/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

describe("GlobTool", () => {
  it("hides wildcard stars in the displayed search target", () => {
    render(
      <GlobTool
        tool={{ pattern: "**/*agent*", path: "zed/crates" }}
        toolResult={{ content: "zed/crates/agent.rs" }}
        isLastMessage={false}
      />,
    );

    expect(screen.getByText(/Searched/i)).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*\/\*agent\*/)).not.toBeInTheDocument();
  });

  it("parses indented AI tree results", () => {
    render(
      <GlobTool
        tool={{ pattern: "api", path: "." }}
        toolResult={{
          content: [
            'Note: Search path "missing" was not found. Searched the workspace root instead.',
            "src/",
            "  api.ts|L12",
          ].join("\n"),
        }}
        isLastMessage={false}
      />,
    );

    fireEvent.click(screen.getByText(/Searched/i));
    fireEvent.click(screen.getByText("src"));

    expect(screen.getByText("api.ts")).toBeInTheDocument();
    expect(screen.getByText("L12")).toBeInTheDocument();
    expect(
      screen.queryByText(/Search path "missing" was not found/i),
    ).not.toBeInTheDocument();
  });

  it("hides markdown headings and glob summary lines from expanded results", () => {
    render(
      <GlobTool
        tool={{ pattern: "**/package.json", path: "." }}
        toolResult={{
          content: [
            "## .",
            'Found 3 results matching pattern "**/package.json":',
            "",
            "Total files: 3, Total folders: 0",
            "(file_name|L = line count)",
            "",
            "src/package.json|L929",
            "src/test-llm-autocompletion/package.json",
            "webview-ui/package.json",
          ].join("\n"),
        }}
        isLastMessage={false}
      />,
    );

    fireEvent.click(screen.getByText(/Searched/i));

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("webview-ui")).toBeInTheDocument();
    expect(
      screen.queryByText(/Found 3 results matching pattern/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("## .")).not.toBeInTheDocument();
  });
});
