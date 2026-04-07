import * as fs from "fs";
import * as path from "path";
import { ClineMessage } from "@roo-code/types";
import { ApiMessage } from "../task-persistence";
import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser";
import { collectFailedToolUseIdsFromContentBlocks } from "./unifiedHistoryTranslation";
import {
  HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
  formatWriteHistoryPlaceholderBody,
} from "../prompts/responses";
import { EditResultBlockSummary } from "../prompts/responses";

export interface LuxurySpaDelegate {
  cwd: string;
  apiConversationHistory: ApiMessage[];
  clineMessages: ClineMessage[];
  saveApiConversationHistory(): Promise<void>;
  postStateToWebview(): Promise<void>;
  saveClineMessages(): Promise<void>;
}

export interface EditMarkerBlock {
  oldText: string;
  newText: string;
  startLine?: number;
  endLine?: number;
  marker: "*" | "**";
}

type TrackedReadRange = { start: number; end: number };

type TrackedReadState = {
  tracked: boolean;
  ranges: TrackedReadRange[] | undefined;
};

function splitDisplayLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export class LuxurySpa {
  private static readonly MAX_PERSISTED_EDIT_BATCHES = 10;

  // System reminders for edits
  public systemReminders: string[] = [];

  // Track active file reads with their requested line ranges
  // Key: file path, Value: undefined = full file, or array of {start, end} for specific ranges
  public activeFileReads: Map<
    string,
    { start: number; end: number }[] | undefined
  > = new Map();

  // Track how many times each file has been edited for labeling
  public fileEditCounts: Map<string, number> = new Map();

  // Track how many edit-result blocks have been emitted per file for stable Index labels
  public fileEditBlockCounts: Map<string, number> = new Map();

  // Track the merged line ranges from recent edits per file so refreshed reads can highlight them.
  public latestEditedLineRanges: Map<
    string,
    { start: number; end: number }[]
  > = new Map();

  // Track recent edit batches per file so markers can persist across multiple edits.
  public recentEditBlockHistory: Map<string, EditMarkerBlock[][]> = new Map();

  // HOT CACHE: Store fresh file content from ReadFileTool to avoid re-reading disk
  // Key: file path, Value: { lines, total, timestamp }
  private hotCache: Map<
    string,
    { lines: string[]; total: number; timestamp: number }
  > = new Map();

  // Track indices of the most recent tool results to enable incremental updates
  // Key: file path, Value: { apiHistoryIndex, clineMessageId }
  private latestToolResultIndices: Map<
    string,
    { apiHistoryIndex: number; clineMessageId?: string }
  > = new Map();

  // Track ALL message indices where a file appears to avoid full history scans
  // Key: file path, Value: Set of message indices
  private fileToMessageIndices: Map<string, Set<number>> = new Map();

  // Cache normalized file paths for faster matching during refresh
  // Key: original tracked path, Value: normalized absolute path
  private normalizedActivePathsCache: Map<string, string> = new Map();

  // Dirty tracking so smartRefresh can skip work when nothing relevant changed
  private dirtyFiles: Set<string> = new Set();
  private hasPendingStructuralRefresh = false;

  // Batched save flag to prevent multiple disk writes
  private pendingSave = false;
  private lastSaveTime = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastSerializedHistory = ""; // Cache to prevent redundant I/O

  /**
   * Regex to identify file content blocks in conversation history for refreshing.
   * Matches legacy unified blocks, wrapped unified blocks, and XML format.
   */
  /**
   * Regex to identify file content blocks in conversation history for refreshing.
   * Optimized to prevent premature truncation on multi-line edits.
   */
  private static readonly blockRegex = new RegExp(
    [
      "(?:Read result for\\s+([^\\r\\n]+)\\r?\\nRead Content:\\r?\\n([\\s\\S]*?)\\r?\\nEOF(?:\\r?\\n\\[[\\s\\S]*?\\])?)",
      "|",
      "(?:(?:\\[(?:read|read)\\s+for\\s+'.*?'\\]\\s+Result(?:\\s+\\(id:\\s+\\[mention\\]\\))?:\\s+)?(?:<<<READ_RESULT path=\"([^\"]+)\">>>\\s*)?(?:File:\\s+|file:\\/\\/\\/|<path>)(.*?)(?:<\\/path>|\\r?\\n|$)(?!\\s*(?:Edit Count:|<<<EDIT_BLOCK|Index=\"))|<file_content\\s+path=\"([^\"]+)\">)([\\s\\S]*?)(?:\\r?\\n<<<END_READ_RESULT>>>|(?=<\\/file_content>)<\\/file_content>|(?=\\r?\\n(?:Read result for |\\[read(?:_file)?\\s+for\\s+'.*?'\\]\\s+Result|<<<READ_RESULT path=|\\[EDIT_RESULT|File:|file:\\/\\/\\/|<path>|<file_content|EOF)|$))",
    ].join(""),
    "gi",
  );

  constructor(private delegate: LuxurySpaDelegate) {}

  /**
   * HOT CACHE: Inject fresh file content directly from ReadFileTool to avoid re-reading disk.
   * This is called immediately after a file is read by the tool.
   */
  public injectFreshContent(
    filePath: string,
    lines: string[],
    apiHistoryIndex?: number,
    clineMessageId?: string,
  ) {
    this.hotCache.set(filePath, {
      lines,
      total: lines.length,
      timestamp: Date.now(),
    });

    this.normalizedActivePathsCache.set(
      filePath,
      path.normalize(path.resolve(this.delegate.cwd, filePath)),
    );

    if (apiHistoryIndex !== undefined) {
      this.latestToolResultIndices.set(filePath, {
        apiHistoryIndex,
        clineMessageId,
      });

      // Also track in the global index map
      if (!this.fileToMessageIndices.has(filePath)) {
        this.fileToMessageIndices.set(filePath, new Set());
      }
      this.fileToMessageIndices.get(filePath)!.add(apiHistoryIndex);
    }

    this.markFileDirty(filePath);

    // console.log(`[LuxurySpa] 🔥 Hot cache injected for ${filePath} (${lines.length} lines)`)
  }

    /**
     * Invalidate hot cache for a specific file (e.g., after an edit).
     * This ensures the next refresh reads fresh content from disk.
     */
    public invalidateHotCache(filePath: string) {
      const normalizedPath = this.normalizeTrackedPath(filePath);
      this.hotCache.delete(filePath);
      this.hotCache.delete(normalizedPath);
      // console.log(`[LuxurySpa] 🔥 Hot cache invalidated for ${filePath}`)
    }

  private normalizeTrackedPath(filePath: string): string {
    return filePath.replace(/^(\.\/|\.\\)/, "");
  }

  private getTrackedReadState(filePath: string): TrackedReadState {
    const targetPathKey = this.getPlatformPathKey(filePath);
    let isTracked = false;
    const ranges: TrackedReadRange[] = [];

    for (const [trackedPath, trackedRanges] of this.activeFileReads.entries()) {
      if (this.getPlatformPathKey(trackedPath) !== targetPathKey) {
        continue;
      }

      isTracked = true;
      if (trackedRanges === undefined || trackedRanges.length === 0) {
        return { tracked: true, ranges: undefined };
      }

      ranges.push(...trackedRanges);
    }

    return {
      tracked: isTracked,
      ranges: isTracked ? this.mergeAndNormalizeRanges(ranges) : undefined,
    };
  }

  private deleteTrackedReadVariants(filePath: string) {
    const targetPathKey = this.getPlatformPathKey(filePath);

    for (const trackedPath of Array.from(this.activeFileReads.keys())) {
      if (this.getPlatformPathKey(trackedPath) === targetPathKey) {
        this.activeFileReads.delete(trackedPath);
      }
    }
  }

  private setTrackedReadState(
    filePath: string,
    ranges: TrackedReadRange[] | undefined,
  ) {
    const normalizedPath = this.normalizeTrackedPath(filePath);
    this.deleteTrackedReadVariants(normalizedPath);
    this.activeFileReads.set(
      normalizedPath,
      ranges && ranges.length > 0 ? [...ranges] : undefined,
    );
  }

  private markFileDirty(filePath: string) {
    this.dirtyFiles.add(this.normalizeTrackedPath(filePath));
  }

  private markStructuralRefreshNeeded() {
    this.hasPendingStructuralRefresh = true;
  }

  public markFilesDirty(filePaths: string[]) {
    for (const filePath of filePaths) {
      const normalizedPath = this.normalizeTrackedPath(filePath);
      this.invalidateHotCache(normalizedPath);
      this.markFileDirty(normalizedPath);
    }
  }

  public removeTrackedFile(filePath: string) {
    const normalizedPath = this.normalizeTrackedPath(filePath);
    this.deleteTrackedReadVariants(normalizedPath);
    this.normalizedActivePathsCache.delete(filePath);
    this.normalizedActivePathsCache.delete(normalizedPath);
    this.dirtyFiles.delete(filePath);
    this.dirtyFiles.delete(normalizedPath);
    this.latestToolResultIndices.delete(filePath);
    this.latestToolResultIndices.delete(normalizedPath);
    this.latestEditedLineRanges.delete(filePath);
    this.latestEditedLineRanges.delete(normalizedPath);
    this.recentEditBlockHistory.delete(filePath);
    this.recentEditBlockHistory.delete(normalizedPath);
    this.markStructuralRefreshNeeded();
  }

  public recordRecentEditBlocks(
    filePath: string,
    blocks: EditResultBlockSummary[],
  ) {
    const pathKey = this.getPlatformPathKey(filePath);
    const normalizedBlocks = blocks
      .filter(
        (block) =>
          block.status !== "failed" &&
          typeof block.newText === "string" &&
          block.newText.length > 0,
      )
      .map((block) => this.toEditMarkerBlock(block))
      .filter((block): block is EditMarkerBlock => !!block);

    if (normalizedBlocks.length === 0) {
      this.recentEditBlockHistory.delete(pathKey);
      this.latestEditedLineRanges.delete(pathKey);
      return;
    }

    const existingHistory = this.recentEditBlockHistory.get(pathKey) ?? [];
    const nextHistory = [...existingHistory, normalizedBlocks].slice(
      -LuxurySpa.MAX_PERSISTED_EDIT_BATCHES,
    );
    this.recentEditBlockHistory.set(pathKey, nextHistory);
    this.latestEditedLineRanges.set(
      pathKey,
      this.mergeAndNormalizeRanges(
        normalizedBlocks
          .filter((block) => block.startLine !== undefined)
          .map((block) => ({
            start: block.startLine!,
            end: block.endLine ?? block.startLine!,
          })),
      ),
    );
  }

  public restoreRecentEditBlockHistory(
    filePath: string,
    history: EditMarkerBlock[][],
  ) {
    const pathKey = this.getPlatformPathKey(filePath);
    const normalizedHistory = history
      .map((batch) =>
        batch
          .map((block) => this.normalizeEditMarkerBlock(block))
          .filter((block): block is EditMarkerBlock => !!block),
      )
      .filter((batch) => batch.length > 0)
      .slice(-LuxurySpa.MAX_PERSISTED_EDIT_BATCHES);

    if (normalizedHistory.length === 0) {
      this.recentEditBlockHistory.delete(pathKey);
      this.latestEditedLineRanges.delete(pathKey);
      return;
    }

    this.recentEditBlockHistory.set(pathKey, normalizedHistory);
    this.latestEditedLineRanges.set(
      pathKey,
      this.mergeAndNormalizeRanges(
        normalizedHistory
          .flat()
          .filter((block) => block.startLine !== undefined)
          .map((block) => ({
            start: block.startLine!,
            end: block.endLine ?? block.startLine!,
          })),
      ),
    );
  }

  private getPlatformPathKey(filePath: string): string {
    const absolutePath = path.normalize(
      path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.delegate.cwd, filePath),
    );
    return process.platform === "win32"
      ? absolutePath.toLowerCase()
      : absolutePath;
  }

  private mergeAndNormalizeRanges(ranges: { start: number; end: number }[]) {
    const normalized = ranges
      .map((range) => ({
        start: Math.max(1, Math.min(range.start, range.end)),
        end: Math.max(1, Math.max(range.start, range.end)),
      }))
      .sort((a, b) => a.start - b.start);

    if (normalized.length === 0) {
      return [];
    }

    const merged = [normalized[0]];
    for (let i = 1; i < normalized.length; i++) {
      const current = normalized[i];
      const previous = merged[merged.length - 1];
      if (current.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, current.end);
        continue;
      }
      merged.push(current);
    }

    return merged;
  }

  private toEditMarkerBlock(
    block: EditResultBlockSummary,
  ): EditMarkerBlock | null {
    if (!block.newText) {
      return null;
    }

    return this.normalizeEditMarkerBlock({
      newText: block.newText,
      oldText: block.oldText ?? "",
      startLine: block.startLine,
      endLine: block.endLine ?? block.startLine,
      marker: (block.oldText ?? "").length === 0 ? "*" : "**",
    });
  }

  private normalizeEditMarkerBlock(
    block: EditMarkerBlock,
  ): EditMarkerBlock | null {
    const normalizedNewText = block.newText.replace(/\r\n/g, "\n");
    if (normalizedNewText.length === 0) {
      return null;
    }

    const startLine =
      typeof block.startLine === "number" && block.startLine > 0
        ? block.startLine
        : undefined;
    const endLine =
      typeof block.endLine === "number" && block.endLine > 0
        ? block.endLine
        : startLine;

    return {
      newText: normalizedNewText,
      oldText: (block.oldText ?? "").replace(/\r\n/g, "\n"),
      startLine,
      endLine,
      marker: block.marker === "*" ? "*" : "**",
    };
  }

  private resolveMarkerBlockRange(
    lines: string[],
    block: EditMarkerBlock,
    usedStarts: Set<number>,
  ): { start: number; end: number } | null {
    const targetLines = splitDisplayLines(block.newText);
    if (targetLines.length === 0) {
      return null;
    }

    const matchStarts: number[] = [];
    for (let startIndex = 0; startIndex <= lines.length - targetLines.length; startIndex++) {
      let matches = true;
      for (let offset = 0; offset < targetLines.length; offset++) {
        if (lines[startIndex + offset] !== targetLines[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchStarts.push(startIndex + 1);
      }
    }

    if (matchStarts.length === 0) {
      if (
        typeof block.startLine === "number" &&
        typeof block.endLine === "number" &&
        block.startLine >= 1 &&
        block.endLine <= lines.length
      ) {
        return { start: block.startLine, end: block.endLine };
      }
      return null;
    }

    const preferredStart = this.pickBestMarkerStart(matchStarts, block.startLine, usedStarts);
    usedStarts.add(preferredStart);
    return {
      start: preferredStart,
      end: preferredStart + targetLines.length - 1,
    };
  }

  private pickBestMarkerStart(
    candidates: number[],
    preferredStart?: number,
    usedStarts?: Set<number>,
  ) {
    return [...candidates].sort((a, b) => {
      const aUsedPenalty = usedStarts?.has(a) ? 100000 : 0;
      const bUsedPenalty = usedStarts?.has(b) ? 100000 : 0;
      const preferred = preferredStart ?? 1;
      return (
        aUsedPenalty +
        Math.abs(a - preferred) -
        (bUsedPenalty + Math.abs(b - preferred))
      );
    })[0];
  }

  /**
   * Clear hot cache entries older than 5 seconds to prevent stale data.
   */
  private pruneHotCache() {
    const now = Date.now();
    const maxAge = 5000; // 5 seconds

    for (const [path, data] of this.hotCache.entries()) {
      if (now - data.timestamp > maxAge) {
        this.hotCache.delete(path);
        // console.log(`[LuxurySpa] 🧹 Pruned stale hot cache for ${path}`)
      }
    }
  }

  public addSystemReminder(reminder: string, filePath?: string) {
    // Luxury Spa: If a filePath is provided, remove any previous reminders for that specific file
    // to prevent "Summary Flood" in the system prompt.
    if (filePath) {
      this.systemReminders = this.systemReminders.filter(
        (r) => !r.includes(`(${filePath})`) && !r.includes(`for ${filePath}`),
      );
    }
    this.systemReminders.push(reminder);

    // Keep only the last 10 reminders to prevent prompt bloat
    if (this.systemReminders.length > 10) {
      this.systemReminders.shift();
    }
  }

  private compactSuccessfulNativeToolHistory() {
    const failedToolUseIds = new Set<string>();
    const completedToolUseIds = new Set<string>();
    for (const message of this.delegate.apiConversationHistory) {
      if (message.role !== "user" || !Array.isArray(message.content)) {
        continue;
      }

      for (const block of message.content as any[]) {
        if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
          completedToolUseIds.add(block.tool_use_id);
        }
      }

      collectFailedToolUseIdsFromContentBlocks(message.content as any).forEach(
        (toolUseId) => failedToolUseIds.add(toolUseId),
      );
    }

    for (const message of this.delegate.apiConversationHistory) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) {
        continue;
      }

      for (const block of message.content as any[]) {
        if (block?.type !== "tool_use" || !block.id || failedToolUseIds.has(block.id)) {
          continue;
        }

        if (!block.input || typeof block.input !== "object") {
          continue;
        }

        block.input = NativeToolCallParser.compactToolInputForHistory(
          block.name,
          block.input,
          { forModel: true },
        );
      }
    }

    for (const message of this.delegate.clineMessages) {
      if (message.say !== "tool" || typeof message.text !== "string") {
        continue;
      }

      try {
        const payload = JSON.parse(message.text);
        const toolUseId =
          typeof payload?.id === "string" ? payload.id : undefined;
        if (
          !toolUseId ||
          !completedToolUseIds.has(toolUseId) ||
          failedToolUseIds.has(toolUseId)
        ) {
          continue;
        }

        if (payload.tool === "newFileCreated") {
          if (typeof payload.content === "string") {
            payload.content = formatWriteHistoryPlaceholderBody(payload.content);
          }
          if (typeof payload.diff === "string") {
            payload.diff = formatWriteHistoryPlaceholderBody(payload.diff);
          }
          message.text = JSON.stringify(payload);
          continue;
        }

        if (payload.tool === "appliedDiff") {
          if (typeof payload.diff === "string") {
            payload.diff = HISTORY_CONTENT_PLACEMENT_PLACEHOLDER;
          }
          if (Array.isArray(payload.edits)) {
            payload.edits = (
              NativeToolCallParser.compactToolInputForHistory("edit", {
                edits: payload.edits,
              }) as any
            ).edits;
          }
          message.text = JSON.stringify(payload);
        }
      } catch {
        // Ignore malformed persisted tool payloads and leave them untouched.
      }
    }
  }

  /**
   * Refresh ALL active file reads in a single pass through history.
   * This is much more efficient than calling updateFileContext per file.
   */
  public async refreshAllActiveContexts(
    incrementalOnly = false,
    targetFilePaths?: string[],
  ) {
    if (this.activeFileReads.size === 0) return;

    // Prune stale hot cache entries
    this.pruneHotCache();

    // console.log(`[LuxurySpa] 🧖 Refreshing ${this.activeFileReads.size} active file reads${incrementalOnly ? ' (INCREMENTAL)' : ' (FULL)'}...`)

    // Cache file contents to avoid redundant disk reads during the pass
    const fileContentsCache = new Map<
      string,
      { lines: string[]; total: number } | null
    >();
    const fileContentsPromises = new Map<
      string,
      Promise<{ lines: string[]; total: number } | null>
    >();

    const getFileContent = async (filePath: string) => {
      // 🔥 HOT CACHE: Check if we have fresh content from ReadFileTool first
      // BUT: Skip hot cache if file is marked dirty (recently edited)
      const normalizedPath = this.normalizeTrackedPath(filePath);
      const isDirty = this.dirtyFiles.has(filePath) || this.dirtyFiles.has(normalizedPath);
      
      if (!isDirty && this.hotCache.has(filePath)) {
        const cached = this.hotCache.get(filePath)!;
        // console.log(`[LuxurySpa] ⚡ Using hot cache for ${filePath} (${cached.lines.length} lines)`)
        fileContentsCache.set(filePath, cached);
        return cached;
      }

      if (fileContentsCache.has(filePath))
        return fileContentsCache.get(filePath) ?? null;
      if (fileContentsPromises.has(filePath))
        return fileContentsPromises.get(filePath)!;

      const pending = (async () => {
        try {
          const absolutePath = path.resolve(this.delegate.cwd, filePath);
          const content = await fs.promises.readFile(absolutePath, "utf8");
          const lines = content.split(/\r?\n/);
          const result = { lines, total: lines.length };
          fileContentsCache.set(filePath, result);
          return result;
        } catch (error: any) {
          // Gracefully handle missing files without spamming logs
          if (error.code !== "ENOENT") {
            console.error(
              `[LuxurySpa] Disk read failed for ${filePath}:`,
              error,
            );
          }
          fileContentsCache.set(filePath, null);
          return null;
        } finally {
          fileContentsPromises.delete(filePath);
        }
      })();

      fileContentsPromises.set(filePath, pending);
      return pending;
    };

    const resolveLineMarkers = (
      filePath: string,
      lines: string[],
    ): Map<number, "*" | "**"> => {
      const blocks =
        this.recentEditBlockHistory.get(this.getPlatformPathKey(filePath)) ?? [];
      const flattenedBlocks = blocks.flat();
      if (flattenedBlocks.length === 0) {
        const fallbackRanges =
          this.latestEditedLineRanges.get(this.getPlatformPathKey(filePath)) ?? [];
        return new Map(
          fallbackRanges.flatMap((range) =>
            Array.from(
              { length: Math.max(0, range.end - range.start + 1) },
              (_, index) => [range.start + index, "**" as const],
            ),
          ),
        );
      }

      const markers = new Map<number, "*" | "**">();
      const usedStarts = new Set<number>();
      for (const block of flattenedBlocks) {
        const resolvedRange = this.resolveMarkerBlockRange(lines, block, usedStarts);
        if (!resolvedRange) {
          continue;
        }

        for (let line = resolvedRange.start; line <= resolvedRange.end; line++) {
          const existing = markers.get(line);
          if (existing === "**") {
            continue;
          }
          markers.set(line, block.marker === "**" ? "**" : existing ?? "*");
        }
      }

      return markers;
    };

    const formatRanges = (
      lines: string[],
      ranges: { start: number; end: number }[],
      lineMarkers?: Map<number, "*" | "**">,
    ) => {
      const rangeContents: string[] = [];
      for (const range of ranges) {
        const start = Math.max(1, range.start);
        const end = Math.min(lines.length, range.end);
        const rangeLines = lines.slice(start - 1, end);
        const numberedContent = rangeLines
          .map((line, idx) => {
            const lineNumber = start + idx;
            const marker = lineMarkers?.get(lineNumber) ?? "";
            return `${marker}${lineNumber}→${line}`;
          })
          .join("\n");
        rangeContents.push(`Lines ${start}-${end}:\n${numberedContent}`);
      }
      return rangeContents.join("\n\n");
    };

    const formatUnifiedReadBlock = (
      pathStr: string,
      content: string,
      advisory?: string,
    ) =>
      [
        `Read result for ${pathStr}`,
        "Read Content:",
        content.trimEnd() || "(tool did not return anything)",
        "EOF",
        advisory ? `[${advisory}]` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

    const formatRangesXml = (
      lines: string[],
      ranges: { start: number; end: number }[],
      lineMarkers?: Map<number, "*" | "**">,
    ) => {
      const rangeContents: string[] = [];
      for (const range of ranges) {
        const start = Math.max(1, range.start);
        const end = Math.min(lines.length, range.end);
        const rangeLines = lines.slice(start - 1, end);
        const numberedContent = rangeLines
          .map((line, idx) => {
            const lineNumber = start + idx;
            const marker = lineMarkers?.get(lineNumber) ?? "";
            return `${marker}${lineNumber}→${line}`;
          })
          .join("\n");
        rangeContents.push(
          `<content lines="${start}-${end}">\n${numberedContent}</content>`,
        );
      }
      return rangeContents.join("\n");
    };

    const formattedContentCache = new Map<string, string>();
    const buildRangesCacheKey = (ranges?: { start: number; end: number }[]) =>
      ranges && ranges.length > 0
        ? ranges.map((range) => `${range.start}-${range.end}`).join(",")
        : "full";
    const buildLineMarkersCacheKey = (
      lineMarkers?: Map<number, "*" | "**">,
    ) =>
      lineMarkers && lineMarkers.size > 0
        ? Array.from(lineMarkers.entries())
            .map(([line, marker]) => `${marker}${line}`)
            .join(",")
        : "none";
    const getFormattedReadContent = (
      filePath: string,
      fileData: { lines: string[]; total: number },
      isXmlFormat: boolean,
      ranges?: { start: number; end: number }[],
    ) => {
      const lineMarkers = resolveLineMarkers(filePath, fileData.lines);
      const cacheKey = `${filePath}::${isXmlFormat ? "xml" : "unified"}::${buildRangesCacheKey(ranges)}::${buildLineMarkersCacheKey(lineMarkers)}`;
      const cached = formattedContentCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      let formatted: string;
      if (ranges && ranges.length > 0) {
        formatted = isXmlFormat
          ? formatRangesXml(fileData.lines, ranges, lineMarkers)
          : formatRanges(fileData.lines, ranges, lineMarkers);
      } else {
        const preferred = this.getTrackedReadState(filePath).ranges;
        if (preferred && preferred.length > 0) {
          formatted = isXmlFormat
            ? formatRangesXml(fileData.lines, preferred, lineMarkers)
            : formatRanges(fileData.lines, preferred, lineMarkers);
        } else if (isXmlFormat) {
          formatted = `<content lines="1-${fileData.total}">\n${formatRanges(
            fileData.lines,
            [{ start: 1, end: fileData.total }],
            lineMarkers,
          )
            .replace(/^Lines 1-\d+:\n/, "")
            .trimEnd()}</content>\n`;
        } else {
          formatted = formatRanges(
            fileData.lines,
            [{ start: 1, end: fileData.total }],
            lineMarkers,
          );
        }
      }
      formattedContentCache.set(cacheKey, formatted);
      return formatted;
    };

    // Track which files have found their "latest" version during the backward scan
    const foundLatestFiles = new Set<string>();
    // Track ranges already seen to strip redundant partials
    const foundFileRanges = new Map<string, { start: number; end: number }[]>();
    const clinePathsToRefresh = new Set<string>();
    let absoluteModified = false;

    const activeTrackedPaths = Array.from(this.activeFileReads.keys());
    const normalizedPathLookup = new Map<string, string>();
    const normalizedPathLookupLower = new Map<string, string>();

    for (const activePath of activeTrackedPaths) {
      const normalized =
        this.normalizedActivePathsCache.get(activePath) ??
        path.normalize(path.resolve(this.delegate.cwd, activePath));
      this.normalizedActivePathsCache.set(activePath, normalized);
      normalizedPathLookup.set(normalized, activePath);
      normalizedPathLookupLower.set(normalized.toLowerCase(), activePath);
    }

    // Determine which messages actually need scanning
    const targetIndices = new Set<number>();
    if (incrementalOnly) {
      const normalizedTargets = targetFilePaths?.length
        ? new Set(
            targetFilePaths.map((filePath) =>
              this.normalizeTrackedPath(filePath),
            ),
          )
        : undefined;

      // Only scan messages for files we know were recently refreshed
      const candidatePaths = activeTrackedPaths.filter((trackedPath) => {
        if (!this.latestToolResultIndices.has(trackedPath)) return false;
        if (!normalizedTargets) return true;
        return normalizedTargets.has(this.normalizeTrackedPath(trackedPath));
      });

      for (const path of candidatePaths) {
        const latest = this.latestToolResultIndices.get(path);
        if (latest) {
          targetIndices.add(latest.apiHistoryIndex);
        }
        const indices = this.fileToMessageIndices.get(path);
        if (indices) indices.forEach((idx) => targetIndices.add(idx));
      }
    } else {
      // Full refresh - scan all user messages (but we'll use a fast filter)
      for (let i = 0; i < this.delegate.apiConversationHistory.length; i++) {
        if (this.delegate.apiConversationHistory[i].role === "user") {
          targetIndices.add(i);
        }
      }
    }

    const sortedIndices = Array.from(targetIndices).sort((a, b) => b - a);

    for (const i of sortedIndices) {
      const msg = this.delegate.apiConversationHistory[i];
      if (!msg || msg.role !== "user") continue;

      // ⚡ FAST FILTER: Skip expensive regex if message doesn't contain any active file markers
      const hasPotentialBlock =
        typeof msg.content === "string"
          ? msg.content.includes("Read result for ") ||
            msg.content.includes("File:") ||
            msg.content.includes("<<<READ_RESULT") ||
            msg.content.includes("<path>") ||
            msg.content.includes("<file_content")
          : Array.isArray(msg.content)
            ? msg.content.some((block: any) => {
                const text =
                  typeof block?.text === "string"
                    ? block.text
                    : typeof block?.content === "string"
                      ? block.content
                      : "";
                return (
                  text.includes("Read result for ") ||
                  text.includes("File:") ||
                  text.includes("<<<READ_RESULT") ||
                  text.includes("<path>") ||
                  text.includes("<file_content")
                );
              })
            : false;
      if (!hasPotentialBlock) continue;

      let msgModified = false;
      const isArrayContent = Array.isArray(msg.content);
      const contents: any[] = isArrayContent
        ? (msg.content as any[])
        : [{ type: "text", text: msg.content as string }];
      const newContentBlocks: any[] = [];

      for (const block of contents) {
        const isText = block.type === "text" && typeof block.text === "string";
        const isToolResult =
          block.type === "tool_result" &&
          typeof (block as any).content === "string";

        if (isText || isToolResult) {
          const originalText = isText ? block.text : (block as any).content;

          let modified = false;
          const modifiedText = await this.asyncReplace(
            originalText,
            LuxurySpa.blockRegex,
            async (
              match: string,
              plainReadPathGroup: string,
              plainReadContentGroup: string,
              wrappedPathGroup: string,
              headerPathGroup: string,
              xmlPathGroup: string,
              contentStr: string,
              offset: number,
            ) => {
              if (
                match.startsWith("File:") &&
                this.isOffsetInsideStructuredEditResult(originalText, offset)
              ) {
                return match;
              }

              const pathStr = (
                plainReadPathGroup ||
                wrappedPathGroup ||
                headerPathGroup ||
                xmlPathGroup ||
                ""
              )
                .trim()
                .replace(/^[\"']|[\"']$/g, "");
              if (!pathStr) return match;

              // Robust path normalization for matching
              const normalizedPartPath = pathStr.startsWith("file:///")
                ? pathStr.slice(8)
                : pathStr;
              const partAbsolutePath = path.isAbsolute(normalizedPartPath)
                ? normalizedPartPath
                : path.resolve(this.delegate.cwd, normalizedPartPath);
              const partNormalized = path.normalize(partAbsolutePath);

              const targetFilePath =
                normalizedPathLookup.get(partNormalized) ??
                normalizedPathLookupLower.get(partNormalized.toLowerCase()) ??
                null;

              if (!targetFilePath) {
                return match;
              }

              const fileData = await getFileContent(targetFilePath);

              modified = true;
              let contentToUse: string;
              let shouldStrip = false;

              if (!fileData) {
                // File doesn't exist anymore. Remove from active reads and strip from history.
                this.activeFileReads.delete(targetFilePath);
                this.normalizedActivePathsCache.delete(targetFilePath);
                this.fileEditCounts.delete(
                  path.resolve(this.delegate.cwd, targetFilePath),
                );
                this.fileEditBlockCounts.delete(
                  path.resolve(this.delegate.cwd, targetFilePath),
                );
                foundLatestFiles.add(targetFilePath); // Ensure UI sync picks it up

                const isXmlBlock = match.startsWith("<file_content");
                const wrapperMatch = match.match(
                  /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
                );
                const rebuilt = isXmlBlock
                  ? `<file_content path="${pathStr}">\n[File not found or deleted]\n</file_content>`
                  : formatUnifiedReadBlock(pathStr, "[File not found or deleted]");
                if (wrapperMatch && !isXmlBlock) {
                  return wrapperMatch[0] + rebuilt;
                }
                return rebuilt;
              }

              // Parse ranges from both unified format (Lines X-Y:) and XML format (<content lines="X-Y">)
              const blockContent = plainReadContentGroup || contentStr;
              const unifiedRangeMatches = [
                ...blockContent.matchAll(/Lines (\d+)-(\d+):/g),
              ];
              const xmlRangeMatches = [
                ...blockContent.matchAll(
                  /<content[^>]*lines="(\d+)-(\d+)"[^>]*>/g,
                ),
              ];

              const hasRanges =
                unifiedRangeMatches.length > 0 || xmlRangeMatches.length > 0;
              const isLatest = !foundLatestFiles.has(targetFilePath);
              const isXmlFormat = xmlRangeMatches.length > 0;
              const trackedReadState =
                this.getTrackedReadState(targetFilePath);
              const preferredReadTracking = trackedReadState.ranges;
              // A read is considered a "full file read" if it has no ranges, OR if it's explicitly tracked as full.
              // However, we must respect the CURRENT tracking state.
              const tracksFullFileRead =
                trackedReadState.tracked &&
                preferredReadTracking === undefined;
              const ranges = [
                ...unifiedRangeMatches.map((m) => ({
                  start: parseInt(m[1]),
                  end: parseInt(m[2]),
                })),
                ...xmlRangeMatches.map((m) => ({
                  start: parseInt(m[1]),
                  end: parseInt(m[2]),
                })),
              ];

              // A read is considered "full" if it covers the entire file or is a mention
              let isActuallyFullRead = !hasRanges;
              if (hasRanges && ranges.length === 1) {
                const { start, end } = ranges[0];
                // If this file is being tracked as a full read, preserve that semantic even
                // after later edits increase the file length.
                if (start === 1 && tracksFullFileRead) {
                  isActuallyFullRead = true;
                }
                // Be lenient with line counts (off by 2 is safer for trailing whitespace/newlines)
                else if (start === 1 && end >= fileData.total - 2) {
                  isActuallyFullRead = true;
                }
              }

              if (hasRanges && !isActuallyFullRead) {
                // Check if these ranges are already covered by later (backward searched) reads
                const existingRanges =
                  foundFileRanges.get(targetFilePath) || [];
                const isRedundant = ranges.every((r) =>
                  existingRanges.some(
                    (er) => er.start <= r.start && er.end >= r.end,
                  ),
                );

                if (isRedundant && !isLatest) {
                  shouldStrip = true;
                  contentToUse = `[Redundant partial read of ${targetFilePath} stripped to save tokens.]`;
                } else {
                  const normalizedRanges = this.mergeAndNormalizeRanges(ranges);
                  // Mark as latest so subsequent (older) occurrences are handled correctly
                  if (isLatest) {
                    foundLatestFiles.add(targetFilePath);
                    foundFileRanges.set(targetFilePath, normalizedRanges);
                  } else {
                    // Add to covered ranges
                    foundFileRanges.set(
                      targetFilePath,
                      this.mergeAndNormalizeRanges([
                        ...existingRanges,
                        ...normalizedRanges,
                      ]),
                    );
                  }
                  contentToUse = getFormattedReadContent(
                    targetFilePath,
                    fileData,
                    isXmlFormat,
                    ranges,
                  );
                }
              } else if (isLatest) {
                // This is the most recent full read or mention
                foundLatestFiles.add(targetFilePath);
                // Mark as fully covered for partials too
                foundFileRanges.set(targetFilePath, [
                  { start: 1, end: fileData.total },
                ]);

                // If the existing block already has ranges, we MUST respect them.
                // Otherwise we fallback to any preferred ranges from activeFileReads.
                const rangesToUse = (ranges && ranges.length > 0) ? ranges : preferredReadTracking;
                contentToUse = getFormattedReadContent(
                  targetFilePath,
                  fileData,
                  isXmlFormat,
                  rangesToUse && rangesToUse.length > 0 ? rangesToUse : undefined,
                );
              } else {
                // Older full read - strip it
                shouldStrip = true;
                contentToUse = `[Older version of ${targetFilePath} stripped to save tokens. See later in history for current content.]`;
              }

              const isXmlBlock = match.startsWith("<file_content");
              const isPlainReadBlock = match.startsWith("Read result for ");
              const wrapperMatch = match.match(
                /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
              );
              if (shouldStrip) {
                const stripped = isXmlBlock
                  ? `<file_content path="${pathStr}">\n${contentToUse}\n</file_content>`
                  : formatUnifiedReadBlock(pathStr, contentToUse);
                if (wrapperMatch && !isXmlBlock && !isPlainReadBlock) {
                  return wrapperMatch[0] + stripped;
                }
                return stripped;
              }

              // Add edit suffix if applicable
              const pathKey =
                process.platform === "win32"
                  ? partAbsolutePath.toLowerCase()
                  : partAbsolutePath;
              const editCount = this.fileEditCounts.get(pathKey) || 0;
              let advisory: string | undefined;
              if (editCount > 0) {
                advisory = `This read result shows the most up-to-date file content after the latest edit, Edit #${editCount}. See Edit #${editCount} for the exact changes and previous content. Line numbers beginning with * mark added lines; ** mark edited lines.`;
              }
              const rebuiltWithSuffix = isXmlBlock
                ? `<file_content path="${pathStr}">\n${contentToUse}${advisory ? `\n(${advisory})` : ""}\n</file_content>`
                : formatUnifiedReadBlock(pathStr, contentToUse, advisory);

              if (wrapperMatch && !isXmlBlock && !isPlainReadBlock) {
                return wrapperMatch[0] + rebuiltWithSuffix;
              }
              return rebuiltWithSuffix;
            },
          );
          if (modified) {
            if (isText) block.text = modifiedText;
            else (block as any).content = modifiedText;
            msgModified = true;
          }
        }
        newContentBlocks.push(block);
      }

      if (msgModified) {
        if (isArrayContent) {
          msg.content = newContentBlocks as any;
        } else {
          msg.content = newContentBlocks[0].text || newContentBlocks[0].content;
        }
        absoluteModified = true;
        foundLatestFiles.forEach((pathStr) => clinePathsToRefresh.add(pathStr));
      }
    }

    if (clinePathsToRefresh.size > 0) {
      const updatedPathEntries = Array.from(clinePathsToRefresh).map((pathStr) => ({
        pathStr,
        absPathStr:
          this.normalizedActivePathsCache.get(pathStr) ??
          path.normalize(path.resolve(this.delegate.cwd, pathStr)),
      }));

      for (const clineMsg of this.delegate.clineMessages) {
        if (!clineMsg.text) continue;

        let clineMsgModified = false;
        let updatedText = clineMsg.text;

        const maybeRelevant = updatedPathEntries.some(
          ({ pathStr, absPathStr }) =>
            updatedText.includes(`Read result for ${pathStr}`) ||
            updatedText.includes(`<<<READ_RESULT path="${pathStr}">>>`) ||
            updatedText.includes(`File: ${pathStr}`) ||
            updatedText.includes(`path="${pathStr}"`) ||
            updatedText.includes(absPathStr),
        );
        if (!maybeRelevant) continue;

        updatedText = await this.asyncReplace(
          updatedText,
          LuxurySpa.blockRegex,
          async (
            match: string,
            plainReadPath: string,
            plainReadContent: string,
            wrappedPath: string,
            headerPath: string,
            xmlPath: string,
            content: string,
            offset: number,
          ) => {
            if (
              match.startsWith("File:") &&
              this.isOffsetInsideStructuredEditResult(updatedText, offset)
            ) {
              return match;
            }

            const matchPath = (
              plainReadPath ||
              wrappedPath ||
              headerPath ||
              xmlPath ||
              ""
            )
              .trim()
              .replace(/^[\"']|[\"']$/g, "");
            const normalizedMatchPath = matchPath.startsWith("file:///")
              ? matchPath.slice(8)
              : matchPath;
            const matchAbs = path.normalize(
              path.isAbsolute(normalizedMatchPath)
                ? normalizedMatchPath
                : path.resolve(this.delegate.cwd, normalizedMatchPath),
            );

            const target = updatedPathEntries.find(
              ({ pathStr, absPathStr }) =>
                matchPath === pathStr || matchAbs === absPathStr,
            );
            if (!target) {
              return match;
            }

            const fileData = await getFileContent(target.pathStr);

            const isXml = match.startsWith("<file_content");
            const isPlainReadBlock = match.startsWith("Read result for ");
            const wrapper = match.match(
              /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
            );

            if (!fileData) {
              clineMsgModified = true;
              const rebuilt = isXml
                ? `<file_content path="${target.pathStr}">\n[File not found or deleted]\n</file_content>`
                : formatUnifiedReadBlock(target.pathStr, "[File not found or deleted]");
              return wrapper && !isXml && !isPlainReadBlock
                ? wrapper[0] + rebuilt
                : rebuilt;
            }

            const blockContent = plainReadContent || content;
            const unifiedRanges = [
              ...blockContent.matchAll(/Lines (\d+)-(\d+):/g),
            ].map((rangeMatch) => ({
              start: parseInt(rangeMatch[1]),
              end: parseInt(rangeMatch[2]),
            }));
            const xmlRanges = [
              ...blockContent.matchAll(/<content[^>]*lines="(\d+)-(\d+)"[^>]*>/g),
            ].map((rangeMatch) => ({
              start: parseInt(rangeMatch[1]),
              end: parseInt(rangeMatch[2]),
            }));
            const preferred = this.getTrackedReadState(target.pathStr).ranges;
            const blockRanges = [...unifiedRanges, ...xmlRanges];
            const editCount = this.fileEditCounts.get(target.absPathStr) || 0;
            const refreshed = getFormattedReadContent(
              target.pathStr,
              fileData,
              isXml,
              blockRanges.length > 0
                ? this.mergeAndNormalizeRanges(blockRanges)
                : preferred && preferred.length > 0
                  ? preferred
                  : undefined,
            );

            const advisory = `This earlier read result has been rewritten to reflect your latest edit. Review Edit #${editCount} later in this chat for the exact blocks that were applied, and see the "Old Blocks" section there if you need the previous content for comparison. Lines marked with * are additions and lines marked with ** are replacements or edits; these markers may reflect changes from the last 10 edits to this file in this task.`;
            clineMsgModified = true;
            const rebuilt = isXml
              ? `<file_content path="${target.pathStr}">\n${refreshed}${editCount > 0 ? `\n(${advisory})` : ""}</file_content>`
              : formatUnifiedReadBlock(
                  target.pathStr,
                  refreshed,
                  editCount > 0 ? advisory : undefined,
                );
            return wrapper && !isXml && !isPlainReadBlock
              ? wrapper[0] + rebuilt
              : rebuilt;
          },
        );

        if (clineMsgModified) {
          clineMsg.text = updatedText;
        }
      }
    }

    if (absoluteModified) {
      // console.log("[LuxurySpa] Success: Performed history refresh across one or more messages.")
      // 🚀 BATCHED SAVE: Use debounced save to prevent triple disk write
      await this.scheduleBatchedSave();
    } else {
      // console.log("[LuxurySpa] Passive: No matching file blocks found in history to refresh.")
    }

    // Clear hot cache after successful refresh
    this.hotCache.clear();
  }

  /**
   * 🚀 NITRO BATCHED SAVE: Debounce and optimize I/O.
   * Separates UI updates from disk I/O to minimize perceived latency.
   */
  private async scheduleBatchedSave() {
    if (this.pendingSave) return;
    this.pendingSave = true;

    if (this.saveTimer) clearTimeout(this.saveTimer);

    this.saveTimer = setTimeout(async () => {
      const start = Date.now();

      // 1. Prioritize UI Responsiveness
      // Post state to webview immediately so the user sees the refresh
      try {
        await this.delegate.postStateToWebview();
      } catch (e) {
        console.error("[LuxurySpa] Webview sync failed:", e);
      }

      // 2. Heavy Disk I/O (Offloaded)
      // We use a simple hash/length check to avoid saving if history is identical
      const currentHistoryLength = this.delegate.apiConversationHistory.length;
      const lastMessage =
        currentHistoryLength > 0
          ? this.delegate.apiConversationHistory[currentHistoryLength - 1]
          : undefined;
      const lastMessageContent =
        typeof lastMessage?.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage?.content)
            ? lastMessage.content
                .map((block: any) =>
                  typeof block?.text === "string"
                    ? block.text.length
                    : typeof block?.content === "string"
                      ? block.content.length
                      : 0,
                )
                .join(",")
            : "";

      const stateFingerprint = `${currentHistoryLength}-${lastMessage?.role || ""}-${lastMessageContent}`;

      if (this.lastSerializedHistory === stateFingerprint) {
        // console.log("[LuxurySpa] 🧊 History unchanged, skipping redundant disk I/O")
        this.pendingSave = false;
        return;
      }

      // console.log("[LuxurySpa] 💾 Persisting changes to disk...")

      this.compactSuccessfulNativeToolHistory();

      // Run disk saves in parallel but don't block the next turn if they're slow
      Promise.all([
        this.delegate.saveApiConversationHistory(),
        this.delegate.saveClineMessages(),
      ])
        .then(() => {
          const elapsed = Date.now() - start;
          this.lastSerializedHistory = stateFingerprint;
          this.lastSaveTime = Date.now();
          // console.log(`[LuxurySpa] ✅ Background save completed in ${elapsed}ms`)
        })
        .catch((err) => {
          console.error("[LuxurySpa] ❌ Background save failed:", err);
        })
        .finally(() => {
          this.pendingSave = false;
        });

      this.saveTimer = null;
    }, 30); // Aggressive 30ms debounce
  }

  /**
   * ⚡ FAST PATH: Incrementally update only the most recent tool results.
   * This skips the full history scan when we know exactly which messages to update.
   */
  /**
   * ⚡ FAST PATH: Incrementally update only the most recent tool results.
   * This uses the hot cache and tracked indices to skip history scanning entirely.
   */
  public async refreshIncrementally(filePaths: string[]) {
    if (filePaths.length === 0) return;

    // Prune stale hot cache before starting
    this.pruneHotCache();

    // Narrow work to files that actually have tracked latest indices
    const tracked = filePaths.filter((filePath) => {
      if (!this.latestToolResultIndices.has(filePath)) return false;
      return this.activeFileReads.has(filePath) || this.hotCache.has(filePath);
    });

    if (tracked.length === 0) return;

    // console.log(`[LuxurySpa] ⚡ Fast incremental refresh for ${tracked.length} files...`)
    await this.refreshAllActiveContexts(true, tracked);

    for (const filePath of tracked) {
      const normalized = this.normalizeTrackedPath(filePath);
      this.dirtyFiles.delete(filePath);
      this.dirtyFiles.delete(normalized);
    }

    // Note: refreshAllActiveContexts already schedules the batched save
  }

  /**
   * 🎯 SMART REFRESH: Automatically choose between incremental and full refresh.
   */
  public async smartRefresh(recentlyReadFiles?: string[]) {
    if (this.activeFileReads.size === 0) return;

    const dirtyCandidates = new Set<string>();
    for (const filePath of this.dirtyFiles) {
      dirtyCandidates.add(this.normalizeTrackedPath(filePath));
    }
    for (const filePath of recentlyReadFiles ?? []) {
      dirtyCandidates.add(this.normalizeTrackedPath(filePath));
    }

    if (!this.hasPendingStructuralRefresh && dirtyCandidates.size === 0) {
      return;
    }

    const dirtyTrackedFiles = Array.from(this.activeFileReads.keys()).filter(
      (filePath) => dirtyCandidates.has(this.normalizeTrackedPath(filePath)),
    );

    if (
      !this.hasPendingStructuralRefresh &&
      dirtyTrackedFiles.length > 0 &&
      dirtyTrackedFiles.length <= 10 &&
      dirtyTrackedFiles.every((f) => this.latestToolResultIndices.has(f))
    ) {
      // console.log("[LuxurySpa] 🎯 Using fast incremental path")
      await this.refreshIncrementally(dirtyTrackedFiles);
      return;
    }

    // Fall back to full refresh
    // console.log("[LuxurySpa] 🎯 Using full refresh path")
    await this.refreshAllActiveContexts();

    this.hasPendingStructuralRefresh = false;
    this.dirtyFiles.clear();
  }

  /**
   * Flush any pending batched saves immediately.
   */
  public async flushPendingSaves() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.pendingSave) {
      await Promise.all([
        this.delegate.saveApiConversationHistory(),
        this.delegate.saveClineMessages(),
        this.delegate.postStateToWebview(),
      ]);
      this.pendingSave = false;
    }
  }

  /** Legacy helper for single file refresh */
  public async updateFileContext(
    filePath: string,
    preferredLineRanges?: { start: number; end: number }[],
  ) {
    if (preferredLineRanges) {
      this.mergeLineRanges(filePath, preferredLineRanges);
    }
    await this.refreshAllActiveContexts();
  }

  /**
   * Merge new line ranges into the existing active file reads.
   * Overlapping or adjacent ranges are combined.
   * Passing undefined for newRanges tracks it as a full file read (overrides partials).
   */
  public mergeLineRanges(
    filePath: string,
    newRanges: { start: number; end: number }[] | undefined,
  ) {
    const normalizedPath = this.normalizeTrackedPath(filePath);

    this.normalizedActivePathsCache.set(
      filePath,
      path.normalize(path.resolve(this.delegate.cwd, filePath)),
    );
    this.normalizedActivePathsCache.set(
      normalizedPath,
      path.normalize(path.resolve(this.delegate.cwd, normalizedPath)),
    );

    const existingState = this.getTrackedReadState(normalizedPath);
    const existing = existingState.ranges;

    if (newRanges === undefined) {
      if (existingState.tracked && existing === undefined) {
        // Already tracking full file, keep it that way
        return;
      }
      this.setTrackedReadState(normalizedPath, undefined);
      this.markFileDirty(normalizedPath);
      return;
    }

    if (existingState.tracked && existing === undefined) {
      return;
    }

    if (!existing || existing.length === 0) {
      this.setTrackedReadState(
        normalizedPath,
        this.mergeAndNormalizeRanges(newRanges),
      );
      this.markFileDirty(normalizedPath);
      return;
    }

    // Merge logic
    const combined = [...existing, ...newRanges].sort(
      (a, b) => a.start - b.start,
    );
    const merged: { start: number; end: number }[] = [];
    if (combined.length > 0) {
      let current = { ...combined[0] };
      for (let i = 1; i < combined.length; i++) {
        if (combined[i].start <= current.end + 1) {
          current.end = Math.max(current.end, combined[i].end);
        } else {
          merged.push(current);
          current = { ...combined[i] };
        }
      }
      merged.push(current);
    }

    const changed =
      !existing ||
      existing.length !== merged.length ||
      existing.some(
        (range, index) =>
          range.start !== merged[index].start ||
          range.end !== merged[index].end,
      );

    this.setTrackedReadState(normalizedPath, merged);

    if (changed) {
      this.markFileDirty(normalizedPath);
    }
  }

  public hasTrackedRead(filePath: string) {
    const normalizedPath = this.normalizeTrackedPath(filePath);
    if (
      this.activeFileReads.has(filePath) ||
      this.activeFileReads.has(normalizedPath)
    ) {
      return true;
    }

    const targetPathKey = this.getPlatformPathKey(filePath);
    for (const trackedPath of this.activeFileReads.keys()) {
      if (this.getPlatformPathKey(trackedPath) === targetPathKey) {
        return true;
      }
    }

    return false;
  }

  /**
   * Track a file as a full read only when it is not already tracked.
   * This preserves existing partial read ranges during edit-triggered refreshes.
   */
  public ensureTrackedFullRead(filePath: string) {
    if (this.hasTrackedRead(filePath)) {
      return;
    }

    this.mergeLineRanges(filePath, undefined);
  }

  /** Internal sync fallback for when disk read fails */
  public stripFileContextSync(filePath: string) {
    for (let i = this.delegate.apiConversationHistory.length - 1; i >= 0; i--) {
      const msg = this.delegate.apiConversationHistory[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_result" && (block as any).content) {
            const assistantMsg = this.delegate.apiConversationHistory[i - 1];
            if (
              assistantMsg &&
              assistantMsg.role === "assistant" &&
              Array.isArray(assistantMsg.content)
            ) {
              const toolUse = assistantMsg.content.find(
                (b: any) => b.type === "tool_use" && b.id === block.tool_use_id,
              );
              if (
                toolUse &&
                ((toolUse as any).name === "read" ||
                  (toolUse as any).name === "read")
              ) {
                const input = (toolUse as any).input || {};
                const readPaths: string[] = [];
                if (input.path) readPaths.push(input.path);
                if (input.files && Array.isArray(input.files)) {
                  readPaths.push(
                    ...input.files.map((f: any) => f.path).filter(Boolean),
                  );
                }
                if (readPaths.includes(filePath)) {
                  (block as any).content =
                    `[Stale read of ${filePath} removed due to read error.]`;
                }
              }
            }
          }
        }
      }
    }
  }

  public pruneEnvironmentDetailsFromHistory() {
    // Iterate through history and strip environment context from previous user messages
    for (let i = 0; i < this.delegate.apiConversationHistory.length; i++) {
      const msg = this.delegate.apiConversationHistory[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            // Handle new markdown format
            if (block.text.includes("## Environment Context")) {
              block.text = block.text.replace(
                /## Environment Context[\s\S]*?(?=\n## |$)/g,
                "## Environment Context\n(Snapshot stripped to save tokens. See latest turn for current context.)\n",
              );
            }
            // Handle old XML format for backward compatibility
            if (block.text.includes("<environment_details>")) {
              block.text = block.text.replace(
                /<environment_details>[\s\S]*?<\/environment_details>/g,
                "<environment_details>\n(Snapshot stripped to save tokens. See latest turn for current context.)\n</environment_details>",
              );
            }
          }
        }
      }
    }
  }

  public pruneTerminalOutputFromHistory() {
    let userMessagesSeen = 0;
    // Iterate backwards through history
    for (let i = this.delegate.apiConversationHistory.length - 1; i >= 0; i--) {
      const msg = this.delegate.apiConversationHistory[i];
      if (msg.role === "user") {
        userMessagesSeen++;

        // Only prune outputs older than 4 user turns
        if (userMessagesSeen > 4 && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && (block as any).content) {
              // Determine if this was a terminal tool
              const assistantMsg = this.delegate.apiConversationHistory[i - 1];
              if (
                assistantMsg &&
                assistantMsg.role === "assistant" &&
                Array.isArray(assistantMsg.content)
              ) {
                const toolUse = assistantMsg.content.find(
                  (b: any) =>
                    b.type === "tool_use" && b.id === block.tool_use_id,
                );
                if (toolUse && (toolUse as any).name === "bash") {
                  const content = (block as any).content;
                  if (typeof content === "string" && content.length > 800) {
                    // console.log(`[LuxurySpa] Truncating old terminal output (${content.length} chars)`)
                    (block as any).content =
                      content.substring(0, 800) + "\n\n--- truncated.";
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  public async updateStaleReads(filePath: string) {
    // When a file is edited, we UPDATE OLD read results to latest version.
    // refreshAllActiveContexts already handles this globally
    await this.refreshAllActiveContexts();
  }

  private isOffsetInsideStructuredEditResult(
    source: string,
    offset: number,
  ): boolean {
    const lastEditStart = source.lastIndexOf("<<<EDIT_RESULT", offset);
    if (lastEditStart !== -1) {
      const lastEditEnd = source.lastIndexOf("<<<END_EDIT_RESULT>>>", offset);
      if (lastEditStart > lastEditEnd) {
        return true;
      }
    }

    const plainEditStart = source.lastIndexOf("[EDIT for '", offset);
    if (plainEditStart !== -1) {
      const plainEditEnd = source.indexOf("\nEOF", plainEditStart);
      if (plainEditEnd !== -1 && offset < plainEditEnd + "\nEOF".length) {
        return true;
      }
    }

    const compactUnifiedEditStart = source.lastIndexOf('@edit: "', offset);
    if (compactUnifiedEditStart !== -1) {
      const startsOnNewLine =
        compactUnifiedEditStart === 0 ||
        source[compactUnifiedEditStart - 1] === "\n";
      if (startsOnNewLine) {
        const remainder = source.slice(compactUnifiedEditStart + 1);
        const nextToolMatch = remainder.match(/\n@[a-z_][a-z0-9_-]*:/i);
        const compactUnifiedEditEnd =
          nextToolMatch && nextToolMatch.index !== undefined
            ? compactUnifiedEditStart + 1 + nextToolMatch.index
            : source.length;
        const compactUnifiedEditBody = source.slice(
          compactUnifiedEditStart,
          compactUnifiedEditEnd,
        );
        if (
          compactUnifiedEditBody.includes('\n"') &&
          offset < compactUnifiedEditEnd
        ) {
          return true;
        }
      }
    }

    const compactEditStart = source.lastIndexOf("Edit ", offset);
    if (compactEditStart === -1) {
      return false;
    }

    const startsOnNewLine =
      compactEditStart === 0 || source[compactEditStart - 1] === "\n";
    if (!startsOnNewLine) {
      return false;
    }

    const compactEditEnd = source.indexOf("\nEOF", compactEditStart);
    if (compactEditEnd === -1 || offset >= compactEditEnd + "\nEOF".length) {
      return false;
    }

    return source
      .slice(compactEditStart, compactEditEnd)
      .includes("\nSearch ");
  }

  /**
   * Helper for async string replacement with regex.
   */
  private async asyncReplace(
    str: string,
    regex: RegExp,
    replacer: (match: string, ...args: any[]) => Promise<string>,
  ): Promise<string> {
    const matches = [];
    let match;
    // Reset regex index
    regex.lastIndex = 0;
    while ((match = regex.exec(str)) !== null) {
      matches.push(match);
    }

    // Process matches in REVERSE order since we are doing a backward history scan
    // This ensures that the "latest" content (further down in a message) is marked first.
    matches.reverse();

    let result = str;
    // When processing reversed matches, we don't need a running offset
    // because we are replacing from back to front, which keeps indices stable for earlier matches.
    for (const m of matches) {
      const matchIndex = (m as any).index;
      const replacement = await replacer(
        m[0],
        ...m.slice(1).map((x) => x || ""),
        matchIndex,
      );
      result =
        result.slice(0, matchIndex) +
        replacement +
        result.slice(matchIndex + m[0].length);
    }
    return result;
  }
}
