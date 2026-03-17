import { Tool } from "./converters"

const ASK_FOLLOWUP_QUESTION_DESCRIPTION = "Ask a question to clarify user intent. Provide 2-4 actionable 'follow_up' suggestions."

export const ask_followup_question: Tool = {
	name: "ask_followup_question",
	description: ASK_FOLLOWUP_QUESTION_DESCRIPTION,
	params: {
		question: "Clear, specific question that captures the missing information you need",
		follow_up: {
			type: "array",
			description:
				"Required list of 2-4 suggested responses; each suggestion must be a complete, actionable answer and may include a mode switch",
			items: {
				type: "object",
				properties: {
					text: {
						type: "string",
						description: "Suggested answer the user can pick",
					},
					mode: {
						type: ["string", "null"],
						description: "Optional mode slug to switch to if this suggestion is chosen (e.g., code, architect)",
					},
				},
				required: ["text", "mode"],
				additionalProperties: false,
			},
		},
	},
	required: ["question", "follow_up"],
}

export default ask_followup_question
