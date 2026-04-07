export const STREAMING_PIN_USER_RELEASE_DISTANCE_PX = 96;

export type ShouldRetainStreamingPinOptions = {
  isStreaming: boolean;
  streamingPinned: boolean;
  distanceFromBottom: number;
  bottomOffsetThreshold: number;
  userInitiatedRelease?: boolean;
};

export const shouldRetainStreamingPin = ({
  isStreaming,
  streamingPinned,
  distanceFromBottom,
  bottomOffsetThreshold,
  userInitiatedRelease = false,
}: ShouldRetainStreamingPinOptions) => {
  // KILOCODE: Always retain pin if we are pinned, regardless of isStreaming

  if (!streamingPinned) {
    return false;
  }

  const releaseDistance = Math.max(
    bottomOffsetThreshold + 24,
    STREAMING_PIN_USER_RELEASE_DISTANCE_PX,
  );

  if (distanceFromBottom <= releaseDistance) {
    return true;
  }

  return !userInitiatedRelease;
};

export type ShouldFollowStreamingOutputOptions = {
  isStreaming: boolean;
  isAtBottom: boolean;
  streamingPinned: boolean;
  hadBottomOwnership: boolean;
  showScrollToBottom: boolean;
};

export const shouldFollowStreamingOutput = ({
  isStreaming,
  isAtBottom,
  streamingPinned,
  hadBottomOwnership,
  showScrollToBottom,
}: ShouldFollowStreamingOutputOptions) => {
  // KILOCODE: Always follow if we are at bottom, regardless of isStreaming
  if (showScrollToBottom) {
    return false;
  }

  return isAtBottom || streamingPinned || hadBottomOwnership;
};
