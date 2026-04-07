import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import type { RooCodeAPI, RooCodeSettings } from "@roo-code/types"

import { waitFor } from "./utils"

function getInitialConfiguration() {
	const provider = process.env.E2E_API_PROVIDER
	const toolProtocol = process.env.E2E_TOOL_PROTOCOL as RooCodeSettings["toolProtocol"] | undefined

	if (provider === "kilocode" && process.env.E2E_KILOCODE_TOKEN) {
		return {
			apiProvider: "kilocode" as const,
			kilocodeToken: process.env.E2E_KILOCODE_TOKEN,
			kilocodeModel: process.env.E2E_MODEL_ID,
			toolProtocol,
		}
	}

	if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) {
		return {
			apiProvider: "openrouter" as const,
			openRouterApiKey: process.env.OPENROUTER_API_KEY,
			openRouterModelId: process.env.E2E_MODEL_ID || "openai/gpt-4.1",
			toolProtocol,
		}
	}

	if (process.env.OPENROUTER_API_KEY) {
		return {
			apiProvider: "openrouter" as const,
			openRouterApiKey: process.env.OPENROUTER_API_KEY,
			openRouterModelId: "openai/gpt-4.1",
		}
	}

	return undefined
}

export async function run() {
	const extension =
		vscode.extensions.getExtension<RooCodeAPI>("kade.kade") ??
		vscode.extensions.getExtension<RooCodeAPI>("kilocode.kilo-code")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	const initialConfiguration = getInitialConfiguration()
	if (initialConfiguration) {
		await api.setConfiguration(initialConfiguration)
	}

	await vscode.commands.executeCommand("kade.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	globalThis.api = api

	const mochaOptions: Mocha.MochaOptions = {
		ui: "tdd",
		timeout: 20 * 60 * 1_000, // 20m
	}

	if (process.env.TEST_GREP) {
		mochaOptions.grep = process.env.TEST_GREP
		console.log(`Running tests matching pattern: ${process.env.TEST_GREP}`)
	}

	const mocha = new Mocha(mochaOptions)
	const cwd = path.resolve(__dirname, "..")

	let testFiles: string[]

	if (process.env.TEST_FILE) {
		const specificFile = process.env.TEST_FILE.endsWith(".js")
			? process.env.TEST_FILE
			: `${process.env.TEST_FILE}.js`

		testFiles = await glob(`**/${specificFile}`, { cwd })
		console.log(`Running specific test file: ${specificFile}`)
	} else {
		testFiles = await glob("**/**.test.js", { cwd })
	}

	if (testFiles.length === 0) {
		throw new Error(`No test files found matching criteria: ${process.env.TEST_FILE || "all tests"}`)
	}

	testFiles.forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

	return new Promise<void>((resolve, reject) =>
		mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed.`)))),
	)
}
