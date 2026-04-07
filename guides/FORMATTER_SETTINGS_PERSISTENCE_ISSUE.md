# Formatter Settings Persistence Issue

## Summary

Formatter toggle changes were saving correctly in the host, but the webview kept flipping the toggles back to enabled because the posted `state` payload dropped `formatterSettings`.

## Root Cause

There were two separate problems:

1. Runtime schema drift

- `packages/types/src/global-settings.ts` had `formatterSettings`
- `packages/types/src/global-settings.js` did not
- runtime key lists in `packages/types/dist/index.cjs` therefore omitted `formatterSettings`

2. Webview state-posting omission

- `webviewMessageHandler.ts` saved `formatterSettings` correctly
- `ContextProxy.setValue("formatterSettings", ...)` returned the correct saved object
- `ClineProvider.getState()` also returned the correct saved object
- but `ClineProvider.getStateToPostToWebview()` did **not** include `formatterSettings`
- so the actual `{ type: "state", state }` message reaching the webview contained `formatterSettings: {}`
- `SettingsView` then synced from `extensionState` and visually re-enabled the toggles

## Observed Diagnostic Trail

The decisive logs were:

- host save path showed `formatterSettings` with the expected disabled values
- host `ClineProvider.getState()` showed the same disabled values
- frontend `SettingsView` logs showed `extensionFormatterSettings: {}`

That proved the setting was not failing to save. It was being dropped from the state message sent back to the webview.

## Reproduction

1. Open Settings.
2. Go to the formatter settings section.
3. Toggle one or more formatter options.
4. Save settings.
5. Reload the window / extension / webview.
6. Reopen Settings.
7. Observe that formatter toggle state has reset.

## Relevant Files

- `webview-ui/src/components/settings/FormatterSettings.tsx`
- `webview-ui/src/components/settings/SettingsView.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `src/core/webview/webviewMessageHandler.ts`
- `src/core/webview/ClineProvider.ts`
- `src/core/config/ContextProxy.ts`
- `packages/types/src/global-settings.ts`
- `packages/types/src/global-settings.js`
- `packages/types/dist/index.cjs`

## Fixes Applied

1. Added `formatterSettings` to the runtime JS schema mirror:

- `packages/types/src/global-settings.js`

2. Rebuilt the runtime types package:

- `pnpm --filter @roo-code/types build`

3. Verified runtime exported key lists now include `formatterSettings`:

- `GLOBAL_SETTINGS_KEYS`
- `GLOBAL_STATE_KEYS`

4. Added `formatterSettings` to the state object returned by:

- `src/core/webview/ClineProvider.ts -> getStateToPostToWebview()`

## Prevention Notes

For future settings bugs in this repo:

- never trust `getState()` alone
- always verify `getStateToPostToWebview()` too
- always check both TS and JS schema mirrors in `packages/types/src`
- always rebuild `@roo-code/types` before trusting runtime behavior
