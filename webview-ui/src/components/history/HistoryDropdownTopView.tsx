import { useExtensionState } from "../../context/ExtensionStateContext";
import React, { useState, useEffect, useRef } from "react";
import { vscode } from "../../utils/vscode";
import { useTaskSearch } from "./useTaskSearch";
import { HistoryItem } from "@roo-code/types";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import "./HistoryDropdownTopView.css";

function formatRelativeShortTime(input?: number | string | Date): string {
  if (input === undefined || input === null) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diff < 6) return "spinner";
  if (diff < 60) return "Now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface HistoryDropdownProps {
  onClose: () => void;
}

const HistoryDropdownTopView: React.FC<HistoryDropdownProps> = ({
  onClose,
}) => {
  const { activeTaskIds, currentTaskItem } = useExtensionState();
  const {
    tasks: fetchedTasks,
    searchQuery,
    setSearchQuery,
    setRequestedPageIndex,
    data,
  } = useTaskSearch();

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  const [allTasks, setAllTasks] = useState<HistoryItem[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSubAgentsExpanded, setIsSubAgentsExpanded] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setPageIndex(0);
    setRequestedPageIndex(0);
    setAllTasks([]);
    setIsLoadingMore(false);
  }, [searchQuery, setRequestedPageIndex]);

  useEffect(() => {
    if (!fetchedTasks) return;

    setAllTasks((prev) => {
      if (pageIndex === 0) {
        return fetchedTasks;
      }
      const existingIds = new Set(prev.map((t) => t.id));
      const newTasks = fetchedTasks.filter((t) => !existingIds.has(t.id));
      return [...prev, ...newTasks];
    });
    setIsLoadingMore(false);
  }, [fetchedTasks, pageIndex]);

  useEffect(() => {
    if (!currentTaskItem) return;
    setAllTasks((prev) =>
      prev.map((task) =>
        task.id === currentTaskItem.id
          ? { ...task, task: currentTaskItem.task }
          : task,
      ),
    );
  }, [currentTaskItem]);

  // Auto-load more tasks if the current view isn't scrollable but more pages exist.
  // This is crucial when many items are filtered/hidden (like collapsed sub-agents),
  // which otherwise prevents the user from scrolling to trigger the next page fetch.
  useEffect(() => {
    if (!isLoadingMore && data && pageIndex < (data.pageCount ?? 1) - 1) {
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          const { scrollHeight, clientHeight } = scrollContainerRef.current;
          // If content doesn't fill the container (or barely does), load more to ensure scrollability
          if (scrollHeight > 0 && scrollHeight <= clientHeight + 50) {
            setIsLoadingMore(true);
            const nextPage = pageIndex + 1;
            setPageIndex(nextPage);
            setRequestedPageIndex(nextPage);
          }
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [
    allTasks,
    isSubAgentsExpanded,
    isLoadingMore,
    data,
    pageIndex,
    setRequestedPageIndex,
  ]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
      if (scrollTop + clientHeight >= scrollHeight - 50 && !isLoadingMore) {
        const totalPages = data?.pageCount ?? 1;
        if (pageIndex < totalPages - 1) {
          setIsLoadingMore(true);
          const nextPage = pageIndex + 1;
          setPageIndex(nextPage);
          setRequestedPageIndex(nextPage);
        }
      }
    }
  };

  const handleSelectSession = (taskId: string) => {
    vscode.postMessage({ type: "showTaskWithId", text: taskId });
    onClose();
  };

  const formatRelativeTime = (ts?: number) => {
    if (!ts) return "";
    try {
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 60) return "Now";
      return formatRelativeShortTime(ts);
    } catch (e) {
      return "";
    }
  };

  const getTaskTitle = (task: string) => {
    if (!task) return "New Chat";

    if (
      task.trim().startsWith("{") ||
      task.includes("errors.") ||
      task.includes("tasks.incomplete") ||
      task.includes("tasks.no_messages")
    ) {
      return "Incomplete Chat";
    }

    return task;
  };

  const getTaskDiffTotals = (item: HistoryItem) => {
    const additions = item.diffAdditions ?? 0;
    const deletions = item.diffDeletions ?? 0;

    if (additions === 0 && deletions === 0) {
      return null;
    }

    return { additions, deletions };
  };

  const isTaskLive = (item: HistoryItem) =>
    !!activeTaskIds?.includes(item.id) &&
    typeof item.ts === "number" &&
    Date.now() - item.ts < 6000;

  const subAgentTasks = allTasks.filter(
    (item) =>
      (item.task || (item as any).title || "").includes("[Sub Agent]") ||
      (item as any).parentTaskId,
  );

  const regularTasks = allTasks.filter(
    (item) =>
      !(item.task || (item as any).title || "").includes("[Sub Agent]") &&
      !(item as any).parentTaskId,
  );

  const renderTaskItem = (item: HistoryItem, isSubAgent: boolean = false) => {
    const isActive = item.id === currentTaskItem?.id;
    const isLive = isTaskLive(item);
    const title = getTaskTitle(item.task || (item as any).title);
    const diffTotals = getTaskDiffTotals(item);

    return (
      <div
        key={item.id}
        className={[
          "compact-session-item",
          isActive ? "active" : "",
          isSubAgent ? "is-sub-agent" : "",
          isLive ? "is-live" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => handleSelectSession(item.id)}
        title={title}
      >
        <div className="compact-item-left">
          <div className="compact-status-badge">
            {isLive ? (
              <span className="codicon codicon-loading codicon-modifier-spin status-icon-compact status-icon-live"></span>
            ) : (
              <span className="codicon codicon-check-all status-icon-compact"></span>
            )}
          </div>
        </div>
        <div className="compact-item-content">
          <div className="compact-item-title-row">
            <div
              className={`compact-item-title ${isSubAgent ? "sub-agent-item-title" : ""}`}
            >
              {title}
            </div>
            {isSubAgent && <span className="compact-item-tag">Sub-agent</span>}
          </div>
        </div>
        <div className="compact-item-right">
          <div className="compact-item-meta">
            {diffTotals && (
              <div className="compact-item-diffs">
                {diffTotals.additions > 0 && (
                  <span className="compact-item-diff compact-item-diff-add">
                    +{diffTotals.additions}
                  </span>
                )}
                {diffTotals.deletions > 0 && (
                  <span className="compact-item-diff compact-item-diff-remove">
                    -{diffTotals.deletions}
                  </span>
                )}
              </div>
            )}
            <div className="compact-item-time">
              {formatRelativeTime(item.ts)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="history-top-view-container"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: "calc(100% - 28px)",
        margin: "0px 11px 11px",
        height: "260px",
        boxSizing: "border-box",
      }}
    >
      <div className="top-view-header">
        <div className="header-search">
          <span className="codicon codicon-search"></span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search"
            className="header-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="header-workspace-label">Current Workspace</div>
        </div>
      </div>

      <div
        className="top-view-list custom-scroll-container"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {allTasks.length === 0 && !isLoadingMore ? (
          <div className="empty-state-compact">
            <span>No sessions found</span>
          </div>
        ) : (
          <>
            {subAgentTasks.length > 0 && (
              <div className="sub-agents-section">
                <div
                  className="sub-agents-header sticky-header"
                  onClick={() => setIsSubAgentsExpanded(!isSubAgentsExpanded)}
                >
                  <div className="sub-agents-header-main">
                    <span
                      className={`codicon codicon-chevron-${isSubAgentsExpanded ? "down" : "right"}`}
                    ></span>
                    <span className="sub-agents-header-label">
                      Sub Agent Chats
                    </span>
                  </div>
                  <span className="sub-agents-header-count">
                    {subAgentTasks.length}
                  </span>
                </div>
                {isSubAgentsExpanded &&
                  subAgentTasks.map((item) => renderTaskItem(item, true))}
              </div>
            )}
            {regularTasks.length > 0 && (
              <div className="regular-tasks-section">
                {regularTasks.map((item) => renderTaskItem(item, false))}
              </div>
            )}
            {isLoadingMore && (
              <div className="history-loading-state">Loading...</div>
            )}
          </>
        )}
      </div>

      {deleteTaskId && (
        <DeleteTaskDialog
          taskId={deleteTaskId}
          onOpenChange={(open) => !open && setDeleteTaskId(null)}
          open
        />
      )}
    </div>
  );
};

export default HistoryDropdownTopView;
