import { HTMLAttributes, useState } from "react";
import {
  Braces,
  CheckCircle2,
  Copy,
  Info,
  Terminal,
} from "lucide-react";
import {
  type FormatterAvailability,
  type FormatterSettings as FormatterSettingsState,
} from "@roo-code/types";

import { Section } from "./Section";
import { SetCachedStateField } from "./types";
import { Checkbox, StandardTooltip } from "../ui";
import { useClipboard } from "../ui/hooks";
import { useRegisterSetting } from "./useSettingsSearch";

type FormatterSettingsProps = HTMLAttributes<HTMLDivElement> & {
  formatterSettings?: FormatterSettingsState;
  formatterAvailability?: FormatterAvailability;
  setCachedStateField: SetCachedStateField<"formatterSettings">;
};

const DEFAULT_SETTINGS: Required<FormatterSettingsState> = {
  prettier: false,
  prettierPlugins: false,
  dprintPython: false,
  dprintPhp: false,
  dprintToml: false,
  dprintDockerfile: false,
  rustfmt: false,
  gofmt: false,
  clangFormat: false,
  csharpier: false,
};

type FormatterSettingKey = keyof FormatterSettingsState;
type CliFormatterKey = keyof FormatterAvailability;

type BuiltInFormatterRow = {
  key: FormatterSettingKey;
  label: string;
  description: string;
  status: string;
  cliKey?: never;
};

type CliFormatterRow = {
  key: FormatterSettingKey;
  label: string;
  description: string;
  cliKey: CliFormatterKey;
  status?: never;
};

type FormatterRow = BuiltInFormatterRow | CliFormatterRow;

const formatterRows: readonly FormatterRow[] = [
  {
    key: "prettier",
    label: "Prettier",
    description:
      "Formats JavaScript, TypeScript, JSX, TSX, JSON, CSS, SCSS, Less, HTML, Vue, Angular templates, Markdown, MDX, YAML, and GraphQL.",
    status: "Built in",
  },
  {
    key: "prettierPlugins",
    label: "Prettier plugins",
    description:
      "Optional plugin-based support for XML, SVG, Svelte, Java, Kotlin, and Ruby.",
    status: "Built in + installed plugins",
  },
  {
    key: "dprintPython",
    label: "Ruff",
    description: "Formats Python files via the bundled dprint Ruff plugin.",
    status: "Built in",
  },
  {
    key: "dprintPhp",
    label: "Mago",
    description: "Formats PHP files via the bundled dprint Mago plugin.",
    status: "Built in",
  },
  {
    key: "dprintToml",
    label: "TOML",
    description: "Formats TOML files via dprint.",
    status: "Built in",
  },
  {
    key: "dprintDockerfile",
    label: "Dockerfile",
    description: "Formats Dockerfiles and `*.dockerfile` files via dprint.",
    status: "Built in",
  },
  {
    key: "rustfmt",
    label: "rustfmt",
    description: "Formats Rust files via the `rustfmt` CLI.",
    cliKey: "rustfmt",
  },
  {
    key: "gofmt",
    label: "gofmt",
    description: "Formats Go files via the `gofmt` CLI.",
    cliKey: "gofmt",
  },
  {
    key: "clangFormat",
    label: "clang-format",
    description: "Formats C and C++ files via the `clang-format` CLI.",
    cliKey: "clangFormat",
  },
  {
    key: "csharpier",
    label: "CSharpier",
    description: "Formats C# files via the `csharpier` CLI.",
    cliKey: "csharpier",
  },
];

const cliFormatterInstallGuides: ReadonlyArray<{
  key: CliFormatterKey;
  label: string;
  installCommand: string;
  verifyCommand: string;
  note: string;
}> = [
  {
    key: "rustfmt",
    label: "rustfmt",
    installCommand: "rustup component add rustfmt",
    verifyCommand: "rustfmt --version",
    note: "Requires Rust toolchain via `rustup`.",
  },
  {
    key: "gofmt",
    label: "gofmt",
    installCommand: "brew install go",
    verifyCommand: "which gofmt",
    note: "`gofmt` ships with Go. Homebrew command shown for macOS.",
  },
  {
    key: "clangFormat",
    label: "clang-format",
    installCommand: "brew install clang-format",
    verifyCommand: "clang-format --version",
    note: "Homebrew command shown for macOS.",
  },
  {
    key: "csharpier",
    label: "CSharpier",
    installCommand: "dotnet tool install -g csharpier",
    verifyCommand: "csharpier --version",
    note: "Requires the .NET SDK.",
  },
];

export const FormatterSettings = ({
  formatterSettings,
  formatterAvailability,
  setCachedStateField,
  ...props
}: FormatterSettingsProps) => {
  const { copy } = useClipboard();
  const [copiedFormatter, setCopiedFormatter] = useState<string | null>(null);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(formatterSettings ?? {}),
  };

  useRegisterSetting({
    settingId: "formatters-overview",
    section: "formatters",
    label: "Formatter pipeline",
  });

  const updateFormatter = (
    key: keyof FormatterSettingsState,
    enabled: boolean,
  ) => {
    setCachedStateField("formatterSettings", {
      ...settings,
      [key]: enabled,
    });
  };

  return (
    <div {...props}>
      <Section className="flex flex-col gap-6">
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
              <Braces className="size-4 text-white/80" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                Formatter pipeline
                <StandardTooltip content="All formatters are disabled by default. Enable any formatter to add it to the post-processing step that runs after agent writes and edits.">

                  <Info className="size-3.5 cursor-help text-vscode-descriptionForeground" />
                </StandardTooltip>
              </div>
              <p className="mt-1 text-sm leading-6 text-vscode-descriptionForeground">
                Experimental post-processing that runs after agent writes and
                edits. It can improve output quality and edit accuracy, but may
                also cause slower responses depending on the enabled formatters.
              </p>
            </div>
          </div>
        </div>

        <div
          className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 shadow-xl"
          data-setting-id="formatters-overview"
        >
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <Terminal className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Available formatters
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {formatterRows.map((formatter) => {
              const availability =
                formatter.cliKey === undefined
                  ? null
                  : formatterAvailability?.[formatter.cliKey] ?? false;
              const installGuide = formatter.cliKey
                ? cliFormatterInstallGuides.find(
                    (guide) => guide.key === formatter.key,
                  )
                : undefined;

              return (
                <div
                  key={formatter.key}
                  className="rounded-2xl border border-white/[0.06] bg-black/10 px-4 py-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <Checkbox
                        checked={settings[formatter.key]}
                        onCheckedChange={(checked) =>
                          updateFormatter(formatter.key, checked === true)
                        }
                        className="mt-0.5 data-[state=checked]:[&_svg]:!text-black"
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-medium text-white/90">
                          {formatter.label}
                        </span>
                        <span className="text-xs leading-5 text-vscode-descriptionForeground">
                          {formatter.description}
                        </span>
                      </div>
                    </label>

                    <div className="self-start text-xs sm:shrink-0">
                      {formatter.cliKey ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
                            availability
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "bg-white/[0.06] text-vscode-descriptionForeground"
                          }`}
                        >
                          {availability ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : (
                            <Info className="size-3.5" />
                          )}
                          {availability ? "Installed" : "Manual install"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-vscode-descriptionForeground">
                          {formatter.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {formatter.cliKey && !availability && installGuide && (
                    <div className="mt-3 flex flex-col gap-2 overflow-hidden rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2 font-mono text-[11px] text-vscode-descriptionForeground sm:ml-9 sm:flex-row sm:items-center">
                      <Terminal className="size-3.5 shrink-0 text-white/45" />
                      <span className="min-w-0 break-all text-white/85 sm:truncate">
                        {installGuide.installCommand}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          copy(installGuide.installCommand);
                          setCopiedFormatter(formatter.key);
                          window.setTimeout(() => {
                            setCopiedFormatter((current) =>
                              current === formatter.key ? null : current,
                            );
                          }, 2000);
                        }}
                        className="inline-flex shrink-0 self-start items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white sm:ml-auto"
                      >
                        <Copy className="size-3" />
                        {copiedFormatter === formatter.key ? "Copied" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Section>
    </div>
  );
};
