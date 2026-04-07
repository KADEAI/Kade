import { ToolArgs } from "./types"

export function getComputerActionDescription(args: ToolArgs): string | undefined {
	if (!args.supportsComputerUse) {
		return undefined
	}
	if (args.compact) {
		return `## computer_action
Control the desktop with keyboard, mouse, and screenshots. Actions: key, type, mouse_move, left_click, left_click_drag, right_click, middle_click, double_click, scroll, get_screenshot, get_cursor_position.
<computer_action><action>...</action><coordinate>x,y@widthxheight</coordinate><text>...</text></computer_action>`
	}
	return `## computer_action
Description: Control the user's desktop directly with mouse, keyboard, scrolling, cursor inspection, and screenshots. Use this when you need real computer use outside the built-in browser tool. This requires a local GUI session and OS input/screen-capture permissions, and is most reliable on macOS and Linux desktop sessions.

Parameters:
- action: (required) The desktop action to perform:
    * key: Press a key or key combination such as Enter, Tab, Escape, Cmd+K, Ctrl+C, Shift+Enter.
    * type: Type a string of text.
    * mouse_move: Move the cursor to a coordinate.
    * left_click: Left-click, optionally moving to the provided coordinate first.
    * left_click_drag: Click and drag to the provided coordinate.
    * right_click: Right-click, optionally moving first.
    * middle_click: Middle-click, optionally moving first.
    * double_click: Double-click, optionally moving first.
    * scroll: Scroll at a coordinate. Use the text field with a direction like up, down, left, right, or direction with amount such as down:500.
    * get_screenshot: Capture the current desktop and return it with a red cursor crosshair.
    * get_cursor_position: Return the current cursor position.
- coordinate: (optional) Coordinate in screenshot space for mouse actions.
    * Preferred format after get_screenshot: plain normalized grid coordinates, <coordinate>x,y</coordinate>, where both values are in the 0-1000 range.
    * Example: <coordinate>500,500</coordinate> means the center of the screen.
    * The screenshot includes a normalized 0-1000 grid overlay, so you can click using those visible labels directly.
    * Explicit screenshot-space coordinates are also supported as <coordinate>x,y@widthxheight</coordinate>.
- text: (optional) Used by key, type, and scroll.
    * key examples: <text>Enter</text>, <text>Cmd+K</text>, <text>Shift+Enter</text>
    * type example: <text>Hello, world!</text>
    * scroll examples: <text>down</text>, <text>down:500</text>, <text>left:200</text>

Usage:
<computer_action>
<action>get_screenshot</action>
</computer_action>

<computer_action>
<action>left_click</action>
<coordinate>450,300@1024x768</coordinate>
</computer_action>

<computer_action>
<action>key</action>
<text>Cmd+K</text>
</computer_action>`
}
