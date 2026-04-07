import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
  ExperimentId,
  openRouterDefaultModelId,
} from "@roo-code/types";
import type { ExtensionState } from "@roo/ExtensionMessage";

import { mergeExtensionState } from "../ExtensionStateContext";

describe("mergeExtensionState background clearing", () => {
  it("clears stale derived background URIs when background settings are reset", () => {
    const prevState: ExtensionState = {
      version: "",
      clineMessages: [],
      apiConfiguration: {},
      taskHistoryFullLength: 0,
      taskHistoryVersion: 0,
      shouldShowAnnouncement: false,
      mcpEnabled: false,
      enableMcpServerCreation: false,
      enableCheckpoints: true,
      writeDelayMs: 1000,
      requestDelaySeconds: 5,
      mode: "default",
      experiments: {} as Record<ExperimentId, boolean>,
      customModes: [],
      maxOpenTabsContext: 20,
      maxWorkspaceFiles: 100,
      subAgentToolEnabled: false,
      showSubAgentBanner: true,
      showPromptSuggestions: true,
      telemetrySetting: "unset",
      showRooIgnoredFiles: true,
      renderContext: "sidebar",
      maxReadFileLine: 500,
      showAutoApproveMenu: false,
      cloudUserInfo: null,
      organizationAllowList: { allowAll: true, providers: {} },
      autoCondenseContext: true,
      autoCondenseContextPercent: 100,
      cloudIsAuthenticated: false,
      sharingEnabled: false,
      profileThresholds: {},
      hasOpenedModeSelector: false,
      maxImageFileSize: 5,
      maxTotalImageSize: 20,
      kilocodeDefaultModel: openRouterDefaultModelId,
      remoteControlEnabled: false,
      taskSyncEnabled: false,
      featureRoomoteControlEnabled: false,
      isBrowserSessionActive: false,
      checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
      emptyStateBackground: "aurora.png",
      emptyStateBackgroundUri: "vscode-webview://aurora.png",
      chatBackground: "forest.jpg",
      chatBackgroundUri: "vscode-webview://forest.jpg",
      toolHeaderBackgrounds: { global: "carbon-fiber.png" },
      toolHeaderBackgroundUris: { global: "vscode-webview://carbon-fiber.png" },
    };

    const newState: ExtensionState = {
      ...prevState,
      emptyStateBackground: "",
      chatBackground: "",
      toolHeaderBackgrounds: {},
    };

    delete (newState as Partial<ExtensionState>).emptyStateBackgroundUri;
    delete (newState as Partial<ExtensionState>).chatBackgroundUri;
    delete (newState as Partial<ExtensionState>).toolHeaderBackgroundUris;

    const result = mergeExtensionState(prevState, newState);

    expect(result.emptyStateBackgroundUri).toBeUndefined();
    expect(result.chatBackgroundUri).toBeUndefined();
    expect(result.toolHeaderBackgroundUris).toBeUndefined();
  });
});
