
import { atom } from "jotai"
import { mergedSessionsAtom, type AgentSession } from "./sessions"

/**
 * Workspace folder definition
 */
export interface WorkspaceFolder {
    id: string
    name: string
    isManual?: boolean
    gitUrl?: string
    path?: string
}

/**
 * Atom to store manual folders created by the user.
 * Initialized from empty array, but should be persisted.
 */
export const manualFoldersAtom = atom<WorkspaceFolder[]>([])

/**
 * Mapping of sessionId to manual folderId.
 */
export const sessionToFolderAtom = atom<Record<string, string>>({})

/**
 * Set of folderIds that are currently collapsed.
 */
export const collapsedFoldersAtom = atom<Set<string>>(new Set<string>())

/**
 * ID of the currently selected folder for a new session.
 */
export const selectedFolderIdAtom = atom<string | null>(null)

/**
 * Flag to track if the workspace config has been loaded from the extension.
 * Used to prevent overwriting the persisted config with initial empty state.
 */
export const workspaceConfigLoadedAtom = atom<boolean>(false)

/**
 * Helper to get project name from git URL
 */
function getProjectName(gitUrl: string): string {
    try {
        // Handle git URLs like https://github.com/user/repo.git or git@github.com:user/repo.git
        const parts = gitUrl.split(/[\\/:]/)
        const lastPart = parts[parts.length - 1].replace(/\.git$/, "")
        return lastPart || "Unknown Project"
    } catch {
        return "Unknown Project"
    }
}

/**
 * Grouped sessions for display in the sidebar.
 */
export interface GroupedSessions {
    folder: WorkspaceFolder
    sessions: AgentSession[]
}

/**
 * Derived atom that groups sessions into folders.
 */
export const groupedSessionsAtom = atom((get) => {
    const allSessions = get(mergedSessionsAtom)
    const manualFolders = get(manualFoldersAtom)
    const sessionToFolder = get(sessionToFolderAtom)

    const groupsMap: Record<string, AgentSession[]> = {}
    const foldersMap: Record<string, WorkspaceFolder> = {}

    // Initialize manual folders
    manualFolders.forEach((f) => {
        groupsMap[f.id] = []
        foldersMap[f.id] = f
    })

    // Initialize auto-git folders from sessionToFolder config if they look like auto-git
    // This ensures that even if we haven't seen the session yet, we respect the folder structure
    Object.values(sessionToFolder).forEach(folderId => {
        if (!groupsMap[folderId]) {
            groupsMap[folderId] = []
            // We don't have the name/gitUrl here, but we'll fill it in when we encounter the session
            // or fallback to ID
            const isAutoGit = folderId.startsWith('auto-git-')
            foldersMap[folderId] = { id: folderId, name: isAutoGit ? "Loading..." : "Unknown Folder" }
        }
    })

    // Add default "Inbox" folder
    const INBOX_ID = "inbox"
    groupsMap[INBOX_ID] = []
    foldersMap[INBOX_ID] = { id: INBOX_ID, name: "Inbox" }

    allSessions.forEach((session) => {
        // 1. Check if manually moved to a folder
        // Prioritize sessionToFolder mapping to handle session ID changes (provisional -> real)
        // or renames, ensuring they stick to the assigned folder.
        const manualFolderId = sessionToFolder[session.sessionId]
        if (manualFolderId) {
            // Even if the folder definition isn't fully loaded yet (e.g. race condition),
            // we trust the ID mapping and force it into that group.
            if (!groupsMap[manualFolderId]) {
                groupsMap[manualFolderId] = []
                // If it's a manual folder ID (not auto-git), we might need a placeholder
                if (!manualFolderId.startsWith("auto-git-") && manualFolderId !== "inbox") {
                    foldersMap[manualFolderId] = { id: manualFolderId, name: "Loading..." }
                }
            }
            groupsMap[manualFolderId].push(session)
            return
        }

        // 2. Auto-detect grouping by gitUrl
        if (session.gitUrl) {
            // Check if any manual folder has this gitUrl
            const matchingManualFolder = manualFolders.find((f) => f.gitUrl === session.gitUrl)
            if (matchingManualFolder) {
                groupsMap[matchingManualFolder.id].push(session)
                return
            }

            const projectName = getProjectName(session.gitUrl)
            const folderId = `auto-git-${session.gitUrl}`
            if (!groupsMap[folderId]) {
                groupsMap[folderId] = []
                foldersMap[folderId] = { id: folderId, name: projectName, gitUrl: session.gitUrl }
            } else if (foldersMap[folderId].name === "Loading...") {
                // Update placeholder with real details
                foldersMap[folderId] = { id: folderId, name: projectName, gitUrl: session.gitUrl }
            }
            groupsMap[folderId].push(session)
            return
        }

        // 3. Fallback to Inbox
        groupsMap[INBOX_ID].push(session)
    })

    // Convert map to sorted array of groups
    // Order: Inbox first, then manual folders, then auto-detected git projects
    const result: GroupedSessions[] = []

    // Inbox if not empty
    if (groupsMap[INBOX_ID].length > 0) {
        result.push({ folder: foldersMap[INBOX_ID], sessions: groupsMap[INBOX_ID] })
    }

    // Manual folders
    manualFolders.forEach((f) => {
        result.push({ folder: f, sessions: groupsMap[f.id] || [] })
    })

    // Also include any placeholder manual folders that were created on the fly
    Object.values(foldersMap).forEach(f => {
        if (!f.id.startsWith("auto-git-") && f.id !== INBOX_ID && !manualFolders.find(mf => mf.id === f.id)) {
            result.push({ folder: f, sessions: groupsMap[f.id] || [] })
        }
    })

    // Auto-git folders (sorted by name)
    const gitFolders = Object.values(foldersMap)
        .filter((f) => f.id.startsWith("auto-git-"))
        .sort((a, b) => a.name.localeCompare(b.name))

    gitFolders.forEach((f) => {
        // Only add if there are sessions or if it's explicitly in sessionToFolder
        // (This prevents "Loading..." empty folders from showing up if no sessions actually load)
        if (groupsMap[f.id].length > 0) {
            result.push({ folder: f, sessions: groupsMap[f.id] })
        }
    })

    return result
})
