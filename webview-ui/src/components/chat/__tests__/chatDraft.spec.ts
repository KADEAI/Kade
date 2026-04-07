import { hasDraftContent } from "../chatDraft";

describe("chatDraft", () => {
  it("treats trimmed text as draft content", () => {
    expect(hasDraftContent("  hello  ", [])).toBe(true);
  });

  it("treats selected images as draft content", () => {
    expect(hasDraftContent("   ", ["data:image/png;base64,abc"])).toBe(true);
  });

  it("rejects empty whitespace-only drafts without images", () => {
    expect(hasDraftContent("   ", [])).toBe(false);
  });
});
