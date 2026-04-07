import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { vscode } from "@/utils/vscode";

import { ToolError } from "./ToolError";
import { FileIcon } from "./FileIcon";
import { ToolHeader } from "./ToolHeader";
import { useArtificialDelay } from "./useArtificialDelay";
import { formatToolActivitySearchTarget } from "../toolActivityTargetFormatting";

interface GrepToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  compactSpacing?: boolean;
}

import { AnimatedAccordion } from "../../common/AnimatedAccordion";

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

const MatchHighlight = styled.mark`
  color: var(--vscode-textLink-foreground);
  background: color-mix(
    in srgb,
    var(--vscode-textLink-foreground) 18%,
    transparent
  );
  border-radius: 4px;
  padding: 0 3px;
  font-weight: 600;
`;

const GREP_MATCH_MARKER_REGEX = /->.*?<-|→.*?←/g;

function renderHighlightedLabel(text: string) {
  GREP_MATCH_MARKER_REGEX.lastIndex = 0;
  const matches = Array.from(text.matchAll(GREP_MATCH_MARKER_REGEX));

  if (matches.length === 0) {
    return text;
  }

  const segments: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const matchText = match[0];
    const startIndex = match.index ?? 0;

    if (startIndex > lastIndex) {
      segments.push(
        <span key={`text-${index}-${lastIndex}`}>
          {text.slice(lastIndex, startIndex)}
        </span>,
      );
    }

    segments.push(
      <MatchHighlight key={`match-${index}-${startIndex}`}>
        {matchText}
      </MatchHighlight>,
    );

    lastIndex = startIndex + matchText.length;
  });

  if (lastIndex < text.length) {
    segments.push(
      <span key={`tail-${lastIndex}`}>{text.slice(lastIndex)}</span>,
    );
  }

  return <>{segments}</>;
}

export const GrepTool: React.FC<GrepToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  compactSpacing,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Search Params
  const pattern = useMemo(() => tool.regex || tool.pattern || "", [tool]);
  const cleanPath = (p: string) => {
    if (!p) return "";
    // Remove surrounding brackets if they wrap the entire path (e.g. "[lines.txt]")
    // logic: starts with [, ends with ], and doesn't look like a standard nextjs dynamic route (which usually ends in file extension)
    // actually, simpler heuristic: if it starts with [ and ends with ], strip them.
    // We'll trust that files named exactly "[something]" are rare enough compared to the bug.
    if (p.startsWith("[") && p.endsWith("]")) {
      return p.slice(1, -1);
    }
    const normalized = p.trim();
    // Partial tool payloads sometimes leak the separator token itself as the path.
    if (normalized.toLowerCase() === "in") {
      return "";
    }
    return normalized;
  };
  const searchPath = useMemo(() => cleanPath(tool.path || ""), [tool]);

  const content = useMemo(() => {
    return typeof toolResult?.content === "string"
      ? toolResult.content
      : Array.isArray(toolResult?.content)
        ? toolResult.content[0]?.text || ""
        : "";
  }, [toolResult]);

  const resultFiles = useMemo(() => {
    if (!content) return [];

    const lines = content.split("\n").filter((line: string) => line.trim());

    // State for tracking "current" file in a grouped list
    let currentFilePath = searchPath;

    return lines
      .map((line: string) => {
        const trimmed = line.trim();

        // Skip ellipsis lines (e.g., "..." or "  ...")
        if (/^\.{3,}$/.test(trimmed)) {
          return null;
        }

        // 1. Try to match standard path:line:content (fallback)
        const fullMatch = trimmed.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):?(.*)$/);
        if (fullMatch) {
          currentFilePath = cleanPath(fullMatch[1]);
          return {
            path: currentFilePath,
            startLine: parseInt(fullMatch[2]),
            label: fullMatch[3] || line,
            fullLine: line,
          };
        }

        // 2. Try to match line headers in grouped output (e.g., "  10: content")
        const lineMatch = trimmed.match(/^(\d+):?(.*)$/);
        if (lineMatch) {
          return {
            path: currentFilePath,
            startLine: parseInt(lineMatch[1]),
            label: lineMatch[2] || line,
            fullLine: line,
          };
        }

        // 3. Otherwise, treat it as a new file header
        // Strip markdown header (##) and line count (|L###) from file paths
        let headerPath = trimmed;
        if (headerPath.startsWith("##")) {
          headerPath = headerPath.slice(2).trim();
        }
        if (headerPath.includes("|L")) {
          headerPath = headerPath.split("|L")[0].trim();
        }
        currentFilePath = cleanPath(headerPath);
        return {
          path: currentFilePath,
          label: line,
          fullLine: line,
          isHeader: true,
        };
      })
      .filter((item: any) => item !== null && !item.isHeader); // Filter out null (ellipsis) and headers
  }, [content, searchPath]);

  const hasResults = resultFiles.length > 0;
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
  const isRunning = !!(!content && isLastMessage && !toolResult?.is_error);
  const showLoading = useArtificialDelay(isRunning);
  const status = toolResult?.is_error
    ? "error"
    : showLoading
      ? "running"
      : "complete";

  const actionVerb = useMemo(() => {
    return showLoading ? "Grepping" : "Grepped";
  }, [showLoading]);

  const toggleExpand = () => {
    if (content || toolResult?.is_error) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleFileClick = (path: string, line?: number) => {
    vscode.postMessage({
      type: "openFile",
      text: path,
      values: {
        line: line,
      },
    });
  };

  const canToggle = !!content || !!toolResult?.is_error;

  if (!showLoading && !canToggle) {
    return null;
  }

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName="grep"
        actionVerb={actionVerb}
        isPermissionRequest={showLoading}
        isError={toolResult?.is_error}
        status={status}
        compactSpacing={compactSpacing}
        hideCompleteIcon

        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
        details={detailsContent}
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="-mt-1 ml-0.5 border-l-2 border-vscode-editorGroup-border pl-2 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          {/* Results header removed for clean look */}

          {hasResults ? (
            <ResultsList>
              <div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                {resultFiles.map((item: any, index: number) => {
                  const filename = item.path.split(/[/\\]/).pop();

                  return (
                    <div
                      key={index}
                      className="inline-flex max-w-full items-center gap-2 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline"
                      style={{
                        fontSize: "11px",
                        fontFamily:
                          "var(--vscode-editor-system-font-family, var(--vscode-font-family))",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileClick(item.path, item.startLine);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
                        <FileIcon fileName={item.path} size={16} />
                        <span
                          className="truncate"
                          style={{ color: "var(--vscode-editor-foreground)" }}
                        >
                          {filename}
                        </span>
                      </div>

                      {item.startLine && (
                        <span className="text-vscode-descriptionForeground opacity-60 text-[11px] whitespace-nowrap">
                          :{item.startLine}
                        </span>
                      )}

                      <span className="min-w-0 text-vscode-descriptionForeground opacity-80 whitespace-pre ml-1 truncate">
                        {renderHighlightedLabel(item.label)}
                      </span>
                    </div>
                  );
                })}
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
