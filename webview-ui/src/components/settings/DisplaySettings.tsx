import { HTMLAttributes, useMemo } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { Info, Layout, Layers, DollarSign } from "lucide-react";
import { telemetryClient } from "@/utils/TelemetryClient";
import { HistoryViewType } from "@/App"; // kade_change
import { useToolTheme } from "@/context/ToolThemeContext";

import { SetCachedStateField } from "./types";

import { Section } from "./Section";
import { TaskTimeline } from "../chat/TaskTimeline";
import { generateSampleTimelineData } from "../../utils/timeline/mockData";
import {
  Slider,
  StandardTooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui";
import { useRegisterSetting } from "./useSettingsSearch";

type DisplaySettingsProps = HTMLAttributes<HTMLDivElement> & {
  showTaskTimeline?: boolean;
  sendMessageOnEnter?: boolean; // kade_change
  showTimestamps?: boolean;
  collapseCodeToolsByDefault?: boolean;
  showVibeStyling?: boolean;
  reasoningBlockCollapsed: boolean;
  showSubAgentBanner?: boolean;
  showPromptSuggestions?: boolean;
  setCachedStateField: SetCachedStateField<
    | "showTaskTimeline"
    | "sendMessageOnEnter"
    | "ghostServiceSettings"
    | "reasoningBlockCollapsed"
    | "hideCostBelowThreshold"
    | "showTimestamps"
    | "collapseCodeToolsByDefault"
    | "showVibeStyling"
    | "showSubAgentBanner"
    | "showPromptSuggestions"
  >;
  hideCostBelowThreshold?: number;
  historyViewType?: HistoryViewType; // kade_change
  setHistoryViewType?: (value: HistoryViewType) => void; // kade_change
};

export const DisplaySettings = ({
  showTaskTimeline,
  showTimestamps,
  collapseCodeToolsByDefault,
  showVibeStyling,
  sendMessageOnEnter,
  setCachedStateField,
  reasoningBlockCollapsed,
  showSubAgentBanner,
  showPromptSuggestions,
  hideCostBelowThreshold,
  historyViewType, // kade_change
  setHistoryViewType, // kade_change
  ...props
}: DisplaySettingsProps) => {
  const { t } = useAppTranslation();
  const { theme, setTheme, availableThemes } = useToolTheme();

  // Register settings for search
  useRegisterSetting({
    settingId: "display-collapse-thinking",
    section: "display",
    label: t("settings:ui.collapseThinking.label"),
  });
  useRegisterSetting({
    settingId: "display-send-on-enter",
    section: "display",
    label: t("settings:display.sendMessageOnEnter.label"),
  });
  useRegisterSetting({
    settingId: "display-show-timestamps",
    section: "display",
    label: t("settings:display.showTimestamps.label"),
  });
  useRegisterSetting({
    settingId: "display-collapse-code-tools",
    section: "display",
    label: "Collapse edit/write/bash tools by default",
  });
  useRegisterSetting({
    settingId: "display-history-mode",
    section: "display",
    label: "History View Mode",
  });
  useRegisterSetting({
    settingId: "display-task-timeline",
    section: "display",
    label: t("settings:display.taskTimeline.label"),
  });
  useRegisterSetting({
    settingId: "display-cost-threshold",
    section: "display",
    label: t("settings:display.costThreshold.label"),
  });
  useRegisterSetting({
    settingId: "display-tool-theme",
    section: "display",
    label: "Tool Theming",
  });
  useRegisterSetting({
    settingId: "display-sub-agent-banner",
    section: "display",
    label: "Show Welcome Banner",
  });
  useRegisterSetting({
    settingId: "display-prompt-suggestions",
    section: "display",
    label: "Show Prompt Suggestions",
  });
  useRegisterSetting({
    settingId: "display-vibe-styling",
    section: "display",
    label: "Enable inline vibe styling",
  });

  const sampleTimelineData = useMemo(() => generateSampleTimelineData(), []);

  const getCheckboxValue = (event: any) =>
    event?.currentTarget?.checked ?? event?.target?.checked ?? false;

  const handleReasoningBlockCollapsedChange = (value: boolean) => {
    setCachedStateField("reasoningBlockCollapsed", value);

    // Track telemetry event
    telemetryClient.capture("ui_settings_collapse_thinking_changed", {
      enabled: value,
    });
  };

  return (
    <div {...props}>
      <Section className="flex flex-col gap-6">
        {/* Appearance & Behavior Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Layout className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              General
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center justify-between"
              data-setting-id="display-collapse-thinking"
            >
              <VSCodeCheckbox
                checked={reasoningBlockCollapsed}
                onChange={(e: any) =>
                  handleReasoningBlockCollapsedChange(e.target.checked)
                }
                data-testid="collapse-thinking-checkbox"
              >
                <span className="font-medium text-sm">
                  {t("settings:ui.collapseThinking.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:ui.collapseThinking.description")}
              >
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-send-on-enter"
            >
              <VSCodeCheckbox
                checked={sendMessageOnEnter}
                onChange={(e: any) => {
                  setCachedStateField(
                    "sendMessageOnEnter",
                    e.target?.checked || false,
                  );
                }}
              >
                <span className="font-medium text-sm">
                  {t("settings:display.sendMessageOnEnter.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:display.sendMessageOnEnter.description")}
              >
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-show-timestamps"
            >
              <VSCodeCheckbox
                checked={showTimestamps}
                onChange={(e: any) => {
                  setCachedStateField("showTimestamps", e.target.checked);
                }}
              >
                <span className="font-medium text-sm">
                  {t("settings:display.showTimestamps.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("settings:display.showTimestamps.description")}
              >
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-collapse-code-tools"
            >
              <VSCodeCheckbox
                checked={collapseCodeToolsByDefault}
                onChange={(e: any) => {
                  setCachedStateField(
                    "collapseCodeToolsByDefault",
                    e.target.checked,
                  );
                }}
              >
                <span className="font-medium text-sm">
                  Collapse edit/write/bash tools by default
                </span>
              </VSCodeCheckbox>
              <StandardTooltip content="New write, edit, and bash tool cards start collapsed unless they are active or showing an error.">
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-sub-agent-banner"
            >
              <VSCodeCheckbox
                checked={showSubAgentBanner}
                onChange={(e: any) => {
                  setCachedStateField("showSubAgentBanner", e.target.checked);
                }}
              >
                <span className="font-medium text-sm">Show Welcome Banner</span>
              </VSCodeCheckbox>
              <StandardTooltip content="Show the Sub-Agent feature announcement banner on the home screen.">
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-prompt-suggestions"
            >
              <VSCodeCheckbox
                checked={showPromptSuggestions}
                onChange={(e: any) => {
                  setCachedStateField("showPromptSuggestions", e.target.checked);
                }}
              >
                <span className="font-medium text-sm">
                  Show Prompt Suggestions
                </span>
              </VSCodeCheckbox>
              <StandardTooltip content="Show rotating prompt suggestions on the home screen under the logo.">
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div
              className="flex items-center justify-between"
              data-setting-id="display-vibe-styling"
            >
              <VSCodeCheckbox
                checked={showVibeStyling}
                onChange={(e: any) => {
                  const nextValue = getCheckboxValue(e) === true;
                  setCachedStateField("showVibeStyling", nextValue);
                }}
              >
                <span className="font-medium text-sm">
                  Enable Colored Vibe text
                </span>
              </VSCodeCheckbox>
              <StandardTooltip content="Render supported ~tag content~ markdown as styled inline vibe text.">
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>
          </div>
        </div>

        {/* Navigation & History Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Layers className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Navigation & History
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <div
              className="flex flex-col gap-2"
              data-setting-id="display-history-mode"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">History View Mode</span>
                <StandardTooltip content="Choose how to display your chat history.">
                  <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>
              <Select
                value={historyViewType || "dropdown"}
                onValueChange={(value) =>
                  setHistoryViewType?.(value as HistoryViewType)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select history view mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dropdown">Dropdown Overlay</SelectItem>
                  <SelectItem value="dropdown-top">
                    Dropdown Overlay (Top View)
                  </SelectItem>
                  <SelectItem value="view">Full Page View</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-3 border-t border-vscode-input-border/10 pt-3">
              <div
                className="flex items-center justify-between"
                data-setting-id="display-task-timeline"
              >
                <VSCodeCheckbox
                  checked={showTaskTimeline}
                  onChange={(e: any) => {
                    setCachedStateField(
                      "showTaskTimeline",
                      e.target?.checked || false,
                    );
                  }}
                >
                  <span className="font-medium text-sm">
                    {t("settings:display.taskTimeline.label")}
                  </span>
                </VSCodeCheckbox>
                <StandardTooltip
                  content={t("settings:display.taskTimeline.description")}
                >
                  <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>

              <div className="bg-vscode-textBlockQuote-background/20 p-3 rounded-md border border-vscode-textBlockQuote-border/10 ml-6">
                <div className="text-[9px] uppercase font-bold text-vscode-descriptionForeground tracking-widest mb-2 opacity-70">
                  Timeline Preview
                </div>
                <div className="opacity-60 scale-90 origin-left">
                  <TaskTimeline
                    groupedMessages={sampleTimelineData}
                    isTaskActive={false}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Financial & Cost Settings Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <DollarSign className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Cost & Usage
            </span>
          </div>

          <div
            className="flex flex-col gap-3"
            data-setting-id="display-cost-threshold"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {t("settings:display.costThreshold.label")}
              </div>
              <StandardTooltip
                content={t("settings:display.costThreshold.description")}
              >
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            <div className="space-y-3 px-1">
              <div className="flex items-center gap-3">
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[hideCostBelowThreshold ?? 0]}
                  onValueChange={([value]) =>
                    setCachedStateField("hideCostBelowThreshold", value)
                  }
                  data-testid="cost-threshold-slider"
                  className="flex-1"
                />
                <div className="bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border text-[10px] font-mono min-w-[50px] text-center">
                  ${(hideCostBelowThreshold ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="text-[10px] text-vscode-descriptionForeground italic text-center opacity-70">
                {t("settings:display.costThreshold.currentValue", {
                  value: (hideCostBelowThreshold ?? 0).toFixed(2),
                })}
              </div>
            </div>
          </div>
        </div>
        {/* Tool Theming Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-3 border-b border-vscode-input-border/50 pb-2">
            <Layout className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Tool Theming
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-500/90 bg-yellow-500/10 px-1.5 py-0.5 rounded-sm border border-yellow-500/20">
              COMING SOON
            </span>
          </div>

          <div
            className="flex flex-col gap-4"
            data-setting-id="display-tool-theme"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Theme</span>
                <StandardTooltip content="Select a theme for tool headers.">
                  <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>
              <Select
                value={theme.name}
                onValueChange={(value) => setTheme(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  {availableThemes
                    .filter((t) => t.toLowerCase() !== "glass")
                    .map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};
