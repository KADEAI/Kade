export interface UnifiedMessage {
    role: string
    content: any
    tool_calls?: any[] | null
    tool_results?: any[] | null
    images?: any[] | null
}

export interface UnifiedTool {
    name: string
    description?: string | null
    input_schema?: any | null
}

export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool"
    content: any
    tool_calls?: any[] | null
    tool_call_id?: string
    name?: string
}

export interface Tool {
    type: "function"
    function?: {
        name: string
        description?: string
        parameters?: any
    }
    // Flat format
    name?: string
    description?: string
    input_schema?: any
}

export interface ChatCompletionRequest {
    model: string
    messages: ChatMessage[]
    tools?: Tool[]
    stream?: boolean
    temperature?: number
    top_p?: number
    max_tokens?: number
}
