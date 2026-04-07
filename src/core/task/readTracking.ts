export type TrackedLineRange = {
	start: number
	end: number
}

type ReadTrackingSource = {
	lineRanges?: Array<{ start?: number; end?: number }>
	head?: number | string
	tail?: number | string
}

type ReadToolResultBlock = {
	content?: unknown
	text?: unknown
}

const INLINE_LINE_RANGE_PATTERN = /^(.*?)(?::(?:L)?|\s+)(\d+)-(\d+)$/i
const INLINE_HEAD_TAIL_PATTERN = /^(.*?)(?::|\s+)([HT])(\d+)$/i

function normalizePositiveInt(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : parseInt(String(value), 10)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function collectToolResultText(block?: ReadToolResultBlock): string {
	if (!block) {
		return ""
	}

	if (typeof block.content === "string") {
		return block.content
	}

	if (typeof block.text === "string") {
		return block.text
	}

	if (Array.isArray(block.content)) {
		return block.content
			.map((entry: any) =>
				typeof entry?.text === "string"
					? entry.text
					: typeof entry?.content === "string"
						? entry.content
						: "",
			)
			.filter(Boolean)
			.join("\n")
	}

	return ""
}

function mergeRanges(ranges: TrackedLineRange[]): TrackedLineRange[] {
	if (ranges.length === 0) {
		return []
	}

	const sorted = [...ranges].sort((a, b) => a.start - b.start)
	const merged: TrackedLineRange[] = [{ ...sorted[0] }]

	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i]
		const previous = merged[merged.length - 1]

		if (current.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, current.end)
			continue
		}

		merged.push({ ...current })
	}

	return merged
}

function extractRangesFromToolResult(block?: ReadToolResultBlock): TrackedLineRange[] {
	const text = collectToolResultText(block)
	if (!text) {
		return []
	}

	const ranges: TrackedLineRange[] = []

	for (const match of text.matchAll(/Lines (\d+)-(\d+):/g)) {
		const start = normalizePositiveInt(match[1])
		const end = normalizePositiveInt(match[2])
		if (start !== undefined && end !== undefined && start <= end) {
			ranges.push({ start, end })
		}
	}

	for (const match of text.matchAll(/<content[^>]*lines="(\d+)-(\d+)"[^>]*>/g)) {
		const start = normalizePositiveInt(match[1])
		const end = normalizePositiveInt(match[2])
		if (start !== undefined && end !== undefined && start <= end) {
			ranges.push({ start, end })
		}
	}

	return mergeRanges(ranges)
}

function sourceHasExplicitSpec(source?: ReadTrackingSource) {
	if (!source) {
		return false
	}

	if (Array.isArray(source.lineRanges) && source.lineRanges.length > 0) {
		return true
	}

	return normalizePositiveInt(source.head) !== undefined || normalizePositiveInt(source.tail) !== undefined
}

export function hasExplicitTrackedReadSpec(
	filePath?: string,
	primarySource?: ReadTrackingSource,
	fallbackSource?: ReadTrackingSource,
) {
	if (sourceHasExplicitSpec(primarySource) || sourceHasExplicitSpec(fallbackSource)) {
		return true
	}

	if (!filePath?.trim()) {
		return false
	}

	return INLINE_LINE_RANGE_PATTERN.test(filePath) || INLINE_HEAD_TAIL_PATTERN.test(filePath)
}

export function extractTrackedReadLineRanges(
	primarySource?: ReadTrackingSource,
	fallbackSource?: ReadTrackingSource,
	toolResultBlock?: ReadToolResultBlock,
): TrackedLineRange[] | undefined {
	const directRanges = [primarySource, fallbackSource]
		.flatMap((source) => source?.lineRanges ?? [])
		.filter(
			(range): range is TrackedLineRange =>
				range?.start !== undefined &&
				range?.end !== undefined &&
				Number.isInteger(range.start) &&
				Number.isInteger(range.end) &&
				range.start > 0 &&
				range.end >= range.start,
		)

	if (directRanges.length > 0) {
		return mergeRanges(directRanges)
	}

	const head =
		normalizePositiveInt(primarySource?.head) ??
		normalizePositiveInt(fallbackSource?.head)
	if (head !== undefined) {
		return [{ start: 1, end: head }]
	}

	const extractedFromResult = extractRangesFromToolResult(toolResultBlock)
	if (extractedFromResult.length > 0) {
		return extractedFromResult
	}

	return undefined
}
