export const CHAT_SCROLL_ANCHOR_ADJUST_EVENT = "chat-scroll-anchor-adjust";

export interface ToolAnimateHeightDetail {
  top: number;
  bottom: number;
  source?: Element | null;
}

export const getChatScrollAnchorDetail = (
  source?: Element | null,
): ToolAnimateHeightDetail | undefined => {
  if (!source || typeof source.getBoundingClientRect !== "function") {
    return undefined;
  }

  const { top, bottom } = source.getBoundingClientRect();
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined;
  }

  return { top, bottom, source };
};

export const getToolAnimateHeightDetail = getChatScrollAnchorDetail;

export const dispatchChatScrollAnchorAdjust = (source?: Element | null) => {
  window.dispatchEvent(
    new CustomEvent(CHAT_SCROLL_ANCHOR_ADJUST_EVENT, {
      detail: getChatScrollAnchorDetail(source),
    }),
  );
};

export const shouldAdjustScrollForToolAnimation = (
  detail: ToolAnimateHeightDetail | undefined,
  viewportTop: number,
  viewportBottom?: number,
  threshold = 8,
) => {
  if (!detail) {
    return false;
  }

  if (typeof viewportBottom === "number" && Number.isFinite(viewportBottom)) {
    return detail.top < viewportBottom - threshold;
  }

  return detail.top < viewportTop + threshold;
};
