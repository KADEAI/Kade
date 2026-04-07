import { describe, expect, it, vi, beforeEach } from "vitest";
import { TOOL_PROTOCOL } from "@roo-code/types";

import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser";
import { batchTool } from "../BatchTool";

const {
  readHandle,
  listHandle,
  grepHandle,
  editHandle,
  writeHandle,
  webHandle,
  fetchHandle,
  bashHandle,
  agentHandle,
} = vi.hoisted(() => ({
  readHandle: vi.fn(),
  listHandle: vi.fn(),
  grepHandle: vi.fn(),
  editHandle: vi.fn(),
  writeHandle: vi.fn(),
  webHandle: vi.fn(),
  fetchHandle: vi.fn(),
  bashHandle: vi.fn(),
  agentHandle: vi.fn(),
}));

vi.mock("../ReadFileTool", () => ({
  readFileTool: {
    handle: readHandle,
  },
}));

vi.mock("../ListFilesTool", () => ({
  listDirTool: {
    handle: listHandle,
  },
}));

vi.mock("../SearchFilesTool", () => ({
  grepTool: {
    handle: grepHandle,
  },
}));

vi.mock("../EditTool", async () => {
  const actual = await vi.importActual<typeof import("../EditTool")>("../EditTool");
  return {
    ...actual,
    editTool: {
      handle: editHandle,
    },
  };
});

vi.mock("../WriteToFileTool", () => ({
  writeToFileTool: {
    handle: writeHandle,
  },
}));

vi.mock("../WebSearchTool", () => ({
  webSearchTool: {
    handle: webHandle,
  },
}));

vi.mock("../FetchTool", () => ({
  webFetchTool: {
    handle: fetchHandle,
  },
}));

vi.mock("../ExecuteCommandTool", () => ({
  executeCommandTool: {
    handle: bashHandle,
  },
}));

vi.mock("../CodebaseSearchTool", () => ({
  codebaseSearchTool: {
    handle: agentHandle,
  },
}));

vi.mock("../RunSubAgentTool", () => ({
  runSubAgentTool: {
    handle: agentHandle,
  },
}));

function createTask() {
  return {
    diffEnabled: false,
    didRejectTool: false,
    consecutiveMistakeCount: 0,
    recordToolUsage: vi.fn(),
    recordToolError: vi.fn(),
    getTaskMode: vi.fn().mockResolvedValue("code"),
    providerRef: {
      deref: () => ({
        getState: async () => ({
          customModes: [
            {
              slug: "code",
              name: "Code",
              roleDefinition: "Test",
              groups: ["read", "edit", "browser", "command", "mcp"] as const,
            },
          ],
          experiments: {},
        }),
      }),
    },
    api: {
      getModel: () => ({
        info: {},
      }),
    },
    sayAndCreateMissingParamError: vi.fn(async (_toolName, paramName) => `missing ${paramName}`),
  } as any;
}

const callbacks = {
  askApproval: vi.fn(),
  handleError: vi.fn(),
  removeClosingTag: vi.fn((_tag, text) => text || ""),
  toolProtocol: TOOL_PROTOCOL.JSON,
};

describe("router native batch tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes execute command arrays through batch using the actual parser + batch tool path", async () => {
    readHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("read ok"),
    );
    grepHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("grep ok"),
    );
    editHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("edit ok"),
    );
    writeHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("write ok"),
    );
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "execute_1",
      name: "execute" as any,
      arguments: JSON.stringify({
        commands: [
          "read src/app.ts:H20",
          'grep "workspace" src',
          "edit src/app.ts\noldText 10-12:\na\nnewText:\nb",
          "write notes.txt\nhello",
        ],
      }),
    }) as any;

    expect(parsed?.name).toBe("batch");
    expect(parsed?.originalName).toBe("execute");

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(readHandle).toHaveBeenCalledOnce();
    expect(grepHandle).toHaveBeenCalledOnce();
    expect(editHandle).toHaveBeenCalledOnce();
    expect(writeHandle).toHaveBeenCalledOnce();
    expect(pushToolResult.mock.calls[0][0]).toContain("[1] read");
    expect(pushToolResult.mock.calls[0][0]).toContain("[2] grep");
    expect(pushToolResult.mock.calls[0][0]).toContain("[3] edit");
    expect(pushToolResult.mock.calls[0][0]).toContain("[4] write");
  });

  it("executes tools router actions through batch using the actual parser + batch tool path", async () => {
    listHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("list ok"),
    );
    readHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("read ok"),
    );
    grepHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("grep ok"),
    );
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "tools_1",
      name: "tools" as any,
      arguments: JSON.stringify({
        tools: [
          { tool: "ls", path: ["src", "webview-ui"] },
          { tool: "read", path: ["src/app.ts:H20", "package.json"] },
          { tool: "grep", query: "workspace", path: ["src", "webview-ui/src"] },
        ],
      }),
    }) as any;

    expect(parsed?.name).toBe("batch");
    expect(parsed?.originalName).toBe("tools");

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(listHandle).toHaveBeenCalledOnce();
    expect(readHandle).toHaveBeenCalledOnce();
    expect(grepHandle).toHaveBeenCalledOnce();
    expect(listHandle.mock.calls[0][1].nativeArgs?.path).toEqual(["src", "webview-ui"]);
    expect(grepHandle.mock.calls[0][1].nativeArgs?.path).toEqual(["src", "webview-ui/src"]);
    expect(pushToolResult.mock.calls[0][0]).toContain("[1] list");
    expect(pushToolResult.mock.calls[0][0]).toContain("list ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[2] read");
    expect(pushToolResult.mock.calls[0][0]).toContain("read ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[3] grep");
    expect(pushToolResult.mock.calls[0][0]).toContain("grep ok");
  });

  it("executes content router actions through batch using the actual parser + batch tool path", async () => {
    editHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("edit ok"),
    );
    writeHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("write ok"),
    );
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "content_1",
      name: "content" as any,
      arguments: JSON.stringify({
        content: [
          {
            path: "src/app.ts",
            edit: [
              "oldText 10-12:\na\nnewText:\nb",
              "Search:\nconst c = 3;\nReplace:\nconst c = 4;",
            ],
          },
          { path: "notes.txt", write: "hello" },
        ],
      }),
    }) as any;

    expect(parsed?.name).toBe("batch");
    expect(parsed?.originalName).toBe("content");

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(editHandle).toHaveBeenCalledOnce();
    expect(writeHandle).toHaveBeenCalledOnce();
    expect(editHandle.mock.calls[0][1].nativeArgs).toEqual({
      path: "src/app.ts",
      edit: [
        { lineRange: "10-12", oldText: "a", newText: "b", start_line: 10, end_line: 12, range: undefined, type: undefined, replaceAll: undefined },
        { lineRange: undefined, oldText: "const c = 3;", newText: "const c = 4;", start_line: undefined, end_line: undefined, range: undefined, type: undefined, replaceAll: undefined },
      ],
    });
    expect(writeHandle.mock.calls[0][1].nativeArgs).toEqual({
      path: "notes.txt",
      content: "hello",
    });
    expect(pushToolResult.mock.calls[0][0]).toContain("[1] edit");
    expect(pushToolResult.mock.calls[0][0]).toContain("edit ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[2] write");
    expect(pushToolResult.mock.calls[0][0]).toContain("write ok");
  });

  it("surfaces execute command parse errors alongside valid child results", async () => {
    readHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("read ok"),
    );
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "execute_invalid_1",
      name: "execute" as any,
      arguments: JSON.stringify({
        commands: [
          "read src/app.ts:H20",
          "edit src/app.ts",
        ],
      }),
    }) as any;

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(readHandle).toHaveBeenCalledOnce();
    expect(pushToolResult.mock.calls[0][0]).toContain("[2] execute");
    expect(pushToolResult.mock.calls[0][0]).toContain("edit requires at least one oldText/newText block.");
    expect(pushToolResult.mock.calls[0][0]).toContain("Command: edit src/app.ts");
    expect(pushToolResult.mock.calls[0][0]).toContain("[1] read");
  });

  it("surfaces clear validation errors for malformed nested edit blocks", async () => {
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "content_invalid_edit_1",
      name: "content" as any,
      arguments: JSON.stringify({
        content: [
          {
            path: "src/app.ts",
            edit: [
              {
                lineRange: { start: 10, end: 12 },
                newText: "after",
              },
            ],
          },
        ],
      }),
    }) as any;

    expect(parsed?.name).toBe("batch");

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(pushToolResult.mock.calls[0][0]).toContain("[1] edit");
    expect(pushToolResult.mock.calls[0][0]).toContain('Invalid nested edit block 1: "oldText" is required.');
  });

  it("reports an empty content router call as a missing content payload instead of missing batch calls", async () => {
    const pushToolResult = vi.fn();
    const parsed = NativeToolCallParser.parseToolCall({
      id: "content_calls_alias_empty",
      name: "content" as any,
      arguments: JSON.stringify({
        calls: [],
      }),
    }) as any;

    await batchTool.handle(
      createTask(),
      parsed,
      {
        ...callbacks,
        pushToolResult,
      },
    );

    expect(pushToolResult).toHaveBeenCalledWith("missing content");
  });

  it("reports malformed content router items with an explicit validation error", async () => {
    const pushToolResult = vi.fn();
    const parsed = NativeToolCallParser.parseToolCall({
      id: "content_invalid_path_only",
      name: "content" as any,
      arguments: JSON.stringify({
        content: [{ path: "snake-game.html" }],
      }),
    }) as any;

    await batchTool.handle(
      createTask(),
      parsed,
      {
        ...callbacks,
        pushToolResult,
      },
    );

    expect(pushToolResult.mock.calls[0][0]).toContain(
      'Invalid content router item. Each item must specify "tool": "write" or "edit", or include a write/edit payload.',
    );
  });

  it("executes mixed tools router actions through batch using the actual parser + batch tool path", async () => {
    webHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("web ok"),
    );
    fetchHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("fetch ok"),
    );
    bashHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("bash ok"),
    );
    agentHandle.mockImplementation(async (_task, _block, cb) =>
      cb.pushToolResult("agent ok"),
    );
    const pushToolResult = vi.fn();

    const parsed = NativeToolCallParser.parseToolCall({
      id: "tools_2",
      name: "tools" as any,
      arguments: JSON.stringify({
        tools: [
          { tool: "web", query: "native tools" },
          { tool: "fetch", query: "https://example.com", include_links: true },
          { tool: "bash", query: "echo hi", path: "src" },
          {
            tool: "agent",
            query: "inspect parser",
            mode: "code",
            api_provider: "openai",
            model_id: "gpt-5",
          },
        ],
      }),
    }) as any;

    expect(parsed?.name).toBe("batch");
    expect(parsed?.originalName).toBe("tools");

    await batchTool.execute(parsed.nativeArgs, createTask(), {
      ...callbacks,
      pushToolResult,
    });

    expect(webHandle).toHaveBeenCalledOnce();
    expect(fetchHandle).toHaveBeenCalledOnce();
    expect(bashHandle).toHaveBeenCalledOnce();
    expect(agentHandle).toHaveBeenCalledOnce();
    expect(pushToolResult.mock.calls[0][0]).toContain("[1] web");
    expect(pushToolResult.mock.calls[0][0]).toContain("web ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[2] fetch");
    expect(pushToolResult.mock.calls[0][0]).toContain("fetch ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[3] bash");
    expect(pushToolResult.mock.calls[0][0]).toContain("bash ok");
    expect(pushToolResult.mock.calls[0][0]).toContain("[4] agent");
    expect(pushToolResult.mock.calls[0][0]).toContain("agent ok");
  });
});
