# Vitest In This Repo

This repo is a PNPM workspace. `vitest` is not installed at the root package, so root-level commands often fail even though Vitest is available inside `webview-ui` and `src`.

Assume your shell starts in the repo root. That is the normal case.

## What works

Run Vitest from the `webview-ui` package context:

```bash
pnpm --dir webview-ui exec vitest run
```

Run Vitest from the `src` package context:

```bash
pnpm --dir src exec vitest run
```

Run specific test files:

```bash
pnpm --dir webview-ui exec vitest run src/components/settings/__tests__/DisplaySettings.spec.tsx
pnpm --dir webview-ui exec vitest run src/components/tools/__tests__/Bash.spec.tsx
pnpm --dir src exec vitest run api/transform/__tests__/stream.spec.ts
```

Run multiple specific files:

```bash
pnpm --dir webview-ui exec vitest run \
  src/components/settings/__tests__/DisplaySettings.spec.tsx \
  src/components/tools/__tests__/Bash.spec.tsx
```

Run tests matching a name:

```bash
pnpm --dir webview-ui exec vitest run -t "starts collapsed"
pnpm --dir src exec vitest run -t "stream"
```

## Path gotcha for `src`

This is the part many agents get wrong.

Even if your shell starts at the repo root, this command:

```bash
pnpm --dir src exec vitest run ...
```

runs Vitest with `src/` as the package directory. That means test file arguments should usually be relative to `src`, not relative to the repo root.

Correct:

```bash
pnpm --dir src exec vitest run api/transform/__tests__/stream.spec.ts
pnpm --dir src exec vitest run core/condense/__tests__/condense.spec.ts
pnpm --dir src exec vitest run activate/__tests__/registerCommands.spec.ts
```

Often wrong:

```bash
pnpm --dir src exec vitest run src/api/transform/__tests__/stream.spec.ts
pnpm --dir src exec vitest run src/core/condense/__tests__/condense.spec.ts
```

Why this fails:

- your shell may be at repo root
- but `--dir src` changes the package execution context to `src`
- so `src/...` can become an accidental `src/src/...` path

For `webview-ui`, using `src/...` is correct because the package root is `webview-ui` and the tests live under `webview-ui/src/...`.

So:

- `pnpm --dir webview-ui exec vitest run src/...`
- `pnpm --dir src exec vitest run api/...` or `core/...` or `services/...`

## Why `vitest not found` happens

This usually fails from the repo root:

```bash
pnpm vitest run
```

Reason:

- the root `package.json` does not have `vitest` as a dependency
- `vitest` is installed in `webview-ui/package.json`
- `vitest` is also installed in `src/package.json`

So you need either:

- `pnpm --dir webview-ui exec vitest ...`
- `pnpm --dir src exec vitest ...`
- or `cd webview-ui && pnpm exec vitest ...`
- or `cd src && pnpm exec vitest ...`

## Why `pnpm --dir <pkg> test` may fail

These can fail:

```bash
pnpm --dir webview-ui test
pnpm --dir src test
```

Reason:

- both `webview-ui/package.json` and `src/package.json` have this `pretest` hook:

```json
"pretest": "turbo run kilo-code#bundle --cwd .."
```

- in this workspace, that Turbo target currently fails with:

```text
Could not find package `kilo-code` in project
```

So if you just want to run Vitest, bypass the package script and call Vitest directly:

```bash
pnpm --dir webview-ui exec vitest run
pnpm --dir src exec vitest run
```

## Recommended commands

Fastest reliable command for a focused `webview-ui` test:

```bash
pnpm --dir webview-ui exec vitest run path/to/test.spec.tsx
```

Fastest reliable command for a focused `src` test:

```bash
pnpm --dir src exec vitest run path/from/src-package-root.spec.ts
```

If you prefer changing directories first:

```bash
cd webview-ui
pnpm exec vitest run
```

```bash
cd src
pnpm exec vitest run
```

## Practical rule

Use these rules in this repo:

- if the test lives under `webview-ui/src`, run Vitest from `webview-ui`
- if the test lives under `src`, run Vitest from `src` and drop the leading `src/` from the file argument
- do not use root-level `pnpm vitest`
- do not rely on `pnpm --dir webview-ui test` unless the broken `pretest` hook has been fixed
- do not rely on `pnpm --dir src test` unless the broken `pretest` hook has been fixed

## Why agents keep getting this wrong

This repo has two patterns that confuse agents:

- it is a workspace monorepo, so `vitest` is package-local instead of root-global
- both `webview-ui` and `src` expose a `test` script, but both also run a broken `pretest` hook first

That means an agent using a generic strategy will often do one of these:

- run `pnpm vitest run` from the repo root and get `Command "vitest" not found`
- run `pnpm test -- ...` and trigger Turbo instead of the local package binary
- run `pnpm --dir webview-ui test` or `pnpm --dir src test` and hit the failing `pretest` before Vitest starts

So the failure is usually not Vitest itself. It is command selection in a workspace with package-local binaries plus a broken `pretest` hook.

## Verified examples

This command was successfully used in this repo:

```bash
pnpm --dir webview-ui exec vitest run src/components/settings/__tests__/DisplaySettings.spec.tsx src/components/tools/__tests__/Bash.spec.tsx
```

It completed with both test files passing.

This is the correct pattern for `src` tests:

```bash
pnpm --dir src exec vitest run api/transform/__tests__/stream.spec.ts
```
