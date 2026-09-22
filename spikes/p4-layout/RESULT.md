# P4 result

Question: does the UI model live (JSX to entities, intent as data, exit before despawn); which layout engine carries `ui.layout`; does Bun's dev JSX transform evaluate `/jsx-dev-runtime`?

Answer: stands. The UI model lives, every case passes on both adapters. Raw `yoga-layout` (A) stands as the layout engine; `@pixi/layout` (B) passes the layout gates but fails the cost gate and carries three integration facts that reach a game without `ui`. One change: Bun evaluates `jsx-dev-runtime` in every mode except `bun build --production`, so `src/jsx-dev-runtime.ts` stays in the skeleton and is the one a game runs in dev.

## Evidence

Installed: `pixi.js` 8.21.0, `yoga-layout` 3.2.1, `@pixi/layout` 3.2.1, Bun 1.3.14. Seed 20260922, 10 blocks per case, fixed 60 Hz step, motions 250 ms enter, 300 ms exit, 200 ms slide. Headless: `bun measure.ts`, 4 runs (adapter × exit-flow policy), `metrics.json`. Browser: Chrome in the Claude pane, Pixi on WebGPU, 3 script passes per adapter (30 blocks per case), `metrics-browser-A.json`, `metrics-browser-B.json`.

### Decision rule operands

| Operand | Gate | A headless | A browser | B headless | B browser | Source |
|---|---|---|---|---|---|---|
| `unlaidFrames` | 0 | 0 | 0 | 0 | 0 | metrics.json, metrics-browser-*.json |
| `solveMs` p50 / p95, about 300 entities | p95 < 4 ms | 0.77 / 1.39 | 1.5 / 1.9 | 0.86 / 1.32 | 1.6 / 2.3 | same (10 samples headless, 30 browser) |
| `solveCallsIdle` (180 counter frames, fixed width) | 0 | 0 | 0 | 0 | 0 | same |
| `solveCallsScroll` (60 frames, 500 px) | 0 | 0 | 0 | 0 | 0 | same |
| `fightWrites` | 0 | 0 | 0 (core), 0 (display) | 0 | 0, 0 | same |
| `nodeLeak` (1000 rows in and out) | 0 | 0 ×10, indirect | 0 ×30, indirect | 0 ×10, indirect | 0 ×30, indirect | same |
| B loads lazily | yes | | | `await import("@pixi/layout")` evaluates in Bun and the browser | | measure.ts, main.ts |
| B's patch cannot reach a game without `ui` | must hold | | | **fails**, see facts 1–3 | | ContainerMixin.mjs, index.mjs |
| `bundleBytes(B) - bundleBytes(A)` | < 8 kB gzipped | | | **45.2 kB gzipped** (A 114.4 kB, B 159.5 kB, base with Pixi `Container` alone 61.8 kB; `bun build --minify` of an entry importing `Container` plus the adapter) | | measured 2026-09-22 |

Result: `gates(A)` holds, `gates(B)` holds, B fails the lazy-patch fact and the cost gate. A stands.

### UI model operands

| Operand | Gate | A headless | A browser | B headless | B browser |
|---|---|---|---|---|---|
| `intentCount` per tap | 1 | 1 ×10 | 1 ×30 | 1 ×10 | 1 ×30 |
| `earlyDespawns` | 0 | 0 | 0 | 0 | 0 |
| `behindMoved` while the popup exits | 0 | 0 | 0 | 0 | 0 |
| `localLost` (patch, shuffle, tab switch) | 0 | 0 | 0 | 0 | 0 |
| `reentered` on a tab switch | 0 | 0 | 0 | 0 | 0 |
| `tabIntents` (a local write is not an intent) | 0 | 0 | 0 | 0 | 0 |
| `reconcilePerFrame` for two renders in one frame | 1 and 1 | 1, 1 ×10 | 1, 1 ×30 | 1, 1 ×10 | 1, 1 ×30 |
| `variantMisses` after the flip | 0 | 0 | 0 | 0 | 0 |
| `solvesPerFlip` | 1 | 1 ×10 | 1 ×30 | 1 ×10 | 1 ×30 |
| `rowWidthError` (icon + gap + measured text) | 0 / < 1 px | 0 | 0 | 0 | 0 |
| `measureCalls` per content change | 1 | 1 ×10 | 1 ×30 | 1 ×10 | 1 ×30 |
| `solveLeafMs` p95 (one intrinsic text changed) | | 0.2 | 0.2 | 0.2 | 0.2 |
| `siblingShiftFrame`, policy "leave" / "stay" | recorded | 1 / 18 | 1 | 1 / 16.8 | 1 |
| `caseCounts` 1–9 | ≥ 10 | 10 each | 30 each | 10 each | 30 each |

Browser frames, pane visible, 632 entities (100 rows), counter re-rendered every frame, 180 frames on a 120 Hz display: frame delta p95 8.5 ms for A and for B; core + reconcile + mirror sync + render work p95 1.5 ms (A), 1.9 ms (B). Whole script pass, 5000 frames with the mirror rendering every frame: 7.0 s (A), 8.3 s (B), so about 1.4 ms and 1.7 ms per frame including the Pixi render.

`initMs`: Yoga wasm 8.0 ms on first load in Bun, 6.5 ms in the browser; under 1 ms once the module is cached. `@pixi/layout` init 1.1 to 3.4 ms on top of a loaded Yoga.

### Strips (`shots/`, 8 frames 50 ms apart; read by the orchestrator)

- `case1-A`: the popup is laid out in its first frame and grows in from 60 % with a 40 px lift; settled at 200 ms. Nothing behind it moves.
- `case2-A`, `case2-B`: after the tap the panel shrinks and fades over 300 ms, the rows behind stay put, the popup is gone in the 300 ms frame. Identical between adapters.
- `case4-A`: policy "leave": the removed row fades where it was while the rows below slide up over it, done by 100 ms; a two-frame ghost under a moving row. Readable.
- `case5-A`, `case5-B`: the flip re-solves once; the button row slides to the right edge (`when.landscape: justify end`), tabs stretch. In B's strips every fixed-height box is shorter (fact 4).

### Facts about `@pixi/layout` 3.2.1, with source lines

1. **Module-scope patch at import.** `dist/core/mixins/ContainerMixin.mjs` ends with `extensions.mixin(Container, mixin)`: importing the package adds `layout`, `_layout`, `updateLocalTransformWithLayout`, `computeLayoutData` to every `Container` in the app. When the first `layout` is set it also redefines `Container.prototype.visible` (same file, `Object.defineProperty(Container.prototype, "visible", ...)`). A dynamic `import()` delays this but does not scope it: the moment `ui` loads, every container of `world` and `renderer` carries it.
2. **Renderer extension at import.** `dist/index.mjs` line 15: `extensions.add(LayoutSystem)`. Every renderer created afterwards gets a `layout` system with `autoUpdate: true` whose `prerender` walks the whole stage every frame (`_updateSize` and `updateLayout` recurse over all children, `LayoutSystem.mjs`). A game without `ui` pays that walk once the package was imported anywhere.
3. **One global Yoga, swapped on every init.** `LayoutSystem.init` runs `setYoga(await loadYoga())` (`LayoutSystem.mjs`): each renderer init, and each standalone `LayoutSystem`, loads a fresh wasm instance and replaces the module-global one. Nodes created before the swap cannot be combined with nodes created after it: the spike hit `BindingError: Expected null or instance of Node, got an instance of Node` in `insertChild` after a probe created a second `LayoutSystem` while adapter B was live. Two renderers, or a renderer created after the UI, break the layout tree.
4. **Web-like defaults.** `Layout.defaultStyle.shared` has `flexShrink: 1` (`Layout.mjs` line 259) where Yoga's default is 0. The same style objects give different rects: a `height: 80` tab bar in a column whose list overflows becomes 53 px tall in B and stays 80 in A (195 of 212 entity rects differ on the settings screen; `_diff` run, 2026-09-22). Leaf containers default to `width: "intrinsic"`, measured from Pixi bounds.
5. **No measure-function API.** Intrinsic size comes from `getPixiSize` on the container's bounds, throttled (`throttle: 100` ms default, settable to 0). The spike reached `layout.yoga.setMeasureFunc` on the `Readonly<Node>` the `Layout` owns; that is an escape hatch, not API.
6. **x/y are offsets.** `updateLocalTransformWithLayout` computes `tx = position._x + x - …` (`ContainerMixin.mjs`): with a layout attached, `container.x` is an offset from the laid-out position. Probe: laid-out left 150, `x = 40`, `realX` 190, `localTransform.tx` 190. So a tween on `x` does not fight the layout; that is the one thing B gets right that a `Box` component must reproduce.

Yoga 3.2.1 facts: `loadYoga()` from `yoga-layout/load` is the async wasm loader, the default export of `yoga-layout` is the sync (asm.js) build; `Node.getInstanceCount` does not exist, so the leak check is attach minus detach (`indirect`); `node.free()` on a node still attached to a parent throws, the adapter removes it from its parent first; `markDirty()` is allowed only on nodes with a measure function.

### Case 10, the JSX runtime

`__p4Runtimes` in the browser under `bun ./index.html` (dev server): `["p4:jsx-dev-runtime"]`. `bun measure.ts` in plain Bun: `["p4:jsx-dev-runtime"]`. `bun build main.ts --minify`: the bundle contains `p4:jsx-dev-runtime`, 33 `jsxDEV` calls. `NODE_ENV=production bun build main.ts --minify`: still `p4:jsx-dev-runtime`. `bun build main.ts --production`: `p4:jsx-runtime`. So Bun's transform picks `jsxDEV` from `<source>/jsx-dev-runtime` unless `--production` is passed to `bun build`; `NODE_ENV` does not switch it.

`errors.txt` (`bunx tsc -p tsconfig.mistakes.json --noEmit`), one error per tag:

```
mistakes.tsx(9,6): error TS2741: Property 'style' is missing in type '{ key: string; }' but required in type 'BoxProps'.
mistakes.tsx(11,47): error TS2322: Type 'number' is not assignable to type 'string'.
mistakes.tsx(13,6): error TS2741: Property 'texture' is missing in type '{ key: string; style: { width: number; height: number; }; }' but required in type 'ImageProps'.
mistakes.tsx(15,62): error TS2322: Type 'number' is not assignable to type 'string'.
mistakes.tsx(17,44): error TS2322: Type '{ key: string; style: { grow: number; }; content: string; }' is not assignable to type 'ListProps'.
  Property 'content' does not exist on type 'ListProps'.
```

The `button` and `text` errors name the position but not the prop; the `ui` spec should give the intrinsic props branded literal types or a lint that prints the prop name.

## What changes in the plan

### 1. Layout engine

Raw `yoga-layout` 3.2.1 behind `ui.layout`, loaded with `await loadYoga()` from `yoga-layout/load` at start (`decisions.md` open question closed). `@pixi/layout` is not a dependency: facts 1 to 4 above. Yoga properties the style vocabulary used: `setFlexDirection`, `setFlexWrap`, `setJustifyContent`, `setAlignItems`, `setGap(Gutter.All)`, `setPadding(edge)`, `setMargin(Edge.All)`, `setWidth` / `setWidthAuto` / percent strings, `setHeight`, `setMinWidth`, `setMinHeight`, `setMaxWidth`, `setMaxHeight`, `setFlexGrow`, `setFlexShrink`, `setPositionType`, `setPosition(edge)`, `setAspectRatio`, `setOverflow`, `setMeasureFunc`, `markDirty`, `insertChild`, `removeChild`, `calculateLayout`, `getComputedLeft/Top/Width/Height`. Never used by the two screens: `wrap`, `margin`, `minWidth`, `maxWidth`, `maxHeight`, `aspect` on anything but the reward images, `alignSelf` (not in the vocabulary; the measured row needed a wrapper box with `align: "start"` instead, so `alignSelf` goes into the `ui` styles).

### 2. Description node and reconcile rules

- Node: `{ type: string, key: string | undefined, props, children: DescriptionNode[] }`. `jsx(type, props, key)` receives the key as the third argument, never in `props`; `jsxs` is the same function; `jsxDEV(type, props, key, isStatic, source, self)` ignores the last three.
- A function `type` is a component and is called at build time; the tree holds intrinsics only. Fragments are lifted into the parent's children; nested arrays flatten; `null`, `undefined` and booleans drop; a string or number child becomes a `text` node.
- Identity is the parent plus `key ?? "<type>@<index>"` plus the type. Same key and type: patch props. Different type: exit the old, enter the new. Missing: exit. New: enter. Moved: reorder, the entity object survives (`localLost` 0 after 30 shuffles).
- Local view state lives on the entity of the `box` that declares `local={...}` (its initial value), keyed by that box's key, and is read in the screen function through `local(key, initial)`. A `button` with `local={patch}` writes the patch into the nearest ancestor that declares `local`; that is a re-render, never an intent (`tabIntents` 0). A `button` with `intent` sends `{ name, payload }` to the gate, exactly once per tap.
- `is` flags come from the markup (`state={{ active, disabled, selected }}`) plus `pressed` from the pointer; `when` flags from the viewport. `resolve(style, flags, viewport)` is base, then `when`, then `is`.
- Two renders in one frame: one reconcile, one solve. The reconcile runs at the start of `advance`, the solve right after it, then the tweens, then the despawn queue; a despawn that changes the flow (policy "stay") solves again in the same frame.
- `src/jsx-dev-runtime.ts` stays in the skeleton (`stage1-structure.md` line 93): Bun's dev server and `bun build` without `--production` evaluate it. Both files export the same `JSX` namespace; the dev one adds `jsxDEV`.

### 3. Layout rules

- `solve` runs after a reconcile that changed a style, the order or the measured content of a node, after a viewport change, and after a despawn that changes the flow. Never per frame (`solveCallsIdle` 0), never on scroll (`solveCallsScroll` 0): a scroll offset is a transform on the list content and shifts the rest poses of its children without a motion.
- A text with a fixed `width` and `height` has no measure function; its content changes without a layout. A text with `width: "auto"` gets a measure function; a content or style change marks it dirty and one solve runs (`measureCalls` 1 per change, `solveLeafMs` p95 0.2 ms).
- Exiting entity: policy **"leave"**. It keeps its last rect and leaves the flow at once; its siblings reflow in the same frame (`siblingShiftFrame` 1) while it plays its exit motion over them. Policy "stay" (siblings wait 300 ms, `siblingShiftFrame` 18) makes a removed row block its neighbours for the whole exit; the strip of "leave" is readable and the rule is simpler: the layout never knows about exiting entities.
- Rect and motion: the `Box` rect in root coordinates is the rest pose of `Transform` (`x`, `y`) with `scale` 1 and `alpha` 1. Motions write the pose; `toRest` retargets toward the rest pose (P5 policy B). A rect change on a live entity is a `change.Rect` hook that slides (200 ms); an enter hook sets the pose off the rest and returns to it; nothing but the tween writes the pose (`fightWrites` 0 in core and 0 between core and the display). `x` and `y` are owned by `ui.layout` through the rest pose; a game never sets them on a UI entity.
- Viewport change: the screen function re-runs (its `when` branches may change), one reconcile, one full solve: about 300 entities in 1.5 ms p50, 1.9 ms p95 on the dev Mac in the browser.

### 4. Yoga lifetime

- `await loadYoga()` once, at the start of `ui` (8 ms cold in Bun, 6.5 ms in Chrome, under 1 ms warm). Pre-warming during the splash is not needed at this cost; start it in `onStart` and gate the first solve on it.
- One Yoga node per UI entity, created when the entity enters, freed when it despawns, after `removeChild` from its parent. Children are re-placed once per parent per reconcile (remove all, insert in order), not per exiting child: doing it per exit made the 1000-row churn quadratic (163 s for the four headless runs; 6.7 s after the fix).
- The instance count is attach minus detach: Yoga 3.2.1 has no `Node.getInstanceCount`. Balanced at 0 over 40 churns of 6000 nodes.

### 5. The seams

- **`text` to `ui`**: a measure function `(content, style) => { width, height }` for `Text` through `CanvasTextMetrics.measureText(content, textStyle)`; invalidated when content or the resolved style changes; called once per invalidation by Yoga with `(width, widthMode, height, heightMode)`, the `ui` side clamps to the mode. For `BitmapText`, `CanvasTextMetrics` is off by 2.6 % (113.4 vs 110.5 px for "1234567" at 28 px): the `text` measure for a bitmap counter reads the `BitmapText` width after `text` is set, or `text` gives the digits atlas its own advance table. Multi-line and inline icons: out of P4, R2.
- **`anim` to `ui`**: the hooks are the ones of `world.projection` after P5: `enter(view, props)`, `exit(view, props)`, `change.<Component>(view, prev, next)`, `settle(view, fields)`, `view.set / tween / toRest`, a handle with `finish / cancel / active`. UI entities need nothing more; the despawn queue waits on `exit`'s handle exactly as the board does.
- **`input` to `ui`**: `ui` puts `Tappable { intent, payload }` (the existing component of `08-input.md`) on a `button` entity that has `intent`; `input.tap` resolves the entity by hit test on the `Box` rect in root coordinates plus the pose offset, last in draw order wins, and answers the gate. A `button` with `local` and no `intent` is not `Tappable`; it carries a `ui`-owned `LocalWrite { patch }` that `input` reports as a plain pointer event and `ui` applies. So `ui` depends on `input` for the pointer and `input` learns no `ui` type. Disabled buttons (`state.disabled`) drop the tap.

### 6. Spec sections to edit

- The future `ui` spec: module `jsx` (point 2), module `styles` (point 2, plus `alignSelf`), module `layout` (points 1, 3, 4).
- The future `text` spec: the measure contract (point 5).
- `08-input.md`: the `Box` hit test and `LocalWrite`, if the design station keeps that seam (point 5).
- `00-foundation.md` §7 and `stage1-structure.md` lines 92–93: `jsx-dev-runtime.ts` stays; the export map serves both.
- `decisions.md`: the layout engine entry (this result); the open question is closed.
- None of the V1 or V2 specs otherwise.
