import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ToolHeader } from "./ToolHeader";
import MarkdownBlock from "../../common/MarkdownBlock";
import { ToolUseBlock, ToolUseBlockHeader } from "../../common/ToolUseBlock";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";

export interface RunSubAgentToolProps {
  tool: any;
  toolResult?: any;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
  autoApprovalEnabled?: boolean;
  alwaysAllowSubtasks?: boolean;
  subAgentIndex?: number;
}

export const RunSubAgentTool: React.FC<RunSubAgentToolProps> = ({
  tool,
  toolResult,
  isLastMessage,
  shouldAnimate,
  autoApprovalEnabled,
  alwaysAllowSubtasks,
  subAgentIndex = 1,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const prompt = tool.prompt || "";
  const mode = tool.mode || "code";

  // Hide permission buttons if auto-approved
  const isPermissionRequest =
    !toolResult &&
    isLastMessage &&
    autoApprovalEnabled === true &&
    alwaysAllowSubtasks === true;
  const showLoading = !toolResult && isLastMessage && !isPermissionRequest;

  const actionVerb = useMemo(() => {
    return showLoading ? "Deploying" : "Deployed";
  }, [showLoading]);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <ToolHeader
        toolName="agent"
        actionVerb={actionVerb}
        isPermissionRequest={showLoading}
        isExpanded={isExpanded}
        onToggle={toggleExpand}
        details={
          <span className="text-vscode-descriptionForeground opacity-85 font-medium">
            1 agent
          </span>
        }
      />
      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4">
          <ToolUseBlock>
            <div
              style={{
                backgroundColor: "var(--vscode-textCodeBlock-background)",
                border: "1px solid var(--vscode-widget-border)",
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--vscode-editorWidget-background)",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <i
                  className="codicon codicon-robot text-vscode-charts-purple"
                  style={{ fontSize: "14px" }}
                />
                <span
                  style={{
                    fontWeight: "600",
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {t("chat:subtasks.newTaskContent")}
                </span>
                <span className="ml-auto text-[10px] opacity-50 font-mono">
                  AGENT 1
                </span>
              </div>
              <div style={{ padding: "12px 16px", fontSize: "13px" }}>
                <MarkdownBlock markdown={prompt} />
              </div>
            </div>
          </ToolUseBlock>
        </div>
      </AnimatedAccordion>
    </div>
  );
};
