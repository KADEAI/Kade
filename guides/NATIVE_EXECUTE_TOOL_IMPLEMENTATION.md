# Native Execute Tool Implementation

## Goal

Replace the current multi-tool native JSON router shape:

- `tools -> [{ tool, query, path, ... }]`
- `content -> [{ tool, path, oldText, newText, ... }]`

with one native tool that carries a low-entropy command DSL:

```json
{
  "name": "execute",
  "arguments": {
    "commands": [
      "read src/app.ts:40-80",
      "grep auth|login src",
      "edit src/app.ts\noldText 10-12:\nfoo\nnewText:\nbar"
    ]
  }
}
```

This keeps JSON as the transport format for users and providers, but moves the real tool language into a parser-controlled string protocol.

## Why

### Problem with the current native JSON routers

- Too many exposed shapes
- Nested object burden on weaker models
- Frequent malformed tool calls:
  - wrong field names
  - missing `tool`
  - empty `content`
  - invalid edit object structure
  - bad batching shape
- The model has to solve transport syntax and tool semantics at the same time

### Why the `execute(commands: string[])` shape is stronger

- One tool only
- One required field only
- One primitive field type only: `string[]`
- One command per array element
- No nested per-tool JSON objects
- No router discrimination problem
- Much easier recovery and error attribution in our parser
- Native tool-call separation is preserved, so the model is not roleplaying a DSL in chat text

## Recommended Tool Shape

Tool name:

- `execute`

Arguments:

```json
{
  "type": "object",
  "properties": {
    "commands": {
      "type": "array",
      "description": "One command per string. No prose.",
      "items": {
        "type": "string",
        "description": "A single command in the built-in command DSL."
      }
    }
  },
  "required": ["commands"],
  "additionalProperties": false
}
```

## DSL Design

### Guiding rules

- Inline commands stay single-line
- Block commands use multiline bodies
- Avoid quotes when possible
- Avoid optional syntax variants
- Keep the first token as the command verb

### Inline commands

```text
read src/app.ts:40-80
grep auth|login src
find package.json|tsconfig.json src
list src/components
bash npm run build apps/web
web python apps
fetch https://example.com
ask auth flow entrypoint
agent analyze the current project structure
```

### Block commands

```text
edit src/app.ts
oldText 10-12:
foo
newText:
bar
```

```text
write notes.txt
hello world
```

```text
todo Implementation
[ ] Analyze requirements
[-] Update parser
[x] Add tests
```

## Architecture

### High-level flow

1. Provider exposes one native tool: `execute`
2. Model emits `execute({ commands: string[] })`
3. New native execute parser converts each `commands[i]` string into an internal canonical tool call
4. Internal execution still uses normal `read`, `grep`, `edit`, `write`, `web`, etc.
5. Tool results remain per-child-call so the rest of the system stays intact

### The key principle

JSON is only the envelope.

The DSL is the actual protocol.

## Implementation Plan

### 1. Native tool registry

Files likely touched:

- `src/core/prompts/tools/native-tools/registry.ts`
- `src/core/prompts/tools/native-tools/index.ts`
- `src/core/task/build-tools.ts`
- `src/core/prompts/tools/filter-tools-for-mode.ts`

Changes:

- Add a new native tool definition for `execute`
- Stop exposing `tools` and `content` to the model when JSON/native protocol is active
- Keep legacy router support parser-side for compatibility and history replay

### 2. Parser

Files likely touched:

- `src/core/assistant-message/NativeToolCallParser.ts`
- possibly a new parser helper file if the logic grows

Changes:

- Add parsing for:
  - `execute({ commands: string[] })`
- For each string command:
  - parse verb
  - parse inline args or block body
  - normalize to internal canonical tool calls
- Produce native batch calls as the output

Result:

- `execute` becomes an internal `batch` call with canonical children

### 3. Batch execution

Files likely touched:

- `src/core/tools/BatchTool.ts`
- possibly a new helper for execute parse errors

Changes:

- Preserve index-level error reporting:
  - `commands[2]: malformed edit block`
- One invalid command should not destroy all valid siblings unless the entire payload is unusable

### 4. Prompting

Files likely touched:

- `src/core/prompts/system.ts`
- new prompt section or reuse current unified prompt ideas in native-tool descriptions

Changes:

- For JSON/native protocol, describe the one-tool command DSL clearly
- Keep the command language tiny and rigid
- Show multiple examples
- Explicitly say:
  - one command per string
  - no prose
  - use multiline only for `edit`, `write`, `todo`

## Backward Compatibility

### Keep parsing these for now

- existing `tools` router calls
- existing `content` router calls
- legacy aliases already in the parser

### Do not keep exposing these to the model

- `tools`
- `content`
- nested router argument schema

That lets old history and fallback providers still work, while new model outputs move to the cleaner one-tool shape.

## Error Handling

This design only pays off if the error messages are better than current JSON router failures.

### Required behavior

- Report invalid command by index
- Report exact failure reason
- Do not convert malformed commands into unrelated child tools
- Do not surface placeholder edit bodies back to the model

### Good examples

- `commands[0]: unknown command "reed"`
- `commands[2]: edit requires at least one oldText/newText pair`
- `commands[3]: write requires a target path`
- `commands[4]: fetch requires a URL`

## Model-History Rules

The model should never see prior successful command bodies in a way that encourages it to copy placeholders back into new calls.

Rules:

- successful `write` history: keep path, drop body
- successful `edit` history: keep path/ranges, drop old/new bodies
- successful `execute` history: keep command skeletons only, not full heavy bodies

## Testing Plan

### Parser tests

- parses inline commands
- parses multiline `edit`
- parses multiline `write`
- parses mixed command batches
- preserves command order
- reports indexed parse failures

### Integration tests

- `execute` -> internal batch -> `read`
- `execute` -> internal batch -> `edit`
- mixed valid + invalid commands
- history compaction does not leak placeholders back to the model

### Regression tests

- legacy `tools` router still parses
- legacy `content` router still parses
- native JSON history replay still works

## Rollout Strategy

### Phase 1

- add `execute`
- add parser + tests
- keep old routers exposed behind a feature flag only

### Phase 2

- expose only `execute` for native JSON protocol
- keep old router parsing internally for replay and compatibility

### Phase 3

- remove public dependence on router-specific JSON shapes in prompts and docs

## Recommendation

If the goal is:

- fewer tool-call failures
- less provider-specific JSON weirdness
- preserved native tool separation
- less model roleplay burden

then `execute({ commands: string[] })` is probably the strongest design available for this extension.

The winning property is not that it is more "standard" than the current system.

The winning property is that it gives the model almost nothing structural to screw up while keeping all semantic intelligence parser-side, where we control it.
