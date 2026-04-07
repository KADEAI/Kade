import React, { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Brain,
  Cpu,
  Zap,
  Eye,
  Search,
  FileCode,
  GitBranch,
  Send,
  Loader2,
  RefreshCw,
} from "lucide-react";

// Thinking phase types
export type ThinkingPhase =
  | "initializing"
  | "analyzing"
  | "searching"
  | "reasoning"
  | "planning"
  | "generating"
  | "verifying"
  | "complete";

interface AdvancedThinkingIndicatorProps {
  phase?: ThinkingPhase;
  phases?: ThinkingPhase[];
  currentPhaseIndex?: number;
  elapsedMs?: number;
  estimatedCost?: number;
  tokenCount?: number;
  isStreaming?: boolean;
  showPhases?: boolean;
  showTiming?: boolean;
  showCost?: boolean;
  showTokens?: boolean;
  compact?: boolean;
  style?: "minimal" | "detailed" | "pulse" | "particles";
  message?: string;
  onPhaseClick?: (phase: ThinkingPhase) => void;
}

// Phase configuration with icons and labels
const PHASE_CONFIG: Record<
  ThinkingPhase,
  { icon: React.ElementType; label: string; color: string; bgColor: string }
> = {
  initializing: {
    icon: RefreshCw,
    label: "Initializing",
    color: "text-vscode-descriptionForeground",
    bgColor: "bg-vscode-descriptionForeground/10",
  },
  analyzing: {
    icon: Eye,
    label: "Analyzing context",
    color: "text-vscode-textPreformat-foreground",
    bgColor: "bg-vscode-textPreformat-foreground/10",
  },
  searching: {
    icon: Search,
    label: "Searching codebase",
    color: "text-vscode-symbolIcon-file-color",
    bgColor: "bg-vscode-symbolIcon-file-color/10",
  },
  reasoning: {
    icon: Brain,
    label: "Reasoning",
    color: "text-vscode-symbolIcon-event-color",
    bgColor: "bg-vscode-symbolIcon-event-color/10",
  },
  planning: {
    icon: GitBranch,
    label: "Planning approach",
    color: "text-vscode-symbolIcon-reference-color",
    bgColor: "bg-vscode-symbolIcon-reference-color/10",
  },
  generating: {
    icon: Sparkles,
    label: "Generating response",
    color: "text-vscode-symbolIcon-keyword-color",
    bgColor: "bg-vscode-symbolIcon-keyword-color/10",
  },
  verifying: {
    icon: FileCode,
    label: "Verifying solution",
    color: "text-vscode-symbolIcon-constructor-color",
    bgColor: "bg-vscode-symbolIcon-constructor-color/10",
  },
  complete: {
    icon: Zap,
    label: "Complete",
    color: "text-vscode-charts-green",
    bgColor: "bg-vscode-charts-green/10",
  },
};

// Format milliseconds to readable time
const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

// Minimal style - simple animated indicator
const MinimalThinkingIndicator: React.FC<AdvancedThinkingIndicatorProps> = ({
  phase = "reasoning",
  elapsedMs = 0,
  isStreaming = true,
  message,
}) => {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const label = message || config.label;

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className="thinking-pulse-ring w-4 h-4" />
        <Icon
          className={cn("w-4 h-4 animate-pulse relative z-10", config.color)}
        />
        {isStreaming && (
          <span className="absolute -bottom-1 -right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vscode-foreground opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-vscode-foreground"></span>
          </span>
        )}
      </div>
      <span className={cn("text-sm font-medium", config.color)}>{label}</span>
      {elapsedMs > 0 && (
        <span className="text-xs text-vscode-descriptionForeground ml-1">
          ({formatTime(elapsedMs)})
        </span>
      )}
    </div>
  );
};

// Detailed style - shows all phases with progress
const DetailedThinkingIndicator: React.FC<AdvancedThinkingIndicatorProps> = ({
  phases = [
    "initializing",
    "analyzing",
    "reasoning",
    "generating",
    "verifying",
  ],
  currentPhaseIndex = 0,
  elapsedMs = 0,
  showTiming = true,
  showCost = false,
  estimatedCost,
  showTokens = false,
  tokenCount,
  message,
  onPhaseClick,
}) => {
  const { t } = useTranslation();
  const headerLabel = message || "Thinking";

  return (
    <div className="w-full">
      {/* Header with timing */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-vscode-foreground animate-pulse" />
          <span className="font-semibold text-vscode-foreground">
            {headerLabel}
          </span>
          {showTiming && elapsedMs > 0 && (
            <span className="text-xs text-vscode-descriptionForeground px-2 py-0.5 bg-vscode-editor-background rounded">
              {formatTime(elapsedMs)}
            </span>
          )}
          {showCost && estimatedCost !== undefined && (
            <span className="text-xs text-vscode-descriptionForeground px-2 py-0.5 bg-vscode-editor-background rounded">
              ~${estimatedCost.toFixed(4)}
            </span>
          )}
          {showTokens && tokenCount !== undefined && (
            <span className="text-xs text-vscode-descriptionForeground px-2 py-0.5 bg-vscode-editor-background rounded">
              {tokenCount} tokens
            </span>
          )}
        </div>
      </div>

      {/* Message if provided */}
      {message && message !== headerLabel && (
        <div className="text-sm text-vscode-descriptionForeground mb-3 italic">
          {message}
        </div>
      )}

      {/* Phase progress bar */}
      <div className="relative mb-3">
        <div className="flex items-center gap-1">
          {phases.map((phase, index) => {
            const config = PHASE_CONFIG[phase];
            const Icon = config.icon;
            const isActive = index === currentPhaseIndex;
            const isPast = index < currentPhaseIndex;
            const isFuture = index > currentPhaseIndex;

            return (
              <React.Fragment key={phase}>
                <button
                  type="button"
                  onClick={() => onPhaseClick?.(phase)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded transition-all",
                    "border",
                    isActive
                      ? `${config.bgColor} ${config.color} border-current`
                      : isPast
                        ? "bg-vscode-editor-background text-vscode-descriptionForeground border-vscode-editorGroup-border/50"
                        : "bg-transparent text-vscode-descriptionForeground/50 border-transparent hover:bg-vscode-editor-background/50",
                  )}
                  disabled={isFuture}
                  title={`${config.label}${onPhaseClick ? " (click for details)" : ""}`}
                >
                  <Icon
                    className={cn(
                      "w-3 h-3",
                      isActive && "animate-spin",
                      isPast && "opacity-70",
                    )}
                    style={{
                      animationDirection: isActive ? "reverse" : "normal",
                    }}
                  />
                  <span className="text-xs font-medium whitespace-nowrap">
                    {config.label}
                  </span>
                </button>
                {index < phases.length - 1 && (
                  <div
                    className={cn(
                      "h-px w-8",
                      isPast
                        ? "bg-vscode-charts-green"
                        : "bg-vscode-editorGroup-border",
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
        /* Progress line */
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-vscode-editorGroup-border -z-10">
          <div
            className="h-full bg-vscode-foreground transition-all duration-300"
            style={{
              width: `${(currentPhaseIndex / (phases.length - 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Current phase detail */}
      {phases[currentPhaseIndex] && (
        <div className="flex items-center gap-2 text-sm">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-vscode-editorGroup-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-vscode-foreground animate-pulse"
                  style={{
                    width: "60%",
                    animationDelay: "0s",
                    animationDuration: "1.5s",
                  }}
                />
                <div
                  className="h-full bg-vscode-foreground/50 animate-pulse absolute top-0"
                  style={{
                    width: "60%",
                    animationDelay: "0.5s",
                    animationDuration: "1.5s",
                  }}
                />
              </div>
            </div>
          </div>
          <span className="text-xs text-vscode-descriptionForeground">
            {PHASE_CONFIG[phases[currentPhaseIndex]].label}...
          </span>
        </div>
      )}
    </div>
  );
};

// Pulse style - animated pulse effect
const PulseThinkingIndicator: React.FC<AdvancedThinkingIndicatorProps> = ({
  phase = "reasoning",
  elapsedMs = 0,
  isStreaming = true,
  showTiming = true,
  message,
}) => {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const [pulsePhase, setPulsePhase] = useState(0);
  const label = message || config.label;

  // Rotate through pulse colors
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      setPulsePhase((p) => (p + 1) % 3);
    }, 2000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  const pulseColors = ["animate-pulse", "animate-ping", "animate-bounce"];

  return (
    <div className="flex items-center gap-3">
      {/* Animated icon with pulse */}
      <div className="relative">
        <div
          className={cn(
            "absolute inset-0 rounded-full blur-lg opacity-50",
            pulsePhase === 0 && "animate-pulse bg-vscode-foreground",
            pulsePhase === 1 && "animate-ping bg-vscode-foreground",
            pulsePhase === 2 && "animate-bounce bg-vscode-foreground",
          )}
        />
        <div
          className={cn(
            "relative p-2 rounded-full",
            "border-2 border-dashed",
            config.color,
            config.bgColor,
            pulseColors[pulsePhase],
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {/* Phase label */}
      <div>
        <div className="flex items-center gap-2">
          <span className={cn("font-semibold", config.color)}>{label}</span>
          {isStreaming && (
            <span className="flex gap-1">
              <span
                className="w-1 h-1 bg-vscode-foreground rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1 h-1 bg-vscode-foreground rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1 h-1 bg-vscode-foreground rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
          )}
        </div>
        {showTiming && elapsedMs > 0 && (
          <div className="text-xs text-vscode-descriptionForeground mt-0.5">
            Elapsed: {formatTime(elapsedMs)}
          </div>
        )}
        {message && message !== label && (
          <div className="text-xs text-vscode-descriptionForeground mt-1 max-w-md truncate">
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

// Particles style - complex animated particles
const ParticlesThinkingIndicator: React.FC<AdvancedThinkingIndicatorProps> = ({
  phase = "reasoning",
  elapsedMs = 0,
  isStreaming = true,
  showTiming = true,
  message,
}) => {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const label = message || config.label;

  // Particle animation on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }> = [];

    // Initialize particles
    const initParticles = () => {
      particles.length = 0;
      for (let i = 0; i < 20; i++) {
        particles.push({
          x: canvas.width / 2,
          y: canvas.height / 2,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          size: Math.random() * 3 + 1,
          opacity: Math.random() * 0.5 + 0.3,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isStreaming) {
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;

          // Wrap around
          if (p.x < 0) p.x = canvas.width;
          if (p.x > canvas.width) p.x = 0;
          if (p.y < 0) p.y = canvas.height;
          if (p.y > canvas.height) p.y = 0;

          // Draw particle
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(150, 150, 150, ${p.opacity})`;
          ctx.fill();
        });
      }

      // Draw center icon
      const iconSize = 20;
      const centerX = canvas.width / 2 - iconSize / 2;
      const centerY = canvas.height / 2 - iconSize / 2;
      ctx.fillStyle = "var(--vscode-foreground)";
      ctx.fillRect(centerX, centerY, iconSize, iconSize);

      animationId = requestAnimationFrame(animate);
    };

    initParticles();
    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isStreaming]);

  return (
    <div className="flex items-center gap-3">
      <canvas
        ref={canvasRef}
        width={40}
        height={40}
        className="rounded-full bg-vscode-editor-background"
      />
      <div>
        <div className="flex items-center gap-2">
          <span className={cn("font-semibold", config.color)}>{label}</span>
          {isStreaming && (
            <Loader2 className={cn("w-4 h-4 animate-spin", config.color)} />
          )}
        </div>
        {showTiming && elapsedMs > 0 && (
          <div className="text-xs text-vscode-descriptionForeground mt-0.5">
            {formatTime(elapsedMs)}
          </div>
        )}
      </div>
    </div>
  );
};

// Main component that switches between styles
export const AdvancedThinkingIndicator: React.FC<
  AdvancedThinkingIndicatorProps
> = ({ style = "detailed", compact = false, ...props }) => {
  const { t } = useTranslation();

  // Auto-track elapsed time if not provided
  const [elapsedMs, setElapsedMs] = useState(props.elapsedMs ?? 0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (props.elapsedMs !== undefined) {
      setElapsedMs(props.elapsedMs);
      return;
    }

    if (props.isStreaming) {
      const tick = () => {
        setElapsedMs(Date.now() - startTimeRef.current);
      };
      tick();
      const id = setInterval(tick, 100);
      return () => clearInterval(id);
    }
  }, [props.elapsedMs, props.isStreaming]);

  // Don't show elapsed if very short
  const displayElapsed = elapsedMs > 500 ? elapsedMs : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex space-x-1">
          <span
            className="w-1.5 h-1.5 bg-vscode-foreground rounded-full animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-vscode-foreground rounded-full animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-vscode-foreground rounded-full animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        <span className="text-xs text-vscode-descriptionForeground">
          {props.message || PHASE_CONFIG[props.phase ?? "reasoning"].label}
        </span>
      </div>
    );
  }

  switch (style) {
    case "minimal":
      return <MinimalThinkingIndicator {...props} elapsedMs={displayElapsed} />;
    case "pulse":
      return <PulseThinkingIndicator {...props} elapsedMs={displayElapsed} />;
    case "particles":
      return (
        <ParticlesThinkingIndicator {...props} elapsedMs={displayElapsed} />
      );
    case "detailed":
    default:
      return (
        <DetailedThinkingIndicator {...props} elapsedMs={displayElapsed} />
      );
  }
};

// Compact inline indicator for small spaces
export const ThinkingPulse: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={cn("flex items-center gap-1", className)}>
    <span className="w-2 h-2 bg-vscode-foreground rounded-full animate-pulse" />
    <span
      className="w-2 h-2 bg-vscode-foreground/60 rounded-full animate-pulse"
      style={{ animationDelay: "150ms" }}
    />
    <span
      className="w-2 h-2 bg-vscode-foreground/30 rounded-full animate-pulse"
      style={{ animationDelay: "300ms" }}
    />
  </div>
);

// API request indicator
export const ApiRequestIndicator: React.FC<{
  provider?: string;
  model?: string;
  elapsedMs?: number;
  isRetrying?: boolean;
  retryCount?: number;
}> = ({
  provider,
  model,
  elapsedMs = 0,
  isRetrying = false,
  retryCount = 0,
}) => {
  const { t } = useTranslation();
  const displayElapsed = elapsedMs > 100 ? elapsedMs : 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Cpu className="w-4 h-4 text-vscode-symbolIcon-operator-color animate-pulse" />
      <span className="text-vscode-descriptionForeground">
        {provider || "AI"} {model && `/ ${model}`}
      </span>
      {displayElapsed > 0 && (
        <span className="text-xs text-vscode-descriptionForeground/70">
          ({formatTime(displayElapsed)})
        </span>
      )}
      {isRetrying && (
        <span className="text-xs px-1.5 py-0.5 bg-vscode-errorForeground/10 text-vscode-errorForeground rounded">
          {t("chat:apiRequest.retrying", { count: retryCount })}
        </span>
      )}
    </div>
  );
};

// Tool execution indicator
export const ToolExecutionIndicator: React.FC<{
  toolName: string;
  progress?: number;
  elapsedMs?: number;
}> = ({ toolName, progress, elapsedMs = 0 }) => {
  const displayElapsed = elapsedMs > 100 ? elapsedMs : 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Send className="w-4 h-4 text-vscode-symbolIcon-method-color animate-pulse" />
      <span className="text-vscode-descriptionForeground">{toolName}</span>
      {displayElapsed > 0 && (
        <span className="text-xs text-vscode-descriptionForeground/70">
          ({formatTime(displayElapsed)})
        </span>
      )}
      {progress !== undefined && (
        <div className="w-16 h-1 bg-vscode-editorGroup-border rounded-full overflow-hidden">
          <div
            className="h-full bg-vscode-foreground transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default AdvancedThinkingIndicator;
