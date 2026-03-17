import * as vscode from "vscode"
import * as path from "path"

import { listFiles } from "../../services/glob/list-files"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { toRelativePath, getWorkspacePath } from "../../utils/path"

const MAX_INITIAL_FILES = 10_000

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()
	private updateTimer: NodeJS.Timeout | null = null
	private prevWorkSpacePath: string | undefined
	private resetTimer: NodeJS.Timeout | null = null
	private pendingAdditions: string[] = []
	private additionTimer: NodeJS.Timeout | null = null

	get cwd() {
		return this.providerRef?.deref()?.cwd ?? getWorkspacePath()
	}
	private watcherDisabled = false

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		// Defer listener registration to check settings first
		this.initializeWithSettings()
	}

	private async initializeWithSettings() {
		// PERF: Check if workspace tracking is disabled before registering expensive watchers
		// The "**" glob watcher is extremely expensive in large codebases - it fires on every file change
		const provider = this.providerRef.deref()
		const state = await provider?.getState()
		const maxWorkspaceFiles = state?.maxWorkspaceFiles ?? 200
		
		if (maxWorkspaceFiles === 0) {
			this.watcherDisabled = true
			// Only register tab listener, skip expensive file system watcher
			this.registerTabListener()
			return
		}
		
		this.registerListeners()
	}

	private registerTabListener() {
		// Listen for tab changes only - no file system watching
		this.disposables.push(
			vscode.window.tabGroups.onDidChangeTabs(() => {
				if (this.prevWorkSpacePath !== this.cwd) {
					this.workspaceDidReset()
				} else {
					this.workspaceDidUpdate()
				}
			}),
		)
	}

	async initializeFilePaths() {
		// should not auto get filepaths for desktop since it would immediately show permission popup before cline ever creates a file
		if (!this.cwd) {
			return
		}

		// PERF: Respect maxWorkspaceFiles=0 setting - skip expensive file scanning entirely
		// This prevents freezing on large codebases when workspace files context is disabled
		const provider = this.providerRef.deref()
		const state = await provider?.getState()
		const maxWorkspaceFiles = state?.maxWorkspaceFiles ?? 200
		if (maxWorkspaceFiles === 0) {
			this.filePaths.clear()
			this.workspaceDidUpdate()
			return
		}

		const tempCwd = this.cwd
		const [files, _] = await listFiles(tempCwd, true, MAX_INITIAL_FILES)
		if (this.prevWorkSpacePath !== tempCwd) {
			return
		}
		this.filePaths.clear() // kade_change: initializeFilePaths is called multiple times, clear to avoid exceeding MAX_INITIAL_FILES
		files.slice(0, MAX_INITIAL_FILES).forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		// Use a more restrictive pattern to avoid watching node_modules and other heavy directories
		// VSCode's native watcher respects files.watcherExclude, but we can be even more proactive
		// We ignore change events because WorkspaceTracker only cares about the file list (create/delete)
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.cwd || "", "**/*.{ts,js,tsx,jsx,py,go,rs,c,cpp,h,hpp,md,txt,json,yaml,yml,html,css}"),
			false, // ignoreCreateEvents
			true,  // ignoreChangeEvents
			false, // ignoreDeleteEvents
		)
		this.prevWorkSpacePath = this.cwd
		this.disposables.push(
			watcher.onDidCreate(async (uri) => {
				// Avoid immediate stat calls for every file event
				this.addFilePathDebounced(uri.fsPath)
			}),
		)

		this.disposables.push(
			watcher.onDidDelete(async (uri) => {
				if (await this.removeFilePath(uri.fsPath)) {
					this.workspaceDidUpdate()
				}
			}),
		)

		this.disposables.push(watcher)

		// Listen for tab changes and call workspaceDidUpdate directly
		this.disposables.push(
			vscode.window.tabGroups.onDidChangeTabs(() => {
				// Reset if workspace path has changed
				if (this.prevWorkSpacePath !== this.cwd) {
					this.workspaceDidReset()
				} else {
					// Otherwise just update
					this.workspaceDidUpdate()
				}
			}),
		)
	}

	private getOpenedTabsInfo() {
		return vscode.window.tabGroups.all.reduce(
			(acc, group) => {
				const groupTabs = group.tabs
					.filter((tab) => tab.input instanceof vscode.TabInputText)
					.map((tab) => ({
						label: tab.label,
						isActive: tab.isActive,
						path: toRelativePath((tab.input as vscode.TabInputText).uri.fsPath, this.cwd || ""),
					}))

				groupTabs.forEach((tab) => (tab.isActive ? acc.unshift(tab) : acc.push(tab)))
				return acc
			},
			[] as Array<{ label: string; isActive: boolean; path: string }>,
		)
	}

	private async workspaceDidReset() {
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
		}
		this.resetTimer = setTimeout(async () => {
			if (this.prevWorkSpacePath !== this.cwd) {
				await this.providerRef.deref()?.postMessageToWebview({
					type: "workspaceUpdated",
					filePaths: [],
					openedTabs: this.getOpenedTabsInfo(),
				})
				this.filePaths.clear()
				this.prevWorkSpacePath = this.cwd
				this.initializeFilePaths()
			}
		}, 300) // Debounce for 300ms
	}

	private workspaceDidUpdate() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
		}
		this.updateTimer = setTimeout(() => {
			if (!this.cwd) {
				return
			}

			const relativeFilePaths = Array.from(this.filePaths).map((file) => toRelativePath(file, this.cwd))
			this.providerRef.deref()?.postMessageToWebview({
				type: "workspaceUpdated",
				filePaths: relativeFilePaths,
				openedTabs: this.getOpenedTabsInfo(),
			})
			this.updateTimer = null
		}, 300) // Debounce for 300ms
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = this.cwd ? path.resolve(this.cwd, filePath) : path.resolve(filePath)
		return filePath.endsWith("/") ? resolvedPath + "/" : resolvedPath
	}

	private async addFilePath(filePath: string): Promise<string> {
		// Allow for some buffer to account for files being created/deleted during a task
		if (this.filePaths.size >= MAX_INITIAL_FILES * 2) {
			return filePath
		}

		const normalizedPath = this.normalizeFilePath(filePath)
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedPath))
			const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
			const pathWithSlash = isDirectory && !normalizedPath.endsWith("/") ? normalizedPath + "/" : normalizedPath
			this.filePaths.add(pathWithSlash)
			return pathWithSlash
		} catch {
			// If stat fails, assume it's a file (this can happen for newly created files)
			this.filePaths.add(normalizedPath)
			return normalizedPath
		}
	}

	private async removeFilePath(filePath: string): Promise<boolean> {
		const normalizedPath = this.normalizeFilePath(filePath)
		return this.filePaths.delete(normalizedPath) || this.filePaths.delete(normalizedPath + "/")
	}

	private addFilePathDebounced(filePath: string) {
		this.pendingAdditions.push(filePath)
		if (this.additionTimer) {
			clearTimeout(this.additionTimer)
		}
		this.additionTimer = setTimeout(async () => {
			const paths = [...this.pendingAdditions]
			this.pendingAdditions = []
			for (const path of paths) {
				await this.addFilePath(path)
			}
			this.workspaceDidUpdate()
		}, 1000) // Batch additions every second
	}

	public dispose() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
			this.updateTimer = null
		}
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
			this.resetTimer = null
		}
		if (this.additionTimer) {
			clearTimeout(this.additionTimer)
			this.additionTimer = null
		}
		this.disposables.forEach((d) => d.dispose())
		this.disposables = [] // Clear the array
	}
}

export default WorkspaceTracker
