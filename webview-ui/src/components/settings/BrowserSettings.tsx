import { VSCodeCheckbox, VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { SquareMousePointer } from "lucide-react"
import { HTMLAttributes, useEffect, useMemo, useState } from "react"
import { Trans } from "react-i18next"

import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	Button,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"

import { Section } from "./Section"

import { SetCachedStateField } from "./types"
import { useRegisterSetting } from "./useSettingsSearch"

type BrowserSettingsProps = HTMLAttributes<HTMLDivElement> & {
	browserToolEnabled?: boolean
	browserViewportSize?: string
	screenshotQuality?: number
	remoteBrowserHost?: string
	remoteBrowserEnabled?: boolean
	disableBrowserHeadless?: boolean // kilocode_change
	setCachedStateField: SetCachedStateField<
		| "browserToolEnabled"
		| "browserViewportSize"
		| "screenshotQuality"
		| "remoteBrowserHost"
		| "remoteBrowserEnabled"
		| "disableBrowserHeadless" // kilocode_change
	>
}

export const BrowserSettings = ({
	browserToolEnabled,
	browserViewportSize,
	screenshotQuality,
	remoteBrowserHost,
	remoteBrowserEnabled,
	disableBrowserHeadless, // kilocode_change
	setCachedStateField,
	...props
}: BrowserSettingsProps) => {
	const { t } = useAppTranslation()

	// Register settings for search
	useRegisterSetting({ settingId: "browser-enable", section: "browser", label: t("settings:browser.enable.label") })
	useRegisterSetting({ settingId: "browser-viewport", section: "browser", label: t("settings:browser.viewport.label") })
	useRegisterSetting({ settingId: "browser-quality", section: "browser", label: t("settings:browser.screenshotQuality.label") })
	useRegisterSetting({ settingId: "browser-remote", section: "browser", label: t("settings:browser.remote.label") })
	useRegisterSetting({ settingId: "browser-remote-url", section: "browser", label: t("settings:browser.remote.urlPlaceholder") })
	useRegisterSetting({ settingId: "browser-headless", section: "browser", label: t("settings:browser.headless.label") }) // kilocode_change

	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null)
	const [discovering, setDiscovering] = useState(false)

	// We don't need a local state for useRemoteBrowser since we're using the
	// `enableRemoteBrowser` prop directly. This ensures the checkbox always
	// reflects the current global state.

	// Set up message listener for browser connection results.
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "browserConnectionResult") {
				setTestResult({ success: message.success, text: message.text })
				setTestingConnection(false)
				setDiscovering(false)
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const testConnection = async () => {
		setTestingConnection(true)
		setTestResult(null)

		try {
			// Send a message to the extension to test the connection.
			vscode.postMessage({ type: "testBrowserConnection", text: remoteBrowserHost })
		} catch (error) {
			setTestResult({
				success: false,
				text: `Error: ${error instanceof Error ? error.message : String(error)}`,
			})
			setTestingConnection(false)
		}
	}

	const options = useMemo(
		() => [
			{
				value: "1280x800",
				label: t("settings:browser.viewport.options.largeDesktop"),
			},
			{
				value: "900x600",
				label: t("settings:browser.viewport.options.smallDesktop"),
			},
			{ value: "768x1024", label: t("settings:browser.viewport.options.tablet") },
			{ value: "360x640", label: t("settings:browser.viewport.options.mobile") },
		],
		[t],
	)

	return (
		<div {...props}>


			<Section className="flex flex-col gap-6">
				{/* Browser Tool Configuration Card */}
				<div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
					<div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
						<SquareMousePointer className="size-3.5 text-vscode-foreground" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
							Browser Tool Configuration
						</span>
					</div>

					<div className="flex flex-col gap-4">
						<div data-setting-id="browser-enable">
							<VSCodeCheckbox
								checked={browserToolEnabled}
								onChange={(e: any) => setCachedStateField("browserToolEnabled", e.target.checked)}>
								<span className="font-medium text-[13px]">{t("settings:browser.enable.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
								<Trans i18nKey="settings:browser.enable.description">
									<VSCodeLink
										href={buildDocLink("features/browser-use", "settings_browser_tool")}
										style={{ display: "inline" }}>
										{" "}
									</VSCodeLink>
								</Trans>
							</div>
						</div>

						{/* kilocode_change start */}
						<div data-setting-id="browser-headless">
							<VSCodeCheckbox
								checked={disableBrowserHeadless ?? false}
								onChange={(e: any) => setCachedStateField("disableBrowserHeadless", e.target.checked)}>
								<span className="font-medium text-[13px]">{t("settings:browser.headless.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
								{t("settings:browser.headless.description")}
							</div>
						</div>
						{/* kilocode_change end */}

						{browserToolEnabled && (
							<div className="flex flex-col gap-5 pl-4 border-l-2 border-vscode-focusBorder/50 ml-1">
								<div data-setting-id="browser-viewport">
									<label className="block text-[13px] font-medium mb-2">{t("settings:browser.viewport.label")}</label>
									<Select
										value={browserViewportSize}
										onValueChange={(value) => setCachedStateField("browserViewportSize", value)}>
										<SelectTrigger className="w-full text-[13px]">
											<SelectValue placeholder={t("settings:common.select")} />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{options.map(({ value, label }) => (
													<SelectItem key={value} value={value} className="text-[13px]">
														{label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
									<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80">
										{t("settings:browser.viewport.description")}
									</div>
								</div>

								<div data-setting-id="browser-quality">
									<label className="block text-[13px] font-medium mb-2">
										{t("settings:browser.screenshotQuality.label")}
									</label>
									<div className="flex items-center gap-4">
										<Slider
											min={1}
											max={100}
											step={1}
											value={[screenshotQuality ?? 75]}
											onValueChange={([value]) => setCachedStateField("screenshotQuality", value)}
											className="flex-1"
										/>
										<span className="w-12 text-center text-xs font-mono bg-vscode-input-background rounded border border-vscode-input-border px-1 py-0.5">
											{screenshotQuality ?? 75}%
										</span>
									</div>
									<div className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80">
										{t("settings:browser.screenshotQuality.description")}
									</div>
								</div>

								<div data-setting-id="browser-remote">
									<VSCodeCheckbox
										checked={remoteBrowserEnabled}
										onChange={(e: any) => {
											setCachedStateField("remoteBrowserEnabled", e.target.checked)
											if (!e.target.checked) {
												setCachedStateField("remoteBrowserHost", undefined)
											}
										}}>
										<span className="font-medium text-[13px]">{t("settings:browser.remote.label")}</span>
									</VSCodeCheckbox>
									<div className="text-vscode-descriptionForeground text-[11px] mt-1 pl-7 opacity-80 leading-relaxed">
										{t("settings:browser.remote.description")}
									</div>
								</div>

								{remoteBrowserEnabled && (
									<div className="flex flex-col gap-3 pl-7" data-setting-id="browser-remote-url">
										<div className="flex items-center gap-2">
											<VSCodeTextField
												value={remoteBrowserHost ?? ""}
												onInput={(e: any) =>
													setCachedStateField("remoteBrowserHost", e.target.value || undefined)
												}
												placeholder={t("settings:browser.remote.urlPlaceholder")}
												className="flex-1"
											/>
											<Button disabled={testingConnection} onClick={testConnection} size="sm" className="h-7 text-xs">
												{testingConnection || discovering
													? t("settings:browser.remote.testingButton")
													: t("settings:browser.remote.testButton")}
											</Button>
										</div>
										{testResult && (
											<div
												className={`p-2 rounded-lg text-xs font-medium ${testResult.success
													? "bg-green-500/10 text-green-500 border border-green-500/20"
													: "bg-red-500/10 text-red-500 border border-red-500/20"
													}`}>
												{testResult.text}
											</div>
										)}
										<div className="text-vscode-descriptionForeground text-[11px] opacity-80 leading-relaxed">
											{t("settings:browser.remote.instructions")}
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}
