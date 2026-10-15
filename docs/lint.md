# Lint for games

`@moku-labs/game/lint` is an oxlint JS plugin named `moku-game`. It checks the engine rules in a game: lazy Pixi and Yoga, no native package in the logic, the editor only in dev files, no module-scope state, determinism, pure rules, and JSX keys the [project index](./project-index.md) can follow. Four layout rules check the v15 layout of a game: the order of the layers, the doors of the features at any depth, the sub-features a feature declares, and the suffix of each test file.

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
    "moku-game/sub-features": "error",
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
| `moku-game/feature-door` | doors | at any depth: `@features` below `game.ts`, a feature that imports its own `index.ts`, a deep import of another feature, a relative import that leaves the feature, a sub-feature that imports a feature it lives in | `@features/orders`, `./flow/merge` inside the feature, a parent's `./ep01` to its child's door, a sibling's `@features/episodes/episodes-kit` |
| `moku-game/sub-features` | sub-features | a door that misses a sub-feature folder in its imports or in `features: [...]`, an entry of `features: [...]` that is not imported from a sub-feature folder, a sub-feature door that registers another name | `features: [episodesKitFeature, ep01Feature]` imported from `./episodes-kit` and `./ep01`, `defineFeature("ep01", …)` in `features/episodes/ep01/index.ts`, a factory call `defineEpisode("ep03", …)` |
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

`layer-imports`, `feature-door` and `rules-siblings` read where an import lands; `sub-features` reads the doors of the features. A relative specifier is joined to the folder of the file. An alias goes through the tsconfig `paths`. A package lands nowhere, and no layout rule looks at it.

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
| `features/<f>/<sub>/index.ts`, the folder of a sub-feature | features | `features/<f>/<sub>` | yes |
| `features/<f>/<sub>/**` | features | `features/<f>/<sub>` | no |
| `plugins/index.ts`, `plugins/<p>/**` | plugins | as features | as features |
| `generated/**` | generated | | |
| `game.ts` | game | | |
| `tests/**` | tests | | |
| anything else: `kit.ts`, `nodes/`, `flows/`, `view/`, `web/`, `features/x.ts` | outside | | |

An importer or a target outside the layout keeps every layout rule quiet. So a game in the template layout, with no `core/`, `shared/` or `plugins/`, lints as before.

A unit of the `features` layer is a unit of `findFeatureUnits` (`src/project/features.ts`), at any depth, and a file belongs to the deepest one that holds it. A unit is a feature owner, found by folder structure: a folder of `features/`, or a folder inside an owner, not a kind folder, with a door `index.ts` and `assets/`, `assets.ts` or `strings/` of its own. Or it is a code-only sub-feature: a folder with a door that its parent's door imports from `./<folder>` and lists in `features: [...]`. A path that is not on disk, such as a file a rule checks before it exists, falls back to `features/<f>`, its top-level folder. The units are read again for every linted file, so an editor sees a new sub-feature at the next file.

A flat game lints exactly as in 0.14.12: a folder with an `index.ts` inside a feature becomes a unit only when the feature's door imports it from `./<folder>` and lists it in `features: [...]`, so a barrel folder such as `features/hud/helpers/index.ts` stays part of `hud`.

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
| a sub-feature imports a feature it lives in, its door or a file of it, by alias or by path: `@features/episodes` or `../../flow/pick` from `features/episodes/ep01/flow/` | `Door: a sub-feature does not import the feature it lives in: features/episodes/ep01 imports features/episodes. Move what they share into a sibling sub-feature, such as features/episodes/episodes-kit, and import it from its door.` The kit named is the one of the feature imported: a grandchild that imports its grandparent is sent to the grandparent's kit |
| a file of a sub-feature, not its door: `@features/episodes/ep01/flow/story`, or `./ep01/flow/story` from the parent's door | `Door: another feature is imported from its index.ts only: @features/episodes/ep01.` |
| a sibling sub-feature by relative path: `../../episodes-kit` from `features/episodes/ep01/flow/` | `Door: an import that leaves features/episodes/ep01 is written as an alias: @features/<f>, @shared, @core/<file>.` |
| two folders with one feature name | `Lint: features: the feature name "ep01" is taken by two folders: features/episodes/ep01 and features/stories/ep01. The layout rules read the top-level features only until it is fixed.`, once per file of the `features` layer; the units fall back to the top level |

Inside one feature any relative import passes, at any depth. A parent reaches the door of a sub-feature by a relative path inside its own folder, `./ep01` from its door and `../ep01` from `features/episodes/flow/pick.ts`, or by alias. A sibling sub-feature is reached by its door alias only: `@features/episodes/episodes-kit`. The barrels `features/index.ts` and `plugins/index.ts` import the doors of their layer by relative path: `export { homeFeature } from "./home"`. `core/` has no door: a relative import inside core and `@core/*` pass, a relative import out of core is reported. `@shared/rules` and the other deep aliases of `shared/` pass.

### Sub-features

`sub-features` keeps a feature's declaration and its folders equal. It reads the doors only, `**/features/**/index.{ts,tsx}`: a file whose folder is a unit (a feature owner or a code-only sub-feature). The `index.ts` of a folder the parent does not list, such as a barrel `features/hud/helpers/index.ts`, is no door, and the rule says nothing about it. A top-level door with no sub-feature folder and no `features: [...]` reports nothing, so a flat game is quiet.

```ts
// features/episodes/index.ts: imports every sub-feature from ./<folder> and lists it
import { ep01Feature } from "./ep01";
import { ep02Feature } from "./ep02";
import { episodesKitFeature } from "./episodes-kit";

export const episodesFeature = defineFeature("episodes", {
  features: [episodesKitFeature, ep01Feature, ep02Feature]
});
```

| Case | Message |
|---|---|
| a sub-feature folder with resources that the door does not import, on the door | `Sub-features: features/episodes/ep03 is a sub-feature of episodes, and this door does not import it. Import it from "./ep03" and list it in features: [...].` |
| a sub-feature imported from `./<folder>` but not listed, on the import | `Sub-features: "./ep03" is imported but not listed in features: [...]. List the sub-feature: features: [..., ep03Feature].` |
| an entry that is not a name: a spread, a call, `null` | `Sub-features: list each sub-feature by the name it is imported under from "./<folder>".` |
| a name not imported from a sub-feature folder: another feature, a kind folder (`./views`), a file (`./helpers.ts`), a folder without a door, or not imported at all | `Sub-features: features: [...] lists homeFeature, which is not imported from a sub-feature folder of episodes. A sub-feature lives in features/episodes/<name> and is imported from "./<name>".` |
| a sub-feature door whose `defineFeature` call names another feature, on the call | `Sub-features: features/episodes/ep03/index.ts registers the feature "episode3"; a sub-feature is named like its folder: "ep03".` |
| a sub-feature door with no call naming its folder | `Sub-features: the door of features/episodes/ep03 registers no feature named "ep03". A sub-feature is named like its folder: defineFeature("ep03", { … }).` |
| a code-only sub-feature that declares sub-features, in `features: [...]` or by a child folder with a door and resources | `Sub-features: features/episodes/tools has no assets/, assets.ts or strings/, so its sub-features are invisible to the scanner and the compiler. Give it a resource of its own, or move them to episodes.` |

An import counts as from `./<folder>` when its source is `./<folder>`, `./<folder>/index`, or either with `.ts`, `.tsx` or `.js`; `import type` does not count. An entry imported from a direct child folder with a door passes: the folder is a sub-feature with resources, or a code-only one exactly because this door lists it. A sub-feature door passes with any call whose first argument is its folder name as a literal, so a factory registers it too: `defineEpisode("ep03", { … })`, `kit.defineFeature("ep03", …)`.

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
// The * of @features/* crosses /: a sub-feature is reached at its door.
aliasTargetsOf("/game/tsconfig.json", "/game", "@features/episodes/ep01"); // ["/game/features/episodes/ep01/index.ts"]
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
| `root` | `layer-imports`, `feature-door`, `sub-features`, `rules-siblings`, `test-suffix` | `string` | The folder of `core/`, `shared/`, `features/`, `plugins/` and `game.ts`, relative to the directory oxlint runs in. Default `.`. A file outside it is not checked |
| `tsconfig` | `layer-imports`, `feature-door`, `rules-siblings`; `sub-features` takes it and reads no alias | `string` | The tsconfig whose `paths` name the aliases, relative to the directory oxlint runs in. Default `tsconfig.json`. One layout object fits every layout rule |
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
| `sub-features` | `**/features/**/index.{ts,tsx}` | tests |
| `test-suffix` | `**/tests/**`, `**/__tests__/**` | none |

- logic: the root `index.ts`, `**/state.ts`, `**/tables.ts`, `**/game.ts`, `**/{core,nodes,flows,rules,features,shared}/**`
- effect side: `**/{plugin,plugins}/**`. Plugins answer effects; the `schedule` effect is a timer by design
- tests: `tests/**`, `**/__tests__/**`, `**/*.{test,spec}.{ts,tsx}`

The asset keys and the names of the kind folders stay with the `moku-game-validator` agent of the moku Claude plugin. The engine's own repository still lints itself with ESLint.
