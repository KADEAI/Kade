export interface BuildCliArgsOptions {
	parallelMode?: boolean
	sessionId?: string
	existingBranch?: string
	// Team tracking is handled in extension state, not passed to CLI
	teamId?: string
	teamRole?: "leader" | "worker" | "validator"
	enableSubAgents?: boolean
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 * Runs in interactive mode - approvals are handled via the JSON-IO protocol.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// --json-io: enables bidirectional JSON communication via stdin/stdout
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	// --yolo: auto-approve tool uses (file reads, writes, commands, etc.)
	const args = ["--json-io", "--yolo", `--workspace=${workspace}`]

	if (options?.parallelMode) {
		args.push("--parallel")

		// Add existing branch flag if specified (resume on existing branch)
		if (options.existingBranch) {
			args.push(`--existing-branch=${options.existingBranch}`)
		}
	}

	if (options?.sessionId) {
		args.push(`--session=${options.sessionId}`)
	}

	if (options?.enableSubAgents) {
		args.push("--enable-sub-agents")
	}

	// Note: teamId and teamRole are tracked in extension state only
	// The CLI doesn't have these flags yet - team coordination happens
	// via the extension's AgentRegistry and GroupChatProvider

	// Only add prompt if non-empty
	// When resuming with --session, an empty prompt means "continue from where we left off"
	if (prompt) {
		args.push(prompt)
	}

	return args
}
