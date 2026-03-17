import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider, StandardTooltip } from "@/components/ui"
import { Info } from "lucide-react"

interface RateLimitSecondsControlProps {
	value: number
	onChange: (value: number) => void
}

export const RateLimitSecondsControl = ({ value, onChange }: RateLimitSecondsControlProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between mb-2">
				<label className="block text-sm font-medium">{t("settings:providers.rateLimitSeconds.label")}</label>
				<StandardTooltip content={t("settings:providers.rateLimitSeconds.description", { value })}>
					<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>
			<div className="flex items-center gap-2">
				<Slider
					value={[value]}
					min={0}
					max={60}
					step={1}
					onValueChange={(newValue) => onChange(newValue[0])}
					className="flex-1"
				/>
				<span className="text-[10px] font-mono min-w-[30px]">{value}s</span>
			</div>
		</div>
	)
}
