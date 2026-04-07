export function splitGlobPatternList(
  input: string | string[],
  options?: { allowLegacyPipe?: boolean },
): string[] {
  const allowLegacyPipe = options?.allowLegacyPipe !== false;
  const values = Array.isArray(input) ? input : [input];
  const results: string[] = [];

  for (const value of values) {
    let current = "";
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;
    let escaped = false;

    const flush = () => {
      const trimmed = current.trim();
      if (trimmed) {
        results.push(trimmed);
      }
      current = "";
    };

    for (const char of value) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }

      if (char === "{") {
        braceDepth++;
        current += char;
        continue;
      }

      if (char === "}" && braceDepth > 0) {
        braceDepth--;
        current += char;
        continue;
      }

      if (char === "[") {
        bracketDepth++;
        current += char;
        continue;
      }

      if (char === "]" && bracketDepth > 0) {
        bracketDepth--;
        current += char;
        continue;
      }

      if (char === "(") {
        parenDepth++;
        current += char;
        continue;
      }

      if (char === ")" && parenDepth > 0) {
        parenDepth--;
        current += char;
        continue;
      }

      const atTopLevel =
        braceDepth === 0 && bracketDepth === 0 && parenDepth === 0;
      const isDelimiter =
        char === "," || (allowLegacyPipe && char === "|" && atTopLevel);

      if (atTopLevel && isDelimiter) {
        flush();
        continue;
      }

      current += char;
    }

    flush();
  }

  return results;
}
