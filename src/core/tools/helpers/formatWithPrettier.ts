import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile as execFileCallback } from "child_process";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { promisify } from "util";
import { FormatterAvailability, FormatterSettings } from "@roo-code/types";

type FormatWithPrettierParams = {
  cwd: string;
  relativePath: string;
  content: string;
  previousContent?: string;
  formatterSettings?: FormatterSettings;
};

type PrettierModule = typeof import("prettier");
type PrettierApi = {
  resolveConfig: PrettierModule["resolveConfig"];
  format: PrettierModule["format"];
};
type PrettierFormatOptions = NonNullable<Parameters<PrettierApi["format"]>[1]>;
type PrettierPlugins = NonNullable<PrettierFormatOptions["plugins"]>;
type PrettierPlugin = PrettierPlugins[number];
type PrettierResolvedConfig = Awaited<ReturnType<PrettierApi["resolveConfig"]>>;
type CachedPromiseEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

type DprintFormatterModule = typeof import("@dprint/formatter");
type DprintFormatterApi = Pick<
  DprintFormatterModule,
  "createFromBuffer" | "createContext"
>;

type DprintPluginModule =
  | typeof import("@dprint/ruff")
  | typeof import("@dprint/toml")
  | typeof import("@dprint/dockerfile")
  | typeof import("@dprint/mago");

type DprintFormatter = {
  formatText(
    request:
      | {
          filePath: string;
          fileText: string;
        }
      | string,
    fileText?: string,
  ): string;
};

function createSafeRequire() {
  const nativeRequire = (globalThis as { require?: NodeRequire }).require;
  if (typeof nativeRequire === "function") {
    return nativeRequire;
  }

  const candidates = [
    typeof __filename === "string" ? __filename : undefined,
    typeof __dirname === "string"
      ? path.join(__dirname, "formatWithPrettier.js")
      : undefined,
    (() => {
      try {
        return fileURLToPath(import.meta.url);
      } catch {
        return undefined;
      }
    })(),
    process.cwd ? path.join(process.cwd(), "noop.js") : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) {
      continue;
    }

    try {
      return createRequire(candidate);
    } catch {
      continue;
    }
  }

  throw new Error(
    "Unable to create a safe require function for formatter module resolution.",
  );
}

const require = createSafeRequire();
const execFile = promisify(execFileCallback);

let prettierModulePromise: Promise<PrettierModule | undefined> | undefined;
let prettierApiPromise: Promise<PrettierApi | undefined> | undefined;
let prettierModuleUnavailable = false;
let hasLoggedMissingPrettierWarning = false;
let dprintFormatterPromise: Promise<DprintFormatterApi> | undefined;
const dprintPluginPromiseByPackage = new Map<
  string,
  Promise<DprintPluginModule>
>();
const dprintFormatterCache = new Map<string, Promise<DprintFormatter>>();
const optionalPrettierPluginPromiseByKey = new Map<
  string,
  Promise<PrettierPlugins>
>();
const prettierConfigCache = new Map<
  string,
  CachedPromiseEntry<PrettierResolvedConfig>
>();
const cliAvailabilityPromiseByCommand = new Map<string, Promise<boolean>>();

const PRETTIER_CONFIG_CACHE_TTL_MS = 300_000;
const PRETTIER_RANGE_FORMAT_MAX_FILE_FRACTION = 0.6;
const PRETTIER_RANGE_FORMAT_MAX_CHANGED_LINES = 1;
const IN_PROCESS_FORMAT_MAX_FILE_BYTES = 128 * 1024;
const IN_PROCESS_FORMAT_MAX_LINES = 4_000;
const TRIVIAL_TOKEN_EDIT_PATTERN = /^[A-Za-z0-9_$]+$/;

const PRETTIER_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".json",
  ".jsonc",
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
]);

const CLANG_FORMAT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
]);

const OPTIONAL_PRETTIER_PLUGIN_PACKAGES: Partial<Record<string, string[]>> = {
  ".xml": ["@prettier/plugin-xml"],
  ".svg": ["@prettier/plugin-xml"],
  ".svelte": ["prettier-plugin-svelte"],
  ".java": ["prettier-plugin-java"],
  ".kt": ["prettier-plugin-kotlin"],
  ".kts": ["prettier-plugin-kotlin"],
  ".rb": ["@prettier/plugin-ruby"],
};

const GENERATED_PATH_SEGMENTS = new Set([
  "dist",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  "node_modules",
]);
const GENERATED_FILE_PATTERNS = [/\.min\.[^.]+$/i, /\.bundle\.[^.]+$/i];
const loggedInProcessSkipReasons = new Set<string>();

const DEFAULT_FORMATTER_SETTINGS: Required<FormatterSettings> = {
  prettier: true,
  prettierPlugins: true,
  dprintPython: true,
  dprintPhp: true,
  dprintToml: true,
  dprintDockerfile: true,
  rustfmt: true,
  gofmt: true,
  clangFormat: true,
  csharpier: true,
};

function resolveFormatterSettings(
  formatterSettings?: FormatterSettings,
): Required<FormatterSettings> {
  return {
    ...DEFAULT_FORMATTER_SETTINGS,
    ...(formatterSettings ?? {}),
  };
}

function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizePathForMatching(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function exceedsLineLimit(content: string, maxLines: number): boolean {
  let lines = 1;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    lines++;
    if (lines > maxLines) {
      return true;
    }
  }

  return false;
}

function getInProcessFormatterSkipReason(
  relativePath: string,
  content: string,
): string | undefined {
  const normalizedRelativePath = normalizePathForMatching(relativePath);
  const pathSegments = normalizedRelativePath.split("/").filter(Boolean);
  if (
    pathSegments.some((segment) =>
      GENERATED_PATH_SEGMENTS.has(segment.toLowerCase()),
    )
  ) {
    return "generated-path";
  }

  const baseName =
    pathSegments[pathSegments.length - 1] ?? normalizedRelativePath;
  if (GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return "generated-file";
  }

  const fileBytes = Buffer.byteLength(content, "utf8");
  if (fileBytes > IN_PROCESS_FORMAT_MAX_FILE_BYTES) {
    return `file-too-large:${fileBytes}`;
  }

  if (exceedsLineLimit(content, IN_PROCESS_FORMAT_MAX_LINES)) {
    return `too-many-lines>${IN_PROCESS_FORMAT_MAX_LINES}`;
  }

  return undefined;
}

function logInProcessFormatterSkip(relativePath: string, reason: string): void {
  const cacheKey = `${relativePath}::${reason}`;
  if (loggedInProcessSkipReasons.has(cacheKey)) {
    return;
  }

  loggedInProcessSkipReasons.add(cacheKey);
  console.warn(
    `[formatWithPrettier] Skipping in-process formatting for ${relativePath} (${reason}) to keep edits responsive.`,
  );
}

function getModuleResolutionPaths(cwd?: string): string[] {
  const candidates = [
    cwd,
    cwd ? path.join(cwd, "src") : undefined,
    cwd ? path.join(cwd, "webview-ui") : undefined,
    __dirname,
    process.cwd(),
    path.resolve(__dirname, "../../../"),
  ];

  return [
    ...new Set(
      candidates
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => path.resolve(candidate)),
    ),
  ];
}

function resolveModulePath(moduleName: string, cwd?: string): string {
  return require.resolve(moduleName, {
    paths: getModuleResolutionPaths(cwd),
  });
}

function isMissingModuleError(error: unknown, moduleName: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes(`Cannot find module '${moduleName}'`) ||
    error.message.includes(`Cannot find package '${moduleName}'`)
  );
}

function markPrettierUnavailable(error: unknown): void {
  prettierModuleUnavailable = true;
  prettierModulePromise = undefined;
  prettierApiPromise = undefined;
  optionalPrettierPluginPromiseByKey.clear();
  prettierConfigCache.clear();

  if (!hasLoggedMissingPrettierWarning) {
    hasLoggedMissingPrettierWarning = true;
    console.warn(
      `[formatWithPrettier] Prettier is unavailable in this runtime. Skipping Prettier-based formatting until reload. ${formatErrorForLog(error)}`,
    );
  }
}

async function getPrettierModule(
  cwd?: string,
): Promise<PrettierModule | undefined> {
  if (prettierModuleUnavailable) {
    return undefined;
  }

  if (!prettierModulePromise) {
    const next = (async () => {
      let resolvedPath: string | undefined;

      try {
        resolvedPath = resolveModulePath("prettier", cwd);
        return require(resolvedPath) as PrettierModule;
      } catch (requireError) {
        try {
          const importPath = resolvedPath ?? resolveModulePath("prettier", cwd);
          return await import(pathToFileURL(importPath).href);
        } catch (resolvedImportError) {
          try {
            return await import("prettier");
          } catch (importError) {
            if (
              isMissingModuleError(importError, "prettier") ||
              isMissingModuleError(resolvedImportError, "prettier") ||
              isMissingModuleError(requireError, "prettier")
            ) {
              markPrettierUnavailable(requireError);
              return undefined;
            }

            console.warn(`[formatWithPrettier] Failed to load Prettier via require, resolved import, and package import.
require: ${formatErrorForLog(requireError)}
resolvedImport: ${formatErrorForLog(resolvedImportError)}
import: ${formatErrorForLog(importError)}`);
            throw requireError;
          }
        }
      }
    })().catch((error) => {
      if (prettierModulePromise === next) {
        prettierModulePromise = undefined;
      }
      throw error;
    });

    prettierModulePromise = next;
  }

  return prettierModulePromise;
}

async function getPrettierApi(cwd?: string): Promise<PrettierApi | undefined> {
  if (prettierModuleUnavailable) {
    return undefined;
  }

  if (!prettierApiPromise) {
    const next = getPrettierModule(cwd)
      .then((prettierModule) =>
        prettierModule ? normalizePrettierApi(prettierModule) : undefined,
      )
      .catch((error) => {
        if (prettierApiPromise === next) {
          prettierApiPromise = undefined;
        }
        throw error;
      });

    prettierApiPromise = next;
  }

  return prettierApiPromise;
}

async function getDprintFormatterModule(): Promise<DprintFormatterApi> {
  if (!dprintFormatterPromise) {
    dprintFormatterPromise = Promise.resolve(
      require("@dprint/formatter") as DprintFormatterApi,
    );
  }

  return dprintFormatterPromise;
}

async function getDprintPluginModule(
  packageName: string,
): Promise<DprintPluginModule> {
  const existing = dprintPluginPromiseByPackage.get(packageName);
  if (existing) {
    return existing;
  }

  const next = Promise.resolve(require(packageName) as DprintPluginModule);
  dprintPluginPromiseByPackage.set(packageName, next);
  return next;
}

async function getOptionalPrettierPluginModules(
  cwd: string,
  packageNames: string[],
): Promise<PrettierPlugins> {
  const cacheKey = `${cwd}::${packageNames.join("|")}`;
  const existing = optionalPrettierPluginPromiseByKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  const next = (async () => {
    const loadedPlugins: PrettierPlugin[] = [];

    for (const packageName of packageNames) {
      try {
        const resolvedPath = resolveModulePath(packageName, cwd);
        const pluginModule = require(resolvedPath);
        loadedPlugins.push((pluginModule as any).default ?? pluginModule);
      } catch (error) {
        console.warn(
          `[formatWithPrettier] Optional plugin ${packageName} not available for ${cwd}. ${formatErrorForLog(error)}`,
        );
      }
    }

    return loadedPlugins;
  })();

  optionalPrettierPluginPromiseByKey.set(cacheKey, next);
  return next;
}

function normalizePrettierApi(prettierModule: PrettierModule): PrettierApi {
  const candidate = ((prettierModule as any).default ??
    prettierModule) as Partial<PrettierApi>;

  if (
    typeof candidate.resolveConfig !== "function" ||
    typeof candidate.format !== "function"
  ) {
    throw new TypeError(
      "Loaded Prettier module does not expose resolveConfig/format in the expected shape.",
    );
  }

  return candidate as PrettierApi;
}

function getChangedRange(
  previousContent: string | undefined,
  content: string,
): { start: number; previousEnd: number; nextEnd: number } | undefined {
  if (typeof previousContent !== "string" || previousContent === content) {
    return undefined;
  }

  const sharedLength = Math.min(previousContent.length, content.length);
  let start = 0;
  while (start < sharedLength && previousContent[start] === content[start]) {
    start++;
  }

  let previousEnd = previousContent.length;
  let nextEnd = content.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousContent[previousEnd - 1] === content[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  if (nextEnd - start <= 0) {
    return undefined;
  }

  return { start, previousEnd, nextEnd };
}

function shouldSkipFormattingForTrivialEdit(
  previousContent: string | undefined,
  content: string,
): boolean {
  const range = getChangedRange(previousContent, content);
  if (!range) {
    return false;
  }

  const previousChangedText = previousContent!.slice(
    range.start,
    range.previousEnd,
  );
  const nextChangedText = content.slice(range.start, range.nextEnd);
  if (
    previousChangedText.length === 0 ||
    nextChangedText.length === 0 ||
    previousChangedText.includes("\n") ||
    nextChangedText.includes("\n") ||
    !TRIVIAL_TOKEN_EDIT_PATTERN.test(previousChangedText) ||
    !TRIVIAL_TOKEN_EDIT_PATTERN.test(nextChangedText)
  ) {
    return false;
  }

  return true;
}

function getPrettierRangeFormatOptions(
  previousContent: string | undefined,
  content: string,
): { rangeStart: number; rangeEnd: number } | undefined {
  const range = getChangedRange(previousContent, content);
  if (!range) {
    return undefined;
  }

  const changedSpan = range.nextEnd - range.start;
  if (changedSpan >= content.length * PRETTIER_RANGE_FORMAT_MAX_FILE_FRACTION) {
    return undefined;
  }

  const previousChangedText = previousContent!.slice(
    range.start,
    range.previousEnd,
  );
  const nextChangedText = content.slice(range.start, range.nextEnd);
  if (
    previousChangedText.split("\n").length - 1 >
      PRETTIER_RANGE_FORMAT_MAX_CHANGED_LINES ||
    nextChangedText.split("\n").length - 1 >
      PRETTIER_RANGE_FORMAT_MAX_CHANGED_LINES
  ) {
    return undefined;
  }

  const rangeStart = content.lastIndexOf("\n", Math.max(0, range.start - 1));
  const normalizedRangeStart = rangeStart === -1 ? 0 : rangeStart + 1;
  const rangeEnd = content.indexOf("\n", range.nextEnd);
  const normalizedRangeEnd = rangeEnd === -1 ? content.length : rangeEnd;

  if (normalizedRangeStart >= normalizedRangeEnd) {
    return {
      rangeStart: range.start,
      rangeEnd: range.nextEnd,
    };
  }

  return {
    rangeStart: normalizedRangeStart,
    rangeEnd: normalizedRangeEnd,
  };
}

async function getDprintFormatter(
  cacheKey: string,
  factory: (api: DprintFormatterApi) => Promise<DprintFormatter>,
): Promise<DprintFormatter> {
  const existing = dprintFormatterCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const next = (async () => factory(await getDprintFormatterModule()))();
  dprintFormatterCache.set(cacheKey, next);
  return next;
}

function getCachedPromise<T>(
  cache: Map<string, CachedPromiseEntry<T>>,
  cacheKey: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const next = factory().catch((error) => {
    if (cache.get(cacheKey)?.promise === next) {
      cache.delete(cacheKey);
    }
    throw error;
  });

  cache.set(cacheKey, {
    expiresAt: now + ttlMs,
    promise: next,
  });

  return next;
}

async function formatWithPrettierEngine(
  absolutePath: string,
  content: string,
  plugins: PrettierPlugins = [],
  pluginCacheKey = "",
  previousContent?: string,
  cwd?: string,
): Promise<string> {
  const prettier = await getPrettierApi(cwd);
  if (!prettier) {
    return content;
  }
  const config = await getCachedPromise(
    prettierConfigCache,
    `${absolutePath}::${pluginCacheKey}`,
    PRETTIER_CONFIG_CACHE_TTL_MS,
    () =>
      prettier.resolveConfig(absolutePath, {
        useCache: true,
      }),
  );

  return await prettier.format(content, {
    ...(config ?? {}),
    filepath: absolutePath,
    plugins,
    ...getPrettierRangeFormatOptions(previousContent, content),
  });
}

async function formatWithDprintRuff(
  absolutePath: string,
  content: string,
): Promise<string> {
  const formatter = await getDprintFormatter("dprint-ruff", async (api) => {
    const plugin = await getDprintPluginModule("@dprint/ruff");
    return api.createFromBuffer((plugin as any).getBuffer());
  });

  return formatter.formatText({
    filePath: absolutePath,
    fileText: content,
  });
}

async function formatWithDprintMago(
  absolutePath: string,
  content: string,
): Promise<string> {
  const formatter = await getDprintFormatter("dprint-mago", async (api) => {
    const plugin = await getDprintPluginModule("@dprint/mago");
    return api.createFromBuffer((plugin as any).getBuffer());
  });

  return formatter.formatText({
    filePath: absolutePath,
    fileText: content,
  });
}

async function formatWithDprintContext(
  cacheKey: string,
  pluginPackageName: "@dprint/toml" | "@dprint/dockerfile",
  absolutePath: string,
  content: string,
): Promise<string> {
  const formatter = await getDprintFormatter(cacheKey, async (api) => {
    const plugin = await getDprintPluginModule(pluginPackageName);
    const context = api.createContext();
    context.addPlugin(fsSyncReadFile((plugin as any).getPath()));
    return {
      formatText(request) {
        return context.formatText(
          typeof request === "string"
            ? { filePath: absolutePath, fileText: request }
            : request,
        );
      },
    };
  });

  return formatter.formatText({
    filePath: absolutePath,
    fileText: content,
  });
}

function fsSyncReadFile(filePath: string): Buffer {
  return require("fs").readFileSync(filePath);
}

async function commandExists(command: string): Promise<boolean> {
  const existing = cliAvailabilityPromiseByCommand.get(command);
  if (existing) {
    return existing;
  }

  const next = (async () => {
    try {
      await execFile(process.platform === "win32" ? "where" : "which", [
        command,
      ]);
      return true;
    } catch {
      return false;
    }
  })();

  cliAvailabilityPromiseByCommand.set(command, next);
  return next;
}

export async function getCliFormatterAvailability(): Promise<FormatterAvailability> {
  const [rustfmt, gofmt, clangFormat, csharpier] = await Promise.all([
    commandExists("rustfmt"),
    commandExists("gofmt"),
    commandExists("clang-format"),
    commandExists("csharpier"),
  ]);

  return {
    rustfmt,
    gofmt,
    clangFormat,
    csharpier,
  };
}

async function formatWithCliFormatter(
  command: string,
  args: string[],
  absolutePath: string,
  content: string,
): Promise<string> {
  if (!(await commandExists(command))) {
    console.warn(
      `[formatWithPrettier] Skipping ${command} for ${absolutePath}: command not found.`,
    );
    return content;
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `${command}-format-`),
  );
  const tempPath = path.join(tempDir, path.basename(absolutePath));

  try {
    await fs.writeFile(tempPath, content, "utf8");
    const { stdout } = await execFile(command, [...args, tempPath], {
      cwd: path.dirname(absolutePath),
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout || content;
  } finally {
    await fs
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

async function formatWithClangFormat(
  absolutePath: string,
  content: string,
): Promise<string> {
  return await formatWithCliFormatter(
    "clang-format",
    ["-style=file"],
    absolutePath,
    content,
  );
}

async function formatWithCSharpier(
  absolutePath: string,
  content: string,
): Promise<string> {
  return await formatWithCliFormatter(
    "csharpier",
    ["format", "--write-stdout"],
    absolutePath,
    content,
  );
}

function isDockerfile(relativePath: string): boolean {
  const base = path.basename(relativePath).toLowerCase();
  return base === "dockerfile" || base.endsWith(".dockerfile");
}

/**
 * Best-effort final-pass formatting for tool-written content.
 * Falls back to raw content on any formatter failure to avoid data loss.
 */
export async function formatWithPrettier({
  cwd,
  relativePath,
  content,
  previousContent,
  formatterSettings,
}: FormatWithPrettierParams): Promise<string> {
  if (!relativePath || typeof content !== "string") {
    return content;
  }

  const absolutePath = path.resolve(cwd, relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  const settings = resolveFormatterSettings(formatterSettings);
  const inProcessFormatterSkipReason = getInProcessFormatterSkipReason(
    relativePath,
    content,
  );

  if (shouldSkipFormattingForTrivialEdit(previousContent, content)) {
    return content;
  }

  if (inProcessFormatterSkipReason) {
    logInProcessFormatterSkip(relativePath, inProcessFormatterSkipReason);
  }

  try {
    if (
      !inProcessFormatterSkipReason &&
      settings.prettier &&
      PRETTIER_EXTENSIONS.has(extension)
    ) {
      return await formatWithPrettierEngine(
        absolutePath,
        content,
        [],
        "",
        previousContent,
        cwd,
      );
    }

    const optionalPluginPackages = OPTIONAL_PRETTIER_PLUGIN_PACKAGES[extension];
    if (
      !inProcessFormatterSkipReason &&
      settings.prettierPlugins &&
      optionalPluginPackages?.length
    ) {
      const plugins = await getOptionalPrettierPluginModules(
        cwd,
        optionalPluginPackages,
      );
      if (plugins.length > 0) {
        return await formatWithPrettierEngine(
          absolutePath,
          content,
          plugins,
          optionalPluginPackages.join("|"),
          previousContent,
          cwd,
        );
      }
    }

    if (
      !inProcessFormatterSkipReason &&
      settings.dprintPython &&
      extension === ".py"
    ) {
      return await formatWithDprintRuff(absolutePath, content);
    }

    if (
      !inProcessFormatterSkipReason &&
      settings.dprintPhp &&
      extension === ".php"
    ) {
      return await formatWithDprintMago(absolutePath, content);
    }

    if (
      !inProcessFormatterSkipReason &&
      settings.dprintToml &&
      extension === ".toml"
    ) {
      return await formatWithDprintContext(
        "dprint-toml",
        "@dprint/toml",
        absolutePath,
        content,
      );
    }

    if (
      !inProcessFormatterSkipReason &&
      settings.dprintDockerfile &&
      isDockerfile(relativePath)
    ) {
      return await formatWithDprintContext(
        "dprint-dockerfile",
        "@dprint/dockerfile",
        absolutePath,
        content,
      );
    }

    if (settings.rustfmt && extension === ".rs") {
      return await formatWithCliFormatter(
        "rustfmt",
        ["--quiet", "--emit", "stdout"],
        absolutePath,
        content,
      );
    }

    if (settings.gofmt && extension === ".go") {
      return await formatWithCliFormatter("gofmt", [], absolutePath, content);
    }

    if (settings.clangFormat && CLANG_FORMAT_EXTENSIONS.has(extension)) {
      return await formatWithClangFormat(absolutePath, content);
    }

    if (settings.csharpier && extension === ".cs") {
      return await formatWithCSharpier(absolutePath, content);
    }

    return content;
  } catch (error) {
    console.warn(
      `[formatWithPrettier] Formatting failed for ${absolutePath}, falling back to raw content.\n${formatErrorForLog(error)}`,
    );
    return content;
  }
}
