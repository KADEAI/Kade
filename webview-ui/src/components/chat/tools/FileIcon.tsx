import React, { useMemo } from "react";

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
  isDirectory?: boolean;
}

type ResolvedThemeIconDefinition = {
  iconUri?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontId?: string;
  fontSize?: string;
};

type ActiveFileIconTheme = {
  themeId: string;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  rootFolder?: string;
  rootFolderExpanded?: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  languageIds: Record<string, string>;
  iconDefinitions: Record<string, ResolvedThemeIconDefinition>;
  extensionToLanguageId: Record<string, string>;
  fileNameToLanguageId: Record<string, string>;
};

declare global {
  interface Window {
    ACTIVE_FILE_ICON_THEME?: ActiveFileIconTheme | null;
  }
}

const getCodiconFallback = (fileName: string, isDirectory: boolean): string => {
  if (isDirectory) {
    return "folder";
  }

  const ext = fileName.toLowerCase().split(".").pop() || "";

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "go":
    case "rs":
    case "php":
      return "file-code";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "yml":
    case "yaml":
    case "toml":
      return "settings-gear";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return "file-media";
    default:
      return "file";
  }
};

const cleanFileName = (fileName: string) => {
  let cleanName = (fileName || "").replace("file://", "").trim();

  if (cleanName.startsWith("@")) {
    cleanName = cleanName.slice(1);
  }

  cleanName = cleanName.split(":")[0];

  const parts = cleanName.split(/[\\/]/).filter(Boolean);
  return (parts[parts.length - 1] || "").trim();
};

const getExtensionCandidates = (fileName: string) => {
  const lowerName = fileName.toLowerCase();
  const parts = lowerName.split(".");

  if (parts.length <= 1) {
    return [];
  }

  const candidates: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    candidates.push(parts.slice(index).join("."));
  }

  return candidates;
};

const resolveThemeIcon = (
  fileName: string,
  isDirectory: boolean,
): ResolvedThemeIconDefinition | undefined => {
  const theme = window.ACTIVE_FILE_ICON_THEME;
  if (!theme || !fileName) {
    return undefined;
  }

  const lowerName = fileName.toLowerCase();

  let iconId: string | undefined;

  if (isDirectory) {
    iconId =
      theme.folderNames[lowerName] ||
      theme.folderNames[`.${lowerName}`] ||
      theme.folder;
  } else {
    iconId = theme.fileNames[lowerName];

    if (!iconId) {
      for (const extension of getExtensionCandidates(lowerName)) {
        iconId = theme.fileExtensions[extension];
        if (iconId) {
          break;
        }
      }
    }

    if (!iconId) {
      const languageIdFromFileName = theme.fileNameToLanguageId[lowerName];
      if (languageIdFromFileName) {
        iconId = theme.languageIds[languageIdFromFileName];
      }
    }

    if (!iconId) {
      for (const extension of getExtensionCandidates(lowerName)) {
        const languageId = theme.extensionToLanguageId[extension];
        if (languageId) {
          iconId = theme.languageIds[languageId];
          if (iconId) {
            break;
          }
        }
      }
    }

    iconId ||= theme.file;
  }

  return iconId ? theme.iconDefinitions[iconId] : undefined;
};

export const FileIcon: React.FC<FileIconProps> = ({
  fileName,
  size = 16,
  className,
  isDirectory = false,
}) => {
  const name = useMemo(() => cleanFileName(fileName), [fileName]);
  const iconDefinition = useMemo(
    () => resolveThemeIcon(name, isDirectory),
    [isDirectory, name],
  );

  if (iconDefinition?.iconUri) {
    return (
      <img
        src={iconDefinition.iconUri}
        alt=""
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: "inline-block",
          flexShrink: 0,
          objectFit: "contain",
        }}
      />
    );
  }

  if (iconDefinition?.fontCharacter && iconDefinition.fontId) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: `file-icon-theme-${iconDefinition.fontId}`,
          color: iconDefinition.fontColor,
          fontSize: iconDefinition.fontSize ?? `${size}px`,
          lineHeight: 1,
        }}
      >
        {iconDefinition.fontCharacter}
      </span>
    );
  }

  const fallbackIcon = name ? getCodiconFallback(name, isDirectory) : "file";

  return (
    <i
      className={`codicon codicon-${fallbackIcon} ${className || ""}`}
      style={{
        fontSize: `${size}px`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    />
  );
};
