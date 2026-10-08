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

**Build time** (`compile/`, node only, reached through `@moku-labs/game/assets`): `compileStrings(root, out, { pseudo?, layers? })` walks `features/*/strings/<locale>.json` and the `strings/` of every layer (`layers`, `--layer`), parses every message once and writes `generated/strings.ts` (the `Strings` type a game hands `defineGame`) and one `generated/strings.<locale>.ts` per locale, plus `strings.en-XA.ts` with `pseudo`. A locale module carries no helper code: when a message has a plain argument or a duration, it imports `messageArgument as argument` and `messageDuration as duration` from `@moku-labs/game`, the same functions the plugin runs. `bun run assets:keys` runs it next to the asset scanner; `--check` covers both. `exportStrings` and `importStrings` exchange the strings with translators.

**Run time**: `format(message)` calls the function the build wrote and returns `Part[]`, never a joined string. `Intl.PluralRules`, `Intl.NumberFormat`, `Intl.ListFormat`, `Intl.DateTimeFormat` and `Intl.DurationFormat` come from a kit memoised per locale.

## API

| Method | Behaviour |
|---|---|
| `locale()` | The current locale |
| `setLocale(locale)` | Loads a lazy module once, then emits `i18n:locale-changed`. An unknown locale throws |
| `format(message)` | `Part[]` in the current locale, adjacent text merged |
| `format(message, locale)` | The same in another registered locale, without switching. For `ui.lint` |
| `plain(message)` | The parts joined, elements dropped. For logs, tests and `describe()` |
| `has(key)` | The key exists in the current locale or in the fallback |
| `duration(ms, style?)` | Milliseconds as text in the current locale: `"1 min, 35 sec"` for `95_000`. Style `"short"` by default. For `text`'s `format: "duration"` |
| `locales()` | Every registered locale, sorted |
| `replace(locale, messages)` | Dev hot swap: the one registered module whose keys overlap `messages` takes them, and the locale is merged again. Emits `i18n:locale-changed` when the locale is the current one or the fallback. A locale not loaded yet is left alone. Zero or several overlapping modules throw, so the page reloads |

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

Argument `{n}`; `plural` and `selectordinal` with `#`, `=n` exact matches and `offset:n`; `select`; `number` with no style, `integer` or `percent`; `date` and `time` with `short`, `medium`, `long`, `full`; `duration` with `long`, `short`, `narrow`, `digital`; all of them nested. Tags (`<b>`, `<color=#hex>`, `<icon=key>`) stay literal text for the tag pass of `text`.

### Durations

```jsonc
// features/chest/strings/en.json
{ "chest.opens": "Opens in {left, duration, short}" }
```

```ts
app.i18n.plain(tr("chest.opens", { left: 95_000 })); // "Opens in 1 min, 35 sec"
```

The value is milliseconds and the parameter is typed `number`. No style means `short`. `95_000` reads `1 min, 35 sec` in `short`, `1 minute, 35 seconds` in `long`, `1m 35s` in `narrow` and `0:01:35` in `digital`. The value is rounded up to whole seconds, so a countdown never reads zero while time is left; a negative value reads `0 sec`; the seconds are always shown. `Intl.DurationFormat` does the wording, so every locale reads its own: `1 мин 35 с` in `ru`. Bun 1.3.14+, Node 24+ and every WebGPU browser have it; there is no polyfill. A style outside the four is a compile problem.

Everything else — skeletons (`::…`), `currency`, a custom pattern, a `plural` or `select` without `other`, a syntax error — is a compile problem naming the key and the file:

```
[game] i18n: "hud.price" in features/hud/strings/ru.json: the number style "currency" is not supported.
  Fix the message or use a supported ICU feature.
```

Every problem of a run is reported in one error. A key one locale lacks is a note, not a problem: the run time falls back.

## Translator notes

A value is a message, or the message with a note for the translators:

```jsonc
{ "hud.deliver": { "text": "Deliver", "note": "Button on an order card, max 10 chars" } }
```

`text` compiles exactly as the bare string would. The note is never in the bundle: it reaches no generated file, only the export. It is free text, with no check and no warning when it is missing. Any other shape is a compile problem:

```
[game] i18n: "hud.deliver" in features/hud/strings/en.json: a message is a string or { "text": string, "note": string }.
  Fix the message or use a supported ICU feature.
```

## Pseudo-locale

`bun run assets:keys --pseudo` also writes `generated/strings.en-XA.ts`, derived from every `en` message. Each letter is accented, the text grows by 40 % in whole words, and brackets mark both ends:

```
"Opens in {left, duration, short}"              → "[Óþéñš íñ 1 min, 35 sec one]" for left = 95000
"{n, plural, one {# order} other {# orders}}"   → "[3 óŕðéŕš one two]" for n = 3
```

A label that stays plain was never translated. A label that loses a bracket was cut by its box. A box that overflows will overflow in a longer language too. Only literal text changes: parameters, plural keywords, `#` and tags stay. The types module does not change. `--check --pseudo` checks the file with the others. Without an `en` file the run refuses: `[game] i18n: "--pseudo" needs an "en" string file in at least one feature.`

Register it in a dev build only, so a production bundle never imports it:

```ts
const devPseudo =
  typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__
    ? { "en-XA": () => import("./generated/strings.en-XA") }
    : {};

const app = createApp({
  pluginConfigs: { i18n: { locale: "ru", fallback: "ru", locales: devPseudo } }
});

await app.start();
await app.i18n.setLocale("en-XA"); // every label reads accented and bracketed
```

`locales()` lists `en-XA` once it is registered, so `ui.lint` measures it as the longest locale.

## Export and import

`exportStrings(root, dir, { source })` writes one `<dir>/<locale>.json` per locale, the source included. The game tree is not touched. Every key is in every file, sorted:

```jsonc
// translations/ru.json
{
  "hud.bonus": { "text": "", "source": "Bonus" },
  "hud.deliver": { "text": "Отдать", "source": "Deliver", "note": "Button on an order card, max 10 chars" }
}
```

`text` is the locale's message, `""` when it has none yet. `source` is the message of the source locale, `"en"` by default. `note` is the source's note, else the locale's own.

`importStrings(root, dir, { out, pseudo })` reads every `<dir>/*.json` back. Each new `text` is checked first: an unknown key, an entry without a string `text` and a message that does not compile are problems, all listed in one error, and then nothing is written. An empty `text` and an unchanged one are skipped; `source` and `note` are ignored. Each text is written into the string file of the feature or layer that owns its key: an existing key keeps its place and its note, a new key is appended. Then the strings are compiled into `out`, `<root>/generated` by default.

A game on the layered layout passes its layers to both, `{ layers: { shared: "ui" } }` or `--layer shared=ui`. The keys of `shared/strings/` go out with the rest, and a translated `ui.ok` comes back into `shared/strings/ru.json`:

```ts
await importStrings("src", "translations", { out: "src/generated", layers: { shared: "ui" } });
// { locales: ["ru"], keys: 1, files: ["shared/strings/ru.json"] }
```

A key is owned by one folder: the same key in `features/hud/strings/en.json` and `shared/strings/en.json` is a compile problem naming both files.

A layer folder is one folder name under the root. A folder that is empty or holds `/`, `\` or `.` is refused by the compile, the export and the import before a string file is read or written: `[game] i18n: the layer "../other" is not a folder name.`

From the command line, through the assets CLI: `--export <dir>`, `--import <dir>`, `--source <locale>`, `--layer <folder>[=<name>]`. A new language: export, copy `en.json` to `de.json`, fill in every `text`, import.

## Events and dependencies

Emits `i18n:locale-changed` after the module of the new locale is loaded, never at start, and after `replace` swapped a module of the current locale or the fallback; the payload is always the current locale. `text` listens and re-resolves. `depends` is `flow` only, for the `strings` key of every feature description; `i18n` never calls `text`, `world` or `ui`.
