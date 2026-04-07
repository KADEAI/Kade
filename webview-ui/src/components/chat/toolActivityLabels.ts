const TOOL_ACTIVITY_NAME_ALIASES: Record<string, string> = {
  read: "readFile",
  read_file: "readFile",
  fetch_instructions: "fetchInstructions",
  list: "listDirTopLevel",
  list_dir: "listDirTopLevel",
  list_files: "listDirTopLevel",
  fast_context: "fastContext",
  switch_mode: "switchMode",
  new_task: "newTask",
  finish_task: "finishTask",
  update_todo_list: "updateTodoList",
  move_file: "moveFile",
  delete_file: "deleteFile",
  generate_image: "generateImage",
};

const TOOL_ACTIVITY_LABELS_BY_NAME: Record<string, string> = {
  readFile: "Reading files",
  fetchInstructions: "Reading instructions",
  listDirTopLevel: "Exploring directories",
  listDirRecursive: "Exploring directories",
  grep: "Searching codebase",
  glob: "Searching codebase",
  fastContext: "Gathering context",
  bash: "Running commands",
  editedExistingFile: "Editing files",
  appliedDiff: "Editing files",
  insertContent: "Editing files",
  searchAndReplace: "Editing files",
  newFileCreated: "Writing files",
  deleteFile: "Writing files",
  moveFile: "Moving files",
  mkdir: "Creating directories",
  wrap: "Wrapping commands",
  web: "Searching the web",
  fetch: "Reading web pages",
  research_web: "Researching online",
  updateTodoList: "Updating task list",
  switchMode: "Switching modes",
  newTask: "Starting task",
  finishTask: "Wrapping up",
  agent: "Delegating work",
  generateImage: "Generating images",
};

export const normalizeToolActivityName = (toolName?: string) =>
  toolName ? TOOL_ACTIVITY_NAME_ALIASES[toolName] || toolName : "";

export const getToolActivityLabel = (toolName?: string) => {
  const normalizedToolName = normalizeToolActivityName(toolName);
  return normalizedToolName
    ? TOOL_ACTIVITY_LABELS_BY_NAME[normalizedToolName]
    : undefined;
};

export const TOOL_ACTIVITY_SUMMARY_TOOL_NAMES = new Set([
  "readFile",
  "read",
  "read_file",
  "listDirTopLevel",
  "listDirRecursive",
  "list",
  "list_dir",
  "list_files",
  "grep",
  "glob",
  "web",
  "fetch",
  "research_web",
  "fetchInstructions",
  "fetch_instructions",
  "fastContext",
  "fast_context",
]);
