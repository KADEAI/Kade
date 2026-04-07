import { HTMLAttributes, useState } from "react";
import {
  X,
  CheckCheck,
  CheckCircle2,
  Settings,
  Shield,
  ListFilter,
  AlertTriangle,
  AlertOctagon,
  Terminal,
  AlertCircle,
  Info,
  Hash,
} from "lucide-react";
import { Trans } from "react-i18next";
import { Package } from "@roo/package";

import { useAppTranslation } from "@/i18n/TranslationContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { vscode } from "@/utils/vscode";
import {
  Button,
  Input,
  Slider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StandardTooltip,
} from "@/components/ui";

import { SetCachedStateField } from "./types";

import { Section } from "./Section";
import { AutoApproveToggle } from "./AutoApproveToggle";
import { MaxLimitInputs } from "./MaxLimitInputs";
import { useRegisterSetting } from "./useSettingsSearch";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { useAutoApprovalState } from "@/hooks/useAutoApprovalState";
import { useAutoApprovalToggles } from "@/hooks/useAutoApprovalToggles";

type AutoApproveSettingsProps = HTMLAttributes<HTMLDivElement> & {
  alwaysAllowReadOnly?: boolean;
  alwaysAllowReadOnlyOutsideWorkspace?: boolean;
  alwaysAllowWrite?: boolean;
  alwaysAllowWriteOutsideWorkspace?: boolean;
  alwaysAllowWriteProtected?: boolean;
  alwaysAllowBrowser?: boolean;
  alwaysApproveResubmit?: boolean;
  requestDelaySeconds: number;
  alwaysAllowMcp?: boolean;
  alwaysAllowModeSwitch?: boolean;
  alwaysAllowSubtasks?: boolean;
  alwaysAllowExecute?: boolean;
  alwaysAllowFollowupQuestions?: boolean;
  alwaysAllowUpdateTodoList?: boolean;

  followupAutoApproveTimeoutMs?: number;
  allowedCommands?: string[];
  allowedMaxRequests?: number | undefined;
  allowedMaxCost?: number | undefined;
  showAutoApproveMenu?: boolean;
  yoloGatekeeperApiConfigId?: string;
  deniedCommands?: string[];
  setCachedStateField: SetCachedStateField<
    | "alwaysAllowReadOnly"
    | "alwaysAllowReadOnlyOutsideWorkspace"
    | "alwaysAllowWrite"
    | "alwaysAllowWriteOutsideWorkspace"
    | "alwaysAllowWriteProtected"
    | "alwaysAllowDelete"
    | "alwaysAllowBrowser"
    | "alwaysApproveResubmit"
    | "requestDelaySeconds"
    | "alwaysAllowMcp"
    | "alwaysAllowModeSwitch"
    | "alwaysAllowSubtasks"
    | "alwaysAllowExecute"
    | "alwaysAllowFollowupQuestions"
    | "followupAutoApproveTimeoutMs"
    | "allowedCommands"
    | "allowedMaxRequests"
    | "allowedMaxCost"
    | "showAutoApproveMenu"
    | "yoloGatekeeperApiConfigId"
    | "deniedCommands"
    | "alwaysAllowUpdateTodoList"
  >;
};

export const AutoApproveSettings = ({
  alwaysAllowReadOnly,
  alwaysAllowReadOnlyOutsideWorkspace,
  alwaysAllowWrite,
  alwaysAllowWriteOutsideWorkspace,
  alwaysAllowWriteProtected,
  alwaysAllowBrowser,
  alwaysApproveResubmit,
  requestDelaySeconds,
  alwaysAllowMcp,
  alwaysAllowModeSwitch,
  alwaysAllowSubtasks,
  alwaysAllowExecute,
  alwaysAllowFollowupQuestions,
  followupAutoApproveTimeoutMs = 60000,
  alwaysAllowUpdateTodoList,

  allowedCommands,
  allowedMaxRequests,
  allowedMaxCost,
  showAutoApproveMenu,
  yoloGatekeeperApiConfigId,
  deniedCommands,
  setCachedStateField,
  ...props
}: AutoApproveSettingsProps) => {
  const { t } = useAppTranslation();
  const [commandInput, setCommandInput] = useState("");
  const [deniedCommandInput, setDeniedCommandInput] = useState("");
  const { autoApprovalEnabled, setAutoApprovalEnabled, listApiConfigMeta } =
    useExtensionState();

  // Register settings for search
  useRegisterSetting({
    settingId: "auto-approve-show-menu",
    section: "autoApprove",
    label: t("settings:autoApprove.showMenu.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-enabled",
    section: "autoApprove",
    label: t("settings:autoApprove.enabled"),
  });
  useRegisterSetting({
    settingId: "auto-approve-read-only",
    section: "autoApprove",
    label: t("settings:autoApprove.readOnly.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-write",
    section: "autoApprove",
    label: t("settings:autoApprove.write.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-browser",
    section: "autoApprove",
    label: t("settings:autoApprove.browser.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-retry",
    section: "autoApprove",
    label: t("settings:autoApprove.retry.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-mcp",
    section: "autoApprove",
    label: t("settings:autoApprove.mcp.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-mode",
    section: "autoApprove",
    label: t("settings:autoApprove.modeSwitch.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-subtasks",
    section: "autoApprove",
    label: t("settings:autoApprove.subtasks.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-execute",
    section: "autoApprove",
    label: t("settings:autoApprove.execute.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-followup",
    section: "autoApprove",
    label: t("settings:autoApprove.followupQuestions.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-todo",
    section: "autoApprove",
    label: t("settings:autoApprove.updateTodoList.label"),
  });
  useRegisterSetting({
    settingId: "auto-approve-max-requests",
    section: "autoApprove",
    label: t("settings:autoApprove.apiRequestLimit.title"),
  });
  useRegisterSetting({
    settingId: "auto-approve-max-cost",
    section: "autoApprove",
    label: t("settings:autoApprove.apiCostLimit.title"),
  });

  const toggles = useAutoApprovalToggles();

  const { effectiveAutoApprovalEnabled } = useAutoApprovalState(
    toggles,
    autoApprovalEnabled,
  );

  const handleAddCommand = () => {
    const currentCommands = allowedCommands ?? [];

    if (commandInput && !currentCommands.includes(commandInput)) {
      const newCommands = [...currentCommands, commandInput];
      setCachedStateField("allowedCommands", newCommands);
      setCommandInput("");
      vscode.postMessage({
        type: "updateSettings",
        updatedSettings: { allowedCommands: newCommands },
      });
    }
  };

  const handleAddDeniedCommand = () => {
    const currentCommands = deniedCommands ?? [];

    if (deniedCommandInput && !currentCommands.includes(deniedCommandInput)) {
      const newCommands = [...currentCommands, deniedCommandInput];
      setCachedStateField("deniedCommands", newCommands);
      setDeniedCommandInput("");
      vscode.postMessage({
        type: "updateSettings",
        updatedSettings: { deniedCommands: newCommands },
      });
    }
  };

  return (
    <div className="flex flex-col" {...props}>
      <Section className="flex flex-col gap-6">
        {/* General Settings Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Settings className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              General Settings
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center gap-2"
              data-setting-id="auto-approve-show-menu"
            >
              <VSCodeCheckbox
                checked={showAutoApproveMenu}
                onChange={(e: any) =>
                  setCachedStateField("showAutoApproveMenu", e.target.checked)
                }
                data-testid="show-auto-approve-menu-checkbox"
              >
                <span className="font-medium text-[13px]">
                  {t("settings:autoApprove.showMenu.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:autoApprove.showMenu.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div className="flex flex-col gap-2">
              <div
                className="flex items-center gap-2"
                data-setting-id="auto-approve-enabled"
              >
                <VSCodeCheckbox
                  checked={effectiveAutoApprovalEnabled}
                  aria-label={t("settings:autoApprove.toggleAriaLabel")}
                  onChange={() => {
                    const newValue = !(autoApprovalEnabled ?? false);
                    setAutoApprovalEnabled(newValue);
                    vscode.postMessage({
                      type: "autoApprovalEnabled",
                      bool: newValue,
                    });
                  }}
                >
                  <span className="font-medium text-[13px]">
                    {t("settings:autoApprove.enabled")}
                  </span>
                </VSCodeCheckbox>
                <StandardTooltip
                  content={t("settings:autoApprove.description")}
                >
                  <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>

              <div className="text-[11px] text-vscode-descriptionForeground pl-7">
                <Trans
                  i18nKey="settings:autoApprove.toggleShortcut"
                  components={{
                    SettingsLink: (
                      <a
                        href="#"
                        className="text-vscode-textLink-foreground hover:underline cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          vscode.postMessage({
                            type: "openKeyboardShortcuts",
                            text: `${Package.name}.toggleAutoApprove`,
                          });
                        }}
                      />
                    ),
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions & Permissions Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <CheckCircle2 className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Actions & Permissions
            </span>
          </div>

          <AutoApproveToggle
            alwaysAllowReadOnly={alwaysAllowReadOnly}
            alwaysAllowWrite={alwaysAllowWrite}
            alwaysAllowBrowser={alwaysAllowBrowser}
            alwaysApproveResubmit={alwaysApproveResubmit}
            alwaysAllowMcp={alwaysAllowMcp}
            alwaysAllowModeSwitch={alwaysAllowModeSwitch}
            alwaysAllowSubtasks={alwaysAllowSubtasks}
            alwaysAllowExecute={alwaysAllowExecute}
            alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
            alwaysAllowUpdateTodoList={alwaysAllowUpdateTodoList}
            onToggle={(key, value) => setCachedStateField(key, value)}
          />
        </div>

        {/* Limits & Thresholds Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Shield className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Limits & Thresholds
            </span>
          </div>

          <MaxLimitInputs
            allowedMaxRequests={allowedMaxRequests}
            allowedMaxCost={allowedMaxCost}
            onMaxRequestsChange={(value) =>
              setCachedStateField("allowedMaxRequests", value)
            }
            onMaxCostChange={(value) =>
              setCachedStateField("allowedMaxCost", value)
            }
          />
        </div>

        {/* Detailed Configuration */}
        {(alwaysAllowReadOnly ||
          alwaysAllowWrite ||
          alwaysApproveResubmit ||
          alwaysAllowFollowupQuestions) && (
          <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
            <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
              <Settings className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                Detailed Configuration
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {alwaysAllowReadOnly && (
                <div className="flex flex-col gap-2 pl-3 border-l-2 border-vscode-focusBorder/50">
                  <div className="flex items-center gap-2 font-medium text-[13px]">
                    <span className="codicon codicon-eye" />
                    <div>{t("settings:autoApprove.readOnly.label")}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <VSCodeCheckbox
                      checked={alwaysAllowReadOnlyOutsideWorkspace}
                      onChange={(e: any) =>
                        setCachedStateField(
                          "alwaysAllowReadOnlyOutsideWorkspace",
                          e.target.checked,
                        )
                      }
                      data-testid="always-allow-readonly-outside-workspace-checkbox"
                    >
                      <span className="font-medium text-[13px]">
                        {t(
                          "settings:autoApprove.readOnly.outsideWorkspace.label",
                        )}
                      </span>
                    </VSCodeCheckbox>
                    <StandardTooltip
                      content={t(
                        "settings:autoApprove.readOnly.outsideWorkspace.description",
                      )}
                    >
                      <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                    </StandardTooltip>
                  </div>
                </div>
              )}

              {alwaysAllowWrite && (
                <div className="flex flex-col gap-2 pl-3 border-l-2 border-vscode-focusBorder/50">
                  <div className="flex items-center gap-2 font-medium text-[13px]">
                    <span className="codicon codicon-edit" />
                    <div>{t("settings:autoApprove.write.label")}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2 items-center">
                      <VSCodeCheckbox
                        checked={alwaysAllowWriteOutsideWorkspace}
                        onChange={(e: any) =>
                          setCachedStateField(
                            "alwaysAllowWriteOutsideWorkspace",
                            e.target.checked,
                          )
                        }
                        data-testid="always-allow-write-outside-workspace-checkbox"
                      >
                        <span className="font-medium text-[13px]">
                          {t(
                            "settings:autoApprove.write.outsideWorkspace.label",
                          )}
                        </span>
                      </VSCodeCheckbox>
                      <StandardTooltip
                        content={t(
                          "settings:autoApprove.write.outsideWorkspace.description",
                        )}
                      >
                        <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                      </StandardTooltip>
                    </div>
                    <div className="flex gap-2 items-center">
                      <VSCodeCheckbox
                        checked={alwaysAllowWriteProtected}
                        onChange={(e: any) =>
                          setCachedStateField(
                            "alwaysAllowWriteProtected",
                            e.target.checked,
                          )
                        }
                        data-testid="always-allow-write-protected-checkbox"
                      >
                        <span className="font-medium text-[13px]">
                          {t("settings:autoApprove.write.protected.label")}
                        </span>
                      </VSCodeCheckbox>
                      <StandardTooltip
                        content={t(
                          "settings:autoApprove.write.protected.description",
                        )}
                      >
                        <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                      </StandardTooltip>
                    </div>
                  </div>
                </div>
              )}

              {alwaysApproveResubmit && (
                <div className="flex flex-col gap-2 pl-3 border-l-2 border-vscode-focusBorder/50">
                  <div className="flex items-center gap-2 font-medium text-[13px]">
                    <span className="codicon codicon-refresh" />
                    <div>{t("settings:autoApprove.retry.label")}</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <Slider
                        min={5}
                        max={100}
                        step={1}
                        value={[requestDelaySeconds]}
                        onValueChange={([value]) =>
                          setCachedStateField("requestDelaySeconds", value)
                        }
                        data-testid="request-delay-slider"
                        className="flex-1"
                      />
                      <span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
                        {requestDelaySeconds}s
                      </span>
                    </div>
                    <div className="text-vscode-descriptionForeground text-[11px] leading-relaxed opacity-90">
                      {t("settings:autoApprove.retry.delayLabel")}
                    </div>
                  </div>
                </div>
              )}

              {alwaysAllowFollowupQuestions && (
                <div className="flex flex-col gap-2 pl-3 border-l-2 border-vscode-focusBorder/50">
                  <div className="flex items-center gap-2 font-medium text-[13px]">
                    <span className="codicon codicon-question" />
                    <div>
                      {t("settings:autoApprove.followupQuestions.label")}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <Slider
                        min={1000}
                        max={300000}
                        step={1000}
                        value={[followupAutoApproveTimeoutMs]}
                        onValueChange={([value]) =>
                          setCachedStateField(
                            "followupAutoApproveTimeoutMs",
                            value,
                          )
                        }
                        data-testid="followup-timeout-slider"
                        className="flex-1"
                      />
                      <span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
                        {followupAutoApproveTimeoutMs / 1000}s
                      </span>
                    </div>
                    <div className="text-vscode-descriptionForeground text-[11px] leading-relaxed opacity-90">
                      {t("settings:autoApprove.followupQuestions.timeoutLabel")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Command Filtering Card */}
        {alwaysAllowExecute && (
          <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
            <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
              <Terminal className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                Command Filtering
              </span>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    className="text-[13px] font-medium"
                    data-testid="allowed-commands-heading"
                  >
                    {t("settings:autoApprove.execute.allowedCommands")}
                  </label>
                  <StandardTooltip
                    content={t(
                      "settings:autoApprove.execute.allowedCommandsDescription",
                    )}
                  >
                    <AlertCircle className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                  </StandardTooltip>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={commandInput}
                    onChange={(e: any) => setCommandInput(e.target.value)}
                    onKeyDown={(e: any) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCommand();
                      }
                    }}
                    placeholder={t(
                      "settings:autoApprove.execute.commandPlaceholder",
                    )}
                    className="grow h-8 text-xs"
                    data-testid="command-input"
                  />
                  <Button
                    className="h-8 px-3 text-xs"
                    onClick={handleAddCommand}
                    data-testid="add-command-button"
                  >
                    {t("settings:autoApprove.execute.addButton")}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(allowedCommands ?? []).map((cmd, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      className="h-6 text-[11px] px-2 gap-1.5"
                      data-testid={`remove-command-${index}`}
                      onClick={() => {
                        const newCommands = (allowedCommands ?? []).filter(
                          (_, i) => i !== index,
                        );
                        setCachedStateField("allowedCommands", newCommands);

                        vscode.postMessage({
                          type: "updateSettings",
                          updatedSettings: { allowedCommands: newCommands },
                        });
                      }}
                    >
                      <span>{cmd}</span>
                      <X className="size-3 opacity-60" />
                    </Button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-vscode-input-border/10" />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    className="text-[13px] font-medium"
                    data-testid="denied-commands-heading"
                  >
                    {t("settings:autoApprove.execute.deniedCommands")}
                  </label>
                  <StandardTooltip
                    content={t(
                      "settings:autoApprove.execute.deniedCommandsDescription",
                    )}
                  >
                    <AlertCircle className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                  </StandardTooltip>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={deniedCommandInput}
                    onChange={(e: any) => setDeniedCommandInput(e.target.value)}
                    onKeyDown={(e: any) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddDeniedCommand();
                      }
                    }}
                    placeholder={t(
                      "settings:autoApprove.execute.deniedCommandPlaceholder",
                    )}
                    className="grow h-8 text-xs"
                    data-testid="denied-command-input"
                  />
                  <Button
                    className="h-8 px-3 text-xs"
                    onClick={handleAddDeniedCommand}
                    data-testid="add-denied-command-button"
                  >
                    {t("settings:autoApprove.execute.addButton")}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(deniedCommands ?? []).map((cmd, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      className="h-6 text-[11px] px-2 gap-1.5"
                      data-testid={`remove-denied-command-${index}`}
                      onClick={() => {
                        const newCommands = (deniedCommands ?? []).filter(
                          (_, i) => i !== index,
                        );
                        setCachedStateField("deniedCommands", newCommands);

                        vscode.postMessage({
                          type: "updateSettings",
                          updatedSettings: { deniedCommands: newCommands },
                        });
                      }}
                    >
                      <span>{cmd}</span>
                      <X className="size-3 opacity-60" />
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
};
