# ui

The interface as one more projection. A screen is a projection whose `view` returns JSX; `world`
wraps that tree in `Tree` and `ui` reconciles it by identity into entities it owns, with a `Box`
rect from one Yoga solve per change.

| Module | Owns |
|---|---|
| `jsx` | the runtime, the intrinsic types, `defineComponent`, instances and their `local`, the reconcile, the windowed rows of a `scroll`, the routing of hints to elements, the `onTap` application of `LocalWrite`, the keyboard focus, the text fields and their hidden input, `tree()`, `find()`, `lint()`, `fill()`, `scroll()`, the tap counter of `DebugTrigger` |
| `styles` | `defineStyle`, `defineTokens`, the `is` and `when` flags, `resolve` |
| `layout` | Yoga load and node lifetime, the solve, `Box` writes, the rest pose, motion, exiting elements, the scroll on both axes (finger, fling, snap, offset, range) and the range of a windowed scroll, the `popup` and `guide` handlers, the system `ui.guide` that places a guide's veil and lock every frame (see [Guide](#guide)) |
| `visual.ts` | pure, shared by `jsx` and `layout`: the visual component of an element, the fit scale and the drawn rect under `fit` |
| `drawn.ts` | where a view or an element is drawn in screen reference units: the resolver `<anchor>`, `app.ui.rectOf` and the guide share |
| `anchor.ts` | the system `ui.anchor`: every `<anchor>` placed on its targets after the solve (see [Anchor](#anchor)) |

| Member | Answers |
|---|---|
| `app.ui.tree()` | the live screen as plain data: natural rect, style, seven state flags, local, `fitScale` on a fitted element, `content` on a text (the words it draws, after `tr()` and `bind`, tags left out), `textStyle` on a text given a style key, `value` on a text field, `window` on a windowed scroll, children |
| `app.ui.find(key)` | the entity of a keyed element, live only, never one of a scene built aside or of a window held warm |
| `app.ui.lint()` | on the screen, never in a scene built aside: tap targets under `tapTargetPt` at their drawn size (text fields and `DebugTrigger` views count), text that overflows in some locale, an absolute element with no `reason`, a nine-slice on a clipping element (`nine-slice-clipped`), a `hollow` style with no `nineSlice` (`hollow-without-nine-slice`), a `zIndex` on a root element (`z-index-on-root`) |
| `app.ui.fill(key, value)` | types into the text field with that `key`: it becomes the one edited, `value` cut to its `maxLength` is written into it and into its component's `local`; `false` and the warning `ui:fill-without-input` when no live `input` has the key |
| `app.ui.scroll(key, to)` | puts the `scroll` with that `key` at `to` from its start, at once, kept inside `0..max`: a fling or a glide stops and `ScrollState` reads `moving: false`; `false` and the warning `ui:scroll-without-scroll` `{ key }` when no live `scroll` has the key, `false` and the warning `ui:scroll-before-solve` `{ key }` when the `scroll` came in this frame and its first solve has not placed it yet. Works headless. See [Scroll](#scroll) |
| `app.ui.rectOf(target)` | where a target is drawn, in screen reference units: `{ projection, key }` (an `AnchorTarget`) or a list of them, whose shown ones it spans; `undefined` when none is shown. Every build, headless too; a new object per call. See [Anchor](#anchor) |

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
hints to the `change` hooks of elements, with a renderer that draws `ui`'s part of a scene build through
`world.projection.onBuild` (see [A scene built aside](#a-scene-built-aside) and
[Warm windows](#warm-windows)), and on a page the
hidden input of the text fields; `onStop` removes all of them. A dev build also installs the [hot swap](#hot-swap-dev) handler.

## What a re-render costs

A `view` returns a new description at every commit that reaches its screen. `ui` compares it with
the one before: element by element, prop by prop, by value. An element that says what it said costs
the comparison and nothing else. No style is resolved, no layout node is written, no solve runs, no
component is set, so `changed()` names none of its components.

```tsx
// Both cost the same. The inline object is new at every render and says what the last one said.
<row key="bar" style={{ gap: 8, padding: 16 }} />
<row key="bar" style={barStyle} />
```

| What changed on an element | What runs for it |
|---|---|
| nothing | the comparison |
| `style`, `state`, a pointer or focus flag, a covered root | its style is resolved again and its components are written. Its layout node is written and its root solves once when a rect may move, and for a new `style` prop |
| `content` | its layout node is written and measured again, its root solves once, its components are written |
| `bind`, `texture`, `name`, `fit`, `intent`, `payload`, `local`, `escape`, `components`, `motion` | its components are written. No style pass, no solve |
| `hosts`, the props of a windowed `scroll`, the `snap` and `offset` of a `scroll`, the props of an `input`, the children | read at every render where they are used. The element itself is not written |
| the viewport (size, orientation, safe area), a dev hot swap | every element is patched in full once: style, layout node, components |
| the locale, a font that arrives after the mount | no element is patched and no view runs. The texts `text` resolves again are measured in that frame; when the line of the `body` style moved, every `icon` without a size is too, on a screen with no text as well. A root solves once when a size in it changed |

- **Plain objects and arrays compare by value, anything else by identity.** A literal object, an
  object without a prototype and an array say the same when their content does, however deep. A
  function, a `Set`, a `Map`, a `Date` and a class instance are the same only when they are the
  same object: a prop that holds a new `Set` at every render is written at every render.
- **Hooks stay built once.** A `motion` from `defineMotion`, or a hook table at module level, is the
  same function at every render. An arrow written inline in a view is a new one each time, so its
  element is written at every render: no style pass and no solve, but one write pass.
- **A style is a value.** Write it inline or keep one from `defineStyle`. An object changed in place
  is the same object, so the change is not seen until that element is resolved again.
- **A patch that throws** is done in full at the next render.
- **A pointer or focus flag restyles one element.** A press, a release, the mouse over it and the
  keyboard focus resolve the style of that element and write its components; no view runs and its
  root is not diffed. A view never reads these flags, so the next render finds them in step.

`UiCounters` counts both passes: `styled` is one per element whose style was resolved or written
onto its layout node, `written` one per live element whose components were written again. On a
screen of 200 elements with every style inline, a commit that changes a field the screen does not
draw adds 0 to both, solves nothing and sets no component.

## What an element is drawn with

| Tag | Visual | Input |
|---|---|---|
| `image`, `icon` | `Sprite` at the rect, `fit` prop `"contain"` (default), `"cover"` or `"fill"`, `style.tint`, `style.alpha`, `style.blend` | none |
| `text` | `Text`; a string `style` is the text style key; `bind={bind(Counter, "value")}` shows a numeric field of a component the element carries (only `bind()` makes a bind) | none |
| any other tag with `style.nineSlice` | `NineSlice` at the rect, `style.alpha`, `style.tint`, `style.debug`, `style.blend` | as below |
| any other tag with `style.nineSlice` and `style.hollow: true` | the same `NineSlice` with `hollow: true`: the rim alone, the centre left unfilled; the hit box stays the whole rect | as below |
| any other tag | a rounded `Shape`, drawing nothing on a container with no fill and no stroke (no fill, stroke width 0, the alpha of its style); with no `fill` nothing is painted inside (`fillAlpha: 0`): a `stroke` alone draws a ring, a bare button such as a text link shows only its label. `style.shape: "triangle"` fills the box pointing right (turn it with `rotation`), `style.dash` dashes the stroke (gaps of half a dash). `style.shape: "arc"` draws only the `stroke` of `strokeWidth` on the circle inscribed in the box (`min(width, height) − strokeWidth` across, centred), from 12 o'clock clockwise over `style.sweep` of it (0 to 1, default 1, clamped: 0 draws nothing, 1 a closed ring), its ends `style.cap` (`"round"`, the default, or `"butt"`); `fill`, `radius` and `dash` do nothing on an arc. An arc writes `sweep` and `cap` into its `Shape` in every render; a rectangle or a triangle writes neither, so after an arc they stay on its `Shape`: only an arc reads them; a rectangle or a triangle ignores them. A render with another `sweep` patches the `Shape`, and the arc is built again once: `<stack key="slotTimer" style={{ ...ring, sweep: left / total }} />` | as below |
| `button` | as above | `Tappable` with `intent`, `Touchable` + `LocalWrite` with `local`, `Touchable` when disabled, covered or naming nothing; `Escapable` too with the `escape` prop, while it answers |
| `panel` | as above | `Touchable`: it swallows every tap and answers nothing |
| `scroll` | `Shape` with `clip`; children for a short list, or `rows`, `rowHeight`, `overscan`, `row` for a long one, see [Scroll](#scroll) and [Scroll windowing](#scroll-windowing) | `Touchable`, `Scroll`, `Scrollable`, `ScrollState` |
| `input` | as any other tag, with `clip` on the `Shape` or on the `NineSlice` of `style.nineSlice`; four ui-owned children draw the text, the caret, the selection and the IME underline, see [Text input](#text-input) | `Touchable` |
| any tag | `components` adds extra components to the element's entity, see [Extra components](#extra-components) | |

A `text` without a fixed `width` and `height` is sized by `text.measure` of what it shows: its
`content`, or for a bound text the string `text` shows for it, `Text.resolved`. Before the first
resolve that is the bound field of its `components` value in the format of the bind, so a number
a row centres is centred from the first frame. A new shown string asks for a solve only when it
measures to another size: a counter that rolls through digits of one width solves nothing. A text
without `bind` is measured again the same way when `text` resolves it again: a message after a new
locale, any text when its font arrives. An `icon` without a `width` and `height` is square on one
line of the `body` text style, and is measured again when that line moves.

A text whose style has `wrap: "box"` wraps at the width its element is laid out at: it is measured
at the width Yoga offers (exact or at most; one line when the width is not bounded), so its element
is as high as its lines, and `ui` writes its laid-out width into `Text.box`, which `text` draws it
at. It is measured again at the same width, so a still screen solves nothing. Shrink is 0 by
default: a row only leaves the text less room than its one line when the boxes on the way to it
have `shrink: 1`, `<column style={{ shrink: 1 }}><text style="card.name" … /></column>`.

`style.alpha` fades the element and everything inside it: a disabled button at `alpha: 0.6`
draws its icon and its label at 0.6 too, and a column at `alpha: 0` hides its children. The
renderer applies it once, on the element's wrapper (see the renderer README).

A live element follows its state: a button that becomes disabled loses `Tappable` and
`LocalWrite` and keeps `Touchable`, so it stops answering the gate; enabled again, it answers.
`Scroll`, `Scrollable` and `ScrollState` are only ever added: hover, a press, a new look or a new
rect never resets where a scroll stands.

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

`style.hollow: true` draws the nine-slice of the style as its rim alone, written into
`NineSlice.hollow` (`false` by default, written in every render, so a variant that sets it ends
with it). For a frame or a glass panel whose middle is empty the GPU fills only the rim: the
centre's pixels are not drawn on any frame the panel is drawn. A tap in the middle still lands on
the element. Without `nineSlice` it does nothing, and `lint()` reports it as
`hollow-without-nine-slice`.

```tsx
<stack key="memFrost" style={{ nineSlice: "glass.frost", hollow: true, width: 960, height: 1400 }} />
```

`style.blend: "add"` or `"screen"` lays an `image`, an `icon` or the nine-slice of the style over
what is drawn under it, written into `Sprite.blend` or `NineSlice.blend` (see "Blend" in the
renderer README). `"add"` adds its colour, for a spark or a flare; `"screen"` lightens with it, for
a soft glow (on a dark background it matches CSS `mix-blend-mode: screen`). Without it the element
covers by alpha. An element that never blended carries no `blend` field, so a game's describe and
saved values stay as they were; once it blended, a render or a variant that drops the blend writes
`"normal"`, and the glow turns off. The rest the element records carries the same value, so a
restore draws the look the element has. It blends the element's own quad alone, never its children,
and does nothing on a rectangle, a shape or a text; no `lint()` rule reports that.

| Cost | |
|---|---|
| Render passes | 0: both are native blends of the sprite batch, no filter |
| Draw calls | quads of one blend next to each other in draw order share one; each switch between blends in draw order costs one more |
| Kept pictures | a filtered view with a blended element inside is drawn live, never kept as a picture (`renderer:kept-blend`, once) |

```tsx
<image key="glow" texture="art.glow" style={{ blend: "screen", alpha: 0.8 }} />
<button key="claim" intent="claim" style={{ nineSlice: "ui.button", is: { hover: { blend: "add" } } }} />
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
- Patch: a `components` list that says the same by value is not looked at. In a list that changed,
  a new name is added; a name whose fields changed (shallow, `Object.is` per field) is set, without
  the fields its type gives to a plugin; a name that left is removed. The same fields write
  nothing, so a tween on `Glow.strength` from a motion hook survives an unrelated re-render.
- Exit: nothing is removed. An exiting element keeps its extras until it despawns.
- `Overlay` (renderer, "Overlays and the HUD"): the element also gets the engine's `OverlayLevel`.
  Its level is one of the element's own motion tracks: 0 to 1 with its enter motion (the length,
  delay and ease of the longest timed track its `enter` hook started), back to 0 with its exit
  motion; `fade` (default 250 ms, kept under reduced motion) times it only when the hook played no
  timed track, and `fade: 0` sets it at once. `landed` turns true at the end of the solve in which
  every enter handle and the level track are over. The exit waits for the level: the dim and the HUD
  parts are back before the element despawns. A flow never waits for it.
- A `scroll` gets them on the container, not on its content.
- Of two values of one type, the last wins.

The element owns `Transform`, `Box`, `Layer`, `Order`, `Parent`, `Sprite`, `NineSlice`, `Shape`,
`Text`, `Tappable`, `Touchable`, `LocalWrite`, `Scroll`, `Scrollable`, `ScrollState`, `Escapable`,
`Exiting`, `Pressed` and `PointerOver`. A value of one of these types is dropped, never written, and logged once per
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
for the exit: an element that leaves while its counter rolls despawns when the roll ended. An
element whose exit waits for nothing (no `exit` hook, a hook that played nothing, a `when:
"change"` hook under `"mount"`) despawns in the frame of the reconcile that took it away, before
that frame is drawn: a keyed swap in one slot never shows both elements.

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
`change` hook of that element in that frame step: the extras, the visual, `change.Box` and
`change.Transform`. A hint no element takes is dropped; the buffer is empty at the end of every
frame step.

```ts
fx.emit(hint("coins.fly", { projection: "hud", key: "coinPillText", ms: 400 }));
```

### `change` hooks of the visual

The visual an element is drawn with (`Shape`, `Sprite`, `NineSlice` or `Text`, see
[What an element is drawn with](#what-an-element-is-drawn-with)) plays its `change` hook the way
an extra does. When a render or a restyle (a pointer or focus flag, a new rect) moves a number of
it (`sweep`, `alpha`, `fillAlpha`, `w`, `h`, any numeric field) and the element's `motion.change`
has a hook of that name, `ui` records the new look as the rest of the visual, cancels the motion
the last change of that name started (the value stays where it is), and plays the hook with
`(view, previous, next, hint)`: the look the element was last written with and this one. When the
hook returns a motion, the numbers are not written: the track brings them home from where they
stand (a hook that tweens one of them brings the others home too, with `view.toRest`), and the
fields that are no number (`kind`, `cap`, `clip`, a texture) are written at once. A render whose
solve then moves the rect (a bar that grows) plays the hook once more in that frame, again from
the look before the render, with the new size.

Without a hook, when it returns nothing or throws (`ui:motion-failed`), and on an element held for
the swap of a scene built aside, the look is written whole, as before. A look whose other fields
alone moved writes them and plays nothing, and a look that says what it said writes nothing, so a
running motion survives a restyle that changes nothing of it. The motion counts for the exit, as
an extra's does. A visual traded for another (a variant's nine-slice) takes its motion with it.

```tsx
// The XP arc of the level ring walks to a new share in 520 ms instead of jumping.
const arcMotion: Ui.ElementMotion = {
  change: {
    Shape: (view, previous: { sweep?: number }, next: { sweep?: number }) => {
      if (previous.sweep === next.sweep) return undefined;
      view.set(Shape, { sweep: previous.sweep ?? 1 });
      return view.toRest(Shape, { ms: 520, ease: "out" });
    }
  }
};
<stack key="xpArc" style={{ ...ring, shape: "arc", sweep: xp / xpToNext }} motion={arcMotion} />
// a commit from 0 to a quarter of the level: Shape.sweep runs 0 → 0.25 over 520 ms
```

A dev build names, once per element and hook name, a `change` hook `ui` never plays:
`ui:change-never-plays` `{ key, name }` for a name that is not `Box`, not `Transform`, not the
visual the element is drawn with and not an extra of its `components` prop (`change.Shape` on an
`image`, which draws a `Sprite`; `change.Alpha` with no `Alpha` among its extras). It is read when
the element mounts and when its `motion` prop changes, against what it carries then.

## Scroll

A `scroll` moves its content on one axis: `axis: "y"`, the default, or `"x"`. The children form
takes both; the windowed form moves on `y` only. The content is one element the scroll holds: a
column of the children on `y`, a row of them on `x`, as tall as the scroll on `x` and as wide on
`y`. It moves by one `Transform` write on the axis, so its children keep their rects, are hit where
they are drawn, and no solve runs.

```tsx
// The order strip of the board: a 306 u window over a 696 u track, three stops, opened on the orders.
<scroll key="strip" axis="x" snap={[0, 318, 390]} offset={318} style={{ width: 306, height: 120 }}
        components={[OrderStrip()]}>
  <row key="track" style={{ width: 696, height: 120 }}>
    {events.map(event => <EventTile key={event.id} event={event} />)}
    <OrderCard key="order" order={order} />
  </row>
</scroll>
// ScrollState of the strip from its first drawn frame: { offset: 318, max: 390, moving: false }
```

| Prop | Meaning |
|---|---|
| `axis` | `"x"` or `"y"` (default). Read when the scroll spawns: another axis on a later render keeps the first, with one warning `ui:scroll-axis-fixed` `{ key, axis }`. `"x"` with `rows` throws `[game] A windowed scroll moves on y only.` |
| `snap` | stops, as offsets from the start; each is kept inside `0..max`. A release glides to the stop nearest to `offset + v × 260` (`v` the offset's velocity in units a ms) |
| `offset` | where the scroll stands, from the start, kept inside `0..max`; 0 when left out. Its first drawn frame stands there. A new value on a later render glides there; the same value does nothing, so a scroll the player moved stays. A scroll that stands at its prop, or glides to it, follows it through a new `max`: a prop the first range was too short for (a text measured before its font arrived) is reached once the content grows. A press and `app.ui.scroll` end that until the next new value |

All numbers are reference units and milliseconds of `time` (`time.delta`): a time scale and a pause
apply.

- **The finger.** While the scroll carries `Pressed` the offset follows the finger on the axis, and
  ignores the other one. The first frame of a press, a hand-off from a child included (see the input
  README), takes the finger where it is as the start, and a fling or a glide stops where it stands.
  A finger that lands on a moving scroll only stops it: `input` gives the scroll that press, and it
  answers nothing.
- **The release.** The velocity comes from the last five samples of the finger, of the last 100 ms,
  kept in a ring in the layout state; a finger that stood still for more than 50 ms lets go with
  none. Without `snap` the scroll flings: `offset += v × dt`, `v ×= 0.998^dt`, until `|v|` is under
  0.02 units a ms. With `snap` it glides to the stop, on `1 − (1 − p)³` over
  `min(620, 260 + distance × 1.1)` ms; no glide when it stands on the stop already.
- **The range.** Every solve gives a scroll its `max`: its content past its window on the axis, or
  `rows × rowHeight` past its height when windowed, in whole units. A new `max` keeps the offset
  inside it at once, and a running glide's target too: when the pinned column of the board closes,
  the window grows 306 → 390 (`max` 390 → 306) while the game sets `snap` to `[0, 306]` and
  `offset` to 306 in the same render, and the strip stands on 306.
- **Hard edges.** The offset never passes 0 or `max`; a fling that reaches an edge ends there, and
  nothing passes the rest of a move to a scroll around it.
- **`ScrollState`** `{ offset, max, moving }` is on the scroll's entity, public: a game system queries
  it next to its own marker component, and the read door (`game.explain`) lists it. `offset` and `max`
  are whole units, `0..max`. It is written in a frame where the offset, `max` or `moving` changed, and
  once with `moving: false` when the scroll stops; a still frame writes nothing. `moving` is true
  while the finger holds it, it flings or it glides. While a scroll moves, `time.wake()` keeps the
  frames coming; at a time scale of 0 it asks for none, and a fling or a glide goes on where it
  stands once time runs again.
- The internal `Scroll` keeps the offset the way the windowed range is cut with: `Scroll.offset =
  −ScrollState.offset`, `Scroll.min = −max`. The internal `Scrollable` `{ axis, moving }` is what
  `input` reads for the hand-off and the catch. A game reads neither.
- **No allocation.** A held, flinging, gliding or still frame allocates nothing: the exact numbers
  live on the element's motion record and in the layout state, written in place, and the components
  get whole units through patches kept in the layout state (`__tests__/perf/scroll.perf.ts`).

```ts
// A test, an agent or a visual test puts the strip on its events at once.
app.ui.scroll("strip", 0); // true: ScrollState { offset: 0, max: 390, moving: false }
app.ui.scroll("nothing", 0); // false, with the warning "ui:scroll-without-scroll"
// A visual test: the step is the `game.scroll` command of the catalogue.
steps: [{ scroll: { key: "strip", to: 0 } }, { checkpoint: "strip-events" }];
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
  `ui:scroll-children-ignored`. `axis: "x"` throws `[game] A windowed scroll moves on y only.`

The child form, a `scroll` with children and no `rows`, is unchanged: keep it for short lists.

## Draw order

The order of a ui tree is what is drawn and hit. A child draws with its parent, always at an
`Order` of its own: its `zIndex` (an integer, 0 without one), less a half, plus its place among
its siblings in small steps (`childOrder` of `ui/jsx/order.ts`). So children draw and are hit in
markup order at equal `zIndex`, whatever order they were mounted in: a child a condition mounts
again draws under the sibling written after it. `zIndex` still lifts a child over its siblings; a
new value from a variant or a new render updates the `Order`, and a child that drops it goes back
to its markup place. A parent with more than 4096 children spills into the next `zIndex` step; a
dev build names it once (`ui:too-many-children`).

Inside one element, bottom first:

1. its own visual (depth −0.5);
2. its children at `zIndex` 0, in markup order;
3. what hangs under it at `Order` 0: the views a slot hosts, a game's own entities;
4. its children at `zIndex` 1, then 2, and so on.

The roots of a scene draw in the order of its `projections` (the k-th of n takes `Order` k − n − 1),
also after a commit mounts one again, and after a switch to a scene that lists the projection too:
the world keeps it and writes the `Order` of its new place on its entity, and the reconcile gives
every root element the `Order` of its entity once per new layer list, in the first layout phase that
runs under it, with no new tree (scenes, "A projection both scenes list"). The `ui` layer sorts by `Order` (`scenes` makes it so); a scene
that writes `ui: { sort: "none" }` keeps insertion order. Inside the `ui` layer, bottom first:

1. the scene's JSX roots, in list order;
2. the focus ring of a root, right above it;
3. everything at `Order` 0 or without one: a world view drawn in `ui`, a timeline `spawn`;
4. the popups (1, 2, …);
5. the guide dim.

A root element ignores `zIndex` (it draws at the order of its root in its layer), and `lint()`
reports it as `z-index-on-root`.
A JSX root draws in the layer its projection names (`layer: "scene"` puts it under every `ui`
root); a `Tree` spawned by hand without a `Layer` draws in `ui`.

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
  the top layer. A root of the scene's HUD layer (`{ above: "overlays" }`) never takes it: the HUD
  draws above every sheet, so Escape and the phone's Back press reach the top sheet under it.
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
has one, else the pose applies through a 0 ms rest track (delta 6): it writes the new pose in the
frame of the change, its pivot and its position together, and ends at the next frame step, where
an additive loop running on the element re-bases on the new rest. A new rect plays
`change.Box` when there is one.

The `motion` prop is a `Ui.ElementMotion`. Its two `change` hooks get typed values: `Transform`
the rest poses before and after, `Box` the rects. A hook of the visual the element is drawn with
(see [`change` hooks of the visual](#change-hooks-of-the-visual)) and a hook of an extra (see
[`change` hooks for extras](#change-hooks-for-extras)) play too, with the values before and
after. A hook for any other component name is accepted, so every `defineMotion` result fits; `ui`
never plays it, and a dev build names it once (`ui:change-never-plays`). One hook alone is a
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
next to `enter`, whatever the cause, and keeps its motion apart: the exit sweep never waits for it.
When the motion prop of a live element names another `loop`, the running loop is cancelled and the
new one starts; a motion without a loop, or no motion, stops it. A `defineMotion` built again with
the same loop (the same keys, cycle and reduced-motion rule) is the same loop: it runs on. Still,
declare a motion at module level: a dev build names an element whose loop was rebuilt by three
renders in a row (`ui:motion-rebuilt`), and a hand-written loop of a new reference restarts.

An element's `enter` hook plays at the element's `Box`, at the flush of phase `layout`, before any
`sync` system of the game sees the entity: a system of `sync` (a gate that reads the element's
alpha, say) sees the start pose the hook wrote, the pose the frame draws, never the rest pose
(F49). The hook keeps a note of the components it read with `view.get`. In phase `sync`, in the
system `ui.enter` (after every system of the game, before `renderer.sync` draws the frame), the
loop starts, and when a game system changed a component the hook read and did not write itself,
that play is undone (its motion cancelled, each field its `set` wrote given back the value it had,
unless something wrote it since) and the hook plays again on what the system wrote. So the
element's first drawn frame shows the pose the hook started from, and a hook may read what a
system wrote in that frame. A hook that reads nothing a system changes plays once; one that does
plays twice in that frame, so keep side effects out of an `enter` hook. A picture that grows out
of a thumbnail in a scrolled list starts where the thumbnail is drawn when a `sync` system adds
the list's `ScrollState.offset` to what the hook reads (F48):

```ts
const growScroll = system({
  name: "casefile.growScroll",
  phase: "sync",
  query: [GrowFrom],
  run: (rows, { world }) => {
    const [list] = world.query(CaseList, ScrollState);
    for (const [entity, from] of rows) {
      if (!from.scrolled) world.set(entity, GrowFrom, { dy: from.dy - (list?.[2].offset ?? 0), scrolled: true });
    }
  }
});
```

`ui` tells the `enter` and `exit` hooks why they play, as their fourth argument: `"mount"` when the
element comes or goes with its screen (a scene mount or unmount, a restore, a load), `"change"` when
a commit adds it to or removes it from a live tree, and for every element of a popup. A
`defineMotion({ when: "change" })` plays nothing for `"mount"`: the element stands at rest from its
first drawn frame, and leaves with no exit when its scene goes. A default motion plays for both.

An element a render replaces leaves the way a removed one does (F83, F84): the top of a root whose
view returns a tree of another key or tag, a child of another key or tag, the element a component's
view returns under another key or tag. The old element starts its exit with the cause `"change"`
and every element under it plays its own; it leaves `app.ui.find` at once, before the new one
enters, so the new element takes every key the two share, and `find` and `tree()` agree. A
component whose view returned another element keeps its local state.

```tsx
// The ward's view: a waiting root, then a ready root of another key; both hold the button "wardNext".
view: item => (item.ready ? <stack key="wardReady">{next}</stack> : <stack key="wardWait">{next}{card}</stack>)
// the commit that makes it ready: "wardWait" exits ("change") and its card plays its own exit,
// app.ui.find("wardWait") is undefined at once, app.ui.tree().key is "wardReady",
// app.ui.find("wardNext") is the new root's button
```

A root that goes with its screen ends with the exit of its top element (F55). When the top plays an
exit, the elements under it play none of their own: they stand and go with the top, the frame its
exit ends (F55b). So no exit under it holds the root, nor the bundles of the scene that left, and
the subtree does not change while the top fades: a top kept as a picture fades as that picture,
not drawn live through its filters. When the top plays none, the exits under it play and the root
waits for them, as a removal in a live tree does.

```tsx
<row key="card" motion={order.ready ? swayWide : swayGentle} />
```

### After a restore

After a restore or a load a ui element stands exactly as if its root had just been mounted with
the restored state. A restore that switches the scene gives that by itself: the scene is
unmounted and mounted. A restore inside the same scene gives the same picture, in two steps.

1. `world` brings every element home in the reconcile of the restore: it ends every track on the
   entity and writes the rest it holds for it, the `Transform`, the visual and the extras. An
   animation may have left an element anywhere: a timeline that moved it off the screen or faded
   it to nothing ends on that pose.
2. `world.projection.onConverged` calls `ui`, and the next reconcile builds every root again. The
   element tree is dropped at once, with no exit, and the root is entered through the mount path:
   a new entity with the components of the description, then the `enter` hook, then the `loop`.

So nothing a mount does is written a second time, and a game needs no extra code:

- An `enter` hook that places an element and returns nothing holds. It runs again, with the
  restored state, also when the screen is the same item as before and no view of a projection
  runs again.
- What a mount does not bring is gone with the old tree, as after a remount of the scene: the
  local state of a component, a scroll offset (a scroll stands at its `offset` prop again), the
  keyboard focus, a text being edited, a hover.
- The entity of an element is another one after a restore. Ask `ui.find(key)` again.
- A view hosted in a slot hangs under the new slot in the frame that builds it, as after a mount.
- Every element enters with the cause `"mount"`: a `when: "change"` motion stands at rest.
- A root that is leaving keeps leaving.

`ui` builds in phase `layout`, which a `paused` or `fast` world skips. Until the world runs
again the elements stand on the rest `world` wrote in step 1. Two things keep that rest right:

- The rest of the visual is recorded every time its look is written, not only at mount. So it is
  the look the element is drawn with now: a hover variant, a new `alpha`.
- The content of a scroll records no rest `Transform`. The scroll step owns its pose, so the
  list stays where the finger left it.

## Fit

`fit: "contain"` lays the element out at its own style size, out of the flow, and centres it in
the content box of its parent (the rect less its padding). Its rest `Transform.scale` is
`min(1, contentW / w, contentH / h)`. Its children keep their natural rects: `Box` under a fitted
element is natural space. `lint()` and the `guide` window scale a rect by every fitted element on
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

`screen`, `row`, `column` and `stack` take `hosts`: projection names. Every live view of those
projections (`world.projection.entitiesOf`) without a `Parent` and not `Held` by a drag gets
`Parent({ entity: element })`, in the frame the slot comes: the solve hosts the views of a slot
that became live in it, so they are drawn under it from their first frame and never alone in their
layer. A view draws in the element's local space, scales with it and keeps its `Order` inside it
(over the slot's children at `zIndex` 0). When the element leaves, or stops naming the projection,
the views lose that `Parent` and fall back to their layer; after a restore the new slot takes them
in the same frame. An exiting view keeps its host while its exit plays. A `guide` whose target is a
hosted view cuts its hole where the view is drawn: its pose through the `Parent` chain, and its
nine-slice or sprite size times that scale.

The hosting step walks the hosts only in a frame where something it reads moved: a host came, went,
became live or was patched, a view of a projection came or went, or a view lost its `Parent` or its
`Held`. An idle frame compares two numbers and walks no view.

```tsx
<stack
  key="boardSlot"
  hosts={["board.cells", "board.generators", "board.items"]}
  style={{ width: 970, height: 970, fit: "contain" }}
/>
```

A JSX projection named in `hosts` is laid out in the slot: its root is solved in the slot's
content box (the box less its padding), in the slot's own units, hangs under the slot at the place
`hosts` lists it, and moves and scales with the slot without a solve. A resized slot solves it again
in the same frame. A slot takes a projection with one root, or roots that place themselves
(`position: "absolute"`): every root of a keyed projection is solved in the whole box.

```tsx
<stack key="boardBack" style={backStyles.root}>
  <stack key="rowSlot" style={backStyles.rowSlot} hosts={["orders.row"]} />
  <stack key="boardField" style={backStyles.field} hosts={["board.cells", "board.items"]} />
</stack>
```

- A slot that exits keeps its root until it is gone: the root leaves with it.
- A slot that stops naming the projection gives the root back to its layer, solved at the viewport
  size, with no change motion: its rects changed units, not places.
- Two slots that name one projection: the first takes it, and a dev build names the other
  (`ui:slot-taken`). Two roots slotted in each other are laid out at the viewport and logged
  (`ui:slot-cycle`).
- The rects of a slotted root are in the slot's units. Every reader converts them to root
  coordinates: the focus ring, a text field, a guide hole and `tree()` (so the `ui` and `locate`
  doors and the `tap` and `drag` commands land where the element is drawn).
- While a scene is built aside, a host and a slot take nothing across the line: a live host no
  view or root of the build, a host of the build no live one. A kept host takes its coming guest in
  the frame after the swap. See [A scene built aside](#a-scene-built-aside).

## Anchor

`<anchor>` is an element whose rect is where its targets are drawn: a tutorial's window, a hint, an
arrow sits on an element of another projection without reading where it landed (a view runs before
the layout and reads none). `to` names one target, `{ projection, key }` (`AnchorTarget`), or a
list, whose shown ones it spans; a ui element is keyed under the projection of its root. `pad`
grows the rect outward on every side, in the units of the anchor's root (0 when left out). Its
children lay out inside it as in any element; its style gives its look, and a `width`, `height`,
`position`, `left`, `top`, `right` or `bottom` there is ignored (a dev build warns once,
`ui:anchor-style` `{ key }`).

```tsx
// The tutorial's window on the first seat of the board's order strip, a rim drawn around it.
<anchor key="window" to={{ projection: "board.strip", key: "seat0" }} pad={4} motion={glide}>
  <stack key="rim" style={{ nineSlice: "tutorial.rim", hollow: true, width: "100%", height: "100%" }} />
</anchor>
// the seat is drawn at { x: 40, y: 1500, w: 116, h: 120 }: the window at { x: 36, y: 1496, w: 124, h: 128 }
```

- **Where.** A target's local box (the layout box of a ui element, the panel of a nine-slice, the
  rectangle of a shape, the anchor box of a sprite) through its root pose: every `Transform` on its
  way up, so a fit, a slot, a scroll's offset and the motion of an ancestor move it. Axis-aligned:
  the rotation is left out. `app.ui.rectOf` answers the same rect. The union is mapped into the
  space of the anchor's parent through the parent's root pose, so the anchor may sit in a fitted,
  scrolled or slotted container.
- **When.** The system `ui.anchor` runs in phase `layout` right after `ui.solve`, so the anchor
  sits on its targets in the frame they are laid out, scrolled or moved by a system before it: no
  lag. A ui element spawned in this frame is found by its rest pose. An anchor and its subtree are
  a Yoga tree of their own, out of the flow of the parent: Yoga runs for it only when its size
  changes or a node of it is dirty (a child restyled, measured again, added or taken out); a pure
  move writes the rects in place. Anchors are placed in the order they came: one whose target lies
  inside another anchor that came after it sits a frame behind that anchor. A `scroll` (its first
  `offset`) and a slot host inside an anchor are settled by the solve, before the anchor pass: they
  take the anchor's rect a frame late.
- **Not shown.** A target is not shown when its key names no entity, it or something it is drawn
  under is leaving, it belongs to a scene built aside or a held warm window, it has no area, or the
  alphas on its way up multiply to 0.01 or less. The key of an element of a scene built aside or of
  a closed warm window names no entity (`entityOf`), so an anchor on it waits, and a dev build
  names it once after two frames. An anchor of such a scene or window is placed in the frame it
  opens. With no target shown the anchor is drawn at alpha 0 (its subtree is not
  drawn and takes no tap), stays, and shows again when a target does; one never shown yet waits
  with no components. A dev build warns once, `ui:anchor-target-missing` `{ key, to }`, after a key
  named no entity two frames in a row (a target spawned this frame is found a frame later). A
  target inside the anchor itself counts as not shown and is logged once:
  `[game] An anchor cannot point at its own child "key".` (`ui:anchor-own-child`).
- **Motion.** Its `change.Box` motion plays only when its targets change: a new `to`, or keys that
  name other entities (a view spawned again), and the rect moved. Following a moving, resizing or
  scrolling target starts no motion. While a motion that ends runs (the glide of a change, a look
  tween of its visual), a follow carries it by how far the target moved since it began, so it lands
  on the target with no jump; a new size sets the pivot at once. While a loop runs on the anchor, a
  follow holds its `x` and `y` from every track (`world.projection.mute`) and writes them; the loop
  gets them back in the frame the anchor stands and goes on from there. On a change of targets its
  children play their `change` hooks as any element whose rect moved; a follow that resizes the
  anchor gives them their rects with none.
- **Cost.** A frame of a still anchor and one of an anchor following a moving target (fractional
  numbers included), also under a loop, allocate nothing (`anchorStill`, `anchorMoving`,
  `anchorMovingLoop`): rects in place, `previous` by value, the `Transform` written field by field
  on its stored value. Three things happen once per follow instead of every frame: the hold of a
  loop when the follow starts, and in the frame the anchor stands the `Box` of the anchor and of its
  subtree (V8 boxes a fractional number written into a stored `Box` field: the shape of `Box`
  values is shared with frozen ones) and the world's copy of the anchor's rest pose.
- **Headless.** `app.input.tap(entity)` does not hit-test: a button inside a hidden anchor still
  answers it.

## Guide

`ui` draws a `guide` (the awaited `await fx(guide(options))` of a node body, and the `guide` a node
derives from state, see the flow README) as a veil over the screen with a window cut over its
targets, and locks `input` outside that window. The narrow of the gate belongs to `flow`: only
`allow` and `blocked` pass it.

```ts
// The tutorial's step on the strip: the first seat, a press anywhere else answers "tutorialBlocked".
defineNode({
  rest: true,
  outcomes: { seat: type(), tutorialBlocked: type() },
  guide: ({ session }) =>
    session.tutorial === 1
      ? {
          allow: { intent: "seat" },
          target: { projection: "board.strip", key: "seat0" },
          pad: 4,
          blocked: { intent: "tutorialBlocked" }
        }
      : undefined
});
// the seat drawn at { x: 40, y: 1500, w: 116, h: 120 }: the window at { x: 36, y: 1496, w: 124, h: 128 }
```

- **Where.** The window is the drawn rect of the target (the resolver of `<anchor>` and
  `app.ui.rectOf`: through fits, slots, scrolls and ancestor motion, rotation left out), or the
  bounding rect of the shown targets of a list, grown by `pad` on every side, in screen reference
  units. The system `ui.guide` of phase `layout`, right after `ui.anchor`, places it every frame,
  so the window follows a target that moves or scrolls, in the frame it moved.
- **The veil.** Four rectangles around the window, at `Order` 1 000 000 of the `ui` layer, above
  every popup: black at 0.6, or the guide's `veil: { color, alpha }`. `alpha: 0` draws nothing
  visible; `veil: false` spawns no rectangle. Without a target the veil is one rectangle over the
  screen. While no target is shown (not mounted yet, leaving, built aside, alpha 0), the veil covers
  the screen and every press is locked; it opens again when a target shows. A target not shown when
  the guide starts is named once, `ui:guide-target-missing`.
- **The lock.** `ui` hands `input` the window by reference (`input.lock.window(window)`) and writes
  it in place every frame; `null` while no target is shown, `undefined` when the guide ends. A press
  outside reaches no view (no `Tappable`, no `LocalWrite`, no scroll, no drag, no trace, no hover)
  and answers the guide's `blocked` when it names one; a drop outside finds no target. Inside the
  window everything works as before. `input` runs before `layout`, so a press reads the window of
  the frame before: one frame of lag behind a moving target. The doors `app.input.tap`, `press`,
  `drag` do no hit test and are not locked.
- **One at a time.** A new guide replaces the one shown: its veil leaves and its lock goes. The
  veil and the lock leave with the narrow that carried them, when the node is left. Fast mode draws
  nothing and locks nothing.
- **Your own look.** The rounded window, the rim, the glide between steps, the hand and the text
  are the game's: `veil: false` (or `alpha: 0`) keeps the lock, and an `<anchor>` on the same
  targets draws the look, glides with its `change.Box` motion and follows the target in the same
  frame the window does. `hand`, `text` and `highlight` of `GuideOptions` are not drawn by the
  engine (deprecated).

```tsx
// The game's tutorial window: the engine locks, the anchor draws the rim and glides between steps.
<anchor key="tutorialWindow" to={{ projection: "board.strip", key: "seat0" }} pad={4} motion={glide}>
  <stack key="rim" style={{ nineSlice: "tutorial.rim", hollow: true, width: "100%", height: "100%" }} />
</anchor>
```

- **Cost.** A frame of a standing guide, and of one whose target moves (fractional numbers
  included), allocates nothing (`guideStill`, `guideMoving`): the window and the rectangles are
  written in place, the veil's `Transform` and `Shape` field by field on their stored values, and
  the lock keeps the same window object.

## A scene built aside

On a live switch with a drawing renderer `scenes` builds the next scene while the old one stays
current, drawn and alive (spec 31). `world.projection.build` mounts the coming projections aside
and flags their views building (`isBuilding`); a view whose `view` returns JSX becomes a root of
the build. `ui` reconciles it by root and by part under the budget, lays it out once and applies it
in parts (spec 33, see [In parts](#in-parts)), starting in the frame after the build starts, and:

- marks every element it spawns for it as the build's (`world.projection.adopt`) right after the
  spawn, before the element gets a visual, and the parts of its text fields with them: the renderer
  holds their views, and a discard takes them with the rest;
- holds its motions: no `enter` hook plays at the `Box`, and the element stays in the queue of
  `ui.enter`, in its order, until the swap. A change before the swap (a text measured again, a
  store commit) plays no `change` hook and no track: the element takes its rect, its pose and its
  extras at once, so its `enter` starts from where it stands. In the first frame after the commit
  the held enters play in the order of a mount: their hooks write the start pose at the end of that
  frame's solve, where a `Box` lands, so the game's systems of `sync` see it (F49), and `ui.enter`
  keeps the play or plays it again (F48) and starts the loops and the level of an overlay, the
  frame the scene is first drawn;
- leaves it out of `app.ui.find`, `app.ui.tree()` (so the `ui` and `locate` doors), `app.ui.lint()`
  and the keyboard focus. The `render` door reads the renderer, which draws no view of the build.
  `world` learns the keys of its elements in the frame after the commit, so
  `world.projection.entityOf` answers nothing for an element of the build before;
- lays it out on the viewport, or in a host of the build, never in a slot of a live root. The
  reconcile after the commit gives the slots out again;
- drops an element or a root of the build that leaves before the swap at once, with no exit. A
  discard (`causeOf` answers `"discard"`) drops every root of the build that way, so the world
  stands as it did before the build.

`ui`'s part of the build, registered with `world.projection.onBuild` when a renderer draws
(`renderer.host.kind()` is not `"none"`, the condition the renderer registers its own part on), is
done when no root of the build is dirty (its tree not diffed yet, or the layout engine not loaded), has parked parts, waits
for its solve or is applied in parts. A root whose first diff threw (`ui:root-failed`) does not
hold the swap. The check walks the roots and allocates nothing; with no build the reconcile and the
solve pay a few numbers a frame.

### In parts

The budget of a frame is `world.projection.left()`: the build's `budgetMs` less the time the frame
spent, finite only while a build runs (`scenes.buildMs`). The work of a root built aside goes in
units, and the first unit of a frame always runs, so a build always moves; a later one runs while
the budget lasts.

- **By root.** A dirty root built aside is diffed while the budget lasts; one that waits stays
  dirty and is diffed in a later frame against its newest tree.
- **By part.** Inside a diff, from the 8th element of a frame the budget is read every 8 elements.
  Once it is spent, a new element is still made (its parent's child list is complete), but its
  children wait in the root's queue. The next frames diff the queue first, in the order it was
  parked; children that park again go to its end. A row a windowed scroll moves in never parks.
- **No diff twice.** While parts wait, the root is not diffed again and its windowed scrolls do not
  move their range, so no element is made twice. A state change during the build costs one more
  diff, once the queue is empty.
- **Laid out once.** Yoga solves the root whole once, after its last part.
- **Applied in parts.** Its first application then runs top-down, parent before children, under the
  budget and at most 100 elements a frame: the components it writes are flushed after the system,
  where the budget does not see them. The root is not solved again until the last element is
  applied.
- **The whole lands together.** Its scrolls are settled, and its hosts take their views, once the
  last part is applied; the windowed ranges are cut in the next frame. Its overlays land after the
  swap, as before.
- **Still until the swap.** A scroll of a root built aside is not moved by the frame step, and its
  windowed range is cut only in the frame after the root was laid out: a frame at rest ranges
  nothing. A new `offset` prop stands at once, with no glide, so the scroll is in place when it is
  first drawn.
- **Ends here.** A discard, a root whose key leaves, its exit and a restore forget the queue and the
  application with the rest of the root.

The screen a build in parts ends on is the one a one-block build ends on.

```ts
// The ward stays on the screen while the board is built aside, in one frame.
app.world.projection.build(["ward", "board"], owner, [{ name: "ui", sort: "order" }], 4); // true
app.time.step(16);
app.ui.find("boardPlay"); // undefined: built, not on the screen
app.ui.tree().key; // "wardRoot"

// The swap, as `scenes` makes it, then the first frame of the board.
app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
app.world.projection.commit();
app.ui.find("boardPlay"); // the button's entity: on the screen from the next frame
app.time.step(16); // the held enters of the board play now
```

## Warm windows

A projection that declares `warm` keeps the view of one item built and held while it is closed
(spec 33, slice B+D; the world's side is in the world README, "Warm windows"). A view that returns
JSX is a root of `ui`, held:

- **Built aside, in parts.** It is built as a root of a scene built aside: by root and by part under
  the warm budget of `world.projection.left()`, laid out once and applied in parts, every element
  it spawns marked for the held view (`world.projection.adopt`). It stays out of `app.ui.find`,
  `app.ui.tree()`, `app.ui.lint()` and the keyboard focus; the renderer neither draws nor hits it.
- **No key reached until the open.** Its elements register their keys with `world` as they are made,
  but `entityOf` answers nothing for an entity `world` builds or holds:
  `world.projection.entityOf("shop.sheet", "shopBuy")` answers nothing for a closed shop.
- **Still while closed.** Its enters wait in the queue of `ui.enter`. A change (a new warm item, a
  new viewport, a text measured again) plays no `change` motion and is written at once. An overlay
  keeps its level at 0 and does not land. A scroll is not moved; a new `offset` prop stands at once.
  A row a windowed list ranges in after the build, when the world no longer marks the work, is
  held as its root is.
- **The open.** In the frame `from` shows the item the world hands the held view over and `ui`
  releases its root: the slots are given out again, `entityOf` answers for its keys, and the
  held enters play in that frame, posed at the end of its solve. A root opened before its build was
  done gets the rest in one block in that frame: its parked children are diffed whatever the
  budget, and it is laid out and applied whole with no motion, so no half-built frame is drawn.
- **The close** plays the exits as for any root; the world builds the window again in idle frames.
- **At rest** the held roots cost a few numbers a frame: the walk for a released root runs only
  when the membership of the world's projections moved, the queue of held
  enters is not walked, the drain and the application step read one size, and no scroll of a held
  root is stepped. 0 B a frame (`__tests__/perf/warm-rest.perf.ts`).
- **Headless.** `ui` registers its part of a build only with a renderer that draws: a headless
  app (a test, the CLI) warms no window, and a sheet opens as a mount.

```ts
// The shop of a scene declares `warm`: its sheet is built while the board rests.
app.ui.find("shopBuy"); // undefined: built and held, not on the screen
app.world.projection.entityOf("shop.sheet", "shopBuy"); // undefined
// The player taps the shop button; in the next frame the sheet is drawn whole and its enters play.
app.time.step(16);
app.world.projection.entityOf("shop.sheet", "shopBuy") === app.ui.find("shopBuy"); // true
```

Limits:

- A held root hosts no live projection view: a `ui` host of it takes only views held as it is (a
  live view under a hidden host would vanish from the screen). Its hosts take their views at the
  open.
- A later solve of a held root (a new warm item, a new viewport) is applied in one block, as a later
  solve of a scene built aside.
- A held root costs the memory of its elements and their Yoga nodes for as long as it is held.

## Doors

`inspect.ts` holds the two ui sources of the editor's read door, `@moku-labs/game/inspect`. Both
only read, so they are safe in a production build. `game.ui` needs an app with `ui`; `game.locate`
one with `ui`, `renderer` and `world`.

| Key in `sources` | id | Input | Changes | Reads |
|---|---|---|---|---|
| `ui` | `game.ui` | none | frame | `app.ui.tree()`: the live screen as plain data; a text node carries `content`, the words it draws, and `textStyle`, its style key |
| `locate` | `game.locate` | `{ key: "string?", target: "json?" }`, exactly one | frame | `{ x, y, w, h }` of the element with that `key` or of the view `target: { projection, key }`, in CSS px of the page, or `undefined` |

`game.locate` answers where something is drawn, by either address the doors use. It replaces
`game.rect`, which answered the key form only; `{ key }` answers the same numbers. Neither shows a
scene built aside before its swap: `tree()` and `find()` leave it out, and `world` answers no
`entityOf` for a building view.

## Debug trigger

`DebugTrigger()` is an extra (see [Extra components](#extra-components)) for the view a player
taps five times to open the editor's overlay on a debug build, with no computer attached: the
version line of the settings, usually.

```tsx
// The version line of the settings sheet. Five taps open the overlay of `moku-game build --debug` on the phone.
<button key="versionLine" style={versionLineStyle} components={[DebugTrigger()]}>
  <text key="version" style="settings.version" content={tr("settings.version", { version: "1.4.0" })} />
</button>
```

- Five taps within 3000 ms (inclusive, first to fifth) open it. The window slides over the last
  five taps, and after an open five new taps are needed. Taps on other views neither count nor
  reset the count.
- The window is wall time (`performance.now()`), not game time: under a time scale of 0 (the
  editor's pause) or a slowed game it stays three real seconds. Taps still arrive from frames that
  run.
- Underneath is `app.debug.overlay.open()` (the `debug` plugin): a game that wants another gesture
  calls it from its own listener.
- The tag adds no component: the view must take a press itself. A `button` naming nothing is the
  plain choice; a `button` with an intent still answers it. A trigger on a view that takes no press
  (no `Tappable`, `Pressable`, `Draggable`, `Swipeable`, `Traceable` or `Touchable`) warns
  `ui:debug-trigger-untouchable` `{ key }` once: five taps can never reach it.
- `lint()` checks a trigger view against `tapTargetPt` in every build, as a tap target.
- An open logs `ui:debug-trigger` `{ key }`. When no overlay took it (no agent on the page), one
  `ui:debug-trigger-no-agent` `{ key }` per app.
- The counter and its hook are registered on a page with the agent flag only (`moku-game dev`,
  `moku-game build --debug`): a release build carries the tag's descriptor and no counting code,
  and five taps do nothing.

1. Exactly one of `key` and `target`, else it throws `[game] game.locate takes a key or a target.`
   `target` is read the way `game.tap` reads it.
2. `key`: only a live element counts. When `app.ui.find(key)` has no entity, the answer is
   `undefined`. It starts from the element's `Box` size, its layout box from Yoga, not the Pixi
   bounds, so a bare button with no fill, such as a text link, has a rect too. The box goes through
   the element's root pose (`rootPoseOf`, the `Transform`s of its `Parent` chain): a fit, a slot,
   the offset a `scroll` writes on its content and a motion of an ancestor move it where it is
   drawn; the rotation is left out. Every clipping entity above it (a `scroll`, an
   `overflow: "hidden"`, a `Shape` or `NineSlice` with `clip`) cuts it to its clip box, as the
   renderer masks it; an element's own clip never cuts itself. `undefined` when a clip hides all
   of it, so a tile scrolled out of its strip is found nowhere, and while it is drawn at no size
   (entering from scale 0), as `boundsOf` answers a view.
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

`control.ts` holds the three ui commands of the editor's write door, `@moku-labs/game/control`,
dev builds only. `tap` goes through `app.input`, so the gate decides; `fill` goes through
`app.ui.fill`, which writes a component's `local` and answers nothing; `scroll` goes through
`app.ui.scroll`. The session stays clean (effect `route`). They need an app with `input` and `ui`.

| Key in `commands` | id | Input | Does |
|---|---|---|---|
| `tap` | `game.tap` | `{ key: "string?", target: "json?" }`, exactly one | `input.tap` on the ui element with that `key` (through `ui.find`) or on the view `target: { projection, key }` |
| `fill` | `game.fill` | `{ key: "string", value: "string" }` | `ui.fill(key, value)`: types into the text field with that `key`; answers `false` for a key that is no live `input` |
| `scroll` | `game.scroll` | `{ key: "string", to: "number" }` | `ui.scroll(key, to)`: puts the `scroll` with that `key` at `to` at once; answers `false` for a key that is no live `scroll`. A visual test writes it as the step `{ scroll: { key, to } }` |

```ts
import { commands, run } from "@moku-labs/game/control";

// An e2e script taps the Play plank of Home.
(await run(app, commands.tap, { key: "play" })).value; // true
// The Rename popup rests: type the name, then submit it with the Enter key.
(await run(app, commands.fill, { key: "nameField", value: "Alex" })).value; // true
await run(app, commands.key, { key: "Enter" }); // the gate takes { intent: "save", payload: { name: "Alex" } }
// The board rests: show the order strip on its events.
(await run(app, commands.scroll, { key: "strip", to: 0 })).value; // true
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
| an own string `kind` of `component`, `tag`, `node`, `slot`, `flow`, `bundles` or `plugin`; without a `kind`, an object with an own string `id` or `name` | refused: a flow, node, slot, ECS component or tag, filter, bundles, scene, system, feature or plugin is registered by value at start |
| anything else: styles, tokens, motions, effect descriptors (`sfx`, `haptic`, `popup`, `play`, `music`, `guide`), timeline steps (`tween`, `mark`), numbers, plain functions, function components | nothing: Bun already gave the importers the new binding, and a node reads a descriptor through it |

The strings files are written by `bun run assets:keys`, which compiles
`features/*/strings/<locale>.json` into `generated/strings.<locale>.ts`. After a JSON edit, run it
again: its save is what the hot swap takes.

The replaces that may throw run first: projections, then animations, then strings. Then the
components and the text styles are written, every ui root reconciles and solves on the next
frame with every element patched in full (see [What a re-render costs](#what-a-re-render-costs)),
`world.projection.rerunAll()` runs every projection again, and `time.wake()` lifts the idle
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
| `Projection "<name>" is not registered` | `world` has no projection of that name |
| `Animation "<id>" is not registered` | `anim` has no animation of that id |
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
    if (typeof swap !== "function") throw new Error("[game] No running game takes the hot swap.\n  Open the game page, then save again.");
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
