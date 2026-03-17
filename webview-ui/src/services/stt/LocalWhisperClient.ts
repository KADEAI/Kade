// Inline worker code from yap-cursor-extension
// We wrap this in a Blob to run it as a Web Worker without needing a separate file build step
const WORKER_CODE = `
var C=Object.defineProperty,F=Object.defineProperties;var x=Object.getOwnPropertyDescriptors;var V=Object.getOwnPropertySymbols;var H=Object.prototype.hasOwnProperty,A=Object.prototype.propertyIsEnumerable;var w=(e,r,o)=>r in e?C(e,r,{enumerable:!0,configurable:!0,writable:!0,value:o}):e[r]=o,T=(e,r)=>{for(var o in r||(r={}))H.call(r,o)&&w(e,o,r[o]);if(V)for(var o of V(r))A.call(r,o)&&w(e,o,r[o]);return e},M=(e,r)=>F(e,x(r));console.log("[Voice Worker] Code execution started.");var d=!1,m="onnx-community/whisper-base",l=null,i=null,s=null,t=null,n=!1,c=!1,W,G,v,P,y,f;async function z(){console.log("[Voice Worker][Init] Initializing Transformers library...");try{let e=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0");console.log("[Voice Worker][Init] Transformers library imported successfully."),{AutoTokenizer:W,AutoProcessor:G,WhisperForConditionalGeneration:v,TextStreamer:P,full:y,env:f}=e,f.allowLocalModels=!1,f.backends.onnx.logLevel="info"}catch(e){throw console.error("[Voice Worker][Init] Failed to import Transformers library:",e),e}}async function S(e){console.log("[Voice Worker][Load] Loading model components... " + m),W||await z(),n=!1,c=!1;try{let r=[W.from_pretrained(m,{progress_callback:e}),G.from_pretrained(m,{progress_callback:e}),v.from_pretrained(m,{dtype:{encoder_model:"fp32",decoder_model_merged:"q4"},device:"webgpu",progress_callback:e})],o=await Promise.all(r);if(console.log("[Voice Worker][Load] All model components loaded."),l=o[0],i=o[1],s=o[2],!l||!i||!s)throw new Error("[Voice Worker][Load] Model components not assigned correctly after load.");await E(),n=!0,console.log("[Voice Worker][Load] Model is loaded and warmed up.")}catch(r){throw console.error("[Voice Worker][Load] Model loading or warmup failed:",r),l=null,i=null,s=null,n=!1,c=!1,t=null,r}}async function E(){if(!s||!y){console.warn("[Voice Worker][Warmup] Cannot warmup model: Not loaded yet.");return}if(c){console.log("[Voice Worker][Warmup] Model already warmed up.");return}console.log("[Voice Worker][Warmup] Warming up model...");try{let o={input_features:y([1,80,3e3],0),max_new_tokens:1,generation_config:{}};await s.generate(o),c=!0,console.log("[Voice Worker][Warmup] Model warmup successful.")}catch(e){console.warn("[Voice Worker][Warmup] Model warmup failed:",e),c=!1}}var k=!1;async function L({audio:e,language:r}){if(k){console.warn("[Voice Worker][Generate] Already processing audio."),self.postMessage({status:"error",data:"Already processing audio."});return}if(!e||e.length===0){console.warn("[Voice Worker][Generate] No audio data received."),self.postMessage({status:"error",data:"No audio data received."});return}if(!n||!l||!i||!s){console.error("[Voice Worker][Generate] Model not ready for transcription."),self.postMessage({status:"error",data:"Model not ready."});return}k=!0,d=!1,console.log("[Voice Worker][Generate] Starting transcription process..."),self.postMessage({status:"transcribing_start"});try{console.log("[Voice Worker][Generate] Processing audio input...");let o=await i(e);console.log("[Voice Worker][Generate] Audio processed.");let a=null,u=0,g="",h=_=>{if(d){console.log("[Voice Worker][Generate] Streamer callback cancelled.");return}a!=null||(a=performance.now()),g=_;let p=0;u++>0&&a&&(p=u/(performance.now()-a)*1e3),self.postMessage({status:"update",output:g,tps:p?parseFloat(p.toFixed(1)):0,numTokens:u})};console.log("[Voice Worker][Generate] Creating text streamer...");let b=new P(l,{skip_prompt:!0,skip_special_tokens:!0,callback_function:h});console.log("[Voice Worker][Generate] Text streamer created."),console.log("[Voice Worker][Generate] Starting model generation..."),await s.generate(M(T({},o),{language:r,streamer:b})),console.log("[Voice Worker][Generate] Model generation finished."),d?console.log("[Voice Worker][Generate] Transcription cancelled post-generation. Discarding result."):(console.log("[Voice Worker][Generate] Transcription complete. Sending final message."),self.postMessage({status:"complete",output:g}))}catch(o){console.error("[Voice Worker][Generate] Transcription failed:",o),self.postMessage({status:"error",data:\`Transcription failed: \${o instanceof Error?o.message:String(o)}\`})}finally{console.log("[Voice Worker][Generate] Cleaning up transcription process."),k=!1}}console.log("[Voice Worker] Setting up message listener.");self.addEventListener("message",async e=>{if(console.log("[Voice Worker][Handler] Received message:",e.data),!e.data||typeof e.data!="object"||!("type"in e.data)){console.warn("[Voice Worker][Handler] Received invalid message format:",e.data);return}let{type:r,data:o}=e.data;switch(r){case"load":if(e.data.modelId)m=e.data.modelId;if(console.log("[Voice Worker][Handler] Handling 'load' message with model: " + m),t){console.log("[Voice Worker][Handler] Model loading already in progress or completed.");try{await t,n&&self.postMessage({status:"ready"})}catch(a){console.error("[Voice Worker][Handler] Previous load attempt failed."),n||self.postMessage({status:"error",data:\`Model initialization failed: \${a instanceof Error?a.message:String(a)}\`})}return}t=S(a=>{a.status==="progress"&&self.postMessage({status:"loading",data:\`Loading: \${a.file} (\${a.progress.toFixed(0)}%)\`})});try{await t,self.postMessage({status:"ready"})}catch(a){console.error("[Voice Worker][Handler] loadModel promise rejected:",a),t=null,n||self.postMessage({status:"error",data:\`Model initialization failed: \${a instanceof Error?a.message:String(a)}\`})}break;case"generate":o?(console.log("[Voice Worker][Handler] Handling 'generate' message."),L(o)):(console.warn("[Voice Worker][Handler] 'generate' message received without data."),self.postMessage({status:"error",data:"Generate request missing audio data."}));break;case"stop":console.log("[Voice Worker][Handler] Handling 'stop' message."),d=!0,console.log("[Voice Worker][Handler] Cancellation requested flag set.");break;default:console.warn("[Voice Worker][Handler] Received unknown message type:",r);break}});console.log("[Voice Worker] Message listener set up. Initial script execution complete.");
`

export type LocalWhisperStatus = "loading" | "ready" | "transcribing_start" | "update" | "complete" | "error"

export interface LocalWhisperEvent {
    status: LocalWhisperStatus
    data?: any // Error message or loading progress
    output?: string // Transcription text
    tps?: number // Tokens per second
    numTokens?: number
}

// Target sample rate for Whisper model
const TARGET_SAMPLE_RATE = 16000

export class LocalWhisperClient {
    private worker: Worker | null = null
    private mediaRecorder: MediaRecorder | null = null
    private audioChunks: Blob[] = []
    private isRecording = false
    private language = "english"
    private onStatusChange: (event: LocalWhisperEvent) => void
    private modelReady = false
    private pendingAudio: Float32Array[] = []

    constructor(onStatusChange: (event: LocalWhisperEvent) => void) {
        this.onStatusChange = onStatusChange
    }

    /**
     * Creates the Web Worker from the inline code blob
     */
    private createWorker(): Worker {
        const blob = new Blob([WORKER_CODE], { type: "text/javascript" })
        const url = URL.createObjectURL(blob)
        const worker = new Worker(url, { type: "module" })
        URL.revokeObjectURL(url) // Worker keeps its own reference
        return worker
    }

    /**
     * Initialize the worker and load the model
     */
    public async initialize(modelId: string = "onnx-community/whisper-base"): Promise<void> {
        if (this.worker) return

        try {
            this.worker = this.createWorker()
            this.worker.onmessage = (e) => {
                const event = e.data as LocalWhisperEvent
                
                // Track when model is ready
                if (event.status === "ready") {
                    this.modelReady = true
                    console.log("[LocalWhisperClient] Model ready, processing", this.pendingAudio.length, "queued audio chunks")
                    // Process any queued audio
                    this.flushPendingAudio()
                }
                
                this.onStatusChange(event)
            }
            this.worker.onerror = (e) => {
                this.onStatusChange({
                    status: "error",
                    data: e.message || "Worker error",
                })
            }

            // Load the model
            this.worker.postMessage({ type: "load", modelId })
        } catch (error) {
            this.onStatusChange({
                status: "error",
                data: `Failed to initialize worker: ${error instanceof Error ? error.message : String(error)}`,
            })
        }
    }

    /**
     * Process recorded audio blob into 16kHz Float32 mono array for the model
     */
    private async processAudioBlob(blob: Blob): Promise<Float32Array | null> {
        if (!blob || blob.size === 0) return null

        const arrayBuffer = await blob.arrayBuffer()
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioContext) throw new Error("AudioContext not supported")

        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        const length = decoded.length
        const inSr = decoded.sampleRate
        const numChannels = decoded.numberOfChannels

        // Mix to mono
        const tmp = new Float32Array(length)
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = decoded.getChannelData(ch)
            for (let i = 0; i < length; i++) {
                tmp[i] += channelData[i]
            }
        }
        // Normalize if mixed multiple channels
        if (numChannels > 1) {
            for (let i = 0; i < length; i++) {
                tmp[i] /= numChannels
            }
        }

        // Resample if necessary
        if (inSr === TARGET_SAMPLE_RATE) {
            await ctx.close()
            return tmp
        }

        // Linear interpolation resampling
        const ratio = inSr / TARGET_SAMPLE_RATE
        const outLen = Math.round(length / ratio)
        const out = new Float32Array(outLen)

        for (let i = 0; i < outLen; i++) {
            const idx = i * ratio
            const i0 = Math.floor(idx)
            const i1 = Math.min(i0 + 1, length - 1)
            const frac = idx - i0
            out[i] = tmp[i0] * (1 - frac) + tmp[i1] * frac
        }

        await ctx.close()
        return out
    }

    /**
     * Start recording audio from the microphone
     */
    public async startRecording(deviceId?: string): Promise<void> {
        if (this.isRecording) return

        this.audioChunks = []
        this.isRecording = true

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Microphone access not supported")
            }

            const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true }
            console.log("[LocalWhisperClient] Requesting microphone access with constraints:", constraints)
            let stream: MediaStream
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints)
            } catch (err) {
                console.error("[LocalWhisperClient] getUserMedia failed:", err)
                if (err instanceof DOMException && err.name === "NotAllowedError") {
                    // Provide helpful guidance for VS Code users
                    const errorMessage = "Microphone access denied.\n\n" +
                        "Please check System Settings → Privacy & Security → Microphone\n" +
                        "and ensure VS Code/Windsurf has microphone access enabled."
                    throw new Error(errorMessage)
                }
                throw err
            }

            // Simple mime type detection
            let mimeType = undefined
            const types = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/wav"]
            for (const t of types) {
                if (MediaRecorder.isTypeSupported(t)) {
                    mimeType = t
                    break
                }
            }

            this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.audioChunks.push(e.data)
                }
            }

            this.mediaRecorder.onstop = async () => {
                try {
                    if (this.audioChunks.length === 0) {
                        this.onStatusChange({ status: "error", data: "No audio recorded" })
                        return
                    }

                    const blob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || "audio/webm" })
                    this.audioChunks = []

                    const f32 = await this.processAudioBlob(blob)
                    if (!f32 || f32.length === 0) {
                        this.onStatusChange({ status: "error", data: "Audio processing failed (empty result)" })
                        return
                    }

                    // Send to worker for transcription
                    if (this.worker) {
                        this.worker.postMessage({
                            type: "generate",
                            data: { audio: f32, language: this.language },
                        })
                    } else {
                        this.onStatusChange({ status: "error", data: "Worker not initialized" })
                    }
                } catch (error) {
                    this.onStatusChange({
                        status: "error",
                        data: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
                    })
                }

                // Cleanup stream tracks
                stream.getTracks().forEach((track) => track.stop())
            }

            this.mediaRecorder.start(100) // 100ms chunks
        } catch (error) {
            this.isRecording = false
            this.onStatusChange({
                status: "error",
                data: `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`,
            })
        }
    }

    /**
     * Stop recording and trigger transcription
     */
    public stopRecording(): void {
        if (!this.isRecording || !this.mediaRecorder) return

        this.isRecording = false
        if (this.mediaRecorder.state === "recording") {
            this.mediaRecorder.stop()
        }
    }

    /**
     * Transcribe audio directly (audio captured via FFmpeg in extension host)
     * This is used when audio comes from the extension host instead of getUserMedia
     */
    public transcribeAudio(audio: Float32Array): void {
        if (!this.worker) {
            this.onStatusChange({
                status: "error",
                data: "Worker not initialized. Call initialize() first.",
            })
            return
        }

        if (!audio || audio.length === 0) {
            this.onStatusChange({
                status: "error",
                data: "No audio data provided",
            })
            return
        }

        if (!this.modelReady) {
            // Queue audio until model is ready
            console.log(`[LocalWhisperClient] Model not ready, queuing ${audio.length} samples (${this.pendingAudio.length} chunks queued)`)
            this.pendingAudio.push(audio)
            return
        }

        console.log(`[LocalWhisperClient] Transcribing ${audio.length} samples`)
        
        // Send to worker for transcription
        this.worker.postMessage({
            type: "generate",
            data: { audio, language: this.language },
        })
    }

    /**
     * Flush any pending audio that was queued while model was loading
     */
    private flushPendingAudio(): void {
        if (this.pendingAudio.length === 0 || !this.worker) return

        // Combine all pending audio into one chunk
        const totalLength = this.pendingAudio.reduce((sum, chunk) => sum + chunk.length, 0)
        const combined = new Float32Array(totalLength)
        let offset = 0
        for (const chunk of this.pendingAudio) {
            combined.set(chunk, offset)
            offset += chunk.length
        }
        this.pendingAudio = []

        console.log(`[LocalWhisperClient] Flushing ${combined.length} queued samples for transcription`)
        this.worker.postMessage({
            type: "generate",
            data: { audio: combined, language: this.language },
        })
    }

    /**
     * Stop the worker and cleanup
     */
    public terminate(): void {
        if (this.worker) {
            this.worker.terminate()
            this.worker = null
        }
    }
}
