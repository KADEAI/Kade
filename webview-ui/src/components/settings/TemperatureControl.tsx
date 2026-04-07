import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { useEffect, useState } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { useDebounce } from "react-use";
import { Info } from "lucide-react";

import { Slider, StandardTooltip } from "@/components/ui";

interface TemperatureControlProps {
  value: number | undefined | null;
  onChange: (value: number | undefined | null) => void;
  maxValue?: number; // Some providers like OpenAI use 0-2 range.
  defaultValue?: number; // Default temperature from model configuration
}

export const TemperatureControl = ({
  value,
  onChange,
  maxValue = 1,
  defaultValue,
}: TemperatureControlProps) => {
  const { t } = useAppTranslation();
  const [isCustomTemperature, setIsCustomTemperature] = useState(
    value !== undefined,
  );
  const [inputValue, setInputValue] = useState(value);

  useDebounce(() => onChange(inputValue), 50, [onChange, inputValue]);

  // Sync internal state with prop changes when switching profiles.
  useEffect(() => {
    const hasCustomTemperature = value !== undefined && value !== null;
    setIsCustomTemperature(hasCustomTemperature);
    setInputValue(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <VSCodeCheckbox
          checked={isCustomTemperature}
          onChange={(e: any) => {
            const isChecked = e.target.checked;
            setIsCustomTemperature(isChecked);

            if (!isChecked) {
              setInputValue(null); // Unset the temperature, note that undefined is unserializable.
            } else {
              // Use the value from apiConfiguration, or fallback to model's defaultTemperature, or finally to 0
              setInputValue(value ?? defaultValue ?? 0);
            }
          }}
        >
          <span className="font-medium text-sm">
            {t("settings:temperature.useCustom")}
          </span>
        </VSCodeCheckbox>
        <StandardTooltip content={t("settings:temperature.description")}>
          <Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
        </StandardTooltip>
      </div>

      {isCustomTemperature && (
        <div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium">Temperature Value</div>
              <StandardTooltip
                content={t("settings:temperature.rangeDescription")}
              >
                <Info className="size-3 text-vscode-descriptionForeground cursor-help" />
              </StandardTooltip>
            </div>
            <div className="flex items-center gap-2">
              <Slider
                min={0}
                max={maxValue}
                step={0.01}
                value={[inputValue ?? 0]}
                onValueChange={([value]) => setInputValue(value)}
                className="flex-1"
              />
              <span className="text-[10px] font-mono min-w-[30px]">
                {inputValue}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
