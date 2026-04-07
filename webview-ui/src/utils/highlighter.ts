import {
  createHighlighter,
  type Highlighter,
  type BundledTheme,
  type BundledLanguage,
  bundledThemes,
} from "shiki";

// Extend BundledLanguage to include 'txt' because Shiki supports this but it is
// not listed in the bundled languages
export type ExtendedLanguage = BundledLanguage | "txt";

const supportedBundledLanguages = [
  "applescript",
  "asm",
  "apl",
  "ada",
  "bash",
  "cobol",
  "common-lisp",
  "clojure",
  "c",
  "c#",
  "c++",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "erlang",
  "fortran-free-form",
  "fortran-fixed-form",
  "fsharp",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "ini",
  "java",
  "javascript",
  "julia",
  "json",
  "jsx",
  "latex",
  "kotlin",
  "log",
  "lua",
  "make",
  "markdown",
  "matlab",
  "nim",
  "ocaml",
  "objective-c",
  "objective-cpp",
  "pascal",
  "perl",
  "php",
  "prolog",
  "powershell",
  "python",
  "r",
  "ruby",
  "scala",
  "scheme",
  "rust",
  "scss",
  "shell",
  "smalltalk",
  "solidity",
  "sql",
  "swift",
  "tcl",
  "toml",
  "tsx",
  "typescript",
  "vue",
  "verilog",
  "vhdl",
  "wasm",
  "wolfram",
  "xml",
  "yaml",
  "zig",
] as const satisfies readonly BundledLanguage[];

const bundledLanguageSet = new Set<ExtendedLanguage>([
  ...supportedBundledLanguages,
  "txt",
]);

export const selectableLanguages = [...supportedBundledLanguages, "txt"].sort();

// Map common language aliases to their Shiki BundledLanguage equivalent
const languageAliases: Record<string, ExtendedLanguage> = {
  // Plain text variants
  text: "txt",
  plaintext: "txt",
  plain: "txt",

  // Shell/Bash variants
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shellscript: "shell",
  "shell-script": "shell",
  console: "shell",
  terminal: "shell",

  // JavaScript variants
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",

  // TypeScript variants
  ts: "typescript",

  // Python variants
  py: "python",
  python3: "python",
  py3: "python",

  // Rust variants
  rs: "rust",
  rust: "rust",

  // Go variants
  go: "go",

  // Java variants
  java: "java",

  // Ruby variants
  rb: "ruby",

  // Markdown variants
  md: "markdown",

  // C++ variants
  cpp: "c++",
  cc: "c++",
  hpp: "c++",
  "c++": "c++",

  // C variants
  c: "c",
  h: "c",

  // Assembly variants
  asm: "asm",
  assembly: "asm",
  x86asm: "asm",

  // AppleScript variants
  applescript: "applescript",

  // APL variants
  apl: "apl",

  // Ada variants
  ada: "ada",

  // C# variants
  cs: "c#",
  csharp: "c#",

  // PHP variants
  php: "php",

  // Swift variants
  swift: "swift",

  // Kotlin variants
  kt: "kotlin",
  kts: "kotlin",

  // Fortran variants
  fortran: "fortran-free-form",
  "fortran-fixed": "fortran-fixed-form",
  "fixed-form-fortran": "fortran-fixed-form",
  f90: "fortran-free-form",
  f95: "fortran-free-form",
  f03: "fortran-free-form",
  f08: "fortran-free-form",
  f18: "fortran-free-form",
  f77: "fortran-free-form",

  // Lisp variants
  lisp: "common-lisp",
  cl: "common-lisp",
  clj: "clojure",
  clojure: "clojure",

  // Erlang / Elixir
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",

  // F# variants
  "f#": "fsharp",
  fs: "fsharp",

  // Haskell variants
  hs: "haskell",

  // Julia variants
  jl: "julia",

  // LaTeX variants
  tex: "latex",

  // Matlab variants
  octave: "matlab",

  // Wolfram variants
  mathematica: "wolfram",
  wolfram: "wolfram",

  // Objective-C variants
  objc: "objective-c",
  "objective-c++": "objective-cpp",

  // OCaml variants
  ml: "ocaml",
  mli: "ocaml",

  // Pascal variants
  pas: "pascal",

  // Perl variants
  pl: "perl",

  // Prolog variants
  prolog: "prolog",

  // Tcl variants
  tcl: "tcl",

  // R variants
  rlang: "r",

  // Scala variants
  sbt: "scala",

  // Scheme variants
  scm: "scheme",

  // Zig variants
  zig: "zig",

  // HDL / low-level variants
  sv: "verilog",
  verilog: "verilog",
  vhdl: "vhdl",
  wasm: "wasm",

  // HTML variants
  htm: "html",

  // YAML variants
  yml: "yaml",

  // Docker variants
  dockerfile: "docker",

  // CSS variants
  styles: "css",
  style: "css",

  // JSON variants
  jsonc: "json",
  json5: "json",

  // XML variants
  xaml: "xml",
  xhtml: "xml",
  svg: "xml",

  // SQL variants
  mysql: "sql",
  postgresql: "sql",
  postgres: "sql",
  pgsql: "sql",
  plsql: "sql",
  oracle: "sql",
};

// Track which languages we've warned about to avoid duplicate warnings
const warnedLanguages = new Set<string>();

// Normalize language to a valid Shiki language
export function normalizeLanguage(
  language: string | undefined,
): ExtendedLanguage {
  if (language === undefined) {
    return "txt";
  }

  // Convert to lowercase for consistent matching
  const normalizedInput = language.toLowerCase();

  // If it's already a valid bundled language, return it
  if (bundledLanguageSet.has(normalizedInput as ExtendedLanguage)) {
    return normalizedInput as ExtendedLanguage;
  }

  // Check if it's an alias
  if (normalizedInput in languageAliases) {
    return languageAliases[normalizedInput];
  }

  // Warn about unrecognized language and default to txt (only once per language)
  if (language !== "txt" && !warnedLanguages.has(language)) {
    console.warn(
      `[Shiki] Unrecognized language '${language}', defaulting to txt.`,
    );
    warnedLanguages.add(language);
  }

  return "txt";
}

// Export function to check if a language is loaded
export const isLanguageLoaded = (language: string): boolean => {
  return state.loadedLanguages.has(normalizeLanguage(language));
};

// Artificial delay for testing language loading (ms) - for testing
const LANGUAGE_LOAD_DELAY = 0;

// Common languages for first-stage initialization
const initialLanguages: BundledLanguage[] = ["shell", "log"];

// Singleton state
const state: {
  instance: Highlighter | null;
  instanceInitPromise: Promise<Highlighter> | null;
  loadedLanguages: Set<ExtendedLanguage>;
  pendingLanguageLoads: Map<ExtendedLanguage, Promise<void>>;
} = {
  instance: null,
  instanceInitPromise: null,
  loadedLanguages: new Set<ExtendedLanguage>(["txt"]),
  pendingLanguageLoads: new Map(),
};

export const getHighlighter = async (
  language?: string,
): Promise<Highlighter> => {
  try {
    const shikilang = normalizeLanguage(language);

    // Initialize highlighter if needed
    if (!state.instanceInitPromise) {
      state.instanceInitPromise = (async () => {
        // const startTime = performance.now()
        // console.debug("[Shiki] Initialization started...")

        const instance = await createHighlighter({
          themes: Object.keys(bundledThemes) as BundledTheme[],
          langs: initialLanguages,
        });

        // const elapsed = Math.round(performance.now() - startTime)
        // console.debug(`[Shiki] Initialization complete (${elapsed}ms)`)

        state.instance = instance;

        // Track initially loaded languages
        initialLanguages.forEach((lang) => state.loadedLanguages.add(lang));

        return instance;
      })();
    }

    // Wait for initialization to complete
    const instance = await state.instanceInitPromise;

    // Load requested language if needed (txt is already in loadedLanguages)
    if (!state.loadedLanguages.has(shikilang)) {
      // Check for existing pending load
      let loadingPromise = state.pendingLanguageLoads.get(shikilang);

      if (!loadingPromise) {
        // const loadStart = performance.now()
        // Create new loading promise
        loadingPromise = (async () => {
          try {
            // Add artificial delay for testing if nonzero
            if (LANGUAGE_LOAD_DELAY > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, LANGUAGE_LOAD_DELAY),
              );
            }

            await instance.loadLanguage(shikilang as BundledLanguage);
            state.loadedLanguages.add(shikilang);

            // const loadTime = Math.round(performance.now() - loadStart)
            // console.debug(`[Shiki] Loaded language ${shikilang} (${loadTime}ms)`)
          } catch (error) {
            console.error(
              `[Shiki] Failed to load language ${shikilang}:`,
              error,
            );
            throw error;
          } finally {
            // Clean up pending promise after completion
            state.pendingLanguageLoads.delete(shikilang);
          }
        })();

        // Store the promise
        state.pendingLanguageLoads.set(shikilang, loadingPromise);
      }

      await loadingPromise;
    }

    return instance;
  } catch (error) {
    console.error("[Shiki] Error in getHighlighter:", error);
    throw error;
  }
};
