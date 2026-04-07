# How To Add A Settings Page And Settings

This is the practical checklist for adding:

1. a new settings tab/page
2. one or more settings inside it
3. actual persistence that survives save, reload, and runtime use

This exists because adding a settings UI is easy.
Adding one that actually saves is not.

## Two Separate Jobs

Do not treat these as the same task.

### Job 1: Add a settings page

This means:

- new tab id
- new icon
- new component
- new page rendering in `SettingsView`

### Job 2: Add settings that persist

This means:

- schema
- runtime key registration
- webview state
- submit/save path
- host persistence
- posted state back to webview
- runtime consumer behavior

You can finish Job 1 and still have a completely fake settings page.

## Part 1: Add A New Settings Page

### 1. Create the page component

Usually under:

- `webview-ui/src/components/settings/`

Example:

- `MyFeatureSettings.tsx`

Typical shape:

```tsx
import { HTMLAttributes } from "react";

import { Section } from "./Section";
import { SetCachedStateField } from "./types";

type MyFeatureSettingsProps = HTMLAttributes<HTMLDivElement> & {
  mySetting?: boolean;
  setCachedStateField: SetCachedStateField<"mySetting">;
};

export const MyFeatureSettings = ({
  mySetting,
  setCachedStateField,
  ...props
}: MyFeatureSettingsProps) => {
  return (
    <div {...props}>
      <Section>
        {/* settings UI here */}
      </Section>
    </div>
  );
};
```

### 2. Import the page into `SettingsView.tsx`

File:

- `webview-ui/src/components/settings/SettingsView.tsx`

Add:

- component import
- optional icon import

### 3. Add a new section name

In `SettingsView.tsx`, update:

- `sectionNames`

Example:

```ts
const sectionNames = [
  "providers",
  "myFeature",
] as const;
```

If you forget this, the tab routing will be broken or invisible.

### 4. Add the tab to the sidebar sections list

In `SettingsView.tsx`, update the `sections` array.

Example:

```ts
{ id: "myFeature", icon: SomeIcon }
```

### 5. Add the page label

If the tab name is custom, update:

- `getSectionLabel()`

Otherwise make sure translations exist if it uses:

- `t("settings:sections.someSection")`

### 6. Render the page in the tab content switch

In `SettingsView.tsx`, add:

```tsx
{activeTab === "myFeature" && (
  <MyFeatureSettings
    mySetting={mySetting}
    setCachedStateField={setCachedStateField}
  />
)}
```

At this point the page exists.

That does not mean the settings save.

## Part 2: Add A New Setting

Decide first:

1. top-level global setting
2. provider/profile setting
3. immediate-message setting
4. nested object setting

If you choose the wrong category, the UI will lie to you.

## Part 3: Add A New Global Setting

This is the common case for settings-page toggles.

### 1. Add it to the global settings schema

Files:

- `packages/types/src/global-settings.ts`
- `packages/types/src/global-settings.js`

Example:

```ts
mySetting: z.boolean().optional(),
```

If you only change `.ts` and not `.js`, runtime can still act like the setting does not exist.

### 2. Make sure runtime key lists include it

These come from the schema, so after changing the schema verify:

- `GLOBAL_SETTINGS_KEYS`
- `GLOBAL_STATE_KEYS`

If runtime keys do not include it, `ContextProxy` will not load/store it correctly.

### 3. Expose it in webview state

File:

- `src/shared/ExtensionMessage.ts`

Add the field to `ExtensionState` if the webview needs to read it.

### 4. Add webview defaults

File:

- `webview-ui/src/context/ExtensionStateContext.tsx`

Add a default value in the initial `useState<ExtensionState>`.

If you skip this, first render behavior can be weird or unstable.

### 5. Make sure the host posts it back to the webview

File:

- `src/core/webview/ClineProvider.ts`

There are two important things:

1. `getState()`
2. `getStateToPostToWebview()`

Both matter.

If `getState()` has it but the posted state does not, the webview will still flip back.

### 6. Add it to `SettingsView` cached state usage

In `SettingsView.tsx`, destructure it from `cachedState`.

Example:

```ts
const { mySetting } = cachedState;
```

### 7. Connect the page UI to local cached state

For simple primitives:

```ts
setCachedStateField("mySetting", value)
```

For arrays, objects, or anything normalized:

- create a dedicated setter in `SettingsView.tsx`

Example:

- `setFormatterSettingsField`

Do not force nested objects through generic primitive-shaped setters unless you enjoy debugging ghosts.

### 8. Add it to `handleSubmit()`

File:

- `webview-ui/src/components/settings/SettingsView.tsx`

This is the most common thing people forget.

You must include it in:

- `updatedSettings`

Example:

```ts
updatedSettings: {
  mySetting: mySetting ?? false,
}
```

If it is not in `handleSubmit()`, it does not save.

### 9. Make sure `webviewMessageHandler.ts` persists it

Usually generic global settings work through:

- `case "updateSettings"`

which calls:

- `provider.contextProxy.setValue(key, value)`

If the setting is special-cased, make sure that special case exists.

### 10. Make sure runtime code reads the stored value

Saving is not enough.

If the setting is supposed to change actual behavior, find the runtime consumer:

- prompt builder
- tool
- task logic
- feature gate

And make sure it reads from the same source of truth.

## Part 4: Add A New Provider/Profile Setting

If the setting belongs to model/provider/profile behavior, do not make it global just because the UI lives in Settings.

Use:

- provider settings schema
- `apiConfiguration`
- `setApiConfigurationField(...)`
- `upsertApiConfiguration`

Typical files:

- provider settings schema/types
- `SettingsView.tsx`
- `webviewMessageHandler.ts`
- `ProviderSettingsManager.ts`

## Part 5: Add A Nested Object Setting

Only do this if grouping is truly worth it.

Example:

- `formatterSettings`

### Required precautions

1. use a dedicated setter
2. use `deepEqual`
3. normalize `undefined` carefully
4. include the entire object in submit
5. include the entire object in posted state
6. verify `mergeExtensionState()` does not stomp it

If you can flatten the setting instead, do that.

Flat booleans are less elegant and more reliable.

## Part 6: Add Search Support

If the settings page participates in settings search, register settings in the page component.

Typical helper:

- `useRegisterSetting`

Example:

```ts
useRegisterSetting({
  settingId: "my-feature-toggle",
  section: "myFeature",
  label: "Enable my feature",
});
```

If you add a page and skip search registration, the page still works, but search results will be incomplete.

## Part 7: Add Tests

At minimum, add UI tests for:

1. rendering
2. calling the setter when toggled

For high-risk settings, also test:

1. save payload includes the setting
2. posted state rehydrates correctly
3. runtime behavior changes

Good places to test:

- `webview-ui/src/components/settings/__tests__/`
- `src/core/webview/__tests__/`
- runtime consumer tests

## Part 8: The Real Verification Checklist

Before calling the page done:

1. page appears in the sidebar
2. page opens correctly
3. controls update immediately
4. Save becomes enabled
5. Save sends the correct payload
6. value survives closing and reopening settings
7. value survives full webview reload
8. value survives extension reload
9. runtime behavior actually changes
10. no second save path is fighting the first one

If you only verify that the tab renders, you verified almost nothing.

## Common Failure Modes

### "The page shows up but the setting does nothing"

Usually:

- runtime consumer never reads the setting

### "The toggle changes but Save does nothing"

Usually:

- missing from `handleSubmit()`

### "It saves in logs but flips back in UI"

Usually:

- missing from posted state
- wrong `getStateToPostToWebview()` path
- bad `mergeExtensionState()` behavior
- webview default stomping the value

### "It works until reload"

Usually:

- missing from runtime `.js` schema mirror
- missing from runtime keys
- not loaded by `ContextProxy`

### "The setting should be global but keeps acting profile-scoped"

Usually:

- someone accidentally wired it through `apiConfiguration`

### "The setting should be profile-scoped but changes globally"

Usually:

- someone accidentally persisted it through top-level global state

## Copy-Paste Mini Checklist

When adding a new settings page and setting, verify:

1. page component created
2. tab added to `sectionNames`
3. tab added to `sections`
4. page rendered in `SettingsView`
5. schema added in `.ts`
6. schema added in `.js`
7. `ExtensionState` updated
8. host posted state updated
9. webview defaults updated
10. local cached state wired
11. `handleSubmit()` updated
12. host persistence path confirmed
13. runtime consumer confirmed
14. reload verified

If any one of these is missing, assume the setting is not done.
