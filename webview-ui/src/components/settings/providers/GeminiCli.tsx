import { SiGoogle } from "react-icons/si"
import type { ProviderSettings } from "@roo-code/types"
import { geminiCliDefaultModelId, geminiCliModels, OrganizationAllowList } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "../../ui"
import { vscode } from "@src/utils/vscode"
import { ModelPicker } from "../ModelPicker"

type GeminiCliProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	geminiCliIsAuthenticated?: boolean
	geminiCliEmail?: string
	geminiCliProjectId?: string
	organizationAllowList: OrganizationAllowList
}

export const GeminiCli = ({
	apiConfiguration,
	setApiConfigurationField,
	geminiCliIsAuthenticated,
	geminiCliEmail,
	geminiCliProjectId,
	organizationAllowList,
}: GeminiCliProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				{geminiCliIsAuthenticated ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2 mb-1 ml-[7px]">
							<SiGoogle className="text-vscode-descriptionForeground" />
							<span className="text-xs text-vscode-descriptionForeground">Signed in as <span className="font-medium text-vscode-foreground">{geminiCliEmail}</span></span>
						</div>

						<Button
							variant="secondary"
							className="w-full"
							onClick={() => vscode.postMessage({ type: "geminiCliSignOut" })}>
							Sign Out
						</Button>
					</div>
				) : (
					<Button
						variant="primary"
						className="w-full"
						onClick={() => vscode.postMessage({ type: "geminiCliSignIn" })}>
						Sign in with Google
					</Button>
				)}
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={geminiCliDefaultModelId}
				models={geminiCliModels}
				modelIdKey="apiModelId"
				serviceName="Gemini CLI"
				serviceUrl="https://github.com/google-gemini/gemini-cli"
				organizationAllowList={organizationAllowList}
			/>

			<div className="text-sm text-vscode-descriptionForeground">
				Use the Gemini CLI authentication to access Gemini models. This uses the OAuth flow from the Gemini CLI tool.
			</div>
		</div>
	)
}
