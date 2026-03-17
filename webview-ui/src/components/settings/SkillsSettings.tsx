import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Section } from "./Section"
import { Info, Loader2, Search } from "lucide-react"
import { StandardTooltip } from "../ui"
import { vscode } from "@/utils/vscode"

interface InstalledSkill {
	id: string
	name: string
	path: string
	description?: string
}

interface SkillsSettingsProps {
	enabledSkills?: string[]
	setCachedStateField: (field: "enabledSkills", value: string[]) => void
}

export const SkillsSettings = ({ enabledSkills = [], setCachedStateField }: SkillsSettingsProps) => {
	const { t } = useAppTranslation()
	const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
	const [filteredSkills, setFilteredSkills] = useState<InstalledSkill[]>([])
	const [localEnabledSkills, setLocalEnabledSkills] = useState<string[]>(enabledSkills)
	const [searchQuery, setSearchQuery] = useState("")
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		// Fetch installed skills on mount
		vscode.postMessage({ type: "fetchInstalledSkills" })

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "installedSkillsData") {
				const skills = message.installedSkills || []
				setInstalledSkills(skills)
				setFilteredSkills(skills)
				setLocalEnabledSkills(message.enabledSkills || [])
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleToggleSkill = (skillId: string) => {
		const newEnabledSkills = localEnabledSkills.includes(skillId)
			? localEnabledSkills.filter(id => id !== skillId)
			: [...localEnabledSkills, skillId]
		
		setLocalEnabledSkills(newEnabledSkills)
		setCachedStateField("enabledSkills", newEnabledSkills)
	}

	const handleSearch = (query: string) => {
		setSearchQuery(query)
		if (!query.trim()) {
			setFilteredSkills(installedSkills)
			return
		}
		const lowerQuery = query.toLowerCase()
		const filtered = installedSkills.filter(skill => 
			skill.name.toLowerCase().includes(lowerQuery) ||
			skill.description?.toLowerCase().includes(lowerQuery) ||
			skill.id.toLowerCase().includes(lowerQuery)
		)
		setFilteredSkills(filtered)
	}

	return (
		<div className="flex flex-col gap-6">
			<Section title="Skills">
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<span className="text-sm text-vscode-descriptionForeground">
							Enable the skills you want the agent to know are available. Enabled skills are exposed as an on-demand registry, and the agent can open each skill's <code>SKILL.md</code> only when it is relevant.
						</span>
						<StandardTooltip content="Skills are AI agent capabilities installed from skills.sh. Enabling a skill makes the agent aware of it and its path, without eagerly injecting the whole skill into the system prompt.">
							<Info className="size-3.5 text-vscode-descriptionForeground cursor-help" />
						</StandardTooltip>
					</div>

					<div>
						<VSCodeButton
							appearance="secondary"
							onClick={() =>
									window.postMessage(
										{
											type: "action",
											action: "marketplaceButtonClicked",
											values: { marketplaceTab: "skills" },
										},
										"*",
									)
								}>
								Open Skills Marketplace
							</VSCodeButton>
						</div>

					{installedSkills.length > 0 && (
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-vscode-descriptionForeground pointer-events-none z-10" />
							<input
								type="text"
								value={searchQuery}
								placeholder="Search skills..."
								onChange={(e) => handleSearch(e.target.value)}
								className="w-full h-10 rounded-md border border-[color:var(--vscode-input-border)] bg-[color:var(--vscode-input-background)] text-[color:var(--vscode-input-foreground)] placeholder:text-[color:var(--vscode-input-placeholderForeground)] pl-10 pr-3 outline-none focus:border-[color:var(--vscode-focusBorder)]"
							/>
						</div>
					)}

					{isLoading ? (
						<div className="flex items-center gap-2 text-sm text-vscode-descriptionForeground">
							<Loader2 className="w-4 h-4 animate-spin" />
							<span>Loading installed skills...</span>
						</div>
					) : filteredSkills.length === 0 && searchQuery ? (
						<div className="bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-lg p-4">
							<p className="text-sm text-vscode-descriptionForeground">
								No skills found matching "{searchQuery}".
							</p>
						</div>
					) : installedSkills.length === 0 ? (
						<div className="bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-lg p-4">
							<p className="text-sm text-vscode-descriptionForeground">
								No skills installed yet. Visit the Skills tab in the Marketplace to browse and install skills.
							</p>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							{filteredSkills
								.sort((a, b) => {
									const aEnabled = localEnabledSkills.includes(a.id)
									const bEnabled = localEnabledSkills.includes(b.id)
									if (aEnabled && !bEnabled) return -1
									if (!aEnabled && bEnabled) return 1
									return a.name.localeCompare(b.name)
								})
								.map((skill) => {
									const isEnabled = localEnabledSkills.includes(skill.id)
								return (
									<div
										key={skill.id}
										className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 flex flex-col gap-2"
									>
										<div className="flex items-center gap-2">
											<VSCodeCheckbox
												checked={isEnabled}
												onChange={() => handleToggleSkill(skill.id)}
											>
												<span className="font-medium text-sm">{skill.name}</span>
											</VSCodeCheckbox>
										</div>
										<div className="text-xs text-vscode-descriptionForeground ml-6">
											{skill.path}
										</div>
										<div className="ml-6 mt-2">
											<button
												type="button"
												onClick={() => vscode.postMessage({ type: "openFile", text: `${skill.path}/SKILL.md` })}
												className="text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground"
											>
												Open SKILL.md
											</button>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
