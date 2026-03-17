import * as fs from "fs";
import * as path from "path";
import { ClineMessage } from "@roo-code/types";
import { ApiMessage } from "../task-persistence";
import { addLineNumbers } from "../../integrations/misc/extract-text";

export interface LuxurySpaDelegate {
  cwd: string;
  apiConversationHistory: ApiMessage[];
  clineMessages: ClineMessage[];
  saveApiConversationHistory(): Promise<void>;
  postStateToWebview(): Promise<void>;
  saveClineMessages(): Promise<void>;
}

export class LuxurySpa {
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
   * Matches both unified format (File: path \n Lines X-Y: ...) and XML format (<file_content path="...">...</file_content>)
   */
  /**
   * Regex to identify file content blocks in conversation history for refreshing.
   * Optimized to prevent premature truncation on multi-line edits.
   */
  private static readonly blockRegex =
    /(?:(?:\[(?:read|read_file)\s+for\s+'.*?'\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+)?(?:File:\s+|file:\/\/\/|<path>)(.*?)(?:<\/path>|\r?\n|$)|<file_content\s+path="([^"]+)">)([\s\S]*?)(?:(?=<\/file_content>)<\/file_content>|(?=\r?\n(?:\[read(?:_file)?\s+for\s+'.*?'\]\s+Result|File:|file:\/\/\/|<path>|<file_content)|$))/gi;

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

  private markFileDirty(filePath: string) {
    this.dirtyFiles.add(this.normalizeTrackedPath(filePath));
  }

  private markStructuralRefreshNeeded() {
    this.hasPendingStructuralRefresh = true;
  }

  public removeTrackedFile(filePath: string) {
    const normalizedPath = this.normalizeTrackedPath(filePath);
    this.activeFileReads.delete(filePath);
    if (normalizedPath !== filePath) {
      this.activeFileReads.delete(normalizedPath);
    }
    this.normalizedActivePathsCache.delete(filePath);
    this.normalizedActivePathsCache.delete(normalizedPath);
    this.dirtyFiles.delete(filePath);
    this.dirtyFiles.delete(normalizedPath);
    this.latestToolResultIndices.delete(filePath);
    this.latestToolResultIndices.delete(normalizedPath);
    this.markStructuralRefreshNeeded();
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

    const formatRanges = (
      lines: string[],
      ranges: { start: number; end: number }[],
    ) => {
      const rangeContents: string[] = [];
      for (const range of ranges) {
        const start = Math.max(1, range.start);
        const end = Math.min(lines.length, range.end);
        const rangeLines = lines.slice(start - 1, end);
        const numberedContent = rangeLines
          .map((line, idx) => `${start + idx}→${line}`)
          .join("\n");
        rangeContents.push(`Lines ${start}-${end}:\n${numberedContent}`);
      }
      return rangeContents.join("\n\n");
    };

    const formatRangesXml = (
      lines: string[],
      ranges: { start: number; end: number }[],
    ) => {
      const rangeContents: string[] = [];
      for (const range of ranges) {
        const start = Math.max(1, range.start);
        const end = Math.min(lines.length, range.end);
        const rangeLines = lines.slice(start - 1, end);
        const numberedContent = rangeLines
          .map((line, idx) => `${start + idx}→${line}`)
          .join("\n");
        rangeContents.push(
          `<content lines="${start}-${end}">\n${numberedContent}</content>`,
        );
      }
      return rangeContents.join("\n");
    };

    // Track which files have found their "latest" version during the backward scan
    const foundLatestFiles = new Set<string>();
    // Track ranges already seen to strip redundant partials
    const foundFileRanges = new Map<string, { start: number; end: number }[]>();
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
          ? msg.content.includes("File:") ||
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
                  text.includes("File:") ||
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
              pathGroup1: string,
              pathGroup2: string,
              contentStr: string,
              offset: number,
            ) => {
              const pathStr = (pathGroup1 || pathGroup2 || "")
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
                foundLatestFiles.add(targetFilePath); // Ensure UI sync picks it up

                const header = match.startsWith("<file_content")
                  ? `<file_content path="${pathStr}">`
                  : `File: ${pathStr}`;
                const wrapperMatch = match.match(
                  /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
                );
                let fullHeader = header;
                if (wrapperMatch && !match.startsWith("<file_content"))
                  fullHeader = wrapperMatch[0] + header;
                const footer = match.startsWith("<file_content")
                  ? "\n</file_content>"
                  : "";

                return `${fullHeader}\n[File not found or deleted]${footer}`;
              }

              // Parse ranges from both unified format (Lines X-Y:) and XML format (<content lines="X-Y">)
              const unifiedRangeMatches = [
                ...contentStr.matchAll(/Lines (\d+)-(\d+):/g),
              ];
              const xmlRangeMatches = [
                ...contentStr.matchAll(
                  /<content[^>]*lines="(\d+)-(\d+)"[^>]*>/g,
                ),
              ];

              const hasRanges =
                unifiedRangeMatches.length > 0 || xmlRangeMatches.length > 0;
              const isLatest = !foundLatestFiles.has(targetFilePath);
              const isXmlFormat = xmlRangeMatches.length > 0;

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
                // Be lenient with line counts (off by 2 is safer for trailing whitespace/newlines)
                if (start === 1 && end >= fileData.total - 2) {
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
                  contentToUse = isXmlFormat
                    ? formatRangesXml(fileData.lines, ranges)
                    : formatRanges(fileData.lines, ranges);
                  // Add to covered ranges
                  foundFileRanges.set(targetFilePath, [
                    ...existingRanges,
                    ...ranges,
                  ]);
                }
              } else if (isLatest) {
                // This is the most recent full read or mention
                foundLatestFiles.add(targetFilePath);
                // Mark as fully covered for partials too
                foundFileRanges.set(targetFilePath, [
                  { start: 1, end: fileData.total },
                ]);

                const preferred = this.activeFileReads.get(targetFilePath);
                if (preferred && preferred.length > 0) {
                  contentToUse = isXmlFormat
                    ? formatRangesXml(fileData.lines, preferred)
                    : formatRanges(fileData.lines, preferred);
                } else {
                  if (isXmlFormat) {
                    contentToUse = `<content lines="1-${fileData.total}">\n${addLineNumbers(fileData.lines.join("\n"))}</content>\n`;
                  } else {
                    contentToUse = `Lines 1-${fileData.total}:\n${addLineNumbers(fileData.lines.join("\n"))}`;
                    // Use formatRanges to get sticky headers for full file read
                    contentToUse = formatRanges(fileData.lines, [
                      { start: 1, end: fileData.total },
                    ]);
                  }
                }
              } else {
                // Older full read - strip it
                shouldStrip = true;
                contentToUse = `[Older version of ${targetFilePath} stripped to save tokens. See later in history for current content.]`;
              }

              const header = match.startsWith("<file_content")
                ? `<file_content path="${pathStr}">`
                : `File: ${pathStr}`;
              const wrapperMatch = match.match(
                /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
              );
              let fullHeader = header;
              if (wrapperMatch && !match.startsWith("<file_content"))
                fullHeader = wrapperMatch[0] + header;

              const footer = match.startsWith("<file_content")
                ? "\n</file_content>"
                : "";

              if (shouldStrip) return `${fullHeader}\n${contentToUse}${footer}`;

              // Add edit suffix if applicable
              const pathKey =
                process.platform === "win32"
                  ? partAbsolutePath.toLowerCase()
                  : partAbsolutePath;
              const editCount = this.fileEditCounts.get(pathKey) || 0;
              let suffix = "";
              if (editCount > 0) {
                const advisory = `This earlier read result has been refreshed to reflect your latest edit. Review Edit #${editCount} later in this chat for the exact blocks that were applied, and see the "Old Blocks" section there if you need the previous content for comparison.`;
                suffix = match.startsWith("<file_content")
                  ? `\n(${advisory})`
                  : `\n\n[${advisory}]`;
              }

              return `${fullHeader}\n${contentToUse}${suffix}${footer}`;
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

        // Sync UI messages if needed.
        // Since apiConversationHistory and clineMessages timestamps rarely match perfectly,
        // we search for messages whose content contains the headers we just refreshed.
        const updatedPathStrs = Array.from(foundLatestFiles);
        const updatedPathEntries = updatedPathStrs.map((pathStr) => ({
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
              updatedText.includes(`File: ${pathStr}`) ||
              updatedText.includes(`path="${pathStr}"`) ||
              updatedText.includes(absPathStr),
          );
          if (!maybeRelevant) continue;

          updatedText = await this.asyncReplace(
            updatedText,
            LuxurySpa.blockRegex,
            async (match: string, p1: string, p2: string, content: string) => {
              const matchPath = (p1 || p2 || "")
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
              const wrapper = match.match(
                /^\[.*?\]\s+Result(?:\s+\(id:\s+\[mention\]\))?:\s+/,
              );
              const h = isXml
                ? `<file_content path="${target.pathStr}">`
                : `File: ${target.pathStr}`;
              const fh = wrapper && !isXml ? wrapper[0] + h : h;
              const f = isXml ? "\n</file_content>" : "";

              if (!fileData) {
                clineMsgModified = true;
                return `${fh}\n[File not found or deleted]${f}`;
              }

              const preferred = this.activeFileReads.get(target.pathStr);
              const editCount = this.fileEditCounts.get(target.absPathStr) || 0;

              let refreshed: string;
              if (preferred && preferred.length > 0) {
                refreshed = isXml
                  ? formatRangesXml(fileData.lines, preferred)
                  : formatRanges(fileData.lines, preferred);
              } else {
                refreshed = isXml
                  ? `<content lines="1-${fileData.total}">\n${addLineNumbers(fileData.lines.join("\n"))}</content>\n`
                  : `Lines 1-${fileData.total}:\n${addLineNumbers(fileData.lines.join("\n"))}`;

                // Use formatRanges for sticky headers
                if (!isXml) {
                  refreshed = formatRanges(fileData.lines, [
                    { start: 1, end: fileData.total },
                  ]);
                }
              }

              const advisory = `This earlier read result has been rewritten to reflect your latest edit. Review Edit #${editCount} later in this chat for the exact blocks that were applied, and see the "Old Blocks" section there if you need the previous content for comparison.`;
              const s = isXml ? `\n(${advisory})` : `\n\n[${advisory}]`;

              clineMsgModified = true;
              return `${fh}\n${refreshed}${editCount > 0 ? s : ""}${f}`;
            },
          );

          if (clineMsgModified) {
            clineMsg.text = updatedText;
          }
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

    const existing =
      this.activeFileReads.get(filePath) ??
      this.activeFileReads.get(normalizedPath);

    if (newRanges === undefined) {
      if (existing === undefined && this.activeFileReads.has(normalizedPath)) {
        return;
      }
      this.activeFileReads.delete(filePath);
      this.activeFileReads.set(normalizedPath, undefined);
      this.markFileDirty(normalizedPath);
      return;
    }

    if (existing === undefined && this.activeFileReads.has(normalizedPath)) {
      // Already tracking full file, keep it that way
      return;
    }

    if (!existing || existing.length === 0) {
      this.activeFileReads.delete(filePath);
      this.activeFileReads.set(normalizedPath, [...newRanges]);
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

    this.activeFileReads.delete(filePath);
    this.activeFileReads.set(normalizedPath, merged);

    if (changed) {
      this.markFileDirty(normalizedPath);
    }
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
                ((toolUse as any).name === "read_file" ||
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
                if (toolUse && (toolUse as any).name === "execute_command") {
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
