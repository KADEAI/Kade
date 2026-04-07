import React, { useState, useMemo } from "react";
import styled from "styled-components";
import { vscode } from "../../../utils/vscode";
import { ToolError } from "./ToolError";
import { ToolHeader } from "./ToolHeader";
import { FileIcon } from "./FileIcon";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";
import { useArtificialDelay } from "./useArtificialDelay";
import { parseListDirContent, type DirectoryTreeItem } from "./listDirParsing";

// Recursive component to render directory tree
const DirectoryItemRenderer = ({ item }: { item: DirectoryTreeItem }) => {
  const isDir = item.isDir || (item.children && item.children.length > 0);
  const filename = item.name;

  return (
    <div style={{ paddingLeft: "0px" }}>
      <div
        className="inline-flex max-w-full items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "openFile", text: item.path });
        }}
        style={{
          fontFamily:
            "var(--vscode-editor-system-font-family, var(--vscode-font-family))",
          fontSize: "11px",
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
          <FileIcon fileName={filename} isDirectory={isDir} size={12} />
          <span
            className="truncate"
            style={{ color: "var(--vscode-editor-foreground)" }}
          >
            {filename}
          </span>
        </div>
        {item.sizeInfo && (
          <span className="text-vscode-descriptionForeground opacity-50 whitespace-nowrap ml-1">
            {item.sizeInfo}
          </span>
        )}
      </div>
      {/* Recursive Call for Children */}
      {item.children && item.children.length > 0 && (
        <div
          style={{
            paddingLeft: "12px",
            borderLeft: "1px solid var(--vscode-tree-indentGuidesStroke)",
          }}
        >
          {item.children.map((child) => (
            <DirectoryItemRenderer key={child.path} item={child} />
          ))}
        </div>
      )}
    </div>
  );
};

interface ListDirToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  compactSpacing?: boolean;
}

const DirectoryList = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

export const ListDirTool: React.FC<ListDirToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  compactSpacing,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Content logic
  const { dirPath, dirName, directoryTree, hasItems } = useMemo(() => {
    const result = toolResult || tool;
    const content =
      typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content[0]?.text || ""
          : "";

    if (!content) {
      const fullPath = tool.path || "";
      return {
        dirPath: fullPath,
        dirName: fullPath.split(/[/\\]/).filter(Boolean).pop() || fullPath,
        directoryTree: [],
        hasItems: false,
      };
    }

    const {
      dirPath: parsedDirPath,
      directoryTree,
      hasItems,
    } = parseListDirContent(content, tool.path || "");
    const fullPath = parsedDirPath || tool.path || "";
    const name = fullPath.split(/[/\\]/).filter(Boolean).pop() || fullPath;

    return {
      dirPath: fullPath,
      dirName: name,
      directoryTree,
      hasItems,
    };
  }, [tool, toolResult]);

  const isRunning = !!(!hasItems && !toolResult?.is_error && isLastMessage);
  const showLoading = useArtificialDelay(isRunning, 375);
  const status = toolResult?.is_error
    ? "error"
    : showLoading
      ? "running"
      : "complete";

  const actionVerb = useMemo(() => {
    return showLoading ? "Exploring" : "Explored";
  }, [showLoading]);

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
        toolName="list"
        actionVerb={actionVerb}
        hideToolIcon={true}
        isPermissionRequest={showLoading}
        isError={toolResult?.is_error}
        status={status}
        compactSpacing={compactSpacing}
        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
        details={
          <>
            <span
              className="inline-flex items-center truncate leading-[1.05] cursor-pointer text-[color:color-mix(in_srgb,var(--vscode-foreground)_34%,transparent)] hover:text-vscode-textLink-foreground"
              title={dirPath || tool.path}
              onClick={(e) => {
                e.stopPropagation();
                vscode.postMessage({
                  type: "openFile",
                  text: dirPath || tool.path,
                });
              }}
            >
              {dirName}
            </span>
          </>
        }
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="-mt-1 ml-1.5 border-l-2 border-vscode-editorGroup-border pl-3 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          {hasItems ? (
            <DirectoryList>
              <div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                {directoryTree.map((item) => (
                  <DirectoryItemRenderer key={item.path} item={item} />
                ))}
              </div>
            </DirectoryList>
          ) : !showLoading && !toolResult?.is_error ? (
            <div className="text-vscode-descriptionForeground opacity-60 italic text-xs px-1">
              Directory is empty.
            </div>
          ) : null}

          {toolResult?.is_error && <ToolError toolResult={toolResult} />}
        </div>
      </AnimatedAccordion>
    </div>
  );
};
