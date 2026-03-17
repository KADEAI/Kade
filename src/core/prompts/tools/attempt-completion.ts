import { ToolArgs } from "./types"

export function getAttemptCompletionDescription(args?: ToolArgs): string {
	if (args?.compact) {
		return `## attempt_completion
Confirm the outcome and present the result.
<attempt_completion><result>...</result></attempt_completion>`
	}

	return `## attempt_completion
Description: After each tool use, the user will respond with the result, which you can use to inform your next steps. Once you've addressed the current request and can confirm the outcome, use this tool to present the result of your work. The user may respond with further feedback or new requests, which you can then address.
IMPORTANT NOTE: This tool should be used once you've confirmed that any previous actions were successful or have been discussed with the user. It marks the conclusion of the current response and invites further dialogue.
Parameters:
- result: (required) The result of your work. Formulate this result clearly and concisely. Briefly summarize what was accomplished or the information gathered.
Usage:
<attempt_completion>
<result>
Your final result description here
</result>
</attempt_completion>

Example: Requesting to attempt completion with a result
<attempt_completion>
<result>
I've updated the CSS
</result>
</attempt_completion>`
}
