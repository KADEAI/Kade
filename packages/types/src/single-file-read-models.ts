/**
 * Configuration for models that should use simplified single-file read tool
 * These models will use the simpler <read><path>...</path></read> format
 * instead of the more complex multi-file args format
 */

/**
 * Check if a model should use single file read format
 * @param modelId The model ID to check
 * @returns true if the model should use single file reads
 */
export function shouldUseSingleFileRead(
	_modelId: string, // kade_change
): boolean {
	return false // kade_change
}
