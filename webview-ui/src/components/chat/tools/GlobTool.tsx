import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { vscode } from "@/utils/vscode";
import { ToolError } from "./ToolError";
import { FileIcon } from "./FileIcon";
import { ToolHeader } from "./ToolHeader";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";
import { useArtificialDelay } from "./useArtificialDelay";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatToolActivitySearchTarget } from "../toolActivityTargetFormatting";

interface GlobToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  compactSpacing?: boolean;
}

const ResultsList = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const NoResults = styled.div`
  padding: 4px 8px;
  opacity: 0.6;
  font-style: italic;
  font-size: 11px;
`;

// --- Tree Data Structure ---
interface TreeNode {
  name: string;
  path: string;
  children: Record<string, TreeNode>;
  isDirectory: boolean;
  sizeInfo?: string;
}

const GLOB_RESULT_SUMMARY_REGEX =
  /^Found \d+ results? matching pattern\b.*:?$/i;

const isGlobMetadataLine = (line: string) => {
  if (!line) return true;
  if (line.match(/^Found \d+ files?$/i)) return true;
  if (GLOB_RESULT_SUMMARY_REGEX.test(line)) return true;
  if (line.startsWith("Total files:")) return true;
  if (line.startsWith("(file_name|L = line count)")) return true;
  if (line.match(/^#{1,6}\s+/)) return true;
  return false;
};

// --- Path to Tree Conversion ---
const buildFileTree = (
  items: { path: string; sizeInfo?: string }[],
): Record<string, TreeNode> => {
  const root: Record<string, TreeNode> = {};

  items.forEach((item) => {
    const { path: fullItemPath, sizeInfo } = item;
    // Normalize path separators for consistency
    const parts = fullItemPath.replace(/\\/g, "/").split("/");
    let currentLevel = root;

    parts.forEach((part, index) => {
      if (!part) return; // Skip empty parts (e.g., from trailing slashes)

      const isDirectory =
        index < parts.length - 1 || fullItemPath.endsWith("/");
      const fullPath = parts.slice(0, index + 1).join("/");

      if (!currentLevel[part]) {
        currentLevel[part] = {
          name: part,
          path: fullPath,
          children: {},
          isDirectory: isDirectory,
        };
      }

      // Assign sizeInfo only to the leaf file node
      if (index === parts.length - 1 && !isDirectory) {
        currentLevel[part].sizeInfo = sizeInfo;
      }

      currentLevel = currentLevel[part].children;
    });
  });

  return root;
};

// --- Recursive File Tree Component ---
const FileTree: React.FC<{
  node: Record<string, TreeNode>;
  level?: number;
}> = ({ node, level = 0 }) => {
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});

  const handleFileClick = (path: string, isDirectory: boolean) => {
    if (isDirectory) {
      setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }));
    } else {
      vscode.postMessage({
        type: "openFile",
        text: path,
      });
    }
  };

  const sortedKeys = Object.keys(node).sort((a, b) => {
    const aIsDirectory = node[a].isDirectory;
    const bIsDirectory = node[b].isDirectory;
    if (aIsDirectory !== bIsDirectory) {
      return aIsDirectory ? -1 : 1;
    }
    return a.localeCompare(b);
  });

  return (
    <>
      {sortedKeys.map((key) => {
        const child = node[key];
        const isExpanded = expandedFolders[child.path];
        const hasChildren = Object.keys(child.children).length > 0;

        return (
          <div key={child.path}>
            <div
              className="inline-flex max-w-full items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline"
              style={{
                fontSize: "11px",
                paddingLeft: `${level * 12 + 4}px`,
                fontFamily:
                  "var(--vscode-editor-system-font-family, var(--vscode-font-family))",
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleFileClick(child.path, child.isDirectory);
              }}
            >
              <div className="flex min-w-0 items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
                {child.isDirectory ? (
                  isExpanded || !hasChildren ? (
                    <ChevronDown size={12} className="opacity-70" />
                  ) : (
                    <ChevronRight size={12} className="opacity-70" />
                  )
                ) : (
                  <div className="w-3 flex-shrink-0" />
                )}
                <FileIcon
                  fileName={child.path}
                  isDirectory={child.isDirectory}
                  size={16}
                />
                <span
                  className="truncate"
                  style={{ color: "var(--vscode-editor-foreground)" }}
                >
                  {child.name}
                </span>
                {child.sizeInfo && (
                  <span className="text-vscode-descriptionForeground opacity-50 whitespace-nowrap ml-1 text-[11px]">
                    {child.sizeInfo}
                  </span>
                )}
              </div>
            </div>
            {(isExpanded || !hasChildren) && hasChildren && (
              <FileTree node={child.children} level={level + 1} />
            )}
          </div>
        );
      })}
    </>
  );
};

export const GlobTool: React.FC<GlobToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  compactSpacing,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const cleanPath = (path: string) => {
    const normalized = path.trim();
    if (normalized.toLowerCase() === "in") {
      return "";
    }
    return normalized;
  };

  const pattern = useMemo(
    () => tool.pattern || tool.params?.pattern || "",
    [tool],
  );
  const searchPath = useMemo(
    () => cleanPath(tool.path || tool.params?.path || ""),
    [tool],
  );

  const content = useMemo(() => {
    return typeof toolResult?.content === "string"
      ? toolResult.content
      : Array.isArray(toolResult?.content)
        ? toolResult.content[0]?.text || ""
        : "";
  }, [toolResult]);

  const resultFiles = useMemo(() => {
    if (!content) return [];
    const lines = content.split("\n");
    return lines
      .filter((line: string) => {
        const trimmed = line.trim();
        return !isGlobMetadataLine(trimmed);
      })
      .map((line: string) => {
        // Matches: "filename" or "filename|L123" or "filename (123 lines)"
        const match = line
          .trim()
          .match(
            /^(.*?)(?:\|L(\d+)| \(([\d.]+\s+(?:lines?|bytes?|KB|MB|GB|files?))\))?$/i,
          );
        const pathOnly = (match ? match[1] : line).trim();
        let sizeInfo = "";
        if (match) {
          if (match[2]) {
            sizeInfo = `L${match[2]}`;
          } else if (match[3]) {
            sizeInfo = match[3];
          }
        }
        return { path: pathOnly, sizeInfo };
      });
  }, [content]);

  const fileTree = useMemo(() => buildFileTree(resultFiles), [resultFiles]);

  const hasResults = resultFiles.length > 0;
  const isRunning = !!(!content && isLastMessage && !toolResult?.is_error);
  const showLoading = useArtificialDelay(isRunning);
  const status = toolResult?.is_error
    ? "error"
    : showLoading
      ? "running"
      : "complete";

  const actionVerb = showLoading ? "Searching" : "Searched";

  const detailsLabel = useMemo(() => {
    const normalizedPattern = formatToolActivitySearchTarget(pattern, "");
    if (normalizedPattern) {
      return normalizedPattern;
    }
    return searchPath.trim();
  }, [pattern, searchPath]);

  const detailsContent = useMemo(
    () => <span>{detailsLabel}</span>,
    [detailsLabel],
  );

  const toggleExpand = () => {
    if (content || toolResult?.is_error) {
      setIsExpanded(!isExpanded);
    }
  };

  const canToggle = !!content || !!toolResult?.is_error;

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName="glob"
        actionVerb={actionVerb}
        isPermissionRequest={showLoading}
        isError={toolResult?.is_error}
        status={status}
        compactSpacing={compactSpacing}
        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
        details={detailsContent}
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="-mt-1 ml-1 border-l-2 border-vscode-editorGroup-border pl-2.5 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          {hasResults ? (
            <ResultsList>
              <div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                <FileTree node={fileTree} />
              </div>
            </ResultsList>
          ) : !showLoading && !toolResult?.is_error ? (
            <NoResults>No matching results found.</NoResults>
          ) : null}

          {toolResult?.is_error && <ToolError toolResult={toolResult} />}
        </div>
      </AnimatedAccordion>
    </div>
  );
};
