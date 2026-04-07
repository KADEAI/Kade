# JSON Tool System

This document explains how native JSON tool calling works in this repository today.

It is an internal maintainer reference, not end-user documentation.

## Purpose

The JSON tool system is the native function-calling path used when:

- the resolved tool protocol is `json`
- the selected model reports `supportsNativeTools: true`

When that happens, the app sends a tool manifest to the provider instead of relying on the markdown or unified text parsers as the primary tool interface.

## High-Level Flow

1. Tool definitions are declared in [src/core/prompts/tools/native-tools/registry.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/registry.ts).
2. The ordered native tool list is assembled in [src/core/prompts/tools/native-tools/index.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/index.ts).
3. Task runtime builds the full tool manifest in [src/core/task/build-tools.ts](/Users/imacpro/Documents/kilomain/src/core/task/build-tools.ts).
4. The active task attaches tools and native-tool metadata in [src/core/task/Task.ts](/Users/imacpro/Documents/kilomain/src/core/task/Task.ts).
5. Providers read `metadata.tools`, `metadata.tool_choice`, and `metadata.parallelToolCalls` from [src/api/index.ts](/Users/imacpro/Documents/kilomain/src/api/index.ts) and map them to provider-specific request fields.
6. Streaming tool call chunks are normalized by [src/core/assistant-message/NativeToolCallParser.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/NativeToolCallParser.ts).
7. The agent loop consumes those tool calls in [src/core/task/AgentLoop.ts](/Users/imacpro/Documents/kilomain/src/core/task/AgentLoop.ts).
8. Tool results are pushed back into conversation state by [src/core/assistant-message/presentAssistantMessage.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/presentAssistantMessage.ts).

## Source Of Truth

The single source of truth for native JSON tool definitions is:

- [src/core/prompts/tools/native-tools/registry.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/registry.ts)

That file contains:

- tool names
- descriptions
- parameter shapes
- required fields
- the exported `nativeToolRegistry` object

If you want to add, remove, rename, or reword a native JSON tool, start there.

## Edit Tool Shape

The native `edit` tool uses an array of edit blocks with stable keys.

Recommended shape:

```json
{
  "path": "src/file.ts",
  "edit": [
    {
      "lineRange": "10-12",
      "oldText": "foo()",
      "newText": "bar()"
    },
    {
      "lineRange": "20-25",
      "oldText": "baz()",
      "newText": "qux()"
    }
  ]
}
```

Notes:

- `lineRange` is required.
- `lineRange` is a hint in `"start-end"` form, not part of the `oldText` key.
- Matching should still be driven primarily by `oldText` and `newText`.

## Current Native Tool Set

The current native JSON tools are:

1. `read`
2. `edit`
3. `write`
4. `list`
5. `grep`
6. `glob`
7. `ask`
8. `bash`
9. `batch` when JSON batch tool use is enabled
10. `todo`
11. `web`
12. `agent` when sub-agents are enabled
13. `fetch`
14. `browser_action`
15. `access_mcp_resource`
16. `generate_image`

## Grep Compatibility

The native `grep` tool accepts both:

- `query`
- `pattern` as a compatibility alias

At execution time, `pattern` is normalized to `query`.

This exists because some providers and fallback raw tool-call emitters still send:

```xml
<tool_call><function=grep><parameter=pattern>fn main</parameter><parameter=path>.</parameter></function></tool_call>
```

Those wrapped calls should now be parsed into the same `grep` execution shape as a normal native JSON call.

Similar compatibility handling now exists for:

- `glob`, which accepts `query` as an alias for `pattern`
- `list`, which accepts legacy tool names like `list_dir` and `list_files`

This order is intentionally aligned with the markdown prompt tool order in [src/core/prompts/sections/markdown-tools.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/sections/markdown-tools.ts), with native-only extras appended afterward.

## Tool Ordering

The emitted array order lives in:

- [src/core/prompts/tools/native-tools/index.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/index.ts)

The `nativeToolRegistry` object in:

- [src/core/prompts/tools/native-tools/registry.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/registry.ts)

is kept in the same logical order so the source file reads the same way the manifest is emitted.

## Building The Manifest

The task runtime does not send every tool blindly.

The manifest is built in:

- [src/core/task/build-tools.ts](/Users/imacpro/Documents/kilomain/src/core/task/build-tools.ts)

That step:

- gets the base native tools from `getNativeTools()`
- filters them by mode restrictions
- filters dynamic MCP tools by mode restrictions
- returns one combined manifest

Important inputs:

- current mode
- custom modes
- experiments
- browser enablement
- diff settings
- sub-agent enablement
- MCP server availability

## When JSON Tools Are Sent

The decision happens in:

- [src/core/task/Task.ts](/Users/imacpro/Documents/kilomain/src/core/task/Task.ts)

JSON tools are only attached when:

- `toolProtocol === TOOL_PROTOCOL.JSON`
- `modelInfo.supportsNativeTools === true`

When true, task metadata includes:

- `tools`
- `tool_choice: "auto"`
- `parallelToolCalls`

## Batch Calling

JSON batch calling is now enabled through the same settings used by the text protocols.

The logic currently is:

- if `disableBatchToolUse` is true, JSON batch calling is off
- otherwise, if `maxToolCalls > 1`, JSON batch calling is on
- otherwise, JSON batch calling is off

This flag is computed in:

- [src/core/task/Task.ts](/Users/imacpro/Documents/kilomain/src/core/task/Task.ts)

and passed to providers as:

- `metadata.parallelToolCalls`

Providers then map that to their native request field, usually:

- `parallel_tool_calls`

When JSON batch calling is enabled, the native manifest also includes a `batch` tool.

That tool exists specifically for models that do not reliably emit multiple sibling native tool calls even when `parallelToolCalls` is true.

Recommended shape:

```json
{
  "calls": [
    { "name": "list", "arguments": { "path": "src" } },
    { "name": "grep", "arguments": { "query": "AuthService", "path": "src" } },
    { "name": "read", "arguments": { "path": "src/auth.ts", "start_line": 1, "end_line": 120 } }
  ]
}
```

Rules:

- use `batch` only for independent calls that do not depend on earlier results
- do not nest `batch`
- `batch` is not emitted in the native manifest when JSON batch tool use is disabled
- nested calls are still validated against the active mode before execution

Examples of provider-side handling:

- [src/api/providers/kilocode/nativeToolCallHelpers.ts](/Users/imacpro/Documents/kilomain/src/api/providers/kilocode/nativeToolCallHelpers.ts)
- [src/api/providers/openrouter.ts](/Users/imacpro/Documents/kilomain/src/api/providers/openrouter.ts)
- [src/api/providers/openai-native.ts](/Users/imacpro/Documents/kilomain/src/api/providers/openai-native.ts)
- [src/api/providers/openai-codex.ts](/Users/imacpro/Documents/kilomain/src/api/providers/openai-codex.ts)

## Provider Metadata Contract

The request metadata shape is defined in:

- [src/api/index.ts](/Users/imacpro/Documents/kilomain/src/api/index.ts)

Relevant fields:

- `tools`
- `tool_choice`
- `toolProtocol`
- `parallelToolCalls`
- `tool_manifest` for debug logging

This metadata object is the handoff point between task orchestration and provider implementations.

## Streaming And Parsing

Native tool calls arrive as streamed chunks from providers.

The parser for that path is:

- [src/core/assistant-message/NativeToolCallParser.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/NativeToolCallParser.ts)

It is responsible for:

- tracking partial tool call chunks
- assigning stable per-turn IDs when providers do not give globally unique ones
- emitting `tool_call_start`, `tool_call_delta`, and `tool_call_end`
- accumulating JSON arguments
- resolving tool aliases before execution
- converting provider-native chunks into the repo’s `ToolUse` shape

This is what allows multiple native tool calls in one assistant response to be handled as separate tool executions.

## Agent Loop Behavior

The stream consumer lives in:

- [src/core/task/AgentLoop.ts](/Users/imacpro/Documents/kilomain/src/core/task/AgentLoop.ts)

For native JSON tool calls, the loop:

- listens for `tool_call_partial` and `tool_call` chunks
- feeds them into `NativeToolCallParser`
- creates or updates streaming `tool_use` blocks
- finalizes completed tool calls
- stops the stream when the configured tool-call limit is reached for the turn

The same `maxToolCalls` setting that informs provider batch enablement also informs when the local stream should be cut and handed back for execution.

## Tool Results

Tool result injection happens in:

- [src/core/assistant-message/presentAssistantMessage.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/presentAssistantMessage.ts)

For native JSON protocol:

- each tool result is attached as a `tool_result`
- the result is tied to the original `tool_use_id`
- image blocks are appended separately after the text result when needed
- multiple sequential native tool results are safe because each one is scoped to its own `tool_use_id`

This is different from markdown/unified flows, which rely on consolidated text blocks instead.

## MCP Tools

Dynamic MCP tools are added alongside built-in native tools.

The MCP native manifest path is:

- [src/core/prompts/tools/native-tools/mcp_server.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/mcp_server.ts)

Those tools are generated from connected MCP server schemas and merged into the final native manifest during build.

## Naming Notes

The current native JSON system uses the short tool names aligned with the markdown protocol:

- `read` instead of `read_file`
- `write` instead of `write_to_file`
- `list` instead of `list_dir`
- `bash` instead of `execute_command`
- `web` instead of `web_search`
- `fetch` instead of `web_fetch`
- `todo` instead of `update_todo_list`
- `ask` instead of `codebase_search`
- `agent` for the sub-agent tool

This is intentional. The JSON manifest is now meant to mirror the visible markdown tool vocabulary as closely as possible.

## Files To Know

If you need to change the JSON tool system, these are the main files:

- [src/core/prompts/tools/native-tools/registry.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/registry.ts)
- [src/core/prompts/tools/native-tools/index.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/index.ts)
- [src/core/task/build-tools.ts](/Users/imacpro/Documents/kilomain/src/core/task/build-tools.ts)
- [src/core/task/Task.ts](/Users/imacpro/Documents/kilomain/src/core/task/Task.ts)
- [src/core/task/AgentLoop.ts](/Users/imacpro/Documents/kilomain/src/core/task/AgentLoop.ts)
- [src/core/assistant-message/NativeToolCallParser.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/NativeToolCallParser.ts)
- [src/core/assistant-message/presentAssistantMessage.ts](/Users/imacpro/Documents/kilomain/src/core/assistant-message/presentAssistantMessage.ts)
- [src/api/index.ts](/Users/imacpro/Documents/kilomain/src/api/index.ts)

## Safe Change Checklist

When changing this system:

1. Update [registry.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/registry.ts) first.
2. Update emitted order in [index.ts](/Users/imacpro/Documents/kilomain/src/core/prompts/tools/native-tools/index.ts) if needed.
3. Check mode filtering in [build-tools.ts](/Users/imacpro/Documents/kilomain/src/core/task/build-tools.ts).
4. Check task metadata assembly in [Task.ts](/Users/imacpro/Documents/kilomain/src/core/task/Task.ts).
5. Check provider request mapping for `parallelToolCalls`.
6. Check `NativeToolCallParser` if the argument format or naming changes.
7. Check `presentAssistantMessage` if result handling semantics change.

## Current Design Intent

The current JSON tool system is trying to do three things at once:

- keep one central schema file
- keep the native tool vocabulary aligned with the markdown prompt vocabulary
- let the runtime use provider-native function calling without losing the existing execution infrastructure

That means the JSON path is native at the provider boundary, but internally it still normalizes back into the repo’s existing `ToolUse` and tool execution pipeline.
