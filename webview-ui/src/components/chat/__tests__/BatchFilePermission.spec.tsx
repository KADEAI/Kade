import { render, screen, fireEvent } from "@/utils/test-utils";

import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext";

import { BatchFilePermission } from "../BatchFilePermission";

const mockVscodePostMessage = vi.fn();

vi.mock("@src/utils/vscode", () => ({
  vscode: {
    postMessage: (...args: any[]) => mockVscodePostMessage(...args),
  },
}));

describe("BatchFilePermission", () => {
  const mockOnPermissionResponse = vi.fn();

  const mockFiles = [
    {
      key: "file1",
      path: "src/components/Button.tsx",
      content: "src/components/Button.tsx",
      lineSnippet: "export const Button = () => {",
      isOutsideWorkspace: false,
    },
    {
      key: "file2",
      path: "../outside/config.json",
      content: "/absolute/path/to/outside/config.json",
      lineSnippet: '{ "apiKey": "..." }',
      isOutsideWorkspace: true,
    },
    {
      key: "file3",
      path: "tests/Button.test.tsx",
      content: "tests/Button.test.tsx",
      lineSnippet: "describe('Button', () => {",
      isOutsideWorkspace: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders file list correctly", () => {
    render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    // Check that all files are rendered
    expect(screen.getByText(/Button\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/config\.json/)).toBeInTheDocument();
    expect(screen.getByText(/Button\.test\.tsx/)).toBeInTheDocument();

    // Check that line snippets are shown
    expect(
      screen.getByText(/export const Button = \(\) => \{/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\{ "apiKey": "\.\.\." \}/)).toBeInTheDocument();
    expect(
      screen.getByText(/describe\('Button', \(\) => \{/),
    ).toBeInTheDocument();
  });

  it("renders nothing when files array is empty", () => {
    const { container } = render(
      <TranslationProvider>
        <BatchFilePermission
          files={[]}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when onPermissionResponse is not provided", () => {
    const { container } = render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={undefined}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("opens file when clicking on file item", () => {
    render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    fireEvent.click(screen.getByTitle("src/components/Button.tsx"));

    expect(mockVscodePostMessage).toHaveBeenCalledWith({
      type: "openFile",
      text: "src/components/Button.tsx",
    });
  });

  it("handles files with paths starting with dot correctly", () => {
    const filesWithDotPath = [
      {
        key: "file1",
        path: "./src/index.ts",
        content: "./src/index.ts",
        lineSnippet: "import React from 'react'",
      },
    ];

    render(
      <TranslationProvider>
        <BatchFilePermission
          files={filesWithDotPath}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    expect(screen.getByTitle("./src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("re-renders when timestamp changes", () => {
    const { rerender } = render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={1000}
        />
      </TranslationProvider>,
    );

    // Initial render
    expect(screen.getByText(/Button\.tsx/)).toBeInTheDocument();

    // Re-render with new timestamp
    rerender(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={2000}
        />
      </TranslationProvider>,
    );

    // Should still show files
    expect(screen.getByText(/Button\.tsx/)).toBeInTheDocument();
  });

  it("renders the completed checkmark at the end of each read row", () => {
    render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
        />
      </TranslationProvider>,
    );

    const checks = document.querySelectorAll(".codicon-check");
    expect(checks).toHaveLength(mockFiles.length);

    const firstReadLabel = screen.getAllByText("Read")[0];
    expect(firstReadLabel.parentElement?.lastElementChild).toHaveClass(
      "codicon",
      "codicon-check",
    );
  });

  it("renders the loading indicator at the end of each pending read row", () => {
    render(
      <TranslationProvider>
        <BatchFilePermission
          files={mockFiles}
          onPermissionResponse={mockOnPermissionResponse}
          ts={Date.now()}
          isLastMessage
        />
      </TranslationProvider>,
    );

    expect(screen.getAllByText("Reading")).toHaveLength(mockFiles.length);

    const spinners = document.querySelectorAll(".codicon-loading");
    expect(spinners).toHaveLength(mockFiles.length);

    const firstReadingLabel = screen.getAllByText("Reading")[0];
    expect(firstReadingLabel.parentElement?.lastElementChild).toHaveClass(
      "codicon",
      "codicon-loading",
      "codicon-modifier-spin",
    );
  });
});
