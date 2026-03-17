import React from "react";
import styled, { keyframes } from "styled-components";

// Shimmer Animation Keyframes
const textShimmer = keyframes`
	0% { background-position: 200% 0; }
	100% { background-position: -200% 0; }
`;

// Calm dot pulse instead of a bounce/jump.
const dotPulse = keyframes`
	0%, 100% { opacity: 0.35; transform: translateY(0); }
	50% { opacity: 0.9; transform: translateY(-1px); }
`;

// Styled Shimmer Span
const ShimmerSpan = styled.span`
  display: inline-block;
  background: linear-gradient(
    120deg,
    var(--vscode-descriptionForeground) 40%,
    var(--vscode-editor-foreground) 50%,
    var(--vscode-descriptionForeground) 60%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ${textShimmer} 3s linear infinite;
  transform: translateZ(0);
  backface-visibility: hidden;
`;

// Stable wrapper to avoid layout shifts while streaming
const WordWrapper = styled.span<{ $compact?: boolean }>`
  display: inline-flex;
  align-items: baseline;
  min-width: ${({ $compact }) => ($compact ? "0" : "12ch")};
  position: relative;
  z-index: 1;
`;

// Wave dot
const WaveDot = styled.span<{ $delay: number }>`
  display: inline-block;
  color: transparent;
  background: linear-gradient(
    120deg,
    var(--vscode-descriptionForeground) 40%,
    var(--vscode-editor-foreground) 50%,
    var(--vscode-descriptionForeground) 60%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  animation:
    ${textShimmer} 3s linear infinite,
    ${dotPulse} 1.4s ease-in-out ${({ $delay }) => $delay}ms infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: ${textShimmer} 3s linear infinite;
  }
`;

// Main loading component — intentionally stable/non-rotating to prevent UI jitter
export const StreamingLoadingText = () => {
  return (
    <WordWrapper>
      <ShimmerSpan className="font-normal antialiased opacity-90">
        Thinking
      </ShimmerSpan>
      <WaveDot $delay={0}>.</WaveDot>
      <WaveDot $delay={120}>.</WaveDot>
      <WaveDot $delay={240}>.</WaveDot>
    </WordWrapper>
  );
};

// Fixed text component with shimmer (e.g. for "Thinking...")
export const ShimmeringText = ({
  text = "Thinking",
  compact = false,
}: {
  text?: string;
  compact?: boolean;
}) => {
  return (
    <WordWrapper $compact={compact}>
      <ShimmerSpan className="font-normal antialiased opacity-90">
        {text}
      </ShimmerSpan>
      <WaveDot $delay={0}>.</WaveDot>
      <WaveDot $delay={120}>.</WaveDot>
      <WaveDot $delay={240}>.</WaveDot>
    </WordWrapper>
  );
};
