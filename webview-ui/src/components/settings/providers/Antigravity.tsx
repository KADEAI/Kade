import { SiGoogle } from "react-icons/si"
import {
    type ProviderSettings,
    antigravityDefaultModelId,
    antigravityModels,
    type OrganizationAllowList,
} from "@roo-code/types"

import { useAppTranslation } from "../../../i18n/TranslationContext"
import { Button } from "../../ui"
import { vscode } from "../../../utils/vscode"
import { ModelPicker } from "../ModelPicker"

interface AntigravityProps {
    apiConfiguration: ProviderSettings
    setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
    simplifySettings?: boolean
    antigravityIsAuthenticated?: boolean
    antigravityEmail?: string
    antigravityProjectId?: string
    organizationAllowList: OrganizationAllowList
}

export const Antigravity: React.FC<AntigravityProps> = ({
    apiConfiguration,
    setApiConfigurationField,
    simplifySettings,
    antigravityIsAuthenticated = false,
    antigravityEmail,
    antigravityProjectId,
    organizationAllowList,
}) => {
    const { t } = useAppTranslation()

    return (
        <div className="flex flex-col gap-4">
            {/* Authentication Section */}
            <div className="flex flex-col gap-2">
                {antigravityIsAuthenticated ? (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 mb-1 ml-[7px]">
                            <SiGoogle className="text-vscode-descriptionForeground" />
                            <span className="text-xs text-vscode-descriptionForeground">Signed in as <span className="font-medium text-vscode-foreground">{antigravityEmail}</span></span>
                        </div>
                        <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => vscode.postMessage({ type: "antigravitySignOut" })}>
                            {t("settings:providers.antigravity.signOutButton", {
                                defaultValue: "Sign Out",
                            })}
                        </Button>
                    </div>
                ) : (
                    <Button
                        variant="primary"
                        onClick={() => vscode.postMessage({ type: "antigravitySignIn" })}
                        className="w-full">
                        {t("settings:providers.antigravity.signInButton", {
                            defaultValue: "Sign in with Google",
                        })}
                    </Button>
                )}
            </div>

            {/* Model Picker */}
            <ModelPicker
                apiConfiguration={apiConfiguration}
                setApiConfigurationField={setApiConfigurationField}
                defaultModelId={antigravityDefaultModelId}
                models={antigravityModels}
                modelIdKey="apiModelId"
                serviceName="Google Gemini (Antigravity)"
                serviceUrl="https://ai.google.dev/gemini-api/docs/models/gemini"
                simplifySettings={simplifySettings}
                organizationAllowList={organizationAllowList}
            />

            <div className="flex flex-col gap-3">
                <p className="text-xs text-vscode-descriptionForeground">
                    Use your Google Account to access Gemini models via the Antigravity API. This is the same authentication method used by official Google integrations in tools like VS Code and JetBrains IDEs.
                </p>
            </div>
        </div>
    )
}
