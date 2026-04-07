export interface DirectoryTreeItem {
  name: string;
  path: string;
  isDir: boolean;
  sizeInfo: string;
  children: DirectoryTreeItem[];
}

interface ParsedEntry {
  path: string;
  isDir: boolean;
  sizeInfo: string;
}

const TREE_LINE_RE = /^((?:\|   |    )*)(?:\|-- |`-- )(.*)$/;

const isMetadataLine = (line: string) =>
  line.startsWith("Total files:") ||
  line.startsWith("(file_name|L = line count)") ||
  line.startsWith("(File list truncated.") ||
  line.startsWith("## ");

const parseEntryLabel = (line: string): ParsedEntry | null => {
  const match = line.match(
    /^(.*?)(?:\|L(\d+)| \(([\d.]+\s+(?:lines?|bytes?|KB|MB|GB|files?))\))?$/i,
  );

  const pathOnly = (match ? match[1] : line).trim();
  if (!pathOnly) {
    return null;
  }

  let sizeInfo = "";
  if (match) {
    if (match[2]) {
      sizeInfo = `L${match[2]}`;
    } else if (match[3]) {
      sizeInfo = match[3];
    }
  }

  const isDir = pathOnly.endsWith("/");
  return {
    path: isDir ? pathOnly.slice(0, -1) : pathOnly,
    isDir,
    sizeInfo,
  };
};

const sortTree = (items: DirectoryTreeItem[]) => {
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  for (const item of items) {
    sortTree(item.children);
  }
};

const buildDirectoryTree = (
  entries: ParsedEntry[],
  basePath: string,
): DirectoryTreeItem[] => {
  const roots: DirectoryTreeItem[] = [];
  const normalizedBasePath = basePath.replace(/\/$/, "");

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let currentChildren = roots;
    let currentPath = normalizedBasePath;

    for (const [index, part] of parts.entries()) {
      const isLeaf = index === parts.length - 1;
      const isDir = isLeaf ? entry.isDir : true;
      const nodePath = currentPath ? `${currentPath}/${part}` : part;

      let node = currentChildren.find((item) => item.name === part);
      if (!node) {
        node = {
          name: part,
          path: nodePath,
          isDir,
          sizeInfo: "",
          children: [],
        };
        currentChildren.push(node);
      } else if (isDir) {
        node.isDir = true;
      }

      if (isLeaf && entry.sizeInfo) {
        node.sizeInfo = entry.sizeInfo;
      }

      currentChildren = node.children;
      currentPath = nodePath;
    }
  }

  sortTree(roots);
  return roots;
};

const parseAsciiTreeEntries = (lines: string[]): ParsedEntry[] => {
  const entries: ParsedEntry[] = [];
  const stack: string[] = [];

  for (const line of lines) {
    if (line.trim() === ".") {
      continue;
    }

    const match = line.match(TREE_LINE_RE);
    if (!match) {
      continue;
    }

    const depth = (match[1].match(/(?:\|   |    )/g) || []).length;
    const entry = parseEntryLabel(match[2]);
    if (!entry) {
      continue;
    }

    stack.length = depth;
    const relativePath = [...stack, entry.path].filter(Boolean).join("/");

    entries.push({
      path: entry.isDir ? `${relativePath}/` : relativePath,
      isDir: entry.isDir,
      sizeInfo: entry.sizeInfo,
    });

    if (entry.isDir) {
      stack[depth] = entry.path;
    }
  }

  return entries;
};

const parseFlatEntries = (lines: string[]): ParsedEntry[] =>
  lines
    .map((line) => parseEntryLabel(line.trim()))
    .filter((entry): entry is ParsedEntry => Boolean(entry));

export const parseListDirContent = (
  content: string,
  fallbackPath = "",
): {
  dirPath: string;
  directoryTree: DirectoryTreeItem[];
  hasItems: boolean;
} => {
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { dirPath: fallbackPath, directoryTree: [], hasItems: false };
  }

  const pathLine = lines[0];
  const pathMatch = pathLine.match(/^(?:Path|Directory): (.+)$/);
  const dirPath = pathMatch ? pathMatch[1] : fallbackPath;
  const contentLines = (pathMatch ? lines.slice(1) : lines).filter(
    (line) => !isMetadataLine(line.trim()),
  );

  const hasAsciiTree = contentLines.some(
    (line) => line.trim() === "." || TREE_LINE_RE.test(line),
  );
  const entries = hasAsciiTree
    ? parseAsciiTreeEntries(contentLines)
    : parseFlatEntries(contentLines);
  const directoryTree = buildDirectoryTree(entries, dirPath);

  return {
    dirPath,
    directoryTree,
    hasItems: directoryTree.length > 0,
  };
};
