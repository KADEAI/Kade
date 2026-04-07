import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  createContext,
  useContext,
  useState,
} from "react";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import styled, { keyframes, css } from "styled-components";
import { visit } from "unist-util-visit";
import remarkGfm from "remark-gfm";
import { Globe } from "lucide-react";

import { vscode } from "@src/utils/vscode";
import { useExtensionState } from "@src/context/ExtensionStateContext";

import CodeBlock from "../kilocode/common/CodeBlock";
const MermaidBlock = React.lazy(() => import("./MermaidBlock"));
import { FileIcon } from "../chat/tools/FileIcon";

type MarkdownMathPlugins = {
  rehypeKatex: NonNullable<ReactMarkdownOptions["rehypePlugins"]>[number];
  remarkMath: NonNullable<ReactMarkdownOptions["remarkPlugins"]>[number];
};

type MarkdownRemarkPlugin =
  NonNullable<ReactMarkdownOptions["remarkPlugins"]>[number];
const normalizeCodeLanguagePlugin: MarkdownRemarkPlugin = () => {
  return (tree: any) => {
    visit(tree, "code", (node: any) => {
      if (!node.lang) {
        node.lang = "text";
      } else if (node.lang.includes(".")) {
        node.lang = node.lang.split(".").slice(-1)[0];
      }
    });
  };
};

let mathPluginsPromise: Promise<MarkdownMathPlugins> | null = null;

const hasMathSyntax = (content: string) =>
  /(^|[^\\])\$\$[\s\S]*?\$\$|(^|[^\\])\$(?!\d)([^$\n]|\\\$)+\$(?!\d)|\\\(|\\\[/.test(content);

const loadMathPlugins = async (): Promise<MarkdownMathPlugins> => {
  if (!mathPluginsPromise) {
    mathPluginsPromise = Promise.all([
      import("rehype-katex"),
      import("remark-math"),
    ]).then(([rehypeKatex, remarkMath]) => ({
      rehypeKatex: rehypeKatex.default,
      remarkMath: remarkMath.default,
    }));
  }

  return mathPluginsPromise;
};

const noopRemarkPlugin: MarkdownRemarkPlugin = () => undefined;

const getDisplayPath = (text: string) => {
  if (!text) return text;
  // Remove protocol if present
  let path = text;
  if (path.startsWith("file://")) {
    path = path.slice(7);
  } else if (path.includes(".vscode-resource.vscode-cdn.net/")) {
    path = path.split(".vscode-resource.vscode-cdn.net/")[1];
  }
  // Remove @ prefix if present
  if (path.startsWith("@")) path = path.slice(1);

  // Handle line numbers (e.g., :42 or :42-45)
  const lineMatch = path.match(/(:\d+(?:-\d+)?)$/);
  const lineSuffix = lineMatch ? lineMatch[1] : "";
  const pathWithoutLines = lineMatch
    ? path.slice(0, -lineMatch[1].length)
    : path;

  // Extract basename (last part of the path)
  const parts = pathWithoutLines.split(/[\\/]/);
  const basename = parts[parts.length - 1];

  // If it's an empty string (e.g. path ended in a slash), return original
  return (basename || pathWithoutLines) + lineSuffix;
};

const getCleanPathForIcon = (path: string) => {
  if (!path) return "";
  // Remove protocol and line numbers
  let clean = path;
  if (clean.startsWith("file://")) {
    clean = clean.slice(7);
  } else if (clean.includes(".vscode-resource.vscode-cdn.net/")) {
    clean = clean.split(".vscode-resource.vscode-cdn.net/")[1];
  }
  return clean.split(":")[0];
};

// ═══════════════════════════════════════════════════════
// ██ V I B E   S Y S T E M — Inline text effects     ██
// ═══════════════════════════════════════════════════════
// Syntax: ~effect content here~
// Examples: ~glitch oh snap~ | ~neon I'm glowing~ | ~cyberpunk hack the planet~
// Multi: ~glitch:cyberpunk double trouble~

const vibePulsePro = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.025); }
`;
const vibeFloating = keyframes`
  0%, 100% { opacity: 0.72; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-0.035em); }
`;
const vibeRainbowPro = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;
const vibeGlitchDrift = keyframes`
  0%, 87%, 100% { transform: translate(0, 0); clip-path: none; text-shadow: none; }
  88% { transform: translate(-2px, 0); clip-path: polygon(0 20%, 100% 20%, 100% 40%, 0 40%); text-shadow: 2px 0 0 rgba(255,0,180,0.7), -2px 0 0 rgba(0,240,255,0.7); }
  89% { transform: translate(2px, 0); clip-path: polygon(0 55%, 100% 55%, 100% 75%, 0 75%); text-shadow: -2px 0 0 rgba(255,0,180,0.7), 2px 0 0 rgba(0,240,255,0.7); }
  90% { transform: translate(0, 0); clip-path: none; text-shadow: none; }
  94%, 96% { transform: translate(1px, 0); text-shadow: -1px 0 0 rgba(255,0,180,0.5), 1px 0 0 rgba(0,240,255,0.5); }
  95%, 97% { transform: translate(-1px, 0); text-shadow: 1px 0 0 rgba(255,0,180,0.5), -1px 0 0 rgba(0,240,255,0.5); }
`;
const vibeSheen = keyframes`
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
`;
const vibeBeating = keyframes`
  0%, 100% { opacity: 0.78; transform: scale(1); text-shadow: 0 0 0 currentColor; }
  50% { opacity: 1; transform: scale(1.045); text-shadow: 0 0 14px currentColor, 0 0 5px currentColor; }
`;
const vibeEmphasisPulse = keyframes`
  0%, 100% { color: inherit; text-shadow: none; font-weight: inherit; }
  50% { color: #ffffff; text-shadow: 0 0 16px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.6); font-weight: 700; }
`;
const vibeShout = keyframes`
  0%, 100% { color: inherit; text-shadow: none; }
  6%  { color: #ffffff; text-shadow: 0 0 20px rgba(255,255,255,1), 0 0 6px rgba(255,200,100,0.8); }
  12% { color: inherit; text-shadow: none; }
  18% { color: #fff5cc; text-shadow: 0 0 14px rgba(255,220,100,0.8); }
  24% { color: inherit; text-shadow: none; }
`;
const vibeFlickerPro = keyframes`
  0%, 19%, 21%, 23%, 52%, 56%, 100% { opacity: 1; }
  20%, 22%, 54% { opacity: 0.68; }
`;
const vibeChromShift = keyframes`
  0%, 100% { text-shadow: 0.8px 0 0 rgba(255,60,60,0.45), -0.8px 0 0 rgba(60,220,255,0.45); }
  33% { text-shadow: -0.8px 0 0 rgba(255,60,60,0.45), 0.8px 0 0 rgba(60,220,255,0.45); }
  66% { text-shadow: 0 0.8px 0 rgba(255,60,60,0.35), 0 -0.8px 0 rgba(60,220,255,0.35); }
`;
const vibeShimmerPro = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`;
const vibeLiquid = keyframes`
  0%, 100% { transform: scale(1, 1); }
  30% { transform: scale(0.97, 1.03); }
  60% { transform: scale(1.03, 0.97); }
`;
const vibeBounceLift = keyframes`
  0%, 100% { transform: translateY(0) scale(1); }
  22% { transform: translateY(-0.18em) scale(1.035); }
  45% { transform: translateY(0.02em) scale(0.99); }
  65% { transform: translateY(-0.09em) scale(1.015); }
`;
const vibeWaveSway = keyframes`
  0%, 100% { transform: translateY(0) skewX(0deg) rotate(0deg); }
  25% { transform: translateY(-0.05em) skewX(-10deg) rotate(-1deg); }
  50% { transform: translateY(0.03em) skewX(8deg) rotate(0.8deg); }
  75% { transform: translateY(-0.025em) skewX(-6deg) rotate(-0.5deg); }
`;
const vibeFadeGhost = keyframes`
  0%, 100% { opacity: 1; text-shadow: none; }
  50% { opacity: 0.24; text-shadow: 0 0 6px color-mix(in srgb, currentColor 16%, transparent); }
`;
const vibeChromaticPop = keyframes`
  0%, 100% {
    text-shadow: 1px 0 0 rgba(255,70,70,0.55), -1px 0 0 rgba(70,220,255,0.55);
  }
  33% {
    text-shadow: -1.3px 0 0 rgba(255,70,70,0.6), 1.3px 0 0 rgba(70,220,255,0.6);
  }
  66% {
    text-shadow: 0 1.1px 0 rgba(255,70,70,0.5), 0 -1.1px 0 rgba(70,220,255,0.5);
  }
`;

// Map of effect name → CSS
const VIBE_EFFECTS: Record<string, ReturnType<typeof css>> = {
  glitch: css`
    animation: ${vibeGlitchDrift} 6s infinite;
    display: inline-block;
    will-change: transform, text-shadow;
  `,
  shimmer: css`
    display: inline-block;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, currentColor 70%, transparent) 0%,
      rgba(255, 255, 255, 0.95) 40%,
      rgba(220, 220, 255, 0.85) 50%,
      rgba(255, 255, 255, 0.95) 60%,
      color-mix(in srgb, currentColor 70%, transparent) 100%
    );
    background-size: 300% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ${vibeShimmerPro} 5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    font-weight: 650;
  `,
  bounce: css`
    display: inline-block;
    transform-origin: center bottom;
    animation: ${vibeBounceLift} 1.25s infinite cubic-bezier(0.34, 1.56, 0.64, 1);
  `,
  pulse: css`
    display: inline-block;
    animation: ${vibePulsePro} 3s infinite ease-in-out;
  `,
  wave: css`
    display: inline-block;
    transform-origin: center center;
    animation: ${vibeWaveSway} 2.2s infinite ease-in-out;
  `,
  rainbow: css`
    display: inline-block;
    background: linear-gradient(
      to right,
      #ff6b6b,
      #ffa94d,
      #ffe066,
      #69db7c,
      #4dabf7,
      #cc5de8
    );
    background-size: 300% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ${vibeRainbowPro} 8s linear infinite;
  `,
  neon: css`
    animation: ${vibeFlickerPro} 5s infinite;
    text-shadow:
      0 0 6px color-mix(in srgb, currentColor 44%, transparent),
      0 0 14px color-mix(in srgb, currentColor 20%, transparent);
  `,
  fire: css`
    color: #ff6b35;
    text-shadow:
      0 0 8px rgba(255, 107, 53, 0.5),
      0 0 16px rgba(255, 60, 0, 0.25);
    animation: ${vibePulsePro} 2s infinite ease-in-out;
    display: inline-block;
  `,
  shake: css`
    display: inline-block;
    animation: ${vibeLiquid} 0.58s infinite;
  `,
  slide: css`
    display: inline-block;
    animation: ${vibeWaveSway} 0.95s ease-out both;
  `,
  fade: css`
    display: inline-block;
    animation: ${vibeFadeGhost} 2.6s infinite ease-in-out;
  `,
  chromatic: css`
    display: inline-block;
    animation: ${vibeChromaticPop} 2.8s infinite linear;
  `,
  emphasis: css`
    display: inline-block;
    animation: ${vibeEmphasisPulse} 4s ease-in-out infinite;
  `,
  pop: css`
    display: inline-block;
    animation: ${vibeBeating} 5s ease-in-out infinite;
  `,
  whisperEffect: css`
    opacity: 0.55;
    animation: ${vibePulsePro} 5s infinite ease-in-out;
  `,
  gentle: css`
    display: inline-block;
    animation: ${vibeFloating} 5s infinite cubic-bezier(0.37, 0, 0.63, 1);
  `,
  shoutEffect: css`
    animation: ${vibeShout} 1.8s ease-in-out infinite;
    font-weight: 700;
  `,
  spotlight: css`
    display: inline-block;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.85) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    background-size: 300% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    animation: ${vibeSheen} 4s infinite ease-in-out;
  `,
  echo: css`
    position: relative;
    &::before {
      content: attr(data-content);
      position: absolute;
      top: 0;
      left: 0;
      opacity: 0.12;
      transform: translate(0.03em, 0.03em) scale(1.02);
      animation: ${vibePulsePro} 4s infinite;
      pointer-events: none;
    }
  `,
};

const VIBE_STYLES: Record<string, string> = {
  neon:
    "color: #12f3cf; font-weight: 650; text-shadow: 0 0 10px rgba(18,243,207,0.18);",
  retro:
    "color: #e6a25b; font-family: var(--vscode-editor-font-family, 'SF Mono', monospace); font-size: 0.88em; font-weight: 560; border-bottom: 1.5px solid rgba(232,164,90,0.32); padding-bottom: 0.5px;",
  cyberpunk:
    "color: #00fff9; font-weight: 820; text-transform: uppercase; font-style: italic; background: linear-gradient(90deg, #ff00c1, #00fff9); background-size: 200% 100%; -webkit-background-clip: text; -webkit-text-fill-color: transparent;",
  holographic:
    "background: linear-gradient(135deg, #00f2ff, #006aff, #7000ff, #ff00c1, #00f2ff); background-size: 400% 400%; -webkit-background-clip: text; -webkit-text-fill-color: transparent;",
  terminal:
    "color: #4ade80; font-family: var(--vscode-editor-font-family, 'SF Mono', monospace); font-size: 0.875em; font-weight: 520; background: rgba(74,222,128,0.07); border: 0.5px solid rgba(74,222,128,0.18); border-radius: 4px; padding: 0.1em 0.45em; letter-spacing: 0.01em;",
  frost:
    "color: #dff7ff; text-shadow: 0 0 12px rgba(64,220,255,0.58), 0 0 3px rgba(180,240,255,0.24); font-weight: 540; font-style: italic;",
  inferno:
    "color: #ff6347; text-shadow: 0 0 6px rgba(255,99,71,0.4), 0 0 12px rgba(255,0,0,0.2); font-weight: 700;",
  galaxy:
    "background: linear-gradient(90deg, #9d50bb, #6e48aa, #2b2d42); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 600;",
  gold: "background: linear-gradient(to bottom, #bf953f, #fcf6ba, #b38728, #fbf5b7, #aa771c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; text-shadow: 0 1px 1px rgba(0,0,0,0.2);",
  dark: "color: rgba(255,255,255,0.78); font-weight: 280; letter-spacing: 0.08em; opacity: 0.82;",
  vapor:
    "font-family: 'Futura', sans-serif; font-weight: 900; background: linear-gradient(180deg, #ff71ce 0%, #01cdfe 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-style: italic; letter-spacing: -0.05em;",
  pro: "letter-spacing: -0.04em; font-weight: 820; background: linear-gradient(180deg, #f4fcff 0%, #8fdfff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 1px 2px rgba(0,0,0,0.14);",
  glass:
    "position: relative; padding: 1px 8px; border-radius: 20px; &::before { content: ''; position: absolute; inset: 0; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); z-index: -1; }",
  loud: "font-weight: 800; font-size: 1.1em; letter-spacing: -0.01em; text-transform: uppercase;",
  quiet:
    "font-weight: 320; opacity: 0.58; font-size: 0.85em; letter-spacing: 0.04em; display: inline-block; transform: scale(0.97);",
  big: "font-size: 1.15em; font-weight: 700;",
  huge: "font-size: 1.25em; font-weight: 800; letter-spacing: -0.02em;",
  mega: "font-size: 1.4em; font-weight: 950; line-height: 1.0; letter-spacing: -0.03em; text-transform: uppercase; background: linear-gradient(to bottom, #fff, #999); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 1px 2px rgba(0,0,0,0.22);",
  shout:
    "font-size: 1.35em; font-weight: 920; letter-spacing: -0.022em; text-transform: uppercase; text-shadow: 0 1px 8px color-mix(in srgb, currentColor 28%, transparent);",
};

const VibeSpan = styled.span<{ $effects: string[]; $styles: string[] }>`
  display: inline-block;
  vertical-align: baseline;
  position: relative;
  isolation: isolate;
  ${({ $styles }) => $styles.map((s) => VIBE_STYLES[s] || "").join("\n")}
  ${({ $effects }) => $effects.map((e) => VIBE_EFFECTS[e])}

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transform: none !important;
    text-shadow: none !important;

    &::before {
      animation: none !important;
      transform: none !important;
    }
  }
`;

const VIBE_KEYWORDS = new Set([
  ...Object.keys(VIBE_EFFECTS),
  ...Object.keys(VIBE_STYLES),
  "happy",
  "sad",
  "angry",
  "excited",
  "cool",
  "spooky",
  "shout",
  "whisper",
]);

// Remark plugin: intercepts GFM delete nodes (~text~) and converts
// them to vibe nodes in the AST when the text starts with a known vibe keyword.
// e.g. ~glitch hello world~ becomes a node that renders as <vibe data-tags="glitch">hello world</vibe>
// Regular strikethrough like ~oops~ is left untouched.
const remarkVibe: MarkdownRemarkPlugin = () => {
  return (tree: any) => {
    visit(tree, "delete", (node: any, index: any, parent: any) => {
      if (!parent || index == null) return;

      // Extract the full text content from the delete node's children
      const textParts: string[] = [];
      for (const child of node.children) {
        if (child.type === "text") textParts.push(child.value);
        else if (child.type === "inlineCode") textParts.push(child.value);
      }
      const fullText = textParts.join("");

      // Check if it starts with a vibe keyword (e.g. "glitch hello" or "fire:inferno yo")
      const match = fullText.match(/^([a-zA-Z][a-zA-Z0-9:]*?)\s+(.+)$/s);
      if (!match) return; // Not a vibe pattern, leave as strikethrough

      const tagPart = match[1];
      const tags = tagPart.split(":");
      const isVibe = tags.some((t) => VIBE_KEYWORDS.has(t));
      if (!isVibe) return; // No recognized keywords, leave as strikethrough

      const content = match[2];

      // Transform the node into a 'vibe' element for the renderer
      node.type = "vibe";
      node.data = {
        hName: "vibe",
        hProperties: {
          "data-tags": tags.join(":"),
        },
      };
      // Replace children with the stripped content
      node.children = [{ type: "text", value: content }];
    });
  };
};

// Component that renders <vibe> tags with effects
const VibeRenderer = ({ children, ...props }: any) => {
  const tagsStr = props["data-tags"] || "";
  let tags = tagsStr.split(":").filter(Boolean);

  // Emotion Mapping Engine
  if (tags.includes("happy"))
    tags = [...new Set([...tags, "rainbow", "gentle"])];
  if (tags.includes("sad")) tags = [...new Set([...tags, "fade", "dark"])];
  if (tags.includes("angry"))
    tags = [...new Set([...tags, "fire", "shake", "inferno"])];
  if (tags.includes("excited"))
    tags = [...new Set([...tags, "emphasis", "bounce", "neon"])];
  if (tags.includes("cool"))
    tags = [...new Set([...tags, "gentle", "frost", "pro"])];
  if (tags.includes("spooky"))
    tags = [
      ...new Set([...tags, "glitch", "dark", "echo", "fade", "chromatic"]),
    ];
  if (tags.includes("shout")) tags = [...new Set([...tags, "shout"])];
  if (tags.includes("whisper"))
    tags = [...new Set([...tags, "whisperEffect", "quiet"])];

  const effects = tags.filter((t: string) => t in VIBE_EFFECTS);
  const styles = tags.filter((t: string) => t in VIBE_STYLES);

  // Convert children to text for data-content attribute (used by pseudo-elements)
  const content = React.Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");

  return (
    <VibeSpan $effects={effects} $styles={styles} data-content={content}>
      {children}
    </VibeSpan>
  );
};

const LinkContext = createContext<boolean>(false);

interface MarkdownBlockProps {
  markdown?: string;
  className?: string;
  filePaths?: string[];
  cwd?: string;
  stableId?: string;
}

let nextAnonymousMarkdownCodeBlockId = 0;

interface FenceState {
  marker: "`" | "~";
  length: number;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// Optimized: cache the last balanced result to avoid re-processing identical input
let lastStreamingInput = "";
let lastStreamingOutput = "";

function balanceStreamingCodeFences(markdown: string, isStreaming?: boolean) {
  if (!isStreaming || !markdown) {
    return markdown;
  }

  // Fast path: return cached result if input hasn't changed
  if (markdown === lastStreamingInput) {
    return lastStreamingOutput;
  }

  const openFences: FenceState[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FENCE_PATTERN);
    if (!match) continue;

    const markerRun = match[1];
    const marker = markerRun[0] as FenceState["marker"];
    const length = markerRun.length;
    const activeFence = openFences[openFences.length - 1];

    if (
      activeFence &&
      activeFence.marker === marker &&
      length >= activeFence.length
    ) {
      openFences.pop();
    } else {
      openFences.push({ marker, length });
    }
  }

  if (openFences.length === 0) {
    lastStreamingInput = markdown;
    lastStreamingOutput = markdown;
    return markdown;
  }

  const closingFences = openFences
    .reverse()
    .map((fence) => fence.marker.repeat(fence.length))
    .join("\n");

  const result = `${markdown}${markdown.endsWith("\n") ? "" : "\n"}${closingFences}`;
  lastStreamingInput = markdown;
  lastStreamingOutput = result;
  return result;
}

const StyledMarkdown = styled.div<{ $isStreaming?: boolean }>`
  /* ══════════════════════════════════════════════
        ██  G O D - T I E R   T Y P O G R A P H Y  ██
        ══════════════════════════════════════════════ */

  /* ── Foundation ── */
  line-height: 1.44;
  font-size: 13.8px;
  font-family: var(--vscode-editor-system-font-family);
  color: #e6e6e6ff;
  -webkit-font-smoothing: subpixel-antialiased;
  min-height: 0;
  width: var(--chat-markdown-width, auto);
  max-width: var(--chat-markdown-max-width, 100%);
  display: block;
  will-change: ${({ $isStreaming }) => ($isStreaming ? "transform" : "auto")};
  backface-visibility: visible;
  position: relative;
  font-weight: 442;
  contain: ${({ $isStreaming }) => ($isStreaming ? "layout style" : "none")};

  /* ── Base Weight ── */
  /* Removed overly aggressive * { font-weight: 400; } to allow inherited bolding */

  /* ── Emphasis ── */
  strong {
    font-weight: 760;
    color: #ffffff;
    letter-spacing: -0.012em;
    transition:
      color 0.18s ease,
      box-shadow 0.18s ease;
    position: relative;
    text-shadow: 0 0 0 currentColor;
    border-radius: 0.2em;
    padding: 0 0.08em;
    margin: 0 -0.08em;
  }

  strong em,
  em strong {
    color: #ffffff;
    font-weight: 780;
  }

  strong code,
  strong a {
    box-shadow: none;
  }

  em {
    font-style: italic;
    color: inherit;
  }

  /* ── Inline Code ── */
  code:not(pre > code) {
    font-family: var(
      --vscode-editor-font-family,
      "SF Mono",
      Monaco,
      Inconsolata,
      "Roboto Mono",
      monospace
    );
    font-size: 0.86em;
    font-weight: 520;
    color: var(--vscode-symbolIcon-keywordForeground);
    background-color: color-mix(
      in srgb,
      var(--vscode-foreground) 5%,
      transparent
    );
    padding: 0.14em 0.38em;
    border-radius: 3.5px;
    border: 0.4px solid
      color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
    font-feature-settings:
      "tnum" 1,
      "lnum" 1;
    letter-spacing: 0.01em;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease;
    position: relative;

    &:hover {
      background-color: color-mix(
        in srgb,
        var(--vscode-foreground) 8%,
        transparent
      );
      border-color: color-mix(
        in srgb,
        var(--vscode-symbolIcon-keywordForeground) 12%,
        transparent
      );
    }
  }

  /* ── Heading Hierarchy ── */
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: var(--vscode-editor-foreground);
    line-height: 1.10;
    font-feature-settings:
      "kern" 1,
      "liga" 1;
    position: relative;
    transition:
      color 0.2s ease,
      border-color 0.2s ease,
      background-color 0.2s ease;
    text-wrap: balance;
    max-width: 100%;
  }

  h1 {
    font-size: 1.72em;
    font-weight: 800;
    letter-spacing: -0.042em;
    margin: 0.35em 0 0.42em 0;
    color: #ffffff;
    text-shadow: 0 10px 24px
      color-mix(in srgb, var(--vscode-editor-foreground) 7%, transparent);
  }

  h2 {
    display: inline-block;
    font-size: 1.30em;
    font-weight: 760;
    letter-spacing: -0.03em;
    margin: 0.3em 0 0.13em 0;
    color: color-mix(in srgb, #a9a9a9ff 92%, var(--vscode-editor-foreground));
    text-shadow: 0 1px 1px
      color-mix(in srgb, var(--vscode-editor-foreground) 5%, transparent);
  }

  h3 {
    font-size: 1.14em;
    font-weight: 730;
    letter-spacing: -0.02em;
    margin: 0em 0 0.24em 0;
    color: color-mix(in srgb, #ffffff 88%, var(--vscode-editor-foreground));
  }

  h4 {
    font-size: 1.02em;
    font-weight: 690;
    letter-spacing: -0.012em;
    text-transform: none;
    margin: 0.0em 0 0.18em 0;
    color: color-mix(in srgb, #ffffff 78%, var(--vscode-editor-foreground));
  }

  h5 {
    font-size: 0.92em;
    font-weight: 760;
    letter-spacing: 0.045em;
    text-transform: uppercase;
    margin: 0.86em 0 0.14em 0;
    color: color-mix(in srgb, #ffffff 90%, var(--vscode-editor-foreground));
    opacity: 0.96;
  }

  h6 {
    font-size: 0.82em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0.72em 0 0.12em 0;
    color: color-mix(in srgb, var(--vscode-editor-foreground) 66%, transparent);
    opacity: 0.92;
  }

  h1::after,
  h2::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -0.12em;
    height: 1px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, #ffffff 18%, transparent) 0%,
      transparent 100%
    );
    pointer-events: none;
  }

  h1::after {
    width: 2.2em;
  }

  h2::after {
    width: 100%;
  }

  h3::before,
  h4::before {
    content: "";
    position: absolute;
    left: -0.72em;
    top: 0.18em;
    bottom: 0.18em;
    width: 2px;
    border-radius: 999px;
    background: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 10%,
      transparent
    );
    opacity: 0.75;
    pointer-events: none;
  }

  /* Heading hover effects — intentionally minimal */
  h1:hover,
  h2:hover,
  h3:hover,
  h4:hover,
  h5:hover,
  h6:hover {
    color: var(--vscode-editor-foreground);
  }

  /* First child heading: no top gap */
  > h1:first-child,
  > h2:first-child,
  > h3:first-child,
  > h4:first-child,
  > h5:first-child,
  > h6:first-child {
    margin-top: 0;
  }

  /* Heading immediately after heading: tighten */
  h1 + h2 {
    margin-top: 0.28em;
  }
  h2 + h3 {
    margin-top: 0.37em;
  }
  h3 + h4 {
    margin-top: 0.16em;
  }
  h4 + h5 {
    margin-top: 0.14em;
  }
  h5 + h6 {
    margin-top: 0.12em;
  }

  /* Heading immediately before table: tighten and add visual connection */
  h1:has(+ table),
  h2:has(+ table),
  h3:has(+ table),
  h4:has(+ table),
  h5:has(+ table),
  h6:has(+ table) {
    margin-bottom: 0.2em;
  }

  /* Table immediately after heading: enhanced styling */
  h1 + table,
  h2 + table,
  h3 + table,
  h4 + table,
  h5 + table,
  h6 + table {
    margin-top: 0.2em;
    border: 1px solid
      color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
    border-radius: 5px;
    overflow: hidden;
    box-shadow: 0 1px 3px
      color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
  }

  /* ── Paragraph & Block Spacing ── */
  p {
    margin: 0.33em 0;
    display: block;
    hanging-punctuation: first allow-end last;
    text-indent: 0;
    orphans: 2;
    widows: 2;
    position: relative;
  }

  p:first-child {
    margin-top: 0;
  }

  p:last-child {
    margin-bottom: 0;
  }

  p > span {
    display: inline;
    line-height: inherit;
  }

  /* ── Lists ── */
  ul,
  ol {
    --markdown-list-indent: 1.00em;
    --markdown-list-marker-color: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 10%,
      transparent
    );
    --markdown-list-rail-color: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 8%,
      transparent
    );
    --markdown-list-branch-width: 0.89em;
    --markdown-list-branch-height: 0.95em;
    margin: 0.5em 0;
    padding-left: 1.03em;
    list-style-position: outside;
    position: relative;
  }

  ol {
    --markdown-list-branch-width: 0.42em;
    --markdown-list-branch-height: 0.8em;
    --markdown-list-rail-color: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 6%,
      transparent
    );
    list-style: none;
    counter-reset: markdown-ol-item;
  }

  ul {
    list-style: none;
  }

  /* Nested list markers */
  ul ul {
    list-style-type: circle;
  }
  ul ul ul {
    list-style-type: square;
  }
  ol ol {
    list-style-type: lower-alpha;
  }
  ol ol ol {
    list-style-type: lower-roman;
  }

  li {
    margin: 0 0 0.10em 0;
    padding-left: 0.38em;
    line-height: 1.44;
    position: relative;
    color: var(--vscode-editor-foreground);
  }

  ol > li {
    counter-increment: markdown-ol-item;
  }

  .markdown-li-content {
    display: inline-block;
    max-width: 100%;
    vertical-align: top;
    position: relative;
    color: inherit !important;
  }

  ul > li > .markdown-li-content::after,
  ol > li > .markdown-li-content::after {
    position: absolute;
    pointer-events: none;
  }

  ul > li > .markdown-li-content::after {
    content: "";
    left: -1.02em;
    top: 0.62em;
    width: 0.34em;
    height: 0.34em;
    border-radius: 999px;
    background: rgba(134, 134, 134, 0.76);
  }

  ol > li > .markdown-li-content::after {
    content: counter(markdown-ol-item) ".";
    left: -1.46em;
    top: 0.087em;
    color: rgba(143, 143, 143, 0.76);
    font-size: 0.9em;
    font-weight: 620;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
    font-feature-settings:
      "tnum" 1,
      "lnum" 1;
  }

  ol ol {
    counter-reset: markdown-ol-item;
  }

  ol ol > li > .markdown-li-content::after {
    content: counter(markdown-ol-item, lower-alpha) ".";
    left: -1.55em;
    font-size: 0.84em;
  }

  ol ol ol > li > .markdown-li-content::after {
    content: counter(markdown-ol-item, lower-roman) ".";
    left: -1.7em;
    font-size: 0.8em;
  }

  .markdown-li-content > p,
  .markdown-li-content > span,
  .markdown-li-content > strong,
  .markdown-li-content > em,
  .markdown-li-content > div,
  .markdown-li-content > p *,
  .markdown-li-content > span *,
  .markdown-li-content > strong *,
  .markdown-li-content > em *,
  .markdown-li-content > div * {
    color: inherit !important;
  }

  /* List “rail” / branch lines: bullet lists only (numbered lists use ::after on .markdown-li-content) */
  ul > li::before {
    content: "";
    position: absolute;
    left: calc(-1 * var(--markdown-list-indent) + 0.16em);
    top: -0.14em;
    width: var(--markdown-list-branch-width);
    height: var(--markdown-list-branch-height);
    border-left: 1px solid var(--markdown-list-rail-color);
    border-bottom: 1px solid var(--markdown-list-rail-color);
    border-bottom-left-radius: 6px;
    pointer-events: none;
  }

  ul > li:not(:last-child)::after {
    content: "";
    position: absolute;
    left: calc(-1 * var(--markdown-list-indent) + 0.16em);
    top: calc(var(--markdown-list-branch-height) - 0.50em);
    bottom: -0.256em;
    width: 1px;
    background: var(--markdown-list-rail-color);
    pointer-events: none;
  }

  li:last-child {
    margin-bottom: 0;
  }

  ul > li + li,
  ol > li + li {
    padding-top: 0;
  }

  ol > li + li {
    margin-top: 0.04em;
  }

  .markdown-li-content > :first-child {
    margin-top: 0;
  }

  .markdown-li-content > :last-child {
    margin-bottom: 0;
  }

  .markdown-li-content > p {
    margin: 0.12em 0;
  }

  .markdown-li-content > p:first-child {
    margin-top: 0;
  }

  .markdown-li-content > p:last-child {
    margin-bottom: 0;
  }

  /* Nested lists: spacing & alignment */
  .markdown-li-content > ul,
  .markdown-li-content > ol {
    --markdown-list-indent: 1.05em;
    margin: 0.18em 0 0.06em 0;
    padding-left: 1.05em;
  }

  .markdown-li-content > p + ul,
  .markdown-li-content > p + ol {
    margin-top: 0.06em;
  }

  /* ── Blockquote ── */
  blockquote {
    margin: 0.75em 0;
    padding: 0.4em 1em;
    border-left: 2.5px solid
      color-mix(in srgb, var(--vscode-editor-foreground) 14%, transparent);
    background-color: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 3%,
      transparent
    );
    border-radius: 0 5px 5px 0;
    color: color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
    font-style: italic;
    transition:
      border-left-color 0.25s ease,
      background-color 0.25s ease;
    position: relative;

    &:hover {
      background-color: color-mix(
        in srgb,
        var(--vscode-editor-foreground) 5%,
        transparent
      );
      border-left-color: color-mix(
        in srgb,
        var(--vscode-editor-foreground) 28%,
        transparent
      );
    }

    p {
      margin: 0.3em 0;
    }

    /* Nested blockquotes */
    blockquote {
      margin: 0.4em 0;
      border-left-color: color-mix(
        in srgb,
        var(--vscode-editor-foreground) 10%,
        transparent
      );
    }
  }

  /* ── Links ── */
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    font-weight: 460;
    position: relative;
    transition: color 0.25s ease;

    &::after {
      content: "";
      position: absolute;
      width: 0;
      height: 1.5px;
      bottom: -1px;
      left: 0;
      background-color: var(--vscode-textLink-activeForeground);
      transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1);
      transform-origin: left;
    }

    &:hover {
      color: var(--vscode-textLink-activeForeground);
    }

    &:hover::after {
      width: 100%;
    }
  }

  /* ── Text Selection ── */
  ::selection {
    background-color: color-mix(
      in srgb,
      var(--vscode-editor-foreground) 20%,
      transparent
    );
    color: var(--vscode-editor-background);
    text-shadow: none;
  }

  /* ── Focus Visible ── */
  :focus-visible {
    outline: 2px solid color-mix(in srgb, white 30%, transparent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* ── Horizontal Rule ── */
  hr {
    border: none;
    height: 1px;
    position: relative;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent) 16%,
      color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent) 50%,
      color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent) 84%,
      transparent 100%
    );
    margin: 0.35em 0 0.8em;
  }

  hr::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 54px;
    height: 8px;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent) 0%,
      transparent 72%
    );
    pointer-events: none;
  }

  /* ── KaTeX & Math ── */
  .katex {
    font-size: 1.1em;
    color: var(--vscode-editor-foreground);
    font-family: KaTeX_Main, "Times New Roman", serif;
    line-height: 1.2;
    white-space: normal;
    text-indent: 0;
  }

  .katex-display {
    display: block;
    margin: 0.6em 0;
    text-align: center;
    padding: 0.6em;
    overflow-x: auto;
    overflow-y: hidden;
    background-color: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
  }

  .katex-error {
    color: var(--vscode-errorForeground);
  }

  /* ── Code Blocks ── */
  pre {
    min-height: 1.5em;
    transition: height 0.2s ease-out;
  }

  div:has(> pre) {
    position: relative;
    contain: layout style;
    padding: 0.5em 0;
  }

  /* ── Tables ── */
  table {
    border-collapse: separate;
    border-spacing: 0;
    margin: 0;
    width: 100%;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 8px 14px;
    text-align: left;
    border-bottom: 1px solid
      color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    white-space: normal;
    overflow-wrap: break-word;
    word-break: break-word;
    min-width: 60px;
    max-width: 300px;
  }

  tr:last-child td {
    border-bottom: none;
  }

  th {
    background-color: color-mix(
      in srgb,
      var(--vscode-foreground) 4%,
      transparent
    );
    font-weight: 620;
    font-size: 0.92em;
    letter-spacing: 0.01em;
    color: var(--vscode-editor-foreground);
    text-align: left;
  }

  td:first-child {
    font-weight: 500;
  }

  tr:hover td {
    background-color: color-mix(
      in srgb,
      var(--vscode-foreground) 3%,
      transparent
    );
  }
`;

const FileLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  margin: 0;
  background-color: transparent !important;
  color: #4daafc !important;
  text-decoration: none !important;
  border-bottom: none !important;
  border: none !important;
  font-family: "Menlo", Monaco, Consolas, "Courier New", monospace !important;
  font-size: 12.95px !important;

  .reasoning-content & {
    font-size: 11.5px !important;
  }

  cursor: pointer;
  vertical-align: baseline;
  transition: all 0.15s ease;
  white-space: normal;
  word-break: break-all;
  overflow-wrap: anywhere;

  /* Precise position adjustment */
  position: relative;
  top: 3.74px;
  left: 0px;

  &:hover,
  &:focus,
  &:active {
    background-color: color-mix(
      in srgb,
      var(--vscode-badge-background) 0%,
      transparent
    );
    color: var(--vscode-textLink-activeForeground) !important;
    text-decoration: none !important;
    outline: none !important;
    box-shadow: none !important;
    border: none !important;
  }

  .file-icon {
    flex-shrink: 0;
    opacity: 0.85;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    transform: translateY(-0.5px);
  }
`;

const WebLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  margin: 0 2px;
  background-color: color-mix(
    in srgb,
    var(--vscode-textLink-foreground) 8%,
    transparent
  );
  color: var(--vscode-textLink-foreground) !important;
  text-decoration: none !important;
  border-radius: 4px;
  font-size: 13.5px;
  font-weight: 500;
  transition: all 0.2s ease;
  vertical-align: middle;
  position: relative;
  top: -1px;

  &:hover {
    background-color: color-mix(
      in srgb,
      var(--vscode-textLink-foreground) 15%,
      transparent
    );
    color: var(--vscode-textLink-activeForeground) !important;
    transform: translateY(-1px);
  }

  .globe-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: var(--vscode-testing-iconPassed);
    opacity: 0.8;
  }
`;

const mentionRegexSource =
  /(?:^|(?<=[\s\(\)\[\]\{\}'"`]))(?<!\\)@(?:(?:\/|\w+:\/\/)(?:[^\s\\]|\\ )+?|[\w\.-]+\.[a-zA-Z0-9]{2,10}|[a-f0-9]{7,40}\b|problems\b|git-changes\b|terminal\b)(?=[.,;:!?]?(?:[\s\(\)\[\]\{\}'"`]|$))/
    .source;
const absolutePathRegexSource =
  /(?:(?<=^|[\s\(\)\[\]\{\}'"`])(?:[a-zA-Z]:[\\/]|[\\/]))[^:?*"<>|\s\[\]\(\)\{\}]+(?:\.[a-zA-Z0-9]+)+(?::\d+)?(?=[.,;:!?]?(?:[\s\(\)\[\]\{\}'"`]|$))/
    .source;
// Matches things that look like source files, including paths with slashes.
// Requires at least one letter and a 2-10 char extension.
const genericFileRegexSource =
  /(?<=^|[\s\(\)\[\]\{\}'"`])[\w\.\-\/\\]*[a-zA-Z][\w\.\-\/\\]*\.[a-zA-Z0-9]{2,10}(?::\d+)?(?=[.,;:!?]?(?:[\s\(\)\[\]\{\}'"`]|$))/
    .source;

const useLinkregex = (filePaths: string[] = []) => {
  // PERF: Track previous files to avoid reprocessing when nothing changed
  const prevFilesRef = useRef<string[]>();
  const prevResultRef = useRef<{
    masterRegex: RegExp;
    basenameToPaths: Map<string, string[]>;
  }>();

  return useMemo(() => {
    // Check if files actually changed (shallow comparison for performance)
    const filesChanged =
      !prevFilesRef.current ||
      prevFilesRef.current.length !== filePaths.length ||
      prevFilesRef.current !== filePaths;

    // If no changes, return cached result
    if (!filesChanged && prevResultRef.current) {
      return prevResultRef.current;
    }

    // Prepare workspace matches
    const basenameToPaths = new Map<string, string[]>();

    // PERF: Limit to first 1500 files (increased from 1000 for better coverage)
    // Processing 10k+ files on every render causes the entire chat to freeze
    const limitedFilePaths = filePaths.slice(0, 1500);

    if (limitedFilePaths.length > 0) {
      for (const fp of limitedFilePaths) {
        const basename = fp.split(/[\\/]/).pop();
        if (basename && basename.length > 2) {
          const paths = basenameToPaths.get(basename);
          if (paths) {
            paths.push(fp);
          } else {
            basenameToPaths.set(basename, [fp]);
          }
        }
      }
    }

    // We no longer include all workspace paths in the regex to avoid hitting limits
    // with large projects. Instead, we rely on the generic file regex and resolve
    // candidates using basenameToPaths.
    const branches = [
      mentionRegexSource,
      absolutePathRegexSource,
      genericFileRegexSource,
    ];

    const result = {
      masterRegex: new RegExp(branches.join("|"), "g"),
      basenameToPaths,
    };

    // Cache the result for next time
    prevFilesRef.current = filePaths;
    prevResultRef.current = result;

    return result;
  }, [filePaths]);
};

// Linkification moved to Remark plugin for performance

// recursive renderChildren removed for performance

const TableScrollWrapper = styled.div`
  overflow-x: auto;
  margin: 0.8em 0;
  max-width: 100%;
  display: block;
  border-radius: 10px;
  border: 1px solid
    color-mix(in srgb, var(--vscode-foreground) 12%, transparent);

  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
    border-radius: 10px;
  }
`;

const MarkdownBlock = memo(
  ({
    markdown,
    className,
    filePaths,
    cwd,
    isStreaming,
    stableId,
  }: MarkdownBlockProps & { isStreaming?: boolean }) => {
    const { showVibeStyling = false } = useExtensionState();
    const { masterRegex, basenameToPaths } = useLinkregex(filePaths);
    const hasEverStreamedRef = useRef(Boolean(isStreaming));
    const codeBlockIdsRef = useRef<string[]>([]);
    const codeBlockRenderIndexRef = useRef(0);

    if (isStreaming) {
      hasEverStreamedRef.current = true;
    }

    const getStableCodeBlockId = useCallback(() => {
      const blockIndex = codeBlockRenderIndexRef.current++;

      if (stableId) {
        return `${stableId}:code:${blockIndex}`;
      }

      if (!codeBlockIdsRef.current[blockIndex]) {
        codeBlockIdsRef.current[blockIndex] =
          `markdown-code-block:${nextAnonymousMarkdownCodeBlockId++}`;
      }

      return codeBlockIdsRef.current[blockIndex];
    }, [stableId]);

    const components = useMemo(
      () => ({
        p: ({ children }: any) => {
          return <p>{children}</p>;
        },
        li: ({ children }: any) => {
          return (
            <li>
              <div className="markdown-li-content">{children}</div>
            </li>
          );
        },
        strong: ({ children, ...props }: any) => {
          const isInsideLink = useContext(LinkContext);
          if (!isInsideLink && typeof children === "string") {
            const text = children;
            masterRegex.lastIndex = 0;
            if (
              masterRegex.test(text) ||
              text.startsWith("file://") ||
              text.startsWith("/")
            ) {
              let href = text;
              if (!href.startsWith("file://")) href = "file://" + href;

              const handleClick = (e: React.MouseEvent) => {
                e.preventDefault();
                let filePath = href.replace("file://", "");
                const basename = filePath.split(/[\\/]/).pop();
                if (basename && basenameToPaths.has(basename)) {
                  const paths = basenameToPaths.get(basename)!;
                  if (paths.length > 0 && !paths.includes(filePath)) {
                    filePath = paths[0];
                  }
                }
                const match = filePath.match(/(.*):(\d+)(-\d+)?$/);
                let values = undefined;
                if (match) {
                  filePath = match[1];
                  values = { line: parseInt(match[2]) };
                }
                vscode.postMessage({
                  type: "openFile",
                  text: filePath,
                  values,
                });
              };

              const fullPath = href.replace("file://", "");
              const displayName = getDisplayPath(text);

              return (
                <strong {...props}>
                  <FileLink href={href} onClick={handleClick} title={fullPath}>
                    <span className="file-icon">
                      <FileIcon
                        fileName={getCleanPathForIcon(fullPath)}
                        size={16}
                        isDirectory={false}
                      />
                    </span>
                    {displayName}
                  </FileLink>
                </strong>
              );
            }
          }
          return <strong {...props}>{children}</strong>;
        },
        table: ({ children, ...props }: any) => {
          return (
            <TableScrollWrapper>
              <table {...props}>{children}</table>
            </TableScrollWrapper>
          );
        },
        a: ({ href, children, title, ...props }: any) => {
          const isInsideLink = useContext(LinkContext);
          if (isInsideLink) return <>{children}</>;

          // Check if this link was explicitly marked as a file by our remark plugin
          const isExplicitFile = props["data-is-file"] === "true";

          const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
            const isLocalPath =
              href?.startsWith("file://") ||
              href?.startsWith("/") ||
              href?.includes(".vscode-resource.vscode-cdn.net/") ||
              !href?.includes("://");
            if (!isLocalPath) return;
            e.preventDefault();

            let filePath = href.replace("file://", "");
            if (filePath.includes(".vscode-resource.vscode-cdn.net/")) {
              filePath = filePath.split(".vscode-resource.vscode-cdn.net/")[1];
            }

            // Dynamic resolution: if it's a basename, find the full path
            const basename = filePath.split(/[\\/]/).pop();
            if (basename && basenameToPaths.has(basename)) {
              const paths = basenameToPaths.get(basename)!;
              if (paths.length > 0 && !paths.includes(filePath)) {
                filePath = paths[0];
              }
            }

            const match = filePath.match(/(.*):(\d+)(-\d+)?$/);
            let values = undefined;
            if (match) {
              filePath = match[1];
              values = { line: parseInt(match[2]) };
            }

            const isAbsolute =
              filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath);

            vscode.postMessage({ type: "openFile", text: filePath, values });
          };

          const isLocal =
            isExplicitFile ||
            href?.startsWith("file://") ||
            href?.startsWith("/") ||
            href?.includes(".vscode-resource.vscode-cdn.net/") ||
            (!href?.includes("://") &&
              !href?.startsWith("mailto:") &&
              !href?.startsWith("tel:"));

          if (isLocal) {
            let fullPath = href?.replace("file://", "") || "";
            if (fullPath.includes(".vscode-resource.vscode-cdn.net/")) {
              fullPath = fullPath.split(".vscode-resource.vscode-cdn.net/")[1];
            }
            // Handle children which might be a string or an array containing a string
            let displayName = children;
            if (typeof children === "string") {
              displayName = getDisplayPath(children);
            } else if (
              Array.isArray(children) &&
              children.length === 1 &&
              typeof children[0] === "string"
            ) {
              displayName = getDisplayPath(children[0]);
            }

            return (
              <FileLink
                {...props}
                href={href}
                onClick={handleClick}
                title={title || fullPath} // Show full path on hover
              >
                <span className="file-icon">
                  <FileIcon
                    fileName={getCleanPathForIcon(fullPath)}
                    size={16}
                    isDirectory={false}
                  />
                </span>
                <LinkContext.Provider value={true}>
                  {displayName}
                </LinkContext.Provider>
              </FileLink>
            );
          } else {
            return (
              <WebLink
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Globe size={13} style={{ flexShrink: 0 }} />
                <LinkContext.Provider value={true}>
                  {children}
                </LinkContext.Provider>
              </WebLink>
            );
          }
        },
        pre: ({ children, ..._props }: any) => {
          const codeEl = children as React.ReactElement;
          if (!codeEl || !codeEl.props) return <pre>{children}</pre>;

          const { className = "", children: codeChildren } = codeEl.props;
          let codeString = "";
          if (typeof codeChildren === "string") {
            codeString = codeChildren;
          } else if (Array.isArray(codeChildren)) {
            codeString = codeChildren
              .filter((child) => typeof child === "string")
              .join("");
          }

          if (className.includes("language-mermaid")) {
            if (!codeString.trim()) return null;
            return (
              <div style={{ margin: "0.5rem 0" }}>
                <React.Suspense fallback={null}>
                  <MermaidBlock code={codeString} />
                </React.Suspense>
              </div>
            );
          }

          const match = /language-(\w+)/.exec(className);
          const language = match ? match[1] : "text";
          const isInternalTool =
            language === "tool" ||
            language === "cmd" ||
            className.toLowerCase().includes("tool") ||
            className.toLowerCase().includes("cmd") ||
            codeString.includes("<tool") ||
            codeString.includes("<cmd");

          if (isInternalTool) return null;
          if (!codeString.trim()) return null;

          const blockId = getStableCodeBlockId();

          return (
            <div style={{ margin: "0.5rem 0" }}>
              <CodeBlock
                blockId={blockId}
                source={codeString}
                language={language}
              />
            </div>
          );
        },
        code: ({ children, className, ...props }: any) => {
          const isInsideLink = useContext(LinkContext);
          const isInline = !className;
          if (!isInsideLink && isInline && typeof children === "string") {
            const text = children;
            const isUrl =
              text.includes("://") ||
              text.startsWith("www.") ||
              /^[a-zA-Z0-9.-]+\.(com|org|net|edu|gov|io|ai|me|dev|app|info)$/.test(
                text,
              );

            // Use the masterRegex already computed in the scope
            masterRegex.lastIndex = 0;
            if (
              isUrl ||
              masterRegex.test(text) ||
              text.startsWith("file://") ||
              text.startsWith("/")
            ) {
              if (isUrl) {
                const href = text.startsWith("www.") ? `https://${text}` : text;
                return (
                  <code
                    className={className}
                    {...props}
                    style={{
                      background: "transparent",
                      padding: 0,
                      border: "none",
                    }}
                  >
                    <WebLink
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="globe-icon">
                        <Globe size={13} strokeWidth={2.5} />
                      </span>
                      {children}
                    </WebLink>
                  </code>
                );
              }

              let href = text;
              if (!href.startsWith("file://") && !href.startsWith("/")) {
                // No longer prefixing with ./ as it breaks backend search fallback
              }
              if (!href.startsWith("file://")) href = "file://" + href;

              const handleClick = (e: React.MouseEvent) => {
                e.preventDefault();
                let filePath = href.replace("file://", "");

                const basename = filePath.split(/[\\/]/).pop();
                if (basename && basenameToPaths.has(basename)) {
                  const paths = basenameToPaths.get(basename)!;
                  if (paths.length > 0 && !paths.includes(filePath)) {
                    filePath = paths[0];
                  }
                }

                const match = filePath.match(/(.*):(\d+)(-\d+)?$/);
                let values = undefined;
                if (match) {
                  filePath = match[1];
                  values = { line: parseInt(match[2]) };
                }
                vscode.postMessage({
                  type: "openFile",
                  text: filePath,
                  values,
                });
              };

              const fullPath = href.replace("file://", "");
              const displayName = getDisplayPath(text);

              return (
                <code
                  className={className}
                  {...props}
                  style={{
                    background: "transparent",
                    padding: 0,
                    border: "none",
                  }}
                >
                  <FileLink href={href} onClick={handleClick} title={fullPath}>
                    <span className="file-icon">
                      <FileIcon
                        fileName={getCleanPathForIcon(fullPath)}
                        size={16}
                        isDirectory={false}
                      />
                    </span>
                    {displayName}
                  </FileLink>
                </code>
              );
            }
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }),
      [filePaths, cwd, getStableCodeBlockId],
    );

    const remarkLinkify = useMemo<MarkdownRemarkPlugin>(() => {
      // Regex to find paths inside common delimiters: (), [], {}, <>, [[]], «»
      // Simplified to catch more file-like patterns inside delimiters
      const delimitedRegex =
        /((?:\(|\{|<|\[\[|«|\[|'|"))([^()\[\]{}<>«»\s'"]+)(?:\)|\]\}|>|\]\]|»|\]|'|")/g;

      // Regex to find naked file paths: must have an extension and be a known file or have path separators
      const nakedFileRegex =
        /(?<=^|[\s\(\)\[\]\{\}'"`])([\w\.\-\/\\]*[a-zA-Z][\w\.\-\/\\]*\.[a-zA-Z0-9]{2,10}(?::\d+)?)(?=[.,;:!?]?(?:[\s\(\)\[\]\{\}'"`]|$))/g;

      return () => {
        return (tree: any) => {
          visit(tree, "text", (node: any, index: any, parent: any) => {
            if (
              parent &&
              (parent.type === "link" ||
                parent.type === "a" ||
                parent.type === "code")
            )
              return;
            if (!node.value) return;

            // We only auto-link naked files if they are confirmed workspace files or @mentions
            const matches = Array.from(node.value.matchAll(nakedFileRegex));
            const validMatches = matches.filter((m: any) => {
              const pathText = m[1];
              if (pathText.startsWith("@")) return true;
              const basename = pathText.split(/[\\/]/).pop()?.split(":")[0];
              return basename && basenameToPaths.has(basename);
            });

            if (validMatches.length === 0) return;

            const children: any[] = [];
            let lastIndex = 0;

            for (const match of validMatches as any[]) {
              if (match.index! > lastIndex) {
                children.push({
                  type: "text",
                  value: node.value.slice(lastIndex, match.index),
                });
              }

              const pathText = match[1];
              let href: string | undefined;
              const cleanPathText = pathText.trim();
              const basename = cleanPathText
                .split(/[\\/]/)
                .pop()
                ?.split(":")[0];

              if (cleanPathText.startsWith("@")) {
                href = `file://${cleanPathText.slice(1)}`;
              } else if (basename && basenameToPaths.has(basename)) {
                const paths = basenameToPaths.get(basename)!;
                href = `file://${paths[0]}`;
              }

              if (href) {
                children.push({
                  type: "link",
                  url: href,
                  title: pathText,
                  data: { hProperties: { "data-is-file": "true" } },
                  children: [{ type: "text", value: getDisplayPath(pathText) }],
                });
              } else {
                children.push({ type: "text", value: match[0] });
              }

              lastIndex = match.index! + match[0].length;
            }

            if (lastIndex < node.value.length) {
              children.push({
                type: "text",
                value: node.value.slice(lastIndex),
              });
            }
            parent.children.splice(index, 1, ...children);
          });
        };
      };
    }, [masterRegex, basenameToPaths]);

    const processedMarkdown = useMemo(() => {
      if (!markdown) return "";
      const balancedMarkdown = balanceStreamingCodeFences(
        markdown,
        isStreaming,
      );
      // Escape $ followed by a digit (currency) to prevent remark-math misinterpretation
      // while leaving actual math ($$ or escaped \$) alone.
      return balancedMarkdown.replace(/\$(?=\d)/g, "\\$");
    }, [markdown, isStreaming]);
    const needsMathPlugins = useMemo(
      () => hasMathSyntax(processedMarkdown),
      [processedMarkdown],
    );
    const [mathPlugins, setMathPlugins] = useState<MarkdownMathPlugins | null>(
      null,
    );

    useEffect(() => {
      let cancelled = false;

      if (!needsMathPlugins) {
        setMathPlugins(null);
        return () => {
          cancelled = true;
        };
      }

      loadMathPlugins()
        .then((plugins) => {
          if (!cancelled) {
            setMathPlugins(plugins);
          }
        })
        .catch((error) => {
          console.error("Failed to load KaTeX markdown plugins:", error);
        });

      return () => {
        cancelled = true;
      };
    }, [needsMathPlugins]);

    const shouldLinkifyMarkdown = !isStreaming && !hasEverStreamedRef.current;
    const remarkPlugins = useMemo(() => {
      const plugins: MarkdownRemarkPlugin[] = [
        remarkGfm as unknown as MarkdownRemarkPlugin,
      ];

      if (showVibeStyling) {
        plugins.push(remarkVibe);
      }

      if (mathPlugins?.remarkMath) {
        plugins.push(mathPlugins.remarkMath as any);
      }

      plugins.push(shouldLinkifyMarkdown ? remarkLinkify : noopRemarkPlugin);
      plugins.push(normalizeCodeLanguagePlugin);

      return plugins;
    }, [mathPlugins, shouldLinkifyMarkdown, showVibeStyling, remarkLinkify]);
    const rehypePlugins = useMemo(
      () => (mathPlugins?.rehypeKatex ? [mathPlugins.rehypeKatex as any] : []),
      [mathPlugins],
    );

    codeBlockRenderIndexRef.current = 0;

    return (
      <StyledMarkdown
        className={className}
        $isStreaming={isStreaming}
        role="article"
        aria-label="Markdown content"
      >
        <ReactMarkdown
          key={showVibeStyling ? "vibe-on" : "vibe-off"}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={
            showVibeStyling
              ? ({ ...components, vibe: VibeRenderer } as any)
              : (components as any)
          }
        >
          {processedMarkdown}
        </ReactMarkdown>
      </StyledMarkdown>
    );
  },
);

export default MarkdownBlock;
