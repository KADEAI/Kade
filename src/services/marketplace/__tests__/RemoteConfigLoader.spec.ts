// npx vitest services/marketplace/__tests__/RemoteConfigLoader.spec.ts

import axios from "axios"
import { RemoteConfigLoader } from "../RemoteConfigLoader"
import type { MarketplaceItemType } from "@roo-code/types"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

// Mock the cloud config
vi.mock("@roo-code/cloud", () => ({
	getRooCodeApiUrl: () => "https://test.api.com",
}))

// kade_change start
vi.mock("@roo-code/types", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@roo-code/types")>()
	return {
		...actual,
		getKiloBaseUriFromToken: () => "https://test.api.com",
	}
})
// kade_change end

describe("RemoteConfigLoader", () => {
	let loader: RemoteConfigLoader

	beforeEach(() => {
		loader = new RemoteConfigLoader()
		vi.clearAllMocks()
		// Clear any existing cache
		loader.clearCache()
		process.env.KILOCODE_BACKEND_BASE_URL = "https://test.api.com"
	})

	afterEach(() => {
		delete process.env.KILOCODE_BACKEND_BASE_URL
	})

	describe("loadAllItems", () => {
		it("includes the built-in orchestrator marketplace modes", async () => {
			mockedAxios.get.mockResolvedValue({ data: "items: []" })

			const items = await loader.loadAllItems()
			const modeIds = items.filter((item) => item.type === "mode").map((item) => item.id)

			expect(modeIds[0]).toBe("sub-agent-ops")
			expect(modeIds).toContain("sub-agent-ops")
			expect(modeIds).toContain("systems-strategist")
		})

		it("should fetch and combine modes and MCPs from API", async () => {
			const mockMcpsYaml = `items:
  - id: "test-mcp"
    name: "Test MCP"
    description: "A test MCP"
    url: "https://github.com/test/test-mcp"
    content: '{"command": "test"}'`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()
			const modeItems = items.filter((item) => item.type === "mode")

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://test.api.com/api/marketplace/mcps",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)

			expect(modeItems.length).toBeGreaterThan(0)
			expect(modeItems.some((item) => item.id === "frontend-expert")).toBe(true)
			expect(items[items.length - 1]).toEqual({
				type: "mcp",
				id: "test-mcp",
				name: "Test MCP",
				description: "A test MCP",
				url: "https://github.com/test/test-mcp",
				content: '{"command": "test"}',
			})
		})

		it("should use cache on subsequent calls", async () => {
			const mockMcpsYaml = `items:
  - id: "test-mcp"
    name: "Test MCP"
    description: "A test MCP"
    url: "https://github.com/test/test-mcp"
    content: "test content"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call - should hit API
			const items1 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			// Second call - should use cache
			const items2 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			expect(items1).toEqual(items2)
		})

		it("should retry on network failures", async () => {
			const mockMcpsYaml = `items: []`

			let mcpCallCount = 0
			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					mcpCallCount++
					if (mcpCallCount <= 2) {
						return Promise.reject(new Error("Network error"))
					}
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()

			expect(mcpCallCount).toBe(3)
			expect(items.some((item) => item.type === "mode")).toBe(true)
		})

		it("should throw error after max retries", async () => {
			mockedAxios.get.mockRejectedValue(new Error("Persistent network error"))

			await expect(loader.loadAllItems()).rejects.toThrow("Persistent network error")

			// Both endpoints will be called with retries since Promise.all starts both promises
			// Each endpoint retries 3 times, but due to Promise.all behavior, one might fail faster
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/api/marketplace/"),
				expect.any(Object),
			)
			// Verify we got at least some retry attempts (should be at least 2 calls)
			expect(mockedAxios.get.mock.calls.length).toBeGreaterThanOrEqual(2)
		})

		it("should handle invalid data gracefully", async () => {
			const invalidMcpsYaml = `items:
  - id: "invalid-mcp"
    name: "Invalid MCP"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: invalidMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			await expect(loader.loadAllItems()).rejects.toThrow()
		})
	})

	describe("getItem", () => {
		it("should find specific item by id and type", async () => {
			const mockMcpsYaml = `items:
  - id: "target-mcp"
    name: "Target MCP"
    description: "The MCP we want"
    url: "https://github.com/test/test-mcp"
    content: "test content"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const modeItem = await loader.getItem("sub-agent-ops", "mode" as MarketplaceItemType)
			const mcpItem = await loader.getItem("target-mcp", "mcp" as MarketplaceItemType)
			const notFound = await loader.getItem("nonexistent", "mode" as MarketplaceItemType)

			expect(modeItem).toMatchObject({
				type: "mode",
				id: "sub-agent-ops",
				name: "Sub Agent Ops",
			})

			expect(mcpItem).toEqual({
				type: "mcp",
				id: "target-mcp",
				name: "Target MCP",
				description: "The MCP we want",
				url: "https://github.com/test/test-mcp",
				content: "test content",
			})

			expect(notFound).toBeNull()
		})
	})

	describe("clearCache", () => {
		it("should clear cache and force fresh API calls", async () => {
			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			// Second call - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			// Clear cache
			loader.clearCache()

			// Third call - should hit API again
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)
		})
	})

	describe("cache expiration", () => {
		it("should expire cache after 5 minutes", async () => {
			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Mock Date.now to control time
			const originalDateNow = Date.now
			let currentTime = 1000000

			Date.now = vi.fn(() => currentTime)

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			// Second call immediately - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)

			// Advance time by 6 minutes (360,000 ms)
			currentTime += 6 * 60 * 1000

			// Third call - cache should be expired
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Restore original Date.now
			Date.now = originalDateNow
		})
	})
})
