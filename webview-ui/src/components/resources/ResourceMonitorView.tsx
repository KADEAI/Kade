import React, { useEffect, useMemo } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"

const ResourceMonitorView: React.FC = () => {
	const { resourceMonitorData } = useExtensionState()

	useEffect(() => {
		vscode.postMessage({ type: "requestResourceMonitorData" })
	}, [])

	const formatBytes = (bytes: number) => {
		if (bytes === 0) return "0 B"
		const k = 1024
		const sizes = ["B", "KB", "MB", "GB", "TB"]
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
	}

	const memoryPercent = useMemo(() => {
		if (!resourceMonitorData) return 0
		const used = resourceMonitorData.totalMemory - resourceMonitorData.freeMemory
		return Math.round((used / resourceMonitorData.totalMemory) * 100)
	}, [resourceMonitorData])

	if (!resourceMonitorData) {
		return (
			<div style={{ padding: "20px", textAlign: "center" }}>
				<p>Loading resource data...</p>
			</div>
		)
	}

	return (
		<div style={{ 
			display: "flex", 
			flexDirection: "column", 
			height: "100%", 
			padding: "15px",
			gap: "20px",
			overflowY: "auto",
			color: "var(--vscode-foreground)"
		}}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<h2 style={{ margin: 0, fontSize: "1.2em", fontWeight: "bold" }}>System Resources</h2>
				<VSCodeButton appearance="icon" onClick={() => vscode.postMessage({ type: "requestResourceMonitorData" })}>
					<span className="codicon codicon-refresh"></span>
				</VSCodeButton>
			</div>

			<div style={{ 
				padding: "15px", 
				backgroundColor: "var(--vscode-welcomePage-tileBackground)", 
				borderRadius: "8px",
				border: "1px solid var(--vscode-widget-border)"
			}}>
				<div style={{ marginBottom: "15px" }}>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
						<span>System Memory</span>
						<span>{memoryPercent}%</span>
					</div>
					<div style={{ 
						height: "8px", 
						width: "100%", 
						backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", 
						borderRadius: "4px",
						overflow: "hidden"
					}}>
						<div style={{ 
							height: "100%", 
							width: `${memoryPercent}%`, 
							backgroundColor: memoryPercent > 80 ? "var(--vscode-errorForeground)" : "var(--vscode-charts-blue)",
							transition: "width 0.5s ease-in-out"
						}} />
					</div>
					<div style={{ marginTop: "8px", fontSize: "0.85em", opacity: 0.8, display: "flex", justifyContent: "space-between" }}>
						<span>Total: {formatBytes(resourceMonitorData.totalMemory)}</span>
						<span>Free: {formatBytes(resourceMonitorData.freeMemory)}</span>
					</div>
				</div>

				<VSCodeDivider />

				<div style={{ marginTop: "15px" }}>
					<div style={{ fontWeight: "bold", marginBottom: "10px" }}>Extension Performance</div>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
						<span>Process ID</span>
						<code>{resourceMonitorData.extensionHost.pid}</code>
					</div>
					<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
						<span>Memory Usage</span>
						<span>{formatBytes(resourceMonitorData.extensionHost.memoryUsage)}</span>
					</div>
					<div style={{ display: "flex", justifyContent: "space-between" }}>
						<span>Uptime</span>
						<span>{Math.floor(resourceMonitorData.extensionHost.uptime / 60)}m {Math.floor(resourceMonitorData.extensionHost.uptime % 60)}s</span>
					</div>
				</div>
			</div>

			<div>
				<h3 style={{ margin: "0 0 10px 0", fontSize: "1em" }}>System Load</h3>
				<div style={{ display: "flex", gap: "10px" }}>
					{[1, 5, 15].map((min, i) => (
						<div key={min} style={{ 
							flex: 1, 
							padding: "10px", 
							textAlign: "center",
							backgroundColor: "var(--vscode-welcomePage-tileBackground)",
							borderRadius: "4px",
							border: "1px solid var(--vscode-widget-border)"
						}}>
							<div style={{ fontSize: "0.8em", opacity: 0.7 }}>{min}m</div>
							<div style={{ fontWeight: "bold", fontSize: "1.1em" }}>{resourceMonitorData.loadAverage[i].toFixed(2)}</div>
						</div>
					))}
				</div>
			</div>

			<div style={{ fontSize: "0.85em", opacity: 0.7, fontStyle: "italic", marginTop: "auto" }}>
				Updates every 5 seconds. High memory usage in the extension host may indicate leaks or large file processing overhead.
			</div>
		</div>
	)
}

export default ResourceMonitorView