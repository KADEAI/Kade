import { DEFAULT_CONSECUTIVE_MISTAKE_LIMIT } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider, StandardTooltip } from "@/components/ui"
import { Info } from "lucide-react"

interface ConsecutiveMistakeLimitControlProps {
	value: number
	onChange: (value: number) => void
}

export const ConsecutiveMistakeLimitControl = ({ value, onChange }: ConsecutiveMistakeLimitControlProps) => {
	const { t } = useAppTranslation()

	const currentLimit = value ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
	const description = value === 0
		? t("settings:providers.consecutiveMistakeLimit.unlimitedDescription")
		: t("settings:providers.consecutiveMistakeLimit.description", {
			value: currentLimit,
		})

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between mb-2">
				<label className="block text-sm font-medium">{t("settings:providers.consecutiveMistakeLimit.label")}</label>
				<StandardTooltip content={description}>
					<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>
			<div className="flex items-center gap-2">
				<Slider
					value={[currentLimit]}
					min={0}
					max={10}
					step={1}
					onValueChange={(newValue) => onChange(Math.max(0, newValue[0]))}
					className="flex-1"
				/>
				<span className="text-[10px] font-mono min-w-[30px]">{Math.max(0, currentLimit)}</span>
			</div>
			{value === 0 && (
				<div className="text-[10px] text-vscode-errorForeground mt-1 italic opacity-80">
					{t("settings:providers.consecutiveMistakeLimit.warning")}
				</div>
			)}
		</div>
	)
}
