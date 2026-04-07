// kade_change - file added
import { useAppTranslation } from "@/i18n/TranslationContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { useCallback } from "react";
import { Info } from "lucide-react";
import { StandardTooltip } from "../ui";

interface RateLimitAfterControlProps {
  rateLimitAfterEnabled?: boolean;
  onChange: (field: "rateLimitAfter", value: any) => void;
}

export const RateLimitAfterControl: React.FC<RateLimitAfterControlProps> = ({
  rateLimitAfterEnabled = false,
  onChange,
}) => {
  const { t } = useAppTranslation();

  const handleRateLimitAfterChange = useCallback(
    (e: any) => {
      onChange("rateLimitAfter", e.target.checked);
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <VSCodeCheckbox
          checked={rateLimitAfterEnabled}
          onChange={handleRateLimitAfterChange}
        >
          <span className="font-medium text-sm">
            {t("settings:providers.rateLimitAfter.label")}
          </span>
        </VSCodeCheckbox>
        <StandardTooltip
          content={t("settings:providers.rateLimitAfter.description")}
        >
          <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
        </StandardTooltip>
      </div>
    </div>
  );
};
