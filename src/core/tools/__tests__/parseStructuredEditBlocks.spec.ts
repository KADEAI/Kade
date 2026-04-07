import { describe, expect, it } from "vitest";
import {
  parseLineRangeFromString,
  parseStructuredEditBlocks,
  stripRedundantLineRangePipePrefix,
} from "../EditTool";

describe("parseStructuredEditBlocks compact DSL", () => {
  it("strips duplicated lineRange| prefix after header range", () => {
    const blocks = parseStructuredEditBlocks("108-110|108-110|foo->bar");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].oldText).toBe("foo");
    expect(blocks[0].newText).toBe("bar");
    expect(blocks[0].start_line).toBe(108);
    expect(blocks[0].end_line).toBe(110);
  });

  it("parses IDE gutter digit→ before lineRange", () => {
    const blocks = parseStructuredEditBlocks("110→108-110|a->b");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start_line).toBe(108);
    expect(blocks[0].end_line).toBe(110);
    expect(blocks[0].oldText).toBe("a");
    expect(blocks[0].newText).toBe("b");
  });

  it("handles single-line range with redundant prefix", () => {
    const blocks = parseStructuredEditBlocks("42|42|x->y");
    expect(blocks[0].oldText).toBe("x");
    expect(blocks[0].newText).toBe("y");
    expect(blocks[0].start_line).toBe(42);
    expect(blocks[0].end_line).toBe(42);
  });

  it("prefers structured otxt/ntxt blocks over compact arrow parsing when a quoted payload contains escaped newlines", () => {
    const blocks = parseStructuredEditBlocks(
      '"otxt[44-51]: <body>\\n    <a href=\\"#\\" class=\\"btn\\">Click Me</a>\\n</body>\\nntxt: <body>\\n    <a href=\\"#\\" class=\\"btn\\">Get Started →</a>\\n</body>"',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].start_line).toBe(44);
    expect(blocks[0].end_line).toBe(51);
    expect(blocks[0].oldText).toBe(
      '<body>\n    <a href="#" class="btn">Click Me</a>\n</body>',
    );
    expect(blocks[0].newText).toBe(
      '<body>\n    <a href="#" class="btn">Get Started →</a>\n</body>',
    );
  });

  it("accepts canonical old/new structured edit headers", () => {
    const blocks = parseStructuredEditBlocks(`old[44-51]: <body>
    <a href="#" class="btn">Click Me</a>
</body>
new: <body>
    <a href="#" class="btn">Get Started →</a>
</body>`);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].start_line).toBe(44);
    expect(blocks[0].end_line).toBe(51);
    expect(blocks[0].oldText).toBe(
      '<body>\n    <a href="#" class="btn">Click Me</a>\n</body>',
    );
    expect(blocks[0].newText).toBe(
      '<body>\n    <a href="#" class="btn">Get Started →</a>\n</body>',
    );
  });
});

describe("parseLineRangeFromString", () => {
  it("parses single line and span", () => {
    expect(parseLineRangeFromString("12")).toEqual({ start: 12, end: 12 });
    expect(parseLineRangeFromString(" 10 - 20 ")).toEqual({
      start: 10,
      end: 20,
    });
  });
});

describe("stripRedundantLineRangePipePrefix", () => {
  it("removes only matching range prefix", () => {
    expect(
      stripRedundantLineRangePipePrefix("132-134|if (x) {}", 132, 134),
    ).toBe("if (x) {}");
    expect(stripRedundantLineRangePipePrefix("  5  |  y  ", 5, 5)).toBe("  y  ");
    expect(stripRedundantLineRangePipePrefix("6-7|z", 6, 7)).toBe("z");
    expect(stripRedundantLineRangePipePrefix("7-8|z", 6, 7)).toBe("7-8|z");
  });

  it("can strip any leading range prefix when native lineRange metadata is already present", () => {
    expect(
      stripRedundantLineRangePipePrefix("140-143|\nctx.fillRect()", 150, 153, {
        allowAnyLeadingRangePrefix: true,
      }),
    ).toBe("\nctx.fillRect()");
    expect(
      stripRedundantLineRangePipePrefix("93+ 140-143|ctx.fillRect()", 150, 153, {
        allowAnyLeadingRangePrefix: true,
      }),
    ).toBe("ctx.fillRect()");
  });
});
