import { EventEmitter } from "events";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  ThemeIcon: class ThemeIcon {
    constructor(public id: string) {}
  },
  window: {
    createTerminal: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
    }),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
}));

import type { Task } from "../../task/Task";
import {
  executeCommandInTerminal,
  sendStdinToTerminal,
} from "../ExecuteCommandTool";
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry";
import { mergePromise } from "../../../integrations/terminal/mergePromise";
import type {
  RooTerminal,
  RooTerminalCallbacks,
  RooTerminalProcess,
  RooTerminalProcessResultPromise,
} from "../../../integrations/terminal/types";

function createPendingProcess(): RooTerminalProcessResultPromise {
  const process = Object.assign(new EventEmitter(), {
    command: "npm run dev",
    isHot: true,
    wasAborted: false,
    run: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn(),
    abort: vi.fn(function (this: { wasAborted: boolean }) {
      this.wasAborted = true;
    }),
    hasUnretrievedOutput: vi.fn().mockReturnValue(false),
    getUnretrievedOutput: vi.fn().mockReturnValue(""),
  }) as unknown as RooTerminalProcess;

  return mergePromise(process, new Promise<void>(() => {}));
}

describe("executeCommandInTerminal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns after user cancellation even when the terminal process never settles", async () => {
    const provider = {
      postMessageToWebview: vi.fn(),
    };

    const fakeProcess = createPendingProcess();
    const runCommand: RooTerminal["runCommand"] = vi.fn(
      (
        _command: string,
        callbacks: RooTerminalCallbacks,
      ): RooTerminalProcessResultPromise => {
        queueMicrotask(() => {
          void callbacks.onLine("Local: http://localhost:3000\n", fakeProcess);
        });

        return fakeProcess;
      },
    );
    const fakeTerminal: RooTerminal = {
      provider: "execa",
      id: 1,
      busy: false,
      running: true,
      taskId: undefined,
      process: fakeProcess,
      getCurrentWorkingDirectory: vi.fn().mockReturnValue("/workspace"),
      isClosed: vi.fn().mockReturnValue(false),
      runCommand,
      setActiveStream: vi.fn(),
      shellExecutionComplete: vi.fn(),
      getProcessesWithOutput: vi.fn().mockReturnValue([]),
      getUnretrievedOutput: vi.fn().mockReturnValue(""),
      getLastCommand: vi.fn().mockReturnValue("npm run dev"),
      cleanCompletedProcessQueue: vi.fn(),
    };

    vi.spyOn(TerminalRegistry, "getOrCreateTerminal").mockResolvedValue(
      fakeTerminal,
    );

    const task = {
      cwd: "/Users/imacpro/Documents/kilomain",
      taskId: "task-1",
      providerRef: new WeakRef(provider),
      terminalProcess: undefined,
      didToolFailInCurrentTurn: false,
      ask: vi.fn(async () => {
        task.terminalProcess?.abort();
        return {
          response: "noButtonClicked",
          text: undefined,
          images: undefined,
        };
      }),
      say: vi.fn(),
    } as unknown as Task;

    await expect(
      executeCommandInTerminal(task, {
        executionId: "exec-1",
        command: "npm run dev",
        terminalShellIntegrationDisabled: true,
      }),
    ).resolves.toEqual([
      false,
      expect.stringContaining("cancelled by the user"),
    ]);

    expect(fakeProcess.abort).toHaveBeenCalled();
    expect(task.terminalProcess).toBeUndefined();
  });

  it("sends stdin to the selected AI terminal target", async () => {
    const provider = {
      getState: vi.fn().mockResolvedValue({}),
      postMessageToWebview: vi.fn(),
    };

    const fakeProcess = Object.assign(new EventEmitter(), {
      command: "python app.py",
      isHot: true,
      wasAborted: false,
      run: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      continue: vi.fn(),
      abort: vi.fn(),
      hasUnretrievedOutput: vi.fn().mockReturnValue(true),
      getUnretrievedOutput: vi.fn().mockReturnValue("Name accepted\n"),
    }) as unknown as RooTerminalProcess;

    vi.spyOn(TerminalRegistry, "getProcessByExecutionId").mockReturnValue(
      fakeProcess,
    );

    const task = {
      providerRef: new WeakRef(provider),
      getAiTerminalStdinTarget: vi
        .fn()
        .mockReturnValue({ executionId: "exec-stdin" }),
      clearAiTerminalStdinTarget: vi.fn(),
    } as unknown as Task;

    await expect(
      sendStdinToTerminal(task, {
        stdin: "alice",
      }),
    ).resolves.toContain("Name accepted");

    expect(fakeProcess.write).toHaveBeenCalledWith("alice\n");
    expect(provider.postMessageToWebview).toHaveBeenCalledWith({
      type: "commandExecutionStatus",
      text: expect.stringContaining('"executionId":"exec-stdin"'),
    });
  });

  it("returns an explicit cancellation result when the process was aborted after streaming started", async () => {
    const provider = {
      postMessageToWebview: vi.fn(),
    };

    const fakeProcess = Object.assign(new EventEmitter(), {
      command: "cat",
      isHot: true,
      wasAborted: false,
      run: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      continue: vi.fn(),
      abort: vi.fn(function (this: { wasAborted: boolean }) {
        this.wasAborted = true;
      }),
      hasUnretrievedOutput: vi.fn().mockReturnValue(false),
      getUnretrievedOutput: vi.fn().mockReturnValue(""),
    }) as unknown as RooTerminalProcess;

    const processPromise = mergePromise(
      fakeProcess,
      new Promise<void>((resolve) => {
        queueMicrotask(() => {
          fakeProcess.abort();
          fakeProcess.emit("shell_execution_complete", {
            exitCode: 130,
            signal: 2,
            signalName: "SIGINT",
            coreDumpPossible: false,
          });
          fakeProcess.emit("completed", "");
          resolve();
        });
      }),
    );

    const fakeTerminal: RooTerminal = {
      provider: "execa",
      id: 1,
      busy: false,
      running: true,
      taskId: undefined,
      process: processPromise,
      getCurrentWorkingDirectory: vi.fn().mockReturnValue("/workspace"),
      isClosed: vi.fn().mockReturnValue(false),
      runCommand: vi.fn(() => processPromise),
      setActiveStream: vi.fn(),
      shellExecutionComplete: vi.fn(),
      getProcessesWithOutput: vi.fn().mockReturnValue([]),
      getUnretrievedOutput: vi.fn().mockReturnValue(""),
      getLastCommand: vi.fn().mockReturnValue("cat"),
      cleanCompletedProcessQueue: vi.fn(),
    };

    vi.spyOn(TerminalRegistry, "getOrCreateTerminal").mockResolvedValue(
      fakeTerminal,
    );

    const task = {
      cwd: "/Users/imacpro/Documents/kilomain",
      taskId: "task-2",
      providerRef: new WeakRef(provider),
      terminalProcess: undefined,
      didToolFailInCurrentTurn: false,
      ask: vi.fn(),
      say: vi.fn(),
      clearAiTerminalStdinTarget: vi.fn(),
    } as unknown as Task;

    await expect(
      executeCommandInTerminal(task, {
        executionId: "exec-2",
        command: "cat",
        terminalShellIntegrationDisabled: true,
      }),
    ).resolves.toEqual([
      false,
      "The command was cancelled by the user.",
    ]);
  });
});
