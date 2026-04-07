import React, { useState, useMemo } from "react";
import styled from "styled-components";
import { vscode } from "../../../utils/vscode";
import { ToolError } from "./ToolError";
import { ToolHeader } from "./ToolHeader";
import { FileIcon } from "./FileIcon";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";
import { useArtificialDelay } from "./useArtificialDelay";

interface MoveFileToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  autoApprovalEnabled?: boolean;
}

const MoveList = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const MoveItem = ({
  source,
  destination,
}: {
  source: string;
  destination: string;
}) => {
  const sourceFilename = source.split(/[\\/]/).filter(Boolean).pop() || source;
  const destFilename =
    destination.split(/[\\/]/).filter(Boolean).pop() || destination;

  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1 border-b border-vscode-editorGroup-border last:border-0 hover:bg-vscode-list-hoverBackground rounded-sm transition-colors group font-mono"
      style={{
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--codex-chat-code-font-size, 13px)",
      }}
    >
      <div
        className="flex items-center gap-1.5 cursor-pointer hover:underline text-vscode-editor-foreground"
        onClick={(e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "openFile", text: source });
        }}
      >
        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-70 group-hover:opacity-100">
          <FileIcon fileName={sourceFilename} size={12} />
          <span style={{ color: "var(--vscode-editor-foreground)" }}>
            {source}
          </span>
        </div>
      </div>

      <div
        className="relative flex items-center ml-4 cursor-pointer hover:underline text-vscode-editor-foreground"
        onClick={(e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "openFile", text: destination });
        }}
        style={{ minHeight: "24px" }}
      >
        <span className="codicon codicon-arrow-right absolute left-[-18px] top-1/2 -translate-y-1/2 text-[10px] opacity-40"></span>
        <div className="flex items-center gap-1.5 flex-shrink-0 font-bold ml-1">
          <FileIcon fileName={destFilename} size={14} />
          <span
            style={{
              color: "var(--vscode-editor-foreground)",
              lineHeight: "1",
            }}
          >
            {destination}
          </span>
        </div>
      </div>
    </div>
  );
};

export const MoveFileTool: React.FC<MoveFileToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  autoApprovalEnabled,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isRename = tool.isRename;
  const isCopy = tool.isCopy;
  const shouldDeleteSource = tool.shouldDeleteSource;

  // Content logic
  const { moves, hasItems } = useMemo(() => {
    const sources = (tool.source || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const destinations = (tool.destination || "")
      .split(",")
      .map((d: string) => d.trim())
      .filter(Boolean);

    const movePairs: { source: string; destination: string }[] = [];

    if (destinations.length === 1 && sources.length > 1) {
      // One destination (dir), multiple sources
      const destDir = destinations[0];
      sources.forEach((s: string) => {
        const filename = s.split(/[\\/]/).filter(Boolean).pop() || s;
        movePairs.push({
          source: s,
          destination:
            destDir.endsWith("/") || destDir.endsWith("\\")
              ? `${destDir}${filename}`
              : `${destDir}/${filename}`,
        });
      });
    } else {
      // 1-to-1 mapping
      sources.forEach((s: string, i: number) => {
        movePairs.push({
          source: s,
          destination: destinations[i] || destinations[0] || "",
        });
      });
    }

    return {
      moves: movePairs,
      hasItems: movePairs.length > 0,
    };
  }, [tool]);

  const isRunning = !!(!toolResult && isLastMessage);
  const showLoading = useArtificialDelay(isRunning);
  const isPermissionRequest = isRunning;

  const actionVerb = useMemo(() => {
    if (showLoading) {
      if (isCopy) return shouldDeleteSource ? "Moving" : "Copying";
      return isRename ? "Renaming" : "Moving";
    }
    const count = moves.length;
    if (isCopy) {
      if (shouldDeleteSource)
        return `Moved ${count} ${count === 1 ? "file" : "files"}`;
      return `Copied ${count} ${count === 1 ? "file" : "files"}`;
    }
    if (isRename) {
      return `Renamed ${count} ${count === 1 ? "file" : "files"}`;
    }
    return `Moved ${count} ${count === 1 ? "file" : "files"}`;
  }, [showLoading, isRename, isCopy, shouldDeleteSource, moves.length]);

  const toolName = isCopy ? "cp" : isRename ? "rename" : "mv";

  if (!hasItems && !toolResult?.is_error && !isLastMessage) {
    return null;
  }

  const toggleExpand = () => {
    if (hasItems || toolResult?.is_error) {
      setIsExpanded(!isExpanded);
    }
  };

  const canToggle = hasItems || !!toolResult?.is_error;

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName={toolName}
        actionVerb={actionVerb}
        isPermissionRequest={showLoading}
        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          {hasItems ? (
            <MoveList>
              <div className="flex flex-col max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                {moves.map((m, i: number) => (
                  <MoveItem
                    key={i}
                    source={m.source}
                    destination={m.destination}
                  />
                ))}
              </div>
            </MoveList>
          ) : !isPermissionRequest && !toolResult?.is_error ? (
            <div className="text-vscode-descriptionForeground opacity-60 italic text-xs px-1">
              No files moved.
            </div>
          ) : null}

          {toolResult?.is_error && <ToolError toolResult={toolResult} />}
        </div>
      </AnimatedAccordion>
    </div>
  );
};
