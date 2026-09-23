# flow

> Very Complex plugin — the deterministic business-logic graph of a game: edge tables are data, nodes are small functions with plain `await` bodies, exactly one node is active, state commits only on edges, and a rest-to-rest transition is a transaction.

Position is data — node id, input and state — which is what gives checkpoints, rollback, fast
walk, bookmarks, inspection and hot reload. Five modules do the work and the plugin root composes
them: `runner` owns the one loop, `gate` is the single entry of player answers, `inbox` holds world
events, `fx` is the gateway to everything that is not logic, `features` is the registry of what the
game brings.

The runner's methods sit on the plugin root, the other four modules stay grouped:

```ts
app.flow.run();                              // runner
app.flow.gate.answer({ intent: "play" });    // gate
app.flow.inbox.post({ type: "purchased" });  // inbox
app.flow.fx.handle("sfx", playSound);        // fx
app.flow.features.all();                     // features
```

Only the public half of each module reaches the root. `gate.open`, `inbox.take`, `fx.run` and
`features.seal` are injected into the runner and stay there.

## API

| Method | Behaviour |
|---|---|
| `run(): Promise<void>` | Validates the graph, seals `features`, loads the save and enters `mainFlow.start`. Called once, by the consumer's `onStart`. Rejects on a fatal error; resolves when `onStop` aborts the loop. |
| `onEnter(stage, fn): () => void` | Registry for the plugins above: `assets` preloads at `"load"`, `scenes` switches at `"scene"`. The callback gets `NodeInfo`, which carries `scene` when the node was defined with `defineNode({ scene: "board", ... })`; a game that passes `scenes: "home" | "board"` to `defineGame` gets the id checked by the compiler. A node without `scene` keeps the current scene; an `over` node must not name one. |
| `walk(route, options?): Promise<FlowState>` | Fast walk: every node's logic runs for real, effects answer instantly, `route` supplies the player's answers. |
| `bookmark(): Bookmark` | The current rest point as serialisable data. |
| `restore(bookmark): Promise<void>` | Replaces state and enters the bookmark's node. |
| `describe(): FlowGraph` | The whole graph as JSON, built without running the game. |
| `state(): FlowState` | `{ running, path, stack, pending, mode }`, frozen. The same object comes back while the graph did not move: no edge, no gate opened or closed, no mode switch. |
| `history(): readonly JournalEntry[]` | Edges since the last checkpoint. |
| `setMode(mode): void` | `"live"` or `"fast"`. Legal before `run()` and while the loop rests. |
| `gate.answer(answer): boolean` | The one entry of player answers. The gate closes before the answer is handed on, so a double tap hits a closed door. |
| `gate.pointer(active): void` | While true, entering an `over` node waits: a popup never appears mid-drag. |
| `gate.state()` | `{ open, allowed, narrowed }`. |
| `inbox.post(event): void` | Queues a world event. It is delivered only to a rest node whose `inbox` lists the type. |
| `fx.handle(kind, fn, options?)` | Registers the single handler of one effect kind. `{ runInFast: true }` makes it run in fast mode too. The handler's `signal` is the node's, with two exceptions: a descriptor with `answers` (a popup) and a `guide` get a signal of their own, so the handler knows when to take down what it showed. |
| `fx.dispatch(descriptor): void` | Fire-and-forget delivery, `runInFast` handlers only in fast mode. Handler errors are logged, never thrown. |
| `fx.onHint(listener): () => void` | Hears every released hint after the commit of its edge, in release order, next to any `handle` owner of the kind. Silent in fast mode. `world` routes hints to projection motions with it. |
| `features.register(name, description)` | Called from a feature plugin's `onInit`. After `run()` it throws. |
| `features.all()`, `features.contributions(slot)` | What the game brought, and the sub-flows of one slot in `order`. |

## Doors for the editor

The editor, MCP tools and e2e scripts reach a running game through two doors: `/inspect` reads,
`/control` writes in dev builds only. Flow hosts the machinery in `doors/`, because it owns the
graph, the journal and the taint. A source or a command is data: an id, a title, an input schema
and one function. Each lives with the plugin that owns its data, in that plugin's `inspect.ts` and
`control.ts`.

| Function | Door | Behaviour |
|---|---|---|
| `defineSource(source)` | `/inspect` | Checks the id (`game.position`: camelCase words joined by dots) and freezes the descriptor. |
| `read(app, source, input?)` | `/inspect` | Calls the source's `read` once. Never changes the game. The input may be left out when every field of the schema is optional. |
| `watch(app, source, input, fn)` | `/inspect` | Reads on the first `signals` phase, then again when the source's change key moved: `"frame"` every frame, `"commit"` when `model.store.snapshot()` is a new object, `"edge"` when `flow.state()` is. Both are memoised, so an unchanged frame allocates nothing. Returns the stop function. |
| `defineCommand(command)` | `/control` | Checks the id and freezes the descriptor. |
| `run(app, command, input?)` | `/control` | Throws `[game] Control commands run in dev builds only.` unless `__MOKU_GAME_DEV__` is `true`. Resolves `{ value, state }`, where `state` is the envelope `{ path, frame, tainted }` read after the command. |

An input schema maps field names to `"string"`, `"number"`, `"boolean"` or `"json"`; a kind with a
trailing `?` is optional. The command reads its input already typed:

```ts
export const jumpToLevel = defineCommand({
  id: "timber.jumpToLevel",
  title: "Go to level",
  input: { level: "number" },
  effect: "route",
  run: (app, { level }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
    return app.flow.walk([{ at: "home", intent: "play", payload: { level } }]);
  }
});
```

**The dev flag.** `__MOKU_GAME_DEV__` is a global the engine never replaces; undefined means
production. A dev build defines it `true` in the bundler, or sets `globalThis.__MOKU_GAME_DEV__ =
true` before the engine runs. `isDev()` reads it at call time. Bun does not inline `isDev()` across
modules, so every command body writes the guard inline, as above: a `define` of `false` folds the
condition and the minifier drops the body. Every body logs the debug entry `moku:dev`, and a Bun
build test proves the marker is gone from `src/plugins/flow/control.ts` with `false` and present
with `true`. Bun does not tree-shake a second time after it drops a body, so a module-level helper
that only a dropped body called (the JSON readers, `reproBookmark`) stays in the bundle, unreachable.

**Effects and taint.** `route` goes through the graph and keeps the session clean. `cheat` and
`raw` taint the session of that app and are journaled `{ id, input, frame }` before they run, the
last 500 kept. Both live per app object, so two apps in one process never share them.

Flow sources:

| id | Input | Output | Changes |
|---|---|---|---|
| `game.graph` | — | `flow.describe()` | edge |
| `game.position` | — | `{ path, flow, node, waiting }` | edge |
| `game.history` | `{ last: "number?" }` | the journal, or its last entries | edge |
| `game.tainted` | — | whether a cheat or raw command ran | frame |
| `game.cheats` | — | the cheat journal, frozen | frame |
| `game.log` | `{ level: "string?" }` | `log.trace()`: every entry, or the entries at `level` and above. Another level than `debug`, `info`, `warn`, `error` throws | frame |

Flow commands:

| id | Input | Effect | Does |
|---|---|---|---|
| `game.answer` | `{ intent: "string", payload: "json?" }` | route | `flow.gate.answer` |
| `game.walk` | `{ route: "json" }` | route | `flow.walk` with the route read from JSON |
| `game.bookmark` | — | read | `flow.bookmark()` |
| `game.restore` | `{ bookmark: "json?", repro: "json?" }`, exactly one | raw | `flow.restore(bookmark)`, or `flow.restore(reproBookmark(app, repro))` then `flow.walk(repro.route)` |

## The signal of an effect handler

A handler lives above the graph and usually shows something: a popup, a tutorial hand, a sound.
It learns from its `signal` when that something has to go.

| Descriptor | Signal | Aborted when |
|---|---|---|
| With `answers` (`popup`) | A child of the node's | The answer arrives, or the node is aborted |
| `guide` | A child of the node's | The runner lifts the narrow on node exit, or the node is aborted |
| Everything else (`play`, `load`, `sfx`) | The node's own | The node is aborted |

A child signal never reaches back: a popup that ends leaves the node running, and the node walks
on to its edge. The node's abort reason (`"stop"`, `"restore"`, `"inbox"`) is forwarded to the
child, so a handler can tell a stop from an answer.

```ts
app.flow.fx.handle("popup", (descriptor, { signal }) => {
  const root = mount(descriptor.payload);

  signal.addEventListener("abort", () => unmount(root));
});
```

## What a feature brings

`features.register(name, description)` stores the description untouched. `nodes`, `flows` and
`contribute` are the logic keys `logicOnly` keeps; `animations` (`anim`), `ui` (`ui`), `strings`
(`i18n`) and `textStyles` (`text`) are the V3 interface keys, typed next to the V2 screen keys
(`projections`, `systems`, `components`, `scenes`, `assets`). `logicOnly` drops every key that is
not logic, so a headless test composes a feature without its screen set.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mainFlow` | `AnyFlow \| undefined` | `undefined` | The top-level flow. Required before `run()`. |
| `safeNode` | `string \| undefined` | `undefined` | Checkpoint entered after a failed retry. `undefined` is the main flow's `start`. |
| `retries` | `number` | `1` | Retries of a failed transition before `safeNode`. |
| `settleTimeoutMs` | `number` | `2000` | How long `onStop` waits for the active node to settle after abort, in real milliseconds. |
| `journalLimit` | `number` | `500` | Journal entries kept between checkpoints. |

```ts
const app = createApp({
  plugins: [boardFeature],
  pluginConfigs: { flow: { mainFlow, safeNode: "home" } },
  onStart: ctx => {
    ctx.flow.run().catch(showFatal);
  }
});
```

The graph is started by the consumer, never by the plugin: an endless awaited loop in `onStart`
would never let `app.start()` resolve.

## Events

| Event | Payload | When |
|---|---|---|
| `flow:edge` | `{ flow, node, outcome, payload, next, patches, index, now }` | After the commit of an edge. A slot emits its own `done` edge after its last contribution ended, also when it had none; each one is a journal entry. |
| `flow:rest` | `{ path, checkpoint }` | On entering a rest node, also one that starts a slot contribution (`"afterOrder/show"`). The save goes to the provider and `bookmark()` names this node. |
| `flow:error` | `{ path, error, rolledBackTo, retry }` | After a rollback. |

No engine plugin hooks these events in V1. They are for the game, for projections and for devtools.

Rare notifications for the plugins above — preload, editor, analytics. None expects an answer: the
loop itself never uses the event bus.

## Lifecycle

- **onInit** `connectFlow` posts `clock.onElapsed` into the inbox, flushes effect completions and
  the one-frame gate hold in `time.onFrame("signals")`, and registers the `schedule` effect handler
  with `{ runInFast: true }`. `onInit` has no access to the plugin's own API, so it builds its own
  module objects over `ctx.state` — the modules keep their data there, so it is the same gate and
  the same fx the API uses.
- **hooks** `lifecycle:changed`: `resumed` pokes the clock; a `"background"` push starts
  `model.store.flush()` and keeps its promise in `state.runner.flushing` for `onStop`.
- No `onStart`. The game calls `flow.run()` itself.
- **onStop** is `({ config, state }) => stopRunner({ config, state })`: aborts the active node,
  wakes a pending pointer wait, awaits settle up to `settleTimeoutMs` of real time, with or without
  a frame loop, and discards an open transaction. `flow` stops before `model`, so `model` still
  flushes afterwards. The background flush started by the hook never rejects: the store logs its failure, and the flush in the `onStop` of `model` reports a lasting one. When the deadline wins, the stop stays on record, so a loop that wakes later still stops.
- A throw inside the `lifecycle:changed` hook reaches the framework `onError`, which writes the
  error entry `"game: a hook failed"` to the log.

## Dependencies

`time` for the `signals` phase, `isRunning()` and `wake()` on every edge (an edge is the moment the
screen has something new to show, so the idle cap is lifted for it), `lifecycle` for the hook,
`model` for the store, `clock` for `now`, `onElapsed`, `poke` and the `schedule` effect. A node
never touches the clock: it writes `await fx(schedule(rules.nextDue(player, tables)))`.
