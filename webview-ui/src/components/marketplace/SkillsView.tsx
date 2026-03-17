import { useState, useEffect } from "react"
import { vscode } from "@/utils/vscode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Skill {
	name: string
	source: string
	skillId: string
	installs: number
	description?: string
}

interface SkillsViewProps {
	onDone?: () => void
	hideHeader?: boolean
}

const getSkillUrl = (skill: Skill) => `https://skills.sh/${skill.source}/${skill.skillId}`
const getRepoUrl = (source: string) => `https://github.com/${source}`

export function SkillsView({ onDone, hideHeader = false }: SkillsViewProps) {
	const [skills, setSkills] = useState<Skill[]>([])
	const [filteredSkills, setFilteredSkills] = useState<Skill[]>([])
	const [searchQuery, setSearchQuery] = useState("")
	const [isLoading, setIsLoading] = useState(true)
	const [isSearching, setIsSearching] = useState(false)
	const [installingSkills, setInstallingSkills] = useState<Set<string>>(new Set())
	const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set())
	const [currentPage, setCurrentPage] = useState(1)
	const skillsPerPage = 50

	useEffect(() => {
		// Fetch initial skills
		vscode.postMessage({ type: "fetchSkills" })

		// Listen for skills data
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			
			if (message.type === "skillsData") {
				setSkills(message.skills || [])
				setFilteredSkills(message.skills || [])
				setIsLoading(false)
			} else if (message.type === "skillsSearchResults") {
				setFilteredSkills(message.skills || [])
				setIsSearching(false)
			} else if (message.type === "skillInstallResult") {
				const skillKey = `${message.skillSource}@${message.skillId}`
				setInstallingSkills(prev => {
					const next = new Set(prev)
					next.delete(skillKey)
					return next
				})
				
				if (message.success) {
					setInstalledSkills(prev => new Set(prev).add(skillKey))
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleSearch = (query: string) => {
		setSearchQuery(query)
		setCurrentPage(1)
		
		if (!query.trim()) {
			setFilteredSkills(skills)
			return
		}

		setIsSearching(true)
		vscode.postMessage({ 
			type: "searchSkills",
			query: query 
		})
	}

	const handleInstall = (skill: Skill) => {
		const skillKey = `${skill.source}@${skill.skillId}`
		setInstallingSkills(prev => new Set(prev).add(skillKey))
		
		vscode.postMessage({
			type: "installSkill",
			skillSource: skill.source,
			skillId: skill.skillId
		})
	}

	const startIdx = (currentPage - 1) * skillsPerPage
	const endIdx = startIdx + skillsPerPage
	const skillsToShow = filteredSkills.slice(startIdx, endIdx)
	const totalPages = Math.ceil(filteredSkills.length / skillsPerPage)

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<Loader2 className="w-8 h-8 animate-spin" />
				<span className="ml-2">Loading skills...</span>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			{!hideHeader && (
				<div className="flex justify-between items-center p-4 border-b">
					<h2 className="text-2xl font-bold">Skills Marketplace</h2>
					<Button onClick={onDone}>Done</Button>
				</div>
			)}

			<div className="p-4 space-y-4">
				<div className="p-4 rounded-xl bg-vscode-textBlock-background/30 border border-vscode-panel-border/50 backdrop-blur-sm relative overflow-hidden group">
					<div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-colors" />
					<div className="relative z-10 flex items-start gap-3">
						<div className="mt-0.5 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
							<span className="codicon codicon-sparkle text-primary animate-pulse" />
						</div>
						<p className="text-sm text-vscode-descriptionForeground m-0 leading-relaxed">
							Install <span className="text-vscode-foreground font-semibold">75,000+</span> skills from{" "}
							<button
								className="text-primary hover:text-primary/80 font-bold underline decoration-primary/30 underline-offset-4 cursor-pointer transition-colors"
								onClick={() => vscode.postMessage({ type: "openExternal", url: "https://skills.sh/" })}>
								skills.sh
							</button>{" "}
							directly. Browse popular installs and add new capabilities to Kade without leaving the marketplace.
						</p>
					</div>
				</div>

				<div className="flex gap-2">
					<div className="relative flex-1">
						<Input
							placeholder="🔍 Search skills..."
							value={searchQuery}
							onChange={(e) => handleSearch(e.target.value)}
						/>
					</div>
					{isSearching && <Loader2 className="w-5 h-5 animate-spin self-center" />}
				</div>

				<div className="grid grid-cols-1 min-[560px]:grid-cols-2 min-[840px]:grid-cols-3 gap-4">
					{skillsToShow.map((skill) => {
						const skillKey = `${skill.source}@${skill.skillId}`
						const isInstalling = installingSkills.has(skillKey)
						const isInstalled = installedSkills.has(skillKey)
						const skillUrl = getSkillUrl(skill)
						const repoUrl = getRepoUrl(skill.source)
						return (
							<div 
								key={skillKey}
								className="border rounded-lg p-4 bg-vscode-sideBar-background hover:bg-vscode-list-hoverBackground transition-colors"
							>
								<div className="mb-3">
									<div className="flex items-center gap-2 mb-2">
										<button
											className="text-lg font-semibold text-left hover:text-vscode-textLink-foreground transition-colors"
											onClick={() => vscode.postMessage({ type: "openExternal", url: skillUrl })}>
											{skill.name}
										</button>
										<button
											className="codicon codicon-link-external text-vscode-textLink-foreground opacity-80 hover:opacity-100 transition-opacity"
											aria-label={`Open ${skill.name}`}
											onClick={() => vscode.postMessage({ type: "openExternal", url: skillUrl })}
										/>
									</div>
									<div className="text-sm text-vscode-descriptionForeground space-y-1">
										<div>
											📦{" "}
											<button
												className="hover:text-vscode-textLink-foreground transition-colors"
												onClick={() => vscode.postMessage({ type: "openExternal", url: repoUrl })}>
												{skill.source}
											</button>
										</div>
										<div>
											⬇️{" "}
											<button
												className="hover:text-vscode-textLink-foreground transition-colors"
												onClick={() => vscode.postMessage({ type: "openExternal", url: skillUrl })}>
												{skill.installs.toLocaleString()} installs
											</button>
										</div>
									</div>
								</div>
								<Button
									className="w-full"
									onClick={() => handleInstall(skill)}
									disabled={isInstalling || isInstalled}
									variant={isInstalled ? "secondary" : "primary"}
								>
									{isInstalling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
									{isInstalled ? "✓ Installed" : isInstalling ? "Installing..." : "Install"}
								</Button>
							</div>
						)
					})}
				</div>

				{totalPages > 1 && (
					<div className="flex flex-wrap justify-center items-center gap-2 mt-6">
						<Button
							variant="outline"
							onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
							disabled={currentPage === 1}
						>
							← Previous
						</Button>
						{Array.from({ length: Math.min(totalPages, 50) }, (_, i) => i + 1).map((page) => (
							<Button
								key={page}
								size="sm"
								variant={page === currentPage ? "primary" : "outline"}
								className={cn("min-w-8 px-2", page > totalPages && "hidden")}
								onClick={() => setCurrentPage(page)}>
								{page}
							</Button>
						))}
						<Button
							variant="outline"
							onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
							disabled={currentPage === totalPages}
						>
							Next →
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
