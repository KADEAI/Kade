const UPPERCASE_MODEL_TOKENS = new Set(["gpt", "api", "ui", "ux", "llm"]);

const formatModelWord = (word: string): string => {
  if (!word) {
    return word;
  }

  const normalized = word.toLowerCase();
  if (UPPERCASE_MODEL_TOKENS.has(normalized)) {
    return normalized.toUpperCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1);
};

export const prettyModelName = (modelId: string): string => {
  if (!modelId) {
    return "";
  }
  const [mainId, tag] = modelId.split(":");

  const projectName = mainId.includes("/") ? mainId.split("/")[0] : "";
  const modelName = mainId.includes("/") ? mainId.split("/")[1] : mainId;

  // Capitalize each word and join with spaces
  const formattedProject = projectName ? formatModelWord(projectName) : "";

  const formattedName = modelName
    .split("-")
    .filter(Boolean)
    .map(formatModelWord)
    .join(" ");

  const formattedTag = tag ? `(${formatModelWord(tag)})` : "";

  return [
    [formattedProject, formattedName].filter(Boolean).join(" / "),
    formattedTag,
  ]
    .filter(Boolean)
    .join(" ");
};
