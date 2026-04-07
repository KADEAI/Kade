import { useCallback, useEffect, useState } from "react";
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";

import {
  type OrganizationAllowList,
  type ProviderSettings,
  bluesmindsDefaultModelId,
} from "@roo-code/types";

import type { RouterModels } from "@roo/api";

import { vscode } from "@src/utils/vscode";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { Button } from "@src/components/ui";
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink";

import { inputEventTransform } from "../transforms";
import { ModelPicker } from "../ModelPicker";

type BluesmindsProps = {
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

export const Bluesminds = ({
  apiConfiguration,
  setApiConfigurationField,
  routerModels,
  refetchRouterModels,
  organizationAllowList,
  modelValidationError,
  simplifySettings,
}: BluesmindsProps) => {
  const { t } = useAppTranslation();
  const [customBaseUrlSelected, setCustomBaseUrlSelected] = useState(
    !!apiConfiguration.bluesmindsBaseUrl,
  );

  useEffect(() => {
    setCustomBaseUrlSelected(!!apiConfiguration.bluesmindsBaseUrl);
  }, [apiConfiguration.bluesmindsBaseUrl]);

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
        value={apiConfiguration?.bluesmindsApiKey || ""}
        type="password"
        onInput={handleInputChange("bluesmindsApiKey")}
        placeholder={t("settings:placeholders.apiKey")}
        className="w-full"
      >
        <label className="block font-medium mb-1">Bluesminds API Key</label>
      </VSCodeTextField>
      <div className="text-sm text-vscode-descriptionForeground -mt-2">
        {t("settings:providers.apiKeyStorageNotice")}
      </div>
      {!apiConfiguration?.bluesmindsApiKey && (
        <VSCodeButtonLink
          href="https://api.bluesminds.com"
          style={{ width: "100%" }}
          appearance="primary"
        >
          Open Bluesminds
        </VSCodeButtonLink>
      )}

      <VSCodeCheckbox
        checked={customBaseUrlSelected}
        onChange={(e: any) => {
          const isChecked = e.target.checked === true;
          if (!isChecked) {
            setApiConfigurationField("bluesmindsBaseUrl", undefined);
          }
          setCustomBaseUrlSelected(isChecked);
        }}
      >
        {t("settings:providers.useCustomBaseUrl")}
      </VSCodeCheckbox>
      {customBaseUrlSelected && (
        <VSCodeTextField
          value={apiConfiguration?.bluesmindsBaseUrl || ""}
          type="url"
          onInput={handleInputChange("bluesmindsBaseUrl")}
          placeholder="Default: https://api.bluesminds.com/v1"
          className="w-full"
        >
          <label className="block font-medium mb-1">Bluesminds Base URL</label>
        </VSCodeTextField>
      )}

      <Button
        variant="outline"
        onClick={() => {
          vscode.postMessage({ type: "flushRouterModels", text: "bluesminds" });
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
        defaultModelId={bluesmindsDefaultModelId}
        models={routerModels?.bluesminds ?? {}}
        modelIdKey="apiModelId"
        serviceName="Bluesminds"
        serviceUrl="https://api.bluesminds.com"
        organizationAllowList={organizationAllowList}
        errorMessage={modelValidationError}
        simplifySettings={simplifySettings}
      />
    </>
  );
};
