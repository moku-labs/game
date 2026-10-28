# text

Complex tier. Words on the screen: a `Text` component holds a string or an i18n `Message`; one
`world` system in phase `layout` resolves it, writes `resolved`, and measures the block from the
font's advance table. No canvas anywhere, so `app.text.measure(content, style)` answers the same
numbers in a browser and in plain Bun — that is the contract `ui.layout` stands on.

- **Config:** `fonts: { body, digits }`, the two boot fonts behind the built-in styles. No glyph
  is drawn or measured in place of a missing one (see Missing glyphs).
- **API:** `measure(content, style, width?)`, `hasGlyph(char, style)`, `styles()`. `width` is
  the width a `wrap: "box"` style wraps at (`ui` passes the width Yoga offers); without it such a
  style measures one line, and any other style ignores it. `hasGlyph` answers
  whether the loaded font of a style has a character, the lookup Pixi draws by; it is true while
  the font is not loaded. `ui` measures a text field's caret over the characters it is true for.
  `replaceStyles(styles)` is the dev hot swap of a saved styles file, called by `ui`: every style
  of the map is written over the table (a new name is added, a known one keeps its owner), the
  fonts are read, the layout cache is dropped, every label is marked and the loop is woken. The
  next frame redraws a label with the new style even when its text and its style name did not
  change: the display adapter compares the drawn style object with the current one. For a label
  it leaves as it was (the same string, style and anchor, and the same alpha) the adapter answers
  `false`, so a renderer drawing on demand (`renderer.onDemand`) skips the frame.
- **Missing glyphs:** a character the loaded font has no glyph for (an emoji, CJK) is drawn as
  nothing by Pixi, so it measures 0 wide, letter spacing included, and is reported once per font
  and character. `"ab😀"` measures as `"ab"`, and a label is as wide as what is drawn.
- **Helpers:** `Text`, `Countdown`, `bind(Component, field, { format })`,
  `label({ text, style, at, anchor? })`, `defineTextStyles(map)`,
  `textFor<TextStyles, Fonts>()` for `defineGame`.
- **Styles:** `font`, `size` and `fill` are required. `bold`, `italic`, `stroke`, `strokeWidth`,
  `letterSpacing`, `align`, `wrap`, `digits`, `shadow` and `lineHeight` have defaults.
  `lineHeight` is the line as a multiple of `size`, like a unitless CSS `line-height`:
  `{ font: "text-medium", size: 14, fill: 0, lineHeight: 1.28 }` lays every line 17.92 px high, so
  three lines measure 53.76. The glyphs sit in the middle of the line (half the leading above,
  half below, as CSS does), and an inline icon fills the line. Left out, the line is the font's.
  It must be a number above 0. Wrap widths do not change with it.
  `shadow: { color, dx, dy, alpha? }` is a drop shadow under every glyph run. The offset is in
  reference px at the style size. `alpha` defaults to 1, and the shadow draws at it: `0.55` is
  0.55. A shadow never changes what `measure` answers.
  `stroke` and `strokeWidth` draw an outline: 8 white copies of each glyph run (12 when
  `strokeWidth` is 6 or more) on a circle of radius `strokeWidth`, tinted `stroke`. An outline
  never changes what `measure` answers.
- **Wrap:** `wrap` is one of three, `"none"` by default.

  | `wrap` | lines |
  |---|---|
  | `"none"` | one line per `\n` segment |
  | a width, `480` | wrapped at that many reference px |
  | `"box"` | wrapped at the laid-out width of its `ui` text element, which `ui` writes into `Text.box`; one line outside a ui layout, with a dev warning `text: wrap "box" outside layout` once per style; a style a layout measured at a width (`measure(content, style, width)`) never warns: its label with no box fits its row (F65) |

  Words break between them; a word wider than the wrap breaks between its glyphs. A `"box"` text
  is measured at the width Yoga offers, so its element is as high as its lines, and is drawn again
  only when its box changes: a still frame compares one number per label and allocates nothing. A
  box is laid out per width and string, a number or `"none"` style once per string. Shrink is 0
  by default in `ui`: put `shrink: 1` on the boxes on the way to the text, or the row grows past
  its room instead of the text wrapping. A line may be 0.0001 px wider than its box, the tolerance
  `ui` rounds a measure to whole units with. Any other wrap, `0` or `-1`, is refused when the
  style is defined.
- **Tags:** `<b>`, `<i>`, `<color=#rrggbb>`, `<icon=key>`, `\<`, `\n`. An unknown tag stays
  literal and is reported once.
- **Icons:** `<icon=key>` is one glyph, square at the line height and as wide as the line is high
  plus `letterSpacing`. In a wrapped style it wraps with its word: `×<icon=hud.coin>5` moves to the
  next line as one word, and `a <icon=hud.coin> b` makes the icon a word of its own. A word wider
  than `wrap` breaks between glyphs and never inside the icon; an icon wider than `wrap` gets a line
  of its own.
- **Alpha:** `Text({ alpha })` fades the whole block once: runs, shadows, outlines and icons. It is
  1 by default and is the alpha of the label's container, so a change is written in place,
  rebuilds no run, and a tween on `Text.alpha` costs one assignment a frame. It draws at its value
  on a distance-field font too: the renderer's own SDF shader applies every alpha once, where Pixi
  8.22's applies it twice (renderer README, "Distance-field text"). `ui` draws a field's
  placeholder at `alpha: 0.5`.
- **Numbers:** `bind(Component, field, { format })` shows a numeric component field of the same
  entity, read every frame, written only when the shown string changes. Formats: `int` (the
  default, `Math.round`), `mm:ss`, `h:mm:ss` and `duration`. The time formats take milliseconds
  and show whole seconds rounded up, so a timer reads `00:01` until it is really at zero.
  `duration` reads as words in the current locale through `i18n.duration(ms)` and is built again
  after a locale change. `bind(Counter, "name")` on a string field does not compile, and neither
  does a hand-written `{ component, field }`: only `bind()` makes a `TextBind`.
- **The spawn frame:** a label shows its string in the frame it is spawned. The layout system
  resolves every label that exists when phase `layout` starts; `ui` adds the `Text` of a JSX
  label in its solve, after that system, and the flush at the end of the phase attaches it with
  the rest of its batch, a bound component included. Right after that flush, before phase `sync`,
  `text` resolves exactly the labels whose `Text` came since its system ran (the step is a
  `time.onFrame("layout")` callback registered after the world's own), so the renderer builds
  them with their string and their glyphs. `ui` measured them before they were resolved, so the
  next system run writes their `Text` once more, with no field: the change reaches the remeasure
  of `ui` in that layout phase, and a bound label whose listed value measures otherwise than its
  string gets its size. The same step resolves a label whose content or style `ui` changed in
  its reconcile, after the system ran: it shows the new string in the frame of the change (`ui`
  measured that content itself, so it is not written once more). A system of phase `sync` that
  writes `resolved` itself (a typing effect) so finds a spawned label resolved in its first run,
  and a label whose content a re-render of `ui` changed in the frame of that re-render. A label that comes while the world is
  paused or fast is not listed: it is resolved by the next live run of the system, as before.
- **Countdown:** `Countdown({ until })` plus `bind(Countdown, "left", { format })` on the same
  entity. `until` is a moment of `clock` in epoch ms. `left` is engine-owned: computed from one
  `clock.now()` per frame on the render side, written with the label and only when its string
  changes, never committed to the save. At zero both stay at zero and nothing fires; a node that
  needs the moment schedules it with `clock.scheduleAt`. Phase `layout` does not run while the
  world is paused, so a countdown does not tick there.
- **Screen:** a `DisplayAdapter` registered with `renderer.sync.displays.provide(Text, …)` builds
  one `BitmapText` per run and one `Sprite` per icon, through `renderer.host.pixi()`. With a
  shadow, each glyph run gets a second `BitmapText` drawn first: the same glyphs in white,
  tinted with `color`, at `alpha`, moved by `dx` and `dy`. It sits in the same container, so it
  follows every update, reflow and destroy of its run. Icons cast no shadow, as in CSS
  `text-shadow`. Drawing order per run: shadow, outline copies, synthetic bold copies (a `<b>` run
  of a style with no `bold` font: 8 copies at `size / 20`, in the run colour), the glyphs. No
  stroke is handed to Pixi `BitmapText`: it draws nothing on an MSDF font. Headless nothing is built and no font is installed.
- **Hot swap:** `assets:replaced` (dev builds only) installs a replaced font again and marks the
  labels drawn with a replaced font or inline icon. The next frame builds each of them again from
  the new textures, even when its string did not change. No other font is read and no other label
  is written; a replaced font drops the layout cache once. A `.fnt` that cannot be read logs
  `text:font-replace-failed` and reloads the page.
- **Depends:** `time`, `flow`, `world`, `renderer`, `assets`, `i18n`, `clock`. Emits nothing; listens to
  `assets:bundle-loaded`, `assets:bundle-unloaded`, `assets:replaced` and `i18n:locale-changed`.
