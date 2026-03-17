import { ToolName, ToolUse, McpToolUse } from "../../shared/tools";
import { AssistantMessageContent } from "./parseAssistantMessage";
import { populateToolParamsFromXmlArgs } from "./XmlToolParser";

export class UnifiedToolCallParser {
  private pendingBuffer = "";
  private finalizedBlocks: AssistantMessageContent[] = [];
  private bufferStartIndex = 0;
  private mcpToolNames: Map<string, { serverName: string; toolName: string }> =
    new Map();
  private toolCounter = 0; // Increments for each NEW tool block encountered

  constructor() { }

  private static readonly CONTENT_TOOL_SHORT_NAMES = new Set([
    "write",
    "edit",
    "write_to_file",
    "edit_file",
    "new_rule",
    "todo",
    "wrap",
    "W",
    "E",
    "T",
  ]);

  private static readonly STRICT_TOOL_SHORT_NAMES = new Set([
    "edit",
    "write",
    "edit_file",
    "write_to_file",
    "new_rule",
    "todo",
    "wrap",
    "E",
    "W",
    "T",
  ]);

  private static readonly SINGLE_LETTER_TOOL_CLOSERS = new Set([
    "R",
    "E",
    "W",
    "M",
    "V",
    "L",
    "G",
    "F",
    "S",
    "B",
    "X",
    "Y",
    "Z",
    "U",
    "T",
    "D",
  ]);

  private static readonly KNOWN_TOOL_SHORT_NAMES = new Set([
    "read",
    "edit",
    "write",
    "ls",
    "glob",
    "grep",
    "search",
    "cmd",
    "execute_command",
    "todo",
    "done",
    "web",
    "research",
    "fetch",
    "browse",
    "click",
    "type",
    "scroll",
    "image",
    "ask",
    "edit_file",
    "new_rule",
    "report_bug",
    "agent",
    "run_sub_agent",
    "condense",
    "sub",
    "diff",
    "delete",
    "delete_file",
    "fast_context",
    "context",
    "mv",
    "move",
    "rename",
    "browser_action",
    "browser",
    "semgrep",
    "wrap",
    "mkdir",
    "find",
    "R",
    "E",
    "W",
    "M",
    "V",
    "L",
    "G",
    "F",
    "S",
    "B",
    "X",
    "Y",
    "Z",
    "U",
    "T",
    "D",
    "use_mcp_tool",
    "access_mcp_resource",
  ]);

  private static readonly TOOL_START_REGEX =
    /(?:(?:^|(?<=[\s]))(?<!\\)([A-Z])(?:[ \t]+((?:(?!\s*\/[A-Z](?:\s|$))[^\r\n])*?))?(?:\s*\/([A-Z]))?[ \t]*(?:\r?\n|$))|(?:<((?:use_mcp_tool|access_mcp_resource))>)/gm;
  private static readonly TRIM_TOOL_START_REGEX =
    /(?:(?:^|(?<=[\s]))(?<!\\)([A-Z])(?:[ \t]+((?:(?!\s*\/[A-Z](?:\s|$))[^\r\n])*?))?(?:\s*\/([A-Z]))?[ \t]*(?:\r?\n|$))|(?:<((?:use_mcp_tool|access_mcp_resource))>)/gm;
  private static readonly NEXT_SINGLE_LETTER_TOOL_REGEX =
    /(?:^|\s+)(?<!\\)([A-Z])(?:[ \t]+[^\r\n]*?)?(?:\r?\n|$)/;

  private splitPipe(input: string[] | string): string | string[] {
    const arr = Array.isArray(input) ? input : [input];
    if (arr.length === 1 && arr[0].includes("|")) {
      return arr[0]
        .split("|")
        .map((q) => q.trim())
        .filter(Boolean);
    }
    return arr.length > 1 ? arr : arr[0];
  }

  /**
   * Register MCP tool names so the parser can recognize them.
   * Accepts an array of {compositeName, serverName, toolName} objects.
   */
  public setMcpToolNames(
    tools: Array<{
      compositeName: string;
      serverName: string;
      toolName: string;
    }>,
  ) {
    this.mcpToolNames = new Map(
      tools.map((t) => [
        t.compositeName,
        { serverName: t.serverName, toolName: t.toolName },
      ]),
    );
  }

  private isRegisteredMcpTool(toolName: string): boolean {
    return (
      this.mcpToolNames.has(toolName) ||
      this.mcpToolNames.has(toolName.replace(/-/g, "_"))
    );
  }

  private isFinalized = false;
  private hasFinalizedTool = false;
  private currentTurnId = Date.now().toString();

  /**
   * Returns true if a tool call has been finalized (closed) in this turn.
   * Used by AgentLoop to stop accumulating trailing text after tool calls.
   */
  public hasCompletedToolCall(): boolean {
    return this.hasFinalizedTool;
  }

  public reset() {
    this.pendingBuffer = "";
    this.finalizedBlocks = [];
    this.bufferStartIndex = 0;
    this.isFinalized = false;
    this.hasFinalizedTool = false;
    this.currentTurnId = Date.now().toString();
    this.toolCounter = 0;
  }

  public processChunk(chunk: string): {
    blocks: AssistantMessageContent[];
    safeIndex: number;
  } {
    this.pendingBuffer += chunk;
    const { finalized, pending, safeIndex } = this.parseMessage(
      this.pendingBuffer,
      false,
    );
    if (safeIndex > 0 || finalized.length > 0) {
      this.finalizedBlocks.push(...finalized);
      this.pendingBuffer = this.pendingBuffer.slice(safeIndex);
      this.bufferStartIndex += safeIndex;
    }

    return {
      blocks: [...this.finalizedBlocks, ...pending],
      safeIndex,
    };
  }

  public finalizeContentBlocks(): void {
    this.isFinalized = true;
    // Parse everything remaining as final
    const { finalized, pending } = this.parseMessage(this.pendingBuffer, true);
    // Everything returned is finalized (since isFinalized=true)
    this.finalizedBlocks.push(...finalized, ...pending);
    this.pendingBuffer = "";
  }

  public getContentBlocks(): AssistantMessageContent[] {
    const { finalized, pending } = this.parseMessage(
      this.pendingBuffer,
      this.isFinalized,
    );
    return [...this.finalizedBlocks, ...finalized, ...pending];
  }

  public trimRawMessageAfterLastCompletedTool(message: string): string {
    let lastCompletedToolEnd = -1;

    const knownToolShortNames = UnifiedToolCallParser.KNOWN_TOOL_SHORT_NAMES;
    const toolStartRegex = new RegExp(
      UnifiedToolCallParser.TRIM_TOOL_START_REGEX,
    );
    let match: RegExpExecArray | null;

    while ((match = toolStartRegex.exec(message)) !== null) {
      let toolShortName = match[1] || match[4];
      let argsStr = (match[2] || "").trim();
      const isXml = !!match[4];

      if (toolShortName.startsWith("tool_")) {
        toolShortName = toolShortName.slice(5);
      }

      const isMcpTool = this.isRegisteredMcpTool(toolShortName);
      if (!knownToolShortNames.has(toolShortName) && !isMcpTool) {
        continue;
      }

      const startIndex = match.index;
      let startTagEndIndex = startIndex + match[0].length;
      let isOneLiner = !!match[3];
      const remaining = message.slice(startTagEndIndex);
      const isCompact =
        argsStr.startsWith("(") ||
        (!argsStr.trim() && remaining.trimStart().startsWith("("));

      if (isCompact) {
        if (!argsStr.trim()) {
          const wsMatch = remaining.match(/^\s+/);
          if (wsMatch) startTagEndIndex += wsMatch[0].length;
        }

        const parenSearch = message.slice(startTagEndIndex);
        if (parenSearch.startsWith("(")) {
          let depth = 0;
          let quote: string | null = null;
          let escape = false;
          let foundEnd = false;
          for (let i = 0; i < parenSearch.length; i++) {
            const char = parenSearch[i];
            if (escape) {
              escape = false;
              continue;
            }
            if (char === "\\") {
              escape = true;
              continue;
            }
            if (quote) {
              if (char === quote) quote = null;
              continue;
            }
            if (char === '"' || char === "'" || char === "`") {
              quote = char;
              continue;
            }
            if (char === "(") depth++;
            else if (char === ")") {
              depth--;
              if (depth === 0) {
                argsStr = parenSearch.slice(1, i);
                startTagEndIndex += i + 1;
                foundEnd = true;
                break;
              }
            }
          }
          if (!foundEnd) {
            break;
          }
        }

        isOneLiner = true;
      }

      const isContentTool =
        UnifiedToolCallParser.CONTENT_TOOL_SHORT_NAMES.has(toolShortName);
      if (isContentTool && !isOneLiner) {
        const explicitCloserRegex = new RegExp(`\\/?${toolShortName}$`);
        const trimmedArgs = argsStr.trim();
        const closerMatch = trimmedArgs.match(explicitCloserRegex);
        if (closerMatch) {
          isOneLiner = true;
          argsStr = trimmedArgs.slice(0, -closerMatch[0].length).trim();
        }
      }

      let endIndex = -1;
      if (isOneLiner) {
        endIndex = startTagEndIndex;
      } else {
        const remainingText = message.slice(startTagEndIndex);
        let closingRegex: RegExp;
        if (
          [
            "edit",
            "write",
            "edit_file",
            "write_to_file",
            "todo",
            "wrap",
            "E",
            "W",
            "T",
          ].includes(toolShortName)
        ) {
          const closer =
            toolShortName === "E" || toolShortName === "edit"
              ? "edit"
              : toolShortName === "W" || toolShortName === "write"
                ? "write"
                : toolShortName === "T" || toolShortName === "todo"
                  ? "todo"
                  : toolShortName;
          closingRegex = new RegExp(
            `(?:^|[\\r\\n])[ \\t]*(?<!\\\\)\\/${closer}(?:[ \\t]*(?:[\\r\\n]|$))`,
          );
        } else if (isXml) {
          closingRegex = new RegExp(`(?:^|[\\r\\n])[ \t]*<\\/${toolShortName}>(?:[ \\t]*(?:[\\r\\n]|$))`);
        } else if (toolShortName.length === 1 && /[A-Z]/.test(toolShortName)) {
          closingRegex = new RegExp(
            `(?:^|[\\r\\n])[ \t]*(?<!\\\\)\\/[${toolShortName}${toolShortName.toLowerCase()}](?=$|[ \\t]|[\\r\\n])`,
          );
        } else {
          closingRegex = /$^/;
        }
        const endMatch = remainingText.match(closingRegex);
        const isStrictTool =
          UnifiedToolCallParser.STRICT_TOOL_SHORT_NAMES.has(toolShortName);

        let actualEndMatch = endMatch;
        let isImplicitClose = false;
        let consumeClosingMatch = true;

        if (!actualEndMatch || actualEndMatch.index === undefined) {
          break;
        }

        if (isImplicitClose && !consumeClosingMatch) {
          endIndex = startTagEndIndex + actualEndMatch.index;
          toolStartRegex.lastIndex = endIndex;
        } else {
          endIndex =
            startTagEndIndex + actualEndMatch.index + actualEndMatch[0].length;
          toolStartRegex.lastIndex = endIndex;
        }
      }

      if (endIndex > startIndex) {
        lastCompletedToolEnd = Math.max(lastCompletedToolEnd, endIndex);
      }
    }

    if (lastCompletedToolEnd === -1) {
      return message;
    }

    return message.slice(0, lastCompletedToolEnd).trimEnd();
  }

  private parseMessage(
    message: string,
    isFinalized: boolean,
  ): {
    finalized: AssistantMessageContent[];
    pending: AssistantMessageContent[];
    safeIndex: number;
  } {
    const contentBlocks: AssistantMessageContent[] = [];
    let currentIndex = 0;
    let lastSafeIndex = 0;
    let finalizedBlockCount = 0;

    const knownToolShortNames = UnifiedToolCallParser.KNOWN_TOOL_SHORT_NAMES;

    // 1. Find positions of <think> tags to skip
    const getThinkingRanges = (str: string) => {
      const ranges: { start: number; end: number }[] = [];
      const tagRegex = /<\/?think>/gi;
      let tagMatch;
      let startPos = -1;
      let depth = 0;
      while ((tagMatch = tagRegex.exec(str)) !== null) {
        if (tagMatch[0].toLowerCase() === "<think>") {
          if (depth === 0) startPos = tagMatch.index;
          depth++;
        } else {
          depth = Math.max(0, depth - 1);
          if (depth === 0 && startPos !== -1) {
            ranges.push({
              start: startPos,
              end: tagMatch.index + tagMatch[0].length,
            });
            startPos = -1;
          }
        }
      }
      if (startPos !== -1) ranges.push({ start: startPos, end: str.length });
      return ranges;
    };

    const thinkingRanges = getThinkingRanges(message);
    const isInsideThinking = (pos: number) =>
      thinkingRanges.some((r) => pos >= r.start && pos < r.end);

    // 2. State machine for single-letter and XML tool blocks.
    const toolStartRegex = new RegExp(UnifiedToolCallParser.TOOL_START_REGEX);
    let match: RegExpExecArray | null;

    while ((match = toolStartRegex.exec(message)) !== null) {
      // Check if inside thinking block
      if (isInsideThinking(match.index)) continue;

      let toolShortName = match[1] || match[4];
      let argsStr = (match[2] || "").trim();

      const isXml = !!match[4];

      if (toolShortName.startsWith("tool_")) {
        toolShortName = toolShortName.slice(5);
      }

      let hasInlineCloser = !!match[3];

      let startIndex = match.index;
      let startTagEndIndex = startIndex + match[0].length;
      let isOneLiner = hasInlineCloser;

      // KILOCODE FIX: Compact Args Detector
      // It's compact if it STARTS with '(' or if it's empty and the NEXT char is '('
      const remaining = message.slice(startTagEndIndex);
      const isCompact =
        argsStr.startsWith("(") ||
        (!argsStr.trim() && remaining.trimStart().startsWith("("));

      // If compact syntax, we need to manually find the arguments block (...)
      if (isCompact) {
        // If it was empty argsStr, we need to skip whitespace to find the (
        if (!argsStr.trim()) {
          const wsMatch = remaining.match(/^\s+/);
          if (wsMatch) startTagEndIndex += wsMatch[0].length;
        }

        const parenSearch = message.slice(startTagEndIndex);
        if (parenSearch.startsWith("(")) {
          // Find balanced closing paren (quote and escape aware)
          let depth = 0;
          let quote: string | null = null;
          let escape = false;
          let foundEnd = false;
          for (let i = 0; i < parenSearch.length; i++) {
            const char = parenSearch[i];
            if (escape) {
              escape = false;
              continue;
            }
            if (char === "\\") {
              escape = true;
              continue;
            }
            if (quote) {
              if (char === quote) quote = null;
              continue;
            }
            if (char === '"' || char === "'" || char === "`") {
              quote = char;
              continue;
            }

            if (char === "(") depth++;
            else if (char === ")") {
              depth--;
              if (depth === 0) {
                argsStr = parenSearch.slice(1, i);
                startTagEndIndex += i + 1;
                foundEnd = true;
                break;
              }
            }
          }
          if (!foundEnd) {
            // KILOCODE FIX: If partial stream, wait for closing paren!
            if (!isFinalized) {
              break; // Treat as incomplete tool, buffer it.
            }
          }
        }

        isOneLiner = true;
      }

      // Verify it's a known tool or a registered MCP tool
      const isMcpTool = this.isRegisteredMcpTool(toolShortName);
      if (!knownToolShortNames.has(toolShortName) && !isMcpTool) continue;

      // IMPORTANT: write/edit/todo tools NEVER use one-liner syntax — they always need a content block.
      // Treating them as one-liners would cut off their content entirely.
      // wrap tool also MUST use a content block as it wraps message content.
      const isContentTool =
        UnifiedToolCallParser.CONTENT_TOOL_SHORT_NAMES.has(toolShortName);

      // KILOCODE FIX: Allow content tools to be one-liners if they explicitly contain
      // their closing token in argsStr.
      if (isContentTool && !isOneLiner) {
        const closer =
          toolShortName === "E" || toolShortName === "edit"
            ? "edit"
            : toolShortName === "W" || toolShortName === "write"
              ? "write"
              : toolShortName === "T" || toolShortName === "todo"
                ? "todo"
                : toolShortName;
        const explicitCloserRegex = new RegExp(
          `(?:\\/?${closer}|\\/?${toolShortName})$`,
        );
        const trimmedArgs = argsStr.trim();
        const closerMatch = trimmedArgs.match(explicitCloserRegex);
        if (closerMatch) {
          isOneLiner = true;
          argsStr = trimmedArgs.slice(0, -closerMatch[0].length).trim();
        }
      }

      argsStr = argsStr.trim();

      // 2a. Flush previous text
      if (startIndex > currentIndex) {
        const textBefore = message.slice(currentIndex, startIndex);
        const cleanText = this.cleanTextContent(textBefore);
        // KILOCODE FIX: Prevent context poisoning.
        // If we have already finalized a tool call in this turn, any subsequent text
        // is likely a hallucination of the result or redundant "thought" that
        // should not be treated as a separate content block.
        // We also check finalizedBlockCount to allow multiple tools in one parse pass.
        if (cleanText) {
          contentBlocks.push({
            type: "text",
            content: cleanText,
            partial: false, // Text before a tool is always complete
          });
        }
      }

      // 2b. Find the end of the block
      let content = "";
      let isClosed = false;
      let endIndex = -1;

      if (isOneLiner) {
        content = "";
        isClosed = true;
        endIndex = startTagEndIndex;
      } else {
        const remainingText = message.slice(startTagEndIndex);
        // KILOCODE MOD: Syntax-Aware Closer detection
        let closingRegex: RegExp;
        if (UnifiedToolCallParser.STRICT_TOOL_SHORT_NAMES.has(toolShortName)) {
          // KILOCODE FIX: Content tools MUST only close on a tag at the start of a line.
          // This prevents "insane regex" or code content containing the tool name from
          // prematurely closing the block.
          // KILOCODE FIX: Support escaping. If the AI writes \/edit (with a backslash)
          // it will NOT close the block. This allows writing code about the parser.
          // KILOCODE FIX: Relax trailing requirement to allow streaming to continue without waiting for newline after closing tag
          // KILOCODE FIX: Accept /toolname with optional backticks OR just /toolname alone (AI often forgets backticks)
          const closer =
            toolShortName === "E" || toolShortName === "edit"
              ? "edit"
              : toolShortName === "W" || toolShortName === "write"
                ? "write"
                : toolShortName === "T" || toolShortName === "todo"
                  ? "todo"
                  : toolShortName;
          closingRegex = new RegExp(
            `(?:^|[\\r\\n])[ \t]*(?<!\\\\)\\/(?:${closer}|${toolShortName})(?:[ \t]*(?:[\\r\\n]|$))`,
          );
        } else {
          // For non-content tools, we use the XML closer or the single-letter closer.
          if (isXml) {
            closingRegex = new RegExp(
              `(?:^|[\\r\\n])[ \t]*<\\/${toolShortName}>(?:[ \\t]*(?:[\\r\\n]|$))`,
            );
          } else if (toolShortName.length === 1 && /[A-Z]/.test(toolShortName)) {
            closingRegex = new RegExp(
              `(?:^|[\\r\\n])[ \t]*(?<!\\\\)\\/[${toolShortName}${toolShortName.toLowerCase()}](?=$|[ \\t]|[\\r\\n])`,
            );
          } else {
            closingRegex = /$^/;
          }
        }

        const endMatch = remainingText.match(closingRegex);
        const nextSingleLetterToolMatch = remainingText.match(
          UnifiedToolCallParser.NEXT_SINGLE_LETTER_TOOL_REGEX,
        );
        const nextToolMatch =
          [nextSingleLetterToolMatch]
            .filter(
              (candidate): candidate is RegExpMatchArray =>
                !!candidate && candidate.index !== undefined,
            )
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0] ?? null;

        let actualEndMatch = endMatch;
        let isImplicitClose = false;
        let consumeClosingMatch = true;
        const isStrictTool =
          UnifiedToolCallParser.STRICT_TOOL_SHORT_NAMES.has(toolShortName);

        // KILOCODE FIX: Only tools that do NOT consume arbitrary content (like read, ls)
        // allow implicit closing via a next-tool lookahead.
        // Content-consuming tools (write, edit) are "Safe Havens" and MUST either
        // find their explicit closer or wait for the message to be finalized.
        if (nextToolMatch && !isStrictTool) {
          if (
            !endMatch ||
            (endMatch.index !== undefined &&
              nextToolMatch.index !== undefined &&
              nextToolMatch.index < endMatch.index)
          ) {
            actualEndMatch = nextToolMatch;
            isImplicitClose = true;
            consumeClosingMatch = false;
          }
        }

        if (actualEndMatch && actualEndMatch.index !== undefined) {
          // KILOCODE FIX: Buffering safety check.
          // For implicit close, `actualEndMatch` is the start of the next tool, so we have 100% confidence.
          // Only for explicit close do we need to check for partial matches or EOF ambiguity.
          const isAtEnd =
            actualEndMatch.index + actualEndMatch[0].length ===
            remainingText.length;
          // If it's an implicit close (next tool detected), we don't wait.
          // If it's an explicit close, we wait for a newline or EOF to ensure we have the full tag.
          // KILOCODE FIX: Always recognize closing tag as complete if we see it, regardless of trailing content
          const shouldWait = false;

          if (!isFinalized && isAtEnd && shouldWait) {
            content = remainingText.slice(0, actualEndMatch.index);
            if (content.startsWith("\n")) content = content.slice(1);
            isClosed = false;
            endIndex = startTagEndIndex + actualEndMatch.index;
          } else {
            content = remainingText.slice(0, actualEndMatch.index);
            if (content.startsWith("\n")) content = content.slice(1);
            isClosed = true;

            // For explicit close, skip the closer.
            // For implicit close, stop before the next tool so the next iteration picks it up.
            if (isImplicitClose && !consumeClosingMatch) {
              endIndex = startTagEndIndex + actualEndMatch.index;
              // KILOCODE FIX: For implicit close, we must reset the regex lastIndex
              // to the start of the NEXT tool so the next iteration of the while loop
              // picks it up immediately.
              toolStartRegex.lastIndex = endIndex;
            } else {
              endIndex =
                startTagEndIndex +
                actualEndMatch.index +
                actualEndMatch[0].length;
              toolStartRegex.lastIndex = endIndex;
            }
          }
        } else {
          content = remainingText;
          if (content.startsWith("\n")) content = content.slice(1);

          if (isFinalized) {
            // KILOCODE FIX: If the message is finalized, we MUST close the tool block
            // even if the closing tag is missing. This prevents "Never Terminate" hangs.
            isClosed = true;
            endIndex = message.length;
          } else {
            // KILOCODE FIX: Streaming safety - do not strip partial tags as it causes flickering/missing lines.
            // Never auto-close an unterminated tool block at stream end.
            // It must remain incomplete so execution can be blocked safely.
            if (
              toolShortName.length === 1 &&
              /[A-Z]/.test(toolShortName) &&
              /(?:^|[\r\n])[ \t]*\/$/.test(content)
            ) {
              // Ignore a dangling "/" while the closing "/R" is still streaming in.
              content = content.replace(/(?:^|\r?\n)[ \t]*\/$/, "");
            }
            isClosed = false;
            endIndex = message.length;
          }
        }
      }

      // 2c. Create Tool Use (or McpToolUse for MCP tools)
      // Use simple counter-based ID - same tool block gets same counter value
      const toolCallId = `unified_${this.currentTurnId}_${toolShortName}_${this.toolCounter}`;
      // Only increment counter when tool is finalized (closed)
      // so re-parsing the same partial tool during streaming yields a stable ID.
      if (isClosed) {
        this.toolCounter++;
        this.hasFinalizedTool = true;
      }
      const shouldBePartial = !isClosed;

      const singleLetterMcpToolUse = this.parseSingleLetterMcpInvocation(
        toolShortName,
        argsStr,
        content,
        toolCallId,
        shouldBePartial,
      );
      if (singleLetterMcpToolUse) {
        contentBlocks.push(singleLetterMcpToolUse);
        currentIndex = endIndex;
        if (isClosed) {
          lastSafeIndex = currentIndex;
          finalizedBlockCount = contentBlocks.length;
          this.hasFinalizedTool = true;
        }
        if (!isClosed) break;
        continue;
      }

      // MCP tools get a special McpToolUse block type
      if (isMcpTool) {
        const { serverName, toolName } = this.parseMcpToolName(toolShortName);
        let mcpArguments: Record<string, unknown> = {};
        const trimmedContent = content.trim();
        if (trimmedContent) {
          try {
            mcpArguments = JSON.parse(trimmedContent);
          } catch {
            // If JSON parsing fails, pass content as a raw "input" argument
            mcpArguments = { input: trimmedContent };
          }
        }

        const mcpToolUse: McpToolUse = {
          type: "mcp_tool_use" as const,
          id: toolCallId,
          name: toolShortName,
          serverName,
          toolName,
          arguments: mcpArguments,
          partial: shouldBePartial,
        };
        // KILOCODE: Critical for atomic execution
        (mcpToolUse as any).isComplete = isClosed;

        contentBlocks.push(mcpToolUse);
        currentIndex = endIndex;
        if (isClosed) {
          lastSafeIndex = currentIndex;
          finalizedBlockCount = contentBlocks.length;
          this.hasFinalizedTool = true;
        }
        if (!isClosed) break;
        continue;
      }

      const toolUse = this.createToolUse(
        toolShortName,
        argsStr,
        shouldBePartial,
        toolCallId,
      );

      // 2d. Attach Content or Parse XML Args
      if (toolShortName === "use_mcp_tool" || toolShortName === "access_mcp_resource") {
        const serverMatch = content.match(/<server_name>([\s\S]*?)<\/server_name>/);
        const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);
        const toolMatch = content.match(/<tool_name>([\s\S]*?)<\/tool_name>/);
        const argsMatch = content.match(/<arguments>([\s\S]*?)<\/arguments>/);

        if (serverMatch) toolUse.params.server_name = serverMatch[1].trim();
        if (nameMatch) toolUse.params.name = nameMatch[1].trim();
        if (toolMatch) toolUse.params.tool_name = toolMatch[1].trim();
        if (argsMatch) toolUse.params.arguments = argsMatch[1].trim();

        // Skip the complex populateToolParamsFromXmlArgs
      } else if (isXml) {
        // ... XML Arg Parsing logic (identical to original) ...
        let inner = content.trim();
        const regexArgs: string[] = [];
        // KILOCODE FIX: Allow slashes in tag names for shorthand paths (e.g. <src/file.ts>)
        // but forbid starting with / to avoid matching closing tags.
        const tagRegex = /<([^\/>][^>]*)>([\s\S]*?)(?:<\/\1>|$)/g;
        let match;
        let hasMatches = false;
        const knownParamNames = new Set([
          "path",
          "content",
          "edit",
          "query",
          "command",
          "pattern",
          "todos",
          "result",
          "url",
          "depth",
          "action",
          "coordinate",
          "text",
          "prompt",
          "output_path",
          "image",
          "target_file",
          "mode",
          "explanation",
          "code",
          "file_result",
          "notice",
          "operation",
          "start_line",
          "end_line",
          "server_name",
          "tool_name",
          "arguments",
        ]);

        // KILOCODE FIX: For vulnerable params (edit, content), extract using indexOf/lastIndexOf
        // to avoid greedy regex breaking on nested HTML/XML tags
        const vulnerableParams = ["edit", "content", "code", "arguments"];
        let extractedVulnerableParam = false;

        for (const paramName of vulnerableParams) {
          if (knownParamNames.has(paramName)) {
            const startTag = `<${paramName}>`;
            const endTag = `</${paramName}>`;
            const startIndex = inner.indexOf(startTag);
            const endIndex = inner.lastIndexOf(endTag);

            if (startIndex !== -1 && endIndex > startIndex) {
              const paramContent = inner.slice(
                startIndex + startTag.length,
                endIndex,
              );
              regexArgs.push(paramContent);
              extractedVulnerableParam = true;
              hasMatches = true;
              break;
            }
          }
        }

        // Only use greedy regex if we didn't extract a vulnerable param
        if (!extractedVulnerableParam) {
          while ((match = tagRegex.exec(inner)) !== null) {
            hasMatches = true;
            const tagName = match[1];
            const tagContent = match[2];
            if (
              knownParamNames.has(tagName.toLowerCase()) ||
              /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tagName)
            ) {
              regexArgs.push(tagContent);
            } else {
              regexArgs.push(tagName);
              regexArgs.push(tagContent);
            }
          }
        }

        if (hasMatches) {
          if (toolShortName === "write" || toolShortName === "write_to_file") {
            if (regexArgs.length > 1) {
              const lastIdx = regexArgs.length - 1;
              regexArgs[lastIdx] = regexArgs[lastIdx].replace(
                /<\/(?:c|co|con|cont|conte|conten|content|w|wr|wri|writ|write)?>?$/,
                "",
              );
            }
          }
          this.populateXmlArgs(toolShortName, regexArgs, toolUse);
        } else {
          if (inner.startsWith("<") && inner.endsWith(">")) {
            const singleArgInnerMatch = inner.match(
              /^<([^>]+)>([\s\S]*?)<\/\1>$/,
            );
            if (singleArgInnerMatch) {
              this.populateXmlArgs(
                toolShortName,
                [singleArgInnerMatch[2]],
                toolUse,
              );
            } else {
              const singleArg = inner.slice(1, -1).trim();
              this.populateXmlArgs(toolShortName, [singleArg], toolUse);
            }
          } else if (
            inner.length > 0 &&
            !inner.includes(">") &&
            !inner.includes("<")
          ) {
            this.populateXmlArgs(toolShortName, [inner], toolUse);
          } else {
            if (inner.startsWith("<")) {
              let val = inner.slice(1);
              if (val.slice(-1) === ">") val = val.slice(0, -1);
              this.populateXmlArgs(toolShortName, [val.trim()], toolUse);
            } else {
              this.populateXmlArgs(toolShortName, [inner], toolUse);
            }
          }
        }
      } else {
        if (
          this.isContentConsumingTool(
            this.mapShortNameToToolName(toolShortName),
          )
        ) {
          this.appendContentToTool(toolUse, content);
        } else if (
          (toolShortName === "F" ||
            toolShortName === "glob" ||
            toolShortName === "find" ||
            toolShortName === "G" ||
            toolShortName === "grep" ||
            toolShortName === "search") &&
          content.trim()
        ) {
          // KILOCODE FIX: Intercept ALL block-based glob/find/grep calls.
          // If an inline arg (argsStr) is provided, it is ALWAYS the path.
          // If no inline arg is provided, the path defaults to ".".
          // The block body lines are ALWAYS the queries/patterns.
          const path = argsStr
            ? argsStr.trim().replace(/^["'`]|["'`]$/g, "")
            : ".";
          const bodyLines = content
            .trim()
            .split(/\r?\n/)
            .map((l: string) => l.trim())
            .filter(Boolean);

          if (
            toolShortName === "G" ||
            toolShortName === "grep" ||
            toolShortName === "search"
          ) {
            const lastBodyLine = bodyLines[bodyLines.length - 1];
            const hasIncludeAllFlag =
              bodyLines.length > 1 &&
              (lastBodyLine === "-i" ||
                lastBodyLine === "--include-all" ||
                lastBodyLine === "--include_all");

            const queries = hasIncludeAllFlag ? bodyLines.slice(0, -1) : bodyLines;
            toolUse.params.query = this.splitPipe(queries);
            toolUse.nativeArgs.query = toolUse.params.query;
            toolUse.params.path = path;
            toolUse.nativeArgs.path = path;
            if (hasIncludeAllFlag) {
              toolUse.params.include_all = true;
              toolUse.nativeArgs.include_all = true;
            }
          } else {
            toolUse.params.pattern = this.splitPipe(bodyLines);
            toolUse.nativeArgs.pattern = toolUse.params.pattern;
            toolUse.params.path = path;
            toolUse.nativeArgs.path = path;
          }
        } else if (!argsStr && content.trim()) {
          // Compact syntax without parens for non-content tools
          // Treat the content as the args string and re-populate
          // For glob/find, preserve newlines so multiline pattern lists work correctly.
          // For read, preserve newlines for multi-file support.
          // For everything else, collapse to a single line.
          const preserveNewlines =
            toolShortName === "R" ||
            toolShortName === "read" ||
            toolShortName === "F" ||
            toolShortName === "glob" ||
            toolShortName === "find";
          const contentAsArgs = preserveNewlines
            ? content.trim()
            : content.trim().replace(/\n/g, " ");
          this.populateToolArgs(toolShortName, contentAsArgs, toolUse);
        } else if (
          (toolShortName === "R" || toolShortName === "read") &&
          argsStr &&
          content.trim()
        ) {
          // KILOCODE FIX: Multi-file R block where first file is inline and the rest are in the body.
          // e.g.:  R sample.txt
          //        sample2.txt
          //        /R
          // argsStr = "sample.txt", content = "sample2.txt" — merge them.
          const merged = argsStr.trim() + "\n" + content.trim();
          this.populateToolArgs(toolShortName, merged, toolUse);
        }
      }

      // KILOCODE MOD: Split multi-file or multi-anchor read_file calls
      // Note: Since this logic expands 1 tool into N, we must be careful with finalizedBlockCount.
      // If the original tool was closed, ALL generated tools are closed (and finalized).
      let generatedTools: any[] = [];
      if (
        toolUse.name === "read_file" &&
        toolUse.nativeArgs?.additional_anchors &&
        toolUse.nativeArgs.additional_anchors.length > 0
      ) {
        // console.log(`[UnifiedToolCallParser] 🔍 read_file with additional_anchors: ${toolUse.nativeArgs.additional_anchors.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
        generatedTools.push(toolUse);
        toolUse.nativeArgs.additional_anchors.forEach(
          (anchor: number, index: number) => {
            const newToolUse = {
              ...toolUse,
              id: `${toolUse.id}_anchor_${index + 1}`,
              params: {
                ...toolUse.params,
                mode: "indentation",
                indentation: { anchor_line: anchor },
              },
              nativeArgs: {
                ...toolUse.nativeArgs,
                mode: "indentation",
                indentation: { anchor_line: anchor },
                additional_anchors: undefined,
              },
            };
            generatedTools.push(newToolUse);
          },
        );
      } else if (
        toolUse.name === "read_file" &&
        toolUse.nativeArgs?.files &&
        toolUse.nativeArgs.files.length > 1
      ) {
        // console.log(`[UnifiedToolCallParser] 🔍 read_file with multiple files: ${toolUse.nativeArgs.files.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
        toolUse.nativeArgs.files.forEach((file: any, index: number) => {
          const newToolUse = {
            ...toolUse,
            id: `${toolUse.id}_${index}`,
            params: {
              ...toolUse.params,
              path: file.path,
              lineRange:
                file.lineRanges && file.lineRanges.length > 0
                  ? file.lineRanges
                    .map((r: any) => `${r.start}-${r.end}`)
                    .join(", ")
                  : undefined,
              head: file.head !== undefined ? file.head.toString() : undefined,
              tail: file.tail !== undefined ? file.tail.toString() : undefined,
            },
            nativeArgs: { ...toolUse.nativeArgs, files: [file] },
          };
          generatedTools.push(newToolUse);
        });
      } else {
        // console.log(`[UnifiedToolCallParser] 🔍 read_file single file: ${toolUse.name}, files: ${JSON.stringify(toolUse.nativeArgs?.files)}, path: ${toolUse.params?.path}`)
        generatedTools.push(toolUse);
      }

      // console.log(`[UnifiedToolCallParser] 🔍 Generated ${generatedTools.length} tool(s) from ${toolUse.name}`)
      contentBlocks.push(...generatedTools);

      currentIndex = endIndex;
      // KILOCODE FIX: lastSafeIndex must ONLY advance for closed tools.
      if (isClosed) lastSafeIndex = endIndex;
      if (isClosed) {
        finalizedBlockCount = contentBlocks.length;
      }

      if (!isClosed) {
        break;
      }
    }

    // 3. Flush remaining text after last tool
    if (currentIndex < message.length) {
      const remainingText = message.slice(currentIndex);
      const cleanText = this.cleanTextContent(remainingText);
      // KILOCODE FIX: Prevent context poisoning.
      // Do not emit trailing text if a tool has already been finalized in this message.
      // This is the "God Mode" kill switch for trailing text.
      if (cleanText && !this.hasFinalizedTool && finalizedBlockCount === 0) {
        contentBlocks.push({
          type: "text",
          content: cleanText,
          partial: !isFinalized,
        });
      }
      // Text is rarely finalized unless isFinalized is true.
    }

    return {
      finalized: contentBlocks.slice(0, finalizedBlockCount),
      pending: contentBlocks.slice(finalizedBlockCount),
      safeIndex: lastSafeIndex,
    };
  }

  /**
   * Parse an MCP tool name (format: "serverName_toolName") into its components.
   * The server name is everything before the first underscore, the tool name is the rest.
   */
  private parseMcpToolName(mcpToolName: string): {
    serverName: string;
    toolName: string;
  } {
    // Look up from the registered mapping first (exact match)
    const exact = this.mcpToolNames.get(mcpToolName);
    if (exact) return exact;
    // Try with hyphens normalized to underscores
    const normalized = this.mcpToolNames.get(mcpToolName.replace(/-/g, "_"));
    if (normalized) return normalized;
    // Fallback: split on first underscore
    const underscoreIdx = mcpToolName.indexOf("_");
    if (underscoreIdx === -1) {
      return { serverName: mcpToolName, toolName: mcpToolName };
    }
    return {
      serverName: mcpToolName.slice(0, underscoreIdx),
      toolName: mcpToolName.slice(underscoreIdx + 1),
    };
  }

  private isContentConsumingTool(toolName: string): boolean {
    return [
      "write_to_file",
      "edit",
      "new_rule",
      "edit_file",
      "update_todo_list",
      "todo",
      "execute_command",
      "wrap",
      "run_sub_agent",
    ].includes(toolName);
  }

  private parseSingleLetterMcpInvocation(
    shortName: string,
    argsStr: string,
    content: string,
    id: string,
    partial: boolean,
  ): McpToolUse | null {
    if (shortName !== "M") {
      return null;
    }

    const trimmedArgs = argsStr.trim();
    if (!trimmedArgs) {
      return null;
    }

    const [candidateToolName, ...rest] = trimmedArgs.split(/\s+/);
    if (!this.isRegisteredMcpTool(candidateToolName)) {
      return null;
    }

    const { serverName, toolName } = this.parseMcpToolName(candidateToolName);
    const inlinePayload = rest.join(" ").trim();
    const rawPayload = [inlinePayload, content.trim()]
      .filter(Boolean)
      .join("\n")
      .trim();

    let argumentsPayload: Record<string, unknown> = {};
    if (rawPayload) {
      try {
        argumentsPayload = JSON.parse(rawPayload);
      } catch {
        argumentsPayload = { input: rawPayload };
      }
    }

    const mcpToolUse: McpToolUse = {
      type: "mcp_tool_use",
      id,
      name: candidateToolName,
      serverName,
      toolName,
      arguments: argumentsPayload,
      partial,
    };
    (mcpToolUse as any).isComplete = !partial;

    return mcpToolUse;
  }

  private createToolUse(
    shortName: string,
    argsStr: string,
    partial: boolean,
    id: string,
  ): any {
    const canonicalName = this.mapShortNameToToolName(shortName);
    const toolUse: any = {
      type: "tool_use",
      name: canonicalName,
      id: id,
      originalName: shortName,
      params: {},
      nativeArgs: {},
      partial: partial,
      isComplete: !partial, // KILOCODE: Critical for atomic execution
    };

    this.populateToolArgs(shortName, argsStr, toolUse);

    return toolUse;
  }

  private mapShortNameToToolName(shortName: string): ToolName {
    const mapping: Record<string, ToolName> = {
      read: "read_file",
      R: "read_file",
      edit: "edit",
      E: "edit",
      write: "write_to_file",
      W: "write_to_file",
      ls: "list_dir",
      L: "list_dir",
      glob: "glob",
      F: "glob",
      search: "grep",
      G: "grep",
      cmd: "execute_command",
      B: "execute_command",
      todo: "update_todo_list",
      T: "update_todo_list",
      D: "attempt_completion",
      done: "attempt_completion",
      web: "web_search",
      X: "web_search",
      Y: "codebase_search",
      research: "research_web",
      fetch: "web_fetch",
      U: "web_fetch",
      browse: "browser_action",
      browser: "browser_action",
      click: "browser_action",
      type: "browser_action",
      scroll: "browser_action",
      image: "generate_image",
      ask: "codebase_search",
      edit_file: "edit_file",
      new_rule: "new_rule",
      report_bug: "report_bug",
      agent: "run_sub_agent",
      Z: "run_sub_agent",
      run_sub_agent: "run_sub_agent",
      sub: "run_sub_agent",
      condense: "condense",
      diff: "edit",
      execute_command: "execute_command",
      delete: "delete_file",
      delete_file: "delete_file",
      fast_context: "fast_context",
      context: "fast_context",
      semgrep: "fast_context",
      S: "fast_context",
      mkdir: "mkdir",
      M: "mkdir",
      find: "glob",
      mv: "move_file",
      V: "move_file",
      move: "move_file",
      rename: "move_file",
      wrap: "wrap" as ToolName,
    };
    return mapping[shortName] || (shortName as ToolName);
  }

  private populateToolArgs(shortName: string, argsStr: string, toolUse: any) {
    const params = toolUse.params;
    const native = toolUse.nativeArgs;
    type ReadRange = { start: number; end: number };

    // Helper to parse --flags into a dictionary.
    // Returns both raw (with quotes) and clean (without quotes) values.
    const parseFlags = (input: string): Record<string, string> => {
      const flags: Record<string, string> = {};
      let i = 0;

      while (i < input.length) {
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) i++;
        if (i >= input.length) break;

        // Look for --flag
        if (input[i] === "-" && input[i + 1] === "-") {
          i += 2;
          const flagStart = i;
          // Extract flag name
          while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) i++;
          const flagName = input.slice(flagStart, i);

          // Skip whitespace after flag name
          while (i < input.length && /\s/.test(input[i])) i++;
          if (i >= input.length) break;

          // Extract value (handle quotes with escape sequences)
          let value = "";
          const quoteChar = input[i];

          if (quoteChar === '"' || quoteChar === "'" || quoteChar === "`") {
            // Quoted value - parse until matching unescaped quote
            i++; // skip opening quote
            let escaped = false;
            while (i < input.length) {
              const char = input[i];
              if (escaped) {
                value += char;
                escaped = false;
              } else if (char === "\\") {
                value += char;
                escaped = true;
              } else if (char === quoteChar) {
                i++; // skip closing quote
                break;
              } else {
                value += char;
              }
              i++;
            }
          } else {
            // Unquoted value - read until next --flag or end
            const valueStart = i;
            while (i < input.length) {
              // Stop at next --flag
              if (input[i] === "-" && input[i + 1] === "-") break;
              i++;
            }
            value = input.slice(valueStart, i).trim();
          }

          flags[flagName] = value;
        } else {
          i++;
        }
      }

      return flags;
    };

    const extractStandaloneShortFlag = (
      input: string,
      shortFlag: string,
    ): { cleanedInput: string; present: boolean } => {
      let quote: string | null = null;
      let tokenStart = -1;
      let present = false;
      const removals: Array<{ start: number; end: number }> = [];

      const flushToken = (end: number) => {
        if (tokenStart === -1) {
          return;
        }

        if (input.slice(tokenStart, end) === `-${shortFlag}`) {
          present = true;
          removals.push({ start: tokenStart, end });
        }

        tokenStart = -1;
      };

      for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (quote) {
          if (char === "\\" && i + 1 < input.length) {
            i++;
            continue;
          }

          if (char === quote) {
            quote = null;
          }
          continue;
        }

        if (char === '"' || char === "'" || char === "`") {
          flushToken(i);
          quote = char;
          continue;
        }

        if (/\s/.test(char)) {
          flushToken(i);
          continue;
        }

        if (tokenStart === -1) {
          tokenStart = i;
        }
      }

      flushToken(input.length);

      if (!present) {
        return { cleanedInput: input, present: false };
      }

      let cleanedInput = "";
      let cursor = 0;
      for (const removal of removals) {
        cleanedInput += input.slice(cursor, removal.start);
        cursor = removal.end;
      }
      cleanedInput += input.slice(cursor);

      cleanedInput = cleanedInput
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .trim();

      if (!cleanedInput) {
        return { cleanedInput: input, present: false };
      }

      return { cleanedInput, present: true };
    };

    // Raw flag extractor that preserves the full raw value (including quotes) up to the next --flag
    // Used for multi-value flags where we need to split on commas only between quoted tokens
    const getRawFlagValue = (
      input: string,
      flagName: string,
    ): string | undefined => {
      const flagPattern = `--${flagName}`;
      const flagIndex = input.indexOf(flagPattern);
      if (flagIndex === -1) return undefined;

      let i = flagIndex + flagPattern.length;
      // Skip whitespace after flag name
      while (i < input.length && /\s/.test(input[i])) i++;
      if (i >= input.length) return undefined;

      const valueStart = i;
      const quoteChar = input[i];

      if (quoteChar === '"' || quoteChar === "'" || quoteChar === "`") {
        // Quoted value - parse until matching unescaped quote
        i++; // skip opening quote
        let escaped = false;
        while (i < input.length) {
          const char = input[i];
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === quoteChar) {
            i++; // include closing quote
            break;
          }
          i++;
        }
        return input.slice(valueStart, i);
      } else {
        // Unquoted value - read until next --flag or end
        while (i < input.length) {
          if (input[i] === "-" && input[i + 1] === "-") break;
          i++;
        }
        return input.slice(valueStart, i).trim();
      }
    };

    const flags = parseFlags(argsStr);
    const splitLeadingToken = (
      value: string,
    ): { first: string; rest: string } => {
      const trimmed = value.trim();
      if (!trimmed) return { first: "", rest: "" };

      const match = trimmed.match(
        /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|(\S+))(?:\s+([\s\S]*))?$/,
      );
      if (!match) return { first: trimmed, rest: "" };

      return {
        first: (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim(),
        rest: (match[5] ?? "").trim(),
      };
    };

    const parseReadRangeSpecs = (
      value?: string,
    ): {
      lineRanges: ReadRange[];
      head?: number;
      tail?: number;
      hasOnlySpecs: boolean;
    } => {
      if (!value?.trim()) {
        return { lineRanges: [], hasOnlySpecs: false };
      }

      const tokens = value
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean);

      if (tokens.length === 0) {
        return { lineRanges: [], hasOnlySpecs: false };
      }

      const lineRanges: ReadRange[] = [];
      let head: number | undefined;
      let tail: number | undefined;
      let hasOnlySpecs = true;

      for (const token of tokens) {
        const rangeMatch = token.match(/^(\d+)-(\d+)$/);
        const headMatch = token.match(/^H(\d+)$/i);
        const tailMatch = token.match(/^T(\d+)$/i);

        if (rangeMatch) {
          lineRanges.push({
            start: parseInt(rangeMatch[1]),
            end: parseInt(rangeMatch[2]),
          });
          continue;
        }

        if (headMatch) {
          head = parseInt(headMatch[1]);
          continue;
        }

        if (tailMatch) {
          tail = parseInt(tailMatch[1]);
          continue;
        }

        hasOnlySpecs = false;
      }

      return { lineRanges, head, tail, hasOnlySpecs };
    };

    const applyReadSpecsToEntry = (
      fileEntry: { lineRanges: ReadRange[]; head?: number; tail?: number },
      specs?: {
        lineRanges: ReadRange[];
        head?: number;
        tail?: number;
      },
    ) => {
      if (!specs) {
        return;
      }

      if (specs.lineRanges.length > 0) {
        fileEntry.lineRanges.push(...specs.lineRanges);
      }
      if (specs.head !== undefined) {
        fileEntry.head = specs.head;
      }
      if (specs.tail !== undefined) {
        fileEntry.tail = specs.tail;
      }
    };

    if (shortName === "ask" || shortName === "Y") {
      // Use raw value to correctly split on commas between quoted items
      const rawQuery = getRawFlagValue(argsStr, "query") || argsStr.trim();
      // Split on commas that are between quoted strings or between unquoted tokens
      const queries = (rawQuery.match(/("[^"]*"|'[^']*'|`[^`]*`|[^,]+)/g) || [])
        .map((q) => q.trim().replace(/^"|"$|^'|'$|^`|`$/g, ""))
        .filter(Boolean);

      if (queries.length > 1) {
        params.query = queries;
        native.query = queries;
      } else {
        params.query = queries[0] || "";
        native.query = queries[0] || "";
      }
      return;
    }

    if (
      shortName === "cmd" ||
      shortName === "execute_command" ||
      shortName === "B"
    ) {
      const command = flags.run || flags.command || argsStr.trim();
      const cwd = flags.cwd;
      params.command = this.normalizeCmdCommand(command);
      native.command = params.command;
      if (cwd) {
        params.cwd = cwd;
        native.cwd = cwd;
      }
      if (cwd) {
        params.cwd = cwd;
        native.cwd = cwd;
      }
      return;
    }

    switch (shortName) {
      case "R":
      case "read": {
        // For markdown format: first token is the path (positional), then flags
        // Extract path before any -- flags
        const beforeFlags = argsStr.split(/\s+--/)[0].trim();
        const rawPath = getRawFlagValue(argsStr, "path");

        let pathStr =
          rawPath !== undefined
            ? rawPath
            : flags.path || beforeFlags || argsStr.trim();
        let linesStr = flags.lines;
        const headStr = flags.head;
        const tailStr = flags.tail;

        // Single-letter syntax refinement: if pathStr contains a space (but not newline) and no linesStr, split it
        // This handles "R src/app.ts 1-50" but NOT "R\nsrc/app.ts\nsrc/auth.ts" (multi-file)
        if (
          shortName === "R" &&
          pathStr &&
          !linesStr &&
          !rawPath &&
          !flags.path &&
          !pathStr.includes("\n")
        ) {
          const { first, rest } = splitLeadingToken(pathStr);
          if (first && rest) {
            pathStr = first;
            linesStr = rest;
          }
        }

        if (pathStr) {
          // pathStr is the raw flag value (may include outer quotes).
          // Two supported formats:
          //   1. Multiple individually-quoted tokens: "a, b.txt", "c.ts", "d.md"
          //      → split on quoted token boundaries, each token is one path
          //   2. Single quoted string with comma+space-separated paths: "game.py, pizza.txt"
          //      → strip outer quotes, split on ", " inside
          //   3. Unquoted comma+space-separated: game.py, pizza.txt
          //      → split on ", "
          let paths: string[];
          let continuationSpecs:
            | {
                lineRanges: ReadRange[];
                head?: number;
                tail?: number;
              }
            | undefined;
          const multiQuotedTokens = pathStr.match(/("[^"]+"|'[^']+'|`[^`]+`)/g);
          if (multiQuotedTokens && multiQuotedTokens.length > 1) {
            // Multiple individually-quoted tokens
            paths = multiQuotedTokens
              .map((p) => p.slice(1, -1))
              .filter(Boolean);
          } else {
            // Single quoted or unquoted — strip outer quotes then split on ", "
            let inner = pathStr.trim();
            if (
              (inner.startsWith('"') && inner.endsWith('"')) ||
              (inner.startsWith("'") && inner.endsWith("'")) ||
              (inner.startsWith("`") && inner.endsWith("`"))
            ) {
              inner = inner.slice(1, -1);
            }
            const logicalLines = inner
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            const trailingLineSpecs =
              logicalLines.length > 1
                ? logicalLines
                    .slice(1)
                    .map((line) => parseReadRangeSpecs(line))
                : [];

            if (
              logicalLines.length > 1 &&
              trailingLineSpecs.every((spec) => spec.hasOnlySpecs)
            ) {
              paths = [logicalLines[0]];
              continuationSpecs = parseReadRangeSpecs(
                logicalLines.slice(1).join(" "),
              );
            } else {
              paths = inner
                .split(/[\r\n]+|, */)
                .map((p) => p.trim())
                .filter(Boolean);
            }
          }

          native.files = [];
          const sharedLineSpecs =
            paths.length === 1 ? parseReadRangeSpecs(linesStr) : undefined;
          paths.forEach((p, idx) => {
            let parsedPath = p;
            let inlineSpecs:
              | {
                  lineRanges: ReadRange[];
                  head?: number;
                  tail?: number;
                }
              | undefined;
            const fileEntry: any = { path: parsedPath, lineRanges: [] };

            // Support path:L1-50, "path 1-50", "path H10", "path T20"
            const inlineRangeMatch = p.match(/^(.*?):L(\d+)-(\d+)$/i);
            const inlineSpecMatch = p.match(/^(\S+)\s+([\s\S]+)$/);

            if (inlineRangeMatch) {
              parsedPath = inlineRangeMatch[1].trim();
              fileEntry.path = parsedPath;
              inlineSpecs = {
                lineRanges: [
                  {
                    start: parseInt(inlineRangeMatch[2]),
                    end: parseInt(inlineRangeMatch[3]),
                  },
                ],
              };
            } else if (inlineSpecMatch) {
              const parsedInlineSpecs = parseReadRangeSpecs(inlineSpecMatch[2]);
              if (parsedInlineSpecs.hasOnlySpecs) {
                parsedPath = inlineSpecMatch[1].trim();
                fileEntry.path = parsedPath;
                inlineSpecs = parsedInlineSpecs;
              }
            }

            if (headStr && fileEntry.head === undefined) {
              fileEntry.head = parseInt(headStr);
            }
            if (tailStr && fileEntry.tail === undefined) {
              fileEntry.tail = parseInt(tailStr);
            }

            if (inlineSpecs) {
              applyReadSpecsToEntry(fileEntry, inlineSpecs);
            }

            if (sharedLineSpecs) {
              applyReadSpecsToEntry(fileEntry, sharedLineSpecs);
            } else if (linesStr) {
              const allRanges = linesStr.split(",").map((r) => r.trim());
              const rangeStr = allRanges[idx] || allRanges[0];
              if (rangeStr) {
                applyReadSpecsToEntry(
                  fileEntry,
                  parseReadRangeSpecs(rangeStr),
                );
              }
            }
            if (idx === 0 && continuationSpecs) {
              applyReadSpecsToEntry(fileEntry, continuationSpecs);
            }
            native.files.push(fileEntry);
          });

          params.path = native.files.map((file: any) => file.path).join(", ");
          const firstFile = native.files[0];
          if (firstFile.lineRanges.length > 0) {
            params.lineRange = firstFile.lineRanges
              .map((range: ReadRange) => `${range.start}-${range.end}`)
              .join(", ");
          } else if (linesStr) {
            params.lineRange = linesStr;
          }
          if (firstFile.head !== undefined)
            params.head = firstFile.head.toString();
          else if (headStr) params.head = headStr;

          if (firstFile.tail !== undefined)
            params.tail = firstFile.tail.toString();
          else if (tailStr) params.tail = tailStr;
        }
        break;
      }
      case "E":
      case "edit": {
        // For markdown format: first line is the path (positional)
        const pathMatch = argsStr.trim().split(/\s+/)[0];
        const path = flags.path || pathMatch || "";
        params.path = path;
        native.path = path;
        break;
      }
      case "W":
      case "write":
      case "write_to_file": {
        // For markdown format: first line is the path (positional), rest is handled by content appending
        // Extract path from argsStr (first line before any flags or newlines)
        const pathMatch = argsStr.trim().split(/\s+/)[0];
        const path = flags.path || pathMatch || "";

        params.path = path;
        params.target_file = path;
        native.path = path;
        native.target_file = path;
        break;
      }
      case "L":
      case "ls": {
        const beforeFlags = argsStr.split(/\s+--/)[0].trim();
        // Check if beforeFlags is actually a flag (starts with --) or empty
        // If so, use "." as the default path instead of treating the flag as path
        const path =
          flags.path ||
          (beforeFlags && !beforeFlags.startsWith("--") ? beforeFlags : ".");
        params.path = path;
        native.path = params.path;
        if (
          flags.recursive === "true" ||
          argsStr.includes("--recursive true") ||
          argsStr.includes("--recursive")
        ) {
          params.recursive = "true";
          native.recursive = true;
        }
        break;
      }
      case "F":
      case "find":
      case "glob": {
        const beforeFlags = argsStr.split(/\s+--/)[0].trim();
        if (flags.pattern) {
          params.pattern = flags.pattern;
          params.path = flags.path || ".";
        } else {
          // KILOCODE FIX: If there's a newline, the first line is ALWAYS the path
          // and subsequent lines are individual patterns.
          if (beforeFlags.includes("\n")) {
            const lines = beforeFlags
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            params.path = flags.path || lines[0];
            const patterns = lines.slice(1);
            params.pattern = this.splitPipe(patterns);
          } else {
            // KILOCODE FIX: Improved positional argument parsing for Glob/Find.
            const match = beforeFlags.match(
              /^(\"[\s\S]*?\"|\'[\s\S]*?\'|\`[\s\S]*?\`|\S+)(?:\s+([\s\S]*))?$/,
            );
            if (match) {
              const firstToken = match[1];
              const secondToken = match[2];
              if (secondToken) {
                // Swap if first token is path and second is pattern
                if (
                  (firstToken.includes("/") ||
                    firstToken.includes("\\") ||
                    firstToken === "." ||
                    firstToken === "..") &&
                  !secondToken.includes("/") &&
                  !secondToken.includes("\\")
                ) {
                  params.pattern = secondToken;
                  params.path = flags.path || firstToken;
                } else {
                  params.pattern = firstToken;
                  params.path = flags.path || secondToken;
                }
              } else {
                // Single token: is it a path or a pattern?
                if (
                  firstToken.includes("/") ||
                  firstToken.includes("\\") ||
                  firstToken === "." ||
                  firstToken === ".."
                ) {
                  // For partial single-letter F blocks like:
                  //   F src/
                  //   ClineMessage
                  // we should not seed a wildcard pattern before the body arrives.
                  // Otherwise the runtime can briefly treat the request as
                  // "find everything under src/" instead of "wait for patterns".
                  params.pattern =
                    shortName === "F" && toolUse.partial ? "" : "*";
                  params.path = flags.path || firstToken;
                } else {
                  params.pattern = firstToken;
                  params.path = flags.path || ".";
                }
              }
            } else {
              params.pattern = beforeFlags;
              params.path = flags.path || ".";
            }
          }
        }

        // Allow multi-line pattern appending
        toolUse.isArgBased = false;

        // Normalize: keep array if multiple patterns, string if single
        if (params.pattern !== undefined && params.pattern !== null) {
          native.pattern = params.pattern;
        }
        // Clean up quotes from the path
        if (params.path) {
          params.path = params.path.replace(/^["'`]|["'`]$/g, "");
        }
        native.pattern = params.pattern;
        native.path = params.path;
        break;
      }
      case "V":
      case "mv":
      case "move":
      case "rename": {
        // If we have flags, use them primarily
        if (flags.source || flags.rename || flags.path || flags.from) {
          params.source =
            flags.source || flags.rename || flags.path || flags.from;
          params.destination = flags.to || flags.new || flags.destination || "";
        } else if (argsStr.trim()) {
          // Try positional split
          // Look for common separators like " to " or " -> "
          const positionalMatch = argsStr
            .trim()
            .match(/^(.+?)\s+(?:--to|--new|--destination|to|into|->)\s+(.+)$/i);
          if (positionalMatch) {
            params.source = positionalMatch[1].trim();
            params.destination = positionalMatch[2].trim();
          } else {
            const parts = argsStr.trim().split(/\s+/);
            if (parts.length >= 2) {
              params.source = parts[0];
              params.destination = parts[parts.length - 1];
            } else {
              params.source = argsStr.trim();
              params.destination = "";
            }
          }
        }

        // Cleanup quotes
        if (params.source)
          params.source = params.source.replace(/^["'`]|["'`]$/g, "");
        if (params.destination)
          params.destination = params.destination.replace(/^["'`]|["'`]$/g, "");

        native.source = params.source;
        native.destination = params.destination;
        if (flags.rename || shortName === "rename") {
          params.isRename = true;
          native.isRename = true;
        }
        break;
      }
      case "G":
      case "grep":
      case "search": {
        const {
          cleanedInput: grepArgs,
          present: hasIncludeAllShortFlag,
        } = extractStandaloneShortFlag(argsStr, "i");
        const beforeFlags = grepArgs.split(/\s+--/)[0].trim();
        let rawQuery = "";
        if (flags.query) {
          rawQuery = flags.query;
          params.path = flags.path || ".";
        } else {
          // KILOCODE FIX: If there's a newline, the first line is ALWAYS the path
          // and subsequent lines are individual queries.
          if (beforeFlags.includes("\n")) {
            const lines = beforeFlags
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            params.path = flags.path || lines[0];
            const queries = lines.slice(1);
            rawQuery = queries.join("|");
          } else if (beforeFlags) {
            // Single line case: logic for swapping query/path remains same
            // but we only do this if there is NO block content.
            // KILOCODE FIX: Improved positional argument parsing for Grep.
            // If beforeFlags contains multiple tokens, the first is query, second is path.
            // If it's a single token, we check if it looks like a path (contains / or .)
            const { first: firstToken, rest: secondToken } =
              splitLeadingToken(beforeFlags);
            if (firstToken) {
              if (secondToken) {
                // KILOCODE FIX: Swap if first token is path and second is query
                if (
                  (firstToken.includes("/") ||
                    firstToken.includes("\\\\") ||
                    firstToken === "." ||
                    firstToken === "..") &&
                  !secondToken.includes("/") &&
                  !secondToken.includes("\\\\")
                ) {
                  rawQuery = secondToken;
                  params.path = flags.path || firstToken;
                } else {
                  rawQuery = firstToken;
                  params.path = flags.path || secondToken;
                }
              } else {
                // Single token: is it a path or a query?
                // If it contains path separators or is a known directory, treat as path.
                if (
                  firstToken.includes("/") ||
                  firstToken.includes("\\\\") ||
                  firstToken === "." ||
                  firstToken === ".."
                ) {
                  rawQuery = "";
                  params.path = flags.path || firstToken;
                } else {
                  rawQuery = firstToken;
                  params.path = flags.path || ".";
                }
              }
            } else {
              rawQuery = beforeFlags;
              params.path = flags.path || ".";
            }
          }
        }

        // Allow multi-line query appending
        toolUse.isArgBased = false;
        params.query = this.splitPipe(rawQuery);
        native.query = params.query;
        native.path = params.path;

        // Single-letter G is documented as regex search, so force regex mode.
        // Leave long-form grep/search unchanged to avoid altering other schemas.
        if (shortName === "G") {
          params.literal = false;
          native.literal = false;
        }

        // Schema uses --case-sensitive. If present, it means case_insensitive should be false.
        if (
          flags["case-sensitive"] !== undefined ||
          flags.case_sensitive === "true"
        ) {
          params.case_insensitive = false;
          native.case_insensitive = false;
        } else if (
          flags["case-insensitive"] !== undefined ||
          flags.case_insensitive === "true"
        ) {
          params.case_insensitive = true;
          native.case_insensitive = true;
        }

        if (
          hasIncludeAllShortFlag ||
          flags["include-all"] === "true" ||
          flags.include_all === "true"
        ) {
          params.include_all = true;
          native.include_all = true;
        }
        break;
      }
      case "T":
      case "todo":
        params.todos = argsStr.trim();
        native.todos = argsStr.trim();
        // Mark as content-consuming to ensure appendContentToTool is called
        toolUse.isArgBased = false;
        break;
      case "D":
      case "done":
        params.result = argsStr.trim();
        native.result = params.result;
        break;
      case "X":
      case "web":
        params.query = flags.query || argsStr.trim();
        native.query = params.query;
        break;
      case "research": {
        params.query = flags.topic || flags.query || argsStr.trim();
        native.query = params.query;
        if (flags.depth) {
          params.depth = flags.depth;
          native.depth = parseInt(flags.depth);
        }
        break;
      }
      case "U":
      case "fetch": {
        const {
          cleanedInput: fetchArgs,
          present: hasIncludeLinksShortFlag,
        } = extractStandaloneShortFlag(argsStr, "L");
        params.url = flags.url || fetchArgs.trim();
        native.url = params.url;
        if (
          hasIncludeLinksShortFlag ||
          flags.links === "true" ||
          flags.include_links === "true" ||
          flags["include-links"] === "true"
        ) {
          params.include_links = "true";
          native.include_links = true;
        }
        break;
      }
      case "browse":
      case "browser":
        params.action = "launch";
        params.url = flags.url || argsStr.trim();
        native.action = "launch";
        native.url = params.url;
        break;
      case "click": {
        params.action = "click";
        params.coordinate = flags.coordinate || argsStr.trim();
        native.action = "click";
        native.coordinate = params.coordinate;
        break;
      }
      case "type":
        params.action = "type";
        params.text = flags.text || argsStr.trim();
        native.action = "type";
        native.text = params.text;
        break;
      case "scroll":
        params.action = flags.direction === "up" ? "scroll_up" : "scroll_down";
        native.action = params.action;
        break;
      case "image":
        params.prompt = flags.prompt || "";
        params.output_path = flags.path || "";
        native.prompt = params.prompt;
        native.path = params.output_path;
        break;
      case "edit_file":
        params.target_file = flags.path || argsStr.trim();
        native.target_file = params.target_file;
        break;
      case "new_rule":
      case "M":
      case "mkdir":
        params.path = flags.path || argsStr.trim();
        native.path = params.path;
        break;
      case "Z":
      case "agent":
      case "sub":
      case "run_sub_agent":
        params.instructions = flags.instructions || argsStr.trim();
        native.instructions = params.instructions;
        if (flags.mode) {
          params.mode = flags.mode;
          native.mode = flags.mode;
        }
        break;
      case "S":
      case "fast_context":
      case "context":
      case "semgrep":
        let query = flags.query || argsStr.trim();
        let path = flags.path;

        // Single-letter syntax refinement: split "query path"
        if (shortName === "S" && query && !path && !flags.query) {
          const parts = query.split(/\s+/);
          if (parts.length >= 2) {
            query = parts[0];
            path = parts[1];
          }
        }

        params.query = query;
        native.query = query;
        if (path) {
          params.path = path;
          native.path = path;
        }
        if (flags.path) {
          params.path = flags.path;
          native.path = flags.path;
        }
        break;
      case "browser_action":
        params.action = flags.action || argsStr.trim();
        native.action = params.action;
        if (flags.url) {
          params.url = flags.url;
          native.url = flags.url;
        }
        if (flags.coordinate) {
          params.coordinate = flags.coordinate;
          native.coordinate = flags.coordinate;
        }
        if (flags.text) {
          params.text = flags.text;
          native.text = flags.text;
        }
        if (flags.size) {
          params.size = flags.size;
          native.size = flags.size;
        }
        if (flags.path) {
          params.path = flags.path;
          native.path = flags.path;
        }
        break;
      case "wrap": {
        const wrapKeys = [
          "effect",
          "emotion",
          "gui",
          "color",
          "bg",
          "border",
          "shadow",
          "style",
          "intensity",
        ];
        for (const key of wrapKeys) {
          if (flags[key]) {
            params[key] = flags[key];
            native[key] = flags[key];
          } else {
            const regex = new RegExp(
              `${key}\\s*=\\s*(?:\\"([^\\"]*)\\"|\\'([^\\']*)\\'|([^,;\\s]+))`,
              "i",
            );
            const m = argsStr.match(regex);
            if (m) {
              const val = (m[1] ?? m[2] ?? m[3]).trim();
              params[key] = val;
              native[key] = val;
            }
          }
        }
        break;
      }
    }
  }

  private normalizeCmdCommand(input: string): string {
    let command = (input || "").trim();
    if (!command) return command;

    // Check if command contains shell metacharacters that need quote protection
    const hasShellMetachars = /[;&|<>()$`\\'"{}[\]!*?~]/.test(command);

    // Handle parser wrapper artifacts like ("npm test"), but keep legitimate shell groups.
    // We recursively strip outer parens and quotes if they wrap the ENTIRE command.
    let prev = "";
    while (command !== prev && command.length > 0) {
      prev = command;

      // 1. Strip matching outer parens if they wrap the whole command and are balanced
      if (this.isWrappedBySinglePairOfParens(command)) {
        const inner = command.slice(1, -1).trim();
        // Only unwrap if it looks like an artifact (e.g. inner also had quotes that get stripped)
        // OR if it's a very simple command that wouldn't normally be a subshell
        const unquotedInner = this.stripMatchingOuterQuotes(inner);
        if (unquotedInner !== inner || !inner.includes(" ")) {
          command = inner;
        }
      }

      // 2. Strip matching outer quotes ONLY if the inner content doesn't need them
      const trimmed = command.trim();
      if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];

        // If wrapped in quotes, check if we should strip them
        if (
          (first === '"' || first === "'" || first === "`") &&
          last === first &&
          !this.isEscaped(trimmed, trimmed.length - 1)
        ) {
          const inner = trimmed.slice(1, -1);

          // CRITICAL: Don't strip quotes if the inner content has embedded quotes or complex shell syntax
          // that would break when passed to shell -c
          const hasEmbeddedQuotes =
            inner.includes('"') || inner.includes("'") || inner.includes("`");
          const hasComplexShellSyntax = /[;&|<>()$`\\]/.test(inner);

          // Only strip if it's a simple command without embedded quotes or complex syntax
          if (!hasEmbeddedQuotes && !hasComplexShellSyntax) {
            const unquoted = this.stripMatchingOuterQuotes(command);
            if (unquoted !== command) {
              command = unquoted.trim();
            }
          } else {
            // Keep the quotes - they're protecting the command
            break;
          }
        }
      }
    }

    return command;
  }

  private stripMatchingOuterQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) return trimmed;

    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (
      (first === '"' || first === "'" || first === "`") &&
      last === first &&
      !this.isEscaped(trimmed, trimmed.length - 1)
    ) {
      const inner = trimmed.slice(1, -1);
      // Unescape only backslashes escaping the quote character or backslash itself.
      // Other escapes (like \n, \t) are left intact for shell command propagation.
      const escapeRegex = new RegExp(`\\\\([\\\\${first}])`, "g");
      return inner.replace(escapeRegex, "$1");
    }

    return trimmed;
  }

  private isEscaped(value: string, index: number): boolean {
    let slashCount = 0;
    for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {
      slashCount++;
    }
    return slashCount % 2 === 1;
  }

  private isWrappedBySinglePairOfParens(value: string): boolean {
    const trimmed = value.trim();
    if (!(trimmed.startsWith("(") && trimmed.endsWith(")"))) return false;

    let depth = 0;
    let quote: '"' | "'" | "`" | null = null;
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "(") {
        depth++;
        continue;
      }

      if (char === ")") {
        depth--;
        if (depth < 0) return false;
        if (depth === 0 && i < trimmed.length - 1) {
          return false;
        }
      }
    }

    return depth === 0;
  }

  private populateXmlArgs(shortName: string, args: string[], toolUse: any) {
    // console.log(`[UnifiedToolCallParser] 🔍 populateXmlArgs called: shortName=${shortName}, args.length=${args.length}, args=${JSON.stringify(args)}`)
    populateToolParamsFromXmlArgs(shortName, args, toolUse);
    // console.log(`[UnifiedToolCallParser] 🔍 After populateToolParamsFromXmlArgs: native.files=${JSON.stringify(toolUse.nativeArgs?.files)}`)

    // Custom post-processing for UnifiedToolCallParser specific logic
    if (
      shortName === "edit" ||
      shortName === "write" ||
      shortName === "write_to_file"
    ) {
      if (args.length > 1) {
        this.appendContentToTool(toolUse, args.slice(1).join("\n"));
      }
    }
  }

  private appendContentToTool(toolUse: any, content: string) {
    if (toolUse.isArgBased) return;

    if (toolUse.name === "edit" || toolUse.name === "edit_file") {
      let contentToProcess = content;

      // KILOCODE FIX: Strip "Content:" anchor if present at the beginning
      // This anchor is a cognitive checkpoint for the model but should not appear in actual content
      if (contentToProcess.trimStart().startsWith("Content:")) {
        contentToProcess = contentToProcess.replace(/^\s*Content:\s*\n?/, "");
      }

      // KILOCODE MOD: Support multi-line path (path on next line)
      const hasPath =
        toolUse.name === "edit"
          ? !!toolUse.params.path
          : !!toolUse.params.target_file;
      if (!hasPath) {
        const firstNewline = contentToProcess.indexOf("\n");
        let potentialPath = "";
        if (firstNewline === -1) {
          potentialPath = contentToProcess.trim();
          if (potentialPath) contentToProcess = "";
        } else {
          // Extract first line as path
          potentialPath = contentToProcess.slice(0, firstNewline).trim();
          contentToProcess = contentToProcess.slice(firstNewline + 1);
        }

        if (potentialPath) {
          if (toolUse.name === "edit") {
            toolUse.params.path = potentialPath;
            toolUse.nativeArgs.path = potentialPath;
          } else {
            toolUse.params.target_file = potentialPath;
            toolUse.nativeArgs.target_file = potentialPath;
          }
        }
      }

      if (toolUse.name === "edit") {
        toolUse.params.edit = (toolUse.params.edit || "") + contentToProcess;
        // KILOCODE FIX: Remove escape backslashes from literals like \/edit in edit content
        toolUse.params.edit = toolUse.params.edit.replace(
          /\\((?:\/)(?:edit|write|edit_file|write_to_file|todo|wrap|E|W|[A-Z]))/g,
          "$1",
        );
        const edits = this.parseEditBlocks(toolUse.params.edit);
        // Propagate line range hints from the tool call header to individual blocks
        // If the header has multiple ranges, assign them sequentially
        if (toolUse.nativeArgs.ranges && toolUse.nativeArgs.ranges.length > 0) {
          edits.forEach((edit: any, idx: number) => {
            // Per-block range (Old (10-20):) takes priority
            if (edit.start_line !== undefined) return;

            // Otherwise use range from header if available for this block index
            const range = toolUse.nativeArgs.ranges[idx];
            if (range) {
              edit.start_line = range.start;
              edit.end_line = range.end;
            }
          });
        } else if (
          toolUse.params.start_line !== undefined ||
          toolUse.params.end_line !== undefined
        ) {
          // Legacy single-range support
          edits.forEach((edit: any) => {
            if (edit.start_line === undefined)
              edit.start_line = toolUse.params.start_line;
            if (edit.end_line === undefined)
              edit.end_line = toolUse.params.end_line;
          });
        }
        toolUse.nativeArgs.edits = edits;
      } else {
        toolUse.params.instructions =
          (toolUse.params.instructions || "") + content;
        toolUse.nativeArgs.instructions = toolUse.params.instructions;
      }
    } else if (
      toolUse.name === "write_to_file" ||
      toolUse.name === "new_rule"
    ) {
      let cleanContent = content;

      // KILOCODE MOD: Support multi-line path (path on next line) - extract before Content: marker
      const hasPath = !!(toolUse.params.path || toolUse.params.target_file);
      if (!hasPath) {
        // Check if first line is the path (before "Content:" marker)
        const contentMarkerIndex = cleanContent.indexOf("Content:");
        if (contentMarkerIndex !== -1) {
          // Extract everything before "Content:" as potential path
          const beforeContent = cleanContent
            .slice(0, contentMarkerIndex)
            .trim();
          if (beforeContent) {
            toolUse.params.path = beforeContent;
            toolUse.params.target_file = beforeContent;
            toolUse.nativeArgs.path = beforeContent;
            toolUse.nativeArgs.target_file = beforeContent;
          }
          // Remove the path line and Content: marker
          cleanContent = cleanContent.slice(contentMarkerIndex);
        } else {
          // No Content: marker, first line is path
          const firstNewline = cleanContent.indexOf("\n");
          let potentialPath = "";
          if (firstNewline === -1) {
            potentialPath = cleanContent.trim();
            if (potentialPath) cleanContent = "";
          } else {
            potentialPath = cleanContent.slice(0, firstNewline).trim();
            cleanContent = cleanContent.slice(firstNewline + 1);
          }
          if (potentialPath) {
            toolUse.params.path = potentialPath;
            toolUse.params.target_file = potentialPath;
            toolUse.nativeArgs.path = potentialPath;
            toolUse.nativeArgs.target_file = potentialPath;
          }
        }
      }

      // KILOCODE FIX: Strip "Content:" anchor if present at the beginning
      if (cleanContent.trimStart().startsWith("Content:")) {
        cleanContent = cleanContent.replace(/^\s*Content:\s*\n?/, "");
      }

      if (!toolUse.params.content) {
        // Only strip the very first leading newline that follows the tool header
        cleanContent = cleanContent.replace(/^\r?\n/, "");
      }
      // KILOCODE FIX: Remove escape backslashes from literals like \/write or \/W
      const unescapedContent = cleanContent.replace(
        /\\((?:\/)(?:edit|write|edit_file|write_to_file|todo|wrap|E|W|[A-Z]))/g,
        "$1",
      );
      toolUse.params.content =
        (toolUse.params.content || "") + unescapedContent;
      toolUse.nativeArgs.content = toolUse.params.content;
    } else if (
      toolUse.name === "update_todo_list" ||
      toolUse.name === "todo" ||
      toolUse.originalName === "T"
    ) {
      const existing = (toolUse.params.todos || "").trim();
      const newContent = content.trim();
      if (existing && newContent) {
        toolUse.params.todos = existing + "\n" + newContent;
      } else {
        toolUse.params.todos = existing || newContent;
      }
      toolUse.nativeArgs.todos = toolUse.params.todos;
    } else if (toolUse.name === "execute_command") {
      // New logic: if argsStr exists, it's the CWD. Content is the command.
      if (toolUse.params.command && content.trim()) {
        // argsStr was already put in command by populateToolArgs, move it to cwd
        toolUse.params.cwd = toolUse.params.command.trim();
        toolUse.params.command = content.trim();
      } else {
        toolUse.params.command = (toolUse.params.command || "") + content;
      }
      toolUse.nativeArgs.command = toolUse.params.command;
      toolUse.nativeArgs.cwd = toolUse.params.cwd;
    } else if (
      toolUse.name === "web_search" ||
      toolUse.name === "research_web" ||
      toolUse.name === "grep" ||
      toolUse.name === "glob"
    ) {
      const paramKey = toolUse.name === "glob" ? "pattern" : "query";
      let cleanContent = content;
      if (
        !toolUse.params[paramKey] ||
        toolUse.params[paramKey] === "*" ||
        toolUse.params[paramKey] === ""
      ) {
        cleanContent = content.replace(/^\r?\n/, "");
      }

      // KILOCODE MOD: If query is already an array (multi-query),
      // append content as a new query if it's substantial,
      // or just avoid concatenating strings which results in [object Object] or "q1,q2" strings.
      const lines = cleanContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        if (
          !toolUse.params[paramKey] ||
          toolUse.params[paramKey] === "*" ||
          toolUse.params[paramKey] === ""
        ) {
          toolUse.params[paramKey] = lines.length > 1 ? lines : lines[0];
        } else {
          const existing = Array.isArray(toolUse.params[paramKey])
            ? toolUse.params[paramKey]
            : [toolUse.params[paramKey]];
          const cleanExisting = existing.filter(
            (e: string) => e !== "*" && e !== "",
          );
          toolUse.params[paramKey] = [...cleanExisting, ...lines];
        }
        toolUse.nativeArgs[paramKey] = toolUse.params[paramKey];
      }
    } else if (toolUse.name === "wrap") {
      let cleanContent = content;
      if (!toolUse.params.content) {
        cleanContent = content.replace(/^\r?\n/, "");
      }
      toolUse.params.content = (toolUse.params.content || "") + cleanContent;
      toolUse.nativeArgs.content = toolUse.params.content;
    } else if (toolUse.name === "run_sub_agent") {
      toolUse.params.instructions =
        (toolUse.params.instructions || "") + content;
      toolUse.nativeArgs.instructions = toolUse.params.instructions;
    }
  }

  private parseEditBlocks(diffContent: string): any[] {
    // NOTE: We do NOT strip diff_N headers anymore; we parse them to extract line context.
    const sanitized = diffContent.replace(
      /^(\s*)(\d+(?:\s*-\s*\d+)?)\s*$/gm,
      "$1$2:",
    );
    const edits: any[] = [];

    // V4 Regex: Context-Aware Header Matching.
    // Added 'diff_\\d+' to the list of recognized headers.
    // Also updated range matching to support BOTH comma and hyphen separators: (\d+)(?:[-]|,[\t ]*)(\d+)
    // Support both "Old start-end:" and "Old (start-end):"
    // KILOCODE MOD: Support high-speed diff syntax: "- 10-12" and "+", plus colon format "10-12:" and "New:"
    const headerRegex =
      /^\s*(?:(Old|Original|SEARCH|New|Updated|REPLACE|diff_\d+|\+)(?:(?:[\t ]*(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?))|(?=:))?(:|(?=\s*\r?\n|$))|(rm|remove|delete|-)[\t ]+(?:(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?))|\b(\d+)(?:[\t ]*-[\t ]*(\d+))?:)/gim;

    let match;
    const headers: {
      index: number;
      length: number;
      type: string;
      start?: string;
      end?: string;
    }[] = [];

    while ((match = headerRegex.exec(sanitized)) !== null) {
      headers.push({
        index: match.index,
        length: match[0].length,
        type: match[1] || match[5] || "range", // "range" for colon format like "10-12:"
        start: match[2] || match[6] || match[8],
        end: match[3] || match[7] || match[9],
      });
    }

    if (headers.length === 0) return [];

    const blocks = headers.map((h, i) => {
      const nextHeader = headers[i + 1];
      // Calculate content start (skip the header line)
      const contentStart = h.index + h.length;
      const contentEnd = nextHeader ? nextHeader.index : sanitized.length;
      const content = sanitized.slice(contentStart, contentEnd);
      return { ...h, content };
    });

    const pendingOlds: {
      oldText: string;
      start_line?: number;
      end_line?: number;
    }[] = [];
    let currentRange: { start: number; end: number } | undefined;

    for (const block of blocks) {
      const isOld =
        /Old|Original|SEARCH/i.test(block.type) || block.type === "-" || block.type === "range";
      const isNew =
        /New|Updated|REPLACE/i.test(block.type) || block.type === "+";
      const isDelete = /rm|remove|delete/i.test(block.type);
      const isDiffHeaders = /diff_\d+/i.test(block.type);

      const normalizeBlock = (rawContent: string): string => {
        // KILOCODE FIX: Improved artifact stripping.
        // When we split the message by headers, the 'content' of a block
        // naturally starts with a newline (immediately after "Old:\n")
        // and ends with one (immediately before "New:\n").
        // We MUST remove exactly one leading and one trailing newline if they exist,
        // but we must NOT strip intentional blank lines or indentation.

        let processed = rawContent;

        // 1. Remove exactly one leading newline if it exists (possibly preceded by spaces)
        processed = processed.replace(/^[ \t]*\r?\n/, "");

        // 2. Remove exactly one trailing newline if it exists (possibly preceded by spaces)
        processed = processed.replace(/\r?\n[ \t]*$/, "");

        return processed;
      };

      if (isDiffHeaders) {
        // Update current context for subsequent blocks
        if (block.start) {
          currentRange = {
            start: parseInt(block.start),
            end: block.end ? parseInt(block.end) : parseInt(block.start),
          };
        }
        // diff_N blocks don't produce edits directly, they just set context
        continue;
      }

      if (isDelete) {
        if (block.start) {
          edits.push({
            type: "line_deletion",
            start_line: parseInt(block.start),
            end_line: block.end ? parseInt(block.end) : parseInt(block.start),
            oldText: "",
            newText: "",
          });
        }
      } else if (isOld) {
        const startLine = block.start
          ? parseInt(block.start)
          : currentRange?.start;
        const endLine = block.end
          ? parseInt(block.end)
          : block.start
            ? parseInt(block.start)
            : currentRange?.end;

        pendingOlds.push({
          oldText: normalizeBlock(block.content),
          start_line: startLine,
          end_line: endLine,
        });
      } else if (isNew) {
        // This is a New/Updated/REPLACE block
        const matchingOld = pendingOlds.shift();
        const newText = normalizeBlock(block.content);

        // Check if New block has its own line numbers (e.g., "New (136-140):")
        const newStartLine = block.start ? parseInt(block.start) : undefined;
        const newEndLine = block.end
          ? parseInt(block.end)
          : block.start
            ? parseInt(block.start)
            : undefined;

        if (matchingOld) {
          const isDeletion =
            newText === "" && matchingOld.start_line !== undefined;
          edits.push({
            ...(isDeletion ? { type: "line_deletion" } : {}),
            oldText: matchingOld.oldText,
            newText,
            // Prefer Old block's line numbers, but fall back to New block's if Old had none
            start_line: matchingOld.start_line ?? newStartLine,
            end_line: matchingOld.end_line ?? newEndLine,
          });
        } else if (newStartLine !== undefined) {
          // Orphaned New block WITH line numbers = line-range replacement (empty Old)
          // This is the new format: "New (136-140):" with line-numbered content
          edits.push({
            oldText: "", // Empty - will be filled from file content by EditTool
            newText,
            start_line: newStartLine,
            end_line: newEndLine,
          });
        } else if (edits.length > 0) {
          // An orphaned New block without line numbers appends to the previous one
          const prevNewText = edits[edits.length - 1].newText;
          edits[edits.length - 1].newText = prevNewText + "\n" + newText;
        }
      }
    }

    // Handle trailing Old blocks (Streaming partials or deletions?)
    // If we end with Old blocks, they are likely partial tool calls being streamed.
    for (const p of pendingOlds) {
      edits.push({
        oldText: p.oldText,
        newText: "", // Partial
        start_line: p.start_line,
        end_line: p.end_line,
      });
    }
    return edits;
  }

  private cleanTextContent(text: string): string {
    let clean = text;

    // 1. During streaming, partial prefixes like "tool:" can leak
    // into text blocks before the full tool call is recognized in the next chunk.
    clean = clean.replace(/`{0,3}tool:[\w-]*(?:\([^)]*)?$/gm, "");

    // 2. Strip XML/native tool call patterns that models sometimes generate alongside tool output.
    // This handles <minimax:tool_call>,  , <invoke>, <function_call>, etc.
    // Remove entire XML tool call blocks (multiline)
    clean = clean.replace(
      /<(?:[\w-]+:)?tool_call>[\s\S]*?<\/(?:[\w-]+:)?tool_call>/g,
      "",
    );
    clean = clean.replace(/<invoke\s[^>]*>[\s\S]*?<\/invoke>/g, "");
    clean = clean.replace(/<function_call>[\s\S]*?<\/function_call>/g, "");
    // Remove orphaned opening tags (streaming - closing tag hasn't arrived yet)
    clean = clean.replace(/<(?:[\w-]+:)?tool_call>[\s\S]*$/g, "");
    clean = clean.replace(
      /<invoke\s+name="[^"]*">\s*(?:<parameter\s[^>]*>[^<]*<\/parameter>\s*)*$/g,
      "",
    );

    return clean.trim();
  }

  private cleanBlockContent(t: string): string {
    let text = t;

    // We strip ONE leading newline if it directly followed the header (common artifact),
    // but we do NOT trimStart() indiscriminately which kills indentation.
    if (text.startsWith("\n")) text = text.slice(1);
    if (text.startsWith("\r\n")) text = text.slice(2);

    // Structural Intent Shift Detection disabled.
    // Content tools must only terminate on explicit closing tags.

    // Return raw text without final trim, preserving trailing newlines if they were inferred to be part of the edit
    return text;
  }
}
