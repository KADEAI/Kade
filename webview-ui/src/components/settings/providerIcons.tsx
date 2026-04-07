import React from "react"
import {
    SiOpenai,
    SiGoogle,
    SiAmazon,
    SiAnthropic,
    SiHuggingface,
    SiVercel,
    SiMeta,
    SiPerplexity,
    SiX,
    SiDatabricks,
    SiSnowflake,
    SiSap,
} from "react-icons/si"
import {
    Cpu,
    Globe,
    Zap,
    Rocket,
    Search,
    Server,
    Code,
    Box,
    Brain,
    MessageSquare,
    Terminal,
    LayoutTemplate,
    Database,
    Network,
    Wind,
    Bot,
    Cloud,
    Triangle,
    Feather,
    Flame,
    Gem,
    Sparkles,
    Compass,
    Users,
} from "lucide-react"

import iconManifest from "./providerIconManifest.json"

const typedIconManifest = iconManifest as Record<string, string>

// Helper to find a fuzzy match for a provider string
function getFuzzyIconPath(provider: string, baseUri: string): string | null {
    const p = provider.toLowerCase()

    // Map keywords to Lobe icon filenames
    const fuzzyMap: Record<string, string> = {
        "claude": "claude-color.svg",
        "anthropic": "claude-color.svg",
        "gpt": "openai.svg",
        "openai": "openai.svg",
        "gemini": "gemini-color.svg",
        "google": "google-color.svg",
        "llama": "meta-color.svg",
        "meta": "meta-color.svg",
        "mistral": "mistral-color.svg",
        "z-ai": "zai.svg",
        "zai": "zai.svg",
        "deepseek": "deepseek-color.svg",
        "groq": "groq.svg",
        "cohere": "cohere-color.svg",
        "perplexity": "perplexity-color.svg",
        "minimax": "minimax-color.svg",
        "midjourney": "midjourney.svg",
        "moonshot": "moonshot.svg",
        "zeroone": "zeroone.svg",
        "01-ai": "zeroone.svg",
        "01.ai": "zeroone.svg",
        "yi": "yi-color.svg",
        "qwen": "qwen-color.svg",
        "alibaba": "alibaba-color.svg",
        "wenxin": "wenxin-color.svg",
        "baidu": "baidu-color.svg",
        "hunyuan": "hunyuan-color.svg",
        "tencent": "tencent-color.svg",
        "doubao": "doubao-color.svg",
        "bytedance": "bytedance-color.svg",
        "skylark": "doubao-color.svg",
        "chatglm": "chatglm-color.svg",
        "zhipu": "zhipu-color.svg",
        "baichuan": "baichuan-color.svg",
        "internlm": "internlm-color.svg",
        "sensenova": "sensenova-color.svg",
        "spark": "spark-color.svg",
        "iflytek": "spark-color.svg",
        "aws": "aws-color.svg",
        "amazon": "aws-color.svg",
        "bedrock": "aws-color.svg",
        "azure": "azure-color.svg",
        "microsoft": "microsoft-color.svg",
        "vertex": "vertex-color.svg",
        "palm": "google-color.svg",
        "ai21": "ai21.svg",
        "jamba": "ai21.svg",
        "replicate": "replicate.svg",
        "together": "together-color.svg",
        "databricks": "databricks-color.svg",
        "mosaic": "databricks-color.svg",
        "nvidia": "nvidia-color.svg",
        "nim": "nvidia-color.svg",
        "rwkv": "rwkv-color.svg",
        "recursal": "rwkv-color.svg",
        "upstage": "upstage-color.svg",
        "solar": "upstage-color.svg",
        "siliconflow": "siliconcloud-color.svg",
        "silicon": "siliconcloud-color.svg",
        "stepfun": "stepfun-color.svg",
        "step": "stepfun-color.svg",
        "abacus": "abacus-color.svg", // Note: Ensure this exists or fallback
        "friendli": "friendli.svg",
        "huggingface": "huggingface-color.svg",
        "hf": "huggingface-color.svg",
        "fal": "fal-color.svg",
        "flux": "black-forest-labs.svg", // Use closest relevant
        "bfl": "black-forest-labs.svg",
        "reka": "reka.svg", // Check if exists
        "pika": "pika.svg",
        "sora": "sora-color.svg",
        "luma": "luma-color.svg",
        "kling": "kling-color.svg",
        "cogview": "cogview-color.svg",
        "cogvideo": "cogvideo-color.svg",
        "video": "runway.svg", // Generic video fallback?
        "runway": "runway.svg",
        "suno": "suno.svg",
        "udio": "udio-color.svg",
        "fish": "fishaudio.svg",
        "eleven": "elevenlabs.svg",
        "arcee": "arcee-color.svg",
        "aion": "aionlabs-color.svg",
        "allen": "ai2-color.svg",
        "unbound": "unbound.png",
        "sap": "sap.ico",
        "requesty": "requesty.ico",
        "litellm": "litellm.png",
        "io-intelligence": "io-intelligence.png",
        "io intelligence": "io-intelligence.png",
        "human-relay": "human-relay.ico",
        "human relay": "human-relay.ico",
        "chutes": "chutes-ai.svg",
        "kilo-gateway": "kilo-gateway.ico",
        "kilo gateway": "kilo-gateway.ico",
        "kilocode": "kilocode.svg",
        "antigravity": "antigravity.svg",
        "kiro": "kiro.svg",
        "kiro-gateway": "kiro.svg"
    }

    // Check strict contains
    for (const [key, filename] of Object.entries(fuzzyMap)) {
        if (p.includes(key)) {
            return `${baseUri}/${filename}`
        }
    }

    return null
}

export function getProviderIcon(provider: string, className?: string, size: number = 16) {
    const iconProps = {
        className: className || "text-vscode-foreground",
        size,
    }

    let p = provider.toLowerCase().trim()
    let originalP = p

    // If it looks like a model ID (e.g. "brand/model" or "brand:model"), extract the brand
    // But keep the original string for fuzzy matching against model names
    if (p.includes("/") || p.includes(":")) {
        p = p.split(/[\/:]/)[0]
    }

    const baseUri = (window as any).PROVIDERS_BASE_URI || "/assets/providers"

    // Model-name overrides should win over manifest/provider aliases.
    if (originalP.includes("grok")) {
        return renderImg(`${baseUri}/xai.svg`, "xai", className, size)
    }

    if (originalP.includes("glm")) {
        return renderImg(`${baseUri}/zai.svg`, "zai", className, size)
    }

    if (originalP.includes("kimi")) {
        return renderImg(`${baseUri}/moonshot.svg`, "moonshot", className, size)
    }

    if (originalP.includes("trinity")) {
        return renderImg(`${baseUri}/arcee-color.svg`, "arcee", className, size)
    }

    if (originalP.includes("nemotron")) {
        return renderImg(`${baseUri}/nvidia-color.svg`, "nvidia", className, size)
    }

    if (originalP.includes("xiaomi") || originalP.includes("mimo")) {
        return renderImg(`${baseUri}/mimo.png`, "mimo", className, size)
    }

    // 0. Check Lobe Icons Layout Manifest first for premium icons (Exact Match)
    const manifestIcon = typedIconManifest[p]
    if (manifestIcon) {
        const iconPath = `${baseUri}/${manifestIcon}`
        return renderImg(iconPath, p, className, size)
    }

    // 0.5 Fuzzy Match against the specific mapped icons
    const fuzzyPath = getFuzzyIconPath(originalP, baseUri)
    if (fuzzyPath) {
        return renderImg(fuzzyPath, p, className, size)
    }

    // 1. Exact matches / Common aliases (Fallbacks using React Icons)
    switch (p) {
        case "openai":
        case "openai-native":
        case "openai-codex":
        case "openai-compatible":
            return <SiOpenai {...iconProps} />
        case "anthropic":
        case "claude-code":
            return <SiAnthropic {...iconProps} />
        case "google":
        case "gemini":
        case "gemini-cli":
        case "vertex":
            return <SiGoogle {...iconProps} />
        case "amazon":
        case "bedrock":
        case "aws":
            return <SiAmazon {...iconProps} />
        case "meta":
        case "meta-ai":
        case "meta-llama":
        case "llama":
            return <SiMeta {...iconProps} />
        case "mistral":
        case "mistralai":
        case "mistral-ai":
            return <Wind {...iconProps} />
        case "nvidia":
            return <Cpu {...iconProps} />
        case "microsoft":
        case "azure":
            return <Cloud {...iconProps} />
        case "cohere":
            return <Network {...iconProps} />
        case "deepseek":
            return <Brain {...iconProps} />
        case "groq":
            return <Zap {...iconProps} />
        case "xai":
        case "x-ai":
        case "x":
            return <SiX {...iconProps} />
        case "perplexity":
        case "perplexity-ai":
            return <SiPerplexity {...iconProps} />
        case "databricks":
            return <Database {...iconProps} />
        case "snowflake":
            return <SiSnowflake {...iconProps} />
        case "huggingface":
        case "hf":
            return <SiHuggingface {...iconProps} />
        case "vercel":
        case "vercel-ai-gateway":
            return <SiVercel {...iconProps} />

        // 2. Specialized Lucide fallbacks
        case "openrouter":
            return <Network {...iconProps} />
        case "deepinfra":
            return <Cloud {...iconProps} />
        case "cerebras":
            return <Brain {...iconProps} />

        case "ollama":
            return <Bot {...iconProps} />
        case "baseten":
            return <Server {...iconProps} />
        case "lmstudio":
            return <LayoutTemplate {...iconProps} />
        case "vscode-lm":
            return <Code {...iconProps} />

        case "glama":
            return <Gem {...iconProps} />
        case "doubao":
            return <Sparkles {...iconProps} />
        case "featherless":
            return <Feather {...iconProps} />
        case "fireworks":
            return <Flame {...iconProps} />
        case "together":
            return <Users {...iconProps} />
        case "voyage":
            return <Compass {...iconProps} />


        // 3. Kilo-specific mappings
        case "kilocode":
        case "cli-proxy":
            return <Terminal {...iconProps} />
        case "provider-routing":
            return <Cpu {...iconProps} />
        case "synthetic":
            return <Box {...iconProps} />
        case "virtual-quota-fallback":
            return <Zap {...iconProps} />
        case "ovhcloud":
            return <Cloud {...iconProps} />
        case "inception":
            return <Triangle {...iconProps} />
    }

    // 4. Prefix/Contains Matching (Smarter fallbacks)
    if (p.includes("openai")) return <SiOpenai {...iconProps} />
    if (p.includes("anthropic")) return <SiAnthropic {...iconProps} />
    if (p.includes("claude")) return <SiAnthropic {...iconProps} />
    if (p.includes("google") || p.includes("gemini")) return <SiGoogle {...iconProps} />
    if (p.includes("meta") || p.includes("llama")) return <SiMeta {...iconProps} />
    if (p.includes("mistral")) return <Wind {...iconProps} />
    if (p.includes("amazon") || p.includes("aws") || p.includes("nova")) return <SiAmazon {...iconProps} />
    if (p.includes("nvidia")) return <Cpu {...iconProps} />
    if (p.includes("microsoft") || p.includes("azure")) return <Cloud {...iconProps} />
    if (p.includes("deepseek")) return <Brain {...iconProps} />
    if (p.includes("cohere")) return <Network {...iconProps} />
    if (p.includes("groq")) return <Zap {...iconProps} />

    // New providers prefix matching


    // 5. Default
    // Use a deterministic random icon based on the provider string
    const fallbackIcons = [
        Cpu,
        Zap,
        Rocket,
        Search,
        Server,
        Code,
        Box,
        Brain,
        MessageSquare,
        Terminal,
        LayoutTemplate,
        Database,
        Network,
        Wind,
        Bot,
        Cloud,
        Triangle,
        Feather,
        Flame,
        Gem,
        Sparkles,
        Compass,
        Users,
    ]

    // Add a colorful palette to randomly assign to fallback icons
    const fallbackColors = [
        "#FF6B6B", // Red
        "#4ECDC4", // Teal
        "#45B7D1", // Blue
        "#FFA07A", // Salmon
        "#98D8C8", // Mint
        "#F7DC6F", // Yellow
        "#BB8FCE", // Purple
        "#F1948A", // Pink
        "#82E0AA", // Green
        "#85C1E9", // Light Blue
        "#E59866", // Orange
        "#D7BDE2", // Lavender
        "#FF9F43", // Deep Orange
        "#54A0FF", // Bright Blue
        "#5F27CD", // Deep Purple
    ]

    let hash = 0
    for (let i = 0; i < p.length; i++) {
        hash = p.charCodeAt(i) + ((hash << 5) - hash)
    }

    const iconIndex = Math.abs(hash) % fallbackIcons.length
    const colorIndex = Math.abs(hash) % fallbackColors.length

    const RandomIcon = fallbackIcons[iconIndex]
    const randomColor = fallbackColors[colorIndex]

    return <RandomIcon {...iconProps} color={randomColor} className={undefined} style={{ color: randomColor }} />
}

function renderImg(src: string, alt: string, className?: string, size: number = 16) {
    return (
        <img
            src={src}
            alt={alt}
            style={{
                width: size,
                height: size,
                objectFit: "contain",
                display: "inline-block",
                verticalAlign: "middle"
            }}
            className={className}
            onError={(e) => {
                // Fallback to hidden if image fails to load
                (e.target as HTMLImageElement).style.display = 'none'
            }}
        />
    )
}
