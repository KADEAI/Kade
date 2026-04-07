import { beforeEach, describe, expect, it } from "vitest";
import { UnifiedToolCallParser } from "../UnifiedToolCallParser";

// Helper: feed entire message at once and return finalized blocks
function parse(message: string) {
  const parser = new UnifiedToolCallParser();
  parser.processChunk(message);
  parser.finalizeContentBlocks();
  return parser.getContentBlocks();
}

// Helper: chunk-by-chunk streaming, returns final blocks
function streamParse(message: string, chunkSize = 5) {
  const parser = new UnifiedToolCallParser();
  let blocks: any[] = [];
  for (let i = 0; i < message.length; i += chunkSize) {
    const chunk = message.slice(i, i + chunkSize);
    const result = parser.processChunk(chunk);
    blocks = result.blocks;
  }
  parser.finalizeContentBlocks();
  return parser.getContentBlocks();
}

function tool(blocks: any[]) {
  return blocks.find((b) => b.type === "tool_use") as any;
}

function tools(blocks: any[]) {
  return blocks.filter((b) => b.type === "tool_use") as any[];
}

function text(blocks: any[]) {
  return blocks.find((b) => b.type === "text") as any;
}

describe("UnifiedToolCallParser — EDGE CASE GAUNTLET", () => {
  let parser: UnifiedToolCallParser;

  beforeEach(() => {
    parser = new UnifiedToolCallParser();
  });

  describe("Complex Nesting and Mixed Protocols", () => {
    it("handles XML tools nested inside a tool fence (should be ignored as tools, treated as content if applicable)", () => {
      const msg = "```tool\nwrite file.txt\n<use_mcp_tool>\n<server_name>test</server_name>\n</use_mcp_tool>\nEOF\n```";
      const blocks = parse(msg);
      const ts = tools(blocks);
      expect(ts).toHaveLength(1);
      expect(ts[0].name).toBe("write");
      expect(ts[0].params.content).toContain("<use_mcp_tool>");
    });

    it("handles tool fence inside an XML tool (should be ignored by the XML parser as tools)", () => {
      // Note: UnifiedToolCallParser.parseMessage checks for tool fence first.
      const msg = "<use_mcp_tool>\n```tool\nread file.ts\n```\n</use_mcp_tool>";
      const blocks = parse(msg);
      // If it sees ```tool, it enters tool fence mode.
      const ts = tools(blocks);
      expect(ts).toHaveLength(1);
      expect(ts[0].name).toBe("read");
    });
  });

  describe("Escaping and Literal Edge Cases", () => {
    it("handles /EOF at the very end of a write block", () => {
      const parser = new UnifiedToolCallParser();
      // Directly check parseActionsBody
      const body = "write file.txt\nThis is the end /EOF\nEOF";
      const blocks = (parser as any).parseActionsBody(body, true);
      const t = tool(blocks);
      // console.log('DEBUG t.params.content:', JSON.stringify(t.params.content));
      expect(t.params.content).toBe("This is the end /EOF");
    });

    it("handles multiple escaped /EOF sequences", () => {
      const parser = new UnifiedToolCallParser();
      const body = "write file.txt\n/EOF 1\n/EOF 2\nEOF";
      const blocks = (parser as any).parseActionsBody(body, true);
      const t = tool(blocks);
      // console.log('DEBUG t.params.content:', JSON.stringify(t.params.content));
      expect(t.params.content).toBe("/EOF 1\n/EOF 2");
    });

    it("handles EOF appearing as part of a word", () => {
      const msg = "write file.txt\nNEOFORM\nEOF";
      const blocks = parse(msg);
      const t = tool(blocks);
      expect(t.params.content).toBe("NEOFORM");
    });
  });

  describe("Malformed Syntax Stress", () => {
    it("handles missing EOF for content tools on finalize", () => {
      const msg = "write file.txt\nI forgot the closer";
      const blocks = parse(msg);
      const t = tool(blocks);
      expect(t.name).toBe("write");
      expect(t.params.content).toBe("I forgot the closer");
      expect(t.partial).toBe(false); // finalized
    });

    it("handles multiple ACTIONS openers", () => {
      const msg = "ACTIONS\nACTIONS\nread file.txt\nEND";
      const blocks = parse(msg);
      const ts = tools(blocks);
      expect(ts).toHaveLength(1);
      expect(ts[0].name).toBe("read");
    });

    it("handles content tool with no path provided (should ideally not crash)", () => {
      const msg = "write\nsome content\nEOF";
      const blocks = parse(msg);
      const ts = tools(blocks);
      // Depending on implementation, it might skip or create a tool with empty path
      if (ts.length > 0) {
        expect(ts[0].name).toBe("write");
      }
    });

    it("handles unknown tool names gracefully", () => {
      const msg = "```tool\ninvalid_tool arg1 arg2\n```";
      const blocks = parse(msg);
      const ts = tools(blocks);
      expect(ts).toHaveLength(0);
    });
  });

  describe("Streaming and Incremental Parsing", () => {
    it("handles EOF split across chunks", () => {
      const parser = new UnifiedToolCallParser();
      parser.processChunk("```tool\nwrite file.txt\ncontent\nEO");
      const b1 = parser.getContentBlocks();
      expect(tool(b1).partial).toBe(true);
      
      parser.processChunk("F\n```");
      const b2 = parser.getContentBlocks();
      expect(tool(b2).partial).toBe(false);
    });

    it("handles ```tool split across chunks", () => {
      const parser = new UnifiedToolCallParser();
      parser.processChunk("some text\n``");
      expect(tools(parser.getContentBlocks())).toHaveLength(0);
      
      parser.processChunk("`tool\nread file.ts\n```");
      const ts = tools(parser.getContentBlocks());
      expect(ts).toHaveLength(1);
    });
  });

  describe("Mixed Content Stress", () => {
    it("parses multiple tool types in complex sequence", () => {
      const msg = [
        "ACTIONS",
        "read file1.ts",
        "write file2.ts",
        "content",
        "eof",
        "bash ls -la",
        "END"
      ].join("\n");
      const blocks = parse(msg);
      const ts = tools(blocks);
      expect(ts).toHaveLength(3);
      expect(ts[0].name).toBe("read");
      expect(ts[1].name).toBe("write");
      expect(ts[2].name).toBe("bash");
    });

    it("handles very long lines in content tools", () => {
      const longLine = "a".repeat(5000);
      const msg = `write long.txt\n${longLine}\nEOF`;
      const blocks = parse(msg);
      const t = tool(blocks);
      expect(t.params.content).toBe(longLine);
    });

    it("handles thousands of tool calls in one batch (stress test)", () => {
      let msg = "ACTIONS\n";
      for (let i = 0; i < 1000; i++) {
        msg += `read file${i}.ts\n`;
      }
      msg += "END";
      const blocks = parse(msg);
      const ts = tools(blocks);
      expect(ts).toHaveLength(1000);
    });
  });

  describe("Implicit Actions and Mode Selector", () => {
    it("respects Mode B: only tool fence and nothing outside", () => {
      const msg = "```tool\nread file.ts\n```\nSome trailing text";
      const blocks = parse(msg);
      const txt = text(blocks);
      // In UnifiedToolCallParser.ts, if hasCompletedToolFenceBatch is set, 
      // trailing text is not emitted if !hasFinalizedTool && finalizedBlockCount === 0.
      // But here we HAVE a finalized tool.
      // Wait, the logic in parseStandardMessage (which is called by parseMessage) 
      // has: if (cleanText && !this.hasFinalizedTool && finalizedBlockCount === 0)
      // Since hasFinalizedTool is true, it won't push the trailing text.
      expect(txt).toBeUndefined();
    });

    it("handles implicit actions at message start without END (until finalize)", () => {
      const msg = "read file.ts\nwrite file.ts\ncontent\nEOF";
      const parser = new UnifiedToolCallParser();
      parser.processChunk(msg);
      const b1 = parser.getContentBlocks();
      // Without END, they might be pending
      expect(tools(b1).every(t => t.partial)).toBe(true);
      
      parser.finalizeContentBlocks();
      const b2 = parser.getContentBlocks();
      expect(tools(b2).every(t => !t.partial)).toBe(true);
    });
  });

  describe("Tool Aliases and Normalization", () => {
    it("normalizes 'ls' to 'list'", () => {
      const msg = "ls src/";
      parser.processChunk(msg);
      parser.finalizeContentBlocks();
      const t = tool(parser.getContentBlocks());
      expect(t.name).toBe("list");
      expect(t.originalName).toBe("ls");
    });

    it("normalizes 'dirlist' to 'list'", () => {
        const msg = "dirlist src/";
        parser.processChunk(msg);
        parser.finalizeContentBlocks();
        const t = tool(parser.getContentBlocks());
        expect(t.name).toBe("list");
        expect(t.originalName).toBe("dirlist");
      });
  });
});
