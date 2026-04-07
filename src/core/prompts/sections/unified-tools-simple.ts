import { McpHub } from "../../../services/mcp/McpHub"
import { getUnifiedToolsPrompt as getStructuredUnifiedToolsPrompt } from "./unified-tools"

export function getUnifiedToolsPrompt(
  isIndexingEnabled: boolean = false,
  isBrowserEnabled: boolean = false,
  isComputerEnabled: boolean = false,
  isTodoEnabled: boolean = false,
  isSubAgentEnabled: boolean = false,
  mcpHub?: McpHub,
  disableBatchToolUse: boolean = false,
  maxToolCalls?: number
): string {
  return getStructuredUnifiedToolsPrompt(
    isIndexingEnabled,
    isBrowserEnabled,
    isComputerEnabled,
    isTodoEnabled,
    isSubAgentEnabled,
    mcpHub,
    disableBatchToolUse,
    maxToolCalls
  )
}

export const UNIFIED_TOOLS_PROMPT = getUnifiedToolsPrompt(false, false, false, true, true)
