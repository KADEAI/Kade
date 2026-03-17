import React, { useState, useMemo } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Section } from "./Section"
import { CheckCircle2, Info, Lock, Unlock } from "lucide-react"
import { StandardTooltip } from "../ui"
import ApiOptions from "./ApiOptions"
import { ProviderSettings } from "@roo-code/types"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { SetCachedStateField } from "./types"

interface SubAgentSettingsProps {
	alwaysAllowSubtasks?: boolean
	subAgentToolEnabled: boolean
	subAgentApiConfiguration?: ProviderSettings
	setCachedStateField: SetCachedStateField<any>
	setSubAgentApiConfigurationField: (field: keyof ProviderSettings, value: any) => void
	uriScheme?: string
	proLicenseKey?: string
}

const VALID_LICENSES = [
	"KADE-FBCB533D",
	"KADE-BF4CA9AE",
	"KADE-81D32597",
	"KADE-9F0F46CC",
	"KADE-23E53C56",
	"KADE-5F73A57A",
	"KADE-C2813B70",
	"KADE-04622D44",
	"KADE-DD386EF4",
	"KADE-DC727B2E",
	"KADE-1AFDEF35",
	"KADE-332B9601",
	"KADE-5A445C31",
	"KADE-81D7EBDD",
	"KADE-96F5CAB9",
	"KADE-46448729",
	"KADE-24BCC637",
	"KADE-6EEB83B8",
	"KADE-52986F6F",
	"KADE-8F7B7B98",
	"KADE-140D212D",
	"KADE-84466BE5",
	"KADE-0626114E",
	"KADE-22D0AC83",
	"KADE-5741DBDC",
	"KADE-DF02BDC2",
	"KADE-26961E94",
	"KADE-24D5E0A5",
	"KADE-45C14CF4",
	"KADE-B3D52F6F",
	"KADE-AF61F3E7",
	"KADE-6743456A",
	"KADE-EB8340CC",
	"KADE-B5DFD47B",
	"KADE-DD188994",
	"KADE-32C061CE",
	"KADE-6193BF2E",
	"KADE-3E55C832",
	"KADE-954ABA03",
	"KADE-7A0E893B",
	"KADE-5A685775",
	"KADE-E2107E80",
	"KADE-78E23D4F",
	"KADE-9C0DC7A8",
	"KADE-DABB29F1",
	"KADE-0E017FEE",
	"KADE-B16C83E6",
	"KADE-DFBFC970",
	"KADE-81D5EC06",
	"KADE-A0000815",
	"KADE-B18E3125",
	"KADE-66BB4BA9",
	"KADE-425114C9",
	"KADE-F45E99C6",
	"KADE-FA36F92F",
	"KADE-A402C43D",
	"KADE-01EDAA73",
	"KADE-469804A2",
	"KADE-F12C07EF",
	"KADE-CABB09D8",
	"KADE-39F1BB06",
	"KADE-E4518814",
	"KADE-FE8E20D8",
	"KADE-DE5FFD27",
	"KADE-CF5A2D43",
	"KADE-3C1BF48F",
	"KADE-30C568C4",
	"KADE-F15A91BD",
	"KADE-432DF30C",
	"KADE-1C838EB3",
	"KADE-D99B884A",
	"KADE-89AB0EBC",
	"KADE-4271AC5E",
	"KADE-156FE68E",
	"KADE-F28EFAF1",
	"KADE-C9AE7AC8",
	"KADE-2E51BFA4",
	"KADE-C7748D34",
	"KADE-2472A4E9",
	"KADE-9A2E6EB9",
	"KADE-AE9F7940",
	"KADE-028E3FC9",
	"KADE-EF674287",
	"KADE-D74D1A1C",
	"KADE-98307FCF",
	"KADE-5C69F19E",
	"KADE-48AFFA15",
	"KADE-3DF63DD2",
	"KADE-414BD119",
	"KADE-73373448",
	"KADE-BDA335BF",
	"KADE-73D1A3D8",
	"KADE-DDEBFE90",
	"KADE-F3D83DB3",
	"KADE-16A169F0",
	"KADE-9D539C33",
	"KADE-95048D40",
	"KADE-238A2147",
	"KADE-838312F7",
	"KADE-FD7BCB26"
]

export const SubAgentSettings = ({
	alwaysAllowSubtasks,
	subAgentToolEnabled,
	subAgentApiConfiguration,
	setCachedStateField,
	setSubAgentApiConfigurationField,
	uriScheme,
	proLicenseKey,
}: SubAgentSettingsProps) => {
	const { t } = useAppTranslation()
	const { apiConfiguration: mainApiConfiguration, marketplaceInstalledMetadata } = useExtensionState()

	const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined)

	const handleApiFieldChange = (field: keyof ProviderSettings, value: any, isUserAction: boolean = true) => {
		setSubAgentApiConfigurationField(field, value)
	}

	// Merge main config with sub-agent overrides so that API keys and base URLs are available
	const mergedApiConfiguration = React.useMemo(() => {
		return {
			...mainApiConfiguration,
			...subAgentApiConfiguration,
		}
	}, [mainApiConfiguration, subAgentApiConfiguration])

	const isUnlocked = useMemo(() => {
		return proLicenseKey && VALID_LICENSES.includes(proLicenseKey.trim())
	}, [proLicenseKey])

	const isSubAgentOpsInstalled = useMemo(() => {
		return Boolean(
			marketplaceInstalledMetadata?.project?.["sub-agent-ops"] ||
				marketplaceInstalledMetadata?.global?.["sub-agent-ops"],
		)
	}, [marketplaceInstalledMetadata])

	return (
		<div className="flex flex-col gap-6">
			<Section title={t("kilocode:settings.subAgents.title")}>
				<div className="flex flex-col gap-4">
					{!isUnlocked && (
						<div className="bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-lg p-4 flex flex-col gap-3">
							<div className="flex items-center gap-2">
								<Lock className="size-4 text-vscode-inputValidation-infoForeground" />
								<span className="font-semibold text-vscode-inputValidation-infoForeground">
									Pro Feature Locked
								</span>
							</div>
							<p className="text-sm text-vscode-descriptionForeground">
								Unlock the most powerful sub-agent feature ever made for an agentic IDE. 
								Get your Pro License for just $5 to enable advanced sub-agent capabilities.
								Email support@kadei.org with feedback, ideas, recommendations, or problems and we'll send you a free one!
							</p>
							<div className="flex flex-col gap-2 mt-1">
								<a
									href="https://buy.stripe.com/00w5kDgCAe28fjFa2q6sw00"
									target="_blank"
									rel="noreferrer"
									className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground text-sm font-medium w-fit"
								>
									Get Pro License →
								</a>
								<div className="flex items-center gap-2 mt-2">
									<VSCodeTextField
										placeholder="Enter Pro License Key (e.g. KADE-XXXXXXXX)"
										value={proLicenseKey || ""}
										onInput={(e: any) => setCachedStateField("proLicenseKey", e.target.value)}
										className="flex-1"
									/>
								</div>
							</div>
						</div>
					)}

					{isUnlocked && (
						<div className="bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-lg p-3 flex items-center gap-2 mb-2">
							<Unlock className="size-4 text-vscode-testing-iconPassed" />
							<span className="text-sm font-medium text-vscode-testing-iconPassed">
								Pro License Active
							</span>
						</div>
					)}

					<div className={`flex flex-col gap-4 ${!isUnlocked ? "opacity-50 pointer-events-none" : ""}`}>
						<div
							className={`rounded-lg p-4 flex flex-col gap-3 ${
								isSubAgentOpsInstalled
									? "bg-transparent border border-white/[0.06]"
									: "bg-white/[0.02] border border-white/[0.06]"
							}`}>
							<div className="flex flex-col gap-1">
								{isSubAgentOpsInstalled ? (
									<div className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-vscode-testing-iconPassed" />
										<span className="text-sm font-medium text-vscode-testing-iconPassed">
											Sub Agent Ops Installed
										</span>
									</div>
								) : (
									<>
										<span className="text-sm font-medium text-white/90">Install Sub Agent Ops Mode</span>
										<span className="text-xs text-vscode-descriptionForeground">
											Install the Sub Agent Ops mode for a more refined sub-agent experience with better delegation and orchestration flows.
										</span>
									</>
								)}
							</div>
							{!isSubAgentOpsInstalled && (
								<div className="flex items-center gap-2">
									<VSCodeButton
										appearance="secondary"
										onClick={() =>
											window.postMessage(
												{
													type: "action",
													action: "marketplaceButtonClicked",
													values: { marketplaceTab: "mode" },
												},
												"*",
											)
										}>
										Open Modes Marketplace
									</VSCodeButton>
								</div>
							)}
						</div>

						<div className="flex items-center gap-2">
						<VSCodeCheckbox
							checked={subAgentToolEnabled}
							onChange={(e: any) => setCachedStateField("subAgentToolEnabled", e.target.checked)}>
							<span className="font-medium text-sm">{t("kilocode:subAgents.enableTool.label")}</span>
						</VSCodeCheckbox>
						<StandardTooltip content={t("kilocode:subAgents.enableTool.description")}>
							<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
						</StandardTooltip>
					</div>


					<div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 flex flex-col gap-4">
						<div className="flex flex-col gap-1">
							<span className="text-sm font-medium text-white/90">
								{t("kilocode:settings.subAgents.defaultModel.label")}
							</span>
							<span className="text-xs text-vscode-descriptionForeground">
								{t("kilocode:settings.subAgents.defaultModel.description")}
							</span>
							<span
								style={{
									fontSize: "11px",
									marginTop: "4px",
									color: "var(--vscode-descriptionForeground)",
									fontWeight: "bold",
								}}>
								Note: To use, simply tell your main agent to spawn sub agents to do (x) task.
							</span>
						</div>

						<ApiOptions
							uriScheme={uriScheme}
							apiConfiguration={mergedApiConfiguration}
							setApiConfigurationField={(field, value, isUserAction) => handleApiFieldChange(field, value, isUserAction)}
							errorMessage={errorMessage}
							setErrorMessage={setErrorMessage}
							hideProtocolAndAdvanced={true}
							hideRecommendation={true}
						/>
					</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
