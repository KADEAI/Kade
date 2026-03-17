import { defineConfig } from "vitest/config"

// kade_change start
const isCI = process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.CI)

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		reporters: isCI ? ["verbose"] : ["default"],
	},
})
// kade_change end
