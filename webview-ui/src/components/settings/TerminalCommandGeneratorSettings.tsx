import { HTMLAttributes } from "react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { Webhook } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { cn } from "@/lib/utils";

import { SetCachedStateField } from "./types";

type TerminalCommandGeneratorSettingsProps = HTMLAttributes<HTMLDivElement> & {
  terminalCommandApiConfigId?: string;
  setCachedStateField: SetCachedStateField<"terminalCommandApiConfigId">;
};

export const TerminalCommandGeneratorSettings = ({
  terminalCommandApiConfigId,
  setCachedStateField,
  className,
  ...props
}: TerminalCommandGeneratorSettingsProps) => {
  const { t } = useAppTranslation();
  const { listApiConfigMeta } = useExtensionState();

  return (
    <div className={cn("flex flex-col gap-5", className)} {...props}>
      <div className="flex flex-col gap-3.5 pl-3.5 border-l-2 border-vscode-focusBorder/50">
        <div>
          <label className="block text-[13px] font-medium mb-2">
            {t("kilocode:settings.terminal.commandGenerator.apiConfigId.label")}
          </label>
          <div className="flex flex-col gap-2">
            <Select
              value={terminalCommandApiConfigId || "-"}
              onValueChange={(value) =>
                setCachedStateField(
                  "terminalCommandApiConfigId",
                  value === "-" ? "" : value,
                )
              }
            >
              <SelectTrigger
                data-testid="terminal-command-api-config-select"
                className="w-full text-[13px]"
              >
                <SelectValue
                  placeholder={t(
                    "kilocode:settings.terminal.commandGenerator.apiConfigId.current",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-" className="text-[13px]">
                  {t(
                    "kilocode:settings.terminal.commandGenerator.apiConfigId.current",
                  )}
                </SelectItem>
                {(listApiConfigMeta || []).map((config) => (
                  <SelectItem
                    key={config.id}
                    value={config.id}
                    data-testid={`terminal-command-${config.id}-option`}
                    className="text-[13px]"
                  >
                    {config.name} ({config.apiProvider})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-vscode-descriptionForeground text-[11px] mt-1.5 opacity-80 leading-relaxed">
              {t(
                "kilocode:settings.terminal.commandGenerator.apiConfigId.description",
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
