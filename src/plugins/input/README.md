# input

> Standard plugin — the finger of the game. Behaviour is data: a view carries `Tappable`, `Pressable`, `Draggable`, `DropTarget` or `Swipeable`, and the engine turns a gesture into one `Answer` for `flow.gate`.

The drop TARGET names the intent. The engine owns the pointer capture, the lifting, the target lookup, the closed gate and the way home through `world.projection.settle`. A game writes no drag code.

`app.input.*` is the same door for a test, an agent and the finger: both build the answer with the same functions of `answers.ts`.

## Behaviour as data

| Name | Kind | Defaults | Meaning |
|---|---|---|---|
| `Tappable({ intent, payload? })` | component | `{ intent: "", payload: {} }` | A tap answers `{ intent, payload }` |
| `Pressable({ intent, payload? })` | component | same | A long press answers `{ intent, payload }` |
| `Draggable({ payload? })` | component | `{ payload: {} }` | The view can be carried. It names no intent |
| `DropTarget({ intent, payload? })` | component | same as `Tappable` | A drop here answers THIS intent |
| `Swipeable({ intent, payload? })` | component | same as `Tappable` | A swipe answers `{ intent, payload: { ...payload, direction } }` |
| `Held` | tag | | On the carried view, from grab to release |
| `Hovered` | tag | | On the topmost drop target under the finger. At most one, never the held view |
| `Pressed` | tag | | On the pressed view, until a tap, a long press, a grab, a swipe or a cancel |
| `Pointer` | resource | `{ x: 0, y: 0, down: false, justPressed: false, justReleased: false }` | Reference coordinates. `justPressed` and `justReleased` last one frame |

Payloads are plain JSON objects of model keys, never entity ids. An empty `intent` is a dev warning through `ctx.log.warn` that names the projection. `Draggable` plus `Swipeable` on one view: `Draggable` wins, one warning per press. A `Draggable` view with no projection key cannot be carried — `mute`, `lift` and `settle` belong to a projection — so the grab is refused with one warning.

```ts
// game side: behaviour inside a projection `view`
view: item => [
  sprite({ texture: `board.item-${item.kind}-${item.level}`, at: cellCenter(item.cell) }),
  Draggable({ payload: { from: item.cell } }),
  DropTarget({ intent: "merge", payload: { to: item.cell } })
]
```

Custom behaviour is an ordinary game system on `Held`, `Hovered`, `Pressed` and `Pointer`: highlight legal cells, tilt the held item.

## API

| Method | Behaviour |
|---|---|
| `tap(target)` | Reads `Tappable` and answers `{ intent, payload }` |
| `press(target)` | The same with `Pressable` |
| `drag(from, to)` | Reads `Draggable` of `from` and `DropTarget` of `to`, answers `{ intent: target.intent, payload: { ...draggable.payload, ...target.payload } }` |
| `swipe(target, direction)` | Reads `Swipeable`, answers `{ intent, payload: { ...payload, direction } }` |

Each returns what `flow.gate.answer` returned, synchronously. Nothing moves: no coordinates, no frames, no `Held`, no `settle`. `target` is `{ projection, key }` — resolved through `world.projection.entityOf`, so a view in the despawn queue is never addressed — or an `Entity`. A missing view or a missing component warns through `ctx.log.warn`, returns `false` and never calls the gate. Nothing throws.

```ts
// a view spawned by the last commit exists after the next reconcile
app.time.step(16);
expect(
  app.input.drag({ projection: "board.items", key: "i5" }, { projection: "board.items", key: "i7" })
).toBe(true);
```

## The frame step

The DOM handlers do one thing: turn a pointer event into a raw sample and queue it. They hit-test nothing, answer nothing and write no component. Everything else runs in one `time.onFrame("input")` callback, registered in `onInit` — before `world` registers its own `input` callback in its `onStart` — so `Pointer`, `Held`, `Hovered` and `Pressed` are fresh when game systems of phase `input` read them.

| Step | What happens |
|---|---|
| 0 | `renderer.host.canvas()` is compared with the attached canvas. A new one is a WebGPU device restore: the listeners move, and a gesture in progress gets a cancel, so a drag settles home |
| 1 | `justPressed` and `justReleased` of `Pointer` are cleared |
| 2 | The queued samples are drained in order, each through `renderer.viewport.toReference` |
| 3 | `time.delta` is added to `pressedMs`, and the long press fires |
| 4 | While dragging: the held view is checked, its `Transform` is written and `Hovered` moves |

Determinism: no `Date.now`, no `performance.now`, no `event.timeStamp`. Every duration is a sum of `time.delta`, so `time.step(dt)` drives the machine in a test and `time.setScale` and a pause apply to it.

| World mode | The frame step |
|---|---|
| `live` | the five steps above |
| `paused` | drops the queued samples; a running drag ends as a cancel and the view settles home; a press goes idle; `Pointer.down` becomes false |
| `fast` | samples are dropped. With nothing in the hand no tag and no resource is written at all; a gesture that was running when the mode turned is let go like a cancel, so `Held`, the mute, the lift and the pointer gate are never left behind |

## Gesture state machine

One active pointer. A sample of any other pointer is dropped while a pointer is active: the second finger is ignored.

| State | Input | Condition | Next |
|---|---|---|---|
| `idle` | `down` | a view under the finger takes the press | `pressed` |
| `idle` | `down` | nothing under the finger | `pressed` with no entity |
| `pressed` | `move` | `Draggable`, distance from `start` > `dragStartPx` | `dragging` |
| `pressed` | frame | `Pressable`, `pressedMs` ≥ `longPressMs`, inside `tapSlopPx` | `longPressed`, answered |
| `pressed` | `up` | `Tappable`, inside `tapSlopPx` | `idle`, answered |
| `pressed` | `up` | `Swipeable`, distance ≥ `swipeMinPx`, `pressedMs` ≤ `swipeMaxMs` | `idle`, answered |
| `longPressed` | `up` | | `idle`: the release of a long press is not a tap |
| `dragging` | `up` | | `idle`, released |
| `dragging` | frame | the held view is `Exiting` or gone | `idle`, given up |
| any but `idle` | `cancel` | `pointercancel` or a lost capture | `idle`, no answer |

A view tagged `Exiting` — in the despawn queue, playing its exit — is never pressed, hovered or dropped on. A view with only a `DropTarget` takes no press.

## The drag

| Step | What happens |
|---|---|
| grab | tag `Held`; `world.projection.mute(entity, Transform, ["x", "y"])`; `lift(entity, true)`; `flow.gate.pointer(true)`; the offset to the finger is read last, so a view that is still sliding is picked up with no jump |
| move | `world.ecs.set(entity, Transform, …)` once per frame, from the last sample |
| hover | the topmost drop target under the finger gets `Hovered`; the old one loses it |
| release | with a target: `flow.gate.answer(dropAnswer(...))`, both components read NOW. Then always, in this order: `unmute()`; `settle(entity)`, always: an accepted answer may still be refused by the node with no state change, and a commit that follows retargets from where the view is; `lift(entity, false)`; the tags go; `flow.gate.pointer(false)` |
| abort | the held view is `Exiting` or gone: `unmute()`, the tags go, `flow.gate.pointer(false)`. No answer, no `settle`, no `lift(false)`: the exit motion and its layer belong to the projection |

The grab never reads the gate: a gate that closes for a moment on a transit node does not cancel a running drag. `unmute()` comes before `settle`, otherwise the settle motion could not write the position. A release at a closed gate returns `false` and the view starts to settle; when the gate opens inside that frame and takes the answer, the projection retargets the motion from the current values, so the item is not lost and nothing jumps. `flow.gate.pointer(true)` lasts from grab to release, so an `over` node never appears mid-drag.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tapSlopPx` | `number` | `12` | Largest move, in reference px, that still counts as a tap or a long press |
| `longPressMs` | `number` | `450` | Hold time, in ms of `time`, after which a `Pressable` answers |
| `dragStartPx` | `number` | `8` | Move, in reference px, that turns a press on a `Draggable` into a drag |
| `swipeMinPx` | `number` | `48` | Shortest swipe, in reference px |
| `swipeMaxMs` | `number` | `300` | Longest swipe, in ms of `time`, from pointer down to pointer up |

```ts
createApp({ plugins: [...screen], pluginConfigs: { input: { longPressMs: 300 } } });
```

## Events

None. An answer goes down to `flow.gate` as a direct call; pointer work never goes through the event bus. Game systems read the tags and the resource.

## Dependencies

`time`, `flow`, `world`, `renderer`.

| Plugin | Used for |
|---|---|
| `time` | `onFrame("input", fn)`, and `time.delta` of the callback |
| `flow` | `gate.answer`, `gate.pointer` |
| `world` | `ecs.get/set/has/tag/untag/resource/mode`; `projection.mute/lift/settle/keyOf/entityOf`; the `Exiting` tag |
| `renderer` | `sync.hitTest`, `viewport.toReference`, `host.canvas`, the `Transform` component |

No `pixi.js` import: the canvas is a DOM element and hit tests go through `renderer`.

## Lifecycle

`onInit` registers the frame step. `onStart` puts `pointerdown`, `pointermove`, `pointerup`, `pointercancel` and `lostpointercapture` on `renderer.host.canvas()` and sets `touch-action: none`. Without a DOM the renderer has no canvas: nothing is attached, the plugin is inert, and `app.input.*` still answers the gate. `onStop` removes the five listeners, the frame callback and a mute a drag still holds, and restores the touch action.

## Not in V2

Keyboard (desktop development only), pinch, gamepad, a second pointer, a dragged stack of cards (`Draggable({ carry })`) and a gesture through many entities.
