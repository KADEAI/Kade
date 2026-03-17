
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { SearchableSelect } from "../../ui"
import { styled } from "styled-components"

interface CliProxyProps {
    apiConfiguration: ProviderSettings
    setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
}

const StyledLoginButton = styled(VSCodeButton)`
	width: 100%;
`

export const CliProxy = ({ apiConfiguration, setApiConfigurationField }: CliProxyProps) => {
    const { t } = useTranslation()
    const [models, setModels] = useState<Record<string, { id: string, info: any }>>({})
    const [isLoading, setIsLoading] = useState(false)

    const channels = useMemo(() => [
        { value: "antigravity", label: "Antigravity", flag: "-antigravity-login" },
        { value: "google", label: "Google (Gemini)", flag: "-login" },
        { value: "claude", label: "Claude", flag: "-claude-login" },
        { value: "codex", label: "Codex (OpenAI)", flag: "-codex-login" },
        { value: "qwen", label: "Qwen", flag: "-qwen-login" },
        { value: "iflow", label: "iFlow", flag: "-iflow-login" },
    ], [])

    useEffect(() => {
        // Fetch models specifically for CLI Proxy
        // We'll listen for a message response
        const handler = (event: MessageEvent) => {
            const message = event.data
            if (message.type === "cliProxyModels" && message.cliProxyModels) {
                setModels(message.cliProxyModels)
                setIsLoading(false)
            }
        }
        window.addEventListener("message", handler)

        // Initial fetch
        refreshModels()

        return () => window.removeEventListener("message", handler)
    }, [])

    const refreshModels = () => {
        setIsLoading(true)
        vscode.postMessage({ type: "requestCliProxyModels" })
    }

    const selectedChannel = channels.find(c => c.value === apiConfiguration.cliProxyAuthId)

    // Filter models? 
    // Since we don't have per-channel filtering from the API easily without more work,
    // we'll assume the API returns all available models or the user selects which one to use.
    // Ideally, the proxy would return models associated with the active auth, or all of them.
    // For now, we show all returned models.

    const modelOptions = useMemo(() => {
        return Object.values(models).map(m => ({
            value: m.id,
            label: m.id
        }))
    }, [models])

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-vscode-descriptionForeground">
                    OAuth Provider Channel
                </label>
                <SearchableSelect
                    value={apiConfiguration.cliProxyAuthId || ""}
                    onValueChange={(value) => setApiConfigurationField("cliProxyAuthId", value)}
                    options={channels}
                    placeholder="Select OAuth Provider"
                    searchPlaceholder="Search provider..."
                    emptyMessage="No provider found."
                    className="w-full"
                />
            </div>

            {selectedChannel && (
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-vscode-descriptionForeground">
                        Authentication
                    </label>
                    <StyledLoginButton
                        appearance="secondary"
                        onClick={() => {
                            vscode.postMessage({ type: "cliProxyLogin", provider: selectedChannel.value })
                        }}
                    >
                        Open 9Router Dashboard
                    </StyledLoginButton>
                    <p className="text-xs text-vscode-descriptionForeground">
                        Manage your accounts (Claude, Google, Codex, etc.) via the 9Router web dashboard.
                    </p>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-vscode-descriptionForeground">
                    Model Selection
                </label>
                {isLoading ? (
                    <div className="text-xs text-vscode-descriptionForeground">Loading models...</div>
                ) : (
                    <SearchableSelect
                        value={apiConfiguration.apiModelId || ""}
                        onValueChange={(value) => setApiConfigurationField("apiModelId", value)}
                        options={modelOptions}
                        placeholder="Select Model"
                        className="w-full"
                        searchPlaceholder="Search model..."
                        emptyMessage="No models found. Try logging in first."
                    />
                )}
                <div className="flex justify-end">
                    <VSCodeButton
                        appearance="icon"
                        title="Refresh Models"
                        onClick={refreshModels}
                        style={{ height: "24px", width: "24px" }}
                    >
                        <span className="codicon codicon-refresh"></span>
                    </VSCodeButton>
                </div>
            </div>

            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-vscode-input-border/20">
                <span className="text-xs font-bold text-vscode-descriptionForeground uppercase">Advanced</span>
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-vscode-descriptionForeground">
                        Executable Path (Optional)
                    </label>
                    <VSCodeTextField
                        value={apiConfiguration.cliProxyPath || ""}
                        onInput={(e: any) => setApiConfigurationField("cliProxyPath", e.target.value)}
                        placeholder="Path to cli-proxy-api.exe"
                        className="w-full"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-vscode-descriptionForeground">
                        Port
                    </label>
                    <VSCodeTextField
                        value={apiConfiguration.cliProxyPort?.toString() || "20128"}
                        onInput={(e: any) => {
                            const val = parseInt(e.target.value)
                            setApiConfigurationField("cliProxyPort", isNaN(val) ? undefined : val)
                        }}
                        placeholder="20128"
                        className="w-full"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-vscode-descriptionForeground">
                        9Router API Key (Optional)
                    </label>
                    <VSCodeTextField
                        value={(apiConfiguration as any).cliProxyApiKey || ""}
                        onInput={(e: any) => setApiConfigurationField("cliProxyApiKey" as any, e.target.value)}
                        placeholder="Your 9Router API Key"
                        className="w-full"
                    />
                </div>
            </div>
        </div>
    )
}
