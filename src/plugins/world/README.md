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
| `system(def): () => void` | Registers a system at the end of its phase list. A duplicate name throws. Registered during a frame: runs from the next frame. Its `query` and its `scenes` are read once, when it registers. It is skipped while a term of its query has no entity, or while none of its `scenes` is mounted or leaving ("When a system runs", below). A system plays animations through `res(AnimPlayer)`, the resource `anim` writes in its `onStart`. |
| `spawn(owner, components): Entity` | The id is reserved and returned at once. Owner is required by the type. |
| `despawn(entity)` / `despawnOwnedBy(owner)` | Removes every component (each fires `onRemoved`), frees the index, bumps the generation. A stale id is a no-op. |
| `get(entity, Component)` | The stored value, read-only, or `undefined`. A stale id gives `undefined`. |
| `set(entity, Component, patch)` | Shallow merge into the stored object, marks changed. Never queued. Throws for a stale entity or a missing component. |
| `add(entity, value)` / `remove(entity, Component)` | Structural. `add` on an existing component replaces the value and marks changed, no `onAdded`. |
| `has(entity, Component)` / `tag` / `untag` | Structural and idempotent. False for a stale id. |
| `query(...Components)` | Walks the store of the FIRST term in insertion order and keeps entities that carry every term. `mut(C)` marks every yielded entity changed for `C` ("Marking what changed", below). Inside a system the walk reads the store live (changes are queued until the phase ends); outside one it walks the keys taken at the start, and skips an entity despawned before its turn. Every row of `ecs.query()` is a new array, also inside a system: keep it if you like. The rows a system's `run` gets for its declared `query` are not: see "The rows of a system", below. |
| `resource(Resource)` | The one mutable value per world, made on first read: a deep clone of plain defaults, or one call of a factory default. |
| `onAdded(C, fn)` / `onRemoved(C, fn)` | Fire when the structural change is applied, for a component or a tag. A component listener gets the entity and the value; a tag listener gets the entity. A throwing listener is logged; the others still run. |
| `changed(Component)` | The coarse change set of the frame, cleared in `time` phase `signals`: the world's own list, each entity once in mark order, emptied in place. Walk it in the frame and copy what you keep. Nothing marked: one shared empty list. Allocates nothing. Inside a system nothing leaves it until the phase ends; outside a phase a despawn or a removal takes the entity out at once and the ones after it move up, so a loop that despawns or removes there walks a copy (`[...ecs.changed(C)]`). |
| `typeOf(name)` | The component type behind a storage name, registered on first use, or `undefined`. |
| `ownerOf(entity)` | The owner of a live entity, or `undefined` for a stale id, also after its index came back: the liveness check. `renderer` asks it before it forgets an entity's filters. |
| `count(): number` | How many entities live now, views and layers included: every id `spawn` handed out that no despawn took back. A size the world keeps, no allocation. A screen entered and left returns it to where it was; a count that grows per visit is a leak. The renderer's monitor reads it once a second in a debug build. |
| `mode()` / `setMode(mode)` | `mode()` is the effective mode: `"fast"` while the flow walks fast, else the stored one. |
| `setScene(scene)` | Tells the world the scene now mounted, for the systems with `scenes`; the scene before leaves until nothing carries `Exiting`. Each system reads it before its next run. `scenes` calls it at every switch; a game never does. |
| `snapshot(): WorldSnapshot` | The world as plain JSON, sorted by index. A value that is not JSON, and every `Tree`, is skipped and named. |
| `diff(from, to): FrameDiff` | What changed between the world at the end of frame `from` and at the end of frame `to`, from the frame history (below). Dev builds only; throws outside the last 120 frames. Only marked components are compared: a value written in place without a mark (into a row of a plain term) is not recorded, also when another component of the entity was marked. The caller is `game.diff`. |
| `schema(): ComponentSchema[]` | Every component and tag type the world met so far, sorted by name, with the JSON kind of each field. A new list on every call. The caller is `game.schema`, the editor's component palette. |

A game writes its systems with the kit's `system`, from `defineGame`: the same function as the root
`system`, with `ctx.snapshot` typed by the game's player and session. The result goes into a
feature's `systems` list or `ecs.system` like any other.

```ts
// features/board/world/systems/looks.ts of a game: `system` comes from the kit.
export const looks = system({
  name: "board.looks",
  phase: "animate",
  query: [mut(Transform)],
  run: (rows, { snapshot }) => {
    const { cells } = snapshot.player.board; // Player["board"]["cells"], no cast
    for (const [, transform] of rows) transform.alpha = cells.length > 0 ? 1 : 0.5;
  }
});
```

The types are `World.SystemFor`, `World.SystemContextOf` and `World.GameSystemDefinition`.

### Marking what changed

`mut(C)` marks every row it yields changed for `C`, written or not. The renderer, effects and the
dev frame history look at each marked row again: a system that walks 60 frosted scene roots with
`mut(Frost)` and writes two of them makes all 60 look changed, 120 times a second.

A system that writes only some rows queries the plain term and writes with
`world.set(entity, C, patch)` when a value changes: `set` marks only the entity it writes.

```ts
// Before: the Frost of every scene root is marked every frame, moved or not.
const frostApply = system({
  name: "shared.frostApply",
  phase: "animate",
  query: [mut(Frost), SheetOpen],
  run: rows => {
    for (const [, frost, open] of rows) frost.amount = open.progress;
  }
});

// After: only a Frost whose amount moved is marked.
const frostApply = system({
  name: "shared.frostApply",
  phase: "animate",
  query: [Frost, SheetOpen],
  run: (rows, { world }) => {
    for (const [entity, frost, open] of rows) {
      if (frost.amount !== open.progress) world.set(entity, Frost, { amount: open.progress });
    }
  }
});
```

A dev build counts, per component, the rows marked and the rows that changed over 120 recorded
frames. A component marked on at least 32 rows a frame, of which at most 5 % changed, and written
by a `mut()` term of a registered system, is reported once per app:
`ctx.log.warn("world:mut-unchanged", { component: "Frost", rowsPerFrame: 61.2, changedShare: 0, systems: ["shared.frostApply"] })`.
A few rows marked by a tween that does change are never reported.

Put the rarest component first in a query: the walk visits every entity of the first term's store
and builds a row only for those that carry every term.

### The rows of a system

A system's `query` is resolved once, when it registers, into one walk the runner resets before
every run. The walk allocates nothing: every row it hands `run` is the same array, rewritten for
the next row. A row is valid until the next row. Destructuring copies, so the usual loop is safe:

```ts
run: rows => {
  for (const [entity, transform] of rows) kept.set(entity, transform); // the values, not the row
}
```

A system that keeps the row itself (`list.push(row)`) sees every kept row turn into the last one;
it copies instead (`list.push([...row])`). `ecs.query()` keeps fresh rows everywhere, also when a
system calls it inside `run`. A system with an empty `query` walks nothing and runs every frame (on
its `scenes` only, when it lists some).
The context a system gets is one object per world; its `time` and `snapshot` are the running
phase's.

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
| `replace(spec)` | Swaps the spec of a registered projection. A mounted one has its layers checked and runs the new `view` for every item on the next frame, directly. An unmounted one is only stored. An unknown name throws; a throw changes nothing. The caller is the dev hot swap in `ui`. |
| `setLayers(list)` / `layers()` | The layer list of the scene; order is draw order. Every call stores a new frozen array, so a reader compares by identity. |
| `mount(names, owner)` | Marks the projections mounted and reconciles them at once, direct. A screen root draws at the `Order` of its place in the list, −n … −1. A projection a scene before mounted (under another layer list of `setLayers`) stays mounted when the new list declares its `layer` and `lift` alike (every field of the entry equal): its views keep their entities and their motions, no hook runs, and its screen roots take the `Order` of their place in this list, on the entity and in the rest pose. One whose layer the new list declares otherwise is unmounted and mounted again. One mounted under the current layer list already warns `world:already-mounted` and changes nothing. Throws for an unknown name and for a `layer` or `lift` the scene does not declare, a kept projection's too; nothing is mounted then. A new view is spawned with its `Layer` first, so an `onAdded` hook of a view component (the `Tree` hook of `ui`) already reads the layer. |
| `unmount(names)` | Flush: every motion is finished, live views and the despawn queue go in the same call. |
| `settle(entity)` | A drop with no commit: cancels the motions and plays settle for every loose component. A view that loops comes home too, and its loop runs on. In `paused` and `fast` it writes the rest pose at once. |
| `mute(entity, Component, fields)` | The hand owns these fields; tracks never write them, also not on `finish()`. The remover is safe after the entity left. On a view whose projection names `initialOnly` fields the mute adds to them, and the remover keeps them. |
| `lift(entity, on)` | Into / out of the projection's `lift` layer. `lift(false)` on a moving view takes effect when its last motion ends. A reconcile or a `settle(entity)` that ends the motions applies the pending drop itself. |
| `membershipVersion(): number` | Moves every time a view enters the live views, leaves them, or is forgotten after its despawn, and on a clear. `ui` hosts the views of a projection again only when it moved. Allocates nothing. |
| `keyOf(entity)` / `entityOf(projection, key)` | `keyOf` also answers for a queued view; `entityOf` never does. Both also answer for a key registered with `registerKey`. A view's `keyOf` is the frozen address it keeps for its life: the same object every call. |
| `causeOf(entity)` | Why the view's motion hooks play: `"mount"` when the view came or goes with its screen (a scene mount, a load, a restore), `"change"` when a commit changed a live screen, `"discard"` when `discard()` dropped the scene build it belonged to; also answers for a view that just left, until the next sweep. A world projection passes the same value to `enter`/`exit` as their fourth argument; a discarded view plays no exit, so a game's hook never sees `"discard"`. |
| `motionsOf(entity)` | The component names of the running tracks on an entity, in start order, each once. `[]` for a resting view, an entity no motion drives and a stale id. A new array on every call; it only reads, no ended track is forgotten. The caller is `game.explain`. |
| `entitiesOf(name)` | The live view entities of a mounted projection, in the order of its model keys. Exiting views and keys registered with `registerKey` are left out; `[]` when the projection is neither mounted nor being built. A projection the running build mounts answers its building views, so a host of the coming scene can take them before the swap (`isBuilding` tells them apart). `ui` uses it to host a projection inside a slot. |
| `setDriver(driver)` | Installs the tween engine behind `tween`, `toRest` and `all`; the remover puts the instant writes back. `anim` calls it in `onStart`. A driver may report what its additive tracks add right now with the optional `offsetsOf(entity, component)`: the world then compares the value under a loop with the rest pose. |
| `viewOf(entity, owner?)` | A view handle for an entity a plugin owns, so `ui` can animate an element. `rest` reads what `setRest` recorded, `peer` answers `undefined`. A projection view and a foreign owner get `undefined`. |
| `setRest(entity, Component, value)` | Records the rest pose of such an element, which is where `toRest` brings it home, and where a restore and a load put it. The owner records the pose it draws the element with, every time that changes. The pose of an entity that is gone is dropped in the next live frame. |
| `registerKey(projection, key, entity)` | Publishes an element under a projection and key. A key a live view holds is a `[game]` error naming both; the remover drops it. A key whose entity is gone is dropped in the next live frame, also when the remover was never called. |
| `onConverged(listener)` | Calls the listener after a reconcile a restore or a load caused, when every view and every element stands on its rest pose and every track on them is ended. `ui` builds its roots again after it, so each element stands as freshly mounted. The remover is safe to call twice. |
| `rerunAll()` | Marks every mounted projection dirty and forces `view` for every item. |
| `build(names, owner, layers, budgetMs): boolean` | Starts building the next scene aside (`scenes`, on a live switch with a drawing renderer). See [Building the next scene aside](#building-the-next-scene-aside). |
| `built(): boolean` | True while a build runs and every `onBuild` check answers true; false without a build. `scenes` polls it once a frame. |
| `commit()` | The swap: the building projections become mounted. `scenes` calls it right after `setLayers(coming)` and `unmount(leaving)`. Does nothing without a build. |
| `discard()` | The abort: every entity of the build is despawned with no motion. Does nothing without a build. |
| `left(): number` | Milliseconds of building budget left in this frame; `Infinity` without a build. Allocates nothing. |
| `isBuilding(entity): boolean` | Whether an entity belongs to the running build. One set lookup, allocates nothing. |
| `onBuild(check)` | Registers "my part of the build is done" (`ui`, `renderer`); the remover is safe to call twice. |
| `adopt(entity)` | Marks an entity another plugin spawned for a building root as building (`ui`'s elements). Nothing without a build. |

The authoring helpers are pure and exported from the package root:
`component`, `tag`, `resource`, `mut`, `system`, `projection`, and `Layer`, `Order`, `Exiting`,
`Tree`. A projection whose `from` returns one plain object needs no `key`: it draws one item under
the name of the projection, and a `view` that returns one description node instead of components is
wrapped as `Tree({ node })`, which `ui` reconciles into child entities.

#### Fields another writer draws: `initialOnly`

`projection({ …, initialOnly: [[Component, fields], …] })` names fields that `view` gives a view once,
when it is born. From then on they are another writer's, a system's for one: nothing of the projection
writes or compares them. A changed item leaves them out, a motion and its `finish()` do not move
them, the check at the end of a motion does not correct them (no `world:view-corrected`), and a
rollback, `settle(entity)`, a restore and a load do not put them back. These are the rules of
`mute()`, for every view of the projection and for its whole life. A `mute()` on the view adds to
them, and its release keeps them. A `replace` moves the live views to the new list; a view a
`mute()` touched keeps the old one until it is born again. Each pair is
checked against its own component: `[[Shape, ["swep"]]]` does not compile. A pair with no field is
refused at `register` with `[game] Projection "…" lists Shape in initialOnly with no field.`. Left
out, the projection writes every field, as before.

The cost: the list is built once per spec, into one frozen table every view of the projection
shares, so a birth makes no set and the frame does no new work. The table joins the type's `owned`
fields through the same cached set as a mute (0 B a frame, `__tests__/perf/initial-only.perf.ts`).

The recipe of F91, a timer ring whose arc runs on the clock: the view draws it full, the system
draws the arc from `Now`, and the end of the fade-in keeps the arc.

```ts
// features/board/world/projections/marks.ts
export const marks = projection({
  name: "board.marks",
  layer: "marks",
  from: player => player.board.timers,
  key: timer => timer.id,
  view: timer => [TimerRing({ startedAt: timer.startedAt, ms: timer.ms }), Shape({ kind: "arc", w: 28, h: 28, sweep: 1 })],
  motion: { enter: view => { view.set(Shape, { alpha: 0 }); return view.tween(Shape, { alpha: 1 }, { ms: 200 }); } },
  initialOnly: [[Shape, ["sweep"]]] // the arc belongs to board.rings
});

// features/board/world/systems/rings.ts
export const rings = system({
  name: "board.rings",
  phase: "input",
  query: [TimerRing, Shape],
  run: (entities, { world, res }) => {
    const { now } = res(Now);

    for (const [entity, ring, shape] of entities) {
      const sweep = Math.max(0, 1 - (now - ring.startedAt) / ring.ms);

      if (shape.sweep !== sweep) world.set(entity, Shape, { sweep });
    }
  }
});
```

`resource(name, defaults | () => value)` takes plain JSON defaults, cloned into every world, or a
factory, called once per world on first read. A factory value may hold a `Map` or a function, so a
system keeps its own state in a resource. `snapshot()` leaves a value that is not JSON out.

```ts
// Per-system state of the hover look: one Map per world, dropped when the world stops.
const Looks = resource("boardLooks", () => ({ shown: new Map<Entity, { look: string }>() }));
```

#### Building the next scene aside

A live switch on a drawing renderer builds the next scene while the old one stays current, drawn and
alive (spec 31, F61 S2). The world keeps the build in a table of its own, so a projection name never
has two records:

```ts
// `scenes`, at the build start: the coming list, its layers, 4 ms a frame for ui and renderer (`buildMs: 4`).
const projection = ctx.deps.world.projection;
projection.build(["board.back", "board.items", "hud"], ctx.state.owner, scene.layers, 4); // true

// ui and renderer, every build frame: the building work fits in what is left of the frame.
projection.left(); // 3: 1 ms of the 4 ms is spent
projection.isBuilding(boardItem); // true: hold it, do not draw it, do not hit it

// `scenes`, in its `signals` callback: the frame `built()` first answers true is the swap.
projection.built(); // true
projection.setLayers(scene.layers);
projection.unmount(["ward.beds"]);
projection.commit(); // the board is mounted, nothing is building
```

- **`build`** answers `false` and touches nothing when a listed projection is mounted now under
  other layer rules (the coming list declares its `layer` or `lift` otherwise): the caller mounts in
  one block instead. Otherwise every name and its layers are checked against the coming list, as
  `mount` checks them; a projection the current scene mounts and the coming list declares alike
  (F23) is not touched; every other one is mounted at once, direct, against the committed state, and
  its views are flagged building right after their spawn (`onAdded` fires inside the spawn, before
  any flag can). A screen root draws at the `Order` of its place in the coming list from the start.
  `entityOf` does not answer for a building view, `keyOf`, `causeOf` and `entitiesOf` do. A second
  `build` while one runs throws `[game] A scene is already being built.`; an unknown name or an
  undeclared layer throws before anything is built; a `view` that throws is not logged as in a
  mount: every entity the build spawned is despawned and the throw goes on, so `enterScene` rejects
  with the old scene standing.
- **During the build** nothing of it moves: no hook runs, and the loops of its views wait. A commit
  of the store reaches the building projections too, direct, so the coming scene shows the latest
  state and a new key enters flagged building. It reaches the mounted projections both lists name
  as before. A mounted projection the coming list does not name reads no new state: it leaves at
  the commit as it stood when the switch began, as in a one-block switch, which unmounts it in the
  block that commits the next node (a ward whose buttons stepped back for a wait does not bring
  them back for the frames of the build). When a reconcile passed one over, the commit and the
  discard mark the world dirty, so one still mounted then (the old scene after an abort) reads the
  store in the next frame; a forced rerun it missed is forced again.
- **`left()`** is `budgetMs` minus the game clock time since the frame started: world reads
  `clock.now()` first thing in its `input` callback, the moment `Now` gets. The clock counts whole
  milliseconds. Negative once the frame spent more; a caller still does one unit a frame.
- **`built()`** is true when a build runs and every `onBuild` check answers true. A registration
  stays across builds.
- **`commit()`** moves the building projections into the mounted ones at the places a `mount` of
  the same list gives them, a kept one takes its new place, and every moved and kept projection
  takes the layer list `setLayers` stored just before, so the next scene compares it by identity.
  The loops of the moved views start in the next live sweep, the swap frame.
- **`discard()`** despawns every view of the build with the cause `"discard"` and no exit, then every
  entity `adopt` marked, and drops the table. The mounted projections, the layer list and the
  scene are untouched, so a later `mount` of the same names works as before.

#### `Now` — the frame's moment

`Now` (`{ now }`, exported from the package root) is the moment of the frame on the game's clock:
`world` writes `clock.now()` into it once when it starts and first thing in every `input` callback,
before the reconcile and the systems of `input`, headless too. Every system of a frame reads the same
moment, the one a node gets as `now`, so a fake clock makes it exact in tests. A running scene build
counts its frame budget (`left()`) from the same moment. A write by a system is
overwritten at the next frame. It is `0` only before the world started, and after the internal
`ecs.clear()` until the next frame. `snapshot().resources` holds it as `Now: { now }`.

A system that shows time reads it and writes its component only when its picture changes; with
`renderer.onDemand` that is when a frame is drawn.

```ts
// A toast shows the seconds left of its energy timer: it is written once a second, not every frame.
const toastTime = system({
  name: "shared.toastTime",
  phase: "animate",
  query: [ToastTime],
  run: (rows, { world, res }) => {
    const { now } = res(Now);

    for (const [entity, time] of rows) {
      const left = Math.max(0, time.until - now);

      if (Math.ceil(left / 1000) !== Math.ceil(time.left / 1000)) world.set(entity, ToastTime, { left });
    }
  }
});
```

The engine's resource names are reserved: `"Now"` (the frame's moment), `"Pointer"` (`input`),
`"AnimPlayer"` (`anim`) and `"UiCounters"` (`ui`). The first type read under one of these names is
the only one read under it; a game resource of the same name throws at its first read
`[game] world: the resource name "Now" is the engine's (the frame's moment).` with the hint to rename
it. A resource of any other name is the game's own.

### `systemTimes()` — the time per system of a debug build

`app.world.systemTimes()` answers the timing table of an agent build (`__MOKU_GAME_AGENT__`: dev
pages and `--debug` builds), `World.SystemTiming`: `names` by registration index and `ms` in the
same order, the time each system took in the current frame. The world takes the page clock from
`time.agentClock()` at start, reads it twice around every system run (the run's own error isolation
unchanged), and zeroes `ms` in place at the start of the next frame, so after a frame it holds that
frame's time. A system that comes back under the same name keeps its row; the table grows only when
a system registers past its end, never per frame. `names` is replaced by a new array when a system
of a new name registers, and stays the same array otherwise (frames, a system back under its name),
so a reader that kept it tells a new system by identity: `names !== kept`. The renderer's monitor reads it after each frame
for the five slowest systems of the frame and of the second. It is the live table, the same object
every call and never a copy, so that read allocates nothing; a reader that keeps numbers past the
frame copies them, and never writes into it. `undefined` without the flag: a release build times
nothing.

```ts
// The renderer's monitor, at the end of a frame of a debug build:
const systems = ctx.require(worldPlugin).systemTimes();
systems?.names[3]; // "ward.pan"
systems?.ms[3]; // 0.42
```

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
| `input` | write `Now` from `clock.now()` → reconcile when dirty → drop the hint buffer → systems of `input` → flush commands |
| `animate` | sweep ended motions (the driver advanced its tracks first) → forget dead elements → start the owed loops → systems of `animate` → flush |
| `layout` | systems of `layout` → flush |
| `sync` | systems of `sync` → flush |
| `signals` | record the frame history (dev builds only) → clear every change set |

The sweep does only the work there is: the live views are walked only while one may hold a motion
(every view handle made since the last sweep, or a view still moving), the dead elements are looked
for only after a despawn or a new `registerKey`, and the owed loops only while a view owes one. An
idle frame of the world allocates nothing; `__tests__/perf/` holds the budgets that prove it.

Before each system runs, the phase checks it: a system whose query has no entity, or none of
whose `scenes` is mounted or leaving, is skipped in its slot; it walks nothing and marks nothing,
and `ctx.resumed` is true on its next run ("When a system runs", below).

A phase runs its systems in registration order, with one exception: `renderer.sync` is always the
last of phase `sync`, so a system registered after the renderer started (the ui's `ui.enter`, a
feature added later) still writes before the frame is drawn.

`"paused"` and `"fast"` skip the phases `input`, `animate` and `layout`; phase `sync`, the reconcile
slot of `input` and the clear in `signals` run in every mode. A throwing system is reported with
`ctx.log.error("world:system-failed", …)` and skipped for this frame; the frame goes on. A dev
build that sees a store gain or lose a key while a phase walks it (an engine path past the command
queue) logs `ctx.log.error("world:store-changed-during-walk", { component })` once per app.

While a phase runs, `spawn`, `despawn`, `despawnOwnedBy`, `add`, `remove`, `tag` and `untag` are
queued and applied in call order when the phase ends. `set` is never queued. A queued command on an
entity that died meanwhile is dropped.

### When a system runs

A system runs once a frame in its phase, unless it is skipped. Two rules decide it, checked before
each run from what is there at that moment; together they cost a few reads and allocate nothing.

1. **Its query has an entity.** A system with a `query` is skipped while one of its terms has no
   entity: the smallest store among the terms is empty. A skipped system walks nothing, marks
   nothing with `mut()` and takes no clock read of `systemTimes()` (its row stays 0). Only store
   sizes are read: an entity that carries one term and not the others still lets the system run,
   and its walk finds nothing, as before. A system without a query is never skipped by this rule.
2. **One of its `scenes` is on screen.** `system({ ..., scenes: ["board"] })` runs only while one
   of the scenes it lists is mounted or leaving. `scenes` tells the world each scene it mounts
   (`ecs.setScene`); the scene before keeps leaving until nothing carries `Exiting` any more, so
   a system that drives a leaving root runs to the end of its exit. Any exit counts, also one of
   the next scene, so a leave may last longer than the scene's own exits, never shorter. The
   next scene's entities stand during the leave, so a system with a query that matches them too
   writes them as well: keep a `scenes` system's writes to its own scene's entities.
   Left out, a system runs on every scene. A dev build throws at start, and at a later
   `ecs.system`, for a name no feature declares as a scene:
   `[game] System "board.idle" runs on the scene "bord", which no feature declares.` A world
   without `scenes` (a test of the world alone) mounts no scene, so a system with `scenes` never
   runs there.

`ctx.resumed` is true on the first run after one or more skipped runs, whichever rule skipped them,
and false on every other run. `world.changed()` holds this frame's changes only, so a system that
keeps in a resource what it drew, or what it saw last, starts over from the components then.

The rules are the same for every system: the ones a feature lists in `systems`, the ones
`ecs.system` registers, the engine's own. Both read the world and the scene the flow mounted, never
a clock or the renderer, so two runs of one session run the same systems in every phase. A system
pays one size read per term (its stores are kept once they exist) and, with `scenes`, a comparison
with the mounted scene and the leaving ones; a phase pays one length read while no scene leaves.
Forty skipped systems cost 0 B a frame (`__tests__/perf/skip.perf.ts`).

```ts
// features/board/world/systems/idle.ts: no query, so `scenes` alone keeps it to the board.
const BoardIdle = resource("BoardIdle", { ms: 0 });
export const idle = system({
  name: "board.idle",
  phase: "animate",
  query: [],
  scenes: ["board"],
  run: (_rows, { res, time }) => {
    res(BoardIdle).ms += time.delta;
  }
});
// On the ward it is not run and BoardIdle.ms stands still. On the board it grows by each frame's
// delta. After the switch to the ward it runs while the board's elements play their exit, then
// not any more.
```

What the first rule covers with no word from the game: a component one feature puts on the
elements of another feature's JSX root (A Memory Missing's order cards inside the board) runs its
system while those elements stand; a leaving root that carries a component runs its system until
its exit ended and the root is gone; a component on the views of another feature (the hub's sweep
anchors) runs its system from the first frame those views stand. The framework test
`tests/integration/scoped-systems.test.tsx` plays the three.

**A run with no rows does not happen any more.** Work a system did whatever its rows held moves
out of its query:

| A system that … | Under the rules | Write it as |
|---|---|---|
| walks its rows and does nothing else | sleeps while it has no entity: nothing on screen changes | as it is |
| does frame work besides its rows: follows a hover, ends a press or a drop when the finger left, resets a resource when its last entity left, steps what outlives its entities | stops doing it once its query is empty | `query: []` with `scenes`, the rows read inside with `world.query()`; or a query on a component that is there whenever the work is |
| remembers in a resource what it saw last (a cue, a cache of what it drew) | misses what happened while it slept | starts over when `ctx.resumed` is true |
| works on a component every screen has (`Sprite`, `Transform`) | never sleeps | add `scenes` |

```ts
// The work does not depend on the rows: no query, and the scene it belongs to.
export const looks = system({
  name: "board.looks",
  phase: "input",
  query: [],
  scenes: ["board"],
  run: (_rows, context) => {
    // `ecs.query()` makes a walk (about 170 B) and a fresh row per match: one walk a frame here.
    const held = firstOf(context.world.query(Held, ItemInfo));

    followHand(context, context.res(BoardLooks), held);
    followHover(context, context.res(BoardLooks));
  }
});

// A cue remembered in a resource: the first run after a sleep only notes the one it finds.
export const payStars = system({
  name: "story.payStars",
  phase: "input",
  query: [PayPlan],
  run: (rows, { res, resumed, snapshot }) => {
    const watch = res(PayWatch);

    if (resumed) watch.seen = undefined;
    // … as before
  }
});
```

#### From `systemsRun` (0.15.3)

0.15.3 had `defineFeature(name, { systemsRun: "active" })`, four rules that made a feature active
(N: a node of it on the stack, S: a scene it declares mounted, V: a view of its projections, U: a
popup or JSX root of it), `ecs.hold` and `ecs.isActive`. They are gone; `ctx.resumed` stays. To
move a game:

1. Delete `systemsRun` from every feature: the type refuses it now (`never`).
2. Read every system's `run`. A system that does work outside its loop over the rows is written
   as the table above says. The rest needs nothing: it sleeps while its query is empty.
3. Add `scenes` only to a system whose entities stand on every screen, and to a system without a
   query of a feature that had `systemsRun: "active"`: it slept while its feature was not active,
   and now runs on every screen.
4. A test that asked `ecs.isActive(feature)` asks what it means: the scene
   (`app.scenes.current()`), or whether the system ran.

### The cause of a reconcile

The cause of the commit decides how the reconcile runs. The causes of one frame are merged: one
direct cause makes the reconcile direct. A direct reconcile ends with a flush: every motion of a
live view is finished, every track on its entity is cancelled, a pending `lift(false)` is applied
and the despawn queue is emptied. The flush ends the loop of a view too, so the view owes its
loop from there on: see [Motions](#motions).

| Cause | Mode | A live view whose item did not change |
|---|---|---|
| `edge` | play; direct while the world is `paused` or `fast` | skipped: its pose is not written |
| `rollback` | play; direct while the world is `paused` or `fast` | settled when it stands off its rest pose, skipped when it stands on it |
| `rerun` (`rerunAll`, `replace`) | direct | `view` runs again and the rest pose is written |
| `restore`, `load` | direct | written to its rest pose; `view` does not run again |

**When an item did not change.** An item that is the same object as before is never projected
again: `view` does not run. An item that is another object goes through `view`, and its
components are compared with the rest pose of the view. In play mode an empty diff is no change:
the new item is stored and nothing else happens. No motion of the view is cancelled, no hook runs,
nothing is written, no loose component is settled, no hint is used and `changed` of
`world:reconciled` does not count the view. So a `from` that maps or spreads may build a new
object on every commit and its views keep their motions; a game needs no frozen item table for
that. A direct reconcile projects a new object as before: its rest pose is written and it counts
as changed. A play reconcile skips a projection whose last reconcile read the same `player` and
`session` trees: `from` does not run, and it is not counted in `projections`. That is the frame
after a scene mounted its projections direct from the state its node committed.

**A rollback.** A rollback commits the state of the last rest point. The failed node committed
nothing, so no item is new and no entry brings back a view the node moved with a motion or a
timeline. So a rollback settles every live view whose item did not change and that stands off its
rest pose, exactly as `settle(entity)` does: the motions of the view are cancelled and
`motion.settle`, or the built-in `toRest` over `settleMs`, is played for the loose components. Off
its rest pose is measured field by field: a muted field does not count and a number is at rest
within 1e-6. A view that stands on its rest pose is left alone, so its motions run on. In direct
mode the rest pose is written at once, after the flush: the flush finishes the motions of the
view and a cancelled additive track writes its base back, so the rest write comes last.

A view that loops is settled like any other, and its loop runs on over the settle. What its loop
adds is no distance from the rest pose: a looping view that stands at home is left alone, and one
the node moved is settled, also when the node moved it in the very field the loop adds to. See
[Motions](#motions).

Two limits of the rollback settle:

- Only the views of mounted projections are settled. An element another plugin owns, as a `ui`
  element, stays where the node left it.
- A timeline the node started and did not await is not aborted by the failure. It may run on
  over the settle.

A restore and a load replace the state. After their reconcile every live view of every mounted
projection stands on the rest pose of the new state and no motion runs on it, whether its item
changed or not. That covers a projection whose `from` hands out the same object for the same
state, a frozen table or a constant: an aborted node finishes its animation, which leaves the views
on the end pose, and no item of the restore is new. The rest pose is written after the flush, so
nothing writes after it, also not an additive track that puts its base back when it is cancelled.
Muted fields are left out. The `loop` of a view is the one motion that comes back: the flush ends
it, and the sweep of the same frame starts it again on the rest pose.

The same reconcile brings home the elements another plugin owns, which no projection meets: every
entity with a pose recorded by `setRest`. Every track on the entity is ended with
`driver.cancelAll`, then each recorded component the entity still carries is written, muted fields
left out. A component the element dropped is not added back. An element tagged `Exiting` has its
tracks ended and keeps its place, so its owner sweeps it. The recorded pose and the registered key
of an entity that is gone are dropped before anything is written, as the sweep of the next live
frame after a despawn drops them: an owner that despawns its element leaves both behind. A pose recorded for a
projection view is skipped. Last, every `onConverged` listener runs:
the owner puts back what only it knows, as `ui` builds its roots again through its mount path. A
listener that throws is logged with `log.error("world:converged-listener-failed", …)` and the
others still run.

## Motions

A motion may carry a `loop` hook (`defineMotion` with `loop` builds it): it is played wherever `enter`
plays, kept out of the view's handles so a change never cancels it, and ends with the view.

A direct reconcile plays no hook, and its flush ends every track of a view, the loop too. Such a
view owes its loop: the flag is set when a view enters directly (a mount, a load, a restore, a
commit while the world is `paused` or `fast`) and whenever a flush ends its tracks. The sweep of
phase `animate` starts the loop of every live view that owes one and clears the flag, only while
the world is `live` and a tween driver is installed. The flag is the only trigger, so a loop starts
once. A world that comes back from `paused` or `fast` makes no reconcile of its own: its first
frame starts the owed loops. Without a driver nothing starts and the views keep owing, because the
instant default would write the end pose of the loop once. A view that enters in play mode starts
its loop at once and owes none. The `enter` hook is never played for a view that entered directly.

So the loop of a live view runs while the world is `live` and `anim` is installed. It ends with
its view. `anim.finishAll()` ends it too and owes nothing by itself; the next flush of the world
(a load, a restore, a commit in a paused or fast world) owes it again. A fast frame of the flow
that flushes no view leaves a loop standing where it is.

A new motion on a view that still animates cancels the running ones and starts from the current
values (spike P5). Components the new hooks do not drive are brought to the rest pose by
`motion.settle`, or by the built-in `toRest` over `settleMs`. When the last motion of a view ends,
every rest component is compared with the stored value, muted fields excluded (the `initialOnly`
fields of its projection too). A number counts as
at rest within 1e-6 reference units, so float noise from a root-space round trip is no difference.
A difference is written and reported with `log.warn("world:view-corrected", …)`.

The loop of a view is an additive track: it adds an offset to the rest pose and owns no
component. So it drives no component, and a settle brings a looping view home under its loop:
the settle after `enter`, of a changed item, of a revive, of `settle(entity)` and of a rollback.
The loop runs on. A track that owns its fields, also one that repeats forever, still drives its
component. An additive tween a change hook answers with drives none either: the settle brings
its component to the new rest pose next to that tween.

The offset of a loop sits in the stored value of the fields it adds to. The driver reports it
with `TweenDriver.offsetsOf`, and the world takes it off before it compares a view with its rest
pose. So the value under the loop is what counts, and three rules follow:

- A looping view that stands at home is home. No settle starts for it, no `settle` hook is called
  and no track runs: not on a rollback, on `settle(entity)`, on a commit that changes another
  component, or on a revive. A view something moved is loose in whatever field, also in the one
  its loop adds to: a bobbing view a failed node flew up comes home.
- The convergence check never corrects what the loop adds and reports no `world:view-corrected`
  for it. A real miss under a loop is corrected to the rest value with the offset on top.
- The driver keeps its own base for those fields, so a rest value the world writes directly would
  be gone with the next frame of the loop. Where a loop runs on, the world hands the rest value to
  the driver with a track of 0 ms that it finishes at once, and writes the value with the offset
  on top: a changed component without a hook, a settle hook that threw, a correction of the
  convergence check, and `settle(entity)` in a world that is not live. The base is moved before
  the write returns, so nothing that cancels the motions of the view next can lose it, and no
  motion is left that a pending `lift(false)` would wait for. In direct mode the flush cancels the loop, which
  writes its old base back, so a changed or revived view is written once more after the flush.

A driver that does not report offsets is read as "no offset": the stored value is compared as it
stands. What an additive track of such a driver adds then counts as a distance from the rest
pose.

`lift(entity, false)` on a moving view waits for its last motion. The sweep applies it when the
motion ends. Whatever ends the motions itself applies it too: the flush of a direct reconcile,
and in play mode a change, a revive, a rollback settle and `settle(entity)` that cancel the
motions of the view and start no new one. A view the finger still holds carries no pending drop
and stays lifted.

`ViewHandle.tween`, `toRest` and `all` (both take `reduced: "cut" | "keep"`: under reduced motion a `"keep"` track plays as written, `"cut"`, the default, jumps to its end) run on the driver `anim` installs with `setDriver`
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
  mode it reconciles at once, direct. What each cause does is in
  [The cause of a reconcile](#the-cause-of-a-reconcile).
- **onStart** `connectWorld` reads the scene ids every feature declares (for the dev check of
  `scenes`), then every feature description, and registers its `components`, then `systems`, then
  `projections`, in feature order; writes `Now` once from `clock.now()`; registers the five `time.onFrame` callbacks, the
  `onOwnerLeft` listener and `flow.fx.onHint`, and keeps the removers in state. Nothing is mounted:
  `scenes` or a test mounts.
- **onStop** `({ state }) => clearWorld(state)` calls the removers and drops the driver, tracks,
  views, registered keys, recorded rest poses, the `onConverged` listeners, a running scene build
  and the `onBuild` checks, the despawn queue, entities and resources, forgets the mounted scene,
  and resets the frame history. No `onRemoved` fires: `renderer` stopped earlier.

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
  nothing: it is the start of the window. Every later frame walks the change sets: a new entity is
  recorded whole, once; for a known one each marked component is compared with the shadow, with
  the filter of `snapshot()` (a value that stops being JSON is recorded as gone) and deep JSON
  equality, so a write of the same value records nothing. A value written in place without a mark
  is not recorded. A despawn, and a removed component,
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
`flow` for `features.all()`, the effective mode of a walk and `fx.onHint`, `clock` for `now()`, the
moment written into `Now` every frame. Core APIs: `ctx.log`.
