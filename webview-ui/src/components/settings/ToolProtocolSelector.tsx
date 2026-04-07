import React from "react";
import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types";
import { cn } from "@src/lib/utils";
import { Star, Zap, Check, X } from "lucide-react";

interface ProtocolOption {
  id: ToolProtocol;
  name: string;
  description: string;
  example: string;
  compatibility: string;
  batchSupport: "full" | "limited" | "none";
  ratings: {
    speed: number;
    accuracy: number;
    errors: number;
  };
  icon: React.ElementType;
}

const getUnifiedRatings = () => ({
  speed: 5,
  accuracy: 5,
  errors: 5,
});

const getUnifiedExample = () =>
  "```tool read src/app.ts:L1-40\ngrep auth --path src\nfind api.ts --path src```";

const protocols: ProtocolOption[] = [
  {
    id: TOOL_PROTOCOL.JSON,
    name: "Native",
    description:
      "Preferred format. Uses provider-native JSON tool calling with strict validation, batched tools/content routers, and the best reliability when the model supports native tool usage.",
    example:
      '{\n  "tools": [\n    { "read": "src/app.ts:L1-40" },\n    { "grep": "auth|login", "path": "src" },\n    { "bash": "pnpm test", "path": "." }\n  ]\n}',
    compatibility: "Variable",
    batchSupport: "full",
    ratings: {
      speed: 5,
      accuracy: 5,
      errors: 4,
    },
    icon: Star,
  },
  {
    id: TOOL_PROTOCOL.UNIFIED,
    name: "Code Block",
    description:
      "Default fallback format. Uses Kade's code block syntax for reliable tool execution across providers, including models that do not support native tool usage.",
    example:
      "```tool read src/app.ts:L1-40\ngrep auth --path src\nfind api.ts --path src```",
    compatibility: "100%",
    batchSupport: "full",
    ratings: getUnifiedRatings(),
    icon: Zap,
  },
];

type UnifiedFormatVariant = "simple" | "structured";

interface ToolProtocolSelectorProps {
  value: ToolProtocol;
  onChange: (value: ToolProtocol) => void;
  allowNativeProtocol?: boolean;
  unifiedFormatVariant?: UnifiedFormatVariant;
  onUnifiedFormatVariantChange?: (value: UnifiedFormatVariant) => void;
  disableBatchToolUse?: boolean;
  onDisableBatchToolUseChange?: (value: boolean) => void;
  maxToolCalls?: number;
  onMaxToolCallsChange?: (value: number | undefined) => void;
  minimalSystemPrompt?: boolean;
  onMinimalSystemPromptChange?: (value: boolean) => void;
}

const ToolProtocolSelector = ({
  value,
  onChange,
  allowNativeProtocol = true,
  unifiedFormatVariant = "structured",
  onUnifiedFormatVariantChange,
  disableBatchToolUse,
  onDisableBatchToolUseChange,
  maxToolCalls,
  onMaxToolCallsChange,
  minimalSystemPrompt,
  onMinimalSystemPromptChange,
}: ToolProtocolSelectorProps) => {
  const availableProtocols = allowNativeProtocol
    ? protocols
    : protocols.filter((protocol) => protocol.id !== TOOL_PROTOCOL.JSON);

  const renderStars = (count: number) => (
    <div className="shrink-0 flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          size={10}
          className={cn(
            i < count
              ? "fill-yellow-500 text-yellow-500"
              : "text-vscode-descriptionForeground/30",
          )}
        />
      ))}
    </div>
  );

  return (
    <div className="flex min-w-0 w-full flex-col gap-2.5">
      <div className="grid min-w-0 grid-cols-1 gap-2 min-[720px]:grid-cols-2">
        {availableProtocols.map((protocol) => {
          const isSelected = value === protocol.id;
          const Icon = protocol.icon;
          return (
            <button
              key={protocol.id}
              type="button"
              onClick={() => onChange(protocol.id)}
              className={cn(
                "group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-300",
                isSelected
                  ? "bg-vscode-button-background/[0.08] border-vscode-button-background shadow-[0_8px_20px_-4px_rgba(0,0,0,0.2)]"
                  : "bg-vscode-editor-background border-vscode-input-border/20 hover:border-vscode-button-background/40 hover:bg-vscode-button-background/[0.03] hover:scale-[1.02] active:scale-[0.98]",
              )}
            >
              <div
                className={cn(
                  "rounded-full p-2 transition-all duration-300 shrink-0",
                  isSelected
                    ? "bg-vscode-button-background text-vscode-button-foreground shadow-lg shadow-vscode-button-background/20"
                    : "bg-vscode-input-background text-vscode-foreground/50 group-hover:text-vscode-foreground/80",
                )}
              >
                <Icon size={16} strokeWidth={isSelected ? 2.5 : 2} />
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block min-w-0 truncate text-[11px] font-bold uppercase tracking-wider transition-colors duration-300",
                    isSelected
                      ? "text-vscode-foreground"
                      : "text-vscode-descriptionForeground group-hover:text-vscode-foreground",
                  )}
                >
                  {protocol.name}
                </span>
                <span className="mt-0.5 block text-[10px] text-vscode-descriptionForeground/80">
                  {protocol.id === TOOL_PROTOCOL.JSON
                    ? "Native provider tool calling"
                    : "Reliable cross-provider fallback"}
                </span>
              </div>
              {protocol.id === TOOL_PROTOCOL.JSON && (
                <div className="absolute -right-8 -top-8 border border-green-500/20 bg-green-500/15 px-8 py-1 text-[7px] font-black text-green-500 rotate-45">
                  PREFERRED
                </div>
              )}
              {protocol.id === TOOL_PROTOCOL.UNIFIED && (
                <div className="absolute -right-8 -top-8 border border-vscode-input-border/40 bg-vscode-input-background/80 px-8 py-1 text-[7px] font-black text-vscode-descriptionForeground rotate-45">
                  FALLBACK
                </div>
              )}
              {isSelected && (
                <div className="absolute top-1.5 right-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-vscode-button-background animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Comparison Detail Card */}
      {(() => {
        let selected =
          availableProtocols.find((p) => p.id === value) ||
          availableProtocols[0];

        // Use dynamic ratings and example for Unified protocol
        if (selected.id === TOOL_PROTOCOL.UNIFIED) {
          selected = {
            ...selected,
            ratings: getUnifiedRatings(),
            example: getUnifiedExample(),
          };
        }

        return (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200 flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-vscode-input-border/30 bg-vscode-editor-background/60 p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="break-words break-anywhere text-[10px] leading-relaxed text-vscode-descriptionForeground">
                {selected.description}
              </p>
              <p className="break-words break-anywhere text-[10px] leading-relaxed text-vscode-foreground/70">
                {selected.id === TOOL_PROTOCOL.JSON
                  ? "Preferred when your chosen model/provider supports native tool usage."
                  : "Use this default fallback when you need a model that does not support native tool usage or are having issues with Native."}
              </p>
            </div>

            <div className="grid min-w-0 gap-3 min-[780px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">
                  Performance
                </span>
                <div className="space-y-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 text-[10px] text-vscode-foreground/70">
                      Compatibility
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-bold",
                        selected.compatibility === "100%"
                          ? "text-green-500"
                          : "text-yellow-500",
                      )}
                    >
                      {selected.compatibility}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 text-[10px] text-vscode-foreground/70">
                      Speed
                    </span>
                    {renderStars(selected.ratings.speed)}
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 text-[10px] text-vscode-foreground/70">
                      Accuracy
                    </span>
                    {renderStars(selected.ratings.accuracy)}
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 text-[10px] text-vscode-foreground/70">
                      API Errors
                    </span>
                    {renderStars(selected.ratings.errors)}
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 text-[10px] text-vscode-foreground/70">
                      Batch Usage
                    </span>
                    {selected.batchSupport === "full" ? (
                      <Check
                        size={12}
                        className="text-green-500"
                        strokeWidth={3}
                      />
                    ) : selected.batchSupport === "limited" ? (
                      <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-tighter">
                        Limited
                      </span>
                    ) : (
                      <X size={12} className="text-red-500" strokeWidth={3} />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">
                  Syntax Example
                </span>
                <div className="flex h-full min-w-0 items-center overflow-hidden rounded-md border border-vscode-input-border/20 bg-vscode-input-background/50 p-2">
                  <code className="min-w-0 whitespace-pre-wrap break-words break-anywhere text-[9px] font-mono leading-relaxed text-vscode-textLink-foreground">
                    {selected.example}
                  </code>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tool Usage Settings - Hidden for JSON protocol */}
      {value !== TOOL_PROTOCOL.MARKDOWN && (
        <div className="mt-0.5 flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-vscode-foreground/40">
            Tool Usage Limit
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="grid min-w-0 grid-cols-3 gap-1.5">
              <button
                onClick={() => {
                  onDisableBatchToolUseChange?.(true);
                  onMaxToolCallsChange?.(undefined);
                }}
                className={cn(
                  "min-w-0 rounded-md border px-2.5 py-1.5 text-[10px] font-medium transition-all duration-200",
                  disableBatchToolUse
                    ? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
                    : "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
                )}
              >
                No Batching
              </button>
              <button
                onClick={() => {
                  onDisableBatchToolUseChange?.(false);
                  onMaxToolCallsChange?.(maxToolCalls || 5);
                }}
                className={cn(
                  "min-w-0 rounded-md border px-2.5 py-1.5 text-[10px] font-medium transition-all duration-200",
                  !disableBatchToolUse && maxToolCalls !== undefined
                    ? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
                    : "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
                )}
              >
                Set Limit
              </button>
              <button
                onClick={() => {
                  onDisableBatchToolUseChange?.(false);
                  onMaxToolCallsChange?.(undefined);
                }}
                className={cn(
                  "min-w-0 rounded-md border px-2.5 py-1.5 text-[10px] font-medium transition-all duration-200",
                  !disableBatchToolUse && maxToolCalls === undefined
                    ? "bg-vscode-button-background text-vscode-button-foreground border-vscode-button-background shadow-sm"
                    : "bg-transparent text-vscode-descriptionForeground border-vscode-input-border/30 hover:border-vscode-button-background/50 hover:text-vscode-foreground",
                )}
              >
                Unlimited
              </button>
            </div>

            {/* Custom Limit Input */}
            {!disableBatchToolUse && maxToolCalls !== undefined && (
              <div className="animate-in fade-in slide-in-from-top-1 duration-200 flex min-w-0 items-center gap-2 rounded-md border border-vscode-input-border/20 bg-vscode-input-background/30 px-2.5 py-1.5">
                <span className="shrink-0 text-[10px] text-vscode-descriptionForeground">
                  Max calls per turn:
                </span>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={maxToolCalls || 5}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val > 1) {
                      onMaxToolCallsChange?.(val);
                    }
                  }}
                  className="h-7 w-16 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded-sm px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder text-center font-mono"
                />
                <span className="min-w-0 text-[10px] text-vscode-descriptionForeground/70 truncate">
                  Stream interrupts after {maxToolCalls || 5} calls
                </span>
              </div>
            )}
            {!disableBatchToolUse && maxToolCalls === undefined && (
              <div className="break-words break-anywhere px-1 text-[10px] text-vscode-descriptionForeground animate-in fade-in slide-in-from-top-1">
                No limit on tool calls per turn. The model can batch as many
                tools as needed.
              </div>
            )}
            {disableBatchToolUse && (
              <div className="break-words break-anywhere px-1 text-[10px] text-vscode-descriptionForeground animate-in fade-in slide-in-from-top-1">
                Restricts the model to making only one tool call per turn. This
                can reduce errors but may slow down complex tasks.
              </div>
            )}
          </div>

          {/* Unified Format Selection Removed */}

          {/* Minimal System Prompt Toggle */}
          {/* <div className="space-y-2">
						<div className="flex items-center justify-between">
							<label className="text-xs font-medium text-vscode-foreground">Minimal System Prompt</label>
							<button
								onClick={() => onMinimalSystemPromptChange?.(!minimalSystemPrompt)}
								className={cn(
									"relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200",
									minimalSystemPrompt
										? "bg-vscode-button-background"
										: "bg-vscode-input-border/30",
								)}>
								<span
									className={cn(
										"inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200",
										minimalSystemPrompt ? "translate-x-5" : "translate-x-0.5",
									)}
								/>
							</button>
						</div>
						<div className="text-[10px] text-vscode-descriptionForeground/70 px-1">
							Experimental: Use a minimal system prompt with only essential instructions. Reduces token usage and may improve performance but reduces guidance.
						</div>
					</div> */}
        </div>
      )}
    </div>
  );
};

export default ToolProtocolSelector;
