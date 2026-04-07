import React, { ReactNode, useEffect, useRef, useState } from "react";

import { dispatchChatScrollAnchorAdjust } from "../chat/scrollAnchorUtils";

export { dispatchChatScrollAnchorAdjust };
export const dispatchToolAnimateHeight = dispatchChatScrollAnchorAdjust;

interface AnimatedAccordionProps {
  isExpanded: boolean;
  children: ReactNode;
  contentClassName?: string;
  style?: React.CSSProperties;
  unmountWhenCollapsed?: boolean;
  durationMs?: number;
}

export const AnimatedAccordion = ({
  isExpanded,
  children,
  contentClassName,
  style,
  unmountWhenCollapsed = false,
  durationMs = 300,
}: AnimatedAccordionProps) => {
  const prevExpanded = useRef(isExpanded);
  const animationFrameRef = useRef<number | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);
  const unmountTimeoutRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderChildren, setShouldRenderChildren] = useState(
    isExpanded || !unmountWhenCollapsed,
  );

  useEffect(() => {
    if (!unmountWhenCollapsed) {
      setShouldRenderChildren(true);
      return;
    }

    if (unmountTimeoutRef.current !== null) {
      window.clearTimeout(unmountTimeoutRef.current);
      unmountTimeoutRef.current = null;
    }

    if (isExpanded) {
      setShouldRenderChildren(true);
      return;
    }

    unmountTimeoutRef.current = window.setTimeout(() => {
      setShouldRenderChildren(false);
      unmountTimeoutRef.current = null;
    }, durationMs);

    return () => {
      if (unmountTimeoutRef.current !== null) {
        window.clearTimeout(unmountTimeoutRef.current);
        unmountTimeoutRef.current = null;
      }
    };
  }, [durationMs, isExpanded, unmountWhenCollapsed]);

  useEffect(() => {
    if (prevExpanded.current === isExpanded) {
      return;
    }

    prevExpanded.current = isExpanded;
    const start = performance.now();
    const animationDurationMs = durationMs + 20;

    const tick = (now: number) => {
      dispatchChatScrollAnchorAdjust(rootRef.current);
      if (now - start < animationDurationMs) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
    animationTimeoutRef.current = window.setTimeout(() => {
      dispatchChatScrollAnchorAdjust(rootRef.current);
    }, animationDurationMs + 24);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, [durationMs, isExpanded]);

  const { transition: _ignoredTransition, ...safeStyle } = style ?? {};

  return (
    <div
      ref={rootRef}
      style={{
        display: "grid",
        gridTemplateRows: isExpanded ? "1fr" : "0fr",
        transition: `grid-template-rows ${durationMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        ...safeStyle,
      }}
    >
      <div
        style={{
          overflow: "hidden",
          minHeight: 0,
          opacity: isExpanded ? 1 : 0,
          transition: `opacity ${durationMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
        className={contentClassName}
      >
        {shouldRenderChildren ? children : null}
      </div>
    </div>
  );
};
