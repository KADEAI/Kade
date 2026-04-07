import type { Tool, ToolParam } from "./converters";

export type ToolsRouterOperation =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "web"
  | "fetch"
  | "command"
  | "agent"
  | "todo"
  | "browser_action"
  | "computer_action"
  | "access_mcp_resource"
  | "generate_image";

type CreateToolsRouterOptions = {
  enabledCanonicalTools?: Iterable<string>;
};

type CreateExecuteToolOptions = {
  enabledCanonicalTools?: Iterable<string>;
};

type CreateContentRouterOptions = {
  allowWrite?: boolean;
  allowEdit?: boolean;
};

type ContentRouterTool = "write" | "edit";

const ALL_TOOLS_ROUTER_OPERATIONS: ToolsRouterOperation[] = [
  "read",
  "grep",
  "find",
  "ls",
  "web",
  "fetch",
  "command",
  "agent",
  "todo",
  "browser_action",
  "computer_action",
  "access_mcp_resource",
  "generate_image",
];

const ROUTER_OPERATION_TO_CANONICAL_TOOL: Record<ToolsRouterOperation, string> = {
  read: "read",
  grep: "grep",
  find: "glob",
  ls: "list",
  web: "web",
  fetch: "fetch",
  command: "bash",
  agent: "agent",
  todo: "todo",
  browser_action: "browser_action",
  computer_action: "computer_action",
  access_mcp_resource: "access_mcp_resource",
  generate_image: "generate_image",
};

const BROWSER_ACTIONS = [
  "launch",
  "click",
  "hover",
  "type",
  "press",
  "scroll_down",
  "scroll_up",
  "resize",
  "close",
  "screenshot",
];

const COMPUTER_ACTIONS = [
  "key",
  "type",
  "mouse_move",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "scroll",
  "get_screenshot",
  "get_cursor_position",
];

const TOOLS_ROUTER_OPERATION_ALIASES: Record<ToolsRouterOperation, readonly string[]> = {
  read: ["read_file", "read_files", "open_file", "view_file", "cat"],
  grep: [],
  find: ["glob", "find_files", "file_search"],
  ls: ["list", "dir", "dirlist", "list_files", "list_dir", "list_directory"],
  web: ["web_search", "search_web", "browse_web"],
  fetch: ["fetch_url", "open_url", "visit_url"],
  command: ["bash", "shell", "run_command", "execute_command", "terminal"],
  agent: ["subagent", "run_sub_agent"],
  todo: ["todos", "checklist", "update_todo_list"],
  browser_action: ["browser", "browser_use"],
  computer_action: ["computer", "desktop", "computer_use"],
  access_mcp_resource: ["mcp_resource", "read_mcp_resource"],
  generate_image: ["create_image", "image_generation"],
};

const CONTENT_ROUTER_TOOL_ALIASES: Record<ContentRouterTool, readonly string[]> = {
  write: ["write_file", "create_file", "save_file"],
  edit: ["edit_file", "modify_file", "update_file", "patch_file"],
};

function normalizeRouterAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function resolveToolsRouterOperation(value: string): ToolsRouterOperation | undefined {
  const normalizedValue = normalizeRouterAliasKey(value);

  for (const operation of ALL_TOOLS_ROUTER_OPERATIONS) {
    if (operation === normalizedValue) {
      return operation;
    }
    if (TOOLS_ROUTER_OPERATION_ALIASES[operation].includes(normalizedValue)) {
      return operation;
    }
  }

  return undefined;
}

export function resolveContentRouterTool(value: string): ContentRouterTool | undefined {
  const normalizedValue = normalizeRouterAliasKey(value);

  for (const tool of ["write", "edit"] as const) {
    if (tool === normalizedValue) {
      return tool;
    }
    if (CONTENT_ROUTER_TOOL_ALIASES[tool].includes(normalizedValue)) {
      return tool;
    }
  }

  return undefined;
}

function getEnabledToolsRouterOperations(
  enabledCanonicalTools?: Iterable<string>,
): ToolsRouterOperation[] {
  if (!enabledCanonicalTools) {
    return [...ALL_TOOLS_ROUTER_OPERATIONS];
  }

  const allowed = new Set(enabledCanonicalTools);
  return ALL_TOOLS_ROUTER_OPERATIONS.filter((operation) =>
    allowed.has(ROUTER_OPERATION_TO_CANONICAL_TOOL[operation]),
  );
}

const EXECUTE_INLINE_CANONICAL_TOOLS = [
  "read",
  "grep",
  "glob",
  "list",
  "bash",
  "web",
  "fetch",
  "ask",
  "agent",
  "browser_action",
  "computer_action",
  "access_mcp_resource",
  "generate_image",
] as const;

const EXECUTE_BLOCK_CANONICAL_TOOLS = ["edit", "write", "todo"] as const;

const EXECUTE_COMPATIBILITY_CANONICAL_TOOLS = [
  ...EXECUTE_INLINE_CANONICAL_TOOLS,
  ...EXECUTE_BLOCK_CANONICAL_TOOLS,
] as const;

const EXECUTE_CANONICAL_TOOL_TO_COMMAND: Record<string, string> = {
  read: "read",
  grep: "grep",
  glob: "find",
  list: "list",
  bash: "bash",
  web: "web",
  fetch: "fetch",
  ask: "ask",
  agent: "agent",
  browser_action: "browser_action",
  computer_action: "computer_action",
  access_mcp_resource: "access_mcp_resource",
  generate_image: "generate_image",
  edit: "edit",
  write: "write",
  todo: "todo",
};

function getEnabledExecuteTools(
  enabledCanonicalTools?: Iterable<string>,
): string[] {
  if (!enabledCanonicalTools) {
    return [...EXECUTE_COMPATIBILITY_CANONICAL_TOOLS];
  }

  const allowed = new Set(enabledCanonicalTools);
  return EXECUTE_COMPATIBILITY_CANONICAL_TOOLS.filter((tool) =>
    allowed.has(tool),
  );
}

function buildSection(title: string, lines: Array<string | undefined>): string {
  return `${title}:\n${lines.filter(Boolean).join("\n")}`;
}

function getAdvertisedExecuteCanonicalTools(enabledCanonicalTools: string[]): string[] {
  return enabledCanonicalTools.includes("agent")
    ? enabledCanonicalTools
    : [...enabledCanonicalTools, "agent"];
}

function buildExecuteDescription(enabledCanonicalTools: string[]): string {
  const advertisedCanonicalTools = getAdvertisedExecuteCanonicalTools(
    enabledCanonicalTools,
  );
  const enabledCommands = advertisedCanonicalTools.map(
    (tool) => EXECUTE_CANONICAL_TOOL_TO_COMMAND[tool] ?? tool,
  );
  const enabledList = enabledCommands.join(", ");

  return [
    buildSection("Description", [
      `The calls array uses standard JSON objects. Enabled commands: ${enabledList}.`,
      enabledCommands.length > 0
        ? `Call only tool. Do not call ${enabledCommands.join(", ")} directly.`
        : "Call only tool. Do not call native tools directly.",
      "Each calls item must be an object with a tool field and tool-specific fields such as query, path, prompt, url, content, old, new, lines, or action.",
      "Do not use DSL strings inside calls items.",
      "Keep each item minimal: prefer canonical fields over aliases.",
      "Use path arrays for multi-read or multi-list actions.",
      "Use string arrays for multi-query fields when needed.",
      "For edit, prefer flat old/new/lines fields for one replacement, or use edit: [{ old, new, lines? }] for structured multi-block edits.",
    ]),
    buildSection("Syntax", [
      '{ "calls": [{ "tool": "<command>", "...": "..." }] }',
      '{ "tool": "read", "path": ["src/app.ts:L10-40", "package.json:H20"] }',
      '{ "tool": "grep", "query": ["auth", "login", "session"], "path": "src" }',
      '{ "tool": "find", "query": "package.json,tsconfig.json", "path": "src" }',
      '{ "tool": "bash", "query": "npm run build", "path": "apps/web" }',
      '{ "tool": "edit", "path": "src/app.ts", "old": "foo", "new": "bar", "lines": "10-12" }',
      '{ "tool": "write", "path": "notes.txt", "content": "build passed" }',
    ]),
    buildSection("Examples", [
      '{ "calls": [{ "tool": "read", "path": ["src/app.ts:L1-80", "package.json"] }] }',
      '{ "calls": [{ "tool": "ask", "query": "auth flow entrypoint", "path": "src" }] }',
      '{ "calls": [{ "tool": "fetch", "url": "https://example.com" }] }',
      '{ "calls": [{ "tool": "agent", "prompt": "analyze the current project structure" }] }',
      '{ "calls": [{ "tool": "generate_image", "prompt": "architecture diagram", "path": "artifacts/architecture.png" }] }',
    ]),
  ].join("\n\n");
}

function buildExecuteCallItemProperties(enabledCanonicalTools: Set<string>): Record<string, ToolParam> {
  const advertisedCanonicalTools = new Set(
    getAdvertisedExecuteCanonicalTools(Array.from(enabledCanonicalTools)),
  );
  const commandEnums = Array.from(advertisedCanonicalTools).map(
    (tool) => EXECUTE_CANONICAL_TOOL_TO_COMMAND[tool] ?? tool,
  );
  const properties: Record<string, ToolParam> = {
    tool: {
      type: "string",
      description: "Command to perform.",
      enum: commandEnums,
    },
  };

  if (
    advertisedCanonicalTools.has("grep") ||
    advertisedCanonicalTools.has("glob") ||
    advertisedCanonicalTools.has("bash") ||
    advertisedCanonicalTools.has("web") ||
    advertisedCanonicalTools.has("ask")
  ) {
    properties.query = {
      type: ["string", "array", "null"],
      description:
        "Generic primary value for grep text, find patterns, bash commands, web queries, or ask queries.",
      items: { type: "string", description: "One query value." },
    };
  }

  if (
    advertisedCanonicalTools.has("read") ||
    advertisedCanonicalTools.has("list") ||
    advertisedCanonicalTools.has("bash") ||
    advertisedCanonicalTools.has("grep") ||
    advertisedCanonicalTools.has("glob") ||
    advertisedCanonicalTools.has("ask") ||
    advertisedCanonicalTools.has("edit") ||
    advertisedCanonicalTools.has("write") ||
    advertisedCanonicalTools.has("generate_image")
  ) {
    properties.path = {
      type: ["string", "array", "null"],
      description:
        "Workspace path or paths. For read, use file targets like 'src/app.ts:L10-40' or arrays for multi-read. For list, use '.' for the current working directory. For bash, this acts as cwd.",
      items: { type: "string", description: "One path target." },
    };
  }

  if (advertisedCanonicalTools.has("agent")) {
    properties.prompt = {
      type: ["string", "null"],
      description: "Used by agent.",
    };
  }

  if (advertisedCanonicalTools.has("fetch")) {
    properties.url = {
      type: ["string", "null"],
      description: "Used by fetch.",
    };
    properties.include_links = {
      type: ["boolean", "null"],
      description: "Optional include_links flag for fetch.",
    };
  }

  if (advertisedCanonicalTools.has("write")) {
    properties.content = {
      type: ["string", "null"],
      description: "Used by write.",
    };
  }

  if (advertisedCanonicalTools.has("edit")) {
    properties.old = {
      type: ["string", "null"],
      description: "Used by edit. Copy exact existing file text.",
    };
    properties.new = {
      type: ["string", "null"],
      description: "Used by edit.",
    };
    properties.lines = {
      type: ["string", "null"],
      description: "Optional edit hint in start-end format.",
    };
    properties.edit = {
      type: ["array", "null"],
      description:
        "Structured edit payload for edit. Prefer an array of { old, new, lines? } objects for multiple replacements.",
      items: {
        type: "object",
        properties: {
          lines: {
            type: ["string", "null"],
            description: "Optional edit range hint. Prefer including it when available.",
          },
          old: {
            type: ["string", "null"],
            description: "Exact existing text.",
          },
          new: {
            type: "string",
            description: "Replacement text.",
          },
        },
        required: ["old", "new"],
      },
    };
  }

  if (advertisedCanonicalTools.has("todo")) {
    properties.todos = {
      type: ["string", "null"],
      description: "Used by todo.",
    };
  }

  if (advertisedCanonicalTools.has("list")) {
    properties.recursive = {
      type: ["boolean", "null"],
      description: "Optional recursive flag for list.",
    };
  }

  if (advertisedCanonicalTools.has("grep")) {
    properties.include = {
      type: ["string", "array", "null"],
      description: "Optional include filter for grep.",
      items: { type: "string", description: "One include value." },
    };
  }

  if (advertisedCanonicalTools.has("browser_action")) {
    properties.action = {
      type: ["string", "null"],
      description: "Used by browser_action.",
      enum: BROWSER_ACTIONS,
    };
    properties.coordinate = {
      type: ["string", "null"],
      description: "Used by browser_action pointer actions.",
    };
    properties.size = {
      type: ["string", "null"],
      description: "Used by browser_action resize.",
    };
    properties.text = {
      type: ["string", "null"],
      description: "Used by browser_action type or press.",
    };
    properties.url = properties.url ?? {
      type: ["string", "null"],
      description: "Used by browser_action launch.",
    };
  }

  if (advertisedCanonicalTools.has("computer_action")) {
    properties.action = {
      type: ["string", "null"],
      description: "Used by computer_action.",
      enum: COMPUTER_ACTIONS,
    };
    properties.coordinate = {
      type: ["string", "null"],
      description: "Used by computer_action pointer actions.",
    };
    properties.text = {
      type: ["string", "null"],
      description: "Used by computer_action text actions.",
    };
  }

  if (advertisedCanonicalTools.has("generate_image")) {
    properties.prompt = properties.prompt ?? {
      type: ["string", "null"],
      description: "Used by generate_image.",
    };
    properties.image = {
      type: ["string", "null"],
      description: "Used by generate_image when editing an existing image.",
    };
  }

  if (advertisedCanonicalTools.has("access_mcp_resource")) {
    properties.server_name = {
      type: ["string", "null"],
      description: "Used by access_mcp_resource.",
    };
    properties.uri = {
      type: ["string", "null"],
      description: "Used by access_mcp_resource.",
    };
  }

  return properties;
}

export function createExecuteTool(options: CreateExecuteToolOptions = {}): Tool {
  const enabledCanonicalTools = getEnabledExecuteTools(
    options.enabledCanonicalTools,
  );
  const enabledSet = new Set(enabledCanonicalTools);

  return {
    name: "tool",
    description: buildExecuteDescription(enabledCanonicalTools),
    strict: false,
    params: {
      calls: {
        type: "array",
        description:
          "Ordered JSON tool calls. Each item must be an object with a tool field and optional tool-specific fields.",
        minItems: 1,
        items: {
          type: "object",
          description:
            "One JSON tool call. Use tool plus canonical fields such as query, path, prompt, url, content, old, new, lines, edit, action, or image.",
          properties: buildExecuteCallItemProperties(enabledSet),
          required: ["tool"],
        },
      },
    },
    required: ["calls"],
  };
}

function buildToolsRouterDescription(enabledOperations: ToolsRouterOperation[]): string {
  const operations = enabledOperations.join(", ");
  return [
    buildSection("Description", [
      `The main native tool router. Use this for ${operations}.`,
      enabledOperations.length > 0
        ? `Never call native tools directly. Only call the 'tools' function for non-file-mutation actions, not ${enabledOperations.join(", ")} directly.`
        : "Never call native tools directly. Only call the 'tools' function for non-file-mutation actions.",
      "Put every non-file-mutation action inside the ordered 'tools' array. For single actions, still use a one-item array.",
      "Keep each item minimal: prefer 'query' plus optional 'path' when possible. For grep and find, multi-query input may be a pipe string or a string array. For multi-read, use a path array.",
    ]),
    buildSection("Syntax", [
      '{ "tools": [{ "tool": "<operation>", "...": "..." }] }',
      '{ "tool": "read", "path": "src/app.ts:L10-40" }',
      '{ "tool": "grep", "query": "auth|login|session", "path": "src" }',
      '{ "tool": "ls", "path": "." }',
      '{ "tool": "command", "query": "npm run build", "path": "apps/web" }',
    ]),
    buildSection("Examples", [
      '{ "tools": [{ "tool": "read", "path": ["package.json", "src/app.ts:L1-80"] }] }',
      '{ "tools": [{ "tool": "find", "query": "package.json,tsconfig.json", "path": "src" }] }',
      '{ "tools": [{ "tool": "web", "query": "python apps" }] }',
    ]),
  ].join("\n\n");
}

function buildToolsRouterItemsDescription(enabledOperations: Set<ToolsRouterOperation>): string {
  const forms = [
    enabledOperations.has("grep")
      ? "grep => { tool, query, path? } where query may be 'a|b|c' or ['a','b','c']"
      : undefined,
    enabledOperations.has("find")
      ? "find => { tool, query, path? } where query may be 'foo.ts,bar.tsx,sample.txt', '*.{ts,tsx}', or ['foo.ts','bar.tsx','sample.txt']"
      : undefined,
    enabledOperations.has("read")
      ? "read => { tool, path } where path may be 'src/app.ts:L10-40' for one file or ['src/app.ts:L10-40','src/routes.ts','package.json'] for multiple reads"
      : undefined,
    enabledOperations.has("fetch") ? "fetch => { tool, query }" : undefined,
    enabledOperations.has("web") ? "web => { tool, query }" : undefined,
    enabledOperations.has("ls")
      ? "ls => { tool, path } where path should be '.' for the current working directory"
      : undefined,
    enabledOperations.has("command") ? "command => { tool, query, path? }" : undefined,
    enabledOperations.has("agent") ? "agent => { tool, query, mode? }" : undefined,
    enabledOperations.has("todo") ? "todo => { tool, query }" : undefined,
    enabledOperations.has("browser_action")
      ? "browser_action => { tool, action, coordinate?, size?, text?, path? }"
      : undefined,
    enabledOperations.has("computer_action")
      ? "computer_action => { tool, action, coordinate?, text? }"
      : undefined,
    enabledOperations.has("access_mcp_resource")
      ? "access_mcp_resource => { tool, server_name, uri }"
      : undefined,
    enabledOperations.has("generate_image")
      ? "generate_image => { tool, query, path, image? }"
      : undefined,
  ].filter(Boolean);

  return `Ordered tool calls. Use 'tool' to choose the operation inside the 'tools' router. Do not call native tools directly; call the 'tools' function and set the inner 'tool' field. Simplified forms: ${forms.join(
    "; ",
  )}.`;
}

function buildToolsRouterItemProperties(enabledOperations: Set<ToolsRouterOperation>) {
  const properties: Record<string, any> = {
    tool: {
      type: "string",
      description: "Operation to perform.",
      enum: Array.from(enabledOperations),
    },
    query: {
      type: ["string", "array", "null"],
      description:
        "Primary input for most tools. For grep, this may be one string, a pipe-separated string, or a string array. For find, prefer a comma-separated glob list or a string array. Examples: 'auth|login|session', ['auth','login','session'], 'foo.ts,bar.tsx,sample.txt', '*.{ts,tsx}', web query text, a URL for fetch, a shell command for command, or a prompt for agent.",
      items: { type: "string", description: "One query value." },
    },
    path: {
      type: ["string", "array", "null"],
      description:
        "Workspace path or paths. For read, use one file target string such as 'src/app.ts:L10-40' or a string array such as ['src/app.ts:L10-40','src/routes.ts','package.json:H20'] for multiple reads. L#-# is the line range of a read, & H# and T# is heads and tails for a read. For ls, path is required and should be '.' when listing the current working directory. For command, this acts as cwd.",
      items: { type: "string", description: "One path target." },
    },
  };

  if (enabledOperations.has("browser_action")) {
    properties.action = {
      type: ["string", "null"],
      description: "Used by browser_action.",
      enum: BROWSER_ACTIONS,
    };
    properties.coordinate = {
      type: ["string", "null"],
      description: "Used by browser_action for click or hover.",
    };
    properties.size = {
      type: ["string", "null"],
      description: "Used by browser_action resize.",
    };
    properties.text = {
      type: ["string", "null"],
      description: "Used by browser_action type or press.",
    };
  }

  if (enabledOperations.has("computer_action")) {
    const existingActionEnum = Array.isArray(properties.action?.enum)
      ? properties.action.enum
      : [];
    properties.action = {
      type: ["string", "null"],
      description: "Used by browser_action or computer_action.",
      enum: Array.from(new Set([...existingActionEnum, ...COMPUTER_ACTIONS])),
    };
    properties.coordinate = {
      type: ["string", "null"],
      description:
        "Used by browser_action or computer_action pointer actions. For computer_action, prefer format 'x,y@WIDTHxHEIGHT' measured on the screenshot image.",
    };
    properties.text = {
      type: ["string", "null"],
      description:
        "Used by browser_action type/press or computer_action key/type/scroll actions.",
    };
  }

  if (enabledOperations.has("access_mcp_resource")) {
    properties.server_name = {
      type: ["string", "null"],
      description: "Used by access_mcp_resource.",
    };
    properties.uri = {
      type: ["string", "null"],
      description: "Used by access_mcp_resource.",
    };
  }

  if (enabledOperations.has("generate_image")) {
    properties.image = {
      type: ["string", "null"],
      description: "Used by generate_image when editing an existing image.",
    };
  }

  if (enabledOperations.has("agent")) {
    properties.mode = {
      type: ["string", "null"],
      description: "Optional agent mode.",
    };
  }

  return properties;
}

export function createToolsRouter(options: CreateToolsRouterOptions = {}): Tool {
  const enabledOperations = getEnabledToolsRouterOperations(options.enabledCanonicalTools);
  const enabledSet = new Set(enabledOperations);

  return {
    name: "tools",
    description: buildToolsRouterDescription(enabledOperations),
    strict: true,
    params: {
      tools: {
        type: "array",
        description: buildToolsRouterItemsDescription(enabledSet),
        items: {
          type: "object",
          properties: buildToolsRouterItemProperties(enabledSet),
          required: ["tool"],
          allOf: enabledSet.has("ls")
            ? [
                {
                  if: {
                    properties: {
                      tool: { const: "ls" },
                    },
                    required: ["tool"],
                  },
                  then: {
                    required: ["tool", "path"],
                  },
                },
              ]
            : undefined,
        },
      },
    },
    required: ["tools"],
  };
}

export function createContentRouter(options: CreateContentRouterOptions = {}): Tool {
  const allowedTools = [
    ...(options.allowWrite !== false ? ["write"] : []),
    ...(options.allowEdit !== false ? ["edit"] : []),
  ] as ContentRouterTool[];

  return {
    name: "content",
    description: [
      buildSection("Description", [
        "The file-mutation router.",
        "Never call native file-mutation tools directly. Only call the 'content' function for write and edit actions.",
        "Put every file change in the ordered 'content' array.",
        "For multiple edits, send multiple edit items instead of nesting an edit array unless you need compatibility.",
      ]),
      buildSection("Syntax", [
        '{ "content": [{ "tool": "write", "path": "notes.txt", "content": "build passed" }] }',
        '{ "content": [{ "tool": "edit", "path": "src/app.ts", "old": "foo", "new": "bar", "lines": "10-12" }] }',
      ]),
      buildSection("Examples", [
        '{ "content": [{ "tool": "write", "path": "notes.txt", "content": "build passed" }] }',
        '{ "content": [{ "tool": "edit", "path": "src/app.ts", "old": "Bad line", "new": "Good line" }] }',
      ]),
    ].join("\n\n"),
    strict: true,
    params: {
      content: {
        type: "array",
        description: `Ordered file mutations. Allowed tools: ${allowedTools.join(", ")}.`,
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "Content operation to perform",
              enum: allowedTools,
            },
            path: {
              type: "string",
              description: "Target file path, relative to the workspace.",
            },
            content: {
              type: ["string", "null"],
              description: "Used by write.",
            },
            old: {
              type: ["string", "null"],
              description: "Used by edit.",
            },
            new: {
              type: ["string", "null"],
              description: "Used by edit.",
            },
            lines: {
              type: ["string", "null"],
              description: "Optional edit hint in 'start-end' format.",
            },
            edit: {
              type: ["array", "null"],
              description:
                "Compatibility form for edit. Prefer flat old/new/lines fields for new calls.",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: ["string", "null"],
                    description: "Optional line range hint. Prefer including it when available.",
                  },
                  old: {
                    type: ["string", "null"],
                    description:
                      "The exact code to find. Raw file text only. Never include a leading lines prefix like '12-15|' or a standalone first line such as '12-15|', and never include IDE gutters.",
                  },
                  new: {
                    type: ["string", "null"],
                    description:
                      "The replacement code. Raw replacement text only. Never include a leading lines prefix like '12-15|' or a standalone first line such as '12-15|', and never include IDE gutters.",
                  },
                },
                required: ["old", "new"],
              },
            },
          },
          required: ["tool", "path"],
        },
      },
    },
    required: ["content"],
  };
}

export const tools: Tool = createToolsRouter();

export const content: Tool = createContentRouter();

export const access_mcp_resource: Tool = {
  name: "access_mcp_resource",
  description: `Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.

Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access

Example: Accessing a weather resource
{ "server_name": "weather-server", "uri": "weather://san-francisco/current" }

Example: Accessing a file resource from an MCP server
{ "server_name": "filesystem-server", "uri": "file:///path/to/data.json" }`,
  params: {
    server_name: "The name of the MCP server providing the resource",
    uri: "The URI identifying the specific resource to access",
  },
};

export const browser_action: Tool = {
  name: "browser_action",
  description:
    "Interact with a browser via Puppeteer. Launch, click, hover, type, scroll, resize, close, or screenshot. Capture and analyze visual/logical state. Only one action per message.",
  strict: false,
  params: {
    action: {
      type: "string",
      description: "Browser action to perform",
      enum: [
        "launch",
        "click",
        "hover",
        "type",
        "press",
        "scroll_down",
        "scroll_up",
        "resize",
        "close",
        "screenshot",
      ],
    },
    url: {
      type: ["string", "null"],
      description:
        "URL to open when performing the launch action; must include protocol",
    },
    coordinate: {
      type: ["string", "null"],
      description:
        "Screen coordinate for hover or click actions in format 'x,y@WIDTHxHEIGHT' where x,y is the target position on the screenshot image and WIDTHxHEIGHT is the exact pixel dimensions of the screenshot image (not the browser viewport). Example: '450,203@900x600' means click at (450,203) on a 900x600 screenshot. The coordinates will be automatically scaled to match the actual viewport dimensions.",
    },
    size: {
      type: ["string", "null"],
      description:
        "Viewport dimensions for the resize action in format 'WIDTHxHEIGHT' or 'WIDTH,HEIGHT'. Example: '1280x800' or '1280,800'",
    },
    text: {
      type: ["string", "null"],
      description:
        "Text to type when performing the type action, or key name to press when performing the press action (e.g., 'Enter', 'Tab', 'Escape')",
    },
    path: {
      type: ["string", "null"],
      description:
        "File path where the screenshot should be saved (relative to workspace). Required for screenshot action. Supports .png, .jpeg, and .webp extensions. Example: 'screenshots/result.png'",
    },
  },
  required: ["action"],
};

export const computer_action: Tool = {
  name: "computer_action",
  description:
    "Control the desktop GUI with screenshots, mouse, keyboard, scrolling, and cursor inspection. Requires a local GUI session and OS permissions for input/screen capture.",
  strict: false,
  params: {
    action: {
      type: "string",
      description: "Desktop action to perform",
      enum: COMPUTER_ACTIONS,
    },
    coordinate: {
      type: ["string", "null"],
      description:
        "Coordinate for mouse actions, measured on the latest screenshot image, preferably in format 'x,y@WIDTHxHEIGHT'.",
    },
    text: {
      type: ["string", "null"],
      description:
        "Text for key, type, or scroll. Examples: 'Cmd+K', 'Hello', 'down:500'.",
    },
  },
  required: ["action"],
};

export const ask: Tool = {
  name: "ask",
  description:
    "Semantic search to find files relevant to a query. Use this FIRST for any new exploration. Queries must be in English.",
  params: {
    query: "Meaning-based search query describing the information you need",
    path: {
      type: ["string", "null"],
      description:
        "Optional subdirectory (relative to the workspace) to limit the search scope",
    },
  },
};

export const edit: Tool = {
  name: "edit",
  description:
    "Apply multiple search-and-replace blocks to a file. Supports fuzzy matching. Use 'old', 'new', and a required 'lines' hint like '20-25' for each edit. Put the range only in lines — never repeat it inside old/new, including as a standalone first line like '12-15|', and never include IDE line gutters.",
  params: {
    path: "The path to the file to edit (relative to workspace).",
    edit: {
      type: "array",
      description:
        'Search/replace blocks. Each block uses stable keys and must include a lines hint. Example of multi-block edit:\n\n[\n  { "lines": "10-12", "old": "foo", "new": "bar" },\n  { "lines": "20-25", "old": "baz", "new": "qux" }\n]',
      items: {
        type: "object",
        properties: {
          lines: {
            type: "string",
            description:
              "Optional line range hint in 'start-end' format, for example '20-25'. Prefer including it when available.",
          },
          old: {
            type: "string",
            description:
              "The exact code to find. Must be raw file text only — no lines prefix like '12-15|', no standalone first line like '12-15|', and no line-number gutters.",
          },
          new: {
            type: "string",
            description:
              "The replacement code. Same rules as old: no duplicated lines prefix, no standalone first line like '12-15|', and no gutter prefixes.",
          },
        },
        required: ["old", "new"],
      },
    },
  },
  required: ["path", "edit"],
};

export const bash: Tool = {
  name: "bash",
  description:
    "Execute a CLI command, or when AI stdin mode is enabled for a running terminal, send stdin to that live process. Use relative paths and standard shell syntax. Avoid creating scripts when a direct command suffices.",
  params: {
    command:
      "Shell command to execute. Omit this when sending stdin to an already running terminal process.",
    stdin:
      "Optional stdin text to send to the currently selected live terminal process in AI stdin mode. Enter/newline is submitted automatically.",
    execution_id: {
      type: "string",
      description:
        "Optional explicit execution id for the live terminal process when sending stdin.",
    },
    cwd: {
      type: ["string", "null"],
      description:
        "Optional working directory for the command, relative or absolute",
    },
  },
};

export const workspace: Tool = {
  name: "workspace",
  description:
    "Legacy compatibility wrapper for workspace batching. Prefer 'tools' instead.",
  strict: false,
  params: {
    actions: {
      type: "array",
      description: "Legacy ordered workspace actions.",
      items: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Workspace action to perform",
            enum: ["read", "list", "grep", "glob", "ask"],
          },
          files: {
            type: "array",
            description: "Used by read.",
            items: { type: "string", description: "One read target." },
          },
          path: { type: ["string", "null"], description: "Used by list, grep, glob, ask." },
          recursive: { type: "boolean", description: "Used by list." },
          query: {
            type: ["string", "array"],
            description: "Used by grep, glob, ask.",
            items: { type: "string", description: "One search term or pattern." },
          },
        },
        required: ["tool"],
      },
    },
  },
  required: ["actions"],
};

export const internet: Tool = {
  name: "internet",
  description:
    "Legacy compatibility wrapper for internet batching. Prefer 'tools' instead.",
  strict: false,
  params: {
    actions: {
      type: "array",
      description: "Legacy ordered internet actions. Allowed tools: fetch, web.",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Internet action to perform", enum: ["fetch", "web"] },
          url: { type: "string", description: "Used by fetch." },
          include_links: { type: "boolean", description: "Used by fetch." },
          query: { type: "string", description: "Used by web." },
        },
        required: ["tool"],
      },
    },
  },
  required: ["actions"],
};

export const system: Tool = {
  name: "system",
  description:
    "Legacy compatibility wrapper for system batching. Prefer 'tools' instead.",
  strict: false,
  params: {
    actions: {
      type: "array",
      description: "Legacy ordered system actions. Allowed tools: bash, agent.",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", description: "System action to perform", enum: ["bash", "agent"] },
          command: { type: "string", description: "Used by bash." },
          stdin: { type: "string", description: "Used by bash." },
          execution_id: { type: "string", description: "Used by bash." },
          cwd: { type: ["string", "null"], description: "Used by bash." },
          prompt: { type: "string", description: "Used by agent." },
          mode: { type: "string", description: "Optional agent mode." },
          api_provider: { type: "string", description: "Optional agent provider." },
          model_id: { type: "string", description: "Optional agent model id." },
        },
        required: ["tool"],
      },
    },
  },
  required: ["actions"],
};

export const generate_image: Tool = {
  name: "generate_image",
  description:
    "Generate or edit an image from text prompts. Provide a 'path' to save the output and an optional 'image' path to modify an existing one.",
  params: {
    prompt: "Text description for generation or edit.",
    path: "Path to save the resulting image.",
    image: "Optional: Path to an existing image to edit.",
  },
  required: ["prompt", "path"],
};

export const glob: Tool = {
  name: "glob",
  description:
    "Find files using glob patterns (*, **, ?, [], {}). Accepts either 'pattern' or the compatibility alias 'query'. For multiple patterns, use either a pipe-separated string like '*.ts|*.tsx' or an array. Ideal for discovering project structure or identifying file types.",
  params: {
    path: {
      type: ["string", "null"],
      description:
        "Optional path to search in, relative to the workspace. Defaults to the current directory.",
    },
    pattern: {
      type: ["string", "array"],
      description:
        "Glob pattern to match files (supports *, **, ?, [], {} patterns). For multiple patterns, use a pipe-separated string like '*.ts|*.tsx' or an array like ['*.ts', '*.tsx'].",
      items: {
        type: "string",
        description: "One glob pattern.",
      },
    },
    query: {
      type: ["string", "array"],
      description:
        "Compatibility alias for 'pattern'. Accepts the same pipe-separated string or string[] values and is normalized to 'pattern' before execution.",
      items: {
        type: "string",
        description: "One glob pattern.",
      },
    },
  },
};

export const grep: Tool = {
  name: "grep",
  description:
    "Fast text search across files. Accepts either 'query' or the legacy alias 'pattern'. For multiple searches, use one string with | separators like 'auth|login|session' or pass an array. Defaults to case-insensitive search, uses whole-word matching for simple identifier-like queries, and filters noisy files unless include_all is true.",
  params: {
    path: {
      type: ["string", "null"],
      description:
        "Optional path to search in, relative to the workspace. Defaults to the current directory.",
    },
    query: {
      type: ["string", "array"],
      description:
        "Text or pattern to search for. For multiple queries, prefer one string with | separators such as 'auth|login|session'. You can also pass an array like ['auth', 'login', 'session'].",
      items: {
        type: "string",
        description: "One search term or pattern.",
      },
    },
    pattern: {
      type: ["string", "array"],
      description:
        "Legacy alias for 'query'. Accepts the same string or string[] values and is normalized to 'query' before execution.",
      items: {
        type: "string",
        description: "One search term or pattern.",
      },
    },
    include: {
      type: ["string", "array", "null"],
      description:
        "Optional glob or list of globs to limit which files are searched, for example '*.ts', '*.{ts,tsx}', or ['*.ts', '*.tsx'].",
      items: {
        type: "string",
        description: "One include glob pattern.",
      },
    },
    include_all: {
      type: "boolean",
      description:
        "If true, also search docs, locales, generated files, assets, lockfiles, and other normally filtered noise.",
    },
    exclude: {
      type: ["string", "array", "null"],
      description: "Optional glob or list of globs to exclude files from the search.",
      items: {
        type: "string",
        description: "One exclude glob pattern.",
      },
    },
  },
  required: [],
};

export const list: Tool = {
  name: "list",
  description:
    "List files and directories. Set 'recursive: true' for subdirectories. For multiple paths, use a pipe-separated or comma-separated string like 'src|tests' or 'src,tests'.",
  params: {
    path: {
      type: ["string", "null"],
      description:
        "Optional path to inspect, relative to the workspace. Defaults to the current directory. For multiple paths, use a pipe-separated or comma-separated string like 'src|tests' or 'src,tests'.",
    },
    recursive: {
      type: "boolean",
      description:
        "Optional. Set true for recursive listing. Omit it or set false for top-level only.",
    },
  },
  required: [],
};

export const read: Tool = {
  name: "read",
  description:
    "Read one or more files from the workspace in a single call. Prefer the 'files' array with one string per target. Each item may be a plain path like 'src/app.ts', an inline line range like 'src/app.ts:L10-50', a head read like 'src/app.ts:H20', or a tail read like 'src/app.ts:T20'.",
  params: {
    files: {
      type: "array",
      description:
        "Files to read in one turn. Use one string per file. Supports plain paths, line ranges via 'path:Lstart-end', head reads via 'path:Hcount', and tail reads via 'path:Tcount'. Examples: ['package.json', 'src/app.ts:L1-80', 'src/app.ts:H40', 'src/routes.ts:T20'].",
      items: {
        type: "string",
        description:
          "A file target such as 'index.html', 'src/app.ts:L10-50', 'src/app.ts:H20', or 'src/app.ts:T20'.",
      },
    },
  },
  required: ["files"],
};

export const agent: Tool = {
  name: "agent",
  description:
    "Spawn an autonomous sub-agent for complex sub-tasks. Runs in an isolated context for parallel execution.",
  params: {
    prompt:
      "The objective or prompt for the sub-agent. Be specific about what you want the sub-agent to do.",
  },
  required: ["prompt"],
};

export const todo: Tool = {
  name: "todo",
  description:
    "Update the markdown checklist ([ ], [x], [-]). Provide the FULL list to overwrite previous state, OR use patch format with numbers (e.g., '1: completed', '2. [x]') for quick status updates. Trace progress for complex tasks.",
  params: {
    todos:
      "Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress. OR use patch format with numbers (e.g., '1: completed', '2. [x]', '3: in progress') for quick status updates.",
  },
};

export const fetch: Tool = {
  name: "fetch",
  description:
    "Fetch text content from a URL. Useful for reading documentation or web pages. By default it strips links and image noise; pass include_links=true to preserve them.",
  params: {
    url: "The URL to fetch",
    include_links:
      "Optional boolean. Preserve links and image placeholders in the result.",
  },
};

export const web: Tool = {
  name: "web",
  description: "Search the web for info. Returns titles, URLs, and snippets.",
  params: {
    query: "Search query string",
  },
  required: ["query"],
};

export const write: Tool = {
  name: "write",
  description:
    "Write content to a file (overwrites existing). Primarily for new files; prefer 'edit' for changes. Provide COMPLETE content without placeholders or line numbers.",
  params: {
    path: "Path to the file to write, relative to the workspace",
    content:
      "Full contents that the file should contain with no omissions or line numbers",
  },
};

export const tool: Tool = createExecuteTool();
export const execute: Tool = tool;

export const nativeToolRegistry = {
  tool,
} as const;

export type NativeToolRegistryKey = keyof typeof nativeToolRegistry;
