import { useState, useEffect } from "react"

export const useVSCodeTheme = () => {
	const [theme, setTheme] = useState<string | null>(null)

	const getTheme = () => {
		if (typeof document === "undefined" || !document.body) return null
		return document.body.getAttribute("data-vscode-theme-kind")
	}

	useEffect(() => {
		setTheme(getTheme())

		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.type === "attributes" && mutation.attributeName === "data-vscode-theme-kind") {
					setTheme(getTheme())
				}
			})
		})

		if (document.body) {
			observer.observe(document.body, { attributes: true, attributeFilter: ["data-vscode-theme-kind"] })
		}

		return () => observer.disconnect()
	}, [])

	return theme
}
