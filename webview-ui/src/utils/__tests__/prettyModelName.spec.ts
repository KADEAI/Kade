import { describe, expect, it } from "vitest";

import { prettyModelName } from "../prettyModelName";

describe("prettyModelName", () => {
  it("keeps GPT uppercase", () => {
    expect(prettyModelName("gpt-5.4")).toBe("GPT 5.4");
  });

  it("keeps GPT uppercase in provider-prefixed model ids", () => {
    expect(prettyModelName("openai/gpt-5.4")).toBe("Openai / GPT 5.4");
  });
});
