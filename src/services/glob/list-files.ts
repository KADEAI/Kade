import os from "os";
import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";
import * as vscode from "vscode";
import ignore from "ignore";
import { arePathsEqual } from "../../utils/path";
import { getBinPath } from "../../services/ripgrep";
import { DIRS_TO_IGNORE } from "./constants";

const HIDDEN_DIR_PATTERN = ".*";
const NON_HIDDEN_IGNORE_PATTERNS = DIRS_TO_IGNORE.filter(
  (pattern) => pattern !== HIDDEN_DIR_PATTERN,
);
const EXPLICITLY_IGNORED_DIR_NAMES = new Set(
  NON_HIDDEN_IGNORE_PATTERNS.map((pattern) => pattern.split("/")[0]).filter(
    Boolean,
  ),
);
const RIPGREP_TIMEOUT_MS = 10_000;

let ripgrepPathPromise: Promise<string> | undefined;
const gitignoreFilesCache = new Map<string, Promise<string[]>>();
const ignoreInstanceCache = new Map<
  string,
  Promise<ReturnType<typeof ignore>>
>();

/**
 * Context object for directory scanning operations
 */
interface ScanContext {
  /** Whether this is the explicitly targeted directory */
  isTargetDir: boolean;
  /** Whether we're inside an explicitly targeted hidden directory */
  insideExplicitHiddenTarget: boolean;
  /** The base path for the scan operation */
  basePath: string;
  /** The ignore instance for gitignore handling */
  ignoreInstance: ReturnType<typeof ignore>;
}

/**
 * List files in a directory, with optional recursive traversal
 *
 * @param dirPath - Directory path to list files from
 * @param recursive - Whether to recursively list files in subdirectories
 * @param limit - Maximum number of files to return
 * @returns Tuple of [file paths array, whether the limit was reached]
 */
export async function listFiles(
  dirPath: string,
  recursive: boolean,
  limit: number,
  rooIgnoreController?: any,
  excludedPaths: string[] = [],
): Promise<[string[], boolean]> {
  void rooIgnoreController;

  // Early return for limit of 0 - no need to scan anything
  if (limit === 0) {
    return [[], false];
  }

  // Handle special directories
  const specialResult = await handleSpecialDirectories(dirPath);

  if (specialResult) {
    return specialResult;
  }

  const [rgPath, ignoreInstance] = await Promise.all([
    getCachedRipgrepPath(),
    createIgnoreInstance(dirPath),
  ]);
  const files = await listFilesWithRipgrep(
    rgPath,
    dirPath,
    recursive,
    limit,
    excludedPaths,
  );
  const remainingLimit = Math.max(0, limit - files.length);
  const directories =
    remainingLimit > 0
      ? await listFilteredDirectories(
          dirPath,
          recursive,
          ignoreInstance,
          remainingLimit,
        )
      : [];

  // Combine and check if we hit the limits
  const [results, limitReached] = formatAndCombineResults(
    files,
    directories,
    limit,
  );

  // If we hit the limit, ensure all first-level directories are included
  if (recursive && limitReached) {
    const firstLevelDirs = await getFirstLevelDirectories(
      dirPath,
      ignoreInstance,
    );
    return ensureFirstLevelDirectoriesIncluded(results, firstLevelDirs, limit);
  }

  return [results, limitReached];
}

/**
 * Get only the first-level directories in a path
 */
async function getFirstLevelDirectories(
  dirPath: string,
  ignoreInstance: ReturnType<typeof ignore>,
): Promise<string[]> {
  const absolutePath = path.resolve(dirPath);
  const directories: string[] = [];

  try {
    const entries = await fs.promises.readdir(absolutePath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      // Include both regular directories and symlinks
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const fullDirPath = path.join(absolutePath, entry.name);

      // For symlinks, verify they point to directories
      if (entry.isSymbolicLink()) {
        try {
          const stats = await fs.promises.stat(fullDirPath);
          if (!stats.isDirectory()) {
            continue;
          }
        } catch (err) {
          // Broken symlink or permission issue, skip it
          continue;
        }
      }

      const context: ScanContext = {
        isTargetDir: false,
        insideExplicitHiddenTarget: false,
        basePath: dirPath,
        ignoreInstance,
      };
      if (shouldIncludeDirectory(entry.name, fullDirPath, context)) {
        const formattedPath = fullDirPath.endsWith("/")
          ? fullDirPath
          : `${fullDirPath}/`;
        directories.push(formattedPath);
      }
    }
  } catch (err) {
    console.warn(`Could not read directory ${absolutePath}: ${err}`);
  }

  return directories;
}

/**
 * Ensure all first-level directories are included in the results
 */
function ensureFirstLevelDirectoriesIncluded(
  results: string[],
  firstLevelDirs: string[],
  limit: number,
): [string[], boolean] {
  // Create a set of existing paths for quick lookup
  const existingPaths = new Set(results);

  // Find missing first-level directories
  const missingDirs = firstLevelDirs.filter((dir) => !existingPaths.has(dir));

  if (missingDirs.length === 0) {
    // All first-level directories are already included
    return [results, true];
  }

  // We need to make room for the missing directories
  // Remove items from the end (which are likely deeper in the tree)
  const itemsToRemove = Math.min(missingDirs.length, results.length);
  const adjustedResults = results.slice(0, results.length - itemsToRemove);

  // Add the missing directories at the beginning (after any existing first-level dirs)
  // First, separate existing results into first-level and others
  const resultPaths = adjustedResults.map((r) => path.resolve(r));
  const basePath = path
    .resolve(firstLevelDirs[0])
    .split(path.sep)
    .slice(0, -1)
    .join(path.sep);

  const firstLevelResults: string[] = [];
  const otherResults: string[] = [];

  for (let i = 0; i < adjustedResults.length; i++) {
    const resolvedPath = resultPaths[i];
    const relativePath = path.relative(basePath, resolvedPath);
    const depth = relativePath.split(path.sep).length;

    if (depth === 1) {
      firstLevelResults.push(adjustedResults[i]);
    } else {
      otherResults.push(adjustedResults[i]);
    }
  }

  // Combine: existing first-level dirs + missing first-level dirs + other results
  const finalResults = [
    ...firstLevelResults,
    ...missingDirs,
    ...otherResults,
  ].slice(0, limit);

  return [finalResults, true];
}

/**
 * Handle special directories (root, home) that should not be fully listed
 */
async function handleSpecialDirectories(
  dirPath: string,
): Promise<[string[], boolean] | null> {
  const absolutePath = path.resolve(dirPath);

  // Do not allow listing files in root directory
  const root =
    process.platform === "win32" ? path.parse(absolutePath).root : "/";
  const isRoot = arePathsEqual(absolutePath, root);
  if (isRoot) {
    return [[root], false];
  }

  // Do not allow listing files in home directory
  const homeDir = os.homedir();
  const isHomeDir = arePathsEqual(absolutePath, homeDir);
  if (isHomeDir) {
    return [[homeDir], false];
  }

  return null;
}

async function getCachedRipgrepPath(): Promise<string> {
  if (!ripgrepPathPromise) {
    ripgrepPathPromise = (async () => {
      const rgPath = await getBinPath(vscode.env.appRoot);
      if (!rgPath) {
        throw new Error("Could not find ripgrep binary");
      }
      return rgPath;
    })();
  }

  return ripgrepPathPromise;
}

/**
 * List files using ripgrep with appropriate arguments
 */
async function listFilesWithRipgrep(
  rgPath: string,
  dirPath: string,
  recursive: boolean,
  limit: number,
  excludedPaths: string[] = [],
): Promise<string[]> {
  const rgArgs = buildRipgrepArgs(dirPath, recursive, excludedPaths);

  const relativePaths = await execRipgrep(rgPath, rgArgs, limit);

  // Convert relative paths from ripgrep to absolute paths
  // Resolve dirPath once here for the mapping operation
  const absolutePath = path.resolve(dirPath);
  return relativePaths.map((relativePath) =>
    path.resolve(absolutePath, relativePath),
  );
}

/**
 * Build appropriate ripgrep arguments based on whether we're doing a recursive search
 */
function buildRipgrepArgs(
  dirPath: string,
  recursive: boolean,
  excludedPaths: string[] = [],
): string[] {
  // Base arguments to list files
  const args = ["--files", "--hidden", "--follow"];
  const exclusionArgs = excludedPaths.flatMap((p) => ["-g", `!**/${p}/**`]);

  if (recursive) {
    return [...args, ...exclusionArgs, ...buildRecursiveArgs(dirPath), dirPath];
  } else {
    return [...args, ...exclusionArgs, ...buildNonRecursiveArgs(), dirPath];
  }
}

/**
 * Build ripgrep arguments for recursive directory traversal
 */
function buildRecursiveArgs(dirPath: string): string[] {
  const args: string[] = [];

  // In recursive mode, respect .gitignore by default
  // (ripgrep does this automatically)

  // Check if we're explicitly targeting a hidden directory
  // Normalize the path first to handle edge cases
  const normalizedPath = path.normalize(dirPath);
  // Split by separator and filter out empty parts
  // This handles cases like trailing slashes, multiple separators, etc.
  const pathParts = normalizedPath
    .split(path.sep)
    .filter((part) => part.length > 0);
  const isTargetingHiddenDir = pathParts.some((part) => part.startsWith("."));

  // Get the target directory name to check if it's in the ignore list
  const targetDirName = path.basename(dirPath);
  const isTargetInIgnoreList = EXPLICITLY_IGNORED_DIR_NAMES.has(targetDirName);

  // If targeting a hidden directory or a directory in the ignore list,
  // use special handling to ensure all files are shown
  if (isTargetingHiddenDir || isTargetInIgnoreList) {
    args.push("--no-ignore-vcs");
    args.push("--no-ignore");

    // When targeting an ignored directory, we need to be careful with glob patterns
    // Add a pattern to explicitly include files at the root level
    args.push("-g", "*");
    args.push("-g", "**/*");
  }

  // Apply directory exclusions for recursive searches
  for (const dir of DIRS_TO_IGNORE) {
    // Special handling for hidden directories pattern
    if (dir === HIDDEN_DIR_PATTERN) {
      // If we're explicitly targeting a hidden directory, don't exclude hidden files/dirs
      // This allows the target hidden directory and all its contents to be listed
      if (!isTargetingHiddenDir) {
        // Not targeting hidden dir: exclude all hidden directories
        args.push("-g", `!**/.*/**`);
      }
      // If targeting hidden dir: don't add any exclusion for hidden directories
      continue;
    }

    // When explicitly targeting a directory that's in the ignore list (e.g., "temp"),
    // we need special handling:
    // - Don't add any exclusion pattern for the target directory itself
    // - Only exclude nested subdirectories with the same name
    // This ensures all files in the target directory are listed, while still
    // preventing recursion into nested directories with the same ignored name
    if (dir === targetDirName && isTargetInIgnoreList) {
      // Skip adding any exclusion pattern - we want to see everything in the target directory
      continue;
    }

    // For all other cases, exclude the directory pattern globally
    args.push("-g", `!**/${dir}/**`);
  }

  return args;
}

/**
 * Build ripgrep arguments for non-recursive directory listing
 */
function buildNonRecursiveArgs(): string[] {
  const args: string[] = [];

  // For non-recursive, limit to the current directory level
  args.push("-g", "*");
  args.push("--maxdepth", "1"); // ripgrep uses maxdepth, not max-depth

  // Respect .gitignore in non-recursive mode too
  // (ripgrep respects .gitignore by default)

  // Apply directory exclusions for non-recursive searches
  for (const dir of DIRS_TO_IGNORE) {
    if (dir === HIDDEN_DIR_PATTERN) {
      // For hidden directories in non-recursive mode, we want to show the directories
      // themselves but not their contents. Since we're using --maxdepth 1, this
      // naturally happens - we just need to avoid excluding the directories entirely.
      // We'll let the directory scanning logic handle the visibility.
      continue;
    } else {
      // Direct children only
      args.push("-g", `!${dir}`);
      args.push("-g", `!${dir}/**`);
    }
  }

  return args;
}

/**
 * Create an ignore instance that handles .gitignore files properly
 * This replaces the custom gitignore parsing with the proper ignore library
 */
async function createIgnoreInstance(
  dirPath: string,
): Promise<ReturnType<typeof ignore>> {
  const absolutePath = path.resolve(dirPath);
  const cachedInstance = ignoreInstanceCache.get(absolutePath);
  if (cachedInstance) {
    return cachedInstance;
  }

  const instancePromise = (async () => {
    const ignoreInstance = ignore();
    const gitignoreFiles = await findGitignoreFiles(absolutePath);
    const gitignoreContents = await Promise.all(
      gitignoreFiles.map(async (gitignoreFile) => {
        try {
          return await fs.promises.readFile(gitignoreFile, "utf8");
        } catch (err) {
          console.warn(`Could not read .gitignore at ${gitignoreFile}: ${err}`);
          return null;
        }
      }),
    );

    for (const content of gitignoreContents) {
      if (content) {
        ignoreInstance.add(content);
      }
    }

    // Always ignore .gitignore files themselves
    ignoreInstance.add(".gitignore");

    return ignoreInstance;
  })();

  ignoreInstanceCache.set(absolutePath, instancePromise);

  try {
    return await instancePromise;
  } catch (error) {
    ignoreInstanceCache.delete(absolutePath);
    throw error;
  }
}

/**
 * Find all .gitignore files from the given directory up to the workspace root
 */
async function findGitignoreFiles(startPath: string): Promise<string[]> {
  const normalizedStartPath = path.resolve(startPath);
  const cachedGitignoreFiles = gitignoreFilesCache.get(normalizedStartPath);
  if (cachedGitignoreFiles) {
    return cachedGitignoreFiles;
  }

  const gitignoreFilesPromise = (async () => {
    const gitignoreFiles: string[] = [];
    let currentPath = normalizedStartPath;

    // Walk up the directory tree looking for .gitignore files
    while (currentPath && currentPath !== path.dirname(currentPath)) {
      const gitignorePath = path.join(currentPath, ".gitignore");

      try {
        await fs.promises.access(gitignorePath);
        gitignoreFiles.push(gitignorePath);
      } catch {
        // .gitignore doesn't exist at this level, continue
      }

      // Move up one directory
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break; // Reached root
      }
      currentPath = parentPath;
    }

    // Return in reverse order (root .gitignore first, then more specific ones)
    return gitignoreFiles.reverse();
  })();

  gitignoreFilesCache.set(normalizedStartPath, gitignoreFilesPromise);

  try {
    return await gitignoreFilesPromise;
  } catch (error) {
    gitignoreFilesCache.delete(normalizedStartPath);
    throw error;
  }
}

/**
 * List directories with appropriate filtering
 */
async function listFilteredDirectories(
  dirPath: string,
  recursive: boolean,
  ignoreInstance: ReturnType<typeof ignore>,
  limit?: number,
): Promise<string[]> {
  const absolutePath = path.resolve(dirPath);
  const directories: string[] = [];
  let dirCount = 0;
  const effectiveLimit = limit ?? Number.MAX_SAFE_INTEGER;

  // For environment details generation, we don't want to treat the root as a "target"
  // if we're doing a general recursive scan, as this would include hidden directories
  // Only treat as target if we're explicitly scanning a single hidden directory
  const isExplicitHiddenTarget = path.basename(absolutePath).startsWith(".");

  // Create initial context for the scan
  const initialContext: ScanContext = {
    isTargetDir: isExplicitHiddenTarget,
    insideExplicitHiddenTarget: isExplicitHiddenTarget,
    basePath: dirPath,
    ignoreInstance,
  };

  // Track visited real paths to prevent circular symlink traversal
  const visitedPaths = new Set<string>();

  async function scanDirectory(
    currentPath: string,
    context: ScanContext,
  ): Promise<boolean> {
    // Check if we've reached the limit
    if (dirCount >= effectiveLimit) {
      return true; // Signal that limit was reached
    }

    // Resolve the real path to detect circular symlinks
    let realPath: string;
    try {
      realPath = await fs.promises.realpath(currentPath);
    } catch (err) {
      // If we can't resolve the real path, skip this directory
      console.warn(`Could not resolve real path for ${currentPath}: ${err}`);
      return false;
    }

    // Check if we've already visited this real path (circular symlink detection)
    if (visitedPaths.has(realPath)) {
      return false;
    }
    visitedPaths.add(realPath);

    try {
      // List all entries in the current directory
      const entries = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
      });

      // Filter for directories, including symbolic links
      for (const entry of entries) {
        // Check limit before processing each directory
        if (dirCount >= effectiveLimit) {
          return true;
        }

        // Skip non-directories
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }

        const dirName = entry.name;
        const fullDirPath = path.join(currentPath, dirName);

        // For symlinks, verify they point to directories
        if (entry.isSymbolicLink()) {
          try {
            const stats = await fs.promises.stat(fullDirPath);
            if (!stats.isDirectory()) {
              continue; // Symlink doesn't point to a directory
            }
          } catch (err) {
            // Broken symlink or permission issue, skip it
            continue;
          }
        }

        // Create context for subdirectory checks
        // Subdirectories found during scanning are never target directories themselves
        const subdirContext: ScanContext = {
          ...context,
          isTargetDir: false,
        };

        // Check if this directory should be included
        if (shouldIncludeDirectory(dirName, fullDirPath, subdirContext)) {
          // Add the directory to our results (with trailing slash)
          // fullDirPath is already absolute since it's built with path.join from absolutePath
          directories.push(
            fullDirPath.endsWith("/") ? fullDirPath : `${fullDirPath}/`,
          );
          dirCount++;

          // Check if we've reached the limit after adding
          if (dirCount >= effectiveLimit) {
            return true;
          }
        }

        if (!recursive || !shouldRecurseIntoDirectory(dirName, context)) {
          continue;
        }

        // If we're entering a hidden directory that's the target, or we're already inside one,
        // mark that we're inside an explicitly targeted hidden directory
        const newContext: ScanContext = {
          ...context,
          isTargetDir: false,
          insideExplicitHiddenTarget:
            context.insideExplicitHiddenTarget ||
            (dirName.startsWith(".") && context.isTargetDir),
        };
        const limitReached = await scanDirectory(fullDirPath, newContext);
        if (limitReached) {
          return true;
        }
      }
    } catch (err) {
      // Continue if we can't read a directory
      console.warn(`Could not read directory ${currentPath}: ${err}`);
    } finally {
      // Remove from visited paths when backtracking
      visitedPaths.delete(realPath);
    }

    return false; // Limit not reached
  }

  // Start scanning from the root directory
  await scanDirectory(absolutePath, initialContext);

  return directories;
}

/**
 * Critical directories that should always be ignored, even inside explicitly targeted hidden directories
 */
const CRITICAL_IGNORE_PATTERNS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "venv",
  "env",
]);

/**
 * Check if a directory matches any of the given patterns
 */
function matchesIgnorePattern(dirName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (
      pattern === dirName ||
      (pattern.includes("/") && pattern.split("/")[0] === dirName)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a directory is ignored by gitignore
 */
function isIgnoredByGitignore(
  fullDirPath: string,
  basePath: string,
  ignoreInstance: ReturnType<typeof ignore>,
): boolean {
  const relativePath = path.relative(basePath, fullDirPath);
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return (
    ignoreInstance.ignores(normalizedPath) ||
    ignoreInstance.ignores(normalizedPath + "/")
  );
}

/**
 * Check if a target directory should be included
 */
function shouldIncludeTargetDirectory(dirName: string): boolean {
  // Only apply non-hidden-directory ignore rules to target directories
  return !matchesIgnorePattern(dirName, NON_HIDDEN_IGNORE_PATTERNS);
}

/**
 * Check if a directory inside an explicitly targeted hidden directory should be included
 */
function shouldIncludeInsideHiddenTarget(
  dirName: string,
  fullDirPath: string,
  context: ScanContext,
): boolean {
  // Only apply the most critical ignore patterns when inside explicit hidden target
  if (CRITICAL_IGNORE_PATTERNS.has(dirName)) {
    return false;
  }

  // Check against gitignore patterns
  return !isIgnoredByGitignore(
    fullDirPath,
    context.basePath,
    context.ignoreInstance,
  );
}

/**
 * Check if a regular directory should be included
 */
function shouldIncludeRegularDirectory(
  dirName: string,
  fullDirPath: string,
  context: ScanContext,
): boolean {
  // Check against explicit ignore patterns (excluding the ".*" pattern)
  if (matchesIgnorePattern(dirName, NON_HIDDEN_IGNORE_PATTERNS)) {
    return false;
  }

  // Check against gitignore patterns
  return !isIgnoredByGitignore(
    fullDirPath,
    context.basePath,
    context.ignoreInstance,
  );
}

/**
 * Determine if a directory should be included in results based on filters
 */
function shouldIncludeDirectory(
  dirName: string,
  fullDirPath: string,
  context: ScanContext,
): boolean {
  // If this is the explicitly targeted directory, allow it even if it's hidden
  // This preserves the ability to explicitly target hidden directories like .roo-memory
  if (context.isTargetDir) {
    return shouldIncludeTargetDirectory(dirName);
  }

  // If we're inside an explicitly targeted hidden directory, allow subdirectories
  // even if they would normally be filtered out by the ".*" pattern or other ignore rules
  if (context.insideExplicitHiddenTarget) {
    return shouldIncludeInsideHiddenTarget(dirName, fullDirPath, context);
  }

  // Regular directory inclusion logic
  return shouldIncludeRegularDirectory(dirName, fullDirPath, context);
}

/**
 * Check if a directory is in our explicit ignore list
 */
function isDirectoryExplicitlyIgnored(dirName: string): boolean {
  return EXPLICITLY_IGNORED_DIR_NAMES.has(dirName);
}

function shouldRecurseIntoDirectory(
  dirName: string,
  context: ScanContext,
): boolean {
  if (context.insideExplicitHiddenTarget) {
    return !CRITICAL_IGNORE_PATTERNS.has(dirName);
  }

  if (isDirectoryExplicitlyIgnored(dirName)) {
    return false;
  }

  return !(
    dirName.startsWith(".") &&
    DIRS_TO_IGNORE.includes(HIDDEN_DIR_PATTERN) &&
    !context.isTargetDir &&
    !context.insideExplicitHiddenTarget
  );
}

/**
 * Combine file and directory results and format them properly
 */
function formatAndCombineResults(
  files: string[],
  directories: string[],
  limit: number,
): [string[], boolean] {
  // Combine file paths with directory paths
  const uniquePaths = Array.from(new Set([...directories, ...files]));

  // Sort to ensure directories come first, followed by files
  uniquePaths.sort((a: string, b: string) => {
    const aIsDir = a.endsWith("/");
    const bIsDir = b.endsWith("/");

    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const trimmedPaths = uniquePaths.slice(0, limit);
  return [trimmedPaths, trimmedPaths.length >= limit];
}

/**
 * Execute ripgrep command and return list of files
 */
async function execRipgrep(
  rgPath: string,
  args: string[],
  limit: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const rgProcess = childProcess.spawn(rgPath, args);
    let pendingOutput = "";
    const results: string[] = [];
    let settled = false;

    function settleWithResults() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(results.slice(0, limit));
    }

    function processRipgrepOutput(chunk?: string, isFinal = false) {
      if (chunk) {
        pendingOutput += chunk;
      }

      let newlineIndex = pendingOutput.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = pendingOutput.slice(0, newlineIndex);
        pendingOutput = pendingOutput.slice(newlineIndex + 1);

        if (line.trim()) {
          results.push(line);
          if (results.length >= limit) {
            rgProcess.kill();
            return;
          }
        }

        newlineIndex = pendingOutput.indexOf("\n");
      }

      if (isFinal && pendingOutput.trim() && results.length < limit) {
        results.push(pendingOutput);
        pendingOutput = "";
      }
    }

    // Set timeout to avoid hanging
    const timeoutId = setTimeout(() => {
      rgProcess.kill();
      console.warn("ripgrep timed out, returning partial results");
      settleWithResults();
    }, RIPGREP_TIMEOUT_MS);

    // Process stdout data as it comes in
    rgProcess.stdout.on("data", (data) => {
      processRipgrepOutput(data.toString());
    });

    // Process stderr but don't fail on non-zero exit codes
    rgProcess.stderr.on("data", (data) => {
      console.error(`ripgrep stderr: ${data}`);
    });

    // Handle process completion
    rgProcess.on("close", (code) => {
      processRipgrepOutput(undefined, true);

      // Log non-zero exit codes but don't fail
      if (code !== 0 && code !== null && code !== 143 /* SIGTERM */) {
        console.warn(
          `ripgrep process exited with code ${code}, returning partial results`,
        );
      }

      settleWithResults();
    });

    // Handle process errors
    rgProcess.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(`ripgrep process error: ${error.message}`));
    });
  });
}
