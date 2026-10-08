# Lint for games

`@moku-labs/game/lint` is an oxlint JS plugin named `moku-game`. It checks the engine rules in a game: lazy Pixi and Yoga, no native package in the logic, the editor only in dev files, no module-scope state, determinism, pure rules, and JSX keys the [project index](./project-index.md) can follow. Three layout rules check the v15 layout of a game: the order of the layers, the doors of the features, and the suffix of each test file.

oxlint's own `no-restricted-imports` also flags the lazy `import("pixi.js")` the engine asks for, and its regex has no lookahead. So these rules ship as plugin code.

## Setup

oxlint 1.86.0 or later. The rules use the ESLint rule API, so ESLint 9 loads the same object. The engine ships no default severity: a game turns each rule on.

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
    "moku-game/static-keys": "error",
    "moku-game/layer-imports": "error",
    "moku-game/feature-door": "error",
    "moku-game/test-suffix": "error"
  }
}
```

## Rules

| Rule | Code | Reports | Passes |
|---|---|---|---|
| `moku-game/lazy-imports` | L2 | `import { Application } from "pixi.js"`, `export … from "yoga-layout"`, subpaths too | `import type …`, `await import("pixi.js")` |
| `moku-game/native-imports` | L13 | any import or `import()` of `@moku-labs/system`, `@moku-labs/native`, `@tauri-apps/*`, also in the root `index.ts` and `config.ts`: name the capability in `config.ts` `system`, the engine page wires it | the same import in `platform-bridge.ts`, `native.ts`, `web/` until the demos leave them |
| `moku-game/dev-imports` | dev only | any import or `import()` of `@moku-labs/editor` (and subpaths) or `@moku-labs/game/control` | the same import in a dev file or a test |
| `moku-game/no-module-state` | L5 | a module-scope `let` or `var`, a module-scope `new Map/Set/WeakMap/WeakSet` (exported too) | the same inside a function |
| `moku-game/determinism` | L3 | `Math.random`, `Date.now`, `performance.now`, `new Date()`, `setTimeout`, `setInterval` (bare or on `globalThis`, `window`, `self`) | `new Date(now)`: it formats a stored moment |
| `moku-game/rules-siblings` | L4 | an import in `rules/` that is not a sibling, `@core/types` or `@shared/rules`: `@core/kit`, `../tables`, `import type … from "@moku-labs/game"` | `import { cost } from "./cost"`, `@core/types`, `@shared/rules`, the same two files by relative path |
| `moku-game/static-keys` | keys | a JSX `key` the project index cannot follow: `tabKeys[props.tab]`, `a ?? b`, `a \|\| b`, `a && b`, `a ? b : c`, `props.tab`, `item.name`, a `let`, a function, a class or a catch parameter, a `const` of one of these | `key="row"`, `key={3}`, `` key={`${props.id}Label`} ``, `props.id`, `props.amountKey`, `cardKey(card.slot)`, a parameter, an import, a `const` of one of these |
| `moku-game/layer-imports` | layers | an import, export-from or `import()` that reaches a layer above its own, `import type` too: `@features/home` from `shared/` | `@core/kit` and `@shared` from a feature |
| `moku-game/feature-door` | doors | `@features` below `game.ts`, a feature that imports its own `index.ts`, a deep import of another feature, a relative import that leaves the feature | `@features/orders`, `./flow/merge` inside the feature |
| `moku-game/test-suffix` | tests | a file in a test kind folder that misses the folder's suffix: `tests/e2e/board.test.ts` | `tests/e2e/board.e2e.ts`, a helper in `tests/helpers/`, the folder's `index.ts` |

`import { type A } from "pixi.js"` is reported. Under `verbatimModuleSyntax` it keeps a side-effect import, which loads Pixi. Write `import type { A } from "pixi.js"`.

### Static keys

The game reports a JSX key at run time; `find` turns it back into the line that wrote it. That works when the key is written so the index can read it. A key may be a string or number literal; the index reads both. A name is followed through up to three `const` initializers in the file. A parameter, an import, a global and a call are left to the index, and `--check` lists what it still cannot read. Any other name is reported: a `let`, a `var`, a function, a class, a catch parameter.

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

## Layout rules

`layer-imports`, `feature-door` and `rules-siblings` read where an import lands. A relative specifier is joined to the folder of the file. An alias goes through the tsconfig `paths`. A package lands nowhere, and no layout rule looks at it.

### Layers

Each path below the game root sits in one layer:

| Path | Layer | Unit | Door |
|---|---|---|---|
| `core/**` | core | `core` | none |
| `shared/index.ts` | shared | `shared` | yes |
| `shared/**` | shared | `shared` | no |
| `features/index.ts` | features | the barrel | yes |
| `features/<f>/index.ts`, the folder `features/<f>` | features | `features/<f>` | yes |
| `features/<f>/**` | features | `features/<f>` | no |
| `plugins/index.ts`, `plugins/<p>/**` | plugins | as features | as features |
| `generated/**` | generated | | |
| `game.ts` | game | | |
| `tests/**` | tests | | |
| anything else: `kit.ts`, `nodes/`, `flows/`, `view/`, `web/`, `features/x.ts` | outside | | |

An importer or a target outside the layout keeps every layout rule quiet. So a game in the template layout, with no `core/`, `shared/` or `plugins/`, lints as before.

`layer-imports` lets each layer import these layers:

| Importer | May import |
|---|---|
| core | core, generated |
| shared | core, shared, generated |
| features | core, shared, features, generated |
| plugins | core, shared, plugins, generated |
| `game.ts` | every layer |

Nobody but `game.ts` imports `game.ts`. The message is `Layers: shared does not import features. Order: core ← shared ← features ← game.ts; plugins import core and shared.`

### Doors

`feature-door` reads the files of `core/`, `shared/`, `features/` and `plugins/`:

| Case | Message |
|---|---|
| `@features` or `@plugins` imported below `game.ts` | `Door: only game.ts imports the @features and @plugins barrels.` |
| a feature imports its own door: `@features/<own>`, `../index`; `@shared` from inside `shared/` | `Door: a feature does not import its own index.ts. Import the file: ./flow/merge.` |
| a file of another feature or plugin, not its door: `@features/orders/flow/merge`, `../../orders/flow/merge` | `Door: another feature is imported from its index.ts only: @features/orders.` |
| a relative import that leaves the feature: `../../orders`, `../../../shared/rules` | `Door: an import that leaves features/orders is written as an alias: @features/<f>, @shared, @core/<file>.` |

Inside one feature any relative import passes, at any depth. The barrels `features/index.ts` and `plugins/index.ts` import the doors of their layer by relative path: `export { homeFeature } from "./home"`. `core/` has no door: a relative import inside core and `@core/*` pass, a relative import out of core is reported. `@shared/rules` and the other deep aliases of `shared/` pass.

### Test suffixes

`test-suffix` reports a `.ts` or `.tsx` file in a test kind folder that does not end with the folder's suffix. A `.tsx` file takes the suffix with an `x`: `.e2e.tsx`. The `index.ts` of a kind folder passes: it is the folder's door, such as `tests/visual/index.ts`, the module `moku-game visual` reads.

| Folder | Suffix |
|---|---|
| `tests/e2e/` | `.e2e.ts` |
| `tests/visual/` | `.visual.ts` |
| `tests/editor/` | `.editor.ts` |
| `__tests__/`, a file directly inside | `.test.ts` |
| `__tests__/unit/`, `__tests__/integration/` | `.test.ts` |
| `__tests__/isolated/` | `.isolated.ts` |
| `__tests__/visual/` | `.visual.ts` |

A kind folder holds its sub-folders too: `tests/editor/e2e/flow.spec.ts` is reported. A sub-folder named `helpers`, `fixtures` or `baselines` is not checked. Neither are `tests/helpers/`, `tests/scenarios/`, `__tests__/fixtures/` and a kind folder the table does not name, as `tests/integration/`. A helper that lies directly in `tests/visual/` is reported: it moves to `tests/helpers/`. The message is `Tests: a file in tests/e2e/ ends with .e2e.ts. Rename board.test.ts to board.e2e.ts, or move a helper to tests/helpers/.`

### Aliases

The layout rules read the `paths` of the game's tsconfig, `tsconfig.json` by default. They read it the way the project index does: an exact key first, then the `*` key with the longest prefix. `@moku-labs/game` is a package even when the paths map it.

- Comments and trailing commas are allowed, as in TypeScript.
- `extends` is followed when it is a relative path, a string or an array, up to 8 configs deep. A package name in `extends` ends the chain: lint resolves no node module.
- The nearest `paths` and the nearest `baseUrl` win. Targets resolve against `baseUrl` when one is set, else against the folder of the config that declares `paths`, as TypeScript does.
- Each rule reads the tsconfig once per lint run. A config that moves, appears or vanishes is read again.

When the tsconfig is missing or declares no `paths`, the rules read the v15 aliases, relative to the game root. A `paths` block replaces the table whole.

| Alias | Target |
|---|---|
| `@core/*` | `core/*` |
| `@shared` | `shared/index.ts` |
| `@shared/rules` | `shared/rules/index.ts` |
| `@features` | `features/index.ts` |
| `@features/*` | `features/*/index.ts` |
| `@plugins` | `plugins/index.ts` |
| `@generated/*` | `generated/*` |
| `@tests/*` | `tests/*` |

A tsconfig that does not parse is reported once per file by each layout rule: `Lint: tsconfig.json does not parse. The layout rules read the v15 aliases until it does.` The rules then read the v15 table.

`aliasTargetsOf(tsconfig, root, specifier)` answers what the rules read for one specifier, by absolute path:

```ts
import { aliasTargetsOf } from "@moku-labs/game/lint";

// A game without a tsconfig reads the v15 aliases.
aliasTargetsOf("/game/tsconfig.json", "/game", "@features/orders"); // ["/game/features/orders/index.ts"]
```

## Options

Every rule takes `files` and `ignores`. A key you give replaces that default.

```json
"moku-game/determinism": ["error", { "files": ["src/logic/**"], "ignores": ["**/*.dev.ts"] }]
```

| Option | Type | Meaning |
|---|---|---|
| `files` | `string[]` | Globs of the files the rule checks |
| `ignores` | `string[]` | Globs of the files the rule skips, even when `files` matches |

Globs are relative to the directory oxlint runs in. They support `**`, `*`, `?` and `{a,b}`. A glob without `/` matches at the root only, as in ESLint flat config.

The layout rules take two more options, `test-suffix` takes `root` and `suffixes`:

```json
"moku-game/layer-imports": ["error", { "root": "src", "tsconfig": "tsconfig.game.json" }],
"moku-game/test-suffix": ["error", { "suffixes": { "tests/e2e/": ".spec.ts" } }]
```

| Option | Rules | Type | Meaning |
|---|---|---|---|
| `root` | `layer-imports`, `feature-door`, `rules-siblings`, `test-suffix` | `string` | The folder of `core/`, `shared/`, `features/`, `plugins/` and `game.ts`, relative to the directory oxlint runs in. Default `.`. A file outside it is not checked |
| `tsconfig` | `layer-imports`, `feature-door`, `rules-siblings` | `string` | The tsconfig whose `paths` name the aliases, relative to the directory oxlint runs in. Default `tsconfig.json` |
| `suffixes` | `test-suffix` | `Record<string, string>` | Kind folder to suffix. Replaces the default table whole |

## Defaults

The defaults follow the layout of a game. They start with `**/`, so a game that keeps its files under `src/` matches too.

| Rule | Default `files` | Default `ignores` |
|---|---|---|
| `lazy-imports` | `**` | tests |
| `native-imports` | logic, `config.ts`, `**/kit.ts`, `**/plugins/**` | `**/*.dev.{ts,tsx}`, tests |
| `dev-imports` | `**` | `.moku/**`, `web/main.ts`, `web/dev*.ts`, `web/editor*.ts`, `**/*.dev.{ts,tsx}`, tests |
| `no-module-state` | `**` | tests |
| `determinism` | logic | effect side, `**/*.dev.{ts,tsx}`, tests |
| `rules-siblings` | `**/rules/**` | tests |
| `static-keys` | `**/*.tsx` | tests |
| `layer-imports` | `**` | tests, `**/generated/**` |
| `feature-door` | `**/{core,shared,features,plugins}/**` | tests |
| `test-suffix` | `**/tests/**`, `**/__tests__/**` | none |

- logic: the root `index.ts`, `**/state.ts`, `**/tables.ts`, `**/game.ts`, `**/{core,nodes,flows,rules,features,shared}/**`
- effect side: `**/{plugin,plugins}/**`. Plugins answer effects; the `schedule` effect is a timer by design
- tests: `tests/**`, `**/__tests__/**`, `**/*.{test,spec}.{ts,tsx}`

The asset keys and the names of the kind folders stay with the `moku-game-validator` agent of the moku Claude plugin. The engine's own repository still lints itself with ESLint.
