# i18n

> Complex plugin — strings as data. `tr(key, params)` builds a `Message`; no locale and no string is read at the call site. ICU MessageFormat 1 is compiled to plain functions at build time, so a wrong key or a missing parameter does not compile, and no parser ships to the browser.

```ts
// features/hud/strings/ru.json — a flat file, keys written in full
{ "hud.orders": "{n, plural, one {# заказ} few {# заказа} many {# заказов} other {# заказа}}",
  "hud.coins": "{icon} {n, number}" }

// features/hud/index.ts — the feature registers what the build wrote
export const hudFeature = defineFeature("hud", {
  projections: [hud],
  strings: { ru: ruStrings, en: () => import("../../generated/strings.en") }
});

// anywhere in the game — data, not a sentence
<text content={tr("hud.orders", { n: hud.orders })} />
<text content={tr("hud.coins", { n: hud.coins, icon: <icon name="hud.coin" /> })} />
```

## The two halves

**Build time** (`compile/`, node only, reached through `@moku-labs/game/assets`): `compileStrings(root, out)` walks `features/*/strings/<locale>.json`, parses every message once and writes `generated/strings.ts` (the `Strings` type a game hands `defineGame`) and one `generated/strings.<locale>.ts` per locale. `bun run assets:keys` runs it next to the asset scanner; `--check` covers both.

**Run time**: `format(message)` calls the function the build wrote and returns `Part[]`, never a joined string. `Intl.PluralRules`, `Intl.NumberFormat`, `Intl.ListFormat` and `Intl.DateTimeFormat` come from a kit memoised per locale.

## API

| Method | Behaviour |
|---|---|
| `locale()` | The current locale |
| `setLocale(locale)` | Loads a lazy module once, then emits `i18n:locale-changed`. An unknown locale throws |
| `format(message)` | `Part[]` in the current locale, adjacent text merged |
| `format(message, locale)` | The same in another registered locale, without switching. For `ui.lint` |
| `plain(message)` | The parts joined, elements dropped. For logs, tests and `describe()` |
| `has(key)` | The key exists in the current locale or in the fallback |
| `locales()` | Every registered locale, sorted |

Resolution order is the current locale, then `config.fallback`, then missing. A missing key gives `[{ kind: "text", text: "⟦key⟧" }]` and one `ctx.log.warn` per key over the app's life. `format` is synchronous: `onStart` awaits the start locale and the fallback, so nothing waits at a label.

## Parts, not strings

```ts
app.i18n.format(tr("hud.coins", { n: 25, icon: coin }));
// [{ kind: "element", node: coin }, { kind: "text", text: " 25" }]
```

An element parameter keeps its place in the sentence, which is what makes an icon inside a line possible without string surgery. An array parameter is formatted through `Intl.ListFormat`, because ICU MessageFormat 1 has no list syntax. A number in a plain argument goes through `Intl.NumberFormat`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `locale` | `"en"` | The locale at start |
| `fallback` | `"en"` | The locale a missing key is read from before it is reported missing |
| `locales` | `{}` | Compiled modules outside features, per locale. A loader's `default` is unwrapped |

A locale is registered when at least one feature or the config brings a module for it. A game that brought no strings at all starts anyway: every key is then missing.

## Supported ICU

Argument `{n}`; `plural` and `selectordinal` with `#`, `=n` exact matches and `offset:n`; `select`; `number` with no style, `integer` or `percent`; `date` and `time` with `short`, `medium`, `long`, `full`; all of them nested. Tags (`<b>`, `<color=#hex>`, `<icon=key>`) stay literal text for the tag pass of `text`.

Everything else — skeletons (`::…`), `currency`, a custom pattern, a `plural` or `select` without `other`, a syntax error — is a compile problem naming the key and the file:

```
[game] i18n: "hud.price" in features/hud/strings/ru.json: the number style "currency" is not supported.
  Fix the message or use a supported ICU feature.
```

Every problem of a run is reported in one error. A key one locale lacks is a note, not a problem: the run time falls back.

## Events and dependencies

Emits `i18n:locale-changed` after the module of the new locale is loaded, never at start. `text` listens and re-resolves. `depends` is `flow` only, for the `strings` key of every feature description; `i18n` never calls `text`, `world` or `ui`.
