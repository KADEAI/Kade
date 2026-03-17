import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { McpTool } from "@roo/mcp"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { StandardTooltip, ToggleSwitch } from "@/components/ui"
import { cn } from "@/lib/utils"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	serverSource?: "global" | "project"
	alwaysAllowMcp?: boolean
	isInChatContext?: boolean
}

const McpToolRow = ({ tool, serverName, serverSource, alwaysAllowMcp, isInChatContext = false }: McpToolRowProps) => {
	const { t } = useAppTranslation()
	const isToolEnabled = tool.enabledForPrompt ?? true

	const handleAlwaysAllowChange = () => {
		if (!serverName) return
		vscode.postMessage({
			type: "toggleToolAlwaysAllow",
			serverName,
			source: serverSource || "global",
			toolName: tool.name,
			alwaysAllow: !tool.alwaysAllow,
		})
	}

	const handleEnabledForPromptChange = () => {
		if (!serverName) return
		vscode.postMessage({
			type: "toggleToolEnabledForPrompt",
			serverName,
			source: serverSource || "global",
			toolName: tool.name,
			isEnabled: !isToolEnabled,
		})
	}

	return (
		<div
			key={tool.name}
			className={cn(
				"py-3 border-b border-vscode-panel-border last:border-b-0 space-y-2",
				!isToolEnabled && "opacity-60 grayscale-[0.3]",
			)}>
			<div
				data-testid="tool-row-container"
				className="flex items-center justify-between gap-4"
				onClick={(e) => e.stopPropagation()}>
				{/* Tool name section */}
				<div className="flex items-center min-w-0 gap-2">
					<span
						className={cn(
							"codicon codicon-symbol-method shrink-0",
							isToolEnabled
								? "text-vscode-symbolIcon-methodForeground"
								: "text-vscode-descriptionForeground",
						)}></span>
					<div className="flex flex-col min-w-0">
						<span
							className={cn(
								"font-bold text-[11px] truncate uppercase tracking-tight",
								isToolEnabled ? "text-vscode-foreground" : "text-vscode-descriptionForeground",
							)}>
							{tool.name}
						</span>
					</div>
				</div>

				{/* Controls section */}
				{serverName && (
					<div className="flex items-center gap-3 flex-shrink-0">
						{/* Always Allow checkbox - only show when tool is enabled */}
						{alwaysAllowMcp && isToolEnabled && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 bg-vscode-badge-background/5 rounded border border-vscode-badge-background/10">
								<VSCodeCheckbox
									checked={tool.alwaysAllow}
									onChange={handleAlwaysAllowChange}
									data-tool={tool.name}
									className="mcp-checkbox h-4"
								/>
								<span className="text-[10px] font-bold text-vscode-descriptionForeground uppercase tracking-wider">
									{t("mcp:tool.alwaysAllow")}
								</span>
							</div>
						)}

						{/* Enabled toggle switch - only show in settings context */}
						{!isInChatContext && (
							<StandardTooltip content={t("mcp:tool.togglePromptInclusion")}>
								<div className="flex items-center h-4">
									<ToggleSwitch
										checked={isToolEnabled}
										onChange={handleEnabledForPromptChange}
										size="small"
										aria-label={t("mcp:tool.togglePromptInclusion")}
										data-testid={`tool-prompt-toggle-${tool.name}`}
									/>
								</div>
							</StandardTooltip>
						)}
					</div>
				)}
			</div>

			{tool.description && (
				<div
					className={cn(
						"text-[11px] leading-relaxed break-words",
						isToolEnabled ? "text-vscode-foreground/80 font-medium" : "text-vscode-descriptionForeground px-1",
					)}>
					{tool.description}
				</div>
			)}

			{isToolEnabled &&
				tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div className="mt-2 text-[10px] bg-vscode-editor-background/40 border border-vscode-panel-border/30 rounded px-2.5 py-2 space-y-1.5">
						<div className="text-[9px] font-black uppercase tracking-widest opacity-40 text-vscode-foreground flex items-center gap-1.5 mb-1">
							<span className="w-4 h-px bg-current opacity-20" />
							{t("mcp:tool.parameters")}
						</div>
						{Object.entries(tool.inputSchema.properties as Record<string, any>).map(
							([paramName, schema]) => {
								const isRequired =
									tool.inputSchema &&
									"required" in tool.inputSchema &&
									Array.isArray(tool.inputSchema.required) &&
									tool.inputSchema.required.includes(paramName)

								return (
									<div key={paramName} className="flex flex-col gap-0.5 mb-2 last:mb-0">
										<div className="flex items-center gap-1.5">
											<code className="text-vscode-textPreformat-foreground font-black tracking-tight bg-vscode-textPreformat-background/50 px-1 rounded">
												{paramName}
											</code>
											{isRequired && (
												<span className="text-vscode-errorForeground font-bold">
													*
												</span>
											)}
										</div>
										<span className="opacity-70 break-words leading-tight ml-1 text-vscode-descriptionForeground">
											{schema.description || t("mcp:tool.noDescription")}
										</span>
									</div>
								)
							},
						)}
					</div>
				)}
		</div>
	)
}

export default McpToolRow
