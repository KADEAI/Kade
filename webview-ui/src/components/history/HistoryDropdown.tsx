import { useExtensionState } from "../../context/ExtensionStateContext"; // kade_change
import React, { useEffect, useRef, useState } from "react";
import { useTaskSearch } from "./useTaskSearch";
import { vscode } from "@/utils/vscode";
import { HistoryItem } from "@roo-code/types";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import "./HistoryDropdown.css";

interface HistoryDropdownProps {
  onClose: () => void;
}

interface DisplayHistoryItem extends HistoryItem {
  title?: string;
  parentTaskId?: string;
  metadata?: {
    diffAdditions?: number;
    diffDeletions?: number;
  };
}

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

const HistoryDropdown: React.FC<HistoryDropdownProps> = ({ onClose }) => {
  const { activeTaskIds, currentTaskItem } = useExtensionState(); // kade_change
  const {
    tasks: fetchedTasks,
    searchQuery,
    setSearchQuery,
    setRequestedPageIndex,
    // We might want to use these later for more advanced filtering in the dropdown if needed
    data,
    // sortOption,
    // setSortOption,
    // showAllWorkspaces,
  } = useTaskSearch();

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // Infinite Scroll State
  const [allTasks, setAllTasks] = useState<HistoryItem[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSubAgentsExpanded, setIsSubAgentsExpanded] = useState(false);

  // Initial Focus
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle Infinite Scroll & Data Accumulation
  useEffect(() => {
    // Reset list when search changes
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
      // Dedup just in case
      const existingIds = new Set(prev.map((t) => t.id));
      const newTasks = fetchedTasks.filter((t) => !existingIds.has(t.id));
      return [...prev, ...newTasks];
    });
    setIsLoadingMore(false);
  }, [fetchedTasks, pageIndex]);

  // kade_change: Sync local list with current task updates (Live Heartbeat)
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

  // Keep loading pages if collapsed sections leave the list non-scrollable.
  useEffect(() => {
    if (!isLoadingMore && data && pageIndex < (data.pageCount ?? 1) - 1) {
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          const { scrollHeight, clientHeight } = scrollContainerRef.current;
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

  // Scroll active item into view when it's found in the list

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
      // Trigger load when within 50px of bottom
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

  const handleDeleteSession = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setDeleteTaskId(taskId);
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

    // If it starts with a brace or contains "errors.", it's likely a technical string being leaked.
    // Also catch 'tasks.incomplete' and 'tasks.no_messages' which show up when translations are missing.
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
    const displayItem = item as DisplayHistoryItem;
    const additions =
      item.diffAdditions ?? displayItem.metadata?.diffAdditions ?? 0;
    const deletions =
      item.diffDeletions ?? displayItem.metadata?.diffDeletions ?? 0;

    if (additions === 0 && deletions === 0) {
      return null;
    }

    return { additions, deletions };
  };

  const getItemTitle = (item: HistoryItem) => {
    const displayItem = item as DisplayHistoryItem;
    return getTaskTitle(item.task || displayItem.title || "");
  };

  const isSubAgentTask = (item: HistoryItem) => {
    const displayItem = item as DisplayHistoryItem;
    return (
      getItemTitle(item).includes("[Sub Agent]") || !!displayItem.parentTaskId
    );
  };

  const isTaskLive = (item: HistoryItem) =>
    !!activeTaskIds?.includes(item.id) &&
    typeof item.ts === "number" &&
    Date.now() - item.ts < 6000;

  const subAgentTasks = allTasks.filter(isSubAgentTask);

  const regularTasks = allTasks.filter((item) => !isSubAgentTask(item));

  const renderTaskItem = (item: HistoryItem, isSubAgent: boolean = false) => {
    const isActive = item.id === currentTaskItem?.id;
    const isLive = isTaskLive(item);
    const title = getItemTitle(item);
    const diffTotals = getTaskDiffTotals(item);

    return (
      <div
        key={item.id}
        className={[
          "session-item",
          isActive ? "active" : "",
          isSubAgent ? "is-sub-agent" : "",
          isLive ? "is-live" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => handleSelectSession(item.id)}
        title={title}
      >
        <div className="item-left">
          <div className="item-status-badge">
            {isLive ? (
              <span className="codicon codicon-loading codicon-modifier-spin status-icon status-icon-live"></span>
            ) : (
              <span className="codicon codicon-check-all status-icon"></span>
            )}
          </div>
        </div>
        <div className="item-center">
          <div className="item-title-row">
            <div
              className={`item-title ${isSubAgent ? "sub-agent-item-title" : ""}`}
            >
              {title}
            </div>
            {isSubAgent && <span className="item-tag">Sub-agent</span>}
          </div>
          <div className="item-secondary-row">
            <div className="item-path">
              {item.workspace || "Unknown workspace"}
            </div>
            {diffTotals && (
              <div className="item-inline-diffs">
                {diffTotals.additions > 0 && (
                  <span className="item-diff item-diff-add">
                    +{diffTotals.additions}
                  </span>
                )}
                {diffTotals.deletions > 0 && (
                  <span className="item-diff item-diff-remove">
                    -{diffTotals.deletions}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="item-right">
          <div className="item-meta">
            <div className="item-time">{formatRelativeTime(item.ts)}</div>
          </div>
          <div className="item-actions">
            <button
              className="action-btn delete-btn"
              onClick={(e) => handleDeleteSession(e, item.id)}
              aria-label="Delete session"
            >
              <span className="codicon codicon-trash"></span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="history-dropdown-backdrop" onClick={onClose}>
      <div
        className="history-dropdown-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dropdown-search">
          <span className="codicon codicon-search"></span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search"
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="filter-text">All Conversations</span>
        </div>

        <div className="list-wrapper">
          <div
            className="session-list custom-scroll-container"
            ref={scrollContainerRef}
            onScroll={handleScroll}
          >
            {allTasks.length === 0 && !isLoadingMore ? (
              <div className="empty-state">
                <span>No sessions found</span>
              </div>
            ) : (
              <>
                {subAgentTasks.length > 0 && (
                  <div className="sub-agents-section">
                    <div
                      className="sub-agents-header"
                      onClick={() => setIsSubAgentsExpanded((value) => !value)}
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
        </div>
      </div>
      {deleteTaskId && (
        <DeleteTaskDialog
          taskId={deleteTaskId}
          open={!!deleteTaskId}
          onOpenChange={(open) => !open && setDeleteTaskId(null)}
        />
      )}
    </div>
  );
};

export default HistoryDropdown;
