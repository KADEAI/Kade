const JSON_ESCAPE_MAP: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const decodeJsonStringFragment = (value: string) =>
  value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\(["\\/bfnrt])/g, (_, escape: string) => {
      return JSON_ESCAPE_MAP[escape] ?? escape;
    })
    .replace(/\\$/g, "");

const extractCommandFromJsonLike = (raw: string) => {
  const match = raw.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/s);
  if (!match) {
    return "";
  }

  return decodeJsonStringFragment(match[1]).trim();
};

export const isBashToolPayload = (value?: string | null) =>
  /"tool"\s*:\s*"bash"/.test(value ?? "");

export const extractBashCommandPreview = (value?: string | null) => {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return "";
  }

  const commandLineMatch = raw.match(/(?:^|\n)Command:\s*([^\n]+)/i);
  if (commandLineMatch?.[1]) {
    return commandLineMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(raw);
    const parsedCommand =
      typeof parsed?.command === "string"
        ? parsed.command
        : typeof parsed?.params?.command === "string"
          ? parsed.params.command
          : "";

    if (parsedCommand.trim()) {
      return parsedCommand.trim();
    }
  } catch {
    // Partial tool payloads are expected during streaming.
  }

  const jsonLikeCommand = extractCommandFromJsonLike(raw);
  if (jsonLikeCommand) {
    return jsonLikeCommand;
  }

  if (/^Output:/i.test(raw) || raw.startsWith("{") || raw.startsWith("[")) {
    return "";
  }

  return raw.split("\nOutput:")[0].trim();
};
