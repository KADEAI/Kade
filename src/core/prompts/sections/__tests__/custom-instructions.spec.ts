import { describe, expect, it } from "vitest"

import { stripInactiveSkillsInstructions } from "../custom-instructions"

describe("stripInactiveSkillsInstructions", () => {
	it("removes the skills section when no skills are enabled", () => {
		const content = `# Repo Rules

Keep responses concise.

## Skills

### Available skills
- foo
- bar

### How to use skills
- read SKILL.md

## Current Mode

Code mode details.`

		expect(stripInactiveSkillsInstructions(content, [])).toBe(`# Repo Rules

Keep responses concise.

## Current Mode

Code mode details.`)
	})

	it("keeps the skills section when skills are enabled", () => {
		const content = `# Repo Rules

## Skills

- foo`

		expect(stripInactiveSkillsInstructions(content, ["foo"])).toBe(content)
	})
})
