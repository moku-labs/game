/**
 * @file i18n plugin — type definitions: the message as data, the parts a format returns, the
 * compiled modules the build writes, the `Intl.*` kit one locale is read through, and the public
 * API a game and the plugins above it call.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";

/**
 * One interface element handed to a message as a parameter. Structural on purpose: it mirrors
 * the `DescriptionNode` of `world/projection`, which sits beside `i18n`, so neither plugin
 * imports the other (seam resolution 1).
 *
 * @example
 * ```ts
 * const icon: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };
 * ```
 */
export type ElementNode = {
  type: string;
  key?: string;
  props: object;
  children: readonly unknown[];
};

/**
 * What a message parameter may be: a word, a number, a list of words, or an element the
 * interface draws in the middle of the sentence.
 *
 * @example
 * ```ts
 * const reward: Argument = 25;
 * const players: Argument = ["Ann", "Bo"];
 * ```
 */
export type Argument = string | number | readonly string[] | ElementNode;

/**
 * What `tr` returns: the key and the parameters, frozen. No locale and no string is read at the
 * call site, so the same value survives a locale change and can be compared and logged.
 *
 * @example
 * ```ts
 * const orders: Message<"hud.orders", { n: number }> = { key: "hud.orders", params: { n: 3 } };
 * ```
 */
export type Message<Key extends string = string, Values = Record<string, Argument>> = {
  key: Key;
  params?: Values;
};

/**
 * One piece of a formatted message: a run of text, or an element to draw in place. The consumer
 * never joins the pieces itself, which is what keeps an icon inside a sentence possible.
 *
 * @example
 * ```ts
 * const parts: Part[] = [
 *   { kind: "element", node: { type: "icon", props: { name: "hud.coin" }, children: [] } },
 *   { kind: "text", text: " 25" }
 * ];
 * ```
 */
export type Part = { kind: "text"; text: string } | { kind: "element"; node: ElementNode };

/**
 * The `Intl.*` formatters of one locale, each memoised by the JSON of its options. Compiled
 * messages are handed one and never construct a formatter themselves.
 *
 * @example
 * ```ts
 * const intl = createIntlKit("ru");
 * intl.plural().select(3); // "few"
 * ```
 */
export type IntlKit = {
  /** The locale every formatter of this kit is built for. */
  locale: string;
  /** The plural rules of the locale; `{ type: "ordinal" }` for `selectordinal`. */
  plural(options?: Intl.PluralRulesOptions): Intl.PluralRules;
  /** The number format of the locale. */
  number(options?: Intl.NumberFormatOptions): Intl.NumberFormat;
  /** The list format of the locale, which ICU MessageFormat 1 has no syntax for. */
  list(options?: Intl.ListFormatOptions): Intl.ListFormat;
  /** The date and time format of the locale. */
  date(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
};

/**
 * One message as the build wrote it: a plain function of the parameters and the locale's kit.
 * There is no ICU parser at run time.
 *
 * @example
 * ```ts
 * const hello: CompiledMessage = p => [{ kind: "text", text: `Hi ${String(p.name)}` }];
 * ```
 */
export type CompiledMessage = (params: Record<string, unknown>, intl: IntlKit) => Part[];

/**
 * One compiled module: every message of one locale by its key.
 *
 * @example
 * ```ts
 * const en: CompiledMessages = { "home.play": () => [{ kind: "text", text: "Play" }] };
 * ```
 */
export type CompiledMessages = Record<string, CompiledMessage>;

/**
 * A compiled module that is imported on first use. A module namespace is unwrapped to its
 * `default` member (seam resolution 2).
 *
 * @example
 * ```ts
 * const loadEnglish: StringsLoader = () => import("./generated/strings.en");
 * ```
 */
export type StringsLoader = () => Promise<CompiledMessages | { default: CompiledMessages }>;

/**
 * i18n plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { i18n: { locale: "ru", fallback: "en", locales: {} } } });
 * ```
 */
export type Config = {
  /** The locale at start. */
  locale: string;
  /** The locale a missing key is read from before it is reported missing. */
  fallback: string;
  /**
   * Compiled modules outside features, per locale; a loader is imported on first use and its
   * `default` is unwrapped.
   */
  locales: Record<string, CompiledMessages | StringsLoader>;
};

/**
 * One module registered for one locale, with the name it can be blamed under when two of them
 * carry the same key.
 */
export type RegisteredModule = {
  /** The feature that brought the module, or `"pluginConfigs.i18n"` for a configured one. */
  from: string;
  /** The module itself, or the loader that fetches it on first use. */
  messages: CompiledMessages | StringsLoader;
};

/**
 * One registered module whose loader already ran, ready to be merged into a locale.
 */
export type ResolvedModule = {
  /** The feature that brought the module, or `"pluginConfigs.i18n"` for a configured one. */
  from: string;
  /** The module itself. */
  messages: CompiledMessages;
};

/**
 * i18n plugin state.
 */
export type State = {
  /** The current locale; `config.locale` until `setLocale`. */
  locale: string;
  /** Per locale, one entry per feature and one for the config, filled in `onStart`. */
  registered: Map<string, RegisteredModule[]>;
  /** Merged and resolved modules per locale. */
  loaded: Map<string, CompiledMessages>;
  /** One kit per locale, built on first use. */
  intl: Map<string, IntlKit>;
  /** Keys already reported missing, so each warns once. */
  warned: Set<string>;
  /** The `setLocale` in flight; a later call waits for it. */
  loading: Promise<void> | undefined;
};

/**
 * i18n plugin events.
 */
export type Events = {
  /** The current locale changed and its messages are loaded. */
  "i18n:locale-changed": { locale: string };
};

/**
 * How this plugin sends its one event. The single emit site narrows the kernel's `emit` to it.
 *
 * @example
 * ```ts
 * const emit: EmitLocaleChanged = (name, payload) => bus.send(name, payload);
 * emit("i18n:locale-changed", { locale: "en" });
 * ```
 */
export type EmitLocaleChanged = (
  name: "i18n:locale-changed",
  payload: Events["i18n:locale-changed"]
) => void;

/**
 * i18n plugin API, `app.i18n`. Messages are data everywhere else in the game; this is the one
 * place a locale is read and a sentence becomes parts.
 *
 * @example
 * ```ts
 * // A settings screen shows the languages the game was built with and switches to one.
 * app.i18n.locales(); // ["en", "ru"]
 * await app.i18n.setLocale("en");
 * app.i18n.plain(tr("hud.orders", { n: 3 })); // "3 orders"
 * ```
 */
export type I18nApi = {
  /**
   * The locale every `format` without a second argument reads.
   *
   * @returns The current locale.
   * @example
   * ```ts
   * app.i18n.locale(); // "ru", the pluginConfigs.i18n.locale the game started with
   * ```
   */
  locale(): string;

  /**
   * Switches the current locale. A lazy module is imported once, then `i18n:locale-changed` is
   * emitted; `text` re-resolves every message on it. A call for the locale already current
   * resolves at once and emits nothing.
   *
   * @param locale - The locale to switch to.
   * @returns A promise that settles when the messages of that locale are loaded.
   * @throws {Error} When no feature and no config brought a module for the locale.
   * @example
   * ```ts
   * // features/settings/nodes.ts: the language button of the settings screen.
   * await app.i18n.setLocale("en"); // loads the compiled module, then emits i18n:locale-changed
   * app.i18n.locale(); // "en"
   * ```
   */
  setLocale(locale: string): Promise<void>;

  /**
   * Formats a message in the current locale. Resolution order is the current locale, then
   * `config.fallback`, then missing: a missing key gives one text part `⟦key⟧` and one warning.
   *
   * @param message - What `tr` returned.
   * @returns The parts of the sentence, adjacent text merged.
   * @example
   * ```ts
   * // text resolves the `content` of a Text component every time the locale changes.
   * app.i18n.format(tr("hud.orders", { n: 3 })); // [{ kind: "text", text: "3 заказа" }]
   * ```
   */
  format(message: Message): readonly Part[];

  /**
   * Formats a message in another registered locale, without switching. `ui.lint` measures a
   * label in every locale this way.
   *
   * @param message - What `tr` returned.
   * @param locale - The registered locale to read.
   * @returns The parts of the sentence in that locale.
   * @throws {Error} When the locale is not registered, or is registered but not loaded yet.
   * @example
   * ```ts
   * // ui.lint does this for every entry of app.i18n.locales() and keeps the widest result.
   * app.i18n.format(tr("hud.orders", { n: 3 }), "en"); // [{ kind: "text", text: "3 orders" }]
   * app.i18n.locale(); // "ru": reading another locale never switches
   * ```
   */
  format(message: Message, locale: string): readonly Part[];

  /**
   * The parts joined into one string, elements dropped. For logs, tests and `flow.describe()`.
   *
   * @param message - What `tr` returned.
   * @returns The sentence as text.
   * @example
   * ```ts
   * // A test asserts what the HUD says without touching the renderer.
   * app.i18n.plain(tr("hud.coins", { n: 25, icon: coinIcon })); // "25": the icon is dropped
   * ```
   */
  plain(message: Message): string;

  /**
   * Tells whether a key exists in the current locale or in the fallback.
   *
   * @param key - The message key.
   * @returns True when `format` would find a message for it.
   * @example
   * ```ts
   * // A projection hides the label of an order that has no description yet.
   * app.i18n.has("orders.hint"); // false: no locale brought that key
   * ```
   */
  has(key: string): boolean;

  /**
   * Every locale at least one feature or the config brought a module for, sorted.
   *
   * @returns The registered locales.
   * @example
   * ```ts
   * // The language menu is built from this list, and ui.lint measures the widest locale.
   * app.i18n.locales(); // ["en", "ru"]
   * ```
   */
  locales(): readonly string[];
};

/**
 * What the kernel context offers this plugin.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: core 1.7 leaves a plugin's
 * own events out of the context it hands the factories as soon as `depends` is declared, so an
 * i18n-typed `emit` here would make every factory unassignable. `api.ts` narrows this one member
 * to `EmitLocaleChanged`; nothing else about the context is cast.
 */
export type I18nCtx = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(...args: never[]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The key-to-parameters table a game generates: `generated/strings.ts` exports it as `Strings`.
 * A key with no parameters carries `Record<never, never>`.
 *
 * @example
 * ```ts
 * const table: StringTable = { "hud.orders": { n: 3 }, "orders.complete": {} };
 * ```
 */
export type StringTable = Record<string, unknown>;

/**
 * The keys of a table whose message takes no parameters, so `tr` may be called with the key
 * alone.
 *
 * @example
 * ```ts
 * type Keys = KeysWithoutParameters<{ "home.play": Record<never, never>; "hud.orders": { n: number } }>;
 * // "home.play"
 * ```
 */
export type KeysWithoutParameters<Table extends StringTable> = {
  [Key in keyof Table]: Record<never, never> extends Table[Key] ? Key : never;
}[keyof Table] &
  string;

/**
 * `tr` as one game reads it: the key is checked against the generated table, and the parameters
 * are the ones that key declares. A key with no parameters takes no second argument.
 *
 * @example
 * ```ts
 * const { tr } = i18nFor<{ "hud.orders": { n: number } }>();
 * tr("hud.orders", { n: 3 }); // { key: "hud.orders", params: { n: 3 } }
 * ```
 */
export type TypedTr<Table extends StringTable> = {
  <Key extends KeysWithoutParameters<Table>>(key: Key): Message<Key, Table[Key]>;
  <Key extends keyof Table & string>(key: Key, params: Table[Key]): Message<Key, Table[Key]>;
};

/**
 * What `defineGame` spreads from this plugin.
 *
 * @example
 * ```ts
 * const kit: I18nKit<{ "home.play": Record<never, never> }> = i18nFor();
 * kit.tr("home.play"); // { key: "home.play" }
 * ```
 */
export type I18nKit<Table extends StringTable> = { tr: TypedTr<Table> };
