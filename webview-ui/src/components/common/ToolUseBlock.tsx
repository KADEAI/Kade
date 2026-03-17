import { cn } from "@/lib/utils";

export const ToolUseBlock = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "overflow-hidden rounded-lg p-3 cursor-pointer transition-[background-color,border-color] duration-150",
      "bg-vscode-editor-background border border-vscode-editorGroup-border",
      "shadow-none backdrop-blur-0",
      "hover:bg-vscode-editor-background hover:border-vscode-focusBorder/40 hover:shadow-none",
      className,
    )}
    {...props}
  />
);

export const ToolUseBlockHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex min-h-5 font-sans items-center select-none text-[11px] font-semibold uppercase tracking-[0.08em] text-vscode-descriptionForeground/85",
      className,
    )}
    {...props}
  />
);
