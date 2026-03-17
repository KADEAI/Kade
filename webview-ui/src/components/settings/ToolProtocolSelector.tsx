import React from "react"
import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import { cn } from "@src/lib/utils"
import { Star, Zap, Code, Braces, Check, X, FileCode } from "lucide-react"

interface ProtocolOption {
	id: ToolProtocol
	name: string
	description: string
	example: string
	compatibility: string
	batchSupport: "full" | "limited" | "none"
	ratings: {
		speed: number
		accuracy: number
		errors: number
	}
	icon: React.ElementType
}

const getUnifiedRatings = () => ({
	speed: 5,
	accuracy: 5,
	errors: 5,
})

const getUnifiedExample = () => "R src/app.ts 1-50\n/R"

const protocols: ProtocolOption[] = [
	{
		id: TOOL_PROTOCOL.UNIFIED,
		name: "Aero",
		description: "The ultimate peak of performance. Our proprietary, single-letter protocol engineered for maximum token efficiency and blazing fast execution. Experience elite-tier precision with zero overhead, crafted exclusively for power users who demand the best.",
		example: "R src/app.ts 1-50\n/R",
		compatibility: "100%",
		batchSupport: "full",
		ratings: getUnifiedRatings(),
		icon: Zap,
	},
	{
		id: TOOL_PROTOCOL.MARKDOWN,
		name: "Native",
		description: "The industry standard JSON-based protocol. Highly reliable, battle-tested, and perfectly aligned with how modern LLMs are trained. Delivers a seamless, robust experience across all major providers.",
		example: '{"read": ["src/app.ts", "1-50", "src/utils.ts", "H20"]}',
		compatibility: "100%",
		batchSupport: "full",
		ratings: { speed: 5, accuracy: 5, errors: 5 },
		icon: FileCode,
	},
]

type UnifiedFormatVariant = "simple" | "structured"

interface ToolProtocolSelectorProps {
	value: ToolProtocol
	onChange: (value: ToolProtocol) => void
	unifiedFormatVariant?: UnifiedFormatVariant
	onUnifiedFormatVariantChange?: (value: UnifiedFormatVariant) => void
	disableBatchToolUse?: boolean
	onDisableBatchToolUseChange?: (value: boolean) => void
	maxToolCalls?: number
	onMaxToolCallsChange?: (value: number | undefined) => void
	minimalSystemPrompt?: boolean
	onMinimalSystemPromptChange?: (value: boolean) => void
}

const ToolProtocolSelector = ({
	value,
	onChange,
	unifiedFormatVariant = "structured",
	onUnifiedFormatVariantChange,
	disableBatchToolUse,
	onDisableBatchToolUseChange,
	maxToolCalls,
	onMaxToolCallsChange,
	minimalSystemPrompt,
	onMinimalSystemPromptChange
}: ToolProtocolSelectorProps) => {
	const renderStars = (count: number) => (
		<div className="flex gap-0.5">
			{[...Array(5)].map((_, i) => (
				<Star
					key={i}
					size={10}
					className={cn(i < count ? "fill-yellow-500 text-yellow-500" : "text-vscode-descriptionForeground/30")}
				/>
			))}
		</div>
	)

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-2 gap-2">
				{protocols.map((protocol) => {
					const isSelected = value === protocol.id
					const Icon = protocol.icon
					return (
						<button
							key={protocol.id}
							onClick={() => onChange(protocol.id)}
							className={cn(
								"flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all duration-300 text-left relative overflow-hidden group",
								isSelected
									? "bg-vscode-button-background/[0.08] border-vscode-button-background shadow-[0_8px_20px_-4px_rgba(0,0,0,0.2)]"
									: "bg-vscode-editor-background border-vscode-input-border/20 hover:border-vscode-button-background/40 hover:bg-vscode-button-background/[0.03] hover:scale-[1.02] active:scale-[0.98]",
							)}>
							<div
								className={cn(
									"p-2.5 rounded-full transition-all duration-300",
									isSelected
										? "bg-vscode-button-background text-vscode-button-foreground shadow-lg shadow-vscode-button-background/20"
										: "bg-vscode-input-background text-vscode-foreground/50 group-hover:text-vscode-foreground/80",
								)}>
								<Icon size={18} strokeWidth={isSelected ? 2.5 : 2} />
							</div>
							<span className={cn(
								"text-[10px] font-bold uppercase tracking-wider transition-colors duration-300",
								isSelected ? "text-vscode-foreground" : "text-vscode-descriptionForeground group-hover:text-vscode-foreground"
							)}>
								{protocol.name}
							</span>
							{protocol.id === TOOL_PROTOCOL.UNIFIED && (
								<div className="absolute -right-7 -top-7 bg-yellow-500/15 text-yellow-500 text-[7px] font-black px-8 py-1.5 rotate-45 border border-yellow-500/20">
									SOTA
								</div>
							)}
							{protocol.id === TOOL_PROTOCOL.MARKDOWN && (
								<div className="absolute -right-7 -top-7 bg-blue-500/15 text-blue-500 text-[7px] font-black px-8 py-1.5 rotate-45 border border-blue-500/20">
									NEW
								</div>
							)}
							{isSelected && (
								<div className="absolute top-1.5 right-1.5">
									<div className="w-1.5 h-1.5 rounded-full bg-vscode-button-background animate-pulse" />
								</div>
							)}
						</button>
					)
				})}
			</div>

			{/* Comparison Detail Card */}
			{(() => {
				let selected = protocols.find((p) => p.id === value) || protocols[0]

				// Use dynamic ratings and example for Unified protocol
				if (selected.id === TOOL_PROTOCOL.UNIFIED) {
					selected = {
						...selected,
						ratings: getUnifiedRatings(),
						example: getUnifiedExample()
					}
				}

				return (
					<div className="rounded-xl border border-vscode-input-border/30 bg-vscode-editor-background/60 p-4 flex flex-col gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
						<div className="flex flex-col gap-1">
							<p className="text-[11px] leading-relaxed text-vscode-descriptionForeground">
								{selected.description}
							</p>
						</div>

						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-2">
								<span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">Performance</span>
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-vscode-foreground/70">Compatibility</span>
										<span className={cn(
											"text-[10px] font-bold",
											selected.compatibility === "100%" ? "text-green-500" : "text-yellow-500"
										)}>
											{selected.compatibility}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-vscode-foreground/70">Speed</span>
										{renderStars(selected.ratings.speed)}
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-vscode-foreground/70">Accuracy</span>
										{renderStars(selected.ratings.accuracy)}
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-vscode-foreground/70">API Errors</span>
										{renderStars(selected.ratings.errors)}
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-vscode-foreground/70">Batch Usage</span>
										{selected.batchSupport === "full" ? (
											<Check size={12} className="text-green-500" strokeWidth={3} />
										) : selected.batchSupport === "limited" ? (
											<span className="text-[10px] text-yellow-500 font-bold uppercase tracking-tighter">Limited</span>
										) : (
											<X size={12} className="text-red-500" strokeWidth={3} />
										)}
									</div>
								</div>
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">Syntax Example</span>
								<div className="bg-vscode-input-background/50 rounded-md p-2 border border-vscode-input-border/20 h-full flex items-center">
									<code className="text-[10px] text-vscode-textLink-foreground break-all font-mono">
										{selected.example}
									</code>
								</div>
							</div>
						</div>
					</div>
				)
			})()}


			{/* Tool Usage Settings - Hidden for JSON protocol */}
			{value !== TOOL_PROTOCOL.MARKDOWN && (
				<div className="flex flex-col gap-2 mt-1">
					<span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">Tool Usage Limit</span>
					<div className="flex flex-col gap-2">
						<div className="flex gap-2">
							<button
								onClick={() => {
									onDisableBatchToolUseChange?.(true)
									onMaxToolCallsChange?.(undefined)
								}}
								className={cn(
									"flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-all duration-200",
									disableBatchToolUse
										? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
										: "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
								)}>
								No Batching
							</button>
							<button
								onClick={() => {
									onDisableBatchToolUseChange?.(false)
									onMaxToolCallsChange?.(maxToolCalls || 5)
								}}
								className={cn(
									"flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-all duration-200",
									!disableBatchToolUse && maxToolCalls !== undefined
										? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
										: "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
								)}>
								Set Limit
							</button>
							<button
								onClick={() => {
									onDisableBatchToolUseChange?.(false)
									onMaxToolCallsChange?.(undefined)
								}}
								className={cn(
									"flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-all duration-200",
									!disableBatchToolUse && maxToolCalls === undefined
										? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
										: "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
								)}>
								Unlimited
							</button>
						</div>

						{/* Custom Limit Input */}
						{!disableBatchToolUse && maxToolCalls !== undefined && (
							<div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200 bg-vscode-input-background/30 p-2 rounded-md border border-vscode-input-border/20">
								<span className="text-[11px] text-vscode-descriptionForeground whitespace-nowrap">Max calls per turn:</span>
								<input
									type="number"
									min={2}
									max={50}
									value={maxToolCalls || 5}
									onChange={(e) => {
										const val = parseInt(e.target.value)
										if (!isNaN(val) && val > 1) {
											onMaxToolCallsChange?.(val)
										}
									}}
									className="w-20 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded-sm px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder text-center font-mono"
								/>
								<span className="text-[10px] text-vscode-descriptionForeground/70 ml-auto">
									Stream interrupts after {maxToolCalls || 5} calls
								</span>
							</div>
						)}
						{!disableBatchToolUse && maxToolCalls === undefined && (
							<div className="text-[10px] text-vscode-descriptionForeground mt-1 animate-in fade-in slide-in-from-top-1 px-1">
								No limit on tool calls per turn. The model can batch as many tools as needed.
							</div>
						)}
						{disableBatchToolUse && (
							<div className="text-[10px] text-vscode-descriptionForeground mt-1 animate-in fade-in slide-in-from-top-1 px-1">
								Restricts the model to making only one tool call per turn. This can reduce errors but may slow down complex tasks.
							</div>
						)}
					</div>

					{/* Unified Format Selection Removed */}

					{/* Minimal System Prompt Toggle */}
					{/* <div className="space-y-2">
						<div className="flex items-center justify-between">
							<label className="text-xs font-medium text-vscode-foreground">Minimal System Prompt</label>
							<button
								onClick={() => onMinimalSystemPromptChange?.(!minimalSystemPrompt)}
								className={cn(
									"relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200",
									minimalSystemPrompt
										? "bg-vscode-button-background"
										: "bg-vscode-input-border/30",
								)}>
								<span
									className={cn(
										"inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200",
										minimalSystemPrompt ? "translate-x-5" : "translate-x-0.5",
									)}
								/>
							</button>
						</div>
						<div className="text-[10px] text-vscode-descriptionForeground/70 px-1">
							Experimental: Use a minimal system prompt with only essential instructions. Reduces token usage and may improve performance but reduces guidance.
						</div>
					</div> */}
				</div>
			)}
		</div >
	)
}

export default ToolProtocolSelector
