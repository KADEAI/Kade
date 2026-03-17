import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Terminal,
  Copy,
  Check,
  ChevronRight,
  Square,
  Play,
  Loader2,
} from "lucide-react";
import { vscode } from "@src/utils/vscode";
import { useExtensionState } from "@/context/ExtensionStateContext";
import styled, { keyframes, css, createGlobalStyle } from "styled-components";
import { motion } from "framer-motion";

const streamDown = keyframes`
  0% {
    transform: translateY(4px);
    opacity: 0.9;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
`;

const cardFadeIn = keyframes`
  0% {
    opacity: 0;
    transform: translateY(5px);
    filter: blur(3px) saturate(0.96);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0) saturate(1);
  }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const BashGlobalStyles = createGlobalStyle`
  @property --angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  @keyframes rotateBorderVar {
    from { --angle: 0deg; }
    to { --angle: 360deg; }
  }
`;

const CardContainer = styled(motion.article)<{
  $isRunning?: boolean;
  $isError?: boolean;
}>`
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: visible;
  isolation: isolate;
  animation: ${cardFadeIn} 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
  box-shadow: none;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: conic-gradient(
      from var(--angle),
      transparent 0deg,
      transparent 60deg,
      rgba(255, 255, 255, 0.4) 72deg,
      transparent 84deg,
      transparent 220deg,
      rgba(255, 255, 255, 0.3) 232deg,
      transparent 244deg,
      transparent 360deg
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: ${({ $isRunning }) => ($isRunning ? 1 : 0)};
    transition: opacity 0.18s ease;
    animation: rotateBorderVar 5.6s linear infinite;
    pointer-events: none;
    z-index: 4;
  }

  &::after {
    display: none;
    content: "";
    position: absolute;
    inset: -28% auto auto -10%;
    width: 40%;
    height: 86px;
    background: radial-gradient(
      circle,
      ${({ $isError, $isRunning }) =>
          $isError
            ? "rgba(248, 113, 113, 0.15)"
            : $isRunning
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(255, 255, 255, 0.05)"}
        0%,
      transparent 70%
    );
    filter: blur(28px);
    pointer-events: none;
    z-index: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const CardFrame = styled.div`
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: none;
  z-index: 3;
`;

const InnerWrapper = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: inherit;
  overflow: hidden;
  background: var(
    --vscode-sideBar-background,
    var(--vscode-editor-background, #1e1e1e)
  );
  backdrop-filter: none;
`;

const CardHeader = styled.div<{ $isExpanded?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 6px 11px;
  cursor: pointer;
  background: var(
    --vscode-sideBar-background,
    var(--vscode-editor-background, #1e1e1e)
  );
  border-bottom: ${({ $isExpanded }) =>
    $isExpanded
      ? "1px solid rgba(255, 255, 255, 0.06)"
      : "1px solid transparent"};
  transition:
    background 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background: var(
      --vscode-sideBar-background,
      var(--vscode-editor-background, #1e1e1e)
    );
  }
`;

const HeaderLead = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
  padding-right: 60px;
`;

const CommandIcon = styled.div`
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
`;

const CommandPreview = styled.span`
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.3;
  font-weight: 500;
  letter-spacing: -0.015em;
  color: rgba(255, 255, 255, 0.92);
  font-family: "SF Mono", "Menlo", var(--vscode-editor-font-family, monospace);
`;

const HeaderActions = styled.div<{ $alwaysVisible?: boolean }>`
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: ${({ $alwaysVisible }) => ($alwaysVisible ? 1 : 0)};
  pointer-events: ${({ $alwaysVisible }) => ($alwaysVisible ? "auto" : "none")};
  transition: opacity 0.18s ease;

  ${CardHeader}:hover & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
`;

const ActionButton = styled.button`
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    color: rgba(255, 255, 255, 0.88);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }
`;

const TerminalButton = styled(ActionButton)<{
  $variant?: "primary" | "danger";
}>`
  ${({ $variant }) =>
    $variant === "primary" &&
    css`
      &:hover:not(:disabled) {
        color: #9df0c8;
        background: rgba(16, 185, 129, 0.12);
        border-color: rgba(16, 185, 129, 0.2);
      }
    `}

  ${({ $variant }) =>
    $variant === "danger" &&
    css`
      &:hover:not(:disabled) {
        color: #ffb4ab;
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.2);
      }
    `}
`;

const ToggleIcon = styled(ChevronRight)<{ $isExpanded?: boolean }>`
  transition: transform 0.18s ease;
  transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`;

const TerminalView = styled.div.attrs({ className: "anchored-container" })`
  font-size: 12px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.68);
  overflow-y: auto;
  max-height: 170px;
  padding: 16px 14px 10px;
  padding-right: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: var(
    --vscode-sideBar-background,
    var(--vscode-editor-background, #1e1e1e)
  );
  font-family: "SF Mono", "Menlo", var(--vscode-editor-font-family, monospace);
  font-feature-settings: "tnum";

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.22);
  }
`;

const OutputContent = styled.div<{ $isStreaming?: boolean }>`
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  animation: ${({ $isStreaming }) =>
    $isStreaming
      ? css`
          ${streamDown} 0.24s cubic-bezier(0.22, 1, 0.36, 1)
        `
      : "none"};

  span {
    transition: color 0.2s ease;
    display: inline-block;
    vertical-align: middle;
    margin: 1px 0;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 11px;
  font-style: italic;
`;

const LoadingIcon = styled(Loader2)`
  width: 12px;
  height: 12px;
  animation: ${spin} 1s linear infinite;
`;

const CompleteBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
`;

function ansiToHtml(str: string): string {
  if (!str) return "";

  const colors: Record<number, string> = {
    30: "color: var(--vscode-terminal-ansiBlack)",
    31: "color: var(--vscode-terminal-ansiRed)",
    32: "color: var(--vscode-terminal-ansiGreen)",
    33: "color: var(--vscode-terminal-ansiYellow)",
    34: "color: var(--vscode-terminal-ansiBlue)",
    35: "color: var(--vscode-terminal-ansiMagenta)",
    36: "color: var(--vscode-terminal-ansiCyan)",
    37: "color: var(--vscode-terminal-ansiWhite)",
    90: "color: var(--vscode-terminal-ansiBrightBlack)",
    91: "color: var(--vscode-terminal-ansiBrightRed)",
    92: "color: var(--vscode-terminal-ansiBrightGreen)",
    93: "color: var(--vscode-terminal-ansiBrightYellow)",
    94: "color: var(--vscode-terminal-ansiBrightBlue)",
    95: "color: var(--vscode-terminal-ansiBrightMagenta)",
    96: "color: var(--vscode-terminal-ansiBrightCyan)",
    97: "color: var(--vscode-terminal-ansiBrightWhite)",
  };

  const html = str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  let currentColorStyle = "";
  let isBold = false;
  let isFaint = false;
  let isUnderline = false;
  let isInverted = false;

  let output = "";
  let lastIndex = 0;
  const regex = /\x1b\[([0-9;]*)m/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const text = html.substring(lastIndex, match.index);
    if (text) {
      const styles: string[] = [];
      if (currentColorStyle) styles.push(currentColorStyle);
      if (isBold) styles.push("font-weight: bold");
      if (isFaint) styles.push("opacity: 0.6");
      if (isUnderline) styles.push("text-decoration: underline");
      if (isInverted) styles.push("filter: invert(1)");

      if (styles.length > 0) {
        output += `<span style="${styles.join("; ")}">${text}</span>`;
      } else {
        output += text;
      }
    }

    const codes = match[1].split(";").map((c) => parseInt(c) || 0);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        currentColorStyle = "";
        isBold = false;
        isFaint = false;
        isUnderline = false;
        isInverted = false;
      } else if (colors[code]) {
        currentColorStyle = colors[code];
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isFaint = true;
      } else if (code === 3 || code === 4) {
        isUnderline = true;
      } else if (code === 7) {
        isInverted = true;
      } else if (code === 22) {
        isBold = false;
        isFaint = false;
      } else if (code === 23 || code === 24) {
        isUnderline = false;
      } else if (code === 39) {
        currentColorStyle = "";
      } else if (code === 38 && codes[i + 1] === 5) {
        const index = codes[i + 2];
        if (index < 16) {
          const base = index < 8 ? 30 + index : 90 + (index - 8);
          if (colors[base]) currentColorStyle = colors[base];
        } else {
          currentColorStyle = "color: #888";
        }
        i += 2;
      } else if (code === 38 && codes[i + 1] === 2) {
        const r = codes[i + 2];
        const g = codes[i + 3];
        const b = codes[i + 4];
        currentColorStyle = `color: rgb(${r},${g},${b})`;
        i += 4;
      }
    }
    lastIndex = regex.lastIndex;
  }

  const text = html.substring(lastIndex);
  if (text) {
    const styles: string[] = [];
    if (currentColorStyle) styles.push(currentColorStyle);
    if (isBold) styles.push("font-weight: bold");
    if (isFaint) styles.push("opacity: 0.6");
    if (isUnderline) styles.push("text-decoration: underline");
    if (isInverted) styles.push("filter: invert(1)");

    if (styles.length > 0) {
      output += `<span style="${styles.join("; ")}">${text}</span>`;
    } else {
      output += text;
    }
  }

  return output;
}

interface BashProps {
  command: string;
  output?: string;
  isError?: boolean;
  isKey?: boolean;
  isRunning?: boolean;
  executionId?: string;
  isAskingToProceed?: boolean;
  allowOutputAutoScroll?: boolean;
}

function normalizeOutput(content: string): string {
  if (!content) return content;

  const half = Math.floor(content.length / 2);
  if (
    content.length % 2 === 0 &&
    content.slice(0, half) === content.slice(half)
  ) {
    content = content.slice(0, half);
  }

  const lines = content.split("\n");
  const deduped: string[] = [];
  for (const line of lines) {
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1] === line &&
      line.trim().length > 0
    ) {
      continue;
    }
    deduped.push(line);
  }

  return deduped.join("\n").replace(/\n+$/g, "");
}

export const Bash = ({
  command,
  output: initialOutput,
  isError,
  isKey,
  isRunning,
  executionId,
  isAskingToProceed,
  allowOutputAutoScroll = true,
}: BashProps) => {
  const { collapseCodeToolsByDefault = false } = useExtensionState();
  const [streamBuffer, setStreamBuffer] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [isProceeding, setIsProceeding] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(
    !collapseCodeToolsByDefault,
  );
  const prevIsActiveRef = useRef(Boolean(isRunning || isAskingToProceed));
  const collapseTimeoutRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsAborting(false);
    setIsProceeding(false);
  }, [isRunning, isAskingToProceed]);

  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current !== null) {
        window.clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (collapseCodeToolsByDefault) {
      prevIsActiveRef.current = Boolean(isRunning || isAskingToProceed);
      return;
    }

    const isActive = Boolean(isRunning || isAskingToProceed);
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }

    if (isActive) {
      setJustCompleted(false);
      setIsExpanded(true);
      return;
    }

    if (wasActive && !isActive) {
      if (!isError) setJustCompleted(true);
      collapseTimeoutRef.current = window.setTimeout(() => {
        setIsExpanded(false);
        collapseTimeoutRef.current = null;
      }, 1500);
    }
  }, [collapseCodeToolsByDefault, isRunning, isAskingToProceed, isError]);

  useEffect(() => {
    setStreamBuffer(normalizeOutput(initialOutput || ""));
  }, [initialOutput]);

  useEffect(() => {
    if (isRunning && allowOutputAutoScroll && outputRef.current) {
      const el = outputRef.current;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [streamBuffer, isRunning, allowOutputAutoScroll]);

  const outputHtml = useMemo(() => {
    let content = streamBuffer;
    if (content.includes("MCP error") && content.includes("AbortError")) {
      content = "";
    }
    return ansiToHtml(content);
  }, [streamBuffer]);

  const cleanCommand = useMemo(() => {
    const raw = (command || "").trim();
    if (raw.includes("Command:")) {
      const match = raw.match(/Command:\s*([^\n]+)/i);
      if (match) return match[1].trim();
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed.command) return parsed.command.trim();
    } catch {
      // Ignore JSON parse failures and fall back to raw text.
    }
    if (!raw || raw.startsWith("Output:")) {
      const outputText =
        initialOutput || raw.replace(/^Output:\s*/i, "").trim();
      if (outputText) {
        const pingMatch = outputText.match(/^Pinging\s+([^\s\[]+)/i);
        if (pingMatch) return `ping ${pingMatch[1]}`;
      }
      return "";
    }
    return raw.split("\nOutput:")[0].trim();
  }, [command, initialOutput]);

  const onCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(cleanCommand || command);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  const onStop = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsAborting(true);
    vscode.postMessage({
      type: "terminalOperation",
      terminalOperation: "abort",
    });
  };

  const onProceed = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsProceeding(true);
    vscode.postMessage({
      type: "terminalOperation",
      terminalOperation: "continue",
    });
  };

  const onToggleExpand = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    setIsExpanded((current) => !current);
  };

  const emptyLabel = isRunning ? "Waiting for output..." : "No output";

  return (
    <CardContainer
      $isRunning={isRunning}
      $isError={isError}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <CardFrame aria-hidden="true" />
      <InnerWrapper>
        <CardHeader $isExpanded={isExpanded} onClick={() => onToggleExpand()}>
          <HeaderLead>
            <CommandIcon>
              <Terminal size={11} strokeWidth={2.1} />
            </CommandIcon>
            <CommandPreview>
              {cleanCommand || "Terminal command"}
            </CommandPreview>
            {justCompleted && !isError && (
              <CompleteBadge title="Command completed">
                <Check size={9} strokeWidth={2.8} />
              </CompleteBadge>
            )}
          </HeaderLead>

          <HeaderActions
            $alwaysVisible={Boolean(isRunning || isAskingToProceed)}
            onClick={(event) => event.stopPropagation()}
          >
            {(isRunning || isAskingToProceed) && (
              <ActionGroup>
                <TerminalButton
                  $variant="primary"
                  onClick={onProceed}
                  disabled={isProceeding || isAborting}
                  title="Proceed"
                >
                  {isProceeding ? <LoadingIcon /> : <Play size={12} />}
                  <span className="sr-only">Proceed</span>
                </TerminalButton>

                <TerminalButton
                  $variant="danger"
                  onClick={onStop}
                  disabled={isAborting || isProceeding}
                  title="Stop"
                >
                  {isAborting ? <LoadingIcon /> : <Square size={12} />}
                  <span className="sr-only">Stop</span>
                </TerminalButton>
              </ActionGroup>
            )}

            <ActionGroup>
              <ActionButton
                onClick={onCopy}
                title={isCopied ? "Copied" : "Copy"}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                <span className="sr-only">Copy</span>
              </ActionButton>

              <ActionButton
                onClick={onToggleExpand}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                <ToggleIcon size={14} $isExpanded={isExpanded} />
                <span className="sr-only">
                  {isExpanded ? "Collapse" : "Expand"}
                </span>
              </ActionButton>
            </ActionGroup>
          </HeaderActions>
        </CardHeader>

        {isExpanded && (
          <TerminalView ref={outputRef} data-testid="bash-output">
            {outputHtml ? (
              <OutputContent
                $isStreaming={isRunning}
                dangerouslySetInnerHTML={{ __html: outputHtml }}
              />
            ) : (
              !isKey && (
                <EmptyState>
                  <Terminal size={13} strokeWidth={2} />
                  {emptyLabel}
                </EmptyState>
              )
            )}
          </TerminalView>
        )}
      </InnerWrapper>
    </CardContainer>
  );
};
