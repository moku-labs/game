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
| `reducedMotion` | `boolean` | `false` | Start value of reduced motion (see below). The live value is state; `setReducedMotion(on)` switches it. |

Durations live in the steps and in `defineMotion` (`{ ms: 250, ease: "out" }`), never in the config:
`toRest` keeps world's `settleMs`.

## API — `app.anim`

| Member | Behaviour |
|---|---|
| `play(animation, slots)` | Builds the step tree now and starts it. Returns a `PlayHandle`: the `MotionHandle` contract over the whole tree plus `done` and `marks()`. |
| `finishAll()` | Every timeline ends at its own end, every track writes its exact target and every spawned entity is despawned. Called by the frame step in world mode `"fast"`. |
| `active()` | Tracks in the table, the delayed ones and the running loops included. `0` when nothing moves; a screen at rest with loops counts one track per loop lane. |
| `onMark(fn)` | Direct subscription next to the event. Returns the remover. |
| `reducedMotion()` | Whether reduced motion is on. |
| `setReducedMotion(on)` | Switches reduced motion on or off for every track started afterwards. |

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
defineMotion({ states?, keyframes?, transition?, loop?, on })
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

## Keyframe motions

`defineMotion` takes keyframe tracks next to its states. `on.enter` and `on.exit` name either one.

```ts
const swing = defineMotion({
  keyframes: {
    swingIn: [
      { at: 0, Transform: { dy: -780, rotation: -0.035, scale: 0.8 } },
      { at: 0.42, Transform: { dy: 14, rotation: 0.087, scale: 1.04 } }
    ], // the missing last key is the rest pose
    swingOut: [
      { at: 0.25, Transform: { dy: 10, rotation: -0.035 } },
      { at: 1, Transform: { dy: -840, rotation: 0.052, scale: 0.9 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "swingIn", exit: "swingOut" }
});
```

- A key (`Anim.MotionKeyframe`): `at` 0..1, `ease?`, `Transform?: { dx, dy, rotation, scale }`,
  `Shape | Sprite | NineSlice?: { alpha }`. `dx`/`dy` are offsets from the rest pose in reference
  units; rotation (radians), scale and alpha are absolute. A field a key leaves out holds the
  previous key's value.
- `transition.ms` is the whole track. Each segment eases by the key it ends on, default `"inOut"`;
  `transition.ease` does not apply to a track.
- Enter: the view is set to the first key (held until its `at`) and walks the keys to the rest pose
  at `at: 1`. A key at `at: 1` only gives that last segment its curve.
- Exit: from where the view is, through the keys, ending on the last key; a last key before `at: 1`
  holds to the end.
- One tween with segments per component, composed with `view.all`, so the walk runs on one clock and
  owns its fields for the whole track. A component the view does not carry is left alone.
- Definition-time errors: a track with no key, an `at` outside 0..1, keys not strictly ascending, a
  name that is both a state and a track, and an `on.enter`/`on.exit` that names neither.

## Loops

`loop: { track, ms? }` names a keyframe track that plays forever from the moment the element enters: an idle sway, a
spinning blade, a wobbling gift.

```ts
const orderCard = defineMotion({
  states: { small: { Transform: { scale: 0.8 } } },
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.25, Transform: { rotation: 0.026 } },
      { at: 0.75, Transform: { rotation: -0.026 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 250 }, // the pop-in
  loop: { track: "sway", ms: 2400 }, // one swing; ms defaults to transition.ms
  on: { enter: "small" }
});
```

- Every Transform key of a loop is an **offset added to the rest pose**: `dx`, `dy`, `rotation` and
  `scale` (`scale: 0.05` grows a scale-1 view to 1.05). `alpha` keys stay absolute. Enter and exit
  tracks keep their own rules above.
- The last key must repeat the first one, field by field; a Transform field the first key leaves out
  starts at no offset, an alpha it leaves out may not appear later. Otherwise `defineMotion` throws
  `[game] Motion loop "<name>" ends somewhere else than it starts.` A first key after `at: 0` is held
  from 0, so the cycle closes on the pose it opens with.
- `rotation` may end whole turns away from its start (a blade spins `0 → 2π`, or `0 → −2π` the other
  way; a tolerance of 1e-9 rad): the next cycle restarts at the start, which looks the same.
- `defineMotion` builds a separate `loop` hook; `enter` no longer starts it. `world` plays `loop`
  wherever it plays `enter`, outside the view's handles, so enter still resolves and the loop runs on.
  On a projection view it starts only when enter plays, never on a direct reconcile (mount, load,
  restore, fast mode); a UI element always plays it, and a changed `motion` prop swaps the loop.
- It is one additive track per component the keys name, with `repeat: "forever"`, so it layers over
  the rest pose, enter, change and settle motions: a new rest pose carries the loop along.
- It dies with its view, on `flushAll` (fast mode) and on `finishAll()`. `active()` counts it.
- A loop does not keep the clock awake: two seconds after the last `wake()` it steps at `time.idleFps`.
- `loop.ms` is one cycle; left out, it is `transition.ms`. A `loop.ms` that is not a finite number above 0 throws
  `[game] Motion loop "<name>" has ms <ms>.` A `loop.track` that names no keyframe track throws too.

## Repeat

A track with `repeat` (from `ViewHandle.tween`) walks again from its first segment when a run ends: a
number counts the extra runs, `"forever"` never ends and its motion never resolves until it is
cancelled or finished. Time past the end of a run carries into the next run; a counted track hands
the time past its last run back like any other track.

## Reduced motion

`app.anim.setReducedMotion(true)` (or `Config.reducedMotion: true` to start with it) makes every track
started afterwards take 0 ms, its delay and repeats dropped: enter and exit, state changes, change and
settle motions, drag returns and timeline tweens land on their target at the next frame step. Marks,
sounds and `wait` steps of a timeline are untouched. Every loop stands on its first key, a running
one at once, and walks on from its first key when the switch goes off. A loop that stands writes its
first key once, not every frame. Tracks already running keep their length.

```ts
// web/main.ts follows the system setting
const query = matchMedia("(prefers-reduced-motion: reduce)");

app.anim.setReducedMotion(query.matches);
query.addEventListener("change", event => app.anim.setReducedMotion(event.matches));
```

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
An additive track with keyframe segments names its offsets directly: it starts at no offset and each
segment's value is the delta it adds, so it keeps its shape whatever pose it starts on. When the last
additive track leaves, the field is written once more without offsets.

## Lifecycle

- **onInit** — registers the one `animate` frame step.
- **onStart** — reads the `animations` of every feature into the registry (a duplicate id throws),
  installs the `TweenDriver` through `world.projection.setDriver`, registers
  `flow.fx.handle("play", …, { runInFast: false })`.
- **onStop** — finishes everything, so every pending `done` resolves, then removes the driver, the
  frame callback and the handler and clears the tables.

## Doors

`control.ts` holds `game.reducedMotion` (key `reducedMotion` in `commands`) of the editor's write
door, `@moku-labs/game/control`, dev builds only. Input `{ on: "boolean" }`: it calls
`setReducedMotion(on)` and answers `reducedMotion()`. Effect `cosmetic`.

## Dependencies

`time` (the frame step, `delta`, `wake()`), `flow` (`fx.handle`, `fx.dispatch`, `features.all()`),
`world` (the driver seam, `projection.entityOf`, `restOf`, the ecs with `spawn` and `despawn`, the
`Layer` and `Order` components), `renderer` (its `Sprite`, `Transform` and `Parent` components and
the `rootPoseOf`, `localPoseOf` and `parentOf` pose helpers of `sync/pose.ts`; no API call).
