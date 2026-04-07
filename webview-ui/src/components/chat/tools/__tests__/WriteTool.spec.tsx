import React from "react";
import { render, screen } from "@/utils/test-utils";
import { WriteTool } from "../WriteTool";

vi.mock("@/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

vi.mock("@/context/ExtensionStateContext", () => ({
  useExtensionState: () => ({}),
}));

describe("WriteTool", () => {
  it("does not render a non-error card when the file path is unknown", () => {
    const { container } = render(
      <WriteTool tool={{ content: "hello" }} isLastMessage={false} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Unknown File")).not.toBeInTheDocument();
  });
});
