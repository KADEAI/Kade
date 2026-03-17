import React from "react"
import { createRoot } from "react-dom/client"
import { GroupChatApp } from "./components/GroupChatApp"
import "../../index.css"
import "./components/GroupChatApp.css"

// Ensure we wait for DOM load
window.addEventListener('DOMContentLoaded', () => {
	const rootElement = document.getElementById("root")
	if (rootElement) {
		const root = createRoot(rootElement)
		root.render(
			<React.StrictMode>
				<GroupChatApp />
			</React.StrictMode>,
		)
	}
})

