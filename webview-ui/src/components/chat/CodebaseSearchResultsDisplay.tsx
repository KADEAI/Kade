import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { vscode } from "@/utils/vscode";
import { ToolHeader } from "./tools/ToolHeader";
import { AnimatedAccordion } from "../common/AnimatedAccordion";
import { FileIcon } from "./tools/FileIcon";

interface CodebaseSearchResultsDisplayProps {
  results: Array<{
    filePath: string;
    score: number;
    startLine: number;
    endLine: number;
    codeChunk: string;
    query?: string;
  }>;
  isComplete?: boolean;
}

const CodebaseSearchResultsDisplay: React.FC<
  CodebaseSearchResultsDisplayProps
> = ({ results, isComplete = true }) => {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);

  const groupedResults = useMemo(() => {
    const groups: Record<string, typeof results> = {};
    results.forEach((r) => {
      const q = r.query || "Search Results";
      if (!groups[q]) groups[q] = [];
      groups[q].push(r);
    });
    return groups;
  }, [results]);

  const queries = Object.keys(groupedResults);
  const [activeQuery, setActiveQuery] = useState(queries[0] || "");

  const handleFileClick = (path: string, line?: number) => {
    vscode.postMessage({
      type: "openFile",
      text: path,
      values: {
        line: line,
      },
    });
  };

  if (results.length === 0) {
    return (
      <div className="p-4 opacity-60 italic text-[11px] antialiased">
        {t("chat:codebaseSearch.noResults", "No relevant code snippets found.")}
      </div>
    );
  }

  return (
    <div className="-ml-0.5">
      <ToolHeader
        toolName="ask"
        actionVerb={
          isComplete
            ? t("chat:codebaseSearch.asked", "Asked")
            : t("chat:codebaseSearch.asking", "Asking")
        }
        hideCompleteIcon
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        isPermissionRequest={!isComplete}
        details={
          <div className="flex items-center min-w-0 flex-1 pr-4">
            <span className="truncate antialiased flex-1">
              {(
                activeQuery ||
                t("chat:codebaseSearch.semanticSearch", "semantic search")
              ).replace(/\?+$/, "")}
            </span>
            <span
              className="antialiased flex-shrink-0"
              style={{
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
                display: "inline-block",
              }}
            >
              ?
            </span>
          </div>
        }
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div className="mt-1 ml-2 border-l border-vscode-tree-indentGuidesStroke pl-3 text-[13px] leading-normal font-sans">
          {queries.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-3 mt-1">
              {queries.map((q) => (
                <button
                  key={q}
                  onClick={() => setActiveQuery(q)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                    activeQuery === q
                      ? "bg-vscode-button-background text-vscode-button-foreground border-transparent"
                      : "bg-vscode-welcomePage-tileHoverBackground border-vscode-widget-border text-vscode-descriptionForeground hover:text-vscode-foreground"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            {groupedResults[activeQuery || queries[0]]?.map((result, idx) => {
              const filename = result.filePath.split(/[/\\]/).pop();
              return (
                <div
                  key={`${activeQuery}-${idx}`}
                  className="flex flex-col gap-0.5 group/result py-1 px-1 rounded hover:bg-vscode-list-hoverBackground cursor-pointer"
                  onClick={() =>
                    handleFileClick(result.filePath, result.startLine)
                  }
                >
                  <div className="flex items-center gap-2 text-[12px] font-mono">
                    <div className="flex items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
                      <FileIcon fileName={filename || ""} size={14} />
                      <span className="font-semibold">{filename}</span>
                    </div>
                    <span className="text-vscode-descriptionForeground opacity-60">
                      :{result.startLine}
                    </span>
                    <span className="text-[10px] opacity-40 truncate">
                      {result.filePath}
                    </span>
                    <span className="text-[10px] opacity-40 ml-auto mr-2">
                      {Math.round(result.score * 100)}%
                    </span>
                  </div>
                  <div className="text-vscode-descriptionForeground opacity-80 text-[11px] font-mono line-clamp-2 pl-5">
                    {result.codeChunk.trim().split("\n")[0]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedAccordion>
    </div>
  );
};

export default CodebaseSearchResultsDisplay;
