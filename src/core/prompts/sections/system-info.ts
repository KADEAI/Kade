import os from "os"
import osName from "os-name"

import { getShell } from "../../../utils/shell"

export function getSystemInfoSection(cwd: string): string {
	let details = `# SYSTEM INFORMATION
OS: ${osName()}
Shell: ${getShell()}
Home Path: ${os.homedir().toPosix()}
CWD: ${cwd.toPosix()}
This is the CWD, and where tools default to. When using tools, use relative paths, not absolute`
	return details
}
