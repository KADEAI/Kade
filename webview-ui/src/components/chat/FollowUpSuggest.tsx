import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy, Timer } from "lucide-react";
import styled, { keyframes, css } from "styled-components";

import { Button, StandardTooltip } from "@/components/ui";

import { useAppTranslation } from "@src/i18n/TranslationContext";
import { useExtensionState } from "@src/context/ExtensionStateContext";
import { SuggestionItem } from "@roo-code/types";
import { cn } from "@/lib/utils";

const DEFAULT_FOLLOWUP_TIMEOUT_MS = 60000;
const COUNTDOWN_INTERVAL_MS = 1000;

// Staggered chip entry animation
const chipEnter = keyframes`
	0% { opacity: 0; transform: translateY(6px); }
	100% { opacity: 1; transform: translateY(0); }
`;

// Copy icon slide-in from right
const copySlideIn = keyframes`
	0% { opacity: 0; transform: translateX(4px); }
	100% { opacity: 1; transform: translateX(0); }
`;

// Click press-down feel
const chipPress = keyframes`
	0% { transform: scale(1); }
	40% { transform: scale(0.97); }
	100% { transform: scale(1); }
`;

const ChipWrapper = styled.div<{ $delay: number }>`
  width: 100%;
  position: relative;
  opacity: 0;
  animation: ${chipEnter} 0.32s cubic-bezier(0.22, 1, 0.36, 1)
    ${({ $delay }) => $delay}ms forwards;

  /* Hover lift */
  & button {
    transition:
      transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
      border-color 0.18s ease,
      box-shadow 0.18s ease !important;
  }

  &:hover button {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  /* Active press */
  &:active button {
    animation: ${chipPress} 0.18s ease forwards;
    transform: translateY(0);
  }
`;

const CopyIconWrapper = styled.div`
  position: absolute;
  cursor: pointer;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.15s ease;

  ${ChipWrapper}:hover & {
    opacity: 1;
    animation: ${copySlideIn} 0.18s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
`;

interface FollowUpSuggestProps {
  suggestions?: SuggestionItem[];
  onSuggestionClick?: (
    suggestion: SuggestionItem,
    event?: React.MouseEvent,
  ) => void;
  ts: number;
  onCancelAutoApproval?: () => void;
  isAnswered?: boolean;
  isFollowUpAutoApprovalPaused?: boolean;
}

export const FollowUpSuggest = ({
  suggestions = [],
  onSuggestionClick,
  ts = 1,
  onCancelAutoApproval,
  isAnswered = false,
  isFollowUpAutoApprovalPaused = false,
}: FollowUpSuggestProps) => {
  const {
    autoApprovalEnabled,
    alwaysAllowFollowupQuestions,
    followupAutoApproveTimeoutMs,
  } = useExtensionState();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [suggestionSelected, setSuggestionSelected] = useState(false);
  const { t } = useAppTranslation();

  // Start countdown timer when auto-approval is enabled for follow-up questions
  useEffect(() => {
    // Only start countdown if auto-approval is enabled for follow-up questions and no suggestion has been selected
    // Also stop countdown if the question has been answered or auto-approval is paused (user is typing)
    if (
      autoApprovalEnabled &&
      alwaysAllowFollowupQuestions &&
      suggestions.length > 0 &&
      !suggestionSelected &&
      !isAnswered &&
      !isFollowUpAutoApprovalPaused
    ) {
      // Start with the configured timeout in seconds
      const timeoutMs =
        typeof followupAutoApproveTimeoutMs === "number" &&
        !isNaN(followupAutoApproveTimeoutMs)
          ? followupAutoApproveTimeoutMs
          : DEFAULT_FOLLOWUP_TIMEOUT_MS;

      // Convert milliseconds to seconds for the countdown
      setCountdown(Math.floor(timeoutMs / 1000));

      // Update countdown every second
      const intervalId = setInterval(() => {
        setCountdown((prevCountdown) => {
          if (prevCountdown === null || prevCountdown <= 1) {
            clearInterval(intervalId);
            return null;
          }
          return prevCountdown - 1;
        });
      }, COUNTDOWN_INTERVAL_MS);

      // Clean up interval on unmount and notify parent component
      return () => {
        clearInterval(intervalId);
        // Notify parent component that this component is unmounting
        // so it can clear any related timeouts
        onCancelAutoApproval?.();
      };
    } else {
      setCountdown(null);
    }
  }, [
    autoApprovalEnabled,
    alwaysAllowFollowupQuestions,
    suggestions,
    followupAutoApproveTimeoutMs,
    suggestionSelected,
    onCancelAutoApproval,
    isAnswered,
    isFollowUpAutoApprovalPaused,
  ]);
  const handleSuggestionClick = useCallback(
    (suggestion: SuggestionItem, event: React.MouseEvent) => {
      // Mark a suggestion as selected if it's not a shift-click (which just copies to input)
      if (!event.shiftKey) {
        setSuggestionSelected(true);
        // Also notify parent component to cancel auto-approval timeout
        // This prevents race conditions between visual countdown and actual timeout
        onCancelAutoApproval?.();
      }

      // Pass the suggestion object to the parent component
      // The parent component will handle mode switching if needed
      onSuggestionClick?.(suggestion, event);
    },
    [onSuggestionClick, onCancelAutoApproval],
  );

  // Don't render if there are no suggestions or no click handler.
  if (!suggestions?.length || !onSuggestionClick) {
    return null;
  }

  return (
    <div className="flex mb-2 flex-col h-full gap-2">
      {suggestions.map((suggestion, index) => {
        const isFirstSuggestion = index === 0;
        // Stagger: 0ms, 60ms, 120ms, etc.
        const staggerDelay = index * 60;

        return (
          <ChipWrapper key={`${suggestion.answer}-${ts}`} $delay={staggerDelay}>
            <Button
              variant="outline"
              className={cn(
                "text-left whitespace-normal break-words w-full h-auto px-3 py-2 justify-start pr-8 rounded-xl",
                isFirstSuggestion &&
                  countdown !== null &&
                  !suggestionSelected &&
                  !isAnswered &&
                  "border-vscode-foreground/60 rounded-b-none -mb-1",
              )}
              onClick={(event) => handleSuggestionClick(suggestion, event)}
              aria-label={suggestion.answer}
            >
              {suggestion.answer}
            </Button>
            {isFirstSuggestion &&
              countdown !== null &&
              !suggestionSelected &&
              !isAnswered && (
                <p className="rounded-b-xl border-1 border-t-0 border-vscode-foreground/60 text-vscode-descriptionForeground text-xs m-0 mt-1 px-3 pt-2 pb-2">
                  <Timer className="size-3 inline-block -mt-0.5 mr-1 animate-pulse" />
                  {t("chat:followUpSuggest.timerPrefix", {
                    seconds: countdown,
                  })}
                </p>
              )}
            {suggestion.mode && (
              <div className="absolute bottom-0 right-0 text-[10px] bg-vscode-badge-background text-vscode-badge-foreground px-1 py-0.5 border border-vscode-badge-background flex items-center gap-0.5">
                <span
                  className="codicon codicon-arrow-right"
                  style={{ fontSize: "8px" }}
                />
                {suggestion.mode}
              </div>
            )}
            <StandardTooltip content={t("chat:followUpSuggest.copyToInput")}>
              <CopyIconWrapper
                onClick={(e) => {
                  e.stopPropagation();
                  // Cancel the auto-approve timer when edit button is clicked
                  setSuggestionSelected(true);
                  onCancelAutoApproval?.();
                  // Simulate shift-click by directly calling the handler with shiftKey=true.
                  onSuggestionClick?.(suggestion, { ...e, shiftKey: true });
                }}
              >
                <ClipboardCopy className="w-4" />
              </CopyIconWrapper>
            </StandardTooltip>
          </ChipWrapper>
        );
      })}
    </div>
  );
};
