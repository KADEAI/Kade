import { Tool } from "./converters"

const GENERATE_IMAGE_DESCRIPTION = "Generate or edit an image from text prompts. Provide a 'path' to save the output and an optional 'image' path to modify an existing one."

export const generate_image: Tool = {
	name: "generate_image",
	description: GENERATE_IMAGE_DESCRIPTION,
	params: {
		prompt: "Text description for generation or edit.",
		path: "Path to save the resulting image.",
		image: "Optional: Path to an existing image to edit.",
	},
	required: ["prompt", "path"],
}

export default generate_image
