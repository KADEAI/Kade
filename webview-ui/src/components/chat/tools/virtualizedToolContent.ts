export const TOOL_CONTENT_WINDOW_THRESHOLD = 200;
export const TOOL_CONTENT_WINDOW_SIZE = 60;
export const TOOL_CONTENT_WINDOW_OVERSCAN = 6;
export const TOOL_CONTENT_ESTIMATED_LINE_HEIGHT = 19;

interface VirtualizedLineWindowOptions {
  lineCount: number;
  scrollTop: number;
  threshold?: number;
  windowSize?: number;
  overscan?: number;
  itemHeight?: number;
}

interface VirtualizedLineWindow {
  enabled: boolean;
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export const getVirtualizedLineWindow = ({
  lineCount,
  scrollTop,
  threshold = TOOL_CONTENT_WINDOW_THRESHOLD,
  windowSize = TOOL_CONTENT_WINDOW_SIZE,
  overscan = TOOL_CONTENT_WINDOW_OVERSCAN,
  itemHeight = TOOL_CONTENT_ESTIMATED_LINE_HEIGHT,
}: VirtualizedLineWindowOptions): VirtualizedLineWindow => {
  if (lineCount <= 0) {
    return {
      enabled: false,
      start: 0,
      end: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  if (lineCount <= threshold) {
    return {
      enabled: false,
      start: 0,
      end: lineCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const safeWindowSize = Math.max(1, windowSize);
  const safeOverscan = Math.max(0, overscan);
  const safeItemHeight = Math.max(1, itemHeight);
  const maxStart = Math.max(0, lineCount - safeWindowSize);
  const anchorIndex = Math.max(0, Math.floor(scrollTop / safeItemHeight));
  const start = Math.min(maxStart, Math.max(0, anchorIndex - safeOverscan));
  const end = Math.min(lineCount, start + safeWindowSize);

  return {
    enabled: true,
    start,
    end,
    topSpacerHeight: start * safeItemHeight,
    bottomSpacerHeight: Math.max(0, (lineCount - end) * safeItemHeight),
  };
};
