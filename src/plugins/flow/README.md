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
| `walk(route, options?): Promise<FlowState>` | Fast walk: every node's logic runs for real, effects answer instantly, `route` supplies the player's answers. `options.from` enters a bookmark first. A rest node is entered before the switch to fast mode. A transit node is entered after the switch, without waiting for its gate. |
| `bookmark(): Bookmark` | Where the graph stands as serialisable data: the last rest node, or the transit node that waits at the gate for an answer. See [Bookmark and restore](#bookmark-and-restore). Flow does not know scenes: the optional `scene` field is written by the `game.bookmark` door only. |
| `restore(bookmark): Promise<void>` | Replaces state and enters the bookmark's node. Ignores `scene`. For a rest node it resolves before the scene stage of the restored node runs; `walk([])` waits for the gate it opens after that stage. For a transit node it resolves once that node opened its gate. It also resolves when the loop ends first, by a stop or a fatal error: nothing is entered then, and `state()` shows where the graph stands. See [Bookmark and restore](#bookmark-and-restore). |
| `describe(): FlowGraph` | The whole graph as JSON, built without running the game. |
| `state(): FlowState` | `{ running, path, stack, pending, mode }`, frozen. The same object comes back while the graph did not move: no edge, no gate opened or closed, no mode switch. |
| `history(): readonly JournalEntry[]` | Edges since the last checkpoint. |
| `setMode(mode): void` | `"live"` or `"fast"`. Legal before `run()` and while the loop rests. It throws while a transit node waits at the gate, also right after a `restore` into one. |
| `gate.answer(answer): boolean` | The one entry of player answers. The gate closes before the answer is handed on, so a double tap hits a closed door. An answer to a closed gate is refused and held for the next gate. See [The gate hold](#the-gate-hold). |
| `gate.pointer(active): void` | While true, entering an `over` node waits: a popup never appears mid-drag. |
| `gate.state()` | `{ open, allowed, narrowed }`. |
| `inbox.post(event): void` | Queues a world event. It is delivered only to a rest node whose `inbox` lists the type. |
| `fx.handle(kind, fn, options?)` | Registers the single handler of one effect kind. `{ runInFast: true }` makes it run in fast mode too. The handler's `signal` is the node's, with two exceptions: a descriptor with `answers` (a popup) and a `guide` get a signal of their own, so the handler knows when to take down what it showed. |
| `fx.dispatch(descriptor): void` | Fire-and-forget delivery, `runInFast` handlers only in fast mode. Handler errors are logged, never thrown. |
| `fx.onHint(listener): () => void` | Hears every released hint after the commit of its edge, in release order, next to any `handle` owner of the kind. Silent in fast mode. `world` routes hints to projection motions with it. |
| `features.register(name, description)` | Called from a feature plugin's `onInit`. After `run()` it throws. |
| `features.all()`, `features.contributions(slot)` | What the game brought, and the sub-flows of one slot in `order`. |

## Bookmark and restore

A bookmark is a node plus a state that really existed there. Two kinds of node can be named.

| The graph stands | `bookmark()` gives |
|---|---|
| At a rest node | That node and the committed state. No `rest`. |
| In a transit node that waits at the gate for an effect that takes answers (a `popup`, or a hand-written descriptor with `answers`) | That node, its input, and the state committed when it was entered. `rest: { path, input }` names the rest point before it. |
| In a transit node that awaits anything else (an animation, a request) | The last rest node and the committed state, as before. |

`rest` is left out when no rest node came before the transit node: the graph started at it, or a
restore entered it.

What the waiting node wrote before its gate is not in the bookmark. Those writes are in its open
transaction. The node writes them again when it is restored.

```ts
// The mini game with its info popup open.
const bookmark = app.flow.bookmark();
bookmark.path; // "info/show"
bookmark.rest; // { path: "home", input: null }
bookmark.session; // { opened: 0 }: the node counts the popup when it runs again

// A fresh page.
await app.flow.restore(bookmark);
app.flow.state().pending.gate; // ["ok", "close"]
```

| | A rest node | A transit node |
|---|---|---|
| Accepted | A checkpoint always. A plain rest node while the graph hash matches. | Only while the graph hash matches. It is never a checkpoint, also with `checkpoint: true`. |
| The graph changed | A plain rest node is refused. | `restore` enters `rest` instead when that is a checkpoint, and logs the info entry `flow:restore-fell-back` with `{ from, to }`. Without `rest` it is refused. A renamed or removed node is a changed graph too: a bookmark with `rest` whose path names no node takes the same fallback, and without `rest` it is refused as no node of the graph. |
| What runs | The node is entered again, with the bookmark's input. | The node runs again from its first line, live, with the bookmark's input. Its effects before the gate play again. A failure retries this node. |
| `restore` resolves | When the node is entered, before its scene stage. Or when the loop ends first: the node is not entered. | When the node opened its gate, or at the rest node or the end of the loop it reaches without one. Or when the loop ends before the node is entered: it never runs. |
| `flow:rest` | Emitted once. `checkpoint` is the node's flag. | Emitted once, with `checkpoint: false`. |
| `walk(route, { from })` | Enters before the switch to fast mode, then walks. The stages of the node see the mode of the caller. | Enters after the switch to fast mode, without waiting for the gate. The node runs in fast mode, so its popup is not shown. The route answers it. |

A repro (`runRepro`, `reproBookmark`, `game.restore` with `repro`) starts at a rest node only. A
`checkpoint` that names a transit node is refused.

Known limits:

- A node that shows two popups in a row comes back at the first.
- A popup over a popup comes back alone.
- Every effect before the gate runs again, a request too.
- The wait of `restore` has no timeout. A transit node that opens no gate, never rests and never
  ends keeps the promise pending.
- The gate being open is not the draw. The popup shows on the next frame.
- `setMode` throws at a transit node that waits at the gate, also right after a `restore` into one.
- A transit restore hands the provider a document from between two rest points: the rest point
  is marked on restore, so that a later rollback does not drop the restored document. A page
  kill right after it loads that state at the start node.
- A body that was aborted (by `restore`, by a world event, by `onStop`) can start no effect any
  more. Its `fx(...)` call rejects with the abort reason: `"restore"`, `"inbox"` or `"stop"`. Its
  `fx.start(...)` call starts nothing and throws nothing.

## The gate hold

An answer that arrives while the gate is closed is refused: `gate.answer` returns `false`. It is
held and offered once to the next gate that opens. That gate takes it when it lists the intent and
a running `guide` lets it through. Otherwise the answer is dropped.

| `holdMs` | How long the answer is held | Two answers at a closed gate |
|---|---|---|
| `0`, the default | The frame it was given in | The first wins |
| Above `0` | Until it is older than `holdMs` | The last wins |
| `Infinity` | Until the next gate opens | The last wins |

The age is counted in game time, `time.snapshot().elapsed`, from the moment of the refusal. A
paused game ages nothing.

```ts
// The move animation closes the gate for about a second. A tap during it is played afterwards.
createApp({ pluginConfigs: { flow: { mainFlow, safeNode: "home", holdMs: 1100 } } });
```

These hold nothing or drop the answer, whatever `holdMs` is:

- Fast mode and a game without a frame source hold nothing.
- A gate that opens in fast mode drops the held answer without offering it. A fast walk answers
  its own gates.
- Entering a bookmark drops it. The press belongs to the position the restore left.
- Giving up on a transition drops it, before the graph goes to `safeNode`. A retry keeps it.
- A stop drops it. The next `run()` starts with nothing held.

## When a node fails

A node that throws, an `onEnter` stage that rejects and an edge that leads nowhere all fail the
transition. The runner discards the transaction, drops the hints, shuts the gate and rolls the
state back to the last rest point.

| Failures in a row | Where the graph goes | `retry` |
|---|---|---|
| Up to `retries` | Back to the last rest point. The player answers again. | `true` |
| One more | To `safeNode` | `false` |
| Any, inside `safeNode` | Nowhere. `run()` rejects. | no event |

A `restore` leaves the safe node. A failure of the restored node is retried, as any failure is.

Every failure writes one error entry to the log, then emits `flow:error`:

```ts
app.log.trace().filter(entry => entry.event === "flow:error");
// [{ level: "error", event: "flow:error", ts: 1790000000000,
//    data: { path: "board/place", rolledBackTo: "home", retry: false, error: { message, stack } } }]
```

A thrown value that is no `Error` is logged as `new Error(String(value))`. The event carries the
value as it was thrown. The fatal failure inside the safe node is no log entry and no event.

**`recover`.** When the graph goes to `safeNode`, the state is the one of the rest point that
failed. Without `recover` the safe node opens its gate on that state. A rest node brings `recover`
to put it right first:

```ts
// "home" is flow.safeNode. The board failed twice: the session still describes the board.
const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type() },
  recover: ({ session }) => {
    session.screen = "home";
  }
});
```

| | `recover` |
|---|---|
| Runs | In the safe node, once, after the last failure. Before the `onEnter` stages and before the gate. |
| Does not run | On a retry. After a `restore`. In a node that is not the safe node: `run()` logs `flow:graph-warning`. |
| Gets | `{ player, session, rng, fx, signal, now }`: the node context without `input` and `out`. |
| Writes | One transaction. It is committed as an edge of the node onto itself: `flow:edge` with `outcome: "recover"`, then `flow:rest`. A later rollback returns to this state. |
| Throws | `run()` rejects, as for any failure inside the safe node. |
| On a transit node | A compile error, and an error of `run()`. |

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
  id: "mini.jumpToLevel",
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
| `game.bookmark` | — | read | `flow.bookmark()`, plus `scene: scenes.current()` when the app has `scenes` and a scene is mounted |
| `game.restore` | `{ bookmark: "json?", repro: "json?" }`, exactly one | raw | `scenes.expect(bookmark.scene)` when the bookmark has a scene, then `flow.restore(bookmark)`; or `flow.restore(reproBookmark(app, repro))` then `flow.walk(repro.route)` |

The `scene` of a bookmark is what makes a restore at a popup work in a fresh page. A node without
a scene of its own keeps the mounted scene: a rest node (`settings/open`, the Settings popup over
Home), or a transit node that waits for an effect that takes answers (`info/show`, the info popup
of the mini game). In a fresh page nothing is mounted, so the restore door names the scene first
and the node mounts it. On a page that shows another scene an `over` node replaces it with the
bookmark's scene. A refused restore leaves the mounted scene as the expected one, so no later node
switches to the scene of the refused bookmark. A `scene` that is not a string makes `game.restore`
refuse the bookmark, and so does a `rest` that is not `{ path, input }`. Flow imports the
`ScenesApi` type only, never the scenes plugin.

`game.bookmark` at a waiting transit node answers with that node's `path` and with `rest`.
`game.restore` of such a bookmark answers once the node's gate is open, so the state it returns
already has `pending.gate`. No `walk([])` is needed after it, and a fast walk would not show the
popup.

## Effects in a node

A node reaches everything that is not logic through the `fx` of its context. There are three
calls. `recover` gets the same `fx`.

| Call | The handler runs | The body | Use it for |
|---|---|---|---|
| `await fx(descriptor)` | Now | Waits for the handler. With `answers` it waits for the player's answer. | A popup, a `guide`, `schedule`, an animation the next line depends on |
| `fx.start(descriptor)` | Now | Goes on at once. The call returns nothing. | A tap sound, a haptic tick, an animation nothing waits for |
| `fx.emit(hint)` | After the commit of the edge | Goes on at once. | What shows a change that must be real first: a sparkle on the merged cell |

```ts
const place = defineNode({
  input: type<{ cell: string }>(),
  outcomes: { placed: type() },
  run: async ({ fx, session, input, out }) => {
    fx.start(sfx("ui.tap"));                                   // started now, not awaited
    session.marks.push(input.cell);
    await fx({ kind: "drop", payload: { cell: input.cell } }); // awaited: the edge waits for it
    fx.emit(hint("placed", { cell: input.cell }));             // released after the commit

    return out.placed();
  }
});
```

`fx.start` takes the path of an awaited effect. Only the end of the effect is nobody's wait.

| | `fx.start(descriptor)` |
|---|---|
| Mode | As for an awaited effect. In fast mode only a `runInFast` handler runs. |
| Signal | The node's. It aborts when the node is aborted. A node that ended never aborts it. |
| A handler that fails | Never fails the node. The log gets one error entry `flow:fx-start-failed` with `{ path, kind }`. While the frame loop runs it is written in the `signals` phase of the next frame. |
| A `cosmetic` descriptor (`sfx`, `haptic`) | Silent when its handler fails, as it is when awaited. |
| `answers`, `guide` | Throws `[game] fx.start() got the effect …`. An answer has to be awaited: write `await fx(...)`. |
| After the abort of the node | Starts nothing and throws nothing. |
| The handler's value | Dropped. |

```ts
app.log.trace().filter(entry => entry.event === "flow:fx-start-failed");
// [{ level: "error", event: "flow:fx-start-failed", ts: 1790000000000,
//    data: { path: "board/place", kind: "load", error: { message, stack } } }]
```

A hint is not a started effect. `fx.emit` waits for the commit and a failed node drops its hints.
`fx.start` runs at once and a failed node does not take it back.

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
(`projections`, `systems`, `components`, `scenes`, `assets`). `emitters` and `filters` are the
V5 keys `effects` reads. `logicOnly` drops every key that is not logic, so a headless test
composes a feature without its screen set.

`GameTypes.emitters` is the emitter id union of a game. `EmitterIdOf<Types>` reads it and falls
back to `string`, as `TextStylesOf` does for `textStyles`.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mainFlow` | `AnyFlow \| undefined` | `undefined` | The top-level flow. Required before `run()`. |
| `safeNode` | `string \| undefined` | `undefined` | Checkpoint entered after a failed retry. `undefined` is the main flow's `start`. Its `recover` runs first. See [When a node fails](#when-a-node-fails). |
| `retries` | `number` | `1` | Retries of a failed transition before `safeNode`. |
| `settleTimeoutMs` | `number` | `2000` | How long `onStop` waits for the active node to settle after abort, in real milliseconds. |
| `journalLimit` | `number` | `500` | Journal entries kept between checkpoints. |
| `holdMs` | `number` | `0` | How long an answer a closed gate refused is kept for the next gate, in milliseconds of game time. `0` is the frame it was given in, `Infinity` is until the next gate opens. See [The gate hold](#the-gate-hold). |

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
| `flow:edge` | `{ flow, node, outcome, payload, next, patches, index, now }` | After the commit of an edge. A slot emits its own `done` edge after its last contribution ended, also when it had none; each one is a journal entry. The recovery of the safe node is an edge too: `node` and `next` are the safe node, `outcome` is `"recover"`. |
| `flow:rest` | `{ path, checkpoint }` | On entering a rest node, also one that starts a slot contribution (`"afterOrder/show"`). The save goes to the provider and `bookmark()` names this node. Also once when a bookmark is entered, for a transit node too: `path` is then no rest node and `checkpoint` is false. And once after the recovery of the safe node, before that node is entered. |
| `flow:error` | `{ path, error, rolledBackTo, retry }` | After a rollback. The log has the same failure first, as the error entry `flow:error`. See [When a node fails](#when-a-node-fails). |

No engine plugin hooks these events in V1. They are for the game, for projections and for devtools.

Rare notifications for the plugins above — preload, editor, analytics. None expects an answer: the
loop itself never uses the event bus.

## Lifecycle

- **onInit** `connectFlow` posts `clock.onElapsed` into the inbox, flushes effect completions and
  ages the gate hold in `time.onFrame("signals")`, with the frame and the elapsed game time of
  that frame, and registers the `schedule` effect handler with `{ runInFast: true }`. `onInit` has no access to the plugin's own API, so it builds its own
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

`time` for the `signals` phase, `isRunning()`, the `elapsed` the gate hold is aged with, and
`wake()` on every edge (an edge is the moment the
screen has something new to show, so the idle cap is lifted for it), `lifecycle` for the hook,
`model` for the store, `clock` for `now`, `onElapsed`, `poke` and the `schedule` effect. A node
never touches the clock: it writes `await fx(schedule(rules.nextDue(player, tables)))`.
