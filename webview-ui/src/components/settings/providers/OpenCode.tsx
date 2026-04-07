import { useCallback, useState } from "react";
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";

import {
  OrganizationAllowList,
  type ProviderSettings,
  opencodeDefaultModelId,
} from "@roo-code/types";

import type { RouterModels } from "@roo/api";

import { vscode } from "@src/utils/vscode";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { Button } from "@src/components/ui";
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink";

import { inputEventTransform } from "../transforms";
import { ModelPicker } from "../ModelPicker";

type OpenCodeProps = {
  apiConfiguration: ProviderSettings;
  setApiConfigurationField: (
    field: keyof ProviderSettings,
    value: ProviderSettings[keyof ProviderSettings],
  ) => void;
  routerModels?: RouterModels;
  refetchRouterModels: () => void;
  organizationAllowList: OrganizationAllowList;
  modelValidationError?: string;
  simplifySettings?: boolean;
};

export const OpenCode = ({
  apiConfiguration,
  setApiConfigurationField,
  routerModels,
  refetchRouterModels,
  organizationAllowList,
  modelValidationError,
  simplifySettings,
}: OpenCodeProps) => {
  const { t } = useAppTranslation();

  const [didRefetch, setDidRefetch] = useState<boolean>();

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
    <>
      <VSCodeTextField
        value={apiConfiguration?.opencodeApiKey || ""}
        type="password"
        onInput={handleInputChange("opencodeApiKey")}
        placeholder={t("settings:placeholders.apiKey")}
        className="w-full"
      >
        <label className="block font-medium mb-1">
          {t("settings:providers.apiKey")}
        </label>
      </VSCodeTextField>
      <div className="text-sm text-vscode-descriptionForeground -mt-2">
        {t("settings:providers.apiKeyStorageNotice")}
      </div>
      {!apiConfiguration?.opencodeApiKey && (
        <VSCodeButtonLink
          href="https://opencode.ai/zen"
          style={{ width: "100%" }}
          appearance="primary"
        >
          Get OpenCode API Key
        </VSCodeButtonLink>
      )}

      <Button
        variant="outline"
        onClick={() => {
          vscode.postMessage({ type: "flushRouterModels", text: "opencode" });
          refetchRouterModels();
          setDidRefetch(true);
        }}
      >
        <div className="flex items-center gap-2">
          <span className="codicon codicon-refresh" />
          {t("settings:providers.refreshModels.label")}
        </div>
      </Button>
      {didRefetch && (
        <div className="flex items-center text-vscode-errorForeground">
          {t("settings:providers.refreshModels.hint")}
        </div>
      )}

      <ModelPicker
        apiConfiguration={apiConfiguration}
        setApiConfigurationField={setApiConfigurationField}
        defaultModelId={opencodeDefaultModelId}
        models={routerModels?.opencode ?? {}}
        modelIdKey="opencodeModelId"
        serviceName="OpenCode"
        serviceUrl="https://opencode.ai/zen"
        organizationAllowList={organizationAllowList}
        errorMessage={modelValidationError}
        simplifySettings={simplifySettings}
      />
    </>
  );
};
