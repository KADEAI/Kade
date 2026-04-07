import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { AnimatedAccordion } from "../common/AnimatedAccordion";

import MarkdownBlock from "../common/MarkdownBlock";
import { cn } from "@/lib/utils";
import {
  AdvancedThinkingIndicator,
  ThinkingPhase,
} from "./AdvancedThinkingIndicator";
import { AgentStatusPill } from "./StreamingLoadingText";

const MAX_REASONING_TOPICS = 6;
const THINKING_TAG_PATTERN = /<\/?(?:thinking|think|reasoning)>/gi;
const THINKING_OPEN_TAG_PATTERN = /<(thinking|think|reasoning)>/gi;

const REASONING_TOPIC_STOP_WORDS = new Set([
      "about",
      "actually",
      "after",
      "again",
      "against",
      "adds",
      "agent",
      "almost",
      "already",
      "also",
      "although",
      "among",
      "amongst",
      "amid",
      "amidst",
      "answer",
      "answered",
      "answering",
      "always",
      "analyze",
      "analyzing",
      "anything",
      "another",
      "anyone",
      "anywhere",
      "anyway",
      "appears",
      "automatic",
      "automatically",
      "apply",
      "applying",
      "around",
      "aside",
      "assistant",
      "atop",
      "basically",
      "because",
      "become",
      "becomes",
      "becoming",
      "been",
      "beforehand",
      "behind",
      "below",
      "beneath",
      "beside",
      "before",
      "being",
      "besides",
      "between",
      "beyond",
      "both",
      "but",
      "by",
      "briefly",
      "build",
      "building",
      "came",
      "called",
      "cannot",
      "cant",
      "carefully",
      "certainly",
      "check",
      "checking",
      "clearly",
      "code",
      "come",
      "coming",
      "completely",
      "consider",
      "considering",
      "could",
      "create",
      "creating",
      "current",
      "currently",
      "debug",
      "debugging",
      "decide",
      "deciding",
      "derive",
      "doing",
      "done",
      "down",
      "due",
      "during",
      "each",
      "either",
      "else",
      "ensure",
      "ensuring",
      "entirely",
      "especially",
      "evaluating",
      "even",
      "every",
      "exactly",
      "explain",
      "explaining",
      "fact",
      "feel",
      "feeling",
      "figuring",
      "follow",
      "following",
      "for",
      "final",
      "finally",
      "find",
      "finding",
      "first",
      "form",
      "focus",
      "focusing",
      "found",
      "from",
      "further",
      "given",
      "gives",
      "gets",
      "getting",
      "giving",
      "going",
      "gone",
      "good",
      "handle",
      "handling",
      "happen",
      "happened",
      "happening",
      "have",
      "having",
      "header",
      "held",
      "help",
      "helping",
      "here",
      "him",
      "himself",
      "his",
      "hers",
      "herself",
      "however",
      "idea",
      "including",
      "in",
      "inside",
      "implement",
      "implementing",
      "itself",
      "it",
      "instead",
      "into",
      "isnt",
      "its",
      "issue",
      "just",
      "keep",
      "keeping",
      "kind",
      "know",
      "known",
      "knows",
      "last",
      "later",
      "like",
      "likely",
      "look",
      "looked",
      "looking",
      "made",
      "make",
      "making",
      "maybe",
      "means",
      "message",
      "might",
      "more",
      "most",
      "must",
      "mine",
      "myself",
      "need",
      "needing",
      "needs",
      "never",
      "new",
      "next",
      "note",
      "notice",
      "noticed",
      "noted",
      "none",
      "nothing",
      "noun",
      "obvious",
      "obviously",
      "once",
      "only",
      "off",
      "on",
      "onto",
      "other",
      "others",
      "output",
      "over",
      "part",
      "perhaps",
      "pick",
      "picking",
      "plan",
      "planning",
      "please",
      "point",
      "per",
      "post",
      "posted",
      "put",
      "puts",
      "possible",
      "possibly",
      "process",
      "probably",
      "quite",
      "rather",
      "refer",
      "reference",
      "referencing",
      "read",
      "reading",
      "realize",
      "really",
      "reason",
      "reasoning",
      "recent",
      "recently",
      "reflect",
      "regarding",
      "response",
      "review",
      "reviewing",
      "right",
      "said",
      "same",
      "saying",
      "seem",
      "seemed",
      "seems",
      "seen",
      "several",
      "should",
      "shouldnt",
      "so",
      "simple",
      "show",
      "showing",
      "since",
      "somebody",
      "small",
      "something",
      "someone",
      "somewhere",
      "start",
      "starting",
      "state",
      "step",
      "steps",
      "still",
      "stream",
      "streamed",
      "streaming",
      "such",
      "sure",
      "skip",
      "take",
      "taking",
      "task",
      "than",
      "that",
      "the",
      "their",
      "theirs",
      "thee",
      "themself",
      "themselves",
      "them",
      "then",
      "there",
      "therefore",
      "these",
      "they",
      "thine",
      "thing",
      "things",
      "thats",
      "think",
      "thinking",
      "third",
      "this",
      "thou",
      "thy",
      "thyself",
      "those",
      "thought",
      "thoughts",
      "though",
      "through",
      "today",
      "together",
      "told",
      "too",
      "to",
      "toward",
      "towards",
      "upon",
      "up",
      "under",
      "until",
      "update",
      "updating",
      "used",
      "user",
      "users",
      "using",
      "usually",
      "value",
      "very",
      "wait",
      "waiting",
      "want",
      "wanting",
      "well",
      "went",
      "were",
      "whats",
      "what",
      "when",
      "where",
      "whether",
      "who",
      "whom",
      "whose",
      "why",
      "which",
      "while",
      "will",
      "word",
      "words",
      "with",
      "within",
      "without",
      "yet",
      "work",
      "working",
      "would",
      "write",
      "writing",
      "your",
    ]);

export const stripThinkingTags = (value: string) =>
  value.replace(THINKING_TAG_PATTERN, "");

export const splitThinkingContent = (value: string) => {
  const reasoningChunks: string[] = [];
  const regularChunks: string[] = [];
  let cursor = 0;
  let reasoningIsStreaming = false;

  THINKING_OPEN_TAG_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(THINKING_OPEN_TAG_PATTERN)) {
    const [openTag, tagName] = match;
    const openIndex = match.index ?? 0;
    const contentStart = openIndex + openTag.length;

    regularChunks.push(value.slice(cursor, openIndex));

    const closeTag = `</${tagName}>`;
    const closeIndex = value
      .toLowerCase()
      .indexOf(closeTag.toLowerCase(), contentStart);

    if (closeIndex === -1) {
      reasoningChunks.push(value.slice(contentStart));
      cursor = value.length;
      reasoningIsStreaming = true;
      break;
    }

    reasoningChunks.push(value.slice(contentStart, closeIndex));
    cursor = closeIndex + closeTag.length;
  }

  regularChunks.push(value.slice(cursor));

  return {
    reasoningContent: stripThinkingTags(reasoningChunks.join("\n\n")).trim(),
    regularContent: stripThinkingTags(regularChunks.join("")).trim(),
    reasoningIsStreaming,
  };
};

const stripReasoningMarkdown = (value: string) =>
  stripThinkingTags(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#>*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractReasoningTopics = (value: string) => {
  const matches =
    stripReasoningMarkdown(value).match(/\b[\p{L}][\p{L}\p{N}-]{3,}\b/gu) ?? [];
  const topics: string[] = [];
  const seen = new Set<string>();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const normalized = match.toLowerCase();
    if (
      REASONING_TOPIC_STOP_WORDS.has(normalized) ||
      (normalized.length < 5 && match !== match.toUpperCase())
    ) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    topics.unshift(match);

    if (topics.length >= MAX_REASONING_TOPICS) {
      break;
    }
  }

  return topics;
};

const getReasoningLabel = ({
  elapsedMs,
  topic,
  fallbackLabel,
  t,
}: {
  elapsedMs: number;
  topic?: string;
  fallbackLabel: string;
  t: ReturnType<typeof useTranslation>["t"];
}) => {
  if (!topic) {
    return fallbackLabel;
  }

  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));

  if (seconds >= 50) {
    return t("chat:reasoning.burningKitchen", {
      topic,
      defaultValue: "🔥 Melting over {{topic}} 🔥",
    });
  }

  if (seconds >= 40) {
    return t("chat:reasoning.wrestling", {
      topic,
      defaultValue: "Sweating over {{topic}} 💦",
    });
  }

  if (seconds >= 30) {
    return t("chat:reasoning.closingIn", {
      topic,
      defaultValue: "Locking in on {{topic}} 🎯",
    });
  }

  if (seconds >= 20) {
    return t("chat:reasoning.piecingTogether", {
      topic,
      defaultValue: "Piecing together {{topic}} 🕵️",
    });
  }

  if (seconds >= 10) {
    return t("chat:reasoning.cooking", {
      topic,
      defaultValue: "Analyzing {{topic}} 🔍",
    });
  }

  return t("chat:reasoning.thinkingAbout", {
    topic,
    defaultValue: "Thinking about {{topic}} 💭",
  });
};

interface ReasoningBlockProps {
  content: string;
  ts: number;
  isStreaming: boolean;
  isLast: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  metadata?: {
    reasoningPhase?: ThinkingPhase;
    reasoningSteps?: ThinkingPhase[];
    currentStep?: number;
    estimatedCost?: number;
    tokenCount?: number;
    reasoningDurationMs?: number;
  };
  wasInterrupted?: boolean;
}

export const ReasoningBlock = ({
  content,
  ts,
  isStreaming,
  isLast,
  isCollapsed,
  onToggle,
  metadata,
  wasInterrupted = false,
}: ReasoningBlockProps) => {
  const { t } = useTranslation();
  const sanitizedContent = stripThinkingTags(content);

  const startTimeRef = useRef<number>(ts);
  const [elapsed, setElapsed] = useState<number>(
    metadata?.reasoningDurationMs ?? 0,
  );
  const fallbackReasoningLabel = t("chat:reasoning.thinking");
  const [reasoningTopics, setReasoningTopics] = useState<string[]>(() =>
    extractReasoningTopics(sanitizedContent),
  );
  const [activeTopicIndex, setActiveTopicIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const userHasScrolledUp = useRef(false);
  const rafRef = useRef<number | null>(null);
  const settleFramesRef = useRef(0);
  const releaseScrollRafRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const prevIsStreamingRef = useRef(isStreaming);
  const prevIsCollapsedRef = useRef(isCollapsed);
  const BOTTOM_EPSILON = 24;

  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    return (
      maxScrollTop <= 0 || maxScrollTop - container.scrollTop <= BOTTOM_EPSILON
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    if (userHasScrolledUp.current || !contentRef.current) {
      return;
    }

    isProgrammaticScrollRef.current = true;
    contentRef.current.scrollTop =
      contentRef.current.scrollHeight - contentRef.current.clientHeight;
    if (releaseScrollRafRef.current !== null) {
      cancelAnimationFrame(releaseScrollRafRef.current);
    }
    releaseScrollRafRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      releaseScrollRafRef.current = null;
    });
  }, []);

  const scheduleAutoScroll = useCallback((settleFrames = 4) => {
    if (userHasScrolledUp.current || !isStreaming || isCollapsed) {
      return;
    }

    settleFramesRef.current = Math.max(settleFramesRef.current, settleFrames);

    if (rafRef.current !== null) {
      return;
    }

    const tick = () => {
      rafRef.current = null;
      scrollToBottom();
      settleFramesRef.current = Math.max(0, settleFramesRef.current - 1);

      if (
        settleFramesRef.current > 0 &&
        !userHasScrolledUp.current &&
        isStreaming &&
        !isCollapsed
      ) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [isCollapsed, isStreaming, scrollToBottom]);

  // Handle manual scroll to disable/enable auto-scroll
  const handleScroll = () => {
    if (!contentRef.current) return;

    // Programmatic writes should never disengage sticky scroll.
    if (isProgrammaticScrollRef.current) {
      return;
    }

    if (isStreaming) {
      userHasScrolledUp.current = false;
      scheduleAutoScroll(6);
      return;
    }

    const isAtBottom = isNearBottom(contentRef.current);
    userHasScrolledUp.current = !isAtBottom;

    if (isAtBottom && isStreaming) {
      scheduleAutoScroll();
    }
  };

  useEffect(() => {
    if (!contentRef.current || !isStreaming || isCollapsed) {
      return;
    }

    scheduleAutoScroll();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      settleFramesRef.current = 0;
      if (releaseScrollRafRef.current !== null) {
        cancelAnimationFrame(releaseScrollRafRef.current);
        releaseScrollRafRef.current = null;
      }
      isProgrammaticScrollRef.current = false;
    };
  }, [isCollapsed, isStreaming, scheduleAutoScroll]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !isStreaming || isCollapsed) {
      return;
    }

    const triggerStickToBottom = () => {
      scheduleAutoScroll(6);
    };

    const resizeObserver = new ResizeObserver(triggerStickToBottom);
    resizeObserver.observe(container);

    if (container.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(container.firstElementChild);
    }

    const mutationObserver = new MutationObserver(triggerStickToBottom);
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [isCollapsed, isStreaming, scheduleAutoScroll]);

  useEffect(() => {
    if (isStreaming && !isCollapsed) {
      scheduleAutoScroll();
    }
  }, [
    content,
    isCollapsed,
    isStreaming,
    metadata?.reasoningPhase,
    scheduleAutoScroll,
  ]);

  // No internal state effects - all expansion logic moved to parent

  useEffect(() => {
    if (metadata?.reasoningDurationMs !== undefined) {
      setElapsed(metadata.reasoningDurationMs);
    }
  }, [metadata?.reasoningDurationMs]);

  useEffect(() => {
    const nextTopics = extractReasoningTopics(sanitizedContent);

    setReasoningTopics((currentTopics) => {
      if (
        currentTopics.length === nextTopics.length &&
        currentTopics.every((topic, index) => topic === nextTopics[index])
      ) {
        return currentTopics;
      }

      return nextTopics;
    });

    setActiveTopicIndex((currentIndex) => {
      if (nextTopics.length === 0) {
        return 0;
      }

      return currentIndex % nextTopics.length;
    });
  }, [sanitizedContent]);

  useEffect(() => {
    if (isLast && isStreaming) {
      const tick = () => setElapsed(Date.now() - startTimeRef.current);
      tick();
      const id = setInterval(tick, 100); // Increase frequency for smoother updates
      return () => clearInterval(id);
    }
  }, [isLast, isStreaming]);

  useEffect(() => {
    if (!isStreaming || reasoningTopics.length <= 1) {
      return;
    }

    const id = setInterval(() => {
      setActiveTopicIndex((currentIndex) =>
        (currentIndex + 1) % reasoningTopics.length,
      );
    }, 1000);

    return () => clearInterval(id);
  }, [isStreaming, reasoningTopics]);

  const seconds = Math.floor(elapsed / 1000);
  const activeReasoningTopic = reasoningTopics[activeTopicIndex];
  const thinkingLabel = getReasoningLabel({
    elapsedMs: elapsed,
    topic: activeReasoningTopic,
    fallbackLabel: fallbackReasoningLabel,
    t,
  });

  const handleToggle = () => {
    onToggle();
  };

  // Use advanced thinking indicator for streaming responses
  const useAdvancedIndicator =
    isLast && isStreaming && metadata?.reasoningPhase;
  const shouldCollapseImmediately =
    isCollapsed &&
    !isStreaming &&
    prevIsStreamingRef.current &&
    !prevIsCollapsedRef.current;

  useEffect(() => {
    prevIsStreamingRef.current = isStreaming;
    prevIsCollapsedRef.current = isCollapsed;
  }, [isCollapsed, isStreaming]);

  return (
    <div
      className="group anchored-container transition-all duration-500 ease-out"
      style={{
        transformStyle: "preserve-3d",
        transform: "translateZ(0)",
        fontFamily: "var(--vscode-font-family)",
      }}
    >
      {/* Header with toggle */}
      <div
        className={cn(
          "relative inline-flex max-w-full items-start gap-2 pl-0 pr-0 py-0.5 mb-0 cursor-pointer select-none transition-all duration-300 ease-out",
          isStreaming && "opacity-90",
        )}
        style={{ marginLeft: "1.3px" }}
        onClick={handleToggle}
      >
        <div
          className={cn(
            "min-w-0 flex-1 flex items-center gap-2 transition-all duration-300 ease-out",
          )}
        >
          {/* Use advanced indicator for last streaming message */}
          {useAdvancedIndicator ? (
            <div
              className={cn(
                "min-w-0 flex items-center gap-2 transition-all duration-300 ease-out",
              )}
            >
              <AdvancedThinkingIndicator
                phase={metadata.reasoningPhase}
                phases={metadata.reasoningSteps}
                currentPhaseIndex={metadata.currentStep ?? 0}
                elapsedMs={elapsed}
                estimatedCost={metadata.estimatedCost}
                tokenCount={metadata.tokenCount}
                isStreaming={isStreaming}
                style="detailed"
                compact={false}
                message={isStreaming ? thinkingLabel : undefined}
              />
            </div>
          ) : (
            <div className="min-w-0 inline-flex items-center">
              <AgentStatusPill
                text={isStreaming ? thinkingLabel : "Thought"}
                elapsedSeconds={
                  elapsed > 0 || !isStreaming ? seconds : undefined
                }
                compact
                active={isStreaming}
                className="mr-[-1px]"
              />
              <ChevronRight
                className={cn(
                  "ml-1.5 h-3.5 w-3.5 text-vscode-descriptionForeground/55 transition-transform duration-300 ease-out motion-reduce:transition-none",
                  !isCollapsed && "rotate-90",
                )}
                strokeWidth={1.2}
              />
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <AnimatedAccordion
        isExpanded={!isCollapsed}
        durationMs={shouldCollapseImmediately ? 0 : 300}
        unmountWhenCollapsed={true}
      >
        {((sanitizedContent?.trim()?.length ?? 0) > 0 ||
          (isStreaming && metadata?.reasoningPhase)) && (
          <div
            ref={contentRef}
            onScroll={handleScroll}
            className={cn(
              "ml-1 mr-1 pl-0 pr-1 pb-1 text-vscode-descriptionForeground text-[13.5px] leading-[1.6] opacity-45 anchored-container -mt-0.5 max-h-60 overflow-y-auto custom-scrollbar",
              "transition-all duration-500 ease-out",
            )}
            style={{ overscrollBehavior: "contain" }}
          >
            <div className="relative">
              <MarkdownBlock
                markdown={sanitizedContent}
                isStreaming={isStreaming}
                className={cn(
                  "!text-[13.3px] reasoning-content transition-all duration-300",
                  isStreaming && "is-streaming",
                )}
              />
            </div>
          </div>
        )}
      </AnimatedAccordion>

      {/* Show metadata summary - moved inside the main accordion or shown statically to prevent double-animation jitter */}
      {isCollapsed &&
        metadata?.reasoningPhase &&
        !isStreaming &&
        !wasInterrupted && (
          <div className="ml-0 px-0 pb-1 text-[11px] text-vscode-descriptionForeground/50 flex items-center gap-2 mt-0 animate-in fade-in duration-300">
            <span className="capitalize">{metadata.reasoningPhase}</span>
            {metadata.tokenCount !== undefined && (
              <span>{metadata.tokenCount.toLocaleString()} tokens</span>
            )}
            {metadata.estimatedCost !== undefined && (
              <span>~${metadata.estimatedCost.toFixed(4)}</span>
            )}
          </div>
        )}
    </div>
  );
};

export default ReasoningBlock;
