import React, { memo } from "react";
import styled, { css } from "styled-components";
import { useToolTheme } from "../../../context/ToolThemeContext";

type ToolHeaderStatus = "running" | "complete" | "error";

interface ToolHeaderProps {
  toolName: string; // e.g., 'grep', 'read', 'web'
  actionVerb: string;
  details?: React.ReactNode;
  errorText?: string;
  extra?: React.ReactNode;
  isExpanded?: boolean;
  onToggle?: () => void;
  isPermissionRequest?: boolean;
  isError?: boolean;
  hasResults?: boolean;
  status?: ToolHeaderStatus;
  completedStatusIcon?: React.ReactNode;
  toolIcon?: React.ReactNode;
  hideToolIcon?: boolean;
  shouldAnimate?: boolean;
  hideCompleteIcon?: boolean;
  compactSpacing?: boolean;
}

const Container = styled.div.attrs({ className: "anchored-container" })<{
  $shouldAnimate?: boolean;
  $compactSpacing?: boolean;
}>`
  display: block;
  font-size: 13.5px;
  line-height: normal;
  margin: ${({ $compactSpacing }) => ($compactSpacing ? "2px 0" : "4px 0")};
  margin-left: -0.14px;
  min-height: ${({ $compactSpacing }) => ($compactSpacing ? "19px" : "22px")};

  /* CRITICAL: Anchor scrolling fix. 
      By using content-visibility: auto and a contain-intrinsic-size, 
      we tell the browser to reserve space for this header even before it fully renders, 
      preventing layout shifts that 'fling' the chat up. */
  content-visibility: auto;
  contain-intrinsic-size: ${({ $compactSpacing }) =>
    $compactSpacing ? "19px" : "22px"};

  ${({ $shouldAnimate }) =>
    $shouldAnimate &&
    css`
      animation: tool-header-enter 0.09s cubic-bezier(0.22, 1, 0.36, 1) both;
      will-change: opacity;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `}
`;

const HeaderRow = styled.div<{
  $canToggle: boolean;
  $compactSpacing?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 4px 3px;
  min-width: 0;
  min-height: ${({ $compactSpacing }) => ($compactSpacing ? "19px" : "22px")};
  font-size: inherit;
  line-height: inherit;
  cursor: ${(props) => (props.$canToggle ? "pointer" : "default")};
`;

const CombinedText = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

const ShimmerSpan = styled.span`
  display: inline-block;
  font-weight: 500;
`;

const ActionText = styled.span<{ $color: string }>`
  display: inline;
  vertical-align: baseline;
  font-weight: 500;
  opacity: 0.9;
  line-height: 1;
  color: ${(props) => props.$color};
`;

const Details = styled.span`
  display: inline-block;
  vertical-align: baseline;
  opacity: 1;
  font-size: inherit;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
  min-width: 0;

  /* Force every nested arg node (icons/links/spans) onto the same text metrics. */
  & * {
    line-height: inherit;
    vertical-align: baseline;
  }
`;

const ErrorText = styled.span`
  display: inline-block;
  vertical-align: baseline;
  min-width: 0;
  max-width: 440px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-errorForeground);
  opacity: 0.88;
  font-size: inherit;
  line-height: 1;
`;

const ToggleChevron = styled.span<{ $expanded?: boolean; $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.5;
  color: ${(props) => props.$color};
  transform: rotate(${(props) => (props.$expanded ? "90deg" : "0deg")});
  transform-origin: center;
  transition:
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 150ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: opacity 150ms ease;
  }
`;

const ToolHeaderComponent: React.FC<ToolHeaderProps> = ({
  toolName,
  actionVerb,
  details,
  errorText,
  extra,
  isExpanded,
  onToggle,
  isPermissionRequest,
  isError,
  hasResults,
  status,
  completedStatusIcon,
  toolIcon,
  hideToolIcon = false,
  shouldAnimate = false,
  hideCompleteIcon = false,
  compactSpacing = false,
}) => {
  const { theme } = useToolTheme();

  const canToggle = !!onToggle;
  const resolvedStatus: ToolHeaderStatus =
    status ??
    (isError ? "error" : isPermissionRequest ? "running" : "complete");

  const getToolIcon = (name: string): string | null => {
    switch (name) {
      case "read":
        return null;
      case "write":
        return "file-add";
      case "edit":
        return "edit";
      case "grep":
      case "glob":
        return null;
      case "find":
        return "search";
      case "list":
        return "folder-opened";
      case "mkdir":
        return "new-folder";
      case "web":
        return "search";
      case "fetch":
        return "link-external";
      case "research_web":
        return "search";
      case "mcp":
        return "plug";
      case "browser":
        return "browser";
      case "mv":
        return "move";
      case "rename":
        return "edit";
      case "agent":
        return "layers";
      default:
        return "tools";
    }
  };

  const defaultToolIcon = getToolIcon(toolName);
  const isSearchTool = toolName === "grep" || toolName === "glob";
  const iconGroupClassName =
    toolName === "list"
      ? "flex items-center gap-1 ml-[2px] shrink-0"
      : isSearchTool
        ? "flex items-center gap-0.5 ml-0.5 shrink-0"
      : "flex items-center gap-1 ml-1 shrink-0";

  return (
    <Container
      $shouldAnimate={shouldAnimate}
      $compactSpacing={compactSpacing}
      style={{ fontFamily: theme.fontFamily }}
    >
      <HeaderRow
        $canToggle={canToggle}
        $compactSpacing={compactSpacing}
        onClick={onToggle}
        className={canToggle ? "group" : undefined}
      >
        <CombinedText className="flex items-center gap-1.5">
          {resolvedStatus === "running" ? (
            <ShimmerSpan className="font-normal antialiased loading-shimmer-pure-text">
              {actionVerb}
            </ShimmerSpan>
          ) : (
            <ActionText $color={theme.colors.description}>
              {actionVerb === "Error" ? "" : actionVerb}
            </ActionText>
          )}
          {details && (
            <>
              {" "}
              <Details
                className="group-hover:text-vscode-foreground transition-colors duration-150"
                style={{
                  color:
                    "color-mix(in srgb, var(--vscode-foreground) 34%, transparent)",
                }}
              >
                {details}
              </Details>
            </>
          )}
          {errorText && (
            <ErrorText title={errorText}>
              {details ? "• " : ""}
              {errorText.replace(/^Error[:.]?\s*/i, "")}
            </ErrorText>
          )}
        </CombinedText>

        {/* Extra (Counts, Favicons, etc) */}
        {extra}

        {/* Status/Toggle Icon + Tool Icon grouped together */}
        <div className={iconGroupClassName}>
          {resolvedStatus === "running" ? (
            <span
              className="codicon codicon-loading codicon-modifier-spin opacity-50"
              style={{ fontSize: "12px", color: theme.colors.description }}
            />
          ) : resolvedStatus === "error" ? (
            <span
              className="codicon codicon-error opacity-70"
              style={{
                fontSize: "12px",
                color: "var(--vscode-errorForeground)",
              }}
            />
          ) : canToggle ? (
            <ToggleChevron
              className="codicon codicon-chevron-right"
              $expanded={isExpanded}
              $color={theme.colors.description}
              style={{ fontSize: "12px" }}
            />
          ) : hideCompleteIcon ? null : (
            (completedStatusIcon ?? (
              <span
                className="codicon codicon-check opacity-50"
                style={{ fontSize: "12px", color: theme.colors.description }}
              />
            ))
          )}
          {hideToolIcon
            ? null
            : (toolIcon ??
              (defaultToolIcon ? (
                <span
                  className={`codicon codicon-${defaultToolIcon} opacity-40`}
                  style={{
                    fontSize: "13px",
                    color:
                      theme.toolAccents[toolName] || theme.colors.description,
                  }}
                />
              ) : null))}
        </div>
      </HeaderRow>
    </Container>
  );
};

export const ToolHeader = memo(
  ToolHeaderComponent,
  (prevProps, nextProps) =>
    prevProps.toolName === nextProps.toolName &&
    prevProps.actionVerb === nextProps.actionVerb &&
    prevProps.details === nextProps.details &&
    prevProps.errorText === nextProps.errorText &&
    prevProps.extra === nextProps.extra &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.onToggle === nextProps.onToggle &&
    prevProps.isPermissionRequest === nextProps.isPermissionRequest &&
    prevProps.isError === nextProps.isError &&
    prevProps.hasResults === nextProps.hasResults &&
    prevProps.status === nextProps.status &&
    prevProps.completedStatusIcon === nextProps.completedStatusIcon &&
    prevProps.toolIcon === nextProps.toolIcon &&
    prevProps.hideToolIcon === nextProps.hideToolIcon &&
    prevProps.shouldAnimate === nextProps.shouldAnimate &&
    prevProps.hideCompleteIcon === nextProps.hideCompleteIcon &&
    prevProps.compactSpacing === nextProps.compactSpacing,
);
