# ui

The interface as one more projection. A screen is a projection whose `view` returns JSX; `world`
wraps that tree in `Tree` and `ui` reconciles it by identity into entities it owns, with a `Box`
rect from one Yoga solve per change.

| Module | Owns |
|---|---|
| `jsx` | the runtime, the intrinsic types, `defineComponent`, instances and their `local`, the reconcile, the `onTap` application of `LocalWrite`, `tree()`, `find()`, `lint()` |
| `styles` | `defineStyle`, `defineTokens`, the `is` and `when` flags, `resolve` |
| `layout` | Yoga load and node lifetime, the solve, `Box` writes, the rest pose, motion, exiting elements, scroll, the `popup` and `guide` handlers |
| `visual.ts` | pure, shared by `jsx` and `layout`: the visual component of an element, the fit scale and the drawn rect under `fit` |

| Member | Answers |
|---|---|
| `app.ui.tree()` | the live screen as plain data: natural rect, style, six state flags, local, `fitScale` on a fitted element, children |
| `app.ui.find(key)` | the entity of a keyed element, live only |
| `app.ui.lint()` | tap targets under `tapTargetPt` at their drawn size, text that overflows in some locale, an absolute element with no `reason`, a nine-slice on a clipping element (`nine-slice-clipped`) |

Config: `{ tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 } }`. Emits nothing, listens to
nothing. Depends on `time`, `flow`, `world`, `renderer`, `input`, `anim`, `i18n`, `text`.
Yoga arrives through `await import("yoga-layout/load")` in `onStart`; nothing solves before it.

## What an element is drawn with

| Tag | Visual | Input |
|---|---|---|
| `image`, `icon` | `Sprite` at the rect, `fit` prop `"contain"` (default), `"cover"` or `"fill"`, `style.tint`, `style.alpha` | none |
| `text` | `Text`; a string `style` is the text style key | none |
| any other tag with `style.nineSlice` | `NineSlice` at the rect, `style.alpha`, `style.tint` | as below |
| any other tag | a rounded `Shape`, invisible on a container with no fill and no stroke | as below |
| `button` | as above | `Tappable` with `intent`, `Touchable` + `LocalWrite` with `local`, `Touchable` when disabled, covered or naming nothing |
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

## State flags

`is` variants merge in the order `disabled`, `active`, `selected`, `hover`, `pressed`,
`covered`. While `disabled` is true, `hover` and `pressed` are not applied.

| Flag | From |
|---|---|
| `disabled`, `active`, `selected` | the `state` prop of the markup |
| `pressed` | `input`'s `Pressed` tag, from down to up |
| `hover` | `input`'s `PointerOver` tag: an idle mouse or pen over the element; touch never hovers. Never from `Hovered`, the drop target under a drag |
| `covered` | the root: every element of a root kept under another popup |

A variant may swap anything, the nine-slice included (`is: { disabled: { nineSlice: "ui.button-off" } }`);
swapping between a rectangle and a nine-slice trades the one component for the other.

## Visual transform styles

`offsetX`, `offsetY` (reference units), `scale` (uniform) and `origin` (`"center"` default,
`"top"`, `"topLeft"`, or `{ x, y }` in fractions of the box) never change a rect. They are written
into the rest `Transform`: `pivot` is the origin on the box, and the position is where the pivot
lands, so the unscaled element sits on its rect.

When a state change moves the rest pose, the element plays its `change.Transform` motion when it
has one, else the pose applies at once. A new rect plays `change.Box` when there is one.

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
