import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import process from "node:process"
import * as console from "node:console"

import { copyPaths, copyWasms, copyLocales, setupLocaleWatcher } from "@roo-code/build"
import { minify } from "terser"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const terserConfig = {
	compress: {
		dead_code: true,
		drop_console: false, // Keep console for debugging
		drop_debugger: true,
		keep_classnames: true, // Preserve class names for VSCode APIs
		keep_fnames: true, // Preserve function names for VSCode APIs
		passes: 1, // Single pass to avoid breaking code
		pure_funcs: [],
		unsafe: false, // Disable unsafe optimizations
		conditionals: true,
		evaluate: true,
		booleans: true,
		loops: true,
		unused: true,
		side_effects: true
	},
	mangle: {
		toplevel: false, // Don't mangle top-level to preserve VSCode API exports
		eval: false,
		keep_classnames: true,
		keep_fnames: true,
		safari10: true
	},
	format: {
		comments: false,
		beautify: false,
		ascii_only: false // Don't force ASCII to avoid encoding issues
	}
}

async function obfuscateFile(filePath) {
	try {
		console.log(`[obfuscation] Processing: ${filePath}`)
		
		const code = fs.readFileSync(filePath, 'utf8')
		
		// Add anti-debugging code
		const antiDebugCode = `(function(){var _0x1a2b=function(){var _0xdef0=setInterval(function(){debugger;},100);};_0x1a2b();})();`
		const codeWithAntiDebug = antiDebugCode + '\n' + code
		
		// Minify and obfuscate with Terser
		const result = await minify(codeWithAntiDebug, {
			...terserConfig,
			sourceMap: false
		})
		
		if (result.code) {
			// Remove any source map comments
			const finalCode = result.code
				.replace(/\/\/# sourceMappingURL=.*/g, '')
				.replace(/\/\*# sourceMappingURL=.*\*\//g, '')
			
			fs.writeFileSync(filePath, finalCode)
			console.log(`[obfuscation] ✅ Obfuscated: ${filePath}`)
			return true
		}
	} catch (error) {
		console.warn(`[obfuscation] ⚠️  Skipped ${path.basename(filePath)}: ${error.message}`)
		return false
	}
}

async function main() {
	const name = "extension"
	const production = process.argv.includes("--production")
	const watch = process.argv.includes("--watch")
	const minify = production
	const sourcemap = !production // Disabled in production for security

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const buildOptions = {
		bundle: true,
		minify,
		sourcemap,
		logLevel: "silent",
		format: "cjs",
		sourcesContent: false,
		platform: "node",
		// kilocode_change start: for ps-list
		banner: {
			js: "const __importMetaUrl = typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : undefined;",
		},
		// kilocode_change end
	}

	const srcDir = __dirname
	const buildDir = __dirname
	const distDir = path.join(buildDir, "dist")

	if (fs.existsSync(distDir)) {
		console.log(`[${name}] Cleaning dist directory: ${distDir}`)
		fs.rmSync(distDir, { recursive: true, force: true })
	}

	/**
	 * @type {import('esbuild').Plugin[]}
	 */
	const plugins = [
		// kilocode_change start
		{
			name: "import-meta-url-plugin",
			setup(build) {
				build.onLoad({ filter: /\.js$/ }, async (args) => {
					const fs = await import("fs")
					let contents = await fs.promises.readFile(args.path, "utf8")

					// Replace import.meta.url with our polyfill
					if (contents.includes("import.meta.url")) {
						contents = contents.replace(/import\.meta\.url/g, "__importMetaUrl")
					}

					return { contents, loader: "js" }
				})
			},
		},
		// kilocode_change end
		{
			name: "copyFiles",
			setup(build) {
				build.onEnd(() => {
					copyPaths(
						[
							["../README.md", "README.md"],
							["../CHANGELOG.md", "CHANGELOG.md"],
							["../LICENSE", "LICENSE"],
							["../.env", ".env", { optional: true }],
							["node_modules/vscode-material-icons/generated", "assets/vscode-material-icons"],
							["../webview-ui/audio", "webview-ui/audio"],
						],
						srcDir,
						buildDir,
					)

					// Copy walkthrough files to dist directory
					copyPaths([["walkthrough", "walkthrough"]], srcDir, distDir)

					// Copy tree-sitter files to dist directory
					copyPaths([["services/continuedev/tree-sitter", "tree-sitter"]], srcDir, distDir)

					// Copy JSDOM xhr-sync-worker.js to fix runtime resolution
					const jsdomWorkerDest = path.join(distDir, "xhr-sync-worker.js")

					try {
						const require = createRequire(import.meta.url)
						const jsdomModulePath = require.resolve("jsdom/package.json")
						const jsdomDir = path.dirname(jsdomModulePath)
						const jsdomWorkerSource = path.join(jsdomDir, "lib/jsdom/living/xhr/xhr-sync-worker.js")

						if (fs.existsSync(jsdomWorkerSource)) {
							fs.copyFileSync(jsdomWorkerSource, jsdomWorkerDest)
							console.log(`[${name}] Copied JSDOM xhr-sync-worker.js to dist from: ${jsdomWorkerSource}`)
						}
					} catch (error) {
						console.error(`[${name}] Failed to copy JSDOM xhr-sync-worker.js:`, error.message)
					}
				})
			},
		},
		{
			name: "copyWasms",
			setup(build) {
				build.onEnd(() => copyWasms(srcDir, distDir))
			},
		},
		{
			name: "copyLocales",
			setup(build) {
				build.onEnd(() => copyLocales(srcDir, distDir))
			},
		},
		{
			name: "esbuild-problem-matcher",
			setup(build) {
				build.onStart(() => console.log("[esbuild-problem-matcher#onStart]"))
				build.onEnd((result) => {
					result.errors.forEach(({ text, location }) => {
						console.error(`✘ [ERROR] ${text}`)
						if (location && location.file) {
							console.error(`    ${location.file}:${location.line}:${location.column}:`)
						}
					})

					console.log("[esbuild-problem-matcher#onEnd]")
				})
			},
		},
	]

	// Filter out false values from plugins array
	const filteredPlugins = plugins.filter(Boolean)

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const extensionConfig = {
		...buildOptions,
		plugins: filteredPlugins,
		entryPoints: ["extension.ts"],
		outfile: "dist/extension.js",
		external: ["vscode", "@lancedb/lancedb", "@vscode/sqlite3"],
	}

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const workerConfig = {
		...buildOptions,
		plugins: filteredPlugins,
		entryPoints: ["workers/countTokens.ts"],
		outdir: "dist/workers",
	}

	const [extensionCtx, workerCtx] = await Promise.all([
		esbuild.context(extensionConfig),
		esbuild.context(workerConfig),
	])

	if (watch) {
		await Promise.all([extensionCtx.watch(), workerCtx.watch()])
		copyLocales(srcDir, distDir)
		setupLocaleWatcher(srcDir, distDir)
	} else {
		await Promise.all([extensionCtx.rebuild(), workerCtx.rebuild()])
		await Promise.all([extensionCtx.dispose(), workerCtx.dispose()])
		
		// OBFUSCATION DISABLED - Causes "Invalid or unexpected token" errors
		// The extension uses dynamic requires and VSCode APIs that break with obfuscation
		console.log('[obfuscation] Skipped - disabled to prevent activation errors')
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
