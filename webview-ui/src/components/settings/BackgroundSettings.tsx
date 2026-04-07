import { HTMLAttributes, useMemo } from "react";
import type { ToolHeaderBackgroundConfig } from "@roo-code/types";
import { FolderOpen, ImageIcon, RefreshCcw } from "lucide-react";
import { useEmptyStateBackgrounds } from "@/hooks/useEmptyStateBackgrounds";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui";

import { Section } from "./Section";
import { SetCachedStateField } from "./types";
import { useRegisterSetting } from "./useSettingsSearch";

type BackgroundSettingsProps = HTMLAttributes<HTMLDivElement> & {
  emptyStateBackground?: string;
  chatBackground?: string;
  toolHeaderBackgrounds?: ToolHeaderBackgroundConfig;
  setCachedStateField: SetCachedStateField<
    "emptyStateBackground" | "chatBackground" | "toolHeaderBackgrounds"
  >;
};

export const BackgroundSettings = ({
  emptyStateBackground,
  chatBackground,
  toolHeaderBackgrounds,
  setCachedStateField,
  ...props
}: BackgroundSettingsProps) => {
  const TOOL_HEADER_BACKGROUND_NONE = "__tool-header-none__";
  const TOOL_HEADER_BACKGROUND_INHERIT = "__tool-header-inherit__";

  useRegisterSetting({
    settingId: "display-chat-background",
    section: "backgrounds",
    label: "Chat background",
  });
  useRegisterSetting({
    settingId: "display-empty-state-background",
    section: "backgrounds",
    label: "Home screen background",
  });
  useRegisterSetting({
    settingId: "display-tool-header-background-global",
    section: "backgrounds",
    label: "Global tool header background",
  });
  useRegisterSetting({
    settingId: "display-tool-header-background-bash",
    section: "backgrounds",
    label: "Bash tool header background",
  });
  useRegisterSetting({
    settingId: "display-tool-header-background-edit",
    section: "backgrounds",
    label: "Edit tool header background",
  });
  useRegisterSetting({
    settingId: "display-tool-header-background-write",
    section: "backgrounds",
    label: "Write tool header background",
  });

  const {
    folderPath,
    options: backgroundOptions,
    isLoading: isLoadingBackgroundOptions,
    error: backgroundOptionsError,
    refresh: refreshBackgroundOptions,
    openFolder: openBackgroundFolder,
  } = useEmptyStateBackgrounds();

  const selectedBackgroundOption = backgroundOptions.find(
    (option) => option.file === emptyStateBackground,
  );
  const selectedChatBackgroundOption = backgroundOptions.find(
    (option) => option.file === chatBackground,
  );

  const toolHeaderBackgroundControls = useMemo(
    () =>
      [
        {
          key: "global",
          title: "Global tool header background",
          description:
            "Used for bash, edit, and write headers unless a tool override is selected.",
          emptyLabel: "Use built-in header styling",
          settingId: "display-tool-header-background-global",
          fallbackPreviewLabel: "Default",
        },
        {
          key: "bash",
          title: "Bash header override",
          description: "Only affects terminal tool headers.",
          emptyLabel: "Use global tool header background",
          settingId: "display-tool-header-background-bash",
          fallbackPreviewLabel: "Global",
        },
        {
          key: "edit",
          title: "Edit header override",
          description: "Only affects edit tool headers.",
          emptyLabel: "Use global tool header background",
          settingId: "display-tool-header-background-edit",
          fallbackPreviewLabel: "Global",
        },
        {
          key: "write",
          title: "Write header override",
          description: "Only affects write tool headers.",
          emptyLabel: "Use global tool header background",
          settingId: "display-tool-header-background-write",
          fallbackPreviewLabel: "Global",
        },
      ] satisfies Array<{
        key: keyof ToolHeaderBackgroundConfig;
        title: string;
        description: string;
        emptyLabel: string;
        settingId: string;
        fallbackPreviewLabel: string;
      }>,
    [],
  );

  const updateToolHeaderBackground = (
    key: keyof ToolHeaderBackgroundConfig,
    nextValue: string,
  ) => {
    const nextBackgrounds: ToolHeaderBackgroundConfig = {
      ...(toolHeaderBackgrounds ?? {}),
    };

    if (nextValue) {
      nextBackgrounds[key] = nextValue;
    } else {
      delete nextBackgrounds[key];
    }

    setCachedStateField(
      "toolHeaderBackgrounds",
      Object.keys(nextBackgrounds).length > 0 ? nextBackgrounds : {},
    );
  };

  const renderBackgroundPicker = ({
    title,
    description,
    settingId,
    selectedValue,
    selectedOption,
    onSelect,
    defaultDescription,
  }: {
    title: string;
    description: string;
    settingId: string;
    selectedValue?: string;
    selectedOption?: { file: string; label: string; uri: string };
    onSelect: (value: string) => void;
    defaultDescription: string;
  }) => (
    <div
      className="rounded-xl border border-vscode-input-border/30 bg-vscode-editor-background/20 p-4 flex flex-col gap-4"
      data-setting-id={settingId}
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed mt-1">
          {description}
        </div>
      </div>

      {selectedOption === undefined &&
        selectedValue &&
        !isLoadingBackgroundOptions && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
            The selected background is missing from the folder. Pick a new image
            or switch back to the default background.
          </div>
        )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={`text-left rounded-xl border p-3 transition-all ${
            !selectedValue
              ? "border-white/40 bg-white/[0.08]"
              : "border-vscode-input-border/30 bg-vscode-editor-background/20 hover:border-white/20 hover:bg-white/[0.04]"
          }`}
          onClick={() => onSelect("")}
        >
          <div className="aspect-[16/10] rounded-lg border border-dashed border-vscode-input-border/40 bg-[radial-gradient(circle_at_top,_rgba(74,158,255,0.16),_transparent_58%),linear-gradient(180deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.01))]" />
          <div className="mt-3 text-sm font-medium">Default</div>
          <div className="text-[11px] text-vscode-descriptionForeground mt-1">
            {defaultDescription}
          </div>
        </button>

        {backgroundOptions.map((option) => {
          const isSelected = option.file === selectedValue;

          return (
            <button
              key={`${settingId}-${option.file}`}
              type="button"
              className={`text-left rounded-xl border p-3 transition-all ${
                isSelected
                  ? "border-white/40 bg-white/[0.08]"
                  : "border-vscode-input-border/30 bg-vscode-editor-background/20 hover:border-white/20 hover:bg-white/[0.04]"
              }`}
              onClick={() => onSelect(option.file)}
            >
              <img
                src={option.uri}
                alt={option.label}
                className="aspect-[16/10] w-full rounded-lg object-cover border border-vscode-input-border/20"
              />
              <div className="mt-3 text-sm font-medium truncate">
                {option.label}
              </div>
              <div className="text-[11px] text-vscode-descriptionForeground mt-1 truncate">
                {option.file}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div {...props}>
      <Section className="flex flex-col gap-6">
        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <ImageIcon className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Background Gallery
            </span>
          </div>

          <div
            className="flex flex-col gap-4"
            data-setting-id="display-empty-state-background"
          >
            <div className="flex flex-col md:flex-row items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">
                  Shared background image folder
                </div>
                <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed mt-1">
                  Add `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, or `.avif` files
                  to this folder, then use them for the home screen, active
                  chat, and tool headers.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openBackgroundFolder}
                  className="gap-2"
                >
                  <FolderOpen className="size-3.5" />
                  Open Folder
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void refreshBackgroundOptions()}
                  className="gap-2"
                >
                  <RefreshCcw className="size-3.5" />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-vscode-input-border/40 bg-vscode-input-background/35 px-3 py-2 overflow-hidden">
              <div className="text-[10px] uppercase tracking-widest text-vscode-descriptionForeground mb-1">
                Folder
              </div>
              <div className="text-[11px] font-mono break-all text-vscode-foreground/90">
                {folderPath || "Loading folder location..."}
              </div>
            </div>

            {backgroundOptionsError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                {backgroundOptionsError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {renderBackgroundPicker({
                title: "Home screen background",
                description:
                  "Shows behind the empty state, stars, and recent chat cards.",
                settingId: "display-empty-state-background",
                selectedValue: emptyStateBackground,
                selectedOption: selectedBackgroundOption,
                onSelect: (value) =>
                  setCachedStateField("emptyStateBackground", value),
                defaultDescription: "Keep the built-in empty state visuals.",
              })}
              {renderBackgroundPicker({
                title: "Chat background",
                description:
                  "Shows behind the active conversation while a task is open.",
                settingId: "display-chat-background",
                selectedValue: chatBackground,
                selectedOption: selectedChatBackgroundOption,
                onSelect: (value) =>
                  setCachedStateField("chatBackground", value),
                defaultDescription: "Keep the standard chat canvas.",
              })}
            </div>

            {!isLoadingBackgroundOptions && backgroundOptions.length === 0 && (
              <div className="rounded-lg border border-vscode-input-border/30 bg-vscode-editor-background/20 px-3 py-3 text-[11px] text-vscode-descriptionForeground">
                No background images were found yet. Drop files into the folder
                above, then press Refresh.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
          <div className="flex items-center gap-2 border-b border-vscode-input-border/50 pb-2">
            <ImageIcon className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
              Tool Header Backgrounds
            </span>
          </div>

          <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed">
            These selectors reuse the same background folder above. Pick one
            shared texture for all tool headers, then override bash, edit, or
            write only when you want something different.
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {toolHeaderBackgroundControls.map((control) => {
              const selectedFile = toolHeaderBackgrounds?.[control.key] ?? "";
              const selectedOption = backgroundOptions.find(
                (option) => option.file === selectedFile,
              );
              const selectValue =
                selectedFile ||
                (control.key === "global"
                  ? TOOL_HEADER_BACKGROUND_NONE
                  : TOOL_HEADER_BACKGROUND_INHERIT);

              return (
                <div
                  key={control.key}
                  className="rounded-xl border border-vscode-input-border/30 bg-vscode-editor-background/20 p-4 flex flex-col gap-3"
                  data-setting-id={control.settingId}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{control.title}</div>
                      <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed mt-1">
                        {control.description}
                      </div>
                    </div>

                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-vscode-input-border/30 bg-vscode-editor-background/30">
                      {selectedOption ? (
                        <img
                          src={selectedOption.uri}
                          alt={selectedOption.label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(74,158,255,0.16),_transparent_58%),linear-gradient(180deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.01))] text-[10px] uppercase tracking-widest text-vscode-descriptionForeground">
                          {control.fallbackPreviewLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  <Select
                    value={selectValue}
                    onValueChange={(value) =>
                      updateToolHeaderBackground(
                        control.key,
                        value === TOOL_HEADER_BACKGROUND_NONE ||
                          value === TOOL_HEADER_BACKGROUND_INHERIT
                          ? ""
                          : value,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={control.emptyLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={
                          control.key === "global"
                            ? TOOL_HEADER_BACKGROUND_NONE
                            : TOOL_HEADER_BACKGROUND_INHERIT
                        }
                      >
                        {control.emptyLabel}
                      </SelectItem>
                      {backgroundOptions.map((option) => (
                        <SelectItem
                          key={`${control.key}-${option.file}`}
                          value={option.file}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedFile &&
                    !selectedOption &&
                    !isLoadingBackgroundOptions && (
                      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
                        The selected image is missing from the shared background
                        folder. Pick a new image or fall back to the default.
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
