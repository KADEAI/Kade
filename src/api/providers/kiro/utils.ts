import * as os from "os"
import * as crypto from "crypto"
import { v4 as uuidv4 } from "uuid"

/**
 * Generates a unique machine fingerprint based on hostname and username.
 * Used for User-Agent formation to identify a specific gateway installation.
 * 
 * @returns SHA256 hash of the string "{hostname}-{username}-kiro-gateway"
 */
export function getMachineFingerprint(): string {
    try {
        const hostname = os.hostname()
        const username = os.userInfo().username
        const uniqueString = `${hostname}-${username}-kiro-gateway`
        return crypto.createHash("sha256").update(uniqueString).digest("hex")
    } catch (error) {
        return crypto.createHash("sha256").update("default-kiro-gateway").digest("hex")
    }
}

/**
 * Builds headers for Kiro API requests.
 */
export function getKiroHeaders(fingerprint: string, token: string): Record<string, string> {
    return {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": `aws-sdk-js/1.0.27 ua/2.1 os/win32#10.0.19044 lang/js md/nodejs#22.21.1 api/codewhispererstreaming#1.0.27 m/E KiroIDE-0.7.45-${fingerprint}`,
        "x-amz-user-agent": `aws-sdk-js/1.0.27 KiroIDE-0.7.45-${fingerprint}`,
        "x-amzn-codewhisperer-optout": "true",
        "x-amzn-kiro-agent-mode": "vibe",
        "amz-sdk-invocation-id": uuidv4(),
        "amz-sdk-request": "attempt=1; max=3",
    }
}

/**
 * Generates a unique ID for chat completion.
 */
export function generateCompletionId(): string {
    return `chatcmpl-${uuidv4().replace(/-/g, "")}`
}

/**
 * Generates a stable conversation ID based on message history.
 */
export function generateConversationId(messages?: any[]): string {
    if (!messages || messages.length === 0) {
        return uuidv4()
    }

    // Use first 3 messages + last message for stability
    const keyMessages =
        messages.length <= 3 ? messages : [...messages.slice(0, 3), messages[messages.length - 1]]

    const simplifiedMessages = keyMessages.map((msg) => {
        const role = msg.role || "unknown"
        let contentStr = ""

        if (typeof msg.content === "string") {
            contentStr = msg.content.substring(0, 100)
        } else {
            contentStr = JSON.stringify(msg.content).substring(0, 100)
        }

        return { role, content: contentStr }
    })

    const contentJson = JSON.stringify(simplifiedMessages)
    const hashDigest = crypto.createHash("sha256").update(contentJson).digest("hex")
    return hashDigest.substring(0, 16)
}

/**
 * Generates a unique ID for tool call.
 */
export function generateToolCallId(): string {
    return `call_${uuidv4().replace(/-/g, "").substring(0, 8)}`
}
