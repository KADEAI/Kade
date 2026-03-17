import { telemetryClient } from "@/utils/TelemetryClient"
import { vscode } from "@/utils/vscode"
import { TelemetryEventName } from "@roo-code/types"
import { useTranslation, Trans } from "react-i18next"

export const IdeaSuggestionsBox = () => {
	const { t } = useTranslation("kilocode")
	const ideas = Object.values(t("ideaSuggestionsBox.ideas", { returnObjects: true }))

	const handleClick = () => {
		const randomIndex = Math.floor(Math.random() * ideas.length)
		const randomIdea = ideas[randomIndex]

		vscode.postMessage({
			type: "insertTextToChatArea",
			text: randomIdea,
		})

		telemetryClient.capture(TelemetryEventName.SUGGESTION_BUTTON_CLICKED, {
			randomIdea,
		})
	}

	return (
		<div className="w-full">
			<div className="bg-vscode-editor-background/50 backdrop-blur-sm border border-vscode-panel-border rounded-xl p-5 transition-all hover:bg-vscode-editor-background/80 group shadow-sm">
				<div className="flex items-start gap-4">
					<div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
						<span className="codicon codicon-lightbulb !text-lg" />
					</div>
					<div className="flex-1 space-y-1.5">
						<p className="text-sm font-semibold text-vscode-foreground tracking-tight">
							{t("ideaSuggestionsBox.newHere")}
						</p>
						<p className="text-sm text-vscode-descriptionForeground leading-relaxed">
							<Trans
								i18nKey="kilocode:ideaSuggestionsBox.suggestionText"
								components={{
									suggestionButton: (
										<button
											onClick={handleClick}
											className="text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none p-0 font-medium hover:underline transition-all inline-flex items-center gap-1"
										/>
									),
									sendIcon: <span className="codicon codicon-arrow-right !text-xs opacity-70" />,
								}}
							/>
						</p>
					</div>
				</div>
			</div>
		</div>
	)
}
