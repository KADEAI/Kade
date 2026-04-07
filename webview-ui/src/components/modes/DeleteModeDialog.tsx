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
import { ShimmerText } from "../ui/shimmer-text";
import { Trash2, X, AlertTriangle, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeleteModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modeToDelete: {
    slug: string;
    name: string;
    source?: string;
    rulesFolderPath?: string;
  } | null;
  onConfirm: () => void;
}

export const DeleteModeDialog: React.FC<DeleteModeDialogProps> = ({
  open,
  onOpenChange,
  modeToDelete,
  onConfirm,
}) => {
  const { t } = useAppTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onEscapeKeyDown={() => onOpenChange(false)}
        className="bg-[#1e1e1e] border-white/5 p-6 max-w-[300px] rounded-[1.5rem] shadow-none ring-1 ring-white/10"
      >
        <div className="space-y-6">
          <AlertDialogHeader className="space-y-2 text-center">
            <AlertDialogTitle className="text-lg font-semibold text-vscode-foreground text-center">
              {t("prompts:deleteMode.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-vscode-descriptionForeground text-xs leading-relaxed text-center px-1">
              {modeToDelete && (
                <div className="space-y-3">
                  <p>
                    {t("prompts:deleteMode.message", {
                      modeName: modeToDelete.name,
                    })}
                  </p>
                  {modeToDelete.rulesFolderPath && (
                    <div className="flex items-start justify-center gap-2 p-2 rounded-xl bg-white/5 border border-white/5 text-[10px] font-mono break-all italic opacity-60">
                      <FolderOpen size={10} className="mt-0.5 shrink-0" />
                      <span>
                        {t("prompts:deleteMode.rulesFolder", {
                          folderPath: modeToDelete.rulesFolderPath,
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="flex flex-col gap-2">
            <AlertDialogAction
              onClick={onConfirm}
              className="w-full h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all border-none"
            >
              {t("prompts:deleteMode.confirm")}
            </AlertDialogAction>
            <AlertDialogCancel className="w-full h-9 rounded-xl bg-transparent hover:bg-white/5 text-vscode-descriptionForeground text-xs border-none transition-all">
              {t("prompts:deleteMode.cancel")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
