import { useCallback, useState, useMemo, useEffect } from "react"
import { useEvent } from "react-use"

import { CommandExecutionStatus, commandExecutionStatusSchema } from "@roo-code/types"

import { ExtensionMessage } from "@roo/ExtensionMessage"
import { safeJsonParse } from "@roo/safeJsonParse"

import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

import { Bash } from "../tools/Bash"

interface CommandExecutionProps {
	executionId: string
	text?: string
	isAskingToProceed?: boolean
	isLast?: boolean
	assistantCommand?: string
	shouldAnimate?: boolean
	allowOutputAutoScroll?: boolean
}

export const CommandExecution = ({
	executionId,
	text,
	isAskingToProceed,
	isLast,
	assistantCommand,
	shouldAnimate,
	allowOutputAutoScroll = true,
}: CommandExecutionProps) => {
	const {
		terminalShellIntegrationDisabled = true, // kade_change: default
	} = useExtensionState()

	const { command, output: parsedOutput } = useMemo(() => parseCommandAndOutput(text), [text])

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)
	const [streamingOutput, setStreamingOutput] = useState("")
	const [status, setStatus] = useState<CommandExecutionStatus | null>(null)

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput

	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							setStatus(data)
							break
						case "output":
							setStreamingOutput(data.output)
							break
						case "fallback":
							setIsExpanded(true)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	const [storedCommand, setStoredCommand] = useState<string | undefined>(undefined);

	// Capture the command from status when it's first started
	useEffect(() => {
		if (status?.status === "started" && status.command && !storedCommand) {
			setStoredCommand(status.command);
		}
	}, [status, storedCommand]);

	const commandFromStatus = status?.status === "started" ? status.command : undefined;
	const finalCommand = storedCommand || commandFromStatus || assistantCommand || (command || text || "").trim();

	return (
		<div className={cn("mb-1", shouldAnimate && "animate-tool-entry", isLast && "will-change-transform")}>
			<Bash
				command={finalCommand}
				output={output}
				isError={(status?.status === "exited" && status.exitCode !== 0) || status?.status === "timeout"}
				isKey={isLast || status?.status === "started" || (terminalShellIntegrationDisabled && !status && isLast)}
				isRunning={status?.status === "started" || (terminalShellIntegrationDisabled && !status && isLast)}
				executionId={executionId}
				isAskingToProceed={isAskingToProceed}
				allowOutputAutoScroll={allowOutputAutoScroll}
			/>

			{/* Disabled in chat rows to keep command item heights stable for Virtuoso scrolling. */}
		</div>
	)
}

CommandExecution.displayName = "CommandExecution"

const normalizeDuplicateOutput = (output: string): string => {
	if (!output) return output

	// Case 1: Entire payload duplicated back-to-back.
	const half = Math.floor(output.length / 2)
	if (output.length % 2 === 0 && output.slice(0, half) === output.slice(half)) {
		return output.slice(0, half)
	}

	// Case 2: Adjacent duplicated lines from repeated merge of the same chunk.
	const lines = output.split("\n")
	const deduped: string[] = []
	for (const line of lines) {
		if (deduped.length > 0 && deduped[deduped.length - 1] === line && line.trim().length > 0) {
			continue
		}
		deduped.push(line)
	}
	return deduped.join("\n")
}

const parseCommandAndOutput = (text: string | undefined) => {
	if (!text) {
		return { command: "", output: "" };
	}

	// Check for persistent command command at the start of output
	// It might appear as "Command: cmd" or "\nOutput:Command: cmd" depending on how it was combined
	const commandMatch = text.match(/(?:^|\n)Output:Command:\s*(.*?)(?:\n|$)/);
	if (commandMatch) {
		const command = commandMatch[1].trim();
		// We want to show the full output including the command line if desired, 
		// but usually the terminal header shows the command.
		// The output currently contains "Command: ...", let's keep it or strip it?
		// User might want to see what they ran.
		// But let's strip the specific "Command: " line from the displayed output if checking pure clean output.
		// For now, return the command and the full text as output (minus the marker if needed).

		// Actually, let's just use the regex extraction for the command name, 
		// and return the rest as output.
		// Fallback split logic below handles separation if we don't return here.
		// But we want to return here to ensure we get the command name.

		// Let's strip the "Command: ..." line from the start to avoid duplication.
		let output = text.replace(commandMatch[0], "");
		// If output starts with Output: marker, remove it
		output = output.replace(/^\n?Output:\n?/, "");

		return { command, output: normalizeDuplicateOutput(output || text) }; // If stripping made it empty, maybe return original? No, consistent.
	}

	// First, check if text starts with "Command: " (raw tool result style)
	if (text.startsWith("Command: ")) {
		const parts = text.split("\nOutput:\n");
		if (parts.length >= 2) {
			const command = parts[0].replace("Command: ", "").trim();
			const output = parts.slice(1).join("\nOutput:\n");
			return { command, output: normalizeDuplicateOutput(output) };
		}
	}

	// Fallback: split on COMMAND_OUTPUT_STRING
	const parts = text.split(COMMAND_OUTPUT_STRING);
	if (parts.length >= 2) {
		const command = parts[0].trim();
		const output = parts.slice(1).join(COMMAND_OUTPUT_STRING);
		return { command, output: normalizeDuplicateOutput(output) };
	}

	// No delimiter found
	return { command: "", output: normalizeDuplicateOutput(text) };
}
