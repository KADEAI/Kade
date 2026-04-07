import { useCallback, useRef } from "react";

interface UseStreamingScrollPinOptions {
  pinSuppressedUntilRef?: { current: number };
  shouldReleasePinFromScroll?: (distanceFromBottom: number) => boolean;
}

/**
 * Keeps the Virtuoso scroller pinned to the bottom during streaming without
 * spamming scroll writes or reacting to every tiny DOM/style mutation.
 *
 * Callers should treat `setPinned` as the canonical mutator for pin state.
 * Writing `pinnedRef.current` directly bypasses the pin-loop scheduling and
 * teardown logic in this hook.
 *
 * Strategy:
 * - Observe real size/content changes only.
 * - Coalesce all pin requests to a single animation frame.
 * - Skip writes when we're already effectively at the bottom.
 */
export function useStreamingScrollPin(
  options?: UseStreamingScrollPinOptions,
) {
  const pinnedRef = useRef(true);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const scrollListenerCleanupRef = useRef<(() => void) | null>(null);
  const scheduleRafIdRef = useRef<number | null>(null);
  const pinLoopRafIdRef = useRef<number | null>(null);
  const pinLoopUntilRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);

  const BOTTOM_EPSILON = 2;
  const PIN_LOOP_WINDOW_MS = 700;
  const PROGRAMMATIC_SCROLL_WINDOW_MS = 80;
  const USER_SCROLL_RELEASE_DISTANCE_PX = 96;

  const isPinSuppressedRef = useRef(() => {
    const suppressedUntil = options?.pinSuppressedUntilRef?.current ?? 0;
    return suppressedUntil > performance.now();
  });
  const shouldReleasePinFromScrollRef = useRef(
    (distanceFromBottom: number) => {
      const releasePin = options?.shouldReleasePinFromScroll;
      return releasePin ? releasePin(distanceFromBottom) : true;
    },
  );

  isPinSuppressedRef.current = () => {
    const suppressedUntil = options?.pinSuppressedUntilRef?.current ?? 0;
    return suppressedUntil > performance.now();
  };
  shouldReleasePinFromScrollRef.current = (distanceFromBottom: number) => {
    const releasePin = options?.shouldReleasePinFromScroll;
    return releasePin ? releasePin(distanceFromBottom) : true;
  };

  const ensurePinLoopRef = useRef(() => {
    if (pinLoopRafIdRef.current !== null) {
      return;
    }

    pinLoopRafIdRef.current = requestAnimationFrame(pinToBottomRef.current);
  });

  const markProgrammaticScrollRef = useRef(() => {
    programmaticScrollUntilRef.current =
      performance.now() + PROGRAMMATIC_SCROLL_WINDOW_MS;
  });

  const writeScrollerToBottomRef = useRef(
    (scroller: HTMLElement, maxScrollTop: number) => {
      markProgrammaticScrollRef.current();
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top: maxScrollTop, behavior: "auto" });
      } else {
        scroller.scrollTop = maxScrollTop;
      }
    },
  );

  const syncPinnedFromScrollRef = useRef((distanceFromBottom: number) => {
    if (!Number.isFinite(distanceFromBottom)) {
      return pinnedRef.current;
    }

    if (distanceFromBottom <= BOTTOM_EPSILON) {
      pinnedRef.current = true;
      return true;
    }

    if (performance.now() < programmaticScrollUntilRef.current) {
      return pinnedRef.current;
    }

    if (
      distanceFromBottom >= USER_SCROLL_RELEASE_DISTANCE_PX &&
      shouldReleasePinFromScrollRef.current(distanceFromBottom)
    ) {
      pinnedRef.current = false;
    }

    return pinnedRef.current;
  });

  const syncPinnedFromScrollerRef = useRef((scroller: HTMLElement) => {
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScrollTop <= 0) {
      return pinnedRef.current;
    }

    const distanceFromBottom = maxScrollTop - scroller.scrollTop;
    return syncPinnedFromScrollRef.current(distanceFromBottom);
  });

  const pinToBottomRef = useRef(() => {
    pinLoopRafIdRef.current = null;
    scheduleRafIdRef.current = null;

    if (!pinnedRef.current) {
      return;
    }

    const scroller = scrollerElRef.current;
    if (!scroller) {
      return;
    }

    if (isPinSuppressedRef.current()) {
      ensurePinLoopRef.current();
      return;
    }

    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop <= 0) {
      if (performance.now() < pinLoopUntilRef.current) {
        ensurePinLoopRef.current();
      }
      return;
    }

    const distanceFromBottom = maxScrollTop - scroller.scrollTop;
    if (distanceFromBottom > BOTTOM_EPSILON) {
      writeScrollerToBottomRef.current(scroller, maxScrollTop);
    }

    if (performance.now() < pinLoopUntilRef.current) {
      ensurePinLoopRef.current();
    }
  });

  const schedulePinRef = useRef(() => {
    if (!pinnedRef.current) return;

    pinLoopUntilRef.current = performance.now() + PIN_LOOP_WINDOW_MS;

    if (scheduleRafIdRef.current !== null) return;
    scheduleRafIdRef.current = requestAnimationFrame(pinToBottomRef.current);
  });

  // Force immediate pin (synchronous) for discrete UI events like accordion expansion.
  const forcePinRef = useRef(() => {
    if (isPinSuppressedRef.current()) return;

    const scroller = scrollerElRef.current;
    if (!scroller) return;

    pinnedRef.current = true;

    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop <= 0) return;

    const distanceFromBottom = maxScrollTop - scroller.scrollTop;
    if (distanceFromBottom > BOTTOM_EPSILON) {
      writeScrollerToBottomRef.current(scroller, maxScrollTop);
    }

    pinLoopUntilRef.current = performance.now() + PIN_LOOP_WINDOW_MS;
    ensurePinLoopRef.current();
  });

  const setPinnedRef = useRef((nextPinned: boolean) => {
    pinnedRef.current = nextPinned;

    if (!nextPinned) {
      pinLoopUntilRef.current = 0;
      if (scheduleRafIdRef.current !== null) {
        cancelAnimationFrame(scheduleRafIdRef.current);
        scheduleRafIdRef.current = null;
      }
      if (pinLoopRafIdRef.current !== null) {
        cancelAnimationFrame(pinLoopRafIdRef.current);
        pinLoopRafIdRef.current = null;
      }
      return;
    }

    schedulePinRef.current();
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
    if (scrollListenerCleanupRef.current) {
      scrollListenerCleanupRef.current();
      scrollListenerCleanupRef.current = null;
    }
    if (scheduleRafIdRef.current !== null) {
      cancelAnimationFrame(scheduleRafIdRef.current);
      scheduleRafIdRef.current = null;
    }
    if (pinLoopRafIdRef.current !== null) {
      cancelAnimationFrame(pinLoopRafIdRef.current);
      pinLoopRafIdRef.current = null;
    }
    pinLoopUntilRef.current = 0;

    scrollerElRef.current = null;

    if (!el || el instanceof Window) return;
    scrollerElRef.current = el;
    const isPinned = syncPinnedFromScrollerRef.current(el);
    if (isPinned) {
      schedulePinRef.current();
    }

    const handleScroll = () => {
      const scroller = scrollerElRef.current;
      if (!scroller) {
        return;
      }

      const maxScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );
      const distanceFromBottom = maxScrollTop - scroller.scrollTop;
      syncPinnedFromScrollRef.current(distanceFromBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    scrollListenerCleanupRef.current = () => {
      el.removeEventListener("scroll", handleScroll);
    };

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
    setPinned: setPinnedRef.current,
    forcePin: forcePinRef.current,
    syncPinnedFromScroll: syncPinnedFromScrollRef.current,
  };
}
