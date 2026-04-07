import { memo } from "react";
import type { HistoryItem } from "@roo-code/types";

import { vscode } from "@/utils/vscode";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

import TaskItemFooter from "./TaskItemFooter";

interface DisplayHistoryItem extends HistoryItem {
  highlight?: string;
  title?: string;
}

interface TaskItemProps {
  item: DisplayHistoryItem;
  variant: "compact" | "full";
  showWorkspace?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (taskId: string, isSelected: boolean) => void;
  onDelete?: (taskId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

const TaskItem = ({
  item,
  variant,
  showWorkspace = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onDelete,
  className,
  style,
}: TaskItemProps) => {
  const handleClick = () => {
    if (isSelectionMode && onToggleSelection) {
      onToggleSelection(item.id, !isSelected);
    } else {
      vscode.postMessage({ type: "showTaskWithId", text: item.id });
    }
  };

  const isCompact = variant === "compact";

  return (
    <div
      key={item.id}
      data-testid={`task-item-${item.id}`}
      className={cn(
        "group relative flex flex-col gap-3 p-4 rounded-xl border border-white/5 bg-vscode-editor-background/40 hover:bg-vscode-editor-background/60 transition-all duration-300 cursor-pointer overflow-hidden",
        "hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:-translate-y-1",
        "before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent before:translate-x-[-200%] hover:before:animate-[shimmer_1.5s_infinite]",
        {
          "ring-1 ring-red-500/50 bg-red-500/5": item.fileNotfound,
          "ring-1 ring-vscode-focusBorder bg-vscode-list-activeSelectionBackground/10":
            isSelected,
        },
        className,
      )}
      style={style}
      onClick={handleClick}
    >
      {/* Decorative accent gradient line on left */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-vscode-textLink-foreground/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="flex gap-4 items-start relative z-10">
        {/* Selection checkbox */}
        {!isCompact && isSelectionMode && (
          <div
            className="pt-1.5 pl-1"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) =>
                onToggleSelection?.(item.id, checked === true)
              }
              className="data-[state=checked]:bg-vscode-focusBorder data-[state=checked]:border-vscode-focusBorder"
            />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Header Row: Workspace & Icons */}
          <div className="flex justify-between items-start gap-2">
            <div
              className={cn(
                "text-base font-semibold text-vscode-foreground leading-snug line-clamp-2 transition-colors group-hover:text-vscode-textLink-foreground",
                !isCompact && isSelectionMode ? "mb-0" : "",
              )}
              data-testid="task-content"
              {...(item.highlight
                ? { dangerouslySetInnerHTML: { __html: item.highlight } }
                : {})}
            >
              {item.highlight ? undefined : item.title || item.task}
            </div>
          </div>

          {/* Metadata Footer */}
          <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
            <TaskItemFooter
              item={item}
              variant={variant}
              isSelectionMode={isSelectionMode}
              onDelete={onDelete}
            />

            {showWorkspace && item.workspace && (
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-vscode-descriptionForeground/70 px-2 py-0.5 bg-vscode-textCodeBlock-background/50 rounded-full border border-white/5 group-hover:border-white/10 transition-colors">
                <span className="codicon codicon-folder scale-75" />
                <span className="truncate max-w-[150px]">{item.workspace}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(TaskItem);
