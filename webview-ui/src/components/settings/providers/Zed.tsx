import { SiGithub } from "react-icons/si";
import {
  type ProviderSettings,
  type OrganizationAllowList,
  zedDefaultModelId,
} from "@roo-code/types";

import type { RouterModels } from "@roo/api";

import { useAppTranslation } from "@src/i18n/TranslationContext";
import { vscode } from "@src/utils/vscode";
import { Button } from "@src/components/ui";

import { ModelPicker } from "../ModelPicker";

type ZedProps = {
  apiConfiguration: ProviderSettings;
  setApiConfigurationField: (
    field: keyof ProviderSettings,
    value: ProviderSettings[keyof ProviderSettings],
  ) => void;
  routerModels?: RouterModels;
  zedIsAuthenticated?: boolean;
  zedGithubLogin?: string;
  organizationAllowList: OrganizationAllowList;
  modelValidationError?: string;
  simplifySettings?: boolean;
};

export const Zed = ({
  apiConfiguration,
  setApiConfigurationField,
  routerModels,
  zedIsAuthenticated = false,
  zedGithubLogin,
  organizationAllowList,
  modelValidationError,
  simplifySettings,
}: ZedProps) => {
  const { t } = useAppTranslation();
  const models = routerModels?.zed ?? {};
  const defaultModelId = Object.keys(models)[0] ?? zedDefaultModelId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {zedIsAuthenticated ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-1 ml-[7px]">
              <SiGithub className="text-vscode-descriptionForeground" />
              <span className="text-xs text-vscode-descriptionForeground">
                Signed in as{" "}
                <span className="font-medium text-vscode-foreground">
                  {zedGithubLogin ? `@${zedGithubLogin}` : "your Zed account"}
                </span>
              </span>
            </div>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => vscode.postMessage({ type: "zedSignOut" })}
            >
              {t("settings:providers.zed.signOutButton", {
                defaultValue: "Sign Out",
              })}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => vscode.postMessage({ type: "zedSignIn" })}
          >
            {t("settings:providers.zed.signInButton", {
              defaultValue: "Sign in with Zed",
            })}
          </Button>
        )}
      </div>

      <ModelPicker
        apiConfiguration={apiConfiguration}
        setApiConfigurationField={setApiConfigurationField}
        defaultModelId={defaultModelId}
        models={models}
        modelIdKey="apiModelId"
        serviceName="Zed"
        serviceUrl="https://zed.dev/ai"
        organizationAllowList={organizationAllowList}
        errorMessage={modelValidationError}
        simplifySettings={simplifySettings}
      />

      <p className="text-xs text-vscode-descriptionForeground">
        Use your Zed account to access the models available through Zed Cloud.
      </p>
    </div>
  );
};
