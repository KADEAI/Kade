import React from "react";
import { render, screen, fireEvent } from "@src/utils/test-utils";
import {
  ChatRowContent,
  setExtensionStateStore,
  setMessageStore,
} from "../ChatRow";
import { vscode } from "@src/utils/vscode";

// Create a variable to hold the mock state
let mockExtensionState: any = {};

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext", () => ({
  useExtensionState: () => mockExtensionState,
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "chat:error": "Error",
        "kilocode:settings.provider.login": "Login",
      };
      return map[key] || key;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Mock vscode postMessage
vi.mock("@src/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

// Mock CodeBlock (avoid ESM/highlighter costs)
vi.mock("@src/components/common/CodeBlock", () => ({
  default: () => null,
}));

// Mock useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
  useSelectedModel: () => ({ info: undefined }),
}));

function renderChatRow(message: any, apiConfiguration: any = {}) {
  const extensionState = {
    apiConfiguration,
    mcpServers: [],
    alwaysAllowMcp: false,
    currentCheckpoint: undefined,
    mode: "code",
    clineMessages: [],
    showTimestamps: false,
    hideCostBelowThreshold: 0,
  };

  mockExtensionState = extensionState;
  setExtensionStateStore(extensionState);
  setMessageStore([message]);

  return render(
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
    />,
  );
}

describe("ChatRow - KiloCode auth error login button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows login button for KiloCode auth error", () => {
    const message: any = {
      type: "say",
      say: "error",
      ts: Date.now(),
      text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
    };

    renderChatRow(message, { apiProvider: "kilocode" });

    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("does not show login button for non-KiloCode provider", () => {
    const message: any = {
      type: "say",
      say: "error",
      ts: Date.now(),
      text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
    };

    renderChatRow(message, { apiProvider: "openai" });

    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("does not show login button for non-auth errors", () => {
    const message: any = {
      type: "say",
      say: "error",
      ts: Date.now(),
      text: "Some other error message",
    };

    renderChatRow(message, { apiProvider: "kilocode" });

    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("navigates to auth tab when login button is clicked", () => {
    const message: any = {
      type: "say",
      say: "error",
      ts: Date.now(),
      text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
    };

    renderChatRow(message, { apiProvider: "kilocode" });

    const loginButton = screen.getByText("Login");
    fireEvent.click(loginButton);

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "switchTab",
      tab: "auth",
      values: { returnTo: "chat" },
    });
  });

  it("hides duplicate fallback errors that immediately follow a tool message", () => {
    const toolMessage: any = {
      type: "ask",
      ask: "tool",
      ts: 1000,
      text: JSON.stringify({ tool: "read", path: "README.md" }),
    };
    const errorMessage: any = {
      type: "say",
      say: "error",
      ts: 1001,
      text: "The tool execution failed",
    };

    setMessageStore([toolMessage, errorMessage]);
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

    render(
      <ChatRowContent
        message={errorMessage}
        isExpanded={false}
        isLast={false}
        isStreaming={false}
        onToggleExpand={() => {}}
        onSuggestionClick={() => {}}
        onBatchFileResponse={() => {}}
        onFollowUpUnmount={() => {}}
        isFollowUpAnswered={false}
      />,
    );

    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("hides generic error rows in compact tool summary mode", () => {
    const message: any = {
      type: "say",
      say: "error",
      ts: Date.now(),
      text: "The tool execution failed",
    };

    setMessageStore([message]);

    render(
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
        compactToolSpacing
      />,
    );

    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });
});
