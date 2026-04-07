import { useEffect, useState } from "react";
import type { ExtensionMessage } from "@roo/ExtensionMessage";
import { vscode } from "@src/utils/vscode";

type BalancePayload = {
  success?: boolean;
  data?: {
    balance?: number;
  };
  error?: string;
};

export const useKiloCreditBalance = (enabled = true) => {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBalance(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);

    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;

      if (message.type !== "balanceDataResponse") {
        return;
      }

      const payload = message.payload as BalancePayload;
      if (payload?.success) {
        setBalance(payload.data?.balance ?? 0);
        setError(null);
      } else {
        setBalance(null);
        setError(payload?.error ?? "Failed to fetch balance");
      }

      setIsLoading(false);
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "fetchBalanceDataRequest" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [enabled]);

  return { data: balance, isLoading, error };
};
