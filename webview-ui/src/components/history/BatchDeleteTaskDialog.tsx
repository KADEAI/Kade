import { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
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
import { vscode } from "@/utils/vscode"
import { AlertDialogProps } from "@radix-ui/react-alert-dialog"
import { useTaskWithId } from "@/kilocode/hooks/useTaskHistory"
import { ShimmerText } from "@/components/ui/shimmer-text"
import { Trash2, X, AlertTriangle, Star, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface BatchDeleteTaskDialogProps extends AlertDialogProps {
	taskIds: string[]
}

export const BatchDeleteTaskDialog = ({ taskIds, ...props }: BatchDeleteTaskDialogProps) => {
	const { t } = useAppTranslation()
	const { data: tasks } = useTaskWithId(taskIds)
	const { onOpenChange } = props

	const favoritedTasks = tasks?.filter((task) => taskIds.includes(task.id) && task.isFavorited) ?? []
	const hasFavoritedTasks = favoritedTasks.length > 0

	const onDelete = useCallback(() => {
		if (taskIds.length > 0) {
			vscode.postMessage({ type: "deleteMultipleTasksWithIds", ids: taskIds })
			onOpenChange?.(false)
		}
	}, [taskIds, onOpenChange])

	return (
		<AlertDialog {...props}>
			<AlertDialogContent onEscapeKeyDown={() => onOpenChange?.(false)} className="bg-[#1e1e1e] border-white/5 p-6 max-w-[320px] rounded-[1.5rem] shadow-none ring-1 ring-white/10">
				<div className="space-y-6">
					<AlertDialogHeader className="space-y-2 text-center">
						<AlertDialogTitle className="text-lg font-semibold text-vscode-foreground">
							{t("history:deleteTasks")}
						</AlertDialogTitle>
						<AlertDialogDescription className="text-vscode-descriptionForeground text-xs leading-relaxed space-y-3 px-2 text-center">
							<div className="font-medium text-vscode-foreground">
								{t("history:confirmDeleteTasks", { count: taskIds.length })}
							</div>

							{hasFavoritedTasks && (
								<div className="flex items-center justify-center gap-2 p-2 rounded-xl bg-yellow-500/5 text-yellow-500/80 text-[10px] italic">
									<Star size={10} className="shrink-0 fill-current" />
									{t("history:deleteTasksFavoritedWarning", { count: favoritedTasks.length })}
								</div>
							)}

							<div className="text-[10px] opacity-60 italic leading-snug">
								{t("history:deleteTasksWarning")}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>

					<AlertDialogFooter className="flex flex-col gap-2">
						<AlertDialogAction
							onClick={onDelete}
							className="w-full h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all border-none flex items-center justify-center gap-2">
							<Trash2 size={14} />
							{t("history:deleteItems", { count: taskIds.length })}
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
