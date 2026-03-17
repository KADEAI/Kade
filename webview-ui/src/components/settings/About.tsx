import {
	HTMLAttributes,
	useState, // kilocode_change
} from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Info, Download, Upload, TriangleAlert } from "lucide-react"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { TelemetrySetting } from "@roo-code/types"

import { Package } from "@roo/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"


import { Section } from "./Section"
import { useRegisterSetting } from "./useSettingsSearch"
import { getMemoryPercentage } from "@/kilocode/helpers"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
}

export const About = ({ telemetrySetting, setTelemetrySetting, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()

	// Register settings for search
	useRegisterSetting({ settingId: "about-telemetry", section: "about", label: t("settings:footer.telemetry.label") })
	useRegisterSetting({ settingId: "about-export", section: "about", label: t("settings:footer.settings.export") })
	useRegisterSetting({ settingId: "about-import", section: "about", label: t("settings:footer.settings.import") })
	useRegisterSetting({ settingId: "about-reset", section: "about", label: t("settings:footer.settings.reset") })

	const [kiloCodeBloat, setKiloCodeBloat] = useState<number[][]>([])

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>

			<Section className="flex flex-col gap-6">
				{/* About Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-6 shadow-xl" data-setting-id="about-telemetry">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<Info className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							About
						</span>
					</div>

					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-1.5">
							<p className="text-vscode-descriptionForeground text-[11px] font-bold uppercase tracking-tight opacity-70">
								{Package.sha
									? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
									: `Version: ${Package.version}`}
							</p>
						</div>

						<div className="flex flex-col gap-1.5">
							<VSCodeCheckbox
								checked={telemetrySetting !== "disabled"}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									setTelemetrySetting(checked ? "enabled" : "disabled")
								}}>
								<span className="font-medium text-[13px]">{t("settings:footer.telemetry.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
								<Trans
									i18nKey="settings:footer.telemetry.description"
									components={{
										privacyLink: <VSCodeLink href="https://kilo.ai/privacy" className="text-vscode-textLink-foreground" />,
									}}
								/>
							</div>
						</div>

						<div className="text-[13px] leading-relaxed opacity-90">
							<Trans
								i18nKey="settings:footer.support"
								components={{
									emailLink: <VSCodeLink href="mailto:support@kadei.org" className="text-vscode-textLink-foreground" />,
									websiteLink: <VSCodeLink href="https://kadei.org" className="text-vscode-textLink-foreground" />,
								}}
							/>
						</div>

						<div className="flex flex-wrap items-center gap-3 mt-2 border-t border-vscode-input-border/30 pt-4">
							<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="flex-1 min-w-[100px] h-9 text-[12px]">
								<Upload size={14} className="mr-2" />
								{t("settings:footer.settings.export")}
							</Button>
							<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="flex-1 min-w-[100px] h-9 text-[12px]">
								<Download size={14} className="mr-2" />
								{t("settings:footer.settings.import")}
							</Button>
							<Button
								variant="destructive"
								onClick={() => vscode.postMessage({ type: "resetState" })}
								className="flex-1 min-w-[100px] h-9 text-[12px]">
								<TriangleAlert size={14} className="mr-2" />
								{t("settings:footer.settings.reset")}
							</Button>
						</div>

						{process.env.NODE_ENV === "development" && (
							<div className="flex flex-wrap items-center gap-2 mt-2 pt-4 border-t border-vscode-input-border/10">
								<Button
									variant="secondary"
									onClick={() => {
										setKiloCodeBloat([...kiloCodeBloat, new Array<number>(20_000_000).fill(0)])
										console.debug(`Memory percentage: ${getMemoryPercentage()}`)
									}}
									className="w-full text-[11px] h-8 opacity-50 hover:opacity-100">
									Development: Allocate memory
								</Button>
							</div>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}
