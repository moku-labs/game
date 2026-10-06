# Project index

Where is this defined, right now? `@moku-labs/game/project` answers that for every engine id of a game, with a line that is fresh at the moment of the question.

The editor and agents need to know where a game's code lives while agents keep editing files. The index parses the game's sources with the TypeScript parser and maps every engine id to an **anchor**: a path plus a binding, a key or a component. The index never stores a line number. `find` reads the line from the file as it is on disk at the call. Nothing is written to disk; the running game carries no source data.

The entry is node and bun only. It is a tooling entry like `/assets` and `/lint`, not a plugin: no `createApp`, no lifecycle, no events.

## Setup

`typescript` is an optional peer (`>=5.5`). A game that uses the index has it as a dev dependency:

```bash
bun add -d typescript
```

It is loaded by a dynamic import on the first `openProject`. Without it `openProject` rejects with `[game] The project index needs the "typescript" package.`

A game that imports through tsconfig `paths`, as the v15 layout does with `@core/kit` and `@features/home`, needs nothing more: the index reads `tsconfig.json` at the root. See [Aliases](#aliases).

## The API

```ts
import { openProject } from "@moku-labs/game/project";

const project = await openProject({ root: "tests/fixtures/mini-game" });

project.index.revision;                        // sha1 over the sorted per-file hashes

await project.find("node:infoPopup/count");
// [{ path: "nodes/count.ts", binding: "count", line: 7, range: [7, 1, 14, 4], hash: "…" }]

await project.find("jsx:infoPanel");
// [{ path: "features/info/popup.tsx", key: "infoPanel", kind: "idProp",
//    component: "Panel", prop: "id", line: 79, range: [79, 7, 82, 15], hash: "…" }, …]

await project.find("component:Panel");
// [{ path: "features/info/popup.tsx", binding: "Panel", line: 62, range: [62, 1, 69, 2], hash: "…" }]
project.index.symbols["component:Panel"].uses;
// [{ path: "features/info/popup.tsx", binding: "Panel" }]

const stop = project.watch((index, change) => refresh(index, change));
await project.changed("nodes/count.ts");       // a caller with its own file watcher
stop();
project.close();
```

| Member | What it does |
|---|---|
| `openProject({ root, manifest?, tsconfig?, debounceMs? })` | Checks the root, loads TypeScript, reads the tsconfig aliases, parses every source file, builds the index. Rejects when the root is missing or not a directory, when the manifest or the tsconfig path leaves the root, and when the tsconfig does not parse, naming the path |
| `index` | The current index. Frozen. A watch batch or `changed` replaces it |
| `find(key)` | The places of a key, with lines read from disk now. `[]` for an unknown key |
| `watch(onIndex)` | Calls back once per batch that changed the index, with `(index, change)`. Returns the stop function |
| `changed(path)` | Re-indexes one root-relative path now and resolves with the new index. The tsconfig, or a file it extends, reads the aliases again. Does not call the watch callers |
| `close()` | Stops the watcher and drops every caller. `find` and `changed` keep working; `watch` throws |

The root is always explicit: `root` or `--root`. Nothing is inferred from the working directory. The manifest defaults to `manifest.json` at the root, the asset scanner's default; `index.manifest` is set only when that file exists. The tsconfig defaults to `tsconfig.json` at the root; `index.tsconfig` is set only when that file exists and holds `paths`.

## The index

```ts
type ProjectIndex = {
  schemaVersion: 1;
  revision: string;          // sha1 hex over the sorted lines `${path}\0${hash}\n`
  manifest?: string;         // root-relative, when the file exists
  tsconfig?: string;         // root-relative, when the file exists and holds `paths`
  symbols: Record<string, { def: Anchor[]; uses?: Anchor[]; conflict?: true }>;
  files: Record<string, { hash: string; state: "ok" | "broken"; error?: string }>;
  unresolved: { path: string; reason: string }[];
};

type Anchor = {
  path: string;              // root-relative, POSIX
  binding?: string;          // the const, function or export the definition is bound to
  key?: string;              // a text style key, the `name` of a projection, a JSX key, the property of a built style
  component?: string;        // JSX: the component of a key-carrying prop, or of a `{id}` / `{amountKey}` pattern
  kind?: "literal" | "template" | "idProp" | "ident";   // JSX only
  stem?: string;             // JSX templates and identifiers: "card" for card*Picture
  prop?: string;             // JSX idProp: the prop the value sits on, "id" or "amountKey"
};
```

A file hash is the sha1 hex of its bytes, the same value the editor uses as a file version.

## Keys

The examples are keys of the engine's own fixture, `tests/fixtures/mini-game/`, with the lines `find` answers there. The mini game builds no style in a function without a property, so that row names a file of a bigger game and no line.

| Key | Example | Defined by | `find` answers |
|---|---|---|---|
| `flow:<id>` | `flow:main` | `defineFlow("main", …)` | the declaration, `flows/main.ts:9` |
| `node:<flow>/<node>` | `node:infoPopup/count` | an entry of the flow's `nodes` table | the declaration of the node, `nodes/count.ts:7` |
| `feature:<id>` | `feature:home` | `defineFeature("home", …)` | the declaration |
| `scene:<id>` | `scene:home` | `defineScene("home", …)` | the declaration, `features/home/scene.ts:8` |
| `projection:<name>` | `projection:home.screen` | `projection({ name: "home.screen", … })` | the `name` property, `features/home/view.tsx:21` |
| `emitter:<id>` | `emitter:fx.spark` | `defineEmitter("fx.spark", …)` | the declaration, `features/info/effects.ts:8` |
| `textStyle:<key>` | `textStyle:ui.counter` | a key of `defineTextStyles({ … })` | the property, `features/home/styles.ts:16` |
| `style:<path>#<binding>` | `style:features/info/popup.tsx#popupScreen` | `const popupScreen = defineStyle(…)` at module scope | the declaration, `features/info/popup.tsx:11` |
| `style:<path>#<function>` | `style:features/ui/kit.tsx#boardStyle` | a `defineStyle(…)` call anywhere inside a module-level function or function-valued const | every style call of the function, the call as the range |
| `style:<path>#<function>.<property>` | `style:features/home/styles.ts#roundStylesOf.disc` | a `defineStyle(…)` call that is the value of the property `disc` inside that function | the property, the call as the range, `features/home/styles.ts:38` |
| `component:<Name>` | `component:Panel` | in a `.tsx` file, a module-level `function Panel(…)`, `const Name = (…) => …` or `const Name = function …` with an upper-case name, exported or not; anywhere, `defineComponent("InfoPopup", …)` | the declaration, `features/info/popup.tsx:62`; `component:InfoPopup` answers `features/info/popup.tsx:74` |
| `jsx:<key>` | `jsx:infoPanel` | a JSX `key`, or a literal key-carrying prop on a component (`id=`, `amountKey=`) | the attribute line, the element as the range |

- **Definers are recognised by binding.** The names destructured from `defineGame()` in the kit are the definers, under any local name an importer gives them. The definers imported from `@moku-labs/game` directly count too. A call whose callee is not a definer binding is not a definition.
- **Nothing is guessed.** A definer with a non-literal id goes to `unresolved` with the reason, for example `defineFlow id is not a string literal`.
- **Nodes.** Every entry of a `nodes` table is a key, as `Object.entries(flow.nodes)` lists it at run time: a node, a sub-flow and a slot alike. A plain name is followed through relative imports, tsconfig `paths`, re-exports and barrels to the file that declares it, and the flow table is its use. A slot or an inline node is anchored at the table. A name that cannot be followed is anchored at the table and listed as unresolved; when it is imported through an alias that names no file, the reason names that alias.
- **Style factories.** A `defineStyle` call that is not the value of a module-level const is keyed by the module-level function it sits in, at any depth: inner arrows and callbacks count. Several calls in one function share one key and one anchor `{ path, binding: "<function>" }`; a call under an object property gets `key: "<property>"` and its own key. A call in a class, in an object const (`const table = { disc: defineStyle(…) }`) or at module scope outside any function stays `unresolved`.
- **Components.** A plain upper-case function of a `.ts` file, a SCREAMING_CASE constant and a lower-case function are not components. A `defineComponent` key takes the literal id and is bound to its const: `const Foo = defineComponent("Bar", …)` makes `component:Bar` with `binding: "Foo"`.
- **Uses.** A node's `uses` is the flow table that names it. A style's `uses` are the files that import its binding. A component's `uses` are the files that render its binding, `<Foo …>` or `<ui.Foo …>` (the last segment of a member tag counts), one `{ path, binding }` per file, sorted by path. One level, no transitive closure.
- **Conflict.** A key other than `jsx:` defined twice sets `conflict: true` and keeps both anchors: two components of one name in two files are a conflict. `jsx:` keys repeat across files by design.
- **Files.** `**/*.{ts,tsx}` under the root, without `node_modules`, `dist`, `generated`, `.moku`, `.git`, `__tests__`, `tests` and `*.{test,spec}.{ts,tsx}`. Symlinks are not followed.

## Aliases

The index follows an import through the `compilerOptions.paths` of the game's tsconfig, as TypeScript does. A v15 game reaches its kit as `@core/kit`, a feature as `@features/home` and the shared layer as `@shared`; every definer, node, feature and text style behind those imports is in the index.

- **Which file.** `tsconfig.json` at the root, or the root-relative path of `tsconfig` / `--tsconfig`. A path that leaves the root is refused by name. A missing file, or one without `paths`, means no aliases: every import that is not relative is a package, as before.
- **How it is read.** TypeScript parses the file, comments and trailing commas included, and merges its `extends` chain. A file that does not parse rejects `openProject` with `[game] The tsconfig "tsconfig.json" does not parse: tsconfig.json:3:1 '}' expected.`
- **Where targets point.** Against `baseUrl` when it is set, else against the folder of the config that declares `paths`, as TypeScript does: the root for `tsconfig.json`, the folder of the extended config when that config holds the block. A target outside the root never names an indexed file.
- **Matching.** A key without `*` that equals the specifier wins. Else the `*` key with the longest prefix, its `*` filled into each target. Each target is tried as written, then with `.ts`, `.tsx`, `/index.ts` and `/index.tsx`; the first file the index holds wins. A key or a target with two `*` is ignored, as in TypeScript.
- **The engine stays a package.** `@moku-labs/game` and its subpaths are never matched, even when `paths` maps them, so its definers keep counting.

```jsonc
// tests/fixtures/layout-game/tsconfig.json, three of its eight keys
"paths": {
  "@core/*": ["./core/*"],                       // @core/kit      -> core/kit.ts
  "@shared": ["./shared/index.ts"],              // @shared        -> shared/index.ts
  "@features/*": ["./features/*/index.ts"]       // @features/home -> features/home/index.ts
}
```

## JSX keys

Every JSX `key` attribute is reduced to a pattern. Literal text stays. An expression is followed through same-file `const` initializers and same-file functions that return one expression, with their parameters bound to the arguments.

A **key-carrying prop** is `id`, or a prop whose name ends in `Key` (`amountKey`, `unitKey`). This is a convention: a component that keys an element from a prop names that prop so. A key-carrying prop of a parameter object (`props.id`, `props.amountKey`, or a destructured `{ id }`) becomes a hole of its name, `{id}` or `{amountKey}`; any other hole becomes `*`, `props.tab` too. On a component, a key-carrying prop with a string literal value is indexed as an `idProp` entry with `prop` set to its name. Other props (`title=`, `picture=`) are not indexed.

| Written | Key | Kind | Stem |
|---|---|---|---|
| `key="counter"` | `jsx:counter` | `literal` | |
| `` key={`${id}Picture`} `` with `const id = cardKey(card.slot)` and `cardKey` returning `` `card${slot}` `` | `jsx:card*Picture` | `template` | `card` |
| `key={id}` with the same `id` | `jsx:card*` | `ident` | `card` |
| `` key={`${props.id}Spark`} `` in `Panel` | `jsx:{id}Spark` | `template` | |
| `key={props.id}` in `Panel` | `jsx:{id}` | `ident` | |
| `key={props.amountKey}` in `Amount` | `jsx:{amountKey}` | `ident` | |
| `id="infoPanel"` on `<Panel>` | `jsx:infoPanel` | `idProp` | |
| `amountKey="giftReward"` on `<Amount>` | `jsx:giftReward` | `idProp` | |
| `key={entry.key}` | none: `*` alone goes to `unresolved` | | |

A pattern with a prop hole written in a component carries that component's name, so it only takes the props of that component. One written in a lower-case helper takes any. A hole takes only the props of its own name: `{amountKey}` is filled by `amountKey=`, never by `id=`.

The lint rule `moku-game/static-keys` reports the key shapes this reading cannot follow, such as `tabKeys[props.tab]` or `a ?? b`. See [Lint for games](./lint.md).

`find` on a key the game reports at run time (what `game.locate` names, such as `jsx:infoPanelSpark` or `jsx:card2Picture`) answers in three tiers:

1. The exact `jsx:` entries.
2. Each pattern with a prop hole whose filled form reads as the key, with the hole set to an indexed literal prop of the same name: the pattern and the prop both answer. In the mini game `jsx:infoPanelSpark` answers `features/info/popup.tsx:65` (`{id}Spark`) and `features/info/popup.tsx:79` (the `idProp`). A literal prop is an exact entry of its own: `jsx:giftRewardUnit` answers `unitKey="giftRewardUnit"` first, then the `{unitKey}` pattern it fills.
3. Each `*` pattern matched as a wildcard. `jsx:card2Picture` answers `card*Picture` before `card*`: within a tier, the pattern with more literal text comes first.

A key that holds `*` or a prop hole such as `{id}` itself is looked up exactly.

## Behaviour

1. **Lines come from disk.** `find` reads each file, compares its sha1 with the indexed hash and parses it again when they differ. The index and `index.files[path].hash` stay as they are, so the next watch batch still sees the change and calls `onIndex`.
2. **Lines and columns are 1-based.** The end column of `range` is exclusive. A binding answers its declaration statement; a text style key, a projection `name` and a slot answer their property; a style built in a function answers each of its style calls, with the call as the range, and one under a property answers that property, with the call as the range; a JSX key answers the line of its attribute with the whole element as the range.
3. **Events only trigger a walk.** `watch` runs one `fs.watch(root, { recursive: true })` per handle; where the platform cannot watch recursively, one watcher per folder, re-armed after each walk. Events in skipped folders are ignored. A batch closes after a quiet period of `debounceMs` (75 by default) or after the longest wait, ten quiet periods and at least one second, during an endless burst. The batch walks the root, hashes every file whose size, inode or time stamps moved and every new file, and drops the vanished ones. Event paths are never trusted: Bun on macOS reports every edit as `rename`, drops the destination of a move and names the `.tmp` of an atomic save. The platform watcher can also miss a write made as it starts, so a handle walks once when watching starts (for what changed since the index was built) and then every two seconds as a backstop.
4. **One call per batch.** A batch that changed bytes calls every caller once with the new index and a `ProjectChange`. A save with the same bytes calls nobody. An error thrown by a caller is dropped, so the other callers still hear the batch.
5. **Moves and deletes.** `change.moved` lists a key that left one file and appeared in another in the batch; `change.removed` lists the keys gone from every file. `change.files` lists the paths whose bytes changed, appeared or vanished.
6. **Broken files keep their keys.** A file whose parse has errors keeps its last good entries. `files[path]` becomes `{ state: "broken", error: "<path>:<line>:<col> <message>" }`, and `find` on its keys answers from the last good parse with `broken: true`. A file broken from its first parse has no entries and one `unresolved` item.
7. **Paths stay inside the root.** Paths in and out are root-relative POSIX. Every read resolves against the real root with `realpath`. A path that leaves the root, by `..`, as an absolute path or by a symlink, is refused with an error naming it.
8. **In process.** No worker, no persisted file, no network. One update runs at a time.
9. **A tsconfig change rebuilds.** A batch also checks the stamps of the tsconfig and of every file it extends inside the root. When one moved, appeared or vanished, the aliases are read again; when names now follow them elsewhere, the index is rebuilt and `change.files` lists the tsconfig. A comment or a save with the same `paths` changes nothing. While the tsconfig does not parse, the last good aliases stay and the source files keep updating. `changed("tsconfig.json")` does the same for a caller with its own file watcher.

```ts
type ProjectChange = {
  revision: string;
  files: string[];
  moved: { key: string; from: string; to: string }[];
  removed: string[];
};

type Found = Anchor & {
  line: number;
  range: [startLine: number, startColumn: number, endLine: number, endColumn: number];
  hash: string;              // sha1 of the bytes the line was read from
  broken?: true;             // the file does not parse now; the last good parse answered
};
```

## The command line

The package bin `moku-game-index` opens the project of `--root` and runs one command.

```bash
moku-game-index --root tests/fixtures/mini-game where node:infoPopup/count
# nodes/count.ts:7
moku-game-index --root tests/fixtures/mini-game where component:Panel
# features/info/popup.tsx:62
moku-game-index --root tests/fixtures/mini-game where jsx:infoPanelSpark
# features/info/popup.tsx:65
# features/info/popup.tsx:79
moku-game-index --root tests/fixtures/mini-game --json
moku-game-index --root tests/fixtures/mini-game --check
#   › 21 files, 35 keys: 0 broken, 0 in conflict, 0 unresolved.
moku-game-index --root tests/fixtures/layout-game --check
#   › 16 files, 12 keys: 0 broken, 0 in conflict, 0 unresolved.
#   › aliases: tsconfig.json, 8 patterns
moku-game-index --root tests/fixtures/layout-game where node:main/home
# features/home/flow/home.ts:3
```

| Command | Prints | Exit |
|---|---|---|
| `--json` | The index, pretty, 2 spaces | 0 |
| `where <key>` | One `<path>:<line>` per place, ` (broken)` for a last good parse | 1 and a message for an unknown key |
| `--check` | A summary, the aliases line, every broken file and conflict as an error, every unresolved item as info | 1 on a broken file or a conflict; unresolved items never fail |

- `--root <dir>` is required. `--manifest <path>` and `--tsconfig <path>` are root-relative.
- The aliases line of `--check` names the tsconfig and how many keys of `paths` it holds: `aliases: tsconfig.json, 8 patterns`. A tsconfig without `paths` prints `aliases: none (no tsconfig paths)`; a root without a tsconfig prints no line.
- Output goes through the branded console of `@moku-labs/common/cli`.
- The same CLI runs from source: `bun src/project.ts --root <dir> where <key>`.

## Cost on the mini game

21 files. A full `openProject`, the TypeScript load included, takes about 120 ms. `find` on an unchanged file takes under 2 ms. `tests/integration/project-mini-game.test.ts` logs both and holds them under 5000 ms and 200 ms, loose on purpose for a slow CI box. The merge game in [moku-labs/demos](https://github.com/moku-labs/demos) is a bigger game to measure on.

The layout game, `tests/fixtures/layout-game/`, has 16 files and 8 aliases; reading the tsconfig adds one parse of a small JSON file, and `openProject` with the TypeScript load stays at about 120 ms.
