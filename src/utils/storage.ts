import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { constants as fsConstants } from "fs"
import * as fsSync from "fs" // // kade_change

import { Package } from "../shared/package"
import { t } from "../i18n"
import { getWorkspacePath } from "./path"

const WORKSPACE_TASK_STORAGE_DIR = ".kilocode"

/**
 * Gets the base storage path for conversations
 * If a custom path is configured, uses that path
 * Otherwise uses the default VSCode extension global storage path
 */
export async function getStorageBasePath(defaultPath: string): Promise<string> {
	// Get user-configured custom storage path
	let customStoragePath = ""

	try {
		// This is the line causing the error in tests
		const config = vscode.workspace.getConfiguration(Package.name)
		customStoragePath = config.get<string>("customStoragePath", "")
	} catch (error) {
		console.warn("Could not access VSCode configuration - using default path")
		return defaultPath
	}

	// If no custom path is set, use default path
	if (!customStoragePath) {
		return defaultPath
	}

	try {
		// Ensure custom path exists
		await fs.mkdir(customStoragePath, { recursive: true })

		// Check directory write permission without creating temp files
		await fs.access(customStoragePath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)

		return customStoragePath
	} catch (error) {
		// If path is unusable, report error and fall back to default path
		console.error(`Custom storage path is unusable: ${error instanceof Error ? error.message : String(error)}`)
		if (vscode.window) {
			vscode.window.showErrorMessage(t("common:errors.custom_storage_path_unusable", { path: customStoragePath }))
		}
		return defaultPath
	}
}

/**
 * Gets the base storage path for task/chat data.
 * Priority:
 * 1. Explicit customStoragePath
 * 2. Workspace-local .kilocode directory
 * 3. Default VS Code global storage path
 */
export async function getTaskStorageBasePath(defaultPath: string, workspacePath = getWorkspacePath()): Promise<string> {
	const configuredBasePath = await getStorageBasePath(defaultPath)
	if (configuredBasePath !== defaultPath) {
		return configuredBasePath
	}

	if (!workspacePath) {
		return defaultPath
	}

	const workspaceStoragePath = path.join(workspacePath, WORKSPACE_TASK_STORAGE_DIR)
	await fs.mkdir(workspaceStoragePath, { recursive: true })
	return workspaceStoragePath
}

// kade_change - start
export function getStorageBasePathSync(defaultPath: string): string {
	let customStoragePath = ""
	try {
		const config = vscode.workspace.getConfiguration(Package.name)
		customStoragePath = config.get<string>("customStoragePath", "")
	} catch (error) {
		console.warn("Could not access VSCode configuration - using default path")
		return defaultPath
	}
	if (!customStoragePath) {
		return defaultPath
	}
	try {
		fsSync.mkdirSync(customStoragePath, { recursive: true })
		const testFile = path.join(customStoragePath, ".write_test")
		fsSync.writeFileSync(testFile, "test")
		fsSync.rmSync(testFile)
		return customStoragePath
	} catch (error) {
		return defaultPath
	}
}

export function getTaskStorageBasePathSync(defaultPath: string, workspacePath = getWorkspacePath()): string {
	const configuredBasePath = getStorageBasePathSync(defaultPath)
	if (configuredBasePath !== defaultPath) {
		return configuredBasePath
	}

	if (!workspacePath) {
		return defaultPath
	}

	const workspaceStoragePath = path.join(workspacePath, WORKSPACE_TASK_STORAGE_DIR)
	fsSync.mkdirSync(workspaceStoragePath, { recursive: true })
	return workspaceStoragePath
}
// kade_change - end

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath, fsConstants.F_OK)
		return true
	} catch {
		return false
	}
}

async function migrateTaskDirectoryIfNeeded(currentTaskDir: string, legacyTaskDir: string): Promise<void> {
	if (currentTaskDir === legacyTaskDir) {
		return
	}

	if (await pathExists(currentTaskDir)) {
		return
	}

	if (!(await pathExists(legacyTaskDir))) {
		return
	}

	const currentParentDir = path.dirname(currentTaskDir)
	await fs.mkdir(currentParentDir, { recursive: true })

	try {
		await fs.rename(legacyTaskDir, currentTaskDir)
		return
	} catch {
		// Fall back to copy+delete for cross-device moves or sandbox differences.
	}

	await fs.cp(legacyTaskDir, currentTaskDir, { recursive: true })
	await fs.rm(legacyTaskDir, { recursive: true, force: true })
}

/**
 * Gets the storage directory path for a task
 */
export async function getTaskDirectoryPath(
	globalStoragePath: string,
	taskId: string,
	workspacePath = getWorkspacePath(),
): Promise<string> {
	const basePath = await getTaskStorageBasePath(globalStoragePath, workspacePath)
	const taskDir = path.join(basePath, "tasks", taskId)
	const legacyBasePath = await getStorageBasePath(globalStoragePath)
	const legacyTaskDir = path.join(legacyBasePath, "tasks", taskId)

	await migrateTaskDirectoryIfNeeded(taskDir, legacyTaskDir)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}

/**
 * Gets the settings directory path
 */
export async function getSettingsDirectoryPath(globalStoragePath: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const settingsDir = path.join(basePath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })
	return settingsDir
}

/**
 * Gets the cache directory path
 */
export async function getCacheDirectoryPath(globalStoragePath: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const cacheDir = path.join(basePath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}

// kade_change - start
/**
 * Gets the local vector store directory path
 */
export function getLancedbVectorStoreDirectoryPath(globalStoragePath: string): string {
	const basePath = getStorageBasePathSync(globalStoragePath)
	const cacheDir = path.join(basePath, "vector")
	fsSync.mkdirSync(cacheDir, { recursive: true })
	return cacheDir
}
// kade_change - end

/**
 * Prompts the user to set a custom storage path
 * Displays an input box allowing the user to enter a custom path
 */
export async function promptForCustomStoragePath(): Promise<void> {
	if (!vscode.window || !vscode.workspace) {
		console.error("VS Code API not available")
		return
	}

	let currentPath = ""
	try {
		const currentConfig = vscode.workspace.getConfiguration(Package.name)
		currentPath = currentConfig.get<string>("customStoragePath", "")
	} catch (error) {
		console.error("Could not access configuration")
		return
	}

	const result = await vscode.window.showInputBox({
		value: currentPath,
		placeHolder: t("common:storage.path_placeholder"),
		prompt: t("common:storage.prompt_custom_path"),
		validateInput: (input) => {
			if (!input) {
				return null // Allow empty value (use default path)
			}

			try {
				// Validate path format
				path.parse(input)

				// Check if path is absolute
				if (!path.isAbsolute(input)) {
					return t("common:storage.enter_absolute_path")
				}

				return null // Path format is valid
			} catch (e) {
				return t("common:storage.enter_valid_path")
			}
		},
	})

	// If user canceled the operation, result will be undefined
	if (result !== undefined) {
		try {
			const currentConfig = vscode.workspace.getConfiguration(Package.name)
			await currentConfig.update("customStoragePath", result, vscode.ConfigurationTarget.Global)

			if (result) {
				try {
					// Test if path is accessible
					await fs.mkdir(result, { recursive: true })
					await fs.access(result, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)
					vscode.window.showInformationMessage(t("common:info.custom_storage_path_set", { path: result }))
				} catch (error) {
					vscode.window.showErrorMessage(
						t("common:errors.cannot_access_path", {
							path: result,
							error: error instanceof Error ? error.message : String(error),
						}),
					)
				}
			} else {
				vscode.window.showInformationMessage(t("common:info.default_storage_path"))
			}
		} catch (error) {
			console.error("Failed to update configuration", error)
		}
	}
}
