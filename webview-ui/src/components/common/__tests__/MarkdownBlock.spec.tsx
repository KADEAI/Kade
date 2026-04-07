import { render, screen } from "@/utils/test-utils";

import MarkdownBlock from "../MarkdownBlock";

const mockUseExtensionState = vi.fn(() => ({
  theme: "dark",
  showVibeStyling: true,
}));

vi.mock("@src/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

vi.mock("../../kilocode/common/CodeBlock", () => ({
  default: ({ source, language }: { source?: string; language: string }) => (
    <pre data-testid="mock-code-block" data-language={language}>
      {source}
    </pre>
  ),
}));

vi.mock("@src/context/ExtensionStateContext", () => ({
  useExtensionState: () => mockUseExtensionState(),
}));

describe("MarkdownBlock", () => {
  beforeEach(() => {
    mockUseExtensionState.mockReturnValue({
      theme: "dark",
      showVibeStyling: true,
    });
  });

  it("should correctly handle URLs with trailing punctuation", async () => {
    const markdown = "Check out this link: https://example.com.";
    const { container } = render(<MarkdownBlock markdown={markdown} />);

    // Wait for the content to be processed
    await screen.findByText(/Check out this link/, { exact: false });

    // Check for nested links - this should not happen
    const nestedLinks = container.querySelectorAll("a a");
    expect(nestedLinks.length).toBe(0);

    // Should have exactly one link
    const linkElement = screen.getByRole("link");
    expect(linkElement).toHaveAttribute("href", "https://example.com");
    expect(linkElement.textContent).toBe("https://example.com");

    // Check that the period is outside the link
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(
      "Check out this link: https://example.com.",
    );
  });

  it("should render unordered lists with proper styling", async () => {
    const markdown = `Here are some items:
- First item
- Second item
  - Nested item
  - Another nested item`;

    const { container } = render(<MarkdownBlock markdown={markdown} />);

    // Wait for the content to be processed
    await screen.findByText(/Here are some items/, { exact: false });

    // Check that ul elements exist
    const ulElements = container.querySelectorAll("ul");
    expect(ulElements.length).toBeGreaterThan(0);

    // Check that list items exist
    const liElements = container.querySelectorAll("li");
    expect(liElements.length).toBe(4);

    // Verify the text content
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
    expect(screen.getByText("Nested item")).toBeInTheDocument();
    expect(screen.getByText("Another nested item")).toBeInTheDocument();
  });

  it("should render ordered lists with proper styling", async () => {
    const markdown = `And a numbered list:
1. Step one
2. Step two
3. Step three`;

    const { container } = render(<MarkdownBlock markdown={markdown} />);

    // Wait for the content to be processed
    await screen.findByText(/And a numbered list/, { exact: false });

    // Check that ol elements exist
    const olElements = container.querySelectorAll("ol");
    expect(olElements.length).toBe(1);

    // Check that list items exist
    const liElements = container.querySelectorAll("li");
    expect(liElements.length).toBe(3);

    // Verify the text content
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Step two")).toBeInTheDocument();
    expect(screen.getByText("Step three")).toBeInTheDocument();
  });

  it("should render nested lists with proper hierarchy", async () => {
    const markdown = `Complex list:
1. First level ordered
   - Second level unordered
   - Another second level
     1. Third level ordered
     2. Another third level
2. Back to first level`;

    const { container } = render(<MarkdownBlock markdown={markdown} />);

    // Wait for the content to be processed
    await screen.findByText(/Complex list/, { exact: false });

    // Check nested structure
    const olElements = container.querySelectorAll("ol");
    const ulElements = container.querySelectorAll("ul");

    expect(olElements.length).toBeGreaterThan(0);
    expect(ulElements.length).toBeGreaterThan(0);

    // Verify all text is rendered
    expect(screen.getByText("First level ordered")).toBeInTheDocument();
    expect(screen.getByText("Second level unordered")).toBeInTheDocument();
    expect(screen.getByText("Third level ordered")).toBeInTheDocument();
    expect(screen.getByText("Back to first level")).toBeInTheDocument();
  });

  it("renders an incomplete fenced code block while streaming", async () => {
    const markdown = "Before\n```ts\nconst answer = 42";

    render(<MarkdownBlock markdown={markdown} isStreaming={true} />);

    const codeBlock = await screen.findByTestId("mock-code-block");
    expect(codeBlock).toHaveTextContent("const answer = 42");
    expect(codeBlock).toHaveAttribute("data-language", "ts");
    expect(screen.getByText("Before")).toBeInTheDocument();
  });

  it("keeps earlier code blocks visible when a later fence is still streaming", async () => {
    const markdown = [
      "```js",
      "console.log('first')",
      "```",
      "",
      "```py",
      "print('second')",
    ].join("\n");

    render(<MarkdownBlock markdown={markdown} isStreaming={true} />);

    const codeBlocks = await screen.findAllByTestId("mock-code-block");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveTextContent("console.log('first')");
    expect(codeBlocks[0]).toHaveAttribute("data-language", "js");
    expect(codeBlocks[1]).toHaveTextContent("print('second')");
    expect(codeBlocks[1]).toHaveAttribute("data-language", "py");
  });

  it("renders vibe markdown when enabled", async () => {
    const markdown = "~shout:pro important~";
    const { container } = render(<MarkdownBlock markdown={markdown} />);

    await screen.findByText("important");
    expect(container.querySelector("[data-content='important']")).toBeTruthy();
  });

  it("renders vibe markdown as plain text when disabled", async () => {
    mockUseExtensionState.mockReturnValue({
      theme: "dark",
      showVibeStyling: false,
    });

    const markdown = "~shout:pro important~";
    const { container } = render(<MarkdownBlock markdown={markdown} />);

    await screen.findByText("~shout:pro important~");
    expect(container.querySelector("[data-content='important']")).toBeFalsy();
  });
});
