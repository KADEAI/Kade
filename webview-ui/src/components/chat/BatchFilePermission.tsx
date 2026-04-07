import React, { memo } from "react";
import styled, { keyframes } from "styled-components";
import { vscode } from "@src/utils/vscode";
import { FileIcon } from "./tools/FileIcon";

interface FilePermissionItem {
  path: string;
  lineSnippet?: string;
  isOutsideWorkspace?: boolean;
  key: string;
  content?: string; // full path
  lineRange?: { start: number; end: number };
}

interface BatchFilePermissionProps {
  files: FilePermissionItem[];
  onPermissionResponse?: (response: { [key: string]: boolean }) => void;
  ts: number;
  isLastMessage?: boolean;
}

const textShimmer = keyframes`
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
`;

const ShimmerSpan = styled.span`
  display: inline-block;
  background: linear-gradient(
    120deg,
    var(--vscode-descriptionForeground) 40%,
    var(--vscode-editor-foreground) 50%,
    var(--vscode-descriptionForeground) 60%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ${textShimmer} 3s linear infinite;
`;

export const BatchFilePermission = memo(
  ({
    files = [],
    onPermissionResponse,
    ts,
    isLastMessage,
  }: BatchFilePermissionProps) => {
    // Don't render if there are no files or no response handler
    if (!files?.length || !onPermissionResponse) {
      return null;
    }

    const showLoading = !!isLastMessage;
    const actionVerb = showLoading ? "Reading" : "Read";

    return (
      <div className="flex flex-col gap-0">
        {files.map((file) => {
          const fileName = (() => {
            if (!file.path) return "";
            const parts = file.path.split(/[\\\/]/);
            return parts.pop() || file.path;
          })();

          return (
            <div
              key={`${file.path}-${ts}`}
              className="block text-[13px] leading-normal"
              style={{ fontFamily: '"Segoe WPC", "Segoe UI", sans-serif' }}
            >
              <div className="flex items-center gap-1.5">
                {showLoading ? (
                  <ShimmerSpan className="font-normal antialiased opacity-80">
                    {actionVerb}
                  </ShimmerSpan>
                ) : (
                  <span className="text-vscode-descriptionForeground font-normal opacity-80 antialiased">
                    {actionVerb}
                  </span>
                )}

                <div
                  className="flex items-center gap-1.5 cursor-pointer truncate antialiased group"
                  title={file.path}
                  onClick={() =>
                    vscode.postMessage({
                      type: "openFile",
                      text: file.content,
                      values: file.lineRange
                        ? {
                            line: file.lineRange.start,
                            endLine: file.lineRange.end,
                          }
                        : undefined,
                    })
                  }
                >
                  <div className="flex-shrink-0 flex items-center opacity-70 group-hover:opacity-100">
                    <FileIcon fileName={file.path} size={14} />
                  </div>

                  <span className="text-vscode-descriptionForeground opacity-50 group-hover:opacity-100 group-hover:text-vscode-textLink-foreground truncate">
                    {fileName}
                  </span>

                  {file.lineSnippet && (
                    <span className="text-vscode-descriptionForeground opacity-60 group-hover:opacity-100 antialiased font-medium">
                      {file.lineSnippet}
                    </span>
                  )}
                </div>

                {showLoading ? (
                  <span
                    className="codicon codicon-loading codicon-modifier-spin opacity-50 shrink-0"
                    style={{ fontSize: "12px" }}
                  />
                ) : (
                  <span
                    className="codicon codicon-check opacity-50 shrink-0"
                    style={{ fontSize: "12px" }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);

BatchFilePermission.displayName = "BatchFilePermission";
