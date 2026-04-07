const collapseWhitespace = (value?: string) =>
  (value || "").replace(/\s+/g, " ").trim();

const stripWrappingQuotes = (value: string) => {
  if (value.length < 2) {
    return value;
  }

  const firstChar = value[0];
  const lastChar = value[value.length - 1];
  if (
    (firstChar === '"' && lastChar === '"') ||
    (firstChar === "'" && lastChar === "'") ||
    (firstChar === "`" && lastChar === "`")
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
};

const normalizeGlobLikeTarget = (value: string) => {
  const pathSegments = value.split(/[\\/]/).filter(Boolean);
  const source = /[*?[\]{}]/.test(value) ? pathSegments.at(-1) || value : value;

  return source
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/[*?]+/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .trim();
};

const basename = (value?: string) => {
  if (!value) return "";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
};

export const formatToolActivitySearchTarget = (
  value?: string,
  fallback = "search",
) => {
  const normalized = stripWrappingQuotes(collapseWhitespace(value));
  if (!normalized) {
    return fallback;
  }

  const cleaned = normalizeGlobLikeTarget(normalized);
  if (!cleaned || !/[A-Za-z0-9]/.test(cleaned)) {
    return fallback;
  }

  return cleaned.length > 92 ? `${cleaned.slice(0, 89)}...` : cleaned;
};

export const formatToolActivitySearchSubject = (
  value?: string,
  path?: string,
  fallback = "search",
) => {
  const target = formatToolActivitySearchTarget(value, "");
  if (target) {
    return target;
  }

  const pathTarget = basename(path);
  if (pathTarget) {
    return pathTarget;
  }

  return fallback;
};
