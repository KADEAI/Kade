import React, { useState, useMemo } from 'react';
import styled from 'styled-components';
import { vscode } from '../../../utils/vscode';
import { ToolError } from './ToolError';
import { ToolHeader } from './ToolHeader';
import { FileIcon } from './FileIcon';
import { AnimatedAccordion } from '../../common/AnimatedAccordion';
import { useArtificialDelay } from './useArtificialDelay';

// Recursive component to render directory tree
const DirectoryItemRenderer = ({ item }: { item: any }) => {
	const isDir = item.isDir || (item.children && item.children.length > 0);
	const filename = item.name;

	return (
		<div style={{ paddingLeft: '0px' }}>
			<div
				className="flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm hover:bg-vscode-list-hoverBackground hover:underline font-mono"
				onClick={(e) => {
					e.stopPropagation();
					vscode.postMessage({ type: 'openFile', text: item.path });
				}}
				style={{ fontFamily: 'var(--vscode-editor-font-family)', fontSize: '11px' }}
			>
				<div className="flex items-center gap-1.5 flex-shrink-0 text-vscode-editor-foreground">
					<FileIcon fileName={filename} isDirectory={isDir} size={12} />
					<span style={{ color: 'var(--vscode-editor-foreground)' }}>{filename}</span>
				</div>
				{item.sizeInfo && (
					<span className="text-vscode-descriptionForeground opacity-50 whitespace-nowrap ml-1">
						{item.sizeInfo}
					</span>
				)}
			</div>
			{/* Recursive Call for Children */}
			{item.children && item.children.length > 0 && (
				<div style={{ paddingLeft: '12px', borderLeft: '1px solid var(--vscode-tree-indentGuidesStroke)' }}>
					{item.children.map((child: any) => (
						<DirectoryItemRenderer key={child.path} item={child} />
					))}
				</div>
			)}
		</div>
	);
};

interface ListDirToolProps {
	tool: any
	toolResult?: any
	isLastMessage?: boolean
	shouldAnimate?: boolean
}

const DirectoryList = styled.div`
    display: flex;
    flex-direction: column;
    width: 100%;
`;

export const ListDirTool: React.FC<ListDirToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	// Content logic
	const { dirPath, dirName, directoryTree, hasItems } = useMemo(() => {
		const result = toolResult || tool;
		const content = typeof result.content === "string"
			? result.content
			: Array.isArray(result.content)
				? (result.content[0]?.text || "")
				: "";

		if (!content) {
			return { dirPath: '', directoryTree: [], hasItems: false };
		}

		const lines = content.split('\n').filter((line: string) => line.trim() !== '');
		if (lines.length === 0) {
			return { dirPath: '', directoryTree: [], hasItems: false };
		}

		// The first line is usually the directory path itself
		const pathLine = lines[0];
		const pathMatch = pathLine.match(/^(?:Path|Directory): (.+)$/);
		const currentDirPath = pathMatch ? pathMatch[1] : '';

		// Filter out the Path line if it exists to avoid processing it as a file
		const fileLines = pathMatch ? lines.slice(1) : lines;

		const processedItems = fileLines
			.filter((line: string) => {
				// Filter out summary lines and category headers
				if (line.startsWith("Total files:")) return false;
				if (line.startsWith("(file_name|L = line count)")) return false;
				if (/^[\u{1F300}-\u{1F9FF}]/u.test(line)) return false; // Emoji check
				return true;
			})
			.map((line: string) => {
				// Matches: "filename" or "filename (123 lines)" or "filename|L123"
				// Capture groups: 1=filename, 2=Line count (new), 3=Old format info
				const match = line.match(/^(.*?)(?:\|L(\d+)| \(([\d.]+\s+(?:lines?|bytes?|KB|MB|GB|files?))\))?$/i);

				const pathOnly = (match ? match[1] : line).trim();
				let sizeInfo = "";

				if (match) {
					if (match[2]) {
						sizeInfo = `L${match[2]}`;
					} else if (match[3]) {
						sizeInfo = match[3];
					}
				}

				// A path is a directory if it ends with / OR if it has no extension and no size info (common in list_dir)
				const isDir = pathOnly.endsWith('/') || (!pathOnly.includes('.') && !sizeInfo);

				const cleanName = pathOnly.replace(/\/$/, '');
				return {
					name: cleanName,
					path: currentDirPath ? `${currentDirPath.replace(/\/$/, '')}/${cleanName}` : cleanName,
					isDir,
					sizeInfo,
					children: []
				};
			});

		// Deduplicate items by path
		const uniqueItems = [];
		const seenPaths = new Set();
		for (const item of processedItems) {
			if (!seenPaths.has(item.path)) {
				seenPaths.add(item.path);
				uniqueItems.push(item);
			}
		}

		const fullPath = currentDirPath || tool.path || '';
		const name = fullPath.split(/[/\\]/).filter(Boolean).pop() || fullPath;

		return {
			dirPath: fullPath,
			dirName: name,
			directoryTree: uniqueItems,
			hasItems: uniqueItems.length > 0
		};
	}, [tool, toolResult]);

	const isRunning = !!(!hasItems && !toolResult?.is_error && isLastMessage);
	const showLoading = useArtificialDelay(isRunning, 375);
	const status = toolResult?.is_error ? 'error' : showLoading ? 'running' : 'complete';

	const actionVerb = useMemo(() => {
		return showLoading ? "Exploring" : "Explored";
	}, [showLoading]);

	if (!hasItems && !toolResult?.is_error && !isLastMessage) {
		return null;
	}

	const toggleExpand = () => {
		if (hasItems || toolResult?.is_error) {
			setIsExpanded(!isExpanded);
		}
	};

	const canToggle = hasItems || !!toolResult?.is_error;

	return (
		<div className={shouldAnimate ? "animate-tool-entry" : ""}>
			<ToolHeader
				toolName="list_dir"
				actionVerb={actionVerb}
				isPermissionRequest={showLoading}
				isError={toolResult?.is_error}
				status={status}
				isExpanded={isExpanded}
				onToggle={canToggle ? toggleExpand : undefined}
				details={
					<>
						<span
							className="text-vscode-descriptionForeground opacity-85 hover:opacity-100 hover:text-vscode-textLink-foreground hover:underline truncate leading-[1] align-baseline cursor-pointer"
							title={dirPath || tool.path}
							onClick={(e) => {
								e.stopPropagation();
								vscode.postMessage({ type: 'openFile', text: dirPath || tool.path });
							}}
						>
							{dirName}
						</span>
							{!showLoading && hasItems && (
								<span className="text-vscode-descriptionForeground opacity-50 leading-[1] align-baseline ml-1 text-[11px]">
									({directoryTree.length})
								</span>
							)}
					</>
				}
			/>

			<AnimatedAccordion isExpanded={isExpanded}>
				<div
					className="mt-1 ml-2 border-l-2 border-vscode-editorGroup-border pl-4 text-[length:var(--codex-chat-font-size,14px)] leading-[1.5]"
					style={{ fontFamily: 'var(--font-sans, var(--vscode-font-family))' }}>
					{dirPath && (
						<div className="flex items-center gap-1.5 mb-0.5 opacity-80 text-[11px] px-1">
							<span className="italic opacity-70">in</span>
							<FileIcon fileName={dirPath} isDirectory size={16} />
							<span className="text-vscode-editor-foreground font-medium truncate" title={dirPath}>
								{dirPath}
							</span>
						</div>
					)}

					{hasItems ? (
						<DirectoryList>
							<div className="flex flex-col max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
								{directoryTree.map((item: any) => (
									<DirectoryItemRenderer key={item.path} item={item} />
								))}
							</div>
						</DirectoryList>
						) : !showLoading && !toolResult?.is_error ? (
							<div className="text-vscode-descriptionForeground opacity-60 italic text-xs px-1">
								Directory is empty.
							</div>
						) : null}

					{toolResult?.is_error && <ToolError toolResult={toolResult} />}
				</div>
			</AnimatedAccordion>
		</div>
	);
};
