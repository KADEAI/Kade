import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatedAccordion,
  dispatchChatScrollAnchorAdjust,
} from "../common/AnimatedAccordion";

export interface ToolActivitySummaryEntry {
  id: string;
  label: string;
  filePath?: string;
  isDirectory?: boolean;
}

export interface ToolActivitySummaryData {
  summaryText: string;
  running: boolean;
  entries: ToolActivitySummaryEntry[];
}

interface ToolActivitySummaryRowProps {
  data: ToolActivitySummaryData;
  shouldAnimate?: boolean;
  children?: React.ReactNode;
}

const TOOL_ACTIVITY_REVEAL_INTERVAL_MS = 180;
const TOOL_ACTIVITY_COLLAPSE_DELAY_MS = 720;

const parseEntryLabel = (label: string) => {
  const trimmed = label.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return { actionVerb: trimmed, details: "" };
  }

  return {
    actionVerb: trimmed.slice(0, firstSpace),
    details: trimmed.slice(firstSpace + 1),
  };
};

const getEntrySignature = (entry: ToolActivitySummaryEntry) =>
  `${entry.label.replace(/\s+/g, " ").trim()}::${entry.filePath?.trim() || ""}::${entry.isDirectory ? "dir" : "file"}`;

const ToolActivitySummaryRow: React.FC<ToolActivitySummaryRowProps> = ({
  data,
  shouldAnimate,
  children,
}) => {
  const childItems = useMemo(
    () => React.Children.toArray(children),
    [children],
  );
  const [isExpanded, setIsExpanded] = useState(data.running);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wasRunningRef = useRef(data.running);
  const revealTimeoutRef = useRef<number | null>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  const autoSequenceStartedRef = useRef(false);
  const parsedSummary = useMemo(
    () => parseEntryLabel(data.summaryText),
    [data.summaryText],
  );
  const parsedEntries = useMemo(() => {
    const seenEntries = new Set<string>();
    return data.entries
      .filter((entry) => {
        const signature = getEntrySignature(entry);
        if (seenEntries.has(signature)) {
          return false;
        }
        seenEntries.add(signature);
        return true;
      })
      .slice(0, 6)
      .map((entry, index) => ({
        ...entry,
        ...parseEntryLabel(entry.label),
        renderKey: `${entry.id}-${index}-${getEntrySignature(entry)}`,
      }));
  }, [data.entries]);
  const totalItemCount = childItems.length || parsedEntries.length;
  const [visibleItemCount, setVisibleItemCount] = useState(
    shouldAnimate && data.running ? 0 : totalItemCount,
  );

  const [hasInteracted, setHasInteracted] = useState(false);

  const clearRevealTimeout = () => {
    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
  };

  const clearCollapseTimeout = () => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearRevealTimeout();
      clearCollapseTimeout();
    };
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    let rafId: number | null = null;
    const scheduleAnchorAdjust = () => {
      if (rafId !== null) {
        return;
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        dispatchChatScrollAnchorAdjust(node);
      });
    };

    const observer = new ResizeObserver(() => {
      if (!isExpanded) {
        return;
      }

      scheduleAnchorAdjust();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!shouldAnimate) {
      autoSequenceStartedRef.current = false;
      clearRevealTimeout();
      clearCollapseTimeout();
      setVisibleItemCount(totalItemCount);
      return;
    }

    if (!autoSequenceStartedRef.current && data.running) {
      autoSequenceStartedRef.current = true;
      clearRevealTimeout();
      clearCollapseTimeout();
      setVisibleItemCount(0);
      return;
    }

    if (!autoSequenceStartedRef.current) {
      setVisibleItemCount(totalItemCount);
    }
  }, [data.running, shouldAnimate, totalItemCount]);

  useEffect(() => {
    if (visibleItemCount > totalItemCount) {
      setVisibleItemCount(totalItemCount);
      return;
    }

    if (!shouldAnimate || !autoSequenceStartedRef.current) {
      return;
    }

    setIsExpanded(true);
    clearCollapseTimeout();

    if (visibleItemCount < totalItemCount) {
      clearRevealTimeout();
      revealTimeoutRef.current = window.setTimeout(() => {
        setVisibleItemCount((current) => Math.min(current + 1, totalItemCount));
      }, TOOL_ACTIVITY_REVEAL_INTERVAL_MS);
      return;
    }

    clearRevealTimeout();

    if (!data.running) {
      collapseTimeoutRef.current = window.setTimeout(() => {
        setIsExpanded(false);
      }, TOOL_ACTIVITY_COLLAPSE_DELAY_MS);
    }
  }, [data.running, shouldAnimate, totalItemCount, visibleItemCount]);

  useEffect(() => {
    if (shouldAnimate && autoSequenceStartedRef.current) {
      dispatchChatScrollAnchorAdjust();
    }
  }, [isExpanded, shouldAnimate, visibleItemCount]);

  useEffect(() => {
    if (shouldAnimate && autoSequenceStartedRef.current) {
      wasRunningRef.current = data.running;
      return;
    }

    if (data.running) {
      setIsExpanded(true);
    } else if (wasRunningRef.current && !hasInteracted) {
      setIsExpanded(false);
    }

    wasRunningRef.current = data.running;
  }, [data.running, hasInteracted]);

  return (
    <div
      ref={rootRef}
      className={
        shouldAnimate
          ? "animate-tool-entry anchored-container ml-[8px] my-[4px]"
          : "anchored-container ml-[6.9px] my-[4px]"
      }
    >
      <button
        type="button"
        onClick={() => {
          setIsExpanded((prev) => !prev);
          setHasInteracted(true);
        }}
        aria-expanded={isExpanded}
        className="group flex w-full items-center justify-start rounded-md bg-transparent px-2 py-1 text-left transition-colors hover:bg-vscode-toolbar-hoverBackground"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 max-w-full items-center gap-1.5 text-[13px] leading-tight">
            <span className="shrink-0 font-medium text-vscode-foreground/90">
              {parsedSummary.actionVerb}
            </span>
            {parsedSummary.details ? (
              <span className="min-w-0 truncate text-vscode-descriptionForeground/80 transition-colors group-hover:text-vscode-foreground">
                {parsedSummary.details}
              </span>
            ) : null}
          </span>
          {data.running ? (
            <div className="codicon codicon-loading animate-spin text-[14px] text-vscode-descriptionForeground/70" />
          ) : null}
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-1">
          {!data.running && totalItemCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-vscode-editorGroup-border/70 bg-vscode-badge-background/12 px-1.5 py-[2px] text-[10px] font-medium leading-none text-vscode-descriptionForeground/70">
              {totalItemCount} {totalItemCount === 1 ? "action" : "actions"}
            </span>
          )}
          <span
            className={`codicon codicon-chevron-right inline-flex shrink-0 text-[14px] text-vscode-descriptionForeground/50 transition-all duration-200 ease-out motion-reduce:transition-none ${
              isExpanded
                ? "rotate-90 text-vscode-foreground/70"
                : "group-hover:text-vscode-foreground/70"
            }`}
            aria-hidden="true"
          />
        </div>
      </button>
      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        {children ? (
          <div className="mt-0 ml-[2px] flex flex-col gap-[1px] overflow-hidden border-l border-vscode-editorGroup-border/80 pl-[8px]">
            {childItems.slice(0, visibleItemCount).map((child, index) => (
              <div
                key={`tool-activity-child-${index}`}
                className={
                  shouldAnimate && autoSequenceStartedRef.current
                    ? "min-w-0 overflow-hidden animate-tool-activity-sequence-item"
                    : "min-w-0 overflow-hidden"
                }
              >
                {child}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-[1px] ml-[10px] flex flex-col gap-[3px] border-l border-vscode-editorGroup-border/80 pl-[10px]">
            {parsedEntries.slice(0, visibleItemCount).map((entry) => (
              <div
                key={entry.renderKey}
                className={`truncate text-[12.5px] leading-[1.35] text-vscode-descriptionForeground/64 ${
                  shouldAnimate && autoSequenceStartedRef.current
                    ? "animate-tool-activity-sequence-item"
                    : ""
                }`}
                title={entry.label}
              >
                <span className="font-medium text-vscode-descriptionForeground/66">
                  {entry.actionVerb}
                </span>
                {entry.details ? (
                  <span className="ml-1 text-vscode-descriptionForeground/56">
                    {entry.details}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </AnimatedAccordion>
    </div>
  );
};

export default ToolActivitySummaryRow;
