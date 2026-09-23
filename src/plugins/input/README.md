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
| `Touchable` | tag | | Takes a press with no gesture component: a tap runs the `onTap` listeners and answers nothing. `ui` tags the buttons that write local state and name no intent |
| `Held` | tag | | On the carried view, from grab to release |
| `Hovered` | tag | | On the topmost drop target under the finger during a drag. At most one, never the held view |
| `Pressed` | tag | | On the pressed view, until a tap, a long press, a grab, a swipe or a cancel |
| `PointerOver` | tag | | On the topmost view a press would take, while a mouse or a pen moves over it with no press. At most one. A touch never hovers. `ui` reads it as `is.hover` |
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

Custom behaviour is an ordinary game system on `Held`, `Hovered`, `Pressed`, `PointerOver` and `Pointer`: highlight legal cells, tilt the held item, light the item under the mouse. The lifted size of the held item is config: `heldScale`.

## API

| Method | Behaviour |
|---|---|
| `tap(target)` | Reads `Tappable` and answers `{ intent, payload }` |
| `press(target)` | The same with `Pressable` |
| `drag(from, to)` | Reads `Draggable` of `from` and `DropTarget` of `to`, answers `{ intent: target.intent, payload: { ...draggable.payload, ...target.payload } }` |
| `swipe(target, direction)` | Reads `Swipeable`, answers `{ intent, payload: { ...payload, direction } }` |
| `onTap(fn)` | Registers a listener called with the tapped entity before the `Tappable` answer; returns the remover |
| `cursor()` | The CSS cursor input last wrote on the canvas (`"pointer"` over a control, `""` elsewhere) |
| `controls.add(component)` | Counts a component type of another plugin as a control for the cursor; returns the remover. `ui` registers `LocalWrite` in `onStart` and removes it in `onStop` |

`tap`, `press`, `drag` and `swipe` return what `flow.gate.answer` returned, synchronously. Nothing moves: no coordinates, no frames, no `Held`, no `settle`. `target` is `{ projection, key }` — resolved through `world.projection.entityOf`, so a view in the despawn queue is never addressed — or an `Entity`. A missing view or a missing component warns through `ctx.log.warn`, returns `false` and never calls the gate. Nothing throws.

`onTap` is the seam `ui` uses for a button that carries `LocalWrite` and no intent: the listeners run on every tap — the finger's and `app.input.tap`'s — in registration order, before the answer. A listener that throws is logged through `ctx.log.error` with its entity, and the listeners after it still run.

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
| 2 | The queued samples are drained in order, each through `renderer.viewport.toReference`. A move of an idle mouse or pen moves `PointerOver` |
| 3 | `time.delta` is added to `pressedMs`, and the long press fires |
| 4 | While dragging: the held view is checked, its `Transform` is written and `Hovered` moves |

Determinism: no `Date.now`, no `performance.now`, no `event.timeStamp`. Every duration is a sum of `time.delta`, so `time.step(dt)` drives the machine in a test and `time.setScale` and a pause apply to it.

| World mode | The frame step |
|---|---|
| `live` | the five steps above |
| `paused` | drops the queued samples; a running drag ends as a cancel and the view settles home; a press goes idle; `PointerOver` goes; `Pointer.down` becomes false |
| `fast` | samples are dropped. With nothing in the hand no tag and no resource is written at all; a gesture that was running when the mode turned is let go like a cancel, so `Held`, the mute, the lift and the pointer gate are never left behind |

## Gesture state machine

One active pointer. A sample of any other pointer is dropped while a pointer is active: the second finger is ignored.

| State | Input | Condition | Next |
|---|---|---|---|
| `idle` | `down` | a view under the finger takes the press | `pressed` |
| `idle` | `down` | nothing under the finger | `pressed` with no entity |
| `pressed` | `move` | `Draggable`, distance from `start` > `dragStartPx` | `dragging` |
| `pressed` | frame | `Pressable`, `pressedMs` ≥ `longPressMs`, inside `tapSlopPx` | `longPressed`, answered |
| `pressed` | `up` | inside `tapSlopPx` | `idle`: every `onTap` listener runs, then `Tappable` is answered. A `Touchable` view without `Tappable` answers nothing |
| `pressed` | `up` | `Swipeable`, distance ≥ `swipeMinPx`, `pressedMs` ≤ `swipeMaxMs` | `idle`, answered |
| `longPressed` | `up` | | `idle`: the release of a long press is not a tap |
| `dragging` | `up` | | `idle`, released |
| `dragging` | frame | the held view is `Exiting` or gone | `idle`, given up |
| any but `idle` | `cancel` | `pointercancel` or a lost capture | `idle`, no answer |

A view tagged `Exiting` — in the despawn queue, playing its exit — is never pressed, hovered or dropped on. A view with only a `DropTarget` takes no press; a view with only `Touchable` does.

## Hover

Every raw sample carries its device: `pointerType` is `"mouse"`, `"touch"` or `"pen"`. A browser that cannot tell counts as a mouse.

| Sample | What happens to `PointerOver` |
|---|---|
| `move` of a mouse or a pen, no gesture running, no button down | hit test with the filter of a press; the view found gets the tag, the one before loses it |
| `move` during a press or a drag | nothing: the tag stays where it was |
| any sample of a touch | the tag goes. A touch never hovers |
| `pointercancel`, `pointerleave` of the canvas | the tag goes |
| lost capture | nothing: the browser sends one after every click |
| world mode `paused` | the tag goes |

The hit test runs once per frame, at the last hover move of the frame. A clear that comes after it in the same frame wins; a hover move after a clear wins.

At most one view carries `PointerOver`. It is not `Hovered`: that one marks the drop target under a drag.

### The cursor

After the frame's hover hit test, input writes `canvas.style.cursor`: `cursor.control` (`"pointer"`) while the view under the mouse is a control — it carries `Tappable`, `Draggable`, `Pressable`, `Swipeable` or a component another plugin registered through `controls.add`, such as ui's `LocalWrite` — and `cursor.idle` (`""`, the page's own cursor) everywhere else, on leave, on a touch and while the world is paused. A disabled or covered ui control has lost its `Tappable`, so it shows `idle`. The style is written only when it changes, and detach puts back what the canvas had. `app.input.cursor()` reads what is set.

Every queued sample calls `time.wake()`, so a finger on the screen always runs at the full frame rate, whatever the idle cap says.

## The drag

| Step | What happens |
|---|---|
| grab | tag `Held`; the rest scale is read; a view with a `Parent` leaves it (below); the scale becomes rest scale × `heldScale` (below); `world.projection.mute(entity, Transform, ["x", "y"])`, plus `"scale"` when `heldScale` is not 1; `lift(entity, true)`; `flow.gate.pointer(true)`; the offset to the finger is read last, so a view that is still sliding is picked up with no jump |
| move | `world.ecs.set(entity, Transform, …)` once per frame, from the last sample |
| hover | the topmost drop target under the finger gets `Hovered`; the old one loses it |
| release | both components read NOW; the rest scale is written back; a view that left a parent is hung back under it; with a target: `flow.gate.answer(dropAnswer(...))`. Then always, in this order: `unmute()`; `settle(entity)`, always: an accepted answer may still be refused by the node with no state change, and a commit that follows retargets from where the view is; `lift(entity, false)`; the tags go; `flow.gate.pointer(false)` |
| abort | the held view is `Exiting` or gone: `unmute()`, a view that still exists gets the rest scale back and, when it left a parent, is hung back under it, the tags go, `flow.gate.pointer(false)`. No answer, no `settle`, no `lift(false)`: the exit motion and its layer belong to the projection |

### A view with a parent

A view hosted inside another entity, such as a board inside a `ui` slot, is carried in root space. At the grab the parent is remembered, the root pose (`rootPoseOf` of `renderer`) is written into the `Transform` and the `Parent` is removed. The finger then moves the view 1:1 whatever the scale of the slot, and `lift` reaches the lift layer, which `renderer` ignores under a `Parent`. The mute covers `x`, `y`, `rotation` and `scale`, so no motion writes a parent-local value into the root pose. On the release, the cancel and the abort, the `Parent` comes back with `localPoseOf(parent, current root pose)`, so the motion home starts under the finger. A parent that left the world meanwhile is forgotten and the view keeps its root pose. `Held` stays on the view for the whole drag: `ui` does not re-host a held view.

### The lifted look

`heldScale` draws the view in the hand bigger: its rest scale in root space times `heldScale`, from the grab to the release. The rest scale is `world.projection.restOf(entity, Transform)` composed through the `Parent` chain, read before the view leaves its parent. So a board item resting at 0.5 on screen with `heldScale: 1.08` is carried at 0.54, also when a press squashed it to 0.94 just before the drag. A view with no recorded rest starts from its scale at the grab. `scale` is muted with the position, so no projection motion writes over it while the view is carried. The release, the cancel and the abort write the rest scale back before the view is hung back under its parent, so the local pose is unscaled and the way home starts at the view's own size.

A timeline step of `anim` does not read the mute. A game whose look tween may still run at the grab cancels it when the view gets `Held`. The default `1` writes no scale, and a view that keeps its place mutes only `x` and `y`.

```ts
// a merge game: the item in the hand is 8% bigger
createApp({ plugins: [...screen], pluginConfigs: { input: { heldScale: 1.08 } } });
```

The grab never reads the gate: a gate that closes for a moment on a transit node does not cancel a running drag. `unmute()` comes before `settle`, otherwise the settle motion could not write the position. A release at a closed gate returns `false` and the view starts to settle; when the gate opens inside that frame and takes the answer, the projection retargets the motion from the current values, so the item is not lost and nothing jumps. `flow.gate.pointer(true)` lasts from grab to release, so an `over` node never appears mid-drag.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tapSlopPx` | `number` | `12` | Largest move, in reference px, that still counts as a tap or a long press |
| `longPressMs` | `number` | `450` | Hold time, in ms of `time`, after which a `Pressable` answers |
| `dragStartPx` | `number` | `8` | Move, in reference px, that turns a press on a `Draggable` into a drag |
| `swipeMinPx` | `number` | `48` | Shortest swipe, in reference px |
| `swipeMaxMs` | `number` | `300` | Longest swipe, in ms of `time`, from pointer down to pointer up |
| `cursor` | `{ control: string; idle: string }` | `{ control: "pointer", idle: "" }` | CSS cursor over a control and everywhere else |
| `heldScale` | `number` | `1` | How much bigger than its rest size the view in the hand is drawn, from the grab to the release. `1` changes nothing |

```ts
createApp({ plugins: [...screen], pluginConfigs: { input: { longPressMs: 300 } } });
```

## Events

None. An answer goes down to `flow.gate` as a direct call; pointer work never goes through the event bus. Game systems read the tags and the resource.

## Dependencies

`time`, `flow`, `world`, `renderer`.

| Plugin | Used for |
|---|---|
| `time` | `onFrame("input", fn)`, `time.delta` of the callback, and `wake()` on every pointer sample |
| `flow` | `gate.answer`, `gate.pointer` |
| `world` | `ecs.get/set/add/remove/has/tag/untag/resource/mode`; `projection.mute/lift/settle/keyOf/entityOf/restOf`; the `Exiting` tag |
| `renderer` | `sync.hitTest`, `viewport.toReference`, `host.canvas`, the `Transform` and `Parent` components, the pose helpers `rootPoseOf` and `localPoseOf` of `renderer/sync/pose` |

No `pixi.js` import: the canvas is a DOM element and hit tests go through `renderer`.

## Lifecycle

`onInit` registers the frame step. `onStart` puts `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture` and `pointerleave` on `renderer.host.canvas()` and sets `touch-action: none`. Without a DOM the renderer has no canvas: nothing is attached, the plugin is inert, and `app.input.*` still answers the gate. `onStop` removes the six listeners, the frame callback, the `onTap` listeners and a mute a drag still holds, and restores the touch action.

## Not in V2

Keyboard (desktop development only), pinch, gamepad, a second pointer, a dragged stack of cards (`Draggable({ carry })`) and a gesture through many entities.
