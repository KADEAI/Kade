import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

const Trigger = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const TooltipLayer = styled.div<{ $x: number; $y: number }>`
  position: fixed;
  left: ${({ $x }) => `${$x}px`};
  top: ${({ $y }) => `${$y}px`};
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  z-index: 2147483647;
`;

const TooltipBubble = styled.div`
  position: relative;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.96);
  color: rgba(255, 255, 255, 0.96);
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.18);
`;

const TooltipArrow = styled.div`
  width: 8px;
  height: 8px;
  margin-top: -1px;
  border-right: 1px solid rgba(255, 255, 255, 0.14);
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.96);
  box-shadow: 8px 8px 18px rgba(0, 0, 0, 0.08);
  transform: rotate(45deg);
`;

interface HeaderActionTooltipProps {
  content?: string;
  children: React.ReactNode;
}

export const HeaderActionTooltip = ({
  content,
  children,
}: HeaderActionTooltipProps) => {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !content) {
      return;
    }

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 1,
      });
    };

    updatePosition();

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [content, isOpen]);

  return (
    <Trigger
      ref={triggerRef}
      onMouseEnter={() => content && setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocusCapture={() => content && setIsOpen(true)}
      onBlurCapture={() => setIsOpen(false)}
    >
      {children}
      {isMounted &&
        isOpen &&
        content &&
        createPortal(
          <TooltipLayer $x={position.x} $y={position.y}>
            <TooltipBubble>{content}</TooltipBubble>
            <TooltipArrow />
          </TooltipLayer>,
          document.body,
        )}
    </Trigger>
  );
};
