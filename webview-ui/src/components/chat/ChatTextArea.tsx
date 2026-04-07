import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEvent } from "react-use";
import { AnimatePresence, motion } from "framer-motion";
import DynamicTextArea from "react-textarea-autosize";

import {
  mentionRegex,
  mentionRegexGlobal,
  unescapeSpaces,
} from "@roo/context-mentions";
import { WebviewMessage } from "@roo/WebviewMessage";
import { Mode, getAllModes } from "@roo/modes";
import { ExtensionMessage } from "@roo/ExtensionMessage";
import type { ProfileType, ClineMessage } from "@roo-code/types"; // kade_change - autocomplete profile type system
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"; // kade_change
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"; // kade_change
import KiloTaskHeader from "../kilocode/KiloTaskHeader"; // kade_change

import { vscode } from "@/utils/vscode";
import { useExtensionState } from "../../context/ExtensionStateContext";
import { useAppTranslation } from "@/i18n/TranslationContext";
import {
  ContextMenuOptionType,
  getContextMenuOptions,
  insertMention,
  removeMention,
  shouldShowContextMenu,
  SearchResult,
} from "@src/utils/context-mentions";
import { convertToMentionPath } from "@/utils/path-mentions";
import { escapeHtml } from "@/utils/highlight"; // kade_change - FIM autocomplete
import { useChatGhostText } from "./hooks/useChatGhostText"; // kade_change: FIM autocomplete
import { DropdownOptionType, Button, StandardTooltip } from "@/components/ui";

import Thumbnails from "../common/Thumbnails";
import { ModeSelector } from "./ModeSelector";
import KiloModeSelector from "../kilocode/KiloModeSelector";
import { KiloProfileSelector } from "../kilocode/chat/KiloProfileSelector";
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView";
import ContextMenu from "./ContextMenu";
import { ImageWarningBanner } from "./ImageWarningBanner";
import {
  VolumeX,
  Pin,
  Check,
  WandSparkles,
  SendHorizontal,
  Paperclip,
  MessageSquareX,
  SquareStack,
  Image as ImageIcon,
  Square,
  Plus,
  AtSign,
  ArrowUp,
  List,
  Undo2,
  Play,
} from "lucide-react";
import { IndexingStatusBadge } from "./IndexingStatusBadge";
import { MicrophoneButton } from "./MicrophoneButton"; // kade_change: STT microphone button
import { VolumeVisualizer } from "./VolumeVisualizer"; // kade_change: STT volume level visual
import { VoiceRecordingCursor } from "./VoiceRecordingCursor"; // kade_change: STT recording cursor
import { cn } from "@/lib/utils";
import { usePromptHistory } from "./hooks/usePromptHistory";
import { useSTT } from "@/hooks/useSTT"; // kade_change: STT hook
import { formatLargeNumber } from "@/utils/format";
import { hasDraftContent } from "./chatDraft";

// kade_change start: pull slash commands from Cline
import SlashCommandMenu from "@/components/chat/SlashCommandMenu";
import {
  SlashCommand,
  shouldShowSlashCommandsMenu,
  getMatchingSlashCommands,
  insertSlashCommand,
  validateSlashCommand,
} from "@/utils/slash-commands";
import { ModelSelector } from "../kilocode/chat/ModelSelector"; // kade_change: Move model selector here
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"; // kade_change: for ModelSelector
import { AutoApproveDropdown } from "./AutoApproveDropdown";
import { createSendRequestGate } from "./sendRequestGate";
// kade_change end

interface ChatTextAreaProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  sendingDisabled: boolean;
  selectApiConfigDisabled: boolean;
  placeholderText: string;
  selectedImages: string[];
  setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
  onSend: () => void;
  onSelectImages: () => void;
  shouldDisableImages: boolean;
  onHeightChange?: (height: number) => void;
  mode: Mode;
  setMode: (value: Mode) => void;
  modeShortcutText: string;
  // Edit mode props
  isEditMode?: boolean;
  onCancel?: () => void;
  onDelete?: () => void;
  sendMessageOnEnter?: boolean; // kade_change
  showBrowserDockToggle?: boolean;
  // kade_change start: Task header props
  task?: ClineMessage;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  totalCost?: number;
  contextTokens?: number;
  contextWindow?: number;
  handleCondenseContext?: (taskId: string) => void;
  onCloseTask?: () => void;
  groupedMessages?: (ClineMessage | ClineMessage[])[];
  onMessageClick?: (index: number) => void;
  todos?: any[];
  isStreaming?: boolean;
  onStop?: () => void;
  onOpenImage?: (image: string) => void; // kade_change
  enableSubAgents?: boolean; // kade_change
  setEnableSubAgents?: (value: boolean) => void; // kade_change
  // kade_change: Action buttons
  primaryButtonText?: string;
  secondaryButtonText?: string;
  enableButtons?: boolean;
  primaryButtonVariant?: "default" | "minimal";
  onPrimaryButtonClick?: (text?: string, images?: string[]) => void;
  onSecondaryButtonClick?: (text?: string, images?: string[]) => void;
  // kade_change end
}

// kade_change start
function handleSessionCommand(
  trimmedInput: string,
  setInputValue: (value: string) => void,
) {
  if (trimmedInput.startsWith("/session show")) {
    vscode.postMessage({
      type: "sessionShow",
    });

    setInputValue("");

    return true;
  } else if (trimmedInput.startsWith("/session share")) {
    vscode.postMessage({
      type: "sessionShare",
    });

    setInputValue("");

    return true;
  } else if (trimmedInput.startsWith("/session fork ")) {
    const shareId = trimmedInput.substring("/session fork ".length).trim();

    vscode.postMessage({
      type: "sessionFork",
      shareId: shareId,
    });

    if (shareId) {
      setInputValue("");
    }

    return true;
  } else if (trimmedInput.startsWith("/session select ")) {
    const sessionId = trimmedInput.substring("/session select ".length).trim();

    vscode.postMessage({
      type: "sessionSelect",
      sessionId: sessionId,
    });

    setInputValue("");

    return true;
  }

  return false;
}
// kade_change end

export const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
  (
    {
      inputValue,
      setInputValue,
      sendingDisabled,
      selectApiConfigDisabled,
      placeholderText,
      selectedImages,
      setSelectedImages,
      onSend,
      onSelectImages,
      shouldDisableImages,
      onHeightChange,
      mode,
      setMode,
      modeShortcutText,
      isEditMode = false,
      onCancel,
      onDelete,
      sendMessageOnEnter = true,
      // kade_change start
      task,
      tokensIn,
      tokensOut,
      cacheWrites,
      cacheReads,
      totalCost,
      contextTokens,
      contextWindow,
      handleCondenseContext,
      onCloseTask,
      groupedMessages,
      onMessageClick,
      todos,
      isStreaming,
      onStop,
      onOpenImage,
      enableSubAgents,
      setEnableSubAgents,
      primaryButtonText,
      secondaryButtonText,
      enableButtons,
      primaryButtonVariant = "default",
      onPrimaryButtonClick,
      onSecondaryButtonClick,
      // kade_change end
    },
    ref,
  ) => {
    const { t } = useAppTranslation();
    const {
      filePaths,
      openedTabs,
      currentApiConfigName,
      listApiConfigMeta: listApiConfigMeta_unfilteredByKiloCodeProfileType,
      customModes,
      customModePrompts,
      cwd,
      pinnedApiConfigs,
      togglePinnedApiConfig,
      localWorkflows, // kade_change
      globalWorkflows, // kade_change
      taskHistoryVersion, // kade_change
      clineMessages,
      language, // User's VSCode display language
      experiments, // kade_change: For speechToText experiment flag
      speechToTextStatus, // kade_change: Speech-to-text availability status with failure reason
      sttProvider, // kade_change: STT provider choice
      apiConfiguration, // kade_change: for ModelSelector
      virtualQuotaActiveModel, // kade_change: for ModelSelector
      showAutoApproveMenu, // kade_change: for AutoApproveDropdown
    } = useExtensionState();

    // kade_change start - autocomplete profile type system
    // Filter out autocomplete profiles - only show chat profiles in the chat interface
    const listApiConfigMeta = useMemo(() => {
      if (!listApiConfigMeta_unfilteredByKiloCodeProfileType) {
        return [];
      }
      return listApiConfigMeta_unfilteredByKiloCodeProfileType.filter(
        (config) => {
          const profileType = (config as { profileType?: ProfileType })
            .profileType;
          return profileType !== "autocomplete";
        },
      );
    }, [listApiConfigMeta_unfilteredByKiloCodeProfileType]);
    // kade_change end

    const { id: selectedModelId, provider: selectedProvider } =
      useSelectedModel(apiConfiguration);

    // Find the ID and display text for the currently selected API configuration
    const { currentConfigId, displayName } = useMemo(() => {
      const currentConfig = listApiConfigMeta?.find(
        (config) => config.name === currentApiConfigName,
      );
      return {
        currentConfigId: currentConfig?.id || "",
        displayName: currentApiConfigName || "", // Use the name directly for display
      };
    }, [listApiConfigMeta, currentApiConfigName]);

    const [gitCommits, setGitCommits] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isIndexingMenuOpen, setIsIndexingMenuOpen] = useState(false);
    const [isTaskPopoverOpen, setIsTaskPopoverOpen] = useState(false);
    const [taskPopoverDefaultExpanded, setTaskPopoverDefaultExpanded] =
      useState(false);

    const handleIndexingMenuOpenChange = useCallback((open: boolean) => {
      setIsIndexingMenuOpen(open);
      if (!open) {
        setIsPlusMenuVisible(false);
      }
    }, []);
    const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>(
      [],
    );

    // kade_change begin: remove button from chat when it gets to small
    const [containerWidth, setContainerWidth] = useState(0);
    const useCompactModeSelector = containerWidth > 0 && containerWidth < 470;
    const safeContextTokens = Math.max(0, contextTokens ?? 0);
    const safeContextWindow = Math.max(0, contextWindow ?? 0);
    const contextUsagePercent =
      safeContextWindow > 0
        ? Math.min(100, (safeContextTokens / safeContextWindow) * 100)
        : 0;
    const contextUsageLabel = useMemo(() => {
      if (safeContextWindow === 0) return undefined;
      return `${Math.round(contextUsagePercent)}% (${formatLargeNumber(safeContextTokens)} / ${formatLargeNumber(safeContextWindow)}) context used`;
    }, [safeContextWindow, safeContextTokens, contextUsagePercent]);

    const contextUsageDisplayPercent = Number.isFinite(contextUsagePercent)
      ? Math.round(contextUsagePercent)
      : 0;
    const contextUsageTooltip =
      contextUsageLabel ??
      `${contextUsageDisplayPercent}% (${formatLargeNumber(safeContextTokens)} / ${formatLargeNumber(safeContextWindow || 1)})`;
    const contextArcStyle = useMemo(() => {
      const percent = Number.isFinite(contextUsagePercent)
        ? Math.min(100, Math.max(0, contextUsagePercent))
        : 0;
      return {
        background: `conic-gradient(var(--kilo-context-usage-fill,#4aa8ff) ${percent}%, color-mix(in srgb,var(--vscode-foreground)_15%,transparent) ${percent}% 100%)`,
      };
    }, [contextUsagePercent]);

    const portalContainer = useRooPortal("roo-portal"); // kade_change
    const canOpenTaskPopover =
      !!task && !!handleCondenseContext && !!onCloseTask && !!groupedMessages;

    const openTaskPopover = useCallback((expanded: boolean) => {
      if (!canOpenTaskPopover) return;
      setTaskPopoverDefaultExpanded(expanded);
      setIsTaskPopoverOpen(true);
    }, [canOpenTaskPopover]);

    const handleTaskPopoverOpenChange = useCallback((open: boolean) => {
      setIsTaskPopoverOpen(open);
      if (!open) {
        setTaskPopoverDefaultExpanded(false);
      }
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      // Check if ResizeObserver is available (it won't be in test environment)
      if (typeof ResizeObserver === "undefined") return;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          setContainerWidth(width);
        }
      });

      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }, []);
    // kade_change end: Container width tracking for responsive UI

    const [searchLoading, setSearchLoading] = useState(false);
    const [searchRequestId, setSearchRequestId] = useState<string>("");

    // Close dropdown when clicking outside.
    useEffect(() => {
      const handleClickOutside = () => {
        if (showDropdown) {
          setShowDropdown(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [showDropdown]);

    // Handle enhanced prompt response and search results.
    useEffect(() => {
      const messageHandler = (event: MessageEvent) => {
        const message = event.data;

        if (message.type === "enhancedPrompt") {
          if (message.text && textAreaRef.current) {
            try {
              // Use execCommand to replace text while preserving undo history
              if (document.execCommand) {
                // Use native browser methods to preserve undo stack
                const textarea = textAreaRef.current;

                // Focus the textarea to ensure it's the active element
                textarea.focus();

                // Select all text first
                textarea.select();
                document.execCommand("insertText", false, message.text);
              } else {
                setInputValue(message.text);
              }
            } catch {
              setInputValue(message.text);
            }
          }

          setIsEnhancingPrompt(false);
        } else if (message.type === "commitSearchResults") {
          const commits = message.commits.map((commit: any) => ({
            type: ContextMenuOptionType.Git,
            value: commit.hash,
            label: commit.subject,
            description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
            icon: "$(git-commit)",
          }));

          setGitCommits(commits);
        } else if (message.type === "fileSearchResults") {
          setSearchLoading(false);
          if (message.requestId === searchRequestId) {
            setFileSearchResults(message.results || []);
          }
        } else if (message.type === "insertTextToChatArea") {
          // kade_change
          if (message.text) {
            setInputValue(message.text);
            setTimeout(() => {
              if (textAreaRef.current) {
                textAreaRef.current.focus();
              }
            }, 0);
          }
        }
      };

      window.addEventListener("message", messageHandler);
      return () => window.removeEventListener("message", messageHandler);
    }, [setInputValue, searchRequestId, inputValue, onSend]);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    // kade_change start: Slash commands state
    const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false);
    const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] =
      useState(0);
    const [slashCommandsQuery, setSlashCommandsQuery] = useState("");
    const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null);
    // kade_change end: Slash commands state
    const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<
      number | undefined
    >(undefined);
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
    const sendRequestGateRef = useRef(createSendRequestGate());
    const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false);

    // kade_change: Use STT (Speech-to-Text) hook
    // Track input state when recording starts
    const recordingStartStateRef = useRef<{
      beforeCursor: string;
      afterCursor: string;
      position: number;
    } | null>(null);
    const {
      isRecording,
      segments,
      volume: volumeLevel,
      start: startSTT,
      stop: stopSTT,
      isModelLoading,
      modelLoadingProgress,
    } = useSTT({
      onComplete: (text) => {
        // Insert transcribed text at cursor position
        if (recordingStartStateRef.current) {
          const { beforeCursor, afterCursor } = recordingStartStateRef.current;
          const separator =
            beforeCursor && !beforeCursor.endsWith(" ") ? " " : "";
          const newValue = beforeCursor + separator + text + afterCursor;
          setInputValue(newValue);
          // Set cursor after inserted text
          const newCursorPos =
            beforeCursor.length + separator.length + text.length;
          setCursorPosition(newCursorPos);
          setIntendedCursorPosition(newCursorPos);
        } else {
          setInputValue(text);
        }
        recordingStartStateRef.current = null;
      },
      onError: (error) => {
        console.error("STT error:", error);
        recordingStartStateRef.current = null;
      },
    });

    // Convert segments to text for display
    const liveTranscript = useMemo(() => {
      return segments.map((s) => s.text).join(" ");
    }, [segments]);

    // Track preview ranges for highlighting
    const previewRanges = useMemo(() => {
      const ranges: { start: number; end: number }[] = [];
      let offset = 0;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.isPreview) {
          ranges.push({ start: offset, end: offset + segment.text.length });
        }
        offset += segment.text.length;
        // Add space offset except for the last segment
        if (i < segments.length - 1) {
          offset += 1; // Account for the space added by join(" ")
        }
      }

      // console.log("🎙️ [ChatTextArea] 🎨 previewRanges:", ranges, "from segments:", segments)
      return ranges;
    }, [segments]);

    // Store cursor position and split input when recording starts
    useEffect(() => {
      if (isRecording && !recordingStartStateRef.current) {
        const pos = textAreaRef.current?.selectionStart ?? inputValue.length;
        recordingStartStateRef.current = {
          beforeCursor: inputValue.slice(0, pos),
          afterCursor: inputValue.slice(pos),
          position: pos,
        };
      }
    }, [isRecording, inputValue]);

    const displayValue = useMemo(() => {
      if (isRecording && liveTranscript && recordingStartStateRef.current) {
        const { beforeCursor, afterCursor } = recordingStartStateRef.current;
        const separator =
          beforeCursor && !beforeCursor.endsWith(" ") ? " " : "";
        return beforeCursor + separator + liveTranscript + afterCursor;
      }
      return inputValue;
    }, [isRecording, liveTranscript, inputValue]);
    const hasDraftContentValue = hasDraftContent(inputValue, selectedImages);

    // Show cursor at insertion point during recording
    const recordingCursorPosition =
      isRecording && recordingStartStateRef.current
        ? recordingStartStateRef.current.position +
          (recordingStartStateRef.current.beforeCursor &&
          !recordingStartStateRef.current.beforeCursor.endsWith(" ")
            ? 1
            : 0)
        : 0;
    const highlightLayerRef = useRef<HTMLDivElement>(null);
    const shouldAutoScrollToCaretRef = useRef(false); // kade_change
    // kade_change start: Plus Menu State
    const [isPlusMenuVisible, setIsPlusMenuVisible] = useState(false);

    const requestSend = useCallback(() => {
      sendRequestGateRef.current.requestSend(onSend);
    }, [onSend]);

    const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1);
    const [selectedType, setSelectedType] =
      useState<ContextMenuOptionType | null>(null);
    const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] =
      useState(false);
    const [intendedCursorPosition, setIntendedCursorPosition] = useState<
      number | null
    >(null);
    const contextMenuContainerRef = useRef<HTMLDivElement>(null);
    const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
    // const [isFocused, setIsFocused] = useState(false) // kade_change - not needed
    // kade_change start: FIM autocomplete ghost text
    const {
      ghostText,
      handleKeyDown: handleGhostTextKeyDown,
      handleInputChange: handleGhostTextInputChange,
    } = useChatGhostText({
      textAreaRef,
      enableChatAutocomplete: false,
    });
    // kade_change end: FIM autocomplete ghost text
    const [imageWarning, setImageWarning] = useState<string | null>(null); // kade_change

    // Use custom hook for prompt history navigation
    const {
      handleHistoryNavigation,
      resetHistoryNavigation,
      resetOnInputChange,
    } = usePromptHistory({
      clineMessages,
      taskHistoryVersion,
      cwd, // kade_change
      inputValue,
      setInputValue,
    });

    // Fetch git commits when Git is selected or when typing a hash.
    useEffect(() => {
      if (
        selectedType === ContextMenuOptionType.Git ||
        /^[a-f0-9]+$/i.test(searchQuery)
      ) {
        const message: WebviewMessage = {
          type: "searchCommits",
          query: searchQuery || "",
        } as const;
        vscode.postMessage(message);
      }
    }, [selectedType, searchQuery]);

    const handleEnhancePrompt = useCallback(() => {
      const trimmedInput = inputValue.trim();

      if (trimmedInput) {
        setIsEnhancingPrompt(true);
        vscode.postMessage({
          type: "enhancePrompt" as const,
          text: trimmedInput,
        });
      } else {
        setInputValue(t("chat:enhancePromptDescription"));
      }
    }, [inputValue, setInputValue, t]);

    // kade_change start: Image and speech handlers
    const showImageWarning = useCallback(
      (messageKey: string) => {
        setImageWarning(messageKey);
      },
      [setImageWarning],
    );

    const dismissImageWarning = useCallback(() => {
      setImageWarning(null);
    }, [setImageWarning]);

    const handleMicrophoneClick = useCallback(() => {
      if (isRecording) {
        stopSTT();
      } else {
        startSTT(language || "en"); // Pass user's language from extension state
      }
    }, [isRecording, startSTT, stopSTT, language]);

    // kade_change start: Auto-clear images when model changes to non-image-supporting
    const prevShouldDisableImages = useRef<boolean>(shouldDisableImages);
    useEffect(() => {
      if (
        !prevShouldDisableImages.current &&
        shouldDisableImages &&
        selectedImages.length > 0
      ) {
        setSelectedImages([]);
        showImageWarning("kilocode:imageWarnings.imagesRemovedNoSupport");
      }
      prevShouldDisableImages.current = shouldDisableImages;
    }, [
      shouldDisableImages,
      selectedImages.length,
      setSelectedImages,
      showImageWarning,
    ]);
    // kade_change end: Auto-clear images when model changes to non-image-supporting

    const allModes = useMemo(() => getAllModes(customModes), [customModes]);

    // PERF: Only build queryItems when context menu is open to avoid processing 10k+ files constantly
    const queryItems = useMemo(() => {
      if (!showContextMenu) {
        return [];
      }
      return [
        { type: ContextMenuOptionType.Problems, value: "problems" },
        { type: ContextMenuOptionType.Terminal, value: "terminal" },
        ...gitCommits,
        ...openedTabs
          .filter((tab) => tab.path)
          .map((tab) => ({
            type: ContextMenuOptionType.OpenedFile,
            value: "/" + tab.path,
          })),
        ...filePaths
          .map((file) => "/" + file)
          .filter(
            (path) =>
              !openedTabs.some((tab) => tab.path && "/" + tab.path === path),
          ) // Filter out paths that are already in openedTabs
          .map((path) => ({
            type: path.endsWith("/")
              ? ContextMenuOptionType.Folder
              : ContextMenuOptionType.File,
            value: path,
          })),
      ];
    }, [showContextMenu, filePaths, gitCommits, openedTabs]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          contextMenuContainerRef.current &&
          !contextMenuContainerRef.current.contains(event.target as Node)
        ) {
          setShowContextMenu(false);
        }
      };

      if (showContextMenu) {
        document.addEventListener("mousedown", handleClickOutside);
      }

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [showContextMenu, setShowContextMenu]);

    const handleMentionSelect = useCallback(
      (type: ContextMenuOptionType, value?: string) => {
        if (type === ContextMenuOptionType.ResourceMonitor) {
          vscode.postMessage({ type: "switchTab", tab: "settings" });
          return;
        }
        if (type === ContextMenuOptionType.Image) {
          // kade_change start: Image selection handling
          // Close the context menu and remove the @character in this case
          setShowContextMenu(false);
          setSelectedType(null);

          if (textAreaRef.current) {
            const beforeCursor = textAreaRef.current.value.slice(
              0,
              cursorPosition,
            );
            const afterCursor = textAreaRef.current.value.slice(cursorPosition);
            const lastAtIndex = beforeCursor.lastIndexOf("@");

            if (lastAtIndex !== -1) {
              const newValue = beforeCursor.slice(0, lastAtIndex) + afterCursor;
              setInputValue(newValue);
            }
          }

          // Call the image selection function
          onSelectImages();
          return;
        } // kade_change end: Image selection handling

        if (type === ContextMenuOptionType.NoResults) {
          return;
        }

        if (type === ContextMenuOptionType.Mode && value) {
          // Handle mode selection.
          setMode(value);
          setInputValue("");
          setShowContextMenu(false);
          vscode.postMessage({ type: "mode", text: value });
          return;
        }

        if (
          type === ContextMenuOptionType.File ||
          type === ContextMenuOptionType.Folder ||
          type === ContextMenuOptionType.Git
        ) {
          if (!value) {
            setSelectedType(type);
            setSearchQuery("");
            setSelectedMenuIndex(0);
            return;
          }
        }

        setShowContextMenu(false);
        setSelectedType(null);

        if (textAreaRef.current) {
          let insertValue = value || "";

          if (type === ContextMenuOptionType.URL) {
            insertValue = value || "";
          } else if (
            type === ContextMenuOptionType.File ||
            type === ContextMenuOptionType.Folder
          ) {
            insertValue = value || "";
          } else if (type === ContextMenuOptionType.Problems) {
            insertValue = "problems";
          } else if (type === ContextMenuOptionType.Terminal) {
            insertValue = "terminal";
          } else if (type === ContextMenuOptionType.Git) {
            insertValue = value || "";
          }

          const { newValue, mentionIndex } = insertMention(
            textAreaRef.current.value,
            cursorPosition,
            insertValue,
          );

          setInputValue(newValue);
          const newCursorPosition =
            newValue.indexOf(" ", mentionIndex + insertValue.length) + 1;
          setCursorPosition(newCursorPosition);
          setIntendedCursorPosition(newCursorPosition);

          // Scroll to cursor.
          setTimeout(() => {
            if (textAreaRef.current) {
              textAreaRef.current.blur();
              textAreaRef.current.focus();
            }
          }, 0);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [setInputValue, cursorPosition],
    );

    const handleSlashCommandsSelect = useCallback(
      // kade_change start: Slash command selection
      (command: SlashCommand) => {
        setShowSlashCommandsMenu(false);

        // Handle mode switching commands
        const modeSwitchCommands = getAllModes(customModes).map(
          (mode) => mode.slug,
        );
        if (modeSwitchCommands.includes(command.name)) {
          // Switch to the selected mode
          setMode(command.name as Mode);
          setInputValue("");
          vscode.postMessage({ type: "mode", text: command.name });
          return;
        }

        // Handle other slash commands (like newtask)
        if (textAreaRef.current) {
          const { newValue, commandIndex } = insertSlashCommand(
            textAreaRef.current.value,
            command.name,
          );
          const newCursorPosition =
            newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1;

          setInputValue(newValue);
          setCursorPosition(newCursorPosition);
          setIntendedCursorPosition(newCursorPosition);

          setTimeout(() => {
            if (textAreaRef.current) {
              textAreaRef.current.blur();
              textAreaRef.current.focus();
            }
          }, 0);
        }
      },
      [setInputValue, setMode, customModes],
    ); // kade_change end: Slash command selection

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // kade_change start: pull slash commands from Cline
        if (showSlashCommandsMenu) {
          // kade_change start: Slash command menu navigation
          if (event.key === "Escape") {
            setShowSlashCommandsMenu(false);
            return;
          }

          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedSlashCommandsIndex((prevIndex) => {
              const direction = event.key === "ArrowUp" ? -1 : 1;
              const commands = getMatchingSlashCommands(
                slashCommandsQuery,
                customModes,
                localWorkflows,
                globalWorkflows,
              ); // kade_change

              if (commands.length === 0) {
                return prevIndex;
              }

              const newIndex =
                (prevIndex + direction + commands.length) % commands.length;
              return newIndex;
            });
            return;
          }

          if (
            (event.key === "Enter" || event.key === "Tab") &&
            selectedSlashCommandsIndex !== -1
          ) {
            event.preventDefault();
            const commands = getMatchingSlashCommands(
              slashCommandsQuery,
              customModes,
              localWorkflows,
              globalWorkflows,
            );
            if (commands.length > 0) {
              handleSlashCommandsSelect(commands[selectedSlashCommandsIndex]);
            }
            return;
          }
        } // kade_change end: Slash command menu navigation
        if (showContextMenu) {
          if (event.key === "Escape") {
            setShowContextMenu(false);
            setSelectedType(null);
            setSelectedMenuIndex(3); // File by default
            return;
          }

          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedMenuIndex((prevIndex) => {
              const direction = event.key === "ArrowUp" ? -1 : 1;
              const options = getContextMenuOptions(
                searchQuery,
                selectedType,
                queryItems,
                fileSearchResults,
                allModes,
              );
              const optionsLength = options.length;

              if (optionsLength === 0) return prevIndex;

              // Find selectable options (non-URL types)
              const selectableOptions = options.filter(
                (option) =>
                  option.type !== ContextMenuOptionType.URL &&
                  option.type !== ContextMenuOptionType.NoResults,
              );

              if (selectableOptions.length === 0) return -1; // No selectable options

              // Find the index of the next selectable option
              const currentSelectableIndex = selectableOptions.findIndex(
                (option) => option === options[prevIndex],
              );

              const newSelectableIndex =
                (currentSelectableIndex +
                  direction +
                  selectableOptions.length) %
                selectableOptions.length;

              // Find the index of the selected option in the original options array
              return options.findIndex(
                (option) => option === selectableOptions[newSelectableIndex],
              );
            });
            return;
          }
          if (
            (event.key === "Enter" || event.key === "Tab") &&
            selectedMenuIndex !== -1
          ) {
            event.preventDefault();
            const selectedOption = getContextMenuOptions(
              searchQuery,
              selectedType,
              queryItems,
              fileSearchResults,
              allModes,
            )[selectedMenuIndex];
            if (
              selectedOption &&
              selectedOption.type !== ContextMenuOptionType.URL &&
              selectedOption.type !== ContextMenuOptionType.NoResults
            ) {
              handleMentionSelect(selectedOption.type, selectedOption.value);
            }
            return;
          }
        }

        // kade_change start: FIM autocomplete - Tab to accept ghost text
        if (handleGhostTextKeyDown(event)) {
          return; // Event was handled by ghost text hook, stop here
        }
        // kade_change end: FIM autocomplete

        const isComposing = event.nativeEvent?.isComposing ?? false;

        const shouldSendMessage = // kade_change start: Send message handling
          !isComposing &&
          event.key === "Enter" &&
          ((sendMessageOnEnter && !event.shiftKey) ||
            (!sendMessageOnEnter && event.shiftKey));

        if (shouldSendMessage) {
          event.preventDefault();

          if (event.repeat) {
            return;
          }

          const trimmedInput = inputValue.trim();

          const preventFlow = handleSessionCommand(trimmedInput, setInputValue);

          if (preventFlow) {
            return;
          }

          if (!hasDraftContentValue) {
            return;
          }

          resetHistoryNavigation();
          requestSend();
        }

        // Handle prompt history navigation using custom hook
        if (handleHistoryNavigation(event, showContextMenu, isComposing)) {
          return;
        } // kade_change end: Send message handling

        if (event.key === "Backspace" && !isComposing) {
          const charBeforeCursor = inputValue[cursorPosition - 1];
          const charAfterCursor = inputValue[cursorPosition + 1];

          const charBeforeIsWhitespace =
            charBeforeCursor === " " ||
            charBeforeCursor === "\n" ||
            charBeforeCursor === "\r\n";

          const charAfterIsWhitespace =
            charAfterCursor === " " ||
            charAfterCursor === "\n" ||
            charAfterCursor === "\r\n";

          // Checks if char before cusor is whitespace after a mention.
          if (
            charBeforeIsWhitespace &&
            // "$" is added to ensure the match occurs at the end of the string.
            inputValue
              .slice(0, cursorPosition - 1)
              .match(new RegExp(mentionRegex.source + "$"))
          ) {
            const newCursorPosition = cursorPosition - 1;
            // If mention is followed by another word, then instead
            // of deleting the space separating them we just move
            // the cursor to the end of the mention.
            if (!charAfterIsWhitespace) {
              event.preventDefault();
              textAreaRef.current?.setSelectionRange(
                newCursorPosition,
                newCursorPosition,
              );
              setCursorPosition(newCursorPosition);
            }

            setCursorPosition(newCursorPosition);
            setJustDeletedSpaceAfterMention(true);
          } else if (justDeletedSpaceAfterMention) {
            const { newText, newPosition } = removeMention(
              inputValue,
              cursorPosition,
            );

            if (newText !== inputValue) {
              event.preventDefault();
              setInputValue(newText);
              setIntendedCursorPosition(newPosition); // Store the new cursor position in state
            }

            setJustDeletedSpaceAfterMention(false);
            setShowContextMenu(false);
          } else {
            setJustDeletedSpaceAfterMention(false);
          }
        }
      },
      [
        showSlashCommandsMenu, // kade_change start
        localWorkflows,
        globalWorkflows,
        customModes,
        handleSlashCommandsSelect,
        selectedSlashCommandsIndex,
        slashCommandsQuery,
        handleGhostTextKeyDown, // kade_change: FIM autocomplete
        // kade_change end
        onSend,
        showContextMenu,
        searchQuery,
        selectedMenuIndex,
        handleMentionSelect,
        selectedType,
        inputValue,
        cursorPosition,
        setInputValue,
        justDeletedSpaceAfterMention,
        queryItems,
        allModes,
        fileSearchResults,
        handleHistoryNavigation,
        resetHistoryNavigation,
        sendMessageOnEnter,
      ],
    );

    useLayoutEffect(() => {
      if (intendedCursorPosition !== null && textAreaRef.current) {
        textAreaRef.current.setSelectionRange(
          intendedCursorPosition,
          intendedCursorPosition,
        );
        setIntendedCursorPosition(null); // Reset the state.
      }
    }, [inputValue, intendedCursorPosition]);

    // Ref to store the search timeout.
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        // kade_change start
        const target = e.target;
        const newValue = target.value;
        const cursorAtEnd =
          target.selectionStart === target.selectionEnd &&
          target.selectionEnd === newValue.length;
        shouldAutoScrollToCaretRef.current = cursorAtEnd;
        // kade_change end

        setInputValue(newValue);

        // Reset history navigation when user types
        resetOnInputChange();

        handleGhostTextInputChange(e); // kade_change - FIM autocomplete

        const newCursorPosition = target.selectionStart; // Use target for consistency
        setCursorPosition(newCursorPosition);

        let showMenu = shouldShowContextMenu(newValue, newCursorPosition); // kade_change start: Slash command menu logic
        const showSlashCommandsMenu = shouldShowSlashCommandsMenu(
          newValue,
          newCursorPosition,
        );

        // we do not allow both menus to be shown at the same time
        // the slash commands menu has precedence bc its a narrower component
        if (showSlashCommandsMenu) {
          showMenu = false;
        }

        setShowSlashCommandsMenu(showSlashCommandsMenu); // kade_change end: Slash command menu logic

        setShowContextMenu(showMenu);

        if (showSlashCommandsMenu) {
          // kade_change start: Slash command query handling
          const slashIndex = newValue.indexOf("/");
          const query = newValue.slice(slashIndex + 1, newCursorPosition);
          setSlashCommandsQuery(query);
          setSelectedSlashCommandsIndex(0);
        } else {
          setSlashCommandsQuery("");
          setSelectedSlashCommandsIndex(0);
        } // kade_change end: Slash command query handling

        if (showMenu) {
          const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1);

          if (newValue.startsWith("/") && lastAtIndex === -1) {
            // kade_change: Prevent slash command conflict with mentions
            // Handle slash command.
            const query = newValue;
            setSearchQuery(query);
            setSelectedMenuIndex(0);
          } else {
            // Existing @ mention handling.
            const query = newValue.slice(lastAtIndex + 1, newCursorPosition);
            setSearchQuery(query);

            // Send file search request if query is not empty.
            if (query.length > 0) {
              setSelectedMenuIndex(0);

              // Don't clear results until we have new ones. This
              // prevents flickering.

              // Clear any existing timeout.
              if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
              }

              // Set a timeout to debounce the search requests.
              searchTimeoutRef.current = setTimeout(() => {
                // Generate a request ID for this search.
                const reqId = Math.random().toString(36).substring(2, 9);
                setSearchRequestId(reqId);
                setSearchLoading(true);

                // Send message to extension to search files.
                vscode.postMessage({
                  type: "searchFiles",
                  query: unescapeSpaces(query),
                  requestId: reqId,
                });
              }, 200); // 200ms debounce.
            } else {
              setSelectedMenuIndex(-1);
            }
          }
        } else {
          setSearchQuery("");
          setSelectedMenuIndex(-1);
          setFileSearchResults([]); // Clear file search results.
        }
      },
      [
        setInputValue,
        setSearchRequestId,
        setFileSearchResults,
        setSearchLoading,
        resetOnInputChange,
        handleGhostTextInputChange, // kade_change: FIM autocomplete
      ],
    );

    useEffect(() => {
      if (!showContextMenu) {
        setSelectedType(null);
      }
    }, [showContextMenu]);

    const handleBlur = useCallback(
      (e: React.FocusEvent) => {
        // Only hide the context menu if the user didn't click on it.
        if (!isMouseDownOnMenu) {
          setShowContextMenu(false);
          setShowSlashCommandsMenu(false);
        } // kade_change

        if (
          isEditMode &&
          onCancel &&
          containerRef.current &&
          !containerRef.current.contains(e.relatedTarget as Node)
        ) {
          onCancel();
        }

        // setIsFocused(false) // kade_change - not needed
      },
      [isMouseDownOnMenu, isEditMode, onCancel],
    );

    const handlePaste = useCallback(
      async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;

        const pastedText = e.clipboardData.getData("text");
        // Check if the pasted content is a URL, add space after so user
        // can easily delete if they don't want it.
        const urlRegex = /^\S+:\/\/\S+$/;
        if (urlRegex.test(pastedText.trim())) {
          e.preventDefault();
          const trimmedUrl = pastedText.trim();
          const newValue =
            inputValue.slice(0, cursorPosition) +
            trimmedUrl +
            " " +
            inputValue.slice(cursorPosition);
          setInputValue(newValue);
          const newCursorPosition = cursorPosition + trimmedUrl.length + 1;
          setCursorPosition(newCursorPosition);
          setIntendedCursorPosition(newCursorPosition);
          setShowContextMenu(false);

          // Scroll to new cursor position.
          setTimeout(() => {
            if (textAreaRef.current) {
              textAreaRef.current.blur();
              textAreaRef.current.focus();
            }
          }, 0);

          return;
        }

        const acceptedTypes = ["png", "jpeg", "webp"];

        const imageItems = Array.from(items).filter((item) => {
          const [type, subtype] = item.type.split("/");
          return type === "image" && acceptedTypes.includes(subtype);
        });

        if (imageItems.length > 0) {
          // kade_change start: Image paste validation
          e.preventDefault();

          if (shouldDisableImages) {
            showImageWarning(`kilocode:imageWarnings.modelNoImageSupport`);
            return;
          }
          if (selectedImages.length >= MAX_IMAGES_PER_MESSAGE) {
            showImageWarning(`kilocode:imageWarnings.maxImagesReached`);
            return;
          } // kade_change end: Image paste validation

          const imagePromises = imageItems.map((item) => {
            return new Promise<string | null>((resolve) => {
              const blob = item.getAsFile();

              if (!blob) {
                resolve(null);
                return;
              }

              const reader = new FileReader();

              reader.onloadend = () => {
                if (reader.error) {
                  console.error(t("chat:errorReadingFile"), reader.error);
                  resolve(null);
                } else {
                  const result = reader.result;
                  resolve(typeof result === "string" ? result : null);
                }
              };

              reader.readAsDataURL(blob);
            });
          });

          const imageDataArray = await Promise.all(imagePromises);
          const dataUrls = imageDataArray.filter(
            (dataUrl): dataUrl is string => dataUrl !== null,
          );

          if (dataUrls.length > 0) {
            setSelectedImages((prevImages) =>
              [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
            );
          } else {
            console.warn(t("chat:noValidImages"));
          }
        }
      },
      [
        shouldDisableImages,
        setSelectedImages,
        cursorPosition,
        setInputValue,
        inputValue,
        t,
        selectedImages.length,
        showImageWarning, // kade_change
      ],
    );

    const handleMenuMouseDown = useCallback(() => {
      setIsMouseDownOnMenu(true);
    }, []);

    const updateHighlights = useCallback(() => {
      if (!textAreaRef.current || !highlightLayerRef.current) return;

      let processedText = textAreaRef.current.value; // kade_change start: Slash command highlighting

      processedText = processedText
        .replace(/\n$/, "\n\n")
        .replace(
          /[<>&]/g,
          (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c,
        )
        .replace(
          mentionRegexGlobal,
          '<mark class="mention-context-textarea-highlight" style="pointer-events: auto; cursor: pointer; color: var(--vscode-textLink-foreground); background-color: var(--vscode-button-secondaryBackground); border-radius: 4px;">$&</mark>',
        );

      // check for highlighting /slash-commands
      if (/^\s*\//.test(processedText)) {
        const slashIndex = processedText.indexOf("/");

        // end of command is end of text or first whitespace
        const spaceIndex = processedText.indexOf(" ", slashIndex);
        const endIndex = spaceIndex > -1 ? spaceIndex : processedText.length;

        // extract and validate the exact command text
        const commandText = processedText.substring(slashIndex + 1, endIndex);
        const isValidCommand = validateSlashCommand(commandText, customModes);

        if (isValidCommand) {
          const fullCommand = processedText.substring(slashIndex, endIndex); // includes slash

          const highlighted = `<mark class="slash-command-match-textarea-highlight">${fullCommand}</mark>`;
          processedText =
            processedText.substring(0, slashIndex) +
            highlighted +
            processedText.substring(endIndex);
        }
      }

      // kade_change start - STT preview text highlighting
      if (
        isRecording &&
        previewRanges.length > 0 &&
        recordingStartStateRef.current
      ) {
        const { beforeCursor } = recordingStartStateRef.current;
        const separator =
          beforeCursor && !beforeCursor.endsWith(" ") ? " " : "";
        const baseOffset = beforeCursor.length + separator.length;
        for (let i = previewRanges.length - 1; i >= 0; i--) {
          const range = previewRanges[i];
          const start = baseOffset + range.start;
          const end = baseOffset + range.end;

          const before = processedText.substring(0, start);
          const previewText = processedText.substring(start, end);
          const after = processedText.substring(end);

          processedText =
            before +
            `<span class="stt-preview-text">${previewText}</span>` +
            after;
        }
      }
      // kade_change end - STT preview text highlighting
      // kade_change start - autocomplete ghost text display
      if (inputValue && ghostText) {
        processedText += `<span class="text-vscode-editor-foreground opacity-60 pointer-events-none">${escapeHtml(ghostText)}</span>`;
      }
      // kade_change end - autocomplete ghost text display

      highlightLayerRef.current.innerHTML = processedText;
      highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop;
      highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft;
    }, [customModes, ghostText, inputValue, isRecording, previewRanges]); // kade_change - merged dependencies

    useLayoutEffect(() => {
      updateHighlights();

      // kade_change start
      if (!shouldAutoScrollToCaretRef.current) {
        return;
      }

      shouldAutoScrollToCaretRef.current = false;

      if (!textAreaRef.current) {
        return;
      }

      const rafId = requestAnimationFrame(() => {
        if (!textAreaRef.current) {
          return;
        }

        textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
        updateHighlights();
      });

      return () => cancelAnimationFrame(rafId);
      // kade_change end
    }, [inputValue, liveTranscript, updateHighlights]);

    const updateCursorPosition = useCallback(() => {
      if (textAreaRef.current) {
        setCursorPosition(textAreaRef.current.selectionStart);
      }
    }, []);

    const handleKeyUp = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(e.key)
        ) {
          updateCursorPosition();
        }
      },
      [updateCursorPosition],
    );

    const handleDrop = useCallback(
      async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingOver(false);

        const textFieldList = e.dataTransfer.getData("text");
        const textUriList = e.dataTransfer.getData(
          "application/vnd.code.uri-list",
        );
        // When textFieldList is empty, it may attempt to use textUriList obtained from drag-and-drop tabs; if not empty, it will use textFieldList.
        const text = textFieldList || textUriList;
        if (text) {
          // Split text on newlines to handle multiple files
          const lines = text
            .split(/\r?\n/)
            .filter((line) => line.trim() !== "");

          if (lines.length > 0) {
            // Process each line as a separate file path
            let newValue = inputValue.slice(0, cursorPosition);
            let totalLength = 0;

            // Using a standard for loop instead of forEach for potential performance gains.
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              // Convert each path to a mention-friendly format
              const mentionText = convertToMentionPath(line, cwd);
              newValue += mentionText;
              totalLength += mentionText.length;

              // Add space after each mention except the last one
              if (i < lines.length - 1) {
                newValue += " ";
                totalLength += 1;
              }
            }

            // Add space after the last mention and append the rest of the input
            newValue += " " + inputValue.slice(cursorPosition);
            totalLength += 1;

            setInputValue(newValue);
            const newCursorPosition = cursorPosition + totalLength;
            setCursorPosition(newCursorPosition);
            setIntendedCursorPosition(newCursorPosition);
          }

          return;
        }

        const files = Array.from(e.dataTransfer.files);

        if (files.length > 0) {
          const acceptedTypes = ["png", "jpeg", "webp"];

          const imageFiles = files.filter((file) => {
            const [type, subtype] = file.type.split("/");
            return type === "image" && acceptedTypes.includes(subtype);
          });

          // kade_change start: Image validation with warning messages for drag and drop
          if (imageFiles.length > 0) {
            if (shouldDisableImages) {
              showImageWarning("kilocode:imageWarnings.modelNoImageSupport");
              return;
            }
            if (selectedImages.length >= MAX_IMAGES_PER_MESSAGE) {
              showImageWarning("kilocode:imageWarnings.maxImagesReached");
              return;
            }
            // kade_change end: Image validation with warning messages for drag and drop

            const imagePromises = imageFiles.map((file) => {
              return new Promise<string | null>((resolve) => {
                const reader = new FileReader();

                reader.onloadend = () => {
                  if (reader.error) {
                    console.error(t("chat:errorReadingFile"), reader.error);
                    resolve(null);
                  } else {
                    const result = reader.result;
                    resolve(typeof result === "string" ? result : null);
                  }
                };

                reader.readAsDataURL(file);
              });
            });

            const imageDataArray = await Promise.all(imagePromises);
            const dataUrls = imageDataArray.filter(
              (dataUrl): dataUrl is string => dataUrl !== null,
            );

            if (dataUrls.length > 0) {
              setSelectedImages((prevImages) =>
                [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
              );

              if (typeof vscode !== "undefined") {
                vscode.postMessage({
                  type: "draggedImages",
                  dataUrls: dataUrls,
                });
              }
            } else {
              console.warn(t("chat:noValidImages"));
            }
          }
        }
      },
      [
        cursorPosition,
        cwd,
        inputValue,
        setInputValue,
        setCursorPosition,
        setIntendedCursorPosition,
        shouldDisableImages,
        setSelectedImages,
        t,
        selectedImages.length, // kade_change - added selectedImages.length
        showImageWarning, // kade_change - added showImageWarning
      ],
    );

    const [isTtsPlaying, setIsTtsPlaying] = useState(false);

    useEvent("message", (event: MessageEvent) => {
      const message: ExtensionMessage = event.data;

      if (message.type === "ttsStart") {
        setIsTtsPlaying(true);
      } else if (message.type === "ttsStop") {
        setIsTtsPlaying(false);
      }
    });

    const placeholderBottomText = `\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`;

    // Common mode selector handler
    const handleModeChange = useCallback(
      (value: Mode) => {
        setMode(value);
        vscode.postMessage({ type: "mode", text: value });
      },
      [setMode],
    );

    // Helper function to render mode
    // kade_change: unused
    const _renderModeSelector = () => (
      <ModeSelector
        value={mode}
        title={t("chat:selectMode")}
        onChange={handleModeChange}
        triggerClassName="w-full"
        modeShortcutText={modeShortcutText}
        customModes={customModes}
        customModePrompts={customModePrompts}
      />
    );

    // Helper function to get API config dropdown options
    // kade_change: unused
    const _getApiConfigOptions = useMemo(() => {
      const pinnedConfigs = (listApiConfigMeta || [])
        .filter((config) => pinnedApiConfigs && pinnedApiConfigs[config.id])
        .map((config) => ({
          value: config.id,
          label: config.name,
          name: config.name,
          type: DropdownOptionType.ITEM,
          pinned: true,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const unpinnedConfigs = (listApiConfigMeta || [])
        .filter((config) => !pinnedApiConfigs || !pinnedApiConfigs[config.id])
        .map((config) => ({
          value: config.id,
          label: config.name,
          name: config.name,
          type: DropdownOptionType.ITEM,
          pinned: false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const hasPinnedAndUnpinned =
        pinnedConfigs.length > 0 && unpinnedConfigs.length > 0;

      return [
        ...pinnedConfigs,
        ...(hasPinnedAndUnpinned
          ? [
              {
                value: "sep-pinned",
                label: t("chat:separator"),
                type: DropdownOptionType.SEPARATOR,
              },
            ]
          : []),
        ...unpinnedConfigs,
        {
          value: "sep-2",
          label: t("chat:separator"),
          type: DropdownOptionType.SEPARATOR,
        },
        {
          value: "settingsButtonClicked",
          label: t("chat:edit"),
          type: DropdownOptionType.ACTION,
        },
      ];
    }, [listApiConfigMeta, pinnedApiConfigs, t]);

    // Helper function to handle API config change
    // kade_change: unused
    const _handleApiConfigChange = useCallback((value: string) => {
      if (value === "settingsButtonClicked") {
        vscode.postMessage({
          type: "loadApiConfiguration",
          text: value,
          values: { section: "providers" },
        });
      } else {
        vscode.postMessage({ type: "loadApiConfigurationById", text: value });
      }
    }, []);

    // Helper function to render API config item
    // kade_change: unused
    const _renderApiConfigItem = useCallback(
      ({ type, value, label, pinned }: any) => {
        if (type !== DropdownOptionType.ITEM) {
          return label;
        }

        const config = listApiConfigMeta?.find((c) => c.id === value);
        const isCurrentConfig = config?.name === currentApiConfigName;

        return (
          <div className="flex justify-between gap-2 w-full h-5">
            <div
              className={cn("truncate min-w-0 overflow-hidden", {
                "font-medium": isCurrentConfig,
              })}
            >
              {label}
            </div>
            <div className="flex justify-end w-10 flex-shrink-0">
              <div
                className={cn("size-5 p-1", {
                  "block group-hover:hidden": !pinned,
                  hidden: !isCurrentConfig,
                })}
              >
                <Check className="size-3" />
              </div>
              <StandardTooltip
                content={pinned ? t("chat:unpin") : t("chat:pin")}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinnedApiConfig(value);
                    vscode.postMessage({
                      type: "toggleApiConfigPin",
                      text: value,
                    });
                  }}
                  className={cn("size-5", {
                    "hidden group-hover:flex": !pinned,
                    "bg-accent": pinned,
                  })}
                >
                  <Pin className="size-3 p-0.5 opacity-50" />
                </Button>
              </StandardTooltip>
            </div>
          </div>
        );
      },
      [listApiConfigMeta, currentApiConfigName, t, togglePinnedApiConfig],
    );

    // Helper function to render the text area section
    const renderTextAreaSection = () => (
      <div className="relative w-full flex flex-col">
        <div
          ref={highlightLayerRef}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.classList.contains("mention-context-textarea-highlight")
            ) {
              let text = target.textContent?.substring(1).trim(); // remove @ and trim whitespace
              if (text) {
                // kade_change: Strip leading slash for workspace-relative paths to fix Mac compatibility
                if (text.startsWith("/")) {
                  text = text.substring(1);
                }
                vscode.postMessage({ type: "openFile", text });
              }
            }
          }}
          className={cn(
            "absolute",
            "inset-0",
            "pointer-events-none",
            "whitespace-pre-wrap",
            "break-words",
            "text-transparent",
            "overflow-hidden",
            "font-vscode-font-family",
            "text-vscode-editor-font-size",
            "leading-vscode-editor-line-height",
            isDraggingOver
              ? "border-2 border-dashed border-vscode-focusBorder"
              : "border border-transparent",
            "py-2 px-3", // kade_change: reduce vertical padding
            "z-10",
            "forced-color-adjust-none",
          )}
          style={{
            color: "transparent",
          }}
        />
        <DynamicTextArea
          ref={(el) => {
            if (typeof ref === "function") {
              ref(el);
            } else if (ref) {
              ref.current = el;
            }
            textAreaRef.current = el;
          }}
          value={displayValue}
          onChange={(e) => {
            // During recording, ignore changes to prevent cursor jumping
            if (!isRecording) {
              handleInputChange(e);
              updateHighlights();
            }
          }}
          onKeyDown={(e) => {
            // Handle ESC to cancel in edit mode
            if (
              isEditMode &&
              e.key === "Escape" &&
              !e.nativeEvent?.isComposing
            ) {
              e.preventDefault();
              onCancel?.();
              return;
            }
            handleKeyDown(e);
          }}
          onKeyUp={handleKeyUp}
          onBlur={handleBlur}
          onPaste={handlePaste}
          onSelect={updateCursorPosition}
          onMouseUp={updateCursorPosition}
          onHeightChange={(height) => {
            if (
              textAreaBaseHeight === undefined ||
              height < textAreaBaseHeight
            ) {
              setTextAreaBaseHeight(height);
            }

            onHeightChange?.(height);
          }}
          placeholder={`${placeholderText}`} // kade_change: single line placeholder to keep size small
          minRows={1}
          maxRows={15}
          autoFocus={true}
          style={{
            border: isRecording
              ? "1px solid var(--vscode-editorError-foreground)"
              : "1px solid transparent",
            outline: "none",
            boxShadow: "none",
          }}
          className={cn(
            "w-full",
            "text-vscode-input-foreground",
            "font-vscode-font-family",
            "text-vscode-editor-font-size",
            "leading-vscode-editor-line-height",
            "cursor-text",
            "py-2 px-3", // kade_change: reduce vertical padding
            "focus:outline-none focus:ring-0 focus:border-transparent",
            isDraggingOver
              ? "bg-[color-mix(in_srgb,var(--vscode-input-background)_95%,var(--vscode-focusBorder))]"
              : "bg-transparent", // Transparent to match container
            "transition-background-color duration-150 ease-in-out",
            "will-change-background-color",
            "resize-none",
            "overflow-x-hidden",
            "overflow-y-auto",
            "flex-none flex-grow",
            "z-[2]",
            "scrollbar-none",
            "scrollbar-hide",
          )}
          onScroll={() => updateHighlights()}
        />

        {/* kade_change: Visual cursor indicator during voice recording */}
        <VoiceRecordingCursor
          textAreaRef={textAreaRef}
          cursorPosition={recordingCursorPosition}
          isVisible={isRecording}
        />
        {selectedImages.length > 0 && (
          <Thumbnails
            images={selectedImages}
            setImages={setSelectedImages}
            onOpenImage={onOpenImage}
            style={{
              paddingTop: "8px",
              paddingLeft: "8px",
              paddingRight: "8px",
            }}
          />
        )}
      </div>
    );

    return (
      <div
        ref={containerRef}
        className={cn(
          "flex w-full min-w-0 flex-col gap-2 relative bg-transparent",
          !isEditMode && "pl-4 pr-5 pt-4 pb-[13px]",
        )}
      >
        {showContextMenu && (
          <div
            ref={contextMenuContainerRef}
            className={cn(
              "absolute",
              "bottom-full",
              "left-0",
              "right-0",
              "z-[1000]",
              "mb-2",
              // kade_change: Remove filter/drop-shadow which breaks backdrop-blur in children
              !isEditMode && "pl-4 pr-5",
            )}
          >
            <ContextMenu
              onSelect={handleMentionSelect}
              searchQuery={searchQuery}
              inputValue={inputValue}
              onMouseDown={handleMenuMouseDown}
              selectedIndex={selectedMenuIndex}
              setSelectedIndex={setSelectedMenuIndex}
              selectedType={selectedType}
              queryItems={queryItems}
              modes={allModes}
              loading={searchLoading}
              dynamicSearchResults={fileSearchResults}
            />
          </div>
        )}
        <div
          className={cn(
            "flex flex-col rounded-xl overflow-hidden relative transition-colors backdrop-blur-md border-[0.8px] border-white/[0.12]",
            isEnhancingPrompt &&
              "rainbow-border border-transparent focus-within:ring-0 focus-within:border-transparent",
          )}
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--vscode-dropdown-background) 70%, black)",
            boxShadow: "none",
          }}
        >
          <div
            className={cn(
              "chat-text-area",
              "relative",
              "flex",
              "flex-col",
              "outline-none",
              "px-0.5",
              "pt-0",
              "pb-2",
            )} // kade_change: reduced padding
            onDrop={handleDrop}
            onDragOver={(e) => {
              // Only allowed to drop images/files on shift key pressed.
              if (!e.shiftKey) {
                setIsDraggingOver(false);
                return;
              }

              e.preventDefault();
              setIsDraggingOver(true);
              e.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();

              if (
                e.clientX <= rect.left ||
                e.clientX >= rect.right ||
                e.clientY <= rect.top ||
                e.clientY >= rect.bottom
              ) {
                setIsDraggingOver(false);
              }
            }}
          >
            {/* kade_change start: ImageWarningBanner integration */}
            <ImageWarningBanner
              messageKey={imageWarning ?? ""}
              onDismiss={dismissImageWarning}
              isVisible={!!imageWarning}
            />
            {/* kade_change end: ImageWarningBanner integration */}
            {/* kade_change start: pull slash commands from Cline */}
            {showSlashCommandsMenu && (
              <div ref={slashCommandsMenuContainerRef}>
                <SlashCommandMenu
                  onSelect={handleSlashCommandsSelect}
                  selectedIndex={selectedSlashCommandsIndex}
                  setSelectedIndex={setSelectedSlashCommandsIndex}
                  onMouseDown={handleMenuMouseDown}
                  query={slashCommandsQuery}
                  customModes={customModes}
                />
              </div>
            )}
            {/* kade_change end: pull slash commands from Cline */}

            {renderTextAreaSection()}
          </div>

          <div className="flex flex-wrap justify-between items-center px-2 pb-1 pt-0 gap-1.5 min-w-0 overflow-hidden">
            {/* Left: Selectors */}
            <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-0 min-w-0 max-w-full flex-nowrap overflow-hidden">
                {/* kade_change start: Plus Menu */}

                {/* kade_change end */}

                {/* kade_change start: KiloModeSelector instead of ModeSelector */}
                <KiloModeSelector
                  value={mode}
                  onChange={setMode}
                  modeShortcutText={modeShortcutText}
                  customModes={customModes}
                  hideLabel={useCompactModeSelector}
                  triggerClassName="max-w-full translate-y-[-0.57px]"
                />
                {/* kade_change end */}

                {/* kade_change: Move ModelSelector here */}
                {apiConfiguration && (
                  <div
                    className="flex min-w-0 max-w-full mt-[-0.1px]"
                    data-testid="model-selector"
                  >
                    <ModelSelector
                      currentApiConfigName={currentApiConfigName}
                      apiConfiguration={apiConfiguration}
                      fallbackText={`${selectedProvider}:${selectedModelId}`}
                      virtualQuotaActiveModel={
                        virtualQuotaActiveModel
                          ? {
                              id: virtualQuotaActiveModel.id,
                              name: virtualQuotaActiveModel.id,
                            }
                          : undefined
                      }
                      scope={task ? "task" : "global"}
                    />
                  </div>
                )}

                {/* kade_change start: Plus Menu (Moved to right of ModelSelector) */}
                <Popover
                  open={isPlusMenuVisible}
                  onOpenChange={setIsPlusMenuVisible}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center justify-center p-0 rounded-sm hover:opacity-100 opacity-60 text-vscode-descriptionForeground transition-opacity shrink-0 mt-[-0.4px]",
                        "cursor-pointer",
                      )}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className={cn(
                      "w-auto min-w-[140px] p-1 bg-vscode-dropdown-background/90 backdrop-blur-md border border-vscode-dropdown-border rounded-lg",
                      isIndexingMenuOpen && "opacity-0 pointer-events-none",
                    )}
                    side="top"
                    align="start"
                  >
                    <div className="flex flex-col gap-0.5">
                      {/* Mentions / Add Context */}
                      <button
                        onClick={() => {
                          if (showContextMenu || !textAreaRef.current) return;
                          textAreaRef.current.focus();
                          setInputValue(`${inputValue} @`);
                          setShowContextMenu(true);
                          setSearchQuery("");
                          setSelectedMenuIndex(4);
                          setIsPlusMenuVisible(false);
                        }}
                        disabled={showContextMenu}
                        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-vscode-list-hoverBackground disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-vscode-foreground"
                      >
                        <AtSign className="w-4 h-4 opacity-70" />
                        <span>Mentions</span>
                      </button>

                      {/* Enhance Prompt */}
                      <button
                        onClick={() => {
                          handleEnhancePrompt();
                          setIsPlusMenuVisible(false);
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-vscode-list-hoverBackground cursor-pointer text-vscode-foreground"
                      >
                        <WandSparkles
                          className={cn(
                            "w-4 h-4 opacity-70",
                            isEnhancingPrompt && "animate-spin",
                          )}
                        />
                        <span>Enhance Prompt</span>
                      </button>

                      {/* Indexing Status */}
                      <IndexingStatusBadge
                        label="Index Codebase"
                        className="text-sm"
                        open={isIndexingMenuOpen}
                        onOpenChange={handleIndexingMenuOpenChange}
                        onClick={() => setIsIndexingMenuOpen(true)}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
                {/* kade_change end */}

                {/* kade_change: Action Buttons Pill */}
                {(primaryButtonText || secondaryButtonText) && (
                  <div
                    className={cn(
                      "flex items-center gap-0.5 ml-0.5 origin-left",
                      primaryButtonVariant === "minimal"
                        ? "scale-100"
                        : "scale-90",
                    )}
                  >
                    {primaryButtonText &&
                      (!isStreaming ||
                        primaryButtonText.includes("Proceed")) && (
                        <Button
                          disabled={!enableButtons}
                          onClick={() =>
                            onPrimaryButtonClick?.(inputValue, selectedImages)
                          }
                          className={cn(
                            primaryButtonVariant === "minimal"
                              ? [
                                  "h-4 w-4 p-0 rounded-md shadow-none",
                                  "border border-transparent bg-transparent text-vscode-foreground/60",
                                  "hover:bg-vscode-foreground/[0.05] hover:text-vscode-foreground hover:border-vscode-foreground/[0.1]",
                                ]
                              : [
                                  "h-6 px-3 text-xs font-medium rounded-full",
                                  "bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground",
                                  "shimmer-btn",
                                ],
                          )}
                        >
                          {primaryButtonVariant === "minimal" ? (
                            <Play className="size-2.5 fill-current" />
                          ) : (
                            primaryButtonText
                          )}
                        </Button>
                      )}
                    {secondaryButtonText && (
                      <Button
                        disabled={!enableButtons}
                        onClick={() =>
                          onSecondaryButtonClick?.(inputValue, selectedImages)
                        }
                        className={cn(
                          "h-6 px-3 text-xs font-medium rounded-full",
                          "bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground",
                        )}
                      >
                        {secondaryButtonText}
                      </Button>
                    )}
                  </div>
                )}
                {/* kade_change end */}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 min-w-0">
              <div className="ml-1.5 flex items-center">
                <KiloProfileSelector
                  currentConfigId={currentConfigId}
                  currentApiConfigName={currentApiConfigName}
                  displayName={displayName}
                  listApiConfigMeta={listApiConfigMeta}
                  pinnedApiConfigs={pinnedApiConfigs}
                  togglePinnedApiConfig={togglePinnedApiConfig}
                  selectApiConfigDisabled={selectApiConfigDisabled}
                />
              </div>
              {showAutoApproveMenu && <AutoApproveDropdown />}
              {safeContextWindow > 0 && (
                <StandardTooltip content={contextUsageLabel}>
                  <button
                    type="button"
                    aria-label={
                      canOpenTaskPopover
                        ? "Open task info from context usage"
                        : contextUsageTooltip
                    }
                    aria-disabled={!canOpenTaskPopover}
                    onClick={() => openTaskPopover(true)}
                    className={cn(
                      "relative inline-flex items-center justify-center",
                      "bg-transparent border-none text-vscode-foreground",
                      "rounded-md w-6 h-6 p-1",
                      "opacity-80 hover:opacity-100",
                      "transition-all duration-150 translate-x-[0.2px] translate-y-[0.4px]",
                      "hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
                      "active:bg-[rgba(255,255,255,0.1)]",
                      canOpenTaskPopover ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    <svg className="-rotate-90 w-4 h-4" viewBox="0 0 24 24">
                      <circle
                        strokeWidth="4"
                        stroke="rgba(85, 85, 85, 0.33)"
                        fill="transparent"
                        r="10"
                        cx="12"
                        cy="12"
                      />
                      <circle
                        style={{
                          stroke: "var(--vscode-foreground)",
                          transition: "stroke-dashoffset 0.3s ease",
                        }}
                        strokeWidth="4"
                        strokeDasharray={2 * Math.PI * 10}
                        strokeDashoffset={
                          2 * Math.PI * 10 * (1 - contextUsagePercent / 100)
                        }
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r="10"
                        cx="12"
                        cy="12"
                      />
                    </svg>
                  </button>
                </StandardTooltip>
              )}
              {isTtsPlaying && (
                <StandardTooltip content={t("chat:stopTts")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-50 hover:opacity-100"
                    onClick={() => vscode.postMessage({ type: "stopTts" })}
                  >
                    <VolumeX className="size-4" />
                  </Button>
                </StandardTooltip>
              )}

              {isRecording && (
                <VolumeVisualizer volume={volumeLevel} isActive={isRecording} />
              )}

              {/* kade_change start: Task Popover */}
              {task &&
                handleCondenseContext &&
                onCloseTask &&
                groupedMessages && (
                  <Popover
                    open={isTaskPopoverOpen}
                    onOpenChange={handleTaskPopoverOpenChange}
                  >
                    <StandardTooltip content="Task Info">
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="Task Info"
                          onClick={() => setTaskPopoverDefaultExpanded(false)}
                          className={cn(
                            "relative inline-flex items-center justify-center",
                            "bg-transparent border-none p-1",
                            "rounded-md w-6 h-6",
                            "opacity-80 hover:opacity-100 text-vscode-foreground",
                            "transition-all duration-150",
                            "hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
                            "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
                            "active:bg-[rgba(255,255,255,0.1)]",
                            "cursor-pointer",
                          )}
                        >
                          <List className={cn("w-4 h-4")} />
                        </button>
                      </PopoverTrigger>
                    </StandardTooltip>
                    <PopoverContent
                      className="w-[calc(100vw-32px)] max-w-[400px] p-0 border-vscode-input-border bg-popover/40 backdrop-blur-2xl rounded-2xl"
                      side="top"
                      align="end"
                      collisionPadding={16}
                      avoidCollisions={true}
                      container={portalContainer}
                    >
                      <KiloTaskHeader
                        task={task}
                        tokensIn={tokensIn || 0}
                        tokensOut={tokensOut || 0}
                        cacheWrites={cacheWrites}
                        cacheReads={cacheReads}
                        totalCost={totalCost || 0}
                        contextTokens={contextTokens || 0}
                        buttonsDisabled={sendingDisabled}
                        handleCondenseContext={handleCondenseContext}
                        onClose={onCloseTask}
                        groupedMessages={groupedMessages}
                        onMessageClick={onMessageClick}
                        isTaskActive={sendingDisabled} // Reusing sendingDisabled as proxy for isTaskActive like ChatView did
                        todos={todos}
                        defaultExpanded={taskPopoverDefaultExpanded}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              {/* kade_change end */}

              <StandardTooltip content={t("chat:addImages")}>
                <button
                  type="button"
                  aria-label={t("chat:addImages")}
                  disabled={shouldDisableImages}
                  onClick={onSelectImages}
                  className={cn(
                    "relative inline-flex items-center justify-center",
                    "bg-transparent border-none p-1",
                    "rounded-md w-6 h-6",
                    "text-vscode-foreground",
                    "transition-all duration-150 -ml-[2.4px]",
                    "opacity-80 hover:opacity-100",
                    "hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
                    "active:bg-[rgba(255,255,255,0.1)]",
                    !shouldDisableImages && "cursor-pointer",
                    shouldDisableImages &&
                      "opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
                  )}
                >
                  <ImageIcon
                    className={cn("w-3.5", "h-3.5", {
                      hidden: containerWidth < 235,
                    })}
                  />
                </button>
              </StandardTooltip>
              {/* kade_change end */}

              {/* kade_change start: Show microphone button only if experiment enabled */}
              {experiments?.speechToText && (
                <div className="flex items-center gap-1">
                  {isModelLoading && modelLoadingProgress && (
                    <span className="text-[10px] opacity-60 truncate max-w-[100px] animate-pulse">
                      {modelLoadingProgress}
                    </span>
                  )}
                  <MicrophoneButton
                    isRecording={isRecording}
                    isLoading={isModelLoading && !isRecording}
                    onClick={handleMicrophoneClick}
                    // Only disable if we confirm it's UNAVAILABLE_MISSING_KEY or UNAVAILABLE_FFMPEG
                    // but ignore if it's local (which doesn't need cloud keys/ffmpeg)
                    disabled={
                      sttProvider !== "local" &&
                      speechToTextStatus?.available === false
                    }
                    tooltipContent={
                      sttProvider !== "local" &&
                      speechToTextStatus?.available === false &&
                      speechToTextStatus.reason
                        ? speechToTextStatus.reason === "apiKeyMissing"
                          ? t("kilocode:speechToText.unavailableApiKeyMissing")
                          : speechToTextStatus.reason === "ffmpegNotInstalled"
                            ? t(
                                "kilocode:speechToText.unavailableFfmpegNotInstalled",
                              )
                            : t("kilocode:speechToText.unavailableBoth")
                        : undefined
                    }
                  />
                </div>
              )}
              {/* kade_change end */}

              <div className="relative w-[19px] h-[19px]">
                <AnimatePresence initial={false}>
                  {isStreaming ? (
                    <motion.div
                      key="stop"
                      className="absolute inset-0"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 90 }}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 20,
                      }}
                    >
                      <StandardTooltip content={t("chat:cancel.title")}>
                        <button
                          aria-label={t("chat:cancel.title")}
                          onClick={onStop}
                          className={cn(
                            "relative inline-flex items-center justify-center",
                            "bg-vscode-button-foreground p-0.5",
                            "rounded-full w-5 h-5",
                            "text-vscode-editor-background",
                            "hover:opacity-90",
                            "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
                            "cursor-pointer",
                          )}
                        >
                          <Square className="w-3 h-3 fill-current" />
                        </button>
                      </StandardTooltip>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="send"
                      className="absolute inset-0"
                      initial={{ scale: 0, rotate: 90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: -90 }}
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 30,
                      }}
                    >
                      <StandardTooltip
                        content={isEditMode ? "Unsend" : t("chat:sendMessage")}
                      >
                        <button
                          aria-label={
                            isEditMode ? "Unsend" : t("chat:sendMessage")
                          }
                          disabled={
                            !isEditMode &&
                            (sendingDisabled || !hasDraftContentValue)
                          }
                          onClick={
                            isEditMode
                              ? onDelete || onCancel
                              : !sendingDisabled && hasDraftContentValue
                                ? requestSend
                                : undefined
                          }
                          className={cn(
                            "kade-send-button relative inline-flex items-center justify-center",
                            "rounded-full w-[19px] h-[19px] p-0.5",
                            hasDraftContentValue
                              ? "bg-vscode-button-foreground text-vscode-editor-background"
                              : "bg-white/[0.18] text-vscode-input-background",

                            "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
                            (isEditMode ||
                              (!sendingDisabled && hasDraftContentValue)) &&
                              "cursor-pointer",
                            !isEditMode &&
                              (sendingDisabled || !hasDraftContentValue) &&
                              "opacity-55 cursor-not-allowed",
                          )}
                        >
                          {isEditMode ? (
                            <Undo2 className="w-3 h-3" />
                          ) : (
                            <ArrowUp className="w-2.5 h-2.5" />
                          )}
                        </button>
                      </StandardTooltip>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Thumbnails moved inside */}
      </div>
    );
  },
);
