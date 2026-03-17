import React, { HTMLAttributes, useMemo } from "react"
import {
	Zap,
	Images,
	Brain,
	FileCode2,
} from "lucide-react"
import { useRegisterSetting } from "./useSettingsSearch"

import type { Experiments, ImageGenerationProvider } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

// import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import {
	SetCachedStateField,
	SetExperimentEnabled,
} from "./types"

import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { FastApplySettings } from "./FastApplySettings"
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { SpeechToTextSettings } from "./SpeechToTextSettings"
// import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	morphApiKey?: string
	fastApplyModel?: string
	fastApplyApiProvider?: string
	setCachedStateField: SetCachedStateField<"morphApiKey" | "fastApplyModel" | "fastApplyApiProvider">
	kiloCodeImageApiKey?: string
	setKiloCodeImageApiKey?: (apiKey: string) => void
	currentProfileKilocodeToken?: string
	apiConfiguration?: any
	setApiConfigurationField?: any
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider?: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey?: (apiKey: string) => void
	setImageGenerationSelectedModel?: (model: string) => void
	setExperimentId?: (id: string, value: boolean) => void // Add definition if missing in types
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	className,
	morphApiKey,
	fastApplyModel,
	fastApplyApiProvider,
	setCachedStateField,
	setKiloCodeImageApiKey,
	kiloCodeImageApiKey,
	currentProfileKilocodeToken,
	...props
}: ExperimentalSettingsProps) => {
	// const { t } = useAppTranslation()

	// Register settings for search
	// useRegisterSetting({ settingId: "exp-fast-apply", section: "experimental", label: "Enable Fast Apply" })
	useRegisterSetting({ settingId: "exp-image-gen", section: "experimental", label: "Enable AI image generation" })
	useRegisterSetting({ settingId: "exp-multi-file", section: "experimental", label: "Enable concurrent file edits" })
	useRegisterSetting({ settingId: "exp-stt", section: "experimental", label: "Speech-to-Text (STT)" })
	useRegisterSetting({ settingId: "exp-power-steering", section: "experimental", label: "Use experimental \"power steering\" mode" })

	// Define groups for experiments
	const groups = useMemo(() => {
		const allExperiments = Object.entries(experimentConfigsMap)
			.filter(([key]) => key in EXPERIMENT_IDS)
			.filter((config) => config[0] !== "MARKETPLACE")
			.filter(([key]) => key !== "MULTIPLE_NATIVE_TOOL_CALLS")
			.filter(([key]) => key !== "YOLO_MODE") // Hide YOLO_MODE from UI

		const grouped = {
			modifications: [] as typeof allExperiments,
			generative: [] as typeof allExperiments,
			behavior: [] as typeof allExperiments,
			other: [] as typeof allExperiments,
		}

		allExperiments.forEach((exp) => {
			const key = exp[0]
			if (key === "MORPH_FAST_APPLY") {
				// grouped.modifications.push(exp) // Disabled
			} else if (key === "MULTI_FILE_APPLY_DIFF") {
				grouped.modifications.push(exp)
			} else if (key === "IMAGE_GENERATION" || key === "SPEECH_TO_TEXT") {
				grouped.generative.push(exp)
			} else if (key === "POWER_STEERING") {
				grouped.behavior.push(exp)
			} else if (key === "ENABLE_SUB_AGENTS") {
				// grouped.behavior.push(exp) // kilocode_change: hidden from UI
			} else {
				grouped.other.push(exp)
			}
		})

		return grouped
	}, [])

	const renderExperiment = (config: [string, any]) => {
		const key = config[0]
		const id = EXPERIMENT_IDS[key as keyof typeof EXPERIMENT_IDS]
		const enabled = experiments[id] ?? false

		// Fast Apply Special Handling
		if (key === "MORPH_FAST_APPLY") {
			return (
				<div key={key} className="flex flex-col gap-2" data-setting-id="exp-fast-apply">
					<ExperimentalFeature
						experimentKey={key}
						enabled={enabled}
						onChange={(checked) => setExperimentEnabled(id, checked)}
					/>
					{enabled && (
						<div className="pl-6 border-l-2 border-vscode-focusBorder/50 ml-1">
							<FastApplySettings
								setCachedStateField={setCachedStateField}
								morphApiKey={morphApiKey}
								fastApplyModel={fastApplyModel}
								fastApplyApiProvider={fastApplyApiProvider}
							/>
						</div>
					)}
				</div>
			)
		}

		// Image Generation Special Handling
		if (
			key === "IMAGE_GENERATION" &&
			setImageGenerationProvider &&
			setOpenRouterImageApiKey &&
			setKiloCodeImageApiKey &&
			setImageGenerationSelectedModel
		) {
			// ImageGenerationSettings handles its own checkbox but we need to style it to match
			// We can wrap it or modify the component. For now, we wrap it to ensure spacing consistency
			return (
				<div key={key} className="flex flex-col gap-2" data-setting-id="exp-image-gen">
					<ImageGenerationSettings
						enabled={enabled}
						onChange={(checked) => setExperimentEnabled(id, checked)}
						imageGenerationProvider={imageGenerationProvider}
						openRouterImageApiKey={openRouterImageApiKey}
						kiloCodeImageApiKey={kiloCodeImageApiKey}
						openRouterImageGenerationSelectedModel={openRouterImageGenerationSelectedModel}
						setImageGenerationProvider={setImageGenerationProvider}
						setOpenRouterImageApiKey={setOpenRouterImageApiKey}
						setKiloCodeImageApiKey={setKiloCodeImageApiKey}
						setImageGenerationSelectedModel={setImageGenerationSelectedModel}
						currentProfileKilocodeToken={currentProfileKilocodeToken}
					/>
				</div>
			)
		}

		return (
			<div data-setting-id={
				key === "MULTI_FILE_APPLY_DIFF" ? "exp-multi-file" :
					key === "SPEECH_TO_TEXT" ? "exp-stt" :
						key === "POWER_STEERING" ? "exp-power-steering" : undefined
			}>
				<ExperimentalFeature
					key={key}
					experimentKey={key}
					enabled={enabled}
					onChange={(checked) => setExperimentEnabled(id, checked)}
				/>
			</div>
		)
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>


			<Section className="flex flex-col gap-6">
				{/* Modifications & Edits Card */}
				{groups.modifications.length > 0 && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<FileCode2 className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								Modifications & Edits
							</span>
						</div>
						<div className="flex flex-col gap-4">
							{groups.modifications.map(renderExperiment)}
						</div>
					</div>
				)}

				{/* Generative Capabilities Card */}
				{groups.generative.length > 0 && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<Images className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								Generative Capabilities
							</span>
						</div>
						<div className="flex flex-col gap-4">
							{groups.generative.map((config) => {
								const key = config[0]
								const id = EXPERIMENT_IDS[key as keyof typeof EXPERIMENT_IDS]
								const enabled = experiments[id] ?? false

								if (key === "SPEECH_TO_TEXT") {
									return (
										<div key={key} className="flex flex-col gap-2" data-setting-id="exp-stt">
											<SpeechToTextSettings
												enabled={enabled}
												onChange={(checked: boolean) => setExperimentEnabled(id, checked)}
												sttProvider={apiConfiguration?.sttProvider}
												setSttProvider={(provider: "openai" | "gemini" | "local") => setApiConfigurationField("sttProvider", provider)}
												sttModelId={apiConfiguration?.sttModelId}
												setSttModelId={(modelId: string) => setApiConfigurationField("sttModelId", modelId)}
											/>
										</div>
									)
								}
								return renderExperiment(config)
							})}
						</div>
					</div>
				)}

				{/* Agent Behavior Card */}
				{groups.behavior.length > 0 && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<Brain className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								Agent Behavior
							</span>
						</div>
						<div className="flex flex-col gap-4">
							{groups.behavior.map(renderExperiment)}
						</div>
					</div>
				)}

				{/* Other Experiments Card */}
				{groups.other.length > 0 && (
					<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
						<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
							<Zap className="size-3.5 text-vscode-foreground" />
							<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
								Other Experiments
							</span>
						</div>
						<div className="flex flex-col gap-4">
							{groups.other.map(renderExperiment)}
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
