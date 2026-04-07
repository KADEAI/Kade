import {
  ToolName,
  ToolUse,
  McpToolUse,
  TOOL_ALIASES,
} from "../../shared/tools";
import { resolveToolAlias } from "../../shared/tool-aliases";
import { AssistantMessageContent } from "./parseAssistantMessage";
import {
  applyParamsDefaulting,
  populateToolParamsFromXmlArgs,
} from "./XmlToolParser";
import {
  HISTORY_CONTENT_PLACEMENT_PLACEHOLDER,
  formatWriteHistoryPlaceholderBody,
  redactEditHistoryBody,
  isEditHistoryPlaceholder,
  isWriteHistoryPlaceholder,
} from "../prompts/responses";
import { splitGlobPatternList } from "../../shared/globPatterns";
import { stripRedundantLineRangePipePrefix } from "../tools/EditTool";

export class UnifiedToolCallParser {
  private pendingBuffer = "";
  private finalizedBlocks: AssistantMessageContent[] = [];
  private bufferStartIndex = 0;
  private mcpToolNames: Map<string, { serverName: string; toolName: string }> =
    new Map();
  private toolCounter = 0; // Increments for each NEW tool block encountered

  constructor() {}

  private static readonly CONTENT_TOOL_SHORT_NAMES = new Set([
    "write",
    "edit",
    "write",
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
    "write",
    "new_rule",
    "todo",
    "wrap",
    "E",
    "W",
    "T",
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
    "bash",
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
    "agent",
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
    "computer_action",
    "computer",
    "desktop",
    "semgrep",
    "wrap",
    "mkdir",
    "find",
    "use_mcp_tool",
    "access_mcp_resource",
  ]);

  private static readonly XML_TOOL_START_REGEX =
    /<((?:use_mcp_tool|access_mcp_resource))>/gm;
  private static readonly WRAPPED_TOOL_CALL_START_REGEX =
    /<(?:[\w-]+:)?tool_call>/gm;
  private static readonly TOOL_FENCE_BLOCK_START_REGEX =
    /(?:^|[\r\n]|[.!?])[ \t]*```tool[ \t]*(?:\r?\n|$)/gi;
  private static readonly ACTIONS_BLOCK_START_REGEX =
    /(?:^|[\r\n]|[.!?])[ \t]*ACTIONS?/g;
  private static readonly ACTIONS_COMMANDS = [
    "write",
    "bash",
    "fetch",
    "agent",
    "grep",
    "find",
    "read",
    "list",
    "mkdir",
    "edit",
    "todo",
    "ask",
    "web",
    "desktop",
    "computer_action",
  ] as const;
  private static readonly ACTIONS_COMMAND_CANDIDATES = [
    ...new Set([
      ...UnifiedToolCallParser.ACTIONS_COMMANDS,
      "shell",
      ...Object.keys(TOOL_ALIASES),
    ]),
  ].sort((left, right) => right.length - left.length);

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

  private splitGlobPatterns(input: string[] | string): string | string[] {
    const patterns = splitGlobPatternList(input, { allowLegacyPipe: true });
    return patterns.length > 1 ? patterns : patterns[0] || "";
  }

  private splitOnFirstUnescapedColon(
    input: string,
  ): { before: string; after: string } | null {
    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === ":") {
        return {
          before: input.slice(0, index),
          after: input.slice(index + 1),
        };
      }
    }

    return null;
  }

  private unescapeInlineColon(value: string): string {
    return value.replace(/\\:/g, ":");
  }

  private parseScopedInlineArg(
    value: string,
    options: { allowWhitespaceScope?: boolean } = {},
  ): { scope: string; payload: string } | null {
    const normalized = this.stripMatchingOuterQuotes(value);
    const split = this.splitOnFirstUnescapedColon(normalized);
    if (!split) {
      return null;
    }

    const scope = this.unescapeInlineColon(split.before.trim());
    const payload = this.unescapeInlineColon(split.after.trim());

    if (!scope || !payload) {
      return null;
    }

    if (options.allowWhitespaceScope === false && /\s/.test(scope)) {
      return null;
    }

    return { scope, payload };
  }

  private parseGrepScopeArg(scope: string): {
    path?: string;
    include?: string;
  } {
    const normalizedScope = this.stripMatchingOuterQuotes(scope).trim();
    if (!normalizedScope) {
      return {};
    }

    if (/^include\s*=/i.test(normalizedScope)) {
      const pipeIndex = normalizedScope.indexOf("|");
      const includeSegment =
        pipeIndex === -1
          ? normalizedScope
          : normalizedScope.slice(0, pipeIndex).trim();
      const pathSegment =
        pipeIndex === -1
          ? "."
          : normalizedScope.slice(pipeIndex + 1).trim() || ".";

      return {
        include: includeSegment.replace(/^include\s*=\s*/i, "").trim(),
        path: pathSegment,
      };
    }

    return { path: normalizedScope };
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

  private looksLikePathArg(argsStr: string): boolean {
    const trimmed = argsStr.trim();
    if (!trimmed) {
      return false;
    }

    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../") ||
      trimmed.startsWith("~/") ||
      trimmed.startsWith('"') ||
      trimmed.startsWith("'") ||
      trimmed.startsWith("`")
    ) {
      return true;
    }

    if (/\s+--/.test(trimmed) || trimmed.startsWith("--")) {
      return true;
    }

    if (!/\s/.test(trimmed)) {
      return true;
    }

    return false;
  }

  private isFinalized = false;
  private hasFinalizedTool = false;
  private hasCompletedToolFenceBatch = false;
  private currentTurnId = Date.now().toString();

  /**
   * Returns true if a tool call has been finalized (closed) in this turn.
   * Used by AgentLoop to stop accumulating trailing text after tool calls.
   * Note: This also handles "brain farts" where the model forgets to populate tool actions.
   */
  public hasCompletedToolCall(): boolean {
    return this.hasFinalizedTool;
  }

  /**
   * Returns true only when the current unified stream can be terminated early
   * without risking additional tool blocks being cut off.
   */
  public hasCompletedStreamingToolBatch(): boolean {
    return this.hasCompletedToolFenceBatch;
  }

  public reset() {
    this.pendingBuffer = "";
    this.finalizedBlocks = [];
    this.bufferStartIndex = 0;
    this.isFinalized = false;
    this.hasFinalizedTool = false;
    this.hasCompletedToolFenceBatch = false;
    this.currentTurnId = Date.now().toString();
    this.toolCounter = 0;
  }

  public processChunk(chunk: string): {
    blocks: AssistantMessageContent[];
    safeIndex: number;
  } {
    if (this.hasCompletedToolFenceBatch && !this.isFinalized) {
      const continuationCandidate = this.pendingBuffer + chunk;
      if (!this.canResumeAfterCompletedTool(continuationCandidate)) {
        return {
          blocks: [...this.finalizedBlocks],
          safeIndex: 0,
        };
      }

      this.hasCompletedToolFenceBatch = false;
    }

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

  public canResumeAfterCompletedTool(message: string): boolean {
    const leadingWhitespaceLength = message.match(/^\s*/)?.[0].length ?? 0;
    const trimmedStart = message.slice(leadingWhitespaceLength);

    if (!trimmedStart) {
      return false;
    }

    if (this.findToolFenceBlockStart(trimmedStart, 0) === 0) {
      return true;
    }

    if (this.findWrappedToolCallStart(trimmedStart, 0) === 0) {
      return true;
    }

    if (this.findAtActionsBlockStart(trimmedStart, 0) === 0) {
      return true;
    }

    if (this.findActionsBlockStart(trimmedStart, 0) === 0) {
      return true;
    }

    if (this.findImplicitActionsBlockStart(trimmedStart, 0) === 0) {
      return true;
    }

    return /^(?:<(?:use_mcp_tool|access_mcp_resource)>)/.test(trimmedStart);
  }

  public finalizeContentBlocks(): void {
    this.isFinalized = true;
    if (this.hasCompletedToolFenceBatch) {
      this.pendingBuffer = "";
      return;
    }
    // Parse everything remaining as final
    const { finalized, pending } = this.parseMessage(this.pendingBuffer, true);
    // Everything returned is finalized (since isFinalized=true)
    this.finalizedBlocks.push(...finalized, ...pending);
    this.pendingBuffer = "";
  }

  public getContentBlocks(): AssistantMessageContent[] {
    if (this.hasCompletedToolFenceBatch && !this.isFinalized) {
      return [...this.finalizedBlocks];
    }

    const { finalized, pending } = this.parseMessage(
      this.pendingBuffer,
      this.isFinalized,
    );
    return [...this.finalizedBlocks, ...finalized, ...pending];
  }

  public trimRawMessageAfterLastCompletedTool(message: string): string {
    const lastCompletedWrapperlessToolEnd =
      this.findLastCompletedWrapperlessToolEnd(message);
    const lastCompletedXmlToolEnd = this.findLastCompletedXmlToolEnd(message);
    const lastCompletedToolEnd = Math.max(
      lastCompletedWrapperlessToolEnd,
      lastCompletedXmlToolEnd,
    );

    if (lastCompletedToolEnd === -1) {
      return message;
    }

    return message.slice(0, lastCompletedToolEnd).trimEnd();
  }

  public compactMessageForHistory(message: string): string {
    const trimmed = this.trimRawMessageAfterLastCompletedTool(message);
    return this.stripWriteBodiesFromHistory(trimmed);
  }

  private stripWriteBodiesFromHistory(message: string): string {
    const lines = message.split(/\r?\n/);
    const compacted: string[] = [];
    let inToolFence = false;
    let inActionsBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!inToolFence && !inActionsBlock) {
        if (/^```tool$/i.test(trimmed)) {
          inToolFence = true;
        } else if (/^ACTIONS?$/i.test(trimmed)) {
          inActionsBlock = true;
        }
        compacted.push(line);
        continue;
      }

      if (inToolFence && trimmed === "```") {
        inToolFence = false;
        compacted.push(line);
        continue;
      }

      if (inActionsBlock && /^END$/i.test(trimmed)) {
        inActionsBlock = false;
        compacted.push(line);
        continue;
      }

      const command = this.parseActionsCommand(line);
      if (command?.command !== "write" && command?.command !== "edit") {
        compacted.push(line);
        continue;
      }

      compacted.push(line);

      const contentLines: string[] = [];

      let consumedCloser = false;
      for (i = i + 1; i < lines.length; i++) {
        const bodyLine = lines[i];
        const bodyTrimmed = bodyLine.trim();

        if (this.isContentToolCloserLine(bodyLine, "eof")) {
          if (command.command === "write") {
            compacted.push(
              formatWriteHistoryPlaceholderBody(contentLines.join("\n")),
            );
          }
          if (command.command === "edit") {
            compacted.push(redactEditHistoryBody(contentLines.join("\n")));
          }
          compacted.push(bodyLine);
          consumedCloser = true;
          break;
        }

        if (inToolFence && bodyTrimmed === "```") {
          if (command.command === "write") {
            compacted.push(
              formatWriteHistoryPlaceholderBody(contentLines.join("\n")),
            );
          }
          if (command.command === "edit") {
            compacted.push(redactEditHistoryBody(contentLines.join("\n")));
          }
          inToolFence = false;
          compacted.push(bodyLine);
          consumedCloser = true;
          break;
        }

        if (inActionsBlock && /^END$/i.test(bodyTrimmed)) {
          if (command.command === "write") {
            compacted.push(
              formatWriteHistoryPlaceholderBody(contentLines.join("\n")),
            );
          }
          if (command.command === "edit") {
            compacted.push(redactEditHistoryBody(contentLines.join("\n")));
          }
          inActionsBlock = false;
          compacted.push(bodyLine);
          consumedCloser = true;
          break;
        }

        contentLines.push(bodyLine);
      }

      if (!consumedCloser) {
        break;
      }
    }

    return compacted.join("\n").trimEnd();
  }

  private findLastCompletedWrapperlessToolEnd(message: string): number {
    let lastCompletedToolEnd = -1;
    let allowInlineFirstAtTool = true;

    let currentIndex = 0;
    while (currentIndex < message.length) {
      const toolFenceStart = this.findToolFenceBlockStart(
        message,
        currentIndex,
      );
      const atActionsStart = this.findAtActionsBlockStartInternal(
        message,
        currentIndex,
        allowInlineFirstAtTool,
      );
      const actionsStart = this.findActionsBlockStart(message, currentIndex);
      const implicitStart = this.findImplicitActionsBlockStart(
        message,
        currentIndex,
      );
      const blockStart = [
        toolFenceStart,
        atActionsStart,
        actionsStart,
        implicitStart,
      ]
        .filter((index) => index !== -1)
        .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);

      if (blockStart === Number.POSITIVE_INFINITY) {
        break;
      }

      const parsedBlock =
        toolFenceStart !== -1 && toolFenceStart === blockStart
          ? this.parseToolFenceBlock(message, blockStart, false)
          : atActionsStart !== -1 && atActionsStart === blockStart
            ? this.parseAtActionsBlock(message, blockStart, false)
            : actionsStart !== -1 && actionsStart === blockStart
              ? this.parseActionsBlock(message, blockStart, false)
              : this.parseImplicitActionsBlock(message, blockStart, false);

      if (!parsedBlock.closed) {
        break;
      }

      if (parsedBlock.blocks.length > 0) {
        lastCompletedToolEnd = Math.max(
          lastCompletedToolEnd,
          parsedBlock.endIndex,
        );
        allowInlineFirstAtTool = false;
      }

      currentIndex = parsedBlock.endIndex;
    }

    return lastCompletedToolEnd;
  }

  private findLastCompletedXmlToolEnd(message: string): number {
    let lastCompletedToolEnd = -1;
    const toolStartRegex = new RegExp(
      UnifiedToolCallParser.XML_TOOL_START_REGEX,
    );
    let match: RegExpExecArray | null;

    while ((match = toolStartRegex.exec(message)) !== null) {
      const toolShortName = match[1];
      const startIndex = match.index;
      const startTagEndIndex = startIndex + match[0].length;
      const remainingText = message.slice(startTagEndIndex);
      const closingRegex = new RegExp(
        `(?:^|[\\r\\n])[ \\t]*<\\/${toolShortName}>(?:[ \\t]*(?:[\\r\\n]|$))`,
      );
      const endMatch = remainingText.match(closingRegex);

      if (!endMatch || endMatch.index === undefined) {
        break;
      }

      const endIndex = startTagEndIndex + endMatch.index + endMatch[0].length;
      lastCompletedToolEnd = Math.max(lastCompletedToolEnd, endIndex);
      toolStartRegex.lastIndex = endIndex;
    }

    return lastCompletedToolEnd;
  }

  private parseMessage(
    message: string,
    isFinalized: boolean,
  ): {
    finalized: AssistantMessageContent[];
    pending: AssistantMessageContent[];
    safeIndex: number;
  } {
    const toolFenceStart = this.findToolFenceBlockStart(message, 0);
    const atActionsStart = this.findAtActionsBlockStartInternal(
      message,
      0,
      !this.hasFinalizedTool && this.toolCounter === 0,
    );
    const actionsStart = this.findActionsBlockStart(message, 0);
    const implicitStart = this.findImplicitActionsBlockStart(message, 0);
    const wrappedStart = this.findWrappedToolCallStart(message, 0);
    const firstBlockStart = [
      toolFenceStart,
      atActionsStart,
      actionsStart,
      implicitStart,
      wrappedStart,
    ]
      .filter((index) => index !== -1)
      .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);

    if (firstBlockStart !== Number.POSITIVE_INFINITY) {
      return this.parseMessageWithActions(message, isFinalized);
    }

    const atActions = this.parseAtActionsAtMessageStart(message, isFinalized);
    if (atActions) {
      return atActions;
    }

    const implicitActions = this.parseImplicitActionsAtMessageStart(
      message,
      isFinalized,
    );
    if (implicitActions) {
      return implicitActions;
    }

    return this.parseStandardMessage(message, isFinalized);
  }

  private parseAtActionsAtMessageStart(
    message: string,
    isFinalized: boolean,
  ): {
    finalized: AssistantMessageContent[];
    pending: AssistantMessageContent[];
    safeIndex: number;
  } | null {
    const leadingWhitespaceMatch = message.match(/^\s*/);
    const leadingWhitespaceLength = leadingWhitespaceMatch?.[0].length ?? 0;
    const trimmedStart = message.slice(leadingWhitespaceLength);

    if (!trimmedStart) {
      return null;
    }

    const firstLine = trimmedStart.split(/\r?\n/, 1)[0] ?? "";
    const parsedAction = this.parseAtToolCommand(firstLine);
    const parsedMcpAction = this.parseAtMcpToolCommand(firstLine);
    if (!parsedAction && !parsedMcpAction) {
      return null;
    }

    const blocks = this.parseActionsBody(trimmedStart, isFinalized);
    if (blocks.length === 0) {
      return null;
    }

    if (isFinalized && blocks.length > 0) {
      this.hasFinalizedTool = true;
    }

    return {
      finalized: isFinalized ? blocks : [],
      pending: isFinalized ? [] : blocks,
      safeIndex: isFinalized ? message.length : 0,
    };
  }

  private parseImplicitActionsAtMessageStart(
    message: string,
    isFinalized: boolean,
  ): {
    finalized: AssistantMessageContent[];
    pending: AssistantMessageContent[];
    safeIndex: number;
  } | null {
    const leadingWhitespaceMatch = message.match(/^\s*/);
    const leadingWhitespaceLength = leadingWhitespaceMatch?.[0].length ?? 0;
    const trimmedStart = message.slice(leadingWhitespaceLength);

    if (!trimmedStart) {
      return null;
    }

    const firstLine = trimmedStart.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (!firstLine || !this.parseActionsCommand(firstLine)) {
      return null;
    }

    const endMatch = this.matchImplicitActionsEnd(trimmedStart);
    const endIndex =
      endMatch && endMatch.index !== undefined
        ? endMatch.index + endMatch[0].indexOf("END")
        : -1;
    const consumedLength =
      endMatch && endMatch.index !== undefined
        ? endMatch.index + endMatch[0].length
        : -1;
    const body =
      endIndex === -1 ? trimmedStart : trimmedStart.slice(0, endIndex);
    const blocks = this.parseActionsBody(body, isFinalized || endIndex !== -1);
    if (blocks.length === 0) {
      return null;
    }

    if ((isFinalized || endIndex !== -1) && blocks.length > 0) {
      this.hasFinalizedTool = true;
    }

    return {
      finalized: isFinalized || endIndex !== -1 ? blocks : [],
      pending: isFinalized || endIndex !== -1 ? [] : blocks,
      safeIndex: isFinalized
        ? message.length
        : endIndex === -1
          ? 0
          : leadingWhitespaceLength + consumedLength,
    };
  }

  private matchImplicitActionsEnd(message: string): RegExpExecArray | null {
    return /(?:^|[\r\n])[ \t]*END(?:[^\r\n]*)?(?=$|[\r\n])/.exec(message);
  }

  private findImplicitActionsEnd(message: string): number {
    const match = this.matchImplicitActionsEnd(message);
    if (!match || match.index === undefined) {
      return -1;
    }

    const endOffset = match[0].indexOf("END");
    return endOffset === -1 ? -1 : match.index + endOffset;
  }

  private findImplicitActionsBlockStart(
    message: string,
    fromIndex: number,
  ): number {
    const regex =
      /(?:^|[\r\n])([ \t]*)(READ|WRITE|EDIT|LIST|MKDIR|GREP|FIND|SHELL|WEB|FETCH|ASK|TODO|AGENT)(?=$|\s|[^\s])/g;
    regex.lastIndex = fromIndex;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
      if (match.index === undefined) {
        break;
      }

      const leadingWhitespace = match[1] ?? "";
      const commandIndex = match.index + match[0].length - match[2].length;
      const lineStart = commandIndex;
      const lineEnd = message.indexOf("\n", lineStart);
      const rawLine =
        lineEnd === -1
          ? message.slice(lineStart)
          : message.slice(lineStart, lineEnd);

      if (this.parseActionsCommand(rawLine)) {
        return commandIndex;
      }

      regex.lastIndex = commandIndex + leadingWhitespace.length + 1;
    }

    return -1;
  }

  private findToolFenceBlockStart(message: string, fromIndex: number): number {
    const regex = /(?:^|[\r\n]|[.!?])[ \t]*```tool[^\r\n]*(?:\r?\n|$)/gi;
    regex.lastIndex = fromIndex;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
      const fenceIndex = match[0].toLowerCase().indexOf("```tool");
      const candidateIndex =
        fenceIndex === -1 ? match.index : match.index + fenceIndex;

      if (this.matchToolFenceOpener(message, candidateIndex)) {
        return candidateIndex;
      }

      regex.lastIndex = candidateIndex + "```tool".length;
    }

    return -1;
  }

  private parseMessageWithActions(
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
    let allowInlineFirstAtTool = !this.hasFinalizedTool && this.toolCounter === 0;

    while (currentIndex < message.length) {
      const toolFenceStart = this.findToolFenceBlockStart(
        message,
        currentIndex,
      );
      const atActionsStart = this.findAtActionsBlockStartInternal(
        message,
        currentIndex,
        allowInlineFirstAtTool,
      );
      const actionsStart = this.findActionsBlockStart(message, currentIndex);
      const implicitStart = this.findImplicitActionsBlockStart(
        message,
        currentIndex,
      );
      const wrappedStart = this.findWrappedToolCallStart(message, currentIndex);
      const blockStart = [
        toolFenceStart,
        atActionsStart,
        actionsStart,
        implicitStart,
        wrappedStart,
      ]
        .filter((index) => index !== -1)
        .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);

      if (blockStart === Number.POSITIVE_INFINITY) {
        const remainder = this.parsePlainTextMessage(
          message.slice(currentIndex),
          isFinalized,
        );
        contentBlocks.push(...remainder.finalized, ...remainder.pending);
        lastSafeIndex = currentIndex + remainder.safeIndex;
        if (remainder.finalized.length > 0) {
          finalizedBlockCount = contentBlocks.length;
        }
        break;
      }

      if (blockStart > currentIndex) {
        const beforeActions = this.parsePlainTextMessage(
          message.slice(currentIndex, blockStart),
          true,
        );
        contentBlocks.push(
          ...beforeActions.finalized,
          ...beforeActions.pending,
        );
        if (
          beforeActions.finalized.length > 0 ||
          beforeActions.pending.length > 0
        ) {
          lastSafeIndex = blockStart;
          finalizedBlockCount = contentBlocks.length;
        }
      }

      const parsedActions =
        toolFenceStart !== -1 && toolFenceStart === blockStart
          ? this.parseToolFenceBlock(message, blockStart, isFinalized)
          : atActionsStart !== -1 && atActionsStart === blockStart
            ? this.parseAtActionsBlock(message, blockStart, isFinalized)
            : wrappedStart !== -1 && wrappedStart === blockStart
              ? this.parseWrappedToolCallBlock(message, blockStart, isFinalized)
              : actionsStart !== -1 && actionsStart === blockStart
                ? this.parseActionsBlock(message, blockStart, isFinalized)
                : this.parseImplicitActionsBlock(
                    message,
                    blockStart,
                    isFinalized,
                  );
      contentBlocks.push(...parsedActions.blocks);
      if (parsedActions.blocks.length > 0) {
        allowInlineFirstAtTool = false;
      }

      if (parsedActions.closed) {
        lastSafeIndex = parsedActions.endIndex;
        finalizedBlockCount = contentBlocks.length;
        currentIndex = parsedActions.endIndex;
        this.hasFinalizedTool =
          parsedActions.blocks.length > 0 || this.hasFinalizedTool;
        if (
          parsedActions.blocks.length > 0 &&
          toolFenceStart !== -1 &&
          toolFenceStart === blockStart
        ) {
          this.hasCompletedToolFenceBatch = true;
        }
        // For the fenced unified protocol, stop after the first completed tool block
        // so the agent loop can terminate the stream before later fenced blocks are parsed.
        if (
          !isFinalized &&
          toolFenceStart !== -1 &&
          toolFenceStart === blockStart
        ) {
          break;
        }
        if (
          !isFinalized &&
          atActionsStart !== -1 &&
          atActionsStart === blockStart
        ) {
          break;
        }
      } else {
        break;
      }
    }

    return {
      finalized: contentBlocks.slice(0, finalizedBlockCount),
      pending: contentBlocks.slice(finalizedBlockCount),
      safeIndex: lastSafeIndex,
    };
  }

  private parseToolFenceBlock(
    message: string,
    startIndex: number,
    isFinalized: boolean,
  ): {
    blocks: AssistantMessageContent[];
    closed: boolean;
    endIndex: number;
  } {
    const openerInfo = this.matchToolFenceOpener(message, startIndex);
    if (!openerInfo) {
      return { blocks: [], closed: false, endIndex: startIndex };
    }

    const bodyStart = startIndex + openerInfo.consumedLength;
    const closingInfo = this.findToolFenceClose(message.slice(bodyStart));
    const remainingBody = message.slice(bodyStart);
    const bodyWithInlineAction = (body: string) =>
      openerInfo.inlineAction
        ? body
          ? `${openerInfo.inlineAction}\n${body}`
          : openerInfo.inlineAction
        : body;

    if (!closingInfo && !isFinalized) {
      const blocks = this.parseActionsBody(
        bodyWithInlineAction(remainingBody),
        false,
      );
      return { blocks, closed: false, endIndex: startIndex };
    }

    const bodyEnd = closingInfo
      ? bodyStart + closingInfo.bodyEnd
      : message.length;
    const body = bodyWithInlineAction(message.slice(bodyStart, bodyEnd));
    const blocks = this.parseActionsBody(body, true);

    if (blocks.length > 0) {
      this.hasFinalizedTool = true;
    }

    return {
      blocks,
      closed: true,
      endIndex: closingInfo
        ? bodyStart + closingInfo.consumedLength
        : message.length,
    };
  }

  private matchToolFenceOpener(
    message: string,
    startIndex: number,
  ): { consumedLength: number; inlineAction: string } | null {
    const openerMatch = /^```tool([^\r\n]*)(?:\r?\n|$)/i.exec(
      message.slice(startIndex),
    );
    if (!openerMatch) {
      return null;
    }

    const suffix = openerMatch[1] ?? "";
    const inlineAction = suffix.trimStart();
    if (inlineAction && !this.parseActionsCommand(inlineAction)) {
      return null;
    }

    return {
      consumedLength: openerMatch[0].length,
      inlineAction,
    };
  }

  private findToolFenceClose(
    body: string,
  ): { bodyEnd: number; consumedLength: number } | null {
    let activeCloser: string | null = null;
    const lineRegex = /([^\r\n]*)(\r?\n|$)/g;
    let match: RegExpExecArray | null;

    while ((match = lineRegex.exec(body)) !== null) {
      const line = match[1] ?? "";
      const trimmed = line.trim().toLowerCase();

      if (activeCloser) {
        if (trimmed === activeCloser) {
          activeCloser = null;
        }
      } else {
        const fencePrefixMatch = /^([ \t]*```)(.*)$/.exec(line);
        const fenceRemainder = fencePrefixMatch?.[2] ?? "";
        const closesToolFence =
          !!fencePrefixMatch &&
          (fenceRemainder.trim().length === 0 ||
            /^[^A-Za-z0-9_]/.test(fenceRemainder));

        if (closesToolFence) {
          return {
            bodyEnd: match.index,
            consumedLength:
              match.index +
              (fenceRemainder.trim().length === 0
                ? match[0].length
                : fencePrefixMatch[1].length),
          };
        }

        const parsedAction = this.parseActionsCommand(line);
        if (parsedAction) {
          activeCloser = this.getContentToolCloser(parsedAction.command);
        }
      }

      if (match[0].length === 0) {
        break;
      }
    }

    return null;
  }

  private parseImplicitActionsBlock(
    message: string,
    startIndex: number,
    isFinalized: boolean,
  ): {
    blocks: AssistantMessageContent[];
    closed: boolean;
    endIndex: number;
  } {
    const body = message.slice(startIndex);
    const endMatch = this.matchImplicitActionsEnd(body);
    const endIndex =
      endMatch && endMatch.index !== undefined
        ? endMatch.index + endMatch[0].indexOf("END")
        : -1;
    const consumedLength =
      endMatch && endMatch.index !== undefined
        ? endMatch.index + endMatch[0].length
        : -1;
    const toolBody = endIndex === -1 ? body : body.slice(0, endIndex);
    const closed = isFinalized || endIndex !== -1;
    const blocks = this.parseActionsBody(toolBody, closed);

    if (closed && blocks.length > 0) {
      this.hasFinalizedTool = true;
    }

    return {
      blocks,
      closed,
      endIndex: closed
        ? startIndex + (endIndex === -1 ? body.length : consumedLength)
        : startIndex,
    };
  }

  private findWrappedToolCallStart(message: string, fromIndex: number): number {
    const regex = new RegExp(
      UnifiedToolCallParser.WRAPPED_TOOL_CALL_START_REGEX,
    );
    regex.lastIndex = fromIndex;
    const match = regex.exec(message);
    return match?.index ?? -1;
  }

  private parseWrappedToolCallBlock(
    message: string,
    startIndex: number,
    isFinalized: boolean,
  ): {
    blocks: AssistantMessageContent[];
    closed: boolean;
    endIndex: number;
  } {
    const openingMatch = message
      .slice(startIndex)
      .match(/^<(?:[\w-]+:)?tool_call>/);

    if (!openingMatch) {
      return {
        blocks: [],
        closed: false,
        endIndex: startIndex,
      };
    }

    const openingLength = openingMatch[0].length;
    const body = message.slice(startIndex + openingLength);
    const closingRegex = /<\/(?:[\w-]+:)?tool_call>/;
    const closingMatch = closingRegex.exec(body);

    const closed = isFinalized || !!closingMatch;
    const content =
      closingMatch && closingMatch.index !== undefined
        ? body.slice(0, closingMatch.index)
        : body;
    const endIndex =
      closingMatch && closingMatch.index !== undefined
        ? startIndex +
          openingLength +
          closingMatch.index +
          closingMatch[0].length
        : closed
          ? message.length
          : startIndex;

    const toolCallId = `unified_${this.currentTurnId}_tool_call_${this.toolCounter}`;
    const toolUse = this.createWrappedToolUse(content, !closed, toolCallId);

    if (!toolUse) {
      return {
        blocks: [],
        closed,
        endIndex,
      };
    }

    if (closed) {
      this.toolCounter++;
      this.hasFinalizedTool = true;
    }

    return {
      blocks: [toolUse],
      closed,
      endIndex,
    };
  }

  private createWrappedToolUse(
    content: string,
    partial: boolean,
    id: string,
  ): ToolUse | null {
    const functionMatch = content.match(
      /<function(?:=([^\s>]+)|\s+name=(['"])(.*?)\2)[^>]*>/i,
    );
    const toolShortName = (
      functionMatch?.[1] ??
      functionMatch?.[3] ??
      ""
    ).trim();

    if (!toolShortName) {
      return null;
    }

    const toolUse = this.createToolUse(toolShortName, "", partial, id);
    toolUse.params = {};
    toolUse.nativeArgs = {};

    const rawArgs: Record<string, string | string[]> = {};
    const paramRegex =
      /<parameter(?:=([^\s>]+)|\s+name=(['"])(.*?)\2)[^>]*>([\s\S]*?)<\/parameter>/gi;
    let match: RegExpExecArray | null;

    while ((match = paramRegex.exec(content)) !== null) {
      const rawName = (match[1] ?? match[3] ?? "").trim();
      if (!rawName) {
        continue;
      }

      const value = match[4].trim();
      const existing = rawArgs[rawName];
      if (existing === undefined) {
        rawArgs[rawName] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        rawArgs[rawName] = [existing, value];
      }
    }

    this.applyWrappedToolArgs(toolUse, rawArgs);
    return toolUse;
  }

  private applyWrappedToolArgs(
    toolUse: any,
    rawArgs: Record<string, string | string[]>,
  ): void {
    const assign = (name: string, value: any, nativeValue: any = value) => {
      toolUse.params[name] = value;
      toolUse.nativeArgs[name] = nativeValue;
    };
    const parseBoolean = (value: any): boolean =>
      typeof value === "boolean"
        ? value
        : String(value).trim().toLowerCase() === "true";
    const parseNumber = (value: any): number | undefined => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const canonicalName = toolUse.name;
    const normalizedArgs: Record<string, any> = { ...rawArgs };

    if (canonicalName === "grep" && normalizedArgs.query === undefined) {
      normalizedArgs.query = normalizedArgs.pattern ?? normalizedArgs.regex;
    }

    if (canonicalName === "glob" && normalizedArgs.pattern === undefined) {
      normalizedArgs.pattern = normalizedArgs.query;
    }

    for (const [rawName, rawValue] of Object.entries(normalizedArgs)) {
      const name = rawName.replace(/-/g, "_");

      switch (name) {
        case "recursive":
        case "include_all":
        case "literal":
        case "whole_word":
        case "case_sensitive":
        case "case_insensitive": {
          const boolValue = parseBoolean(rawValue);
          assign(name, String(boolValue), boolValue);
          break;
        }
        case "context_lines": {
          const numberValue = parseNumber(rawValue);
          if (numberValue !== undefined) {
            assign(name, String(numberValue), numberValue);
          }
          break;
        }
        case "arguments": {
          if (canonicalName === "use_mcp_tool") {
            try {
              assign(
                name,
                typeof rawValue === "string"
                  ? rawValue
                  : JSON.stringify(rawValue),
                JSON.parse(String(rawValue)),
              );
            } catch {
              assign(name, rawValue);
            }
          } else {
            assign(name, rawValue);
          }
          break;
        }
        case "pattern":
          if (canonicalName !== "grep") {
            assign(name, rawValue);
          }
          break;
        default:
          assign(name, rawValue);
          break;
      }
    }

    applyParamsDefaulting(toolUse);

    if (
      (canonicalName === "grep" ||
        canonicalName === "glob" ||
        canonicalName === "list") &&
      toolUse.nativeArgs.path === undefined
    ) {
      toolUse.nativeArgs.path = toolUse.params.path;
    }
  }

  private parsePlainTextMessage(
    message: string,
    isFinalized: boolean,
  ): {
    finalized: AssistantMessageContent[];
    pending: AssistantMessageContent[];
    safeIndex: number;
  } {
    const cleanText = this.cleanTextContent(message, isFinalized);
    if (!cleanText) {
      return {
        finalized: [],
        pending: [],
        safeIndex: isFinalized ? message.length : 0,
      };
    }

    const block: AssistantMessageContent = {
      type: "text",
      content: cleanText,
      partial: !isFinalized,
    };

    return {
      finalized: isFinalized ? [block] : [],
      pending: isFinalized ? [] : [block],
      safeIndex: isFinalized ? message.length : 0,
    };
  }

  private parseStandardMessage(
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

    // 2. State machine for XML tool blocks. Wrapperless READ/WRITE/ACTIONS are
    // handled separately; legacy single-letter tools are intentionally unsupported.
    const toolStartRegex = new RegExp(
      UnifiedToolCallParser.XML_TOOL_START_REGEX,
    );
    let match: RegExpExecArray | null;

    while ((match = toolStartRegex.exec(message)) !== null) {
      // Check if inside thinking block
      if (isInsideThinking(match.index)) continue;

      const toolShortName = match[1];
      let argsStr = "";
      const isXml = true;
      let startIndex = match.index;
      let startTagEndIndex = startIndex + match[0].length;

      // Verify it's a known tool or a registered MCP tool
      const isMcpTool = this.isRegisteredMcpTool(toolShortName);
      if (!knownToolShortNames.has(toolShortName) && !isMcpTool) continue;

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

      const remainingText = message.slice(startTagEndIndex);
      const closingRegex = new RegExp(
        `(?:^|[\\r\\n])[ \t]*<\\/${toolShortName}>(?:[ \\t]*(?:[\\r\\n]|$))`,
      );
      const endMatch = remainingText.match(closingRegex);

      if (endMatch && endMatch.index !== undefined) {
        content = remainingText.slice(0, endMatch.index);
        if (content.startsWith("\n")) content = content.slice(1);
        isClosed = true;
        endIndex = startTagEndIndex + endMatch.index + endMatch[0].length;
        toolStartRegex.lastIndex = endIndex;
      } else {
        content = remainingText;
        if (content.startsWith("\n")) content = content.slice(1);

        if (isFinalized) {
          isClosed = true;
          endIndex = message.length;
        } else {
          isClosed = false;
          endIndex = message.length;
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

      // MCP tools get a special McpToolUse block type
      if (isMcpTool) {
        const mcpToolUse = this.createMcpToolUse(
          toolShortName,
          content,
          shouldBePartial,
          toolCallId,
        );
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
      if (
        toolShortName === "use_mcp_tool" ||
        toolShortName === "access_mcp_resource"
      ) {
        const serverMatch = content.match(
          /<server_name>([\s\S]*?)<\/server_name>/,
        );
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
          if (toolShortName === "write" || toolShortName === "write") {
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
            toolShortName === "L" ||
            toolShortName === "ls" ||
            toolShortName === "list" ||
            toolShortName === "G" ||
            toolShortName === "grep" ||
            toolShortName === "search") &&
          content.trim()
        ) {
          // KILOCODE FIX: Intercept ALL block-based list/glob/find/grep calls.
          // If an inline arg (argsStr) is provided, it is ALWAYS the path.
          // If no inline arg is provided, the path defaults to ".".
          // For list, the block body can provide the path and optional recursive flag.
          const inlinePath = argsStr
            ? argsStr.trim().replace(/^["'`]|["'`]$/g, "")
            : ".";
          const bodyLines = content
            .trim()
            .split(/\r?\n/)
            .map((l: string) => l.trim())
            .filter(Boolean);

          if (
            toolShortName === "L" ||
            toolShortName === "ls" ||
            toolShortName === "list"
          ) {
            const recursiveLine = bodyLines.find(
              (line) =>
                /^(?:--recursive(?:\s+|=))?true$/i.test(line) ||
                /^(?:--recursive(?:\s+|=))?false$/i.test(line) ||
                /^--recursive$/i.test(line),
            );
            const pathLine = bodyLines.find((line) => line !== recursiveLine);
            const path = argsStr
              ? inlinePath
              : pathLine
                ? pathLine.replace(/^["'`]|["'`]$/g, "")
                : ".";

            toolUse.params.path = path;
            toolUse.nativeArgs.path = path;

            if (recursiveLine && !/false$/i.test(recursiveLine)) {
              toolUse.params.recursive = "true";
              toolUse.nativeArgs.recursive = true;
            }
          } else if (
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

            const queries = hasIncludeAllFlag
              ? bodyLines.slice(0, -1)
              : bodyLines;
            toolUse.params.query = this.splitPipe(queries);
            toolUse.nativeArgs.query = toolUse.params.query;
            toolUse.params.path = inlinePath;
            toolUse.nativeArgs.path = inlinePath;
            if (hasIncludeAllFlag) {
              toolUse.params.include_all = true;
              toolUse.nativeArgs.include_all = true;
            }
          } else {
            toolUse.params.pattern = this.splitPipe(bodyLines);
            toolUse.nativeArgs.pattern = toolUse.params.pattern;
            toolUse.params.path = inlinePath;
            toolUse.nativeArgs.path = inlinePath;
          }
        } else if (!argsStr && content.trim()) {
          // Compact syntax without parens for non-content tools
          // Treat the content as the args string and re-populate
          // For list/glob/find, preserve newlines so multiline bodies keep structure.
          // For read, preserve newlines for multi-file support.
          // For everything else, collapse to a single line.
          const preserveNewlines =
            toolShortName === "R" ||
            toolShortName === "read" ||
            toolShortName === "L" ||
            toolShortName === "ls" ||
            toolShortName === "list" ||
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

      // KILOCODE MOD: Split multi-file or multi-anchor read calls
      // Note: Since this logic expands 1 tool into N, we must be careful with finalizedBlockCount.
      // If the original tool was closed, ALL generated tools are closed (and finalized).
      let generatedTools: any[] = [];
      if (
        toolUse.name === "read" &&
        toolUse.nativeArgs?.additional_anchors &&
        toolUse.nativeArgs.additional_anchors.length > 0
      ) {
        // console.log(`[UnifiedToolCallParser] 🔍 read with additional_anchors: ${toolUse.nativeArgs.additional_anchors.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
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
        toolUse.name === "read" &&
        toolUse.nativeArgs?.files &&
        toolUse.nativeArgs.files.length > 1
      ) {
        // console.log(`[UnifiedToolCallParser] 🔍 read with multiple files: ${toolUse.nativeArgs.files.length}, files: ${JSON.stringify(toolUse.nativeArgs.files)}`)
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
        // console.log(`[UnifiedToolCallParser] 🔍 read single file: ${toolUse.name}, files: ${JSON.stringify(toolUse.nativeArgs?.files)}, path: ${toolUse.params?.path}`)
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
      const cleanText = this.cleanTextContent(remainingText, isFinalized);
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

  private findActionsBlockStart(message: string, fromIndex: number): number {
    const regex = new RegExp(UnifiedToolCallParser.ACTIONS_BLOCK_START_REGEX);
    regex.lastIndex = fromIndex;
    const match = regex.exec(message);
    if (!match) return -1;
    const actionIndex = match[0].indexOf("ACTION");
    return actionIndex === -1 ? match.index : match.index + actionIndex;
  }

  private parseActionsBlock(
    message: string,
    startIndex: number,
    isFinalized: boolean,
  ): {
    blocks: AssistantMessageContent[];
    closed: boolean;
    endIndex: number;
  } {
    const blockStartMatch = /^(ACTIONS?)([^\r\n]*)(?:\r?\n|$)/.exec(
      message.slice(startIndex),
    );
    if (!blockStartMatch) {
      return { blocks: [], closed: false, endIndex: startIndex };
    }

    let inlineAction = (blockStartMatch[2] || "").trim();
    inlineAction = this.normalizeInlineActionsRemainder(inlineAction);
    const bodyStart = startIndex + blockStartMatch[0].length;
    let sameLineEndConsumedLength = 0;
    const sameLineEndMatch = blockStartMatch[2]?.match(
      /^(.*?)(?:[ \t]+END[ \t]*)$/i,
    );
    if (sameLineEndMatch) {
      inlineAction = this.normalizeInlineActionsRemainder(
        sameLineEndMatch[1] || "",
      );
      sameLineEndConsumedLength = blockStartMatch[0].length;
    }

    const endMatch =
      sameLineEndConsumedLength > 0
        ? null
        : /(?:^|[\r\n])[ \t]*END[ \t]*(?:\r?\n|$)/m.exec(
            message.slice(bodyStart),
          );

    if (!endMatch && sameLineEndConsumedLength === 0 && !isFinalized) {
      const body = inlineAction
        ? `${inlineAction}\n${message.slice(bodyStart)}`
        : message.slice(bodyStart);
      const blocks = this.parseActionsBody(body, false);
      return { blocks, closed: false, endIndex: startIndex };
    }

    const bodyEnd =
      sameLineEndConsumedLength > 0
        ? bodyStart
        : endMatch
          ? bodyStart + (endMatch.index ?? 0)
          : message.length;
    const rawBody = message.slice(bodyStart, bodyEnd);
    const body = inlineAction ? `${inlineAction}\n${rawBody}` : rawBody;
    const blocks = this.parseActionsBody(body, true);
    const endIndex = endMatch
      ? bodyStart + (endMatch.index ?? 0) + endMatch[0].length
      : sameLineEndConsumedLength > 0
        ? startIndex + sameLineEndConsumedLength
        : message.length;

    return { blocks, closed: true, endIndex };
  }

  private findAtActionsBlockStart(message: string, fromIndex: number): number {
    return this.findAtActionsBlockStartInternal(message, fromIndex, false);
  }

  private findAtActionsBlockStartInternal(
    message: string,
    fromIndex: number,
    allowInlineFirstTool: boolean,
  ): number {
    const regex = /@([a-z_][a-z0-9_-]*)(?::|(?=\s|$))/gim;
    regex.lastIndex = fromIndex;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
      if (match.index === undefined) {
        break;
      }

      const atIndex = match.index + match[0].lastIndexOf("@");
      if (
        !this.isValidAtActionsBoundary(
          message,
          atIndex,
          allowInlineFirstTool,
        )
      ) {
        regex.lastIndex = atIndex + 1;
        continue;
      }

      const lineEnd = message.indexOf("\n", atIndex);
      const rawLine =
        lineEnd === -1
          ? message.slice(atIndex)
          : message.slice(atIndex, lineEnd);

      if (
        this.parseAtToolCommand(rawLine) ||
        this.parseAtMcpToolCommand(rawLine)
      ) {
        return atIndex;
      }

      regex.lastIndex = atIndex + 1;
    }

    return -1;
  }

  private isValidAtActionsBoundary(
    message: string,
    atIndex: number,
    allowInlineFirstTool: boolean,
  ): boolean {
    if (atIndex <= 0) {
      return true;
    }

    const previousChar = message[atIndex - 1];
    if (previousChar === "\n" || previousChar === "\r") {
      return true;
    }

    return allowInlineFirstTool;
  }

  private parseAtActionsBlock(
    message: string,
    startIndex: number,
    isFinalized: boolean,
  ): {
    blocks: AssistantMessageContent[];
    closed: boolean;
    endIndex: number;
  } {
    const body = message.slice(startIndex);
    const lines: Array<{
      line: string;
      start: number;
      end: number;
    }> = [];
    const lineRegex = /([^\r\n]*)(\r?\n|$)/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(body)) !== null) {
      lines.push({
        line: lineMatch[1] ?? "",
        start: lineMatch.index,
        end: lineMatch.index + lineMatch[0].length,
      });

      if (lineMatch[0].length === 0) {
        break;
      }
    }

    if (lines.length === 0 || !this.isAtToolHeaderLine(lines[0].line)) {
      return { blocks: [], closed: false, endIndex: startIndex };
    }

    let activeBlockTool = false;
    let activeContentCloser: string | null = null;
    let batchEndOffset = 0;
    let invalidStartOffset: number | null = null;

    for (let index = 0; index < lines.length; index++) {
      const entry = lines[index];
      const parsedAction = this.parseAtToolCommand(entry.line);
      const parsedMcpAction = this.parseAtMcpToolCommand(entry.line);

      if (parsedAction || parsedMcpAction) {
        batchEndOffset = entry.end;
        activeContentCloser =
          parsedAction !== null
            ? this.getContentToolCloser(parsedAction.command)
            : null;
        activeBlockTool =
          parsedMcpAction !== null || activeContentCloser !== null;
        continue;
      }

      if (activeBlockTool) {
        if (
          activeContentCloser &&
          this.isContentToolCloserLine(entry.line, activeContentCloser)
        ) {
          batchEndOffset = entry.end;
          activeBlockTool = false;
          activeContentCloser = null;
          continue;
        }

        batchEndOffset = entry.end;
        continue;
      }

      if (entry.line.trim().length === 0) {
        batchEndOffset = entry.end;
        continue;
      }

      invalidStartOffset = entry.start;
      break;
    }

    const closed =
      invalidStartOffset !== null || !activeBlockTool || isFinalized;

    if (!closed) {
      const blocks = this.parseActionsBody(body, false);
      return { blocks, closed: false, endIndex: startIndex };
    }

    const endOffset =
      invalidStartOffset !== null
        ? invalidStartOffset
        : activeBlockTool && isFinalized
          ? body.length
          : batchEndOffset;
    const blocks = this.parseActionsBody(body.slice(0, endOffset), true);

    return {
      blocks,
      closed: true,
      endIndex: startIndex + endOffset,
    };
  }

  private parseActionsBody(
    body: string,
    isClosed: boolean,
  ): AssistantMessageContent[] {
    const blocks: AssistantMessageContent[] = [];
    const lines = this.normalizeActionsBodyLines(body.split(/\r?\n/));
    let nextToolIndex = this.toolCounter;

    const createIndexedToolUse = (
      shortName: string,
      argsStr: string,
      partial: boolean = false,
    ) => {
      const toolUse = this.createActionsToolUse(
        shortName,
        argsStr,
        partial,
        nextToolIndex,
      );
      nextToolIndex++;
      return toolUse;
    };

    const createIndexedMcpToolUse = (
      toolName: string,
      rawArguments: string,
      partial: boolean = false,
    ) => {
      const toolUse = this.createActionsMcpToolUse(
        toolName,
        rawArguments,
        partial,
        nextToolIndex,
      );
      nextToolIndex++;
      return toolUse;
    };

    const createIndexedAtToolUse = (
      command: string,
      args: string[],
      rawArgs: string,
      partial: boolean = false,
    ) => {
      const toolUse = this.createAtToolUse(
        command,
        args,
        rawArgs,
        partial,
        nextToolIndex,
      );
      nextToolIndex++;
      return toolUse;
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const parsedAtMcpAction = this.parseAtMcpToolCommand(line);
      if (parsedAtMcpAction) {
        const { body, loopIndex, sawCloser } = this.collectAtBlockToolBody(
          lines,
          i,
          isClosed,
        );
        i = loopIndex;
        const rawArguments = this.combineAtMcpArguments(
          parsedAtMcpAction.rest,
          body,
        );
        blocks.push(
          createIndexedMcpToolUse(
            parsedAtMcpAction.originalCommand,
            rawArguments,
            !isClosed || !sawCloser,
          ),
        );
        continue;
      }

      const parsedAction = this.parseActionsCommand(line);
      if (!parsedAction) {
        if (this.isRegisteredMcpTool(line)) {
          const { rawArguments, nextIndex, complete } =
            this.collectActionsMcpArguments(lines, i + 1, isClosed);
          const mcpTool = createIndexedMcpToolUse(
            line,
            rawArguments,
            !isClosed || !complete,
          );
          blocks.push(mcpTool);
          i = nextIndex - 1;
        }
        continue;
      }

      const { command, originalCommand, rest } = parsedAction;
      const atArgs =
        parsedAction.syntax === "at" ? (parsedAction.args ?? []) : [];

      if (command === "read") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "grep") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(
                originalCommand,
                this.convertNaturalSearchArgs(rest),
                !isClosed,
              ),
        );
        continue;
      }

      if (command === "find") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(
                originalCommand,
                this.convertNaturalFindArgs(rest),
                !isClosed,
              ),
        );
        continue;
      }

      if (command === "list") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(
                originalCommand,
                this.convertNaturalListArgs(rest),
                !isClosed,
              ),
        );
        continue;
      }

      if (command === "mkdir") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "bash") {
        if (parsedAction.syntax === "at") {
          blocks.push(createIndexedAtToolUse(command, atArgs, rest, false));
        } else {
          blocks.push(
            this.createActionsBashToolUse(
              rest,
              originalCommand,
              !isClosed,
              nextToolIndex,
            ),
          );
          nextToolIndex++;
        }
        continue;
      }

      if (command === "web") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "fetch") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "ask") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "edit") {
        const legacyInlineArgs =
          parsedAction.syntax === "at"
            ? atArgs
            : this.parseAtToolArguments(rest).args;
        const hasInlineEditArgs = legacyInlineArgs.length > 1;
        const closer = this.getContentToolCloser(command) ?? undefined;
        const { body, loopIndex, sawCloser, explicitCloser } =
          parsedAction.syntax === "at"
            ? this.collectAtBlockToolBody(lines, i, isClosed, closer)
            : this.collectContentToolBody(lines, i, "eof", isClosed);
        i = loopIndex;
        if (parsedAction.syntax === "at" && isClosed && !body.trim() && !hasInlineEditArgs) {
          continue;
        }
        const editIsPartial = hasInlineEditArgs ? false : !isClosed || !sawCloser;
        const editTool =
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, editIsPartial)
            : createIndexedToolUse(
                originalCommand,
                rest,
                editIsPartial,
              );
        if (isEditHistoryPlaceholder(body)) {
          editTool.params.edit = body;
          editTool.nativeArgs.edit = body;
        } else {
          this.appendContentToTool(editTool, body);
        }
        if (explicitCloser) {
          editTool.params.contentCloser = explicitCloser;
          editTool.nativeArgs.contentCloser = explicitCloser;
        }
        blocks.push(editTool);
        continue;
      }

      if (command === "write") {
        const legacyInlineArgs =
          parsedAction.syntax === "at"
            ? atArgs
            : this.parseAtToolArguments(rest).args;
        const hasInlineWriteArgs = this.hasInlineWritePayload(legacyInlineArgs);
        const closer = this.getContentToolCloser(command) ?? undefined;
        const { body, loopIndex, sawCloser, explicitCloser } =
          parsedAction.syntax === "at"
            ? this.collectAtBlockToolBody(lines, i, isClosed, closer)
            : this.collectContentToolBody(lines, i, "eof", isClosed);
        i = loopIndex;
        if (parsedAction.syntax === "at" && isClosed && !body.trim() && !hasInlineWriteArgs) {
          continue;
        }
        const writeIsPartial = hasInlineWriteArgs ? false : !isClosed || !sawCloser;
        const writeTool =
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, writeIsPartial)
            : createIndexedToolUse(
                originalCommand,
                rest,
                writeIsPartial,
              );
        const multilineCompactWrite =
          parsedAction.syntax === "at" && /^[\s"'`]/.test(rest)
            ? this.parseMultilineQuotedWriteArg(
                rest,
                body,
                { allowPartial: writeIsPartial },
              )
            : null;
        if (isWriteHistoryPlaceholder(body)) {
          writeTool.params.content = body;
          writeTool.nativeArgs.content = body;
        } else if (multilineCompactWrite) {
          writeTool.params.path = multilineCompactWrite.path;
          writeTool.params.target_file = multilineCompactWrite.path;
          writeTool.nativeArgs.path = multilineCompactWrite.path;
          writeTool.nativeArgs.target_file = multilineCompactWrite.path;
          writeTool.params.content = multilineCompactWrite.content;
          writeTool.nativeArgs.content = multilineCompactWrite.content;
        } else if (parsedAction.syntax === "at" && !hasInlineWriteArgs) {
          this.appendContentToTool(writeTool, body);
        } else {
          this.appendContentToTool(writeTool, body);
        }
        if (explicitCloser) {
          writeTool.params.contentCloser = explicitCloser;
          writeTool.nativeArgs.contentCloser = explicitCloser;
        }
        blocks.push(writeTool);
        continue;
      }

      if (command === "todo") {
        const closer = this.getContentToolCloser(command) ?? undefined;
        const { body, loopIndex, sawCloser, explicitCloser } =
          parsedAction.syntax === "at"
            ? this.collectAtBlockToolBody(lines, i, isClosed, closer)
            : this.collectContentToolBody(lines, i, "eof", isClosed);
        i = loopIndex;
        if (parsedAction.syntax === "at" && isClosed && !body.trim()) {
          continue;
        }
        const todoTool =
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, !isClosed || !sawCloser)
            : createIndexedToolUse(
                originalCommand,
                "",
                !isClosed || !sawCloser,
              );
        this.appendContentToTool(todoTool, body);
        if (explicitCloser) {
          todoTool.params.contentCloser = explicitCloser;
          todoTool.nativeArgs.contentCloser = explicitCloser;
        }
        blocks.push(todoTool);
        continue;
      }

      if (command === "agent") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }

      if (command === "desktop" || command === "computer_action") {
        blocks.push(
          parsedAction.syntax === "at"
            ? createIndexedAtToolUse(command, atArgs, rest, false)
            : createIndexedToolUse(originalCommand, rest, !isClosed),
        );
        continue;
      }
    }

    if (isClosed) {
      this.toolCounter = nextToolIndex;
    }

    return blocks;
  }

  private parseActionsCommand(line: string): {
    command: string;
    originalCommand: string;
    rest: string;
    args?: string[];
    syntax: "legacy" | "at";
  } | null {
    const atCommand = this.parseAtToolCommand(line);
    if (atCommand) {
      return atCommand;
    }

    const normalized = line.trim();
    const actionCommandAliases: Record<string, string> = {
      command: "bash",
      cmd: "bash",
      shell: "bash",
      ls: "list",
      dirlist: "list",
      list_files: "list",
      list_dir: "list",
      search: "grep",
    };

    for (const candidate of UnifiedToolCallParser.ACTIONS_COMMAND_CANDIDATES) {
      if (!normalized.toLowerCase().startsWith(candidate)) {
        continue;
      }

      const nextChar = normalized.charAt(candidate.length);
      if (nextChar && /[\p{L}\p{N}_]/u.test(nextChar)) {
        const remainder = normalized.slice(candidate.length);
        const emittedPrefix = normalized.slice(0, candidate.length);
        const isUppercaseShortcut =
          emittedPrefix.length > 0 &&
          emittedPrefix === emittedPrefix.toUpperCase();
        const looksLikeAttachedArgs =
          /[\/|.:=_-]/.test(remainder) || /\bin\b/i.test(remainder);

        if (!isUppercaseShortcut && !looksLikeAttachedArgs) {
          continue;
        }
      }

      const command = actionCommandAliases[candidate] ?? candidate;
      if (
        !UnifiedToolCallParser.ACTIONS_COMMANDS.includes(
          command as (typeof UnifiedToolCallParser.ACTIONS_COMMANDS)[number],
        )
      ) {
        continue;
      }

      const remainder = normalized.slice(candidate.length);
      const rest = remainder.trim();
      return {
        command,
        originalCommand: candidate,
        rest,
        syntax: "legacy",
      };
    }

    return null;
  }

  private parseAtToolCommand(line: string): {
    command: string;
    originalCommand: string;
    rest: string;
    args?: string[];
    syntax: "at";
  } | null {
    const trimmed = line.trim();
    const match =
      /^@([a-z_][a-z0-9_-]*)(?::([\s\S]*)|(?:\s+([\s\S]*))?)$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    const rawCommand = match[1].toLowerCase();
    const rest = match[2] ?? match[3] ?? "";
    const actionCommandAliases: Record<string, string> = {
      command: "bash",
      cmd: "bash",
      shell: "bash",
      ls: "list",
      dirlist: "list",
      list_files: "list",
      list_dir: "list",
      search: "grep",
    };
    const command = actionCommandAliases[rawCommand] ?? rawCommand;

    if (
      !UnifiedToolCallParser.ACTIONS_COMMANDS.includes(
        command as (typeof UnifiedToolCallParser.ACTIONS_COMMANDS)[number],
      )
    ) {
      return null;
    }

    const parsedArgs = this.parseAtToolArguments(rest);
    if (!parsedArgs.complete) {
      const allowsMultilineQuotedArg =
        command === "write" && /^[\s"'`]/.test(rest);
      if (!allowsMultilineQuotedArg) {
        return null;
      }
    }

    const allowsEmptyArgs =
      command === "list" ||
      command === "todo" ||
      (command === "write" && !parsedArgs.complete && /^[\s"'`]/.test(rest));
    if (!allowsEmptyArgs && parsedArgs.args.length === 0) {
      return null;
    }

    return {
      command,
      originalCommand: command,
      rest,
      args: parsedArgs.args,
      syntax: "at",
    };
  }

  private parseAtMcpToolCommand(line: string): {
    originalCommand: string;
    rest: string;
    syntax: "at-mcp";
  } | null {
    const trimmed = line.trim();
    const match =
      /^@([a-z_][a-z0-9_-]*)(?::([\s\S]*)|(?:\s+([\s\S]*))?)$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    const rawCommand = match[1];
    if (!this.isRegisteredMcpTool(rawCommand)) {
      return null;
    }

    return {
      originalCommand: rawCommand,
      rest: match[2] ?? match[3] ?? "",
      syntax: "at-mcp",
    };
  }

  private parseAtToolArguments(input: string): {
    args: string[];
    complete: boolean;
  } {
    const args: string[] = [];
    let index = 0;

    while (index < input.length) {
      while (index < input.length && /[\s,]/.test(input[index])) {
        index++;
      }

      if (index >= input.length) {
        break;
      }

      const quote = input[index];
      if (quote === '"' || quote === "'" || quote === "`") {
        index++;
        let value = "";
        let closed = false;

        while (index < input.length) {
          const char = input[index];
          if (char === "\\") {
            const decodedEscape = this.decodeEscapedTextSequence(input, index);
            value += decodedEscape.value;
            index += decodedEscape.consumed;
            continue;
          }
          if (char === quote) {
            closed = true;
            index++;
            break;
          }
          value += char;
          index++;
        }

        if (!closed) {
          return { args, complete: false };
        }

        args.push(value);
        continue;
      }

      let value = "";
      while (index < input.length && !/[\s,]/.test(input[index])) {
        value += input[index];
        index++;
      }

      if (value) {
        args.push(value);
      }
    }

    return { args, complete: true };
  }

  private decodeEscapedTextSequence(
    input: string,
    index: number,
  ): { value: string; consumed: number } {
    const nextChar = input[index + 1];
    if (nextChar === undefined) {
      return { value: "\\", consumed: 1 };
    }

    if (input.startsWith("\\->", index)) {
      return { value: "->", consumed: 3 };
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
      case "→":
        return { value: nextChar, consumed: 2 };
      default:
        return { value: `\\${nextChar}`, consumed: 2 };
    }
  }

  private findFirstUnescapedEditSeparator(
    input: string,
  ): { index: number; length: number } | null {
    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (char === "\\" ) {
        const decoded = this.decodeEscapedTextSequence(input, index);
        index += decoded.consumed - 1;
        continue;
      }

      if (char === "→") {
        return { index, length: 1 };
      }

      if (char === "-" && input[index + 1] === ">") {
        return { index, length: 2 };
      }
    }

    return null;
  }

  private decodeEscapedEditContent(value: string): string {
    let decoded = "";

    for (let index = 0; index < value.length; ) {
      if (value[index] !== "\\") {
        decoded += value[index];
        index++;
        continue;
      }

      const escape = this.decodeEscapedTextSequence(value, index);
      decoded += escape.value;
      index += escape.consumed;
    }

    return decoded;
  }

  private parseCompactEditString(
    value: string,
  ): {
    oldText: string;
    newText: string;
    start_line?: number;
    end_line?: number;
  } | null {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (!normalized) {
      return null;
    }

    let payload = normalized;
    let startLine: number | undefined;
    let endLine: number | undefined;

    const pipeIndex = normalized.indexOf("|");
    if (pipeIndex !== -1) {
      let rangeCandidate = normalized.slice(0, pipeIndex).trim();
      rangeCandidate = rangeCandidate.replace(/^\d+\s*→\s*/, "");
      const rangeMatch = rangeCandidate.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (rangeMatch) {
        startLine = parseInt(rangeMatch[1], 10);
        endLine = parseInt(rangeMatch[2] || rangeMatch[1], 10);
        payload = normalized.slice(pipeIndex + 1);
        payload = stripRedundantLineRangePipePrefix(
          payload,
          startLine,
          endLine,
        );
      }
    }

    const separator = this.findFirstUnescapedEditSeparator(payload);
    if (!separator) {
      return null;
    }

    const oldText = this.decodeEscapedEditContent(
      payload.slice(0, separator.index),
    );
    const newText = this.decodeEscapedEditContent(
      payload.slice(separator.index + separator.length),
    );

    return {
      oldText,
      newText,
      start_line: startLine,
      end_line: endLine,
    };
  }

  private buildCanonicalEditBody(
    edits: Array<{
      oldText: string;
      newText: string;
      start_line?: number;
      end_line?: number;
    }>,
  ): string {
    return edits
      .map((edit) => {
        const hasRange =
          typeof edit.start_line === "number" && typeof edit.end_line === "number";
        const rangeHeader = hasRange
          ? `old[${edit.start_line}${edit.end_line !== edit.start_line ? `-${edit.end_line}` : ""}]:`
          : "old:";
        return [rangeHeader, edit.oldText, "new:", edit.newText].join("\n");
      })
      .join("\n");
  }

  private applyInlineEditArgs(toolUse: any, args: string[]): boolean {
    const editArgs = args.slice(1);
    if (editArgs.length === 0) {
      return false;
    }

    const parsedEdits = editArgs
      .map((arg) => this.parseCompactEditString(arg))
      .filter(
        (
          edit,
        ): edit is {
          oldText: string;
          newText: string;
          start_line?: number;
          end_line?: number;
        } => edit !== null,
      );

    if (parsedEdits.length === 0) {
      return false;
    }

    const canonicalBody = this.buildCanonicalEditBody(parsedEdits);
    toolUse.params.edit = canonicalBody;
    toolUse.nativeArgs.edit = canonicalBody;
    toolUse.params.edits = parsedEdits;
    toolUse.nativeArgs.edits = parsedEdits;
    return true;
  }

  private parseQuotedEditBodyLines(
    body: string,
    options?: {
      allowTrailingPartialLine?: boolean;
    },
  ): Array<{
    oldText: string;
    newText: string;
    start_line?: number;
    end_line?: number;
  }> | null {
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return null;
    }

    const parsedEdits: Array<{
      oldText: string;
      newText: string;
      start_line?: number;
      end_line?: number;
    }> = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const firstChar = line[0];
      if (!(firstChar === '"' || firstChar === "'" || firstChar === "`")) {
        return null;
      }

      const lastChar = line[line.length - 1];
      const isClosed =
        lastChar === firstChar && !this.isEscaped(line, line.length - 1);
      if (!isClosed) {
        const isTrailingLine = index === lines.length - 1;
        if (options?.allowTrailingPartialLine && isTrailingLine) {
          return parsedEdits;
        }
        return null;
      }

      const inner = line.slice(1, -1);
      const parsedEdit = this.parseCompactEditString(inner);
      if (!parsedEdit) {
        return null;
      }
      parsedEdits.push(parsedEdit);
    }

    return parsedEdits;
  }

  private findFirstUnescapedWriteSeparator(
    input: string,
  ): { index: number; length: number } | null {
    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (char === "\\") {
        const decoded = this.decodeEscapedTextSequence(input, index);
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
        const decoded = this.decodeEscapedTextSequence(input, index);
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
      if (looksLikeWindowsDrive || looksLikeUrlScheme) {
        continue;
      }

      return { index, length: 1 };
    }

    return null;
  }

  private findLikelyEscapedWriteSeparator(
    input: string,
  ): { index: number; length: number } | null {
    for (let index = 0; index < input.length - 1; index++) {
      if (input[index] !== "\\") {
        continue;
      }

      const separatorChar = input[index + 1];
      if (separatorChar !== "|" && separatorChar !== ":") {
        continue;
      }

      if (separatorChar === ":") {
        const looksLikeWindowsDrive =
          index === 1 &&
          /[A-Za-z]/.test(input[0] || "") &&
          /[\\/]/.test(input[2] || "");
        const looksLikeUrlScheme = input.slice(index + 1, index + 4) === "://";
        if (looksLikeWindowsDrive || looksLikeUrlScheme) {
          continue;
        }
      }

      const pathCandidate = input.slice(0, index).trim();
      const contentCandidate = input.slice(index + 2);
      if (!pathCandidate || !contentCandidate) {
        continue;
      }

      if (/[\r\n]/.test(pathCandidate)) {
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
  }

  private decodeEscapedWriteContent(value: string): string {
    let decoded = "";

    for (let index = 0; index < value.length; ) {
      if (value[index] !== "\\") {
        decoded += value[index];
        index++;
        continue;
      }

      const escape = this.decodeEscapedTextSequence(value, index);
      decoded += escape.value;
      index += escape.consumed;
    }

    return decoded;
  }

  private parseCompactWriteArg(
    value: string,
  ): { path: string; content: string } | null {
    const separator =
      this.findFirstUnescapedWriteSeparator(value) ??
      this.findLikelyEscapedWriteSeparator(value);
    if (!separator) {
      return null;
    }

    const path = this.decodeEscapedWriteContent(
      value.slice(0, separator.index).trim(),
    );
    if (!path) {
      return null;
    }

    const content = this.decodeEscapedWriteContent(
      value.slice(separator.index + separator.length),
    );

    return { path, content };
  }

  private hasInlineWritePayload(args: string[]): boolean {
    if (args.length === 0) {
      return false;
    }

    if (this.parseCompactWriteArg(args[0]) !== null) {
      return true;
    }

    return args.length > 1;
  }

  private parseMultilineQuotedWriteArg(
    headerRest: string,
    body: string,
    options?: {
      allowPartial?: boolean;
    },
  ): { path: string; content: string } | null {
    const combined = [headerRest, body].filter(Boolean).join("\n").trim();
    if (combined.length < 2) {
      return null;
    }

    const firstChar = combined[0];
    if (!(firstChar === '"' || firstChar === "'" || firstChar === "`")) {
      return null;
    }

    for (let index = 1; index < combined.length; index++) {
      if (combined[index] !== firstChar) {
        continue;
      }

      if (this.isEscaped(combined, index)) {
        continue;
      }

      return this.parseCompactWriteArg(combined.slice(1, index));
    }

    if (!options?.allowPartial) {
      return null;
    }

    return this.parseCompactWriteArg(combined.slice(1));
  }

  private applyInlineWriteArgs(toolUse: any, args: string[]): boolean {
    if (args.length === 0) {
      return false;
    }

    const compact = this.parseCompactWriteArg(args[0]);
    if (compact) {
      toolUse.params.path = compact.path;
      toolUse.params.target_file = compact.path;
      toolUse.nativeArgs.path = compact.path;
      toolUse.nativeArgs.target_file = compact.path;
      toolUse.params.content = compact.content;
      toolUse.nativeArgs.content = compact.content;
      return true;
    }

    if (args.length === 1) {
      return false;
    }

    const content = args.slice(1).join("\n");
    toolUse.params.content = content;
    toolUse.nativeArgs.content = content;
    return true;
  }

  private combineAtMcpArguments(inlineRest: string, body: string): string {
    const trimmedInlineRest = inlineRest.trim();
    const trimmedBody = body.trim();

    if (trimmedInlineRest && trimmedBody) {
      return `${trimmedInlineRest}\n${trimmedBody}`;
    }

    return trimmedInlineRest || trimmedBody;
  }

  private collectActionsMcpArguments(
    lines: string[],
    startIndex: number,
    isClosed: boolean,
  ): { rawArguments: string; nextIndex: number; complete: boolean } {
    let index = startIndex;
    while (index < lines.length && !lines[index].trim()) {
      index++;
    }

    if (index >= lines.length) {
      return {
        rawArguments: "",
        nextIndex: lines.length,
        complete: isClosed,
      };
    }

    const firstLine = lines[index].trim();
    if (this.isActionsToolHeaderLine(firstLine)) {
      return {
        rawArguments: "",
        nextIndex: index,
        complete: true,
      };
    }

    const balancedJson = this.collectBalancedJsonLines(lines, index);
    if (balancedJson) {
      return {
        rawArguments: balancedJson.content,
        nextIndex: balancedJson.nextIndex,
        complete: true,
      };
    }

    const remaining = lines.slice(index).join("\n").trim();
    if (!isClosed) {
      return {
        rawArguments: remaining,
        nextIndex: lines.length,
        complete: false,
      };
    }

    return {
      rawArguments: lines[index].trim(),
      nextIndex: index + 1,
      complete: true,
    };
  }

  private isActionsToolHeaderLine(line: string): boolean {
    return (
      Boolean(this.parseActionsCommand(line)) || this.isRegisteredMcpTool(line)
    );
  }

  private collectBalancedJsonLines(
    lines: string[],
    startIndex: number,
  ): { content: string; nextIndex: number } | null {
    let depth = 0;
    let quote: string | null = null;
    let escape = false;
    let started = false;

    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex++) {
      const sourceLine = lines[lineIndex];
      const line =
        lineIndex === startIndex
          ? sourceLine.slice(sourceLine.search(/\S|$/))
          : sourceLine;

      for (let charIndex = 0; charIndex < line.length; charIndex++) {
        const char = line[charIndex];

        if (escape) {
          escape = false;
          continue;
        }

        if (quote) {
          if (char === "\\") {
            escape = true;
          } else if (char === quote) {
            quote = null;
          }
          continue;
        }

        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }

        if (!started) {
          if (/\s/.test(char)) {
            continue;
          }
          if (char !== "{" && char !== "[") {
            return null;
          }
          started = true;
          depth = 1;
          continue;
        }

        if (char === "{" || char === "[") {
          depth++;
          continue;
        }

        if (char === "}" || char === "]") {
          depth--;
          if (depth === 0) {
            const trailing = line.slice(charIndex + 1).trim();
            if (trailing) {
              return null;
            }
            return {
              content: lines
                .slice(startIndex, lineIndex + 1)
                .join("\n")
                .trim(),
              nextIndex: lineIndex + 1,
            };
          }
        }
      }
    }

    return null;
  }

  private collectContentToolBody(
    lines: string[],
    headerIndex: number,
    closer: string,
    isClosed: boolean,
  ): {
    body: string;
    loopIndex: number;
    sawCloser: boolean;
    explicitCloser?: string;
  } {
    const bodyStartIndex = headerIndex + 1;
    let bodyEndIndex = bodyStartIndex;

    while (
      bodyEndIndex < lines.length &&
      !this.isContentToolCloserLine(lines[bodyEndIndex], closer)
    ) {
      bodyEndIndex++;
    }

    const sawExplicitCloser =
      bodyEndIndex < lines.length &&
      this.isContentToolCloserLine(lines[bodyEndIndex], closer);
    const sawCloser =
      sawExplicitCloser || (isClosed && bodyEndIndex >= lines.length);
    const explicitCloser = sawExplicitCloser
      ? lines[bodyEndIndex].trim()
      : undefined;

    return {
      body: lines
        .slice(bodyStartIndex, bodyEndIndex)
        .map((line) => this.unescapeContentToolCloserLine(line, closer))
        .join("\n"),
      loopIndex: sawCloser
        ? bodyEndIndex
        : Math.max(headerIndex, bodyEndIndex - 1),
      sawCloser,
      explicitCloser,
    };
  }

  private collectAtBlockToolBody(
    lines: string[],
    headerIndex: number,
    isClosed: boolean,
    closer?: string,
  ): {
    body: string;
    loopIndex: number;
    sawCloser: boolean;
    explicitCloser?: string;
  } {
    const bodyStartIndex = headerIndex + 1;
    let bodyEndIndex = bodyStartIndex;

    while (
      bodyEndIndex < lines.length &&
      !(closer && this.isContentToolCloserLine(lines[bodyEndIndex], closer)) &&
      !this.isAtToolHeaderLine(lines[bodyEndIndex])
    ) {
      bodyEndIndex++;
    }

    const sawExplicitCloser =
      !!closer &&
      bodyEndIndex < lines.length &&
      this.isContentToolCloserLine(lines[bodyEndIndex], closer);
    const sawBoundary = bodyEndIndex < lines.length;
    const sawCloser =
      sawExplicitCloser ||
      sawBoundary ||
      (isClosed && bodyEndIndex >= lines.length);
    const explicitCloser = sawExplicitCloser
      ? lines[bodyEndIndex].trim()
      : undefined;

    return {
      body: lines
        .slice(bodyStartIndex, bodyEndIndex)
        .map((line) =>
          closer ? this.unescapeAtContentToolLine(line, closer) : line,
        )
        .join("\n"),
      loopIndex: sawExplicitCloser
        ? bodyEndIndex
        : sawBoundary
          ? bodyEndIndex - 1
          : lines.length - 1,
      sawCloser,
      explicitCloser,
    };
  }

  private isAtToolHeaderLine(line: string): boolean {
    return (
      line.startsWith("@") &&
      (this.parseAtToolCommand(line) !== null ||
        this.parseAtMcpToolCommand(line) !== null)
    );
  }

  private getContentToolCloser(command: string): string | null {
    switch (command) {
      case "write":
        return "eof";
      case "edit":
        return "eof";
      case "todo":
        return "eof";
      default:
        return null;
    }
  }

  private getContentToolCloserAliases(closer: string): string[] {
    switch (closer.toLowerCase()) {
      case "eof":
        return ["eof", "etxt"];
      default:
        return [closer.toLowerCase()];
    }
  }

  private unescapeAtContentToolLine(line: string, closer: string): string {
    return this.unescapeEscapedTextProtocolLine(
      this.unescapeContentToolCloserLine(line, closer),
    );
  }

  private unescapeEscapedTextProtocolLine(line: string): string {
    const eofUnescapedLine = this.unescapeContentToolCloserLine(line, "eof");
    if (eofUnescapedLine !== line) {
      return eofUnescapedLine;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("/@")) {
      return line;
    }

    const slashIndex = line.indexOf("/");
    if (slashIndex === -1) {
      return line;
    }

    const unescapedLine =
      line.slice(0, slashIndex) + line.slice(slashIndex + 1);
    const trimmedUnescapedLine = unescapedLine.trim();

    if (
      this.parseAtToolCommand(trimmedUnescapedLine) !== null ||
      this.parseAtMcpToolCommand(trimmedUnescapedLine) !== null
    ) {
      return unescapedLine;
    }

    return line;
  }

  private unescapeContentToolCloserLine(line: string, closer: string): string {
    const trimmed = line.trim();
    const closerAliases = this.getContentToolCloserAliases(closer);
    if (
      closerAliases.some(
        (alias) => trimmed.toLowerCase() === `/${alias.toLowerCase()}`,
      )
    ) {
      const slashIndex = line.indexOf("/");
      return line.slice(0, slashIndex) + line.slice(slashIndex + 1);
    }
    return line;
  }

  private isContentToolCloserLine(line: string, closer: string): boolean {
    const normalizedLine = line.trim().toLowerCase();
    return this.getContentToolCloserAliases(closer).includes(normalizedLine);
  }

  private normalizeActionsBodyLines(lines: string[]): string[] {
    if (lines.length === 0) {
      return lines;
    }

    const normalized = [...lines];
    const lastIndex = normalized.length - 1;
    normalized[lastIndex] = normalized[lastIndex]
      .replace(/[ \t]*END$/i, "")
      .trimEnd();

    return normalized;
  }

  private normalizeInlineActionsRemainder(value: string): string {
    let normalized = value.trim();
    if (!normalized) {
      return normalized;
    }

    // Tolerate models repeating the opener inline, e.g.:
    // ACTION ACTIONread src/App.jsx END
    while (/^ACTIONS?/i.test(normalized)) {
      normalized = normalized.replace(/^ACTIONS?/i, "").trim();
    }

    // Tolerate models placing END on the same line as the opener/action payload.
    normalized = normalized.replace(/[ \t]+END$/i, "").trim();

    return normalized;
  }

  private createActionsToolUse(
    shortName: string,
    argsStr: string,
    partial: boolean = false,
    toolIndex?: number,
  ): any {
    const resolvedToolIndex = toolIndex ?? this.toolCounter;
    const toolCallId = `unified_${this.currentTurnId}_${shortName}_${resolvedToolIndex}`;
    if (toolIndex === undefined && !partial) {
      this.toolCounter++;
    }
    return this.createToolUse(shortName, argsStr, partial, toolCallId);
  }

  private createAtToolUse(
    command: string,
    args: string[],
    rawArgs: string,
    partial: boolean = false,
    toolIndex?: number,
  ): any {
    const resolvedToolIndex = toolIndex ?? this.toolCounter;
    const toolCallId = `unified_${this.currentTurnId}_${command}_${resolvedToolIndex}`;
    if (toolIndex === undefined && !partial) {
      this.toolCounter++;
    }

    const toolUse: any = {
      type: "tool_use",
      name: this.mapShortNameToToolName(command),
      id: toolCallId,
      originalName: command,
      params: {},
      nativeArgs: {},
      partial,
      isComplete: !partial,
    };

    const firstArg = args[0] ?? "";
    const secondArg = args[1] ?? "";
    const trimmedRawArgs = rawArgs.trim();
    const normalizedRawArgs = this.stripMatchingOuterQuotes(trimmedRawArgs);
    const setPath = (path: string, options?: { targetFile?: boolean }) => {
      toolUse.params.path = path;
      toolUse.nativeArgs.path = path;
      if (options?.targetFile) {
        toolUse.params.target_file = path;
        toolUse.nativeArgs.target_file = path;
      }
    };

    switch (command) {
      case "read": {
        let pathArg = firstArg;
        let linesArg = secondArg;
        let headArg: string | undefined;
        let tailArg: string | undefined;
        const parseReadSpecs = (
          value?: string,
        ): {
          lineRanges: Array<{ start: number; end: number }>;
          head?: string;
          tail?: string;
          matched: boolean;
        } => {
          if (!value?.trim()) {
            return { lineRanges: [], matched: false };
          }

          const tokens = value
            .split(/[\s,]+/)
            .map((token) => token.trim())
            .filter(Boolean);
          if (tokens.length === 0) {
            return { lineRanges: [], matched: false };
          }

          const lineRanges: Array<{ start: number; end: number }> = [];
          let parsedHead: string | undefined;
          let parsedTail: string | undefined;

          for (const token of tokens) {
            const rangeMatch = token.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
              lineRanges.push({
                start: parseInt(rangeMatch[1], 10),
                end: parseInt(rangeMatch[2], 10),
              });
              continue;
            }

            const headMatch = token.match(/^H(\d+)$/i);
            if (headMatch) {
              parsedHead = headMatch[1];
              continue;
            }

            const tailMatch = token.match(/^T(\d+)$/i);
            if (tailMatch) {
              parsedTail = tailMatch[1];
              continue;
            }

            return { lineRanges: [], matched: false };
          }

          return {
            lineRanges,
            head: parsedHead,
            tail: parsedTail,
            matched: true,
          };
        };
        let parsedSpecs = parseReadSpecs(secondArg);

        const bracketMatch = !secondArg
          ? firstArg.match(/^(.*)\[([^[\]]+)\]$/)
          : null;
        if (bracketMatch) {
          const candidatePath = bracketMatch[1].trim();
          const bracketSpecs = parseReadSpecs(bracketMatch[2]);
          if (candidatePath && bracketSpecs.matched) {
            pathArg = candidatePath;
            linesArg = "";
            parsedSpecs = bracketSpecs;
            headArg = bracketSpecs.head;
            tailArg = bracketSpecs.tail;
          }
        } else {
          const scopedReadArg = !secondArg
            ? this.parseScopedInlineArg(firstArg)
            : null;
          if (scopedReadArg) {
            const candidatePath = scopedReadArg.scope;
            const candidateSpecs = scopedReadArg.payload;
            const colonSpecs = parseReadSpecs(
              candidateSpecs.replace(/\bL(?=\d+-\d+\b)/gi, ""),
            );
            if (candidatePath && colonSpecs.matched) {
              pathArg = candidatePath;
              linesArg = "";
              parsedSpecs = colonSpecs;
              headArg = colonSpecs.head;
              tailArg = colonSpecs.tail;
            }
          } else if (!secondArg) {
            const inlineSpacedSpecMatch = firstArg.match(/^(\S+)\s+([\s\S]+)$/);
            if (inlineSpacedSpecMatch) {
              const spacedSpecs = parseReadSpecs(inlineSpacedSpecMatch[2]);
              if (spacedSpecs.matched) {
                pathArg = inlineSpacedSpecMatch[1];
                linesArg = "";
                parsedSpecs = spacedSpecs;
                headArg = spacedSpecs.head;
                tailArg = spacedSpecs.tail;
              }
            }
          }
        }

        const fileEntry: {
          path: string;
          lineRanges: Array<{ start: number; end: number }>;
          head?: number;
          tail?: number;
        } = {
          path: pathArg,
          lineRanges: [],
        };

        if (parsedSpecs.matched && parsedSpecs.lineRanges.length > 0) {
          fileEntry.lineRanges.push(...parsedSpecs.lineRanges);
          toolUse.params.lineRange = parsedSpecs.lineRanges
            .map((range) => `${range.start}-${range.end}`)
            .join(", ");
        } else if (linesArg) {
          const lineMatch = linesArg.match(/^(\d+)-(\d+)$/);
          if (lineMatch) {
            fileEntry.lineRanges.push({
              start: parseInt(lineMatch[1], 10),
              end: parseInt(lineMatch[2], 10),
            });
            toolUse.params.lineRange = linesArg;
          }
        }

        if (parsedSpecs.matched && parsedSpecs.head) {
          fileEntry.head = parseInt(parsedSpecs.head, 10);
          toolUse.params.head = parsedSpecs.head;
        } else if (headArg) {
          fileEntry.head = parseInt(headArg, 10);
          toolUse.params.head = headArg;
        }

        if (parsedSpecs.matched && parsedSpecs.tail) {
          fileEntry.tail = parseInt(parsedSpecs.tail, 10);
          toolUse.params.tail = parsedSpecs.tail;
        } else if (tailArg) {
          fileEntry.tail = parseInt(tailArg, 10);
          toolUse.params.tail = tailArg;
        }

        toolUse.params.path = pathArg;
        toolUse.nativeArgs.files = [fileEntry];
        break;
      }
      case "grep": {
        const scopedGrepArg = !secondArg && normalizedRawArgs
          ? this.parseScopedInlineArg(normalizedRawArgs)
          : null;
        const { value: pathArg, remaining } = this.consumeNamedOrInAtArgument(
          args.slice(1),
          ["path"],
        );
        const legacyPositionalTarget =
          !pathArg && args.length === 2 ? remaining[0] : undefined;
        const positionalTarget = pathArg || legacyPositionalTarget;
        const includeMatch = positionalTarget?.match(/^include\s*=\s*(.+)$/i);
        const parsedScope = scopedGrepArg
          ? this.parseGrepScopeArg(scopedGrepArg.scope)
          : {};
        const queryTail = includeMatch ? remaining.slice(0, -1) : remaining;
        const querySegments = scopedGrepArg
          ? [scopedGrepArg.payload]
          : pathArg || includeMatch
            ? [firstArg, ...queryTail]
            : legacyPositionalTarget
              ? [firstArg]
              : args;
        toolUse.params.query = this.splitPipe(
          querySegments
            .filter((segment) => typeof segment === "string" && segment.length > 0)
            .join(" "),
        );
        toolUse.nativeArgs.query = toolUse.params.query;
        if (parsedScope.include) {
          toolUse.params.include = parsedScope.include;
          toolUse.nativeArgs.include = toolUse.params.include;
        } else if (includeMatch) {
          toolUse.params.include = includeMatch[1].trim();
          toolUse.nativeArgs.include = toolUse.params.include;
        }
        toolUse.params.path = parsedScope.path
          ? parsedScope.path
          : includeMatch
            ? "."
            : positionalTarget || ".";
        toolUse.nativeArgs.path = toolUse.params.path;
        break;
      }
      case "find": {
        const scopedFindArg = !secondArg && normalizedRawArgs
          ? this.parseScopedInlineArg(normalizedRawArgs)
          : null;
        const { value: pathArg, remaining } = this.consumeNamedOrInAtArgument(
          args.slice(1),
          ["path"],
        );
        const legacyPositionalPath =
          !pathArg && args.length === 2 ? remaining[0] : undefined;
        toolUse.params.pattern = this.splitGlobPatterns(
          scopedFindArg?.payload ??
            (pathArg
              ? [firstArg, ...remaining].join(" ")
              : legacyPositionalPath
                ? firstArg
                : args.join(" ")),
        );
        toolUse.nativeArgs.pattern = toolUse.params.pattern;
        toolUse.params.path =
          scopedFindArg?.scope || pathArg || legacyPositionalPath || ".";
        toolUse.nativeArgs.path = toolUse.params.path;
        break;
      }
      case "list":
        setPath(normalizedRawArgs || firstArg || ".");
        break;
      case "bash": {
        const scopedBashArg = normalizedRawArgs
          ? this.parseScopedInlineArg(normalizedRawArgs, {
              allowWhitespaceScope: false,
            })
          : null;
        const { value: cwdArg, remaining } = this.consumeNamedOrInAtArgument(
          args.slice(1),
          ["cwd", "path"],
        );
        const implicitCwd =
          !cwdArg &&
          remaining.length === 1 &&
          typeof firstArg === "string" &&
          firstArg.includes(" ")
            ? remaining[0]
            : undefined;
        const commandTokens = scopedBashArg
          ? [scopedBashArg.payload]
          : implicitCwd
            ? [firstArg]
            : [firstArg, ...remaining];
        toolUse.params.command = this.normalizeCmdCommand(
          commandTokens
            .filter(
              (token): token is string =>
                typeof token === "string" && token.length > 0,
            )
            .join(" "),
        );
        toolUse.nativeArgs.command = toolUse.params.command;
        if (cwdArg || implicitCwd || scopedBashArg?.scope) {
          toolUse.params.cwd = cwdArg || implicitCwd || scopedBashArg?.scope;
          toolUse.nativeArgs.cwd = toolUse.params.cwd;
        }
        break;
      }
      case "web":
      case "ask":
        toolUse.params.query = normalizedRawArgs || firstArg;
        toolUse.nativeArgs.query = toolUse.params.query;
        break;
      case "fetch":
        toolUse.params.url = normalizedRawArgs || firstArg;
        toolUse.nativeArgs.url = toolUse.params.url;
        break;
      case "agent":
        toolUse.params.prompt = normalizedRawArgs || firstArg;
        toolUse.nativeArgs.prompt = toolUse.params.prompt;
        toolUse.params.instructions = toolUse.params.prompt;
        toolUse.nativeArgs.instructions = toolUse.params.instructions;
        break;
      case "edit":
        setPath(firstArg);
        this.applyInlineEditArgs(toolUse, args);
        break;
      case "write":
        this.applyInlineWriteArgs(toolUse, args);
        if (!toolUse.params.path && !toolUse.params.target_file) {
          setPath(firstArg, { targetFile: true });
        }
        break;
      case "mkdir":
        setPath(firstArg);
        break;
      case "todo":
        toolUse.isArgBased = false;
        if (normalizedRawArgs || firstArg) {
          toolUse.params.todos = normalizedRawArgs || firstArg;
          toolUse.nativeArgs.todos = toolUse.params.todos;
        }
        break;
      case "desktop":
      case "computer_action":
        this.applyDesktopAtArgs(toolUse, args, rawArgs);
        break;
      default:
        this.populateToolArgs(command, args.join(" "), toolUse);
        break;
    }

    applyParamsDefaulting(toolUse);

    if (
      (toolUse.name === "grep" ||
        toolUse.name === "glob" ||
        toolUse.name === "list") &&
      toolUse.nativeArgs.path === undefined
    ) {
      toolUse.nativeArgs.path = toolUse.params.path;
    }

    return toolUse;
  }

  private consumeNamedAtArgument(
    args: string[],
    keys: string[],
  ): { value?: string; remaining: string[] } {
    const normalizedKeys = keys.map((key) => key.toLowerCase());
    const remaining: string[] = [];
    let value: string | undefined;

    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      const normalizedArg = arg.toLowerCase();

      if (value === undefined) {
        const exactKeyMatch = normalizedKeys.find(
          (key) => normalizedArg === `${key}:`,
        );
        if (exactKeyMatch) {
          const nextArg = args[index + 1];
          if (nextArg !== undefined) {
            value = this.stripMatchingOuterQuotes(nextArg);
            index++;
            continue;
          }
        }

        const inlineKeyMatch = normalizedKeys.find((key) =>
          normalizedArg.startsWith(`${key}:`),
        );
        if (inlineKeyMatch) {
          value = this.stripMatchingOuterQuotes(
            arg.slice(inlineKeyMatch.length + 1),
          );
          continue;
        }
      }

      remaining.push(arg);
    }

    return { value, remaining };
  }

  private consumeNamedOrInAtArgument(
    args: string[],
    keys: string[],
  ): { value?: string; remaining: string[] } {
    const named = this.consumeNamedAtArgument(args, keys);
    if (named.value !== undefined) {
      return named;
    }

    const remaining: string[] = [];
    let value: string | undefined;

    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (value === undefined && arg.toLowerCase() === "in") {
        const nextArg = args[index + 1];
        if (nextArg !== undefined) {
          value = this.stripMatchingOuterQuotes(nextArg);
          index++;
          continue;
        }
      }

      remaining.push(arg);
    }

    return { value, remaining };
  }

  private applyDesktopAtArgs(
    toolUse: any,
    args: string[],
    rawArgs?: string,
  ): void {
    const rawFirstArg = this.stripMatchingOuterQuotes(
      (rawArgs?.trim() || args[0] || "").trim(),
    );
    const parseActionAndInlineValue = (
      input: string,
    ): { action: string; inlineValue?: string } => {
      const separatorIndex = input.indexOf(":");
      if (separatorIndex === -1) {
        return { action: input };
      }

      const candidateAction = input.slice(0, separatorIndex).trim();
      const candidateValue = input.slice(separatorIndex + 1).trim();
      const knownActions = new Set([
        "key",
        "type",
        "mouse_move",
        "left_click",
        "left_click_drag",
        "right_click",
        "middle_click",
        "double_click",
        "scroll",
        "get_screenshot",
        "get_cursor_position",
      ]);

      if (!knownActions.has(candidateAction)) {
        return { action: input };
      }

      return { action: candidateAction, inlineValue: candidateValue };
    };

    const { action, inlineValue } = parseActionAndInlineValue(rawFirstArg);
    if (!action) {
      return;
    }

    const params = toolUse.params;
    const native = toolUse.nativeArgs;
    params.action = action;
    native.action = action;

    const setCoordinate = (value?: string) => {
      if (!value) {
        return;
      }
      params.coordinate = value;
      native.coordinate = value;
    };

    const setText = (value?: string) => {
      if (!value) {
        return;
      }
      params.text = value;
      native.text = value;
    };

    const isCoordinateLike = (value?: string): boolean =>
      !!value && /^\d+,\d+@\d+x\d+$/i.test(value.trim());
    const isPlainCoordinateLike = (value?: string): boolean =>
      !!value && /^\d+\s*,\s*\d+$/i.test(value.trim());
    const isAnyCoordinateLike = (value?: string): boolean =>
      isCoordinateLike(value) || isPlainCoordinateLike(value);
    const parsePackedScrollValue = (
      value?: string,
    ): { coordinate?: string; text?: string } => {
      if (!value) {
        return {};
      }

      const trimmed = value.trim();
      const coordinatePrefixMatch = trimmed.match(
        /^(\d+\s*,\s*\d+(?:\s*@\s*\d+\s*[x,]\s*\d+)?)\s*:(.+)$/i,
      );
      if (coordinatePrefixMatch) {
        return {
          coordinate: coordinatePrefixMatch[1].trim(),
          text: coordinatePrefixMatch[2].trim(),
        };
      }

      if (isAnyCoordinateLike(trimmed)) {
        return { coordinate: trimmed };
      }

      return { text: trimmed };
    };

    const { value: coordinateArg, remaining: withoutCoordinate } =
      this.consumeNamedAtArgument(args.slice(1), ["coordinate"]);
    const { value: textArg, remaining: positionalArgs } =
      this.consumeNamedAtArgument(withoutCoordinate, ["text"]);
    const positionalValues = inlineValue
      ? [inlineValue, ...positionalArgs]
      : positionalArgs;

    switch (action) {
      case "mouse_move":
      case "left_click":
      case "left_click_drag":
      case "right_click":
      case "middle_click":
      case "double_click":
        setCoordinate(coordinateArg || positionalValues[0]);
        setText(textArg);
        break;
      case "key":
      case "type":
        setText(textArg || positionalValues[0]);
        setCoordinate(coordinateArg);
        break;
      case "scroll":
        {
          const packedScroll = parsePackedScrollValue(inlineValue);
          setCoordinate(coordinateArg || packedScroll.coordinate);
          if (textArg || packedScroll.text) {
            setText(textArg || packedScroll.text);
            break;
          }
          if (positionalValues.length >= 2) {
            if (!params.coordinate && isAnyCoordinateLike(positionalValues[0])) {
              setCoordinate(positionalValues[0]);
              setText(positionalValues.slice(1).join(":"));
            } else {
              setText(positionalValues.join(":"));
            }
            break;
          }
          if (positionalValues.length === 1) {
            if (!params.coordinate && isAnyCoordinateLike(positionalValues[0])) {
              setCoordinate(positionalValues[0]);
            } else {
              setText(positionalValues[0]);
            }
          }
        }
        break;
      default:
        setCoordinate(coordinateArg);
        setText(textArg || positionalValues[0]);
        break;
    }
  }

  private createActionsMcpToolUse(
    toolName: string,
    rawArguments: string,
    partial: boolean = false,
    toolIndex?: number,
  ): McpToolUse {
    const resolvedToolIndex = toolIndex ?? this.toolCounter;
    const toolCallId = `unified_${this.currentTurnId}_${toolName}_${resolvedToolIndex}`;
    if (toolIndex === undefined && !partial) {
      this.toolCounter++;
    }
    return this.createMcpToolUse(toolName, rawArguments, partial, toolCallId);
  }

  private createActionsBashToolUse(
    argsStr: string,
    originalCommand: string,
    partial: boolean = false,
    toolIndex?: number,
  ): any {
    const cwdMatch = argsStr.match(/^(.*?)\s*:\s*([\s\S]+)$/);
    if (cwdMatch && cwdMatch[1].trim() && cwdMatch[2].trim()) {
      const cwd = cwdMatch[1].trim();
      const command = cwdMatch[2].trim();
      return this.createActionsToolUse(
        originalCommand,
        `--command ${JSON.stringify(command)} --cwd ${JSON.stringify(cwd)}`,
        partial,
        toolIndex,
      );
    }

    const naturalCwdMatch = argsStr.match(/^([\s\S]*?)\s+in\s+(\S[\s\S]*)$/);
    if (
      naturalCwdMatch &&
      naturalCwdMatch[1].trim() &&
      naturalCwdMatch[2].trim()
    ) {
      const command = naturalCwdMatch[1].trim();
      const cwd = naturalCwdMatch[2].trim();
      return this.createActionsToolUse(
        originalCommand,
        `--command ${JSON.stringify(command)} --cwd ${JSON.stringify(cwd)}`,
        partial,
        toolIndex,
      );
    }

    return this.createActionsToolUse(
      originalCommand,
      argsStr,
      partial,
      toolIndex,
    );
  }

  private convertNaturalSearchArgs(argsStr: string): string {
    const match = argsStr.match(/^([\s\S]*?)\s+in\s+(\S[\s\S]*)$/);
    let rawQuery = match ? match[1].trim() : argsStr.trim();
    let path = match ? match[2].trim() : "";
    let include: string | undefined;

    if (!path) {
      const gluedInMatch = rawQuery.match(
        /^([\s\S]*?)\s+in([A-Za-z0-9_./~\\-][\s\S]*)$/,
      );
      if (gluedInMatch) {
        rawQuery = gluedInMatch[1].trim();
        path = gluedInMatch[2].trim();
      }
    }

    if (!path) {
      const scopedGrepArg = this.parseScopedInlineArg(rawQuery, {
        allowWhitespaceScope: false,
      });
      if (scopedGrepArg) {
        const parsedScope = this.parseGrepScopeArg(scopedGrepArg.scope);
        rawQuery = scopedGrepArg.payload;
        path = parsedScope.path || ".";
        include = parsedScope.include;
      }
    }

    if (!path) {
      const splitMatch = rawQuery.match(
        /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|(\S+))(?:\s+([\s\S]*))?$/,
      );
      if (splitMatch) {
        const firstToken = (
          splitMatch[1] ??
          splitMatch[2] ??
          splitMatch[3] ??
          splitMatch[4] ??
          ""
        ).trim();
        const rest = (splitMatch[5] ?? "").trim();
        if (rest && this.looksLikePathArg(rest)) {
          rawQuery = firstToken;
          path = rest;
        }
      }
    }

    const normalizedQuery = this.stripMatchingOuterQuotes(rawQuery);
    const queries = normalizedQuery
      .split("|")
      .map((query) => query.trim())
      .filter(Boolean);

    if (include) {
      return `--query ${JSON.stringify(queries.join("|"))} --include ${JSON.stringify(include)} --path ${JSON.stringify(path || ".")}`;
    }

    if (!path) {
      return queries.join("|");
    }

    return `${path}\n${queries.join("\n")}`;
  }

  private convertNaturalFindArgs(argsStr: string): string {
    const match = argsStr.match(/^([\s\S]*?)\s+in\s+(\S[\s\S]*)$/);
    let rawPattern = match ? match[1].trim() : argsStr.trim();
    let path = match ? match[2].trim() : "";
    const wasQuotedInitially =
      (rawPattern.startsWith('"') && rawPattern.endsWith('"')) ||
      (rawPattern.startsWith("'") && rawPattern.endsWith("'")) ||
      (rawPattern.startsWith("`") && rawPattern.endsWith("`"));

    if (!path) {
      const gluedInMatch = rawPattern.match(
        /^([\s\S]*?)\s+in([A-Za-z0-9_./~\\-][\s\S]*)$/,
      );
      if (gluedInMatch) {
        rawPattern = gluedInMatch[1].trim();
        path = gluedInMatch[2].trim();
      }
    }

    if (!path) {
      const scopedFindArg = this.parseScopedInlineArg(rawPattern, {
        allowWhitespaceScope: false,
      });
      if (scopedFindArg) {
        rawPattern = scopedFindArg.payload;
        path = scopedFindArg.scope;
      }
    }

    if (!path && !wasQuotedInitially) {
      const splitMatch = rawPattern.match(
        /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|(\S+))(?:\s+([\s\S]*))?$/,
      );
      if (splitMatch) {
        const firstToken = (
          splitMatch[1] ??
          splitMatch[2] ??
          splitMatch[3] ??
          splitMatch[4] ??
          ""
        ).trim();
        const rest = (splitMatch[5] ?? "").trim();
        const looksLikeGlobPattern =
          /[*?\[\]{}]/.test(rest) ||
          (rest.startsWith(".") && !rest.includes(" "));

        if (
          firstToken &&
          rest &&
          this.looksLikePathArg(firstToken) &&
          looksLikeGlobPattern
        ) {
          path = firstToken;
          rawPattern = rest;
        }
      }

      if (path) {
        const normalizedPattern = this.stripMatchingOuterQuotes(rawPattern);
        const patterns = splitGlobPatternList(normalizedPattern, {
          allowLegacyPipe: true,
        });

        return `${path}\n${patterns.join("\n")}`;
      }

      const parts = rawPattern
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length >= 3) {
        const candidatePath = parts[parts.length - 1];
        const lastPatternToken = parts[parts.length - 2];
        if (
          this.looksLikePathArg(candidatePath) &&
          /in$/i.test(lastPatternToken) &&
          lastPatternToken.length > 2
        ) {
          path = candidatePath;
          parts[parts.length - 2] = lastPatternToken.slice(0, -2);
          rawPattern = parts.slice(0, -1).filter(Boolean).join(" ");
        }
      }
    }

    const normalizedPattern = this.stripMatchingOuterQuotes(rawPattern);
    const topLevelPatterns = splitGlobPatternList(normalizedPattern, {
      allowLegacyPipe: true,
    });
    const patterns = topLevelPatterns.length > 1
      ? topLevelPatterns
      : !wasQuotedInitially && /\s+/.test(normalizedPattern)
        ? normalizedPattern
            .split(/\s+/)
            .map((pattern) => pattern.trim())
            .filter(Boolean)
        : [normalizedPattern].filter(Boolean);

    if (!path) {
      return patterns.join("\n");
    }

    return `${path}\n${patterns.join("\n")}`;
  }

  private convertNaturalListArgs(argsStr: string): string {
    let rawPath = argsStr.trim();
    let recursive = false;

    if (!rawPath) {
      return ".";
    }

    const recursiveFlagMatch = rawPath.match(
      /^(.*?)(?:\s+)?--recursive(?:[=\s]+(true|false))?$/i,
    );
    if (recursiveFlagMatch) {
      rawPath = recursiveFlagMatch[1].trim();
      recursive =
        !recursiveFlagMatch[2] ||
        recursiveFlagMatch[2].toLowerCase() === "true";
    } else {
      const trailingBooleanMatch = rawPath.match(/^(.*?)\s+(true|false)$/i);
      if (trailingBooleanMatch) {
        rawPath = trailingBooleanMatch[1].trim();
        recursive = trailingBooleanMatch[2].toLowerCase() === "true";
      }
    }

    const normalizedPath = this.stripMatchingOuterQuotes(rawPath || ".");

    if (!recursive) {
      return normalizedPath || ".";
    }

    return `${normalizedPath || "."}\ntrue`;
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
      "write",
      "edit",
      "new_rule",
      "edit_file",
      "todo",
      "todo",
      "bash",
      "wrap",
      "agent",
    ].includes(toolName);
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

  private createMcpToolUse(
    shortName: string,
    rawArguments: string,
    partial: boolean,
    id: string,
  ): McpToolUse {
    const { serverName, toolName } = this.parseMcpToolName(shortName);

    const toolUse: McpToolUse = {
      type: "mcp_tool_use",
      id,
      name: shortName,
      serverName,
      toolName,
      arguments: this.parseMcpArguments(rawArguments),
      partial,
    };

    (toolUse as any).isComplete = !partial;

    return toolUse;
  }

  private parseMcpArguments(rawArguments: string): Record<string, unknown> {
    const trimmedArguments = rawArguments.trim();
    if (!trimmedArguments) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmedArguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return { input: parsed };
    } catch {
      return { input: trimmedArguments };
    }
  }

  private mapShortNameToToolName(shortName: string): ToolName {
    const mapping: Record<string, ToolName> = {
      read: "read",
      R: "read",
      edit: "edit",
      E: "edit",
      write: "write",
      W: "write",
      list: "list",
      ls: "list",
      L: "list",
      glob: "glob",
      F: "glob",
      grep: "grep",
      search: "grep",
      G: "grep",
      shell: "bash",
      cmd: "bash",
      B: "bash",
      todo: "todo",
      T: "todo",
      D: "attempt_completion",
      done: "attempt_completion",
      web: "web",
      X: "web",
      Y: "ask",
      research: "research_web",
      fetch: "fetch",
      U: "fetch",
      browse: "browser_action",
      browser: "browser_action",
      click: "browser_action",
      type: "browser_action",
      scroll: "browser_action",
      computer: "computer_action",
      desktop: "computer_action",
      image: "generate_image",
      ask: "ask",
      edit_file: "edit_file",
      new_rule: "new_rule",
      report_bug: "report_bug",
      agent: "agent",
      Z: "agent",
      sub: "agent",
      condense: "condense",
      diff: "edit",
      bash: "bash",
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
    return (
      mapping[shortName] ||
      (resolveToolAlias(shortName) as ToolName) ||
      (shortName as ToolName)
    );
  }

  private populateToolArgs(shortName: string, argsStr: string, toolUse: any) {
    const params = toolUse.params;
    const native = toolUse.nativeArgs;
    const normalizedShortName = resolveToolAlias(shortName);
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

    const stripLongFlagSegment = (input: string, flagName: string): string => {
      const flagPattern = `--${flagName}`;
      const flagIndex = input.indexOf(flagPattern);
      if (flagIndex === -1) return input.trim();

      let i = flagIndex + flagPattern.length;
      while (i < input.length && /\s/.test(input[i])) i++;
      if (i >= input.length) {
        return `${input.slice(0, flagIndex)} ${input.slice(i)}`
          .replace(/[ \t]{2,}/g, " ")
          .trim();
      }

      const quoteChar = input[i];
      if (quoteChar === '"' || quoteChar === "'" || quoteChar === "`") {
        i++;
        let escaped = false;
        while (i < input.length) {
          const char = input[i];
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === quoteChar) {
            i++;
            break;
          }
          i++;
        }
      } else {
        while (i < input.length) {
          if (input[i] === "-" && input[i + 1] === "-") break;
          i++;
        }
      }

      return `${input.slice(0, flagIndex)} ${input.slice(i)}`
        .replace(/[ \t]{2,}/g, " ")
        .trim();
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
    const parseInlineIncludePattern = (value?: string): string | undefined => {
      if (!value?.trim()) {
        return undefined;
      }

      const normalizedValue = this.stripMatchingOuterQuotes(value);
      const includeMatch = normalizedValue.match(/^include\s*=\s*(.+)$/i);
      if (!includeMatch) {
        return undefined;
      }

      const includePattern = includeMatch[1].trim();
      return includePattern || undefined;
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
        params.query = queries.map((q) => this.stripMatchingOuterQuotes(q));
        native.query = queries;
      } else {
        params.query = this.stripMatchingOuterQuotes(queries[0] || "");
        native.query = params.query;
      }
      native.query = params.query;
      return;
    }

    if (
      shortName === "cmd" ||
      shortName === "shell" ||
      shortName === "bash" ||
      shortName === "B"
    ) {
      const cwd = flags.cwd || flags.path;
      const stdin = flags.stdin;
      const executionId = flags.execution_id;
      let commandInput = argsStr;
      if (flags.cwd) {
        commandInput = stripLongFlagSegment(commandInput, "cwd");
      }
      if (flags.path) {
        commandInput = stripLongFlagSegment(commandInput, "path");
      }
      if (flags.stdin) {
        commandInput = stripLongFlagSegment(commandInput, "stdin");
      }
      if (flags.execution_id) {
        commandInput = stripLongFlagSegment(commandInput, "execution_id");
      }
      const scopedCommand =
        !flags.run && !flags.command && !cwd
          ? this.parseScopedInlineArg(commandInput.trim(), {
              allowWhitespaceScope: false,
            })
          : null;
      const command =
        flags.run ||
        flags.command ||
        scopedCommand?.payload ||
        commandInput.trim();
      if (stdin !== undefined) {
        params.stdin = stdin;
        native.stdin = stdin;
      } else {
        params.command = this.normalizeCmdCommand(command);
        native.command = params.command;
      }
      if (executionId) {
        params.execution_id = executionId;
        native.execution_id = executionId;
      }
      if (cwd) {
        params.cwd = cwd;
        native.cwd = cwd;
      } else if (scopedCommand?.scope) {
        params.cwd = scopedCommand.scope;
        native.cwd = scopedCommand.scope;
      }
      return;
    }

    switch (normalizedShortName) {
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

        // Positional refinement: if pathStr contains a space (but not newline) and no
        // explicit --lines flag, split the first token as the path and treat the rest
        // as line specs. This supports wrapperless READ syntax like:
        //   READ src/app.ts 1-50
        // and preserves multiline bodies for multi-file reads.
        if (
          (shortName === "R" || shortName === "read") &&
          pathStr &&
          !linesStr &&
          !rawPath &&
          !flags.path &&
          !pathStr.includes("\n")
        ) {
          const scopedReadArg = this.parseScopedInlineArg(pathStr, {
            allowWhitespaceScope: false,
          });
          if (scopedReadArg) {
            const scopedSpecs = parseReadRangeSpecs(scopedReadArg.payload);
            if (scopedSpecs.hasOnlySpecs) {
              pathStr = scopedReadArg.scope;
              linesStr = scopedReadArg.payload;
            }
          }

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
                ? logicalLines.slice(1).map((line) => parseReadRangeSpecs(line))
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
              const singleColonTargetMatch = this.parseScopedInlineArg(inner, {
                allowWhitespaceScope: false,
              });
              const singleBracketTargetMatch = inner.match(
                /^(.*)\[([^[\]]+)\]$/,
              );
              const parsedBracketSpecs = singleBracketTargetMatch
                ? parseReadRangeSpecs(singleBracketTargetMatch[2])
                : undefined;
              const parsedColonSpecs = singleColonTargetMatch
                ? parseReadRangeSpecs(singleColonTargetMatch.payload)
                : undefined;

              if (parsedBracketSpecs?.hasOnlySpecs) {
                paths = [inner.trim()];
              } else if (
                singleColonTargetMatch &&
                parsedColonSpecs?.hasOnlySpecs
              ) {
                paths = [singleColonTargetMatch.scope];
                continuationSpecs = parsedColonSpecs;
              } else {
                paths = inner
                  .split(/[\r\n]+|, */)
                  .map((p) => p.trim())
                  .filter(Boolean);
              }
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

            // Support path:L1-50, path:H10, path:T20, "path 1-50", "path H10", and "path T20"
            const inlineBracketSpecMatch = p.match(/^(.*)\[([^[\]]+)\]$/);
            const inlineCompactSpecMatch = p.match(
              /^(.*?):([LHT])(\d+(?:-\d+)?)$/i,
            );
            const inlineSpecMatch = p.match(/^(\S+)\s+([\s\S]+)$/);

            if (inlineBracketSpecMatch) {
              const parsedBracketSpecs = parseReadRangeSpecs(
                inlineBracketSpecMatch[2],
              );
              if (parsedBracketSpecs.hasOnlySpecs) {
                parsedPath = inlineBracketSpecMatch[1].trim();
                fileEntry.path = parsedPath;
                inlineSpecs = parsedBracketSpecs;
              }
            } else if (inlineCompactSpecMatch) {
              parsedPath = inlineCompactSpecMatch[1].trim();
              fileEntry.path = parsedPath;
              const compactType = inlineCompactSpecMatch[2].toUpperCase();
              const compactValue = inlineCompactSpecMatch[3];
              inlineSpecs = parseReadRangeSpecs(
                compactType === "L"
                  ? compactValue
                  : `${compactType}${compactValue}`,
              );
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
                applyReadSpecsToEntry(fileEntry, parseReadRangeSpecs(rangeStr));
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
        const inlineArgs = this.parseAtToolArguments(argsStr);
        const pathMatch = inlineArgs.args[0] || argsStr.trim().split(/\s+/)[0];
        const path = flags.path || pathMatch || "";
        params.path = path;
        native.path = path;
        if (inlineArgs.complete && inlineArgs.args.length > 1) {
          this.applyInlineEditArgs(toolUse, inlineArgs.args);
        }
        break;
      }
      case "W":
      case "write": {
        const inlineArgs = this.parseAtToolArguments(argsStr);
        const pathMatch = inlineArgs.args[0] || argsStr.trim().split(/\s+/)[0];
        const path = flags.path || pathMatch || "";

        if (inlineArgs.complete) {
          this.applyInlineWriteArgs(toolUse, inlineArgs.args);
        }
        if (!params.path && !params.target_file) {
          params.path = path;
          params.target_file = path;
          native.path = path;
          native.target_file = path;
        }
        break;
      }
      case "L":
      case "ls":
      case "list": {
        const beforeFlags = argsStr.split(/\s+--/)[0].trim();
        const lines = beforeFlags
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const recursiveLine = lines.find(
          (line) =>
            /^(?:--recursive(?:\s+|=))?true$/i.test(line) ||
            /^(?:--recursive(?:\s+|=))?false$/i.test(line) ||
            /^--recursive$/i.test(line),
        );
        const pathLine = lines.find((line) => line !== recursiveLine);
        const path =
          flags.path ||
          (pathLine && !pathLine.startsWith("--") ? pathLine : ".");
        params.path = path;
        native.path = params.path;
        if (
          (!!recursiveLine && !/false$/i.test(recursiveLine)) ||
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
          params.pattern = this.stripMatchingOuterQuotes(flags.pattern);
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
            const patterns = lines
              .slice(1)
              .map((pattern) => this.stripMatchingOuterQuotes(pattern));
            params.pattern = this.splitGlobPatterns(patterns);
          } else {
            const scopedFindArg = this.parseScopedInlineArg(beforeFlags, {
              allowWhitespaceScope: false,
            });
            if (scopedFindArg) {
              params.pattern = this.stripMatchingOuterQuotes(
                scopedFindArg.payload,
              );
              params.path = flags.path || scopedFindArg.scope;
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
                  params.pattern = this.stripMatchingOuterQuotes(secondToken);
                  params.path = flags.path || firstToken;
                } else {
                  params.pattern = this.stripMatchingOuterQuotes(firstToken);
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
                  params.pattern = this.stripMatchingOuterQuotes(firstToken);
                  params.path = flags.path || ".";
                }
              }
            } else {
              params.pattern = this.stripMatchingOuterQuotes(beforeFlags);
              params.path = flags.path || ".";
            }
            }
          }
        }

        // Allow multi-line pattern appending
        toolUse.isArgBased = false;

        // Normalize: keep array if multiple patterns, string if single
        if (params.pattern !== undefined && params.pattern !== null) {
          if (Array.isArray(params.pattern)) {
            params.pattern = this.splitGlobPatterns(
              params.pattern.map((pattern: string) =>
                this.stripMatchingOuterQuotes(pattern),
              ),
            );
          } else {
            params.pattern = this.splitGlobPatterns(
              this.stripMatchingOuterQuotes(params.pattern),
            );
          }
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
        const { cleanedInput: grepArgs, present: hasIncludeAllShortFlag } =
          extractStandaloneShortFlag(argsStr, "i");
        const beforeFlags = grepArgs.split(/\s+--/)[0].trim();
        const includeFromFlag =
          flags.include || flags.file_pattern || flags["file-pattern"];
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
            const scopedGrepArg = this.parseScopedInlineArg(beforeFlags, {
              allowWhitespaceScope: false,
            });
            if (scopedGrepArg) {
              const parsedScope = this.parseGrepScopeArg(scopedGrepArg.scope);
              rawQuery = scopedGrepArg.payload;
              params.path = flags.path || parsedScope.path || ".";
              if (parsedScope.include) {
                params.include = parsedScope.include;
              }
            } else {
            // Single line case: logic for swapping query/path remains same
            // but we only do this if there is NO block content.
            // KILOCODE FIX: Improved positional argument parsing for Grep.
            // If beforeFlags contains multiple tokens, the first is query, second is path.
            // If it's a single token, we check if it looks like a path (contains / or .)
            const { first: firstToken, rest: secondToken } =
              splitLeadingToken(beforeFlags);
            if (firstToken) {
              if (secondToken) {
                const includePattern =
                  parseInlineIncludePattern(secondToken) || includeFromFlag;
                if (includePattern) {
                  rawQuery = firstToken;
                  params.path = flags.path || ".";
                  params.include = includePattern;
                } else {
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
                }
              } else {
                // Single token: is it a path or a query?
                // If it contains path separators or is a known directory, treat as path.
                const includePattern =
                  parseInlineIncludePattern(firstToken) || includeFromFlag;
                if (includePattern) {
                  rawQuery = "";
                  params.path = flags.path || ".";
                  params.include = includePattern;
                } else if (
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
        }

        // Allow multi-line query appending
        toolUse.isArgBased = false;
        params.query = this.splitPipe(this.stripMatchingOuterQuotes(rawQuery));
        native.query = params.query;
        if (params.path) {
          params.path = this.stripMatchingOuterQuotes(params.path);
        }
        native.path = params.path;
        if (!params.include && includeFromFlag) {
          params.include = this.stripMatchingOuterQuotes(includeFromFlag);
        }
        if (params.include) {
          params.include = this.stripMatchingOuterQuotes(params.include);
          native.include = params.include;
        }

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
        params.query = this.stripMatchingOuterQuotes(
          flags.query || argsStr.trim(),
        );
        native.query = params.query;
        break;
      case "research": {
        params.query = this.stripMatchingOuterQuotes(
          flags.topic || flags.query || argsStr.trim(),
        );
        native.query = params.query;
        if (flags.depth) {
          params.depth = flags.depth;
          native.depth = parseInt(flags.depth);
        }
        break;
      }
      case "U":
      case "fetch": {
        const { cleanedInput: fetchArgs, present: hasIncludeLinksShortFlag } =
          extractStandaloneShortFlag(argsStr, "L");
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
        params.prompt = flags.prompt || argsStr.trim();
        native.prompt = params.prompt;
        params.instructions = params.prompt;
        native.instructions = params.prompt;
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
      case "computer_action":
        params.action = flags.action || argsStr.trim();
        native.action = params.action;
        if (flags.coordinate) {
          params.coordinate = flags.coordinate;
          native.coordinate = flags.coordinate;
        }
        if (flags.text) {
          params.text = flags.text;
          native.text = flags.text;
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
      shortName === "write"
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

      if (isEditHistoryPlaceholder(contentToProcess)) {
        toolUse.params.edit = (toolUse.params.edit || "") + contentToProcess;
        toolUse.nativeArgs.edit = toolUse.params.edit;
        return;
      }

      // A naked shared history placeholder is not a valid edit body.
      if (
        contentToProcess.trim().toLowerCase() ===
        HISTORY_CONTENT_PLACEMENT_PLACEHOLDER.toLowerCase()
      ) {
        return;
      }

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
          /\\((?:\/)(?:edit|write|edit_file|write|todo|wrap|E|W|[A-Z]))/g,
          "$1",
        );
        toolUse.nativeArgs.edit = toolUse.params.edit;
        const quotedBodyEdits = this.parseQuotedEditBodyLines(toolUse.params.edit, {
          allowTrailingPartialLine: !!toolUse.partial,
        });
        const edits =
          quotedBodyEdits !== null
            ? quotedBodyEdits
            : this.parseEditBlocks(toolUse.params.edit);
        // Propagate line range hints from the tool call header to individual blocks
        // If the header has multiple ranges, assign them sequentially
        if (toolUse.nativeArgs.ranges && toolUse.nativeArgs.ranges.length > 0) {
          edits.forEach((edit: any, idx: number) => {
            // Per-block range (SEARCH (10-20):) takes priority
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
    } else if (toolUse.name === "write" || toolUse.name === "new_rule") {
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

      if (isWriteHistoryPlaceholder(cleanContent)) {
        toolUse.params.content = (toolUse.params.content || "") + cleanContent;
        toolUse.nativeArgs.content = toolUse.params.content;
        return;
      }

      if (!toolUse.params.content) {
        // Only strip the very first leading newline that follows the tool header
        cleanContent = cleanContent.replace(/^\r?\n/, "");
      }
      // KILOCODE FIX: Remove escape backslashes from literals like \/write or \/W
      const unescapedContent = cleanContent.replace(
        /\\((?:\/)(?:edit|write|edit_file|write|todo|wrap|E|W|[A-Z]))/g,
        "$1",
      );
      toolUse.params.content =
        (toolUse.params.content || "") + unescapedContent;
      toolUse.nativeArgs.content = toolUse.params.content;
    } else if (
      toolUse.name === "todo" ||
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
    } else if (toolUse.name === "bash") {
      if (toolUse.params.stdin !== undefined) {
        toolUse.params.stdin = (toolUse.params.stdin || "") + content;
        toolUse.nativeArgs.stdin = toolUse.params.stdin;
      } else {
        // New logic: if argsStr exists, it's the CWD. Content is the command.
        if (toolUse.params.command && content.trim()) {
          // argsStr was already put in command by populateToolArgs, move it to cwd
          toolUse.params.cwd = toolUse.params.command.trim();
          toolUse.params.command = content.trim();
        } else {
          toolUse.params.command = (toolUse.params.command || "") + content;
        }
        toolUse.nativeArgs.command = toolUse.params.command;
      }
      toolUse.nativeArgs.cwd = toolUse.params.cwd;
      toolUse.nativeArgs.execution_id = toolUse.params.execution_id;
    } else if (
      toolUse.name === "web" ||
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
    } else if (toolUse.name === "agent") {
      toolUse.params.instructions =
        (toolUse.params.instructions || "") + content;
      toolUse.nativeArgs.instructions = toolUse.params.instructions;
    }
  }

  private parseEditBlocks(diffContent: string): any[] {
    // NOTE: We do NOT strip diff_N headers anymore; we parse them to extract line context.
    const normalizeLegacyInlineHeader = (
      content: string,
      aliases: string[],
      replacement: "SEARCH" | "REPLACE",
    ) => {
      const aliasPattern = aliases.join("|");
      const headerRegex = new RegExp(
        `^(\\s*)(?:${aliasPattern})(?:\\s*(?:\\[(\\d+)(?:(?:\\s*-\\s*|,\\s*)(\\d+))?\\]|\\((\\d+)(?:(?:\\s*-\\s*|,\\s*)(\\d+))?\\)|:(\\d+)(?:(?:\\s*-\\s*|,\\s*)(\\d+))?:|(\\d+)(?:(?:\\s*-\\s*|,\\s*)(\\d+))?))?:(.*)$`,
        "gim",
      );

      return content.replace(
        headerRegex,
        (
          _match: string,
          indent: string,
          bracketStart?: string,
          bracketEnd?: string,
          parenStart?: string,
          parenEnd?: string,
          colonStart?: string,
          colonEnd?: string,
          spacedStart?: string,
          spacedEnd?: string,
          inlineContent: string = "",
        ) => {
          const start =
            bracketStart || parenStart || colonStart || spacedStart;
          const end = bracketEnd || parenEnd || colonEnd || spacedEnd;
          const header = `${indent}${replacement}${start ? ` ${start}${end ? `-${end}` : ""}` : ""}:`;
          const normalizedInlineContent = inlineContent.replace(/^[ \t]/, "");
          return normalizedInlineContent
            ? `${header}\n${normalizedInlineContent}`
            : header;
        },
      );
    };

    const normalizedOldNewBlocks = normalizeLegacyInlineHeader(
      normalizeLegacyInlineHeader(
        diffContent,
        ["old", "oldText", "oldtxt", "otxt"],
        "SEARCH",
      ),
      ["new", "newText", "newtxt", "ntxt"],
      "REPLACE",
    );
    const sanitized = normalizedOldNewBlocks.replace(
      /^(\s*)(\d+(?:\s*-\s*\d+)?)\s*$/gm,
      "$1$2:",
    );
    const edits: any[] = [];

    // V4 Regex: Context-Aware Header Matching.
    // Added 'diff_\\d+' to the list of recognized headers.
    // Also updated range matching to support BOTH comma and hyphen separators: (\d+)(?:[-]|,[\t ]*)(\d+)
    // Support canonical SEARCH/REPLACE headers plus high-speed diff syntax.
    // KILOCODE MOD: Support high-speed diff syntax: "- 10-12" and "+", plus colon format "10-12:" and "REPLACE:"
    const headerRegex =
      /^\s*(?:(SEARCH|REPLACE|diff_\d+|\+)(?:(?:[\t ]*(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?))|(?=:))?(:|(?=\s*\r?\n|$))|(rm|remove|delete|-)[\t ]+(?:(?:\(?[\t ]*(\d+)(?:(?:[-]|,[\t ]*)(\d+))?[\t ]*\)?))|\b(\d+)(?:[\t ]*-[\t ]*(\d+))?:)/gim;

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
        /SEARCH/i.test(block.type) ||
        block.type === "-" ||
        block.type === "range";
      const isNew = /REPLACE/i.test(block.type) || block.type === "+";
      const isDelete = /rm|remove|delete/i.test(block.type);
      const isDiffHeaders = /diff_\d+/i.test(block.type);

      const normalizeBlock = (rawContent: string): string => {
        // KILOCODE FIX: Improved artifact stripping.
        // When we split the message by headers, the 'content' of a block
        // naturally starts with a newline (immediately after "SEARCH:\n")
        // and ends with one (immediately before "REPLACE:\n").
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

  private cleanTextContent(text: string, isFinalized: boolean = true): string {
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

    if (!isFinalized) {
      clean = this.stripTrailingPartialToolFencePrefix(clean);
      clean = this.stripTrailingPartialActionsPrefix(clean);
      clean = this.stripTrailingPartialAtToolPrefix(clean);
      clean = this.stripTrailingPartialWrapperlessCommandPrefix(clean);
    }

    clean = clean
      .split(/\r?\n/)
      .map((line) => this.unescapeEscapedTextProtocolLine(line))
      .join("\n");

    return clean.trim();
  }

  private stripTrailingPartialActionsPrefix(text: string): string {
    return text.replace(
      /(?:^|[\r\n])([ \t]*)(A|AC|ACT|ACTI|ACTIO|ACTION|ACTIONS?)$/i,
      (_match, leadingWhitespace: string) => leadingWhitespace,
    );
  }

  private stripTrailingPartialToolFencePrefix(text: string): string {
    return text.replace(
      /(?:^|[\r\n])([ \t]*)(?:`|``|```|```t|```to|```too|```tool)$/i,
      (_match, leadingWhitespace: string) => leadingWhitespace,
    );
  }

  private stripTrailingPartialAtToolPrefix(text: string): string {
    const match =
      /(?:^|[\r\n])([ \t]*)@([a-z_][a-z0-9_-]*)?(?:(?::[^\r\n]*)|(?:\s+[^\r\n]*))?$/i.exec(
        text,
      );
    if (!match) {
      return text;
    }

    const rawCommand = (match[2] ?? "").toLowerCase();
    const looksLikeRegisteredMcpPrefix =
      rawCommand.length > 0 &&
      Array.from(this.mcpToolNames.keys()).some((toolName) => {
        const normalizedToolName = toolName.toLowerCase();
        return (
          normalizedToolName.startsWith(rawCommand) ||
          rawCommand.startsWith(normalizedToolName)
        );
      });
    const looksLikeAtToolPrefix =
      rawCommand.length === 0 ||
      looksLikeRegisteredMcpPrefix ||
      UnifiedToolCallParser.ACTIONS_COMMAND_CANDIDATES.some(
        (candidate) =>
          candidate.startsWith(rawCommand) || rawCommand.startsWith(candidate),
      );

    if (!looksLikeAtToolPrefix) {
      return text;
    }

    return text.slice(0, match.index) + (match[1] ?? "");
  }

  private stripTrailingPartialWrapperlessCommandPrefix(text: string): string {
    return text.replace(
      /(?:^|[\r\n])([ \t]*)(R|RE|REA|READ|L|LI|LIS|LIST|G|GR|GRE|GREP|F|FI|FIN|FIND|S|SH|SHE|SHEL|SHELL|W|WR|WRI|WRIT|WRITE|E|ED|EDI|EDIT|A|AG|AGE|AGEN|AGENT|T|TO|TOD|TODO|WE|WEB|FE|FET|FETC|FETCH|AS|ASK)$/i,
      (_match, leadingWhitespace: string) => leadingWhitespace,
    );
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
