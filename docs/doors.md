# Doors for the editor

Two entries let an outside tool read a running game and, in a dev build, drive it.

The editor, MCP tools and e2e scripts reach a running game through two subpaths. Neither is on the root.

| Subpath | Exports | In a production build |
|---|---|---|
| `@moku-labs/game/inspect` | `read`, `watch`, `defineSource`, the catalogue `sources`, the types `Source`, `InputSchema`, `InputOf` | Safe. Every source only reads. The door reaches no command module, so its bundle carries no command |
| `@moku-labs/game/control` | `run`, `defineCommand`, `controlRefused`, the catalogue `commands`, the types `Command`, `Ran` | Dev only. `run` throws unless the dev flag is `true`, and a `define` of `false` drops every command body |

A source or a command is data: an id, a title, an input schema and one function. `sources` and `commands` are frozen objects keyed by a short name, so an editor registers `Object.values(sources)` and `Object.values(commands)`. Each descriptor lives in the plugin that owns its data, in that plugin's `inspect.ts` or `control.ts`; the machinery lives in `flow`, see its [README](../src/plugins/flow/README.md#doors-for-the-editor).

The dice game of the [Quick start](./quick-start.md), driven through both doors:

```ts
// dice.test.ts
import { commands, run } from "@moku-labs/game/control";
import { read, sources, watch } from "@moku-labs/game/inspect";
import { createHeadless } from "@moku-labs/game/testing";
import { it, vi } from "vitest";
import dice from "./index";

it("rolls, bookmarks and restores through the doors", async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const { app } = dice.headless({ seed: 42 });
  const game = await createHeadless(app);

  read(app, sources.position); // { path: "home", flow: "main", node: "home", waiting: ["roll", "reset"] }

  const seen: string[] = [];
  const stop = watch(app, sources.position, undefined, position => {
    seen.push(position.path);
  });
  app.time.step(16);
  seen; // ["home"]: a headless watch reads on the frames a test steps

  const walked = await run(app, commands.walk, { route: [{ at: "home", intent: "roll" }] });
  walked.value.path; // "home"
  walked.state; // { path: "home", frame: 1, tainted: false }: a walk goes through the graph
  read(app, sources.model).session; // { rolls: 1 }

  const { value: mark } = await run(app, commands.bookmark);
  await run(app, commands.restore, { bookmark: mark });
  read(app, sources.tainted); // true: a restore replaces the state outside the graph
  read(app, sources.cheats); // [{ id: "game.restore", input: { bookmark: { path: "home", ... } }, frame: 1 }]

  stop();
  await game.stop();
});
```

- **Input.** A schema maps field names to `"string"`, `"number"`, `"boolean"` or `"json"`. A kind with a trailing `?` is optional. The input may be left out when every field is optional. The descriptor function gets it typed.
- **`read(app, source, input?)`** calls the source once and returns what it reads.
- **`watch(app, source, input, fn)`** reads on the first frame, in the `signals` phase, and again when the source's change key moved: `frame` every frame, `commit` when `model.store.snapshot()` is a new object, `edge` when `flow.state()` is. It returns the stop function. It runs on the frame loop, so a headless test steps frames with `app.time.step(16)`.
- **`run(app, command, input?)`** resolves `{ value, state }`. `value` is what the command returned. `state` is the envelope `{ path, frame, tainted }`, read after the command.
- **Screen sources need the screen.** `Source` and `Command` name the app they need. `read(app, sources.locate, { key: "play" })` on an app without `ui`, `renderer` and `world` is a compile error. `game.at` needs `renderer` and `world`.

## Base sources

From `@moku-labs/game/inspect`. `Changes` is when `watch` reads the source again.

| Key in `sources` | id | Input | Changes | Reads |
|---|---|---|---|---|
| `graph` | `game.graph` | none | edge | `flow.describe()`: flows, nodes with their flags and outcomes, edges, slots |
| `position` | `game.position` | none | edge | `{ path, flow, node, waiting }` from `flow.state()`. `waiting` lists the intents the gate waits for |
| `history` | `game.history` | `{ last: "number?" }` | edge | `flow.history()`, the edges since the last checkpoint: all of them, or the last `last` |
| `tainted` | `game.tainted` | none | frame | Whether a `cheat` or `raw` command ran on this app |
| `cheats` | `game.cheats` | none | frame | The journal of `cheat` and `raw` commands, `{ id, input, frame }`, oldest first, the last 500 |
| `model` | `game.model` | none | commit | `model.store.snapshot()`: the committed `{ player, session, rng }` |
| `entities` | `game.entities` | `{ owner: "string?", component: "string?" }` | frame | `world.ecs.snapshot().entities`: all, the ones whose owner has that name, the ones that carry that component, or both |
| `projections` | `game.projections` | none | commit | Projection name to key to entity, through `world.projection.keyOf` |
| `ui` | `game.ui` | none | frame | `ui.tree()`: the live screen as plain data. Each node has `key`, `type`, `rect`, `style`, `state`, `children`; a text adds `content`, the words it draws after `tr()` and `bind`; a text field adds `value` |
| `locate` | `game.locate` | `{ key: "string?", target: "json?" }`, exactly one | frame | Where a ui element (`key`) or a view (`target: { projection, key }`) is on the page: `{ x, y, w, h }` in CSS px. Reference units while the renderer is inert; a view has no box then. `undefined` when it is not on screen |
| `render` | `game.render` | none | frame | `renderer.stats()`: `{ fps, drawn, frameMs, textures, textureMb, views, pooled, renderPasses }`, and `drawCalls` in a dev build. `drawn` is the frames really drawn per second: `fps` without `onDemand`, 0 on a screen at rest with it. `renderPasses` is 1 for the frame plus, for every view with an enabled filter, 1 for its content and the passes of its filters |
| `effects` | `game.effects` | none | frame | `effects.stats()`: `{ particles, emitters, filters, renderPasses }`. Only in a game that composes `effectsPlugin` |
| `filters` | `game.filters` | none | frame | `{ kinds, off }` of `effects.diagnostics`: every filter kind in registration order (the seven built-ins, then the `filters` of every feature) and the ones a debug switch turned off. `off` is always `[]` in a production build. Only in a game that composes `effectsPlugin` |
| `sounds` | `game.sounds` | `{ last: "number?" }` | frame | `audio.journal()`: all, or the last `last`. Empty unless `pluginConfigs.audio.journal` is above 0 |
| `audioMuted` | `game.audioMuted` | none | frame | `audio.muted("master")`: whether the whole game is muted. Only in a game that composes `audioPlugin` |
| `assets` | `game.assets` | none | frame | `assets.usage()`: `{ textureMb, budgetMb, bundles }` |
| `log` | `game.log` | `{ level: "string?" }` | frame | `log.trace()`: every entry, or the entries at `level` and above. A level other than `debug`, `info`, `warn`, `error` throws |
| `explain` | `game.explain` | `{ entity: "number" }` | frame | One entity in full: `{ id, owner, key, components, skipped, motions }`. `motions` lists the components a motion still drives. `undefined` for a stale id |
| `diff` | `game.diff` | `{ from: "number", to: "number" }` | frame | `world.ecs.diff(from, to)`: `{ from, to, entities }`, what changed between the end of frame `from` and the end of frame `to`. Dev builds only, see "Frame history" |
| `schema` | `game.schema` | none | frame | `world.ecs.schema()`: every component and tag the world met, sorted by name, with the JSON kind of each field |
| `at` | `game.at` | `{ x: "number", y: "number" }` | frame | What lies under a page point in CSS px, topmost first: `[{ entity, owner, key, layer }]`. `[]` while the renderer is inert |

## Base commands

From `@moku-labs/game/control`. Every command runs in dev builds and in debug builds, by the profile of the page (see [Turn the dev build on](#turn-the-dev-build-on)), and leaves a `moku:dev` debug entry in the log.

| Key in `commands` | id | Input | Effect | Does |
|---|---|---|---|---|
| `answer` | `game.answer` | `{ intent: "string", payload: "json?" }` | route | `flow.gate.answer({ intent, payload })`. Value: whether the gate took the answer |
| `tap` | `game.tap` | `{ key: "string?", target: "json?" }`, exactly one | route | `input.tap` on the ui element with that `key`, or on the view `target: { projection, key }`. Value: whether the gate took the answer |
| `drag` | `game.drag` | `{ from: "json", to: "json" }` | route | `input.drag(from, to)`, both `{ projection, key }`. Value: whether the gate took the answer |
| `key` | `game.key` | `{ key: "string", shift: "boolean?" }` | route | `input.pressKey(key, { shift })`. Value: whether a listener handled the key |
| `fill` | `game.fill` | `{ key: "string", value: "string" }` | route | `ui.fill(key, value)`: types into the `input` with that `key`, cut to its `maxLength`. Value: whether the field took the text |
| `walk` | `game.walk` | `{ route: "json" }` | route | `flow.walk(route)`. Value: the flow state after the walk |
| `bookmark` | `game.bookmark` | none | read | `flow.bookmark()`, plus `scene`, the mounted scene, when the app has `scenes` and a scene is mounted. While an effect that takes answers waits, the bookmark names the waiting transit node and carries `rest`. Value: the bookmark, plain JSON |
| `restore` | `game.restore` | `{ bookmark: "json?", repro: "json?" }`, exactly one | raw | `scenes.expect(bookmark.scene)` when the bookmark has a `scene`, then `flow.restore(bookmark)`. A bookmark of a waiting transit node runs that node again, and the command answers once its gate is open. Or a `/testing` repro: its state at its checkpoint, then `flow.walk(repro.route)`. Value: the flow state |
| `saveExport` | `game.saveExport` | none | read | `model.store.snapshot()`: the committed save, so a tester's progress leaves the store app. Value: `{ player, session, rng }`, plain JSON |
| `saveImport` | `game.saveImport` | `{ save: "json" }` | raw | Restores a save of `game.saveExport` at the main flow's start, the way `game.restore` restores a repro, then `model.store.flush()`, so the next start reads it. A value without `player`, `session` and `rng` throws `[game] game.saveImport needs { player, session, rng } of game.saveExport.` Value: `{ restored: true }` |
| `step` | `game.step` | `{ frames: "number", deltaMs: "number?" }` | cosmetic | `time.step(deltaMs)` `frames` times, also while paused. `deltaMs` is 1000/60 by default. Value: `time.snapshot()` |
| `pause` | `game.pause` | none | cosmetic | `lifecycle.push("devtools")`. Value: `lifecycle.isPaused()` |
| `resume` | `game.resume` | none | cosmetic | `lifecycle.pop("devtools")`. Value: `lifecycle.isPaused()`, still true while another reason holds |
| `capture` | `game.capture` | `{ legend: "boolean?", layers: "json?", sheet: "json?", diff: "json?" }` | read | `renderer.capture(options)`: `{ png, legend? }` of the canvas after the next drawn frame. `undefined` while the renderer is inert. See "Capture options" |
| `debug` | `game.debug` | `{ nineSlice: "boolean?", verifyFrames: "boolean?", kept: "boolean?" }` | cosmetic | `renderer.sync.debug.nineSlice(on)`, `renderer.sync.debug.verifyFrames(on)` and `renderer.sync.debug.kept(on)`, each field given; `{ kept: false }` alone draws every filtered view live (the A/B switch of a measurement); none answers the switches unchanged. Value: the debug switches `{ nineSlice, verifyFrames, kept }` |
| `reducedMotion` | `game.reducedMotion` | `{ on: "boolean" }` | cosmetic | `anim.setReducedMotion(on)`. Value: `anim.reducedMotion()` |
| `timeScale` | `game.timeScale` | `{ scale: "number" }` | cosmetic | `time.setScale(scale)`. A scale below 0 or not finite throws. Value: `time.snapshot()` |
| `frameRate` | `game.frameRate` | `{ fps: "number?" }` | cosmetic | `time.setRate(fps)`, or `time.setRate("auto")` without `fps`: the same screen at 120 and at 60 for an A/B run. An `fps` other than 30, 60 or 120 throws `[game] time.setRate takes "auto", 30, 60 or 120.` Value: `time.rate()` |
| `mute` | `game.mute` | `{ muted: "boolean" }` | cosmetic | `audio.mute("master", muted)`: music and sfx go silent, the stored volumes stay. Value: `audio.muted("master")`. Only in a game that composes `audioPlugin` |
| `trace` | `game.trace` | `{ path: "json" }` | route | `input.trace(path)`, a list of `{ projection, key }`. Value: whether the gate took the answer. See the [input README](../src/plugins/input/README.md) |
| `filter` | `game.filter` | `{ kind: "string", on: "boolean" }` | cosmetic | `effects.diagnostics.enable(kind)` or `disable(kind)`: from the next frame no view draws an off kind, while its instances stay and stay written. Value: `diagnostics.disabled()`, the off kinds. An unknown kind throws `[game] No filter kind "fx.nope".` with `Known: effects.glow, effects.outline, …`. Only in a game that composes `effectsPlugin`; it carries no overlay marker |

A bookmark at a popup comes back with its scene. A popup node has no `scene` of its own. It is a rest node, as the Settings popup over Home, or a transit node that waits for an effect that takes answers, as `info/show` of the mini game. In a fresh page nothing is mounted, so `game.restore` names the bookmark's `scene` first and the restored node mounts it under the popup. On a page that shows another scene the popup node replaces it with the bookmark's scene. A refused restore leaves the mounted scene as the expected one, so no later node switches to the scene of the refused bookmark. A `scene` that is not a string makes `game.restore` throw, and so does a `rest` that is not `{ path, input }`. `flow.restore` itself ignores `scene`.

A bookmark taken while an effect that takes answers waits names the waiting transit node. Such an effect is a `popup`, or a hand-written descriptor with `answers`. The bookmark carries `rest: { path, input }`, the rest point before that node. `rest` is left out when no rest node came before it: the graph started at that node, or a restore entered it. The state of the bookmark is the one committed when the node was entered: what the node wrote before its gate is not in it.

`game.restore` of such a bookmark runs the node again from its start, so its effects before the gate play again and it writes again what it wrote. The command answers once the gate is open, so `value.pending.gate` already lists the answers. The open gate is not the draw: the popup shows on the next frame. When the graph stops before the bookmark was entered, the command answers too, with the flow state as it stands, and nothing was restored. When the graph changed since the bookmark, the restore enters `rest` instead if that is a checkpoint, and logs `flow:restore-fell-back`. Otherwise it throws. A repro starts at a rest node only. Full rules: the [flow README](../src/plugins/flow/README.md#bookmark-and-restore).

```ts
// The mini game with its info popup open over Home.
const { value: atPopup } = await run(app, commands.bookmark);
atPopup.path; // "info/show": the node that waits for the popup's answer
atPopup.scene; // "home"
atPopup.rest; // { path: "home", input: null }

// A fresh page.
const { value } = await run(app, commands.restore, { bookmark: atPopup });
value.path; // "info/show"
value.pending.gate; // ["ok", "close"]
app.scenes.current(); // "home"
read(app, sources.locate, { key: "infoOk" }); // undefined: the gate is open, the popup is not drawn yet
// One frame later.
read(app, sources.locate, { key: "infoOk" }); // { x: 380, y: 827, w: 320, h: 120 } in a headless test
```

### Capture options

`png` is a PNG data URL. `legend` comes only with `legend: true`.

| Option | Shape | Does |
|---|---|---|
| `legend` | `true` | Numbers every keyed view with a drawn box. Each entry is `{ n, projection, key, rect }`, `rect` in picture pixels. A badge with `n` sits on the picture |
| `layers` | `["board", "hud"]` | Draws only these layers. An unknown name throws |
| `sheet` | `{ frames, everyMs }` | A contact sheet of 2 to 12 frames, `everyMs` apart in game time. It takes no other option but `layers` |
| `diff` | a bookmark | Red where the pixels differ from the screen of the bookmark |

`diff` is a round trip. The game must wait at a gate with no effect pending, else it throws. The command journals itself, restores the bookmark and waits for its gate, takes that picture, restores where the game stood and waits again. Then it answers the picture of now against then. Every restore reconciles in direct mode, so motions in flight when the command started are finished afterwards. Full rules: the [renderer README](../src/plugins/renderer/README.md).

```ts
const { value: mark } = await run(app, commands.bookmark);
// ... play a move ...
(await run(app, commands.capture, { diff: mark })).value; // { png: "data:image/png;base64,…" }
read(app, sources.cheats); // [{ id: "game.capture", input: { diff: { path: "home", ... } }, frame: 1 }]
```

## Frame history

A dev build keeps the last 120 frames of world changes, about 2 s at 60 fps. A production build keeps none. `game.diff` reads it.

- `from === to` answers no entity.
- A production build throws `[game] game.diff needs a dev build.`
- A frame outside the window, or `from` after `to`, throws `[game] game.diff: frame 7 is not in the history.` with the frames it keeps.

## Effects, taint and the cheat journal

| Effect | Means |
|---|---|
| `read` | Takes something out of the game and changes nothing |
| `route` | Goes through the graph or the input, the way a player does. The session stays clean |
| `cosmetic` | Changes how the game runs or looks. The session stays clean |
| `cheat` | Changes the state outside the rules. Taints the session and is journaled |
| `raw` | Replaces the state outside the graph. Taints the session and is journaled |

`run` journals a `cheat` or `raw` command as `{ id, input, frame }` before it runs, so a failing one still counts. The session and the journal belong to one app object: two apps in one process never share them. Read them with `sources.tainted` and `sources.cheats` (`game.cheats`), and in `state.tainted` of every `run`. Of the base commands `game.restore` and `game.saveImport` are `raw`; none is `cheat`. `game.capture` with `diff` journals itself as a raw write, `{ id: "game.capture", input: { diff }, frame }`. It is the one base command whose taint depends on its input.

## Turn the dev build on

`__MOKU_GAME_DEV__` is a global the engine reads and never sets. Only `true` turns the dev build on; undefined means production, and `run` throws `[game] Control commands run in dev builds only.` Two more boolean flags follow the same rules: `__MOKU_GAME_AGENT__`, the editor's page agent is on the page and measurement code runs, and `__MOKU_GAME_CONTROL__`, every command runs, the state-changing ones too. Three strings name the page: `__MOKU_GAME_BUILD__` (the build id), `__MOKU_GAME_ENGINE__` (the engine fingerprint, `0.14.12+9c41e0`, with `.patch.<hash>` when the install root patches the engine, `0.0.0+src` from the engine's sources) and `__MOKU_GAME_EDITOR__` (the `host:port` the agent of a debug page dials). The package ships their declarations, `var __MOKU_GAME_DEV__: boolean | undefined` and the rest. A game never re-declares them.

**`moku-game` sets them.** Who sets what:

| Page | DEV | AGENT | CONTROL | BUILD |
|---|---|---|---|---|
| `moku-game dev`, the editor's `preparePage`, the page of `moku-game visual` | `true` | `true` | `true` | `"dev"` |
| `moku-game build` (release) | define `"false"` | define `"false"` | define `"false"` | not set |
| `moku-game build --debug` (= `--debug=read`) | define `"false"` | define `"true"` + global | define `"false"` + global | `"debug-<stamp>"` |
| `moku-game build --debug=full` | define `"false"` | define `"true"` + global | define `"true"` + global | `"debug-full-<stamp>"` |
| a library test, `createHeadless` | undefined unless stubbed | undefined unless stubbed | undefined unless stubbed | undefined |

`__MOKU_GAME_ENGINE__` is set on the dev page and on a debug page, `__MOKU_GAME_EDITOR__` on a debug page only (`--editor`, default `127.0.0.1:47600`); a release page sets neither. `moku-game dev` defines the three flags `true` in the bunfig of the dev page, `define = { "__MOKU_GAME_DEV__" = "true", "__MOKU_GAME_AGENT__" = "true", "__MOKU_GAME_CONTROL__" = "true" }`, and its `.moku/dev.ts`, imported right after the startup mark of `.moku/main.ts`, sets the globals for code that reads `globalThis`, DEV last:

```ts
// Written by moku-game dev. Do not edit.
globalThis.__MOKU_GAME_BUILD__ = "dev";
globalThis.__MOKU_GAME_ENGINE__ = "0.0.0+src";
globalThis.__MOKU_GAME_CONTROL__ = true;
globalThis.__MOKU_GAME_AGENT__ = true;
globalThis.__MOKU_GAME_DEV__ = true;
```

A test sets a flag with `vi.stubGlobal("__MOKU_GAME_DEV__", true)`; DEV alone runs every command.

**Which commands run where.** The effect of a command decides:

| Page | `read`, `cosmetic` | `route`, `cheat`, `raw` |
|---|---|---|
| dev, a test with DEV | run | run |
| `--debug=full` | run | run |
| `--debug` | run | refused: `controlReadOnly` |
| release, a test with no flag | refused: `controlRefused` | refused: `controlRefused` |

`run` throws the read-only refusal before the command runs: `[game] The command game.tap changes the game: this debug build runs read and cosmetic commands only.` with `Build with moku-game build --debug=full to run it.` Its error carries `reason: "read-only"`, so an editor tells it apart from a failure; `controlReadOnly` and the type `ControlReadOnlyError` come from `@moku-labs/game/control`. `game.capture` with `diff` writes the state, so a `--debug` page refuses it the same way.

**A game without the shell** does the same with a bundler `define`, `true` in dev and `false` in production. Its production `define` should also set `__MOKU_GAME_AGENT__: "false"` and `__MOKU_GAME_CONTROL__: "false"`: without them the agent-guarded code stays in its bundle and never runs (larger, not wrong).

```ts
// build.ts of a game with a page of its own
const production = Bun.argv.includes("--production");

await Bun.build({
  entrypoints: ["index.html"],
  outdir: "dist",
  minify: true,
  define: {
    __MOKU_GAME_DEV__: production ? "false" : "true",
    __MOKU_GAME_AGENT__: production ? "false" : "true",
    __MOKU_GAME_CONTROL__: production ? "false" : "true"
  }
});
```

**What the `define` strips.** Every command body starts with the inline guard of its effect, never a function call (Bun does not inline across modules):

| Purpose | Inline form |
|---|---|
| Agent-only code, positive branch (measurement) | `if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) { … }` |
| Dev or agent, positive branch | `if ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) \|\| (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) { … }` |
| A `read` or `cosmetic` command body (the agent form) | `if ((typeof __MOKU_GAME_DEV__ === "undefined" \|\| !__MOKU_GAME_DEV__) && (typeof __MOKU_GAME_AGENT__ === "undefined" \|\| !__MOKU_GAME_AGENT__)) throw controlRefused();` |
| A `route`, `cheat` or `raw` command body (the control form) | `if ((typeof __MOKU_GAME_DEV__ === "undefined" \|\| !__MOKU_GAME_DEV__) && (typeof __MOKU_GAME_CONTROL__ === "undefined" \|\| !__MOKU_GAME_CONTROL__)) throw controlRefused();` |

The DEV term stays in every command form, so a game's test that stubs only `__MOKU_GAME_DEV__` runs every command. A `define` of `false` folds the condition, and the minifier drops the body behind it; a flag must be a boolean to fold, a string value does not. [`tests/integration/doors-build.test.ts`](../tests/integration/doors-build.test.ts) proves it with a minified Bun build of each door: with the three flags `false` no command body of `/control` is left, with AGENT `true` and CONTROL `false` exactly the `read` and `cosmetic` bodies are there, with both `true` every body, and an `/inspect` bundle carries no command id at all. The descriptors stay, so an editor can still list the commands. Without a `define` the bodies stay in the bundle, and `run` still refuses them while the flag is undefined.

## A game's own sources and commands

`defineSource` and `defineCommand` take the same shape as the base catalogue. The id is camelCase words joined by dots, at least two (`dice.rolls`); any other id throws. Keep them in `.dev` modules that only the dev page, a debug page and the tests import, so a production bundle never reaches them. `moku-game build` imports none. The dev page of the editor (`preparePage` with agents) and a debug page (`moku-game build --debug`) import every `**/*.dev.ts` of the game and hand them to the agents. `defineCommand` adds no guard: a command writes the inline guard itself, because Bun does not inline a guard function across modules. A command with the `__MOKU_GAME_DEV__` guard alone, as the two below, runs in dev and is refused on a debug page; a `.dev` command that should run on a debug page writes the guard of its effect from [Turn the dev build on](#turn-the-dev-build-on): the agent form for `read` and `cosmetic`, the control form for the others.

```ts
// dice.dev.ts
import { controlRefused, defineCommand } from "@moku-labs/game/control";
import { defineSource } from "@moku-labs/game/inspect";
import type dice from "./index";

export const rolls = defineSource({
  id: "dice.rolls",
  title: "Rolls",
  input: {},
  changes: "commit",
  read: (app: ReturnType<typeof dice.headless>["app"]) => app.model.store.snapshot().session
});

export const rollTwice = defineCommand({
  id: "dice.rollTwice",
  title: "Roll twice",
  input: {},
  effect: "route",
  run: app => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
    return app.flow.walk([{ at: "home", intent: "roll" }, { at: "home", intent: "roll" }]);
  }
});

export const giveCoins = defineCommand({
  id: "dice.giveCoins",
  title: "Give coins",
  input: { coins: "number" },
  effect: "cheat",
  run: (app, { coins }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
    return app.flow.restore({ ...app.flow.bookmark(), player: { coins, lastRoll: 0 } });
  }
});

// On a fresh headless game, before any frame:
// (await run(app, rollTwice)).state; // { path: "home", frame: 0, tainted: false }
// read(app, rolls); // { rolls: 2 }
// (await run(app, giveCoins, { coins: 100 })).state.tainted; // true
// read(app, sources.cheats); // [{ id: "dice.giveCoins", input: { coins: 100 }, frame: 0 }]
```

### Overlay commands

The editor's overlay on a debug page has no buttons of its own: it lists the commands a game marked with `overlay`.
`overlay: "toggle"` draws a switch: the input is exactly `{ on: "boolean" }`, and `value(app)` answers the switch's
state; the overlay runs it with `{ on: !value(app) }`. `overlay: "button"` draws a button: no required input and no
`value`; the overlay runs it with `{}`. Any other combination does not compile. An overlay command is still a door
command: its body starts with the guard of its effect, and the editor greys out a `route`, `cheat` or `raw` one while
`__MOKU_GAME_CONTROL__ !== true`. The engine's own commands carry no marker.

```ts
// features/ward/glow.dev.ts — the overlay's "Glow" switch of this game, on top of game.filter's call.
import type { Effects } from "@moku-labs/game";
import { controlRefused, defineCommand } from "@moku-labs/game/control";

export const glowSwitch = defineCommand({
  id: "ward.glow",
  title: "Glow",
  input: { on: "boolean" },
  effect: "cosmetic",
  overlay: "toggle",
  value: (app: { readonly effects: Effects.EffectsApi }) =>
    !app.effects.diagnostics.disabled().includes("effects.glow"),
  run: (app, { on }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }
    return on ? app.effects.diagnostics.enable("effects.glow") : app.effects.diagnostics.disable("effects.glow");
  }
});
// The overlay draws a switch "Glow", on; a tap runs it with { on: false } and the next frame draws no glow.
```
