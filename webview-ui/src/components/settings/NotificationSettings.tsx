import { HTMLAttributes } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { Bell, Info, Volume2, Mic, BellRing } from "lucide-react";

import { SetCachedStateField } from "./types";

import { Section } from "./Section";
import { Slider, StandardTooltip } from "../ui";
import { vscode } from "../../utils/vscode";
import { useRegisterSetting } from "./useSettingsSearch";

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
  ttsEnabled?: boolean;
  ttsSpeed?: number;
  soundEnabled?: boolean;
  soundVolume?: number;
  systemNotificationsEnabled?: boolean;
  areSettingsCommitted?: boolean;
  setCachedStateField: SetCachedStateField<
    | "ttsEnabled"
    | "ttsSpeed"
    | "soundEnabled"
    | "soundVolume"
    | "systemNotificationsEnabled"
  >;
};

export const NotificationSettings = ({
  ttsEnabled,
  ttsSpeed,
  soundEnabled,
  soundVolume,
  systemNotificationsEnabled,
  areSettingsCommitted,
  setCachedStateField,
  ...props
}: NotificationSettingsProps) => {
  const { t } = useAppTranslation();

  // Register settings for search
  useRegisterSetting({
    settingId: "notifications-desktop",
    section: "notifications",
    label: t("kilocode:settings.systemNotifications.label"),
  });
  useRegisterSetting({
    settingId: "notifications-sound",
    section: "notifications",
    label: t("settings:notifications.sound.label"),
  });
  useRegisterSetting({
    settingId: "notifications-tts",
    section: "notifications",
    label: t("settings:notifications.tts.label"),
  });

  const onTestNotificationClick = () => {
    vscode.postMessage({
      type: "showSystemNotification",
      notificationOptions: {
        title: t("kilocode:settings.systemNotifications.testTitle"),
        message: t("kilocode:settings.systemNotifications.testMessage"),
      },
      alwaysAllow: true,
    });
  };

  return (
    <div {...props}>
      <Section className="flex flex-col gap-6">
        {/* System Notifications Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <BellRing className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Desktop Notifications
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="flex items-center justify-between"
              data-setting-id="notifications-desktop"
            >
              <VSCodeCheckbox
                checked={systemNotificationsEnabled}
                onChange={(e: any) =>
                  setCachedStateField(
                    "systemNotificationsEnabled",
                    e.target.checked,
                  )
                }
                data-testid="system-notifications-enabled-checkbox"
              >
                <span className="font-medium text-sm">
                  {t("kilocode:settings.systemNotifications.label")}
                </span>
              </VSCodeCheckbox>
              <StandardTooltip
                content={t("kilocode:settings.systemNotifications.description")}
              >
                <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>

            {systemNotificationsEnabled && (
              <div className="flex items-center justify-between ml-6 bg-vscode-textBlockQuote-background/20 px-3 py-1.5 rounded border border-vscode-textBlockQuote-border/10">
                <span className="text-[10px] text-vscode-descriptionForeground font-medium italic">
                  Quick Test
                </span>
                <VSCodeButton
                  appearance="secondary"
                  onClick={onTestNotificationClick}
                  className="scale-90 origin-right"
                >
                  {t("kilocode:settings.systemNotifications.testButton")}
                </VSCodeButton>
              </div>
            )}
          </div>
        </div>

        {/* Audio Controls Card */}
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Volume2 className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Audio & Speech
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Sound Effects */}
            <div className="flex flex-col gap-2">
              <div
                className="flex items-center justify-between"
                data-setting-id="notifications-sound"
              >
                <VSCodeCheckbox
                  checked={soundEnabled}
                  onChange={(e: any) =>
                    setCachedStateField("soundEnabled", e.target.checked)
                  }
                  data-testid="sound-enabled-checkbox"
                >
                  <span className="font-medium text-sm">
                    {t("settings:notifications.sound.label")}
                  </span>
                </VSCodeCheckbox>
                <StandardTooltip
                  content={t("settings:notifications.sound.description")}
                >
                  <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>

              {soundEnabled && (
                <div className="flex flex-col gap-2 ml-6 bg-vscode-textBlockQuote-background/20 p-2.5 rounded border border-vscode-textBlockQuote-border/10">
                  <div className="flex items-center gap-4">
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[soundVolume ?? 0.5]}
                      onValueChange={([value]) =>
                        setCachedStateField("soundVolume", value)
                      }
                      data-testid="sound-volume-slider"
                      className="flex-1"
                    />
                    <div className="bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border text-[10px] font-mono min-w-[40px] text-center">
                      {((soundVolume ?? 0.5) * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* TTS */}
            <div className="flex flex-col gap-2 border-t border-vscode-input-border/10 pt-3">
              <div
                className="flex items-center justify-between"
                data-setting-id="notifications-tts"
              >
                <VSCodeCheckbox
                  checked={ttsEnabled}
                  onChange={(e: any) =>
                    setCachedStateField("ttsEnabled", e.target.checked)
                  }
                  data-testid="tts-enabled-checkbox"
                >
                  <span className="font-medium text-sm">
                    {t("settings:notifications.tts.label")}
                  </span>
                </VSCodeCheckbox>
                <StandardTooltip
                  content={t("settings:notifications.tts.description")}
                >
                  <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
                </StandardTooltip>
              </div>

              {ttsEnabled && (
                <div className="flex flex-col gap-2 ml-6 bg-vscode-textBlockQuote-background/20 p-2.5 rounded border border-vscode-textBlockQuote-border/10">
                  <div className="flex items-center gap-4">
                    <Slider
                      min={0.1}
                      max={2.0}
                      step={0.01}
                      value={[ttsSpeed ?? 1.0]}
                      onValueChange={([value]) =>
                        setCachedStateField("ttsSpeed", value)
                      }
                      data-testid="tts-speed-slider"
                      className="flex-1"
                    />
                    <div className="bg-vscode-input-background px-1.5 py-0.5 rounded border border-vscode-input-border text-[10px] font-mono min-w-[40px] text-center">
                      {((ttsSpeed ?? 1.0) * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};
