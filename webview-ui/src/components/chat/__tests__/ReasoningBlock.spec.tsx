import React from "react";
import { act, fireEvent, render, screen } from "@/utils/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReasoningBlock } from "../ReasoningBlock";

vi.mock("@/components/common/MarkdownBlock", () => ({
  __esModule: true,
  default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const topic = options?.topic;

      switch (key) {
        case "chat:reasoning.thinking":
          return "Thinking";
        case "chat:reasoning.thinkingAbout":
          return `Thinking about ${topic} 💭`;
        case "chat:reasoning.cooking":
          return `Analyzing ${topic} 🔍`;
        case "chat:reasoning.piecingTogether":
          return `Piecing together ${topic} 🕵️`;
        case "chat:reasoning.closingIn":
          return `Locking in on ${topic} 🎯`;
        case "chat:reasoning.wrestling":
          return `Sweating over ${topic} 💦`;
        case "chat:reasoning.burningKitchen":
          return `🔥 Melting over ${topic} 🔥`;
        default:
          return key;
      }
    },
    i18n: { language: "en" },
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

describe("ReasoningBlock", () => {
  const hasExactText =
    (value: string) => (_content: string, node: Element | null) =>
      node?.textContent === value;

  let nextAnimationFrameId = 1;
  let animationFrameQueue = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    vi.useFakeTimers();
    nextAnimationFrameId = 1;
    animationFrameQueue = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++;
      animationFrameQueue.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrameQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flushAnimationFrames = (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      const queuedFrames = [...animationFrameQueue.values()];
      animationFrameQueue.clear();

      if (queuedFrames.length === 0) {
        return;
      }

      for (const callback of queuedFrames) {
        callback(performance.now());
      }
    }
  };

  const renderBlock = (content = "Step 1\n\nStep 2") => {
    const ts = Date.now();

    return render(
      <ReasoningBlock
        content={content}
        ts={ts}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
      />,
    );
  };

  const mockScrollerMetrics = (scroller: HTMLDivElement) => {
    let scrollTop = 0;
    let scrollHeight = 120;

    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => 60,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    return {
      getScrollTop: () => scrollTop,
      setScrollTop: (value: number) => {
        scrollTop = value;
      },
      setScrollHeight: (value: number) => {
        scrollHeight = value;
      },
    };
  };

  it("keeps pinning while the rendered height settles across later frames", () => {
    const { container, rerender } = renderBlock("Step 1");
    const scroller = container.querySelector(
      ".custom-scrollbar",
    ) as HTMLDivElement;
    const metrics = mockScrollerMetrics(scroller);

    act(() => {
      flushAnimationFrames(1);
    });
    expect(metrics.getScrollTop()).toBe(60);

    metrics.setScrollHeight(180);
    act(() => {
      rerender(
        <ReasoningBlock
          content={"Step 1\n\nStep 2"}
          ts={Date.now()}
          isStreaming
          isLast
          isCollapsed={false}
          onToggle={() => {}}
        />,
      );
      flushAnimationFrames(1);
    });
    expect(metrics.getScrollTop()).toBe(120);

    metrics.setScrollHeight(260);
    act(() => {
      flushAnimationFrames(3);
    });
    expect(metrics.getScrollTop()).toBe(200);
  });

  it("stops auto-scrolling after the user scrolls away from the bottom", () => {
    const { container, rerender } = renderBlock();
    const scroller = container.querySelector(
      ".custom-scrollbar",
    ) as HTMLDivElement;
    const metrics = mockScrollerMetrics(scroller);

    metrics.setScrollHeight(200);
    act(() => {
      flushAnimationFrames(1);
    });
    expect(metrics.getScrollTop()).toBe(140);

    act(() => {
      metrics.setScrollTop(40);
      fireEvent.scroll(scroller);
    });

    metrics.setScrollHeight(320);
    act(() => {
      rerender(
        <ReasoningBlock
          content={"Step 1\n\nStep 2\n\nStep 3"}
          ts={Date.now()}
          isStreaming
          isLast
          isCollapsed={false}
          onToggle={() => {}}
        />,
      );
      flushAnimationFrames(6);
    });
    expect(metrics.getScrollTop()).toBe(40);
  });

  it("rotates streamed reasoning topics once per second", () => {
    renderBlock("database cache schema");

    expect(
      screen.getByText(hasExactText("Thinking about database 💭")),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(hasExactText("Thinking about cache 💭")),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(hasExactText("Thinking about schema 💭")),
    ).toBeInTheDocument();
  });

  it("ignores generic words like user and prefers recent streamed topics", () => {
    const { rerender } = renderBlock("user request");

    expect(
      screen.getByText(hasExactText("Thinking about request 💭")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="user request database cache schema"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
      />,
    );

    expect(
      screen.getByText(hasExactText("Thinking about database 💭")),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(hasExactText("Thinking about cache 💭")),
    ).toBeInTheDocument();
  });

  it("updates the advanced indicator label with streamed topics", () => {
    render(
      <ReasoningBlock
        content="database cache schema"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningPhase: "reasoning" }}
      />,
    );

    expect(
      screen.getByText(hasExactText("Thinking about database 💭")),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(hasExactText("Thinking about cache 💭")),
    ).toBeInTheDocument();
  });

  it("strips literal thinking tags from rendered reasoning content", () => {
    const { container } = render(
      <ReasoningBlock
        content={"<thinking>\ndatabase cache\n</thinking>"}
        ts={Date.now()}
        isStreaming={false}
        isLast
        isCollapsed={false}
        onToggle={() => {}}
      />,
    );

    expect(container.textContent).toContain("database cache");
    expect(container.textContent).not.toContain("<thinking>");
    expect(container.textContent).not.toContain("</thinking>");
  });

  it("switches the streamed label as thinking takes longer", () => {
    const { rerender } = render(
      <ReasoningBlock
        content="database"
        ts={1234}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 0 }}
      />,
    );

    expect(
      screen.getByText(hasExactText("Thinking about database 💭")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="database"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 10_000 }}
      />,
    );
    expect(
      screen.getByText(hasExactText("Analyzing database 🔍")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="database"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 20_000 }}
      />,
    );
    expect(
      screen.getByText(hasExactText("Piecing together database 🕵️")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="database"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 30_000 }}
      />,
    );
    expect(
      screen.getByText(hasExactText("Locking in on database 🎯")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="database"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 40_000 }}
      />,
    );
    expect(
      screen.getByText(hasExactText("Sweating over database 💦")),
    ).toBeInTheDocument();

    rerender(
      <ReasoningBlock
        content="database"
        ts={Date.now()}
        isStreaming
        isLast
        isCollapsed={false}
        onToggle={() => {}}
        metadata={{ reasoningDurationMs: 60_000 }}
      />,
    );
    expect(
      screen.getByText(hasExactText("🔥 Melting over database 🔥")),
    ).toBeInTheDocument();
  });
});
