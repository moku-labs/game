# text

Complex tier. Words on the screen: a `Text` component holds a string or an i18n `Message`; one
`world` system in phase `layout` resolves it, writes `resolved`, and measures the block from the
font's advance table. No canvas anywhere, so `app.text.measure(content, style)` answers the same
numbers in a browser and in plain Bun — that is the contract `ui.layout` stands on.

- **Config:** `fonts: { body, digits }` (the two boot fonts behind the built-in styles),
  `missingGlyph: "□"`. Nothing reads `missingGlyph`: no glyph is drawn or measured in place of
  a missing one (see Missing glyphs).
- **API:** `measure(content, style)`, `hasGlyph(char, style)`, `styles()`. `hasGlyph` answers
  whether the loaded font of a style has a character, the lookup Pixi draws by; it is true while
  the font is not loaded. `ui` measures a text field's caret over the characters it is true for.
- **Missing glyphs:** a character the loaded font has no glyph for (an emoji, CJK) is drawn as
  nothing by Pixi, so it measures 0 wide, letter spacing included, and is reported once per font
  and character. `"ab😀"` measures as `"ab"`, and a label is as wide as what is drawn.
- **Helpers:** `Text`, `label({ text, style, at, anchor? })`, `defineTextStyles(map)`,
  `textFor<TextStyles, Fonts>()` for `defineGame`.
- **Styles:** `font`, `size` and `fill` are required. `bold`, `italic`, `stroke`, `strokeWidth`,
  `letterSpacing`, `align`, `wrap`, `digits` and `shadow` have defaults.
  `shadow: { color, dx, dy, alpha? }` is a drop shadow under every glyph run. The offset is in
  reference px at the style size. `alpha` defaults to 1. A shadow never changes what `measure`
  answers.
  `stroke` and `strokeWidth` draw an outline: 8 white copies of each glyph run (12 when
  `strokeWidth` is 6 or more) on a circle of radius `strokeWidth`, tinted `stroke`. An outline
  never changes what `measure` answers.
- **Tags:** `<b>`, `<i>`, `<color=#rrggbb>`, `<icon=key>`, `\<`, `\n`. An unknown tag stays
  literal and is reported once.
- **Icons:** `<icon=key>` is one glyph, square at the line height and as wide as the line is high
  plus `letterSpacing`. In a wrapped style it wraps with its word: `×<icon=hud.coin>5` moves to the
  next line as one word, and `a <icon=hud.coin> b` makes the icon a word of its own. A word wider
  than `wrap` breaks between glyphs and never inside the icon; an icon wider than `wrap` gets a line
  of its own.
- **Alpha:** `Text({ alpha })` fades the whole block once: runs, shadows, outlines and icons. It is
  1 by default. A change is written in place on every object of the label and rebuilds no run, so
  a tween on `Text.alpha` costs one assignment per object a frame; the container stays at 1. An
  icon and a run of a plain bitmap font take the alpha as it is. Pixi 8.21 draws a distance-field
  font (MSDF, SDF) with a shader that applies the alpha twice: `calculateMSDFAlpha` raises
  `vColor.a` to a gamma that leans on the colour's luma, then the result is multiplied by `vColor`
  again, so `alpha: 0.5` would draw at about 0.25. Such a run gets the inverse of that shader for
  its own colour (`alpha.ts`), so it draws at 0.5; every outline copy is corrected for the outline
  colour. A shadow keeps the look it has at alpha 1 and is faded once with the block. The `.fnt`
  tells which font has a distance field: `<distanceField fieldType="msdf">`, as Pixi reads it.
  `ui` draws a field's placeholder at `alpha: 0.5`.
- **Numbers:** `bind: { component, field }` shows `Math.round` of a numeric component field,
  read every frame, written only when the rounded value moved.
- **Screen:** a `DisplayAdapter` registered with `renderer.sync.displays.provide(Text, …)` builds
  one `BitmapText` per run and one `Sprite` per icon, through `renderer.host.pixi()`. With a
  shadow, each glyph run gets a second `BitmapText` drawn first: the same glyphs in white,
  tinted with `color`, at `alpha`, moved by `dx` and `dy`. It sits in the same container, so it
  follows every update, reflow and destroy of its run. Icons cast no shadow, as in CSS
  `text-shadow`. Drawing order per run: shadow, outline copies, synthetic bold copies (a `<b>` run
  of a style with no `bold` font: 8 copies at `size / 20`, in the run colour), the glyphs. No
  stroke is handed to Pixi `BitmapText`: it draws nothing on an MSDF font. Headless nothing is built and no font is installed.
- **Depends:** `time`, `flow`, `world`, `renderer`, `assets`, `i18n`. Emits nothing; listens to
  `assets:bundle-loaded`, `assets:bundle-unloaded` and `i18n:locale-changed`.
