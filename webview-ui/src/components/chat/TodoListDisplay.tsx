import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useState, useRef, useMemo, useEffect } from "react";

const TodoStatus = {
  Completed: "completed",
  InProgress: "in_progress",
  Pending: "pending",
} as const;

type TodoStatus = (typeof TodoStatus)[keyof typeof TodoStatus];

function getTodoIcon(status: TodoStatus | string | null) {
  switch (status) {
    case TodoStatus.Completed:
      return (
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-charts-green" />
      );
    case TodoStatus.InProgress:
      return (
        <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-charts-yellow animate-spin-slow" />
      );
    default:
      return (
        <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-vscode-descriptionForeground/60" />
      );
  }
}

export function TodoListDisplay({ todos }: { todos: any[] }) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const ulRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const scrollIndex = useMemo(() => {
    const inProgressIdx = todos.findIndex(
      (todo: any) => todo.status === "in_progress",
    );
    if (inProgressIdx !== -1) return inProgressIdx;
    return todos.findIndex((todo: any) => todo.status !== "completed");
  }, [todos]);

  useEffect(() => {
    if (isCollapsed) return;
    if (!ulRef.current) return;
    if (scrollIndex === -1) return;
    const target = itemRefs.current[scrollIndex];
    if (target && ulRef.current) {
      const ul = ulRef.current;
      const targetTop = target.offsetTop - ul.offsetTop;
      const targetHeight = target.offsetHeight;
      const ulHeight = ul.clientHeight;
      const scrollTo = targetTop - (ulHeight / 2 - targetHeight / 2);
      ul.scrollTop = scrollTo;
    }
  }, [todos, isCollapsed, scrollIndex]);

  if (!Array.isArray(todos) || todos.length === 0) return null;

  const totalCount = todos.length;
  const completedCount = todos.filter(
    (todo: any) => todo.status === "completed",
  ).length;
  const allCompleted = completedCount === totalCount && totalCount > 0;

  return (
    <div className="group/todo p-0 m-0 w-full">
      {/* Inline expanded list */}
      {!isCollapsed && (
        <div className="bg-transparent overflow-hidden p-0 m-0">
          <ul
            ref={ulRef}
            className="list-none max-h-[300px] overflow-y-auto flex flex-col p-0 m-0"
          >
            {todos.map((todo: any, idx: number) => {
              const icon = getTodoIcon(todo.status);
              const isCompleted = todo.status === "completed";
              const isInProgress = todo.status === "in_progress";

              return (
                <li
                  key={todo.id || todo.content}
                  ref={(el) => (itemRefs.current[idx] = el)}
                  className={cn(
                    "flex items-start gap-1.5 px-2 py-0 transition-all duration-300 border-l-2 border-transparent",
                    isInProgress
                      ? "border-vscode-charts-yellow/60 bg-vscode-charts-yellow/5 shadow-[inset_0_0_12px_rgba(234,179,8,0.05)]"
                      : "hover:bg-vscode-list-hoverBackground/25",
                  )}
                >
                  <div className="pt-0.5 shrink-0">{icon}</div>
                  <span
                    className={cn(
                      "leading-snug break-words text-sm transition-all duration-300",
                      isCompleted &&
                        "text-vscode-descriptionForeground/60 line-through opacity-50",
                      isInProgress &&
                        "text-vscode-charts-yellow font-semibold opacity-100 drop-shadow-[0_0_8px_rgba(234,179,8,0.2)]",
                    )}
                  >
                    {todo.content}
                  </span>
                </li>
              );
            })}
            {allCompleted && (
              <li className="px-2 py-1.5 text-[10px] text-center text-vscode-descriptionForeground/40 uppercase tracking-widest font-medium">
                All tasks completed
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
