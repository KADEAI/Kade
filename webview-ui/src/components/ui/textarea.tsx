import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					"flex min-h-[60px] w-full rounded-md px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-0 focus-visible:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
					"border border-[var(--vscode-input-border,var(--vscode-input-background))]",
					"bg-vscode-input-background",
					"text-vscode-input-foreground",
					className,
				)}
				ref={ref}
				{...props}
			/>
		)
	},
)
Textarea.displayName = "Textarea"

export { Textarea }
