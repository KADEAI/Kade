import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { ApiHandler, ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "."
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiStream, ApiStreamChunk } from "./transform/stream"

export class LoggingApiHandler implements ApiHandler, SingleCompletionHandler {
    constructor(private delegate: ApiHandler) {
        // console.log("LoggingApiHandler initialized")
    }

    createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        metadata?: ApiHandlerCreateMessageMetadata,
    ): ApiStream {
        const requestId = new Date().toISOString().replace(/[:.]/g, "-")
        const logDir = this.getLogDir()

        // Fire and forget request logging
        if (logDir) {
            this.logRequest(logDir, requestId, systemPrompt, messages, metadata).catch(console.error)
        }

        const stream = this.delegate.createMessage(systemPrompt, messages, metadata)
        return this.wrapStream(stream, requestId, logDir)
    }

    getModel() {
        return this.delegate.getModel()
    }

    countTokens(content: Array<Anthropic.Messages.ContentBlockParam>) {
        return this.delegate.countTokens(content)
    }

    async completePrompt(prompt: string): Promise<string> {
        if ("completePrompt" in this.delegate && typeof (this.delegate as any).completePrompt === "function") {
            return (this.delegate as any).completePrompt(prompt)
        }
        throw new Error("Delegate does not support completePrompt")
    }

    get contextWindow() {
        return this.delegate.contextWindow
    }

    private async logRequest(
        dir: string,
        requestId: string,
        systemPrompt: string,
        messages: any[],
        metadata: any,
    ) {
        // Disabled - no longer logging API requests
        return
    }

    private async *wrapStream(
        stream: ApiStream,
        requestId: string,
        logDir: string | undefined,
    ): ApiStream {
        // Disabled - no longer logging API responses, just pass through the stream
        for await (const chunk of stream) {
            yield chunk;
        }
    }

    private getLogDir(): string | undefined {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return undefined
        }
        return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, ".kilocode", "api_logs")
    }

    private async writeLog(dir: string, filename: string, data: any) {
        // Disabled - no longer writing logs to disk
        return
    }
}
