import React, { useMemo } from 'react';
import { vscode } from '@/utils/vscode';

import { ToolHeader } from './ToolHeader';
import { useArtificialDelay } from './useArtificialDelay';

export interface ReadToolProps {
    tool: any;
    toolResult?: any;
    isLastMessage?: boolean;
    shouldAnimate?: boolean;
    autoApprovalEnabled?: boolean; // kilocode_change: accept auto-approval setting
}

const ReadToolBody: React.FC<ReadToolProps> = ({ tool, toolResult: _toolResult, isLastMessage, shouldAnimate, autoApprovalEnabled }) => {
    const filePath = useMemo(() => {
        const raw = tool.path || tool.file_path || tool.notebook_path || '';
        // kilocode_change: Strip embedded line ranges from path (e.g. "flappy.html 1-260" → "flappy.html")
        // The backend handlePartial sometimes leaks the raw path with line ranges included
        const rangeStripped = raw.replace(/\s+\d+-\d+$/, '');
        return rangeStripped || raw;
    }, [tool]);
    const fileName = useMemo(() => {
        if (!filePath) return '';
        const parts = filePath.split(/[\\/]/);
        return parts.pop() || filePath;
    }, [filePath]);

    // kilocode_change: Hide redundant "combined" read blocks that can occur with XML shorthand
    // The backend sometimes emits a summary tool call with concatenated paths in addition to individual reads.
    const isRedundantBatch = useMemo(() => {
        const raw = tool.path || '';
        // If it sends a list of files in the path for a single ReadTool, it's a display artifact
        if (raw.includes(", ") && raw.split(", ").length > 1) {
            return true;
        }
        // If it contains XML tags in the path, it's a parsing artifact
        if (raw.includes("<") && raw.includes(">")) {
            return true;
        }
        return false;
    }, [tool.path]);

    const content = useMemo(() => {
        if (typeof tool.content === 'string' && tool.content.length > 0) return tool.content;
        if (typeof _toolResult?.content === 'string') return _toolResult.content;
        if (Array.isArray(_toolResult?.content)) {
            return _toolResult.content.map((c: any) => c.text || '').join('');
        }
        return '';
    }, [tool.content, _toolResult]);
    const isRunning = !!(isLastMessage && !content && !_toolResult?.is_error);
    const showLoading = useArtificialDelay(isRunning);
    // Hide permission buttons if auto-approved, but keep the real running state.
    const isPermissionRequest = isRunning && autoApprovalEnabled === false;
    const status = _toolResult?.is_error ? 'error' : showLoading ? 'running' : 'complete';

    const actionVerb = useMemo(() => {
        return showLoading ? "Reading" : "Read";
    }, [showLoading]);

    const lineRange = useMemo(() => {
        if (!tool.reason) return null;
        const rangeMatch = tool.reason.match(/(\d+)\D+(\d+)/);
        if (rangeMatch) return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
        const singleMatch = tool.reason.match(/(\d+)/);
        if (singleMatch) return { start: parseInt(singleMatch[1]), end: parseInt(singleMatch[1]) };
        return null;
    }, [tool.reason]);

    const lineLabel = useMemo(() => {
        // kilocode_change: Add visual indicators for head/tail reads
        const headVal = tool.head || tool.params?.head || tool.nativeArgs?.head || 
                       (tool.nativeArgs?.files?.[0] as any)?.head || 
                       _toolResult?.head || _toolResult?.files?.[0]?.head;
        
        const tailVal = tool.tail || tool.params?.tail || tool.nativeArgs?.tail || 
                       (tool.nativeArgs?.files?.[0] as any)?.tail || 
                       _toolResult?.tail || _toolResult?.files?.[0]?.tail;

        const indicators = [];
        if (headVal) indicators.push("⬆️");
        if (tailVal) indicators.push("⬇️");

        if (!lineRange) {
            const parts = [];
            if (headVal) parts.push(`⬆️ #L${headVal}`);
            if (tailVal) parts.push(`⬇️ #L${tailVal}`);
            return parts.join(" ");
        }

        const label = lineRange.start === lineRange.end ? `#L${lineRange.start}` : `#L${lineRange.start}-${lineRange.end}`;
        return indicators.length > 0 ? `${indicators.join("")} ${label}` : label;
    }, [lineRange, tool, _toolResult]);
    if (isRedundantBatch) {
        return null;
    }

    return (
        <div className={shouldAnimate ? "animate-tool-entry" : ""}>
            <ToolHeader
                toolName="read"
                actionVerb={actionVerb}
                isPermissionRequest={isPermissionRequest}
                isError={_toolResult?.is_error}
                status={status}
                details={
                    <>
                        <span
                            className="text-vscode-descriptionForeground opacity-85 hover:opacity-100 hover:text-vscode-textLink-foreground hover:underline truncate leading-[1] align-baseline cursor-pointer"
                            title={filePath}
                            onClick={(e) => {
                                e.stopPropagation();
                                vscode.postMessage({
                                    type: 'openFile',
                                    text: filePath,
                                    values: lineRange ? { line: lineRange.start, endLine: lineRange.end } : undefined
                                });
                            }}
                        >
                            {fileName}
                            {lineLabel && (
                                <span className="ml-1">{lineLabel}</span>
                            )}
                        </span>
                    </>
                }
            />
        </div>
    );
};

export const ReadTool: React.FC<ReadToolProps> = (props) => <ReadToolBody {...props} />;

