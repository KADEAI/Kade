import React, { useMemo, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { IMAGE_GENERATION_MODELS, type ImageGenerationProvider, getImageGenerationProvider } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { getAppUrl } from "@roo-code/types"
import { useRegisterSetting } from "./useSettingsSearch"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
	// kade_change start
	kiloCodeImageApiKey?: string
	setKiloCodeImageApiKey: (apiKey: string) => void
	currentProfileKilocodeToken?: string
	// kade_change end
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	// kade_change start
	kiloCodeImageApiKey,
	setKiloCodeImageApiKey,
	currentProfileKilocodeToken,
	// kade_change end
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// Register settings for search
	useRegisterSetting({ settingId: "image-gen-provider", section: "experimental", label: t("settings:experimental.IMAGE_GENERATION.providerLabel") })
	useRegisterSetting({ settingId: "image-gen-key", section: "experimental", label: t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyLabel") })
	useRegisterSetting({ settingId: "image-gen-model", section: "experimental", label: t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel") })

	// Use shared utility for backwards compatibility logic
	const currentProvider = getImageGenerationProvider(
		imageGenerationProvider,
		!!openRouterImageGenerationSelectedModel,
	)

	// kade_change start
	useEffect(() => {
		if (!enabled) {
			return
		}
		if (currentProvider !== "openrouter" && openRouterImageApiKey) {
			setOpenRouterImageApiKey("")
		}
	}, [enabled, currentProvider, openRouterImageApiKey, setOpenRouterImageApiKey])
	// kade_change end

	const availableModels = useMemo(() => {
		return IMAGE_GENERATION_MODELS.filter((model) => model.provider === currentProvider)
	}, [currentProvider])

	// Derive the current model value - either from props or first available
	const currentModel = useMemo(() => {
		// If we have a stored model, verify it exists for the current provider
		// (check both value and provider since some models have duplicate values)
		if (openRouterImageGenerationSelectedModel) {
			// Find a model that matches BOTH the value AND the current provider
			const modelInfo = IMAGE_GENERATION_MODELS.find(
				(m) => m.value === openRouterImageGenerationSelectedModel && m.provider === currentProvider,
			)
			if (modelInfo) {
				return openRouterImageGenerationSelectedModel
			}
		}
		// Otherwise use first available model for current provider
		return availableModels[0]?.value || IMAGE_GENERATION_MODELS[0].value
	}, [openRouterImageGenerationSelectedModel, availableModels, currentProvider])

	// Handle provider changes
	// kade_change: unused for now
	const handleProviderChange = (value: string) => {
		const newProvider = value as ImageGenerationProvider
		setImageGenerationProvider(newProvider)

		// Smart model selection when switching providers:
		// 1. If current model exists for new provider (same model name), keep it
		// 2. Otherwise, switch to first available model for new provider
		const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === newProvider)
		if (providerModels.length > 0) {
			// Check if current model exists for new provider
			const currentModelForNewProvider = providerModels.find(
				(m) => m.value === openRouterImageGenerationSelectedModel,
			)
			if (currentModelForNewProvider) {
				// Current model exists for new provider, keep it
				// No need to call setImageGenerationSelectedModel since the value doesn't change
			} else {
				// Current model doesn't exist for new provider, switch to first available
				setImageGenerationSelectedModel(providerModels[0].value)
			}
		}
	}

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		setOpenRouterImageApiKey(value)
	}

	const handleKiloApiKeyChange = (value: string) => {
		setKiloCodeImageApiKey(value)
	}

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		setImageGenerationSelectedModel(value)
	}

	const isConfigured = currentProvider === "openrouter" ? openRouterImageApiKey : kiloCodeImageApiKey // kade_change

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium text-[13px]">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-[11px] leading-relaxed opacity-90 pl-7">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="flex flex-col gap-5 pl-4 border-l-2 border-vscode-focusBorder/50 ml-1">
					{/* Provider Selection */}
					<div data-setting-id="image-gen-provider">
						<label className="block text-[13px] font-medium mb-2">
							{t("settings:experimental.IMAGE_GENERATION.providerLabel")}
						</label>
						<Select value={currentProvider} onValueChange={(value) => handleProviderChange(value)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select image provider" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="kilocode">Kilo Gateway</SelectItem>
								<SelectItem value="openrouter">OpenRouter</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
							{t("settings:experimental.IMAGE_GENERATION.providerDescription")}
						</p>
					</div>

					{/* Kilo Gateway API Key */}
					<div
						style={{ display: currentProvider === "openrouter" ? "none" : undefined }}
						data-setting-id="image-gen-key">
						<label className="block text-[13px] font-medium mb-2">
							{t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyLabel")}
						</label>
						<VSCodeTextField
							value={kiloCodeImageApiKey}
							onInput={(e: any) => handleKiloApiKeyChange(e.target.value)}
							placeholder={t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyPlaceholder")}
							className="w-full"
							type="password"
						/>
						<p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
							{currentProfileKilocodeToken ? (
								<a
									href="#"
									onClick={() => handleKiloApiKeyChange(currentProfileKilocodeToken)}
									className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
									{t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyPaste")}
								</a>
							) : (
								<>
									{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
									<a
										href={getAppUrl("/profile?personal=true")}
										target="_blank"
										rel="noopener noreferrer"
										className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
										{getAppUrl("/profile")}
									</a>
								</>
							)}
						</p>
					</div>

					{/* API Key Configuration (only for OpenRouter) */}
					{currentProvider === "openrouter" && (
						<div data-setting-id="image-gen-key">
							<label className="block text-[13px] font-medium mb-2">
								{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
							</label>
							<VSCodeTextField
								value={openRouterImageApiKey || ""}
								onInput={(e: any) => handleApiKeyChange(e.target.value)}
								placeholder={t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder")}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
								{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
								<a
									href="https://openrouter.ai/keys"
									target="_blank"
									rel="noopener noreferrer"
									className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
									openrouter.ai/keys
								</a>
							</p>
						</div>
					)}

					{/* Model Selection */}
					<div data-setting-id="image-gen-model">
						<label className="block text-[13px] font-medium mb-2">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<Select value={currentModel} onValueChange={(value) => handleModelChange(value)}>
							<SelectTrigger className="w-full text-[13px]">
								<SelectValue placeholder="Select model" />
							</SelectTrigger>
							<SelectContent>
								{availableModels.map((model) => (
									<SelectItem key={model.value} value={model.value}>
										{model.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
						</p>
					</div>

					{/* Status Message */}
					{enabled && !isConfigured && (
						<div className="p-3 bg-vscode-editorWarning-background/10 text-vscode-editorWarning-foreground rounded-xl text-[12px] border border-vscode-editorWarning-foreground/20 italic">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && isConfigured && (
						<div className="p-3 bg-vscode-editorInfo-background/10 text-vscode-editorInfo-foreground rounded-xl text-[12px] border border-vscode-editorInfo-foreground/20 italic">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
