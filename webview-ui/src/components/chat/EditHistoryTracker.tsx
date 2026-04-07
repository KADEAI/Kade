import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { AnimatePresence, motion } from "framer-motion";
import { useExtensionState } from "../../context/ExtensionStateContext";
import { FileIcon } from "./tools/FileIcon";
import { vscode } from "../../utils/vscode";
import { ChevronDown, RotateCcw, CheckCircle2 } from "lucide-react";
import {
  getEditToolDiffStats,
  isTrackedEditTool,
} from "@roo/kilocode/editHistoryDiffTotals";

const EXPANDED_LIST_MAX_HEIGHT = 240;

type TrackerFileChange = {
  path: string;
  additions: number;
  deletions: number;
  toolIds: string[];
  type: "create" | "edit" | "delete";
};

type TrackerUndoneChange = {
  path: string;
  toolIds: string[];
};

type TrackerOptimisticStatus = "accepted" | "undone" | "active";

type TrackerDerivedState = {
  fileChanges: TrackerFileChange[];
  undoneChanges: TrackerUndoneChange[];
  totalAdditions: number;
  totalDeletions: number;
};

const isToolMessage = (msg: any) =>
  (msg.type === "ask" && msg.ask === "tool") ||
  (msg.type === "say" && msg.say === "tool");

const getToolState = (
  toolId: string | undefined,
  acceptedToolIds: Set<string>,
  undoneToolIds: Set<string>,
) => {
  if (!toolId) {
    return "active" as const;
  }
  if (undoneToolIds.has(toolId)) {
    return "undone" as const;
  }
  if (acceptedToolIds.has(toolId)) {
    return "accepted" as const;
  }
  return "active" as const;
};

const mergeToolIds = (toolIds: string[], nextToolId?: string) =>
  nextToolId ? [...toolIds, nextToolId] : toolIds;

const buildEffectiveToolSets = (
  acceptedToolIds: string[],
  undoneToolIds: string[],
  optimisticStatuses: Record<string, TrackerOptimisticStatus>,
) => {
  const effectiveAcceptedIds = new Set(acceptedToolIds);
  const effectiveUndoneIds = new Set(undoneToolIds);

  for (const [toolId, status] of Object.entries(optimisticStatuses)) {
    if (status === "accepted") {
      effectiveAcceptedIds.add(toolId);
      effectiveUndoneIds.delete(toolId);
      continue;
    }

    if (status === "undone") {
      effectiveUndoneIds.add(toolId);
      effectiveAcceptedIds.delete(toolId);
      continue;
    }

    effectiveAcceptedIds.delete(toolId);
    effectiveUndoneIds.delete(toolId);
  }

  return { effectiveAcceptedIds, effectiveUndoneIds };
};

export const deriveEditHistoryState = (
  clineMessages: any[] = [],
  acceptedToolIds: Set<string>,
  undoneToolIds: Set<string>,
): TrackerDerivedState => {
  const fileChanges = new Map<string, TrackerFileChange>();
  const undoneChanges = new Map<string, TrackerUndoneChange>();
  const processedToolIds = new Set<string>();
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const msg of clineMessages) {
    if (msg.partial || !isToolMessage(msg)) {
      continue;
    }

    try {
      const toolData = JSON.parse(msg.text || "{}");
      const toolName = toolData.tool;

      if (!isTrackedEditTool(toolName)) {
        continue;
      }

      const filePath = toolData.path || toolData.file_path;
      if (!filePath) {
        continue;
      }

      const toolId =
        typeof toolData.id === "string" && toolData.id.length > 0
          ? toolData.id
          : undefined;

      if (toolId && processedToolIds.has(toolId)) {
        continue;
      }

      if (toolId) {
        processedToolIds.add(toolId);
      }

      const toolState = getToolState(toolId, acceptedToolIds, undoneToolIds);

      if (toolState === "undone") {
        const existing = undoneChanges.get(filePath);
        undoneChanges.set(filePath, {
          path: filePath,
          toolIds: existing
            ? mergeToolIds(existing.toolIds, toolId)
            : mergeToolIds([], toolId),
        });
        continue;
      }

      if (toolState === "accepted") {
        continue;
      }

      const { additions, deletions } = getEditToolDiffStats(toolName, toolData);
      const existing = fileChanges.get(filePath);

      if (existing) {
        existing.additions += additions;
        existing.deletions += deletions;
        existing.toolIds = mergeToolIds(existing.toolIds, toolId);
        if (toolName === "deleteFile") {
          existing.type = "delete";
        }
      } else {
        fileChanges.set(filePath, {
          path: filePath,
          additions,
          deletions,
          toolIds: mergeToolIds([], toolId),
          type:
            toolName === "deleteFile"
              ? "delete"
              : toolName === "newFileCreated"
                ? "create"
                : "edit",
        });
      }

      totalAdditions += additions;
      totalDeletions += deletions;
    } catch (_error) {
      // Ignore malformed tool payloads.
    }
  }

  return {
    fileChanges: Array.from(fileChanges.values()),
    undoneChanges: Array.from(undoneChanges.values()),
    totalAdditions,
    totalDeletions,
  };
};

const TrackerContainer = styled.div`
  display: flex;
  flex-direction: column;
  background: rgba(20, 20, 20, 0.99);
  border: 1px solid rgba(58, 58, 58, 0.36);
  border-radius: 10px;
  margin: 0 24.26px -18px 19.9px;
  overflow: hidden;
  box-shadow: 0 0px 0px rgba(78, 78, 78, 0.26);
`;

const TrackerHeader = styled.div<{ $isExpanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px;
  cursor: pointer;
  user-select: none;
  background: ${({ $isExpanded }) =>
    $isExpanded ? "rgba(255, 255, 255, 0.03)" : "transparent"};
  transition: background 0.2s ease;
  z-index: 101;
  position: relative;
`;

const FilesCount = styled.div`
  display: flex;
  align-items: center;
  padding-left: 2px;
  font-size: 12px;
  font-weight: 400;
  font-family: var(--vscode-font-family);
  color: #cccccc;
  min-width: 0;
  flex: 1;
  align-self: stretch;

  .count-text {
    white-space: nowrap;
    margin-right: 6px;
  }

  .chevron {
    margin-left: 6px;
    opacity: 0.3;
    display: flex;
    align-items: center;
  }
`;

const StatsSummary = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const Actions = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: stretch;
`;

const NotificationBubble = styled(motion.div)`
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: #2a2d33;
  color: #d4d4d4;
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" }>`
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $variant }) =>
    $variant === "primary" ? "#1e3d55af" : "#333333"};
  border: 0px solid rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  height: 24px;
  padding: 0 10px;
  border-radius: 10px;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  box-sizing: border-box;

  &:hover {
    background: ${({ $variant }) =>
      $variant === "primary" ? "#005a9e" : "#444444"};
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
  }

  &:active {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    filter: brightness(0.9);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
`;

const FilesList = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
  border-top: 0px solid rgba(255, 255, 255, 0.05);
  background: rgba(0, 0, 0, 0.15);

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 2px;
  }
`;

const FileItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  font-size: 12px;
  border-bottom: 0px solid rgba(255, 255, 255, 0.03);

  &:last-child {
    border-bottom: none;
  }
`;

const FileNameSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
`;

const FileName = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vscode-foreground);
  opacity: 0.9;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
    opacity: 1;
  }
`;

const FileStats = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 12px;
  flex-shrink: 0;
`;

const Stat = styled.span<{ $type: "add" | "remove" }>`
  color: ${({ $type }) => ($type === "add" ? "#4ade80" : "#f87171")};
  font-weight: 500;
  font-size: 12px;
`;

const UndoIcon = styled.div`
  cursor: pointer;
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 4px;
  transition: all 0.2s;
  margin-left: 2px;

  &:hover {
    opacity: 1;
    background: rgba(255, 70, 70, 0.2);
    color: #ff5555;
  }
`;

const DiffMeter = styled.div`
  display: flex;
  width: 32px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1px;
  overflow: hidden;
  margin-left: 8px;
  flex-shrink: 0;
`;

const AdditionBar = styled.div<{ $percent: number }>`
  width: ${({ $percent }) => $percent}%;
  height: 100%;
  background: #4ade80;
  transition: width 0.3s ease;
`;

const DeletionBar = styled.div<{ $percent: number }>`
  width: ${({ $percent }) => $percent}%;
  height: 100%;
  background: #f87171;
  transition: width 0.3s ease;
`;

const ExpandedSection = styled(motion.div)`
  overflow: hidden;
`;

const TrackerChevron = styled(ChevronDown)<{ $isExpanded: boolean }>`
  transform: rotate(${({ $isExpanded }) => ($isExpanded ? "0deg" : "-90deg")});
  transition: transform 0.18s ease;
`;

const EditHistoryFileRow = React.memo(function EditHistoryFileRow({
  file,
  onOpenFile,
  onUndoFile,
}: {
  file: TrackerFileChange;
  onOpenFile: (path: string) => void;
  onUndoFile: (toolIds: string[], path: string) => void;
}) {
  const fileName = file.path.split(/[\\/]/).pop();
  const totalChanges = file.additions + file.deletions;
  const additionPercent =
    totalChanges > 0 ? (file.additions / totalChanges) * 100 : 0;
  const deletionPercent =
    totalChanges > 0 ? (file.deletions / totalChanges) * 100 : 0;

  return (
    <FileItem>
      <FileNameSection>
        <FileIcon fileName={file.path} size={14} />
        <FileName title={file.path} onClick={() => onOpenFile(file.path)}>
          {fileName}
        </FileName>
      </FileNameSection>

      <FileStats>
        {file.additions > 0 && <Stat $type="add">+{file.additions}</Stat>}
        {file.deletions > 0 && <Stat $type="remove">-{file.deletions}</Stat>}

        <DiffMeter
          title={`${file.additions} additions, ${file.deletions} deletions`}
        >
          {totalChanges > 0 && (
            <>
              <AdditionBar $percent={additionPercent} />
              <DeletionBar $percent={deletionPercent} />
            </>
          )}
        </DiffMeter>

        <UndoIcon
          title="Undo changes for this file"
          onClick={() => onUndoFile(file.toolIds, file.path)}
        >
          <RotateCcw size={14} />
        </UndoIcon>
      </FileStats>
    </FileItem>
  );
});

export const EditHistoryTracker: React.FC = () => {
  const {
    clineMessages,
    undoneToolIds = [],
    acceptedToolIds = [],
  } = useExtensionState();
  const [isExpanded, setIsExpanded] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [optimisticStatuses, setOptimisticStatuses] = useState<
    Record<string, TrackerOptimisticStatus>
  >({});
  const notificationTimer = useRef<NodeJS.Timeout | null>(null);
  const deferredMessages = useDeferredValue(clineMessages);

  useEffect(() => {
    return () => {
      if (notificationTimer.current) {
        clearTimeout(notificationTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const acceptedSet = new Set(acceptedToolIds);
    const undoneSet = new Set(undoneToolIds);

    setOptimisticStatuses((current) => {
      let didChange = false;
      const nextStatuses = { ...current };

      for (const [toolId, status] of Object.entries(current)) {
        const currentStatus = getToolState(toolId, acceptedSet, undoneSet);

        if (currentStatus === status) {
          delete nextStatuses[toolId];
          didChange = true;
        }
      }

      return didChange ? nextStatuses : current;
    });
  }, [acceptedToolIds, undoneToolIds]);

  const showNotification = useCallback((message: string) => {
    if (notificationTimer.current) {
      clearTimeout(notificationTimer.current);
    }
    setNotification(message);
    notificationTimer.current = setTimeout(() => {
      setNotification(null);
    }, 3000);
  }, []);

  const { effectiveAcceptedIds, effectiveUndoneIds } = useMemo(
    () =>
      buildEffectiveToolSets(
        acceptedToolIds,
        undoneToolIds,
        optimisticStatuses,
      ),
    [acceptedToolIds, undoneToolIds, optimisticStatuses],
  );

  const { fileChanges, undoneChanges, totalAdditions, totalDeletions } =
    useMemo(
      () =>
        deriveEditHistoryState(
          deferredMessages,
          effectiveAcceptedIds,
          effectiveUndoneIds,
        ),
      [deferredMessages, effectiveAcceptedIds, effectiveUndoneIds],
    );

  const updateOptimisticStatuses = useCallback(
    (toolIds: string[], status: TrackerOptimisticStatus) => {
      if (toolIds.length === 0) {
        return;
      }

      setOptimisticStatuses((current) => {
        const nextStatuses = { ...current };
        for (const toolId of toolIds) {
          nextStatuses[toolId] = status;
        }
        return nextStatuses;
      });
    },
    [],
  );

  const handleUndoAll = useCallback(() => {
    const allToolIds = fileChanges.flatMap((f) => f.toolIds);
    if (allToolIds.length > 0) {
      updateOptimisticStatuses(allToolIds, "undone");
      vscode.postMessage({
        type: "command",
        command: "claudix.undoEdits",
        args: [allToolIds],
      });
      showNotification(`Undid edits for ${fileChanges.length} file(s)`);

      // Update workspace state to persist the undone IDs
      const newUndoneIds = Array.from(
        new Set([...undoneToolIds, ...allToolIds]),
      );
      vscode.postMessage({
        type: "request",
        requestId: Date.now().toString(),
        request: {
          type: "updateWorkspaceState",
          key: "claudix.undoneToolIds",
          value: newUndoneIds,
        },
      } as any);
    }
  }, [fileChanges, undoneToolIds, showNotification, updateOptimisticStatuses]);

  const handleAcceptAll = useCallback(() => {
    const allToolIds = fileChanges.flatMap((f) => f.toolIds);
    if (allToolIds.length > 0) {
      updateOptimisticStatuses(allToolIds, "accepted");

      // Update workspace state to persist the accepted IDs
      const newAcceptedIds = Array.from(
        new Set([...acceptedToolIds, ...allToolIds]),
      );
      vscode.postMessage({
        type: "request",
        requestId: Date.now().toString(),
        request: {
          type: "updateWorkspaceState",
          key: "claudix.acceptedToolIds",
          value: newAcceptedIds,
        },
      } as any);
      setIsExpanded(false);
    }
  }, [acceptedToolIds, fileChanges, updateOptimisticStatuses]);

  const handleRedoAll = useCallback(() => {
    const allToolIds = undoneChanges.flatMap((f) => f.toolIds);
    if (allToolIds.length > 0) {
      updateOptimisticStatuses(allToolIds, "active");
      vscode.postMessage({
        type: "command",
        command: "claudix.redoEdits",
        args: [allToolIds],
      });
      showNotification(`Redid edits for ${undoneChanges.length} file(s)`);

      const newUndoneIds = undoneToolIds.filter(
        (id) => !allToolIds.includes(id),
      );
      vscode.postMessage({
        type: "request",
        requestId: Date.now().toString(),
        request: {
          type: "updateWorkspaceState",
          key: "claudix.undoneToolIds",
          value: newUndoneIds,
        },
      } as any);
    }
  }, [
    undoneChanges,
    undoneToolIds,
    showNotification,
    updateOptimisticStatuses,
  ]);

  const handleUndoFile = useCallback(
    (toolIds: string[], path: string) => {
      updateOptimisticStatuses(toolIds, "undone");

      vscode.postMessage({
        type: "command",
        command: "claudix.undoEdits",
        args: [toolIds],
      });
      showNotification(`Undid edits for ${path.split(/[\\/]/).pop()}`);

      const newUndoneIds = Array.from(new Set([...undoneToolIds, ...toolIds]));
      vscode.postMessage({
        type: "request",
        requestId: Date.now().toString(),
        request: {
          type: "updateWorkspaceState",
          key: "claudix.undoneToolIds",
          value: newUndoneIds,
        },
      } as any);
    },
    [showNotification, undoneToolIds, updateOptimisticStatuses],
  );

  const handleOpenFile = useCallback((path: string) => {
    vscode.postMessage({ type: "openFile", text: path });
  }, []);

  const handleExpandedToggle = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);

  return (
    <AnimatePresence initial={false}>
      {fileChanges.length > 0 && (
        <motion.div
          key="edit-history-tracker"
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.985 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          style={{
            position: "relative",
            zIndex: 10,
            transformOrigin: "center bottom",
            willChange: "transform, opacity",
          }}
        >
          <TrackerContainer>
            <TrackerHeader
              $isExpanded={isExpanded}
              onClick={handleExpandedToggle}
            >
              <FilesCount>
                <span className="count-text">
                  {fileChanges.length}{" "}
                  {fileChanges.length === 1 ? "file" : "files"}
                </span>
                <StatsSummary>
                  {totalAdditions > 0 && (
                    <Stat $type="add">+{totalAdditions}</Stat>
                  )}
                  {totalDeletions > 0 && (
                    <Stat $type="remove">-{totalDeletions}</Stat>
                  )}
                </StatsSummary>
                <div className="chevron">
                  <TrackerChevron $isExpanded={isExpanded} size={14} />
                </div>
              </FilesCount>

              <Actions onClick={(e) => e.stopPropagation()}>
                <AnimatePresence initial={false}>
                  {notification && (
                    <NotificationBubble
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                    >
                      <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                      {notification}
                    </NotificationBubble>
                  )}
                </AnimatePresence>
                {undoneChanges.length > 0 && (
                  <ActionButton $variant="secondary" onClick={handleRedoAll}>
                    Redo
                  </ActionButton>
                )}
                <ActionButton $variant="secondary" onClick={handleUndoAll}>
                  Reject all
                </ActionButton>
                <ActionButton $variant="primary" onClick={handleAcceptAll}>
                  Accept all
                </ActionButton>
              </Actions>
            </TrackerHeader>

            <ExpandedSection
              initial={false}
              animate={{
                maxHeight: isExpanded ? EXPANDED_LIST_MAX_HEIGHT : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
            >
              <FilesList>
                {fileChanges.map((file) => (
                  <EditHistoryFileRow
                    key={file.path}
                    file={file}
                    onOpenFile={handleOpenFile}
                    onUndoFile={handleUndoFile}
                  />
                ))}
              </FilesList>
            </ExpandedSection>
          </TrackerContainer>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
