# P17: stack drag and trace gesture for the `input` plugin

**Goal: know, with measured facts, how a drag can carry a stack of cards and how one pointer can trace through many cells, on the current engine and Pixi 8.21, before any API is designed.**

Status: done. Source read in `src/` and `node_modules/pixi.js` 8.21.0. Two probes run headless (Apple M4 Pro, Node 26.9, vitest 4.0.18). Nothing was run in a browser or on a phone. Claims marked "not verified" have no probe behind them.

Run the probes:

```sh
bun x vitest run --config spikes/p17-stack-trace/vitest.config.ts
```

## 1. How `input` works today

| fact | where |
|---|---|
| The engine does its own hit test. Pixi's `EventSystem` is not used. The test is component math, because Pixi fills world matrices at render time, one frame after the input phase. | `src/plugins/renderer/sync/hit-test.ts:1-4`, `:199-223` |
| `hitTest(x, y, accept)` walks layers from the top. Per layer it sorts and flattens the whole container tree on every call, then tests each view: alpha, box in local space, clipping parents, `accept`. Cost is linear in views. | `hit-test.ts:140-155` (`topFirst`), `:167-188` (`pickIn`) |
| Children of a wrapper come before the wrapper itself. A parented view is hit before its parent. | `hit-test.ts:131-133`, `:150` |
| A press takes the topmost view with a gesture component or `Touchable`. A drop takes the topmost `DropTarget` that is not the held view and not `Exiting`. Only one entity is excluded. | `src/plugins/input/hit.ts:34-46`, `:56-60` |
| DOM listeners only queue samples. Consecutive moves of one pointer are merged: only the last move of a frame survives. | `src/plugins/input/pointer.ts:55-66` |
| The frame step drains samples, then writes the held `Transform` once per frame from the last point. | `gestures.ts:287-305`, `:334`, `:407-441`; `drag.ts:192-201` |
| One active pointer. A second finger is ignored. | `gestures.ts:248`, README "Gesture state machine" |
| Grab: tag `Held`, read rest scale, leave `Parent`, mute `Transform` fields, `lift(true)`, `gate.pointer(true)`, offset to finger. | `drag.ts:165-184` |
| Release: read both components now, scale down, re-parent, answer, then `unmute`, `settle`, `lift(false)`, untag, `gate.pointer(false)`. | `drag.ts:233-262` |
| `settle` plays the settle motion to the rest pose recorded by the projection. Rest poses are root values when `view()` sets no `Parent`. | `src/plugins/world/projection/api.ts:299-326` |
| `mute` hands fields to another writer. `lift` moves a view into the projection's `lift` layer by writing `Layer`. | `projection/types.ts:701-735`, `projection/views.ts:94-96` |
| A view with a `Parent` hangs in the parent's wrapper. Its own `Layer` is ignored (`view.layer = ""`). Inside the wrapper it sorts by `Order`. | `renderer/sync/views.ts:621-656`, `renderer/sync/layers.ts:67-76` |
| The seams: "A stack of cards needs `Draggable({ carry })`: open seam". "Word, trace: a gesture through many entities: open seam". | `.planning/specs/08-input.md:173-174`, `.planning/design/v2-screen-api/design-context.md:30` |
| Pixi's `EventSystem` is still installed: `browserAll` is loaded unless `skipExtensionImports`. It listens on the canvas and on `document` `pointermove` and hit-tests the stage on each move. The engine passes no `eventFeatures`. Cost in the game: not measured. | `node_modules/pixi.js/lib/rendering/renderers/shared/system/AbstractRenderer.mjs:57`, `environment-browser/browserAll.mjs:3`, `events/EventSystem.mjs:219-229`, `src/plugins/renderer/host/init.ts:131-140` |

## 2. Stack drag (solitaire), measured

Probe `stack.probe.ts`. Full headless app: real `world`, projection, `input`, inert renderer. Pile of 4 cards fanned 30 px. The finger takes `c2`; `c3` and `c4` lie on top. Rest y = 130, 160, 190.

| case | what the probe did | result |
|---|---|---|
| A: followers hang under the held card | Followers: mute `x, y, rotation, scale`, add `Parent(held)`, write `localPoseOf(held, rootPose)`. Only the held card is written per frame. | Carried to `400,300 / 400,330 / 400,360`. Rigid, one write per frame. A reconcile frame keeps the `Parent`: the projection never touches components `view()` does not return. |
| A, settle while still parented | `unmute`, `settle` all, no unparent first. | **Wrong.** Followers end at `200,290` and `200,320`. The root rest pose is read as a local pose under the held card. Rest + held rest = 100+100, 160+130. |
| A': unparent before settle | Per follower: write root pose, remove `Parent`, `lift(true)`. Then `unmute`, `settle`, `lift(false)`. | Correct. Home = rest. Midway after one frame all three are at the same offset (`373,285 / 373,315 / 373,345`): one settle duration, so the stack flies home as one piece. |
| B: every card written each frame | Mute `x, y` and `lift(true)` per card, bottom first. Each frame: `Transform = finger + offset_i`. | Correct. Carried and home = rest. `Order` stays 1, 2, 3. N writes per frame instead of 1. |
| Renderer: where a follower is drawn | Mock renderer over fake Pixi. Follower under `Parent(held)`. | Drawn in the held card's wrapper, inside `layer:lifted`. `view.layer = ""`. So the followers ride the lift with no `lift` call. |
| Drop lookup during a carry | `hitTest` at a point over the follower, accept = everything but the held card (what `acceptDrop` does). | Returns the **follower**. At the overlap strip the follower is hit before the held card (children first). Today's `acceptDrop` must exclude the whole carried set. |
| Scripted door | `app.input.drag(c2, c4)` today. | Answer accepted. Followers do not move (the door moves nothing, by design). Payload names only `from: c2`. |

What the probe shows:

- Both ways work with existing public calls. No Pixi change.
- Reparenting (A') costs one `Transform` write per frame. It must undo the `Parent` before `settle`, in the same order `drag.ts` already uses for the held card (`drag.ts:243-255`).
- Move-each (B) needs no pose math. It costs N writes per frame and N `lift` calls. With a `lift` layer of sort `"none"`, the order is the order of the `lift` calls. Bottom first is required. Renderer order with `"none"`: not verified in a real Pixi frame.
- A view that is already parented (a board in a `ui` slot) makes A' and B both go through `rootPoseOf` first, as `unparent` does now (`drag.ts:49-62`). Not probed with a parented pile.
- `heldScale` with a stack: in A' a scale on the held card scales the followers around the held pivot for free. In B each card scales around its own pivot and the fan spacing does not grow. Not probed.
- Abort (the held card despawns mid-drag): in A the followers lose their parent entity. The renderer warns "parent draws nothing" and detaches them (`views.ts:631-635`). Abort must unparent followers first. Not probed.

## 3. Trace gesture (word games), measured

Probe `trace.probe.ts`. Cells 64 px with an 8 px gap (pitch 72). Same answers checked across all three methods on 500 points.

### Hit-test cost

20 000 random points over the grid, after 200 warm-up calls.

| method | 100 cells | 400 cells | note |
|---|---|---|---|
| engine `renderer.sync.hitTest` (real sync module, fake Pixi) | 6.85 µs | 29.90 µs | Linear. Sort + flatten of the tree on every call (`hit-test.ts:143`) and a pose walk per candidate. |
| Pixi `EventBoundary.hitTest` (real Pixi, `hitArea` rectangles, `eventMode: "static"`) | 1.38 µs | 5.28 µs | Linear. Needs `worldTransform`, which Pixi fills at render: one frame late for the input phase. Needs `import "pixi.js/events"` for `isInteractive`. |
| grid math (cell = round((p - origin) / pitch), then a box test) | 0.02 µs | 0.02 µs | Constant. Only for a regular grid. |

A frame with 10 samples on 400 cells through the engine hit test: **0.27 ms**. Budget of a 60 Hz frame: 16.7 ms. The engine hit test is cheap enough for a trace. Pixi's own hit test is not needed.

### Segment sampling, diagonals, backtracking

| case | result |
|---|---|
| Fast swipe from cell 0 to cell 9 between two frames. Hit test at the frame point only. | `[0, 9]`: 8 cells lost. Today `record` keeps only the last move per frame (`pointer.ts:61`), so this is the real behaviour on a fast finger. |
| Same swipe, sampled every 32 px (half a cell) from the last point to the new one | `[0..9]`: all 10 cells, in order. |
| Same swipe, sampled every 100 px (more than the pitch) | `[0,1,3,4,5,6,8,9]`: cells 2 and 7 lost. The step must be below the smallest cell span. |
| Diagonal 0→33, drawn 10 px below the centre line, full box hit | `[0, 11, 22, 33]`: fine. |
| Same diagonal 20 px or 26 px off, full box hit | `[0, 10, 11, 21, 22, 32, 33]`: the line cuts the corners of neighbour cells. |
| Same diagonal 20 px or 26 px off, inset circle r = 0.4 × pitch | `[0, 11, 22, 33]`: correct. Word games need a trace hit shape smaller than the visual box. |
| Path 0→1→2→1→11→0. Rule: a new cell appends, the cell before the last pops, any other used cell is ignored | `[0, 1, 11]`: backtrack works with the last two cells only. |

### Browser facts

| fact | source |
|---|---|
| `PointerEvent.getCoalescedEvents()` gives every move merged into one `pointermove`. Chrome 58, Firefox 59, Safari and iOS Safari 18.2, WebViews mirror. Secure context only. | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents , https://github.com/mdn/browser-compat-data/blob/main/api/PointerEvent.json |
| Segment sampling between frame points is enough for straight moves. Coalesced events matter only for a curve inside one frame. Not verified on a device. | probe above |
| Pixi `eventMode`: `none` skips the subtree, `passive` (default) tests only children, `static` is hit-tested, `dynamic` also gets synthetic moves while the pointer is idle. `interactiveChildren = false` skips children. `hitArea` prunes. | https://pixijs.com/8.x/guides/components/events , `EventBoundary.mjs:302-358` |
| Pixi maps every `pointermove` to `pointerout` / `pointerover` with one hit test per move, also for touch. | `EventBoundary.mjs:412-485` |
| Pixi `pointerover` on touch has a known issue: hover and down fire synchronously, and a view changed on `pointerover` can miss the following `pointerdown`. | https://github.com/pixijs/pixijs/issues/11321 |
| Pointer capture (which `input` already takes on down, `gestures.ts:69-80`) keeps all moves on the canvas while the finger is down. | https://github.com/pixijs/pixijs/issues/6346 |

Conclusion for trace: do not use Pixi `pointerover`. It is per DOM event, not per frame, it is not deterministic under `time.step`, and it uses world matrices that lag one frame. The engine already has the right pieces: the queued samples, the frame step and `renderer.sync.hitTest`. What is missing: keep the previous point, sample the segment, use a smaller hit shape, and a path reducer.

## Decision input for design

1. **Stack: `Draggable({ payload, carry: ["c3", "c4"] })`, keys of the same projection, carried by reparenting (A').**
   Plus: data only, like the rest of `input`. One write per frame. Followers ride the lift layer for free. `heldScale` scales the fan as one piece.
   Minus: must unparent before `settle` and on abort, else followers land wrong or vanish (measured). `acceptDrop` must exclude the carried set (measured). Breaks for a pile that is already under a `Parent` unless the root pose is written first. The `view()` must name the keys, so the game computes "cards on top" in `view`.

2. **Stack: same component, carried by moving each card (B).**
   Plus: no pose math, no `Parent` juggling. Each card settles on its own. Same code path as the single drag, looped.
   Minus: N writes, N mutes, N lifts per drag. Lift order depends on call order in a `"none"` lift layer. `heldScale` does not widen the fan. Still needs the carried set excluded from the drop lookup.

3. **Trace: a new component `Traceable({ intent, payload, radius? })` and one `answer` on release with `payload: { path: [payload, ...] }`.**
   The engine samples the segment from the last frame point at half the smallest cell, hit-tests with an inset radius, keeps the path with the "pop the cell before last" rule, and tags each cell in the path (`Traced`) so a game system draws the line. A tap on one cell is a path of one.
   Plus: one answer per gesture fits `flow.gate`. The engine hit test costs 0.27 ms per frame for 400 cells.
   Minus: a new phase in the gesture machine. Adjacency (word grid) versus free order (word wheel) is a rule the engine cannot know: it needs an `adjacent?` option or the game checks on the answer. A live preview ("current word") needs a resource, e.g. `Trace { path }`, readable each frame.

Alternative to 3: no component. Expose `Pointer` with the frame segment (`from`, `to`) and let the game system hit-test. Less engine code. Each word game rewrites sampling and backtracking, the same 60–80 lines the V2 design rejected for drag.
