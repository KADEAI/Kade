import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionProps = HTMLAttributes<HTMLDivElement>

export const Section = ({ className, ...props }: SectionProps) => (
	<div
		className={cn(
			"flex flex-col gap-4 p-5 rounded-xl border border-white/[0.04] bg-[#282828] shadow-[0_8px_32px_rgba(0,0,0,0.4)] font-sans",
			className
		)}
		{...props}
	/>
)
