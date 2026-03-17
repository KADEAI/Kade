import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Globe } from "lucide-react"

import type { Language } from "@roo-code/types"

import { LANGUAGES } from "@roo/language"

import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SetCachedStateField } from "./types"

import { Section } from "./Section"
import { useRegisterSetting } from "./useSettingsSearch"

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement> & {
	language: string
	setCachedStateField: SetCachedStateField<"language">
}

// kade_change start: sort languages
function getSortedLanguages() {
	return Object.entries(LANGUAGES).toSorted((a, b) => a[0].localeCompare(b[0]))
}
// kade_change end

export const LanguageSettings = ({ language, setCachedStateField, className, ...props }: LanguageSettingsProps) => {
	const { t } = useAppTranslation()

	// Register settings for search
	useRegisterSetting({ settingId: "language-select", section: "language", label: t("settings:sections.language") })

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>


			<Section className="flex flex-col gap-6">
				{/* Language Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl" data-setting-id="language-select">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Globe className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							Language
						</span>
					</div>

					<div className="flex flex-col gap-2">
						<Select value={language} onValueChange={(value) => setCachedStateField("language", value as Language)}>
							<SelectTrigger className="w-full text-[13px]">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{/* kade_change: sort languages */}
									{getSortedLanguages().map(([code, name]) => (
										<SelectItem key={code} value={code} className="text-[13px]">
											{name}
											<span className="text-vscode-descriptionForeground/60 ml-2">({code})</span>
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>
				</div>
			</Section>
		</div>
	)
}
