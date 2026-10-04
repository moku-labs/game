# world

> Very Complex plugin — the screen as data: a small zero-dependency ECS, and the projection that
> turns keyed items of the model into entities. No business logic lives here, and everything runs
> in plain Bun.

Two modules do the work and the plugin root composes them, in the injection order `ecs → projection`:
`ecs` owns entities, components, resources, systems and the four frame phases; `projection` is the
bridge from `model:committed` to those entities, with the retarget policy of spike P5.

```ts
app.world.ecs.query(Sprite, Transform);                                   // ecs
app.world.projection.mount(["board.items"], { kind: "plugin", name: "scenes" }); // projection
```

`projection` never imports the run-time code of `ecs`: `api.ts` injects the sibling module and the
four world-owned components (`Layer`, `Order`, `Exiting`, `Tree`) into its factory.

## API

### `ecs` — `app.world.ecs`

| Method | Behaviour |
|---|---|
| `system(def): () => void` | Registers a system at the end of its phase list. A duplicate name throws. Registered during a frame: runs from the next frame. |
| `spawn(owner, components): Entity` | The id is reserved and returned at once. Owner is required by the type. |
| `despawn(entity)` / `despawnOwnedBy(owner)` | Removes every component (each fires `onRemoved`), frees the index, bumps the generation. A stale id is a no-op. |
| `get(entity, Component)` | The stored value, read-only, or `undefined`. A stale id gives `undefined`. |
| `set(entity, Component, patch)` | Shallow merge into the stored object, marks changed. Never queued. Throws for a stale entity or a missing component. |
| `add(entity, value)` / `remove(entity, Component)` | Structural. `add` on an existing component replaces the value and marks changed, no `onAdded`. |
| `has(entity, Component)` / `tag` / `untag` | Structural and idempotent. False for a stale id. |
| `query(...Components)` | Walks the store of the FIRST term in insertion order and keeps entities that carry every term. `mut(C)` marks every yielded entity changed for `C`. |
| `resource(Resource)` | The one mutable value per world, cloned from the defaults on first read. |
| `onAdded(C, fn)` / `onRemoved(C, fn)` | Fire when the structural change is applied, for a component or a tag. A component listener gets the entity and the value; a tag listener gets the entity. A throwing listener is logged; the others still run. |
| `changed(Component)` | The coarse change set of the frame, cleared in `time` phase `signals`. |
| `typeOf(name)` | The component type behind a storage name, registered on first use, or `undefined`. |
| `ownerOf(entity)` | The owner of a live entity, or `undefined` for a stale id, also after its index came back: the liveness check. `renderer` asks it before it forgets an entity's filters. |
| `mode()` / `setMode(mode)` | `mode()` is the effective mode: `"fast"` while the flow walks fast, else the stored one. |
| `snapshot(): WorldSnapshot` | The world as plain JSON, sorted by index. A value that is not JSON, and every `Tree`, is skipped and named. |
| `diff(from, to): FrameDiff` | What changed between the world at the end of frame `from` and at the end of frame `to`, from the frame history (below). Dev builds only; throws outside the last 120 frames. The caller is `game.diff`. |
| `schema(): ComponentSchema[]` | Every component and tag type the world met so far, sorted by name, with the JSON kind of each field. A new list on every call. The caller is `game.schema`, the editor's component palette. |

`snapshot()` is typed. Both types reach a game as `World.WorldSnapshot` and `World.EntitySnapshot`;
`diff()` and `schema()` answer `World.FrameDiff` (with `World.EntityDiff` entries) and
`World.ComponentSchema`.

| Type | Field | Holds |
|---|---|---|
| `WorldSnapshot` | `mode` | The effective mode, as `mode()` answers it |
| | `entities` | `EntitySnapshot[]`, sorted by index |
| | `resources` | Resource name to value, the values that are JSON |
| `EntitySnapshot` | `id` | The `Entity` |
| | `index`, `generation` | The two halves of the id |
| | `owner` | `{ kind, name }`, the owner `spawn` named |
| | `components` | Component name to value, the values that are plain JSON. A tag reads `true` |
| | `skipped` | The names of the components that are not JSON, and `Tree` |

```ts
// A test asserts what the board holds after the first reconcile.
app.world.ecs.snapshot().entities[0];
// { id: 1048576, index: 0, generation: 1, owner: { kind: "projection", name: "board.items" },
//   components: { Layer: { name: "items" } }, skipped: [] }
```

### `projection` — `app.world.projection`

| Method | Behaviour |
|---|---|
| `register(spec)` | Stores a projection. A duplicate name throws. Nothing is drawn until `mount`. |
| `setLayers(list)` / `layers()` | The layer list of the scene; order is draw order. Every call stores a new frozen array, so a reader compares by identity. |
| `mount(names, owner)` | Marks the projections mounted and reconciles them at once, direct. Throws for an unknown name and for a `layer` or `lift` the scene does not declare; nothing is mounted then. |
| `unmount(names)` | Flush: every motion is finished, live views and the despawn queue go in the same call. |
| `settle(entity)` | A drop with no commit: cancels the motions and plays settle for every loose component. In `paused` and `fast` it writes the rest pose at once. |
| `mute(entity, Component, fields)` | The hand owns these fields; tracks never write them, also not on `finish()`. The remover is safe after the entity left. |
| `lift(entity, on)` | Into / out of the projection's `lift` layer. `lift(false)` on a moving view takes effect when its last motion ends. |
| `keyOf(entity)` / `entityOf(projection, key)` | `keyOf` also answers for a queued view; `entityOf` never does. Both also answer for a key registered with `registerKey`. |
| `motionsOf(entity)` | The component names of the running tracks on an entity, in start order, each once. `[]` for a resting view, an entity no motion drives and a stale id. A new array on every call; it only reads, no ended track is forgotten. The caller is `game.explain`. |
| `entitiesOf(name)` | The live view entities of a mounted projection, in the order of its model keys. Exiting views and keys registered with `registerKey` are left out; `[]` when the projection is not mounted. `ui` uses it to host a projection inside a slot. |
| `setDriver(driver)` | Installs the tween engine behind `tween`, `toRest` and `all`; the remover puts the instant writes back. `anim` calls it in `onStart`. |
| `viewOf(entity, owner?)` | A view handle for an entity a plugin owns, so `ui` can animate an element. `rest` reads what `setRest` recorded, `peer` answers `undefined`. A projection view and a foreign owner get `undefined`. |
| `setRest(entity, Component, value)` | Records the rest pose of such an element, which is where `toRest` brings it home. |
| `registerKey(projection, key, entity)` | Publishes an element under a projection and key. A key a live view holds is a `[game]` error naming both; the remover drops it. |
| `rerunAll()` | Marks every mounted projection dirty and forces `view` for every item. |

The authoring helpers are pure and exported from the package root:
`component`, `tag`, `resource`, `mut`, `system`, `projection`, and `Layer`, `Order`, `Exiting`,
`Tree`. A projection whose `from` returns one plain object needs no `key`: it draws one item under
the name of the projection, and a `view` that returns one description node instead of components is
wrapped as `Tree({ node })`, which `ui` reconciles into child entities.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `settleMs` | `number` | `350` | Duration of the built-in settle motion, in game milliseconds. |
| `reconciledEvent` | `boolean` | `false` | Emit `world:reconciled` after every reconcile. Off in production. |

```ts
const app = createApp({
  plugins: [worldPlugin, boardFeature],
  pluginConfigs: { world: { settleMs: 250, reconciledEvent: true } }
});
```

## The frame

| `time` phase | What `world` does, in order |
|---|---|
| `input` | reconcile when dirty → drop the hint buffer → systems of `input` → flush commands |
| `animate` | sweep ended motions (the driver advanced its tracks first) → systems of `animate` → flush |
| `layout` | systems of `layout` → flush |
| `sync` | systems of `sync` → flush |
| `signals` | record the frame history (dev builds only) → clear every change set |

`"paused"` and `"fast"` skip the phases `input`, `animate` and `layout`; phase `sync`, the reconcile
slot of `input` and the clear in `signals` run in every mode. A throwing system is reported with
`ctx.log.error("world:system-failed", …)` and skipped for this frame; the frame goes on.

While a phase runs, `spawn`, `despawn`, `despawnOwnedBy`, `add`, `remove`, `tag` and `untag` are
queued and applied in call order when the phase ends. `set` is never queued. A queued command on an
entity that died meanwhile is dropped.

## Motions

A motion may carry a `loop` hook (`defineMotion` with `loop` builds it): it is played wherever `enter`
plays, kept out of the view's handles so a change never cancels it, and ends with the view.

A new motion on a view that still animates cancels the running ones and starts from the current
values (spike P5). Components the new hooks do not drive are brought to the rest pose by
`motion.settle`, or by the built-in `toRest` over `settleMs`. When the last motion of a view ends,
every rest component is compared with the stored value, muted fields excluded. A number counts as
at rest within 1e-6 reference units, so float noise from a root-space round trip is no difference.
A difference is written and reported with `log.warn("world:view-corrected", …)`.

`ViewHandle.tween`, `toRest` and `all` run on the driver `anim` installs with `setDriver`
(`projection/driver.ts`). A track reads its start values when its `delayMs` ends, writes the exact
target on its last frame and goes through `ecs.set`; muted fields are never written, also not on
`finish()`. Without a driver the instant default writes every target at once and hands back an
inactive handle, so a composition without `anim` plays every motion instantly. A despawn and every
flush call `driver.cancelAll(entity)`.

`TweenOptions.segments` (and `TrackOptions.segments` on the driver) turns one tween into a keyframe
walk: `[{ at, ease?, to }]`, each segment ending at `at` (0..1 of `ms`) with its own curve (the
tween's `ease` when left out), all on one clock. A field a segment does not name holds; the track's
`to` is where the last segment ends, and the track owns every field a segment names for the whole
walk. `motions.ts` passes `segments` to the driver unchanged; the instant default writes the last
value of every segment field at once.

`TweenOptions.repeat` (and `TrackOptions.repeat`) is `number | "forever"`: the driver starts the
walk again from its first segment when it ends, a number counting the extra runs. `motions.ts`
passes it on like `segments`, and names no `repeat` when the tween has none. The instant default
ignores it and writes the end pose once, so a world without `anim` never loops.

## Events

| Event | Payload | When |
|---|---|---|
| `world:reconciled` | `{ mode, projections, entered, changed, exited, revived, queued, hintsRouted, hintsDropped }` | After a reconcile, only when `reconciledEvent` is true. Counts, never one per entity. |

## Lifecycle

- **hooks** `model:committed` records `cause` and `roots` in `state.projection.dirty`. The reconcile
  runs once, at the start of the next frame, so two commits in one frame give one reconcile. In fast
  mode it reconciles at once, direct.
- **onStart** `connectWorld` reads every feature description and registers its `components`, then
  `systems`, then `projections`, in feature order; registers the five `time.onFrame` callbacks, the
  `onOwnerLeft` listener and `flow.fx.onHint`, and keeps the removers in state. Nothing is mounted:
  `scenes` or a test mounts.
- **onStop** `({ state }) => clearWorld(state)` calls the removers and drops the driver, tracks,
  views, registered keys, recorded rest poses, the despawn queue, entities and resources, and resets
  the frame history. No `onRemoved` fires: `renderer` stopped earlier.

## Doors

`inspect.ts` holds the five world sources of the editor's read door, `@moku-labs/game/inspect`.
Every one only reads through `app.world`. `game.diff` answers in a dev build only, because only a
dev build keeps the frame history; the other four are safe in a production build.

| Key in `sources` | id | Input | Changes | Reads |
|---|---|---|---|---|
| `entities` | `game.entities` | `{ owner: "string?", component: "string?" }` | frame | `ecs.snapshot().entities`: all of them, the ones whose owner has the name `owner`, the ones that carry `component`, or both. A component counts when it is in `components` or in `skipped` |
| `projections` | `game.projections` | none | commit | Projection name to key to entity: every entity of the snapshot for which `projection.keyOf` answers. That includes a view in the despawn queue and a key registered with `registerKey` |
| `explain` | `game.explain` | `{ entity: "number" }` | frame | One entity in full, `Explained \| undefined`: `{ id, owner, key, components, skipped, motions }`. `components` and `skipped` are its row of `ecs.snapshot()`, `key` is `projection.keyOf`, `motions` is `projection.motionsOf`. `undefined` for a stale id |
| `diff` | `game.diff` | `{ from: "number", to: "number" }` | frame | `ecs.diff(from, to)`: `{ from, to, entities }`, each entity `{ id, owner, key, change, components }` with `change` `"spawned"`, `"despawned"` or `"changed"` and `components` name to `{ from, to }`, `null` for "not there". Sorted by id. Throws, see below |
| `schema` | `game.schema` | none | frame | `ecs.schema()`: `[{ name, kind, json, fields, defaults, owned }]`, sorted by name. `kind` is `"component"` or `"tag"`; `fields` maps a field to the JSON kind of its default (`"number"`, `"string"`, `"boolean"`, `"object"`, `"array"`, `"null"`); `json: false` (as `Display`) has `fields: {}` and `defaults: null`; a tag has `defaults: true` |

```ts
import { read, sources } from "@moku-labs/game/inspect";

// Which views does the board show, and which entity is item i5?
read(app, sources.entities, { owner: "board.items" }); // EntitySnapshot[] of that projection
read(app, sources.projections)["board.items"]?.i5; // its Entity, or undefined
```

### Frame history

A dev build keeps the history `game.diff` reads; a production build keeps none. The recorder runs
in the `signals` callback, before the change sets are cleared, behind the inline dev guard, so a
production `define` drops it from the bundle. Its first frame logs
`ctx.log.debug("world:history-on", { frames: 120 })`, the marker the doors build check looks for.

- **What it keeps.** One shadow copy of the world as JSON, and a ring of 120 slots of change
  records, 2 s at 60 fps. A record is one component of one entity with its JSON before and after;
  a slot also names the entities its frame spawned and despawned, since a record alone cannot tell
  a spawn from a component added to a live entity. Records cost memory only when something
  changes: 120 full snapshots of a 400-cell board would hold about 48 MB.
- **When it records.** The first frame copies the whole world into the shadow and records
  nothing: it is the start of the window. Every later frame compares each changed entity with the
  shadow, with the filter of `snapshot()` (a value that is not JSON is never recorded) and deep JSON
  equality, so a write of the same value records nothing. A despawn, and a removed component,
  record at once, into the frame that is open: a write after `signals` belongs to the next frame.
  Every frame gets a slot, also an empty one.
- **What `diff(from, to)` answers.** The records of frames `from + 1 .. to`, folded per entity and
  component: the first `from` and the last `to`. A round trip inside the window is left out, and so
  is an entity spawned and despawned inside it. `from === to` answers no entity. `key` is the live
  address at read time, `undefined` once the entity is gone.
- **What it throws.** In a production build:
  `[game] game.diff needs a dev build.\n  Define __MOKU_GAME_DEV__ as true in the dev build.` For
  `from` after `to`, or a frame outside the window:
  `[game] game.diff: frame 7 is not in the history.\n  The history keeps the last 120 frames, 61 to 180.`
  The window starts at the first recorded frame, or 119 frames before the newest when that is later;
  `from > to` names `to`. Before the first frame of a recording the second line reads
  `The history keeps the last 120 frames and starts with the next frame.`
- **Reset.** `onStop` and `ecs.clear` empty the shadow and the ring; the next frame starts a new
  recording.

## Dependencies

`time` for the five frame phases, `model` for the `model:committed` hook and `store.snapshot()`,
`flow` for `features.all()`, the effective mode of a walk and `fx.onHint`. Core APIs: `ctx.log`.
