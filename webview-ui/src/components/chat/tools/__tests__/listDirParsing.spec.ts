import { describe, expect, it } from "vitest";

import { parseListDirContent } from "../listDirParsing";

describe("parseListDirContent", () => {
  it("parses ASCII tree output into nested directory items", () => {
    const content = `Total files: 5, Total folders: 2
(file_name|L = line count)

.
|-- src/ (2 files)
|   |-- components/ (1 files)
|   |   \`-- Button.tsx|L34
|   \`-- index.ts|L12
\`-- README.md|L8`;

    const result = parseListDirContent(content, "/workspace");

    expect(result.directoryTree).toEqual([
      {
        name: "src",
        path: "/workspace/src",
        isDir: true,
        sizeInfo: "2 files",
        children: [
          {
            name: "components",
            path: "/workspace/src/components",
            isDir: true,
            sizeInfo: "1 files",
            children: [
              {
                name: "Button.tsx",
                path: "/workspace/src/components/Button.tsx",
                isDir: false,
                sizeInfo: "L34",
                children: [],
              },
            ],
          },
          {
            name: "index.ts",
            path: "/workspace/src/index.ts",
            isDir: false,
            sizeInfo: "L12",
            children: [],
          },
        ],
      },
      {
        name: "README.md",
        path: "/workspace/README.md",
        isDir: false,
        sizeInfo: "L8",
        children: [],
      },
    ]);
  });

  it("keeps supporting the legacy flat list format", () => {
    const content = `Total files: 3, Total folders: 1
(file_name|L = line count)

src/ (2 files)
src/index.ts|L12
README.md|L8`;

    const result = parseListDirContent(content, "/workspace");

    expect(result.directoryTree).toEqual([
      {
        name: "src",
        path: "/workspace/src",
        isDir: true,
        sizeInfo: "2 files",
        children: [
          {
            name: "index.ts",
            path: "/workspace/src/index.ts",
            isDir: false,
            sizeInfo: "L12",
            children: [],
          },
        ],
      },
      {
        name: "README.md",
        path: "/workspace/README.md",
        isDir: false,
        sizeInfo: "L8",
        children: [],
      },
    ]);
  });
});
