import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"
import { useRegisterSetting } from "./useSettingsSearch"

const CommitMessagePromptSettings = () => {
	const { t } = useAppTranslation()

	// Register settings for search
	useRegisterSetting({ settingId: "commit-msg-config", section: "prompts", label: t("prompts:supportPrompts.enhance.apiConfiguration") })
	const { listApiConfigMeta, commitMessageApiConfigId, setCommitMessageApiConfigId } = useExtensionState()

	return (
		<div className="flex flex-col gap-5">
			<div data-setting-id="commit-msg-config">
				<label className="block text-[13px] font-medium mb-2">
					{t("prompts:supportPrompts.enhance.apiConfiguration")}
				</label>
				<Select
					value={commitMessageApiConfigId || "-"}
					onValueChange={(value) => {
						setCommitMessageApiConfigId(value === "-" ? "" : value)
						vscode.postMessage({
							type: "commitMessageApiConfigId",
							text: value,
						})
					}}>
					<SelectTrigger data-testid="commit-message-api-config-select" className="w-full text-[13px]">
						<SelectValue placeholder={t("prompts:supportPrompts.enhance.useCurrentConfig")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="-" className="text-[13px]">{t("prompts:supportPrompts.enhance.useCurrentConfig")}</SelectItem>
						{(listApiConfigMeta || []).map((config) => (
							<SelectItem
								key={config.id}
								value={config.id}
								data-testid={`commit-message-${config.id}-option`}
								className="text-[13px]">
								{config.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
					{t("prompts:supportPrompts.enhance.apiConfigDescription")}
				</div>
			</div>
		</div>
	)
}

export default CommitMessagePromptSettings
