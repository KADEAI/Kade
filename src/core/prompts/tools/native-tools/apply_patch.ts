import { Tool } from "./converters"

const apply_patch_DESCRIPTION = "Apply multi-file patches using '*** Add/Delete/Update File: <path>' headers. For updates, use '@@ context' followed by space/+/ - lines (diff format). Wrap in '*** Begin/End Patch'."

export const apply_patch: Tool = {
	name: "apply_patch",
	description: apply_patch_DESCRIPTION,
	params: {
		patch: "The complete patch text in the apply_patch format, starting with '*** Begin Patch' and ending with '*** End Patch'.",
	},
}

export default apply_patch
