import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ExtensionStateContext,
  type ExtensionStateContextType,
} from "@/context/ExtensionStateContext";

import { useToolHeaderBackground } from "./useToolHeaderBackground";

vi.mock("@/hooks/useEmptyStateBackgrounds", () => ({
  useEmptyStateBackgrounds: () => ({
    options: [
      {
        file: "carbon-fiber.png",
        label: "carbon-fiber",
        uri: "vscode-webview://carbon-fiber.png",
      },
      {
        file: "write.png",
        label: "write",
        uri: "vscode-webview://write.png",
      },
    ],
    folderPath: "/tmp/empty-state-backgrounds",
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    openFolder: vi.fn(),
  }),
}));

describe("useToolHeaderBackground", () => {
  const createWrapper =
    (
      toolHeaderBackgrounds?: ExtensionStateContextType["toolHeaderBackgrounds"],
    ) =>
    ({ children }: { children: React.ReactNode }) => (
      <ExtensionStateContext.Provider
        value={{ toolHeaderBackgrounds } as ExtensionStateContextType}
      >
        {children}
      </ExtensionStateContext.Provider>
    );

  it("returns no style when no backgrounds are configured", () => {
    const { result } = renderHook(() => useToolHeaderBackground("bash"), {
      wrapper: createWrapper(),
    });

    expect(result.current.hasBackground).toBe(false);
    expect(result.current.style).toEqual({
      "--tool-header-overlay-image": "none",
      "--tool-header-overlay-opacity": "0",
    });
  });

  it("clears the overlay style when switching back to the default background", () => {
    let toolHeaderBackgrounds: ExtensionStateContextType["toolHeaderBackgrounds"] =
      {
        global: "carbon-fiber.png",
      };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ExtensionStateContext.Provider
        value={{ toolHeaderBackgrounds } as ExtensionStateContextType}
      >
        {children}
      </ExtensionStateContext.Provider>
    );
    const { result, rerender } = renderHook(
      () => useToolHeaderBackground("bash"),
      { wrapper },
    );

    expect(result.current.hasBackground).toBe(true);

    toolHeaderBackgrounds = undefined;
    rerender();

    expect(result.current.hasBackground).toBe(false);
    expect(result.current.style).toEqual({
      "--tool-header-overlay-image": "none",
      "--tool-header-overlay-opacity": "0",
    });
  });

  it("uses the global background when a tool-specific one is missing", () => {
    const { result } = renderHook(() => useToolHeaderBackground("edit"), {
      wrapper: createWrapper({
        global: "carbon-fiber.png",
      }),
    });

    expect(result.current.hasBackground).toBe(true);
    expect(result.current.imageUrl).toBe("vscode-webview://carbon-fiber.png");
    expect(
      (result.current.style as Record<string, string>)?.[
        "--tool-header-overlay-image"
      ],
    ).toContain("vscode-webview://carbon-fiber.png");
  });

  it("prefers the tool-specific background over the global one", () => {
    const { result } = renderHook(() => useToolHeaderBackground("write"), {
      wrapper: createWrapper({
        global: "carbon-fiber.png",
        write: "write.png",
      }),
    });

    expect(result.current.imageUrl).toBe("vscode-webview://write.png");
    expect(
      (result.current.style as Record<string, string>)?.[
        "--tool-header-overlay-image"
      ],
    ).toContain("vscode-webview://write.png");
  });
});
