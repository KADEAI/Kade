export function buildBatchChildToolCallId(
	parentToolCallId: string | undefined,
	index: number,
	childName: string,
): string | undefined {
	if (!parentToolCallId) {
		return undefined
	}

	return `${parentToolCallId}::${childName}:${index}`
}
