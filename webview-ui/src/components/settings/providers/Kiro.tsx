import { useCallback } from "react";
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import type { ProviderSettings } from "@roo-code/types";
import { inputEventTransform } from "../transforms";

type KiroProps = {
  apiConfiguration: ProviderSettings;
  setApiConfigurationField: (
    field: keyof ProviderSettings,
    value: ProviderSettings[keyof ProviderSettings],
  ) => void;
};

export const Kiro = ({
  apiConfiguration,
  setApiConfigurationField,
}: KiroProps) => {
  const handleInputChange = useCallback(
    <K extends keyof ProviderSettings, E>(
      field: K,
      transform: (event: E) => ProviderSettings[K] = inputEventTransform,
    ) =>
      (event: E | Event) => {
        setApiConfigurationField(field, transform(event as E));
      },
    [setApiConfigurationField],
  );

  return (
    <div className="flex flex-col gap-4">

      <div className="p-3 bg-vscode-notifications-infoBackground border border-vscode-notifications-infoBorder rounded-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="codicon codicon-pass-filled text-vscode-notifications-infoIconForeground"></span>
          <span className="font-medium text-vscode-notifications-infoForeground">
            Kiro OAuth Status
          </span>
        </div>
        <div className="text-sm text-vscode-descriptionForeground mb-3">
          Bypasses standard limits using your local Kiro/AWS CLI session.
        </div>

        <VSCodeTextField
          value={
            apiConfiguration?.kiroBaseUrl ||
            "~/.aws/sso/cache/kiro-auth-token.json"
          }
          onInput={handleInputChange("kiroBaseUrl")}
          className="w-full mb-2"
        >
          <label className="block font-medium mb-1 text-xs">
            Credentials Path
          </label>
        </VSCodeTextField>
      </div>
    </div>
  );
};
