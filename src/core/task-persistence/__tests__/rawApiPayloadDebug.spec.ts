import { beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const hoisted = vi.hoisted(() => ({
	safeWriteJsonMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: hoisted.safeWriteJsonMock,
}))

import { saveRawApiRequestPayload } from "../rawApiPayloadDebug"

let tmpBaseDir: string

beforeEach(async () => {
	hoisted.safeWriteJsonMock.mockClear()
	tmpBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-"))
})

describe("rawApiPayloadDebug.saveRawApiRequestPayload", () => {
	it("persists the raw API request payload under the task debug logs directory", async () => {
		const payload = {
			timestamp: "2026-03-20T10:11:12.345Z",
			taskId: "task-raw-1",
			retryAttempt: 2,
			provider: "openrouter",
			modelId: "test-model",
			cwd: "/workspace/project",
			systemPrompt: "You are helpful.",
			metadata: {
				taskId: "task-raw-1",
				mode: "code",
			},
			messages: [{ role: "user" as const, content: "hello" }],
		}

		const filePath = await saveRawApiRequestPayload({
			globalStoragePath: tmpBaseDir,
			payload,
		})

		expect(filePath).toContain(path.join("tasks", "task-raw-1", "raw_api_payload_"))
		expect(filePath).toContain("attempt-2")
		expect(hoisted.safeWriteJsonMock).toHaveBeenCalledTimes(2)
		expect(hoisted.safeWriteJsonMock).toHaveBeenCalledWith(filePath, payload)
		expect(hoisted.safeWriteJsonMock).toHaveBeenCalledWith(
			path.join(tmpBaseDir, "tasks", "task-raw-1", "raw_api_payload_latest.json"),
			payload,
		)
	})
})
