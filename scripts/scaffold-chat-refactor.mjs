#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

const sections = [
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/chatListModel.ts",
    exportName: "chatListModelSource",
    start: 118,
    end: 368,
    description:
      "Props, row types, tool-summary helpers, constants, and low-level helpers.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/useChatViewState.ts",
    exportName: "useChatViewStateSource",
    start: 370,
    end: 520,
    description:
      "Component bootstrapping, extension-state intake, optimistic user messages, and module-store syncing.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/useTaskSessionController.ts",
    exportName: "useTaskSessionControllerSource",
    start: 1379,
    end: 1508,
    description:
      "Task-switch resets, initial scroll-to-bottom, and task-switch lifecycle handling.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/useChatBottomState.ts",
    exportName: "useChatBottomStateSource",
    start: 1510,
    end: 1593,
    description:
      "Expanded-row tracking and updateBottomState, the start of the scroll state machine.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/useChatListApi.ts",
    exportName: "useChatListApiSource",
    start: 1630,
    end: 1657,
    description: "Imperative scroll API abstraction.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target:
      "webview-ui/src/components/chat/ChatView/selectors/filterRenderableMessages.ts",
    exportName: "filterRenderableMessagesSource",
    start: 2288,
    end: 2406,
    description:
      "Filtering visible messages into renderable grouped messages.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target:
      "webview-ui/src/components/chat/ChatView/selectors/buildChatRenderRows.ts",
    exportName: "buildChatRenderRowsSource",
    start: 2414,
    end: 2617,
    description:
      "Building renderRows, row IDs, tool-summary grouping, and stable timestamps.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/hooks/useChatScrollEngine.ts",
    exportName: "useChatScrollEngineSource",
    start: 2634,
    end: 2912,
    description:
      "Bottom magnet, pin suppression, animated anchor preservation, wheel escape, and highlight scrolling.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/hooks/useChatActions.ts",
    exportName: "useChatActionsSource",
    start: 2942,
    end: 3000,
    description:
      "Row interaction handlers like suggestions and batch responses.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target:
      "webview-ui/src/components/chat/ChatView/renderers/renderItemContent.tsx",
    exportName: "renderItemContentSource",
    start: 3002,
    end: 3215,
    description: "Row rendering policy in itemContent.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/legacy/virtuosoAdapters.tsx",
    exportName: "virtuosoAdaptersSource",
    start: 3238,
    end: 3337,
    description: "Old Virtuoso and message-list data adapters.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/useChatListBridge.ts",
    exportName: "useChatListBridgeSource",
    start: 3448,
    end: 3470,
    description:
      "List refs, scroll root refs, virtual row keys, and renderRow indirection.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/hooks/useChatDragAndDrop.ts",
    exportName: "useChatDragAndDropSource",
    start: 3473,
    end: 3595,
    description: "Drag and drop behavior.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target:
      "webview-ui/src/components/chat/ChatView/hooks/useStableListAnchoring.ts",
    exportName: "useStableListAnchoringSource",
    start: 3598,
    end: 3712,
    description: "Stable-list and TanStack anchoring loop.",
  },
  {
    group: "ChatView",
    source: "webview-ui/src/components/chat/ChatView.tsx",
    target: "webview-ui/src/components/chat/ChatView/ChatViewShell.tsx",
    exportName: "chatViewShellSource",
    start: 3718,
    end: 4183,
    description: "JSX shell and top-level composition.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target: "webview-ui/src/components/chat/ChatRow/chatRowStores.ts",
    exportName: "chatRowStoresSource",
    start: 145,
    end: 335,
    description:
      "Module-level stores and caches for messages, extension state, tool results, and tool component selection.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target: "webview-ui/src/components/chat/ChatRow/chatRowRules.ts",
    exportName: "chatRowRulesSource",
    start: 548,
    end: 660,
    description: "Local helper plus props and shell-skipping rules.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target: "webview-ui/src/components/chat/ChatRow/ChatRow.tsx",
    exportName: "chatRowComponentSource",
    start: 662,
    end: 884,
    description:
      "Memoized row shell, optional layout observation, wrapper styling, and custom comparator.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target: "webview-ui/src/components/chat/ChatRow/useChatRowContentLogic.ts",
    exportName: "useChatRowContentLogicSource",
    start: 888,
    end: 1527,
    description:
      "ChatRowContent pre-render logic: selectors, derived state, tool-result lookup, and status calculation.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target:
      "webview-ui/src/components/chat/ChatRow/renderers/renderToolMessage.tsx",
    exportName: "renderToolMessageSource",
    start: 1529,
    end: 2327,
    description: "Tool-message renderer switch.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target:
      "webview-ui/src/components/chat/ChatRow/renderers/renderNonToolMessage.tsx",
    exportName: "renderNonToolMessageSource",
    start: 2329,
    end: 3140,
    description: "Non-tool message renderer switch.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target:
      "webview-ui/src/components/chat/ChatRow/renderers/renderAssistantText.tsx",
    exportName: "renderAssistantTextSource",
    start: 2593,
    end: 2639,
    description: "Assistant text rendering and text cleanup.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target: "webview-ui/src/components/chat/ChatRow/renderers/UserMessageRow.tsx",
    exportName: "userMessageRowSource",
    start: 2644,
    end: 2775,
    description:
      "User bubble and editing UI. The pasted range list was truncated, so this uses the previously identified full block.",
  },
  {
    group: "ChatRow",
    source: "webview-ui/src/components/chat/ChatRow.tsx",
    target:
      "webview-ui/src/components/chat/ChatRow/renderers/renderMessageFamilies.tsx",
    exportName: "renderMessageFamiliesSource",
    start: 2818,
    end: 3140,
    description:
      "Completion, command output, condense/truncation, codebase search, image, and fallback rendering. The pasted range list was truncated, so this uses the previously identified full block.",
  },
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function buildFileContent(section, snippet) {
  const escaped = snippet.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  return `// @ts-nocheck
/**
 * Generated by scripts/scaffold-chat-refactor.mjs
 * Source: ${section.source}:${section.start}-${section.end}
 * Group: ${section.group}
 * Intent: ${section.description}
 *
 * This is a scaffold artifact. It is not wired into the runtime yet.
 * The raw source is preserved below so the refactor can proceed in split files
 * instead of inside the original monolith.
 */

export const meta = {
  group: ${JSON.stringify(section.group)},
  source: ${JSON.stringify(section.source)},
  target: ${JSON.stringify(section.target)},
  startLine: ${section.start},
  endLine: ${section.end},
  description: ${JSON.stringify(section.description)},
} as const;

export const ${section.exportName} = String.raw\`${escaped}\`;

export {};
`;
}

function buildManifestContent(entries) {
  const grouped = entries.reduce((acc, entry) => {
    acc[entry.group] ??= [];
    acc[entry.group].push(entry);
    return acc;
  }, {});

  const lines = [
    "# Chat Refactor Scaffold",
    "",
    "Generated by `scripts/scaffold-chat-refactor.mjs`.",
    "",
    "These files contain exact source slices from the current `ChatView.tsx` and `ChatRow.tsx` monoliths, wrapped as string exports so the scaffold compiles without being wired into the app yet.",
    "",
  ];

  for (const group of ["ChatView", "ChatRow"]) {
    if (!grouped[group]) continue;
    lines.push(`## ${group}`);
    lines.push("");
    for (const entry of grouped[group]) {
      lines.push(
        `- [${toPosix(entry.target)}](/Users/imacpro/Documents/kilomain/${toPosix(entry.target)}): ${entry.source}:${entry.start}-${entry.end} - ${entry.description}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const shouldWrite = process.argv.includes("--write");

  const sourceCache = new Map();
  const written = [];

  for (const section of sections) {
    const sourcePath = path.join(repoRoot, section.source);
    if (!sourceCache.has(sourcePath)) {
      const content = await fs.readFile(sourcePath, "utf8");
      sourceCache.set(sourcePath, content.split("\n"));
    }

    const lines = sourceCache.get(sourcePath);
    const snippet = lines.slice(section.start - 1, section.end).join("\n");
    const targetPath = path.join(repoRoot, section.target);
    const output = buildFileContent(section, snippet);

    if (shouldWrite) {
      await ensureDir(targetPath);
      await fs.writeFile(targetPath, output, "utf8");
    }

    written.push(section);
  }

  const manifestPath = path.join(
    repoRoot,
    "webview-ui/src/components/chat/CHAT_REFACTOR_MANIFEST.generated.md",
  );

  if (shouldWrite) {
    await ensureDir(manifestPath);
    await fs.writeFile(manifestPath, buildManifestContent(written), "utf8");
  }

  const modeLabel = shouldWrite ? "Wrote" : "Planned";
  console.log(`${modeLabel} ${written.length} extracted scaffold files.`);
  console.log(
    `${modeLabel} manifest: webview-ui/src/components/chat/CHAT_REFACTOR_MANIFEST.generated.md`,
  );
  for (const entry of written) {
    console.log(
      `- ${entry.group}: ${entry.source}:${entry.start}-${entry.end} -> ${entry.target}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
