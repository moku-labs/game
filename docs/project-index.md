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

## The API

```ts
import { openProject } from "@moku-labs/game/project";

const project = await openProject({ root: "tests/integration/merge-game" });

project.index.revision;                        // sha1 over the sorted per-file hashes

await project.find("node:board/merge");
// [{ path: "nodes/merge.ts", binding: "merge", line: 17, range: [17, 1, 38, 4], hash: "…" }]

await project.find("jsx:settingsBoard");
// [{ path: "features/settings/settings.tsx", key: "settingsBoard", kind: "idProp",
//    component: "Signboard", line: 301, range: [300, 7, 321, 19], hash: "…" }, …]

const stop = project.watch((index, change) => refresh(index, change));
await project.changed("nodes/merge.ts");       // a caller with its own file watcher
stop();
project.close();
```

| Member | What it does |
|---|---|
| `openProject({ root, manifest?, debounceMs? })` | Checks the root, loads TypeScript, parses every source file, builds the index. Rejects when the root is missing or not a directory, naming the path |
| `index` | The current index. Frozen. A watch batch or `changed` replaces it |
| `find(key)` | The places of a key, with lines read from disk now. `[]` for an unknown key |
| `watch(onIndex)` | Calls back once per batch that changed the index, with `(index, change)`. Returns the stop function |
| `changed(path)` | Re-indexes one root-relative path now and resolves with the new index. Does not call the watch callers |
| `close()` | Stops the watcher and drops every caller. `find` and `changed` keep working; `watch` throws |

The root is always explicit: `root` or `--root`. Nothing is inferred from the working directory. The manifest defaults to `manifest.json` at the root, the asset scanner's default; `index.manifest` is set only when that file exists.

## The index

```ts
type ProjectIndex = {
  schemaVersion: 1;
  revision: string;          // sha1 hex over the sorted lines `${path}\0${hash}\n`
  manifest?: string;         // root-relative, when the file exists
  symbols: Record<string, { def: Anchor[]; uses?: Anchor[]; conflict?: true }>;
  files: Record<string, { hash: string; state: "ok" | "broken"; error?: string }>;
  unresolved: { path: string; reason: string }[];
};

type Anchor = {
  path: string;              // root-relative, POSIX
  binding?: string;          // the const, function or export the definition is bound to
  key?: string;              // a text style key, the `name` of a projection, a JSX key
  component?: string;        // JSX: the component of an `id=` prop, or of an `{id}` pattern
  kind?: "literal" | "template" | "idProp" | "ident";   // JSX only
  stem?: string;             // JSX templates and identifiers: "card" for card*Picture
};
```

A file hash is the sha1 hex of its bytes, the same value the editor uses as a file version.

## Keys

| Key | Example in merge-game | Defined by | `find` answers |
|---|---|---|---|
| `flow:<id>` | `flow:board` | `defineFlow("board", …)` | the declaration, `flows/board.ts:21` |
| `node:<flow>/<node>` | `node:board/merge` | an entry of the flow's `nodes` table | the declaration of the node, `nodes/merge.ts:17` |
| `feature:<id>` | `feature:home` | `defineFeature("home", …)` | the declaration |
| `scene:<id>` | `scene:home` | `defineScene("home", …)` | the declaration, `features/home/scene.ts:8` |
| `projection:<name>` | `projection:board.items` | `projection({ name: "board.items", … })` | the `name` property, `view/projections.ts:179` |
| `emitter:<id>` | `emitter:fx.stars` | `defineEmitter("fx.stars", …)` | the declaration |
| `textStyle:<key>` | `textStyle:ui.title` | a key of `defineTextStyles({ … })` | the property, `features/ui/styles.ts:39` |
| `style:<path>#<binding>` | `style:features/ui/popup.tsx#popupScreen` | `const popupScreen = defineStyle(…)` at module scope | the declaration, `features/ui/popup.tsx:20` |
| `jsx:<key>` | `jsx:settingsBoard` | a JSX `key`, or a literal `id=` on a component | the attribute line, the element as the range |

- **Definers are recognised by binding.** The names destructured from `defineGame()` in the kit are the definers, under any local name an importer gives them. The definers imported from `@moku-labs/game` directly count too. A call whose callee is not a definer binding is not a definition.
- **Nothing is guessed.** A definer with a non-literal id goes to `unresolved` with the reason, for example `defineFlow id is not a string literal`.
- **Nodes.** Every entry of a `nodes` table is a key, as `Object.entries(flow.nodes)` lists it at run time: a node, a sub-flow and a slot alike. A plain name is followed through relative imports, re-exports and barrels to the file that declares it, and the flow table is its use. A slot or an inline node is anchored at the table. A name that cannot be followed is anchored at the table and listed as unresolved.
- **Uses.** A node's `uses` is the flow table that names it. A style's `uses` are the files that import its binding. One level, no transitive closure.
- **Conflict.** A key other than `jsx:` defined twice sets `conflict: true` and keeps both anchors. `jsx:` keys repeat across files by design.
- **Files.** `**/*.{ts,tsx}` under the root, without `node_modules`, `dist`, `generated`, `.moku`, `.git`, `__tests__`, `tests` and `*.{test,spec}.{ts,tsx}`. Symlinks are not followed.

## JSX keys

Every JSX `key` attribute is reduced to a pattern. Literal text stays. An expression is followed through same-file `const` initializers and same-file functions that return one expression, with their parameters bound to the arguments. The `id` of a parameter object (`props.id`, or a destructured `{ id }`) becomes `{id}`; any other hole becomes `*`.

| Written | Key | Kind | Stem |
|---|---|---|---|
| `key="hudRow"` | `jsx:hudRow` | `literal` | |
| `` key={`${id}Picture`} `` with `const id = cardKey(card.slot)` and `cardKey` returning `` `card${slot}` `` | `jsx:card*Picture` | `template` | `card` |
| `key={id}` with the same `id` | `jsx:card*` | `ident` | `card` |
| `` key={`${props.id}Close`} `` in `Signboard` | `jsx:{id}Close` | `template` | |
| `id="settingsBoard"` on `<Signboard>` | `jsx:settingsBoard` | `idProp` | |
| `key={entry.key}` | none: `*` alone goes to `unresolved` | | |

An `{id}` pattern written in a component carries that component's name, so it only takes the `id=` props of that component. One written in a lower-case helper takes any.

`find` on a key the game reports at run time (what `game.locate` names, such as `jsx:settingsBoardClose` or `jsx:card2Picture`) answers in three tiers:

1. The exact `jsx:` entries.
2. Each `{id}` pattern whose filled form reads as the key, with `{id}` set to an indexed `id=` prop: the pattern and the prop both answer. `jsx:settingsBoardClose` answers `features/ui/kit.tsx:844` (`{id}Close`) and `features/settings/settings.tsx:301` (the `idProp`).
3. Each `*` pattern matched as a wildcard. `jsx:card2Picture` answers `card*Picture` before `card*`: within a tier, the pattern with more literal text comes first.

A key that holds `*` or `{id}` itself is looked up exactly.

## Behaviour

1. **Lines come from disk.** `find` reads each file, compares its sha1 with the indexed hash and parses it again when they differ. The index and `index.files[path].hash` stay as they are, so the next watch batch still sees the change and calls `onIndex`.
2. **Lines and columns are 1-based.** The end column of `range` is exclusive. A binding answers its declaration statement; a text style key, a projection `name` and a slot answer their property; a JSX key answers the line of its attribute with the whole element as the range.
3. **Events only trigger a walk.** `watch` runs one `fs.watch(root, { recursive: true })` per handle; where the platform cannot watch recursively, one watcher per folder, re-armed after each walk. Events in skipped folders are ignored. A batch closes after a quiet period of `debounceMs` (75 by default) or after the longest wait, ten quiet periods and at least one second, during an endless burst. The batch walks the root, hashes every file whose size, inode or time stamps moved and every new file, and drops the vanished ones. Event paths are never trusted: Bun on macOS reports every edit as `rename`, drops the destination of a move and names the `.tmp` of an atomic save. The platform watcher can also miss a write made as it starts, so a handle walks once when watching starts (for what changed since the index was built) and then every two seconds as a backstop.
4. **One call per batch.** A batch that changed bytes calls every caller once with the new index and a `ProjectChange`. A save with the same bytes calls nobody. An error thrown by a caller is dropped, so the other callers still hear the batch.
5. **Moves and deletes.** `change.moved` lists a key that left one file and appeared in another in the batch; `change.removed` lists the keys gone from every file. `change.files` lists the paths whose bytes changed, appeared or vanished.
6. **Broken files keep their keys.** A file whose parse has errors keeps its last good entries. `files[path]` becomes `{ state: "broken", error: "<path>:<line>:<col> <message>" }`, and `find` on its keys answers from the last good parse with `broken: true`. A file broken from its first parse has no entries and one `unresolved` item.
7. **Paths stay inside the root.** Paths in and out are root-relative POSIX. Every read resolves against the real root with `realpath`. A path that leaves the root, by `..`, as an absolute path or by a symlink, is refused with an error naming it.
8. **In process.** No worker, no persisted file, no network. One update runs at a time.

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
moku-game-index --root tests/integration/merge-game where node:board/merge
# nodes/merge.ts:17
moku-game-index --root tests/integration/merge-game where jsx:settingsBoardClose
# features/ui/kit.tsx:844
# features/settings/settings.tsx:301
moku-game-index --root tests/integration/merge-game --json
moku-game-index --root tests/integration/merge-game --check
#   › 111 files, 316 keys: 0 broken, 0 in conflict, 16 unresolved.
#   › unresolved features/ui/kit.tsx: defineStyle in "plankStyle" is not bound to a module-level const
```

| Command | Prints | Exit |
|---|---|---|
| `--json` | The index, pretty, 2 spaces | 0 |
| `where <key>` | One `<path>:<line>` per place, ` (broken)` for a last good parse | 1 and a message for an unknown key |
| `--check` | A summary, every broken file and conflict as an error, every unresolved item as info | 1 on a broken file or a conflict; unresolved items never fail |

- `--root <dir>` is required. `--manifest <path>` is root-relative.
- Output goes through the branded console of `@moku-labs/common/cli`.
- The same CLI runs from source: `bun src/project.ts --root <dir> where <key>`.

## Cost on merge-game

111 files. A full `openProject`, the TypeScript load included, takes about 150 ms. `find` on an unchanged file takes under 5 ms. The integration test logs both and holds them under 1000 ms and 20 ms.
