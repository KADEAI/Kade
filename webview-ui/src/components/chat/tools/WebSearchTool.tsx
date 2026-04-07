import React, { useEffect, useMemo, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { ToolError } from "./ToolError";
import { ToolHeader } from "./ToolHeader";

interface WebSearchToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  compactSpacing?: boolean;
}

import { AnimatedAccordion } from "../../common/AnimatedAccordion";

const ResultLink = styled.a`
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
  font-weight: 500;
  &:hover {
    text-decoration: underline;
  }
`;

const ScrollableResults = styled.div`
  max-height: 250px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;

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
    border: 2px solid transparent;
    background-clip: content-box;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: var(--vscode-scrollbarSlider-hoverBackground);
  }
`;

const faviconCascadeIn = keyframes`
  0% {
    opacity: 0;
    transform: translateX(8px) scale(0.55) rotate(-10deg);
    filter: blur(6px) saturate(0.7);
  }
  62% {
    opacity: 1;
    transform: translateX(-1px) scale(1.14) rotate(1deg);
    filter: blur(0) saturate(1.1);
  }
  100% {
    opacity: 1;
    transform: translateX(0) scale(1) rotate(0deg);
    filter: blur(0) saturate(1);
  }
`;

const faviconGlow = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  45% {
    opacity: 0.35;
    transform: scale(1.8);
  }
  100% {
    opacity: 0;
    transform: scale(2.3);
  }
`;

const FaviconStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  opacity: 0.72;
`;

const FaviconChip = styled.span<{ $animate?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  transform-origin: center;
  will-change: ${({ $animate }) =>
    $animate ? "transform, opacity, filter" : "auto"};

  ${({ $animate }) =>
    $animate &&
    css`
      animation: ${faviconCascadeIn} 420ms cubic-bezier(0.22, 1.18, 0.32, 1) both;
    `}

  &::after {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 6px;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--vscode-textLink-foreground) 38%, transparent) 0%,
      transparent 72%
    );
    pointer-events: none;

    ${({ $animate }) =>
      $animate
        ? css`
            animation: ${faviconGlow} 520ms ease-out both;
            display: block;
          `
        : css`
            animation: none;
            display: none;
          `}
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;

    &::after {
      animation: none;
      display: none;
    }
  }
`;

const HeaderFavicon = styled.img`
  width: 14px;
  height: 14px;
  border-radius: 4px;
  display: block;
  box-shadow:
    0 0 0 1px
      color-mix(in srgb, var(--vscode-editorWidget-border) 38%, transparent),
    0 3px 10px color-mix(in srgb, var(--vscode-widget-shadow) 18%, transparent);
`;

export const WebSearchTool: React.FC<WebSearchToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  compactSpacing,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const prevDomainCountRef = useRef(0);
  const [lastAnimatedDomain, setLastAnimatedDomain] = useState<string | null>(
    null,
  );

  const query = useMemo(() => tool.query || tool.params?.query || "", [tool]);
  const allowedDomains = useMemo(
    () => tool.allowed_domains || tool.params?.allowed_domains || [],
    [tool],
  );
  const blockedDomains = useMemo(
    () => tool.blocked_domains || tool.params?.blocked_domains || [],
    [tool],
  );

  const results = useMemo(() => {
    if (!toolResult?.content) return [];
    const content =
      typeof toolResult.content === "string"
        ? toolResult.content
        : Array.isArray(toolResult.content)
          ? toolResult.content.map((c: any) => c.text).join("")
          : "";

    if (!content) return [];

    try {
      const parsed = JSON.parse(content);
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results;
      }
    } catch {}

    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.results && Array.isArray(parsed.results)) {
          return parsed.results;
        }
      } catch {}
    }

    const resultsArr: any[] = [];
    let currentResult: any = null;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Handle bulleted format: - title: "..."
      const titleMatch =
        line.match(/^-\s+title:\s*"(.*)"$/i) || line.match(/^\d+\.\s+(.+)$/);
      if (titleMatch) {
        if (currentResult && currentResult.title)
          resultsArr.push(currentResult);
        currentResult = {
          title: titleMatch[1].trim(),
          url: "",
          description: "",
        };
        continue;
      }

      if (currentResult) {
        if (line.startsWith("url:")) {
          currentResult.url = line
            .replace(/^url:\s*"/i, "")
            .replace(/"$/, "")
            .trim();
        } else if (line.startsWith("description:")) {
          currentResult.description = line
            .replace(/^description:\s*"/i, "")
            .replace(/"$/, "")
            .trim();
        } else if (line.startsWith("URL:")) {
          currentResult.url = line.replace("URL:", "").trim();
        } else if (line.startsWith("Summary:")) {
          currentResult.description = line.replace("Summary:", "").trim();
        }
      }
    }
    if (currentResult && currentResult.title) resultsArr.push(currentResult);

    if (resultsArr.length > 0) return resultsArr;
    return [];
  }, [toolResult]);

  const hasResults = results.length > 0;
  const content = toolResult?.content; // Check for any content presence

  // Permission/Loading Logic
  const isPermissionRequest = !content && isLastMessage;
  const status = toolResult?.is_error
    ? "error"
    : isPermissionRequest
      ? "running"
      : "complete";

  const actionVerb = useMemo(() => {
    return isPermissionRequest ? "Searching" : "Searched";
  }, [isPermissionRequest]);

  const canToggle =
    hasResults || toolResult?.is_error || (!!content && !isPermissionRequest);

  const toggleExpand = () => {
    if (canToggle) {
      setIsExpanded(!isExpanded);
    }
  };

  const getFaviconUrl = (url: string) => {
    try {
      let urlStr = url;
      if (!urlStr.startsWith("http")) {
        urlStr = "https://" + urlStr;
      }
      const domain = new URL(urlStr).hostname;
      return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    } catch {
      return "";
    }
  };

  const uniqueDomains = useMemo(() => {
    if (!results.length) return [];
    const domains = new Set<string>();
    const list: string[] = [];

    for (const result of results) {
      try {
        let urlStr = result.url;
        if (!urlStr.startsWith("http")) urlStr = "https://" + urlStr;
        const hostname = new URL(urlStr).hostname;
        if (!domains.has(hostname)) {
          domains.add(hostname);
          list.push(hostname);
        }
      } catch {}
    }
    return list;
  }, [results]);

  const totalDomains = !isPermissionRequest ? uniqueDomains.length : 0;
  const [visibleDomainCount, setVisibleDomainCount] = useState(
    () => totalDomains,
  );

  useEffect(() => {
    if (totalDomains === 0) {
      prevDomainCountRef.current = 0;
      setVisibleDomainCount(0);
      setLastAnimatedDomain(null);
      return;
    }

    if (
      totalDomains <= prevDomainCountRef.current &&
      totalDomains <= visibleDomainCount
    ) {
      prevDomainCountRef.current = totalDomains;
      return;
    }

    if (totalDomains > visibleDomainCount) {
      let current = visibleDomainCount;
      let clearAnimationTimeout: number | undefined;
      const interval = window.setInterval(() => {
        current += 1;
        const nextDomain = uniqueDomains[current - 1] ?? null;
        setVisibleDomainCount(current);
        setLastAnimatedDomain(nextDomain);
        if (current >= totalDomains) {
          window.clearInterval(interval);
          clearAnimationTimeout = window.setTimeout(() => {
            setLastAnimatedDomain((activeDomain) =>
              activeDomain === nextDomain ? null : activeDomain,
            );
          }, 520);
        }
      }, 95);
      prevDomainCountRef.current = totalDomains;
      return () => {
        window.clearInterval(interval);
        if (clearAnimationTimeout !== undefined) {
          window.clearTimeout(clearAnimationTimeout);
        }
      };
    }

    prevDomainCountRef.current = totalDomains;
  }, [totalDomains, uniqueDomains, visibleDomainCount]);

  const visibleDomains = uniqueDomains.slice(0, visibleDomainCount);

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName="web"
        actionVerb={actionVerb}
        isPermissionRequest={isPermissionRequest}
        isError={toolResult?.is_error}
        status={status}
        compactSpacing={compactSpacing}
        isExpanded={isExpanded}
        onToggle={canToggle ? toggleExpand : undefined}
        details={
          <span className="text-vscode-descriptionForeground opacity-75 truncate antialiased">
            "{query}"
          </span>
        }
        extra={
          !isPermissionRequest &&
          visibleDomains.length > 0 && (
            <FaviconStrip>
              {visibleDomains.map((domain) => (
                <FaviconChip
                  key={domain}
                  $animate={domain === lastAnimatedDomain}
                >
                  <HeaderFavicon
                    src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
                    alt={domain}
                    title={domain}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.parentElement?.style.setProperty(
                        "display",
                        "none",
                      );
                    }}
                  />
                </FaviconChip>
              ))}
            </FaviconStrip>
          )
        }
      />

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          <ScrollableResults className="flex flex-col gap-3">
            {allowedDomains.length > 0 && (
              <div className="text-xs text-vscode-descriptionForeground">
                Allowed: {allowedDomains.join(", ")}
              </div>
            )}
            {blockedDomains.length > 0 && (
              <div className="text-xs text-vscode-inputValidation-errorForeground">
                Blocked: {blockedDomains.join(", ")}
              </div>
            )}

            {results.map((result: any, i: number) => (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  {/* Favicon in Result List */}
                  {getFaviconUrl(result.url) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getFaviconUrl(result.url)}
                      alt=""
                      className="w-3.5 h-3.5 rounded-sm"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  )}
                  <ResultLink
                    href={result.url}
                    target="_blank"
                    className="text-xs truncate block"
                  >
                    {result.title}
                  </ResultLink>
                </div>
                <div className="text-[11px] opacity-60 truncate ml-5.5">
                  {result.url}
                </div>
                {result.description && (
                  <div className="text-[11px] opacity-80 line-clamp-2 ml-5.5">
                    {result.description}
                  </div>
                )}
              </div>
            ))}

            {results.length === 0 && !isPermissionRequest && content && (
              <div className="text-xs opacity-60 italic">No results found.</div>
            )}

            {toolResult?.is_error && <ToolError toolResult={toolResult} />}
          </ScrollableResults>
        </div>
      </AnimatedAccordion>
    </div>
  );
};
