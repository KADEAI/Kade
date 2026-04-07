import { HTMLAttributes, useState, useCallback, useMemo } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { vscode } from "@/utils/vscode";
import {
  SquareTerminal,
  Settings,
  Wrench,
  Info,
  Monitor,
  Braces,
  Terminal,
} from "lucide-react";
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { Trans } from "react-i18next";
import { buildDocLink } from "@src/utils/docLinks";
import { useEvent, useMount } from "react-use";

import { ExtensionMessage } from "@roo/ExtensionMessage";

import { cn } from "@/lib/utils";
import { Slider, StandardTooltip } from "@/components/ui";

import { TerminalCommandGeneratorSettings } from "./TerminalCommandGeneratorSettings";
import { SetCachedStateField } from "./types";

import { Section } from "./Section";
import { useRegisterSetting } from "./useSettingsSearch";

type TerminalSettingsProps = HTMLAttributes<HTMLDivElement> & {
  terminalOutputLineLimit?: number;
  terminalOutputCharacterLimit?: number;
  terminalShellIntegrationTimeout?: number;
  terminalShellIntegrationDisabled?: boolean;
  terminalCommandDelay?: number;
  terminalPowershellCounter?: boolean;
  terminalZshClearEolMark?: boolean;
  terminalZshOhMy?: boolean;
  terminalZshP10k?: boolean;
  terminalZdotdir?: boolean;
  terminalCompressProgressBar?: boolean;
  terminalCommandApiConfigId?: string;
  setCachedStateField: SetCachedStateField<
    | "terminalOutputLineLimit"
    | "terminalOutputCharacterLimit"
    | "terminalShellIntegrationTimeout"
    | "terminalShellIntegrationDisabled"
    | "terminalCommandDelay"
    | "terminalPowershellCounter"
    | "terminalZshClearEolMark"
    | "terminalZshOhMy"
    | "terminalZshP10k"
    | "terminalZdotdir"
    | "terminalCompressProgressBar"
    | "terminalCommandApiConfigId"
  >;
};

export const TerminalSettings = ({
  terminalOutputLineLimit,
  terminalOutputCharacterLimit,
  terminalShellIntegrationTimeout,
  terminalShellIntegrationDisabled,
  terminalCommandDelay,
  terminalPowershellCounter,
  terminalZshClearEolMark,
  terminalZshOhMy,
  terminalZshP10k,
  terminalZdotdir,
  terminalCompressProgressBar,
  terminalCommandApiConfigId,
  setCachedStateField,
  className,
  ...props
}: TerminalSettingsProps) => {
  const { t } = useAppTranslation();

  // Register settings for search
  useRegisterSetting({
    settingId: "terminal-output-line-limit",
    section: "terminal",
    label: t("settings:terminal.outputLineLimit.label"),
  });
  useRegisterSetting({
    settingId: "terminal-output-character-limit",
    section: "terminal",
    label: t("settings:terminal.outputCharacterLimit.label"),
  });
  useRegisterSetting({
    settingId: "terminal-compress-progress-bar",
    section: "terminal",
    label: t("settings:terminal.compressProgressBar.label"),
  });
  useRegisterSetting({
    settingId: "terminal-inherit-env",
    section: "terminal",
    label: t("settings:terminal.inheritEnv.label"),
  });
  useRegisterSetting({
    settingId: "terminal-shell-integration-disabled",
    section: "terminal",
    label: t("settings:terminal.shellIntegrationDisabled.label"),
  });
  useRegisterSetting({
    settingId: "terminal-shell-integration-timeout",
    section: "terminal",
    label: t("settings:terminal.shellIntegrationTimeout.label"),
  });
  useRegisterSetting({
    settingId: "terminal-command-delay",
    section: "terminal",
    label: t("settings:terminal.commandDelay.label"),
  });
  useRegisterSetting({
    settingId: "terminal-powershell-counter",
    section: "terminal",
    label: t("settings:terminal.powershellCounter.label"),
  });
  useRegisterSetting({
    settingId: "terminal-zsh-clear-eol",
    section: "terminal",
    label: t("settings:terminal.zshClearEolMark.label"),
  });
  useRegisterSetting({
    settingId: "terminal-zsh-oh-my",
    section: "terminal",
    label: t("settings:terminal.zshOhMy.label"),
  });
  useRegisterSetting({
    settingId: "terminal-zsh-p10k",
    section: "terminal",
    label: t("settings:terminal.zshP10k.label"),
  });
  useRegisterSetting({
    settingId: "terminal-zdotdir",
    section: "terminal",
    label: t("settings:terminal.zdotdir.label"),
  });
  useRegisterSetting({
    settingId: "terminal-command-generation",
    section: "terminal",
    label: t("settings:terminal.commandGeneration.title"),
  });

  const [inheritEnv, setInheritEnv] = useState<boolean>(true);

  useMount(() =>
    vscode.postMessage({
      type: "getVSCodeSetting",
      setting: "terminal.integrated.inheritEnv",
    }),
  );

  const onMessage = useCallback((event: MessageEvent) => {
    const message: ExtensionMessage = event.data;

    switch (message.type) {
      case "vsCodeSetting":
        switch (message.setting) {
          case "terminal.integrated.inheritEnv":
            setInheritEnv(message.value ?? true);
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
  }, []);

  useEvent("message", onMessage);

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <Section className="flex flex-col gap-6">
        {/* Basic Settings Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Settings className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              {t("settings:terminal.basic.label")}
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <div
              className="flex flex-col gap-2"
              data-setting-id="terminal-output-line-limit"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">
                  {t("settings:terminal.outputLineLimit.label")}
                </span>
                <StandardTooltip
                  content={t("settings:terminal.outputLineLimit.description")}
                >
                  <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  min={100}
                  max={5000}
                  step={100}
                  value={[terminalOutputLineLimit ?? 500]}
                  onValueChange={([value]) =>
                    setCachedStateField("terminalOutputLineLimit", value)
                  }
                  className="flex-1"
                />
                <span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
                  {terminalOutputLineLimit ?? 500}
                </span>
              </div>
            </div>

            <div
              className="flex flex-col gap-2"
              data-setting-id="terminal-output-character-limit"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">
                  {t("settings:terminal.outputCharacterLimit.label")}
                </span>
                <StandardTooltip
                  content={t(
                    "settings:terminal.outputCharacterLimit.description",
                  )}
                >
                  <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  min={10000}
                  max={100000}
                  step={1000}
                  value={[terminalOutputCharacterLimit ?? 50000]}
                  onValueChange={([value]) =>
                    setCachedStateField("terminalOutputCharacterLimit", value)
                  }
                  className="flex-1"
                />
                <span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
                  {terminalOutputCharacterLimit ?? 50000}
                </span>
              </div>
            </div>

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-compress-progress-bar"
            >
              <VSCodeCheckbox
                checked={terminalCompressProgressBar ?? true}
                onChange={(e: any) =>
                  setCachedStateField(
                    "terminalCompressProgressBar",
                    e.target.checked,
                  )
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.compressProgressBar.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.compressProgressBar.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>
          </div>
        </div>

        {/* Advanced Settings Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Wrench className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              {t("settings:terminal.advanced.label")}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {!inheritEnv && (
              <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 mb-2">
                <Info className="size-4 shrink-0" />
                <p className="text-xs">
                  <Trans
                    i18nKey="settings:terminal.inheritEnvWarning"
                    components={{
                      Link: (
                        <a
                          href={buildDocLink("features", "inline-terminal")}
                          className="underline cursor-pointer"
                          onClick={(e) => {
                            vscode.postMessage({
                              type: "openExternal",
                              url: buildDocLink("features", "inline-terminal"),
                            });
                            e.preventDefault();
                          }}
                        />
                      ),
                    }}
                  />
                </p>
              </div>
            )}

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-inherit-env"
            >
              <VSCodeCheckbox
                checked={inheritEnv}
                onChange={(e: any) => {
                  setInheritEnv(e.target.checked);
                  vscode.postMessage({
                    type: "updateVSCodeSetting",
                    setting: "terminal.integrated.inheritEnv",
                    value: e.target.checked,
                  });
                }}
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.inheritEnv.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.inheritEnv.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-shell-integration-disabled"
            >
              <VSCodeCheckbox
                checked={terminalShellIntegrationDisabled ?? false}
                onChange={(e: any) =>
                  setCachedStateField(
                    "terminalShellIntegrationDisabled",
                    e.target.checked,
                  )
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.shellIntegrationDisabled.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t(
                  "settings:terminal.shellIntegrationDisabled.description",
                )}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            {!terminalShellIntegrationDisabled && (
              <div className="flex flex-col gap-3 pl-4 border-l-2 border-vscode-focusBorder/50">
                <div
                  className="flex flex-col gap-2"
                  data-setting-id="terminal-shell-integration-timeout"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {t("settings:terminal.shellIntegrationTimeout.label")}
                    </span>
                    <div className="bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border text-[10px] font-mono min-w-[30px] text-center">
                      {(terminalShellIntegrationTimeout ?? 5000) / 1000}s
                    </div>
                  </div>
                  <Slider
                    min={1000}
                    max={60000}
                    step={1000}
                    value={[terminalShellIntegrationTimeout ?? 5000]}
                    onValueChange={([value]) =>
                      setCachedStateField(
                        "terminalShellIntegrationTimeout",
                        value,
                      )
                    }
                  />
                </div>

                <div
                  className="flex flex-col gap-2"
                  data-setting-id="terminal-command-delay"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {t("settings:terminal.commandDelay.label")}
                    </span>
                    <StandardTooltip
                      content={t("settings:terminal.commandDelay.description")}
                    >
                      <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
                    </StandardTooltip>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={0}
                      max={2000}
                      step={50}
                      value={[terminalCommandDelay ?? 0]}
                      onValueChange={([value]) =>
                        setCachedStateField("terminalCommandDelay", value)
                      }
                      className="flex-1"
                    />
                    <span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
                      {terminalCommandDelay ?? 0}ms
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PowerShell Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Monitor className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              PowerShell Integration
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-powershell-counter"
            >
              <VSCodeCheckbox
                checked={terminalPowershellCounter ?? false}
                onChange={(e: any) =>
                  setCachedStateField(
                    "terminalPowershellCounter",
                    e.target.checked,
                  )
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.powershellCounter.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.powershellCounter.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>
          </div>
        </div>

        {/* Zsh Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Braces className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Zsh Integration
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-zsh-clear-eol"
            >
              <VSCodeCheckbox
                checked={terminalZshClearEolMark ?? true}
                onChange={(e: any) =>
                  setCachedStateField(
                    "terminalZshClearEolMark",
                    e.target.checked,
                  )
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.zshClearEolMark.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.zshClearEolMark.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-zsh-oh-my"
            >
              <VSCodeCheckbox
                checked={terminalZshOhMy ?? false}
                onChange={(e: any) =>
                  setCachedStateField("terminalZshOhMy", e.target.checked)
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.zshOhMy.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.zshOhMy.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-zsh-p10k"
            >
              <VSCodeCheckbox
                checked={terminalZshP10k ?? false}
                onChange={(e: any) =>
                  setCachedStateField("terminalZshP10k", e.target.checked)
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.zshP10k.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.zshP10k.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center gap-2"
              data-setting-id="terminal-zdotdir"
            >
              <VSCodeCheckbox
                checked={terminalZdotdir ?? false}
                onChange={(e: any) =>
                  setCachedStateField("terminalZdotdir", e.target.checked)
                }
              >
                <span className="font-medium text-[13px]">
                  {t("settings:terminal.zdotdir.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:terminal.zdotdir.description")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>
          </div>
        </div>

        {/* Command Generator Card */}
        <div
          className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl"
          data-setting-id="terminal-command-generation"
        >
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Terminal className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              {t("settings:terminal.commandGeneration.title")}
            </span>
          </div>

          <TerminalCommandGeneratorSettings
            terminalCommandApiConfigId={terminalCommandApiConfigId}
            setCachedStateField={setCachedStateField}
          />
        </div>
      </Section>
    </div>
  );
};
