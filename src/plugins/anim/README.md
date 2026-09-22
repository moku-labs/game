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
| `finishAll()` | Every timeline ends at its own end and every track writes its exact target. Called by the frame step in world mode `"fast"`. |
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
tween(target, Component, to, { ms, ease?, delayMs?, additive? })   set(target, Component, patch)
frames(target, { keys, fps, loop? })    // writes Sprite.texture, one key per frame
sfx(key, { bus? })   haptic(kind)       // descriptors anim owns; audio and platform own the handlers
use(animation, slots, tools?)           // nests one animation; pass the outer tools when it reads `at`
play(animation, slots)                  // the fx descriptor a node awaits
external(player, clip)                  // reserved for Spine: always throws
defineMotion({ states, transition?, on })
```

`build(slots, { at })` runs once per play, so the same animation may play twice at once. `at(target)`
resolves the target through `world.projection.entityOf` and answers its `Transform`; a target
nothing resolves gives `{ x: 0, y: 0, rotation: 0, scale: 1 }` and one warning.

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
`world` (the driver seam, `projection.entityOf`, the ecs), `renderer` (its `Sprite` and `Transform`
components; no API call).
