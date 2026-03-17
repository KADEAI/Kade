import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import "@vscode/codicons/dist/codicon.css"
import "./codicon-custom.css" // kade_change
import "katex/dist/katex.min.css"

import { getHighlighter } from "./utils/highlighter"

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

// Suppress noisy react-virtuoso "Zero-sized element" warnings (benign — caused by hidden/collapsed chat rows)
const shouldSuppressVirtuosoWarning = (args: any[]) =>
	args.some((arg) =>
		(typeof arg === "string" && arg.includes("Zero-sized element")) ||
		(arg instanceof Error && arg.message.includes("Zero-sized element")) ||
		(typeof arg?.message === "string" && arg.message.includes("Zero-sized element")),
	)

for (const method of ["log", "warn", "error"] as const) {
	const orig = console[method]
	console[method] = (...args: any[]) => {
		if (shouldSuppressVirtuosoWarning(args)) return
		orig.apply(console, args)
	}
}

console.log("Mounting App...")
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
