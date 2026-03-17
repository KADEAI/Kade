import * as vscode from "vscode"
import { Package } from "../../../shared/package"

/**
 * Gets the API request timeout from VSCode configuration with validation.
 * Optimized: Separate timeouts for different operations to reduce latency
 *
 * @returns The timeout in milliseconds. Returns undefined to disable timeout
 *          (letting the SDK use its default), or a positive number for explicit timeout.
 */
export function getApiRequestTimeout(): number | undefined {
	// Get timeout with validation to ensure it's a valid non-negative number
	const configTimeout = vscode.workspace.getConfiguration(Package.name).get<number>("apiRequestTimeout", 600)

	// Validate that it's actually a number and not NaN
	if (typeof configTimeout !== "number" || isNaN(configTimeout)) {
		return 600 * 1000 // Default to 600 seconds
	}

	// 0 or negative means "no timeout" - return undefined to let SDK use its default
	// (OpenAI SDK interprets 0 as "abort immediately", so we return undefined instead)
	if (configTimeout <= 0) {
		return undefined
	}

	return configTimeout * 1000 // Convert to milliseconds
}

/**
 * Gets a shorter timeout specifically for first chunk detection to reduce latency.
 * This helps detect hanging connections faster than the full request timeout.
 *
 * @returns Timeout in milliseconds for first chunk detection
 */
export function getFirstChunkTimeout(): number {
	// Use 30 seconds for first chunk - gives slow/loaded servers enough time to respond
	// 5s was too aggressive and caused false-positive timeouts on normal slow connections
	return 30000
}

/**
 * Gets timeout for streaming operations between chunks.
 *
 * @returns Timeout in milliseconds for streaming operations
 */
export function getStreamingTimeout(): number {
	// Use 10 seconds between chunks to detect stalled streams
	return 10000
}
