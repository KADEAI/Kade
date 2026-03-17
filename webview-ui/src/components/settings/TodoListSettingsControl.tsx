import React, { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Info } from "lucide-react"
import { StandardTooltip } from "../ui"

interface TodoListSettingsControlProps {
	todoListEnabled?: boolean
	onChange: (field: "todoListEnabled", value: any) => void
}

export const TodoListSettingsControl: React.FC<TodoListSettingsControlProps> = ({
	todoListEnabled = true,
	onChange,
}) => {
	const { t } = useAppTranslation()

	const handleTodoListEnabledChange = useCallback(
		(e: any) => {
			onChange("todoListEnabled", e.target.checked)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between">
				<VSCodeCheckbox checked={todoListEnabled} onChange={handleTodoListEnabledChange}>
					<span className="font-medium text-sm">{t("settings:advanced.todoList.label")}</span>
				</VSCodeCheckbox>
				<StandardTooltip content={t("settings:advanced.todoList.description")}>
					<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>
		</div>
	)
}
