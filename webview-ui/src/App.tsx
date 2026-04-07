import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { useEvent, useLocalStorage } from "react-use";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ExtensionMessage } from "@roo/ExtensionMessage";
import TranslationProvider from "./i18n/TranslationContext";
import { MarketplaceViewStateManager } from "./components/marketplace/MarketplaceViewStateManager";

import { vscode } from "./utils/vscode";
import { telemetryClient } from "./utils/TelemetryClient";
import { TelemetryEventName } from "@roo-code/types";
import {
  initializeSourceMaps,
  exposeSourceMapsForDebugging,
} from "./utils/sourceMapInitializer";
import { installWebviewLifecycleDebugging } from "./utils/webviewDebug";
import {
  ExtensionStateContextProvider,
  useExtensionState,
} from "./context/ExtensionStateContext";
import ChatView, { ChatViewRef } from "./components/chat/ChatView";
import { BashGlobalStyles } from "./components/tools/Bash";
import type { SettingsViewRef } from "./components/settings/SettingsView";
import { HumanRelayDialog } from "./components/human-relay/HumanRelayDialog";
// import BottomControls from "./components/kilocode/BottomControls" // kade_change
import { MemoryService } from "./services/MemoryService"; // kade_change
import { CheckpointRestoreDialog } from "./components/chat/CheckpointRestoreDialog";
import {
  DeleteMessageDialog,
  EditMessageDialog,
} from "./components/chat/MessageModificationConfirmationDialog";
import ErrorBoundary from "./components/ErrorBoundary";
// import { AccountView } from "./components/account/AccountView" // kade_change: we have our own profile view
// import { CloudView } from "./components/cloud/CloudView" // kade_change: not rendering this
import { useAddNonInteractiveClickListener } from "./components/ui/hooks/useNonInteractiveClick";
import { TooltipProvider } from "./components/ui/tooltip";
import { STANDARD_TOOLTIP_DELAY } from "./components/ui/standard-tooltip";
import { useKiloIdentity } from "./utils/kilocode/useKiloIdentity";
import { MemoryWarningBanner } from "./kilocode/MemoryWarningBanner";
import { getFileChangesInRange } from "./utils/tool-utils";
import { ToolThemeProvider } from "./context/ToolThemeContext";

const HistoryView = React.lazy(() => import("./components/history/HistoryView"));
const loadSettingsView = () => import("./components/settings/SettingsView");
const SettingsView = React.lazy(loadSettingsView);
const WelcomeView = React.lazy(() => import("./components/kilocode/welcome/WelcomeView"));
const ProfileView = React.lazy(() => import("./components/kilocode/profile/ProfileView"));
const AuthView = React.lazy(() => import("./components/kilocode/auth/AuthView"));
const MarketplaceView = React.lazy(async () => {
  const module = await import("./components/marketplace/MarketplaceView");
  return { default: module.MarketplaceView };
});
const ResourceMonitorView = React.lazy(() => import("./components/resources/ResourceMonitorView"));

type Tab =
  | "settings"
  | "history"
  | "modes"
  | "chat"
  | "marketplace"
  | "account"
  | "cloud"
  | "profile"
  | "auth"
  | "resources"; // kade_change: add "profile", "auth", "resources", remove "mcp"

export type HistoryViewType = "dropdown" | "dropdown-top" | "view"; // kade_change

interface HumanRelayDialogState {
  isOpen: boolean;
  requestId: string;
  promptText: string;
}

interface DeleteMessageDialogState {
  isOpen: boolean;
  messageTs: number;
  hasCheckpoint: boolean;
}

interface EditMessageDialogState {
  isOpen: boolean;
  messageTs: number;
  text: string;
  hasCheckpoint: boolean;
  images?: string[];
}

// Memoize dialog components to prevent unnecessary re-renders
const MemoizedDeleteMessageDialog = React.memo(DeleteMessageDialog);
const MemoizedEditMessageDialog = React.memo(EditMessageDialog);
const MemoizedCheckpointRestoreDialog = React.memo(CheckpointRestoreDialog);
const MemoizedHumanRelayDialog = React.memo(HumanRelayDialog);

const LazyViewFallback = () => null;

const tabsByMessageAction: Partial<
  Record<NonNullable<ExtensionMessage["action"]>, Tab>
> = {
  chatButtonClicked: "chat",
  settingsButtonClicked: "settings",
  // historyButtonClicked: "history", // kade_change: handled in onMessage to toggle dropdown
  profileButtonClicked: "profile",
  marketplaceButtonClicked: "marketplace",
  promptsButtonClicked: "settings", // kade_change: Navigate to settings with modes section
  mcpButtonClicked: "marketplace", // kade_change
  // cloudButtonClicked: "cloud", // kade_change: no cloud
};

// kade_change start: Map certain actions to a default section when navigating to settings
const defaultSectionByAction: Partial<
  Record<NonNullable<ExtensionMessage["action"]>, string>
> = {
  promptsButtonClicked: "modes",
};

const defaultMarketplaceTabByAction: Partial<
  Record<NonNullable<ExtensionMessage["action"]>, string>
> = {
  mcpButtonClicked: "installed",
};
// kade_change end

const App = () => {
  const {
    didHydrateState,
    showWelcome,
    shouldShowAnnouncement,
    telemetrySetting,
    telemetryKey,
    machineId,
    // kade_change start: unused
    // cloudUserInfo,
    // cloudIsAuthenticated,
    // cloudApiUrl,
    // cloudOrganizations,
    // kade_change end
    renderContext,
    mdmCompliant,
    apiConfiguration, // kade_change
    clineMessages,
    undoneToolIds,
  } = useExtensionState();

  // Create a persistent state manager
  const marketplaceStateManager = useMemo(
    () => new MarketplaceViewStateManager(),
    [],
  );

  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [authReturnTo, setAuthReturnTo] = useState<"chat" | "settings">("chat");
  const [authProfileName, setAuthProfileName] = useState<string | undefined>(
    undefined,
  );
  const [settingsEditingProfile, setSettingsEditingProfile] = useState<
    string | undefined
  >(undefined);
  const [historyViewType, setHistoryViewType] =
    useLocalStorage<HistoryViewType>("historyViewType", "dropdown-top"); // kade_change

  const [humanRelayDialogState, setHumanRelayDialogState] =
    useState<HumanRelayDialogState>({
      isOpen: false,
      requestId: "",
      promptText: "",
    });

  const [deleteMessageDialogState, setDeleteMessageDialogState] =
    useState<DeleteMessageDialogState>({
      isOpen: false,
      messageTs: 0,
      hasCheckpoint: false,
    });

  const [editMessageDialogState, setEditMessageDialogState] =
    useState<EditMessageDialogState>({
      isOpen: false,
      messageTs: 0,
      text: "",
      hasCheckpoint: false,
      images: [],
    });

  const deleteFileChanges = useMemo(() => {
    if (!deleteMessageDialogState.isOpen || !deleteMessageDialogState.messageTs)
      return [];
    return getFileChangesInRange(
      clineMessages,
      deleteMessageDialogState.messageTs,
    );
  }, [
    deleteMessageDialogState.isOpen,
    deleteMessageDialogState.messageTs,
    clineMessages,
  ]);

  const editFileChanges = useMemo(() => {
    if (!editMessageDialogState.isOpen || !editMessageDialogState.messageTs)
      return [];
    return getFileChangesInRange(
      clineMessages,
      editMessageDialogState.messageTs,
    );
  }, [
    editMessageDialogState.isOpen,
    editMessageDialogState.messageTs,
    clineMessages,
  ]);

  const settingsRef = useRef<SettingsViewRef>(null);
  const chatViewRef = useRef<ChatViewRef & { focusInput: () => void }>(null); // kade_change

  const switchTab = useCallback(
    (newTab: Tab) => {
      // Only check MDM compliance if mdmCompliant is explicitly false (meaning there's an MDM policy and user is non-compliant)
      // If mdmCompliant is undefined or true, allow tab switching
      if (mdmCompliant === false && newTab !== "cloud") {
        // Notify the user that authentication is required by their organization
        vscode.postMessage({ type: "showMdmAuthRequiredNotification" });
        return;
      }

      setCurrentSection(undefined);
      setCurrentMarketplaceTab(undefined);

      // kade_change start - Bypass unsaved changes check when navigating to auth tab
      if (newTab === "auth") {
        setTab(newTab);
      } else if (settingsRef.current?.checkUnsaveChanges) {
        // kade_change: end
        settingsRef.current.checkUnsaveChanges(() => setTab(newTab));
      } else {
        setTab(newTab);
      }
    },
    [mdmCompliant],
  );

  const [currentSection, setCurrentSection] = useState<string | undefined>(
    undefined,
  );
  const [currentMarketplaceTab, setCurrentMarketplaceTab] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    if (!didHydrateState) {
      return;
    }

    let cancelled = false;
    const preload = () => {
      if (!cancelled) {
        void loadSettingsView();
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(preload, 250);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [didHydrateState]);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      const message: ExtensionMessage = e.data;

      if (message.type === "action" && message.action) {
        // kade_change begin
        if (message.action === "focusChatInput") {
          if (tab !== "chat") {
            switchTab("chat");
          }
          chatViewRef.current?.focusInput();
          return;
        }
        // kade_change end

        if (message.action === "historyButtonClicked") {
          // kade_change: check preference
          if (historyViewType === "view") {
            switchTab("history");
          } else if (
            historyViewType === "dropdown" ||
            historyViewType === "dropdown-top"
          ) {
            if (tab !== "chat") {
              switchTab("chat");
            }
            // Small timeout to ensure chat view is mounted/ready before calling its method
            setTimeout(() => {
              chatViewRef.current?.toggleHistory();
            }, 0);
          }
          return;
        }

        // Handle switchTab action with tab parameter
        if (message.action === "switchTab" && message.tab) {
          const targetTab = message.tab as Tab;
          // kade_change start - Handle auth tab with returnTo and profileName parameters
          if (targetTab === "auth") {
            if (message.values?.returnTo) {
              const returnTo = message.values.returnTo as "chat" | "settings";
              setAuthReturnTo(returnTo);
            }
            if (message.values?.profileName) {
              const profileName = message.values.profileName as string;
              setAuthProfileName(profileName);
              setSettingsEditingProfile(profileName);
            }
          }
          // kade_change end
          switchTab(targetTab);
          // Extract targetSection from values if provided
          const targetSection = message.values?.section as string | undefined;
          setCurrentSection(targetSection);
          setCurrentMarketplaceTab(undefined);
        } else {
          // Handle other actions using the mapping
          const newTab = tabsByMessageAction[message.action];
          // kade_change start
          const section =
            (message.values?.section as string | undefined) ??
            defaultSectionByAction[message.action];
          // kade_change end
          const marketplaceTab =
            (message.values?.marketplaceTab as string | undefined) ??
            defaultMarketplaceTabByAction[message.action];
          const editingProfile = message.values?.editingProfile as
            | string
            | undefined; // kade_change

          if (newTab) {
            switchTab(newTab);
            setCurrentSection(section);
            setCurrentMarketplaceTab(marketplaceTab);
            // kade_change start - If navigating to settings with editingProfile, forward it
            if (newTab === "settings" && editingProfile) {
              // Re-send the message to SettingsView with the editingProfile
              setTimeout(() => {
                window.postMessage(
                  {
                    type: "action",
                    action: "settingsButtonClicked",
                    values: { editingProfile },
                  },
                  "*",
                );
              }, 100);
            }
            // kade_change end
          }
        }
      }

      if (
        message.type === "showHumanRelayDialog" &&
        message.requestId &&
        message.promptText
      ) {
        const { requestId, promptText } = message;
        setHumanRelayDialogState({ isOpen: true, requestId, promptText });
      }

      if (message.type === "showDeleteMessageDialog" && message.messageTs) {
        setDeleteMessageDialogState({
          isOpen: true,
          messageTs: message.messageTs,
          hasCheckpoint: message.hasCheckpoint || false,
        });
      }

      if (
        message.type === "showEditMessageDialog" &&
        message.messageTs &&
        message.text
      ) {
        setEditMessageDialogState({
          isOpen: true,
          messageTs: message.messageTs,
          text: message.text,
          hasCheckpoint: message.hasCheckpoint || false,
          images: message.images || [],
        });
      }

      if (message.type === "acceptInput") {
        chatViewRef.current?.acceptInput();
      }
    },
    // kade_change: add tab and historyViewType
    [tab, switchTab, historyViewType],
  );

  useEvent("message", onMessage);

  useEffect(() => {
    if (shouldShowAnnouncement && tab === "chat") {
      setShowAnnouncement(true);
      vscode.postMessage({ type: "didShowAnnouncement" });
    }
  }, [shouldShowAnnouncement, tab]);

  // kade_change start
  const telemetryDistinctId = useKiloIdentity(
    apiConfiguration?.kilocodeToken ?? "",
    machineId ?? "",
  );
  useEffect(() => {
    if (didHydrateState) {
      telemetryClient.updateTelemetryState(
        telemetrySetting,
        telemetryKey,
        telemetryDistinctId,
      );

      // kade_change start
      const memoryService = new MemoryService();
      memoryService.start();
      return () => memoryService.stop();
      // kade_change end
    }
  }, [telemetrySetting, telemetryKey, telemetryDistinctId, didHydrateState]);
  // kade_change end

  // Tell the extension that we are ready to receive messages.
  useEffect(() => vscode.postMessage({ type: "webviewDidLaunch" }), []);

  // Initialize source map support for better error reporting
  useEffect(() => {
    // Initialize source maps for better error reporting in production
    initializeSourceMaps();
    installWebviewLifecycleDebugging();

    // Expose source map debugging utilities in production
    if (process.env.NODE_ENV === "production") {
      exposeSourceMapsForDebugging();
    }

    // Log initialization for debugging
    console.debug("App initialized with source map support");
  }, []);

  // Focus the WebView when non-interactive content is clicked (only in editor/tab mode)
  useAddNonInteractiveClickListener(
    useCallback(() => {
      // Only send focus request if we're in editor (tab) mode, not sidebar
      if (renderContext === "editor") {
        vscode.postMessage({ type: "focusPanelRequest" });
      }
    }, [renderContext]),
  );
  // Track marketplace tab views
  useEffect(() => {
    if (tab === "marketplace") {
      telemetryClient.capture(TelemetryEventName.MARKETPLACE_TAB_VIEWED);
    }
  }, [tab]);

  if (!didHydrateState) {
    return null;
  }

  // Do not conditionally load ChatView, it's expensive and there's state we
  // don't want to lose (user input, disableInput, askResponse promise, etc.)
  // kade_change: no WelcomeViewProvider toggle
  return showWelcome ? (
    <Suspense fallback={<LazyViewFallback />}>
      <WelcomeView />
    </Suspense>
  ) : (
    <>
      <MemoryWarningBanner />
      {/* kade_change end */}
      {tab === "history" && (
        <Suspense fallback={<LazyViewFallback />}>
          <HistoryView onDone={() => switchTab("chat")} />
        </Suspense>
      )}
      {/* kade_change: add profileview, authview, and resourceview */}
      {tab === "resources" && (
        <Suspense fallback={<LazyViewFallback />}>
          <ResourceMonitorView />
        </Suspense>
      )}
      {tab === "profile" && (
        <Suspense fallback={<LazyViewFallback />}>
          <ProfileView onDone={() => switchTab("chat")} />
        </Suspense>
      )}
      {tab === "auth" && (
        <Suspense fallback={<LazyViewFallback />}>
          <AuthView returnTo={authReturnTo} profileName={authProfileName} />
        </Suspense>
      )}
      {tab === "marketplace" && (
        <Suspense fallback={<LazyViewFallback />}>
          <MarketplaceView
            stateManager={marketplaceStateManager}
            onDone={() => switchTab("chat")}
            targetTab={(currentMarketplaceTab as any) || "mcp"}
          />
        </Suspense>
      )}
      {/* kade_change: no cloud view */}
      {/* kade_change: we have our own profile view */}
      {/* Settings renders as an overlay panel on top of ChatView */}
      <ChatView
        ref={chatViewRef}
        isHidden={tab !== "chat" && tab !== "settings"}
        showAnnouncement={showAnnouncement}
        hideAnnouncement={() => setShowAnnouncement(false)}
        historyViewType={historyViewType}
      />
      {/* kade_change: Settings rendered as overlay panel */}
      {tab === "settings" && (
        <div
          data-testid="settings-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            pointerEvents: "auto",
          }}
        >
          {/* Transparent click-capture to dismiss */}
          <div
            data-testid="settings-overlay-backdrop"
            style={{
              position: "absolute",
              inset: 0,
              background: "transparent",
            }}
            onClick={() => {
              if (settingsRef.current?.checkUnsaveChanges) {
                settingsRef.current.checkUnsaveChanges(() => switchTab("chat"));
              } else {
                switchTab("chat");
              }
            }}
          />
          {/* Settings panel — large floating centered card */}
          <div
            data-testid="settings-panel"
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              maxWidth: "900px",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background:
                "var(--vscode-sideBar-background, var(--vscode-editor-background, #1f1f1f))",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "18px",
              overflow: "hidden",
              marginTop: "16px",
              marginBottom: "26px",
              boxShadow:
                "0 12px 36px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <Suspense fallback={<LazyViewFallback />}>
              <SettingsView
                ref={settingsRef}
                onDone={() => switchTab("chat")}
                targetSection={currentSection}
                editingProfile={settingsEditingProfile}
                historyViewType={historyViewType} // kade_change
                setHistoryViewType={setHistoryViewType} // kade_change
              />
            </Suspense>
          </div>
        </div>
      )}
      <MemoizedHumanRelayDialog
        isOpen={humanRelayDialogState.isOpen}
        requestId={humanRelayDialogState.requestId}
        promptText={humanRelayDialogState.promptText}
        onClose={() =>
          setHumanRelayDialogState((prev) => ({ ...prev, isOpen: false }))
        }
        onSubmit={(requestId, text) =>
          vscode.postMessage({ type: "humanRelayResponse", requestId, text })
        }
        onCancel={(requestId) =>
          vscode.postMessage({ type: "humanRelayCancel", requestId })
        }
      />
      {deleteMessageDialogState.hasCheckpoint ? (
        <MemoizedCheckpointRestoreDialog
          open={deleteMessageDialogState.isOpen}
          type="delete"
          hasCheckpoint={deleteMessageDialogState.hasCheckpoint}
          fileChanges={deleteFileChanges}
          onOpenChange={(open: boolean) =>
            setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))
          }
          onConfirm={(restoreCheckpoint: boolean) => {
            if (!restoreCheckpoint) {
              const toolIds = deleteFileChanges.flatMap((f) => f.toolIds);
              if (toolIds.length > 0) {
                vscode.postMessage({
                  type: "command",
                  command: "claudix.undoEdits",
                  args: [toolIds],
                } as any);

                // Update undoneToolIds in workspace state
                const newUndoneIds = Array.from(
                  new Set([...(undoneToolIds || []), ...toolIds]),
                );
                vscode.postMessage({
                  type: "request",
                  requestId: Date.now().toString(),
                  request: {
                    type: "updateWorkspaceState",
                    key: "claudix.undoneToolIds",
                    value: newUndoneIds,
                  },
                } as any);
              }
            }
            vscode.postMessage({
              type: "deleteMessageConfirm",
              messageTs: deleteMessageDialogState.messageTs,
              restoreCheckpoint,
            });
            setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }));
          }}
        />
      ) : (
        <MemoizedDeleteMessageDialog
          open={deleteMessageDialogState.isOpen}
          fileChanges={deleteFileChanges}
          onOpenChange={(open: boolean) =>
            setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))
          }
          onConfirm={() => {
            const toolIds = deleteFileChanges.flatMap((f) => f.toolIds);
            if (toolIds.length > 0) {
              vscode.postMessage({
                type: "command",
                command: "claudix.undoEdits",
                args: [toolIds],
              } as any);

              // Update undoneToolIds in workspace state
              const newUndoneIds = Array.from(
                new Set([...(undoneToolIds || []), ...toolIds]),
              );
              vscode.postMessage({
                type: "request",
                requestId: Date.now().toString(),
                request: {
                  type: "updateWorkspaceState",
                  key: "claudix.undoneToolIds",
                  value: newUndoneIds,
                },
              } as any);
            }
            vscode.postMessage({
              type: "deleteMessageConfirm",
              messageTs: deleteMessageDialogState.messageTs,
            });
            setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }));
          }}
        />
      )}
      {editMessageDialogState.hasCheckpoint ? (
        <MemoizedCheckpointRestoreDialog
          open={editMessageDialogState.isOpen}
          type="edit"
          hasCheckpoint={editMessageDialogState.hasCheckpoint}
          fileChanges={editFileChanges}
          onOpenChange={(open: boolean) =>
            setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))
          }
          onConfirm={(restoreCheckpoint: boolean) => {
            if (!restoreCheckpoint) {
              const toolIds = editFileChanges.flatMap((f) => f.toolIds);
              if (toolIds.length > 0) {
                vscode.postMessage({
                  type: "command",
                  command: "claudix.undoEdits",
                  args: [toolIds],
                } as any);

                // Update undoneToolIds in workspace state
                const newUndoneIds = Array.from(
                  new Set([...(undoneToolIds || []), ...toolIds]),
                );
                vscode.postMessage({
                  type: "request",
                  requestId: Date.now().toString(),
                  request: {
                    type: "updateWorkspaceState",
                    key: "claudix.undoneToolIds",
                    value: newUndoneIds,
                  },
                } as any);
              }
            }
            vscode.postMessage({
              type: "editMessageConfirm",
              messageTs: editMessageDialogState.messageTs,
              text: editMessageDialogState.text,
              restoreCheckpoint,
            });
            setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }));
          }}
        />
      ) : (
        <MemoizedEditMessageDialog
          open={editMessageDialogState.isOpen}
          fileChanges={editFileChanges}
          onOpenChange={(open: boolean) =>
            setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))
          }
          onConfirm={() => {
            const toolIds = editFileChanges.flatMap((f) => f.toolIds);
            if (toolIds.length > 0) {
              vscode.postMessage({
                type: "command",
                command: "claudix.undoEdits",
                args: [toolIds],
              } as any);

              // Update undoneToolIds in workspace state
              const newUndoneIds = Array.from(
                new Set([...(undoneToolIds || []), ...toolIds]),
              );
              vscode.postMessage({
                type: "request",
                requestId: Date.now().toString(),
                request: {
                  type: "updateWorkspaceState",
                  key: "claudix.undoneToolIds",
                  value: newUndoneIds,
                },
              } as any);
            }
            vscode.postMessage({
              type: "editMessageConfirm",
              messageTs: editMessageDialogState.messageTs,
              text: editMessageDialogState.text,
              images: editMessageDialogState.images,
            });
            setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }));
          }}
        />
      )}
      {/* kade_change */}
      {/* Chat, and history view contain their own bottom controls, settings doesn't need it */}
    </>
  );
};

const queryClient = new QueryClient();

const AppWithProviders = () => (
  <ErrorBoundary>
    <ExtensionStateContextProvider>
      <TranslationProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
            <ToolThemeProvider>
              <BashGlobalStyles />
              <App />
            </ToolThemeProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </TranslationProvider>
    </ExtensionStateContextProvider>
  </ErrorBoundary>
);

export default AppWithProviders;
