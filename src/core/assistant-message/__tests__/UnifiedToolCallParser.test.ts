import { beforeEach, describe, expect, it } from "vitest";

import {
  formatWriteHistoryPlaceholderBody,
  redactEditHistoryBody,
} from "../../prompts/responses";
import { UnifiedToolCallParser } from "../UnifiedToolCallParser";

describe("UnifiedToolCallParser", () => {
  let parser: UnifiedToolCallParser;

  beforeEach(() => {
    parser = new UnifiedToolCallParser();
    parser.setMcpToolNames([
      {
        compositeName: "poly-mcp_file_tree",
        serverName: "poly-mcp",
        toolName: "file_tree",
      },
      {
        compositeName: "puppeteer_puppeteer_navigate",
        serverName: "puppeteer",
        toolName: "puppeteer_navigate",
      },
      {
        compositeName: "puppeteer_puppeteer_screenshot",
        serverName: "puppeteer",
        toolName: "puppeteer_screenshot",
      },
    ]);
  });

  it("does not treat legacy single-letter mkdir syntax as a unified tool", () => {
    const message = [
      "I'll inspect the workspace first.",
      "",
      "M poly-mcp_file_tree",
      "/M",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");

    expect(textBlock?.content).toContain("I'll inspect the workspace first.");
    expect(textBlock?.content).toContain("M poly-mcp_file_tree");
    expect(toolBlocks).toHaveLength(0);
  });

  it("ignores legacy single-letter syntax after a closed markdown code fence", () => {
    const message = [
      "Here is the snippet:",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "Y auth provider flow",
      "/Y",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");

    expect(textBlock).toBeDefined();
    expect(textBlock.content.match(/```/g)?.length).toBe(2);
    expect(textBlock.content).toContain("Y auth provider flow");
    expect(toolBlocks).toHaveLength(0);
  });

  it("ignores legacy single-letter syntax after an unclosed markdown code fence", () => {
    const parser = new UnifiedToolCallParser();
    const firstChunk = [
      "Here is the snippet:",
      "",
      "```ts",
      "const x = 1;",
    ].join("\n");
    const secondChunk = ["", "Y auth provider flow", "/Y"].join("\n");

    parser.processChunk(firstChunk);
    const { blocks } = parser.processChunk(secondChunk);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("Y auth provider flow");
  });

  it("ignores legacy single-letter ask blocks with Y", () => {
    const message = [
      "I’m going to search semantically first.",
      "",
      "Y auth provider flow",
      "/Y",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");

    expect(textBlock?.content).toContain(
      "I’m going to search semantically first.",
    );
    expect(textBlock?.content).toContain("Y auth provider flow");
    expect(toolBlocks).toHaveLength(0);
  });

  it("does not misclassify normal words that start with action names", () => {
    const message = [
      "We should update the README before shipping.",
      "searching later is fine too.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("README");
    expect(textBlock?.content).toContain("searching later is fine too.");
  });

  it("still parses valid action commands when followed by arguments", () => {
    const message = ["read src/core/UnifiedToolCallParser.ts", "END"].join(
      "\n",
    );

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
    expect(toolBlock.params.path).toBe("src/core/UnifiedToolCallParser.ts");
  });

  it("ignores legacy single-letter grep syntax", () => {
    const message = ["G src/ AuthService -i", "/G"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("G src/ AuthService -i");
  });

  it("ignores legacy single-letter grep regex syntax", () => {
    const message = ["G src/ toolResult.*is_error", "/G"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("toolResult.*is_error");
  });

  it("keeps legacy single-letter find blocks as plain text while streaming", () => {
    const firstPass = parser.processChunk("F src/\n");
    const firstToolBlocks = firstPass.blocks.filter(
      (block) => block.type === "tool_use",
    );

    expect(firstToolBlocks).toHaveLength(0);

    const secondPass = parser.processChunk(
      "ClineMessage\nExtensionMessage\n/F",
    );
    const secondToolBlocks = secondPass.blocks.filter(
      (block) => block.type === "tool_use",
    );
    const textBlock = secondPass.blocks.find(
      (block) => block.type === "text",
    ) as any;

    expect(secondToolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("F src/");
  });

  it("ignores legacy single-letter fetch syntax", () => {
    const message = ["U https://example.com/docs -L", "/U"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("https://example.com/docs");
  });

  it("parses wrapped raw tool_call grep blocks and normalizes pattern to query", () => {
    const message = [
      "<tool_call><function=grep><parameter=pattern>fn main</parameter><parameter=path>.</parameter></function></tool_call>",
      "<tool_call><function=grep><parameter=pattern>UE5|ue5|Unreal</parameter><parameter=path>.</parameter></function></tool_call>",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "grep",
      partial: false,
      nativeArgs: {
        query: "fn main",
        path: ".",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      partial: false,
      nativeArgs: {
        query: "UE5|ue5|Unreal",
        path: ".",
      },
    });
  });

  it("parses wrapped raw tool_call glob blocks and normalizes query to pattern", () => {
    const message =
      "<tool_call><function=glob><parameter=query>*.ts</parameter><parameter=path>src</parameter></function></tool_call>";

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "glob",
      partial: false,
      nativeArgs: {
        pattern: "*.ts",
        path: "src",
      },
    });
  });

  it("parses wrapped raw tool_call list_dir blocks through the list alias", () => {
    const message =
      "<tool_call><function=list_dir><parameter=path>src</parameter><parameter=recursive>true</parameter></function></tool_call>";

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "list",
      originalName: "list_dir",
      partial: false,
      nativeArgs: {
        path: "src",
        recursive: true,
      },
    });
  });

  it("parses dirlist alias commands inside unified tool fences", () => {
    const message = ["```tool", "dirlist .", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.originalName).toBe("dirlist");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.partial).toBe(false);
  });

  it("parses ls alias commands inside unified tool fences", () => {
    const message = ["```tool", "ls src", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.originalName).toBe("ls");
    expect(toolBlock.params.path).toBe("src");
    expect(toolBlock.partial).toBe(false);
  });

  it("parses dirlist alias commands at message start as implicit actions", () => {
    parser.processChunk("dirlist .");
    parser.finalizeContentBlocks();
    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.originalName).toBe("dirlist");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.partial).toBe(false);
  });

  it("parses mkdir commands inside unified tool fences", () => {
    const message = ["```tool", "mkdir .", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("mkdir");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.partial).toBe(false);
  });

  it("parses mkdir commands at message start as implicit actions", () => {
    parser.processChunk("mkdir .");
    parser.finalizeContentBlocks();
    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("mkdir");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.partial).toBe(false);
  });

  it("parses stacked hybrid edit blocks with colon and New headers", () => {
    const edits = (parser as any).parseEditBlocks(`245:
const score = 1;
New:
const score = 2;
250 - 252:
function draw() {
  return 1;
}
New:
function draw() {
  return 2;
}`);

    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({
      start_line: 245,
      end_line: 245,
      oldText: "const score = 1;",
      newText: "const score = 2;",
    });
    expect(edits[1]).toMatchObject({
      start_line: 250,
      end_line: 252,
    });
  });

  it("preserves raw multiline replacement text with indentation and braces", () => {
    const edits = (parser as any).parseEditBlocks(`149-160:
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
            }`);

    expect(edits[0].newText).toBe(`            constructor() {
                this.type = Math.random() < 0.15 ? bombType : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
                this.x = Math.random() * canvas.width;
                this.y = canvas.height + 50;
                this.vx = (Math.random() - 0.5) * 4;
                this.vy = -(20 + Math.random() * 12);
            }`);
  });

  it("preserves blank lines inside replacement blocks", () => {
    const edits = (parser as any).parseEditBlocks(`10:
function test() {}
New:
function test() {

  return {
    ok: true,
  };
}`);

    expect(edits[0].newText).toBe(`function test() {

  return {
    ok: true,
  };
}`);
  });

  it("keeps multiple multiline New blocks separated", () => {
    const edits = (parser as any).parseEditBlocks(`11-13:
body {
  color: blue;
}
New:
body {
  color: brown;
  background-image:
    linear-gradient(red, orange),
    linear-gradient(blue, green);
}
20:
.card { display: block; }
New:
.card {
  display: grid;
  gap: 12px;
}`);

    expect(edits).toHaveLength(2);
    expect(edits[0].newText).toContain("\n  background-image:\n");
    expect(edits[1].newText).toBe(`.card {
  display: grid;
  gap: 12px;
}`);
  });

  it("does not absorb the New marker into adjacent brace content", () => {
    const edits = (parser as any).parseEditBlocks(`30-34:
if (ready) {
  run();
}
New:
if (ready) {
  run();
  finish();
}`);

    expect(edits[0].oldText.includes("}New:")).toBe(false);
    expect(edits[0].newText.includes("\n  finish();\n")).toBe(true);
  });

  it("parses sloppy newText headers that redundantly include a line range", () => {
    const edits = (parser as any).parseEditBlocks(`oldText 2494-2507:
className={cn(
  "base",
)}
newText:2494-2507:
className={cn(
  "base changed",
)}`);

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      start_line: 2494,
      end_line: 2507,
      oldText: `className={cn(
  "base",
)}`,
      newText: `className={cn(
  "base changed",
)}`,
    });
  });

  it("parses inline oldText/newText content on the header line", () => {
    const edits = (parser as any).parseEditBlocks(`oldText: const x = 1;
newText: const x = 2;`);

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      oldText: "const x = 1;",
      newText: "const x = 2;",
    });
  });

  it("parses inline oldText/newText headers with multiline continuation", () => {
    const edits = (parser as any).parseEditBlocks(`oldText 12-18: const x = 1;
This is a sample edit
Blah blah blah
newText: blah blah blah
New content what about this?`);

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      start_line: 12,
      end_line: 18,
      oldText: ["const x = 1;", "This is a sample edit", "Blah blah blah"].join(
        "\n",
      ),
      newText: ["blah blah blah", "New content what about this?"].join("\n"),
    });
  });

  it("parses oldtxt/newtxt and otxt/ntxt aliases", () => {
    const edits = (parser as any).parseEditBlocks(`oldtxt 3-4: alpha
beta
newtxt: gamma
delta
otxt: left
ntxt: right`);

    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({
      start_line: 3,
      end_line: 4,
      oldText: ["alpha", "beta"].join("\n"),
      newText: ["gamma", "delta"].join("\n"),
    });
    expect(edits[1]).toMatchObject({
      oldText: "left",
      newText: "right",
    });
  });

  it("parses bracketed OTXT/NTXT ranges", () => {
    const edits = (parser as any).parseEditBlocks(`OTXT[1-3]: old content
line two
NTXT: new content
line two changed`);

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      start_line: 1,
      end_line: 3,
      oldText: ["old content", "line two"].join("\n"),
      newText: ["new content", "line two changed"].join("\n"),
    });
  });

  it("parses bare range headers without a leading dash or trailing colon", () => {
    const edits = (parser as any).parseEditBlocks(`10-12
const score = 1;
const lives = 3;
New:
const score = 2;
const lives = 4;`);

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      start_line: 10,
      end_line: 12,
      oldText: `const score = 1;
const lives = 3;`,
      newText: `const score = 2;
const lives = 4;`,
    });
  });

  it("treats legacy single-letter multiline B blocks as plain text", () => {
    const message = [
      "I'll run the build from the app directory.",
      "",
      "B src/components",
      "npm run build",
      "/b",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("B src/components");
    expect(textBlock?.content).toContain("/b");
  });

  it("does not treat prose after a single L as the list tool", () => {
    const message = "L LLMs are useful for code review.";

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toBe(message);
  });

  it("does not trim history for prose that only looks like an L tool opener", () => {
    const rawMessage = [
      "First tool completed correctly.",
      "",
      "READ src/app.ts",
      "END",
      "",
      "L LLMs are useful for code review.",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      ["First tool completed correctly.", "", "READ src/app.ts", "END"].join(
        "\n",
      ),
    );
  });

  it("trims trailing chat text after a completed unified tool call", () => {
    const rawMessage = [
      "I'll inspect the file first.",
      "",
      "READ src/app.ts",
      "END",
      "",
      "Here is what the tool returned and what I'll do next.",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      ["I'll inspect the file first.", "", "READ src/app.ts", "END"].join("\n"),
    );
  });

  it("drops a partial next unified tool from history trimming after a completed tool call", () => {
    const rawMessage = [
      "Starting with a read.",
      "",
      "READ src/app.ts",
      "END",
      "",
      "WRITE src/app.ts",
      "const broken = true;",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      ["Starting with a read.", "", "READ src/app.ts", "END"].join("\n"),
    );
  });

  it("parses ACTIONS blocks with natural-language discovery commands", () => {
    const message = [
      "ACTIONS",
      "read src/core/prompts/sections/unified-tools.ts 30-49, 39-49, 59-64",
      "read src/core/prompts/sections/markdown-tools.ts",
      "grep tool call|pizza|text in src",
      "find pizza.txt|test.txt|.ts in src/core",
      "bash npm run build",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(5);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe(
      "src/core/prompts/sections/unified-tools.ts",
    );
    expect(toolBlocks[0].params.lineRange).toBe("30-49, 39-49, 59-64");
    expect(toolBlocks[1].name).toBe("read");
    expect(toolBlocks[1].params.path).toBe(
      "src/core/prompts/sections/markdown-tools.ts",
    );
    expect(toolBlocks[2].name).toBe("grep");
    expect(toolBlocks[2].params.path).toBe("src");
    expect(toolBlocks[2].params.query).toEqual(["tool call", "pizza", "text"]);
    expect(toolBlocks[3].name).toBe("glob");
    expect(toolBlocks[3].params.path).toBe("src/core");
    expect(toolBlocks[3].params.pattern).toEqual([
      "pizza.txt",
      "test.txt",
      ".ts",
    ]);
    expect(toolBlocks[4].name).toBe("bash");
    expect(toolBlocks[4].params.command).toBe("npm run build");
  });

  it("parses compact head and tail suffixes in ACTIONS read commands", () => {
    const message = [
      "ACTIONS",
      "read src/head.ts:H10",
      "read src/tail.ts:T20",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "read",
      params: {
        path: "src/head.ts",
        head: "10",
      },
      nativeArgs: {
        files: [
          {
            path: "src/head.ts",
            lineRanges: [],
            head: 10,
          },
        ],
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "read",
      params: {
        path: "src/tail.ts",
        tail: "20",
      },
      nativeArgs: {
        files: [
          {
            path: "src/tail.ts",
            lineRanges: [],
            tail: 20,
          },
        ],
      },
    });
  });

  it("parses ACTIONS grep with quoted multi-query and trailing path", () => {
    const message = [
      "ACTIONS",
      'grep "Line 20|React|detective" sample_text.txt',
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("grep");
    expect(toolBlock.params.path).toBe("sample_text.txt");
    expect(toolBlock.params.query).toEqual(["Line 20", "React", "detective"]);
  });

  it("parses singular ACTION blocks", () => {
    const message = ["ACTION", "bash npm run build", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("bash");
    expect(toolBlock.params.command).toBe("npm run build");
  });

  it("keeps multi-word bash commands intact and only uses explicit cwd syntax", () => {
    const message = [
      "ACTIONS",
      "bash ls -la",
      "bash npm install",
      "bash npm run build in src",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(3);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      params: {
        command: "ls -la",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      params: {
        command: "npm install",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "bash",
      params: {
        command: "npm run build",
        cwd: "src",
      },
    });
  });

  it("parses malformed inline ACTION opener with first action attached", () => {
    const message = ["ACTIONlist", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe(".");
  });

  it("parses glued tool lines without a separating space inside ACTION blocks", () => {
    const message = [
      "ACTION",
      "readsrc/App.jsx",
      "listsrc/components",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("src/App.jsx");
    expect(toolBlocks[1].name).toBe("list");
    expect(toolBlocks[1].params.path).toBe("src/components");
  });

  it("parses duplicated inline ACTION opener on one line", () => {
    const message = "ACTION ACTIONread src/App.jsx END";

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
    expect(toolBlock.params.path).toBe("src/App.jsx");
  });

  it("parses ACTIONS blocks when a period is immediately before the opener", () => {
    const message = "We should make a file.ACTIONS\nlist src\nEND";

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("We should make a file.");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe("src");
  });

  it("does not leak partial ACTIONS opener text while streaming", () => {
    const firstChunk = parser.processChunk("A");
    const firstTextBlocks = firstChunk.blocks.filter(
      (block) => block.type === "text",
    );
    expect(firstTextBlocks).toHaveLength(0);

    const secondChunk = parser.processChunk("CTIONS\nlist src\nEND");
    const toolBlock = secondChunk.blocks.find(
      (block) => block.type === "tool_use",
    ) as any;
    const textBlocks = secondChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(textBlocks).toHaveLength(0);
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe("src");
  });

  it("does not leak partial wrapperless command prefixes while streaming", () => {
    const firstChunk = parser.processChunk("L");
    const firstTextBlocks = firstChunk.blocks.filter(
      (block) => block.type === "text",
    );
    expect(firstTextBlocks).toHaveLength(0);

    const secondChunk = parser.processChunk("IST\nEND");
    const toolBlock = secondChunk.blocks.find(
      (block) => block.type === "tool_use",
    ) as any;
    const textBlocks = secondChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(textBlocks).toHaveLength(0);
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe(".");
  });

  it("parses trailing END glued to the final action line", () => {
    const message = [
      "ACTIONS",
      "read package.json",
      "read vite.config.jsEND",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("package.json");
    expect(toolBlocks[1].name).toBe("read");
    expect(toolBlocks[1].params.path).toBe("vite.config.js");
  });

  it("strips outer quotes from ask, find, web, and grep queries", () => {
    const message = [
      "ACTIONS",
      'ask "auth flow entrypoint"',
      'find "App.tsx|index.html" in src',
      'web "react suspense error"',
      'grep "Line 20|React" in sample_text.txt',
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks[0].name).toBe("ask");
    expect(toolBlocks[0].params.query).toBe("auth flow entrypoint");
    expect(toolBlocks[1].name).toBe("glob");
    expect(toolBlocks[1].params.pattern).toEqual(["App.tsx", "index.html"]);
    expect(toolBlocks[2].name).toBe("web");
    expect(toolBlocks[2].params.query).toBe("react suspense error");
    expect(toolBlocks[3].name).toBe("grep");
    expect(toolBlocks[3].params.query).toEqual(["Line 20", "React"]);
  });

  it("parses ACTIONS find with path first and a glob pattern second", () => {
    const message = ["ACTIONS", "find src **/*.ts", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.params.path).toBe("src");
    expect(toolBlock.params.pattern).toBe("**/*.ts");
  });

  it("parses ACTIONS find comma-separated glob lists without splitting brace globs", () => {
    const message = ["ACTIONS", "find src *.ts,*.tsx,*.{js,jsx}", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.params.path).toBe("src");
    expect(toolBlock.params.pattern).toEqual(["*.ts", "*.tsx", "*.{js,jsx}"]);
  });

  it("parses ACTIONS edit blocks with EOF closers", () => {
    const message = [
      "ACTIONS",
      "edit src/app.ts",
      "Old (1-1):",
      "foo",
      "New:",
      "bar",
      "EOF",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("edit");
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.edit).toContain("Old (1-1):");
    expect(toolBlock.params.edit).toContain("New:");
    expect(toolBlock.params.edit).not.toContain("\nEOF");
  });

  it("treats /EOF as an escaped literal inside ACTIONS todo blocks", () => {
    const message = [
      "ACTIONS",
      "todo",
      "[ ] mention EOF explicitly",
      "/EOF",
      "[x] done",
      "EOF",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("todo");
    expect(toolBlock.params.todos).toBe(
      ["[ ] mention EOF explicitly", "EOF", "[x] done"].join("\n"),
    );
  });

  it("streams partial ACTIONS write blocks before END", () => {
    const firstChunk = [
      "ACTIONS",
      "write docs/notes.md",
      "# Notes",
      "hello world",
    ].join("\n");

    const { blocks } = parser.processChunk(firstChunk);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.partial).toBe(true);
    expect(toolBlock.params.path).toBe("docs/notes.md");
    expect(toolBlock.params.content).toBe(
      ["# Notes", "hello world"].join("\n"),
    );
  });

  it("streams partial ACTIONS edit blocks before END", () => {
    const firstChunk = [
      "ACTIONS",
      "edit src/app.ts",
      "Old (1-1):",
      "foo",
      "New:",
      "bar",
    ].join("\n");

    const { blocks } = parser.processChunk(firstChunk);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("edit");
    expect(toolBlock.partial).toBe(true);
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.edit).toContain("Old (1-1):");
    expect(toolBlock.params.edit).toContain("New:");
  });

  it("implicitly closes a trailing ACTIONS write block at END", () => {
    const message = [
      "ACTIONS",
      "write src/utils/hello.ts",
      "export function greet(name: string): string {",
      "  return `Hello, ${name}!`;",
      "}",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.partial).toBeFalsy();
    expect(toolBlock.params.path).toBe("src/utils/hello.ts");
    expect(toolBlock.params.content).toBe(
      [
        "export function greet(name: string): string {",
        "  return `Hello, ${name}!`;",
        "}",
      ].join("\n"),
    );
  });

  it("implicitly closes a trailing ACTIONS edit block at END", () => {
    const message = [
      "ACTIONS",
      "edit src/app.ts",
      "Old (1-1):",
      "foo",
      "New:",
      "bar",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("edit");
    expect(toolBlock.partial).toBeFalsy();
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.edit).toContain("Old (1-1):");
    expect(toolBlock.params.edit).toContain("New:");
  });

  it("parses ACTIONS blocks for list, ask, web, fetch, agent, write, and todo", () => {
    const message = [
      "ACTIONS",
      "list src/core",
      "ask auth flow entrypoint",
      "web latest vitest features 2024",
      "fetch https://example.com/docs",
      "agent analyze the current project structure",
      "write docs/notes.md",
      "# Notes",
      "hello world",
      "EOF",
      "todo",
      "[ ] one",
      "[x] two",
      "EOF",
      "END",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(8);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe("src/core");
    expect(toolBlocks[1].name).toBe("ask");
    expect(toolBlocks[1].params.query).toBe("auth flow entrypoint");
    expect(toolBlocks[2].name).toBe("web");
    expect(toolBlocks[2].params.query).toBe("latest vitest features 2024");
    expect(toolBlocks[3].name).toBe("fetch");
    expect(toolBlocks[3].params.url).toBe("https://example.com/docs");
    expect(toolBlocks[4].name).toBe("agent");
    expect(toolBlocks[4].params.instructions).toBe(
      "analyze the current project structure",
    );
    expect(toolBlocks[5].name).toBe("write");
    expect(toolBlocks[5].params.path).toBe("docs/notes.md");
    expect(toolBlocks[5].params.content).toBe(
      ["# Notes", "hello world"].join("\n"),
    );
    expect(toolBlocks[6].name).toBe("todo");
    expect(toolBlocks[6].params.todos).toBe(["[ ] one", "[x] two"].join("\n"));
    expect(toolBlocks[6].params.todos).not.toContain("\nEOF");
  });

  it("normalizes ACTIONS list commands with an explicit recursive flag", () => {
    const message = ["ACTIONS", "list . --recursive", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.recursive).toBe("true");
  });

  it("normalizes ACTIONS list commands with a trailing boolean recursive shorthand", () => {
    const message = ["ACTIONS", "list src true", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.params.path).toBe("src");
    expect(toolBlock.params.recursive).toBe("true");
  });

  it("treats END as plain text outside ACTIONS blocks", () => {
    const message = ["I am not inside an actions block.", "END"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock.content).toContain("END");
  });

  it("parses bare write blocks at message start as implicit actions on finalize", () => {
    const message = [
      "write new_sample.txt",
      "This is a sample text file generated by Jarvis.",
      "It contains a few lines of placeholder content.",
      "Feel free to edit or replace this text as needed.",
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.params.path).toBe("new_sample.txt");
    expect(toolBlock.params.content).toContain(
      "This is a sample text file generated by Jarvis.",
    );
    expect(toolBlock.params.content).not.toContain("\nEOF");
  });

  it("parses uppercase wrapperless tool batches at message start", () => {
    const message = [
      "READ src/App.tsx 1-40",
      "LIST src/components",
      "GREP auth|login|session in src",
      "AGENT analyze the current project structure",
      "END",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("src/App.tsx");
    expect(toolBlocks[0].params.lineRange).toBe("1-40");
    expect(toolBlocks[1].name).toBe("list");
    expect(toolBlocks[1].params.path).toBe("src/components");
    expect(toolBlocks[2].name).toBe("grep");
    expect(toolBlocks[2].params.path).toBe("src");
    expect(toolBlocks[2].params.query).toEqual(["auth", "login", "session"]);
    expect(toolBlocks[3].name).toBe("agent");
    expect(toolBlocks[3].params.prompt).toBe(
      "analyze the current project structure",
    );
  });

  it("preserves full-word original names for uppercase wrapperless tool batches", () => {
    const message = [
      "LIST src",
      "READ src/App.jsx 1-50",
      "GREP AuthService|useEffect in src",
      "FIND .ts|.jsx in src",
      "SHELL npm run build",
      "END",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(5);
    expect(toolBlocks[0].originalName).toBe("list");
    expect(toolBlocks[1].originalName).toBe("read");
    expect(toolBlocks[2].originalName).toBe("grep");
    expect(toolBlocks[3].originalName).toBe("find");
    expect(toolBlocks[4].originalName).toBe("shell");
  });

  it("parses uppercase wrapperless tool batches after leading prose and thinking", () => {
    const message = [
      "I'll test out a variety of tools to demonstrate their capabilities.",
      "",
      "<thinking>",
      "I should explore the workspace and inspect a few files.",
      "</thinking>",
      "",
      "LIST",
      "FIND .tsx|.jsx|package.json",
      "GREP react|import in src",
      "SHELL pwd",
      "END",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("I'll test out a variety of tools");
    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[1].name).toBe("glob");
    expect(toolBlocks[1].params.path).toBe(".");
    expect(toolBlocks[1].params.pattern).toEqual([
      ".tsx",
      ".jsx",
      "package.json",
    ]);
    expect(toolBlocks[2].name).toBe("grep");
    expect(toolBlocks[3].name).toBe("bash");
  });

  it("defaults pathless uppercase FIND multi-pattern batches to cwd", () => {
    const message = ["FIND .md|.json|.js|.ts", "END"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.pattern).toEqual([".md", ".json", ".js", ".ts"]);
  });

  it("defaults pathless uppercase GREP multi-query batches to cwd", () => {
    const message = ["GREP auth|login|session", "END"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("grep");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.query).toEqual(["auth", "login", "session"]);
  });

  it("streams uppercase wrapperless write blocks from message start", () => {
    const firstChunk = ["WRITE docs/notes.md", "# Notes", "hello world"].join(
      "\n",
    );

    const { blocks } = parser.processChunk(firstChunk);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.partial).toBe(true);
    expect(toolBlock.params.path).toBe("docs/notes.md");
    expect(toolBlock.params.content).toBe(
      ["# Notes", "hello world"].join("\n"),
    );
  });

  it("does not close wrapperless write blocks when content contains uppercase END substrings", () => {
    const firstChunk = [
      "WRITE src/config.ts",
      'export const FRONTEND_URL = "https://example.com"',
      'export const BACKEND_URL = "https://api.example.com"',
    ].join("\n");

    const { blocks } = parser.processChunk(firstChunk);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.partial).toBe(true);
    expect(toolBlock.params.path).toBe("src/config.ts");
    expect(toolBlock.params.content).toContain("FRONTEND_URL");
    expect(toolBlock.params.content).toContain("BACKEND_URL");

    parser.processChunk("\nEND");
    parser.finalizeContentBlocks();

    const finalizedTool = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(finalizedTool.partial).toBe(false);
    expect(finalizedTool.params.content).toContain("FRONTEND_URL");
    expect(finalizedTool.params.content).toContain("BACKEND_URL");
  });

  it("closes wrapperless tool batches when END is glued to trailing prose", () => {
    const message = [
      "LIST",
      "ENDThe system returned a list of files in the current directory.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;
    const textBlocks = blocks.filter((block) => block.type === "text");

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("list");
    expect(toolBlock.partial).toBeFalsy();
    expect(toolBlock.params.path).toBe(".");
    expect(textBlocks).toHaveLength(0);
    expect(parser.hasCompletedToolCall()).toBe(true);
  });

  it("parses glued END suffixes on wrapperless tool arguments", () => {
    const message = ["LIST sambaEND"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe("samba");
    expect(toolBlocks[0].partial).toBe(false);
  });

  it("does not parse bare natural-language tool calls after leading prose", () => {
    const message = [
      "Sure, I'll create that file for you.",
      "write new_sample.txt",
      "hello",
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("write new_sample.txt");
  });

  it("does not parse sentence text that merely mentions uppercase tool names", () => {
    const message = "Let me READ this file and then I'll LIST this directory!";

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("READ this file");
    expect(textBlock.content).toContain("LIST this directory");
  });

  it("parses glued wrapperless list commands like LISTsrc", () => {
    const message = ["LISTsrc", "END"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe("src");
  });

  it("parses glued FIND payloads in wrapperless mode", () => {
    const message = ["FINDagent in zed END"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("glob");
    expect(toolBlocks[0].params.pattern).toBe("agent");
    expect(toolBlocks[0].params.path).toBe("zed");
  });

  it("parses glued LIST payloads in wrapperless mode", () => {
    const message = ["LISTzed/crates/agent/src/ END"].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe("zed/crates/agent/src/");
  });

  it("splits glued 'in' path syntax for find and grep", () => {
    const message = [
      "FIND AuthService|SessionManager insrc",
      "GREP auth|login insrc",
      "END",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("glob");
    expect(toolBlocks[0].params.path).toBe("src");
    expect(toolBlocks[0].params.pattern).toEqual([
      "AuthService",
      "SessionManager",
    ]);
    expect(toolBlocks[1].name).toBe("grep");
    expect(toolBlocks[1].params.path).toBe("src");
    expect(toolBlocks[1].params.query).toEqual(["auth", "login"]);
  });

  it("does not treat legacy single-letter prefixes in prose as unified tools", () => {
    const message = [
      "The project uses Vite for bundling.",
      "package.json contains the npm scripts.",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();
    const blocks = parser.getContentBlocks();
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("Vite");
    expect(textBlock.content).toContain("package.json");
  });

  it("parses tool-fence batches with lowercase commands", () => {
    const message = [
      "```tool",
      "read src/app.ts 1-40",
      "grep auth|login in src",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("src/app.ts");
    expect(toolBlocks[0].params.lineRange).toBe("1-40");
    expect(toolBlocks[1].name).toBe("grep");
    expect(toolBlocks[1].params.path).toBe("src");
    expect(toolBlocks[1].params.query).toEqual(["auth", "login"]);
  });

  it("assigns distinct stable ids to streamed single-line tools before the fence closes", () => {
    const firstChunk = [
      "```tool",
      "read src/app.ts 1-40",
      "grep auth|login in src",
      "",
    ].join("\n");

    const firstPass = parser.processChunk(firstChunk);
    const firstToolBlocks = firstPass.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(firstToolBlocks).toHaveLength(2);
    expect(firstToolBlocks[0].id).not.toBe(firstToolBlocks[1].id);
    expect(firstToolBlocks[0].partial).toBe(true);
    expect(firstToolBlocks[1].partial).toBe(true);

    const firstIds = firstToolBlocks.map((block) => block.id);

    const secondPass = parser.processChunk(["list src", ""].join("\n"));
    const secondToolBlocks = secondPass.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(secondToolBlocks).toHaveLength(3);
    expect(secondToolBlocks.slice(0, 2).map((block) => block.id)).toEqual(
      firstIds,
    );
    expect(secondToolBlocks[2].id).not.toBe(firstIds[0]);
    expect(secondToolBlocks[2].id).not.toBe(firstIds[1]);
    expect(new Set(secondToolBlocks.map((block) => block.id)).size).toBe(3);
  });

  it("parses MCP tool calls inside unified tool fences", () => {
    const message = [
      "```tool",
      "poly-mcp_file_tree",
      '{"path": ".", "max_depth": 3}',
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const mcpBlock = blocks.find(
      (block) => block.type === "mcp_tool_use",
    ) as any;

    expect(mcpBlock).toBeDefined();
    expect(mcpBlock.name).toBe("poly-mcp_file_tree");
    expect(mcpBlock.serverName).toBe("poly-mcp");
    expect(mcpBlock.toolName).toBe("file_tree");
    expect(mcpBlock.arguments).toEqual({ path: ".", max_depth: 3 });
    expect(mcpBlock.partial).toBe(false);
  });

  it("assigns distinct stable ids to streamed MCP tools inside an open fence", () => {
    const firstChunk = [
      "```tool",
      "read src/app.ts 1-10",
      "poly-mcp_file_tree",
      '{ "path": ".", "max_depth": 2 }',
      "",
    ].join("\n");

    const firstPass = parser.processChunk(firstChunk);
    const firstBlocks = firstPass.blocks.filter(
      (block) => block.type === "tool_use" || block.type === "mcp_tool_use",
    ) as any[];

    expect(firstBlocks).toHaveLength(2);
    expect(firstBlocks[0].id).not.toBe(firstBlocks[1].id);
    const firstIds = firstBlocks.map((block) => block.id);

    const secondPass = parser.processChunk(["grep auth in src", ""].join("\n"));
    const secondBlocks = secondPass.blocks.filter(
      (block) => block.type === "tool_use" || block.type === "mcp_tool_use",
    ) as any[];

    expect(secondBlocks).toHaveLength(3);
    expect(secondBlocks.slice(0, 2).map((block) => block.id)).toEqual(firstIds);
    expect(new Set(secondBlocks.map((block) => block.id)).size).toBe(3);
  });

  it("batches multiline MCP JSON bodies with other unified fence tools", () => {
    const message = [
      "```tool",
      "read src/app.ts 1-10",
      "poly-mcp_file_tree",
      "{",
      '  "path": ".",',
      '  "max_depth": 2',
      "}",
      "grep auth|login in src",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const readBlock = blocks.find(
      (block) => block.type === "tool_use" && (block as any).name === "read",
    ) as any;
    const mcpBlock = blocks.find(
      (block) => block.type === "mcp_tool_use",
    ) as any;
    const grepBlock = blocks.find(
      (block) => block.type === "tool_use" && (block as any).name === "grep",
    ) as any;

    expect(readBlock).toBeDefined();
    expect(readBlock.params.path).toBe("src/app.ts");
    expect(readBlock.params.lineRange).toBe("1-10");
    expect(mcpBlock).toBeDefined();
    expect(mcpBlock.arguments).toEqual({ path: ".", max_depth: 2 });
    expect(grepBlock).toBeDefined();
    expect(grepBlock.params.path).toBe("src");
    expect(grepBlock.params.query).toEqual(["auth", "login"]);
  });

  it("splits unquoted natural find patterns by whitespace inside tool fences", () => {
    const message = ["```tool", "find zed agent in .", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.originalName).toBe("find");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.pattern).toEqual(["zed", "agent"]);
  });

  it("keeps quoted natural find patterns intact inside tool fences", () => {
    const message = ["```tool", 'find "zed agent" in .', "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.pattern).toBe("zed agent");
  });

  it("recovers when the final natural find token is glued to in before the path", () => {
    const message = ["```tool", "find zed agentin .", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.originalName).toBe("find");
    expect(toolBlock.params.path).toBe(".");
    expect(toolBlock.params.pattern).toEqual(["zed", "agent"]);
  });

  it("does not leak partial tool-fence opener text while streaming", () => {
    const firstChunk = parser.processChunk("```to");
    const firstTextBlocks = firstChunk.blocks.filter(
      (block) => block.type === "text",
    );
    expect(firstTextBlocks).toHaveLength(0);

    const secondChunk = parser.processChunk("ol\nread src/app.ts\n```");
    const toolBlock = secondChunk.blocks.find(
      (block) => block.type === "tool_use",
    ) as any;
    const textBlocks = secondChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(textBlocks).toHaveLength(0);
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
    expect(toolBlock.params.path).toBe("src/app.ts");
  });

  it("does not close tool fences when write content contains markdown fences", () => {
    const message = [
      "```tool",
      "write docs/example.md",
      "```ts",
      "const x = 1",
      "```",
      "EOF",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.params.path).toBe("docs/example.md");
    expect(toolBlock.params.content).toBe(
      ["```ts", "const x = 1", "```"].join("\n"),
    );
    expect(toolBlock.params.content).not.toContain("\nEOF");
  });

  it("treats /EOF as an escaped literal inside tool-fence write blocks", () => {
    const message = [
      "```tool",
      "write docs/example.md",
      "first line",
      "/EOF",
      "last line",
      "EOF",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.params.content).toBe(
      ["first line", "EOF", "last line"].join("\n"),
    );
  });

  it("closes a tool fence even when prose is glued to the closing fence", () => {
    const message = [
      "```tool",
      "list zed/crates/agent",
      "```<===== specifically here this should stop",
      "```tool",
      "list zed/crates/agent/src",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];
    const textBlocks = blocks.filter((block) => block.type === "text");

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe("zed/crates/agent");
    expect(textBlocks).toHaveLength(0);
  });

  it("parses a tool fence when the first command is glued to the opener", () => {
    const message = ["```toolfind agent in zed", "```"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("glob");
    expect(toolBlock.originalName).toBe("find");
    expect(toolBlock.params.pattern).toBe("agent");
    expect(toolBlock.params.path).toBe("zed");
  });

  it("trims trailing chat text after a completed tool-fence batch", () => {
    const rawMessage = [
      "I'll inspect the file first.",
      "",
      "```tool",
      "read src/app.ts",
      "```",
      "",
      "Here is what the tool returned and what I'll do next.",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      [
        "I'll inspect the file first.",
        "",
        "```tool",
        "read src/app.ts",
        "```",
      ].join("\n"),
    );
  });

  it("trims history at the fence even when prose is glued to the closing fence", () => {
    const rawMessage = [
      "I'll inspect the file first.",
      "",
      "```tool",
      "list zed/crates/agent",
      "```<===== specifically here this should stop",
      "Then the model kept talking.",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      [
        "I'll inspect the file first.",
        "",
        "```tool",
        "list zed/crates/agent",
        "```",
      ].join("\n"),
    );
  });

  it("compacts write bodies in saved history while preserving the tool fence", () => {
    const rawMessage = [
      "```tool",
      "write src/app.ts",
      "const a = 1",
      "const b = 2",
      "EOF",
      "read src/app.ts",
      "```",
    ].join("\n");

    expect(parser.compactMessageForHistory(rawMessage)).toBe(
      [
        "```tool",
        "write src/app.ts",
        "const a = ..... see result for rest of write",
        "EOF",
        "read src/app.ts",
        "```",
      ].join("\n"),
    );
  });

  it("does not treat a stripped write placeholder as executable write content", () => {
    const message = [
      "```tool",
      "write src/app.ts",
      formatWriteHistoryPlaceholderBody(),
      "EOF",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("write");
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.content).toBeUndefined();
  });

  it("compacts edit bodies in saved history while preserving the tool fence", () => {
    const rawMessage = [
      "```tool",
      "edit src/app.ts",
      "search 10-12:",
      "const a = 1",
      "replace:",
      "const a = 2",
      "EOF",
      "```",
    ].join("\n");

    expect(parser.compactMessageForHistory(rawMessage)).toBe(
      [
        "```tool",
        "edit src/app.ts",
        "Content placed in paired result below",
        "Search 10-12:",
        "Replace:",
        "EOF",
        "```",
      ].join("\n"),
    );
  });

  it("preserves multi-block edit headers when compacting saved history", () => {
    const rawMessage = [
      "```tool",
      "edit src/app.ts",
      "Search 10-12:",
      "const a = 1",
      "Replace:",
      "const a = 2",
      "Search 20:",
      "const b = 1",
      "Replace:",
      "const b = 2",
      "EOF",
      "```",
    ].join("\n");

    expect(parser.compactMessageForHistory(rawMessage)).toBe(
      [
        "```tool",
        "edit src/app.ts",
        "Content placed in paired result below",
        "Search 10-12:",
        "Replace:",
        "Search 20:",
        "Replace:",
        "EOF",
        "```",
      ].join("\n"),
    );
  });

  it("does not treat a stripped edit placeholder as executable edit content", () => {
    const message = [
      "```tool",
      "edit src/app.ts",
      redactEditHistoryBody(
        "Search 10-12:\nconst a = 1\nReplace:\nconst a = 2",
      ),
      "EOF",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("edit");
    expect(toolBlock.params.path).toBe("src/app.ts");
    expect(toolBlock.params.edit).toBeUndefined();
  });

  it("stops after the first completed tool fence during streaming", () => {
    const message = [
      "```tool",
      "list",
      "```",
      "```tool",
      "grep bro in .",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(toolBlocks[0].params.path).toBe(".");
    expect(parser.hasCompletedToolCall()).toBe(true);
  });

  it("drops trailing tool-like text after a completed tool fence when finalized", () => {
    const message = ["```tool", "read src/app.ts 1-10", "```", "read z"].join(
      "\n",
    );

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("src/app.ts");
    expect(toolBlocks[0].params.lineRange).toBe("1-10");
  });

  it("ignores later streamed chunks after the first completed tool fence", () => {
    const firstChunk = ["```tool", "read src/app.ts 1-10", "```"].join("\n");

    parser.processChunk(firstChunk);
    const secondChunk = parser.processChunk("\nread z");
    const toolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("read");
    expect(toolBlocks[0].params.path).toBe("src/app.ts");
    expect(toolBlocks[0].params.lineRange).toBe("1-10");
  });

  it("parses bare @ inline tools without a tool fence", () => {
    const message = [
      '@read: "src/app.ts:1-10"',
      '@bash: "apps/web:npm run build"',
      '@grep: "include=*.ts,*.tsx|src:authservice|pizza|text"',
      '@find: "src:*.ts,*.tsx"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks[0]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        lineRange: "1-10",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm run build",
        cwd: "apps/web",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "grep",
      partial: false,
      nativeArgs: {
        query: ["authservice", "pizza", "text"],
        path: "src",
        include: "*.ts,*.tsx",
      },
    });
    expect(toolBlocks[3]).toMatchObject({
      name: "glob",
      partial: false,
      nativeArgs: {
        pattern: ["*.ts", "*.tsx"],
        path: "src",
      },
    });
  });

  it("parses scope-first inline syntax inside tool fences", () => {
    const message = [
      "```tool",
      "read src/app.ts:1-10",
      "grep include=*.ts,*.tsx|src:AuthService|SessionManager",
      "find src:*.ts,*.tsx",
      "bash apps/web:npm run build",
      "```",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks[0]).toMatchObject({
      name: "read",
      nativeArgs: {
        files: [
          {
            path: "src/app.ts",
            lineRanges: [{ start: 1, end: 10 }],
          },
        ],
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      nativeArgs: {
        query: ["AuthService", "SessionManager"],
        include: "*.ts,*.tsx",
        path: "src",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "glob",
      nativeArgs: {
        pattern: ["*.ts", "*.tsx"],
        path: "src",
      },
    });
    expect(toolBlocks[3]).toMatchObject({
      name: "bash",
      params: {
        command: "npm run build",
        cwd: "apps/web",
      },
    });
  });

  it("parses compact bare @desktop calls into computer_action tool uses", () => {
    const message = [
      '@desktop: "get_screenshot"',
      '@desktop: "mouse_move:450,300"',
      '@desktop: "left_click:450,300"',
      '@desktop: "double_click:450,300"',
      '@desktop: "key:Cmd+K"',
      '@desktop: "type:hello world"',
      '@desktop: "scroll:450,300:down:500"',
      '@desktop: "get_cursor_position"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(8);
    expect(toolBlocks).toMatchObject([
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "get_screenshot",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "mouse_move",
          coordinate: "450,300",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "left_click",
          coordinate: "450,300",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "double_click",
          coordinate: "450,300",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "key",
          text: "Cmd+K",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "type",
          text: "hello world",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "scroll",
          coordinate: "450,300",
          text: "down:500",
        },
      },
      {
        name: "computer_action",
        partial: false,
        params: {
          action: "get_cursor_position",
        },
      },
    ]);
  });

  it("continues a streamed bare @ batch when the next chunk starts another tool", () => {
    const firstChunk = parser.processChunk('@list: "."\n');
    const firstToolBlocks = firstChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(firstToolBlocks).toHaveLength(1);
    expect(firstToolBlocks[0]).toMatchObject({
      name: "list",
      partial: false,
      params: {
        path: ".",
      },
    });

    const secondChunk = parser.processChunk(
      '@read: "src/core/assistant-message/UnifiedToolCallParser.ts:1-10"',
    );
    const secondToolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];
    const secondTextBlocks = secondChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(secondToolBlocks).toHaveLength(2);
    expect(secondToolBlocks[0].name).toBe("list");
    expect(secondToolBlocks[1]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/core/assistant-message/UnifiedToolCallParser.ts",
        lineRange: "1-10",
      },
    });
    expect(secondTextBlocks).toHaveLength(0);
    expect(parser.hasCompletedToolCall()).toBe(true);
  });

  it("continues a streamed bare @ batch when later tools arrive across partial @read headers", () => {
    const firstChunk = parser.processChunk('@read: "sample.txt:1-2"\n');
    const firstToolBlocks = firstChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(firstToolBlocks).toHaveLength(1);
    expect(firstToolBlocks[0]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "sample.txt",
        lineRange: "1-2",
      },
    });

    const secondChunk = parser.processChunk("\n@re");
    const secondToolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];
    expect(secondToolBlocks).toHaveLength(1);

    parser.processChunk('ad: "sample.txt:3-4"\n@re');
    const finalChunk = parser.processChunk('ad: "sample.txt:8-10"');
    const finalToolBlocks = finalChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(finalToolBlocks).toHaveLength(3);
    expect(finalToolBlocks.map((block) => block.params.lineRange)).toEqual([
      "1-2",
      "3-4",
      "8-10",
    ]);
    expect(finalToolBlocks.map((block) => block.params.path)).toEqual([
      "sample.txt",
      "sample.txt",
      "sample.txt",
    ]);
  });

  it("parses three bare @read calls in one turn", () => {
    const message = [
      '@read: "sample.txt:1-2"',
      '@read: "sample.txt:3-4"',
      '@read: "sample.txt:8-10"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(3);
    expect(toolBlocks).toMatchObject([
      {
        name: "read",
        partial: false,
        params: {
          path: "sample.txt",
          lineRange: "1-2",
        },
      },
      {
        name: "read",
        partial: false,
        params: {
          path: "sample.txt",
          lineRange: "3-4",
        },
      },
      {
        name: "read",
        partial: false,
        params: {
          path: "sample.txt",
          lineRange: "8-10",
        },
      },
    ]);
  });

  it("parses bare @read line ranges passed as a second quoted argument", () => {
    const message = '@read: "src/app.ts" "11-20"';

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        lineRange: "11-20",
      },
    });
  });

  it("parses bare @read line ranges in a single quoted path-plus-spec argument", () => {
    const message = '@read: "game.py 40-60,80-90,T20"';

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "game.py",
        lineRange: "40-60, 80-90",
        tail: "20",
      },
      nativeArgs: {
        files: [
          {
            path: "game.py",
            lineRanges: [
              { start: 40, end: 60 },
              { start: 80, end: 90 },
            ],
            tail: 20,
          },
        ],
      },
    });
  });

  it("parses bare @read line ranges in a bracketed path suffix", () => {
    const message = '@read: "game.py[40-60,80-90,T20]"';

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "game.py",
        lineRange: "40-60, 80-90",
        tail: "20",
      },
      nativeArgs: {
        files: [
          {
            path: "game.py",
            lineRanges: [
              { start: 40, end: 60 },
              { start: 80, end: 90 },
            ],
            tail: 20,
          },
        ],
      },
    });
  });

  it("parses bare @read multiple line ranges in a single quoted colon-suffix argument", () => {
    const message = '@read: "src/core/task/LuxurySpa.ts:868-885,1130-1145"';

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/core/task/LuxurySpa.ts",
        lineRange: "868-885, 1130-1145",
      },
      nativeArgs: {
        files: [
          {
            path: "src/core/task/LuxurySpa.ts",
            lineRanges: [
              { start: 868, end: 885 },
              { start: 1130, end: 1145 },
            ],
          },
        ],
      },
    });
  });

  it("parses bare @read head and tail suffixes inline", () => {
    const message = ['@read: "src/app.ts:H20"', '@read: "src/app.ts:T15"'].join(
      "\n",
    );

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        head: "20",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        tail: "15",
      },
    });
  });

  it("parses bare @read head and tail in a bracketed path suffix", () => {
    const message = [
      '@read: "src/app.ts[H20]"',
      '@read: "src/app.ts[T15]"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        head: "20",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "read",
      partial: false,
      params: {
        path: "src/app.ts",
        tail: "15",
      },
    });
  });

  it("parses bare @find, @web, @fetch, and @ask into structured params", () => {
    const message = [
      '@find: "Button.tsx" "webview-ui/src"',
      '@web: "react compiler useEffectEvent"',
      '@fetch: "https://example.com/docs"',
      '@ask: "which package owns this parser?"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(4);
    expect(toolBlocks[0]).toMatchObject({
      name: "glob",
      originalName: "find",
      partial: false,
      params: {
        pattern: "Button.tsx",
        path: "webview-ui/src",
      },
      nativeArgs: {
        pattern: "Button.tsx",
        path: "webview-ui/src",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "web",
      partial: false,
      params: {
        query: "react compiler useEffectEvent",
      },
      nativeArgs: {
        query: "react compiler useEffectEvent",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "fetch",
      partial: false,
      params: {
        url: "https://example.com/docs",
      },
      nativeArgs: {
        url: "https://example.com/docs",
      },
    });
    expect(toolBlocks[3]).toMatchObject({
      name: "ask",
      partial: false,
      params: {
        query: "which package owns this parser?",
      },
      nativeArgs: {
        query: "which package owns this parser?",
      },
    });
  });

  it("parses bare @bash and @grep directly into structured params", () => {
    const message = [
      '@bash: "npm test" "packages/app"',
      '@grep: "AuthService|SessionManager" "src"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
        cwd: "packages/app",
      },
      nativeArgs: {
        command: "npm test",
        cwd: "packages/app",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      partial: false,
      params: {
        path: "src",
      },
      nativeArgs: {
        query: ["AuthService", "SessionManager"],
        path: "src",
      },
    });
    expect(toolBlocks[1].params.query).toEqual([
      "AuthService",
      "SessionManager",
    ]);
  });

  it("parses @bash and @grep without a trailing colon", () => {
    const message = [
      '@bash "npm test" "packages/app"',
      '@grep "AuthService|SessionManager" "include=*.ts,*.tsx"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
        cwd: "packages/app",
      },
      nativeArgs: {
        command: "npm test",
        cwd: "packages/app",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      partial: false,
      params: {
        path: ".",
        include: "*.ts,*.tsx",
      },
      nativeArgs: {
        query: ["AuthService", "SessionManager"],
        path: ".",
        include: "*.ts,*.tsx",
      },
    });
    expect(toolBlocks[1].params.query).toEqual([
      "AuthService",
      "SessionManager",
    ]);
  });

  it("parses bare @grep include shorthand as a file filter", () => {
    const message = '@grep: "AuthService|SessionManager" "include=*.ts,*.tsx"';

    const { blocks } = parser.processChunk(message);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "grep",
      partial: false,
      params: {
        path: ".",
        include: "*.ts,*.tsx",
      },
      nativeArgs: {
        query: ["AuthService", "SessionManager"],
        path: ".",
        include: "*.ts,*.tsx",
      },
    });
    expect(toolBlock.params.query).toEqual(["AuthService", "SessionManager"]);
  });

  it("parses named path arguments for bare @find, @grep, and @bash", () => {
    const message = [
      '@find: "tool_test_a.txt|nested.txt|data.json" path:"."',
      '@grep: "alpha|search-target|nested" path:"."',
      '@bash: "npm test" path:"apps/web"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(3);
    expect(toolBlocks[0]).toMatchObject({
      name: "glob",
      originalName: "find",
      params: {
        pattern: ["tool_test_a.txt", "nested.txt", "data.json"],
        path: ".",
      },
      nativeArgs: {
        pattern: ["tool_test_a.txt", "nested.txt", "data.json"],
        path: ".",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      params: {
        path: ".",
      },
      nativeArgs: {
        query: ["alpha", "search-target", "nested"],
        path: ".",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "bash",
      params: {
        command: "npm test",
        cwd: "apps/web",
      },
      nativeArgs: {
        command: "npm test",
        cwd: "apps/web",
      },
    });
  });

  it('parses bare @find, @grep, and @bash using in "path" syntax', () => {
    const message = [
      '@find: "tool_test_a.txt|nested.txt|data.json" in "."',
      '@grep: "alpha|search-target|nested" in "."',
      '@bash: "npm test" in "apps/web"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(3);
    expect(toolBlocks[0]).toMatchObject({
      name: "glob",
      originalName: "find",
      params: {
        pattern: ["tool_test_a.txt", "nested.txt", "data.json"],
        path: ".",
      },
      nativeArgs: {
        pattern: ["tool_test_a.txt", "nested.txt", "data.json"],
        path: ".",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "grep",
      params: {
        path: ".",
      },
      nativeArgs: {
        query: ["alpha", "search-target", "nested"],
        path: ".",
      },
    });
    expect(toolBlocks[2]).toMatchObject({
      name: "bash",
      params: {
        command: "npm test",
        cwd: "apps/web",
      },
      nativeArgs: {
        command: "npm test",
        cwd: "apps/web",
      },
    });
  });

  it("does not execute empty bare @bash or @grep headers", () => {
    const message = ["@bash:", "@grep:"].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content ?? "").not.toContain("@bash:");
    expect(textBlock?.content ?? "").not.toContain("@grep:");
    expect(parser.hasCompletedToolCall()).toBe(false);
  });

  it("does not leak partial bare @tool prefixes while streaming", () => {
    const firstChunk = parser.processChunk('@bash: "echo hello');
    const firstTextBlock = firstChunk.blocks.find(
      (block) => block.type === "text",
    ) as any;

    expect(firstTextBlock?.content ?? "").not.toContain("@bash:");

    const secondChunk = parser.processChunk(' world"');
    const toolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "echo hello world",
      },
    });
  });

  it("does not leak partial bare @tool prefixes without a colon while streaming", () => {
    const firstChunk = parser.processChunk(
      'Right.\n@grep "historyView|HistoryDropdown|topview" "',
    );
    const firstTextBlock = firstChunk.blocks.find(
      (block) => block.type === "text",
    ) as any;

    expect(firstTextBlock?.content ?? "").toContain("Right.");
    expect(firstTextBlock?.content ?? "").not.toContain("@grep ");

    const secondChunk = parser.processChunk('include=*.ts,*.tsx,*.json"');
    const toolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "grep",
      partial: false,
      params: {
        path: ".",
        include: "*.ts,*.tsx,*.json",
      },
      nativeArgs: {
        query: ["historyView", "HistoryDropdown", "topview"],
        path: ".",
        include: "*.ts,*.tsx,*.json",
      },
    });
  });

  it("does not leak a bare @ while a tool header is still streaming", () => {
    const firstChunk = parser.processChunk("@");
    const firstTextBlocks = firstChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(firstTextBlocks).toHaveLength(0);

    const secondChunk = parser.processChunk('write: "sample.txt"');
    const toolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: true,
      params: {
        path: "sample.txt",
      },
    });
  });

  it("does not leak partial bare @tool command names while streaming", () => {
    const firstChunk = parser.processChunk("@wr");
    const firstTextBlocks = firstChunk.blocks.filter(
      (block) => block.type === "text",
    );

    expect(firstTextBlocks).toHaveLength(0);

    const secondChunk = parser.processChunk('ite: "sample.txt"');
    const toolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: true,
      params: {
        path: "sample.txt",
      },
    });
  });

  it("does not treat bare @tool mentions without a colon as tool calls", () => {
    const message = [
      "I need to check what's in this folder. Let me use the shell to list the contents.",
      "",
      "@bash",
      "",
      "I should probably look at the workspace root.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock?.content).toContain("@bash");
    expect(parser.hasCompletedToolCall()).toBe(false);
  });

  it("recovers bare @ tools even when prose appears before them", () => {
    const message = [
      "I'll check what's in this folder to see what we're working with.",
      "",
      '@list: "."',
      "",
      "oh okay, so you need to fix this then",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(textBlock?.content).toContain("I'll check what's in this folder");
    expect(textBlock?.content).not.toContain("oh okay");
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "list",
      partial: false,
      params: {
        path: ".",
      },
    });
    expect(parser.hasCompletedToolCall()).toBe(true);
  });

  it("parses the first bare @tool when it appears inline after prose", () => {
    const message =
      'Empty workspace - perfect for a fresh React app. @bash: "npm create vite@latest . -- --template react-ts" ".."';

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(textBlock?.content).toContain(
      "Empty workspace - perfect for a fresh React app.",
    );
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm create vite@latest . -- --template react-ts",
        cwd: "..",
      },
      nativeArgs: {
        command: "npm create vite@latest . -- --template react-ts",
        cwd: "..",
      },
    });
  });

  it("parses the first bare @tool when it is glued directly to prose", () => {
    const message =
      'Empty workspace - perfect for a fresh React app.@bash: "npm create vite@latest . -- --template react-ts" ".."';

    const { blocks } = parser.processChunk(message);
    const textBlock = blocks.find((block) => block.type === "text") as any;
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(textBlock?.content).toContain(
      "Empty workspace - perfect for a fresh React app.",
    );
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm create vite@latest . -- --template react-ts",
        cwd: "..",
      },
    });
  });

  it("does not parse a later inline bare @tool after a tool has already been parsed", () => {
    const message = ['@list: "."', 'Then @bash: "pwd"'].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("list");
    expect(parser.trimRawMessageAfterLastCompletedTool(message)).toBe(
      '@list: "."',
    );
  });

  it("trims trailing prose after a completed bare @ batch", () => {
    const rawMessage = [
      "I'll check what's in this folder to see what we're working with.",
      "",
      '@list: "."',
      "",
      "oh okay, so you need to fix this then",
    ].join("\n");

    expect(parser.trimRawMessageAfterLastCompletedTool(rawMessage)).toBe(
      [
        "I'll check what's in this folder to see what we're working with.",
        "",
        '@list: "."',
      ].join("\n"),
    );
  });

  it("ignores later streamed chunks after the first completed bare @ batch", () => {
    const firstChunk = parser.processChunk('@bash: "echo hello"');
    const firstToolBlocks = firstChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(firstToolBlocks).toHaveLength(1);
    expect(firstToolBlocks[0].name).toBe("bash");

    const secondChunk = parser.processChunk(
      "\nThere you go. Terminal's responding. What's next?",
    );
    const secondToolBlocks = secondChunk.blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];
    const secondTextBlocks = secondChunk.blocks.filter(
      (block) => block.type === "text",
    ) as any[];

    expect(secondToolBlocks).toHaveLength(1);
    expect(secondTextBlocks).toHaveLength(0);
    expect(parser.hasCompletedToolCall()).toBe(true);
  });

  it("parses bare @edit blocks and closes them at the next top-level @tool line", () => {
    const message = [
      '@edit: "src/app.ts"',
      "oldText:1-1:",
      'console.log("hello")',
      "newText:",
      'console.log("goodbye")',
      '@bash: "npm test"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0].name).toBe("edit");
    expect(toolBlocks[0].params.path).toBe("src/app.ts");
    expect(toolBlocks[0].partial).toBe(false);
    expect(toolBlocks[0].nativeArgs.edits).toEqual([
      {
        oldText: 'console.log("hello")',
        newText: 'console.log("goodbye")',
        start_line: 1,
        end_line: 1,
      },
    ]);
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
      },
    });
  });

  it("parses bare @ MCP tool blocks with multiline JSON bodies", () => {
    const message = [
      "@poly-mcp_file_tree:",
      '{"path": ".", "max_depth": 3}',
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const mcpBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "mcp_tool_use") as any[];

    expect(mcpBlocks).toHaveLength(1);
    expect(mcpBlocks[0]).toMatchObject({
      name: "poly-mcp_file_tree",
      serverName: "poly-mcp",
      toolName: "file_tree",
      arguments: {
        path: ".",
        max_depth: 3,
      },
      partial: false,
    });
  });

  it("parses sequential bare @ MCP tool blocks using the next top-level @tool as the boundary", () => {
    const message = [
      "@puppeteer_puppeteer_navigate:",
      '{"url": "https://example.com"}',
      "",
      "@puppeteer_puppeteer_screenshot:",
      '{"name": "test_screenshot", "width": 1280, "height": 720}',
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const mcpBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "mcp_tool_use") as any[];

    expect(mcpBlocks).toHaveLength(2);
    expect(mcpBlocks[0]).toMatchObject({
      name: "puppeteer_puppeteer_navigate",
      serverName: "puppeteer",
      toolName: "puppeteer_navigate",
      arguments: {
        url: "https://example.com",
      },
      partial: false,
    });
    expect(mcpBlocks[1]).toMatchObject({
      name: "puppeteer_puppeteer_screenshot",
      serverName: "puppeteer",
      toolName: "puppeteer_screenshot",
      arguments: {
        name: "test_screenshot",
        width: 1280,
        height: 720,
      },
      partial: false,
    });
  });

  it("parses a bare @write block when the response is finalized", () => {
    const message = ['@write: "notes.txt"', "hello", 'print("world")'].join(
      "\n",
    );

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: 'hello\nprint("world")',
        contentCloser: "ETXT",
      },
    });
  });

  it("parses bare @write blocks with EOF closers before the next @tool line", () => {
    const message = [
      '@write: "notes.txt"',
      "hello",
      'print("world")',
      "EOF",
      '@bash: "pwd"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: 'hello\nprint("world")',
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "pwd",
      },
    });
  });

  it("parses bare @write blocks with ETXT closers before the next @tool line", () => {
    const message = [
      '@write: "notes.txt"',
      "hello",
      'print("world")',
      "ETXT",
      '@bash: "pwd"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: 'hello\nprint("world")',
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "pwd",
      },
    });
  });

  it("parses compact @write strings using the primary pipe separator", () => {
    const message = '@write: "notes.txt|hello\\nprint(\\"world\\")\\n"';

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: 'hello\nprint("world")\n',
      },
    });
  });

  it("parses compact @write strings using colon as a fallback separator", () => {
    const message = '@write: "notes.txt:hello\\nprint(\\"world\\")\\n"';

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: 'hello\nprint("world")\n',
      },
    });
  });

  it("parses compact @write strings when the pipe separator is over-escaped", () => {
    const message =
      '@write: "sample_game.html\\\\|<!DOCTYPE html>\\n<html lang=\\"en\\">\\n"';

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "sample_game.html",
        content: '<!DOCTYPE html>\n<html lang="en">\n',
      },
    });
    expect(toolBlocks[0].params.path).not.toContain("<!DOCTYPE html>");
  });

  it("parses multiline quoted compact @write strings with actual newlines in the content", () => {
    const message = [
      '@write: "twenty_lines.txt|This is line 1.',
      "This is line 2.",
      "This is line 3.",
      'This is line 4."',
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "twenty_lines.txt",
        content: ["This is line 1.", "This is line 2.", "This is line 3.", "This is line 4."].join("\n"),
      },
    });
  });

  it("closes multiline quoted compact @write strings before trailing leaked think tags", () => {
    const message = [
      '@write: "dodge-game.html|<html>',
      "<body>Hello</body>",
      '</html>"</think_never_used_51bce0c785ca2f68081bfa7d91973934>',
      "Done. This should not be written.",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "dodge-game.html",
        content: ["<html>", "<body>Hello</body>", "</html>"].join("\n"),
      },
    });
    expect(toolBlocks[0].params.content).not.toContain("think_never_used");
    expect(toolBlocks[0].params.content).not.toContain("Done. This should not be written.");
  });

  it("ignores trailing same-line garbage after a valid compact @write payload closes", () => {
    const message =
      '@write: "snake-game.html|<html>\\n<body></body>\\n</html>"</think_never_used_51bce0c785ca2f68081bfa7d91973934>';

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "snake-game.html",
        content: ["<html>", "<body></body>", "</html>"].join("\n"),
      },
    });
    expect(toolBlocks[0].params.content).not.toContain("think_never_used");
  });

  it("closes multiline quoted compact @write strings when the terminator quote is on its own line", () => {
    const message = [
      '@write: "snake-game.html|<html>',
      "<body>",
      "</body>",
      "</html>",
      '"',
      "",
      "---",
      "",
      "Game created successfully.",
      "Just open `snake-game.html` directly in any modern browser.",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0].name).toBe("write");
    expect(toolBlocks[0].partial).toBe(false);
    expect(toolBlocks[0].params.path).toBe("snake-game.html");
    expect(toolBlocks[0].params.content.trimEnd()).toBe(
      ["<html>", "<body>", "</body>", "</html>"].join("\n"),
    );
    expect(toolBlocks[0].params.content).not.toContain("Game created successfully.");
    expect(toolBlocks[0].params.content).not.toContain("Just open `snake-game.html`");
  });

  it("streams compact quoted @write blocks without promoting content lines into the path", () => {
    const firstChunk = [
      '@write: "sample20lines.txt|Line 1: Coffee steam curls against cold window glass',
      "Line 2: Streetlights fade into morning rain",
    ].join("\n");

    const { blocks } = parser.processChunk(firstChunk);
    const toolBlock = blocks.find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "write",
      partial: true,
      params: {
        path: "sample20lines.txt",
        content: [
          "Line 1: Coffee steam curls against cold window glass",
          "Line 2: Streetlights fade into morning rain",
        ].join("\n"),
      },
    });

    expect(toolBlock.params.path).not.toContain("Line 2:");
  });

  it("parses inline escaped @edit block strings using the primary arrow separator", () => {
    const message = '@edit: "src/app.ts" "1-1|const a = 1→const a = 2\\n" "3|const c = 1→const c = 2"';

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "src/app.ts",
      },
      nativeArgs: {
        path: "src/app.ts",
        edits: [
          {
            oldText: "const a = 1",
            newText: "const a = 2",
            start_line: 1,
            end_line: 1,
          },
          {
            oldText: "const c = 1",
            newText: "const c = 2",
            start_line: 3,
            end_line: 3,
          },
        ],
      },
    });
  });

  it("parses multiline quoted @edit body blocks and preserves escaped literal arrows", () => {
    const message = [
      '@edit: "src/app.ts"',
      '"1-1|left \\→ right→done \\→ now"',
      '"3|before→after"',
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlocks = parser
      .getContentBlocks()
      .filter((block) => block.type === "tool_use") as any[];

    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "src/app.ts",
      },
      nativeArgs: {
        path: "src/app.ts",
        edits: [
          {
            oldText: "left → right",
            newText: "done → now",
            start_line: 1,
            end_line: 1,
          },
          {
            oldText: "before",
            newText: "after",
            start_line: 3,
            end_line: 3,
          },
        ],
      },
    });
  });

  it("streams compact quoted @edit blocks as soon as each line closes", () => {
    const firstChunk = [
      '@edit: "sample.txt"',
      '"12-13|before one\\nbefore two→after one\\nafter two"',
      '"21|partial old→partial ne',
    ].join("\n");

    const { blocks } = parser.processChunk(firstChunk);
    const partialTool = blocks.find((block) => block.type === "tool_use") as any;

    expect(partialTool).toMatchObject({
      name: "edit",
      partial: true,
      params: {
        path: "sample.txt",
      },
      nativeArgs: {
        path: "sample.txt",
        edits: [
          {
            oldText: "before one\nbefore two",
            newText: "after one\nafter two",
            start_line: 12,
            end_line: 13,
          },
        ],
      },
    });

    parser.processChunk('w"');
    parser.finalizeContentBlocks();

    const finalizedTool = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(finalizedTool).toMatchObject({
      name: "edit",
      partial: false,
      nativeArgs: {
        edits: [
          {
            oldText: "before one\nbefore two",
            newText: "after one\nafter two",
            start_line: 12,
            end_line: 13,
          },
          {
            oldText: "partial old",
            newText: "partial new",
            start_line: 21,
            end_line: 21,
          },
        ],
      },
    });
  });

  it("treats /EOF as an escaped literal inside bare @write blocks", () => {
    const message = [
      '@write: "notes.txt"',
      "first line",
      "/EOF",
      "last line",
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: ["first line", "EOF", "last line"].join("\n"),
      },
    });
  });

  it("treats /ETXT as an escaped literal inside bare @write blocks", () => {
    const message = [
      '@write: "notes.txt"',
      "first line",
      "/ETXT",
      "last line",
      "ETXT",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: ["first line", "ETXT", "last line"].join("\n"),
      },
    });
  });

  it("treats /@read as an escaped literal inside bare @write blocks", () => {
    const message = [
      '@write: "notes.txt"',
      "first line",
      '/@read: "src/app.ts:1-5"',
      "last line",
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: ["first line", '@read: "src/app.ts:1-5"', "last line"].join(
          "\n",
        ),
      },
    });
  });

  it("treats /@bash as an escaped literal inside bare @edit blocks", () => {
    const message = [
      '@edit: "sample.txt"',
      "oldText 1-1:",
      "alpha",
      "newText:",
      "beta",
      '/@bash: "npm test"',
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
      },
      nativeArgs: {
        edits: [
          {
            oldText: "alpha",
            newText: ["beta", '@bash: "npm test"'].join("\n"),
            start_line: 1,
            end_line: 1,
          },
        ],
      },
    });
  });

  it("treats escaped MCP @tool headers as literals inside bare @write blocks", () => {
    const message = [
      '@write: "notes.txt"',
      '/@poly-mcp_file_tree: {"path":"src"}',
      "EOF",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "write",
      partial: false,
      params: {
        path: "notes.txt",
        content: '@poly-mcp_file_tree: {"path":"src"}',
      },
    });
  });

  it("unescapes /@read in plain text without executing it", () => {
    const message = [
      "Use this literal example in chat:",
      '/@read: "src/app.ts:1-5"',
      "Do not run it.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain('@read: "src/app.ts:1-5"');
    expect(textBlock.content).not.toContain('/@read: "src/app.ts:1-5"');
  });

  it("unescapes /EOF in plain text without treating it as a closer", () => {
    const message = [
      "Literal protocol docs:",
      "/EOF",
      "That line should render as EOF.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("\nEOF\n");
    expect(textBlock.content).not.toContain("/EOF");
  });

  it("parses a finalized bare @edit block into executable native edit args", () => {
    const message = [
      '@edit: "sample.txt"',
      "oldText 1-1:",
      "hello",
      "newText:",
      "goodbye",
    ].join("\n");

    parser.processChunk(message);
    parser.finalizeContentBlocks();

    const toolBlock = parser
      .getContentBlocks()
      .find((block) => block.type === "tool_use") as any;

    expect(toolBlock).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
        edit: "oldText 1-1:\nhello\nnewText:\ngoodbye",
      },
      nativeArgs: {
        path: "sample.txt",
        edit: "oldText 1-1:\nhello\nnewText:\ngoodbye",
        edits: [
          {
            oldText: "hello",
            newText: "goodbye",
            start_line: 1,
            end_line: 1,
          },
        ],
      },
    });
  });

  it("parses bare @edit blocks with EOF closers before the next @tool line", () => {
    const message = [
      '@edit: "sample.txt"',
      "oldText 1-1:",
      "hello",
      "newText:",
      "goodbye",
      "EOF",
      '@bash: "npm test"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
        edit: "oldText 1-1:\nhello\nnewText:\ngoodbye",
        contentCloser: "ETXT",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
      },
    });
  });

  it("parses bare @edit blocks with ETXT closers before the next @tool line", () => {
    const message = [
      '@edit: "sample.txt"',
      "oldText 1-1:",
      "hello",
      "newText:",
      "goodbye",
      "ETXT",
      '@bash: "npm test"',
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter(
      (block) => block.type === "tool_use",
    ) as any[];

    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({
      name: "edit",
      partial: false,
      params: {
        path: "sample.txt",
        edit: "oldText 1-1:\nhello\nnewText:\ngoodbye",
      },
    });
    expect(toolBlocks[1]).toMatchObject({
      name: "bash",
      partial: false,
      params: {
        command: "npm test",
      },
    });
  });

  it("unescapes /ETXT in plain text without treating it as a closer", () => {
    const message = [
      "Literal protocol docs:",
      "/ETXT",
      "That line should render as ETXT.",
    ].join("\n");

    const { blocks } = parser.processChunk(message);
    const toolBlocks = blocks.filter((block) => block.type === "tool_use");
    const textBlock = blocks.find((block) => block.type === "text") as any;

    expect(toolBlocks).toHaveLength(0);
    expect(textBlock).toBeDefined();
    expect(textBlock.content).toContain("\nETXT\n");
    expect(textBlock.content).not.toContain("/ETXT");
  });

  it("drops bare @edit and @write blocks when finalized without any body", () => {
    const editMessage = '@edit: "src/app.ts"';
    parser.processChunk(editMessage);
    parser.finalizeContentBlocks();
    const editBlocks = parser.getContentBlocks();

    expect(
      editBlocks.filter((block) => block.type === "tool_use"),
    ).toHaveLength(0);

    parser.reset();

    const writeMessage = '@write: "notes.txt"';
    parser.processChunk(writeMessage);
    parser.finalizeContentBlocks();
    const writeBlocks = parser.getContentBlocks();

    expect(
      writeBlocks.filter((block) => block.type === "tool_use"),
    ).toHaveLength(0);
    expect(parser.hasCompletedToolCall()).toBe(false);
  });
});
