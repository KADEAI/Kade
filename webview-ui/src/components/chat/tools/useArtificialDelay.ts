import { useEffect, useRef, useState } from "react";

/**
 * Keeps a real running/partial state visible for a minimum duration so
 * ultra-fast tool calls still have a readable transition in the UI.
 *
 * Unlike the previous version, this only activates after a tool actually
 * enters a real running state. It never fabricates a pre-run shimmer.
 */
export const useArtificialDelay = (
  isRunning: boolean | undefined,
  minVisibleMs = 425,
) => {
  const [displayRunning, setDisplayRunning] = useState(!!isRunning);
  const startTimeRef = useRef<number | null>(isRunning ? Date.now() : null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isRunning) {
      if (startTimeRef.current == null) {
        startTimeRef.current = Date.now();
      }
      setDisplayRunning(true);
      return;
    }

    if (startTimeRef.current == null) {
      setDisplayRunning(false);
      return;
    }

    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, minVisibleMs - elapsed);

    if (remaining === 0) {
      startTimeRef.current = null;
      setDisplayRunning(false);
      return;
    }

    timeoutRef.current = setTimeout(() => {
      startTimeRef.current = null;
      setDisplayRunning(false);
      timeoutRef.current = null;
    }, remaining);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isRunning, minVisibleMs]);

  return displayRunning;
};
