import { mentionRegexGlobal } from "@roo/context-mentions"

import { vscode } from "../../utils/vscode"

interface MentionProps {
	text?: string
	withShadow?: boolean
}

export const Mention = ({ text, withShadow = false }: MentionProps) => {
	if (!text) {
		return <>{text}</>
	}

	const parts = text.split(mentionRegexGlobal).map((part, index) => {
		if (index % 2 === 0) {
			// This is regular text.
			return part
		} else {
			// This is a mention.
			return (
				<span
					key={index}
					className={`${withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} text-[0.9em] cursor-pointer`}
					onClick={() => {
						// kade_change: Strip leading slash for workspace-relative paths to fix Mac compatibility
						const mentionPath = part.startsWith("/") ? part.substring(1) : part
						vscode.postMessage({ type: "openMention", text: mentionPath })
					}}>
					@{part}
				</span>
			)
		}
	})

	return <>{parts}</>
}
