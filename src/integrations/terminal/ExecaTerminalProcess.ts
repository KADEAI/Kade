import { execa, ExecaError } from "execa";
import psList from "ps-list";
import process from "process";

import type { RooTerminal } from "./types";
import { BaseTerminalProcess } from "./BaseTerminalProcess";

// kade_change start
/**
 * Get all descendant process IDs for a given parent PID.
 */
async function getDescendantPids(parentPid: number): Promise<number[]> {
  try {
    const processes = await psList();
    const descendants: number[] = [];
    const queue = [parentPid];

    while (queue.length > 0) {
      const currentPid = queue.shift();

      if (currentPid === undefined) {
        continue;
      }

      const childPids = processes
        .filter((p) => p.ppid === currentPid)
        .map((p) => p.pid);

      for (const pid of childPids) {
        if (!descendants.includes(pid)) {
          descendants.push(pid);
          queue.push(pid);
        }
      }
    }

    return descendants;
  } catch (error) {
    console.error(
      `Failed to get descendant processes for PID ${parentPid}:`,
      error,
    );
    return [];
  }
}
// kade_change end

export class ExecaTerminalProcess extends BaseTerminalProcess {
  private static readonly lineEmitThrottleMs = 500;

  private terminalRef: WeakRef<RooTerminal>;
  private aborted = false;
  private shellPid?: number;
  private pid?: number;
  private subprocess?: ReturnType<typeof execa>;
  private pidUpdatePromise?: Promise<void>;
  private pendingEmitTimeout?: NodeJS.Timeout;

  constructor(terminal: RooTerminal) {
    super();

    this.terminalRef = new WeakRef(terminal);

    this.once("completed", () => {
      this.terminal.busy = false;
    });
  }

  public get terminal(): RooTerminal {
    const terminal = this.terminalRef.deref();

    if (!terminal) {
      throw new Error("Unable to dereference terminal");
    }

    return terminal;
  }

  public override async run(command: string) {
    this.command = command;

    try {
      this.isHot = true;

      this.subprocess = execa({
        shell: true,
        cwd: this.terminal.getCurrentWorkingDirectory(),
        all: true,
        stdin: "pipe",
        env: {
          ...process.env,
          // Ensure UTF-8 encoding for Ruby, CocoaPods, etc.
          LANG: "en_US.UTF-8",
          LC_ALL: "en_US.UTF-8",
        },
      })`${command}`;

      this.shellPid = this.subprocess.pid;
      this.pid = this.subprocess.pid;

      // When using shell: true, the PID is for the shell, not the actual command
      // Find the actual command PID after a small delay
      if (this.shellPid) {
        this.pidUpdatePromise = new Promise<void>((resolve) => {
          // kade_change start
          setTimeout(async () => {
            try {
              const descendantPids = await getDescendantPids(this.shellPid!);
              if (descendantPids.length > 0) {
                // Prefer the first descendant for logging and status, but keep the shell PID
                // so abort can terminate the entire process tree.
                this.pid = descendantPids[0];
              }
            } catch (error) {
              console.error(`Failed to update PID:`, error);
            }
            resolve();
          }, 100);
          // kade_change end
        });
      }

      const rawStream = this.subprocess.iterable({
        from: "all",
        preserveNewlines: true,
      });

      // Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
      const stream = (async function* () {
        for await (const chunk of rawStream) {
          yield typeof chunk === "string"
            ? chunk
            : new TextDecoder().decode(chunk);
        }
      })();

      this.terminal.setActiveStream(stream, this.pid);
      console.info(
        `[ExecaTerminalProcess#run] stream started, entering for-await loop`,
      );

      for await (const line of stream) {
        if (this.aborted) {
          break;
        }

        this.fullOutput += line;

        const now = Date.now();

        if (
          this.isListening &&
          (now - this.lastEmitTime_ms >
            ExecaTerminalProcess.lineEmitThrottleMs ||
            this.lastEmitTime_ms === 0)
        ) {
          this.emitRemainingBufferIfListening();
          this.lastEmitTime_ms = now;
          this.clearPendingEmitTimeout();
        } else {
          this.scheduleBufferedEmit();
        }

        this.startHotTimer(line);
      }

      console.info(
        `[ExecaTerminalProcess#run] for-await loop ended, aborted=${this.aborted}`,
      );

      if (this.aborted) {
        try {
          await Promise.race([
            this.subprocess,
            new Promise<void>((resolve) => {
              setTimeout(resolve, 1_000);
            }),
          ]);
        } catch (error) {
          console.log(
            `[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.emit(
        "shell_execution_complete",
        this.aborted
          ? {
              exitCode: 130,
              signal: 2,
              signalName: "SIGINT",
              coreDumpPossible: false,
            }
          : { exitCode: 0 },
      );
    } catch (error) {
      if (error instanceof ExecaError) {
        console.error(
          `[ExecaTerminalProcess#run] shell execution error: ${error.message}`,
        );
        this.emit("shell_execution_complete", {
          exitCode: error.exitCode ?? 0,
          signalName: error.signal,
        });
      } else {
        console.error(
          `[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
        );

        this.emit("shell_execution_complete", { exitCode: 1 });
      }
      this.subprocess = undefined;
    }

    this.terminal.setActiveStream(undefined);
    this.clearPendingEmitTimeout();
    this.emitRemainingBufferIfListening();
    this.stopHotTimer();
    console.info(
      `[ExecaTerminalProcess#run] emitting completed + continue, output length=${this.fullOutput.length}`,
    );
    this.emit("completed", this.fullOutput);
    this.emit("continue");
    this.subprocess = undefined;
  }

  public override async write(data: string) {
    if (!data || !this.subprocess?.stdin) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.subprocess?.stdin?.write(data, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  public override continue() {
    this.clearPendingEmitTimeout();
    this.isListening = false;
    this.removeAllListeners("line");
    this.emit("continue");
  }

  public override abort() {
    this.aborted = true;

    // Function to perform the kill operations
    const performKill = async () => {
      // Try to kill using the subprocess object
      if (this.subprocess) {
        try {
          this.subprocess.kill("SIGKILL");
        } catch (e) {
          console.warn(
            `[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      await this.killProcessTree();
    };

    // If PID update is in progress, wait for it before killing
    if (this.pidUpdatePromise) {
      this.pidUpdatePromise.then(performKill).catch(() => void performKill());
    } else {
      void performKill();
    }
  }

  public get wasAborted(): boolean {
    return this.aborted;
  }

  public override hasUnretrievedOutput() {
    return this.lastRetrievedIndex < this.fullOutput.length;
  }

  public override getUnretrievedOutput() {
    let output = this.fullOutput.slice(this.lastRetrievedIndex);
    const newlineIndex = output.lastIndexOf("\n");
    const carriageReturnIndex = output.lastIndexOf("\r");
    let index = Math.max(newlineIndex, carriageReturnIndex);

    if (index === -1) {
      if (output.length === 0) {
        return "";
      }

      // Long-running commands like dev servers often print status lines
      // without a trailing newline. Flush what we have so the UI can show
      // addresses and prompts while the process is still running.
      this.lastRetrievedIndex = this.fullOutput.length;
      return output;
    }

    index++;
    this.lastRetrievedIndex += index;

    // console.log(
    // 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
    // 	output.slice(0, index),
    // )

    return output.slice(0, index);
  }

  private emitRemainingBufferIfListening() {
    if (!this.isListening) {
      return;
    }

    const output = this.getUnretrievedOutput();

    if (output !== "") {
      this.emit("line", output);
    }
  }

  private scheduleBufferedEmit() {
    if (this.pendingEmitTimeout || !this.isListening) {
      return;
    }

    this.pendingEmitTimeout = setTimeout(() => {
      this.pendingEmitTimeout = undefined;

      if (!this.isListening) {
        return;
      }

      this.emitRemainingBufferIfListening();
      this.lastEmitTime_ms = Date.now();
    }, ExecaTerminalProcess.lineEmitThrottleMs);
  }

  private clearPendingEmitTimeout() {
    if (this.pendingEmitTimeout) {
      clearTimeout(this.pendingEmitTimeout);
      this.pendingEmitTimeout = undefined;
    }
  }

  private async killProcessTree() {
    const rootPids = [
      ...new Set(
        [this.pid, this.shellPid].filter(
          (pid): pid is number => typeof pid === "number",
        ),
      ),
    ];

    if (rootPids.length === 0) {
      return;
    }

    try {
      const descendantPidGroups = await Promise.all(
        rootPids.map((pid) => getDescendantPids(pid)),
      );
      const descendantPids = [...new Set(descendantPidGroups.flat())];

      if (descendantPids.length > 0) {
        console.error(
          `[ExecaTerminalProcess#abort] SIGKILL descendants -> ${descendantPids.join(", ")}`,
        );
      }

      for (const pid of [...descendantPids].reverse()) {
        this.killPid(pid);
      }

      for (const pid of rootPids) {
        this.killPid(pid);
      }
    } catch (error) {
      console.error(
        `[ExecaTerminalProcess#abort] Failed to kill process tree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private killPid(pid: number) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return;
      }

      console.warn(
        `[ExecaTerminalProcess#abort] Failed to send SIGKILL to PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
