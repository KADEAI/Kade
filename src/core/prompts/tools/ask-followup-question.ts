export function getAskFollowupQuestionDescription(): string {
	return `## ask_followup_question
Description: Ask the user a question to gather additional information or clarification. Use this to maintain an active dialogue and ensure you have the necessary details to proceed effectively with the current request.

Parameters:
- question: (required) A clear, specific question addressing the information needed
- follow_up: (optional) A list of 2-4 suggested answers, each in its own <suggest> tag. Suggestions must be complete, actionable answers without placeholders. Optionally include mode attribute to switch modes (code/architect/etc.)

Usage:
<ask_followup_question>
<question>Your question here</question>
<follow_up>
<suggest>First suggestion</suggest>
<suggest mode="code">Action with mode switch</suggest>
</follow_up>
</ask_followup_question>

Example:
<question>What is the path to the frontend-config.json file?</question>
<follow_up>
<suggest>./src/frontend-config.json</suggest>
<suggest>./config/frontend-config.json</suggest>
<suggest>./frontend-config.json</suggest>
</follow_up>
</ask_followup_question>`
}
