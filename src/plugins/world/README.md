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
| `mode()` / `setMode(mode)` | `mode()` is the effective mode: `"fast"` while the flow walks fast, else the stored one. |
| `snapshot()` | The world as plain JSON, sorted by index. A value that is not JSON, and every `Tree`, is skipped and named. |

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
| `signals` | clear every change set |

`"paused"` and `"fast"` skip the phases `input`, `animate` and `layout`; phase `sync`, the reconcile
slot of `input` and the clear in `signals` run in every mode. A throwing system is reported with
`ctx.log.error("world:system-failed", …)` and skipped for this frame; the frame goes on.

While a phase runs, `spawn`, `despawn`, `despawnOwnedBy`, `add`, `remove`, `tag` and `untag` are
queued and applied in call order when the phase ends. `set` is never queued. A queued command on an
entity that died meanwhile is dropped.

## Motions

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
  views, registered keys, recorded rest poses, the despawn queue, entities and resources. No `onRemoved` fires: `renderer` stopped earlier.

## Dependencies

`time` for the five frame phases, `model` for the `model:committed` hook and `store.snapshot()`,
`flow` for `features.all()`, the effective mode of a walk and `fx.onHint`. Core APIs: `ctx.log`.
