import { Tool } from "./converters"

const BROWSER_ACTION_DESCRIPTION = "Interact with a browser via Puppeteer. Launch, click, hover, type, scroll, resize, close, or screenshot. Capture and analyze visual/logical state. Only one action per message."

export const browser_action: Tool = {
	name: "browser_action",
	description: BROWSER_ACTION_DESCRIPTION,
	strict: false,
	params: {
		action: {
			type: "string",
			description: "Browser action to perform",
			enum: [
				"launch",
				"click",
				"hover",
				"type",
				"press",
				"scroll_down",
				"scroll_up",
				"resize",
				"close",
				"screenshot",
			],
		},
		url: {
			type: ["string", "null"],
			description: "URL to open when performing the launch action; must include protocol",
		},
		coordinate: {
			type: ["string", "null"],
			description:
				"Screen coordinate for hover or click actions in format 'x,y@WIDTHxHEIGHT' where x,y is the target position on the screenshot image and WIDTHxHEIGHT is the exact pixel dimensions of the screenshot image (not the browser viewport). Example: '450,203@900x600' means click at (450,203) on a 900x600 screenshot. The coordinates will be automatically scaled to match the actual viewport dimensions.",
		},
		size: {
			type: ["string", "null"],
			description: "Viewport dimensions for the resize action in format 'WIDTHxHEIGHT' or 'WIDTH,HEIGHT'. Example: '1280x800' or '1280,800'",
		},
		text: {
			type: ["string", "null"],
			description: "Text to type when performing the type action, or key name to press when performing the press action (e.g., 'Enter', 'Tab', 'Escape')",
		},
		path: {
			type: ["string", "null"],
			description: "File path where the screenshot should be saved (relative to workspace). Required for screenshot action. Supports .png, .jpeg, and .webp extensions. Example: 'screenshots/result.png'",
		},
	},
	required: ["action"],
}

export default browser_action
