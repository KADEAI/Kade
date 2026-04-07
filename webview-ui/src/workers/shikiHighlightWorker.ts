import { getHighlighter } from "@src/utils/highlighter";
import type { ShikiTransformer } from "shiki";

type HighlightRequest = {
  id: number;
  source: string;
  language: string;
  theme: "github-dark" | "github-light" | "dark-plus" | "light-plus";
};

type HighlightResponse = {
  id: number;
  html?: string;
  error?: string;
};

const ctx: Worker = self as any;

ctx.addEventListener("message", async (event: MessageEvent<HighlightRequest>) => {
  const { id, source, language, theme } = event.data;

  try {
    const highlighter = await getHighlighter(language);
    const html = await highlighter.codeToHtml(source, {
      lang: language || "txt",
      theme,
      transformers: [
        {
          pre(node) {
            const className = Array.isArray(node.properties.class)
              ? node.properties.class
              : typeof node.properties.class === "string"
                ? [node.properties.class]
                : [];
            node.properties.class = [...className, "hljs"];
            return node;
          },
          code(node) {
            const className = Array.isArray(node.properties.class)
              ? node.properties.class
              : typeof node.properties.class === "string"
                ? [node.properties.class]
                : [];
            node.properties.class = [...className, `language-${language || "txt"}`];
            return node;
          },
        } as ShikiTransformer,
      ],
    });

    ctx.postMessage({ id, html } satisfies HighlightResponse);
  } catch (error) {
    ctx.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HighlightResponse);
  }
});
