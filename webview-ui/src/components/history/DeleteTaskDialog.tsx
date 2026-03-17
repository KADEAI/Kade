import { useCallback, useEffect } from "react"
import { useKeyPress } from "react-use"
import { AlertDialogProps } from "@radix-ui/react-alert-dialog"

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { useTaskWithId } from "@/kilocode/hooks/useTaskHistory"
import { ShimmerText } from "@/components/ui/shimmer-text"
import { Trash2, X, AlertTriangle, Star } from "lucide-react"
import { cn } from "@/lib/utils"

interface DeleteTaskDialogProps extends AlertDialogProps {
	taskId: string
}

export const DeleteTaskDialog = ({ taskId, ...props }: DeleteTaskDialogProps) => {
	const { t } = useAppTranslation()
	const [isEnterPressed] = useKeyPress("Enter")
	const { data: tasks } = useTaskWithId([taskId])

	const { onOpenChange } = props

	const task = tasks?.find((t) => t.id === taskId)
	const isFavorited = task?.isFavorited

	const onDelete = useCallback(() => {
		if (taskId) {
			vscode.postMessage({ type: "deleteTaskWithId", text: taskId })
			onOpenChange?.(false)
		}
	}, [taskId, onOpenChange])

	useEffect(() => {
		if (taskId && isEnterPressed) {
			onDelete()
		}
	}, [taskId, isEnterPressed, onDelete])

	return (
		<AlertDialog {...props}>
			<AlertDialogContent onEscapeKeyDown={() => onOpenChange?.(false)} className="bg-[#1e1e1e] border-white/5 p-6 max-w-[300px] rounded-[1.5rem] shadow-none ring-1 ring-white/10">
				<div className="space-y-6">
					<AlertDialogHeader className="space-y-2 text-center">
						<AlertDialogTitle className="text-lg font-semibold text-vscode-foreground">
							{t("history:deleteTask")}
						</AlertDialogTitle>
						<AlertDialogDescription className="text-vscode-descriptionForeground text-xs leading-relaxed">
							{isFavorited ? (
								<div className="flex items-center justify-center gap-2 p-2 rounded-xl bg-yellow-500/5 text-yellow-500/80 text-[10px] mb-2 italic">
									<Star size={10} className="shrink-0 fill-current" />
									{t("history:deleteTaskFavoritedWarning")}
								</div>
							) : null}
							{t("history:deleteTaskMessage")}
						</AlertDialogDescription>
					</AlertDialogHeader>

					<AlertDialogFooter className="flex flex-col gap-2">
						<AlertDialogAction
							onClick={onDelete}
							className="w-full h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all border-none">
							{t("history:delete")}
						</AlertDialogAction>
						<AlertDialogCancel className="w-full h-9 rounded-xl bg-transparent hover:bg-white/5 text-vscode-descriptionForeground text-xs border-none transition-all">
							{t("history:cancel")}
						</AlertDialogCancel>
					</AlertDialogFooter>
				</div>
			</AlertDialogContent>
		</AlertDialog>
	)
}
