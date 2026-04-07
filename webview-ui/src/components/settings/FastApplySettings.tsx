import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { SetCachedStateField } from "./types";
import { useRegisterSetting } from "./useSettingsSearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui";

export const FastApplySettings = ({
  morphApiKey,
  fastApplyModel,
  fastApplyApiProvider,
  setCachedStateField,
}: {
  morphApiKey?: string;
  fastApplyModel?: string;
  fastApplyApiProvider?: string;
  setCachedStateField: SetCachedStateField<
    "morphApiKey" | "fastApplyModel" | "fastApplyApiProvider"
  >;
}) => {
  const { t } = useAppTranslation();

  // Register settings for search
  useRegisterSetting({
    settingId: "fast-apply-provider",
    section: "experimental",
    label: t("settings:experimental.MORPH_FAST_APPLY.apiProvider"),
  });
  useRegisterSetting({
    settingId: "fast-apply-model",
    section: "experimental",
    label: t("settings:experimental.MORPH_FAST_APPLY.modelLabel"),
  });
  useRegisterSetting({
    settingId: "fast-apply-key",
    section: "experimental",
    label: t("settings:experimental.MORPH_FAST_APPLY.apiKey"),
  });
  return (
    <div className="flex flex-col gap-5">
      <div data-setting-id="fast-apply-provider">
        <label className="block text-[13px] font-medium mb-2">
          {t("settings:experimental.MORPH_FAST_APPLY.apiProvider")}
        </label>
        <Select
          value={fastApplyApiProvider || "current"}
          onValueChange={(value) =>
            setCachedStateField("fastApplyApiProvider", value)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select API provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="kilocode">Kade</SelectItem>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
            <SelectItem value="morph">Morph</SelectItem>
            <SelectItem value="current">
              {t(
                "settings:experimental.MORPH_FAST_APPLY.apiProviderList.current",
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div data-setting-id="fast-apply-model">
        <label className="block text-[13px] font-medium mb-2">
          {t("settings:experimental.MORPH_FAST_APPLY.modelLabel")}
        </label>
        <Select
          value={fastApplyModel || "auto"}
          onValueChange={(value) =>
            setCachedStateField("fastApplyModel", value)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {t("settings:experimental.MORPH_FAST_APPLY.models.auto")}
            </SelectItem>
            <SelectItem value="morph/morph-v3-fast">
              {t("settings:experimental.MORPH_FAST_APPLY.models.morphFast")}
            </SelectItem>
            <SelectItem value="morph/morph-v3-large">
              {t("settings:experimental.MORPH_FAST_APPLY.models.morphLarge")}
            </SelectItem>
            <SelectItem value="relace/relace-apply-3">
              {t("settings:experimental.MORPH_FAST_APPLY.models.relace")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
          {t("settings:experimental.MORPH_FAST_APPLY.modelDescription")}
        </p>
      </div>

      {fastApplyApiProvider !== "current" && (
        <div data-setting-id="fast-apply-key">
          <label className="block text-[13px] font-medium mb-2">
            {t("settings:experimental.MORPH_FAST_APPLY.apiKey")}
          </label>
          <VSCodeTextField
            type="password"
            value={morphApiKey || ""}
            placeholder={t(
              "settings:experimental.MORPH_FAST_APPLY.placeholder",
            )}
            onInput={(e) =>
              setCachedStateField("morphApiKey", (e.target as any)?.value || "")
            }
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};
