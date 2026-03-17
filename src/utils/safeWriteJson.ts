import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as lockfile from "proper-lockfile"
import Disassembler from "stream-json/Disassembler"
import Stringer from "stream-json/Stringer"

/**
 * Safely writes JSON data to a file.
 * - Creates parent directories if they don't exist
 * - Uses 'proper-lockfile' for inter-process advisory locking to prevent concurrent writes to the same path.
 * - Writes to a temporary file first.
 * - If the target file exists, it's backed up before being replaced.
 * - Attempts to roll back and clean up in case of errors.
 *
 * @param {string} filePath - The absolute path to the target file.
 * @param {any} data - The data to serialize to JSON and write.
 * @returns {Promise<void>}
 */

async function safeWriteJson(filePath: string, data: any): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	let releaseLock = async () => {} // Initialized to a no-op

	// For directory creation
	const dirPath = path.dirname(absoluteFilePath)

	// Ensure directory structure exists with improved reliability
	try {
		// Create directory with recursive option
		await fs.mkdir(dirPath, { recursive: true })

		// Verify directory exists after creation attempt
		await fs.access(dirPath)
	} catch (dirError: any) {
		console.error(`Failed to create or access directory for ${absoluteFilePath}:`, dirError)
		throw dirError
	}

	// Acquire the lock before any file operations
	try {
		releaseLock = await lockfile.lock(absoluteFilePath, {
			stale: 31000, // Stale after 31 seconds
			update: 10000, // Update mtime every 10 seconds to prevent staleness if operation is long
			realpath: false, // the file may not exist yet, which is acceptable
			retries: {
				// Configuration for retrying lock acquisition
				retries: 5, // Number of retries after the initial attempt
				factor: 2, // Exponential backoff factor (e.g., 100ms, 200ms, 400ms, ...)
				minTimeout: 100, // Minimum time to wait before the first retry (in ms)
				maxTimeout: 1000, // Maximum time to wait for any single retry (in ms)
			},
			onCompromised: (err) => {
				console.error(`Lock at ${absoluteFilePath} was compromised:`, err)
				throw err
			},
		})
	} catch (lockError) {
		// If lock acquisition fails, we throw immediately.
		// The releaseLock remains a no-op, so the finally block in the main file operations
		// try-catch-finally won't try to release an unacquired lock if this path is taken.
		console.error(`Failed to acquire lock for ${absoluteFilePath}:`, lockError)
		// Propagate the lock acquisition error
		throw lockError
	}

	// Variable to hold the actual path of the temp file if it is created.
	let actualTempNewFilePath: string | null = null

	try {
		// Step 1: Write data to a new temporary file.
		actualTempNewFilePath = path.join(
			path.dirname(absoluteFilePath),
			`.${path.basename(absoluteFilePath)}.new_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
		)

		await _streamDataToFile(actualTempNewFilePath, data)

		// Step 2: Rename the new temporary file to the target file path.
		// This is the atomic "commit" step. On most filesystems, rename(2) is atomic.
		// If the target file exists, it will be replaced.
		await fs.rename(actualTempNewFilePath, absoluteFilePath)

		// If we reach here, the new file is successfully in place.
		actualTempNewFilePath = null
	} catch (originalError) {
		console.error(`Operation failed for ${absoluteFilePath}: [Original Error Caught]`, originalError)

		const newFileToCleanupWithinCatch = actualTempNewFilePath

		// Cleanup the .new file if it exists
		if (newFileToCleanupWithinCatch) {
			try {
				await fs.unlink(newFileToCleanupWithinCatch)
			} catch (cleanupError) {
				console.error(
					`[Catch] Failed to clean up temporary new file ${newFileToCleanupWithinCatch}:`,
					cleanupError,
				)
			}
		}
		throw originalError // This MUST be the error that rejects the promise.
	} finally {
		// Release the lock in the main finally block.
		try {
			// releaseLock will be the actual unlock function if lock was acquired,
			// or the initial no-op if acquisition failed.
			await releaseLock()
		} catch (unlockError) {
			// Do not re-throw here, as the originalError from the try/catch (if any) is more important.
			console.error(`Failed to release lock for ${absoluteFilePath}:`, unlockError)
		}
	}
}

/**
 * Helper function to stream JSON data to a file.
 * @param targetPath The path to write the stream to.
 * @param data The data to stream.
 * @returns Promise<void>
 */
async function _streamDataToFile(targetPath: string, data: any): Promise<void> {
	// Stream data to avoid high memory usage for large JSON objects.
	const fileWriteStream = fsSync.createWriteStream(targetPath, { encoding: "utf8" })
	const disassembler = Disassembler.disassembler()
	// Output will be compact JSON as standard Stringer is used.
	const stringer = Stringer.stringer()

	return new Promise<void>((resolve, reject) => {
		let errorOccurred = false
		const handleError = (_streamName: string) => (err: Error) => {
			if (!errorOccurred) {
				errorOccurred = true
				if (!fileWriteStream.destroyed) {
					fileWriteStream.destroy(err)
				}
				reject(err)
			}
		}

		disassembler.on("error", handleError("Disassembler"))
		stringer.on("error", handleError("Stringer"))
		fileWriteStream.on("error", (err: Error) => {
			if (!errorOccurred) {
				errorOccurred = true
				reject(err)
			}
		})

		fileWriteStream.on("finish", () => {
			if (!errorOccurred) {
				resolve()
			}
		})

		disassembler.pipe(stringer).pipe(fileWriteStream)

		// stream-json's Disassembler might error if `data` is undefined.
		// JSON.stringify(undefined) would produce the string "undefined" if it's the root value.
		// Writing 'null' is a safer JSON representation for a root undefined value.
		if (data === undefined) {
			disassembler.write(null)
		} else {
			disassembler.write(data)
		}
		disassembler.end()
	})
}

export { safeWriteJson }
