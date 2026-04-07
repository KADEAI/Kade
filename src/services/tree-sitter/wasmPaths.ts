import * as fs from "fs"
import * as path from "path"

function dedupePaths(candidatePaths: Array<string | undefined>): string[] {
	return [...new Set(candidatePaths.filter((candidate): candidate is string => Boolean(candidate)))]
}

export function findExistingPath(candidatePaths: Array<string | undefined>): string | undefined {
	for (const candidatePath of dedupePaths(candidatePaths)) {
		if (fs.existsSync(candidatePath)) {
			return candidatePath
		}
	}

	return undefined
}

function resolveWebTreeSitterAsset(...relativePath: string[]): string | undefined {
	try {
		const packageEntrypoint = require.resolve("web-tree-sitter")
		return path.join(path.dirname(packageEntrypoint), ...relativePath)
	} catch {
		return undefined
	}
}

function resolveTreeSitterLanguageAsset(...relativePath: string[]): string | undefined {
	try {
		const knownLanguageWasm = require.resolve("tree-sitter-wasms/out/tree-sitter-javascript.wasm")
		return path.join(path.dirname(knownLanguageWasm), ...relativePath)
	} catch {
		return undefined
	}
}

export function getTreeSitterCoreWasmPath(baseDir = __dirname): string | undefined {
	const cwd = process.cwd()

	return findExistingPath([
		path.join(baseDir, "tree-sitter.wasm"),
		path.join(baseDir, "dist", "tree-sitter.wasm"),
		path.join(cwd, "dist", "tree-sitter.wasm"),
		path.join(cwd, "src", "dist", "tree-sitter.wasm"),
		resolveWebTreeSitterAsset("tree-sitter.wasm"),
		resolveWebTreeSitterAsset("lib", "tree-sitter.wasm"),
	])
}

export function getLanguageWasmPath(
	langName: string,
	options: {
		baseDir?: string
		sourceDirectory?: string
	} = {},
): string | undefined {
	const { baseDir = __dirname, sourceDirectory } = options
	const cwd = process.cwd()
	const filename = `tree-sitter-${langName}.wasm`

	return findExistingPath([
		sourceDirectory ? path.join(sourceDirectory, filename) : undefined,
		path.join(baseDir, filename),
		path.join(baseDir, "dist", filename),
		path.join(cwd, "dist", filename),
		path.join(cwd, "src", "dist", filename),
		resolveTreeSitterLanguageAsset(filename),
	])
}
