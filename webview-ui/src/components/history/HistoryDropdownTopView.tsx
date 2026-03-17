import { useExtensionState } from "../../context/ExtensionStateContext"; 
import React, { useState, useEffect, useRef } from 'react';
import { vscode } from '../../utils/vscode';
import { useTaskSearch } from './useTaskSearch';
import { HistoryItem } from "@roo-code/types";
import { DeleteTaskDialog } from './DeleteTaskDialog';
import './HistoryDropdownTopView.css';

function formatRelativeShortTime(input?: number | string | Date): string {
    if (input === undefined || input === null) return '';
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);

    if (diff < 6) return 'spinner';
    if (diff < 60) return 'Now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

interface HistoryDropdownProps {
    onClose: () => void;
}

const HistoryDropdownTopView: React.FC<HistoryDropdownProps> = ({ onClose }) => {
    const { activeTaskIds, currentTaskItem } = useExtensionState();
    const {
        tasks: fetchedTasks,
        searchQuery,
        setSearchQuery,
        setRequestedPageIndex,
        data
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
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
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
            const existingIds = new Set(prev.map(t => t.id));
            const newTasks = fetchedTasks.filter(t => !existingIds.has(t.id));
            return [...prev, ...newTasks];
        });
        setIsLoadingMore(false);
    }, [fetchedTasks, pageIndex]);

    useEffect(() => {
        if (!currentTaskItem) return;
        setAllTasks(prev => prev.map(task =>
            task.id === currentTaskItem.id
                ? { ...task, task: currentTaskItem.task }
                : task
        ));
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
    }, [allTasks, isSubAgentsExpanded, isLoadingMore, data, pageIndex, setRequestedPageIndex]);

    const handleScroll = () => {
        if (scrollContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
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
        if (!ts) return '';
        try {
            const diff = Math.floor((Date.now() - ts) / 1000);
            if (diff < 60) return 'Now';
            return formatRelativeShortTime(ts);
        } catch (e) {
            return '';
        }
    };

    const getTaskTitle = (task: string) => {
        if (!task) return 'New Chat';

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
        <div
            className="history-top-view-container"
            onClick={(e) => e.stopPropagation()}
            style={{
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                width: "calc(100% - 11px)",
                height: "220px",
                margin: "4px auto 6px",
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
                    <div className="header-workspace-label">
                        Current Workspace
                    </div>
                </div>
            </div>

            <div className="top-view-list custom-scroll-container"
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
                        {(() => {
                            // Sub-agents are identified by the [Sub Agent] prefix in their initial prompt (task field).
                            // We also check for 'parentTaskId' if available in the history item for future-proofing.
                            const subAgentTasks = allTasks.filter(item => 
                                (item.task || (item as any).title || "").includes('[Sub Agent]') || 
                                (item as any).parentTaskId
                            );
                            const regularTasks = allTasks.filter(item => 
                                !(item.task || (item as any).title || "").includes('[Sub Agent]') && 
                                !(item as any).parentTaskId
                            );

                            const renderTaskItem = (item: HistoryItem, isSubAgent: boolean = false) => (
                                <div
                                    key={item.id}
                                    className={`compact-session-item ${item.id === currentTaskItem?.id ? 'active' : ''}`}
                                    onClick={() => handleSelectSession(item.id)}
                                >
                                    <div className="compact-item-left">
                                        {activeTaskIds?.includes(item.id) && (Date.now() - item.ts < 6000) ? (
                                            <span className="codicon codicon-loading codicon-modifier-spin" style={{ color: "var(--vscode-textLink-foreground)" }}></span>
                                        ) : (
                                            <span className="codicon codicon-check-all status-icon-compact"></span>
                                        )}
                                    </div>
                                    <div className="compact-item-content">
                                        <div className={`compact-item-title ${isSubAgent ? 'sub-agent-item-title' : ''}`}>
                                            {getTaskTitle(item.task || (item as any).title)}
                                        </div>
                                    </div>
                                    <div className="compact-item-right">
                                        <div className="compact-item-time">{formatRelativeTime(item.ts)}</div>
                                    </div>
                                </div>
                            );

                            return (
                                <>
                                    {subAgentTasks.length > 0 && (
                                        <div className="sub-agents-section">
                                            <div 
                                                className="sub-agents-header sticky-header" 
                                                onClick={() => setIsSubAgentsExpanded(!isSubAgentsExpanded)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    padding: '2px 10px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                    fontWeight: '600',
                                                    color: 'var(--vscode-descriptionForeground)',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    background: 'rgba(37, 37, 37, 0.9)',
                                                    backdropFilter: 'blur(10px)',
                                                    WebkitBackdropFilter: 'blur(10px)',
                                                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                    height: '24px',
                                                    position: 'sticky',
                                                    top: 0,
                                                    zIndex: 10
                                                }}
                                            >
                                                <span 
                                                    className={`codicon codicon-chevron-${isSubAgentsExpanded ? 'down' : 'right'}`}
                                                    style={{ marginRight: '6px', fontSize: '10px' }}
                                                ></span>
                                                Sub Agent Chats
                                                <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{subAgentTasks.length}</span>
                                            </div>
                                            {isSubAgentsExpanded && subAgentTasks.map(item => renderTaskItem(item, true))}
                                        </div>
                                    )}
                                    {regularTasks.length > 0 && (
                                        <div className="regular-tasks-section">
                                            {regularTasks.map(item => renderTaskItem(item, false))}
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                        {isLoadingMore && (
                            <div className="p-2 text-center text-xs text-vscode-descriptionForeground">
                                Loading...
                            </div>
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