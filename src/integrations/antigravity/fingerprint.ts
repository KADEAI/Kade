import * as crypto from "crypto"
import { ANTIGRAVITY_VERSION } from "./constants"

export interface ClientMetadata {
    ideType: string
    platform: string
    pluginType: string
    osVersion: string
    arch: string
    sqmId?: string
}

export interface Fingerprint {
    deviceId: string
    userAgent: string
    apiClient: string
    clientMetadata: ClientMetadata
    quotaUser: string
}

const SDK_CLIENTS = [
    "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "google-cloud-sdk vscode/1.96.0",
    "google-cloud-sdk jetbrains/2024.3",
    "google-cloud-sdk vscode/1.95.0",
]

const PLATFORMS = ["windows/amd64", "darwin/arm64", "linux/amd64", "darwin/amd64", "linux/arm64"]

function randomFrom<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!
}

export function generateFingerprint(): Fingerprint {
    const deviceId = crypto.randomUUID()
    const platform = randomFrom(PLATFORMS)
    
    return {
        deviceId,
        userAgent: `antigravity/${ANTIGRAVITY_VERSION} ${platform}`,
        apiClient: randomFrom(SDK_CLIENTS),
        clientMetadata: {
            ideType: "VSCODE",
            platform: platform.startsWith("darwin") ? "MACOS" : platform.split("/")[0].toUpperCase(),
            pluginType: "GEMINI",
            osVersion: "10.0.22631",
            arch: platform.split("/")[1],
            sqmId: `{${crypto.randomUUID().toUpperCase()}}`,
        },
        quotaUser: `device-${crypto.randomBytes(8).toString("hex")}`,
    }
}

export function buildFingerprintHeaders(fp: Fingerprint): Record<string, string> {
    return {
        "User-Agent": fp.userAgent,
        "X-Goog-Api-Client": fp.apiClient,
        "Client-Metadata": JSON.stringify(fp.clientMetadata),
        "X-Goog-QuotaUser": fp.quotaUser,
        "X-Client-Device-Id": fp.deviceId,
        "X-Antigravity-Source": "vscode",
    }
}
