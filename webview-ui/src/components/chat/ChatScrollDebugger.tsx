import React, { useEffect, useState } from "react";

interface ChatScrollDebuggerProps {
  virtuosoRef: any;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  stickyFollow: boolean;
  isStreaming: boolean;
  itemCount: number;
  chatAreaHeight: number;
}

export const ChatScrollDebugger: React.FC<ChatScrollDebuggerProps> = ({
  virtuosoRef,
  scrollContainerRef,
  isAtBottom,
  stickyFollow,
  isStreaming,
  itemCount,
  chatAreaHeight,
}) => {
  const [scrollInfo, setScrollInfo] = useState({
    top: 0,
    height: 0,
    client: 0,
  });
  const [showLayers, setShowLayers] = useState(false);
  const [heightLogs, setHeightLogs] = useState<
    { ts: number; delta: number; index: number }[]
  >([]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      setScrollInfo({
        top: el.scrollTop,
        height: el.scrollHeight,
        client: el.clientHeight,
      });
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollContainerRef]);

  // Listen for custom height change events
  useEffect(() => {
    const handleHeightLog = (e: any) => {
      setHeightLogs((prev: any[]) =>
        [{ ts: Date.now(), ...e.detail }, ...prev].slice(0, 10),
      );
    };
    window.addEventListener("chat-height-change-log", handleHeightLog);
    return () =>
      window.removeEventListener("chat-height-change-log", handleHeightLog);
  }, []);

  useEffect(() => {
    if (!showLayers) {
      const style = document.getElementById("debug-layer-style");
      if (style) style.remove();
      return;
    }

    const style = document.createElement("style");
    style.id = "debug-layer-style";
    style.innerHTML = `
			* { outline: 1px solid rgba(0, 255, 0, 0.1) !important; }
			[style*="z-index"], [class*="z-"], .anchored-container, .rainbow-border { 
				outline: 2px solid red !important;
				background: rgba(255, 0, 0, 0.1) !important;
			}
			[style*="z-index"]::after, [class*="z-"]::after {
				content: "Z: " attr(style) !important;
				position: absolute;
				top: 0;
				right: 0;
				background: red;
				color: white;
				font-size: 8px;
				z-index: 100000;
			}
		`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [showLayers]);

  return (
    <div
      onClick={() => setShowLayers(!showLayers)}
      style={{
        position: "fixed",
        top: "10px",
        left: "10px",
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.85)",
        color: "#00ff00",
        padding: "10px",
        borderRadius: "8px",
        fontSize: "10px",
        fontFamily: "monospace",
        pointerEvents: "auto", // Allow clicking to toggle layers
        border: "1px solid #00ff00",
        width: "250px",
        boxShadow: "0 0 20px rgba(0, 255, 0, 0.2)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          fontWeight: "bold",
          borderBottom: "1px solid #00ff00",
          marginBottom: "5px",
        }}
      >
        SCROLL DIAGNOSTICS (Click to Toggle Layers)
      </div>
      <div>At Bottom: {isAtBottom ? "YES" : "NO"}</div>
      <div>Sticky Follow: {stickyFollow ? "ON" : "OFF"}</div>
      <div>Streaming: {isStreaming ? "YES" : "NO"}</div>
      <div>Items: {itemCount}</div>
      <div>Footer Height: {chatAreaHeight}px</div>
      <div
        style={{
          marginTop: "5px",
          borderTop: "1px dotted #00ff00",
          paddingTop: "5px",
        }}
      >
        ST: {scrollInfo.top.toFixed(1)}px / SH: {scrollInfo.height}px
      </div>
      <div>
        Diff:{" "}
        {(scrollInfo.height - scrollInfo.top - scrollInfo.client).toFixed(1)}px
      </div>

      <div
        style={{
          marginTop: "5px",
          borderTop: "1px dotted #00ff00",
          paddingTop: "5px",
        }}
      >
        <b>RECENT HEIGHT CHANGES:</b>
        {heightLogs.map(
          (log: { ts: number; delta: number; index: number }, i: number) => (
            <div key={log.ts + (i as number)}>
              #{log.index}: {log.delta > 0 ? "+" : ""}
              {log.delta}px
            </div>
          ),
        )}
      </div>
    </div>
  );
};
