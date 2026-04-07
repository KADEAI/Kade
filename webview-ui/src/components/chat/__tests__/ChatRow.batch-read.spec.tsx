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

function renderChatRow(message: any) {
  const queryClient = new QueryClient();

  return render(
    <ExtensionStateContextProvider>
      <QueryClientProvider client={queryClient}>
        <ChatRowContent
          message={message}
          isExpanded={false}
          isLast={false}
          isStreaming={false}
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

describe("ChatRow - batch read rendering", () => {
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

  it("switches from a partial readFile ask to the batch-read UI when batchFiles arrive", () => {
    const ts = 4242;
    const partialMessage: any = {
      type: "ask",
      ask: "tool",
      ts,
      partial: true,
      text: JSON.stringify({
        tool: "readFile",
      }),
    };

    setMessageStore([partialMessage]);
    const view = renderChatRow(partialMessage);

    expect(screen.queryByText("alpha.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("beta.ts")).not.toBeInTheDocument();

    const completedMessage: any = {
      ...partialMessage,
      partial: false,
      text: JSON.stringify({
        tool: "readFile",
        batchFiles: [
          {
            key: "alpha",
            path: "src/alpha.ts",
            content: "/workspace/src/alpha.ts",
            lineSnippet: "#L1-50",
          },
          {
            key: "beta",
            path: "src/beta.ts",
            content: "/workspace/src/beta.ts",
            lineSnippet: "#L10-20",
          },
        ],
      }),
    };

    setMessageStore([completedMessage]);
    view.rerender(
      <ExtensionStateContextProvider>
        <QueryClientProvider client={new QueryClient()}>
          <ChatRowContent
            message={completedMessage}
            isExpanded={false}
            isLast={false}
            isStreaming={false}
            onToggleExpand={() => {}}
            onSuggestionClick={() => {}}
            onBatchFileResponse={() => {}}
            onFollowUpUnmount={() => {}}
            isFollowUpAnswered={false}
          />
        </QueryClientProvider>
      </ExtensionStateContextProvider>,
    );

    expect(screen.getByText("alpha.ts")).toBeInTheDocument();
    expect(screen.getByText("beta.ts")).toBeInTheDocument();
    expect(screen.getByText("#L1-50")).toBeInTheDocument();
    expect(screen.getByText("#L10-20")).toBeInTheDocument();
  });
});
