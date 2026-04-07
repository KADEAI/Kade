import { useCallback, useEffect, useState } from "react";
import {
  VSCodeCheckbox,
  VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";

import {
  type OrganizationAllowList,
  type ProviderSettings,
  aihubmixDefaultModelId,
} from "@roo-code/types";

import type { RouterModels } from "@roo/api";

import { vscode } from "@src/utils/vscode";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { Button } from "@src/components/ui";
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink";

import { inputEventTransform } from "../transforms";
import { ModelPicker } from "../ModelPicker";

type AIHubMixProps = {
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

export const AIHubMix = ({
  apiConfiguration,
  setApiConfigurationField,
  routerModels,
  refetchRouterModels,
  organizationAllowList,
  modelValidationError,
  simplifySettings,
}: AIHubMixProps) => {
  const { t } = useAppTranslation();
  const [customBaseUrlSelected, setCustomBaseUrlSelected] = useState(
    !!apiConfiguration.aihubmixBaseUrl,
  );

  useEffect(() => {
    setCustomBaseUrlSelected(!!apiConfiguration.aihubmixBaseUrl);
  }, [apiConfiguration.aihubmixBaseUrl]);

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
        value={apiConfiguration?.aihubmixApiKey || ""}
        type="password"
        onInput={handleInputChange("aihubmixApiKey")}
        placeholder={t("settings:placeholders.apiKey")}
        className="w-full"
      >
        <label className="block font-medium mb-1">AIHubMix API Key</label>
      </VSCodeTextField>
      <div className="text-sm text-vscode-descriptionForeground -mt-2">
        {t("settings:providers.apiKeyStorageNotice")}
      </div>
      {!apiConfiguration?.aihubmixApiKey && (
        <VSCodeButtonLink
          href="https://aihubmix.com"
          style={{ width: "100%" }}
          appearance="primary"
        >
          Get AIHubMix API Key
        </VSCodeButtonLink>
      )}

      <VSCodeCheckbox
        checked={customBaseUrlSelected}
        onChange={(e: any) => {
          const isChecked = e.target.checked === true;
          if (!isChecked) {
            setApiConfigurationField("aihubmixBaseUrl", undefined);
          }
          setCustomBaseUrlSelected(isChecked);
        }}
      >
        {t("settings:providers.useCustomBaseUrl")}
      </VSCodeCheckbox>
      {customBaseUrlSelected && (
        <VSCodeTextField
          value={apiConfiguration?.aihubmixBaseUrl || ""}
          type="url"
          onInput={handleInputChange("aihubmixBaseUrl")}
          placeholder="Default: https://aihubmix.com/v1"
          className="w-full"
        >
          <label className="block font-medium mb-1">AIHubMix Base URL</label>
        </VSCodeTextField>
      )}

      <Button
        variant="outline"
        onClick={() => {
          vscode.postMessage({ type: "flushRouterModels", text: "aihubmix" });
          refetchRouterModels();
        }}
      >
        <div className="flex items-center gap-2">
          <span className="codicon codicon-refresh" />
          {t("settings:providers.refreshModels.label")}
        </div>
      </Button>

      <ModelPicker
        apiConfiguration={apiConfiguration}
        setApiConfigurationField={setApiConfigurationField}
        defaultModelId={aihubmixDefaultModelId}
        models={routerModels?.aihubmix ?? {}}
        modelIdKey="apiModelId"
        serviceName="AIHubMix"
        serviceUrl="https://aihubmix.com"
        organizationAllowList={organizationAllowList}
        errorMessage={modelValidationError}
        simplifySettings={simplifySettings}
      />
    </>
  );
};
