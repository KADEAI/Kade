import { memo, useEffect, useRef, useCallback, useState, useMemo } from "react";
import styled from "styled-components";
import { useCopyToClipboard } from "@src/utils/clipboard";
import {
  getHighlighter,
  isLanguageLoaded,
  normalizeLanguage,
  ExtendedLanguage,
  selectableLanguages,
} from "@src/utils/highlighter";
import type { ShikiTransformer } from "shiki";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { ChevronDown, ChevronUp, Copy, Check, Search } from "lucide-react";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import {
  StandardTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { useRooPortal } from "@/components/ui/hooks/useRooPortal";
import { FileIcon } from "../../chat/tools/FileIcon";

export const CODE_BLOCK_BG_COLOR =
  "color-mix(in srgb, var(--vscode-editor-background, rgb(30 30 30)) 88%, black)";
export const WRAPPER_ALPHA = "cc"; // 80% opacity
const ASPHALT_TEXTURE =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.91' numOctaves='2' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.70'/%3E%3C/svg%3E")`;

// Configuration constants
export const WINDOW_SHADE_SETTINGS = {
  transitionDelayS: 0.2,
  collapsedHeight: 250, // Default collapsed height in pixels
};

// Tolerance in pixels for determining when a container is considered "at the bottom"
export const SCROLL_SNAP_TOLERANCE = 20;

const trimCodeBlockBoundaryLines = (value?: string) =>
  value?.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, "") ?? "";

interface CodeBlockProps {
  blockId?: string;
  source?: string;
  rawSource?: string; // Add rawSource prop for copying raw text
  language: string;
  preStyle?: React.CSSProperties;
  initialWordWrap?: boolean;
  collapsedHeight?: number;
  initialWindowShade?: boolean;
  onLanguageChange?: (language: ExtendedLanguage) => void;
  isStreaming?: boolean;
}

const highlightedCodeCache = new Map<string, React.ReactNode>();

const CodeBlockControls = styled.div`
  position: absolute;
  top: 5.2px;
  right: 17px;
  display: flex;
  align-items: center;
  gap: 0px;
  z-index: 20;
  opacity: 0;
  /* kade_change: explicit depth boost to prevent z-fighting */
  transform: translateZ(10px);
  backface-visibility: hidden;
  /* kade_change: reduce transition complexity during scroll */
  transition: opacity 0.2s ease-out;
  padding: 0.4px 4px;
  background-color: color-mix(
    in srgb,
    var(--vscode-editor-background) 95%,
    transparent
  );
  border: 0.1px solid
    color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
  border-radius: 10px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);

  &:hover {
    transform: translate3d(0, -1px, 10px);
    background-color: color-mix(
      in srgb,
      var(--vscode-editor-background) 95%,
      transparent
    );
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    border-color: color-mix(in srgb, var(--vscode-foreground) 35%, transparent);
  }
`;

const CodeBlockMeta = styled.div<{ $isScrolled: boolean }>`
  position: absolute;
  top: 8px;
  left: 12px;
  z-index: 20;
  transform: translateZ(10px);
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: ${({ $isScrolled }) => ($isScrolled ? "4px 8px" : "0")};
  border-radius: 999px;
  background: ${({ $isScrolled }) =>
    $isScrolled
      ? "color-mix(in srgb, var(--vscode-editor-background) 74%, transparent)"
      : "transparent"};
  border: 1px solid
    ${({ $isScrolled }) =>
      $isScrolled
        ? "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"
        : "transparent"};
  box-shadow: ${({ $isScrolled }) =>
    $isScrolled ? "0 10px 30px rgba(0, 0, 0, 0.16)" : "none"};
  backdrop-filter: ${({ $isScrolled }) =>
    $isScrolled ? "blur(14px)" : "blur(0px)"};
  -webkit-backdrop-filter: ${({ $isScrolled }) =>
    $isScrolled ? "blur(14px)" : "blur(0px)"};
  transition:
    padding 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    backdrop-filter 0.18s ease;
`;

const CodeBlockContainer = styled.div`
  position: relative;
  margin: 5px 0;
  width: var(--chat-code-block-width, auto);
  max-width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background-color: ${CODE_BLOCK_BG_COLOR};
  isolation: isolate;
  border: 0.3px solid
    color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
  /* kade_change: explicit 3D layer for compositor stability */
  transform-style: preserve-3d;
  transform: translateZ(0);

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.018) 0%,
        rgba(255, 255, 255, 0.006) 34%,
        rgba(0, 0, 0, 0.05) 100%
      ),
      ${ASPHALT_TEXTURE};
    background-size: 100% 100%, 320px 320px;
    background-position: 0 0, 0 0;
    opacity: 0.28;
    mix-blend-mode: overlay;
  }

  &:hover ${CodeBlockControls} {
    opacity: 1;
  }
`;

export const StyledPre = styled.div.attrs({ className: "anchored-container" })<{
  preStyle?: React.CSSProperties;
  wordwrap?: "true" | "false" | undefined;
  windowshade?: "true" | "false";
  collapsedHeight?: number;
}>`
  max-height: ${({ windowshade, collapsedHeight }) =>
    windowshade === "true"
      ? `${collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight}px`
      : "none"};
  overflow-y: auto;
  padding: 0;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  pre {
    background-color: transparent !important;
    margin: 0;
    padding: 20px 15px 0;

    width: 100%;
    box-sizing: border-box;
  }

  pre,
  code {
    white-space: ${({ wordwrap }) =>
      wordwrap === "false" ? "pre" : "pre-wrap"};
    word-break: ${({ wordwrap }) =>
      wordwrap === "false" ? "normal" : "normal"};
    overflow-wrap: ${({ wordwrap }) =>
      wordwrap === "false" ? "normal" : "break-word"};
    font-size: 12px;
    font-family: var(
      --vscode-editor-font-family,
      "Cascadia Code",
      "Fira Code",
      monospace
    );
    line-height: 1.5;
    background-color: transparent !important;
  }

  .hljs {
    display: block;
    margin-bottom: -0.18em;
    color: var(--vscode-editor-foreground, #fff);
    background-color: transparent !important;
  }

  .hljs,
  .hljs span,
  .line,
  .line span {
    background-color: transparent !important;
  }
`;

const DropdownTrigger = styled.button`
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  border: none;
  border-radius: 4px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  line-height: 1;
  appearance: none;
  opacity: 0;
  pointer-events: none;

  &:hover {
    color: var(--vscode-foreground);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
    opacity: 1;
  }

  .language-chevron {
    opacity: 0.65;
  }
`;

const MetaTrigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
    border-radius: 6px;
  }
`;

const LanguageLabel = styled.span`
  color: color-mix(in srgb, var(--vscode-foreground) 88%, transparent);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
`;

const ControlGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`;

const LANGUAGE_BADGE_META: Record<string, { label: string; fileName: string }> =
  {
    c: { label: "C", fileName: "snippet.c" },
    cpp: { label: "C++", fileName: "snippet.cpp" },
    csharp: { label: "C#", fileName: "snippet.cs" },
    css: { label: "CSS", fileName: "snippet.css" },
    docker: { label: "Dockerfile", fileName: "Dockerfile" },
    dockerfile: {
      label: "Dockerfile",
      fileName: "Dockerfile",
    },
    go: { label: "Go", fileName: "snippet.go" },
    html: { label: "HTML", fileName: "snippet.html" },
    java: { label: "Java", fileName: "snippet.java" },
    javascript: { label: "JavaScript", fileName: "snippet.js" },
    json: { label: "JSON", fileName: "snippet.json" },
    jsonc: { label: "JSONC", fileName: "snippet.json" },
    jsx: { label: "JSX", fileName: "snippet.jsx" },
    kotlin: { label: "Kotlin", fileName: "snippet.kt" },
    markdown: { label: "Markdown", fileName: "snippet.md" },
    mermaid: { label: "Mermaid", fileName: "diagram.mmd" },
    php: { label: "PHP", fileName: "snippet.php" },
    python: { label: "Python", fileName: "snippet.py" },
    ruby: { label: "Ruby", fileName: "snippet.rb" },
    rust: { label: "Rust", fileName: "snippet.rs" },
    scss: { label: "SCSS", fileName: "snippet.scss" },
    shell: { label: "Shell", fileName: "snippet.sh" },
    sql: { label: "SQL", fileName: "snippet.sql" },
    swift: { label: "Swift", fileName: "snippet.swift" },
    tsx: { label: "TSX", fileName: "snippet.tsx" },
    txt: { label: "Plain Text", fileName: "snippet.txt" },
    typescript: {
      label: "TypeScript",
      fileName: "snippet.ts",
    },
    xml: { label: "XML", fileName: "snippet.xml" },
    yaml: { label: "YAML", fileName: "snippet.yaml" },
  };

const getLanguageBadgeMeta = (language: ExtendedLanguage) => {
  const meta = LANGUAGE_BADGE_META[language];
  if (meta) {
    return meta;
  }

  const fallbackLabel =
    language
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Plain Text";

  return {
    label: fallbackLabel,
    fileName: `snippet.${language.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "txt"}`,
  };
};

const DropdownContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    border-radius: 10px;
  }
`;

const DropdownItem = styled.div<{ $isSelected: boolean }>`
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 500;
  color: ${({ $isSelected }) =>
    $isSelected
      ? "var(--vscode-foreground)"
      : "var(--vscode-descriptionForeground)"};
  background: ${({ $isSelected }) =>
    $isSelected
      ? "color-mix(in srgb, var(--vscode-foreground) 5%, transparent)"
      : "transparent"};
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.1s;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    color: var(--vscode-foreground);
  }

  &::before {
    content: "";
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${({ $isSelected }) =>
      $isSelected
        ? "var(--vscode-symbolIcon-keywordForeground)"
        : "transparent"};
    transition: background 0.2s;
  }
`;

const CodeBlock = memo(
  ({
    blockId,
    source,
    rawSource,
    language,
    preStyle,
    initialWordWrap = true,
    initialWindowShade = true,
    collapsedHeight,
    onLanguageChange,
    isStreaming = false,
  }: CodeBlockProps) => {
    const trimmedSource = useMemo(
      () => trimCodeBlockBoundaryLines(source),
      [source],
    );
    const trimmedRawSource = useMemo(
      () => trimCodeBlockBoundaryLines(rawSource),
      [rawSource],
    );
    const [wordWrap] = useState(initialWordWrap);
    const [windowShade, setWindowShade] = useState(initialWindowShade);
    const [currentLanguage, setCurrentLanguage] = useState<ExtendedLanguage>(
      () => normalizeLanguage(language),
    );
    const portalContainer = useRooPortal("roo-portal");
    const userChangedLanguageRef = useRef(false);
    const [highlightedCode, setHighlightedCode] = useState<React.ReactNode>(
      blockId ? (highlightedCodeCache.get(blockId) ?? null) : null,
    );
    const [showCollapseButton, setShowCollapseButton] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMetaScrolled, setIsMetaScrolled] = useState(false);
    const [langSearch, setLangSearch] = useState("");
    const codeBlockRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLDivElement>(null);
    const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard();
    const { t } = useAppTranslation();
    const isMountedRef = useRef(true);
    const shouldAutoScrollRef = useRef(true);
    const languageBadgeMeta = useMemo(
      () => getLanguageBadgeMeta(currentLanguage),
      [currentLanguage],
    );
    useEffect(() => {
      if (!blockId) {
        return;
      }

      const cachedHighlightedCode = highlightedCodeCache.get(blockId);
      if (cachedHighlightedCode) {
        setHighlightedCode((current) => current ?? cachedHighlightedCode);
      }
    }, [blockId]);

    useEffect(() => {
      isMountedRef.current = true;

      if (!trimmedSource) {
        setHighlightedCode(null);
        return;
      }

      const fallback = (
        <pre style={{ margin: 0 }}>
          <code className={`hljs language-${currentLanguage || "txt"}`}>
            {trimmedSource}
          </code>
        </pre>
      );

      const cacheKey = `${currentLanguage}::${trimmedSource}`;
      const cachedHighlightedCode = highlightedCodeCache.get(cacheKey);
      if (cachedHighlightedCode) {
        setHighlightedCode(cachedHighlightedCode);
        return;
      }

      // If we don't have a cached version, immediately show the fallback
      // so the code doesn't disappear during the async highlighting process.
      setHighlightedCode(fallback);

      const highlight = async () => {
        try {
          const highlighter = await getHighlighter(currentLanguage);
          if (!isMountedRef.current) return;

          const hast = await highlighter.codeToHast(trimmedSource, {
            lang: currentLanguage,
            theme: document.body.className.toLowerCase().includes("light")
              ? "github-light"
              : "github-dark",
            transformers: [
              {
                pre(node) {
                  if (node.properties.style) {
                    node.properties.style = (
                      node.properties.style as string
                    ).replace(/background(?:-color)?:[^;]+;?/g, "");
                  }
                  const className = Array.isArray(node.properties.class)
                    ? node.properties.class
                    : typeof node.properties.class === "string"
                      ? [node.properties.class]
                      : [];
                  node.properties.class = [...className, "hljs"];
                  return node;
                },
                code(node) {
                  if (node.properties.style) {
                    node.properties.style = (
                      node.properties.style as string
                    ).replace(/background(?:-color)?:[^;]+;?/g, "");
                  }
                  return node;
                },
                span(node) {
                  if (node.properties.style) {
                    node.properties.style = (node.properties.style as string)
                      .replace(/font-family:[^;]+;?/g, "")
                      .replace(/background(?:-color)?:[^;]+;?/g, "");
                  }
                  return node;
                },
              } as ShikiTransformer,
            ],
          });

          if (!isMountedRef.current) return;

          const reactElements = toJsxRuntime(hast as any, {
            Fragment,
            jsx,
            jsxs,
          });
          highlightedCodeCache.set(cacheKey, reactElements);
          if (blockId) {
            highlightedCodeCache.set(blockId, reactElements);
          }
          setHighlightedCode(reactElements);
        } catch (e) {
          console.error("[CodeBlock] Syntax highlighting error:", e);
          if (isMountedRef.current) {
            setHighlightedCode(fallback);
          }
        }
      };

      const timeoutId = window.setTimeout(
        () => {
          void highlight();
        },
        isStreaming ? 250 : 0,
      );

      return () => {
        isMountedRef.current = false;
        window.clearTimeout(timeoutId);
      };
    }, [trimmedSource, currentLanguage, isStreaming, blockId]);

    // Update language if prop changes (unless user manually changed it)
    useEffect(() => {
      if (!userChangedLanguageRef.current) {
        setCurrentLanguage(normalizeLanguage(language));
      }
    }, [language]);

    // Check if content height exceeds collapsed height whenever content changes
    useEffect(() => {
      const codeBlock = codeBlockRef.current;
      if (codeBlock) {
        const actualHeight = codeBlock.scrollHeight;
        setShowCollapseButton(
          actualHeight >=
            (collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight),
        );
      }
    }, [highlightedCode, collapsedHeight]);

    const updateMetaScrollState = useCallback(() => {
      if (!preRef.current) {
        setIsMetaScrolled(false);
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = preRef.current;
      const scrollableDistance = Math.max(scrollHeight - clientHeight, 0);
      const threshold = scrollableDistance * 0.025;

      setIsMetaScrolled(scrollableDistance > 0 && scrollTop > threshold);
    }, []);

    // Handle auto-scrolling as content streams in
    useEffect(() => {
      if (shouldAutoScrollRef.current && preRef.current) {
        preRef.current.scrollTo?.({
          top: preRef.current.scrollHeight,
          behavior: "auto",
        });
      }
      updateMetaScrollState();
    }, [highlightedCode, updateMetaScrollState]);

    // Detect manual scroll to toggle auto-scroll state
    const handleScroll = useCallback(() => {
      if (preRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = preRef.current;
        const isAtBottom =
          scrollHeight - scrollTop - clientHeight < SCROLL_SNAP_TOLERANCE;
        shouldAutoScrollRef.current = isAtBottom;
      }
      updateMetaScrollState();
    }, [updateMetaScrollState]);

    const updateCodeBlockButtonPosition = useCallback(() => {
      // No-op for now as we use absolute positioning in the new design
    }, []);

    const handleCopy = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        const textToCopy =
          rawSource !== undefined ? trimmedRawSource : trimmedSource;
        if (textToCopy) {
          copyWithFeedback(textToCopy, e);
        }
      },
      [trimmedSource, trimmedRawSource, rawSource, copyWithFeedback],
    );

    // Handle hover events for menu visibility
    const handleMouseEnter = useCallback(() => {
      setIsHovered(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
      setIsHovered(false);
    }, []);

    if (trimmedSource.length === 0) {
      return null;
    }

    return (
      <CodeBlockContainer
        ref={codeBlockRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <CodeBlockMeta $isScrolled={isMetaScrolled}>
          <Popover
            open={isDropdownOpen}
            onOpenChange={(open) => {
              setIsDropdownOpen(open);
              if (!open) setLangSearch("");
            }}
          >
            <PopoverTrigger asChild>
              <MetaTrigger
                type="button"
                aria-label={`Code language: ${languageBadgeMeta.label}`}
              >
                <FileIcon fileName={languageBadgeMeta.fileName} size={13} />
                <LanguageLabel>{languageBadgeMeta.label}</LanguageLabel>
                <DropdownTrigger
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{
                    opacity: isHovered || isDropdownOpen ? 1 : 0,
                    pointerEvents: "none",
                  }}
                >
                  <ChevronDown size={12} className="language-chevron" />
                </DropdownTrigger>
              </MetaTrigger>
            </PopoverTrigger>
            <PopoverContent
              container={portalContainer}
              align="start"
              sideOffset={8}
              className="p-0 min-w-[160px] bg-popover/40 backdrop-blur-3xl border border-vscode-dropdown-border rounded-xl shadow-2xl z-[1000] overflow-hidden flex flex-col"
            >
              <div className="p-2 border-b border-vscode-dropdown-border">
                <div className="relative flex items-center">
                  <Search
                    size={10}
                    className="absolute left-2 text-vscode-descriptionForeground opacity-50"
                  />
                  <input
                    className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded pl-6 pr-2 py-1 text-[11px] outline-none focus:border-vscode-focusBorder"
                    placeholder={t("common:ui.search_placeholder")}
                    value={langSearch}
                    onChange={(e) => setLangSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                </div>
              </div>
              <DropdownContent className="flex-1">
                {(!langSearch ||
                  normalizeLanguage(language)
                    .toLowerCase()
                    .includes(langSearch.toLowerCase())) && (
                  <DropdownItem
                    $isSelected={
                      currentLanguage === normalizeLanguage(language)
                    }
                    onClick={() => {
                      const newLang = normalizeLanguage(language);
                      userChangedLanguageRef.current = true;
                      setCurrentLanguage(newLang);
                      setIsDropdownOpen(false);
                      if (onLanguageChange) onLanguageChange(newLang);
                    }}
                  >
                    {normalizeLanguage(language)}
                  </DropdownItem>
                )}

                {selectableLanguages.sort().map((lang) => {
                  const normalizedLang = normalizeLanguage(
                    lang as ExtendedLanguage,
                  );
                  if (normalizedLang === normalizeLanguage(language))
                    return null;
                  if (
                    langSearch &&
                    !normalizedLang
                      .toLowerCase()
                      .includes(langSearch.toLowerCase())
                  )
                    return null;
                  return (
                    <DropdownItem
                      key={lang}
                      $isSelected={currentLanguage === normalizedLang}
                      onClick={() => {
                        userChangedLanguageRef.current = true;
                        setCurrentLanguage(normalizedLang);
                        setIsDropdownOpen(false);
                        if (onLanguageChange) onLanguageChange(normalizedLang);
                      }}
                    >
                      {normalizedLang}
                    </DropdownItem>
                  );
                })}
              </DropdownContent>
            </PopoverContent>
          </Popover>
        </CodeBlockMeta>

        <CodeBlockControls>
          <ControlGroup>
            {showCollapseButton && (
              <StandardTooltip
                content={t(
                  `chat:codeblock.tooltips.${windowShade ? "expand" : "collapse"}`,
                )}
                side="top"
              >
                <button
                  onClick={() => setWindowShade(!windowShade)}
                  className="p-1 hover:bg-vscode-toolbar-hoverBackground rounded text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center"
                >
                  {windowShade ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronUp size={14} />
                  )}
                </button>
              </StandardTooltip>
            )}

            <StandardTooltip
              content={t("chat:codeblock.tooltips.copy_code")}
              side="top"
            >
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-vscode-toolbar-hoverBackground rounded text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center min-w-[24px]"
              >
                {showCopyFeedback ? (
                  <Check size={14} className="text-vscode-charts-green" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </StandardTooltip>
          </ControlGroup>
        </CodeBlockControls>

        <MemoizedStyledPre
          preRef={preRef}
          preStyle={preStyle}
          wordWrap={wordWrap}
          windowShade={windowShade}
          collapsedHeight={collapsedHeight}
          highlightedCode={highlightedCode}
          currentLanguage={currentLanguage}
          trimmedSource={trimmedSource}
          updateCodeBlockButtonPosition={updateCodeBlockButtonPosition}
          onScroll={handleScroll}
        />
      </CodeBlockContainer>
    );
  },
);

// Memoized content component to prevent unnecessary re-renders of highlighted code
const MemoizedCodeContent = memo(
  ({
    highlightedCode,
    currentLanguage,
    trimmedSource,
  }: {
    highlightedCode: React.ReactNode;
    currentLanguage: ExtendedLanguage;
    trimmedSource: string;
  }) =>
    highlightedCode || (
      <pre style={{ margin: 0 }}>
        <code className={`hljs language-${currentLanguage || "txt"}`}>
          {trimmedSource}
        </code>
      </pre>
    ),
);

// Memoized StyledPre component
const MemoizedStyledPre = memo(
  ({
    preRef,
    preStyle,
    wordWrap,
    windowShade,
    collapsedHeight,
    highlightedCode,
    currentLanguage,
    trimmedSource,
    updateCodeBlockButtonPosition,
    onScroll,
  }: {
    preRef: React.RefObject<HTMLDivElement>;
    preStyle?: React.CSSProperties;
    wordWrap: boolean;
    windowShade: boolean;
    collapsedHeight?: number;
    highlightedCode: React.ReactNode;
    currentLanguage: ExtendedLanguage;
    trimmedSource: string;
    updateCodeBlockButtonPosition: (forceHide?: boolean) => void;
    onScroll?: () => void;
  }) => (
    <StyledPre
      ref={preRef}
      preStyle={preStyle}
      wordwrap={wordWrap ? "true" : "false"}
      windowshade={windowShade ? "true" : "false"}
      collapsedHeight={collapsedHeight}
      onMouseDown={() => updateCodeBlockButtonPosition(true)}
      onMouseUp={() => updateCodeBlockButtonPosition(false)}
      onScroll={onScroll}
    >
      <MemoizedCodeContent
        highlightedCode={highlightedCode}
        currentLanguage={currentLanguage}
        trimmedSource={trimmedSource}
      />
    </StyledPre>
  ),
);

export default CodeBlock;
