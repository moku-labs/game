# anim

The one tween core of the engine and the choreographies over it. **Complex tier**: flat files plus
the `tween/` and `timeline/` sub-directories.

A **track** drives the numeric fields of one component of one entity from the values it reads when
its delay ends to an exact target. A **timeline** is plain frozen data built by a pure function of
typed slots and walked step by step from `time.delta`. Three doors feed the same track table:
`ViewHandle.tween` / `toRest` / `all` of a projection, a `tween` step of a timeline, and the
`motion` prop of a UI element.

Animation is text: a TypeScript module next to the feature, no asset format, no callbacks. `mark`
is the only way out.

## Config

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxTracks` | `number` | `2000` | Dev guard. One `ctx.log.warn` each time the running track count rises past it. |

Durations live in the steps and in `defineMotion` (`{ ms: 250, ease: "out" }`), never in the config:
`toRest` keeps world's `settleMs`.

## API — `app.anim`

| Member | Behaviour |
|---|---|
| `play(animation, slots)` | Builds the step tree now and starts it. Returns a `PlayHandle`: the `MotionHandle` contract over the whole tree plus `done` and `marks()`. |
| `finishAll()` | Every timeline ends at its own end, every track writes its exact target and every spawned entity is despawned. Called by the frame step in world mode `"fast"`. |
| `active()` | Tracks in the table, the delayed ones included. `0` when nothing moves. |
| `onMark(fn)` | Direct subscription next to the event. Returns the remover. |

## Events

| Event | Payload | When |
|---|---|---|
| `anim:mark` | `{ animation, mark }` | A `mark` step was reached, or jumped by `finish()`. |
| `anim:finished` | `{ animation }` | A timeline ended or was finished. Never on `cancel()`. |

## Helpers (pure, exported from the package root)

```ts
defineAnimation(id, { slots, build })   // slots: { name: type<Target>() | type<Target[]>() }
sequence(...steps)  parallel(...steps)  stagger(items, ms, item => Step)  wait(ms)  mark(name)
tween(target, Component, to, { ms, ease?, delayMs?, additive?, space? })   set(target, Component, patch)
frames(target, { keys, fps, loop? })    // writes Sprite.texture, one key per frame
spawn(id, components, { layer?, order? }) // a temporary entity, made when the step is reached
spawned(id)                             // the target of an entity a spawn step of this timeline made
sfx(key, { bus? })   haptic(kind)       // descriptors anim owns; audio and platform own the handlers
use(animation, slots, tools?)           // nests one animation; pass the outer tools when it reads `at`
play(animation, slots)                  // the fx descriptor a node awaits
external(player, clip)                  // reserved for Spine: always throws
defineMotion({ states, transition?, on })
```

A `Target` is a projection key `{ projection, key }`, an entity, or `spawned(id)`.

`Component` in `tween` and `set` is any component handle `world.ecs` takes: the root `Transform`
and `Sprite`, and the kit's `Sprite` and `NineSlice` that `defineGame` narrows to the game's asset
keys. The kit component passes as it is: `tween(target, Sprite, { alpha: 0 }, { ms: 100 })`.

`build(slots, { at })` runs once per play, so the same animation may play twice at once. `at(target)`
resolves the target through `world.projection.entityOf` and answers its **root pose**: the rest
`Transform` composed through the `Parent` chain (`rootPoseOf` of `renderer`, every pivot applied), so
a flight lands on a cell inside a scaled board slot. An entity without a parent answers its rest
`Transform` as is. A target nothing resolves gives `{ x: 0, y: 0, rotation: 0, scale: 1 }` and one
warning.

## Tween space

A `tween` writes the target's own `Transform`, which is local to its `Parent`. `at()` answers a root
pose. To aim a hosted view at another element, name the root space:

```ts
// An order is delivered: the board item flies out of the scaled board slot onto the order card.
const deliverFly = defineAnimation("orders.deliverFly", {
  slots: { item: type<Target>(), card: type<Target>() },
  build: ({ item, card }, { at }) =>
    tween(item, Transform, { x: at(card).x, y: at(card).y, scale: at(card).scale }, {
      ms: 400, ease: "inCubic", space: "root"
    })
});
app.anim.play(deliverFly, {
  item: { projection: "board.items", key: "i1" },
  card: { projection: "hud", key: "card0" }
});
// 400 ms later the item covers the card at the card's size; its Transform stays slot-local
```

- `space: "local"` is the default: the fields are written into the `Transform` as they are.
- `space: "root"`: the `x`, `y`, `rotation` and `scale` of a `Transform` are a root pose. When the
  track starts, or when a finished timeline writes a step that never started, they are turned into
  the space of the target's `Parent` with `localPoseOf` of `renderer`.
- A field the step does not name stays where it is. Under a turned parent, name `x` and `y`
  together.
- A target without a `Parent`, and a component other than `Transform`, move as in the local space.
- The step data carries the space: `{ kind: "tween", ..., space: "root" }`.

## Spawned entities

```ts
const coinsFly = defineAnimation("hud.coinsFly", {
  slots: { from: type<Target>(), to: type<Target>() },
  build: ({ from, to }, { at }) =>
    sequence(
      spawn("coin1", [
        Sprite({ texture: "ui.icon-coin", width: 64, height: 64, fit: "contain" }),
        Transform({ x: at(from).x, y: at(from).y })
      ], { order: 50 }),
      tween(spawned("coin1"), Transform, { x: at(to).x, y: at(to).y }, { ms: 600, ease: "inCubic" }),
      mark("landed")
    )
});
```

- `spawn(id, components, { layer?, order? })` is frozen plain data: the component values
  `world.ecs.spawn` takes, the layer (`"ui"` by default) and the order (`0` by default). `build`
  stays pure.
- The entity is made when the step is reached, owned by `anim` (`{ kind: "plugin", name: "anim" }`),
  with `Layer` and `Order` added from the options. Later steps aim at it with `spawned(id)`.
- Every entity a timeline spawned is despawned when the timeline ends, is finished (`finish()`,
  `finishAll()`, the abort of the node that played it) or is cancelled. Finishing a timeline
  before a `spawn` step is reached spawns nothing.
- A spawned id names one entity of one timeline: two plays of the same animation each spawn their
  own. One timeline that spawns an id twice (nested `use` included) throws at build time:
  `[game] Animation "hud.coinsFly" spawns "coin1" twice.` A step aimed at an id no `spawn` step
  reached yet ends silently.
- `at(spawned(id))` answers the current `Transform` of the spawned entity, composed through its
  `Parent` chain. `build` runs before any step is reached, so inside `build` the id is not there
  yet: `at` gives the identity pose and one warning.
- Spawn ids are flat across nested `use`: an animation that spawns cannot be `use`d twice in one
  timeline. Name each spawned entity (`sparkle1` … `sparkle12`) in the animation that makes it.
- `Animation.playing` counts the tracks of a spawned entity, not its timeline: the entity lives
  exactly as long as the timeline.

## Component

`Animation({ playing })` — how many tracks and running timelines name the entity. Added at the
first one, removed at zero. `anim` never reads it; the inspector and `ui.lint` do.

## How a frame runs

`time.onFrame("animate")`, registered in `onInit`, so it runs before world's own `animate`
callback and the sweep of the same frame sees the tracks it just advanced.

| World mode | The step |
|---|---|
| `"live"` | The timelines consume `time.delta` first — a track a step just started takes the remainder at once — then every other track advances. |
| `"paused"` | Nothing moves. |
| `"fast"` | `finishAll()`. |

Additive tracks advance before the absolute ones, so the absolute owner of a field writes the sum
of this frame's offsets. Determinism: no `Date.now`, no `performance.now`, no `Math.random`, no
timers, no `pixi.js` import.

## Retarget and offsets

A new absolute track on a field cancels the older owner **of that field**; a track that loses every
field ends where it stands. An additive track never owns a field: it contributes
`(to − from) × ease(t)` to the field's offsets, and every write of that field is `base + Σ offsets`.
When the last additive track leaves, the field is written once more without offsets.

## Lifecycle

- **onInit** — registers the one `animate` frame step.
- **onStart** — reads the `animations` of every feature into the registry (a duplicate id throws),
  installs the `TweenDriver` through `world.projection.setDriver`, registers
  `flow.fx.handle("play", …, { runInFast: false })`.
- **onStop** — finishes everything, so every pending `done` resolves, then removes the driver, the
  frame callback and the handler and clears the tables.

## Dependencies

`time` (the frame step, `delta`, `wake()`), `flow` (`fx.handle`, `fx.dispatch`, `features.all()`),
`world` (the driver seam, `projection.entityOf`, `restOf`, the ecs with `spawn` and `despawn`, the
`Layer` and `Order` components), `renderer` (its `Sprite`, `Transform` and `Parent` components and
the `rootPoseOf`, `localPoseOf` and `parentOf` pose helpers of `sync/pose.ts`; no API call).
