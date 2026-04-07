import { ToolArgs } from "./types";

export function getExecuteCommandDescription(
  args: ToolArgs,
): string | undefined {
  if (args.compact) {
    return `## bash
Execute a CLI command, or when AI stdin mode is enabled, send stdin to the selected running terminal process. Target the user's OS and use relative paths.
<bash><command>...</command><stdin>...</stdin><execution_id>...</execution_id><cwd>...</cwd></bash>`;
  }

  return `## bash
Description: Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency, e.g: \`touch ./testdata/example.file\`, \`dir ./examples/model1/data/yaml\`, or \`go test ./cmd/front --config ./cmd/front/config.yml\`. If directed by the user, you may open a terminal in a different directory by using the \`cwd\` parameter. When AI stdin mode is enabled for a running terminal, use \`stdin\` instead of \`command\` to send input to that live process.
Parameters:
- command: (required unless using stdin) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- stdin: (optional) Text to send to the currently selected live terminal process in AI stdin mode. This sends input to the existing process instead of starting a new command. Include the intended answer text; Enter/newline is submitted automatically.
- execution_id: (optional) Explicit execution id for the live terminal process when sending stdin. Usually omit this and rely on the currently selected AI stdin target.
- cwd: (optional) The working directory to execute the command in (default: ${args.cwd})
Usage:
<bash>
<command>Your command here</command>
<cwd>Working directory path (optional)</cwd>
</bash>

Usage for AI stdin mode:
<bash>
<stdin>y</stdin>
</bash>

Example: Requesting to execute npm run dev
<bash>
<command>npm run dev</command>
</bash>

Example: Requesting to execute ls in a specific directory if directed
<bash>
<command>ls -la</command>
<cwd>/home/user/projects</cwd>
</bash>`;
}
