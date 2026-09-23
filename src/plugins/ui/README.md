# ui

The interface as one more projection. A screen is a projection whose `view` returns JSX; `world`
wraps that tree in `Tree` and `ui` reconciles it by identity into entities it owns, with a `Box`
rect from one Yoga solve per change.

| Module | Owns |
|---|---|
| `jsx` | the runtime, the intrinsic types, `defineComponent`, instances and their `local`, the reconcile, the `onTap` application of `LocalWrite`, the keyboard focus, `tree()`, `find()`, `lint()` |
| `styles` | `defineStyle`, `defineTokens`, the `is` and `when` flags, `resolve` |
| `layout` | Yoga load and node lifetime, the solve, `Box` writes, the rest pose, motion, exiting elements, scroll, the `popup` and `guide` handlers |
| `visual.ts` | pure, shared by `jsx` and `layout`: the visual component of an element, the fit scale and the drawn rect under `fit` |

| Member | Answers |
|---|---|
| `app.ui.tree()` | the live screen as plain data: natural rect, style, seven state flags, local, `fitScale` on a fitted element, children |
| `app.ui.find(key)` | the entity of a keyed element, live only |
| `app.ui.lint()` | tap targets under `tapTargetPt` at their drawn size, text that overflows in some locale, an absolute element with no `reason`, a nine-slice on a clipping element (`nine-slice-clipped`), a `zIndex` on a root element (`z-index-on-root`) |

Config:

| Field | Default | Meaning |
|---|---|---|
| `tapTargetPt` | `44` | the smallest tap target `lint()` accepts, in CSS px |
| `breakpoints` | `{ tall: 2, wide: 1.5 }` | the ratios of the `tall` and `wide` flags |
| `focusRing` | `{ stroke: 0x3a2212, strokeWidth: 4, dash: 10, offset: 9, halo: 0xfff3d6, haloWidth: 12 }` | the keyboard focus ring: a dashed ring `offset` outside the control, over a solid halo of `haloWidth` on the same path |

Emits nothing, listens to nothing. Depends on `time`, `flow`, `world`, `renderer`, `input`,
`anim`, `i18n`, `text`. Yoga arrives through `await import("yoga-layout/load")` in `onStart`;
nothing solves before it. `onStart` also registers `LocalWrite` through `input.controls.add`, so
the cursor shows a hand over a local-state button, and one `input.onKey` listener for the focus;
`onStop` removes both.

## What an element is drawn with

| Tag | Visual | Input |
|---|---|---|
| `image`, `icon` | `Sprite` at the rect, `fit` prop `"contain"` (default), `"cover"` or `"fill"`, `style.tint`, `style.alpha` | none |
| `text` | `Text`; a string `style` is the text style key | none |
| any other tag with `style.nineSlice` | `NineSlice` at the rect, `style.alpha`, `style.tint`, `style.debug` | as below |
| any other tag | a rounded `Shape`, invisible on a container with no fill and no stroke; with no `fill` nothing is painted inside (`fillAlpha: 0`): a `stroke` alone draws a ring, a bare button such as a text link shows only its label. `style.shape: "triangle"` fills the box pointing right (turn it with `rotation`), `style.dash` dashes the stroke (gaps of half a dash) | as below |
| `button` | as above | `Tappable` with `intent`, `Touchable` + `LocalWrite` with `local`, `Touchable` when disabled, covered or naming nothing; `Escapable` too with the `escape` prop, while it answers |
| `panel` | as above | `Touchable`: it swallows every tap and answers nothing |
| `scroll` | `Shape` with `clip` | `Touchable`, `Scroll` |

A live element follows its state: a button that becomes disabled loses `Tappable` and
`LocalWrite` and keeps `Touchable`, so it stops answering the gate; enabled again, it answers.
`Scroll` is only ever added: hover, a press or a new rect never resets the offset.

`overflow: "hidden"` clips the children to the rect through `Shape.clip`, as a scroll does. A
clipping element keeps its `Shape` and draws no nine-slice: an entity has one visual. Put the
nine-slice on the parent instead; `lint()` reports the dropped one as `nine-slice-clipped`.

`nineSlice` takes the game's asset keys: `defineStyle` and the `style` of every tag from
`defineGame` (through `uiFor`) refuse a key outside them, the way `texture` and `name` do.

```tsx
<panel key="reward" style={{ nineSlice: "ui.panel", padding: 32, fit: "contain", origin: "top" }}>
  <image key="bg" texture="board.bg-forest-meadow" fit="cover" style={{ width: "100%", height: 300 }} />
  <button key="claim" intent="claim" style={claimButton} />
</panel>
```

Migration (delta 4): `<panel nineSlice="k">` becomes `<panel style={{ nineSlice: "k" }}>`.

`style.debug: true` outlines the nine-slice of that element: its bounds and the four slice lines,
cyan, red when the corners overlap or the texture is missing. It is written into `NineSlice.debug`
(`false` by default) and `lint()` ignores it. To outline every nine-slice at once, use the
renderer: `app.renderer.sync.debug.nineSlice(true)` or `pluginConfigs.renderer.debug.nineSlice`.

```tsx
<panel key="board" style={{ nineSlice: "ui.panel-signboard", padding: 72, debug: true }} />
```

## Draw order

A child draws with its parent, over the siblings before it. `zIndex` (an integer) changes that:
it is written as the child's `Order`, so `renderer` sorts the siblings by it; a sibling without
it draws at 0 in markup order. A new value from a variant or a new render updates the `Order`;
a child that drops its `zIndex` goes back to 0. The views a slot hosts keep their own `Order`.
A root element ignores `zIndex` (it draws at the order of its root in its layer), and `lint()`
reports it as `z-index-on-root`.

```tsx
<column key="board">
  <row key="orders" style={{ zIndex: 1 }}>{cards}</row>
  <panel key="tray" style={{ margin: { top: -40 } }}>{items}</panel>
</column>
```

## State flags

`is` variants merge in the order `disabled`, `active`, `selected`, `hover`, `focus`, `pressed`,
`covered`. While `disabled` is true, `hover` and `pressed` are not applied.

| Flag | From |
|---|---|
| `disabled`, `active`, `selected` | the `state` prop of the markup |
| `pressed` | `input`'s `Pressed` tag, from down to up |
| `hover` | `input`'s `PointerOver` tag: an idle mouse or pen over the element; touch never hovers. Never from `Hovered`, the drop target under a drag |
| `focus` | the keyboard focus, see below |
| `covered` | the root: every element of a root kept under another popup |

A variant may swap anything, the nine-slice included (`is: { disabled: { nineSlice: "ui.button-off" } }`);
swapping between a rectangle and a nine-slice trades the one component for the other.

## Keyboard focus

For desktop development and keyboard players. `input` delivers the keys (`onKey`); `ui` owns the
focus, because it knows the roots and the layout.

- **The root the keyboard works in:** the top uncovered popup; with no popup, the screen root in
  the top layer.
- **Tab / Shift+Tab** move the focus through the controls of that root (the elements with
  `Tappable` or `LocalWrite`) in reading order: the upper rect first, then the left one. Both
  wrap. With no control, Tab does nothing and the browser keeps the key. A button with `escape`
  and no children is a popup's backdrop, not a Tab stop: Escape and a tap still reach it.
- **Enter / Space** tap the focused control through `input.tap`, the same door a finger uses:
  the intent is answered, or the `local` patch is written. The focus stays.
- **Escape** taps the button with the `escape` prop in that root: the close button or the
  backdrop of a dismissable popup. Nothing without one.
- **A pointer tap** clears the focus: the ring shows only after a key (focus-visible).
- The focus drops when its element leaves, or its root gets covered or another root comes over
  it.

The focused element resolves `is.focus`. Around it `ui` draws one overlay it owns: a solid halo
under a dashed ring (`config.focusRing`), `offset` outside the drawn rect with a corner radius of
the element's `radius` plus `offset`, in the layer of its root, above its elements. Hidden
without focus.

```tsx
<button key="close" intent="close" escape style={{ is: { focus: { scale: 1.05 } } }} />
```

A headless test presses keys through `app.input.key("Tab", { shift: true })`.

## Visual transform styles

`offsetX`, `offsetY` (reference units), `scale` (uniform), `rotation` (radians) and `origin` (`"center"` default,
`"top"`, `"topLeft"`, or `{ x, y }` in fractions of the box, any fraction: `{ x: 0.5, y: -0.5 }`
hangs the pivot half the height above the top edge, where a popup's ropes meet) never change a
rect. They are written
into the rest `Transform`: `pivot` is the origin on the box, and the position is where the pivot
lands, so the unscaled element sits on its rect.

`rotation` turns the element around its origin; it works in `is:` variants like `scale`, and
`lint()` ignores it. A popup plaque tilted by 1.5 degrees: `{ rotation: -0.026, origin: "top" }`.

When a state change moves the rest pose, the element plays its `change.Transform` motion when it
has one, else the pose applies through a 0 ms rest track (delta 6): it lands on the next frame
step, and an additive loop running on the element re-bases on the new rest. A headless test
steps once after a variant change before it reads the drawn `Transform`. A new rect plays
`change.Box` when there is one.

The `motion` prop is a `Ui.ElementMotion`. Its two `change` hooks get typed values: `Transform`
the rest poses before and after, `Box` the rects. A hook for any other component name is
accepted, so every `defineMotion` result fits, and `ui` never plays it. One hook alone is a
`Ui.ElementChange<Value>`.

```ts
const cardMotion: Ui.ElementMotion = {
  change: {
    Transform: (view, previous, next) =>
      next.scale > previous.scale
        ? view.all([
            view.toRest(Transform, { ms: 240 }),
            view.tween(Transform, { rotation: 0.12 }, { ms: 520, additive: true })
          ])
        : view.toRest(Transform, { ms: 240 })
  }
};
```

A motion with a `loop` hook (a `defineMotion` with `loop`) starts it when the element enters,
next to `enter`, and keeps its motion apart: the exit sweep never waits for it. When the motion
prop of a live element names another `loop`, the running loop is cancelled and the new one
starts; a motion without a loop, or no motion, stops it. Keep a motion a module constant: a
`defineMotion` called inside a view builds a new loop every render and restarts it.

```tsx
<row key="card" motion={order.ready ? swayWide : swayGentle} />
```

A keyframed `defineMotion` works on any element as it is: the keys walk around the element's
pivot, so a popup that swings on its ropes names the rope point as its origin.

```tsx
const swing = defineMotion({
  keyframes: {
    dropIn: [
      { at: 0, Transform: { dy: -780, rotation: -0.035, scale: 0.8 } },
      { at: 0.42, ease: "out", Transform: { dy: 14, rotation: 0.087, scale: 1.04 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "dropIn" }
});

<panel key="board" style={{ width: 600, height: 400, origin: { x: 0.5, y: -0.5 } }} motion={swing} />;
```

Breaking (delta 4): every ui motion with `scale` or `rotation` now turns around the element's
centre. `origin: "topLeft"` keeps the old pivot.

## Fit

`fit: "contain"` lays the element out at its own style size, out of the flow, and centres it in
the content box of its parent (the rect less its padding). Its rest `Transform.scale` is
`min(1, contentW / w, contentH / h)`. Its children keep their natural rects: `Box` under a fitted
element is natural space. `lint()` and the `guide` hole scale a rect by every fitted element on
the way up; `tree()` reports the natural rect and adds `fitScale`.

```tsx
<column key="slot" style={{ grow: 1, padding: 20 }}>
  <stack key="board" style={{ width: 970, height: 970, fit: "contain" }}>{cells}</stack>
</column>
```

Give the fitted element a parent whose size comes from the screen (`grow`, a percent, a fixed
size): the fitted element never stretches it.

## Popups

`popup(component, props, options?)` is an effect a node awaits. The gate opens for the
component's outcomes; the node goes on with the answer and never waits for the exit motion.

- **Deferred unmount.** When the answer arrives (or the node is aborted) the root stays. It leaves
  at the first `ui.reconcile` where the flow rests on a node that shows no popup of its component:
  the gate is open, the loop stands on no node, or it is not running (`flow.state()`). Then the
  exit motions play and the root is despawned.
- **Reuse.** A `popup` of the same component that arrives first takes the root back: the props are
  patched, no exit and no enter motion play, the component's `local` is kept. A settings popup
  that the flow shows again after every volume step is one root for its whole life.
- **`over`.** `popup(Confirm, {}, { over: "Settings" })` keeps the newest `Settings` popup mounted
  beneath the new one. Its root entity gets the internal tag `Covered`, and every element of it
  resolves `is.covered`, so a style can hide what should not show under the confirm. Its buttons
  answer nothing: only the top popup answers the gate. When `Settings` is shown again (a cancel),
  the same root is taken back and uncovered. When the coverer leaves and nothing takes the covered
  root back, it leaves too. `over` is the option of `popup()`, not the `over` flag of a node.

```ts
const settings = defineNode({
  rest: true,
  outcomes: { volume: type<{ delta: number }>(), reset: type(), close: type() },
  run: async ({ player, fx, out }) => {
    const answer = (await fx(popup(Settings, { volume: player.volume }))) as Answer | undefined;

    // A transit node writes the volume and comes back here: the same root, props patched.
    if (answer?.intent === "volume") return out.volume({ delta: 1 });
    // The next node awaits popup(Confirm, {}, { over: "Settings" }): Settings stays, covered.
    if (answer?.intent === "reset") return out.reset();
    // Home rests with no popup: the root leaves at the next frame.
    return out.close();
  }
});
```

A popup root is laid out at the viewport size. A popup component draws its own backdrop, a
full-screen `button` with a dim fill, and its panel; the panel swallows the taps on it.

## Hosts

`screen`, `row`, `column` and `stack` take `hosts`: projection names. Each `ui.reconcile`, every
live view of those projections (`world.projection.entitiesOf`) without a `Parent` and not `Held` by
a drag gets `Parent({ entity: element })`. It draws in the element's local space, scales with it and
keeps its `Order` inside it. When the element leaves, or stops naming the projection, the views lose
that `Parent` and fall back to their layer. An exiting view keeps its host while its exit plays.
A `guide` whose target is a hosted view cuts its hole where the view is drawn: its pose through
the `Parent` chain, and its nine-slice or sprite size times that scale.

```tsx
<stack
  key="boardSlot"
  hosts={["board.cells", "board.generators", "board.items"]}
  style={{ width: 970, height: 970, fit: "contain" }}
/>
```
