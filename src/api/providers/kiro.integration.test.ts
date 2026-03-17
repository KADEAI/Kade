import axios from "axios"
import { KiroAuthManager } from "./kiro/auth"
import { buildKiroPayload } from "./kiro/converters"
import { AwsEventStreamParser } from "./kiro/parser"
import { v4 as uuidv4 } from "uuid"

async function runTest() {
    console.log("Starting Kiro Infinite Integration Test...")
    const authManager = new KiroAuthManager({
        credsFile: "~/.aws/sso/cache/kiro-auth-token.json",
        region: "us-east-1",
    })

    const token = await authManager.getAccessToken()
    const profileArn = authManager.getProfileArn() || "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"
    
    console.log("Using Token (first 10 chars):", token.substring(0, 10))
    console.log("Using Profile ARN:", profileArn)

    const payload = buildKiroPayload({
        messages: [{ role: "user", content: "Hello, are you Claude 3.5 Sonnet?" }],
        systemPrompt: "You are a helpful assistant.",
        modelId: "claude-3.7-sonnet",
        conversationId: `test_${uuidv4()}`,
        profileArn: profileArn,
    })
    
    // Final payload fix: AWS Q requires these at the root for this specific endpoint
    Object.assign(payload, {
        chatTriggerType: "MANUAL",
        source: "IDE"
    })

    const url = `https://q.us-east-1.amazonaws.com/generateAssistantResponse`

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-amzn-codewhisperer-token': token,
                'x-amzn-codewhisperer-clientid': authManager.getFingerprint(),
                'User-Agent': `aws-sdk-js/1.0.27 ua/2.1 os/macos#24.0.0 lang/js md/nodejs#22.22.0 api/codewhispererstreaming#1.0.27 m/E KiroIDE-0.10.78-${authManager.getFingerprint()}`,
                'amz-sdk-invocation-id': uuidv4(),
                'x-amz-user-agent': `aws-sdk-js/1.0.27 KiroIDE-0.10.78-${authManager.getFingerprint()}`,
            },
            responseType: "stream",
            timeout: 30000
        })
        
        console.log("SUCCESS! Status:", response.status)
        const parser = new AwsEventStreamParser()
        
        response.data.on('data', (chunk: Buffer) => {
            const events = parser.feed(chunk.toString())
            for (const event of events) {
                if (event.type === 'content') {
                    process.stdout.write(event.content || '')
                }
            }
        })

        response.data.on('end', () => {
            console.log("\n\nStream finished.")
            process.exit(0)
        })
    } catch (error: any) {
        if (error.response) {
            console.error("ERROR DETAIL:", error.response.status)
            console.error("SENT PAYLOAD:", JSON.stringify(payload, null, 2))
        } else {
            console.error("ERROR:", error.message)
        }
        process.exit(1)
    }
}

runTest()