import React, { useState, useMemo } from "react";
import styled, { css } from "styled-components";
import { ToolStatusIndicator } from "./ToolStatusIndicator";

interface ToolMessageWrapperProps {
  toolIcon?: string;
  toolName?: string;
  toolResult?: any;
  permissionState?: "pending" | "allowed" | "rejected" | string; // Adjusted type
  defaultExpanded?: boolean;
  isCustomLayout?: boolean;
  shouldAnimate?: boolean;
  children?: React.ReactNode;
  onAllow?: () => void;
  onDeny?: () => void;
  checkPending?: boolean; // new prop
}

const Wrapper = styled.div<{ $isCustomLayout?: boolean }>`
  display: flex;
  flex-direction: column;
  padding: ${(props) => (props.$isCustomLayout ? "0" : "0px 8px")};
  will-change: transform, opacity;
`;

const MainLine = styled.div<{ $isExpandable: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  user-select: none;

  ${({ $isExpandable }) =>
    $isExpandable &&
    css`
      cursor: pointer;
      &:hover {
        background-color: color-mix(
          in srgb,
          var(--vscode-list-hoverBackground) 30%,
          transparent
        );
      }
    `}
`;

const ToolIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 2px;
  color: var(--vscode-foreground);
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  .codicon {
    font-size: 16px;
  }
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const StatusIndicatorTrailing = styled(ToolStatusIndicator)`
  margin-left: auto;
`;

const ExpandableContent = styled.div`
  padding: 4px 0 0px 16px;
  margin-left: 10px;
  border-left: 1px solid var(--vscode-panel-border);
`;

const PermissionActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 0 4px;
  margin-left: 26px;
`;

const ActionButton = styled.button`
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.9em;
  cursor: pointer;
  border: 1px solid var(--vscode-button-border);
`;

const RejectButton = styled(ActionButton)`
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);

  &:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
`;

const AcceptButton = styled(ActionButton)`
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);

  &:hover {
    background: var(--vscode-button-hoverBackground);
  }
`;

export const ToolMessageWrapper: React.FC<ToolMessageWrapperProps> = ({
  toolIcon = "codicon-tools",
  toolName = "Tool",
  toolResult,
  permissionState,
  defaultExpanded = false,
  isCustomLayout = false,
  shouldAnimate = false,
  children,
  onAllow,
  onDeny,
  checkPending = false,
}) => {
  const [userToggled, setUserToggled] = useState(false);
  const [userToggledState, setUserToggledState] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // In standard layout, children are passed as "expandable" content usually.
  // But since we are porting Vue slots, we might need to adjust usage.
  // For custom layout, children is the custom content.

  const hasExpandableContent = useMemo(() => {
    return !isCustomLayout && (!!children || !!toolResult?.is_error);
  }, [isCustomLayout, children, toolResult]);

  const isExpanded = useMemo(() => {
    if (userToggled) {
      return userToggledState;
    }
    return defaultExpanded || !!toolResult?.is_error;
  }, [userToggled, userToggledState, defaultExpanded, toolResult]);

  const indicatorState = useMemo(() => {
    if (toolResult?.is_error) return "error";
    if (permissionState === "pending") return "pending";
    if (toolResult) return "success";
    return null;
  }, [toolResult, permissionState]);

  const toggleExpand = () => {
    if (hasExpandableContent) {
      setUserToggled(true);
      setUserToggledState(!isExpanded);
    }
  };

  return (
    <Wrapper
      $isCustomLayout={isCustomLayout}
      className={shouldAnimate ? "animate-tool-entry" : ""}
    >
      {isCustomLayout ? (
        children
      ) : (
        <>
          <MainLine
            $isExpandable={hasExpandableContent}
            onClick={toggleExpand}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <ToolIconBtn title={toolName}>
              {!isHovered || !hasExpandableContent ? (
                <span className={`codicon ${toolIcon}`}></span>
              ) : isExpanded ? (
                <span className="codicon codicon-fold"></span>
              ) : (
                <span className="codicon codicon-chevron-up-down"></span>
              )}
            </ToolIconBtn>

            <MainContent>
              {/* Standard layout main content usually goes here, but we don't have named slots in React props easily without custom props.
                                Assuming standard layout usage will pass a prop or we don't use standard layout for the ported tools.
                                The ported tools Read, Edit, Write ALL use isCustomLayout=true.
                                So standard layout might not be needed for this task.
                            */}
              <span>{toolName}</span>
            </MainContent>

            {indicatorState && (
              <StatusIndicatorTrailing state={indicatorState} />
            )}
          </MainLine>

          {hasExpandableContent && isExpanded && (
            <ExpandableContent>{children}</ExpandableContent>
          )}
        </>
      )}

      {permissionState === "pending" && (
        <PermissionActions>
          <RejectButton
            onClick={(e) => {
              e.stopPropagation();
              onDeny?.();
            }}
            disabled={checkPending}
            style={{
              opacity: checkPending ? 0.6 : 1,
              cursor: checkPending ? "not-allowed" : "pointer",
            }}
          >
            <span>Reject</span>
          </RejectButton>
          <AcceptButton
            onClick={(e) => {
              e.stopPropagation();
              onAllow?.();
            }}
            disabled={checkPending}
            style={{
              opacity: checkPending ? 0.6 : 1,
              cursor: checkPending ? "not-allowed" : "pointer",
            }}
          >
            {checkPending ? (
              <span className="codicon codicon-loading codicon-modifier-spin" />
            ) : (
              <span>Accept</span>
            )}
          </AcceptButton>
        </PermissionActions>
      )}
    </Wrapper>
  );
};
