import path, { resolve } from "path"
import fs from "fs"
import { execSync } from "child_process"

import { defineConfig, type PluginOption, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

import { sourcemapPlugin } from "./src/vite-plugins/sourcemapPlugin"
import { obfuscatePlugin } from "./vite-obfuscation-plugin"

function getGitSha() {
	let gitSha: string | undefined = undefined

	try {
		gitSha = execSync("git rev-parse HEAD").toString().trim()
	} catch (_error) {
		// Do nothing.
	}

	return gitSha
}

const wasmPlugin = (): Plugin => ({
	name: "wasm",
	async load(id) {
		if (id.endsWith(".wasm")) {
			const wasmBinary = await import(id)

			return `
           			const wasmModule = new WebAssembly.Module(${wasmBinary.default});
           			export default wasmModule;
         		`
		}
	},
})

const persistPortPlugin = (): Plugin => ({
	name: "write-port-to-file",
	configureServer(viteDevServer) {
		viteDevServer?.httpServer?.once("listening", () => {
			const address = viteDevServer?.httpServer?.address()
			const port = address && typeof address === "object" ? address.port : null

			if (port) {
				fs.writeFileSync(resolve(__dirname, "..", ".vite-port"), port.toString())
				console.log(`[Vite Plugin] Server started on port ${port}`)
			} else {
				console.warn("[Vite Plugin] Could not determine server port")
			}
		})
	},
})

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	let outDir = "../src/webview-ui/build"
	const isProduction = mode === "production"
	const enableSourceMapProcessing = process.env.ROO_PROCESS_WEBVIEW_SOURCEMAPS === "1"
	const enableWebviewObfuscation = process.env.ROO_OBFUSCATE_WEBVIEW === "1"

	// kilocode_change start - read package.json fresh every time to avoid caching issues
	const getPkg = () => {
		try {
			return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "package.json"), "utf8"))
		} catch (error) {
			throw new Error(`Could not read package.json: ${error}`)
		}
	}

	const pkg = getPkg()
	// kilocode_change end
	const gitSha = getGitSha()

	const define: Record<string, any> = {
		"process.platform": JSON.stringify(process.platform),
		"process.env.VSCODE_TEXTMATE_DEBUG": JSON.stringify(process.env.VSCODE_TEXTMATE_DEBUG),
		"process.env.PKG_NAME": JSON.stringify(pkg.name),
		"process.env.PKG_VERSION": JSON.stringify(pkg.version),
		"process.env.PKG_OUTPUT_CHANNEL": JSON.stringify("Kilo-Code"),
		...(gitSha ? { "process.env.PKG_SHA": JSON.stringify(gitSha) } : {}),
	}

	// TODO: We can use `@roo-code/build` to generate `define` once the
	// monorepo is deployed.
	if (mode === "nightly") {
		outDir = "../apps/vscode-nightly/build/webview-ui/build"

		const nightlyPkg = JSON.parse(
			fs.readFileSync(path.join(__dirname, "..", "apps", "vscode-nightly", "package.nightly.json"), "utf8"),
		)

		define["process.env.PKG_NAME"] = JSON.stringify(nightlyPkg.name)
		define["process.env.PKG_VERSION"] = JSON.stringify(nightlyPkg.version)
		define["process.env.PKG_OUTPUT_CHANNEL"] = JSON.stringify("Kilo-Code-Nightly")
	}

	const plugins: PluginOption[] = [
		react(),
		tailwindcss(),
		persistPortPlugin(),
		wasmPlugin(),
		sourcemapPlugin({
			enabled: !isProduction && enableSourceMapProcessing,
			outDir,
		}),
		obfuscatePlugin(isProduction && enableWebviewObfuscation),
		// cssPerEntryPlugin(), // kilocode_change: enable per-entry CSS files
	]

	return {
		base: "./", // Use relative paths for VSCode webview compatibility
		plugins,
		resolve: {
			alias: {
				"@": resolve(__dirname, "./src"),
				"@src": resolve(__dirname, "./src"),
				"@roo": resolve(__dirname, "../src/shared"),
			},
		},
		build: {
			outDir,
			emptyOutDir: true,
			reportCompressedSize: false,
			// Disable source maps in production for security
			sourcemap: !isProduction,
			// Advanced minification and obfuscation
			minify: isProduction ? "esbuild" : false,
			// Use a single combined CSS bundle so both webviews share styles
			cssCodeSplit: false, // kilocode_change: changed to true to enable cssPerEntryPlugin
			rollupOptions: {
				input: {
					index: resolve(__dirname, "index.html"), // kilocode_change - DO NOT CHANGE
					"agent-manager": resolve(__dirname, "agent-manager.html"), // kilocode_change
					"group-chat": resolve(__dirname, "group-chat.html"), // kilocode_change
					"browser-panel": resolve(__dirname, "browser-panel.html"),
				},
				external: ["vscode"], // kilocode_change: we inadvertently import vscode into the webview: @roo/modes => src/shared/modes => ../core/prompts/sections/custom-instructions
				output: {
					entryFileNames: `assets/[name].js`,
					chunkFileNames: (chunkInfo) => {
						if (chunkInfo.name === "mermaid-bundle") {
							return `assets/mermaid-bundle.js`
						}
						// Default naming for other chunks, ensuring uniqueness from entry
						return `assets/chunk-[hash].js`
					},
					assetFileNames: (assetInfo) => {
						const name = assetInfo.name || ""

						// kilocode_change start -  cssPerEntryPlugin
						// Force all CSS into a single predictable file used by both webviews
						if (name.endsWith(".css")) {
							return "assets/index.css"
						}
						// kilocode_change end

						if (name.endsWith(".woff2") || name.endsWith(".woff") || name.endsWith(".ttf")) {
							return "assets/fonts/[name][extname]"
						}
						// Ensure source maps are included in the build
						if (name.endsWith(".map")) {
							return "assets/[name]"
						}
						return "assets/[name][extname]"
					},
					manualChunks: (id, { getModuleInfo }) => {
						// Consolidate all mermaid code and its direct large dependencies (like dagre)
						// into a single chunk. The 'channel.js' error often points to dagre.
						if (
							id.includes("node_modules/mermaid") ||
							id.includes("node_modules/dagre") || // dagre is a common dep for graph layout
							id.includes("node_modules/cytoscape") // another potential graph lib
							// Add other known large mermaid dependencies if identified
						) {
							return "mermaid-bundle"
						}

						// Check if the module is part of any explicitly defined mermaid-related dynamic import
						// This is a more advanced check if simple path matching isn't enough.
						const moduleInfo = getModuleInfo(id)
						if (moduleInfo?.importers.some((importer) => importer.includes("node_modules/mermaid"))) {
							return "mermaid-bundle"
						}
						if (
							moduleInfo?.dynamicImporters.some((importer) => importer.includes("node_modules/mermaid"))
						) {
							return "mermaid-bundle"
						}
					},
				},
			},
		},
		server: {
			host: "0.0.0.0", // kilocode_change
			hmr: {
				// host: "localhost", kilocode_change
				protocol: "ws",
			},
			// Disable built-in CORS — wildcard "*" doesn't work for vscode-webview:// origins.
			// Custom headers below reflect the actual Origin back to support non-standard schemes.
			cors: false,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "*",
				"Access-Control-Allow-Headers": "*",
				"Access-Control-Expose-Headers": "*",
			},
		},
		define,
		optimizeDeps: {
			include: [
				"mermaid",
				"dagre", // Explicitly include dagre for pre-bundling
				// Add other known large mermaid dependencies if identified
			],
			exclude: ["@vscode/codicons", "vscode-oniguruma", "shiki", "vscode" /*kilocode_change*/],
		},
		assetsInclude: ["**/*.wasm", "**/*.wav"],
	}
})
