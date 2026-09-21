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
| `register(flow): void` | Adds a flow that is not reachable from `mainFlow` by reference. Before `run()` only. |
| `onEnter(stage, fn): () => void` | Registry for the plugins above: `assets` preloads at `"load"`, `scenes` switches at `"scene"`. |
| `walk(route, options?): Promise<FlowState>` | Fast walk: every node's logic runs for real, effects answer instantly, `route` supplies the player's answers. |
| `bookmark(): Bookmark` | The current rest point as serialisable data. |
| `restore(bookmark): Promise<void>` | Replaces state and enters the bookmark's node. |
| `describe(): FlowGraph` | The whole graph as JSON, built without running the game. |
| `state(): FlowState` | `{ running, path, stack, pending, mode }`. |
| `history(): readonly JournalEntry[]` | Edges since the last checkpoint. |
| `setMode(mode): void` | `"live"` or `"fast"`. Legal before `run()` and while the loop rests. |
| `gate.answer(answer): boolean` | The one entry of player answers. The gate closes before the answer is handed on, so a double tap hits a closed door. |
| `gate.pointer(active): void` | While true, entering an `over` node waits: a popup never appears mid-drag. |
| `gate.state()` | `{ open, allowed, narrowed }`. |
| `inbox.post(event): void` | Queues a world event. It is delivered only to a rest node whose `inbox` lists the type. |
| `fx.handle(kind, fn, options?)` | Registers the single handler of one effect kind. `{ runInFast: true }` makes it run in fast mode too. |
| `fx.dispatch(descriptor): void` | Fire-and-forget delivery, `runInFast` handlers only in fast mode. Handler errors are logged, never thrown. |
| `features.register(name, description)` | Called from a feature plugin's `onInit`. After `run()` it throws. |
| `features.all()`, `features.contributions(slot)` | What the game brought, and the sub-flows of one slot in `order`. |

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
| `flow:edge` | `{ flow, node, outcome, payload, next, patches, index, now }` | After the commit of an edge. |
| `flow:rest` | `{ path, checkpoint }` | On entering a rest node. |
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
- A throw inside the `lifecycle:changed` hook is reported with
  `ctx.log.error("flow: lifecycle:changed hook failed", { error })`.

## Dependencies

`time` for the `signals` phase and `isRunning()`, `lifecycle` for the hook, `model` for the store,
`clock` for `now`, `onElapsed`, `poke` and the `schedule` effect. A node never touches the clock: it
writes `await fx(schedule(rules.nextDue(player, tables)))`.
