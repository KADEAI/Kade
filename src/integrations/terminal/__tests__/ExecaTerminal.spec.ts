// npx vitest run src/integrations/terminal/__tests__/ExecaTerminal.spec.ts

import { RooTerminalCallbacks } from "../types";
import { ExecaTerminal } from "../ExecaTerminal";

describe("ExecaTerminal", () => {
  it("should run terminal commands and collect output", async () => {
    // TODO: Run the equivalent test for Windows.
    if (process.platform === "win32") {
      return;
    }

    const terminal = new ExecaTerminal(1, "/tmp");
    let result: string | undefined;

    const callbacks: RooTerminalCallbacks = {
      onLine: vi.fn(),
      onCompleted: (output) => (result = output),
      onShellExecutionStarted: vi.fn(),
      onShellExecutionComplete: vi.fn(),
    };

    const subprocess = terminal.runCommand("ls -al", callbacks);
    await subprocess;

    expect(callbacks.onLine).toHaveBeenCalled();
    expect(callbacks.onShellExecutionStarted).toHaveBeenCalled();
    expect(callbacks.onShellExecutionComplete).toHaveBeenCalled();

    expect(result).toBeTypeOf("string");
    expect(result).toContain("total");
  });

  it("should forward stdin to interactive commands", async () => {
    if (process.platform === "win32") {
      return;
    }

    const terminal = new ExecaTerminal(2, "/tmp");
    let result = "";
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });

    const callbacks: RooTerminalCallbacks = {
      onLine: vi.fn(),
      onCompleted: (output) => {
        result = output ?? "";
      },
      onShellExecutionStarted: () => startedResolve?.(),
      onShellExecutionComplete: vi.fn(),
    };

    const command = `${JSON.stringify(process.execPath)} -e 'process.stdin.once("data", (data) => { process.stdout.write(String(data).toUpperCase()); process.exit(0); })'`;
    const subprocess = terminal.runCommand(command, callbacks);

    await started;
    await subprocess.write("hello stdin\n");
    await subprocess;

    expect(result).toContain("HELLO STDIN");
  });
});
