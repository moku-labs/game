# text

Complex tier. Words on the screen: a `Text` component holds a string or an i18n `Message`; one
`world` system in phase `layout` resolves it, writes `resolved`, and measures the block from the
font's advance table. No canvas anywhere, so `app.text.measure(content, style)` answers the same
numbers in a browser and in plain Bun — that is the contract `ui.layout` stands on.

- **Config:** `fonts: { body, digits }` (the two boot fonts behind the built-in styles),
  `missingGlyph: "□"`.
- **API:** `measure(content, style)`, `styles()`.
- **Helpers:** `Text`, `label({ text, style, at, anchor? })`, `defineTextStyles(map)`,
  `textFor<TextStyles, Fonts>()` for `defineGame`.
- **Tags:** `<b>`, `<i>`, `<color=#rrggbb>`, `<icon=key>`, `\<`, `\n`. An unknown tag stays
  literal and is reported once.
- **Numbers:** `bind: { component, field }` shows `Math.round` of a numeric component field,
  read every frame, written only when the rounded value moved.
- **Screen:** a `DisplayAdapter` registered with `renderer.sync.displays.provide(Text, …)` builds
  one `BitmapText` per run and one `Sprite` per icon, through `renderer.host.pixi()`. Headless
  nothing is built and no font is installed.
- **Depends:** `time`, `flow`, `world`, `renderer`, `assets`, `i18n`. Emits nothing; listens to
  `assets:bundle-loaded`, `assets:bundle-unloaded` and `i18n:locale-changed`.
