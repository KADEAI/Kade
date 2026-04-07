import React, { useState } from "react";
import { Trans } from "react-i18next";
import {
  VSCodeCheckbox,
  VSCodeLink,
  VSCodePanels,
  VSCodePanelTab,
  VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";

import { McpServer } from "@roo/mcp";

import { vscode } from "@src/utils/vscode";
import { useExtensionState } from "../../context/ExtensionStateContext";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ToggleSwitch,
  StandardTooltip,
} from "@src/components/ui";
import { buildDocLink } from "@src/utils/docLinks";
import { Section } from "@src/components/settings/Section";
import { cn } from "@/lib/utils";

import { Tab, TabHeader } from "../common/Tab";

import McpToolRow from "./McpToolRow";
import McpResourceRow from "./McpResourceRow";
import { McpErrorRow } from "./McpErrorRow";

type McpViewProps = {
  onDone: () => void;
  hideHeader?: boolean;
  maxVisibleServers?: number;
  showDescriptionCard?: boolean;
  embedded?: boolean;
};

const McpView = ({
  onDone,
  hideHeader = false,
  maxVisibleServers,
  showDescriptionCard = true,
  embedded = false,
}: McpViewProps) => {
  const {
    mcpServers: servers,
    alwaysAllowMcp,
    mcpEnabled,
    enableMcpServerCreation,
    setEnableMcpServerCreation,
  } = useExtensionState();

  const { t } = useAppTranslation();
  const visibleServers =
    maxVisibleServers !== undefined
      ? servers.slice(0, maxVisibleServers)
      : servers;

  const content = (
    <div
      className={cn(
        "flex flex-col h-full overflow-hidden",
        embedded ? "bg-transparent" : "bg-vscode-sideBar-background",
      )}
    >
      {!hideHeader && (
        <TabHeader className="flex justify-between items-center px-4 py-3 border-b border-vscode-panel-border bg-vscode-sideBar-background shrink-0">
          <h3 className="text-vscode-foreground font-bold m-0 text-base">
            {t("mcp:title")}
          </h3>
          <Button onClick={onDone} className="h-8 px-4">
            {t("mcp:done")}
          </Button>
        </TabHeader>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 scrollbar-thin">
        <div className="space-y-4">
          {showDescriptionCard && (
            <div className="mb-6 p-4 rounded-xl bg-vscode-textBlock-background/30 border border-vscode-panel-border/50 backdrop-blur-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-colors" />
              <div className="relative z-10 flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="codicon codicon-sparkle text-primary animate-pulse" />
                </div>
                <p className="text-sm text-vscode-descriptionForeground m-0 leading-relaxed">
                  <Trans i18nKey="mcp:description">
                    <a
                      className="text-primary hover:text-primary/80 font-bold underline decoration-primary/30 underline-offset-4 cursor-pointer transition-colors"
                      onClick={() =>
                        vscode.postMessage({
                          type: "openExternal",
                          url: buildDocLink(
                            "features/mcp/using-mcp-in-kilo-code",
                            "mcp_settings",
                          ),
                        })
                      }
                    >
                      Model Context Protocol
                    </a>
                  </Trans>
                </p>
              </div>
            </div>
          )}

          {mcpEnabled && (
            <>
              {/* Server List */}
              {visibleServers.length > 0 ? (
                <div className="grid gap-3">
                  {visibleServers.map((server) => (
                    <ServerRow
                      key={`${server.name}-${server.source || "global"}`}
                      server={server}
                      alwaysAllowMcp={alwaysAllowMcp}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-6 border border-dashed border-vscode-panel-border rounded-xl opacity-60 text-center space-y-3 bg-vscode-editor-background/30">
                  <span className="codicon codicon-bracket-dot text-4xl" />
                  <div className="space-y-1">
                    <p className="font-medium text-vscode-foreground text-sm">
                      No MCP Servers Found
                    </p>
                    <p className="text-xs text-vscode-descriptionForeground max-w-[200px]">
                      Install servers from the marketplace or add your own local
                      servers.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-vscode-panel-border/50">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-vscode-descriptionForeground opacity-70">
                  Management Actions
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2 h-9 px-4 shrink-0 transition-all hover:bg-vscode-button-secondaryHover"
                    onClick={() =>
                      vscode.postMessage({ type: "openMcpSettings" })
                    }
                  >
                    <span className="codicon codicon-edit text-xs"></span>
                    {t("mcp:editGlobalMCP")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2 h-9 px-4 shrink-0 transition-all hover:bg-vscode-button-secondaryHover"
                    onClick={() =>
                      vscode.postMessage({ type: "openProjectMcpSettings" })
                    }
                  >
                    <span className="codicon codicon-edit text-xs"></span>
                    {t("mcp:editProjectMCP")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex items-center gap-2 h-9 px-4 shrink-0 transition-all hover:bg-vscode-button-secondaryHover"
                    onClick={() =>
                      vscode.postMessage({ type: "refreshAllMcpServers" })
                    }
                  >
                    <span className="codicon codicon-refresh text-xs"></span>
                    {t("mcp:refreshMCP")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return hideHeader ? (
    content
  ) : (
    <Tab
      className={cn(
        "relative overflow-hidden",
        embedded ? "bg-transparent" : undefined,
      )}
    >
      {content}
    </Tab>
  );
};

const ServerRow = ({
  server,
  alwaysAllowMcp,
}: {
  server: McpServer;
  alwaysAllowMcp?: boolean;
}) => {
  const { t } = useAppTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [timeoutValue, setTimeoutValue] = useState(() => {
    try {
      const config = JSON.parse(server.config || "{}");
      return config.timeout ?? 60;
    } catch (e) {
      return 60;
    }
  });

  const isExpandable =
    (server.status === "connected" || server.status === "connecting") &&
    !server.disabled;

  const timeoutOptions = [
    { value: 15, label: t("mcp:networkTimeout.options.15seconds") },
    { value: 30, label: t("mcp:networkTimeout.options.30seconds") },
    { value: 60, label: t("mcp:networkTimeout.options.1minute") },
    { value: 300, label: t("mcp:networkTimeout.options.5minutes") },
    { value: 600, label: t("mcp:networkTimeout.options.10minutes") },
    { value: 900, label: t("mcp:networkTimeout.options.15minutes") },
    { value: 1800, label: t("mcp:networkTimeout.options.30minutes") },
    { value: 3600, label: t("mcp:networkTimeout.options.60minutes") },
  ];

  const getStatusColor = () => {
    if (server.disabled) return "bg-[#808080]/40";
    switch (server.status) {
      case "connected":
        return "bg-[#4ccb49]";
      case "connecting":
        return "bg-[#e2c140] animate-bounce";
      case "disconnected":
        return "bg-[#ff4b4b]";
      default:
        return "bg-[#808080]/40";
    }
  };

  const handleRowClick = () => {
    if (isExpandable) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({
      type: "restartMcpServer",
      text: server.name,
      source: server.source || "global",
    });
  };

  const handleTimeoutChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const seconds = parseInt(event.target.value);
    setTimeoutValue(seconds);
    vscode.postMessage({
      type: "updateMcpTimeout",
      serverName: server.name,
      source: server.source || "global",
      timeout: seconds,
    });
  };

  const handleDelete = () => {
    vscode.postMessage({
      type: "deleteMcpServer",
      serverName: server.name,
      source: server.source || "global",
    });
    setShowDeleteConfirm(false);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={cn(
        "group border rounded-lg overflow-hidden transition-colors duration-200",
        isExpanded
          ? "border-vscode-focusBorder bg-vscode-editor-background shadow-lg shadow-vscode-focusBorder/10"
          : "border-vscode-panel-border bg-vscode-textCodeBlock-background hover:border-vscode-focusBorder/40 hover:shadow-md hover:shadow-vscode-focusBorder/20 transition-all duration-300",
        server.disabled && "opacity-75 grayscale-[0.5]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2 select-none h-[44px]",
          isExpandable && "cursor-pointer",
        )}
        onClick={handleRowClick}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 h-full">
          <div
            className={cn("shrink-0 relative flex items-center justify-center")}
          >
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full z-10 relative",
                getStatusColor(),
              )}
            />
            {server.status === "connected" && !server.disabled && (
              <div className="absolute inset-0 w-4 h-4 rounded-full bg-[#4ccb49]/20 animate-ping [animation-duration:3s] opacity-60 ml-[-3px] mt-[-3px]" />
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 overflow-hidden">
              <span
                className={cn(
                  "font-bold text-sm truncate uppercase tracking-tight",
                  server.disabled
                    ? "text-vscode-descriptionForeground"
                    : "text-vscode-foreground",
                )}
              >
                {server.name}
              </span>
              {server.source && (
                <div
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-black rounded uppercase flex-shrink-0 tracking-wider",
                    server.source === "global"
                      ? "bg-vscode-charts-blue/10 text-vscode-charts-blue border border-vscode-charts-blue/20"
                      : "bg-vscode-charts-orange/10 text-vscode-charts-orange border border-vscode-charts-orange/20",
                  )}
                >
                  {server.source}
                </div>
              )}
              {server.status === "connecting" && (
                <div className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase flex-shrink-0 tracking-wider bg-vscode-charts-yellow/10 text-vscode-charts-yellow border border-vscode-charts-yellow/20 flex items-center gap-1.5">
                  <span className="codicon codicon-loading codicon-modifier-spin text-[10px]" />
                  LOADING...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto h-full">
          <div
            className="hidden group-hover:flex items-center gap-1 h-full"
            onClick={handleToggle}
          >
            <StandardTooltip content={t("mcp:restartMCP")}>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRestart}
                disabled={server.status === "connecting"}
                className="h-8 w-8 hover:bg-vscode-toolbar-hoverBackground"
              >
                <span className="codicon codicon-refresh text-xs"></span>
              </Button>
            </StandardTooltip>
            <StandardTooltip content={t("mcp:delete")}>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="h-8 w-8 hover:bg-vscode-inputValidation-errorBackground/20 hover:text-vscode-errorForeground"
              >
                <span className="codicon codicon-trash text-xs"></span>
              </Button>
            </StandardTooltip>
          </div>

          <div className="w-px h-4 bg-vscode-panel-border hidden group-hover:block shrink-0" />

          <div className="flex items-center gap-2 h-full">
            {/* Allow All Tools Toggle */}
            {!server.disabled && (server.tools?.length ?? 0) > 0 && (
              <StandardTooltip content={t("mcp:tool.allowAll")}>
                <div
                  className="flex flex-col items-center gap-0.5 mr-2 px-1.5 py-0.5 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    vscode.postMessage({
                      type: "toggleAlwaysAllowAllTools",
                      serverName: server.name,
                      source: server.source || "global",
                      alwaysAllowAll: !(
                        server.tools?.every((t) => t.alwaysAllow) ?? false
                      ),
                    });
                  }}
                >
                  <span className="text-[8px] font-bold text-vscode-descriptionForeground uppercase tracking-wider whitespace-nowrap leading-none">
                    ALLOW ALL TOOLS
                  </span>
                  {/* Golden Toggle */}
                  <div
                    role="switch"
                    aria-checked={
                      server.tools?.every((t) => t.alwaysAllow) ?? false
                    }
                    className="relative transition-all duration-200"
                    style={{
                      width: "24px",
                      height: "12px",
                      backgroundColor: server.tools?.every((t) => t.alwaysAllow)
                        ? "#f59e0b"
                        : "rgba(245, 158, 11, 0.3)",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        backgroundColor: "#fff",
                        borderRadius: "50%",
                        position: "absolute",
                        top: "2px",
                        left: server.tools?.every((t) => t.alwaysAllow)
                          ? "14px"
                          : "2px",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      }}
                    />
                  </div>
                </div>
              </StandardTooltip>
            )}

            <div
              className="flex flex-col items-center gap-0.5 px-1.5 py-0.5 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                vscode.postMessage({
                  type: "toggleMcpServer",
                  serverName: server.name,
                  source: server.source || "global",
                  disabled: !server.disabled,
                });
              }}
            >
              <span className="text-[8px] font-bold text-vscode-descriptionForeground uppercase tracking-wider whitespace-nowrap leading-none">
                SERVER
              </span>
              <ToggleSwitch
                checked={!server.disabled}
                onChange={() => {}}
                size="small"
              />
            </div>
            {isExpandable && (
              <span
                className={cn(
                  "codicon transition-transform duration-200 text-[10px] opacity-40 cursor-pointer px-0.5 hover:opacity-100",
                  isExpanded ? "codicon-chevron-up" : "codicon-chevron-down",
                )}
              />
            )}
          </div>
        </div>
      </div>

      {isExpandable && isExpanded && (
        <div className="animate-in slide-in-from-top-2 duration-200 bg-vscode-sideBar-background">
          <div className="px-3 pb-4">
            <VSCodePanels className="mcp-panels">
              <VSCodePanelTab
                id="tools"
                className="text-[10px] uppercase tracking-wider font-bold h-8"
              >
                Tools ({server.tools?.length || 0})
              </VSCodePanelTab>
              <VSCodePanelTab
                id="resources"
                className="text-[10px] uppercase tracking-wider font-bold h-8"
              >
                Resources (
                {[
                  ...(server.resourceTemplates || []),
                  ...(server.resources || []),
                ].length || 0}
                )
              </VSCodePanelTab>
              {server.instructions && (
                <VSCodePanelTab
                  id="instructions"
                  className="text-[10px] uppercase tracking-wider font-bold h-8"
                >
                  Notes
                </VSCodePanelTab>
              )}
              <VSCodePanelTab
                id="logs"
                className="text-[10px] uppercase tracking-wider font-bold h-8"
              >
                Logs ({server.errorHistory?.length || 0})
              </VSCodePanelTab>

              <VSCodePanelView id="tools-view" className="py-2">
                {server.tools && server.tools.length > 0 ? (
                  <div className="flex flex-col gap-2 w-full max-h-[220px] overflow-y-auto scrollbar-thin pr-2">
                    {server.tools.map((tool) => (
                      <McpToolRow
                        key={`${tool.name}-${server.name}-${server.source || "global"}`}
                        tool={tool}
                        serverName={server.name}
                        serverSource={server.source || "global"}
                        alwaysAllowMcp={alwaysAllowMcp}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center opacity-40 italic text-[11px] space-y-2">
                    <span className="codicon codicon-warning text-lg" />
                    <span>{t("mcp:emptyState.noTools")}</span>
                  </div>
                )}
              </VSCodePanelView>

              <VSCodePanelView id="resources-view" className="py-2">
                {(server.resources && server.resources.length > 0) ||
                (server.resourceTemplates &&
                  server.resourceTemplates.length > 0) ? (
                  <div className="flex flex-col gap-2 w-full max-h-[180px] overflow-y-auto scrollbar-thin pr-2">
                    {[
                      ...(server.resourceTemplates || []),
                      ...(server.resources || []),
                    ].map((item) => (
                      <McpResourceRow
                        key={
                          "uriTemplate" in item ? item.uriTemplate : item.uri
                        }
                        item={item}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center opacity-40 italic text-[11px] space-y-2">
                    <span className="codicon codicon-warning text-lg" />
                    <span>{t("mcp:emptyState.noResources")}</span>
                  </div>
                )}
              </VSCodePanelView>

              {server.instructions && (
                <VSCodePanelView id="instructions-view" className="py-2">
                  <div className="bg-vscode-editor-background rounded p-3 font-mono text-[11px] border border-vscode-panel-border/30 whitespace-pre-wrap break-words leading-relaxed opacity-90 tracking-tight">
                    {server.instructions}
                  </div>
                </VSCodePanelView>
              )}

              <VSCodePanelView id="logs-view" className="py-2">
                {server.errorHistory && server.errorHistory.length > 0 ? (
                  <div className="flex flex-col gap-2 w-full max-h-[200px] overflow-y-auto scrollbar-thin rounded border border-vscode-panel-border/20 p-1 bg-vscode-editor-background/50 pr-2">
                    {[...server.errorHistory]
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((error, index) => (
                        <McpErrorRow
                          key={`${error.timestamp}-${index}`}
                          error={error}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center opacity-40 italic text-[11px] space-y-2">
                    <span className="codicon codicon-info text-lg" />
                    <span>{t("mcp:emptyState.noLogs")}</span>
                  </div>
                )}
              </VSCodePanelView>
            </VSCodePanels>

            <div className="mt-2 pt-2 border-t border-vscode-panel-border/20">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-widest text-vscode-descriptionForeground opacity-70">
                    {t("mcp:networkTimeout.label")}
                  </span>
                  <span className="text-[8px] italic opacity-50">
                    {t("mcp:networkTimeout.description")}
                  </span>
                </div>
                <div className="min-w-[100px]">
                  <select
                    value={timeoutValue}
                    onChange={handleTimeoutChange}
                    className="w-full h-7 px-2 bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded text-[10px] outline-none focus:border-vscode-focusBorder cursor-pointer hover:bg-vscode-dropdown-hoverBackground transition-colors"
                  >
                    {timeoutOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!server.disabled && server.status === "disconnected" && server.error && (
        <div className="px-3 pb-3 animate-in fade-in duration-300">
          <div className="flex flex-col gap-2 p-3 bg-vscode-inputValidation-errorBackground/10 border border-vscode-inputValidation-errorBorder/30 rounded-md shadow-inner">
            <div className="flex items-start gap-2 text-vscode-errorForeground text-[11px] leading-relaxed font-mono overflow-hidden">
              <span className="codicon codicon-error mt-0.5 shrink-0" />
              <div className="flex-1 break-words opacity-90">
                {server.error.split("\n").map((item, index) => (
                  <React.Fragment key={index}>
                    {index > 0 && <br />}
                    {item}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRestart}
              className="w-full text-[10px] font-bold uppercase tracking-wide h-8 hover:bg-vscode-inputValidation-errorBackground/20 transition-all active:scale-[0.98]"
            >
              {t("mcp:serverStatus.retryConnection")}
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-[320px] p-6 gap-6 rounded-2xl border-vscode-panel-border bg-vscode-editor-background shadow-2xl animate-in zoom-in-95 duration-200">
          <DialogHeader className="gap-2">
            <div className="w-14 h-14 rounded-full bg-vscode-inputValidation-errorBackground/10 text-vscode-errorForeground flex items-center justify-center mx-auto mb-2 border border-vscode-errorForeground/20">
              <span className="codicon codicon-warning text-3xl animate-pulse" />
            </div>
            <DialogTitle className="text-center font-black uppercase tracking-tight text-xl text-vscode-foreground">
              {t("mcp:deleteDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-center text-[11px] opacity-60 leading-relaxed max-w-[240px] mx-auto">
              {t("mcp:deleteDialog.description", { serverName: server.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            <Button
              variant="primary"
              className="w-full h-11 uppercase font-black tracking-widest bg-vscode-errorForeground hover:bg-vscode-errorForeground/90 border-none rounded-xl text-white shadow-lg shadow-vscode-errorForeground/20 transition-all active:scale-95"
              onClick={handleDelete}
            >
              {t("mcp:deleteDialog.delete")}
            </Button>
            <Button
              variant="ghost"
              className="w-full h-10 uppercase font-black tracking-widest opacity-40 hover:opacity-100 rounded-xl transition-all"
              onClick={() => setShowDeleteConfirm(false)}
            >
              {t("mcp:deleteDialog.cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default McpView;
