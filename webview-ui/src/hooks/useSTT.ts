// kade_change - new file: React hook for STT (Speech-to-Text) functionality
import { useState, useEffect, useCallback, useRef } from "react";
import { vscode } from "../utils/vscode";
import { STTSegment } from "../../../src/shared/sttContract";
import {
  LocalWhisperClient,
  LocalWhisperEvent,
} from "../services/stt/LocalWhisperClient";

export interface UseSTTOptions {
  /** Called when recording completes with final text */
  onComplete?: (text: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

export interface UseSTTReturn {
  /** Whether currently recording */
  isRecording: boolean;
  /** Transcript segments (complete state from extension or local) */
  segments: STTSegment[];
  /** Current volume level 0-1 */
  volume: number;
  /** Start recording */
  start: (language?: string) => void;
  /** Stop recording and finalize */
  stop: () => void;
  /** Cancel recording and discard */
  cancel: () => void;
  /** Whether the local model is loading */
  isModelLoading?: boolean;
  /** Loading progress for local model */
  modelLoadingProgress?: string;
}

/**
 * Hook for Speech-to-Text functionality
 *
 * All STT providers (openai, gemini, local) use FFmpeg in the extension host for audio capture.
 * Local Whisper sends audio to webview for transcription via Web Worker.
 *
 * Usage:
 * ```tsx
 * const { isRecording, transcript, start, stop } = useSTT({
 *   onComplete: (text) => {
 *     setInputValue(prev => prev + " " + text)
 *   }
 * })
 * ```
 */
export function useSTT(options: UseSTTOptions = {}): UseSTTReturn {
  const { onComplete, onError } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<STTSegment[]>([]);
  const [volume, setVolume] = useState(0);

  // Local STT state
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<string>("");

  // Local whisper client for transcription (audio comes from extension host via FFmpeg)
  const localClientRef = useRef<LocalWhisperClient | null>(null);

  // Track session to ignore stale events
  const sessionIdRef = useRef<string | null>(null);
  // Use ref to avoid stale closure - segments must be current when stt:stopped fires
  const segmentsRef = useRef<STTSegment[]>([]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // Local whisper status change handler - for transcription results
  const handleLocalStatusChange = useCallback(
    (event: LocalWhisperEvent) => {
      switch (event.status) {
        case "loading":
          setIsModelLoading(true);
          setModelLoadingProgress(
            typeof event.data === "string" ? event.data : "Loading model...",
          );
          break;
        case "ready":
          setIsModelLoading(false);
          setModelLoadingProgress("");
          break;
        case "update":
          if (event.output) {
            const text = event.output.trim();
            if (text) {
              console.log("🎙️ [useSTT] Local whisper update:", text);
              // Accumulate segments instead of replacing - show all transcribed text
              setSegments((prev) => [...prev, { text, isPreview: true }]);
            }
          }
          break;
        case "complete":
          if (event.output) {
            const finalText = event.output.trim();
            if (finalText) {
              console.log("🎙️ [useSTT] Local whisper complete:", finalText);
              // Add final segment to accumulated segments
              setSegments((prev) => [
                ...prev,
                { text: finalText, isPreview: false },
              ]);
            }
            // Call onComplete directly - stt:stopped already fired with empty text
            // so we need to insert the transcription result here
            if (finalText) {
              onComplete?.(finalText);
            }
          }
          break;
        case "error": {
          const errorMsg =
            typeof event.data === "string"
              ? event.data
              : JSON.stringify(event.data);
          console.error("🎙️ [useSTT] Local whisper error:", errorMsg);
          onError?.(errorMsg);
          break;
        }
      }
    },
    [onComplete, onError],
  );

  useEffect(() => {
    // Handle messages from extension host
    const handler = (event: MessageEvent) => {
      const msg = event.data;

      // Handle STT events from extension host
      if (msg.type?.startsWith("stt:")) {
        switch (msg.type) {
          case "stt:started":
            sessionIdRef.current = msg.sessionId;
            setIsRecording(true);
            setSegments([]);
            // Don't reset model loading here - local whisper may still be loading
            break;

          case "stt:transcript":
            // Ignore events from old sessions
            if (msg.sessionId !== sessionIdRef.current) return;
            console.log(
              "🎙️ [useSTT WebView] 📨 Received segments:",
              JSON.stringify(msg.segments, null, 2),
            );
            setSegments(msg.segments || []);
            break;

          case "stt:volume":
            if (msg.sessionId !== sessionIdRef.current) return;
            setVolume(msg.level);
            break;

          case "stt:stopped":
            if (msg.sessionId !== sessionIdRef.current) return;

            setIsRecording(false);
            setVolume(0);
            setIsModelLoading(false);

            if (msg.reason === "completed") {
              const finalText = segmentsRef.current
                .map((s) => s.text)
                .join(" ")
                .trim();
              if (finalText) {
                onComplete?.(finalText);
              }
            } else if (msg.reason === "error" && msg.error) {
              onError?.(msg.error);
            }

            setSegments([]);
            // Don't clear sessionId yet - local whisper transcription may still arrive
            // sessionIdRef will be overwritten on next stt:started
            break;
        }
      }

      // Handle local whisper messages from extension host
      if (msg.type?.startsWith("localWhisper:")) {
        console.log(
          "🎙️ [useSTT] Received localWhisper message:",
          msg.type,
          msg,
        );
        switch (msg.type) {
          case "localWhisper:init":
            // Extension host wants us to initialize the whisper model
            // stt:started will also arrive and set isRecording/sessionId
            sessionIdRef.current = msg.sessionId;
            setIsRecording(true);
            setIsModelLoading(true);
            setModelLoadingProgress("Loading whisper model...");
            console.log(
              "🎙️ [useSTT] Starting local whisper initialization, sessionId:",
              msg.sessionId,
            );

            if (!localClientRef.current) {
              localClientRef.current = new LocalWhisperClient(
                handleLocalStatusChange,
              );
            }
            localClientRef.current.initialize(msg.modelId).catch((err) => {
              console.error("🎙️ [useSTT] Failed to initialize whisper:", err);
              vscode.postMessage({
                type: "localWhisper:error",
                sessionId: msg.sessionId,
                error: err.message || "Failed to initialize whisper model",
              } as any);
            });
            break;

          case "localWhisper:transcribe":
            // Extension host sends audio captured via FFmpeg for transcription
            console.log(
              "🎙️ [useSTT] Received audio for transcription, samples:",
              msg.audio?.length,
            );
            if (msg.sessionId !== sessionIdRef.current) return;

            if (localClientRef.current) {
              // Convert array back to Float32Array and transcribe
              const audio = new Float32Array(msg.audio);
              console.log(
                "🎙️ [useSTT] Transcribing audio with",
                audio.length,
                "samples",
              );
              localClientRef.current.transcribeAudio(audio);
            } else {
              console.error("🎙️ [useSTT] Whisper model not initialized");
              vscode.postMessage({
                type: "localWhisper:error",
                sessionId: msg.sessionId,
                error: "Whisper model not initialized",
              } as any); // Type assertion needed for error field
            }
            break;
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onComplete, onError, handleLocalStatusChange]);

  const start = useCallback((language?: string) => {
    // All providers go through extension host
    vscode.postMessage({ type: "stt:start", language });
  }, []);

  const stop = useCallback(() => {
    vscode.postMessage({ type: "stt:stop" });
  }, []);

  const cancel = useCallback(() => {
    vscode.postMessage({ type: "stt:cancel" });
    setIsRecording(false);
    setSegments([]);
  }, []);

  return {
    isRecording,
    segments,
    volume,
    start,
    stop,
    cancel,
    isModelLoading,
    modelLoadingProgress,
  };
}
