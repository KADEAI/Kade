import * as vscode from "vscode"
import * as os from "os"
import { ExtensionMessage } from "../../shared/ExtensionMessage"

export interface ProcessResourceInfo {
	pid: number
	name: string
	type: "extension" | "mcp-server" | "terminal" | "other"
	memoryUsage: number // in bytes
	cpuUsage: number // percentage
	uptime: number // seconds
}

export interface ResourceSnapshot {
	timestamp: number
	totalMemory: number
	freeMemory: number
	extensionHost: ProcessResourceInfo
	processes: ProcessResourceInfo[]
	loadAverage: number[]
}

export class ResourceMonitorService {
	private static instance: ResourceMonitorService
	private intervalId?: NodeJS.Timeout
	private providers: Set<{ postMessageToWebview: (message: ExtensionMessage) => Promise<void> }> = new Set()

	private constructor() {}

	static getInstance(): ResourceMonitorService {
		if (!ResourceMonitorService.instance) {
			ResourceMonitorService.instance = new ResourceMonitorService()
		}
		return ResourceMonitorService.instance
	}

	registerProvider(provider: { postMessageToWebview: (message: ExtensionMessage) => Promise<void> }) {
		this.providers.add(provider)
		if (this.providers.size === 1) {
			this.startMonitoring()
		}
	}

	unregisterProvider(provider: { postMessageToWebview: (message: ExtensionMessage) => Promise<void> }) {
		this.providers.delete(provider)
		if (this.providers.size === 0) {
			this.stopMonitoring()
		}
	}

	private startMonitoring() {
		if (this.intervalId) return
		this.intervalId = setInterval(() => this.broadcastSnapshot(), 5000)
		this.broadcastSnapshot() // Immediate first update
	}

	private stopMonitoring() {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = undefined
		}
	}

	private async getSnapshot(): Promise<ResourceSnapshot> {
		const memUsage = process.memoryUsage()
		
		const extensionHost: ProcessResourceInfo = {
			pid: process.pid,
			name: "Extension Host",
			type: "extension",
			memoryUsage: memUsage.rss, // RSS is more indicative of total process memory
			cpuUsage: 0, 
			uptime: process.uptime()
		}

		// In a real implementation, we would gather MCP server PIDs from McpHub
		// and use a library like 'pidusage' or parse 'ps' output.
		// For now, we provide the core extension stats.

		return {
			timestamp: Date.now(),
			totalMemory: os.totalmem(),
			freeMemory: os.freemem(),
			extensionHost,
			processes: [], // Future: Add child processes
			loadAverage: os.loadavg()
		}
	}

	async broadcastSnapshot() {
		const snapshot = await this.getSnapshot()
		const message: ExtensionMessage = {
			type: "resourceMonitorData",
			payload: snapshot as any
		}

		for (const provider of this.providers) {
			provider.postMessageToWebview(message).catch(() => {})
		}
	}
}