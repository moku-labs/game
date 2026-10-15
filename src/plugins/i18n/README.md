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

// features/episodes/ep01/strings/ru.json — a sub-feature: every key starts with its folder name
{ "ep01.title": "Палата" }

// features/episodes/ep01/index.ts — the sub-feature registers its own modules, lazily
export const ep01Feature = defineFeature("ep01", {
  flows: [ep01Flow],
  strings: { en: () => import("@generated/strings.ep01.en"), ru: () => import("@generated/strings.ep01.ru") }
});

// anywhere in the game — data, not a sentence
<text content={tr("hud.orders", { n: hud.orders })} />
<text content={tr("hud.coins", { n: hud.coins, icon: <icon name="hud.coin" /> })} />
```

## The two halves

**Build time** (`compile/`, node only, reached through `@moku-labs/game/assets`): `compileStrings(root, out, { pseudo?, layers? })` walks the `strings/<locale>.json` of every feature owner (each folder of `features/`, and inside a feature each folder with a door `index.ts` and resources of its own, at any depth) and the `strings/` of every layer (`layers`, `--layer`), parses every message once and writes `generated/strings.ts` (the `Strings` type a game hands `defineGame`, every key of the game) and one `generated/strings.<locale>.ts` per locale with the keys of the top-level features and the layers, plus `strings.en-XA.ts` with `pseudo`. Each sub-feature with string files gets its own modules, `generated/strings.<feature>.<locale>.ts` for every locale of the game (`en-XA` included), with its keys only: `features/episodes/ep01/strings/en.json` writes `generated/strings.ep01.en.ts`. A sub-feature's keys start with its name and a dot, `ep01.title`; any other key in its files is a compile problem, `[game] i18n: "title" in features/episodes/ep01/strings/en.json: a key of the sub-feature "ep01" starts with "ep01.".` A game without sub-features gets exactly the files it got before. A locale module carries no helper code: when a message has a plain argument or a duration, it imports `messageArgument as argument` and `messageDuration as duration` from `@moku-labs/game`, the same functions the plugin runs. `bun run assets:keys` runs it next to the asset scanner; `--check` covers both. `exportStrings` and `importStrings` exchange the strings with translators.

**Run time**: `format(message)` calls the function the build wrote and returns `Part[]`, never a joined string. `Intl.PluralRules`, `Intl.NumberFormat`, `Intl.ListFormat`, `Intl.DateTimeFormat` and `Intl.DurationFormat` come from a kit memoised per locale.

## API

| Method | Behaviour |
|---|---|
| `locale()` | The current locale |
| `setLocale(locale)` | Loads a lazy module once, then emits `i18n:locale-changed`. The modules of every sub-feature whose bundle is loaded are imported for the new locale before the event; one whose bundle is not loaded is left for its next load. An unknown locale throws |
| `format(message)` | `Part[]` in the current locale, adjacent text merged. A key of a sub-feature whose bundle is not loaded gives `⟦key⟧`, and its one warning names the bundle |
| `format(message, locale)` | The same in another registered locale, without switching. For `ui.lint`. Every loaded locale carries the strings of every loaded bundle |
| `plain(message)` | The parts joined, elements dropped. For logs, tests and `describe()` |
| `has(key)` | The key exists in the current locale or in the fallback. A key of a sub-feature whose bundle is not loaded answers false |
| `isKey(value)` | A value read from a save is a key of the game: a key of the current locale or the fallback, or the `<feature>.` prefix of a sub-feature whose strings are not loaded. Not a string: false. On the game's app a true answer types the value as `I18n.TextKey<Strings>`; through `ctx.require(i18nPlugin)` as a `string`. See [Keys that come from data](#keys-that-come-from-data) |
| `duration(ms, style?)` | Milliseconds as text in the current locale: `"1 min, 35 sec"` for `95_000`. Style `"short"` by default. For `text`'s `format: "duration"` |
| `locales()` | Every registered locale, sorted |
| `replace(locale, messages)` | Dev hot swap: the one registered module whose keys overlap `messages` takes them, and the locale is merged again. Emits `i18n:locale-changed` when the locale is the current one or the fallback. A locale not loaded yet is left alone, and so is the module of a sub-feature whose bundle is not loaded: its loader imports the new module at the next load. The module of a loaded bundle (`generated/strings.ep01.ru.ts`) swaps like the whole-game one. Zero or several overlapping modules throw, so the page reloads |

Resolution order is the current locale, then `config.fallback`, then missing. A missing key gives `[{ kind: "text", text: "⟦key⟧" }]` and one `ctx.log.warn` per key over the app's life. `format` is synchronous: `onStart` awaits the start locale and the fallback, so nothing waits at a label.

## Parts, not strings

```ts
app.i18n.format(tr("hud.coins", { n: 25, icon: coin }));
// [{ kind: "element", node: coin }, { kind: "text", text: " 25" }]
```

An element parameter keeps its place in the sentence, which is what makes an icon inside a line possible without string surgery. An array parameter is formatted through `Intl.ListFormat`, because ICU MessageFormat 1 has no list syntax. A number in a plain argument goes through `Intl.NumberFormat`.

## Strings per feature

A sub-feature's strings live with its bundle. At `onStart` a module a feature registered is **coupled** to the bundle of the feature's name when all three hold:

1. the feature is a sub-feature: its entry in `flow.features.all()` has a `parent`;
2. the module is a loader, `() => import(...)`, not an eager table;
3. `assets` is composed and its manifest has a bundle of that name (`ctx.has("assets")` and `assets.has(name)`).

A coupled module is imported for every loaded locale when `assets` loads the bundle, whatever brought it (a node entry, a scene's `bundles`, `load`, a restore, the `safeNode`), and the bundle counts as loaded only after its strings are in. It is dropped when the bundle is unloaded (budget, request or `release: "leave"`). While the bundle is not loaded a key of it gives `⟦key⟧`, `has(key)` is false, and the one warning of the key names the bundle: `i18n: the bundle of a key is not loaded` with `{ key, bundle, locale }`. A locale switch brings the modules of the loaded bundles in the new locale.

```ts
// The episodes game (tests/fixtures/episodes-game): the ward of episode 1 is on screen.
app.assets.isLoaded("ep01"); // true
app.i18n.plain(tr("ep01.title")); // "The ward"
await app.i18n.setLocale("ru");
app.i18n.plain(tr("ep01.title")); // "Палата": strings.ep01.ru came with the switch
// The player left the episode; two rests later its bundle and its strings are gone.
app.i18n.has("ep01.title"); // false
```

Everything else registers as before: a top-level feature's modules, an eager table and the modules of `config.locales` load with their locale, never with a bundle, so a flat game is unchanged. A game without `assets` (a headless test, a hand-written `createApp` with `i18n` alone) couples nothing either, and its lazy modules load with the locale. The order of `i18n` and `assets` in a hand-written `createApp` does not matter: the kernel builds every API before the first `onInit`, so `i18n` adds its companion in `onInit` either way.

A sub-feature with lazy strings and no flows of its own (a strings-only `kit`) still has a bundle, a file-less one the scanner writes for it, so its strings wait until that bundle loads. A `feature`-tier bundle nobody enters never loads: give it tier `core` in an `assets.ts`, name it in a scene's `bundles`, or register the kit's strings eagerly.

## Keys that come from data

A key kept in data (a table of generators with a hint each, a toast text in the session or in the
save) is typed by the game's table, never as a `string`, and `tr` never takes a plain `string`.
`I18n.TextKey<Strings>` is the keys of the generated `Strings` type that take no parameters; it is
derived from the type `moku-game keys` already writes, so `generated/strings.ts` does not change.

```ts
// core/kit.ts of a game
export type TextKey = I18n.TextKey<Strings>; // "board.hint.blue" | "board.hint.red" | …, never "hud.orders"
export const { tr, key } = defineGame<{ player: Player; session: Session; assets: AssetKey; strings: Strings }>();

// core/tables.ts: a data table holds TextKey, or builds it with key("…")
export const generators: Record<string, { readonly hint: TextKey }> = {
  red: { hint: key("board.hint.red") },
  blue: { hint: "board.hint.blue" }
};
tr(generators.red.hint); // { key: "board.hint.red" }
```

A key read back from a save is checked where the app is (an effect handler, app or page code, the
code that loads the save) before it reaches a view, with the one `isKey(value)`. The game's app is
typed by its table: `index.ts` passes `strings: type<Strings>()` to `defineGameApp`, and a true
answer of `app.i18n.isKey(value)` types the value as `TextKey`. An engine plugin's
`ctx.require(i18nPlugin).isKey(value)` is the same call with no table: it narrows to `string`. Nodes
and rules use keys typed `TextKey`.

```ts
// index.ts of a game: the strings table types app.i18n.isKey
export default defineGameApp({ flow: mainFlow, player, session, strings: type<Strings>(), features });

// the page: the toast text kept in the save
const text = app.i18n.isKey(saved.text) ? saved.text : "ui.toast.fallback"; // TextKey
```

`app.i18n.isKey(value)` answers true for a key of the loaded tables of the current locale or the
fallback. For a sub-feature whose strings are not loaded yet it answers by the prefix: `casefile.title`
is accepted while the strings of the sub-feature `casefile` wait for their bundle, and the exact key is
checked once they load (a key that does not exist then shows `⟦key⟧` and warns once). A value that is
not a string answers false. The compiled tables carry no parameter list, so a key that takes
parameters answers true as well: the check protects against a key renamed or removed since the save.

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

A key is owned by one folder, at any depth: the same key in `features/hud/strings/en.json` and `shared/strings/en.json` is a compile problem naming both files. A translated key of a sub-feature comes back into its own file, `features/episodes/ep01/strings/ru.json`, and the compile after the import writes its modules.

A layer folder is one folder name under the root. A folder that is empty or holds `/`, `\` or `.` is refused by the compile, the export and the import before a string file is read or written: `[game] i18n: the layer "../other" is not a folder name.`

From the command line, through the assets CLI: `--export <dir>`, `--import <dir>`, `--source <locale>`, `--layer <folder>[=<name>]`. A new language: export, copy `en.json` to `de.json`, fill in every `text`, import.

## Events and dependencies

Emits `i18n:locale-changed` after the module of the new locale is loaded, never at start, and after `replace` swapped a module of the current locale or the fallback; the payload is always the current locale. It also follows the strings of a bundle that arrive for a key already shown missing. `text` listens and re-resolves. `depends` is `flow` only, for the `strings` key of every feature description and the `parent` of its registry entry; `i18n` never calls `text`, `world` or `ui`. When `assets` is composed (`ctx.has("assets")`), `i18n` adds its companion in `onInit` and asks `assets.has(name)` and `assets.isLoaded(name)` at start; there is no `depends` edge, so an app without `assets` keeps working.
