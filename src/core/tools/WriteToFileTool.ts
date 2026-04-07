import path from "path";
import delay from "delay";
import * as vscode from "vscode";
import fs from "fs/promises";

import { Task } from "../task/Task";
import { ClineSayTool } from "../../shared/ExtensionMessage";
import {
  formatResponse,
  isWriteHistoryPlaceholder,
} from "../prompts/responses";
import { RecordSource } from "../context-tracking/FileContextTrackerTypes";
import { fileExistsAtPath, createDirectoriesForFile } from "../../utils/fs";
import {
  stripLineNumbers,
  everyLineHasLineNumbers,
} from "../../integrations/misc/extract-text";
import { getReadablePath } from "../../utils/path";
import { isPathOutsideWorkspace } from "../../utils/pathUtils";
import { unescapeHtmlEntities } from "../../utils/text-normalization";
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types";
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments";
import {
  convertNewFileToUnifiedDiff,
  computeDiffStats,
  sanitizeUnifiedDiff,
} from "../diff/stats";
import { BaseTool, ToolCallbacks } from "./BaseTool";
import type { ToolUse } from "../../shared/tools";
import { trackContribution } from "../../services/contribution-tracking/ContributionTrackingService"; // kade_change
import { formatWithPrettier } from "./helpers/formatWithPrettier";
import { findLastIndex } from "../../shared/array";

interface WriteToFileParams {
  path: string;
  content: string;
  write?: string;
}

const decodeCompactWriteEscape = (
  input: string,
  index: number,
): { value: string; consumed: number } => {
  const nextChar = input[index + 1];
  if (nextChar === undefined) {
    return { value: "\\", consumed: 1 };
  }

  switch (nextChar) {
    case "n":
      return { value: "\n", consumed: 2 };
    case "r":
      return { value: "\r", consumed: 2 };
    case "t":
      return { value: "\t", consumed: 2 };
    case "\\":
    case '"':
    case "'":
    case "`":
    case "|":
    case ":":
      return { value: nextChar, consumed: 2 };
    default:
      return { value: `\\${nextChar}`, consumed: 2 };
  }
};

const decodeCompactWriteValue = (value: string): string => {
  let decoded = "";

  for (let index = 0; index < value.length; ) {
    if (value[index] !== "\\") {
      decoded += value[index];
      index++;
      continue;
    }

    const escape = decodeCompactWriteEscape(value, index);
    decoded += escape.value;
    index += escape.consumed;
  }

  return decoded;
};

const findCompactWriteSeparator = (
  input: string,
): { index: number; length: number } | null => {
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === "\\") {
      const decoded = decodeCompactWriteEscape(input, index);
      index += decoded.consumed - 1;
      continue;
    }

    if (char === "|") {
      return { index, length: 1 };
    }
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === "\\") {
      const decoded = decodeCompactWriteEscape(input, index);
      index += decoded.consumed - 1;
      continue;
    }

    if (char !== ":") {
      continue;
    }

    const looksLikeWindowsDrive =
      index === 1 &&
      /[A-Za-z]/.test(input[0] || "") &&
      /[\\/]/.test(input[2] || "");
    const looksLikeUrlScheme = input.slice(index, index + 3) === "://";
    if (!looksLikeWindowsDrive && !looksLikeUrlScheme) {
      return { index, length: 1 };
    }
  }

  for (let index = 0; index < input.length - 1; index++) {
    if (input[index] !== "\\") {
      continue;
    }

    const separatorChar = input[index + 1];
    if (separatorChar !== "|" && separatorChar !== ":") {
      continue;
    }

    const pathCandidate = input.slice(0, index).trim();
    const contentCandidate = input.slice(index + 2);
    if (!pathCandidate || !contentCandidate || /[\r\n]/.test(pathCandidate)) {
      continue;
    }

    const looksPathLike =
      /[\\/]/.test(pathCandidate) ||
      /\.[A-Za-z0-9_-]{1,16}$/.test(pathCandidate) ||
      /^[A-Za-z0-9 _.-]+$/.test(pathCandidate);
    const looksContentLike =
      /[\r\n<>{};]/.test(contentCandidate) ||
      /\s/.test(contentCandidate) ||
      contentCandidate.length > 32;

    if (looksPathLike && looksContentLike) {
      return { index, length: 2 };
    }
  }

  return null;
};

const parseEmbeddedCompactWrite = (
  rawPath: string,
): { path: string; content: string } | null => {
  const separator = findCompactWriteSeparator(rawPath);
  if (!separator) {
    return null;
  }

  const path = decodeCompactWriteValue(rawPath.slice(0, separator.index).trim());
  const content = decodeCompactWriteValue(
    rawPath.slice(separator.index + separator.length),
  );

  if (!path || !content) {
    return null;
  }

  return { path, content };
};

const normalizeWriteParams = (
  params: Pick<WriteToFileParams, "path" | "content" | "write">,
): WriteToFileParams => {
  const content = params.content ?? params.write ?? "";
  const path = params.path ?? "";
  const recovered =
    typeof path === "string" && (path.includes("|") || path.includes(":"))
      ? parseEmbeddedCompactWrite(path)
      : null;

  if (!recovered) {
    return {
      path,
      content,
      write: params.write,
    };
  }

  const normalizedContent =
    typeof content === "string" ? content.replace(/\r\n/g, "\n") : "";
  const normalizedRecoveredContent = recovered.content.replace(/\r\n/g, "\n");
  const trimmedContent = normalizedContent.trim();
  const looksLikeTrailingWrapperJunk =
    trimmedContent.length > 0 &&
    trimmedContent.length <= 8 &&
    /^[\]\[}{)(><"'`|,.:;]+$/.test(trimmedContent);
  const shouldUseRecoveredContent =
    !normalizedContent ||
    looksLikeTrailingWrapperJunk ||
    (normalizedRecoveredContent.length > normalizedContent.length &&
      normalizedRecoveredContent.startsWith(normalizedContent));

  return {
    path: recovered.path,
    content: shouldUseRecoveredContent ? recovered.content : content,
    write: params.write,
  };
};

export class WriteToFileTool extends BaseTool<"write"> {
  readonly name = "write" as const;

  parseLegacy(params: Partial<Record<string, string>>): WriteToFileParams {
    return normalizeWriteParams({
      path: params.path || "",
      content: params.content || params.write || "",
      write: params.write,
    });
  }

  async execute(
    params: WriteToFileParams,
    task: Task,
    callbacks: ToolCallbacks,
  ): Promise<void> {
    params = normalizeWriteParams(params);
    const { pushToolResult, handleError, askApproval, removeClosingTag } =
      callbacks;
    const relPath = params.path;
    let newContent = params.content ?? params.write;

    // Guard against cross-call contamination: if another tool call currently owns
    // the streaming diff session, reset before executing this write.
    const activeToolCallId =
      task.diffViewProvider.getActiveStreamingToolCallId();
    if (
      task.diffViewProvider.isEditing &&
      callbacks.toolCallId &&
      activeToolCallId &&
      callbacks.toolCallId !== activeToolCallId
    ) {
      await task.diffViewProvider.reset();
    }
    task.diffViewProvider.setActiveStreamingToolCallId(callbacks.toolCallId);

    if (!relPath) {
      task.consecutiveMistakeCount++;
      task.recordToolError("write");
      pushToolResult(await task.sayAndCreateMissingParamError("write", "path"));
      await task.diffViewProvider.reset();
      return;
    }

    if (newContent === undefined) {
      task.consecutiveMistakeCount++;
      task.recordToolError("write");
      pushToolResult(
        await task.sayAndCreateMissingParamError("write", "content"),
      );
      await task.diffViewProvider.reset();
      return;
    }

    const accessAllowed = task.rooIgnoreController?.validateAccess(relPath);

    if (!accessAllowed) {
      await task.say("rooignore_error", relPath);
      pushToolResult(formatResponse.rooIgnoreError(relPath));
      return;
    }

    // kade_change start
    if (typeof newContent !== "string") {
      console.warn(
        `[WriteToFileTool] converting incorrect model output ${typeof newContent} to string`,
      );
      newContent = JSON.stringify(newContent, null, "\t");
    }
    // kade_change end

    if (
      isWriteHistoryPlaceholder(newContent, relPath) ||
      isWriteHistoryPlaceholder(newContent)
    ) {
      task.consecutiveMistakeCount++;
      task.recordToolError("write");
      pushToolResult(
        formatResponse.toolError(
          `Refusing to write stripped history placeholder content to ${relPath}. Use the canonical write body or the paired post-write snapshot instead.`,
        ),
      );
      await task.diffViewProvider.reset();
      return;
    }

    const isWriteProtected =
      task.rooProtectedController?.isWriteProtected(relPath) || false;

    let fileExists: boolean;
    const absolutePath = path.resolve(task.cwd, relPath);

    // kade_change: Strongly prioritize cached editType from streaming if it exists.
    // This prevents the state from flipping from "create" to "modify" once the empty
    // file is created on disk to support the VS Code Diff View.
    if (task.diffViewProvider.editType !== undefined) {
      fileExists = task.diffViewProvider.editType === "modify";
    } else {
      // If editType is lost but we have empty originalContent cached, it means we likely
      // created the file during streaming (or opened an empty one). Treat as new file.
      if (task.diffViewProvider.originalContent === "") {
        fileExists = false;
      } else {
        const stats = await fs.stat(absolutePath).catch(() => null);
        fileExists = stats ? !stats.isDirectory() : false;
      }
      task.diffViewProvider.editType = fileExists ? "modify" : "create";
    }

    // Create parent directories early for new files to prevent ENOENT errors
    // in subsequent operations (e.g., diffViewProvider.open, fs.readFile)
    if (!fileExists) {
      await createDirectoriesForFile(absolutePath);
    }
    if (newContent.endsWith("```")) {
      newContent = newContent.split("\n").slice(0, -1).join("\n");
    }

    if (!task.api.getModel().id.includes("claude")) {
      newContent = unescapeHtmlEntities(newContent);
    }

    const state = await task.providerRef.deref()?.getState();

    newContent = await formatWithPrettier({
      cwd: task.cwd,
      relativePath: relPath,
      content: newContent,
      previousContent: fileExists
        ? task.diffViewProvider.originalContent
        : undefined,
      formatterSettings: state?.formatterSettings,
    });

    const fullPath = relPath
      ? path.resolve(task.cwd, removeClosingTag("path", relPath))
      : "";
    const isOutsideWorkspace = isPathOutsideWorkspace(fullPath);

    // Capture snapshot for undo
    try {
      const { EditHistoryService } = await import(
        "../../services/edit-history/EditHistoryService"
      );
      // kade_change: If we already have a snapshot from handlePartial/open, use it!
      // This prevents the snapshot from capturing the "truncated" intermediate state
      // if Auto-Save happened between the start of streaming and the final execute.
      let originalContent: string | undefined =
        task.diffViewProvider.originalContent;

      if (originalContent === undefined) {
        if (fileExists) {
          originalContent = await fs.readFile(absolutePath, "utf-8");
        }
      }

      if (EditHistoryService) {
        const tracker = await EditHistoryService.getInstance();
        if (tracker) {
          await tracker.captureBatchState(
            task.cwd,
            [
              {
                path: relPath,
                content: originalContent,
              },
            ],
            callbacks.toolCallId,
          );
        }
      }
    } catch (e) {
      // console.error("Failed to capture snapshot:", e)
    }

    const sharedMessageProps: ClineSayTool = {
      tool: "newFileCreated",
      path: getReadablePath(task.cwd, removeClosingTag("path", relPath)),
      content: newContent,
      isOutsideWorkspace,
      isProtected: isWriteProtected,
      id: callbacks.toolCallId,
    };

    try {
      task.consecutiveMistakeCount = 0;

      const provider = task.providerRef.deref();
      const state = await provider?.getState();
      const diagnosticsEnabled = state?.diagnosticsEnabled ?? true;
      const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
      const isPreventFocusDisruptionEnabled = experiments.isEnabled(
        state?.experiments ?? {},
        EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
      );

      if (isPreventFocusDisruptionEnabled) {
        task.diffViewProvider.editType = fileExists ? "modify" : "create";
        if (fileExists) {
          const absolutePath = path.resolve(task.cwd, relPath);
          task.diffViewProvider.originalContent = await fs.readFile(
            absolutePath,
            "utf-8",
          );
        } else {
          task.diffViewProvider.originalContent = "";
        }

        let unified = fileExists
          ? formatResponse.createPrettyPatch(
              relPath,
              task.diffViewProvider.originalContent,
              newContent,
            )
          : convertNewFileToUnifiedDiff(newContent, relPath);
        unified = sanitizeUnifiedDiff(unified);
        const completeMessage = JSON.stringify({
          ...sharedMessageProps,
          tool: "newFileCreated",
          content: unified,
          diff: unified,
          diffStats: computeDiffStats(unified) || undefined,
        } satisfies ClineSayTool);

        const didApprove = await askApproval(
          "tool",
          completeMessage,
          undefined,
          isWriteProtected,
        );

        // kade_change start
        // Track contribution (fire-and-forget, never blocks user workflow)
        trackContribution({
          cwd: task.cwd,
          filePath: relPath,
          unifiedDiff: unified,
          status: didApprove ? "accepted" : "rejected",
          taskId: task.taskId,
          organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
          kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
        });
        // kade_change end

        if (!didApprove) {
          return;
        }

        await task.diffViewProvider.saveDirectly(
          relPath,
          newContent,
          false,
          diagnosticsEnabled,
          writeDelayMs,
          true,
        );
      } else {
        if (
          !task.diffViewProvider.isEditing ||
          task.diffViewProvider.isDiffSuppressed()
        ) {
          const partialMessage = JSON.stringify(sharedMessageProps);
          await task
            .say("tool", partialMessage, undefined, true)
            .catch(() => {});
          await task.diffViewProvider.open(relPath);
        }

        await task.diffViewProvider.update(
          everyLineHasLineNumbers(newContent)
            ? stripLineNumbers(newContent)
            : newContent,
          true,
        );

        // Scroll immediately without delay for faster UI response
        task.diffViewProvider.scrollToFirstDiff();

        let unified = fileExists
          ? formatResponse.createPrettyPatch(
              relPath,
              task.diffViewProvider.originalContent,
              newContent,
            )
          : convertNewFileToUnifiedDiff(newContent, relPath);
        unified = sanitizeUnifiedDiff(unified);
        const completeMessage = JSON.stringify({
          ...sharedMessageProps,
          tool: "newFileCreated",
          content: newContent,
          diff: unified,
          diffStats: computeDiffStats(unified) || undefined,
        } satisfies ClineSayTool);

        const didApprove = await askApproval(
          "tool",
          completeMessage,
          undefined,
          isWriteProtected,
        );

        // kade_change start
        // Track contribution (fire-and-forget, never blocks user workflow)
        trackContribution({
          cwd: task.cwd,
          filePath: relPath,
          unifiedDiff: unified,
          status: didApprove ? "accepted" : "rejected",
          taskId: task.taskId,
          organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
          kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
        });
        // kade_change end

        if (!didApprove) {
          await task.diffViewProvider.revertChanges();
          return;
        }

        await task.diffViewProvider.saveChanges(
          diagnosticsEnabled,
          writeDelayMs,
          true,
        );
      }

      if (relPath) {
        await task.fileContextTracker.trackFileContext(
          relPath,
          "roo_edited" as RecordSource,
        );
      }

      task.didEditFile = true;

      // Capture modified state for Redo
      try {
        const { EditHistoryService } = await import(
          "../../services/edit-history/EditHistoryService"
        );
        if (callbacks.toolCallId) {
          const service = EditHistoryService.getInstance();
          service.updateModifiedState(
            callbacks.toolCallId,
            absolutePath,
            newContent,
          );
        }
      } catch (e) {
        console.error(
          "[WriteToFileTool] ❌ Failed to capture modified state:",
          e,
        );
      }

      task.luxurySpa.ensureTrackedFullRead(relPath);
      const message = await task.diffViewProvider.pushToolWriteResult(
        task,
        task.cwd,
        !fileExists,
        false,
        true,
      );

      const enhancedPushToolResult = (content: string) => {
        pushToolResult(content);
        (async () => {
          try {
            const toolId = callbacks.toolCallId;
            const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
              try {
                const parsed = JSON.parse(m.text || "{}");
                const isNewFileCreated =
                  (m.say === "tool" || m.ask === "tool") &&
                  parsed.tool === "newFileCreated";
                if (!isNewFileCreated) return false;
                if (toolId && parsed.id) {
                  return parsed.id === toolId;
                }
                return parsed.path === getReadablePath(task.cwd, relPath);
              } catch {
                return false;
              }
            });

            if (lastMsgIndex !== -1) {
              const msg = task.clineMessages[lastMsgIndex];
              const toolData = JSON.parse(msg.text || "{}");
              toolData.content = newContent;
              msg.text = JSON.stringify(toolData);
              msg.partial = false;
              await task.saveClineMessages();
              await task.updateClineMessage(msg);
            }
          } catch (error) {
            console.error(`[write] Failed to update UI: ${error}`);
          }
        })();
      };

      enhancedPushToolResult(message);

      await task.diffViewProvider.reset();

      task.processQueuedMessages();

      return;
    } catch (error) {
      await handleError("writing file", error as Error);
      await task.diffViewProvider.reset();
      return;
    }
  }

  override async handlePartial(
    task: Task,
    block: ToolUse<"write">,
  ): Promise<void> {
    const normalized = normalizeWriteParams({
      path:
        (block.params.path as string | undefined) ||
        ((block.params as any).target_file as string | undefined) ||
        "",
      content:
        (block.params.content as string | undefined) ??
        ((block.params as any).write as string | undefined) ??
        "",
      write: (block.params as any).write,
    });
    const relPath: string | undefined = normalized.path;
    let newContent: string | undefined = normalized.content;

    if (!relPath || newContent === undefined) {
      return;
    }

    if (
      isWriteHistoryPlaceholder(newContent, relPath) ||
      isWriteHistoryPlaceholder(newContent)
    ) {
      return;
    }

    const provider = task.providerRef.deref();
    const state = await provider?.getState();
    const isPreventFocusDisruptionEnabled = experiments.isEnabled(
      state?.experiments ?? {},
      EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
    );

    // Removed the check entirely to allow streaming to work always
    // Don't return early - always allow streaming to work

    let fileExists: boolean;
    const absolutePath = path.resolve(task.cwd, relPath);

    // kade_change: Strongly prioritize cached editType from streaming if it exists.
    // This prevents the state from flipping from "create" to "modify" once the empty
    // file is created on disk to support the VS Code Diff View.
    if (task.diffViewProvider.editType !== undefined) {
      fileExists = task.diffViewProvider.editType === "modify";
    } else {
      const stats = await fs.stat(absolutePath).catch(() => null);
      fileExists = stats ? !stats.isDirectory() : false;
      task.diffViewProvider.editType = fileExists ? "modify" : "create";
    }

    // Create parent directories early for new files to prevent ENOENT errors
    // in subsequent operations (e.g., diffViewProvider.open)
    if (!fileExists) {
      await createDirectoriesForFile(absolutePath);
    }

    const isWriteProtected =
      task.rooProtectedController?.isWriteProtected(relPath!) || false;
    const fullPath = absolutePath;
    const isOutsideWorkspace = isPathOutsideWorkspace(fullPath);

    // Hard boundary between streaming tool calls:
    // if another tool already owns the streaming diff session, hand the session
    // off cleanly instead of dropping later writes on the floor.
    if (task.diffViewProvider.isEditing) {
      const activeToolCallId =
        task.diffViewProvider.getActiveStreamingToolCallId();
      const activeRelPath = task.diffViewProvider.getCurrentRelPath();
      const isDifferentTool = !!(
        block.id &&
        activeToolCallId &&
        block.id !== activeToolCallId
      );
      if (isDifferentTool) {
        await task.diffViewProvider.reset();
      }
      // Same tool id should not change target file mid-stream; reset and treat it as a new stream.
      if (
        activeToolCallId &&
        block.id === activeToolCallId &&
        activeRelPath &&
        path.resolve(task.cwd, activeRelPath) !== absolutePath
      ) {
        await task.diffViewProvider.reset();
      }
    }

    task.diffViewProvider.setActiveStreamingToolCallId(block.id);

    const sharedMessageProps: ClineSayTool = {
      tool: "newFileCreated",
      path: getReadablePath(task.cwd, relPath!),
      content: newContent!,
      isOutsideWorkspace,
      isProtected: isWriteProtected,
      id: block.id,
    };

    // Always stream partial content for better UX.
    // Use a non-interactive say() instead of ask() so partial tool previews
    // don't get stuck as the active approval request in the webview.
    const partialMessage = JSON.stringify(sharedMessageProps);
    task
      .say("tool", partialMessage, undefined, true, undefined, undefined, {
        isNonInteractive: true,
        skipSave: true,
      })
      .catch(() => {});

    if (newContent) {
      if (!task.diffViewProvider.isEditing) {
        await task.diffViewProvider.open(relPath!, true);
      }

      // Stream the content update immediately
      await task.diffViewProvider.update(
        everyLineHasLineNumbers(newContent)
          ? stripLineNumbers(newContent)
          : newContent,
        false, // isPartial = true for streaming
      );
    }
  }
}

export const writeToFileTool = new WriteToFileTool();
