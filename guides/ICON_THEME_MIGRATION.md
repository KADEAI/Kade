# Icon Theme Migration: VS Code Native Icons

## Overview

Migrated the extension from using the custom `vscode-material-icons` package to VS Code's native icon theme (codicons). This makes the extension more consistent with VS Code's UI and respects the user's chosen icon theme.

## Changes Made

### 1. FileIcon Component (`webview-ui/src/components/chat/tools/FileIcon.tsx`)

**Before:**
- Used `vscode-material-icons` package to load icon images
- Required material icons base URI from extension host
- Rendered icons as `<img>` tags with SVG sources
- Had special handling for Rust files with custom React icon

**After:**
- Uses VS Code's built-in codicons (icon font)
- No external dependencies needed
- Renders icons as `<i>` tags with CSS classes
- Comprehensive file extension mapping (80+ file types)
- Icons automatically respect VS Code's theme

**Supported File Types:**
- Code files: JS, TS, Python, Java, Rust, Go, PHP, C/C++, C#, Swift, Kotlin, Ruby
- Markup: HTML, CSS, Markdown, XML, YAML, TOML
- Data: JSON, SQL, CSV
- Media: Images, Audio, Video
- Archives: ZIP, TAR, GZ, RAR
- Documents: PDF, DOC, XLS, PPT
- Shell scripts: SH, BASH, PS1, BAT
- Special files: package.json, tsconfig.json, .gitignore, README, Dockerfile, .env, LICENSE

### 2. ContextMenu Component (`webview-ui/src/components/chat/ContextMenu.tsx`)

**Changes:**
- Removed `vscode-material-icons` imports
- Removed `getMaterialIconForOption()` function
- Removed `materialIconsBaseUri` state
- Now uses `FileIcon` component for file/folder icons
- Simplified icon rendering logic

### 3. Package Dependencies

**Removed from:**
- `src/package.json` - removed `vscode-material-icons` dependency
- `webview-ui/package.json` - removed `vscode-material-icons` dependency

### 4. Build Configuration

**Updated files:**
- `src/esbuild.mjs` - removed material icons copy operation
- `apps/vscode-nightly/esbuild.mjs` - removed material icons copy operation

**Removed:**
```javascript
["node_modules/vscode-material-icons/generated", "assets/vscode-material-icons"]
```

### 5. Webview Providers

**Updated files:**
- `src/core/webview/ClineProvider.ts`
- `src/core/kilocode/agent-manager/AgentManagerProvider.ts`

**Changes:**
- Removed `materialIconsUri` variable declarations
- Removed `window.MATERIAL_ICONS_BASE_URI` from webview HTML

**Before:**
```typescript
const materialIconsUri = getUri(webview, this.context.extensionUri, [
  "assets",
  "vscode-material-icons",
  "icons",
]);
```

```html
<script>
  window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
</script>
```

**After:**
These lines were completely removed.

## Benefits

1. **Smaller bundle size** - No need to package icon assets
2. **Theme consistency** - Icons match VS Code's current theme
3. **Better performance** - Icon font loads faster than individual SVG files
4. **Simpler maintenance** - No external icon package to update
5. **Native integration** - Uses VS Code's standard icon system

## Icon Mapping Strategy

The FileIcon component uses a comprehensive mapping function that:
1. Checks for special filenames (package.json, README.md, etc.)
2. Falls back to file extension matching
3. Provides sensible defaults for unknown types

Example mappings:
- `.ts`, `.tsx` → `symbol-method` icon
- `.json` → `json` icon
- `.md` → `markdown` icon
- `.py` → `symbol-method` icon
- folders → `folder` icon
- unknown → `file` icon

## Testing Recommendations

After this migration, test:
1. File icons in chat messages
2. File icons in context menu
3. Folder icons in file browser
4. Icons with different VS Code themes
5. Icons for various file types (code, config, media, etc.)

## Rollback Instructions

If needed to rollback:
1. Restore `vscode-material-icons` dependencies in package.json files
2. Restore material icons copy operations in esbuild.mjs files
3. Restore `materialIconsUri` and `MATERIAL_ICONS_BASE_URI` in providers
4. Revert FileIcon.tsx to use material icons
5. Revert ContextMenu.tsx to use `getMaterialIconForOption()`
6. Run `pnpm install` to restore dependencies

## Migration Date

March 19, 2026
