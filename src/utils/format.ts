/**
 * Converts bytes to a human-readable string (e.g., 1.2 KB, 5.5 MB).
 *
 * @param bytes - The number of bytes to format.
 * @param decimals - Number of decimal places to include (default: 1).
 * @returns A formatted string.
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
    if (bytes === 0) return "0 B"

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}
