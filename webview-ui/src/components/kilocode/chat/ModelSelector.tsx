import { useMemo } from "react"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { prettyModelName } from "../../../utils/prettyModelName"
import { useProviderModels } from "../hooks/useProviderModels"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { usePreferredModels } from "@/components/ui/hooks/kilocode/usePreferredModels"
import { getProviderIcon } from "../../settings/providerIcons"

interface ModelSelectorProps {
	currentApiConfigName?: string
	apiConfiguration: ProviderSettings
	fallbackText: string
	virtualQuotaActiveModel?: { id: string; name: string } // kade_change: Add virtual quota active model for UI display
	scope?: "task" | "global" // kade_change: Scope for settings updates
}

export const ModelSelector = ({
	currentApiConfigName,
	apiConfiguration,
	fallbackText,
	virtualQuotaActiveModel, //kade_change
	scope, // kade_change
}: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const { provider, providerModels, providerDefaultModel, isLoading, isError } = useProviderModels(apiConfiguration)
	const selectedModelId = getSelectedModelId({
		provider,
		apiConfiguration,
		defaultModelId: providerDefaultModel,
	})
	const modelIdKey = getModelIdKey({ provider })
	const isAutocomplete = apiConfiguration.profileType === "autocomplete"

	const modelsIds = usePreferredModels(providerModels)
	const options = useMemo(() => {
		const missingModelIds = modelsIds.indexOf(selectedModelId) >= 0 ? [] : [selectedModelId]
		return missingModelIds.concat(modelsIds).map((modelId) => {
			const rawLabel = providerModels[modelId]?.displayName ?? prettyModelName(modelId)
			const label = rawLabel.includes(":") ? rawLabel.split(":").slice(1).join(":").trim() : rawLabel

			const icon = getProviderIcon(modelId)

			return {
				value: modelId,
				label,
				type: DropdownOptionType.ITEM,
				icon,
			}
		})
	}, [modelsIds, providerModels, selectedModelId, provider])

	const disabled = isLoading || isError || isAutocomplete

	const onChange = (value: string) => {
		if (!currentApiConfigName) {
			return
		}
		if (apiConfiguration[modelIdKey] === value) {
			// don't reset openRouterSpecificProvider
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[modelIdKey]: value,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
			scope, // kade_change
		})
	}

	if (isLoading) {
		return null
	}

	// kade_change start: Display active model for virtual quota fallback
	if (provider === "virtual-quota-fallback" && virtualQuotaActiveModel) {
		return (
			<span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
				{prettyModelName(virtualQuotaActiveModel.id)}
			</span>
		)
	}
	// kade_change end

	if (isError || isAutocomplete || options.length <= 0) {
		return <span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">{fallbackText}</span>
	}

	return (
		<SelectDropdown
			value={selectedModelId}
			disabled={disabled}
			title={undefined}
			options={options}
			onChange={onChange}
			triggerClassName={cn(
				"text-ellipsis overflow-hidden",
				"bg-transparent border-none hover:bg-vscode-toolbar-hoverBackground focus:outline-none focus:ring-0 focus:border-0",
			)}
			triggerIcon={false}
			itemClassName="group"
		/>
	)
}
