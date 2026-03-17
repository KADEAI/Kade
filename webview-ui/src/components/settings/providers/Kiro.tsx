import { useCallback, useState } from "react"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type { ProviderSettings } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { inputEventTransform } from "../transforms"
import { vscode } from "../../../utils/vscode"

type KiroProps = {
    apiConfiguration: ProviderSettings
    setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const Kiro = ({ apiConfiguration, setApiConfigurationField }: KiroProps) => {
    const { t } = useAppTranslation()
    const [status, setStatus] = useState<{ loading: boolean; message: string; success?: boolean }>({
        loading: false,
        message: "",
    })

    const handleInputChange = useCallback(
        <K extends keyof ProviderSettings, E>(
            field: K,
            transform: (event: E) => ProviderSettings[K] = inputEventTransform,
        ) =>
            (event: E | Event) => {
                setApiConfigurationField(field, transform(event as E))
            },
        [setApiConfigurationField],
    )

    const checkConnection = () => {
        setStatus({ loading: true, message: "Checking credentials..." })
        // We'll use a generic message type that the extension handles
        vscode.postMessage({ 
            type: "checkKiroAuth", 
            path: apiConfiguration?.kiroBaseUrl // We'll hijack kiroBaseUrl to store the custom path
        })
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="p-3 bg-vscode-notifications-infoBackground border border-vscode-notifications-infoBorder rounded-md">
                <div className="flex items-center gap-2 mb-1">
                    <span className="codicon codicon-pass-filled text-vscode-notifications-infoIconForeground"></span>
                    <span className="font-medium text-vscode-notifications-infoForeground">Kiro OAuth Status</span>
                </div>
                <div className="text-sm text-vscode-descriptionForeground mb-3">
                    Bypasses standard limits using your local Kiro/AWS CLI session.
                </div>
                
                <VSCodeTextField
                    value={apiConfiguration?.kiroBaseUrl || "~/.aws/sso/cache/kiro-auth-token.json"}
                    onInput={handleInputChange("kiroBaseUrl")}
                    className="w-full mb-2">
                    <label className="block font-medium mb-1 text-xs">Credentials Path</label>
                </VSCodeTextField>


                {status.message && (
                    <div className={`mt-2 text-xs ${status.success === false ? "text-vscode-errorForeground" : "text-vscode-descriptionForeground"}`}>
                        {status.message}
                    </div>
                )}
            </div>
        </div>
    )
}
