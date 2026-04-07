import type { ClineMessage } from "@roo-code/types";
import type { ClineSayTool } from "@roo/ExtensionMessage";
import { normalizeToolActivityName } from "./toolActivityLabels";
import { formatToolActivitySearchSubject } from "./toolActivityTargetFormatting";

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const basename = (value?: string) => {
  if (!value) return "";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
};

const formatNaturalList = (values: string[]) => {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const capitalizeFirst = (value: string) =>
  value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

const getToolPath = (tool: ClineSayTool) =>
  tool.path ||
  (tool as any).file_path ||
  (tool as any).target_file ||
  (tool as any).notebook_path ||
  "";

const getToolActivityVerb = (
  fileCount: number,
  folderCount: number,
  searchCount: number,
  running: boolean,
) => {
  if (fileCount > 0 && folderCount === 0 && searchCount === 0) {
    return running ? "Reading" : "Read";
  }

  if (folderCount > 0 && fileCount === 0 && searchCount === 0) {
    return running ? "Exploring" : "Explored";
  }

  if (searchCount > 0 && fileCount === 0 && folderCount === 0) {
    return running ? "Searching" : "Searched";
  }

  if (running) {
    if (searchCount > 0) return "Searching";
    if (folderCount > 0) return "Exploring";
    return "Reading";
  }

  return "Processed";
};

export const buildToolActivitySummaryText = (
  tools: ClineSayTool[],
  running: boolean,
) => {
  let fileCount = 0;
  let folderCount = 0;
  let searchCount = 0;
  const namedTargets: string[] = [];
  const searchTargets: string[] = [];
  const mixedActionPhrases: string[] = [];
  const actionKinds = new Set<"read" | "explore" | "search">();

  for (const tool of tools) {
    switch (normalizeToolActivityName(tool.tool as string)) {
      case "readFile": {
        fileCount += 1;
        actionKinds.add("read");
        const fileName = basename(getToolPath(tool));
        if (fileName) {
          namedTargets.push(fileName);
          mixedActionPhrases.push(
            `${running ? "reading" : "read"} ${fileName}`,
          );
        }
        break;
      }
      case "fetchInstructions": {
        fileCount += 1;
        actionKinds.add("read");
        const fileName = basename(getToolPath(tool));
        if (fileName) {
          namedTargets.push(fileName);
          mixedActionPhrases.push(
            `${running ? "reading" : "read"} ${fileName}`,
          );
        }
        break;
      }
      case "fastContext":
      case "fetch":
        fileCount += 1;
        actionKinds.add("read");
        break;
      case "listDirTopLevel":
      case "listDirRecursive": {
        folderCount += 1;
        actionKinds.add("explore");
        const folderName = basename(getToolPath(tool));
        if (folderName) {
          namedTargets.push(folderName);
          mixedActionPhrases.push(
            `${running ? "exploring" : "explored"} ${folderName}`,
          );
        }
        break;
      }
      case "grep":
      case "glob":
      case "web":
      case "research_web": {
        searchCount += 1;
        actionKinds.add("search");
        const searchTarget = formatToolActivitySearchSubject(
          (tool as any).regex ||
            (tool as any).pattern ||
            (tool as any).glob ||
            (tool as any).query ||
            (tool as any).searchTerm,
          getToolPath(tool),
        );
        if (searchTarget !== "search") {
          searchTargets.push(searchTarget);
          mixedActionPhrases.push(
            `${running ? "searching" : "searched"} ${searchTarget}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  const verb = getToolActivityVerb(
    fileCount,
    folderCount,
    searchCount,
    running,
  );
  const totalExploredCount = fileCount + folderCount;
  const uniqueSearchTargets = [...new Set(searchTargets)];
  const uniqueMixedActionPhrases = [...new Set(mixedActionPhrases)];

  if (
    actionKinds.size > 1 &&
    uniqueMixedActionPhrases.length >= 2 &&
    uniqueMixedActionPhrases.length <= 4
  ) {
    return capitalizeFirst(formatNaturalList(uniqueMixedActionPhrases));
  }

  if (
    searchCount === 0 &&
    totalExploredCount >= 2 &&
    totalExploredCount <= 4 &&
    namedTargets.length === totalExploredCount
  ) {
    return `${verb} ${formatNaturalList(namedTargets)}`;
  }

  if (fileCount > 0 && folderCount === 0 && searchCount === 0) {
    if (fileCount === 1 && namedTargets.length === 1) {
      return `${verb} ${namedTargets[0]}`;
    }
    return `${verb} ${pluralize(fileCount, "file")}`;
  }

  if (folderCount > 0 && fileCount === 0 && searchCount === 0) {
    return `${verb} ${pluralize(folderCount, "directory", "directories")}`;
  }

  if (
    searchCount >= 2 &&
    fileCount === 0 &&
    folderCount === 0 &&
    uniqueSearchTargets.length === searchCount &&
    uniqueSearchTargets.length <= 4
  ) {
    return `${verb} ${formatNaturalList(uniqueSearchTargets)}`;
  }

  if (searchCount > 0 && fileCount === 0 && folderCount === 0) {
    return `${verb} codebase`;
  }

  const parts: string[] = [];
  if (fileCount > 0) parts.push(pluralize(fileCount, "file"));
  if (folderCount > 0) {
    parts.push(pluralize(folderCount, "directory", "directories"));
  }
  if (searchCount > 0) parts.push(pluralize(searchCount, "search", "searches"));

  if (parts.length === 0) {
    return `${verb} ${pluralize(tools.length, "tool call")}`;
  }

  return `${verb} ${parts.join(", ")}`;
};

export const getToolActivitySummaryRunning = ({
  hasFollowingBoundary,
  isStreaming,
  segmentMessages,
}: {
  hasFollowingBoundary: boolean;
  isStreaming: boolean;
  segmentMessages: Pick<ClineMessage, "partial">[];
}) =>
  segmentMessages.some((candidate) => candidate.partial) ||
  (!hasFollowingBoundary && isStreaming);
