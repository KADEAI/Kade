import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import stripBom from "strip-bom";
import { XMLBuilder } from "fast-xml-parser";
import delay from "delay";

import { createDirectoriesForFile } from "../../utils/fs";
import { arePathsEqual, getReadablePath } from "../../utils/path";
import {
  buildAppliedEditBlocksFromContents,
  formatNativeFileReadback,
  formatResponse,
} from "../../core/prompts/responses";
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics";
import { ClineSayTool } from "../../shared/ExtensionMessage";
import { Task } from "../../core/task/Task";
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types";
import { resolveToolProtocol } from "../../utils/resolveToolProtocol";
import { formatWithPrettier } from "../../core/tools/helpers/formatWithPrettier";

import { DecorationController } from "./DecorationController";

export const DIFF_VIEW_URI_SCHEME = "cline-diff";
export const MODIFIED_VIEW_URI_SCHEME = "cline-modified";
export const DIFF_VIEW_LABEL_CHANGES = "Original ↔ Kilo Code's Changes";
const DIAGNOSTIC_POLL_INTERVAL_MS = 50;
const DIAGNOSTIC_SETTLE_WINDOW_MS = 150;

type DiagnosticsSnapshot = [vscode.Uri, vscode.Diagnostic[]][];

function areDiagnosticsEqual(
  left: DiagnosticsSnapshot,
  right: DiagnosticsSnapshot,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let outerIndex = 0; outerIndex < left.length; outerIndex++) {
    const [leftUri, leftDiagnostics] = left[outerIndex];
    const [rightUri, rightDiagnostics] = right[outerIndex];

    if (leftUri.toString() !== rightUri.toString()) {
      return false;
    }

    if (leftDiagnostics.length !== rightDiagnostics.length) {
      return false;
    }

    for (
      let diagnosticIndex = 0;
      diagnosticIndex < leftDiagnostics.length;
      diagnosticIndex++
    ) {
      const leftDiagnostic = leftDiagnostics[diagnosticIndex];
      const rightDiagnostic = rightDiagnostics[diagnosticIndex];

      if (
        leftDiagnostic.message !== rightDiagnostic.message ||
        leftDiagnostic.severity !== rightDiagnostic.severity ||
        leftDiagnostic.source !== rightDiagnostic.source ||
        leftDiagnostic.code !== rightDiagnostic.code ||
        leftDiagnostic.range.start.line !== rightDiagnostic.range.start.line ||
        leftDiagnostic.range.start.character !==
          rightDiagnostic.range.start.character ||
        leftDiagnostic.range.end.line !== rightDiagnostic.range.end.line ||
        leftDiagnostic.range.end.character !==
          rightDiagnostic.range.end.character
      ) {
        return false;
      }
    }
  }

  return true;
}

// TODO: https://github.com/cline/cline/pull/3354
export class DiffViewProvider implements vscode.TextDocumentContentProvider {
  // Properties to store the results of saveChanges
  newProblemsMessage?: string;
  userEdits?: string;
  editType?: "create" | "modify";
  isEditing = false;
  originalContent: string | undefined;
  private shouldSuppressDiff = false;
  private createdDirs: string[] = [];
  private documentWasOpen = false;
  private relPath?: string;
  private newContent?: string;
  private activeDiffEditor?: vscode.TextEditor;
  private fadedOverlayController?: DecorationController;
  private activeLineController?: DecorationController;
  private streamedLines: string[] = [];
  private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [];
  private taskRef: WeakRef<Task>;
  private activeStreamingToolCallId?: string;
  private firstDiffLine?: number;
  private lastScrollLine?: number;

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private cwd: string,
    task: Task,
  ) {
    this.taskRef = new WeakRef(task);
    // Register this provider for both the original snapshot and the live modified buffer
    vscode.workspace.registerTextDocumentContentProvider(
      DIFF_VIEW_URI_SCHEME,
      this,
    );
    vscode.workspace.registerTextDocumentContentProvider(
      MODIFIED_VIEW_URI_SCHEME,
      this,
    );
  }

  getCurrentRelPath(): string | undefined {
    return this.relPath;
  }

  isDiffSuppressed(): boolean {
    return this.shouldSuppressDiff;
  }

  getActiveStreamingToolCallId(): string | undefined {
    return this.activeStreamingToolCallId;
  }

  setActiveStreamingToolCallId(toolCallId?: string): void {
    this.activeStreamingToolCallId = toolCallId;
  }

  getRelPath(): string | undefined {
    return this.relPath;
  }

  getNewContent(): string | undefined {
    return this.newContent;
  }

  // Implementation of TextDocumentContentProvider
  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.scheme === DIFF_VIEW_URI_SCHEME) {
      // Return original content from query (base64) or fallback to internal state
      return (
        Buffer.from(uri.query, "base64").toString("utf-8") ||
        this.originalContent ||
        ""
      );
    }
    if (uri.scheme === MODIFIED_VIEW_URI_SCHEME) {
      // Return the currently streamed content
      return this.newContent || "";
    }
    return "";
  }

  async open(relPath: string, suppressDiff: boolean = false): Promise<void> {
    this.relPath = relPath;
    this.newContent = undefined; // KILOCODE FIX: Clear stale content from previous runs
    this.shouldSuppressDiff = suppressDiff;
    const fileExists = this.editType === "modify";
    const absolutePath = path.resolve(this.cwd, relPath);
    this.isEditing = true;

    // If the file is already open, ensure it's not dirty before getting its
    // contents.
    if (fileExists) {
      const existingDocument = vscode.workspace.textDocuments.find(
        (doc) =>
          doc.uri.scheme === "file" &&
          arePathsEqual(doc.uri.fsPath, absolutePath),
      );

      if (existingDocument && existingDocument.isDirty) {
        await existingDocument.save();
      }
    }

    // Get diagnostics before editing the file, we'll compare to diagnostics
    // after editing to see if cline needs to fix anything.
    this.preDiagnostics = vscode.languages.getDiagnostics();

    if (fileExists) {
      this.originalContent = await fs.readFile(absolutePath, "utf-8");
    } else {
      this.originalContent = "";
    }

    // For new files, create any necessary directories and keep track of new
    // directories to delete if the user denies the operation.
    this.createdDirs = await createDirectoriesForFile(absolutePath);

    // KILOCODE FIX: STOP pre-emptive file creation.
    // We used to write "" to the file here to make it "exist" for VS Code diff.
    // Now we use a virtual URI, so we don't touch the disk until approval.
    /*
		if (!fileExists) {
			await fs.writeFile(absolutePath, "")
		}
		*/

    // If the file was already open, close it (must happen after showing the

    // If the file was already open, close it (must happen after showing the
    // diff view since if it's the only tab the column will close).
    this.documentWasOpen = false;

    // Close the tab if it's open (it's already saved above).
    const tabs = vscode.window.tabGroups.all
      .map((tg) => tg.tabs)
      .flat()
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.scheme === "file" &&
          arePathsEqual(tab.input.uri.fsPath, absolutePath),
      );

    for (const tab of tabs) {
      if (!tab.isDirty) {
        await vscode.window.tabGroups.close(tab);
      }
      this.documentWasOpen = true;
    }

    this.activeDiffEditor = await this.openDiffEditor(suppressDiff);

    if (!this.shouldSuppressDiff) {
      this.fadedOverlayController = new DecorationController(
        "fadedOverlay",
        this.activeDiffEditor,
      );
      this.activeLineController = new DecorationController(
        "activeLine",
        this.activeDiffEditor,
      );
      // Apply faded overlay to all lines initially.
      this.fadedOverlayController.addLines(
        0,
        this.activeDiffEditor.document.lineCount,
      );
    }

    this.scrollEditorToLine(0); // Will this crash for new files?
    this.streamedLines = [];
    this.firstDiffLine = undefined;
    this.lastScrollLine = undefined;
  }

  async update(accumulatedContent: string, isFinal: boolean) {
    if (
      !this.relPath ||
      (!this.shouldSuppressDiff &&
        (!this.activeLineController || !this.fadedOverlayController))
    ) {
      throw new Error("Required values not set");
    }

    this.newContent = accumulatedContent;
    const accumulatedLines = accumulatedContent.split("\n");
    const endLine = accumulatedLines.length;

    const absolutePath = path.resolve(this.cwd, this.relPath);
    // KILOCODE FIX: Use absolute path in virtual URI for reliable matching across all workspace types.
    const modifiedUri = vscode.Uri.from({
      scheme: MODIFIED_VIEW_URI_SCHEME,
      path: absolutePath,
    });
    this._onDidChange.fire(modifiedUri);

    // If editor is not ready, we search for it again.
    if (!this.activeDiffEditor) {
      const editors = vscode.window.visibleTextEditors;
      this.activeDiffEditor = editors.find((e) => {
        const u = e.document.uri;
        // KILOCODE FIX: Check both path and fsPath for robust matching
        return (
          u.scheme === MODIFIED_VIEW_URI_SCHEME &&
          (arePathsEqual(u.path, absolutePath) ||
            arePathsEqual(u.fsPath, absolutePath))
        );
      });
    }

    // Check if we've been reset/disposed or if editor is not yet ready
    if (!this.relPath || !this.activeDiffEditor) {
      return;
    }

    const diffEditor = this.activeDiffEditor;
    const document = diffEditor.document;

    if (
      !this.shouldSuppressDiff &&
      (!this.activeLineController || !this.fadedOverlayController)
    ) {
      return;
    }

    if (
      !this.shouldSuppressDiff &&
      this.activeLineController &&
      this.fadedOverlayController
    ) {
      // Update decorations immediately for better visual feedback
      this.activeLineController.setActiveLine(endLine);
      this.fadedOverlayController.updateOverlayAfterLine(
        endLine,
        document.lineCount,
      );
    }

    // Track the first line that changed incrementally so we can scroll cheaply later.
    const previousLines = this.streamedLines;
    if (this.firstDiffLine === undefined) {
      const sharedPrefixLength = Math.min(
        previousLines.length,
        accumulatedLines.length,
      );
      let firstChangedLine = sharedPrefixLength;
      for (let i = 0; i < sharedPrefixLength; i++) {
        if (previousLines[i] !== accumulatedLines[i]) {
          firstChangedLine = i;
          break;
        }
      }
      if (
        firstChangedLine < accumulatedLines.length ||
        previousLines.length !== accumulatedLines.length
      ) {
        this.firstDiffLine = firstChangedLine;
      }
    }

    // Scroll only when the streamed cursor has moved meaningfully to reduce UI churn.
    const ranges = this.activeDiffEditor.visibleRanges;
    const shouldConsiderScroll =
      !ranges || ranges.length === 0 || endLine >= ranges[0].end.line - 2;
    if (shouldConsiderScroll && this.lastScrollLine !== endLine) {
      this.scrollEditorToLine(endLine);
      this.lastScrollLine = endLine;
    }

    // Update the streamedLines with the new accumulated content
    this.streamedLines = accumulatedLines;

    if (isFinal) {
      // Preserve empty last line if original content had one.
      const hasEmptyLastLine = this.originalContent?.endsWith("\n");

      if (hasEmptyLastLine && !accumulatedContent.endsWith("\n")) {
        this.newContent = accumulatedContent + "\n";
        this._onDidChange.fire(modifiedUri);
      }

      // Clear all decorations at the end.
      if (
        !this.shouldSuppressDiff &&
        this.fadedOverlayController &&
        this.activeLineController
      ) {
        this.fadedOverlayController.clear();
        this.activeLineController.clear();
      }
    }
  }

  async saveChanges(
    diagnosticsEnabled: boolean = true,
    writeDelayMs: number = DEFAULT_WRITE_DELAY_MS,
    contentAlreadyFormatted: boolean = false,
  ): Promise<{
    newProblemsMessage: string | undefined;
    userEdits: string | undefined;
    finalContent: string | undefined;
  }> {
    if (!this.relPath || !this.newContent) {
      throw new Error(
        "Synchronization Error: Missing file path or content. The operation may have been reset.",
      );
    }

    // KILOCODE FIX: Last-resort editor discovery before failing.
    if (!this.activeDiffEditor) {
      const absolutePath = path.resolve(this.cwd, this.relPath);
      this.activeDiffEditor = vscode.window.visibleTextEditors.find((e) => {
        const u = e.document.uri;
        return (
          u.scheme === MODIFIED_VIEW_URI_SCHEME &&
          (arePathsEqual(u.path, absolutePath) ||
            arePathsEqual(u.fsPath, absolutePath))
        );
      });
    }

    if (!this.activeDiffEditor) {
      throw new Error(
        "Synchronization Error: The diff editor was closed or could not be found. Please ensure the 'Kilo Code's Changes' tab is open before approving.",
      );
    }

    const absolutePath = path.resolve(this.cwd, this.relPath);
    const updatedDocument = this.activeDiffEditor.document;
    let editedContent = updatedDocument.getText();

    // KILOCODE FIX: When auto-approve is enabled, saveChanges executes instantly.
    // VS Code's virtual document provider needs a moment to sync `this.newContent` to `updatedDocument.getText()`.
    // If they don't match, we wait briefly.
    const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n";
    const isSynced = () =>
      editedContent.replace(/\r\n|\n/g, newContentEOL) ===
      this.newContent!.replace(/\r\n|\n/g, newContentEOL);

    if (!isSynced()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      editedContent = updatedDocument.getText();

      if (!isSynced()) {
        // If it's still not synced, it might be stuck on empty or original content.
        if (editedContent === "" || editedContent === this.originalContent) {
          console.warn(
            `[DiffViewProvider] Virtual document didn't sync! Falling back to newContent. editedContent length: ${editedContent.length}`,
          );
          editedContent = this.newContent;
        }
      }
    }

    if (!contentAlreadyFormatted || editedContent !== this.newContent) {
      const state = await this.taskRef.deref()?.providerRef.deref()?.getState();
      editedContent = await formatWithPrettier({
        cwd: this.cwd,
        relativePath: this.relPath,
        content: editedContent,
        formatterSettings: state?.formatterSettings,
      });
    }
    this.newContent = editedContent;

    // KILOCODE FIX: Always write directly to disk instead of using document.save().
    // During streaming, handlePartial's applyEdit calls modify the real file document,
    // which can trigger VS Code auto-save writing partial content to disk. When
    // document.save() is called here, VS Code detects the on-disk mtime changed and
    // throws "File Modified Since". Writing directly to disk with fs.writeFile bypasses
    // this mtime check entirely. The document content (editedContent) is authoritative
    // since it has the final streamed content from applyEdit calls.
    await fs.writeFile(absolutePath, editedContent, "utf-8");

    await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
      preview: false,
      preserveFocus: true,
    });
    await this.closeAllDiffViews();

    // Getting diagnostics before and after the file edit is a better approach than
    // automatically tracking problems in real-time. This method ensures we only
    // report new problems that are a direct result of this specific edit.
    // Since these are new problems resulting from Roo's edit, we know they're
    // directly related to the work he's doing. This eliminates the risk of Roo
    // going off-task or getting distracted by unrelated issues, which was a problem
    // with the previous auto-debug approach. Some users' machines may be slow to
    // update diagnostics, so this approach provides a good balance between automation
    // and avoiding potential issues where Roo might get stuck in loops due to
    // outdated problem information. If no new problems show up by the time the user
    // accepts the changes, they can always debug later using the '@problems' mention.
    // This way, Roo only becomes aware of new problems resulting from his edits
    // and can address them accordingly. If problems don't change immediately after
    // applying a fix, won't be notified, which is generally fine since the
    // initial fix is usually correct and it may just take time for linters to catch up.

    let newProblemsMessage = "";

    if (diagnosticsEnabled) {
      // Treat writeDelayMs as a max wait budget instead of a mandatory sleep.
      // This lets fast diagnostics complete quickly while still giving slower
      // linters time to settle when they actually need it.
      const postDiagnostics =
        await this.collectPostSaveDiagnostics(writeDelayMs);

      // Get diagnostic settings from state
      const task = this.taskRef.deref();
      const state = await task?.providerRef.deref()?.getState();
      const includeDiagnosticMessages =
        state?.includeDiagnosticMessages ?? true;
      const maxDiagnosticMessages = state?.maxDiagnosticMessages ?? 50;

      const newProblems = await diagnosticsToProblemsString(
        getNewDiagnostics(this.preDiagnostics, postDiagnostics),
        [
          vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
        ],
        this.cwd,
        includeDiagnosticMessages,
        maxDiagnosticMessages,
      ); // Will be empty string if no errors.

      newProblemsMessage =
        newProblems.length > 0
          ? `\n\nNew problems detected after saving the file:\n${newProblems}`
          : "";
    }

    // If the edited content has different EOL characters, we don't want to
    // show a diff with all the EOL differences.

    // Normalize EOL characters without trimming content
    const normalizedEditedContent = editedContent.replace(
      /\r\n|\n/g,
      newContentEOL,
    );

    // Just in case the new content has a mix of varying EOL characters.
    const normalizedNewContent = this.newContent.replace(
      /\r\n|\n/g,
      newContentEOL,
    );

    if (normalizedEditedContent.trim() !== normalizedNewContent.trim()) {
      // User made changes before approving edit.
      const userEdits = formatResponse.createPrettyPatch(
        this.relPath.toPosix(),
        normalizedNewContent,
        normalizedEditedContent,
      );

      // Store the results as class properties for formatFileWriteResponse to use
      this.newProblemsMessage = newProblemsMessage;
      this.userEdits = userEdits;

      return {
        newProblemsMessage,
        userEdits,
        finalContent: normalizedEditedContent,
      };
    } else {
      // No changes to Roo's edits.
      // Store the results as class properties for formatFileWriteResponse to use
      this.newProblemsMessage = newProblemsMessage;
      this.userEdits = undefined;

      return {
        newProblemsMessage,
        userEdits: undefined,
        finalContent: normalizedEditedContent,
      };
    }
  }

  /**
   * Formats a standardized response for file write operations
   *
   * @param task Task instance to get protocol info
   * @param cwd Current working directory for path resolution
   * @param isNewFile Whether this is a new file or an existing file being modified
   * @returns Formatted message (JSON for native protocol, XML for legacy)
   */
  async pushToolWriteResult(
    task: Task,
    cwd: string,
    isNewFile: boolean,
    includeEditCount: boolean = true,
    includeReadback: boolean = false,
  ): Promise<string> {
    if (!this.relPath) {
      throw new Error("No file path available in DiffViewProvider");
    }

    // Increment file edit count
    const absolutePath = path.resolve(cwd, this.relPath);
    const pathKey =
      process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
    const currentCount = (task.luxurySpa.fileEditCounts.get(pathKey) || 0) + 1;
    task.luxurySpa.fileEditCounts.set(pathKey, currentCount);
    task.luxurySpa.recordRecentEditBlocks(
      absolutePath,
      buildAppliedEditBlocksFromContents(
        this.originalContent ?? "",
        this.newContent ?? "",
      ),
    );

    // Check which protocol we're using
    const toolProtocol = resolveToolProtocol(
      task.apiConfiguration,
      task.api.getModel().info,
    );

    if (includeReadback) {
      const finalContent = this.newContent ?? "";
      const lines = finalContent.length > 0 ? finalContent.split(/\r?\n/) : [];
      task.luxurySpa.injectFreshContent(this.relPath, lines);

      let response = `File ${isNewFile ? "created" : "modified"} successfully${!isNewFile && includeEditCount ? ` (Edit #${currentCount})` : ""}\n`;
      response += `Post-write snapshot:\n${formatNativeFileReadback(this.relPath, finalContent)}`;

      if (this.newProblemsMessage) {
        response += `\n${this.newProblemsMessage}`;
      }

      return response;
    }

    if (
      (toolProtocol as string) === "unified" ||
      (toolProtocol as string) === "markdown"
    ) {
      // Return a neutral, readable string for the Unified/Markdown protocol
      let response = `File ${isNewFile ? "created" : "modified"} successfully${!isNewFile && includeEditCount ? ` (Edit #${currentCount})` : ""}\n`;
      if (!isNewFile) {
        response += `Notice: The edit succeeded. If an older read in your context now shows the New: text from this edit, that does NOT mean it was already there before. Reads are automatically refreshed after edits, so they now reflect the latest file state. In short: the Old block you provided in this edit is the previous content, and any read now showing the New block is showing the updated file.\n`;
      }

      if (this.newProblemsMessage) {
        response += `\n${this.newProblemsMessage}\n`;
      }

      // response += `\nNotice: ${notices.join(" ")}`
      return response;
    } else {
      // Build a more neutral XML response for the legacy protocol
      const xmlObj = {
        file_result: {
          path: this.relPath,
          operation: isNewFile ? "created" : "modified",
          problems: this.newProblemsMessage || undefined,
          // notice: notices.join(" "),
        },
      };

      const builder = new XMLBuilder({
        format: true,
        indentBy: "  ",
        suppressEmptyNode: true,
        processEntities: false,
        tagValueProcessor: (name, value) => {
          if (typeof value === "string") {
            return value
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
          }
          return value;
        },
        attributeValueProcessor: (name, value) => {
          if (typeof value === "string") {
            return value
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
          }
          return value;
        },
      });

      return builder.build(xmlObj);
    }
  }

  async revertChanges(): Promise<void> {
    if (!this.relPath) {
      return;
    }

    await this.closeAllDiffViews();

    const fileExists = this.editType === "modify";

    // If it was a new file, we only need to clean up directories we created.
    // We no longer pre-create an empty file, so no unlink needed.
    if (!fileExists) {
      // Remove the directories we created, in reverse order.
      for (let i = this.createdDirs.length - 1; i >= 0; i--) {
        try {
          await fs.rmdir(this.createdDirs[i]);
        } catch (e) {
          // Directory might not be empty if other files exist
        }
      }
    }

    // Edit is done.
    await this.reset();
  }

  private async closeAllDiffViews(): Promise<void> {
    const closeOps = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        // Check for standard diff views with our URI scheme
        if (
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.scheme === DIFF_VIEW_URI_SCHEME &&
          !tab.isDirty
        ) {
          return true;
        }

        // Also check by tab label for our specific diff views
        // This catches cases where the diff view might be created differently
        // when files are pre-opened as text documents
        if (tab.label.includes(DIFF_VIEW_LABEL_CHANGES) && !tab.isDirty) {
          return true;
        }

        return false;
      })
      .map((tab) =>
        vscode.window.tabGroups.close(tab).then(
          () => undefined,
          (err) => {
            console.error(`Failed to close diff tab ${tab.label}`, err);
          },
        ),
      );

    await Promise.all(closeOps);
  }

  private async openDiffEditor(
    suppressDiff: boolean = false,
  ): Promise<vscode.TextEditor> {
    if (!this.relPath) {
      throw new Error(
        "No file path set for opening diff editor. Ensure open() was called before openDiffEditor()",
      );
    }

    const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath));

    // If this diff editor is already open (ie if a previous write file was
    // interrupted) then we should activate that instead of opening a new
    // diff.
    const diffTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
          arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
      );

    if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
      const editor = await vscode.window.showTextDocument(
        diffTab.input.modified,
        { preserveFocus: true },
      );
      return editor;
    }

    // Open new diff editor.
    return new Promise<vscode.TextEditor>((resolve, reject) => {
      const fileName = path.basename(uri.fsPath);
      const fileExists = this.editType === "modify";
      const DIFF_EDITOR_TIMEOUT = 20_000; // ms

      let timeoutId: NodeJS.Timeout | undefined;
      const disposables: vscode.Disposable[] = [];

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        disposables.forEach((d) => d.dispose());
        disposables.length = 0;
      };

      // Check if it's already open before setting up the timeout/listeners
      const existingEditor = vscode.window.visibleTextEditors.find(
        (e) =>
          e.document.uri.scheme === MODIFIED_VIEW_URI_SCHEME &&
          (arePathsEqual(e.document.uri.path, uri.fsPath) ||
            arePathsEqual(e.document.uri.fsPath, uri.fsPath)),
      );
      if (existingEditor && suppressDiff) {
        resolve(existingEditor);
        return;
      }

      // Set timeout for the entire operation
      timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Failed to open diff editor for ${uri.fsPath} within ${DIFF_EDITOR_TIMEOUT / 1000} seconds. The editor may be blocked or VS Code may be unresponsive.`,
          ),
        );
      }, DIFF_EDITOR_TIMEOUT);

      // Listen for document open events - more efficient than scanning all tabs
      disposables.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
          // KILOCODE FIX: Match the MODIFIED_VIEW_URI_SCHEME instead of 'file'
          if (
            document.uri.scheme === MODIFIED_VIEW_URI_SCHEME &&
            arePathsEqual(document.uri.path, uri.fsPath)
          ) {
            // Wait a tick for the editor to be available
            await new Promise((r) => setTimeout(r, 0));

            // Find the editor for this document
            const editor = vscode.window.visibleTextEditors.find(
              (e) =>
                e.document.uri.scheme === MODIFIED_VIEW_URI_SCHEME &&
                (arePathsEqual(e.document.uri.path, uri.fsPath) ||
                  arePathsEqual(e.document.uri.fsPath, uri.fsPath)),
            );

            if (editor) {
              cleanup();
              resolve(editor);
            }
          }
        }),
      );

      // Also listen for visible editor changes as a fallback
      disposables.push(
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
          const editor = editors.find((e) => {
            const isModifiedScheme =
              e.document.uri.scheme === MODIFIED_VIEW_URI_SCHEME;
            const pathMatches =
              arePathsEqual(e.document.uri.path, uri.fsPath) ||
              arePathsEqual(e.document.uri.fsPath, uri.fsPath);
            return isModifiedScheme && pathMatches;
          });
          if (editor) {
            cleanup();
            resolve(editor);
          }
        }),
      );

      // Pre-open the file as a text document only if it exists.
      // For new files, we skip this to avoid "File not found" errors.
      const preOpen = fileExists
        ? vscode.window.showTextDocument(uri, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: true,
          })
        : Promise.resolve();

      preOpen
        .then(() => {
          // Execute the diff command after ensuring the file is open as text
          const modifiedUri = vscode.Uri.from({
            scheme: MODIFIED_VIEW_URI_SCHEME,
            path: uri.fsPath,
          });

          // KILOCODE FIX: If suppressDiff is true, we still need an editor for the virtual buffer
          // so we can apply streaming edits. We show it in the background.
          if (suppressDiff) {
            return vscode.window.showTextDocument(modifiedUri, {
              preview: false,
              viewColumn: vscode.ViewColumn.Active,
              preserveFocus: true,
            });
          }

          return vscode.commands.executeCommand(
            "vscode.diff",
            vscode.Uri.from({
              scheme: DIFF_VIEW_URI_SCHEME,
              path: uri.fsPath,
              query: Buffer.from(this.originalContent ?? "").toString("base64"),
            }),
            modifiedUri,
            `${fileName}: ${fileExists ? `${DIFF_VIEW_LABEL_CHANGES}` : "New File"} (Preview)`,
            { preserveFocus: true },
          );
        })
        .then(
          () => {
            // Command executed successfully, now wait for the editor to appear
          },
          (err: any) => {
            cleanup();
            reject(
              new Error(
                `Failed to execute diff command for ${uri.fsPath}: ${err.message}`,
              ),
            );
          },
        );
    });
  }

  private scrollEditorToLine(line: number) {
    if (this.activeDiffEditor) {
      const scrollLine = line + 4;

      this.activeDiffEditor.revealRange(
        new vscode.Range(scrollLine, 0, scrollLine, 0),
        vscode.TextEditorRevealType.InCenter,
      );
    }
  }

  scrollToFirstDiff() {
    if (!this.activeDiffEditor) {
      return;
    }

    const line = this.firstDiffLine ?? 0;
    this.activeDiffEditor.revealRange(
      new vscode.Range(line, 0, line, 0),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  private stripAllBOMs(input: string): string {
    let result = input;
    let previous;

    do {
      previous = result;
      result = stripBom(result);
    } while (result !== previous);

    return result;
  }

  private async collectPostSaveDiagnostics(
    writeDelayMs: number,
  ): Promise<DiagnosticsSnapshot> {
    const maxWaitMs = Math.max(0, writeDelayMs);
    let snapshot = vscode.languages.getDiagnostics();

    if (maxWaitMs === 0) {
      return snapshot;
    }

    let elapsedMs = 0;
    let stableMs = 0;

    while (elapsedMs < maxWaitMs && stableMs < DIAGNOSTIC_SETTLE_WINDOW_MS) {
      const waitMs = Math.min(
        DIAGNOSTIC_POLL_INTERVAL_MS,
        maxWaitMs - elapsedMs,
      );

      if (waitMs <= 0) {
        break;
      }

      try {
        await delay(waitMs);
      } catch (error) {
        console.warn(`Failed to apply write delay: ${error}`);
        break;
      }

      elapsedMs += waitMs;

      const nextSnapshot = vscode.languages.getDiagnostics();
      if (areDiagnosticsEqual(snapshot, nextSnapshot)) {
        stableMs += waitMs;
        continue;
      }

      snapshot = nextSnapshot;
      stableMs = 0;
    }

    return snapshot;
  }

  async reset(): Promise<void> {
    await this.closeAllDiffViews();
    this.editType = undefined;
    this.isEditing = false;
    this.originalContent = undefined;
    this.createdDirs = [];
    this.documentWasOpen = false;
    this.activeDiffEditor = undefined;
    this.fadedOverlayController = undefined;
    this.activeLineController = undefined;
    this.streamedLines = [];
    this.preDiagnostics = [];
    this.shouldSuppressDiff = false;
    this.activeStreamingToolCallId = undefined;
    this.firstDiffLine = undefined;
    this.lastScrollLine = undefined;
  }

  /**
   * Directly save content to a file without showing diff view
   * Used when preventFocusDisruption experiment is enabled
   *
   * @param relPath - Relative path to the file
   * @param content - Content to write to the file
   * @param openFile - Whether to show the file in editor (false = open in memory only for diagnostics)
   * @returns Result of the save operation including any new problems detected
   */
  async saveDirectly(
    relPath: string,
    content: string,
    openFile: boolean = true,
    diagnosticsEnabled: boolean = true,
    writeDelayMs: number = DEFAULT_WRITE_DELAY_MS,
    contentAlreadyFormatted: boolean = false,
  ): Promise<{
    newProblemsMessage: string | undefined;
    userEdits: string | undefined;
    finalContent: string | undefined;
  }> {
    const absolutePath = path.resolve(this.cwd, relPath);
    if (!contentAlreadyFormatted) {
      const state = await this.taskRef.deref()?.providerRef.deref()?.getState();
      content = await formatWithPrettier({
        cwd: this.cwd,
        relativePath: relPath,
        content,
        formatterSettings: state?.formatterSettings,
      });
    }

    // Get diagnostics before editing the file
    this.preDiagnostics = vscode.languages.getDiagnostics();

    // Write the content directly to the file
    await createDirectoriesForFile(absolutePath);
    await fs.writeFile(absolutePath, content, "utf-8");

    // Open the document to ensure diagnostics are loaded
    // When openFile is false (PREVENT_FOCUS_DISRUPTION enabled), we only open in memory
    if (openFile) {
      // Show the document in the editor
      await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
        preview: false,
        preserveFocus: true,
      });
    } else {
      // Just open the document in memory to trigger diagnostics without showing it
      await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
    }

    let newProblemsMessage = "";

    if (diagnosticsEnabled) {
      const postDiagnostics =
        await this.collectPostSaveDiagnostics(writeDelayMs);

      // Get diagnostic settings from state
      const task = this.taskRef.deref();
      const state = await task?.providerRef.deref()?.getState();
      const includeDiagnosticMessages =
        state?.includeDiagnosticMessages ?? true;
      const maxDiagnosticMessages = state?.maxDiagnosticMessages ?? 50;

      const newProblems = await diagnosticsToProblemsString(
        getNewDiagnostics(this.preDiagnostics, postDiagnostics),
        [vscode.DiagnosticSeverity.Error],
        this.cwd,
        includeDiagnosticMessages,
        maxDiagnosticMessages,
      );

      newProblemsMessage =
        newProblems.length > 0
          ? `\n\nNew problems detected after saving the file:\n${newProblems}`
          : "";
    }

    // Store the results for formatFileWriteResponse
    this.newProblemsMessage = newProblemsMessage;
    this.userEdits = undefined;
    this.relPath = relPath;
    this.newContent = content;

    return {
      newProblemsMessage,
      userEdits: undefined,
      finalContent: content,
    };
  }
}
