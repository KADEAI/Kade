import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { useEvent } from "react-use";
import { McpExecutionStatus, mcpExecutionStatusSchema } from "@roo-code/types";
import {
  ExtensionMessage,
  ClineAskUseMcpServer,
} from "../../../../../src/shared/ExtensionMessage";
import { safeJsonParse } from "../../../../../src/shared/safeJsonParse";
import { ToolHeader } from "./ToolHeader";
import { ToolError } from "./ToolError";
import { AnimatedAccordion } from "../../common/AnimatedAccordion";
import CodeBlock from "../../kilocode/common/CodeBlock";

interface McpToolProps {
  executionId: string;
  serverName?: string;
  toolName?: string;
  arguments?: string;
  useMcpServer?: ClineAskUseMcpServer;
  isLastMessage?: boolean;
  shouldAnimate?: boolean;
}

const ScrollableContent = styled.div`
  max-height: 300px;
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

export const McpTool: React.FC<McpToolProps> = ({
  executionId,
  serverName: initialServerName,
  toolName: initialToolName,
  arguments: argsText,
  useMcpServer,
  isLastMessage,
  shouldAnimate,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState<McpExecutionStatus | null>(null);
  const [responseText, setResponseText] = useState("");
  const [serverName, setServerName] = useState(initialServerName || "");
  const [toolName, setToolName] = useState(initialToolName || "");

  // Listen for MCP execution status messages
  const onMessage = useCallback(
    (event: MessageEvent) => {
      const message: ExtensionMessage = event.data;
      if (message.type === "mcpExecutionStatus") {
        try {
          const result = mcpExecutionStatusSchema.safeParse(
            safeJsonParse(message.text || "{}", {}),
          );
          if (result.success) {
            const data = result.data;
            if (data.executionId === executionId) {
              setStatus(data);
              if (data.status === "output" && data.response) {
                setResponseText((prev) => prev + data.response);
              } else if (data.status === "completed" && data.response) {
                setResponseText(data.response);
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse MCP execution status", e);
        }
      }
    },
    [executionId],
  );

  useEvent("message", onMessage);

  useEffect(() => {
    if (useMcpServer?.response) {
      setResponseText(useMcpServer.response);
    }
    if (initialServerName && initialServerName !== serverName) {
      setServerName(initialServerName);
    }
    if (initialToolName && initialToolName !== toolName) {
      setToolName(initialToolName);
    }
  }, [useMcpServer, initialServerName, initialToolName, serverName, toolName]);

  // Format arguments for display
  const formattedArgs = useMemo(() => {
    if (!argsText) return "";
    try {
      const parsed = JSON.parse(argsText);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return argsText;
    }
  }, [argsText]);

  // Format response for display
  const formattedResponse = useMemo(() => {
    if (!isExpanded || !responseText) return responseText;
    if (status?.status === "completed") {
      try {
        const parsed = JSON.parse(responseText);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return responseText;
      }
    }
    return responseText;
  }, [responseText, isExpanded, status]);

  const hasResponse = !!responseText;
  const hasError = status?.status === "error";
  const isComplete = status?.status === "completed";
  const isRunning = status?.status === "started";
  const content = hasResponse || hasError || !!argsText;

  const isPermissionRequest =
    !hasResponse && !hasError && !isComplete && isLastMessage;

  const actionVerb = useMemo(() => {
    if (isPermissionRequest) return `Running ${toolName}`;
    if (isRunning) return `Running ${toolName}`;
    return `Used ${toolName}`;
  }, [isPermissionRequest, isRunning, toolName]);

  const canToggle = content && !isPermissionRequest;

  const toggleExpand = () => {
    if (canToggle) {
      setIsExpanded(!isExpanded);
    }
  };

  // Status indicator dot
  const statusDot = useMemo(() => {
    if (!status) return null;
    if (status.status === "error") return "❌";
    if (status.status === "completed") return "✓";
    return null;
  }, [status]);

  return (
    <div className={shouldAnimate ? "animate-tool-entry" : ""}>
      <div style={{ marginTop: "-10px", marginBottom: "-3px" }}>
        <ToolHeader
          toolName="mcp"
          actionVerb={actionVerb}
          isPermissionRequest={isPermissionRequest}
          isExpanded={isExpanded}
          onToggle={canToggle ? toggleExpand : undefined}
          details={
            <span
              className="text-vscode-descriptionForeground opacity-75 truncate antialiased"
              title={`${serverName}/${toolName}`}
            >
              {serverName}
            </span>
          }
          extra={
            statusDot && !isPermissionRequest ? (
              <span className="text-[11px] opacity-60 ml-0.5">{statusDot}</span>
            ) : undefined
          }
        />
      </div>

      <AnimatedAccordion isExpanded={isExpanded} unmountWhenCollapsed={true}>
        <div
          className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
          style={{ fontFamily: "var(--font-sans, var(--vscode-font-family))" }}
        >
          <ScrollableContent>
            {/* Arguments */}
            {formattedArgs && (
              <div className="mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-1">
                  Arguments
                </div>
                <CodeBlock source={formattedArgs} language="json" />
              </div>
            )}

            {/* Response */}
            {hasResponse && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-1">
                  Response
                </div>
                <CodeBlock source={formattedResponse} language="json" />
              </div>
            )}

            {/* Error */}
            {hasError && "error" in status && status.error && (
              <ToolError
                toolResult={{ is_error: true, content: status.error }}
              />
            )}
          </ScrollableContent>
        </div>
      </AnimatedAccordion>
    </div>
  );
};
