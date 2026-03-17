import { useExtensionState } from "../../context/ExtensionStateContext"; // kade_change
import React, { useEffect, useRef, useState } from 'react';
import { useTaskSearch } from './useTaskSearch';
import { vscode } from '@/utils/vscode';
import { useAppTranslation } from '@/i18n/TranslationContext';
import { formatDistanceToNow } from 'date-fns';
import { HistoryItem } from "@roo-code/types";
import { DeleteTaskDialog } from './DeleteTaskDialog';
import './HistoryDropdown.css';

interface HistoryDropdownProps {
    onClose: () => void;
}



const HistoryDropdown: React.FC<HistoryDropdownProps> = ({ onClose }) => {
    const { t } = useAppTranslation();
    const { activeTaskIds, currentTaskItem } = useExtensionState(); // kade_change
    const {
        tasks: fetchedTasks,
        searchQuery,
        setSearchQuery,
        setRequestedPageIndex,
        // We might want to use these later for more advanced filtering in the dropdown if needed
        data
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

    // Initial Focus
    useEffect(() => {
        if (searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, []);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
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

        setAllTasks(prev => {
            if (pageIndex === 0) {
                return fetchedTasks;
            }
            // Dedup just in case
            const existingIds = new Set(prev.map(t => t.id));
            const newTasks = fetchedTasks.filter(t => !existingIds.has(t.id));
            return [...prev, ...newTasks];
        });
        setIsLoadingMore(false);
    }, [fetchedTasks, pageIndex]);

    // kade_change: Sync local list with current task updates (Live Heartbeat)
    useEffect(() => {
        if (!currentTaskItem) return;
        setAllTasks(prev => prev.map(task =>
            task.id === currentTaskItem.id
                ? { ...task, task: currentTaskItem.task }
                : task
        ));
    }, [currentTaskItem?.task, currentTaskItem?.id]);

    // Scroll active item into view when it's found in the list

    const handleScroll = () => {
        if (scrollContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
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
        if (!ts) return '';
        try {
            const diff = Math.floor((Date.now() - ts) / 1000);
            if (diff < 60) return 'Now';
            return formatDistanceToNow(new Date(ts), { addSuffix: true });
        } catch (e) {
            return '';
        }
    };

    const getTaskTitle = (task: string) => {
        if (!task) return 'New Chat';

        // If it starts with a brace or contains "errors.", it's likely a technical string being leaked.
        // Also catch 'tasks.incomplete' and 'tasks.no_messages' which show up when translations are missing.
        if (
            task.trim().startsWith('{') ||
            task.includes('errors.') ||
            task.includes('tasks.incomplete') ||
            task.includes('tasks.no_messages')
        ) {
            return 'Incomplete Chat';
        }

        return task;
    };

    return (
        <div className="history-dropdown-backdrop" onClick={onClose}>
            <div className="history-dropdown-container" onClick={(e) => e.stopPropagation()}>
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
                                {allTasks.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`session-item ${item.id === currentTaskItem?.id ? 'active' : ''}`}
                                        onClick={() => handleSelectSession(item.id)}
                                    >
                                        <div className="item-left">
                                            {activeTaskIds?.includes(item.id) && (Date.now() - item.ts < 6000) ? (
                                                <span className="codicon codicon-loading codicon-modifier-spin" style={{ color: "var(--vscode-textLink-foreground)" }}></span>
                                            ) : (
                                                <span className="codicon codicon-check status-icon"></span>
                                            )}
                                        </div>
                                        <div className="item-center">
                                            <div className="item-title">{getTaskTitle(item.task || (item as any).title)}</div>
                                            <div className="item-path">{item.workspace || 'Unknown workspace'}</div>
                                        </div>
                                        <div className="item-right">
                                            <div className="item-time">{formatRelativeTime(item.ts)}</div>
                                            <div className="item-actions">
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={(e) => handleDeleteSession(e, item.id)}
                                                >
                                                    <span className="codicon codicon-trash"></span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoadingMore && (
                                    <div className="p-2 text-center text-xs text-gray-500">
                                        Loading more...
                                    </div>
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
