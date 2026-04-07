import * as path from "path"

import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerCreateMessageMetadata } from "../../api"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { getTaskDirectoryPath } from "../../utils/storage"

export type RawApiRequestPayloadLog = {
	timestamp: string
	taskId: string
	retryAttempt: number
	provider: string
	modelId: string
	cwd: string
	systemPrompt: string
	metadata: ApiHandlerCreateMessageMetadata
	messages: Anthropic.Messages.MessageParam[]
}

export async function saveRawApiRequestPayload({
	globalStoragePath,
	payload,
}: {
	globalStoragePath: string
	payload: RawApiRequestPayloadLog
}): Promise<string> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, payload.taskId)
	const timestamp = payload.timestamp.replace(/[:.]/g, "-")
	const suffix = Math.random().toString(36).slice(2, 8)
	const filePath = path.join(taskDir, `raw_api_payload_${timestamp}-attempt-${payload.retryAttempt}-${suffix}.json`)
	const latestFilePath = path.join(taskDir, "raw_api_payload_latest.json")

	await safeWriteJson(filePath, payload)
	await safeWriteJson(latestFilePath, payload)

	return filePath
}
