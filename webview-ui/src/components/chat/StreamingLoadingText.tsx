import React from "react";
import styled, { css, keyframes } from "styled-components";
import { Eye, Terminal } from "lucide-react";
import type { ClineMessage } from "@roo-code/types";
import type { ClineSayTool } from "@roo/ExtensionMessage";
import { getToolActivityLabel } from "./toolActivityLabels";

export const WORKING_STATUS_TRANSLATIONS = [
  "Working",
  "Laborans",
  "Lavorando",
  "Arbeitend",
  "Trabajando",
  "Werkend",
  "Arbeider",
  "Arbejder",
  "Työskentelee",
  "Vinnur",
  "Pracuje",
  "Dela",
  "Radi",
  "Lucrează",
  "Dolgozik",
  "Strādā",
  "Dirba",
  "Εργάζεται",
  "Работает",
  "Працює",
  "Работи",
  "Çalışıyor",
  "Treballant",
  "Traballando",
  "Laboras",
  "Travaille",
  "Lanean",
  "Labourat",
  "Đang làm việc",
  "Bekerja",
  "作業中",
  "実行中",
  "稼働中",
  "工作中",
  "작업 중",
  "Gweithio",
] as const;

export const WORKING_TRANSLATION_INTERVAL_MS = 1400;

export const STATUS_VARIANTS = {
  "Running commands": [
    "Running commands",
    "Processing commands",
    "Executing commands",
    "Handling commands",
    "Issuing commands",
    "Launching commands",
    "Using terminal",
  ],
  "Reading files": [
    "Reading files",
    "Inspecting files",
    "Reviewing files",
    "Scanning files",
    "Checking files",
    "Analyzing files",
  ],
  "Writing files": [
    "Writing files",
    "Creating files",
    "Saving files",
    "Saving changes",
  ],
  "Editing files": [
    "Editing files",
    "Updating files",
    "Patching files",
    "Refining changes",
    "Modifying files",
    "Revising files",
    "Adjusting files",
    "Refining files",
    "Tweaking files",
    "Reworking files",
  ],
  "Exploring directories": [
    "Exploring directories",
    "Browsing folders",
    "Scanning folders",
    "Checking folders",
    "Reviewing folders",
    "Inspecting folders",
    "Analyzing folders",
  ],
  "Searching the web": [
    "Searching web",
    "Browsing web",
    "Scanning web",
    "Checking web",
    "Reviewing sources",
    "Finding sources",
  ],
  "Reading web pages": [
    "Reading pages",
    "Fetching pages",
    "Reviewing pages",
    "Scanning pages",
  ],
  "Researching online": [
    "Researching online",
    "Reviewing sources",
    "Finding sources",
    "Searching web",
    "Browsing web",
    "Checking web",
  ],
} as const;

const squarePulse = keyframes`
  0%, 100% {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.02);
  }
  50% {
    border-color: rgba(255, 255, 255, 0.26);
    background: rgba(255, 255, 255, 0.06);
  }
`;

const dotPulse = keyframes`
  0%, 100% {
    opacity: 0.3;
    transform: scale(0.82);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
`;

const elapsedGlow = keyframes`
  0%, 100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.95;
  }
`;

const webSquarePulse = keyframes`
  0%, 100% {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(92, 110, 255, 0.08);
  }
  50% {
    border-color: rgba(255, 255, 255, 0.32);
    background: rgba(255, 122, 78, 0.12);
  }
`;

const writeSquarePulse = keyframes`
  0%, 100% {
    border-color: rgba(92, 162, 255, 0.28);
    background: rgba(63, 140, 255, 0.08);
  }
  50% {
    border-color: rgba(116, 188, 255, 0.42);
    background: rgba(77, 156, 255, 0.14);
  }
`;

const editSquarePulse = keyframes`
  0%, 100% {
    border-color: rgba(74, 128, 92, 0.28);
    background: rgba(32, 72, 46, 0.1);
  }
  50% {
    border-color: rgba(98, 158, 118, 0.42);
    background: rgba(44, 88, 58, 0.15);
  }
`;

const eyeBlink = keyframes`
  0%, 44%, 100% {
    transform: scaleY(1);
  }
  46%, 48% {
    transform: scaleY(0.14);
  }
  50%, 82% {
    transform: scaleY(1);
  }
  84%, 86% {
    transform: scaleY(0.18);
  }
  88%, 100% {
    transform: scaleY(1);
  }
`;

const headerSweep = keyframes`
  0% {
    transform: translateX(-135%);
  }
  100% {
    transform: translateX(135%);
  }
`;

const statusEntrance = keyframes`
  0% {
    opacity: 0;
    transform: translate3d(0, 0px, 0) scale(0.985);
    filter: blur(4px);
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
    filter: blur(0);
  }
`;

const StatusShell = styled.div<{
  $compact?: boolean;
  $active?: boolean;
  $animateOnMount?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: ${({ $compact }) => ($compact ? "3px" : "4px")};
  min-height: ${({ $compact }) => ($compact ? "18px" : "28px")};
  padding: ${({ $compact, $active }) =>
    $active ? ($compact ? "2px 6px" : "4px 8px") : "0"};
  position: relative;
  overflow: ${({ $active }) => ($active ? "hidden" : "visible")};
  border-radius: ${({ $active }) => ($active ? "999px" : "0")};
  transform: translateZ(0);
  backface-visibility: hidden;
  margin-left: -2.4px;
  background: ${({ $active }) =>
    $active ? "rgba(255, 255, 255, 0.035)" : "transparent"};
  ${({ $animateOnMount }) =>
    $animateOnMount
      ? css`
          animation: ${statusEntrance} 0.44s cubic-bezier(0.16, 1, 0.3, 1)
            both;
          will-change: opacity, transform, filter;

          @media (prefers-reduced-motion: reduce) {
            animation: none;
          }
        `
      : null}

  & > * {
    position: relative;
    z-index: 1;
  }

  ${({ $active }) =>
    $active
      ? css`
          &::after {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
            background: linear-gradient(
              90deg,
              rgba(0, 0, 0, 0) 0%,
              rgba(0, 0, 0, 0.14) 28%,
              rgba(0, 0, 0, 0.34) 50%,
              rgba(0, 0, 0, 0.14) 72%,
              rgba(0, 0, 0, 0) 100%
            );
            transform: translateX(-135%);
            animation: ${headerSweep} 1.9s ease-in-out infinite;
          }
        `
      : null}
`;

type GridVariant = "default" | "web" | "write" | "edit";

const webDotPalette = [
  "#8ab4ff",
  "#7ce7f6",
  "#6af0b6",
  "#f8d86c",
  "#ffae57",
  "#ff7e6b",
  "#ff7fcf",
  "#c592ff",
  "#8ca4ff",
];

const getDotColor = (variant: GridVariant, index: number) => {
  if (variant === "edit") {
    return index === 4 ? "#7db28d" : "#3f7251";
  }

  if (variant === "write") {
    return index === 4 ? "#a9d2ff" : "#5ca7ff";
  }

  if (variant === "web") {
    return webDotPalette[index % webDotPalette.length];
  }

  return "rgba(255, 255, 255, 0.9)";
};

const SquareGlyph = styled.div<{
  $compact?: boolean;
  $active?: boolean;
  $variant?: GridVariant;
}>`
  width: ${({ $compact }) => ($compact ? "12px" : "22px")};
  height: ${({ $compact }) => ($compact ? "12px" : "22px")};
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ $compact }) => ($compact ? "1px" : "2px")};
  padding: ${({ $compact }) => ($compact ? "1px" : "2px")};
  border-radius: ${({ $compact }) => ($compact ? "3px" : "5px")};
  border: 1px solid
    ${({ $variant }) =>
      $variant === "edit"
        ? "rgba(74, 128, 92, 0.32)"
        : $variant === "write"
          ? "rgba(92, 162, 255, 0.3)"
          : $variant === "web"
            ? "rgba(255, 255, 255, 0.24)"
            : "rgba(255, 255, 255, 0.14)"};
  background: ${({ $variant }) =>
    $variant === "edit"
      ? "rgba(32, 72, 46, 0.08)"
      : $variant === "write"
        ? "rgba(63, 140, 255, 0.06)"
        : $variant === "web"
          ? "rgba(92, 110, 255, 0.05)"
          : "transparent"};
  box-shadow: ${({ $variant }) =>
    $variant === "edit"
      ? "0 0 0 1px rgba(50, 92, 63, 0.12), 0 4px 10px rgba(18, 48, 28, 0.16)"
      : $variant === "write"
        ? "0 0 0 1px rgba(54, 118, 255, 0.08), 0 4px 10px rgba(36, 99, 235, 0.1)"
        : $variant === "web"
          ? "0 0 0 1px rgba(255, 255, 255, 0.06), 0 4px 10px rgba(124, 91, 255, 0.12)"
          : "none"};
  animation: ${({ $active, $variant }) => {
    if (!$active) {
      return "none";
    }

    if ($variant === "web") {
      return css`
        ${webSquarePulse} 2s ease-in-out infinite
      `;
    }

    if ($variant === "write") {
      return css`
        ${writeSquarePulse} 2s ease-in-out infinite
      `;
    }

    if ($variant === "edit") {
      return css`
        ${editSquarePulse} 2s ease-in-out infinite
      `;
    }

    return css`
      ${squarePulse} 2s ease-in-out infinite
    `;
  }};
`;

const SquareDot = styled.span<{
  $delay: number;
  $active?: boolean;
  $variant?: GridVariant;
  $index: number;
}>`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: ${({ $variant = "default", $index }) =>
    getDotColor($variant, $index)};
  box-shadow: ${({ $variant = "default", $index }) =>
    $variant === "default"
      ? "none"
      : `0 0 10px ${getDotColor($variant, $index)}44`};
  animation: ${({ $active, $delay }) =>
    $active
      ? css`
          ${dotPulse} 1.2s ease-in-out ${$delay}ms infinite
        `
      : "none"};
  opacity: ${({ $active }) => ($active ? 1 : 0.5)};
  transform: scale(${({ $active }) => ($active ? 1 : 0.88)});
`;

const TerminalGlyph = styled.div<{ $compact?: boolean; $active?: boolean }>`
  width: ${({ $compact }) => ($compact ? "12px" : "22px")};
  height: ${({ $compact }) => ($compact ? "12px" : "22px")};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ $compact }) => ($compact ? "3px" : "5px")};
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.84);
  background: rgba(255, 255, 255, 0.025);
  animation: ${({ $active }) =>
    $active
      ? css`
          ${squarePulse} 2s ease-in-out infinite
        `
      : "none"};
  opacity: ${({ $active }) => ($active ? 1 : 0.6)};

  svg {
    width: ${({ $compact }) => ($compact ? "8px" : "13px")};
    height: ${({ $compact }) => ($compact ? "8px" : "13px")};
    stroke-width: 2.15;
  }
`;

const EyeGlyph = styled.div<{ $compact?: boolean; $active?: boolean }>`
  width: ${({ $compact }) => ($compact ? "12px" : "22px")};
  height: ${({ $compact }) => ($compact ? "12px" : "22px")};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ $compact }) => ($compact ? "3px" : "5px")};
  border: 1px solid rgba(130, 214, 255, 0.2);
  color: rgba(170, 232, 255, 0.9);
  background: rgba(112, 196, 255, 0.05);
  box-shadow:
    0 0 0 1px rgba(112, 196, 255, 0.08),
    0 4px 10px rgba(44, 147, 255, 0.08);
  animation: ${({ $active }) =>
    $active
      ? css`
          ${squarePulse} 2s ease-in-out infinite
        `
      : "none"};
  opacity: ${({ $active }) => ($active ? 1 : 0.68)};

  svg {
    width: ${({ $compact }) => ($compact ? "8px" : "13px")};
    height: ${({ $compact }) => ($compact ? "8px" : "13px")};
    stroke-width: 2.05;
    transform-origin: center;
    animation: ${({ $active }) =>
      $active
        ? css`
            ${eyeBlink} 2.8s ease-in-out infinite
          `
        : "none"};
  }
`;

const StatusLabel = styled.span`
  color: color-mix(in srgb, var(--vscode-foreground) 78%, transparent);
  font-size: 13px;
  line-height: 1.2;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Elapsed = styled.span<{ $active?: boolean }>`
  color: color-mix(in srgb, var(--vscode-foreground) 48%, transparent);
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  margin-left: 1px;
  animation: ${({ $active }) =>
    $active
      ? css`
          ${elapsedGlow} 1.8s ease-in-out infinite
        `
      : "none"};
`;

const dotDelays = [0, 120, 240, 120, 240, 360, 240, 360, 480];
const hasStaticStatusVariants = (
  text?: string,
): text is keyof typeof STATUS_VARIANTS =>
  !!text && Object.prototype.hasOwnProperty.call(STATUS_VARIANTS, text);

const shouldCycleWorkingLabel = (text?: string) =>
  text?.trim().toLowerCase() === "working";

export const buildWorkingStatusRotation = (
  random = Math.random,
): readonly string[] => {
  const [startingLabel, ...rest] = WORKING_STATUS_TRANSLATIONS;
  const shuffled = [...rest];

  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return [startingLabel, ...shuffled];
};

export const pickStatusVariant = (
  text: keyof typeof STATUS_VARIANTS,
  random = Math.random,
) => {
  const variants = STATUS_VARIANTS[text];
  return variants[Math.floor(random() * variants.length)] || text;
};

const COMMAND_STATUS_LABELS = new Set<string>(
  STATUS_VARIANTS["Running commands"],
);
const FILE_READING_STATUS_LABELS = new Set<string>(
  STATUS_VARIANTS["Reading files"],
);
const FILE_WRITING_STATUS_LABELS = new Set<string>(
  STATUS_VARIANTS["Writing files"],
);
const FILE_EDITING_STATUS_LABELS = new Set<string>(
  STATUS_VARIANTS["Editing files"],
);
const WEB_ACTIVITY_LABELS = new Set<string>([
  ...STATUS_VARIANTS["Searching the web"],
  ...STATUS_VARIANTS["Reading web pages"],
  ...STATUS_VARIANTS["Researching online"],
]);

const isToolMessage = (message?: ClineMessage) =>
  !!message && (message.ask === "tool" || message.say === "tool");

const parseTool = (message?: ClineMessage): ClineSayTool | null => {
  if (!isToolMessage(message) || !message?.text) {
    return null;
  }

  try {
    return JSON.parse(message.text) as ClineSayTool;
  } catch {
    return null;
  }
};

const normalizeStatusText = (text?: string, fallback = "Thinking") => {
  const cleaned = (text || "")
    .replace(/[`*_>#~\-]+/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return fallback;
  }

  const firstPhrase = cleaned
    .split(/(?<=[.!?])\s|\n/)
    .find(Boolean)
    ?.trim()
    .replace(/[•.]+$/, "");

  const candidate = (firstPhrase || cleaned).slice(0, 52).trim();
  if (!candidate) {
    return fallback;
  }

  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
};

const getStructuredReasoningLabel = (text?: string, fallback = "Thinking") => {
  if (!text?.trim()) {
    return fallback;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return fallback;
  }

  const isStructuralBoundary = (line: string) => {
    if (/^#{1,6}\s+/.test(line)) {
      return true;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      return true;
    }

    if (/^[-*+•]\s+/.test(line)) {
      return true;
    }

    if (/^[A-Z0-9"'`].{0,90}:$/.test(line)) {
      return true;
    }

    return false;
  };

  const firstContentLine = lines.find((line) => !isStructuralBoundary(line));
  let latestCommittedLabel = firstContentLine
    ? normalizeStatusText(firstContentLine, fallback)
    : fallback;

  for (let index = 0; index < lines.length; index++) {
    if (!isStructuralBoundary(lines[index])) {
      continue;
    }

    const nextContentLine = lines
      .slice(index + 1)
      .find((line) => !isStructuralBoundary(line));
    if (nextContentLine) {
      latestCommittedLabel = normalizeStatusText(nextContentLine, fallback);
    }
  }

  return latestCommittedLabel;
};

export const deriveAgentStatusLabel = (
  messages: ClineMessage[],
  currentTs: number,
  fallback = "Thinking",
) => {
  const currentIndex = messages.findIndex((msg) => msg.ts === currentTs);
  if (currentIndex === -1) {
    return fallback;
  }

  const forwardWindow = messages.slice(currentIndex, currentIndex + 7);
  const backwardWindow = messages
    .slice(Math.max(0, currentIndex - 2), currentIndex)
    .reverse();
  const nearbyMessages = [...forwardWindow, ...backwardWindow];
  const commandStatusLabel = getToolActivityLabel("bash") || fallback;

  for (const candidate of nearbyMessages) {
    if (
      candidate.partial &&
      (candidate.say === "command" ||
        candidate.ask === "command" ||
        candidate.say === "command_output" ||
        candidate.ask === "command_output")
    ) {
      return commandStatusLabel;
    }
  }

  for (const candidate of nearbyMessages) {
    const tool = parseTool(candidate);
    if (candidate.partial && tool?.tool) {
      return (
        getToolActivityLabel(tool.tool) ||
        normalizeStatusText(tool.tool, fallback)
      );
    }
  }

  for (const candidate of nearbyMessages) {
    if (
      candidate.partial &&
      (candidate.say === "reasoning" || candidate.say === "text") &&
      candidate.text?.trim()
    ) {
      return getStructuredReasoningLabel(candidate.text, fallback);
    }
  }

  for (const candidate of nearbyMessages) {
    if (
      candidate.say === "command" ||
      candidate.ask === "command" ||
      candidate.say === "command_output" ||
      candidate.ask === "command_output"
    ) {
      return commandStatusLabel;
    }
  }

  for (const candidate of nearbyMessages) {
    const tool = parseTool(candidate);
    if (tool?.tool) {
      return (
        getToolActivityLabel(tool.tool) ||
        normalizeStatusText(tool.tool, fallback)
      );
    }
  }

  for (const candidate of nearbyMessages) {
    if (
      (candidate.say === "reasoning" || candidate.say === "text") &&
      candidate.text?.trim()
    ) {
      return getStructuredReasoningLabel(candidate.text, fallback);
    }
  }

  return fallback;
};

interface AgentStatusPillProps {
  text?: string;
  elapsedSeconds?: number;
  compact?: boolean;
  className?: string;
  active?: boolean;
  animateOnMount?: boolean;
}

export const AgentStatusPill = ({
  text = "Thinking",
  elapsedSeconds,
  compact = false,
  className,
  active = true,
  animateOnMount = false,
}: AgentStatusPillProps) => {
  const showTerminalGlyph = COMMAND_STATUS_LABELS.has(text);
  const showReadingGlyph = FILE_READING_STATUS_LABELS.has(text);
  const useCompletedThoughtLabel = !active && text === "Thought for";
  const gridVariant: GridVariant = WEB_ACTIVITY_LABELS.has(text)
    ? "web"
    : FILE_EDITING_STATUS_LABELS.has(text)
      ? "edit"
      : FILE_WRITING_STATUS_LABELS.has(text)
        ? "write"
        : "default";

  return (
    <StatusShell
      $compact={compact}
      $active={active}
      $animateOnMount={animateOnMount}
      className={className}
    >
      <StatusLabel>
        {useCompletedThoughtLabel ? "Thought" : text}
      </StatusLabel>
      {elapsedSeconds !== undefined && elapsedSeconds >= 0 && (
        <Elapsed $active={active}>{elapsedSeconds}s</Elapsed>
      )}
      {active ? (
        showTerminalGlyph ? (
          <TerminalGlyph $compact={compact} $active={active} aria-hidden="true">
            <Terminal />
          </TerminalGlyph>
        ) : showReadingGlyph ? (
          <EyeGlyph $compact={compact} $active={active} aria-hidden="true">
            <Eye />
          </EyeGlyph>
        ) : (
          <SquareGlyph
            $compact={compact}
            $active={active}
            $variant={gridVariant}
            aria-hidden="true"
          >
            {dotDelays.map((delay, index) => (
              <SquareDot
                key={index}
                $delay={delay}
                $active={active}
                $variant={gridVariant}
                $index={index}
              />
            ))}
          </SquareGlyph>
        )
      ) : null}
    </StatusShell>
  );
};

export const StreamingLoadingText = ({
  text = "Thinking",
  elapsedSeconds,
  compact = false,
  active = true,
  animateOnMount = false,
}: {
  text?: string;
  elapsedSeconds?: number;
  compact?: boolean;
  active?: boolean;
  animateOnMount?: boolean;
}) => {
  const shouldCycle = active && shouldCycleWorkingLabel(text);
  const [selectedText, setSelectedText] = React.useState(text);
  const [translationSequence, setTranslationSequence] = React.useState<
    readonly string[]
  >(WORKING_STATUS_TRANSLATIONS);
  const [translationIndex, setTranslationIndex] = React.useState(0);

  React.useEffect(() => {
    if (shouldCycle) {
      return;
    }

    if (active && hasStaticStatusVariants(text)) {
      setSelectedText(pickStatusVariant(text));
      return;
    }

    setSelectedText(text);
  }, [active, shouldCycle, text]);

  React.useEffect(() => {
    if (!shouldCycle) {
      setTranslationSequence(WORKING_STATUS_TRANSLATIONS);
      setTranslationIndex(0);
      return;
    }

    const sequence = buildWorkingStatusRotation();
    setTranslationSequence(sequence);
    setTranslationIndex(0);

    const interval = window.setInterval(() => {
      setTranslationIndex((current) => (current + 1) % sequence.length);
    }, WORKING_TRANSLATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [shouldCycle]);

  const resolvedText = shouldCycle
    ? translationSequence[translationIndex]
    : selectedText;

  return (
    <AgentStatusPill
      text={resolvedText}
      elapsedSeconds={elapsedSeconds}
      compact={compact}
      active={active}
      animateOnMount={animateOnMount}
    />
  );
};

export const ShimmeringText = ({
  text = "Thinking",
  compact = false,
  active = true,
}: {
  text?: string;
  compact?: boolean;
  active?: boolean;
}) => <AgentStatusPill text={text} compact={compact} active={active} />;
