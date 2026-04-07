import { useCallback, useEffect, useState } from "react";
import type {
  EmptyStateBackgroundOption,
  ExtensionMessage,
} from "@roo/ExtensionMessage";

import { vscode } from "@/utils/vscode";

type EmptyStateBackgroundState = {
  folderPath: string;
  options: EmptyStateBackgroundOption[];
  isLoading: boolean;
  error: string | null;
};

const EMPTY_STATE_BACKGROUNDS_TIMEOUT_MS = 10_000;

let sharedState: EmptyStateBackgroundState = {
  folderPath: "",
  options: [],
  isLoading: false,
  error: null,
};
let hasLoadedSharedState = false;
let inflightRefresh: Promise<void> | null = null;
const listeners = new Set<(state: EmptyStateBackgroundState) => void>();

const createRequestId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `empty-state-backgrounds-${Date.now()}`;
};

export const useEmptyStateBackgrounds = () => {
  const [state, setState] = useState<EmptyStateBackgroundState>(sharedState);

  const publishState = useCallback((nextState: EmptyStateBackgroundState) => {
    sharedState = nextState;
    listeners.forEach((listener) => listener(nextState));
  }, []);

  const refresh = useCallback(() => {
    if (inflightRefresh) {
      return inflightRefresh;
    }

    const requestId = createRequestId();
    const nextLoadingState = {
      ...sharedState,
      isLoading: true,
      error: null,
    };
    publishState(nextLoadingState);

    inflightRefresh = new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        hasLoadedSharedState = true;
        publishState({
          ...sharedState,
          isLoading: false,
          error: "Timed out while loading backgrounds.",
        });
        resolve();
      }, EMPTY_STATE_BACKGROUNDS_TIMEOUT_MS);

      const handleMessage = (event: MessageEvent) => {
        const message = event.data as ExtensionMessage;

        if (
          message.type !== "emptyStateBackgrounds" ||
          message.requestId !== requestId
        ) {
          return;
        }

        cleanup();
        hasLoadedSharedState = true;
        publishState({
          folderPath: message.values?.folderPath ?? "",
          options: Array.isArray(message.values?.options)
            ? (message.values.options as EmptyStateBackgroundOption[])
            : [],
          isLoading: false,
          error: message.error ?? null,
        });
        resolve();
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        inflightRefresh = null;
      };

      window.addEventListener("message", handleMessage);
      vscode.postMessage({
        type: "requestEmptyStateBackgrounds",
        requestId,
      });
    });
    return inflightRefresh;
  }, [publishState]);

  const openFolder = useCallback(() => {
    vscode.postMessage({ type: "openEmptyStateBackgroundsFolder" });
  }, []);

  useEffect(() => {
    listeners.add(setState);
    setState(sharedState);

    if (!hasLoadedSharedState && !inflightRefresh) {
      void refresh();
    }

    return () => {
      listeners.delete(setState);
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
    openFolder,
  };
};
