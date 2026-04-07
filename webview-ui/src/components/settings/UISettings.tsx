import { HTMLAttributes, useMemo } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { Glasses } from "lucide-react";
import { telemetryClient } from "@/utils/TelemetryClient";

import { SetCachedStateField } from "./types";

import { Section } from "./Section";
import { ExtensionStateContextType } from "@/context/ExtensionStateContext";
import { useRegisterSetting } from "./useSettingsSearch";

interface UISettingsProps extends HTMLAttributes<HTMLDivElement> {
  reasoningBlockCollapsed: boolean;
  enterBehavior: "send" | "newline";
  setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>;
}

export const UISettings = ({
  reasoningBlockCollapsed,
  enterBehavior,
  setCachedStateField,
  ...props
}: UISettingsProps) => {
  const { t } = useAppTranslation();

  const primaryMod = useMemo(() => {
    const platform = window.navigator.platform.toLowerCase();
    return platform.includes("mac") ? "Cmd" : "Ctrl";
  }, []);

  // Register settings for search
  useRegisterSetting({
    settingId: "ui-collapse-thinking",
    section: "ui",
    label: t("settings:ui.collapseThinking.label"),
  });
  useRegisterSetting({
    settingId: "ui-require-ctrl-enter",
    section: "ui",
    label: t("settings:ui.requireCtrlEnterToSend.label", { primaryMod }),
  });

  const handleReasoningBlockCollapsedChange = (value: boolean) => {
    setCachedStateField("reasoningBlockCollapsed", value);

    // Track telemetry event
    telemetryClient.capture("ui_settings_collapse_thinking_changed", {
      enabled: value,
    });
  };

  const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
    const newBehavior = requireCtrlEnter ? "newline" : "send";
    setCachedStateField("enterBehavior", newBehavior);

    // Track telemetry event
    telemetryClient.capture("ui_settings_enter_behavior_changed", {
      behavior: newBehavior,
    });
  };

  return (
    <div {...props}>
      <Section className="flex flex-col gap-6">
        {/* User Interface Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Glasses className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              User Interface
            </span>
          </div>

          <div className="flex flex-col gap-5">
            {/* Collapse Thinking Messages Setting */}
            <div
              className="flex flex-col gap-1.5"
              data-setting-id="ui-collapse-thinking"
            >
              <VSCodeCheckbox
                checked={reasoningBlockCollapsed}
                onChange={(e: any) =>
                  handleReasoningBlockCollapsedChange(e.target.checked)
                }
                data-testid="collapse-thinking-checkbox"
              >
                <span className="font-medium text-[13px]">
                  {t("settings:ui.collapseThinking.label")}
                </span>
              </VSCodeCheckbox>
              <div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
                {t("settings:ui.collapseThinking.description")}
              </div>
            </div>

            {/* Enter Key Behavior Setting */}
            <div
              className="flex flex-col gap-1.5"
              data-setting-id="ui-require-ctrl-enter"
            >
              <VSCodeCheckbox
                checked={enterBehavior === "newline"}
                onChange={(e: any) =>
                  handleEnterBehaviorChange(e.target.checked)
                }
                data-testid="enter-behavior-checkbox"
              >
                <span className="font-medium text-[13px]">
                  {t("settings:ui.requireCtrlEnterToSend.label", {
                    primaryMod,
                  })}
                </span>
              </VSCodeCheckbox>
              <div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
                {t("settings:ui.requireCtrlEnterToSend.description", {
                  primaryMod,
                })}
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};
