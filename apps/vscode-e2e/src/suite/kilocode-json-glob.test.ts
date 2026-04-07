import * as assert from "assert"
import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage, type RooCodeAPI } from "@roo-code/types"

import { waitFor } from "./utils"

const MODEL_ID = "xiaomi/mimo-v2-pro:free"
const TASK_TIMEOUT_MS = 180_000

async function readKilocodeToken() {
	const repoRoot = path.resolve(__dirname, "../../../../")
	const candidatePaths = [
		path.join(repoRoot, "OPENROUTER.TXT"),
		path.join(repoRoot, "openrouter.txt"),
		path.join(repoRoot, "openrouterkey.txt"),
	]

	for (const filePath of candidatePaths) {
		try {
			const token = (await fs.readFile(filePath, "utf8")).trim()
			if (token.length > 0) {
				return token
			}
		} catch {
			// Ignore missing files and continue to the next candidate.
		}
	}

	throw new Error(`No Kilo/OpenRouter token file found. Checked: ${candidatePaths.join(", ")}`)
}

function summarizeMessage(message: ClineMessage) {
	return JSON.stringify(
		{
			ts: message.ts,
			type: message.type,
			ask: (message as any).ask,
			say: (message as any).say,
			partial: message.partial,
			text: typeof message.text === "string" ? message.text.slice(0, 400) : message.text,
		},
		null,
		2,
	)
}

suite("KiloCode Unified Glob Repro", function () {
	this.timeout(TASK_TIMEOUT_MS + 60_000)

	test("uses Kilo Gateway unified protocol with MiMo and executes a glob request", async () => {
		const api = globalThis.api as RooCodeAPI
		const kilocodeToken = await readKilocodeToken()
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]

		assert.ok(workspaceFolder, "Expected VS Code test workspace to exist")

		const workspacePath = workspaceFolder!.uri.fsPath
		await fs.mkdir(path.join(workspacePath, "fixtures", "nested"), { recursive: true })
		await fs.writeFile(path.join(workspacePath, "fixtures", "alpha.txt"), "alpha\n")
		await fs.writeFile(path.join(workspacePath, "fixtures", "nested", "beta.ts"), "export const beta = 1\n")
		await fs.writeFile(path.join(workspacePath, "fixtures", "nested", "gamma.md"), "# gamma\n")

		await api.setConfiguration({
			apiProvider: "kilocode",
			kilocodeToken,
			kilocodeModel: MODEL_ID,
			toolProtocol: "unified",
		})

		const messages: ClineMessage[] = []
		const toolFailures: Array<{ toolName: string; error: string }> = []
		const completed = new Set<string>()
		const aborted = new Set<string>()
		let currentTaskId = ""

		api.on(RooCodeEventName.Message, ({ taskId, message }) => {
			if (taskId === currentTaskId) {
				messages.push(message)
			}
		})
		api.on(RooCodeEventName.TaskToolFailed, (taskId, toolName, error) => {
			if (taskId === currentTaskId) {
				toolFailures.push({ toolName, error })
			}
		})
		api.on(RooCodeEventName.TaskCompleted, (taskId) => {
			completed.add(taskId)
		})
		api.on(RooCodeEventName.TaskAborted, (taskId) => {
			aborted.add(taskId)
		})

			currentTaskId = await api.startNewTask({
				configuration: {
					mode: "ask",
					alwaysAllowModeSwitch: true,
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
				},
				text:
					"Use the glob tool only on this directory. Match '**/*.{txt,ts,md}' from the workspace root, then reply with DONE.",
			})

		try {
			await waitFor(() => completed.has(currentTaskId) || aborted.has(currentTaskId), {
				timeout: TASK_TIMEOUT_MS,
				interval: 500,
			})
		} catch (error) {
			const transcript = messages.map(summarizeMessage).join("\n")
			throw new Error(
				`Timed out waiting for task completion.\nTask: ${currentTaskId}\nTool failures: ${JSON.stringify(toolFailures, null, 2)}\nMessages:\n${transcript}`,
			)
		}

		assert.ok(!aborted.has(currentTaskId), `Task aborted.\nMessages:\n${messages.map(summarizeMessage).join("\n")}`)

		const toolMessages = messages.filter((message) => {
			const ask = (message as any).ask
			const say = (message as any).say
			return ask === "tool" || say === "tool"
		})
		const debugMessages = messages.filter(
			(message) => (message as any).say === "error" && typeof message.text === "string" && message.text.includes("[TOOL_STREAM_DEBUG]"),
		)
		const completionMessages = messages.filter((message) => {
			const say = (message as any).say
			return (say === "completion_result" || say === "text") && typeof message.text === "string"
		})
		const doneMessage = completionMessages.find((message) => message.text?.includes("DONE"))

		assert.ok(
			toolMessages.length > 0 || debugMessages.length > 0,
			`Expected at least one tool/debug message.\nTool failures: ${JSON.stringify(toolFailures, null, 2)}\nMessages:\n${messages.map(summarizeMessage).join("\n")}`,
		)
		assert.ok(
			doneMessage,
			`Expected completion containing DONE.\nTool failures: ${JSON.stringify(toolFailures, null, 2)}\nMessages:\n${messages.map(summarizeMessage).join("\n")}`,
		)
	})
})
