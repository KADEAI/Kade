import fs from "fs/promises";
import os from "os";
import path from "path";

import { describe, expect, it, vi } from "vitest";

import {
  formatEditHistoryPlaceholderBody,
  HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
  isEditHistoryPlaceholder,
} from "../../prompts/responses";
import { EditTool } from "../../tools/EditTool";
import { UnifiedToolCallParser } from "../UnifiedToolCallParser";

function finalizeParse(message: string) {
  const parser = new UnifiedToolCallParser();
  parser.processChunk(message);
  parser.finalizeContentBlocks();
  return parser.getContentBlocks();
}

function finalizeStreamParse(message: string, chunkSizes: number[]) {
  const parser = new UnifiedToolCallParser();
  let offset = 0;
  let chunkIndex = 0;

  while (offset < message.length) {
    const size = chunkSizes[chunkIndex % chunkSizes.length];
    parser.processChunk(message.slice(offset, offset + size));
    offset += size;
    chunkIndex++;
  }

  parser.finalizeContentBlocks();
  return parser.getContentBlocks();
}

function toolUses(blocks: any[]) {
  return blocks.filter((block) => block.type === "tool_use") as any[];
}

function editTools(blocks: any[]) {
  return toolUses(blocks).filter((block) => block.name === "edit") as any[];
}

function createEditTask(cwd: string, relPath: string) {
  let latestContent = "";

  return {
    cwd,
    consecutiveMistakeCount: 0,
    didToolFailInCurrentTurn: false,
    didEditFile: false,
    lastEditBlocks: [],
    recordToolError: vi.fn(),
    recordToolUsage: vi.fn(),
    processQueuedMessages: vi.fn(),
    say: vi.fn().mockResolvedValue(undefined),
    rooIgnoreController: {
      validateAccess: vi.fn().mockReturnValue(true),
    },
    rooProtectedController: {
      isWriteProtected: vi.fn().mockReturnValue(false),
    },
    providerRef: {
      deref: () => ({
        getState: async () => ({
          diagnosticsEnabled: false,
          writeDelayMs: 0,
          experiments: {},
        }),
      }),
    },
    diffViewProvider: {
      editType: "",
      originalContent: "",
      newProblemsMessage: "",
      open: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockImplementation(async (content: string) => {
        latestContent = content;
      }),
      scrollToFirstDiff: vi.fn(),
      revertChanges: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      saveChanges: vi.fn().mockImplementation(async () => {
        await fs.writeFile(path.join(cwd, relPath), latestContent, "utf8");
      }),
      saveDirectly: vi.fn().mockImplementation(async (targetPath: string, content: string) => {
        await fs.writeFile(path.resolve(cwd, targetPath), content, "utf8");
      }),
    },
    fileContextTracker: {
      trackFileContext: vi.fn().mockResolvedValue(undefined),
    },
    luxurySpa: {
      fileEditCounts: new Map(),
      fileEditBlockCounts: new Map(),
      recordRecentEditBlocks: vi.fn(),
    },
    clineMessages: [],
    saveClineMessages: vi.fn().mockResolvedValue(undefined),
    updateClineMessage: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createWackyMultiBlockFixture() {
  const originalLines = [
    "export const alpha = 1;",
    "export const beta = 2;",
    "function wobble() {",
    '  return "old wobble";',
    "}",
    "const banner = [",
    '  "line one",',
    '  "line two",',
    '].join(" ");',
    "const config = {",
    '  mode: "old",',
    "  enabled: false,",
    "};",
    'console.log("tail");',
  ];

  const expectedLines = [
    "export const alpha = 11;",
    "export const beta = 22;",
    "function wobble() {",
    "  const lines = [",
    '    "new wobble",',
    '    "  // @bash: not a real tool boundary",',
    "  ];",
    '  return lines.join("\\n");',
    "}",
    "const banner = [",
    '  "line one",',
    '  "line two",',
    '  "line three",',
    '  "  @edit: still content, not a top-level tool",',
    '].join(" | ");',
    "const config = {",
    '  mode: "new",',
    "  enabled: true,",
    "  nested: { weird: true, count: 3 },",
    "};",
    'console.log("tail but louder");',
  ];

  const message = [
    '@edit: "sample.txt"',
    "oldText 1-2:",
    "export const alpha = 1;",
    "export const beta = 2;",
    "newText:",
    "export const alpha = 11;",
    "export const beta = 22;",
    "",
    "oldText 3-5:",
    "function wobble() {",
    '  return "old wobble";',
    "}",
    "newText:",
    "function wobble() {",
    "  const lines = [",
    '    "new wobble",',
    '    "  // @bash: not a real tool boundary",',
    "  ];",
    '  return lines.join("\\n");',
    "}",
    "",
    "oldText 6-9:",
    "const banner = [",
    '  "line one",',
    '  "line two",',
    '].join(" ");',
    "newText:",
    "const banner = [",
    '  "line one",',
    '  "line two",',
    '  "line three",',
    '  "  @edit: still content, not a top-level tool",',
    '].join(" | ");',
    "",
    "oldText 10-13:",
    "const config = {",
    '  mode: "old",',
    "  enabled: false,",
    "};",
    "newText:",
    "const config = {",
    '  mode: "new",',
    "  enabled: true,",
    "  nested: { weird: true, count: 3 },",
    "};",
    "",
    "oldText 14-14:",
    'console.log("tail");',
    "newText:",
    'console.log("tail but louder");',
  ].join("\n");

  return {
    message,
    originalContent: `${originalLines.join("\n")}\n`,
    expectedContent: `${expectedLines.join("\n")}\n`,
  };
}

describe("UnifiedToolCallParser — unified @edit schema mega spec", () => {
  it("parses the canonical @edit oldText/newText form at end of message", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText 1-1:",
          "print('hello')",
          "newText:",
          "print('goodbye')",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
      },
      nativeArgs: {
        edits: [
          {
            oldText: "print('hello')",
            newText: "print('goodbye')",
            start_line: 1,
            end_line: 1,
          },
        ],
      },
    });
  });

  it("parses the prompt's oldText:2-5: variant", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText:2-5:",
          "Pizza",
          "Pineapples",
          "newText:",
          "strawberries",
          "Bananas",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: ["Pizza", "Pineapples"].join("\n"),
        newText: ["strawberries", "Bananas"].join("\n"),
        start_line: 2,
        end_line: 5,
      },
    ]);
  });

  it("parses inline oldText/newText headers inside an @edit block", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText 12-18: const x = 1;",
          "This is a sample edit",
          "Blah blah blah",
          "newText: blah blah blah",
          "New content what about this?",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: ["const x = 1;", "This is a sample edit", "Blah blah blah"].join(
          "\n",
        ),
        newText: ["blah blah blah", "New content what about this?"].join("\n"),
        start_line: 12,
        end_line: 18,
      },
    ]);
  });

  it("parses oldtxt/newtxt and otxt/ntxt aliases inside an @edit block", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldtxt 7-8: alpha",
          "beta",
          "newtxt: gamma",
          "delta",
          "otxt: left",
          "ntxt: right",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: ["alpha", "beta"].join("\n"),
        newText: ["gamma", "delta"].join("\n"),
        start_line: 7,
        end_line: 8,
      },
      {
        oldText: "left",
        newText: "right",
      },
    ]);
  });

  it("parses bracketed OTXT ranges inside an @edit block", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "OTXT[12-18]: const x = 1;",
          "This is a sample edit",
          "NTXT: blah blah blah",
          "New content what about this?",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: ["const x = 1;", "This is a sample edit"].join("\n"),
        newText: ["blah blah blah", "New content what about this?"].join("\n"),
        start_line: 12,
        end_line: 18,
      },
    ]);
  });

  it("parses multiple oldText/newText pairs in one @edit block", () => {
    const tools = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText 1-1:",
          "alpha",
          "newText:",
          "beta",
          "",
          "oldText 4-4:",
          "gamma",
          "newText:",
          "delta",
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: "alpha",
        newText: "beta",
        start_line: 1,
        end_line: 1,
      },
      {
        oldText: "gamma",
        newText: "delta",
        start_line: 4,
        end_line: 4,
      },
    ]);
  });

  it("parses a huge wacky multiblock @edit body without splitting on fake tool-looking lines", () => {
    const fixture = createWackyMultiBlockFixture();
    const tools = editTools(finalizeParse(fixture.message));

    expect(tools).toHaveLength(1);
    expect(tools[0].params.path).toBe("sample.txt");
    expect(tools[0].nativeArgs.edits).toHaveLength(5);
    expect(tools[0].nativeArgs.edits[1]).toMatchObject({
      start_line: 3,
      end_line: 5,
      oldText: ['function wobble() {', '  return "old wobble";', "}"].join("\n"),
    });
    expect(tools[0].nativeArgs.edits[1].newText).toContain(
      '  // @bash: not a real tool boundary',
    );
    expect(tools[0].nativeArgs.edits[2].newText).toContain(
      "  @edit: still content, not a top-level tool",
    );
  });

  it("closes the edit block at the next top-level tool line", () => {
    const tools = toolUses(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText 1-1:",
          "alpha",
          "newText:",
          "beta",
          '@bash: "npm test"',
        ].join("\n"),
      ),
    );

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("edit");
    expect(tools[0].nativeArgs.edits).toEqual([
      {
        oldText: "alpha",
        newText: "beta",
        start_line: 1,
        end_line: 1,
      },
    ]);
    expect(tools[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
      },
    });
  });

  it("survives hostile chunk boundaries around @edit headers and the next top-level tool", () => {
    const tools = toolUses(
      finalizeStreamParse(
        [
          '@edit: "sample.txt"',
          "oldText 12-16:",
          "alpha",
          "newText:",
          "beta",
          '@bash: "npm test"',
        ].join("\n"),
        [1, 2, 5, 3, 1, 4, 2],
      ),
    );

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
      },
      nativeArgs: {
        edits: [
          {
            oldText: "alpha",
            newText: "beta",
            start_line: 12,
            end_line: 16,
          },
        ],
      },
    });
    expect(tools[1].name).toBe("bash");
  });

  it("streams a huge wacky multiblock @edit and still closes exactly once at the next top-level tool", () => {
    const fixture = createWackyMultiBlockFixture();
    const tools = toolUses(
      finalizeStreamParse([fixture.message, '@bash: "npm test"'].join("\n"), [1, 7, 2, 9, 3, 11, 4]),
    );

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("edit");
    expect(tools[0].partial).toBe(false);
    expect(tools[0].nativeArgs.edits).toHaveLength(5);
    expect(tools[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: { command: "npm test" },
    });
  });

  it("drops a finalized @edit block with no body", () => {
    const tools = toolUses(finalizeParse('@edit: "sample.txt"'));

    expect(tools).toHaveLength(0);
  });

  it("keeps redacted history placeholders non-executable when they appear in an @edit body", () => {
    const tools = editTools(
      finalizeParse(['@edit: "sample.txt"', formatEditHistoryPlaceholderBody()].join("\n")),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].params.path).toBe("sample.txt");
    expect(tools[0].nativeArgs.edits ?? []).toHaveLength(0);
    expect(tools[0].params.edit).toBeDefined();
    expect(isEditHistoryPlaceholder(tools[0].params.edit)).toBe(true);
  });

  it("rejects a naked shared placeholder line as an unusable @edit body", () => {
    const tools = editTools(
      finalizeParse(['@edit: "sample.txt"', HISTORY_CONTENT_PLACEMENT_PLACEHOLDER].join("\n")),
    );

    expect(tools).toHaveLength(1);
    expect(tools[0].params.path).toBe("sample.txt");
    expect(tools[0].nativeArgs.edits ?? []).toHaveLength(0);
    expect(tools[0].params.edit).toBeUndefined();
  });

  it("applies a parsed @edit block through the real EditTool", async () => {
    const parsedTool = editTools(
      finalizeParse(
        [
          '@edit: "sample.txt"',
          "oldText 1-1:",
          "print('hello')",
          "newText:",
          "print('goodbye')",
        ].join("\n"),
      ),
    )[0];

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "print('hello')\n", "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(parsedTool.nativeArgs, task, {
        askApproval: vi.fn().mockResolvedValue(true),
        handleError: vi.fn(),
        pushToolResult,
        removeClosingTag: vi.fn(),
        toolProtocol: "unified" as any,
        toolCallId: "edit-tool-success",
      });

      expect((await fs.readFile(filePath, "utf8")).trimEnd()).toBe("print('goodbye')");
      expect(task.recordToolError).not.toHaveBeenCalled();
      expect(task.didEditFile).toBe(true);
      expect(pushToolResult).toHaveBeenCalled();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies raw oldtxt/newtxt edit bodies through the real EditTool", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "Line 1\nLine 2\nLine 3\n", "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(
        {
          path: "sample.txt",
          edit: ["oldtxt[1-3]: Line 1", "Line 2", "Line 3", "newtxt: Edited Line 1", "Edited Line 2", "Edited Line 3"].join("\n"),
        },
        task,
        {
          askApproval: vi.fn().mockResolvedValue(true),
          handleError: vi.fn(),
          pushToolResult,
          removeClosingTag: vi.fn(),
          toolProtocol: "unified" as any,
          toolCallId: "edit-tool-oldtxt-raw",
        },
      );

      expect(await fs.readFile(filePath, "utf8")).toBe(
        "Edited Line 1\nEdited Line 2\nEdited Line 3\n",
      );
      expect(task.recordToolError).not.toHaveBeenCalled();
      expect(task.didEditFile).toBe(true);
      expect(pushToolResult).toHaveBeenCalled();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies raw compact arrow edit strings through the real EditTool", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "Line 1\nLine 2\nLine 3\n", "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(
        {
          path: "sample.txt",
          edit: '1-2|Line 1\\nLine 2→Edited Line 1\\nEdited Line 2',
        },
        task,
        {
          askApproval: vi.fn().mockResolvedValue(true),
          handleError: vi.fn(),
          pushToolResult,
          removeClosingTag: vi.fn(),
          toolProtocol: "unified" as any,
          toolCallId: "edit-tool-compact-arrow-raw",
        },
      );

      expect(await fs.readFile(filePath, "utf8")).toBe(
        "Edited Line 1\nEdited Line 2\nLine 3\n",
      );
      expect(task.recordToolError).not.toHaveBeenCalled();
      expect(task.didEditFile).toBe(true);
      expect(pushToolResult).toHaveBeenCalled();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies raw multiline quoted compact edit blocks through the real EditTool", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "Line 1\nLine 2\narrow → here\n", "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(
        {
          path: "sample.txt",
          edit: ['"1|Line 1→Edited Line 1"', '"3|arrow \\→ here→arrow done \\→ here"'].join("\n"),
        },
        task,
        {
          askApproval: vi.fn().mockResolvedValue(true),
          handleError: vi.fn(),
          pushToolResult,
          removeClosingTag: vi.fn(),
          toolProtocol: "unified" as any,
          toolCallId: "edit-tool-compact-quoted-raw",
        },
      );

      expect(await fs.readFile(filePath, "utf8")).toBe(
        "Edited Line 1\nLine 2\narrow done → here\n",
      );
      expect(task.recordToolError).not.toHaveBeenCalled();
      expect(task.didEditFile).toBe(true);
      expect(pushToolResult).toHaveBeenCalled();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies the huge wacky multiblock @edit through the real EditTool", async () => {
    const fixture = createWackyMultiBlockFixture();
    const parsedTool = editTools(finalizeParse(fixture.message))[0];

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, fixture.originalContent, "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(parsedTool.nativeArgs, task, {
        askApproval: vi.fn().mockResolvedValue(true),
        handleError: vi.fn(),
        pushToolResult,
        removeClosingTag: vi.fn(),
        toolProtocol: "unified" as any,
        toolCallId: "edit-tool-wacky-multiblock",
      });

      expect(await fs.readFile(filePath, "utf8")).toBe(fixture.expectedContent);
      expect(task.recordToolError).not.toHaveBeenCalled();
      expect(task.didEditFile).toBe(true);
      expect(pushToolResult).toHaveBeenCalled();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("feeds the naked placeholder case into EditTool without touching the file", async () => {
    const parsedTool = editTools(
      finalizeParse(['@edit: "sample.txt"', HISTORY_CONTENT_PLACEMENT_PLACEHOLDER].join("\n")),
    )[0];

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilomain-edit-tool-"));
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "print('hello')\n", "utf8");

    const task = createEditTask(cwd, "sample.txt");
    const pushToolResult = vi.fn();

    try {
      await new EditTool().execute(parsedTool.nativeArgs, task, {
        askApproval: vi.fn().mockResolvedValue(true),
        handleError: vi.fn(),
        pushToolResult,
        removeClosingTag: vi.fn(),
        toolProtocol: "unified" as any,
        toolCallId: "edit-tool-placeholder",
      });

      expect((await fs.readFile(filePath, "utf8"))).toBe("print('hello')\n");
      expect(task.recordToolError).toHaveBeenCalledWith("edit");
      expect(task.consecutiveMistakeCount).toBe(1);
      expect(pushToolResult.mock.calls[0][0]).toContain(
        'Edit payload was empty or unusable for sample.txt.',
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
