import { describe, expect, it } from "vitest";

import { resolveToolFilePath } from "../filePathResolver";

describe("resolveToolFilePath", () => {
  it("prefers the top-level tool path", () => {
    expect(
      resolveToolFilePath({
        path: "sample.txt",
        params: { path: "ignored.txt" },
      }),
    ).toBe("sample.txt");
  });

  it("falls back to nested params and nativeArgs paths", () => {
    expect(
      resolveToolFilePath({
        params: { path: "sample.txt" },
      }),
    ).toBe("sample.txt");

    expect(
      resolveToolFilePath({
        nativeArgs: { path: "src/app.ts" },
      }),
    ).toBe("src/app.ts");
  });

  it("falls back to the tool result path when the tool payload is missing one", () => {
    expect(
      resolveToolFilePath(
        {
          params: {},
        },
        {
          path: "sample.txt",
        },
      ),
    ).toBe("sample.txt");
  });

  it("supports alternate file path keys", () => {
    expect(
      resolveToolFilePath({
        file_path: "src/app.ts",
      }),
    ).toBe("src/app.ts");

    expect(
      resolveToolFilePath({
        target_file: "src/app.ts",
      }),
    ).toBe("src/app.ts");
  });

  it("falls back to file entries when path fields live under files arrays", () => {
    expect(
      resolveToolFilePath({
        files: [{ path: "sample.txt" }],
      }),
    ).toBe("sample.txt");

    expect(
      resolveToolFilePath(
        {},
        {
          files: [{ file_path: "src/app.ts" }],
        },
      ),
    ).toBe("src/app.ts");
  });
});
