import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  ExtensionStateContext,
  type ExtensionStateContextType,
} from "@/context/ExtensionStateContext";
import { Bash } from "../Bash";

vi.mock("@src/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

import { vscode } from "@src/utils/vscode";

describe("Bash", () => {
  const renderBash = (
    ui: React.ReactElement,
    collapseCodeToolsByDefault = false,
  ) => {
    return render(
      <ExtensionStateContext.Provider
        value={{ collapseCodeToolsByDefault } as ExtensionStateContextType}
      >
        {ui}
      </ExtensionStateContext.Provider>,
    );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not auto-scroll terminal output when chat browsing released bottom pinning", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const { rerender } = renderBash(
      <Bash
        command="npm test"
        output="line 1"
        isRunning
        allowOutputAutoScroll={false}
      />,
    );

    const output = screen.getByTestId("bash-output");
    Object.defineProperty(output, "scrollHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(output, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(output, "scrollTop", {
      configurable: true,
      writable: true,
      value: 100,
    });

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash
          command="npm test"
          output={"line 1\nline 2"}
          isRunning
          allowOutputAutoScroll={false}
        />
      </ExtensionStateContext.Provider>,
    );

    await waitFor(() => {
      expect(rafSpy).not.toHaveBeenCalled();
      expect((output as HTMLDivElement).scrollTop).toBe(100);
    });
  });

  it("keeps auto-scrolling terminal output when chat is still pinned", async () => {
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const { rerender } = renderBash(
      <Bash
        command="npm test"
        output="line 1"
        isRunning
        allowOutputAutoScroll
      />,
    );

    const output = screen.getByTestId("bash-output");
    Object.defineProperty(output, "scrollHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(output, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(output, "scrollTop", {
      configurable: true,
      writable: true,
      value: 100,
    });

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash
          command="npm test"
          output={"line 1\nline 2"}
          isRunning
          allowOutputAutoScroll
        />
      </ExtensionStateContext.Provider>,
    );

    await waitFor(() => {
      expect(rafSpy).toHaveBeenCalled();
      expect((output as HTMLDivElement).scrollTop).toBe(200);
    });
  });

  it("waits before auto-collapsing after the command completes", async () => {
    vi.useFakeTimers();
    const { rerender } = renderBash(
      <Bash command="npm test" output="done" isRunning />,
    );

    expect(screen.getByTestId("bash-output")).toBeInTheDocument();

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash command="npm test" output="done" isRunning={false} />
      </ExtensionStateContext.Provider>,
    );

    expect(screen.getByTestId("bash-output")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByTestId("bash-output")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument();
  });

  it("cancels the pending auto-collapse if the command starts running again", async () => {
    vi.useFakeTimers();
    const { rerender } = renderBash(
      <Bash command="npm test" output="line 1" isRunning />,
    );

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash command="npm test" output="line 1" isRunning={false} />
      </ExtensionStateContext.Provider>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash command="npm test" output="line 1\nline 2" isRunning />
      </ExtensionStateContext.Provider>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId("bash-output")).toBeInTheDocument();
  });

  it("applies the configured header background overlay as an inline css variable", () => {
    const { container } = render(
      <ExtensionStateContext.Provider
        value={
          {
            collapseCodeToolsByDefault: false,
            toolHeaderBackgrounds: {
              global: "/assets/textures/carbon-fiber.png",
            },
          } as ExtensionStateContextType
        }
      >
        <Bash command="npm test" output="done" isRunning={false} />
      </ExtensionStateContext.Provider>,
    );

    const header = container.querySelector(
      'div[style*="--tool-header-overlay-image"]',
    );

    expect(header).not.toBeNull();
    expect(header?.getAttribute("style")).toContain(
      "/assets/textures/carbon-fiber.png",
    );
  });

  it("starts collapsed when the display setting is enabled and the command is idle", () => {
    renderBash(
      <Bash command="npm test" output="done" isRunning={false} />,
      true,
    );

    expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument();
  });

  it("starts collapsed for restored chat commands even when auto-expand is enabled", () => {
    renderBash(
      <Bash
        command="npm test"
        output="done"
        isRunning={false}
        startCollapsedOnMount
      />,
      false,
    );

    expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument();
  });

  it("stays collapsed while running when the display setting is enabled", () => {
    renderBash(<Bash command="npm test" output="line 1" isRunning />, true);

    expect(screen.queryByTestId("bash-output")).not.toBeInTheDocument();
  });

  it("removes blank leading lines from terminal output", () => {
    renderBash(
      <Bash
        command="npm run dev"
        output={
          "\n\n> dope-todo-app@1.0.0 dev\n> vite\n\nLocal: http://localhost:5173/"
        }
        isRunning
      />,
    );

    const output = screen.getByTestId("bash-output");
    expect(output.textContent?.startsWith("\n")).toBe(false);
    expect(output.textContent).toContain("> dope-todo-app@1.0.0 dev");
  });

  it("renders localhost URLs in output as clickable links", () => {
    renderBash(
      <Bash
        command="npm run dev"
        output={
          "VITE ready\nLocal: http://localhost:5175/\nNetwork: use --host to expose"
        }
        isRunning
      />,
    );

    const link = screen.getByRole("link", { name: "http://localhost:5175/" });
    expect(link).toHaveAttribute("href", "http://localhost:5175/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows partial bash tool commands in the header while they stream", () => {
    renderBash(
      <Bash
        command={'{"tool":"bash","command":"echo Jarvis online'}
        output=""
        isRunning
      />,
    );

    expect(screen.getByText("echo Jarvis online")).toBeInTheDocument();
  });

  it("keeps the longest streamed header command when a later payload regresses", () => {
    const { rerender } = renderBash(
      <Bash
        command={'{"tool":"bash","command":"echo Jarvis online. Ready'}
        output=""
        isRunning
      />,
    );

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash
          command={'{"tool":"bash","command":"echo Jarvis online'}
          output=""
          isRunning
        />
      </ExtensionStateContext.Provider>,
    );

    expect(
      screen.getByText("echo Jarvis online. Ready"),
    ).toBeInTheDocument();
  });

  it("posts scoped stdin to the extension for active commands", () => {
    renderBash(
      <Bash
        command="python app.py"
        output="Enter your name:"
        isRunning
        executionId="exec-stdin"
      />,
    );

    const input = screen.getByTestId("bash-stdin-input");
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.submit(input.closest("form")!);

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "terminalOperation",
      terminalOperation: "stdin",
      executionId: "exec-stdin",
      text: "alice\n",
    });
  });

  it("posts continue with execution context so proceed can activate AI stdin mode", () => {
    renderBash(
      <Bash
        command="python app.py"
        output="Enter your name:"
        isRunning
        executionId="exec-ai-stdin"
      />,
    );

    fireEvent.click(screen.getByLabelText("Proceed while running"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: "terminalOperation",
      terminalOperation: "continue",
      executionId: "exec-ai-stdin",
      text: "python app.py",
    });
  });

  it("keeps the stop button available after proceeding while the command is still running", () => {
    const { rerender } = renderBash(
      <Bash
        command="npm run dev"
        output="Local: http://localhost:3000"
        isRunning
        isAskingToProceed
        executionId="exec-proceed"
      />,
    );

    fireEvent.click(screen.getByLabelText("Proceed while running"));

    rerender(
      <ExtensionStateContext.Provider
        value={
          { collapseCodeToolsByDefault: false } as ExtensionStateContextType
        }
      >
        <Bash
          command="npm run dev"
          output="Local: http://localhost:3000"
          isRunning
          isAskingToProceed={false}
          executionId="exec-proceed"
        />
      </ExtensionStateContext.Provider>,
    );

    const stopButton = screen.getByLabelText("Kill command");
    expect(stopButton).toBeEnabled();

    fireEvent.click(stopButton);

    expect(vscode.postMessage).toHaveBeenLastCalledWith({
      type: "terminalOperation",
      terminalOperation: "abort",
      executionId: "exec-proceed",
    });
  });
});
