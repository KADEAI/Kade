import { useMemo } from "react";
import styled, { keyframes, css } from "styled-components";
import MarkdownBlock from "../../common/MarkdownBlock";
import { ClineSayTool } from "@roo/ExtensionMessage";

// ─── Keyframe Animations ─────────────────────────────────────────────

const glitchSkew = keyframes`
  0% { transform: skew(0deg); }
  10% { transform: skew(-4deg); }
  20% { transform: skew(6deg); }
  30% { transform: skew(-2deg); }
  40% { transform: skew(5deg); }
  50% { transform: skew(-6deg); }
  60% { transform: skew(3deg); }
  70% { transform: skew(-5deg); }
  80% { transform: skew(2deg); }
  90% { transform: skew(-3deg); }
  100% { transform: skew(0deg); }
`;

const shimmerSlide = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const bounceFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;

const pulseGlow = keyframes`
  0%, 100% { opacity: 1; filter: brightness(1); }
  50% { opacity: 0.85; filter: brightness(1.3); }
`;

const waveRipple = keyframes`
  0% { transform: translateX(0) translateY(0); }
  25% { transform: translateX(2px) translateY(-1px); }
  50% { transform: translateX(0) translateY(-2px); }
  75% { transform: translateX(-2px) translateY(-1px); }
  100% { transform: translateX(0) translateY(0); }
`;

const rainbowShift = keyframes`
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
`;

const flickerNeon = keyframes`
  0%, 19.9%, 22%, 62.9%, 64%, 64.9%, 70%, 100% { opacity: 1; }
  20%, 21.9%, 63%, 63.9%, 65%, 69.9% { opacity: 0.4; }
`;

const typewriterBlink = keyframes`
  0%, 100% { border-right-color: currentColor; }
  50% { border-right-color: transparent; }
`;

const shakeRattle = keyframes`
  0%, 100% { transform: translate(0); }
  10% { transform: translate(-2px, -1px); }
  20% { transform: translate(2px, 1px); }
  30% { transform: translate(-1px, 2px); }
  40% { transform: translate(1px, -2px); }
  50% { transform: translate(-2px, 1px); }
  60% { transform: translate(2px, -1px); }
  70% { transform: translate(-1px, -2px); }
  80% { transform: translate(1px, 2px); }
  90% { transform: translate(-2px, -1px); }
`;

const slideIn = keyframes`
  0% { transform: translateX(-20px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
`;

const fadeInUp = keyframes`
  0% { transform: translateY(12px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;

const scanline = keyframes`
  0% { background-position: 0 0; }
  100% { background-position: 0 100%; }
`;

const confettiFall = keyframes`
  0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(30px) rotate(360deg); opacity: 0; }
`;

const sparkleKeyframes = keyframes`
  0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
  50% { opacity: 1; transform: scale(1) rotate(180deg); }
`;

const fireFlicker = keyframes`
  0%, 100% { text-shadow: 0 0 4px #ff6600, 0 0 11px #ff3300, 0 0 19px #ff0000; }
  50% { text-shadow: 0 0 4px #ff9900, 0 0 18px #ff6600, 0 0 25px #ff3300; }
`;

// ─── Effect Map ──────────────────────────────────────────────────────

const effectMap: Record<string, ReturnType<typeof css>> = {
  glitch: css`
    animation: ${glitchSkew} 0.6s infinite linear alternate-reverse;
    text-shadow:
      2px 0 #ff00c1,
      -2px 0 #00fff9;
  `,
  shimmer: css`
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.35) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    background-size: 200% 100%;
    animation: ${shimmerSlide} 2s infinite linear;
    -webkit-background-clip: text;
    background-clip: text;
  `,
  bounce: css`
    animation: ${bounceFloat} 0.9s infinite ease-in-out;
  `,
  pulse: css`
    animation: ${pulseGlow} 1.5s infinite ease-in-out;
  `,
  wave: css`
    animation: ${waveRipple} 2s infinite ease-in-out;
  `,
  rainbow: css`
    animation: ${rainbowShift} 4s infinite linear;
  `,
  neon: css`
    animation: ${flickerNeon} 2s infinite;
  `,
  typewriter: css`
    border-right: 2px solid currentColor;
    animation: ${typewriterBlink} 0.8s infinite;
    display: inline-block;
  `,
  shake: css`
    animation: ${shakeRattle} 0.5s infinite;
  `,
  slide: css`
    animation: ${slideIn} 0.6s ease-out both;
  `,
  fade: css`
    animation: ${fadeInUp} 0.5s ease-out both;
  `,
  scanline: css`
    &::after {
      content: "";
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.1) 2px,
        rgba(0, 0, 0, 0.1) 4px
      );
      background-size: 100% 4px;
      animation: ${scanline} 8s linear infinite;
      pointer-events: none;
    }
  `,
  fire: css`
    animation: ${fireFlicker} 0.8s infinite alternate;
  `,
};

// ─── Style Presets ───────────────────────────────────────────────────

const stylePresets: Record<string, string> = {
  neon: `
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.08) 0%, rgba(0, 200, 255, 0.08) 100%);
    border: 1px solid rgba(0, 255, 136, 0.5);
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.2), inset 0 0 15px rgba(0, 255, 136, 0.05);
    color: #00ff88;
  `,
  retro: `
    background: linear-gradient(135deg, rgba(255, 165, 0, 0.1) 0%, rgba(255, 69, 0, 0.08) 100%);
    border: 2px dashed rgba(255, 165, 0, 0.6);
    color: #ffa500;
    font-family: "Courier New", monospace;
  `,
  cyberpunk: `
    background: linear-gradient(135deg, rgba(255, 0, 255, 0.1) 0%, rgba(0, 255, 255, 0.08) 50%, rgba(255, 255, 0, 0.06) 100%);
    border: 1px solid rgba(255, 0, 255, 0.6);
    box-shadow: 0 0 20px rgba(255, 0, 255, 0.15), 0 0 40px rgba(0, 255, 255, 0.08);
    color: #ff00ff;
  `,
  holographic: `
    background: linear-gradient(135deg, rgba(255,0,128,0.08), rgba(0,128,255,0.08), rgba(128,255,0,0.08), rgba(255,128,0,0.08));
    background-size: 400% 400%;
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 0 25px rgba(128, 0, 255, 0.15);
  `,
  terminal: `
    background: rgba(0, 12, 0, 0.9);
    border: 1px solid rgba(0, 255, 0, 0.4);
    color: #00ff00;
    font-family: "Courier New", monospace;
    text-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
  `,
  frost: `
    background: linear-gradient(135deg, rgba(173, 216, 230, 0.15) 0%, rgba(135, 206, 250, 0.1) 100%);
    border: 1px solid rgba(173, 216, 230, 0.4);
    box-shadow: 0 0 20px rgba(173, 216, 230, 0.15);
    backdrop-filter: blur(8px);
    color: #b0e0e6;
  `,
  inferno: `
    background: linear-gradient(135deg, rgba(255, 69, 0, 0.15) 0%, rgba(255, 0, 0, 0.1) 50%, rgba(139, 0, 0, 0.08) 100%);
    border: 1px solid rgba(255, 69, 0, 0.5);
    box-shadow: 0 0 20px rgba(255, 69, 0, 0.2), 0 0 40px rgba(255, 0, 0, 0.1);
    color: #ff6347;
  `,
  galaxy: `
    background: linear-gradient(135deg, rgba(25, 25, 112, 0.3) 0%, rgba(75, 0, 130, 0.2) 50%, rgba(138, 43, 226, 0.15) 100%);
    border: 1px solid rgba(138, 43, 226, 0.5);
    box-shadow: 0 0 25px rgba(138, 43, 226, 0.2);
    color: #dda0dd;
  `,
  gold: `
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.12) 0%, rgba(218, 165, 32, 0.08) 100%);
    border: 1px solid rgba(255, 215, 0, 0.5);
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.15);
    color: #ffd700;
  `,
  dark: `
    background: rgba(10, 10, 15, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    box-shadow: 0 4px 30px rgba(0,0,0,0.5);
  `,
  vapor: `
    background: linear-gradient(135deg, rgba(255, 113, 206, 0.12) 0%, rgba(1, 205, 254, 0.1) 50%, rgba(185, 103, 255, 0.08) 100%);
    border: 1px solid rgba(255, 113, 206, 0.4);
    color: #ff71ce;
    font-style: italic;
  `,
};

// ─── GUI Widgets ─────────────────────────────────────────────────────

const CONFETTI_CHARS = ["🎉", "✨", "🎊", "💫", "⭐", "🌟", "💥", "🔥"];
const SPARKLE_CHARS = ["✦", "✧", "⟡", "◈", "❖"];

const GuiOverlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
`;

const ConfettiParticle = styled.span<{
  $delay: number;
  $x: number;
  $char: string;
}>`
  position: absolute;
  top: -10px;
  left: ${(p) => p.$x}%;
  font-size: 14px;
  animation: ${confettiFall} ${() => 1.5 + Math.random() * 2}s ease-in infinite;
  animation-delay: ${(p) => p.$delay}s;
`;

const SparkleParticle = styled.span<{ $delay: number; $x: number; $y: number }>`
  position: absolute;
  top: ${(p) => p.$y}%;
  left: ${(p) => p.$x}%;
  font-size: 10px;
  color: #ffd700;
  animation: ${sparkleKeyframes} ${() => 1 + Math.random() * 1.5}s ease-in-out
    infinite;
  animation-delay: ${(p) => p.$delay}s;
`;

function GuiWidget({ type }: { type: string }) {
  const particles = useMemo(() => {
    switch (type) {
      case "confetti":
        return Array.from({ length: 12 }, (_, i) => ({
          id: i,
          x: Math.random() * 100,
          delay: Math.random() * 3,
          char: CONFETTI_CHARS[i % CONFETTI_CHARS.length],
        }));
      case "sparkle":
      case "sparkles":
        return Array.from({ length: 8 }, (_, i) => ({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          delay: Math.random() * 2,
          char: SPARKLE_CHARS[i % SPARKLE_CHARS.length],
        }));
      default:
        return [];
    }
  }, [type]);

  if (type === "confetti") {
    return (
      <GuiOverlay>
        {particles.map((p) => (
          <ConfettiParticle key={p.id} $delay={p.delay} $x={p.x} $char={p.char}>
            {p.char}
          </ConfettiParticle>
        ))}
      </GuiOverlay>
    );
  }

  if (type === "sparkle" || type === "sparkles") {
    return (
      <GuiOverlay>
        {particles.map((p) => (
          <SparkleParticle
            key={p.id}
            $delay={p.delay}
            $x={p.x}
            $y={"y" in p ? (p as any).y : 50}
          >
            {p.char}
          </SparkleParticle>
        ))}
      </GuiOverlay>
    );
  }

  // If it's an emoji, render it as a decorative border
  if (/\p{Emoji}/u.test(type)) {
    return (
      <GuiOverlay>
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 8,
            fontSize: 18,
            opacity: 0.8,
          }}
        >
          {type}
        </span>
        <span
          style={{
            position: "absolute",
            bottom: 4,
            left: 8,
            fontSize: 18,
            opacity: 0.8,
          }}
        >
          {type}
        </span>
      </GuiOverlay>
    );
  }

  return null;
}

// ─── Styled Container ────────────────────────────────────────────────

interface WrapStyleProps {
  $effect?: string;
  $color?: string;
  $bg?: string;
  $border?: string;
  $shadow?: string;
  $style?: string;
  $intensity?: string;
}

const WrapContainer = styled.div<WrapStyleProps>`
  padding: 14px 16px;
  border-radius: 10px;
  margin: 6px 0;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;

  /* Base defaults */
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);

  /* Apply preset style first (can be overridden by individual props) */
  ${({ $style }) =>
    $style && stylePresets[$style]
      ? css`
          ${stylePresets[$style]}
        `
      : ""}

  /* Custom overrides from AI */
  ${({ $color }) =>
    $color
      ? css`
          color: ${$color};
        `
      : ""}
  ${({ $bg }) =>
    $bg
      ? css`
          background: ${$bg};
        `
      : ""}
  ${({ $border }) =>
    $border
      ? css`
          border: 1px solid ${$border};
        `
      : ""}
  ${({ $shadow }) =>
    $shadow
      ? css`
          box-shadow: ${$shadow};
        `
      : ""}

  /* Scale intensity for animations */
  ${({ $intensity }) => {
    if (!$intensity) return "";
    const val = parseFloat($intensity);
    if (isNaN(val)) return "";
    return css`
      animation-duration: ${Math.max(0.1, 2 / val)}s;
    `;
  }}

  .wrap-content {
    position: relative;
    z-index: 1;
    ${({ $effect }) =>
      $effect && effectMap[$effect] ? effectMap[$effect] : ""}
  }
`;

// ─── Component ───────────────────────────────────────────────────────

interface WrapToolProps {
  tool: ClineSayTool;
}

export const WrapTool: React.FC<WrapToolProps> = ({ tool }) => {
  return (
    <WrapContainer
      $effect={tool.effect}
      $color={tool.color}
      $bg={tool.bg}
      $border={tool.border}
      $shadow={tool.shadow}
      $style={tool.style}
      $intensity={tool.intensity}
    >
      {tool.gui && <GuiWidget type={tool.gui} />}
      <div className="wrap-content">
        <MarkdownBlock markdown={tool.content || ""} />
      </div>
    </WrapContainer>
  );
};
