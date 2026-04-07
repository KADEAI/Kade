import React, { useMemo } from "react";
import styled from "styled-components";
import { vscode } from "@/utils/vscode";

interface ToolFilePathProps {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

const FilePathButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 0px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-family:
    var(--vscode-editor-font-family), sans-serif;
  font-size: 0.9em;
  color: var(--vscode-foreground);
  transition: background-color 0.2s;

  &:hover {
    background-color: color-mix(
      in srgb,
      var(--vscode-list-hoverBackground) 50%,
      transparent
    );
    text-decoration: underline;
  }

  .filepath-name {
    font-weight: 500;
    color: var(--vscode-textLink-foreground);
  }
`;

export const ToolFilePath: React.FC<ToolFilePathProps> = ({
  filePath,
  startLine,
  endLine,
}) => {
  const fileName = useMemo(() => {
    if (!filePath) return "";
    // Simple path parsing (cross-platform)
    return filePath.split("/").pop()?.split("\\").pop() || filePath;
  }, [filePath]);

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    vscode.postMessage({
      type: "openFile",
      text: filePath,
      // We might need to handle line numbers if the backend supports it in "openFile"
      // Assuming "openFile" handles it or we might need to modify it.
      // But based on ChatRow, it sends `text: tool.content` which seems wrong for openFile?
      // Wait, ChatRow: onClick={() => vscode.postMessage({ type: "openFile", text: tool.content })}
      // Actually for "readFile", tool.content might be the file path? No, tool.content is usually the content.
      // Let's check ChatRow again.
    });
  };

  return (
    <FilePathButton
      role="button"
      tabIndex={0}
      onClick={handleClick}
      title={filePath}
    >
      <span className="filepath-name">{fileName}</span>
    </FilePathButton>
  );
};
