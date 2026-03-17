# Tool Development Guide

This guide explains how to create a new tool in KiloCode and wire it up to the GUI correctly. The current tool system is complex and this guide will help you navigate it.

## Overview

Tools in KiloCode have three main parts:
1. **Backend Tool Logic** (`src/core/tools/`)
2. **Tool Message Handling** (`src/core/assistant-message/`)
3. **Frontend GUI Component** (`webview-ui/src/components/chat/tools/`)

## Step 1: Create the Backend Tool

### 1.1 Define Tool Types

First, add your tool types to `src/shared/tools.ts`:

```typescript
// Add to ToolParamName type
type ToolParamName = 
    "existing_params" |
    "your_tool_param" |  // Add your parameter names here
    // ... other params

// Add to ToolName type  
type ToolName = 
    "existing_tools" |
    "your_tool_name" |  // Add your tool name here
    // ... other tools

// Add tool interface
export interface YourToolToolUse extends ToolUse<"your_tool_name"> {
    name: "your_tool_name"
    params: Partial<Pick<Record<ToolParamName, string>, "your_tool_param">>
}
```

### 1.2 Create the Tool Class

Create `src/core/tools/YourTool.ts`:

```typescript
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { Task } from "../task/Task"

export class YourTool extends BaseTool<"your_tool_name"> {
    readonly name = "your_tool_name" as const

    // Parse XML/legacy parameters into typed parameters
    parseLegacy(params: Partial<Record<string, string>>): { your_param: string } {
        return {
            your_param: params.your_param || ""
        }
    }

    // Main tool execution logic
    async execute(params: { your_param: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult: originalPushToolResult } = callbacks

        // Create tool message for approval (REQUIRED!)
        const completeMessage = JSON.stringify({ 
            tool: "your_tool_name", 
            your_param: params.your_param
        })

        // Ask for user approval (REQUIRED!)
        const { response } = await task.ask("tool", completeMessage, false)
        if (response !== "yesButtonClicked") {
            return
        }

        // Your tool logic here
        try {
            const result = await doYourLogic(params.your_param)
            
            // Push the result
            pushToolResult(result)
            
        } catch (e: any) {
            console.error(`[your_tool] Error: ${e}`)
            pushToolResult(`Error: ${e.message || e}`)
        }
    }
}

export const yourTool = new YourTool()
```

### 1.3 Key Points for Backend

- **ALWAYS** create a tool message with `task.ask("tool", completeMessage, false)`
- **NEVER** use the `askApproval` callback - that's for a different flow
- The tool message structure should match your tool interface
- Handle errors gracefully and push error messages

## Step 2: Wire Up Tool Message Handling

### 2.1 Add Tool to Handler

In `src/core/assistant-message/presentAssistantMessage.ts`, add your tool to the switch statement:

```typescript
// Find the switch statement and add your case
case "your_tool_name":
    await yourTool.handle(cline, block as ToolUse<"your_tool_name">, {
        askApproval,
        handleError,
        pushToolResult,
        removeClosingTag,
        toolProtocol,
        toolCallId: block.id,
    })
    break
```

### 2.2 Export Tool

Make sure your tool is exported from `src/core/tools/index.ts`:

```typescript
export { yourTool } from './YourTool'
```

## Step 3: Create Frontend GUI Component

### 3.1 Create GUI Component

Create `webview-ui/src/components/chat/tools/YourTool.tsx`:

```typescript
import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { ToolMessageWrapper } from './ToolMessageWrapper'
import { ToolError } from './ToolError'

interface YourToolProps {
    tool: any
    toolResult?: any
    isLastMessage?: boolean
}

// Styled components (copy from other tools and modify)
const YourCardContainer = styled.div<{ $isExpanded: boolean }>`
    // Your styles here - copy from WebSearchTool or WebFetchTool
`

export const YourTool: React.FC<YourToolProps> = ({ tool, toolResult, isLastMessage }) => {
    const [isExpanded, setIsExpanded] = useState(false)

    // IMPORTANT: Access parameters from both tool.param and tool.params?.param
    const yourParam = useMemo(() => tool.your_param || tool.params?.your_param || "", [tool])
    
    const isPermissionRequest = !toolResult && isLastMessage

    // Parse results from toolResult
    const content = useMemo(() => {
        const result = toolResult || tool
        if (!result) return null
        return typeof result.content === 'string'
            ? result.content
            : Array.isArray(result.content)
                ? result.content.map((c: any) => c.text).join('')
                : ''
    }, [toolResult, tool])

    return (
        <ToolMessageWrapper
            toolIcon="codicon-your-icon"
            toolName="your_tool_name"
            toolResult={toolResult}
            isCustomLayout={true}
        >
            <YourCardContainer $isExpanded={isExpanded}>
                {/* Your header with click to expand */}
                {/* Your content when expanded */}
            </YourCardContainer>
        </ToolMessageWrapper>
    )
}
```

### 3.2 Key Points for GUI

- **CRITICAL**: Access parameters using `tool.param || tool.params?.param` - tools use different structures
- Use `ToolMessageWrapper` for consistent styling
- Handle both `tool` and `toolResult` for different states
- Check `isLastMessage` to show loading states

## Step 4: Add Tool to System

### 4.1 Add to Native Tools

In `src/core/prompts/tools/native-tools/index.ts`:

```typescript
import { your_tool } from "./your_tool"

export const nativeTools = [
    // ... existing tools
    your_tool,
] satisfies OpenAI.Chat.ChatCompletionTool[]
```

### 4.2 Add to Tool Definitions

Create `src/core/prompts/tools/native-tools/your_tool.ts`:

```typescript
import type OpenAI from "openai"

const YOUR_TOOL_DESCRIPTION = `Description of what your tool does`

export const your_tool: OpenAI.Chat.ChatCompletionTool = {
    type: "function",
    function: {
        name: "your_tool_name",
        description: YOUR_TOOL_DESCRIPTION,
        strict: true,
        parameters: {
            type: "object",
            properties: {
                your_param: {
                    type: "string",
                    description: "Description of your parameter"
                }
            },
            required: ["your_param"]
        }
    }
}
```

### 4.3 Add to Legacy Tools

In `src/core/prompts/tools/index.ts`:

```typescript
export function getYourToolDescription(args: ToolArgs): string {
    return `## your_tool_name
Description: What your tool does
Parameters:
- your_param: (required) Description of parameter
Usage:
<your_tool_name>
<your_param>value</your_param>
</your_tool_name>`
}

// Add to tools object
your_tool_name: (args) => getYourToolDescription(args),
```

## Step 5: Register Tool

### 5.1 Add to Tool Registry

In `src/shared/tools.ts`:

```typescript
// Add to TOOL_DISPLAY_NAMES
export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
    // ... existing tools
    your_tool_name: "Your Tool Display Name",
}

// Add to tool groups if needed
export const TOOL_GROUPS: Record<string, ToolGroupConfig> = {
    // ... existing groups
    external: {
        tools: ["your_tool_name", "web_search", "web_fetch"],
    }
}
```

## Common Pitfalls

### 1. Tool Message Not Created
**Problem**: GUI doesn't show tool parameters
**Solution**: Always create tool message with `task.ask("tool", completeMessage, false)`

### 2. Parameters Not Accessible in GUI
**Problem**: GUI can't find tool parameters
**Solution**: Use `tool.param || tool.params?.param` to handle both structures

### 3. Tool Not Showing in GUI
**Problem**: Tool executes but GUI doesn't render
**Solution**: Make sure GUI component is properly exported and imported

### 4. Approval Dialog Not Showing
**Problem**: Tool executes without user approval
**Solution**: Use `task.ask()` not `askApproval` callback

## Testing Your Tool

1. **Backend Test**: Create a simple test in `src/core/tools/__tests__/`
2. **GUI Test**: Check browser console for tool structure
3. **Integration Test**: Run the full tool flow

## Example: Complete Tool Flow

1. User triggers tool → 
2. `presentAssistantMessage.ts` calls `yourTool.handle()` →
3. `BaseTool.handle()` calls `yourTool.execute()` →
4. `yourTool.execute()` creates tool message and calls `task.ask()` →
5. User approves →
6. Tool executes logic →
7. `pushToolResult()` updates message →
8. GUI component renders with parameters and results

## Debugging Tips

- Add `console.log()` in GUI component to see tool structure
- Check browser console for parameter access issues
- Verify tool message creation in backend logs
- Test with simple parameters first

This guide should help you avoid the "clusterfuck" of tool development. The key is understanding the three separate parts and how they connect through the tool message system.

## Step 6: Make Results Visible in the GUI

**If the GUI never shows your tool output, do this before debugging anything else.**

### 6.1 Backend: Update the Stored Tool Message

After you call `pushToolResult`, immediately mirror the content into the tool message so the frontend can read it:

```ts
const pushToolResult = (content: any) => {
  originalPushToolResult(content)
  ;(async () => {
    try {
      const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
        try {
          const parsed = JSON.parse(m.text || "{}")
          return (m.say === "tool" || m.ask === "tool") && parsed.tool === "your_tool_name"
        } catch {
          return false
        }
      })

      if (lastMsgIndex !== -1) {
        const msg = task.clineMessages[lastMsgIndex]
        const toolData = JSON.parse(msg.text || "{}")
        toolData.content = content
        msg.text = JSON.stringify(toolData)
        await task.updateClineMessage(msg)
      }
    } catch (error) {
      console.error(`[your_tool_name] Failed to update UI: ${error}`)
    }
  })()
}
```

Key points:
- Match both `say === "tool"` **and** `ask === "tool"` (native + legacy flows).
- Write the entire `content` you pushed so the frontend sees the same payload.

### 6.2 Frontend: Read from `toolResult.content`

Every tool component should follow the same pattern used by `EditTool`, `WriteTool`, etc.:

```ts
const content = typeof toolResult?.content === "string"
  ? toolResult.content
  : Array.isArray(toolResult?.content)
    ? toolResult.content.map((c: any) => c.text).join("")
    : ""

if (!content) return [] // or render "SEARCHING" state
```

### 6.3 Approval Flow Reminder

1. `task.ask("tool", completeMessage, false)` creates a placeholder in the UI.
2. After approval, your tool runs and calls `pushToolResult`.
3. You **must** update that placeholder with the final content as shown above; otherwise the webview keeps displaying an empty card.

Following this pattern guarantees that both `web_search` and `web_fetch` (and any new tool) instantly display their results in the VS Code sidebar once the user approves the call.
