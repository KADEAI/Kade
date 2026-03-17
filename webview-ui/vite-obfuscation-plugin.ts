import { minify } from 'terser'
import type { Plugin } from 'vite'

const productionObfuscationConfig = {
	compress: {
		dead_code: true,
		drop_console: false, // Keep console for debugging
		drop_debugger: true, // Remove debugger statements
		keep_classnames: true, // Preserve class names for stability
		keep_fnames: true, // Preserve function names for stability
		passes: 1, // Single pass to avoid over-optimization
		pure_funcs: [], // Don't remove functions
		unsafe: false, // Disable unsafe optimizations
		conditionals: true,
		evaluate: true,
		booleans: true,
		loops: true,
		unused: true,
		side_effects: true
	},
	mangle: {
		toplevel: false, // Don't mangle top-level scope
		eval: false,
		keep_classnames: true,
		keep_fnames: true,
		safari10: true
	},
	format: {
		comments: false,
		beautify: false,
		ascii_only: true
	}
}

function obfuscatePlugin(enabled: boolean = false): Plugin {
	return {
		name: 'obfuscation',
		async generateBundle(_options, bundle) {
			if (!enabled) return

			// Process each chunk
			for (const [fileName, chunk] of Object.entries(bundle)) {
				if (fileName.endsWith('.js') && chunk.type === 'chunk') {
					try {
						console.log(`Obfuscating webview chunk: ${fileName}`)
						
						// Add anti-debugging code at the top
						const antiDebugCode = `(function(){var _0x1a2b=function(){var _0xdef0=setInterval(function(){debugger;},100);};_0x1a2b();})();`
						
						const codeWithAntiDebug = antiDebugCode + '\n' + chunk.code
						
						// Minify and obfuscate with Terser
						const result = await minify(codeWithAntiDebug, {
							...productionObfuscationConfig,
							sourceMap: false
						})
						
						if (result.code) {
							// Remove any source map comments that might have slipped through
							chunk.code = result.code
								.replace(/\/\/# sourceMappingURL=.*/g, '')
								.replace(/\/\*# sourceMappingURL=.*\*\//g, '')
						}
						
						// Remove source map references
						if ('map' in chunk) {
							delete (chunk as any).map
						}
						
						console.log(`✅ Obfuscated: ${fileName}`)
					} catch (error) {
						console.error(`❌ Failed to obfuscate ${fileName}:`, error)
					}
				}
			}
		},
		
		// Also process the final output files
		writeBundle(_options, bundle) {
			if (!enabled) return
			
			// Remove any source map files that were generated
			for (const [fileName] of Object.entries(bundle)) {
				if (fileName.endsWith('.js.map')) {
					delete bundle[fileName]
					console.log(`🗑️  Removed source map: ${fileName}`)
				}
			}
		}
	}
}

export { obfuscatePlugin, productionObfuscationConfig }
