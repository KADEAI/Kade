import { useState, useEffect, FormEvent, useMemo } from "react";
import {
  VSCodeTextArea,
  VSCodeCheckbox,
  VSCodeLink,
} from "@vscode/webview-ui-toolkit/react";
import {
  MessageSquare,
  Sparkles,
  Settings,
  Info,
  RotateCcw,
  Cloud,
  Send,
  Braces,
} from "lucide-react";
import { useRegisterSetting } from "./useSettingsSearch";

import { supportPrompt, SupportPromptType } from "@roo/support-prompt";

import { vscode } from "@src/utils/vscode";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { useExtensionState } from "@src/context/ExtensionStateContext";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StandardTooltip,
} from "@src/components/ui";

import { Section } from "./Section";
import CommitMessagePromptSettings from "./CommitMessagePromptSettings"; // kade_change

interface PromptsSettingsProps {
  customSupportPrompts: Record<string, string | undefined>;
  setCustomSupportPrompts: (
    prompts: Record<string, string | undefined>,
  ) => void;
  includeTaskHistoryInEnhance?: boolean;
  setIncludeTaskHistoryInEnhance?: (value: boolean) => void;
}

const PromptsSettings = ({
  customSupportPrompts,
  setCustomSupportPrompts,
  includeTaskHistoryInEnhance: propsIncludeTaskHistoryInEnhance,
  setIncludeTaskHistoryInEnhance: propsSetIncludeTaskHistoryInEnhance,
}: PromptsSettingsProps) => {
  const { t } = useAppTranslation();

  // Register settings for search
  useRegisterSetting({
    settingId: "prompts-template-select",
    section: "prompts",
    label: "Select Prompt Template",
  });
  useRegisterSetting({
    settingId: "prompts-edit-content",
    section: "prompts",
    label: t("prompts:supportPrompts.prompt"),
  });
  useRegisterSetting({
    settingId: "prompts-api-config",
    section: "prompts",
    label: "API Configuration",
  });
  useRegisterSetting({
    settingId: "prompts-include-history",
    section: "prompts",
    label: t("prompts:supportPrompts.enhance.includeTaskHistory"),
  });
  useRegisterSetting({
    settingId: "prompts-test-enhancement",
    section: "prompts",
    label: t("prompts:supportPrompts.enhance.testEnhancement"),
  });

  const {
    listApiConfigMeta,
    enhancementApiConfigId,
    setEnhancementApiConfigId,
    condensingApiConfigId,
    setCondensingApiConfigId,
    customCondensingPrompt,
    setCustomCondensingPrompt,
    includeTaskHistoryInEnhance: contextIncludeTaskHistoryInEnhance,
    setIncludeTaskHistoryInEnhance: contextSetIncludeTaskHistoryInEnhance,
  } = useExtensionState();

  // Use props if provided, otherwise fall back to context
  const includeTaskHistoryInEnhance =
    propsIncludeTaskHistoryInEnhance ??
    contextIncludeTaskHistoryInEnhance ??
    true;
  const setIncludeTaskHistoryInEnhance =
    propsSetIncludeTaskHistoryInEnhance ??
    contextSetIncludeTaskHistoryInEnhance;

  const [testPrompt, setTestPrompt] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [activeSupportOption, setActiveSupportOption] =
    useState<SupportPromptType>("ENHANCE");

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "enhancedPrompt") {
        if (message.text) {
          setTestPrompt(message.text);
        }
        setIsEnhancing(false);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const updateSupportPrompt = (
    type: SupportPromptType,
    value: string | undefined,
  ) => {
    const finalValue = value ?? undefined;

    if (type === "CONDENSE") {
      setCustomCondensingPrompt(finalValue ?? supportPrompt.default.CONDENSE);
      vscode.postMessage({
        type: "updateCondensingPrompt",
        text: finalValue ?? supportPrompt.default.CONDENSE,
      });
      const updatedPrompts = { ...customSupportPrompts };
      if (finalValue === undefined) {
        delete updatedPrompts[type];
      } else {
        updatedPrompts[type] = finalValue;
      }
      setCustomSupportPrompts(updatedPrompts);
    } else {
      const updatedPrompts = { ...customSupportPrompts };
      if (finalValue === undefined) {
        delete updatedPrompts[type];
      } else {
        updatedPrompts[type] = finalValue;
      }
      setCustomSupportPrompts(updatedPrompts);
    }
  };

  const handleSupportReset = (type: SupportPromptType) => {
    if (type === "CONDENSE") {
      setCustomCondensingPrompt(supportPrompt.default.CONDENSE);
      vscode.postMessage({
        type: "updateCondensingPrompt",
        text: supportPrompt.default.CONDENSE,
      });
      const updatedPrompts = { ...customSupportPrompts };
      delete updatedPrompts[type];
      setCustomSupportPrompts(updatedPrompts);
    } else {
      const updatedPrompts = { ...customSupportPrompts };
      delete updatedPrompts[type];
      setCustomSupportPrompts(updatedPrompts);
    }
  };

  const getSupportPromptValue = (type: SupportPromptType): string => {
    if (type === "CONDENSE") {
      return customCondensingPrompt ?? supportPrompt.default.CONDENSE;
    }
    return supportPrompt.get(customSupportPrompts, type);
  };

  const handleTestEnhancement = () => {
    if (!testPrompt.trim()) return;

    setIsEnhancing(true);
    vscode.postMessage({
      type: "enhancePrompt",
      text: testPrompt,
    });
  };

  return (
    <div className="flex flex-col">
      <Section className="flex flex-col gap-6">
        {/* Prompt Selector Card */}
        <div
          className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl"
          data-setting-id="prompts-template-select"
        >
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Settings className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Select Prompt Template
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <Select
              value={activeSupportOption}
              onValueChange={(type) =>
                setActiveSupportOption(type as SupportPromptType)
              }
            >
              <SelectTrigger
                className="w-full text-[13px]"
                data-testid="support-prompt-select-trigger"
              >
                <SelectValue placeholder={t("settings:common.select")} />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(supportPrompt.default).map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    data-testid={`${type}-option`}
                    className="text-[13px]"
                  >
                    {t(`prompts:supportPrompts.types.${type}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed opacity-90 px-1">
              {t(
                `prompts:supportPrompts.types.${activeSupportOption}.description`,
              )}
            </div>
          </div>
        </div>

        {/* Edit Prompt Card */}
        <div
          className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl"
          data-setting-id="prompts-edit-content"
        >
          <div className="flex items-center justify-between border-b border-vscode-input-border/50 pb-2">
            <div className="flex items-center gap-2">
              <Braces className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                {t("prompts:supportPrompts.prompt")}
              </span>
            </div>
            <StandardTooltip
              content={t("prompts:supportPrompts.resetPrompt", {
                promptType: activeSupportOption,
              })}
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-vscode-descriptionForeground hover:text-vscode-foreground"
                onClick={() => handleSupportReset(activeSupportOption)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </StandardTooltip>
          </div>

          <VSCodeTextArea
            resize="vertical"
            value={getSupportPromptValue(activeSupportOption)}
            onInput={(e) => {
              const value =
                (e as unknown as CustomEvent)?.detail?.target?.value ??
                ((e as any).target as HTMLTextAreaElement).value;
              updateSupportPrompt(activeSupportOption, value);
            }}
            rows={5}
            className="w-full font-mono text-[11px]"
          />
        </div>

        {/* Mode-Specific Settings Card */}
        {(activeSupportOption === "ENHANCE" ||
          activeSupportOption === "CONDENSE") && (
          <div
            className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl"
            data-setting-id="prompts-api-config"
          >
            <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
              <Cloud className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                API Configuration
              </span>
            </div>

            <div className="flex flex-col gap-5 pl-3.5 border-l-2 border-vscode-focusBorder/50">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">
                    {activeSupportOption === "ENHANCE"
                      ? t("prompts:supportPrompts.enhance.apiConfiguration")
                      : t("prompts:supportPrompts.condense.apiConfiguration")}
                  </span>
                  <StandardTooltip
                    content={
                      activeSupportOption === "ENHANCE"
                        ? t(
                            "prompts:supportPrompts.enhance.apiConfigDescription",
                          )
                        : t(
                            "prompts:supportPrompts.condense.apiConfigDescription",
                          )
                    }
                  >
                    <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                  </StandardTooltip>
                </div>
                <Select
                  value={
                    activeSupportOption === "ENHANCE"
                      ? enhancementApiConfigId || "-"
                      : condensingApiConfigId || "-"
                  }
                  onValueChange={(value) => {
                    const newConfigId = value === "-" ? "" : value;
                    if (activeSupportOption === "ENHANCE") {
                      setEnhancementApiConfigId(newConfigId);
                      vscode.postMessage({
                        type: "enhancementApiConfigId",
                        text: value,
                      });
                    } else {
                      setCondensingApiConfigId(newConfigId);
                      vscode.postMessage({
                        type: "updateSettings",
                        updatedSettings: { condensingApiConfigId: newConfigId },
                      });
                    }
                  }}
                >
                  <SelectTrigger
                    data-testid="api-config-select"
                    className="w-full text-[13px]"
                  >
                    <SelectValue
                      placeholder={
                        activeSupportOption === "ENHANCE"
                          ? t("prompts:supportPrompts.enhance.useCurrentConfig")
                          : t(
                              "prompts:supportPrompts.condense.useCurrentConfig",
                            )
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="-" className="text-[13px]">
                      {activeSupportOption === "ENHANCE"
                        ? t("prompts:supportPrompts.enhance.useCurrentConfig")
                        : t("prompts:supportPrompts.condense.useCurrentConfig")}
                    </SelectItem>
                    {(listApiConfigMeta || []).map((config) => (
                      <SelectItem
                        key={config.id}
                        value={config.id}
                        data-testid={`${config.id}-option`}
                        className="text-[13px]"
                      >
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {activeSupportOption === "ENHANCE" && (
                <>
                  <div className="h-px bg-vscode-input-border/10" />
                  <div
                    className="flex flex-col gap-1.5"
                    data-setting-id="prompts-include-history"
                  >
                    <div className="flex items-center justify-between">
                      <VSCodeCheckbox
                        checked={includeTaskHistoryInEnhance}
                        onChange={(e: Event | FormEvent<HTMLElement>) => {
                          const target = (
                            "target" in e ? e.target : null
                          ) as HTMLInputElement | null;
                          if (!target) return;
                          setIncludeTaskHistoryInEnhance(target.checked);
                          vscode.postMessage({
                            type: "updateSettings",
                            updatedSettings: {
                              includeTaskHistoryInEnhance: target.checked,
                            },
                          });
                        }}
                      >
                        <span className="font-medium text-[13px]">
                          {t(
                            "prompts:supportPrompts.enhance.includeTaskHistory",
                          )}
                        </span>
                      </VSCodeCheckbox>
                      <StandardTooltip
                        content={t(
                          "prompts:supportPrompts.enhance.includeTaskHistoryDescription",
                        )}
                      >
                        <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                      </StandardTooltip>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Test Enhancement Card */}
        {activeSupportOption === "ENHANCE" && (
          <div
            className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl"
            data-setting-id="prompts-test-enhancement"
          >
            <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
              <Sparkles className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                {t("prompts:supportPrompts.enhance.testEnhancement")}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <VSCodeTextArea
                resize="vertical"
                value={testPrompt}
                onChange={(e) =>
                  setTestPrompt((e.target as HTMLTextAreaElement).value)
                }
                placeholder={t(
                  "prompts:supportPrompts.enhance.testPromptPlaceholder",
                )}
                rows={3}
                className="w-full text-xs"
                data-testid="test-prompt-textarea"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleTestEnhancement}
                  disabled={isEnhancing}
                  className="gap-2"
                >
                  {isEnhancing ? (
                    <div className="size-3 border-2 border-vscode-button-foreground/30 border-t-vscode-button-foreground rounded-full animate-spin" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  {t("prompts:supportPrompts.enhance.previewButton")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Commit Message Settings */}
        {activeSupportOption === "COMMIT_MESSAGE" && (
          <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
            <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
              <Send className="size-3.5 text-vscode-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                Commit Message Settings
              </span>
            </div>
            <div className="pl-3.5 border-l-2 border-vscode-focusBorder/50">
              <CommitMessagePromptSettings />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
};

export default PromptsSettings;
