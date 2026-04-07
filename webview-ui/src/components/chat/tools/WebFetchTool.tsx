import React, { useMemo, useState } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ToolError } from "./ToolError";
import { ToolHeader } from "./ToolHeader";
import { vscode } from "../../../utils/vscode";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";

interface WebFetchToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  compactSpacing?: boolean;
}

const BrowserFrame = styled.div`
  border-radius: 8px;
  border: 1px solid var(--vscode-widget-border);
  background-color: var(--vscode-editor-background);
  margin-top: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
`;

const BrowserHeader = styled.div`
  background-color: var(--vscode-editorGroupHeader-tabsBackground);
  padding: 6px 12px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--vscode-widget-border);
  gap: 12px;
`;

const TrafficLights = styled.div`
  display: flex;
  gap: 6px;

  div {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .red {
    background-color: #ff5f56;
  }
  .yellow {
    background-color: #ffbd2e;
  }
  .green {
    background-color: #27c93f;
  }
`;

const UrlBar = styled.div`
  flex: 1;
  background-color: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  text-align: center;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--vscode-font-family);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    opacity: 1;
    background-color: var(--vscode-input-background);
    border-color: var(--vscode-focusBorder);
  }
`;

const BrowserContent = styled.div`
  height: 225px;
  overflow-y: auto;
  overflow-x: auto;
  background-color: var(--vscode-editor-background);
  position: relative;

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background-color: color-mix(
      in srgb,
      var(--vscode-scrollbarSlider-background) 50%,
      transparent
    );
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: var(--vscode-scrollbarSlider-hoverBackground);
  }
`;

const ReaderContent = styled.div`
  padding: 24px 40px;
  max-width: 800px;
  margin: 0 auto;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  background-color: var(--vscode-editor-background);
  font-family:
    var(--vscode-font-family),
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;

  h1 {
    font-size: 1.8em;
    font-weight: bold;
    margin-bottom: 0.5em;
    color: var(--vscode-editor-foreground);
    border-bottom: 1px solid var(--vscode-widget-border);
    padding-bottom: 0.3em;
  }
  h2 {
    font-size: 1.5em;
    font-weight: bold;
    margin-top: 1.2em;
    margin-bottom: 0.5em;
    color: var(--vscode-editor-foreground);
  }
  h3 {
    font-size: 1.2em;
    font-weight: bold;
    margin-top: 1.2em;
    margin-bottom: 0.5em;
    color: var(--vscode-editor-foreground);
  }
  p {
    margin-bottom: 1em;
    opacity: 0.9;
  }
  ul,
  ol {
    margin-left: 1.5em;
    margin-bottom: 1em;
    opacity: 0.9;
  }
  li {
    margin-bottom: 0.4em;
  }
  pre {
    background-color: var(--vscode-textBlockQuote-background);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 1em;
    border: 1px solid var(--vscode-widget-border);
  }
  code {
    font-family: var(--vscode-editor-font-family), monospace;
    font-size: 0.9em;
    padding: 0.2em 0.4em;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }
  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  blockquote {
    border-left: 4px solid var(--vscode-textBlockQuote-border);
    padding-left: 16px;
    margin: 1em 0;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 16px 0;
    display: block;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    border: 1px solid var(--vscode-widget-border);
  }
`;

export const WebFetchTool: React.FC<WebFetchToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  compactSpacing,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const url = useMemo(() => tool.url || tool.params?.url || "", [tool]);

  const rawContent = useMemo(() => {
    const source = toolResult?.content ?? tool?.content;
    if (!source) return "";
    return typeof source === "string"
      ? source
      : Array.isArray(source)
        ? source.map((c: any) => c.text).join("")
        : "";
  }, [toolResult, tool]);

  const isPermissionRequest = !rawContent && isLastMessage;
  const status = toolResult?.is_error
    ? "error"
    : isPermissionRequest
      ? "running"
      : "complete";

  const actionVerb = useMemo(() => {
    return isPermissionRequest ? "Fetching" : "Fetched";
  }, [isPermissionRequest]);

  const canToggle = !!rawContent || !!toolResult?.is_error;

  const toggleExpand = () => {
    if (canToggle) {
      setIsExpanded(!isExpanded);
    }
  };

  const faviconUrl = useMemo(() => {
    try {
      let u = url;
      if (!u.startsWith("http")) u = "https://" + u;
      const domain = new URL(u).hostname;
      return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    } catch {
      return null;
    }
  }, [url]);

  const markdownComponents = useMemo(
    () => ({
      img: ({ ...props }: any) => {
        const [hasError, setHasError] = useState(false);
        const resolvedSrc = useMemo(() => {
          if (!props.src) return "";
          try {
            return new URL(props.src, url).href;
          } catch {
            return props.src;
          }
        }, [props.src]);

        if (hasError) {
          return (
            <a
              className="inline-flex items-center gap-1 text-xs opacity-60 my-1 border px-1.5 py-0.5 rounded cursor-pointer border-vscode-widget-border"
              title={`Open: ${resolvedSrc}`}
              onClick={(e) => {
                e.preventDefault();
                vscode.postMessage({ type: "openExternal", url: resolvedSrc });
              }}
            >
              <span
                className="codicon codicon-file-media"
                style={{ fontSize: "12px" }}
              />
              {props.alt || "Broken Image"}
              <span
                className="codicon codicon-link-external"
                style={{ fontSize: "10px", marginLeft: "2px" }}
              />
            </a>
          );
        }

        return (
          <img
            {...props}
            src={resolvedSrc}
            referrerPolicy="no-referrer"
            onError={() => setHasError(true)}
          />
        );
      },
      a: ({ ...props }: any) => {
        const resolvedHref = useMemo(() => {
          if (!props.href) return "#";
          try {
            return new URL(props.href, url).href;
          } catch {
            return props.href;
          }
        }, [props.href]);

        return (
          <a
            {...props}
            href={resolvedHref}
            onClick={(e) => {
              e.preventDefault();
              vscode.postMessage({ type: "openExternal", url: resolvedHref });
            }}
          >
            {props.children}
          </a>
        );
      },
    }),
    [url],
  );

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName="fetch"
        actionVerb={actionVerb}
        isPermissionRequest={isPermissionRequest}
        isError={toolResult?.is_error}
        status={status}
        compactSpacing={compactSpacing}
        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
        details={
          <div className="flex items-center gap-1 min-w-0">
            <span
              className="text-vscode-descriptionForeground opacity-50 truncate antialiased max-w-[200px]"
              title={url}
            >
              {url}
            </span>

            {!isPermissionRequest && faviconUrl && (
              <img
                src={faviconUrl}
                alt=""
                className="w-3.5 h-3.5 rounded-sm"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
          </div>
        }
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          {rawContent && (
            <BrowserFrame>
              <BrowserHeader>
                <TrafficLights>
                  <div className="red" />
                  <div className="yellow" />
                  <div className="green" />
                </TrafficLights>

                <UrlBar
                  onClick={() =>
                    vscode.postMessage({ type: "openExternal", url: url })
                  }
                >
                  {url}
                </UrlBar>
              </BrowserHeader>

              <BrowserContent className="custom-scrollbar">
                <ReaderContent>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents as any}
                  >
                    {rawContent}
                  </ReactMarkdown>
                </ReaderContent>
              </BrowserContent>
            </BrowserFrame>
          )}

          {toolResult?.is_error && <ToolError toolResult={toolResult} />}
        </div>
      </AnimatedAccordion>
    </div>
  );
};
