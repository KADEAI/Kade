import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Provider, createStore } from "jotai"
import { SessionSidebar } from "../SessionSidebar"
import {
	selectedSessionIdAtom,
	sessionsMapAtom,
	sessionOrderAtom,
	type AgentSession,
} from "../../state/atoms/sessions"
import {
	manualFoldersAtom,
	selectedFolderIdAtom,
} from "../../state/atoms/workspaces"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock vscode postMessage
const postMessageMock = vi.fn()
vi.mock("../../utils/vscode", () => ({
	vscode: {
		postMessage: (...args: any[]) => postMessageMock(...args),
	},
}))

describe("SessionSidebar", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const renderSidebar = (store = createStore()) => {
		return render(
			<Provider store={store}>
				<SessionSidebar />
			</Provider>,
		)
	}

	it("renders workspace folders correctly", () => {
		const store = createStore()
		
		// Set up manual folders
		store.set(manualFoldersAtom, [
			{ id: "folder-1", name: "Project A", path: "/path/to/a", gitUrl: "git@a", isManual: true }
		])

		renderSidebar(store)

		expect(screen.getByText("Project A")).toBeInTheDocument()
	})

	it("calls handleNewSession with folder ID when clicking plus button on a folder", () => {
		const store = createStore()
		
		// Set up manual folders
		store.set(manualFoldersAtom, [
			{ id: "folder-1", name: "Project A", path: "/path/to/a", gitUrl: "git@a", isManual: true }
		])
		
		renderSidebar(store)

		const addButton = screen.getByTitle("Start conversation in workspace")
		fireEvent.click(addButton)

		// Check if selectedFolderIdAtom was updated
		expect(store.get(selectedFolderIdAtom)).toBe("folder-1")
		// Check if selectedSessionIdAtom was cleared
		expect(store.get(selectedSessionIdAtom)).toBeNull()
	})

	it("calls handleNewSession with null when clicking New Agent button", () => {
		const store = createStore()
		store.set(manualFoldersAtom, [])
		
		renderSidebar(store)

		const newAgentButton = screen.getByText("sidebar.newAgent")
		fireEvent.click(newAgentButton)

		expect(store.get(selectedFolderIdAtom)).toBeNull()
		expect(store.get(selectedSessionIdAtom)).toBeNull()
	})
})
