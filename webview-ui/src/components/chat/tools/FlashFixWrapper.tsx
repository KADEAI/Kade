import React, { memo } from "react";
import styled from "styled-components";

const FlashFixContainer = styled.div`
  /* Prevent any visual flashing during state transitions */
  isolation: isolate;
  contain: layout style paint;
  will-change: contents;

  /* Force GPU layer to prevent repaints */
  transform: translateZ(0);
  backface-visibility: hidden;

  /* Ensure smooth transitions */
  & > * {
    transition: opacity 0.1s ease-in-out !important;
  }
`;

interface FlashFixWrapperProps {
  children: React.ReactNode;
}

/**
 * Simple wrapper that prevents flashing during component state transitions.
 * Uses CSS containment and GPU acceleration to isolate rendering.
 */
export const FlashFixWrapper = memo(({ children }: FlashFixWrapperProps) => {
  return <FlashFixContainer>{children}</FlashFixContainer>;
});
