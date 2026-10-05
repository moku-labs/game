# ui

The interface as one more projection. A screen is a projection whose `view` returns JSX; `world`
wraps that tree in `Tree` and `ui` reconciles it by identity into entities it owns, with a `Box`
rect from one Yoga solve per change.

| Module | Owns |
|---|---|
| `jsx` | the runtime, the intrinsic types, `defineComponent`, instances and their `local`, the reconcile, the windowed rows of a `scroll`, the routing of hints to elements, the `onTap` application of `LocalWrite`, the keyboard focus, the text fields and their hidden input, `tree()`, `find()`, `lint()`, `fill()` |
| `styles` | `defineStyle`, `defineTokens`, the `is` and `when` flags, `resolve` |
| `layout` | Yoga load and node lifetime, the solve, `Box` writes, the rest pose, motion, exiting elements, scroll and the range of a windowed scroll, the `popup` and `guide` handlers |
| `visual.ts` | pure, shared by `jsx` and `layout`: the visual component of an element, the fit scale and the drawn rect under `fit` |

| Member | Answers |
|---|---|
| `app.ui.tree()` | the live screen as plain data: natural rect, style, seven state flags, local, `fitScale` on a fitted element, `value` on a text field, `window` on a windowed scroll, children |
| `app.ui.find(key)` | the entity of a keyed element, live only |
| `app.ui.lint()` | tap targets under `tapTargetPt` at their drawn size (text fields count), text that overflows in some locale, an absolute element with no `reason`, a nine-slice on a clipping element (`nine-slice-clipped`), a `zIndex` on a root element (`z-index-on-root`) |
| `app.ui.fill(key, value)` | types into the text field with that `key`: it becomes the one edited, `value` cut to its `maxLength` is written into it and into its component's `local`; `false` and the warning `ui:fill-without-input` when no live `input` has the key |

Config:

| Field | Default | Meaning |
|---|---|---|
| `tapTargetPt` | `44` | the smallest tap target `lint()` accepts, in CSS px |
| `breakpoints` | `{ tall: 2, wide: 1.5 }` | the ratios of the `tall` and `wide` flags |
| `focusRing` | `{ stroke: 0x3a2212, strokeWidth: 4, dash: 10, offset: 9, halo: 0xfff3d6, haloWidth: 12 }` | the keyboard focus ring: a dashed ring `offset` outside the control, over a solid halo of `haloWidth` on the same path |
| `textInput` | `{ caretWidth: 3, caret: 0x000000, selection: 0x3390ff, selectionAlpha: 0.35, composingUnderline: 3, keyboardMargin: 16 }` | a text field while it is edited: the caret (it does not blink) and the IME underline in `caret`, the selection box, and the CSS px kept between the field and the keyboard. Shallow merge: a game that sets it gives all six fields |

Emits the global `ui:hot-swap` in a dev build only, listens to nothing. Depends on `time`,
`flow`, `world`, `renderer`, `input`, `anim`, `i18n`, `text`. Yoga arrives through
`await import("yoga-layout/load")` in `onStart`; nothing solves before it. `onStart` also registers `LocalWrite` through `input.controls.add`, so
the cursor shows a hand over a local-state button, one `input.onKey` listener for the focus, one
`input.onPointer` listener for the text fields, one `flow.fx.onHint` listener that hands released
hints to the `change` hooks of elements, and on a page the hidden input of the text fields;
`onStop` removes all of them. A dev build also installs the [hot swap](#hot-swap-dev) handler.

## What an element is drawn with

| Tag | Visual | Input |
|---|---|---|
| `image`, `icon` | `Sprite` at the rect, `fit` prop `"contain"` (default), `"cover"` or `"fill"`, `style.tint`, `style.alpha` | none |
| `text` | `Text`; a string `style` is the text style key; `bind={bind(Counter, "value")}` shows a numeric field of a component the element carries (only `bind()` makes a bind) | none |
| any other tag with `style.nineSlice` | `NineSlice` at the rect, `style.alpha`, `style.tint`, `style.debug` | as below |
| any other tag | a rounded `Shape`, drawing nothing on a container with no fill and no stroke (no fill, stroke width 0, the alpha of its style); with no `fill` nothing is painted inside (`fillAlpha: 0`): a `stroke` alone draws a ring, a bare button such as a text link shows only its label. `style.shape: "triangle"` fills the box pointing right (turn it with `rotation`), `style.dash` dashes the stroke (gaps of half a dash) | as below |
| `button` | as above | `Tappable` with `intent`, `Touchable` + `LocalWrite` with `local`, `Touchable` when disabled, covered or naming nothing; `Escapable` too with the `escape` prop, while it answers |
| `panel` | as above | `Touchable`: it swallows every tap and answers nothing |
| `scroll` | `Shape` with `clip`; children for a short list, or `rows`, `rowHeight`, `overscan`, `row` for a long one, see [Scroll windowing](#scroll-windowing) | `Touchable`, `Scroll` |
| `input` | as any other tag, with `clip` on the `Shape` or on the `NineSlice` of `style.nineSlice`; four ui-owned children draw the text, the caret, the selection and the IME underline, see [Text input](#text-input) | `Touchable` |
| any tag | `components` adds extra components to the element's entity, see [Extra components](#extra-components) | |

A `text` without a fixed `width` and `height` is sized by `text.measure` of what it shows: its
`content`, or for a bound text the string `text` shows for it, `Text.resolved`. Before the first
resolve that is the bound field of its `components` value in the format of the bind, so a number
a row centres is centred from the first frame. A new shown string asks for a solve only when it
measures to another size: a counter that rolls through digits of one width solves nothing.

`style.alpha` fades the element and everything inside it: a disabled button at `alpha: 0.6`
draws its icon and its label at 0.6 too, and a column at `alpha: 0` hides its children. The
renderer applies it once, on the element's wrapper (see the renderer README).

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

## Extra components

Every tag takes `components`: a list of component values added to the element's entity, next to
the ones the tag writes itself. `ui` knows nothing about what they are: a filter of `effects`, such
as `Glow` or `Blur`, or a game's own component.

```tsx
// a glowing claim button; the glow covers the button and its label
<button key="claim" intent="claim" components={[Glow({ strength: 2 })]} />

// a blurred board behind a popup: the blur sits on the slot that hosts the board
<stack key="boardSlot" hosts={["board.items"]} style={boardSlot} components={[Blur({ strength: 6 })]} />
```

A filter covers the entity's subtree, so the blur goes on the slot that hosts the board views, not
on a `layer`: a `<layer components={[Blur(...)]} />` blurs its own children only.

- Mount: the extras are added after the element's visual and input, before `Box`, so a `Box` hook
  sees them.
- Patch: a new name is added; a name whose fields changed (shallow, `Object.is` per field) is set,
  without the fields its type gives to a plugin; a name that left is removed. The same fields write
  nothing, so a tween on `Glow.strength` from a motion hook survives an unrelated re-render.
- Exit: nothing is removed. An exiting element keeps its extras until it despawns.
- A `scroll` gets them on the container, not on its content.
- Of two values of one type, the last wins.

The element owns `Transform`, `Box`, `Layer`, `Order`, `Parent`, `Sprite`, `NineSlice`, `Shape`,
`Text`, `Tappable`, `Touchable`, `LocalWrite`, `Scroll`, `Escapable`, `Exiting`, `Pressed` and
`PointerOver`. A value of one of these types is dropped, never written, and logged once per
element and name. Nothing throws: the element keeps its own component and the screen draws.

```tsx
<button key="claim" intent="claim" components={[Transform({ x: 10 })]} />
// ctx.log.error("ui:component-owned", { key: "claim", component: "Transform" }); the Transform of the layout stays
```

An element without a key is logged with its identity as `key`.

### `change` hooks for extras

`ui` records the rest of every extra with a value at mount and whenever a name is added
(`world.projection.setRest`), so `view.toRest(Counter)` has a rest from the first frame. When a
re-render changes the fields of an extra and the element's `motion.change` has a hook of that
component's name, `ui` records the new rest, cancels the motion the last change of that name
started (the value stays where it is), and plays the hook with `(view, previous, next, hint)`.
When the hook returns a motion, nothing is written directly: the track brings the value home from
where it is. Without a hook, or when it returns nothing or throws (`ui:motion-failed`), the fields
are written directly as before. A field the component type gives to a plugin (`Countdown.left`) is
never written by a render, and its rest keeps the entity's value. The motion of an extra counts
for the exit: an element that leaves while its counter rolls despawns when the roll ended.

```tsx
// the coin counter is the number of the pill, nothing else exists for it
<text key="coinPillText" style="ui.number" bind={bind(Counter, "value")}
      components={[Counter({ value: coins })]} motion={{ change: { Counter: rollCoins } }} />
// a commit that raises coins re-renders the HUD: ui records the new rest of Counter, plays rollCoins
// with the `coins.fly` hint of that commit, and the track rolls Counter.value; text shows Math.round of it
```

The hint is routed the way the world routes it to projection views: `ui` buffers every released
hint, and while a root reconciles, an element gets the first hint whose payload has a top-level
value equal to its key, narrowed to its root when the payload names a `projection` (the projection
of a screen, the component of a popup). An unkeyed element gets none. The same hint reaches every
`change` hook of that element in that frame step: the extras, `change.Box` and `change.Transform`.
A hint no element takes is dropped; the buffer is empty at the end of every frame step.

```ts
fx.emit(hint("coins.fly", { projection: "hud", key: "coinPillText", ms: 400 }));
```

## Scroll windowing

A long list keeps only the rows in view plus `overscan` on each side as elements, entities and
Yoga nodes. Every row has the same height, so the range is arithmetic and the scroll range exact.

```tsx
<scroll key="shop" style={list} rows={items.length} rowHeight={80} overscan={5}
        row={index => <ShopRow key={items[index].id} item={items[index]} />} />
// at offset 0: rows 0 to 24 exist, 25 of the 1000, for 80 u rows in a 1600 u list with overscan 5
```

| Prop | Meaning |
|---|---|
| `rows` | how many rows the list has; rounded down to a whole number of 0 or more, with one warning `ui:scroll-rows-rounded` |
| `rowHeight` | the height of every row in reference units; not above 0 throws `[game] Scroll rowHeight must be above 0.` |
| `overscan` | rows kept beyond each edge of the viewport; 5 when left out, a negative one is 0 |
| `row` | builds the row at an index; called at reconcile for the rows in the window, never at build time |

- **The range.** `first = max(0, floor(−offset / h) − overscan)`, `last = min(rows − 1,
  ceil((−offset + H) / h) − 1 + overscan)` with `H` the height of the scroll's rect. An empty list
  holds no row. Before its first solve the scroll uses its style's `height` when it is a number,
  else the viewport's; the next frame corrects it.
- **The content** is one column: a spacer for the rows above, the rows of the window, a spacer for
  the rows below. Its height is `rows × rowHeight`, so `Scroll.min` is exact. The spacers are never
  listed by `tree()`, never keyed, never found.
- **A row** is exactly one node; a row without a `key` is keyed by its index. `ui` writes the row
  height over its style (`height`, `shrink: 0`); another height in its style is one warning
  `ui:row-height-overridden` per scroll. A callback that answers none or several nodes is one error
  `ui:row-not-one-node` with `{ key, index }` per scroll, and an empty slot of the row height stands
  in. A callback that throws fails its root (`ui:root-failed`) like any view.
- **Before the diff.** Each frame the scroll step moves the content with the finger, then every
  windowed scroll cuts its range at that offset, before any root is diffed: a row never arrives a
  frame late. A range that moved re-renders only the list, on the stored node of the scroll: no view
  above it runs, the root solves once, and `UiCounters.windowRenders` counts it. A still window
  re-renders and solves nothing.
- **Rows that leave the window** despawn and free their nodes in the same frame, with no `exit`
  hook and no `Exiting`: leaving the window is not a removal. Rows that enter by a range change play
  no `enter` hook; a `loop` starts at once. When the list itself changes on a re-render, rows that
  appear or vanish play `enter` and `exit` like any element.
- **Row state belongs in the model: a row that leaves the window loses its local state.** Its
  component instances are forgotten with it, and it comes back fresh. A focused row that leaves
  drops the keyboard focus; a text field being edited in it is done; a pressed row takes `Pressed`
  with it and its press answers nothing. No row is pinned.
- **Keys and doors** know the live rows only: `find`, `world.projection.entityOf`, `input.tap` and a
  `guide` target answer for a row inside the window and not for one outside it. `lint()` checks the
  live rows. `tree()` lists them as the children of the content and adds `window: { first, last,
  rows }` to the scroll node.
- A list that shrinks below its window clamps the window and the offset in the same frame.
- Some but not all of `rows`, `rowHeight` and `row` throws `[game] A windowed scroll needs rows,
  rowHeight and row.`; children next to `row` are ignored with one warning
  `ui:scroll-children-ignored`. `axis: "x"` still throws.

The child form, a `scroll` with children and no `rows`, is unchanged: keep it for short lists.

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
  `Tappable` or `LocalWrite`, and the text fields) in reading order: the upper rect first, then
  the left one. Both wrap. Tab landing on a text field starts its editing; leaving one ends it. With no control, Tab does nothing and the browser keeps the key. A button with `escape`
  and no children is a popup's backdrop, not a Tab stop: Escape and a tap still reach it.
- **Enter / Space** tap the focused control through `input.tap`, the same door a finger uses:
  the intent is answered, or the `local` patch is written. The focus stays.
- **Escape** taps the button with the `escape` prop in that root: the close button or the
  backdrop of a dismissable popup. Nothing without one.
- **A pointer tap** clears the focus: the ring shows only after a key (focus-visible). A tap on a
  text field focuses it with no ring.
- **While a text field is edited**, Enter submits it and Escape ends the editing; see
  [Text input](#text-input).
- The focus drops when its element leaves, or its root gets covered or another root comes over
  it.

The focused element resolves `is.focus`. Around it `ui` draws one overlay it owns: a solid halo
under a dashed ring (`config.focusRing`), `offset` outside the drawn rect with a corner radius of
the element's `radius` plus `offset`, in the layer of its root, above its elements. Hidden
without focus.

```tsx
<button key="close" intent="close" escape style={{ is: { focus: { scale: 1.05 } } }} />
```

A headless test presses keys through `app.input.pressKey("Tab", { shift: true })`.

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

## Doors

`inspect.ts` holds the two ui sources of the editor's read door, `@moku-labs/game/inspect`. Both
only read, so they are safe in a production build. `game.ui` needs an app with `ui`; `game.locate`
one with `ui`, `renderer` and `world`.

| Key in `sources` | id | Input | Changes | Reads |
|---|---|---|---|---|
| `ui` | `game.ui` | none | frame | `app.ui.tree()`: the live screen as plain data |
| `locate` | `game.locate` | `{ key: "string?", target: "json?" }`, exactly one | frame | `{ x, y, w, h }` of the element with that `key` or of the view `target: { projection, key }`, in CSS px of the page, or `undefined` |

`game.locate` answers where something is drawn, by either address the doors use. It replaces
`game.rect`, which answered the key form only; `{ key }` answers the same numbers.

1. Exactly one of `key` and `target`, else it throws `[game] game.locate takes a key or a target.`
   `target` is read the way `game.tap` reads it.
2. `key`: only a live element counts. When `app.ui.find(key)` has no entity, the answer is
   `undefined`. It starts from the element's `rect` in `tree()`: its layout box from Yoga, not the
   Pixi bounds, so a bare button with no fill, such as a text link, has a rect too. Every fitted
   element on the way up, the element itself included, scales that rect by its `fitScale` about
   the centre of its own rect, the way `fit: "contain"` draws it.
3. `target`: `world.projection.entityOf(projection, key)`, then the box the renderer draws for that
   entity (`renderer.sync.boundsOf`). `undefined` when the view is not live or has no drawn box, as
   always while the renderer is inert.
4. Both corners go through `renderer.viewport.toScreen`, so the rect is in CSS px of the page.
   While the renderer is inert, as in a headless test, a key's rect stays in reference units.

```ts
import { read, sources } from "@moku-labs/game/inspect";

// An e2e script finds the Play button on the page before it clicks there.
read(app, sources.locate, { key: "play" }); // { x, y, w, h } in CSS px
read(app, sources.locate, { key: "nothing" }); // undefined: no live element has this key
// An agent finds a board item before it drags it.
read(app, sources.locate, { target: { projection: "board.items", key: "c7" } }); // { x, y, w, h }
```

`control.ts` holds the two ui commands of the editor's write door, `@moku-labs/game/control`,
dev builds only. `tap` goes through `app.input`, so the gate decides; `fill` goes through
`app.ui.fill`, which writes a component's `local` and answers nothing. The session stays clean
(effect `route`). They need an app with `input` and `ui`.

| Key in `commands` | id | Input | Does |
|---|---|---|---|
| `tap` | `game.tap` | `{ key: "string?", target: "json?" }`, exactly one | `input.tap` on the ui element with that `key` (through `ui.find`) or on the view `target: { projection, key }` |
| `fill` | `game.fill` | `{ key: "string", value: "string" }` | `ui.fill(key, value)`: types into the text field with that `key`; answers `false` for a key that is no live `input` |

```ts
import { commands, run } from "@moku-labs/game/control";

// An e2e script taps the Play plank of Home.
(await run(app, commands.tap, { key: "play" })).value; // true
// The Rename popup rests: type the name, then submit it with the Enter key.
(await run(app, commands.fill, { key: "nameField", value: "Alex" })).value; // true
await run(app, commands.key, { key: "Enter" }); // the gate takes { intent: "save", payload: { name: "Alex" } }
```

## Hot swap (dev)

`hot.ts` takes the save of a view module while the game runs, with no reload. Only a dev build
installs it: `onStart` checks the inline guard `typeof __MOKU_GAME_DEV__ !== "undefined" &&
__MOKU_GAME_DEV__`, so a production `define` folds it and the module leaves the bundle. It sets
`globalThis.__moku_hot(next, file)`, which the footer of `@moku-labs/game/hot` calls with the new
exports of the saved module. `onStop` deletes it while it is still this app's handler, so a second
app on the page keeps its own.

The dev server appends the footer through `bunfig.toml`:

```toml
[serve.static]
plugins = ["@moku-labs/game/hot"]
```

Every export of the saved module is sorted, in this order:

| Export | What happens |
|---|---|
| a `defineComponent` definition | replaces the component of that name, or adds it |
| a projection spec: string `name` and `layer`, `from`, `view`, and `key` unless `from` returns one object | `world.projection.replace`: a mounted one runs its new `view` |
| an animation: own string `id`, a `build` function, `slots` | `anim.replace`: the next `play` builds the new tree; a running timeline keeps its own |
| an emitter: own string `id`, a `config` object | nothing in ui: `effects` takes it from the `ui:hot-swap` event; live particles keep their bake |
| the `default` export of `generated/strings.<locale>.ts`, a record of functions | `i18n.replace(locale, messages)`, the locale read from the path: every label re-resolves |
| text styles: `{ kind: "textStyles", map }` | `text.replaceStyles`: every label is laid out again and redrawn with the new style |
| an object or a function with an own string `kind`, an object with an own string `id` or `name` | refused: a scene, flow, node, system, ECS component, filter, feature or plugin is registered by value at start |
| anything else: styles, tokens, motions, numbers, plain functions, function components | nothing: Bun already gave the importers the new binding |

The strings files are written by `bun run assets:keys`, which compiles
`features/*/strings/<locale>.json` into `generated/strings.<locale>.ts`. After a JSON edit, run it
again: its save is what the hot swap takes.

The replaces that may throw run first: projections, then animations, then strings. Then the
components and the text styles are written, every ui root reconciles and solves on the next
frame, `world.projection.rerunAll()` runs every projection again, and `time.wake()` lifts the idle
cap. Last, the global event `ui:hot-swap` carries `{ file, module }` with the exports, and
`ui:hot-swap` is logged at info with `{ file, components, projections, animations, emitters,
strings, textStyles }`: names, ids, locales and style names. This runs for a module that swapped
nothing too, so a saved `styles.ts` shows on the next frame. Component instances keep their
identity, so their `local` stays. The flow is not touched.

A refusal logs `ui:hot-refused` at info with `{ file, reason }` and throws
`[game] Hot swap refused for <file>: <reason>.\n  The page reloads and restores its state.` Bun
turns the throw into a full reload, which restores the state. The reasons:

| Reason | When |
|---|---|
| `exports "<export>", registered at start` | the module exports a value of the refused row |
| `"<name>" is a new projection, a scene mounts it` | `world` has no projection of that name |
| `"<id>" is a new animation, a feature registers it` | `anim` has no animation of that id |
| the first line of the `world` error | a mounted projection names a `layer` or `lift` the scene does not declare |
| the first line of the `i18n` error | the strings match no registered module of the locale, or more than one |
| `the module did not evaluate` | a syntax error: there is no namespace |
| `no exports` | the module exports nothing |

Every export is sorted and every replace that may throw has run before any component or text
style is written, so a refused module changes no component and no style. A replace that ran
before the refused one stands until the reload drops it.

```ts
// The footer `@moku-labs/game/hot` appends to a saved `settings.tsx`. Its `Settings` component
// is swapped: the open popup repaints on the next frame with the tab the player picked.
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.accept(next => {
    const swap = globalThis.__moku_hot;
    if (typeof swap !== "function") throw new Error("[game] No running game takes the hot swap.");
    swap(next, "/game/features/settings/settings.tsx");
  });
}
```

## Text input

The `input` tag is a text field. The text lives in the `local` of the nearest component: every
keystroke writes it, and the journal sees only the answer Enter submits. No keystroke is an
intent.

```tsx
export const Rename = defineComponent("Rename", {
  local: { name: "" },
  outcomes: { save: type<{ name: string }>(), close: type() },
  view: (props, local) => (
    <PopupScreen id="rename" dismiss="close">
      <input key="nameField" local="name" maxLength={16} submit="save" placeholder={tr("rename.hint")} style={field} />
      <text key="count" content={`${local.name.length}/16`} />
      <button key="ok" intent="save" payload={{ name: local.name }} />
    </PopupScreen>
  )
});
// the node gets { name: "Alex" } through the gate, from Enter or from the button
```

| Prop | Meaning |
|---|---|
| `local` | required: the local field of the nearest component the field writes. Without it the tag throws `[game] An input needs a local field.` |
| `submit` | the intent Enter answers with `{ [local]: value }`; without it Enter does nothing |
| `maxLength` | the longest value, in UTF-16 units: the DOM `maxlength` and the cut of `fill` |
| `placeholder` | a string or a message, drawn while the value is empty; also the `aria-label` |
| `kind` | `"text"` (default), `"number"` (a decimal keyboard, the value stays a string) or `"email"` |
| `textStyle` | the text style key of the value, the placeholder and the caret height; `"body"` by default |
| `style` | the layout style of the field box: `fill`, `stroke`, `radius`, `nineSlice`, `padding`, `width`, `height` |

A field outside every component draws and takes the focus, writes nothing and warns once
(`ui:input-without-component`). `IntrinsicElementsFor` narrows `textStyle` to the game's text style
keys and `placeholder` to its message keys.

### What it is drawn with

The field is the element entity: its `Shape` clips (a nine-slice field draws its slices and
clips to them through `NineSlice.clip`), and it carries `Touchable`. Four ui-owned children with
`Parent` = field draw the rest: the selection box (`textInput.selection` at `selectionAlpha`),
the `Text` of the value, or of the placeholder at `alpha: 0.5`, the caret
(`textInput.caretWidth` wide, a measured line tall, `textInput.caret`, steady) and the IME
underline. They have no Yoga node and no key: `tree()` lists the field with its `value` and not
the parts, and `lint()` counts the field as a tap target, never a part. A value wider than the box
scrolls left so the caret stays inside. Every position is `text.measure` of a prefix of the value,
over the characters the font draws: a character the font has no glyph for (an emoji, CJK) is
drawn as nothing by Pixi, so `text.hasGlyph` leaves it out and the caret and the selection never
stand past the drawn text.

### The hidden input

On a page, `ui` makes one `<input>` in `onStart` (found through the renderer's canvas), appended to
the body, removed in `onStop`: `position: fixed`, `opacity: 0`, `pointer-events: none`,
`font-size: 16px`, with `enterkeyhint="done"` and autocomplete, autocorrect, autocapitalize and
spellcheck off, outside every `<form>`. It holds the focus, the keyboard and the real text; the
canvas draws. While a field is edited it sits over the drawn field, where a desktop IME window
anchors. Headless there is none, and the mirror of the text is the whole truth.

### Editing

| Moment | What happens |
|---|---|
| a finger lifts on a field | inside the DOM `pointerup` (`input.onPointer`), the input is set up for that field and focused with `preventScroll`: the keyboard opens. iOS shows none for a focus made in the next frame |
| the tap resolves (`input.onTap`) | the field is the one edited; the keyboard focus moves to it with no ring |
| a finger goes down outside every field | the input blurs at once: the keyboard leaves |
| the input blurs, Escape, a tap elsewhere, the field leaves, its root is covered or leaves | done: nothing is edited, the lift drops, the local keeps the value. A blur never submits |
| Enter | with `submit`, the gate is answered with `{ [local]: value }`; the field stays edited, so a refused answer leaves the player typing. Without `submit`, nothing |
| Tab | moves the focus on and ends the editing; landing on a field starts it with the ring shown |
| `app.ui.fill(key, value)` | the field is edited, the value is written into it and into the local |

Every frame, before the roots re-render, the value, the selection and its direction are read from
the input into the mirror and written into the local, so the component re-renders in the same
frame. A focus no tap resolved on (a press that slid away) is blurred by the next frame step.
Enter and Escape reach `ui` through `input.onKey`, which skips every other key typed into the
input and an IME commit, so `app.input.pressKey("Enter")` submits headless:

```ts
app.ui.fill("nameField", "Alex"); // true
app.time.step(16);
app.input.pressKey("Enter"); // true: the gate took { intent: "save", payload: { name: "Alex" } }
```

### Above the keyboard

While a field is edited, `ui` follows `visualViewport` (`resize`, `scroll`): the keyboard covers
`inset = innerHeight − (offsetTop + height)` CSS px, and the root of the field is lifted by
`max(0, fieldBottom + keyboardMargin − (innerHeight − inset))` through `setRest` and a 0 ms rest
track, so loops re-base and nothing fights. iOS does not pan the page for an invisible input. The
lift drops at done, not at the late resize; the listeners go with it.

### Not covered

No native paste menu or long-press selection on the field (the input takes no pointer), no
multi-line field, no grapheme clusters in the caret index (`selectionStart` counts UTF-16 units),
no Android measurements.
