import fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import delay from "delay";

import {
  CommandExecutionStatus,
  DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
} from "@roo-code/types";
import { TelemetryService } from "@roo-code/telemetry";

import { Task } from "../task/Task";

import { ToolUse, ToolResponse } from "../../shared/tools";
import { formatResponse } from "../prompts/responses";
import { unescapeHtmlEntities } from "../../utils/text-normalization";
import {
  ExitCodeDetails,
  RooTerminalCallbacks,
  RooTerminalProcess,
} from "../../integrations/terminal/types";
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry";
import { Terminal } from "../../integrations/terminal/Terminal";
import { Package } from "../../shared/package";
import { t } from "../../i18n";
import { BaseTool, ToolCallbacks } from "./BaseTool";

class ShellIntegrationError extends Error {}

interface ExecuteCommandParams {
  command?: string;
  cwd?: string;
  stdin?: string;
  execution_id?: string;
}

export class ExecuteCommandTool extends BaseTool<"bash"> {
  readonly name = "bash" as const;

  parseLegacy(params: Partial<Record<string, string>>): ExecuteCommandParams {
    return {
      command: params.command || undefined,
      cwd: params.cwd,
      stdin: params.stdin || undefined,
      execution_id: params.execution_id || undefined,
    };
  }

  async execute(
    params: ExecuteCommandParams,
    task: Task,
    callbacks: ToolCallbacks,
  ): Promise<void> {
    const { command, cwd: customCwd, stdin, execution_id } = params;
    const {
      handleError,
      pushToolResult,
      askApproval,
      removeClosingTag,
      toolProtocol,
    } = callbacks;
    console.info(
      `[ExecuteCommandTool#execute] ENTERED with command="${command?.slice(0, 80)}", toolProtocol=${toolProtocol}`,
    );

    try {
      if (stdin !== undefined) {
        if (command) {
          pushToolResult(
            "Provide either 'command' or 'stdin' for bash, not both.",
          );
          return;
        }

        pushToolResult(
          await sendStdinToTerminal(task, {
            stdin,
            executionId: execution_id,
          }),
        );
        return;
      }

      if (!command) {
        task.consecutiveMistakeCount++;
        task.recordToolError("bash");
        pushToolResult(
          await task.sayAndCreateMissingParamError("bash", "command"),
        );
        return;
      }

      const ignoredFileAttemptedToAccess =
        task.rooIgnoreController?.validateCommand(command);

      if (ignoredFileAttemptedToAccess) {
        await task.say("rooignore_error", ignoredFileAttemptedToAccess);
        pushToolResult(
          formatResponse.rooIgnoreError(
            ignoredFileAttemptedToAccess,
            toolProtocol,
          ),
        );
        return;
      }

      task.consecutiveMistakeCount = 0;

      const unescapedCommand = unescapeHtmlEntities(command);
      const didApprove = await askApproval("command", unescapedCommand);

      if (!didApprove) {
        return;
      }

      const executionId =
        task.lastMessageTs?.toString() ?? Date.now().toString();
      const provider = await task.providerRef.deref();
      const providerState = await provider?.getState();

      const {
        terminalOutputLineLimit = 500,
        terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
        terminalShellIntegrationDisabled = true,
      } = providerState ?? {};

      // Get command execution timeout from VSCode configuration (in seconds)
      const commandExecutionTimeoutSeconds = vscode.workspace
        .getConfiguration(Package.name)
        .get<number>("commandExecutionTimeout", 0);

      // Get command timeout allowlist from VSCode configuration
      const commandTimeoutAllowlist = vscode.workspace
        .getConfiguration(Package.name)
        .get<string[]>("commandTimeoutAllowlist", []);

      // Check if command matches any prefix in the allowlist
      const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) =>
        unescapedCommand.startsWith(prefix.trim()),
      );

      // Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
      const commandExecutionTimeout = isCommandAllowlisted
        ? 0
        : commandExecutionTimeoutSeconds * 1000;

      const options: ExecuteCommandOptions = {
        executionId,
        command: unescapedCommand,
        customCwd,
        terminalShellIntegrationDisabled,
        terminalOutputLineLimit,
        terminalOutputCharacterLimit,
        commandExecutionTimeout,
        alwaysAllowExecute: providerState?.alwaysAllowExecute,
      };

      try {
        const [rejected, result] = await executeCommandInTerminal(
          task,
          options,
        );

        if (rejected) {
          task.didRejectTool = true;
        }

        pushToolResult(result);
      } catch (error: unknown) {
        const status: CommandExecutionStatus = {
          executionId,
          status: "fallback",
        };
        provider?.postMessageToWebview({
          type: "commandExecutionStatus",
          text: JSON.stringify(status),
        });
        await task.say("shell_integration_warning");

        if (error instanceof ShellIntegrationError) {
          const [rejected, result] = await executeCommandInTerminal(task, {
            ...options,
            terminalShellIntegrationDisabled: true,
          });

          if (rejected) {
            task.didRejectTool = true;
          }

          pushToolResult(result);
        } else {
          pushToolResult(
            `Command failed to execute in terminal due to a shell integration error.`,
          );
        }
      }

      return;
    } catch (error) {
      await handleError("executing command", error as Error);
      return;
    }
  }

  override async handlePartial(
    task: Task,
    block: ToolUse<"bash">,
  ): Promise<void> {
    const command = block.params.command;
    await task
      .say(
        "command",
        this.removeClosingTag("command", command, block.partial),
        undefined,
        block.partial,
      )
      .catch(() => {});
  }
}

export type ExecuteCommandOptions = {
  executionId: string;
  command: string;
  customCwd?: string;
  terminalShellIntegrationDisabled?: boolean;
  terminalOutputLineLimit?: number;
  terminalOutputCharacterLimit?: number;
  commandExecutionTimeout?: number;
  alwaysAllowExecute?: boolean;
};

export async function sendStdinToTerminal(
  task: Task,
  {
    stdin,
    executionId,
  }: {
    stdin: string;
    executionId?: string;
  },
): Promise<ToolResponse> {
  const provider = await task.providerRef.deref();
  const providerState = await provider?.getState();
  const {
    terminalOutputLineLimit = 500,
    terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
  } = providerState ?? {};

  const targetExecutionId =
    executionId || task.getAiTerminalStdinTarget().executionId;

  if (!targetExecutionId) {
    return "AI stdin mode is not active for any running terminal command.";
  }

  const process = TerminalRegistry.getProcessByExecutionId(targetExecutionId);
  if (!process) {
    task.clearAiTerminalStdinTarget(targetExecutionId);
    return "The selected terminal stdin target is no longer running.";
  }

  const payload = stdin.endsWith("\n") ? stdin : `${stdin}\n`;
  await process.write(payload);
  await delay(75);

  const latestOutput = Terminal.compressTerminalOutput(
    process.getUnretrievedOutput(),
    terminalOutputLineLimit,
    terminalOutputCharacterLimit,
  );

  if (latestOutput) {
    const status: CommandExecutionStatus = {
      executionId: targetExecutionId,
      status: "output",
      output: latestOutput,
    };
    provider?.postMessageToWebview({
      type: "commandExecutionStatus",
      text: JSON.stringify(status),
    });
  }

  return latestOutput
    ? `Sent stdin to the running terminal process.\nLatest output:\n${latestOutput}`
    : "Sent stdin to the running terminal process.";
}

export async function executeCommandInTerminal(
  task: Task,
  {
    executionId,
    command,
    customCwd,
    terminalShellIntegrationDisabled = true,
    terminalOutputLineLimit = 500,
    terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
    commandExecutionTimeout = 0,
    alwaysAllowExecute = false,
  }: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
  const formatCancelledCommandResult = (output: string): ToolResponse =>
    [
      "The command was cancelled by the user.",
      output.length > 0 ? `Here's the output so far:\n${output}\n` : "",
    ]
      .filter(Boolean)
      .join("\n");

  // Convert milliseconds back to seconds for display purposes.
  const commandExecutionTimeoutSeconds = commandExecutionTimeout / 1000;
  let workingDir: string;

  if (!customCwd) {
    workingDir = task.cwd;
  } else if (path.isAbsolute(customCwd)) {
    workingDir = customCwd;
  } else {
    workingDir = path.resolve(task.cwd, customCwd);
  }

  try {
    await fs.access(workingDir);
  } catch (error) {
    return [false, `Working directory '${workingDir}' does not exist.`];
  }

  let message: { text?: string; images?: string[] } | undefined;
  let runInBackground = false;
  let completed = false;
  let result: string = "";
  let exitDetails: ExitCodeDetails | undefined;
  let shellIntegrationError: string | undefined;
  let hasAskedForCommandOutput = false;
  let userCancelled = false;
  let processOutcome: "completed" | "cancelled" = "completed";
  let resolveUserCancelled: (() => void) | undefined;
  const userCancelledPromise = new Promise<void>((resolve) => {
    resolveUserCancelled = resolve;
  });
  const userCancelSettleTimeoutMs = 500;

  const terminalProvider = terminalShellIntegrationDisabled
    ? "execa"
    : "vscode";
  const provider = await task.providerRef.deref();

  let accumulatedOutput = "";
  const callbacks: RooTerminalCallbacks = {
    onLine: async (lines: string, process: RooTerminalProcess) => {
      accumulatedOutput += lines;
      const compressedOutput = Terminal.compressTerminalOutput(
        accumulatedOutput,
        terminalOutputLineLimit,
        terminalOutputCharacterLimit,
      );
      const status: CommandExecutionStatus = {
        executionId,
        status: "output",
        output: compressedOutput,
      };
      provider?.postMessageToWebview({
        type: "commandExecutionStatus",
        text: JSON.stringify(status),
      });

      // Only ask the user once if auto-approve is not enabled, but always continue streaming output
      if (
        !runInBackground &&
        !hasAskedForCommandOutput &&
        !alwaysAllowExecute
      ) {
        // Mark that we've asked to prevent multiple concurrent asks
        hasAskedForCommandOutput = true;

        try {
          const { response, text, images } = await task.ask(
            "command_output",
            "",
          );

          if (response === "noButtonClicked") {
            userCancelled = true;
            resolveUserCancelled?.();
            return;
          }

          runInBackground = true;

          if (response === "messageResponse") {
            message = { text, images };
            // Don't call process.continue() - it stops output streaming
            // unless AI stdin mode explicitly requested terminal takeover.
            if (task.consumeAiTerminalStdinPendingContinue(executionId)) {
              process.continue();
            }
            // Just let runInBackground = true handle it otherwise.
          }
        } catch (_error) {
          // Silently handle ask errors (e.g., "Current ask promise was ignored")
        }
      }
    },
    onCompleted: (output: string | undefined) => {
      result = Terminal.compressTerminalOutput(
        output ?? "",
        terminalOutputLineLimit,
        terminalOutputCharacterLimit,
      );

      completed = true;
    },
    onShellExecutionStarted: (pid: number | undefined) => {
      const status: CommandExecutionStatus = {
        executionId,
        status: "started",
        pid,
        command,
      };
      provider?.postMessageToWebview({
        type: "commandExecutionStatus",
        text: JSON.stringify(status),
      });
    },
    onShellExecutionComplete: (details: ExitCodeDetails) => {
      const status: CommandExecutionStatus = {
        executionId,
        status: "exited",
        exitCode: details.exitCode,
      };
      provider?.postMessageToWebview({
        type: "commandExecutionStatus",
        text: JSON.stringify(status),
      });
      exitDetails = details;
    },
  };

  if (terminalProvider === "vscode") {
    callbacks.onNoShellIntegration = async (error: string) => {
      TelemetryService.instance.captureShellIntegrationError(task.taskId);
      shellIntegrationError = error;
    };
  }

  const terminal = await TerminalRegistry.getOrCreateTerminal(
    workingDir,
    task.taskId,
    terminalProvider,
  );

  if (terminal instanceof Terminal) {
    terminal.terminal.show(true);

    // Update the working directory in case the terminal we asked for has
    // a different working directory so that the model will know where the
    // command actually executed.
    workingDir = terminal.getCurrentWorkingDirectory();
  }

  const process = terminal.runCommand(command, callbacks);
  task.terminalProcess = process;
  TerminalRegistry.registerProcessForExecution(executionId, process);
  process.once("completed", () => {
    TerminalRegistry.clearProcessForExecution(executionId, process);
    task.clearAiTerminalStdinTarget(executionId);
  });
  process.once("error", () => {
    TerminalRegistry.clearProcessForExecution(executionId, process);
    task.clearAiTerminalStdinTarget(executionId);
  });

  const waitForProcessOrUserCancel = async (): Promise<
    "completed" | "cancelled"
  > => {
    const outcome = await Promise.race([
      process.then(() => "completed" as const),
      userCancelledPromise.then(() => "cancelled" as const),
    ]);

    if (outcome !== "cancelled") {
      return outcome;
    }

    return Promise.race([
      process.then(() => "completed" as const),
      delay(userCancelSettleTimeoutMs).then(() => "cancelled" as const),
    ]);
  };

  // Implement command execution timeout (skip if timeout is 0).
  if (commandExecutionTimeout > 0) {
    let timeoutId: NodeJS.Timeout | undefined;
    let isTimedOut = false;

    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        task.terminalProcess?.abort();
        reject(
          new Error(
            `Command execution timed out after ${commandExecutionTimeout}ms`,
          ),
        );
      }, commandExecutionTimeout);
    });

    try {
      processOutcome = (await Promise.race([
        waitForProcessOrUserCancel(),
        timeoutPromise,
      ])) as "completed" | "cancelled";
    } catch (error) {
      if (isTimedOut) {
        const status: CommandExecutionStatus = {
          executionId,
          status: "timeout",
        };
        provider?.postMessageToWebview({
          type: "commandExecutionStatus",
          text: JSON.stringify(status),
        });
        await task.say(
          "error",
          t("common:errors:command_timeout", {
            seconds: commandExecutionTimeoutSeconds,
          }),
        );
        task.didToolFailInCurrentTurn = true;
        task.terminalProcess = undefined;

        return [
          false,
          `The command was terminated after exceeding a user-configured ${commandExecutionTimeoutSeconds}s timeout. Do not try to re-run the command.`,
        ];
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      task.terminalProcess = undefined;
    }
  } else {
    // No timeout - just wait for the process to complete.
    try {
      processOutcome = await waitForProcessOrUserCancel();
    } finally {
      task.terminalProcess = undefined;
    }
  }

  if (processOutcome === "cancelled") {
    return [
      false,
      [
        formatCancelledCommandResult(result),
        "The terminal did not confirm shutdown before the cancel grace period elapsed.",
      ]
        .filter(Boolean)
        .join("\n"),
    ];
  }

  if (shellIntegrationError) {
    throw new ShellIntegrationError(shellIntegrationError);
  }

  if (process.wasAborted) {
    return [false, formatCancelledCommandResult(result)];
  }

  // Wait for a short delay to ensure all messages are sent to the webview.
  // This delay allows time for non-awaited promises to be created and
  // for their associated messages to be sent to the webview, maintaining
  // the correct order of messages (although the webview is smart about
  // grouping command_output messages despite any gaps anyways).
  await delay(50);

  // Persist the final command output into a say message so that
  // combineCommandSequences can restore it when the chat is reloaded.
  // Without this, the output is only streamed via ephemeral
  // commandExecutionStatus messages and lost on chat re-entry.
  if (result) {
    await task.say("command_output", result);
  }

  if (message) {
    const { text, images } = message;
    await task.say("user_feedback", text, images);

    return [
      true,
      formatResponse.toolResult(
        [
          `Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
          result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
          `The user provided the following feedback:`,
          `<feedback>\n${text}\n</feedback>`,
        ].join("\n"),
        images,
      ),
    ];
  } else if (completed || exitDetails) {
    let exitStatus: string = "";

    if (exitDetails !== undefined) {
      if (exitDetails.signalName) {
        exitStatus = `Process terminated by signal ${exitDetails.signalName}`;

        if (exitDetails.coreDumpPossible) {
          exitStatus += " - core dump possible";
        }
      } else if (exitDetails.exitCode === undefined) {
        result +=
          "<VSCE exit code is undefined: terminal output and command execution status is unknown.>";
        exitStatus = `Exit code: <undefined, notify user>`;
      } else {
        if (exitDetails.exitCode !== 0) {
          exitStatus +=
            "Command execution was not successful, inspect the cause and adjust as needed.\n";
        }

        exitStatus += `Exit code: ${exitDetails.exitCode}`;
      }
    } else {
      result +=
        "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>";
      exitStatus = `Exit code: <undefined, notify user>`;
    }

    let workingDirInfo = ` within working directory '${terminal.getCurrentWorkingDirectory().toPosix()}'`;

    return [false, result];
  } else {
    return [
      false,
      [
        `Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
        result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
        "You will be updated on the terminal status and new output in the future.",
      ].join("\n"),
    ];
  }
}

export const executeCommandTool = new ExecuteCommandTool();
