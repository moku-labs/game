# P18: scroll windowing for the `scroll` tag

**Goal: know what a long `scroll` costs today, and what windowing (only the rows in view plus a margin are entities) needs from the reconciler, before the API is designed.**

Status: measured. Headless in plain Bun (real `ui`, real Yoga, inert renderer) and in Chromium 1243 headless on WebGPU (real renderer). Mac arm64, Bun 1.3.14, yoga-layout 3.2.1, pixi.js 8.21.0. Windowing was emulated in spike code only; `src/` is untouched. "Not verified" marks claims without a measurement or a primary source.

Files: `probe.tsx` (headless, writes `metrics.json`), `browser.tsx` + `index.html` + `serve.ts` (page on port 3118), `drive.ts` (playwright-core, writes `metrics-browser.json`, `shots/`).

Test list: rows of 5 elements (`row`, avatar `stack`, two fixed-size `text`, `button`), row height 120 u, scroll viewport 1600 u (14 rows), margin 5 rows each side. Viewport 1080 × 1920 u.

## How `scroll` works today

| fact | source |
|---|---|
| A `scroll` gets one ui-owned content child. All markup children go under it. | `src/plugins/ui/jsx/reconcile.ts:100` (`childrenOf`) |
| The container carries `Touchable` and `Scroll { axis, offset, min }`. Horizontal throws. | `reconcile.ts:241`, `reconcile.ts:201`, `src/plugins/ui/components.ts:71` |
| A re-render never patches `Scroll`, so the offset survives. | `reconcile.ts:660` |
| Each frame, the scroll step moves the content while the container is `Pressed`. It does one `Transform.y` write. No solve, no motion. | `src/plugins/ui/layout/scroll.ts:49-83` |
| `min = container.h - content.h` is read from the solved content rect, so the content must have its full height. | `scroll.ts:75` |
| The step runs at the end of `reconcile`, after the dirty roots were diffed. | `reconcile.ts:1167` |
| Every frame, `scrollContainers()` walks all elements to find the scroll tags. That is O(elements) on idle frames. | `reconcile.ts:1083-1090` |
| No momentum and no fling. The offset follows the finger only while pressed. | `scroll.ts`, spec `.planning/specs/14-ui.md:200` |
| The view cannot read the offset. Nothing marks a root dirty on scroll. A re-render only comes from a `Tree` change, a local write (`tap.ts:36-40`), a field, or the viewport. | `reconcile.ts:1111`, `src/plugins/ui/jsx/tap.ts:36` |
| A dirty root re-runs every component view in it and diffs every element. There is no subtree-only re-render. | `reconcile.ts:1072`, `reconcile.ts:735` |
| One entity and one Yoga node per element. The node is created at enter and freed at despawn. | `src/plugins/ui/layout/nodes.ts:16-66` |
| A changed child list re-places all children of that parent once: remove all, then insert in order. | `nodes.ts:74`, `reconcile.ts:841` |
| One `calculateLayout` per marked root. Never per frame, never on scroll (P4). | `src/plugins/ui/layout/solve.ts:138`, `spikes/p4-layout/RESULT.md` §3 |
| Identity is parent identity + `key ?? type@index` + type. A keyed row that stays in the window keeps its entity. | `reconcile.ts:118` |
| An element that leaves goes to `exiting`. Its component instances are dropped, so local state is lost. It leaves the Yoga flow at once (P4 policy "leave"). It despawns in a later `sweep`. | `reconcile.ts:853-856`, `src/plugins/ui/jsx/instances.ts:102`, `reconcile.ts:945` |
| The renderer makes one view per entity. It has no culling: off-screen rows are drawn too, only masked by `Shape.clip`. | `grep -ri cull src/plugins/renderer` finds nothing; `views` = entities in `metrics-browser.json` |

## Cost today (mode "full") vs emulated window

Headless, `metrics.json`. Frame = one `app.time.step(16)`.

| rows | mode | ui entities | Yoga nodes | mount ms | idle frame p50 ms | drag frame p50 ms | full re-render p50 / p95 ms |
|---|---|---|---|---|---|---|---|
| 50 | full | 255 | 255 | 14.1 | 0.023 | 0.020 | 2.0 / 3.5 |
| 50 | window | 102 | 102 | 5.2 | 0.009 | 0.008 | 0.7 / 0.9 |
| 200 | full | 1005 | 1005 | 17.6 | 0.034 | 0.034 | 7.2 / 9.0 |
| 200 | window | 102 | 102 | 4.5 | 0.004 | 0.004 | 0.6 / 0.9 |
| 1000 | full | 5005 | 5005 | 73.5 | 0.133 | 0.143 | **39.9 / 43.8** |
| 1000 | window | 102 | 102 | 4.6 | 0.003 | 0.004 | 0.6 / 1.1 |

"Full re-render" is any local write in the component that holds the list, for example a toggle on one row. It re-diffs every row. At 1000 rows that is 2.5 frames at 60 Hz.

Browser, Chromium headless, WebGPU, 390 × 844 CSS px at DPR 3, `metrics-browser.json`. Work ms is `renderer.stats().frameMs`: the mean CPU work per frame over a 1 s window (`src/plugins/renderer/monitor/window.ts:32`). Drag is 16 u per frame for 240 frames.

| rows | mode | entities = views | mount ms | idle work ms | drag work p50 / p95 ms | draw calls | rAF delta max in drag |
|---|---|---|---|---|---|---|---|
| 50 | full | 255 | 39.6 | 1.04 | 1.09 / 1.15 | 3 | 33.4 |
| 50 | window | 102→127 | 27.1 | 0.74 | 0.76 / 1.47 | 3 | 16.8 |
| 200 | full | 1005 | 65.5 | 1.50 | 1.95 / 2.42 | 3 | 33.3 |
| 200 | window | 127 | 27.4 | 0.65 | 1.25 / 1.40 | 3 | 16.7 |
| 1000 | full | 5005 | **164.8** | 3.75 | 4.29 / 5.42 | 3 | **66.7** |
| 1000 | window | 127 | 29.4 | 0.80 | 1.48 / 1.80 | 3 | 16.8 |

In window mode, the drag loop recomputed the window from `Scroll.offset` and asked for a re-render 26 times in 240 frames. `shots/1000-window.png` shows row 32 at the top after the drag: no gap, no jump. Batching holds: 3 draw calls in every case.

Window shift (headless, window mode):

| rows | shift 1 row p50 / p95 ms | jump 14 rows p50 / p95 ms | entities spawned |
|---|---|---|---|
| 50 | 1.19 / 2.12 | 0.86 / 1.07 | 5 per row |
| 200 | 1.14 / 1.49 | 1.29 / 2.48 | 5 per row |
| 1000 | 1.07 / 1.45 | 1.31 / 2.11 | 5 per row, 70 per 14-row jump |

Rows that stay in the window keep their entity (`stableEntitiesKept: true`). Rows that exit without a motion are still in `exiting` one frame later: 127 nodes instead of 102 after a 14-row jump (`nodesAfterShifts`). They are freed one frame later.

Local state of a row component that leaves the window (`localSurvival`): before `"row 3 open"`, while out the row is gone, after return `"row 3 shut"`, new entity. **The state is lost.** The cause is `forgetInstances` in `exitElement` (`reconcile.ts:855`).

Yoga alone, no entities (`yoga` in `metrics.json`). This is the cost of "keep the full list in Yoga":

| rows | nodes | build ms | first solve ms | relayout after one leaf change p50 ms | read all rects ms |
|---|---|---|---|---|---|
| 50 | 252 | 1.1 | 1.7 | 0.08 | 0.3 |
| 200 | 1002 | 1.5 | 1.0 | 0.16 | 0.5 |
| 1000 | 5002 | 6.1 | 3.6 | 0.83 | 2.4 |
| 10 000 | 50 002 | 57.5 | 32.4 | 9.3 | 21.4 |

## What the reconciler needs for windowing

| need | today | measured or read |
|---|---|---|
| The view must learn the visible range | not possible, the offset lives only in `Scroll` | read |
| Re-render when the range changes, not every frame | no trigger on scroll | emulated with a local tap: 26 renders in 240 frames |
| Re-render only the list, not the whole root | whole root re-diffs | 0.6 ms with 102 entities; it grows with the rest of the screen. Not measured with a large screen around the list |
| One-frame lag | the scroll step runs after the diff (`reconcile.ts:1167`), so a range from this frame's offset renders next frame | the margin of 5 rows = 600 u covers a finger under 600 u per frame |
| Content keeps its full height so `min` stays right | `min` reads the content rect | spacers kept `scrollMin` at −118 400 u for 1000 rows, same as full |
| Stable identity by key | holds already | 5 entities spawned per row shift, rest kept |
| Row local state across leave and return | lost | lost, see above |
| A focused row, a pressed row, a text field row that scrolls out | not handled | not verified. A pressed row that exits takes `Pressed` with it |
| Exit and enter motions of rows | a row leaving the window plays its exit hook like a removal | not verified with a motion. It must not play: leaving the window is not a removal |

Fixed vs measured row height:

- Fixed height: range = `floor(-offset / h)`, total = `n * h`. Pure math, no Yoga needed for the hidden rows. This is what was measured.
- Measured height: the hidden rows have no rect. Options are an estimate that is corrected when a row is measured (react-window's dynamic row height, Flutter without `itemExtent`), or the full list kept in Yoga. Yoga for 1000 rows is 3.6 ms first solve and 0.8 ms per relayout. That is fine for 1000 and too much for 10 000. Correction of an estimate shifts `min` and the offset while scrolling. Not verified.

Spacers vs absolute rows: two spacer `row`s (top and bottom) inside a column keep the flow layout and give rows real rects. The other way is an absolute `top = i * h` per row inside a fixed-height content. Both keep `min` right. Spacers were measured. Absolute was not.

## How other UIs do it

| library | approach | source |
|---|---|---|
| react-window | `List` mounts only visible rows plus overscan. Rows are absolutely positioned in a container with the total height. Fixed `rowHeight`, a function of index, or a dynamic-height hook (documented as less efficient). Row component state is not kept when a row scrolls out; state goes in the parent. Default overscan count: not verified. | https://github.com/bvaughn/react-window |
| Flutter `ListView.builder` | Builds children on demand. `itemExtent` or `prototypeItem` makes the scroll extent exact and cheap. `addAutomaticKeepAlives` (default true) lets a child ask to stay alive off-screen. `findChildIndexCallback` keeps state when the order changes. A cache extent builds a margin around the viewport. | https://api.flutter.dev/flutter/widgets/ListView/ListView.builder.html |
| @pixi/ui `ScrollBox` | Creates all items up front. "Dynamic rendering" only skips rendering items outside the view (`isItemVisible` with a proximity padding). Turn it off with `disableDynamicRendering`. No item is destroyed. | https://pixijs.io/ui/ScrollBox.html |
| Pixi `CullerPlugin` | Per-frame walk that skips rendering of `cullable` containers outside the screen or a fixed `cullArea`. Entities and layout stay. | https://pixijs.download/dev/docs/app.CullerPlugin.html |

So there are two families. Virtualize: react-window and Flutter create only the window. Cull: Pixi keeps everything and only skips the draw. Culling does not fix this engine's mount cost (165 ms at 1000 rows) or re-render cost (40 ms). Those come from entities and the diff, not from the GPU.

## Decision input for design

Measured anchors: at 1000 rows today, mount takes 165 ms in the browser and a re-render takes 40 ms headless. A window of about 24 rows mounts in 29 ms, re-renders in 0.6 ms, and shifts in about 1.1 ms. GPU draw calls are not the problem: 3 in every case.

**Option A. `scroll` with `rows` and a fixed `rowHeight` (virtualize, fixed extent).**

```tsx
<scroll key="orders" style={list} count={orders.length} rowHeight={120} margin={5}
  row={i => <OrderRow key={orders[i].id} order={orders[i]} />} />
```

- `ui` keeps the range. It re-renders only this scroll's content when the range changes, and puts in the spacers.
- Pros: exact `min`, no Yoga for hidden rows, one re-render per row crossed. This was measured.
- Cons: every row has the same height. A row callback is a new kind of prop: the first function child in the JSX model. `ui` needs a subtree re-render, or the range check before the diff, to avoid the one-frame lag.

**Option B. A view reads the range and writes the rows itself (`window` local).**

```tsx
view: (props, local) => { const { first, last } = local.window; ... rows.slice(first, last + 1) ... }
```

- The scroll writes `{ first, last }` into the nearest component's local when the range changes, as a `LocalWrite` does.
- Pros: no new prop shape. It reuses the local-write re-render path, which is the emulation that was measured. Spacers are user markup, so any row height math works.
- Cons: the game writes the spacers and the margin math, so it is easy to get wrong. The whole root still re-diffs. The view needs `rowHeight` to turn an offset into a range, so it ends up as A with more boilerplate.

**Option C. Keep all rows, add culling and a keep-alive (cull, measured heights).**

- All rows stay entities and Yoga nodes. The renderer skips views outside the clip rect.
- Pros: measured heights work. Local state, focus and motions are untouched.
- Cons: it does not touch the measured costs. Mount stays 165 ms and a re-render stays 40 ms at 1000 rows. Renderer work drops from 4.3 ms toward the window figure: not verified, because there is no culling in `renderer`.

Questions for all options:

1. Row local state. Either lift it into the model, as react-window advises, or keep the instances of windowed-out rows by key (`forgetInstances` skipped for a window exit). This is a Flutter-style keep-alive.
2. A window exit must not play the exit motion and must despawn at once.
3. A row that holds focus or `Pressed`, or a text field being edited, must pin itself in the window.
