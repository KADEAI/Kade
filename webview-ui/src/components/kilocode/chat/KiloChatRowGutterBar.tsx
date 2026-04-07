import { useExtensionState } from "@/context/ExtensionStateContext";
import { cn } from "@/lib/utils";
import { getTaskTimelineMessageColor } from "@/utils/messageColors";
import type { ClineMessage } from "@roo-code/types";

export function KiloChatRowGutterBar({ message }: { message: ClineMessage }) {
  const { hoveringTaskTimeline } = useExtensionState();

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-[1px] top-[4px] bottom-[4px] w-[3px] rounded-full opacity-0 transition-all",
        getTaskTimelineMessageColor(message),
        hoveringTaskTimeline && "opacity-55 scale-x-105",
      )}
    />
  );
}
