# Provider Implementation Guide

This repo has two separate pieces for a provider:

1. runtime support in `src/api/`
2. settings and model-selection support in `webview-ui/`

If you only do one side, the provider will look half-implemented.

## 1. Add provider types and defaults

Start in `packages/types/src/`.

- Add the provider to `provider-settings.ts`
- Add provider-specific config fields
- Add the provider to the discriminated union
- Add the model-id mapping in `modelIdKeysByProvider`
- Add provider metadata in the provider catalog
- Add default model exports in `packages/types/src/providers/<provider>.ts`
- Export that provider from `packages/types/src/providers/index.ts`

Minimum things you need:

- provider name in the relevant provider list
- API key/base URL fields if applicable
- default model id
- default model info
- model-id field mapping

## 2. Wire model fetching

Model loading is separate from message generation.

Relevant files:

- `src/api/providers/fetchers/modelCache.ts`
- `src/api/providers/fetchers/<provider>.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/shared/api.ts`

Typical flow:

1. add a fetcher in `src/api/providers/fetchers/<provider>.ts`
2. register it in `modelCache.ts`
3. make sure `GetModelsOptions` in `src/shared/api.ts` accepts the provider-specific fields
4. include the provider in `requestRouterModels` handling in `src/core/webview/webviewMessageHandler.ts`

If the provider is public, also consider adding it to the background refresh list in `modelCache.ts`.

## 3. Add the runtime handler

This is what actually sends prompts.

Relevant files:

- `src/api/providers/<provider>.ts`
- `src/api/providers/index.ts`
- `src/api/index.ts`

Patterns already in the repo:

- `RouterProvider` for OpenAI-compatible dynamic providers
- `BaseOpenAiCompatibleProvider` for providers with fixed model catalogs
- custom handlers for providers with unusual auth/protocol behavior

Checklist:

1. create `src/api/providers/<provider>.ts`
2. choose the right base class
3. pass base URL, API key, selected model field, and provider defaults
4. export it from `src/api/providers/index.ts`
5. instantiate it in the `buildApiHandler()` switch in `src/api/index.ts`

If the provider is OpenAI-compatible, prefer reusing the existing OpenAI/router abstractions instead of copying a custom handler.

## 4. Make selected model resolution work

The settings UI and task UI both depend on selected-model resolution.

Relevant file:

- `webview-ui/src/components/ui/hooks/useSelectedModel.ts`

If your provider uses router-loaded models or a custom model-id field, add a dedicated case here. Otherwise the UI may show the wrong model info or fall back to another provider's defaults.

## 5. Add settings UI

Relevant files:

- `webview-ui/src/components/settings/constants.ts`
- `webview-ui/src/components/settings/constants.js`
- `webview-ui/src/components/settings/ApiOptions.tsx`
- `webview-ui/src/components/settings/providers/index.ts`
- `webview-ui/src/components/settings/providers/<Provider>.tsx`

Important: this repo has both `constants.ts` and `constants.js` checked in. If you add a provider to the picker, update both or the runtime/tests may still miss it.

Typical settings work:

1. add the provider to `PROVIDERS` in `constants.ts` and `constants.js`
2. create `providers/<Provider>.tsx`
3. export it from `providers/index.ts`
4. render it in `ApiOptions.tsx`
5. add default model reset behavior in `ApiOptions.tsx`
6. include provider-specific router query keys if models depend on API key or base URL

If the provider is missing from the dropdown, check `ApiOptions.tsx` for an explicit filter first.

## 6. Add icon support

Relevant files:

- `webview-ui/src/components/settings/providerIcons.tsx`
- `webview-ui/src/components/settings/providerIconManifest.json`

If no icon asset exists, add a simple explicit fallback in `providerIcons.tsx`.

## 7. Verify both halves

At minimum:

- provider appears in settings
- provider settings panel renders
- model list loads
- selecting the provider sets the expected model field
- `buildApiHandler()` returns the new handler

Useful focused checks:

- `pnpm exec vitest run webview-ui/src/components/settings/__tests__/ApiOptions.spec.tsx -t "<ProviderName>"`
- targeted TypeScript checks if the full repo currently has unrelated failures

## 8. Common failure modes

- Added to types, but not `ApiOptions.tsx`
- Added to settings UI, but `buildApiHandler()` still uses a placeholder handler
- Added model fetcher, but forgot `useSelectedModel.ts`
- Added `constants.ts`, but forgot `constants.js`
- Added provider fields, but forgot `modelIdKeysByProvider`
- Added handler, but forgot `src/api/providers/index.ts`

## Fast checklist

- `packages/types/src/provider-settings.ts`
- `packages/types/src/providers/<provider>.ts`
- `packages/types/src/providers/index.ts`
- `src/shared/api.ts`
- `src/api/providers/fetchers/<provider>.ts`
- `src/api/providers/fetchers/modelCache.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/api/providers/<provider>.ts`
- `src/api/providers/index.ts`
- `src/api/index.ts`
- `webview-ui/src/components/ui/hooks/useSelectedModel.ts`
- `webview-ui/src/components/settings/constants.ts`
- `webview-ui/src/components/settings/constants.js`
- `webview-ui/src/components/settings/providers/<Provider>.tsx`
- `webview-ui/src/components/settings/providers/index.ts`
- `webview-ui/src/components/settings/ApiOptions.tsx`
- `webview-ui/src/components/settings/providerIcons.tsx`

## Good examples in this repo

- `opencode`: dynamic OpenAI-compatible provider with dedicated settings panel
- `glama`: dynamic provider with auth URL + router models
- `aihubmix`: provider that needed both settings wiring and a real runtime handler
