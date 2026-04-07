import type OpenAI from "openai";
import type { Tool } from "./converters";
import {
  tool,
} from "./registry";

export { getMcpServerTools } from "./mcp_server";
export {
  convertOpenAIToolToAnthropic,
  convertOpenAIToolsToAnthropic,
} from "./converters";
export * from "./registry";

/**
 * Get native tools array, optionally customizing based on settings.
 */
export function getNativeTools(
  _partialReadsEnabled: boolean = true,
  _enableSubAgents: boolean = false,
  _enableBatch: boolean = false,
): any[] {
  const nativeTools: (Tool | OpenAI.Chat.ChatCompletionTool)[] = [
    tool,
  ];

  // We return the tools exactly as defined.
  // No more OpenAI boilerplate wrappers.
  return nativeTools;
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools(true);
