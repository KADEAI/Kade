import { beforeEach, describe, expect, it } from "vitest";

import { MarkdownToolCallParser } from "../MarkdownToolCallParser";

describe("MarkdownToolCallParser", () => {
  let parser: MarkdownToolCallParser;

  beforeEach(() => {
    parser = new MarkdownToolCallParser();
    parser.setMcpToolNames([
      {
        compositeName: "poly-mcp_file_tree",
        serverName: "poly-mcp",
        toolName: "file_tree",
      },
    ]);
  });

  it("parses fenced MCP tool blocks with a raw JSON body", () => {
    const message = [
      "Let's inspect the workspace first.",
      "",
      "```poly-mcp_file_tree",
      '{"path": ".", "max_depth": 3}',
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlock = blocks.find(
      (block) => block.type === "mcp_tool_use",
    ) as any;

    expect(textBlock?.content).toContain("Let's inspect the workspace first.");
    expect(textBlock?.content).not.toContain("poly-mcp_file_tree");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("poly-mcp_file_tree");
    expect(toolBlock.serverName).toBe("poly-mcp");
    expect(toolBlock.toolName).toBe("file_tree");
    expect(toolBlock.arguments).toEqual({ path: ".", max_depth: 3 });
    expect(toolBlock.partial).toBe(false);
  });

  it("parses multi-file fenced read blocks with per-line --lines flags", () => {
    const message = [
      "```read",
      "src/core/tools/EditTool.ts --lines 1050-1150",
      "src/core/assistant-message/UnifiedToolCallParser.ts --lines 168-250",
      "src/core/task/LuxurySpa.ts --lines 60-150",
      "src/core/task/AgentLoop.ts --lines 600-700",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks.map((block) => block.params.path)).toEqual([
      "src/core/tools/EditTool.ts",
      "src/core/assistant-message/UnifiedToolCallParser.ts",
      "src/core/task/LuxurySpa.ts",
      "src/core/task/AgentLoop.ts",
    ]);
    expect(toolBlocks.map((block) => block.params.lineRange)).toEqual([
      "1050-1150",
      "168-250",
      "60-150",
      "600-700",
    ]);
  });

  it("parses multi-file fenced read blocks with inline H and T specifiers", () => {
    const message = [
      "```read",
      "src/core/tools/EditTool.ts H20",
      "src/core/task/AgentLoop.ts T15",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].params.path).toBe("src/core/tools/EditTool.ts");
    expect(toolBlocks[0].params.head).toBe("20");
    expect(toolBlocks[1].params.path).toBe("src/core/task/AgentLoop.ts");
    expect(toolBlocks[1].params.tail).toBe("15");
  });

  it("parses multiple hybrid edit blocks from a single edit tool call", () => {
    const message = JSON.stringify({
      edit: [
        "fruit-ninja.html",
        `11-13:
        body {
            overflow: hidden;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'Arial Black', sans-serif;
New:
        body {
            overflow: hidden;
            background: linear-gradient(135deg, #8B4513 0%, #D2691E 100%);
            font-family: 'Arial Black', sans-serif;
            background-size: 100% 100%;
        }`,
        `20-22:
        #gameCanvas {
            display: block;
            cursor: none;
            background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 70%);
New:
        #gameCanvas {
            display: block;
            cursor: none;
            background: radial-gradient(circle at 50% 50%, rgba(210, 180, 140, 0.2) 0%, transparent 70%);
        }`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.nativeArgs.path).toBe("fruit-ninja.html");
    expect(toolBlock.nativeArgs.edits).toHaveLength(2);
    expect(toolBlock.nativeArgs.edits[0]).toMatchObject({
      start_line: 11,
      end_line: 13,
    });
    expect(toolBlock.nativeArgs.edits[1]).toMatchObject({
      start_line: 20,
      end_line: 22,
    });
  });

  it("parses hybrid edit ranges with whitespace around the dash", () => {
    const message = JSON.stringify({
      edit: [
        "fruit-ninja.html",
        `20 - 22:
        #gameCanvas {
            display: block;
New:
        #gameCanvas {
            display: block;
        }`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.nativeArgs.edits).toEqual([
      expect.objectContaining({
        start_line: 20,
        end_line: 22,
      }),
    ]);
  });

  it("parses single-line hybrid edit ranges written as 245:", () => {
    const message = JSON.stringify({
      edit: [
        "fruit-ninja.html",
        `245:
const score = 1;
New:
const score = 2;`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.nativeArgs.edits).toEqual([
      expect.objectContaining({
        start_line: 245,
        end_line: 245,
        oldText: "const score = 1;",
        newText: "const score = 2;",
      }),
    ]);
  });

  it("preserves raw multiline newText with indentation and braces", () => {
    const message = JSON.stringify({
      edit: [
        "fruit-ninja.html",
        `149-160:
            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
            }
New:
            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -(20 + Math.random() * 12);
            }`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;
    const edit = toolBlock.nativeArgs.edits[0];

    expect(edit.start_line).toBe(149);
    expect(edit.end_line).toBe(160);
    expect(edit.newText).toBe(`            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -(20 + Math.random() * 12);
            }`);
    expect(edit.newText).toContain("\n                this.y = canvas.height + 50;");
  });

  it("preserves blank lines inside New blocks", () => {
    const message = JSON.stringify({
      edit: [
        "app.ts",
        `10:
function test() {}
New:
function test() {

  return {
    ok: true,
  };
}`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock.nativeArgs.edits[0].newText).toBe(`function test() {

  return {
    ok: true,
  };
}`);
  });

  it("treats a trailing grep -i flag as include_all in JSON tool syntax", () => {
    const message = JSON.stringify({
      grep: ["src/", "AuthService", "-i"],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("grep");
    expect(toolBlock.params.path).toBe("src/");
    expect(toolBlock.params.query).toEqual(["AuthService"]);
    expect(toolBlock.params.include_all).toBe(true);
    expect(toolBlock.nativeArgs.include_all).toBe(true);
  });

  it("treats a trailing fetch -L flag as include_links in JSON tool syntax", () => {
    const message = JSON.stringify({
      fetch: ["https://example.com/docs", "-L"],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("fetch");
    expect(toolBlock.params.url).toBe("https://example.com/docs");
    expect(toolBlock.params.include_links).toBe(true);
    expect(toolBlock.nativeArgs.include_links).toBe(true);
  });

  it("preserves multiple multiline New blocks in order", () => {
    const message = JSON.stringify({
      edit: [
        "styles.css",
        `11-13:
body {
  color: blue;
}
New:
body {
  color: brown;
  background-image:
    linear-gradient(red, orange),
    linear-gradient(blue, green);
}`,
        `20:
.card { display: block; }
New:
.card {
  display: grid;
  gap: 12px;
}`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock.nativeArgs.edits).toHaveLength(2);
    expect(toolBlock.nativeArgs.edits[0].newText).toBe(`body {
  color: brown;
  background-image:
    linear-gradient(red, orange),
    linear-gradient(blue, green);
}`);
    expect(toolBlock.nativeArgs.edits[1].newText).toBe(`.card {
  display: grid;
  gap: 12px;
}`);
  });

  it("does not mash New onto closing braces when parsing hybrid blocks", () => {
    const message = JSON.stringify({
      edit: [
        "widget.ts",
        `30-34:
if (ready) {
  run();
}
New:
if (ready) {
  run();
  finish();
}`,
      ],
    });

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;
    const edit = toolBlock.nativeArgs.edits[0];

    expect(edit.oldText.includes("}New:")).toBe(false);
    expect(edit.newText.startsWith("if (ready) {")).toBe(true);
    expect(edit.newText.includes("\n  finish();\n")).toBe(true);
  });

  it("preserves raw newlines in non-JSON-stringified hybrid edit payloads", () => {
    const message = `{
  "edit": [
    "fruit-ninja.html",
    "244-245:
            }
        }
New:
            }
        }

        class Powerup {
            constructor() {
                this.type = powerupTypes[Math.floor(Math.random() * powerupTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
            }
        }"
  ]
}`;

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;
    const edit = toolBlock.nativeArgs.edits[0];

    expect(toolBlock).toBeDefined();
    expect(edit.oldText.includes("New:")).toBe(false);
    expect(edit.oldText.endsWith("        }")).toBe(true);
    expect(edit.newText).toContain("\n\n        class Powerup {\n");
    expect(edit.newText.includes("}New:")).toBe(false);
  });

  it("salvages a finalized malformed edit call instead of leaking it into chat", () => {
    const message = `{
  "edit": [
    "app.ts",
    "10:
function test() {}
New:
function test() {
  return true;
}"
  ]

I changed the file and now I'm done talking.`;

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("edit");
    expect(toolBlock.partial).toBe(false);
    expect(toolBlock.nativeArgs.path).toBe("app.ts");
    expect(toolBlock.nativeArgs.edits[0]).toMatchObject({
      start_line: 10,
      end_line: 10,
      oldText: "function test() {}",
    });
    expect(toolBlock.nativeArgs.edits[0].newText).toContain("return true;");
    expect(textBlock?.content ?? "").not.toContain(`"edit"`);
    expect(textBlock?.content ?? "").not.toContain("function test() {}");
  });

  it("does not absorb later streaming chatter into a partial hybrid edit", () => {
    const chunks = [
      '{\n  "edit": [\n    "app.ts",\n    "10:\nfunction test() {}\nNew:\nfunction test() {',
      "\n  return true;\n}",
      '"\n  ]\n',
      "\nokay cool that edit is done and now let me explain the result",
    ];

    let latestBlocks: any[] = [];
    for (const chunk of chunks) {
      latestBlocks = parser.processChunk(chunk).blocks as any[];
    }

    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.partial).toBe(false);
    expect(toolBlock.nativeArgs.edits[0].newText).toBe(`function test() {\n  return true;\n}`);
    expect(toolBlock.nativeArgs.edits[0].newText).not.toContain("okay cool");
    expect(latestBlocks.some((block) => block.type === "text" && String(block.content).includes("okay cool"))).toBe(false);
  });

  it("keeps the same tool id while a markdown edit streams and when it finalizes", () => {
    const firstChunk = '{\n  "edit": [\n    "app.ts",\n    "10:\nfunction test() {}\nNew:\nfunction test() {';
    const secondChunk = '\n  return true;\n}"\n  ]\n}';

    const firstBlocks = parser.processChunk(firstChunk).blocks as any[];
    const partialToolBlock = firstBlocks.find(
      (block) => block.type === "tool_use",
    ) as any;

    expect(partialToolBlock).toBeDefined();
    expect(partialToolBlock.partial).toBe(true);
    expect(partialToolBlock.nativeArgs.path).toBe("app.ts");
    expect(partialToolBlock.nativeArgs.edits[0].newText).toBe("function test() {");

    const secondBlocks = parser.processChunk(secondChunk).blocks as any[];
    const finalizedToolBlock = secondBlocks.find(
      (block) => block.type === "tool_use" && block.partial === false,
    ) as any;

    expect(finalizedToolBlock).toBeDefined();
    expect(finalizedToolBlock.id).toBe(partialToolBlock.id);
    expect(finalizedToolBlock.nativeArgs.path).toBe("app.ts");
    expect(finalizedToolBlock.nativeArgs.edits[0].newText).toBe(
      "function test() {\n  return true;\n}",
    );
  });

  it("recovers a strict markdown tool when the next tool starts without a closer", () => {
    const message = [
      "```write file.txt",
      "alpha",
      "```read src/app.ts --lines 1-5",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("write");
    expect(toolBlocks[0].partial).toBe(false);
    expect(toolBlocks[0].params.path).toBe("file.txt");
    expect(toolBlocks[0].params.content).toBe("alpha");
    expect(toolBlocks[1].name).toBe("read");
    expect(toolBlocks[1].partial).toBe(false);
    expect(toolBlocks[1].params.path).toBe("src/app.ts");
    expect(toolBlocks[1].params.lineRange).toBe("1-5");
  });

  it("does not let an unterminated non-tool code fence swallow a later tool block", () => {
    const message = [
      "Here is some broken markdown:",
      "```typescript",
      "const example = true;",
      "```read src/app.ts --lines 1-5",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(textBlock?.content ?? "").toContain("Here is some broken markdown:");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
    expect(toolBlock.partial).toBe(false);
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.lineRange).toBe("1-5");
  });

  it("recovers a later tool in streaming after an unterminated non-tool code fence", () => {
    const chunks = [
      "```typescript\nconst x = 1;\n",
      "```read src/app.ts --lines 1-5\n",
      "```",
    ];

    let blocks: any[] = [];
    for (const chunk of chunks) {
      blocks = parser.processChunk(chunk).blocks as any[];
    }

    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
    expect(toolBlock.partial).toBe(false);
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.lineRange).toBe("1-5");
  });
});
