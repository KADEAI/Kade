import path from "path";
import { promises as fs } from "fs";

import * as vscode from "vscode";

import { Task } from "../task/Task";
import { ClineSayTool } from "../../shared/ExtensionMessage";
import { getReadablePath, resolveRecursivePath } from "../../utils/path";
import { isPathOutsideWorkspace } from "../../utils/pathUtils";
import { getBinPath, execRipgrep } from "../../services/ripgrep";
import { BaseTool, ToolCallbacks } from "./BaseTool";
import { buildGrepIgnoreGlobs } from "./searchFilesIgnoreGlobs";
import type { ToolUse } from "../../shared/tools";
import { findLastIndex } from "../../shared/array";

interface GrepParams {
  path: string;
  query: string | string[]; // Support both single query and multiple queries
  recursive_resolution?: boolean; // Internal flag to indicate if paths have been resolved
  file_pattern?: string | null;
  include?: string | null; // kilocode_change: Support 'include'
  exclude?: string | null; // kilocode_change: Support 'exclude'
  include_all?: boolean; // Whether to include docs, locales, generated files, assets, etc.
  context_lines?: number; // Configurable context lines
  literal?: boolean; // Whether to treat query as literal string
  whole_word?: boolean; // Whether to match whole words only
  case_insensitive?: boolean; // kilocode_change: Support 'case_insensitive'
  tests?: boolean; // Whether to include test files while still filtering non-code noise
  multiline?: boolean; // Whether to enable multiline regex matching (-U flag)
}

export class GrepTool extends BaseTool<"grep"> {
  readonly name = "grep" as const;
  private readonly MAX_TOTAL_MATCHES = 150;
  private readonly MAX_LINE_LENGTH = 300;

  /**
   * Parse ripgrep JSON output and convert to grouped path/line format
   * for cleaner display in logs and UI.
   *
   * Performance notes:
   *  - Uses a single running `totalMatches` counter (O(1) per match) instead of
   *    re-summing all buckets on every insert (previously O(n*m)).
   *  - Returns the unique match count directly so callers don't have to re-parse
   *    the formatted string to obtain it.
   */
  private async parseRipgrepJsonOutput(
    jsonOutput: string,
    cwd: string,
    maxMatches?: number,
  ): Promise<{ output: string; count: number }> {
    const lines = jsonOutput.split("\n");
    const matchesByFile = new Map<string, { line_number: number, content: string }[]>();
    const limit = maxMatches ?? this.MAX_TOTAL_MATCHES;
    let totalMatches = 0; // O(1) running counter — no re-sum on every match

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.startsWith("{")) continue;

      try {
        const parsed = JSON.parse(trimmedLine);

        if (parsed.type === "match" || parsed.type === "context") {
          const {
            path: ripgrepPath,
            lines: content,
            line_number,
          } = parsed.data;
          const filePathRaw = ripgrepPath.text;
          const filePath = path.relative(cwd, filePathRaw);
          const rawText = content.text ?? "";
          // We don't trim the start so we can preserve indentation for readability,
          // but we do trim the end to remove trailing newlines.
          const lineContent = rawText.trimEnd().substring(0, this.MAX_LINE_LENGTH);
          const truncatedSuffix =
            rawText.length > this.MAX_LINE_LENGTH ? " [truncated]" : "";

          if (!matchesByFile.has(filePath)) {
            matchesByFile.set(filePath, []);
          }

          // Skip empty lines - they're just noise
          if (lineContent.trim()) {
            matchesByFile
              .get(filePath)!
              .push({
                line_number,
                content: `${lineContent}${truncatedSuffix}`
              });
            totalMatches++;
          }

          if (totalMatches >= limit) break;
        }
      } catch {
        console.warn(
          `Failed to parse JSON line: ${trimmedLine.substring(0, 50)}...`,
        );
      }
    }

    const formattedResults: string[] = [];
    let uniqueCount = 0;

    for (const [filePath, fileMatches] of matchesByFile.entries()) {
      // Get line count for the file
      const absolutePath = path.resolve(cwd, filePath);
      let lineCount = "?";
      try {
        const fileContent = await fs.readFile(absolutePath, "utf-8");
        lineCount = fileContent.split("\n").length.toString();
      } catch {
        // If we can't read the file, just skip the line count
      }
      
      formattedResults.push(`## ${filePath}|L${lineCount}`);
      
      // Deduplicate within the same file (context lines can overlap between adjacent matches)
      const uniqueMatchesStr = [...new Set(fileMatches.map(m => JSON.stringify(m)))];
      const uniqueMatches = uniqueMatchesStr.map(m => JSON.parse(m));
      
      // Group matches that are within 10 lines of each other
      const groupedMatches: Array<Array<{ line_number: number; content: string }>> = [];
      let currentGroup: Array<{ line_number: number; content: string }> = [];
      
      uniqueMatches.forEach((match, idx) => {
        if (currentGroup.length === 0) {
          currentGroup.push(match);
        } else {
          const lastMatch = currentGroup[currentGroup.length - 1];
          if (match.line_number - lastMatch.line_number <= 30) {
            currentGroup.push(match);
          } else {
            groupedMatches.push(currentGroup);
            currentGroup = [match];
          }
        }
        
        if (idx === uniqueMatches.length - 1 && currentGroup.length > 0) {
          groupedMatches.push(currentGroup);
        }
      });
      
      const maxLineNumLength = Math.max(...uniqueMatches.map(m => m.line_number.toString().length));
      
      groupedMatches.forEach((group, groupIdx) => {
        group.forEach((m) => {
          const paddedLineNum = m.line_number.toString().padStart(maxLineNumLength, " ");
          formattedResults.push(`  ${paddedLineNum}→${m.content}`);
        });
        
        if (groupIdx < groupedMatches.length - 1) {
          formattedResults.push("  ..."); // Ellipsis to indicate gap between groups
        }
      });
      
      formattedResults.push(""); // Spacer between files
      
      uniqueCount += uniqueMatches.length;
    }

    return { output: formattedResults.join("\n").trim(), count: uniqueCount };
  }

  parseLegacy(params: Partial<Record<string, string>>): GrepParams {
    return {
      path: params.path || "",
      query: params.regex || params.query || "", // Support both old and new param names
      file_pattern: params.file_pattern || undefined,
      context_lines: params.context_lines
        ? parseInt(params.context_lines)
        : undefined,
      literal: params.literal === "true",
      whole_word: params.whole_word === "true",
      multiline: params.multiline === "true",
    };
  }

  async execute(
    params: GrepParams,
    task: Task,
    callbacks: ToolCallbacks,
  ): Promise<void> {
    const { askApproval, handleError, pushToolResult } = callbacks;

    const relDirPath = params.path;
    const query = params.query;
    const filePattern = params.file_pattern || params.include || undefined; // kilocode_change: Support 'include' alias
    const excludePattern = params.exclude; // kilocode_change: Support 'exclude'
    const contextLines = params.context_lines || 1;
    const isLiteral = params.literal !== false; // Default to literal search to prevent regex crashes on special chars
    const isWholeWord = params.whole_word || false;
    const isCaseInsensitive = params.case_insensitive !== false; // kilocode_change: Default to case-insensitive (true)
    const includeAll = params.include_all || false;
    const includeTests = params.tests || false;
    const isMultiline = params.multiline || false;

    // Calculate per-query limit: divide total max by number of queries
    const queries = Array.isArray(query) ? query : [query];
    const perQueryLimit = Math.floor(this.MAX_TOTAL_MATCHES / queries.length);

    if (!relDirPath) {
      task.consecutiveMistakeCount++;
      task.recordToolError("grep");
      task.didToolFailInCurrentTurn = true;
      pushToolResult(await task.sayAndCreateMissingParamError("grep", "path"));
      return;
    }

    if (!query) {
      task.consecutiveMistakeCount++;
      task.recordToolError("grep");
      task.didToolFailInCurrentTurn = true;
      pushToolResult(await task.sayAndCreateMissingParamError("grep", "query"));
      return;
    }

    task.consecutiveMistakeCount = 0;

    // Split paths by comma and resolve each
    const rawPaths = relDirPath
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const resolvedPaths: string[] = [];

    for (const p of rawPaths) {
      const { resolvedPath } = await resolveRecursivePath(task.cwd, p);
      resolvedPaths.push(resolvedPath);
    }

    const relDirPaths = resolvedPaths;
    const absolutePaths = relDirPaths.map((p) => path.resolve(task.cwd, p));
    const isOutsideWorkspace = absolutePaths.some((p) =>
      isPathOutsideWorkspace(p),
    );

      const sharedMessageProps: ClineSayTool = {
        tool: "grep",
        path: relDirPaths.map((p) => getReadablePath(task.cwd, p)).join(", "),
        regex: Array.isArray(query) ? query.join("|") : query, // For display purposes
        filePattern: filePattern,
        isOutsideWorkspace,
        id: callbacks.toolCallId,
      };

    try {
      // Resolve the ripgrep binary path ONCE outside the query loop.
      // Previously this was called inside the loop, causing redundant filesystem
      // probes (up to 4 path checks per query) on every iteration.
      const vscodeAppRoot = vscode.env.appRoot;
      const rgPath = await getBinPath(vscodeAppRoot);

      if (!rgPath) {
        throw new Error("Could not find ripgrep binary");
      }

      /**
       * Build the argument list for a single query and execute ripgrep.
       * Keeping this as a local helper makes the parallel Promise.all below tidy.
       */
      const runSingleQuery = async (singleQuery: string): Promise<string> => {
        const rgArgs: string[] = ["--json", "--no-messages"];

        if (isLiteral) {
          rgArgs.push("-F");
        }

        if (isCaseInsensitive) {
          rgArgs.push("-i");
        }

        if (isWholeWord) {
          rgArgs.push("-w");
        }

        if (isMultiline) {
          rgArgs.push("-U"); // Enable multiline matching
        }

        // Tell ripgrep to stop after `perQueryLimit` matches per file.
        // This lets the subprocess exit early instead of emitting thousands
        // of JSON lines that we would just discard in the JS layer.
        rgArgs.push("--max-count", String(perQueryLimit));

        if (filePattern) {
          rgArgs.push("--glob", filePattern);
        }

        if (excludePattern) {
          rgArgs.push("--glob", `!${excludePattern}`);
        }

        rgArgs.push("--context", contextLines.toString());

        for (const glob of buildGrepIgnoreGlobs({ includeAll, includeTests })) {
          rgArgs.push("--glob", glob);
        }

        // Use -e so queries starting with "-" are never misread as flags
        rgArgs.push("-e", singleQuery);
        rgArgs.push(...absolutePaths);

        return execRipgrep(rgPath, rgArgs);
      };

      // Run all queries in parallel instead of sequentially.
      // For a single query this is a no-op; for multiple queries it avoids
      // waiting for each ripgrep subprocess to finish before starting the next.
      const rawResults = await Promise.all(queries.map(runSingleQuery));

      const querySegments: string[] = [];

      for (let i = 0; i < queries.length; i++) {
        const singleQuery = queries[i];
        const rawOutput = rawResults[i];

        if (!rawOutput) continue;

        // parseRipgrepJsonOutput now returns the unique match count directly,
        // so we no longer need to re-split and filter the formatted string.
        const { output: formattedResult, count: resultCount } =
          await this.parseRipgrepJsonOutput(rawOutput, task.cwd, perQueryLimit);

        if (!formattedResult) continue;

        let segment = `Query: "${singleQuery}"\n(${resultCount} matches, max ${perQueryLimit})\n${formattedResult}`;

        if (resultCount >= perQueryLimit) {
          segment += `\n[Reached per-query limit of ${perQueryLimit} results]`;
        }

        querySegments.push(segment);
      }

      const searchResults = `(file_name|L = total amount of lines in file)\n\n${querySegments.join("\n\n---\n\n")}`;

      const completeMessage = JSON.stringify({
        ...sharedMessageProps,
        content: searchResults,
      } satisfies ClineSayTool);
      const didApprove = await askApproval("tool", completeMessage);

      if (!didApprove) {
        return;
      }

      const enhancedPushToolResult = (content: any) => {
        pushToolResult(content);
        (async () => {
          try {
            const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
              try {
                const parsed = JSON.parse(m.text || "{}");
                return (
                  (m.say === "tool" || m.ask === "tool") &&
                  parsed.tool === "grep" &&
                  parsed.id === callbacks.toolCallId
                );
              } catch {
                return false;
              }
            });

            if (lastMsgIndex !== -1) {
              const msg = task.clineMessages[lastMsgIndex];
              const toolData = JSON.parse(msg.text || "{}");
              toolData.content = content;
              msg.text = JSON.stringify(toolData);
              await task.updateClineMessage(msg);
            }
          } catch (error) {
            console.error(`[grep] Failed to update UI: ${error}`);
          }
        })();
      };

      enhancedPushToolResult(searchResults);
    } catch (error) {
      await handleError("searching files", error as Error);
    }
  }

  override async handlePartial(task: Task, block: ToolUse<"grep">): Promise<void> {
    if (!block.partial) {
      return
    }

    const nativeArgs = block.nativeArgs as Partial<GrepParams> | undefined
    const relDirPath = nativeArgs?.path || block.params.path
    const queryValue = nativeArgs?.query || block.params.query || block.params.regex
    const query = Array.isArray(queryValue) ? queryValue.join("|") : queryValue
    const filePattern = nativeArgs?.file_pattern || nativeArgs?.include || block.params.file_pattern || block.params.include

    if (!relDirPath && !query) {
      return
    }

    const normalizedPath = this.removeClosingTag("path", relDirPath || "", block.partial)
    const absolutePath = normalizedPath ? path.resolve(task.cwd, normalizedPath) : task.cwd

    const sharedMessageProps: ClineSayTool = {
      tool: "grep",
      path: normalizedPath ? getReadablePath(task.cwd, normalizedPath) : "",
      regex: this.removeClosingTag("query", query || "", block.partial),
      filePattern,
      isOutsideWorkspace: normalizedPath ? isPathOutsideWorkspace(absolutePath) : false,
      id: block.id,
    }

    const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
    await task.say("tool", partialMessage, undefined, block.partial).catch(() => {})
  }
}

export const grepTool = new GrepTool();
