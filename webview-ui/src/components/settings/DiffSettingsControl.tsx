import React, { useCallback } from "react"
import { Slider, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Info } from "lucide-react"

interface DiffSettingsControlProps {
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	onChange: (field: "diffEnabled" | "fuzzyMatchThreshold", value: any) => void
}

export const DiffSettingsControl: React.FC<DiffSettingsControlProps> = ({
	diffEnabled = true,
	fuzzyMatchThreshold = 1.0,
	onChange,
}) => {
	const { t } = useAppTranslation()

	const handleDiffEnabledChange = useCallback(
		(e: any) => {
			onChange("diffEnabled", e.target.checked)
		},
		[onChange],
	)

	const handleThresholdChange = useCallback(
		(newValue: number[]) => {
			onChange("fuzzyMatchThreshold", newValue[0])
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between">
				<VSCodeCheckbox checked={diffEnabled} onChange={handleDiffEnabledChange}>
					<span className="font-medium text-sm">{t("settings:advanced.diff.label")}</span>
				</VSCodeCheckbox>
				<StandardTooltip content={t("settings:advanced.diff.description")}>
					<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>

			{diffEnabled && (
				<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
					<div>
						<div className="flex items-center justify-between mb-2">
							<label className="block text-xs font-medium">
								{t("settings:advanced.diff.matchPrecision.label")}
							</label>
							<StandardTooltip content={t("settings:advanced.diff.matchPrecision.description")}>
								<Info className="size-3 text-vscode-descriptionForeground cursor-help" />
							</StandardTooltip>
						</div>
						<div className="flex items-center gap-2">
							<Slider
								min={0.8}
								max={1}
								step={0.005}
								value={[fuzzyMatchThreshold]}
								onValueChange={handleThresholdChange}
								className="flex-1"
							/>
							<span className="text-[10px] font-mono min-w-[30px]">{Math.round(fuzzyMatchThreshold * 100)}%</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
