# Webview Disposal Fix

## Problem
After opening the editor tab using the "open in editor tab" button, the extension worked fine initially. However, once you returned to the main sidebar view, it would throw "webview is disposed" errors. This required reloading the window to fix.

## Root Cause
The issue was caused by improper webview lifecycle management when switching between sidebar and editor tab modes:

1. **Panel Reference Conflicts**: The `setPanel()` function in `panelUtils.ts` was clearing the sidebar panel reference when opening the editor tab (and vice versa), even though both webviews could coexist independently.

2. **Stale View References**: When the sidebar webview was disposed (which could happen when opening the tab), the `ClineProvider` instance's `view` property was never cleared, causing it to reference a disposed webview.

3. **Global State Not Cleared**: The global panel references in `panelUtils.ts` were not being cleared when webviews were disposed, leading to stale references.

## Changes Made

### 1. `src/activate/panelUtils.ts`
**Before:**
```typescript
export function setPanel(
    newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
    type: "sidebar" | "tab",
): void {
    if (type === "sidebar") {
        sidebarPanel = newPanel as vscode.WebviewView
        tabPanel = undefined  // ❌ Clearing tab reference
    } else {
        tabPanel = newPanel as vscode.WebviewPanel
        sidebarPanel = undefined  // ❌ Clearing sidebar reference
    }
}
```

**After:**
```typescript
export function setPanel(
    newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
    type: "sidebar" | "tab",
): void {
    if (type === "sidebar") {
        sidebarPanel = newPanel as vscode.WebviewView
    } else {
        tabPanel = newPanel as vscode.WebviewPanel
    }
}
```

**Why:** Both sidebar and tab panels can coexist independently. Clearing one when setting the other was causing reference conflicts.

### 2. `src/core/webview/ClineProvider.ts`
**Before:**
```typescript
webviewView.onDidDispose(
  async () => {
    if (inTabMode) {
      this.log("Disposing ClineProvider instance for tab view");
      await this.dispose();
    } else {
      this.log("Clearing webview resources for sidebar view");
      this.clearWebviewResources();
      this.codeIndexManager = undefined;
      // ❌ view property never cleared
      // ❌ global panel reference never cleared
    }
  },
  null,
  this.disposables,
);
```

**After:**
```typescript
webviewView.onDidDispose(
  async () => {
    if (inTabMode) {
      this.log("Disposing ClineProvider instance for tab view");
      setPanel(undefined, "tab");  // ✅ Clear global reference
      await this.dispose();
    } else {
      this.log("Clearing webview resources for sidebar view");
      this.clearWebviewResources();
      this.codeIndexManager = undefined;
      this.view = undefined;  // ✅ Clear instance reference
      setPanel(undefined, "sidebar");  // ✅ Clear global reference
    }
  },
  null,
  this.disposables,
);
```

**Why:** Properly clearing all references ensures that when VSCode reinitializes the sidebar webview, it starts with a clean state instead of trying to use disposed references.

## How It Works Now

1. **Opening Editor Tab**: Creates a new `ClineProvider` instance with its own webview panel. The sidebar provider instance remains intact.

2. **Switching Back to Sidebar**: If the sidebar webview was disposed, VSCode automatically calls `resolveWebviewView()` again to reinitialize it with fresh references.

3. **Proper Cleanup**: When either webview is disposed, all references (instance-level and global) are properly cleared, preventing stale reference errors.

## Testing
To verify the fix:
1. Open the extension in the sidebar
2. Click "open in editor tab"
3. Close the editor tab
4. Return to the sidebar view
5. The extension should work without "webview is disposed" errors
