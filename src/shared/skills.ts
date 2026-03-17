export interface Skill {
	name: string
	source: string
	skillId: string
	installs: number
	description?: string
}

export interface InstalledSkill {
	id: string
	name: string
	path: string
	content?: string
}

export interface SkillSearchResult {
	skills: Skill[]
	query: string
}