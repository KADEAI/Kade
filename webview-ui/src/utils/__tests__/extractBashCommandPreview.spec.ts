import {
  extractBashCommandPreview,
  isBashToolPayload,
} from "../extractBashCommandPreview";

describe("extractBashCommandPreview", () => {
  it("extracts commands from partial bash tool payloads", () => {
    expect(
      extractBashCommandPreview(
        '{"tool":"bash","command":"echo Jarvis online',
      ),
    ).toBe("echo Jarvis online");
  });

  it("decodes escaped characters from json-like command fragments", () => {
    expect(
      extractBashCommandPreview(
        '{"tool":"bash","command":"printf \\"hello\\\\nworld\\"',
      ),
    ).toBe('printf "hello\\nworld"');
  });

  it("does not treat incomplete non-command json as a command", () => {
    expect(extractBashCommandPreview('{"tool":"bash","status":"started"')).toBe(
      "",
    );
  });

  it("detects bash tool payloads before the json is complete", () => {
    expect(isBashToolPayload('{"tool":"bash","command":"npm run dev')).toBe(
      true,
    );
  });
});
