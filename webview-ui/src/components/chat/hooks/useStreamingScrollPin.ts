import { useCallback, useRef } from "react";

/**
 * Keeps the Virtuoso scroller pinned to the bottom during streaming without
 * spamming scroll writes or reacting to every tiny DOM/style mutation.
 *
 * Strategy:
 * - Observe real size/content changes only.
 * - Coalesce all pin requests to a single animation frame.
 * - Skip writes when we're already effectively at the bottom.
 */
export function useStreamingScrollPin() {
  const pinnedRef = useRef(true);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const BOTTOM_EPSILON = 2;

  const pinToBottomRef = useRef(() => {
    rafIdRef.current = null;
    if (!pinnedRef.current) return;

    const scroller = scrollerElRef.current;
    if (!scroller) return;

    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop <= 0) return;

    const distanceFromBottom = maxScrollTop - scroller.scrollTop;
    if (distanceFromBottom <= BOTTOM_EPSILON) return;

    scroller.scrollTop = maxScrollTop;
  });

  const schedulePinRef = useRef(() => {
    if (!pinnedRef.current) return;

    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(pinToBottomRef.current);
  });

  // Force immediate pin (synchronous) for discrete UI events like accordion expansion.
  const forcePinRef = useRef(() => {
    if (!pinnedRef.current) return;

    const scroller = scrollerElRef.current;
    if (!scroller) return;

    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop <= 0) return;

    const distanceFromBottom = maxScrollTop - scroller.scrollTop;
    if (distanceFromBottom <= BOTTOM_EPSILON) return;

    scroller.scrollTop = maxScrollTop;
  });

  const scrollerRef = useCallback((el: HTMLElement | Window | null) => {
    if (mutationObserverRef.current) {
      mutationObserverRef.current.disconnect();
      mutationObserverRef.current = null;
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    scrollerElRef.current = null;

    if (!el || el instanceof Window) return;
    scrollerElRef.current = el;

    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "childList" ||
          mutation.type === "characterData" ||
          (mutation.type === "attributes" && mutation.attributeName === "open")
        ) {
          schedulePinRef.current();
          return;
        }
      }
    });

    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    mutationObserverRef.current = mo;

    const ro = new ResizeObserver(() => {
      schedulePinRef.current();
    });
    ro.observe(el);
    resizeObserverRef.current = ro;
  }, []);

  return {
    scrollerRef,
    scrollerElRef,
    pinnedRef,
    forcePin: forcePinRef.current,
  };
}
