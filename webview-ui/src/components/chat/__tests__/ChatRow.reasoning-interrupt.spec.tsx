import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@/utils/test-utils";
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext";
import {
  ChatRowContent,
  clearToolResultCache,
  setExtensionStateStore,
  setMessageStore,
} from "../ChatRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

vi.mock("@src/components/common/CodeBlock", () => ({
  default: () => null,
}));

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
  useSelectedModel: () => ({ info: undefined }),
}));

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
  VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

function renderReasoningRow(
  message: any,
  options?: { isExpanded?: boolean; isLast?: boolean; isStreaming?: boolean },
) {
  const queryClient = new QueryClient();

  return render(
    <ExtensionStateContextProvider>
      <QueryClientProvider client={queryClient}>
        <ChatRowContent
          message={message}
          isExpanded={options?.isExpanded ?? false}
          isLast={options?.isLast ?? false}
          isStreaming={options?.isStreaming ?? false}
          onToggleExpand={() => {}}
          onSuggestionClick={() => {}}
          onBatchFileResponse={() => {}}
          onFollowUpUnmount={() => {}}
          isFollowUpAnswered={false}
        />
      </QueryClientProvider>
    </ExtensionStateContextProvider>,
  );
}

describe("ChatRow - interrupted reasoning", () => {
  beforeEach(() => {
    clearToolResultCache();
    setMessageStore([]);
    setExtensionStateStore({
      apiConfiguration: {},
      mcpServers: [],
      alwaysAllowMcp: false,
      currentCheckpoint: undefined,
      mode: "code",
      showTimestamps: false,
      filePaths: [],
      cwd: "",
      alwaysAllowReadOnly: false,
      alwaysAllowWrite: false,
      alwaysAllowExecute: false,
      alwaysAllowBrowser: false,
      alwaysAllowModeSwitch: false,
      alwaysAllowSubtasks: false,
      autoApprovalEnabled: false,
      hideCostBelowThreshold: 0,
    });
  });

  it("falls back to 'Thought' when a partial reasoning block is interrupted", () => {
    const message: any = {
      type: "say",
      say: "reasoning",
      ts: Date.now(),
      partial: true,
      text: "Identifying a bug in the request flow",
      metadata: {
        reasoningPhase: "reasoning",
        reasoningDurationMs: 14000,
      },
    };

    setMessageStore([message]);
    const { container } = renderReasoningRow(message, {
      isLast: false,
      isStreaming: true,
    });

    expect(
      screen.getByText((_content, node) => node?.textContent === "Thought"),
    ).toBeInTheDocument();
    expect(screen.getByText("14s")).toBeInTheDocument();
    expect(screen.queryByText("reasoning")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("moves inline thinking content into a reasoning block", () => {
    const message: any = {
      type: "say",
      say: "text",
      ts: 2345,
      text: "<thinking>\nChecking parser state\n</thinking>\nVisible answer",
    };

    setMessageStore([message]);
    const { container } = renderReasoningRow(message, { isExpanded: true });

    expect(
      screen.getByText((_content, node) => node?.textContent === "Thought"),
    ).toBeInTheDocument();
    expect(container.textContent).toContain("Checking parser state");
    expect(container.textContent).toContain("Visible answer");
    expect(container.textContent).not.toContain("<thinking>");
    expect(container.textContent).not.toContain("</thinking>");
  });
});
