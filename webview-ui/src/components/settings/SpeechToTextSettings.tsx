import React, { useMemo } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRegisterSetting } from "./useSettingsSearch"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui"

interface SpeechToTextSettingsProps {
    enabled: boolean
    onChange: (enabled: boolean) => void
    sttProvider?: "openai" | "gemini" | "local"
    setSttProvider: (provider: "openai" | "gemini" | "local") => void
    sttModelId?: string
    setSttModelId: (modelId: string) => void
}

const LOCAL_MODELS = [
    { id: "onnx-community/whisper-tiny", label: "Whisper Tiny (~40MB)" },
    { id: "onnx-community/whisper-base", label: "Whisper Base (~80MB)" },
    { id: "onnx-community/whisper-small", label: "Whisper Small (~250MB)" },
]

export const SpeechToTextSettings = ({
    enabled,
    onChange,
    sttProvider = "openai",
    setSttProvider,
    sttModelId = "onnx-community/whisper-base",
    setSttModelId,
}: SpeechToTextSettingsProps) => {
    const { t } = useAppTranslation()

    // Register settings for search
    useRegisterSetting({ settingId: "stt-provider", section: "experimental", label: "Speech-to-Text Provider" })
    useRegisterSetting({ settingId: "stt-model", section: "experimental", label: "Local STT Model" })

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center">
                    <VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
                        <span className="font-medium text-[13px]">{t("kilocode:speechToText.startRecording")}</span>
                    </VSCodeCheckbox>
                </div>
                <p className="text-vscode-descriptionForeground text-[11px] leading-relaxed opacity-90 pl-7">
                    Enable voice input for chat. Can use cloud APIs (OpenAI/Gemini) or a local Whisper model running on your browser via WebGPU.
                </p>
            </div>

            {enabled && (
                <div className="flex flex-col gap-5 pl-4 border-l-2 border-vscode-focusBorder/50 ml-1">
                    {/* Provider Selection */}
                    <div data-setting-id="stt-provider">
                        <label className="block text-[13px] font-medium mb-2">
                            Transcription Provider
                        </label>
                        <Select value={sttProvider} onValueChange={(value) => setSttProvider(value as any)}>
                            <SelectTrigger className="w-full text-[13px]">
                                <SelectValue placeholder="Select STT provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="openai">OpenAI Whisper (Remote)</SelectItem>
                                <SelectItem value="gemini">Gemini (Remote)</SelectItem>
                                <SelectItem value="local">Local Whisper (WebGPU - Privacy First)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
                            {sttProvider === "local"
                                ? "Runs entirely in your browser. No audio data leaves your machine. Downloads ~80MB+ on first use."
                                : "Sends audio to the respective API for transcription. Requires an API key."}
                        </p>
                    </div>

                    {/* Model Selection (Local only) */}
                    {sttProvider === "local" && (
                        <div data-setting-id="stt-model">
                            <label className="block text-[13px] font-medium mb-2">
                                Local Model
                            </label>
                            <Select value={sttModelId} onValueChange={setSttModelId}>
                                <SelectTrigger className="w-full text-[13px]">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {LOCAL_MODELS.map((model) => (
                                        <SelectItem key={model.id} value={model.id}>
                                            {model.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-vscode-descriptionForeground text-[11px] mt-2 opacity-80 leading-relaxed">
                                Smaller models are faster but less accurate. Tiny/Base are recommended for most users.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
