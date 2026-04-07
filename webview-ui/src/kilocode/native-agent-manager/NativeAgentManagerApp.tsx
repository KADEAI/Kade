import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  LoaderCircle,
  PanelsTopLeft,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  SquarePen,
} from "lucide-react";
import type { HistoryItem } from "@roo-code/types";

import { ExtensionMessage } from "@roo/ExtensionMessage";
import TranslationProvider from "@/i18n/TranslationContext";
import {
  ExtensionStateContextProvider,
  useExtensionState,
} from "@/context/ExtensionStateContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { STANDARD_TOOLTIP_DELAY } from "@/components/ui/standard-tooltip";
import { ToolThemeProvider } from "@/context/ToolThemeContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BashGlobalStyles } from "@/components/tools/Bash";
import ChatView, { type ChatViewRef } from "@/components/chat/ChatView";
import SettingsView from "@/components/settings/SettingsView";
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory";
import { vscode } from "@/utils/vscode";
import "./NativeAgentManagerApp.css";

type PanelSection = "chat" | "automations" | "skills" | "settings";

type ThreadGroup = {
  key: string;
  label: string;
  description?: string;
  tasks: HistoryItem[];
};

const queryClient = new QueryClient();
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 216;
const MAX_SIDEBAR_WIDTH = 460;
const SIDEBAR_COMPACT_BREAKPOINT = 308;

const titleFromTask = (task?: string) => {
  const normalized = (task || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "New thread";
  return normalized.length > 28 ? `${normalized.slice(0, 27)}…` : normalized;
};

const workspaceLabel = (workspace?: string) => {
  if (!workspace) return "workspace";
  const segments = workspace.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || workspace;
};

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return "";
  const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSeconds < 15) return "now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
  return `${Math.floor(diffSeconds / 86400)}d`;
};

const sanitizeTaskLabel = (value?: string) => {
  const normalized = (value || "").trim();
  if (!normalized) return "New thread";
  if (
    normalized.startsWith("{") ||
    normalized.includes("tasks.incomplete") ||
    normalized.includes("tasks.no_messages")
  ) {
    return "Incomplete thread";
  }
  return normalized;
};

const isTaskLive = (item: HistoryItem, activeTaskIds: string[] = []) =>
  activeTaskIds.includes(item.id) &&
  typeof item.ts === "number" &&
  Date.now() - item.ts < 14000;

const ThreadSidebar = React.memo(({
  sidebarRef,
  groups,
  activeTaskId,
  activeTaskIds,
  query,
  setQuery,
  section,
  setSection,
  onNewThread,
  onOpenTask,
  onOpenSettings,
  isCompact,
  collapsedGroups,
  onToggleGroup,
}: {
  sidebarRef: React.RefObject<HTMLElement>;
  groups: ThreadGroup[];
  activeTaskId?: string;
  activeTaskIds: string[];
  query: string;
  setQuery: (value: string) => void;
  section: PanelSection;
  setSection: (value: PanelSection) => void;
  onNewThread: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenSettings: () => void;
  isCompact: boolean;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (groupKey: string) => void;
}) => {
  const threadGroupsRef = useRef<HTMLDivElement>(null);
  const groupHeaderRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const collapseTargetRef = useRef<string | null>(null);
  const sidebarStars = useMemo(() => {
    const colors = ["#ffffff", "#fff4e6", "#e6f2ff", "#f0e6ff"];

    return [...Array(80)].map((_, i) => {
      const size = Math.random() * 1.5 + 0.5;
      const depth = Math.random();

      return (
        <div
          key={i}
          className="native-agent-manager__sidebar-star"
          style={
            {
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: colors[Math.floor(Math.random() * colors.length)],
              filter: `blur(${depth > 0.7 ? "0.5px" : "0px"})`,
              ["--star-delay" as any]: `${Math.random() * -20}s`,
              ["--star-duration" as any]: `${15 + Math.random() * 20}s`,
              ["--star-opacity" as any]: 0.15 + Math.random() * 0.4,
            } as React.CSSProperties
          }
        />
      );
    });
  }, []);

  useLayoutEffect(() => {
    const collapseTarget = collapseTargetRef.current;
    if (!collapseTarget) return;

    const scroller = threadGroupsRef.current;
    const header = groupHeaderRefs.current[collapseTarget];
    if (!scroller || !header) {
      collapseTargetRef.current = null;
      return;
    }

    const scrollerTop = scroller.getBoundingClientRect().top;
    const nextTop = header.getBoundingClientRect().top;
    const targetTop = scroller.scrollTop + (nextTop - scrollerTop) - 4;

    scroller.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });

    collapseTargetRef.current = null;
  }, [collapsedGroups]);

  const handleToggleGroup = useCallback(
    (groupKey: string) => {
      const willCollapse = !collapsedGroups[groupKey];
      collapseTargetRef.current = willCollapse ? groupKey : null;

      onToggleGroup(groupKey);
    },
    [collapsedGroups, onToggleGroup],
  );

  return (
    <aside
      ref={sidebarRef}
      className={`native-agent-manager__sidebar ${isCompact ? "is-compact" : ""}`}
    >
      <div className="native-agent-manager__sidebar-stars" aria-hidden="true">
        <div className="native-agent-manager__sidebar-ambient" />
        {sidebarStars}
      </div>

      <div className="native-agent-manager__sidebar-nav">
        <button
          type="button"
          className="native-agent-manager__nav-item native-agent-manager__nav-item--primary"
          onClick={onNewThread}
        >
          <SquarePen size={16} />
          <span>New thread</span>
        </button>
        <button
          type="button"
          className={`native-agent-manager__nav-item ${section === "automations" ? "is-active" : ""}`}
          onClick={() => setSection("automations")}
        >
          <Clock3 size={16} />
          <span>Automations</span>
        </button>
        <button
          type="button"
          className={`native-agent-manager__nav-item ${section === "skills" ? "is-active" : ""}`}
          onClick={() => setSection("skills")}
        >
          <LayoutGrid size={16} />
          <span>Skills</span>
        </button>
      </div>

      <div className="native-agent-manager__threads">
        <div className="native-agent-manager__threads-header">
          <span>Threads</span>
          <div className="native-agent-manager__threads-actions">
            <button type="button" onClick={onNewThread} aria-label="Create thread">
              <Plus size={14} />
            </button>
            <button type="button" aria-label="Filter threads">
              <SlidersHorizontal size={14} />
            </button>
          </div>
        </div>

        <label className="native-agent-manager__search">
          <Search size={13} />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads"
          />
        </label>

        <div ref={threadGroupsRef} className="native-agent-manager__thread-groups">
          {groups.map((group) => (
            <section key={group.key} className="native-agent-manager__thread-group">
              <div className="native-agent-manager__thread-group-header">
                <button
                  type="button"
                  className="native-agent-manager__thread-group-trigger"
                  onClick={() => handleToggleGroup(group.key)}
                  aria-expanded={!collapsedGroups[group.key]}
                  ref={(node) => {
                    groupHeaderRefs.current[group.key] = node;
                  }}
                >
                  <div className="native-agent-manager__thread-group-title">
                    <span className="codicon codicon-folder-opened" />
                    <span>{group.label}</span>
                  </div>
                  <span className="native-agent-manager__thread-group-toggle">
                    {collapsedGroups[group.key] ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                  </span>
                </button>
              </div>

              <div
                className={`native-agent-manager__thread-group-body ${
                  collapsedGroups[group.key] ? "is-collapsed" : ""
                }`}
              >
                <div className="native-agent-manager__thread-group-body-inner">
                  {group.tasks.length === 0 ? (
                    <div className="native-agent-manager__thread-empty">No threads</div>
                  ) : (
                    <div className="native-agent-manager__thread-list">
                      {group.tasks.map((item) => {
                        const active = item.id === activeTaskId;
                        const live = isTaskLive(item, activeTaskIds);
                        const diffAdditions = item.diffAdditions ?? 0;
                        const diffDeletions = item.diffDeletions ?? 0;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`native-agent-manager__thread-item ${active ? "is-active" : ""}`}
                            onClick={() => onOpenTask(item.id)}
                          >
                            <span className="native-agent-manager__thread-item-title">
                              {titleFromTask(sanitizeTaskLabel(item.task))}
                            </span>
                            <div className="native-agent-manager__thread-item-meta">
                              {live ? (
                                <span
                                  className="native-agent-manager__thread-item-live"
                                  aria-label="Active thread"
                                >
                                  <LoaderCircle size={11} />
                                </span>
                              ) : null}
                              <div className="native-agent-manager__thread-item-diff">
                                {diffAdditions > 0 ? (
                                  <span className="is-positive">+{diffAdditions}</span>
                                ) : null}
                                {diffDeletions > 0 ? (
                                  <span className="is-negative">-{diffDeletions}</span>
                                ) : null}
                              </div>
                              <span className="native-agent-manager__thread-item-time">
                                {formatRelativeTime(item.ts)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`native-agent-manager__sidebar-settings ${section === "settings" ? "is-active" : ""}`}
        onClick={onOpenSettings}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>
    </aside>
  );
});

const NativeAgentManagerSurface = () => {
  const {
    activeTaskIds,
    currentTaskItem,
    cwd,
    taskHistoryVersion,
  } = useExtensionState();
  const [section, setSection] = useState<PanelSection>("chat");
  const [query, setQuery] = useState("");
  const chatRef = useRef<ChatViewRef>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const resizeFrameRef = useRef<number | null>(null);
  const pendingSidebarWidthRef = useRef<number | null>(null);
  const liveSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isDraftThread, setIsDraftThread] = useState(false);
  const [draftBaseTaskId, setDraftBaseTaskId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const applySidebarWidth = useCallback((width: number) => {
    liveSidebarWidthRef.current = width;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    sidebar.style.width = `${width}px`;
    sidebar.style.flexBasis = `${width}px`;
  }, []);

  const clampSidebarWidth = useCallback((width: number) => {
    const shellWidth = shellRef.current?.clientWidth ?? window.innerWidth;
    const maxWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, shellWidth - 360),
    );

    return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxWidth);
  }, []);

  useEffect(() => {
    setSidebarWidth((current) => {
      const nextWidth = clampSidebarWidth(current);
      applySidebarWidth(nextWidth);
      return nextWidth;
    });
  }, [applySidebarWidth, clampSidebarWidth]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    if (isSidebarHidden) {
      sidebar.style.setProperty("width", "0px", "important");
      sidebar.style.setProperty("flex-basis", "0px", "important");
      sidebar.style.setProperty("padding", "0px", "important");
      sidebar.style.setProperty("border-right-width", "0px", "important");
      return;
    }

    sidebar.style.removeProperty("padding");
    sidebar.style.removeProperty("border-right-width");
    applySidebarWidth(liveSidebarWidthRef.current);
  }, [applySidebarWidth, isSidebarHidden]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;

      const nextWidth = clampSidebarWidth(
        state.startWidth + event.clientX - state.startX,
      );
      pendingSidebarWidthRef.current = nextWidth;

      if (resizeFrameRef.current !== null) return;

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;

        if (pendingSidebarWidthRef.current === null) return;
        applySidebarWidth(pendingSidebarWidthRef.current);
        pendingSidebarWidthRef.current = null;
      });
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      if (pendingSidebarWidthRef.current !== null) {
        applySidebarWidth(pendingSidebarWidthRef.current);
        pendingSidebarWidthRef.current = null;
      }

      document.body.classList.remove("native-agent-manager-resizing");
      setSidebarWidth(liveSidebarWidthRef.current);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      pendingSidebarWidthRef.current = null;
      document.body.classList.remove("native-agent-manager-resizing");
    };
  }, [applySidebarWidth, clampSidebarWidth]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (isSidebarHidden) return;
      const nextWidth = clampSidebarWidth(liveSidebarWidthRef.current);
      applySidebarWidth(nextWidth);
      setSidebarWidth(nextWidth);
    });

    observer.observe(shell);
    return () => observer.disconnect();
  }, [applySidebarWidth, clampSidebarWidth, isSidebarHidden]);

  const { data } = useTaskHistory(
    {
      workspace: "all",
      sort: "newest",
      favoritesOnly: false,
      pageIndex: 0,
      pageSize: 200,
      search: query,
    },
    taskHistoryVersion,
  );

  const groups = useMemo(() => {
    const currentKey = cwd || currentTaskItem?.workspace || "current";
    const byWorkspace = new Map<string, ThreadGroup>();

    byWorkspace.set(currentKey, {
      key: currentKey,
      label: workspaceLabel(currentKey),
      tasks: [],
    });

    for (const item of data?.historyItems ?? []) {
      const key = item.workspace || "workspace";
      const existing = byWorkspace.get(key);

      if (existing) {
        existing.tasks.push(item);
        continue;
      }

      byWorkspace.set(key, {
        key,
        label: workspaceLabel(key),
        tasks: [item],
      });
    }

    return [...byWorkspace.values()]
      .map((group) => ({
        ...group,
        tasks: group.tasks
          .slice()
          .sort((left, right) => (right.ts || 0) - (left.ts || 0)),
      }))
      .sort((left, right) => {
        if (left.key === currentKey) return -1;
        if (right.key === currentKey) return 1;
        return left.label.localeCompare(right.label);
      });
  }, [currentTaskItem?.workspace, cwd, data?.historyItems]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionMessage;
      if (message.type !== "action") return;

      if (
        message.action === "chatButtonClicked" ||
        message.action === "focusInput" ||
        message.action === "focusChatInput"
      ) {
        setSection("chat");
        window.setTimeout(() => chatRef.current?.focusInput(), 0);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleNewThread = () => {
    setSection("chat");
    setDraftBaseTaskId(currentTaskItem?.id ?? null);
    setIsDraftThread(true);
    vscode.postMessage({ type: "clearTask" });
    window.setTimeout(() => chatRef.current?.focusInput(), 0);
  };

  const handleOpenTask = (taskId: string) => {
    setSection("chat");
    setIsDraftThread(false);
    setDraftBaseTaskId(null);
    vscode.postMessage({ type: "showTaskWithId", text: taskId });
  };

  const handleOpenSettings = () => {
    setIsDraftThread(false);
    setDraftBaseTaskId(null);
    setSection("settings");
  };

  useEffect(() => {
    if (!isDraftThread) return;

    if (currentTaskItem?.id && currentTaskItem.id !== draftBaseTaskId) {
      setIsDraftThread(false);
      setDraftBaseTaskId(null);
    }
  }, [currentTaskItem?.id, draftBaseTaskId, isDraftThread]);

  const handleFocusTerminal = useCallback(() => {
    vscode.postMessage({ type: "focusTerminal" });
  }, []);

  const handleCreateUntitledFile = useCallback(() => {
    vscode.postMessage({ type: "newUntitledFile" });
  }, []);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const handleSidebarResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (isSidebarHidden) return;
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    document.body.classList.add("native-agent-manager-resizing");
  };

  const isCompactSidebar = sidebarWidth < SIDEBAR_COMPACT_BREAKPOINT;
  const diffAdditions = isDraftThread ? 0 : (currentTaskItem?.diffAdditions ?? 0);
  const diffDeletions = isDraftThread ? 0 : (currentTaskItem?.diffDeletions ?? 0);
  const showDiffTotals = diffAdditions !== 0 || diffDeletions !== 0;
  const handleToggleSidebar = useCallback(() => {
    setIsSidebarHidden((current) => !current);
  }, []);

  return (
    <div
      ref={shellRef}
      className={`native-agent-manager ${isSidebarHidden ? "is-sidebar-hidden" : ""}`}
    >
      <ThreadSidebar
        sidebarRef={sidebarRef}
        groups={groups}
        activeTaskId={isDraftThread ? undefined : currentTaskItem?.id}
        activeTaskIds={activeTaskIds || []}
        query={query}
        setQuery={setQuery}
        section={section}
        setSection={setSection}
        onNewThread={handleNewThread}
        onOpenTask={handleOpenTask}
        onOpenSettings={handleOpenSettings}
        isCompact={isCompactSidebar}
        collapsedGroups={collapsedGroups}
        onToggleGroup={handleToggleGroup}
      />
      <div
        className="native-agent-manager__sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={handleSidebarResizeStart}
      />

      <main className="native-agent-manager__main">
        <header className="native-agent-manager__main-header">
          <div className="native-agent-manager__main-title-wrap">
            <div className="native-agent-manager__main-title">
              {section === "chat"
                ? isDraftThread
                  ? "New thread"
                  : titleFromTask(currentTaskItem?.task)
                : section === "skills"
                  ? "Skills"
                  : section === "settings"
                    ? "Settings"
                  : "Automations"}
            </div>
            <button
              type="button"
              className="native-agent-manager__title-toggle"
              onClick={handleToggleSidebar}
              title={isSidebarHidden ? "Show sidebar" : "Hide sidebar"}
              aria-label={isSidebarHidden ? "Show sidebar" : "Hide sidebar"}
              aria-pressed={isSidebarHidden}
            >
              {isSidebarHidden ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          <div className="native-agent-manager__toolbar">
            <button
              type="button"
              className="native-agent-manager__toolbar-icon"
              onClick={handleFocusTerminal}
              title="Open terminal panel"
              aria-label="Open terminal panel"
            >
              <TerminalSquare size={18} />
            </button>
            <button
              type="button"
              className="native-agent-manager__toolbar-icon"
              onClick={handleCreateUntitledFile}
              title="New empty file"
              aria-label="New empty file"
            >
              <PanelsTopLeft size={18} />
            </button>
            {showDiffTotals ? (
              <div className="native-agent-manager__diff-totals">
                <span className="is-positive">+{diffAdditions}</span>
                <span className="is-negative">-{diffDeletions}</span>
              </div>
            ) : null}
          </div>
        </header>

        <section className="native-agent-manager__content">
          {section === "chat" ? (
            <div className="native-agent-manager__chat-shell">
              <div className="native-agent-manager__chat-viewport">
                <ChatView
                  ref={chatRef}
                  isHidden={false}
                  showAnnouncement={false}
                  hideAnnouncement={() => undefined}
                  historyViewType="view"
                  layout="embedded"
                />
              </div>
            </div>
          ) : null}

          {section === "skills" ? (
            <div className="native-agent-manager__skills-shell">
              <SettingsView
                onDone={() => setSection("chat")}
                targetSection="skills"
                historyViewType="view"
              />
            </div>
          ) : null}

          {section === "automations" ? (
            <div className="native-agent-manager__settings-shell">
              <SettingsView
                onDone={() => setSection("chat")}
                targetSection="infinity"
                historyViewType="view"
              />
            </div>
          ) : null}

          {section === "settings" ? (
            <div className="native-agent-manager__settings-shell">
              <SettingsView
                onDone={() => setSection("chat")}
                historyViewType="view"
              />
            </div>
          ) : null}
        </section>

      </main>
    </div>
  );
};

const NativeAgentManagerApp = () => (
  <ErrorBoundary>
    <ExtensionStateContextProvider>
      <TranslationProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
            <ToolThemeProvider>
              <BashGlobalStyles />
              <NativeAgentManagerSurface />
            </ToolThemeProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </TranslationProvider>
    </ExtensionStateContextProvider>
  </ErrorBoundary>
);

export default NativeAgentManagerApp;
