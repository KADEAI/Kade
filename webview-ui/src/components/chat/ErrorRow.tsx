import React, { useState, useCallback, memo } from "react"
import styled, { keyframes } from "styled-components"
import { useTranslation } from "react-i18next"
import { Info, Copy, Check } from "lucide-react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import CodeBlock from "../kilocode/common/CodeBlock"
import { Button } from "@src/components/ui"
import { Dialog, DialogContent, DialogTitle } from "@src/components/ui/dialog"

const fadeIn = keyframes`
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
`;

const ErrorContainer = styled.div`
    display: flex;
    flex-direction: column;
    width: 100%;
    animation: ${fadeIn} 0.3s ease-out;
    margin: 1px 0;
`;

const CompactHeader = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    width: 100%;
    padding: 1px 0;
`;

const IconWrapper = styled.div`
    display: flex;
    align-items: center;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    font-size: 13px;
    flex-shrink: 0;
`;

const ErrorLabel = styled.span`
    font-family: "Segoe WPC", "Segoe UI", sans-serif;
    font-size: 13px;
    font-weight: 400;
    color: var(--vscode-descriptionForeground);
    opacity: 0.9;
    white-space: nowrap;
    flex-shrink: 0;
    margin-right: 4px;
`;

const ErrorMessage = styled.span`
    font-family: "Segoe WPC", "Segoe UI", sans-serif;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    cursor: default;
`;

const InlineContent = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
`;

const Actions = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.2s ease;
    ${ErrorContainer}:hover & {
        opacity: 1;
    }
`;

const ActionIconButton = styled.button`
    background: transparent;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s;
    &:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-foreground);
        opacity: 1;
    }
`;

const SubContent = styled.div`
    margin-left: 19px;
    margin-top: 2px;
    border-left: 1px solid var(--vscode-panel-border);
    padding-left: 10px;
`;

export interface ErrorRowProps {
	type:
	| "error"
	| "mistake_limit"
	| "api_failure"
	| "diff_error"
	| "streaming_failed"
	| "cancelled"
	| "api_req_retry_delayed"
	title?: string
	message: string
	showCopyButton?: boolean
	expandable?: boolean
	defaultExpanded?: boolean
	additionalContent?: React.ReactNode
	headerClassName?: string
	messageClassName?: string
	showLoginButton?: boolean
	onLoginClick?: () => void
	errorDetails?: string
}

export const ErrorRow = memo(
	({
		type,
		title: customTitle,
		message,
		showCopyButton = false,
		expandable = false,
		defaultExpanded = false,
		additionalContent,
		showLoginButton = false,
		onLoginClick,
		errorDetails,
	}: ErrorRowProps) => {
		const { t } = useTranslation()
		const [isExpanded, setIsExpanded] = useState(defaultExpanded)
		const [showCopySuccess, setShowCopySuccess] = useState(false)
		const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
		const [showDetailsCopySuccess, setShowDetailsCopySuccess] = useState(false)
		const { copyWithFeedback } = useCopyToClipboard()

		const title = customTitle || (() => {
			switch (type) {
				case "error": return t("chat:error")
				case "mistake_limit": return t("chat:troubleMessage")
				case "api_failure": return "API Error"
				case "api_req_retry_delayed": return "API Error"
				case "streaming_failed": return "API Error"
				case "cancelled": return "API Error"
				case "diff_error": return t("chat:diffError.title")
				default: return "Error"
			}
		})()

		const handleCopy = useCallback(async (e: React.MouseEvent) => {
			e.stopPropagation()
			const success = await copyWithFeedback(message)
			if (success) {
				setShowCopySuccess(true)
				setTimeout(() => setShowCopySuccess(false), 1000)
			}
		}, [message, copyWithFeedback])

		const handleCopyDetails = useCallback(async (e: React.MouseEvent) => {
			e.stopPropagation()
			if (errorDetails) {
				const success = await copyWithFeedback(errorDetails)
				if (success) {
					setShowDetailsCopySuccess(true)
					setTimeout(() => setShowDetailsCopySuccess(false), 1000)
				}
			}
		}, [errorDetails, copyWithFeedback])

		return (
			<ErrorContainer>
				<CompactHeader title={message}>
					<IconWrapper>
						<span className="codicon codicon-error"></span>
					</IconWrapper>
					<ErrorLabel>{title}</ErrorLabel>
					<ErrorMessage>{message}</ErrorMessage>

					<InlineContent>
						{additionalContent && !isExpanded && (
							<div style={{ display: 'flex', alignItems: 'center' }}>
								{additionalContent}
							</div>
						)}
					</InlineContent>

					<Actions>
						{errorDetails && (
							<ActionIconButton
								onClick={() => setIsDetailsDialogOpen(true)}
								title={t("chat:errorDetails.title")}
							>
								<Info size={13} />
							</ActionIconButton>
						)}
						{showCopyButton && (
							<ActionIconButton onClick={handleCopy} title="Copy error message">
								{showCopySuccess ? <Check size={13} /> : <Copy size={13} />}
							</ActionIconButton>
						)}
						{expandable && (
							<ActionIconButton onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "Collapse" : "Expand"}>
								<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`} style={{ fontSize: '12px' }} />
							</ActionIconButton>
						)}
					</Actions>
				</CompactHeader>

				{(isExpanded || (additionalContent && isExpanded) || showLoginButton) && (
					<SubContent>
						{isExpanded && type === "diff_error" && (
							<div className="mt-1 rounded-md overflow-hidden border border-vscode-editorGroup-border shadow-sm">
								<CodeBlock source={message} language="xml" />
							</div>
						)}
						{isExpanded && additionalContent}
						{showLoginButton && onLoginClick && (
							<div className="mt-1">
								<Button variant="secondary" size="sm" style={{ height: '22px', fontSize: '11px', padding: '0 8px' }} onClick={onLoginClick}>
									{t("kilocode:settings.provider.login")}
								</Button>
							</div>
						)}
					</SubContent>
				)}

				{errorDetails && (
					<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
						<DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl p-0 gap-0 overflow-hidden">
							<div className="px-5 pt-5 pb-3">
								<DialogTitle>{t("chat:errorDetails.title")}</DialogTitle>
							</div>
							<div className="max-h-96 overflow-auto bg-vscode-editor-background border-y border-vscode-editorGroup-border">
								<pre className="font-mono text-sm whitespace-pre-wrap break-words bg-transparent p-4">
									{errorDetails}
								</pre>
							</div>
							<div className="px-5 py-4 flex justify-end">
								<Button variant="secondary" onClick={handleCopyDetails}>
									{showDetailsCopySuccess ? (
										<><Check className="size-3 mr-2" /> {t("chat:errorDetails.copied")}</>
									) : (
										<><Copy className="size-3 mr-2" /> {t("chat:errorDetails.copyToClipboard")}</>
									)}
								</Button>
							</div>
						</DialogContent>
					</Dialog>
				)}
			</ErrorContainer>
		)
	}
)

export default ErrorRow
