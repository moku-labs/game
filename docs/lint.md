# Lint for games

`@moku-labs/game/lint` is an oxlint JS plugin named `moku-game`. It checks the engine rules in a game: lazy Pixi and Yoga, no native package in the logic, the editor only in dev files, no module-scope state, determinism, pure rules, and JSX keys the [project index](./project-index.md) can follow.

oxlint's own `no-restricted-imports` also flags the lazy `import("pixi.js")` the engine asks for, and its regex has no lookahead. So these rules ship as plugin code.

## Setup

oxlint 1.86.0 or later. The rules use the ESLint rule API, so ESLint 9 loads the same object.

```json
// .oxlintrc.json
{
  "jsPlugins": ["@moku-labs/game/lint"],
  "rules": {
    "moku-game/lazy-imports": "error",
    "moku-game/native-imports": "error",
    "moku-game/dev-imports": "error",
    "moku-game/no-module-state": "error",
    "moku-game/determinism": "error",
    "moku-game/rules-siblings": "error",
    "moku-game/static-keys": "error"
  }
}
```

## Rules

| Rule | Code | Reports | Passes |
|---|---|---|---|
| `moku-game/lazy-imports` | L2 | `import { Application } from "pixi.js"`, `export … from "yoga-layout"`, subpaths too | `import type …`, `await import("pixi.js")` |
| `moku-game/native-imports` | L13 | any import or `import()` of `@moku-labs/system`, `@moku-labs/native`, `@tauri-apps/*` | the same import in `platform-bridge.ts`, `native.ts`, `web/` |
| `moku-game/dev-imports` | dev only | any import or `import()` of `@moku-labs/editor` (and subpaths) or `@moku-labs/game/control` | the same import in a dev file or a test |
| `moku-game/no-module-state` | L5 | a module-scope `let` or `var`, a module-scope `new Map/Set/WeakMap/WeakSet` (exported too) | the same inside a function |
| `moku-game/determinism` | L3 | `Math.random`, `Date.now`, `performance.now`, `new Date()`, `setTimeout`, `setInterval` (bare or on `globalThis`, `window`, `self`) | `new Date(now)`: it formats a stored moment |
| `moku-game/rules-siblings` | L4 | an import in `rules/` that does not start with `./` | `import { cost } from "./cost"` |
| `moku-game/static-keys` | keys | a JSX `key` the project index cannot follow: `tabKeys[props.tab]`, `a ?? b`, `a \|\| b`, `a && b`, `a ? b : c`, `props.tab`, `item.name`, a `let`, a `const` of one of these | `key="row"`, `` key={`${props.id}Label`} ``, `props.id`, `props.amountKey`, `cardKey(card.slot)`, a parameter, an import, a `const` of one of these |

`import { type A } from "pixi.js"` is reported. Under `verbatimModuleSyntax` it keeps a side-effect import, which loads Pixi. Write `import type { A } from "pixi.js"`.

### Static keys

The game reports a JSX key at run time; `find` turns it back into the line that wrote it. That works when the key is written so the index can read it. A name is followed through up to three `const` initializers in the file; a parameter, an import and a call are left to the index, and `--check` lists what it still cannot read.

```tsx
// Reported: the key is picked out of a table at run time.
const tabKeys = { audio: "tabSound", language: "tabLanguage" };
function TabButton(props: { tab: Tab }) {
  const key = tabKeys[props.tab];
  return <button key={key} />;
}

// Passes: the key is passed in as a key-carrying prop, `id` or a name that ends in `Key`.
function TabButton(props: { id: string; tab: Tab }) {
  return <button key={props.id} />;
}
<TabButton id="tabSound" tab="audio" />
```

The message is `Keys: a JSX key must be a literal, a template, or props.id / props.<name>Key. Pass the key in as a prop: <X id="…">.`

## Options

Every rule takes the same options. A key you give replaces that default.

```json
"moku-game/determinism": ["error", { "files": ["src/logic/**"], "ignores": ["**/*.dev.ts"] }]
```

| Option | Type | Meaning |
|---|---|---|
| `files` | `string[]` | Globs of the files the rule checks |
| `ignores` | `string[]` | Globs of the files the rule skips, even when `files` matches |

Globs are relative to the directory oxlint runs in. They support `**`, `*`, `?` and `{a,b}`. A glob without `/` matches at the root only, as in ESLint flat config.

## Defaults

The defaults follow the template layout of a game. They start with `**/`, so a game that keeps its files under `src/` matches too.

| Rule | Default `files` | Default `ignores` |
|---|---|---|
| `lazy-imports` | `**` | tests |
| `native-imports` | logic, `**/kit.ts`, `**/game.ts` | `**/*.dev.{ts,tsx}`, tests |
| `dev-imports` | `**` | `web/main.ts`, `web/dev*.ts`, `web/editor*.ts`, `**/*.dev.{ts,tsx}`, tests |
| `no-module-state` | `**` | tests |
| `determinism` | logic | `**/*.dev.{ts,tsx}`, tests |
| `rules-siblings` | `**/rules/**` | tests |
| `static-keys` | `**/*.tsx` | tests |

- logic: `**/state.ts`, `**/tables.ts`, `**/{nodes,flows,rules,features}/**`
- tests: `tests/**`, `**/__tests__/**`, `**/*.{test,spec}.{ts,tsx}`

The door guards, the asset keys and the feature layout stay with the `moku-game-validator` agent of the moku Claude plugin. The engine's own repository still lints itself with ESLint.
