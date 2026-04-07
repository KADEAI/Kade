import {
  DiffViewProvider,
  DIFF_VIEW_URI_SCHEME,
  DIFF_VIEW_LABEL_CHANGES,
} from "../DiffViewProvider";
import * as vscode from "vscode";
import * as path from "path";
import delay from "delay";

const { mockFormatWithPrettier } = vi.hoisted(() => ({
  mockFormatWithPrettier: vi.fn(async ({ content }: { content: string }) => {
    if (content === "const x={a:1}") {
      return "const x = { a: 1 };\n";
    }
    return content;
  }),
}));

// Mock delay
vi.mock("delay", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("file content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock utils
vi.mock("../../../utils/fs", () => ({
  createDirectoriesForFile: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../core/tools/helpers/formatWithPrettier", () => ({
  formatWithPrettier: mockFormatWithPrettier,
}));

// Mock path
vi.mock("path", () => ({
  default: {
    resolve: vi.fn((cwd, relPath) => `${cwd}/${relPath}`),
    basename: vi.fn((targetPath) => targetPath.split("/").pop()),
  },
  resolve: vi.fn((cwd, relPath) => `${cwd}/${relPath}`),
  basename: vi.fn((targetPath) => targetPath.split("/").pop()),
}));

// Mock vscode
vi.mock("vscode", () => ({
  workspace: {
    applyEdit: vi.fn(),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn().mockResolvedValue({
      isDirty: false,
      save: vi.fn().mockResolvedValue(undefined),
    }),
    textDocuments: [],
    fs: {
      stat: vi.fn(),
    },
  },
  window: {
    createTextEditorDecorationType: vi.fn(),
    showTextDocument: vi.fn(),
    onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
    tabGroups: {
      all: [],
      close: vi.fn(),
    },
    visibleTextEditors: [],
  },
  commands: {
    executeCommand: vi.fn(),
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
  languages: {
    getDiagnostics: vi.fn(() => []),
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  WorkspaceEdit: vi.fn().mockImplementation(() => ({
    replace: vi.fn(),
    delete: vi.fn(),
  })),
  ViewColumn: {
    Active: 1,
    Beside: 2,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
  },
  Range: vi.fn(),
  Position: vi.fn(),
  Selection: vi.fn(),
  TextEditorRevealType: {
    InCenter: 2,
  },
  TabInputTextDiff: class TabInputTextDiff {},
  Uri: {
    file: vi.fn((path) => ({ fsPath: path })),
    from: vi.fn((parts) => ({
      ...parts,
      toString: vi.fn(() => `${parts.scheme}:${parts.path}`),
    })),
    parse: vi.fn((uri) => ({ with: vi.fn(() => ({})) })),
  },
}));

// Mock DecorationController
vi.mock("../DecorationController", () => ({
  DecorationController: vi.fn().mockImplementation(() => ({
    setActiveLine: vi.fn(),
    updateOverlayAfterLine: vi.fn(),
    addLines: vi.fn(),
    clear: vi.fn(),
  })),
}));

describe("DiffViewProvider", () => {
  let diffViewProvider: DiffViewProvider;
  const mockCwd = "/mock/cwd";
  let mockWorkspaceEdit: { replace: any; delete: any };
  let mockTask: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatWithPrettier.mockClear();
    mockWorkspaceEdit = {
      replace: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(vscode.WorkspaceEdit).mockImplementation(
      () => mockWorkspaceEdit as any,
    );

    // Create a mock Task instance
    mockTask = {
      providerRef: {
        deref: vi.fn().mockReturnValue({
          getState: vi.fn().mockResolvedValue({
            includeDiagnosticMessages: true,
            maxDiagnosticMessages: 50,
          }),
        }),
      },
    };

    diffViewProvider = new DiffViewProvider(mockCwd, mockTask);
    // Mock the necessary properties and methods
    (diffViewProvider as any).relPath = "test.txt";
    (diffViewProvider as any).activeDiffEditor = {
      document: {
        uri: { fsPath: `${mockCwd}/test.txt` },
        getText: vi.fn(),
        lineCount: 10,
      },
      selection: {
        active: { line: 0, character: 0 },
        anchor: { line: 0, character: 0 },
      },
      edit: vi.fn().mockResolvedValue(true),
      revealRange: vi.fn(),
    };
    (diffViewProvider as any).activeLineController = {
      setActiveLine: vi.fn(),
      clear: vi.fn(),
    };
    (diffViewProvider as any).fadedOverlayController = {
      updateOverlayAfterLine: vi.fn(),
      addLines: vi.fn(),
      clear: vi.fn(),
    };
  });

  describe("update method", () => {
    it("should preserve empty last line when original content has one", async () => {
      (diffViewProvider as any).originalContent = "Original content\n";
      await diffViewProvider.update("New content", true);

      expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "New content\n",
      );
    });

    it("should not add extra newline when accumulated content already ends with one", async () => {
      (diffViewProvider as any).originalContent = "Original content\n";
      await diffViewProvider.update("New content\n", true);

      expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "New content\n",
      );
    });

    it("should not add newline when original content does not end with one", async () => {
      (diffViewProvider as any).originalContent = "Original content";
      await diffViewProvider.update("New content", true);

      expect(mockWorkspaceEdit.replace).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "New content",
      );
    });
  });

  describe("open method", () => {
    it("should pre-open file as text document before executing diff command", async () => {
      // Setup
      const mockEditor = {
        document: {
          uri: { fsPath: `${mockCwd}/test.md`, scheme: "file" },
          getText: vi.fn().mockReturnValue(""),
          lineCount: 0,
        },
        selection: {
          active: { line: 0, character: 0 },
          anchor: { line: 0, character: 0 },
        },
        edit: vi.fn().mockResolvedValue(true),
        revealRange: vi.fn(),
      };

      // Track the order of calls
      const callOrder: string[] = [];

      // Mock showTextDocument to track when it's called
      vi.mocked(vscode.window.showTextDocument).mockImplementation(
        async (uri, options) => {
          callOrder.push("showTextDocument");
          expect(options).toEqual({
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: true,
          });
          return mockEditor as any;
        },
      );

      // Mock executeCommand to track when it's called
      vi.mocked(vscode.commands.executeCommand).mockImplementation(
        async (command) => {
          callOrder.push("executeCommand");
          expect(command).toBe("vscode.diff");
          return undefined;
        },
      );

      // Mock workspace.onDidOpenTextDocument to trigger immediately
      vi.mocked(vscode.workspace.onDidOpenTextDocument).mockImplementation(
        (callback) => {
          // Trigger the callback immediately with the document
          setTimeout(() => {
            callback({
              uri: { fsPath: `${mockCwd}/test.md`, scheme: "file" },
            } as any);
          }, 0);
          return { dispose: vi.fn() };
        },
      );

      // Mock window.visibleTextEditors to return our editor
      vi.mocked(vscode.window).visibleTextEditors = [mockEditor as any];

      // Set up for file
      (diffViewProvider as any).editType = "modify";

      // Execute open
      await diffViewProvider.open("test.md");

      // Verify that showTextDocument was called before executeCommand
      expect(callOrder).toEqual(["showTextDocument", "executeCommand"]);

      // Verify that showTextDocument was called with preview: false and preserveFocus: true
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: `${mockCwd}/test.md` }),
        {
          preview: false,
          viewColumn: vscode.ViewColumn.Active,
          preserveFocus: true,
        },
      );

      // Verify that the diff command was executed
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.any(Object),
        expect.any(Object),
        `test.md: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
        { preserveFocus: true },
      );
    });

    it("should handle showTextDocument failure", async () => {
      // Mock showTextDocument to fail
      vi.mocked(vscode.window.showTextDocument).mockRejectedValue(
        new Error("Cannot open file"),
      );

      // Mock workspace.onDidOpenTextDocument
      vi.mocked(vscode.workspace.onDidOpenTextDocument).mockReturnValue({
        dispose: vi.fn(),
      });

      // Mock window.onDidChangeVisibleTextEditors
      vi.mocked(vscode.window.onDidChangeVisibleTextEditors).mockReturnValue({
        dispose: vi.fn(),
      });

      // Set up for file
      (diffViewProvider as any).editType = "modify";

      // Try to open and expect rejection
      await expect(diffViewProvider.open("test.md")).rejects.toThrow(
        "Failed to execute diff command for /mock/cwd/test.md: Cannot open file",
      );
    });
  });

  describe("closeAllDiffViews method", () => {
    it("should close diff views including those identified by label", async () => {
      // Mock tab groups with various types of tabs
      const mockTabs = [
        // Normal diff view
        {
          input: {
            constructor: { name: "TabInputTextDiff" },
            original: { scheme: DIFF_VIEW_URI_SCHEME },
            modified: { fsPath: "/test/file1.ts" },
          },
          label: `file1.ts: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
          isDirty: false,
        },
        // Diff view identified by label (for pre-opened files)
        {
          input: {
            constructor: { name: "TabInputTextDiff" },
            original: { scheme: "file" }, // Different scheme due to pre-opening
            modified: { fsPath: "/test/file2.md" },
          },
          label: `file2.md: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
          isDirty: false,
        },
        // Regular file tab (should not be closed)
        {
          input: {
            constructor: { name: "TabInputText" },
            uri: { fsPath: "/test/file3.js" },
          },
          label: "file3.js",
          isDirty: false,
        },
        // Dirty diff view (should not be closed)
        {
          input: {
            constructor: { name: "TabInputTextDiff" },
            original: { scheme: DIFF_VIEW_URI_SCHEME },
            modified: { fsPath: "/test/file4.ts" },
          },
          label: `file4.ts: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
          isDirty: true,
        },
      ];

      // Make tabs appear as TabInputTextDiff instances
      mockTabs.forEach((tab) => {
        if (tab.input.constructor.name === "TabInputTextDiff") {
          Object.setPrototypeOf(tab.input, vscode.TabInputTextDiff.prototype);
        }
      });

      // Mock the tabGroups getter
      Object.defineProperty(vscode.window.tabGroups, "all", {
        get: () => [
          {
            tabs: mockTabs as any,
          },
        ],
        configurable: true,
      });

      const closedTabs: any[] = [];
      vi.mocked(vscode.window.tabGroups.close).mockImplementation((tab) => {
        closedTabs.push(tab);
        return Promise.resolve(true);
      });

      // Execute closeAllDiffViews
      await (diffViewProvider as any).closeAllDiffViews();

      // Verify that only the appropriate tabs were closed
      expect(closedTabs).toHaveLength(2);
      expect(closedTabs[0].label).toBe(
        `file1.ts: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
      );
      expect(closedTabs[1].label).toBe(
        `file2.md: ${DIFF_VIEW_LABEL_CHANGES} (Editable)`,
      );

      // Verify that the regular file and dirty diff were not closed
      expect(closedTabs.find((t) => t.label === "file3.js")).toBeUndefined();
      expect(
        closedTabs.find(
          (t) =>
            t.label === `file4.ts: ${DIFF_VIEW_LABEL_CHANGES} (Editable)` &&
            t.isDirty,
        ),
      ).toBeUndefined();
    });
  });

  describe("saveDirectly method", () => {
    beforeEach(() => {
      // Mock vscode functions
      vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as any);
      vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([]);
    });

    it("should write content directly to file without opening diff view", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      const result = await diffViewProvider.saveDirectly(
        "test.ts",
        "const x={a:1}",
        true,
        true,
        2000,
      );

      // Verify file was written
      const fs = await import("fs/promises");
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${mockCwd}/test.ts`,
        "const x = { a: 1 };\n",
        "utf-8",
      );

      // Verify file was opened without focus
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: `${mockCwd}/test.ts` }),
        { preview: false, preserveFocus: true },
      );

      expect(mockDelay).toHaveBeenCalledTimes(3);
      expect(
        mockDelay.mock.calls.reduce(
          (total, [duration]) => total + Number(duration ?? 0),
          0,
        ),
      ).toBe(150);
      expect(vscode.languages.getDiagnostics).toHaveBeenCalled();

      // Verify result
      expect(result.newProblemsMessage).toBe("");
      expect(result.userEdits).toBeUndefined();
      expect(result.finalContent).toBe("const x = { a: 1 };\n");
    });

    it("should not open file when openWithoutFocus is false", async () => {
      await diffViewProvider.saveDirectly(
        "test.ts",
        "const x={a:1}",
        false,
        true,
        1000,
      );

      // Verify file was written
      const fs = await import("fs/promises");
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${mockCwd}/test.ts`,
        "const x = { a: 1 };\n",
        "utf-8",
      );

      // Verify file was NOT opened
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it("should skip diagnostics when diagnosticsEnabled is false", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();
      vi.mocked(vscode.languages.getDiagnostics).mockClear();

      await diffViewProvider.saveDirectly(
        "test.ts",
        "const x={a:1}",
        true,
        false,
        1000,
      );

      // Verify file was written
      const fs = await import("fs/promises");
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${mockCwd}/test.ts`,
        "const x = { a: 1 };\n",
        "utf-8",
      );

      // Verify delay was NOT called
      expect(mockDelay).not.toHaveBeenCalled();
      // getDiagnostics is called once for pre-diagnostics, but not for post-diagnostics
      expect(vscode.languages.getDiagnostics).toHaveBeenCalledTimes(1);
    });

    it("should handle negative delay values", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      await diffViewProvider.saveDirectly(
        "test.ts",
        "new content",
        true,
        true,
        -500,
      );

      expect(mockDelay).not.toHaveBeenCalled();
    });

    it("should store results for formatFileWriteResponse", async () => {
      await diffViewProvider.saveDirectly(
        "test.ts",
        "new content",
        true,
        true,
        1000,
      );

      // Verify internal state was updated
      expect((diffViewProvider as any).newProblemsMessage).toBe("");
      expect((diffViewProvider as any).userEdits).toBeUndefined();
      expect((diffViewProvider as any).relPath).toBe("test.ts");
      expect((diffViewProvider as any).newContent).toBe("new content");
    });

    it("should skip formatting when content is already formatted", async () => {
      await diffViewProvider.saveDirectly(
        "test.ts",
        "const x = { a: 1 };\n",
        true,
        true,
        1000,
        true,
      );

      expect(mockFormatWithPrettier).not.toHaveBeenCalled();

      const fs = await import("fs/promises");
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${mockCwd}/test.ts`,
        "const x = { a: 1 };\n",
        "utf-8",
      );
    });
  });

  describe("saveChanges method with diagnostic settings", () => {
    const getTotalDelayedMs = () =>
      vi
        .mocked(delay)
        .mock.calls.reduce(
          (total, [duration]) => total + Number(duration ?? 0),
          0,
        );

    beforeEach(() => {
      // Setup common mocks for saveChanges tests
      (diffViewProvider as any).relPath = "test.ts";
      (diffViewProvider as any).newContent = "new content";
      (diffViewProvider as any).activeDiffEditor = {
        document: {
          getText: vi.fn().mockReturnValue("new content"),
          isDirty: false,
          save: vi.fn().mockResolvedValue(undefined),
        },
      };
      (diffViewProvider as any).preDiagnostics = [];

      // Mock vscode functions
      vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as any);
      vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([]);
    });

    it("should apply diagnostic delay when diagnosticsEnabled is true", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      // Mock closeAllDiffViews
      (diffViewProvider as any).closeAllDiffViews = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await diffViewProvider.saveChanges(true, 3000);

      expect(mockDelay).toHaveBeenCalledTimes(3);
      expect(getTotalDelayedMs()).toBe(150);
      expect(vscode.languages.getDiagnostics).toHaveBeenCalled();
      expect(result.newProblemsMessage).toBe("");
    });

    it("should skip diagnostics when diagnosticsEnabled is false", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      // Mock closeAllDiffViews
      (diffViewProvider as any).closeAllDiffViews = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await diffViewProvider.saveChanges(false, 2000);

      // Verify delay was NOT called and diagnostics were NOT checked
      expect(mockDelay).not.toHaveBeenCalled();
      expect(vscode.languages.getDiagnostics).not.toHaveBeenCalled();
      expect(result.newProblemsMessage).toBe("");
    });

    it("should use default values when no parameters provided", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      // Mock closeAllDiffViews
      (diffViewProvider as any).closeAllDiffViews = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await diffViewProvider.saveChanges();

      expect(mockDelay).toHaveBeenCalledTimes(2);
      expect(getTotalDelayedMs()).toBe(100);
      expect(vscode.languages.getDiagnostics).toHaveBeenCalled();
      expect(result.newProblemsMessage).toBe("");
    });

    it("should handle custom delay values", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();

      // Mock closeAllDiffViews
      (diffViewProvider as any).closeAllDiffViews = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await diffViewProvider.saveChanges(true, 5000);

      expect(mockDelay).toHaveBeenCalledTimes(3);
      expect(getTotalDelayedMs()).toBe(150);
      expect(vscode.languages.getDiagnostics).toHaveBeenCalled();
    });

    it("should skip reformatting unchanged preformatted content on save", async () => {
      const mockDelay = vi.mocked(delay);
      mockDelay.mockClear();
      (diffViewProvider as any).closeAllDiffViews = vi
        .fn()
        .mockResolvedValue(undefined);
      (diffViewProvider as any).newContent = "const x = { a: 1 };\n";
      (diffViewProvider as any).activeDiffEditor.document.getText = vi
        .fn()
        .mockReturnValue("const x = { a: 1 };\n");

      await diffViewProvider.saveChanges(true, 1000, true);

      expect(mockFormatWithPrettier).not.toHaveBeenCalled();
      expect(mockDelay).toHaveBeenCalledTimes(3);
      expect(getTotalDelayedMs()).toBe(150);
    });
  });
});
