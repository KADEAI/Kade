# Settings Persistence Guide

This file is a practical map of how settings are actually saved in this extension.

Use this before changing any setting-related behavior.

## Absolute Rule Zero

Do not start by editing the UI.

Start by deciding:

1. what the source of truth is
2. whether the setting is global or profile-scoped
3. whether the webview needs to read it back after save
4. whether runtime code reads the stored value or only the posted state

If you skip that and start with a checkbox, you are volunteering for save hell.

## The Four Real Setting Types

There are four common patterns in this codebase:

1. Top-level global settings
2. Provider/API profile settings
3. Special immediate-message settings
4. Nested object settings

If you mix these patterns carelessly, the setting will look broken.

## 1. Top-Level Global Settings

Examples:

- `showVibeStyling`
- `showTaskTimeline`
- `showTimestamps`
- `collapseCodeToolsByDefault`
- `alwaysAllowUpdateTodoList`

### UI flow

Usually starts in a settings component with:

- `setCachedStateField("someSetting", value)`

Main file:

- `webview-ui/src/components/settings/SettingsView.tsx`

The settings UI keeps a local `cachedState`.

Nothing is persisted yet.

### Save flow

The real persistence happens in:

- `SettingsView.tsx -> handleSubmit()`

This sends:

- `vscode.postMessage({ type: "updateSettings", updatedSettings: { ... } })`

### Host flow

Handled in:

- `src/core/webview/webviewMessageHandler.ts`

Inside `case "updateSettings"`:

- iterate `message.updatedSettings`
- call `provider.contextProxy.setValue(key, value)`

### Storage flow

Actual storage is handled by:

- `src/core/config/ContextProxy.ts`

Important methods:

- `setValue()`
- `updateGlobalState()`
- `getValues()`

`ContextProxy` is the real storage boundary for top-level settings.

### What must exist for a normal global setting

For a normal top-level global setting to behave correctly, verify all of these:

1. schema entry in `packages/types/src/global-settings.ts`
2. runtime mirror entry in `packages/types/src/global-settings.js`
3. field included in `src/shared/ExtensionMessage.ts` `ExtensionState`
4. field returned from the host state that is actually posted to the webview
5. UI edits local `cachedState`
6. `handleSubmit()` includes the field in `updatedSettings`
7. `webviewMessageHandler.ts` persists it
8. the posted `"state"` message sends it back
9. the webview sync path does not overwrite it with a default

## 2. Provider/API Profile Settings

Examples:

- `todoListEnabled`
- `diffEnabled`
- `toolProtocol`
- `maxToolCalls`
- model/provider config values

These do **not** behave like top-level global settings.

They live inside:

- `apiConfiguration`

### UI flow

Usually changed through:

- `setApiConfigurationField(field, value)`

### Save flow

Saved through:

- `vscode.postMessage({ type: "upsertApiConfiguration", apiConfiguration, ... })`

### Host flow

Handled in:

- `src/core/webview/webviewMessageHandler.ts`

under:

- `case "upsertApiConfiguration"`

### Persistence owner

Profile persistence is managed by:

- `src/core/config/ProviderSettingsManager.ts`

If a setting belongs to provider/model behavior, it usually belongs here.

Do not randomly make those top-level global flags.

## 3. Immediate-Message Settings

Examples:

- `subAgentToolEnabled`
- some other small toggles with dedicated message handlers

These may have their own message type like:

- `type: "subAgentToolEnabled"`

and be handled directly in:

- `webviewMessageHandler.ts`

Pattern:

1. receive exact value
2. persist exact value
3. call `provider.postStateToWebview()`

This works well for small direct toggles.

But do not combine this with multiple duplicate save paths unless absolutely necessary.

## 4. Nested Object Settings

Examples:

- `formatterSettings`
- anything like `someFeatureSettings = { ... }`

These are the easiest settings to make look correct and the easiest settings to accidentally break.

### Why they are risky

Nested objects fail in more places:

1. local equality checks
2. `mergeExtensionState()` replacement behavior
3. missing field in posted state
4. partial save payloads
5. object defaulting with `?? {}`
6. runtime schema mirror mismatch

If a nested setting flips back after save, assume the object path is guilty until proven innocent.

### Safer nested-object pattern

If you must use a nested object:

1. use a dedicated setter in `SettingsView.tsx`
2. compare with `deepEqual`
3. normalize `undefined` to `{}` in one place only
4. include the entire object in `handleSubmit()`
5. include the entire object in the posted state
6. make sure `ExtensionStateContext` defaults match the posted shape

Example:

- `setFormatterSettingsField` in `webview-ui/src/components/settings/SettingsView.tsx`

### Preferred alternative

If the setting does not truly need to be grouped, flatten it into top-level booleans.

This codebase is materially more reliable with:

- `formatterRustfmtEnabled`

than with:

- `formatterSettings.rustfmt`

## State Round-Trip

Once something is saved, the webview gets refreshed by:

- `provider.postStateToWebview()`

Main files:

- `src/core/webview/ClineProvider.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`

### Host -> webview

`ClineProvider.getStateToPostToWebview()` builds the state object.

That object is sent as:

- `{ type: "state", state }`

### Webview rehydration

Handled in:

- `webview-ui/src/context/ExtensionStateContext.tsx`

The settings page then syncs from `extensionState` back into its local `cachedState`.

If stale host state comes back, it can overwrite the local setting.

This is the source of many “checkbox saved then unsaved itself” bugs.

## The Actual Layers

When debugging, think in layers:

1. schema layer
   - `packages/types/src/global-settings.ts`
   - `packages/types/src/global-settings.js`
2. storage layer
   - `ContextProxy`
3. host state construction layer
   - `ClineProvider.getState()`
   - `ClineProvider.getStateToPostToWebview()`
4. transport layer
   - `{ type: "state", state }`
5. webview merge layer
   - `mergeExtensionState()`
6. settings page local cache layer
   - `cachedState`
7. save-submit layer
   - `handleSubmit()`
8. runtime-consumer layer
   - prompt builders
   - tools
   - task logic

Any one broken layer makes the setting look haunted.

## The Most Important Rule

Pick one authoritative save path per setting.

Bad:

- local cached update
- immediate host message
- generic `updateGlobalState`
- generic `updateSettings`

all fighting each other

Good:

- local cached update
- one save action
- one host persistence path
- one state refresh path

Corollary:

If you add a direct `updateGlobalState` path as a rescue fix, document why.

Otherwise the next person will “clean it up”, remove it, and recreate the bug.

## Prompt-Related Settings

If a setting affects prompt generation, trace all of these:

1. UI setting component
2. `SettingsView.handleSubmit()`
3. `webviewMessageHandler.ts`
4. `ContextProxy.ts` or `ProviderSettingsManager.ts`
5. `ClineProvider.getState()` / `getStateToPostToWebview()`
6. prompt generator:
   - `src/core/webview/generateSystemPrompt.ts`
   - `src/core/task/Task.ts`
   - `src/core/prompts/system.ts`
   - template sections like `src/core/prompts/sections/antigravity.ts`

If any one of those reads from a different source of truth, the setting will look random.

## The Difference Between "Stored", "Returned", and "Posted"

These are not the same:

1. stored in `ContextProxy`
2. returned by `ClineProvider.getState()`
3. posted to the webview via `postStateToWebview()`

It is common for:

- storage to be correct
- `getState()` to be correct
- posted webview state to still be wrong

Never stop debugging after checking storage.

## Important Gotcha: `packages/types/src/*.js` Mirrors

This repo has a nasty source/runtime trap.

`packages/types/src` contains both:

- `.ts`
- `.js`

And the package index exports the `.js` files, for example:

- `packages/types/src/index.ts` exports `./global-settings.js`

That means:

- editing `packages/types/src/global-settings.ts` alone is **not enough**

If the matching `.js` file is stale, runtime builds can ignore your TS change.

This is exactly the kind of bug that makes a setting appear to:

- exist in source
- exist in types
- still fail at runtime

### For settings schema changes, always check both:

- `packages/types/src/global-settings.ts`
- `packages/types/src/global-settings.js`

And if needed rebuild:

- `pnpm --filter @roo-code/types build`

## Reload Persistence Checklist

If a setting works in-session but resets on reload:

1. Check the setting exists in:
   - `packages/types/src/global-settings.ts`
   - `packages/types/src/global-settings.js`
2. Check runtime keys include it:
   - `GLOBAL_SETTINGS_KEYS`
   - `GLOBAL_STATE_KEYS`
3. Check `ContextProxy.initialize()` will actually load it
4. Check `ClineProvider.getState()` returns it
5. Check `ClineProvider.getStateToPostToWebview()` also returns it
6. Check the actual `{ type: "state", state }` payload received by the webview
7. Check the webview is not defaulting it back via `!== false` or `?? true`

## Critical Gotcha: `getState()` Is Not The Posted State

This codebase has two very different state builders:

- `ClineProvider.getState()`
- `ClineProvider.getStateToPostToWebview()`

This distinction matters.

`getState()` being correct does **not** mean the webview receives that value.

The webview is updated by:

- `postStateToWebview()`

which uses:

- `getStateToPostToWebview()`

So a setting can:

- save correctly
- exist in `ContextProxy`
- appear correctly in `getState()`
- still arrive as missing/empty in the webview

if `getStateToPostToWebview()` forgets to include it in the returned state object.

This exact failure mode happened with:

- `formatterSettings`

Symptoms:

- host logs showed `formatterSettings` saving correctly
- `ClineProvider.getState()` showed the correct saved object
- the webview still received `formatterSettings: {}`
- `SettingsView` synced from `extensionState` and visually re-enabled the toggles

Root cause:

- `formatterSettings` was missing from `getStateToPostToWebview()`

Fix:

1. include the field in the destructure from `await this.getState()`
2. include the field in the returned state object posted to the webview

Files:

- `src/core/webview/ClineProvider.ts`

## Critical Gotcha: `mergeExtensionState()` Can Hide Real Bugs

The webview does not simply replace state. It merges in:

- `webview-ui/src/context/ExtensionStateContext.tsx`

Specifically:

- `mergeExtensionState(prevState, newState)`

That means:

1. some fields are merged
2. some fields are replaced
3. defaults can mask missing host values

If a nested setting is omitted from the posted state, the webview may silently keep an old object or silently fall back to a default object depending on the path.

Do not assume the merge behavior is helping you.
Inspect it directly.

## Critical Gotcha: Runtime Key Lists Can Be Stale Even When TS Looks Correct

This repo exports runtime schema from the `.js` mirrors under:

- `packages/types/src/*.js`

That means a setting can exist in:

- `packages/types/src/global-settings.ts`

and still be missing at runtime if it is absent from:

- `packages/types/src/global-settings.js`

This exact failure mode also happened with:

- `formatterSettings`

The runtime proof check was:

```bash
node - <<'NODE'
const t=require('./packages/types/dist/index.cjs');
console.log('GLOBAL_SETTINGS_KEYS has formatter:', t.GLOBAL_SETTINGS_KEYS.includes('formatterSettings'));
console.log('GLOBAL_STATE_KEYS has formatter:', t.GLOBAL_STATE_KEYS.includes('formatterSettings'));
NODE
```

If those are `false`, runtime still does not know the setting exists.

Required fix:

1. add the field to `packages/types/src/global-settings.js`
2. rebuild the package:
   - `pnpm --filter @roo-code/types build`
3. re-check `packages/types/dist/index.cjs`

## Critical Gotcha: `handleSubmit()` Is a Hand-Curated Allowlist

Saving from settings is not automatic.

`SettingsView.handleSubmit()` manually builds `updatedSettings`.

That means:

- adding a new field to `cachedState` is not enough
- adding a schema key is not enough
- rendering the control is not enough

If it is missing from `updatedSettings`, it does not save.

File:

- `webview-ui/src/components/settings/SettingsView.tsx`

This is one of the highest-frequency causes of fake-working settings.

## Critical Gotcha: `setCachedStateField()` Is Not Always Enough

For simple primitives, this is usually fine:

- `setCachedStateField("someFlag", true)`

For nested objects, arrays, or settings with normalization, use a dedicated setter.

Example:

- `setFormatterSettingsField`

Why:

1. object equality needs `deepEqual`
2. `undefined` vs `{}` matters
3. partial nested writes can accidentally discard siblings

If the setting is not a primitive, default to a dedicated setter.

## Minimal Debug Recipe For Settings That “Save” But Flip Back

If a setting appears to save but the checkbox/button flips back:

1. Log the submitted value in `webviewMessageHandler.ts`
2. Log immediately after `contextProxy.setValue(...)`
3. Log `ClineProvider.getState()`
4. Log `ClineProvider.getStateToPostToWebview()`
5. Log the webview `"state"` message in `ExtensionStateContext.tsx`
6. Log the `SettingsView` sync effect that copies `extensionState` into `cachedState`

If backend logs are correct but frontend receives `{}` or default values, the bug is not storage. It is the state-posting pipeline.

## Better Debug Recipe

Use this order exactly:

1. confirm the UI local value changed
   - `cachedState`
2. confirm `handleSubmit()` sent the right payload
3. confirm `webviewMessageHandler.ts` received the right payload
4. confirm `ContextProxy.setValue()` stored the right value
5. confirm `ContextProxy.getValues()` still has the value
6. confirm `ClineProvider.getState()` includes it
7. confirm `ClineProvider.getStateToPostToWebview()` includes it
8. confirm the webview `"state"` message contains it
9. confirm `mergeExtensionState()` does not destroy it
10. confirm `SettingsView` sync from `extensionState` does not overwrite `cachedState`

Do not skip steps.
Most wasted time comes from jumping from step 3 to step 10.

## Prompt Persistence Checklist

If a setting saves correctly but the prompt does not change:

1. Check `generateSystemPrompt.ts` passes the setting through
2. Check `Task.getSystemPrompt()` passes the setting through
3. Check the prompt template actually uses it
4. Invalidate any task system prompt cache when the setting changes

Main cache invalidation location:

- `src/core/webview/webviewMessageHandler.ts`

## Safe Pattern For New Settings

For a normal global setting:

1. add to:
   - `packages/types/src/global-settings.ts`
   - `packages/types/src/global-settings.js`
2. make sure runtime key lists include it:
   - `GLOBAL_SETTINGS_KEYS`
   - `GLOBAL_STATE_KEYS`
3. add it to `src/shared/ExtensionMessage.ts` if webview state needs it
4. add it to host posted state in `ClineProvider.ts`
5. initialize sane webview defaults in `ExtensionStateContext.tsx`
6. update UI cached state
   - primitive: `setCachedStateField`
   - object/array: dedicated setter
7. include it in `SettingsView.handleSubmit()`
8. persist through one authoritative path
9. verify the posted `"state"` includes the saved value
10. make runtime read from the same stored value

### New Global Setting Template

Use this when adding a new global setting:

1. Define the schema and runtime mirror.
2. Decide whether it is primitive or nested.
3. Add it to `ExtensionState`.
4. Add default webview value.
5. Add host posted-state value.
6. Add UI control.
7. Add submit persistence.
8. Reload and verify the round-trip.
9. Verify runtime consumer behavior.
10. Add a targeted test if the setting is non-trivial.

For an API/profile setting:

1. add to provider settings schema
2. edit via `apiConfiguration`
3. persist through `upsertApiConfiguration`
4. make runtime read from `apiConfiguration`

## When To Use `updateSettings` vs `updateGlobalState`

Prefer:

- `updateSettings`

when the setting belongs to the settings page save/apply model.

Use:

- `updateGlobalState`

when:

1. the setting is not part of the settings page
2. it needs immediate persistence outside save/apply
3. you are intentionally using a direct persistence path

Do not casually use both unless you explicitly want redundancy and understand the tradeoff.

## If You Are An AI Editing Settings

Before “fixing” a broken setting:

1. Identify whether it is global or provider/profile state
2. Find the real source of truth
3. Find every place that reads it
4. Find every place that writes it
5. Remove duplicate write paths unless truly needed
6. Check `packages/types/src/*.js` mirrors

If you skip step 6, you can waste hours.

## Final Sanity Checklist

Before calling a setting "done", verify all of this manually:

1. toggling it updates the control immediately
2. Save becomes enabled
3. Save persists without errors
4. closing and reopening settings shows the saved value
5. full webview reload still shows the saved value
6. extension reload still shows the saved value
7. runtime behavior actually changes
8. no duplicate write path is fighting the saved value

If you only test step 1, you have tested almost nothing.
