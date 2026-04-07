import React from "react";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@src/components/ui";
import { ShimmerText } from "@src/components/ui/shimmer-text";
import {
  History as HistoryIcon,
  RotateCcw,
  Edit3,
  Trash2,
  Undo2,
  X,
  AlertTriangle,
  FilePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckpointRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (restoreCheckpoint: boolean) => void;
  type: "edit" | "delete";
  hasCheckpoint: boolean;
  fileChanges?: any[];
}

export const CheckpointRestoreDialog: React.FC<
  CheckpointRestoreDialogProps
> = ({
  open,
  onOpenChange,
  onConfirm,
  type,
  hasCheckpoint,
  fileChanges = [],
}) => {
  const { t } = useAppTranslation();

  const isEdit = type === "edit";
  const title = isEdit
    ? t("common:confirmation.editMessage")
    : "Unsend Message";
  const description = isEdit
    ? t("common:confirmation.editQuestionWithCheckpoint")
    : "Unsending this message will remove it and all subsequent messages in the conversation. Do you want to proceed?";

  const handleConfirmWithRestore = () => {
    onConfirm(true);
    onOpenChange(false);
  };

  const handleConfirmWithoutRestore = () => {
    onConfirm(false);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-[#1e1e1e] border-white/5 p-0 max-w-[320px] rounded-[1.25rem] overflow-hidden shadow-2xl ring-1 ring-white/10">
        <div className="flex flex-col max-h-[85vh]">
          {/* Header with Icon */}
          <div className="p-4 pb-2 text-center space-y-2.5">
            <div
              className={cn(
                "mx-auto w-9 h-9 rounded-xl flex items-center justify-center border",
                isEdit
                  ? "bg-blue-500/10 border-blue-500/20"
                  : "bg-red-500/10 border-red-500/20",
              )}
            >
              {isEdit ? (
                <RotateCcw className="text-blue-400" size={18} />
              ) : (
                <Undo2 className="text-red-400" size={18} />
              )}
            </div>
            <div className="space-y-1">
              <AlertDialogTitle className="text-base font-semibold text-vscode-foreground tracking-tight">
                {title}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-vscode-descriptionForeground text-[11px] leading-relaxed px-1">
                {description}
              </AlertDialogDescription>
            </div>
          </div>

          {/* File Changes Section */}
          {fileChanges.length > 0 && (
            <div className="px-4 pb-4">
              <div className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                <div className="px-2.5 py-1.5 border-b border-white/5 bg-white/5 flex items-center gap-2">
                  <HistoryIcon
                    size={10}
                    className="text-vscode-descriptionForeground"
                  />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-vscode-descriptionForeground opacity-80">
                    {t("common:confirmation.revertFileChanges") ||
                      "Changes to Revert"}
                  </span>
                  <span className="ml-auto text-[9px] font-medium px-1.5 py-0 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {fileChanges.length}
                  </span>
                </div>
                <div className="max-h-[120px] overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                  {fileChanges.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors group"
                    >
                      <div className="shrink-0 flex items-center justify-center">
                        {file.type === "create" ? (
                          <FilePlus size={12} className="text-green-400/70" />
                        ) : file.type === "delete" ? (
                          <Trash2 size={12} className="text-red-400/70" />
                        ) : (
                          <Edit3 size={12} className="text-blue-400/70" />
                        )}
                      </div>
                      <span className="text-[11px] text-vscode-foreground/80 truncate flex-1 font-mono">
                        {file.path.split(/[/\\]/).pop()}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        {file.additions > 0 && (
                          <span className="text-[10px] font-bold text-green-400/90">
                            +{file.additions}
                          </span>
                        )}
                        {file.deletions > 0 && (
                          <span className="text-[10px] font-bold text-red-400/90">
                            -{file.deletions}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer with Actions */}
          <AlertDialogFooter className="p-5 pt-2 flex flex-col gap-1.5">
            {hasCheckpoint && (
              <AlertDialogAction
                onClick={handleConfirmWithRestore}
                className="w-full h-9 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-all border-none flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
              >
                <RotateCcw size={12} />
                {t("common:confirmation.restoreToCheckpoint")}
              </AlertDialogAction>
            )}
            <div className="flex flex-row gap-1.5 w-full">
              <AlertDialogCancel className="flex-1 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-vscode-descriptionForeground text-[11px] border-none transition-all mt-0">
                {t("common:answers.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmWithoutRestore}
                className={cn(
                  "flex-1 h-9 rounded-xl text-[11px] font-semibold transition-all border-none bg-white/[0.03] hover:bg-white/[0.08] backdrop-blur-sm",
                  isEdit ? "text-blue-400" : "text-red-400",
                )}
              >
                {isEdit ? t("common:confirmation.editOnly") : "Unsend Only"}
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// Export convenience components for backward compatibility
export const EditMessageWithCheckpointDialog: React.FC<
  Omit<CheckpointRestoreDialogProps, "type">
> = (props) => <CheckpointRestoreDialog {...props} type="edit" />;

export const DeleteMessageWithCheckpointDialog: React.FC<
  Omit<CheckpointRestoreDialogProps, "type">
> = (props) => <CheckpointRestoreDialog {...props} type="delete" />;
