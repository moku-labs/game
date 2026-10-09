/**
 * @file text plugin — shared types: the component a game writes, the style table a feature
 * brings, the runs and lines a tagged string becomes, the advance table a `.fnt` is read into,
 * the plugin state, the API `ui.layout` stands on, and the bound numbers and countdowns a label
 * shows.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Api as ClockApi } from "../clock/types";
import type { Api as FlowApi } from "../flow/types";
import type { I18nApi, Events as I18nEvents, Message } from "../i18n/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";
import type { AnyComponent, Entity } from "../world/ecs/types";
import type { NumericFields, Api as WorldApi } from "../world/types";

/**
 * A point in reference units: where a label sits, and which point of the block sits there.
 *
 * @example
 * ```ts
 * const anchor: Point = { x: 0.5, y: 0.5 };
 * ```
 */
export type Point = { x: number; y: number };

/**
 * The size of a measured block, in reference pixels.
 *
 * @example
 * ```ts
 * const size: Size = { width: 57.6, height: 38.4 };
 * ```
 */
export type Size = { width: number; height: number };

/**
 * How a bound number is shown. `"int"` rounds it; the three time formats take milliseconds and
 * show whole seconds, rounded up, so a timer never reads zero while time is left.
 *
 * @example
 * ```ts
 * const format: TextFormat = "mm:ss"; // 95_000 ms shows "01:35"
 * ```
 */
export type TextFormat = "int" | "mm:ss" | "h:mm:ss" | "duration";

/** The brand only `bind()` puts on a `TextBind`. Type-only: nothing is emitted for it. */
declare const textBind: unique symbol;

/**
 * Which numeric component field a label shows, and how. Plain data in the component, so a
 * snapshot lists it; nominal, so only `bind()` makes one and a hand-written literal does not
 * compile.
 *
 * @example
 * ```ts
 * const Counter = component("Counter", { value: 0 });
 * const coins: TextBind = bind(Counter, "value");
 * // { component: "Counter", field: "value", format: "int" }
 * ```
 */
export type TextBind = {
  readonly component: string;
  readonly field: string;
  readonly format: TextFormat;
} & { readonly [textBind]: true };

/**
 * The numeric fields of a component value, by name: what `bind()` takes as its field.
 *
 * @example
 * ```ts
 * type Fields = BindField<{ value: number; name: string }>; // "value"
 * ```
 */
export type BindField<Value extends object> = keyof NumericFields<Value> & string;

/**
 * What `bind()` takes after the field. The format is `"int"` when left out.
 *
 * @example
 * ```ts
 * const options: BindOptions = { format: "mm:ss" };
 * ```
 */
export type BindOptions = { format?: TextFormat };

/**
 * A moment to count down to, and how much is left. A game writes `until`, a moment of `clock` in
 * epoch milliseconds; `left` is engine-owned and follows what the label shows.
 *
 * @example
 * ```ts
 * // clock.now() is 1_790_000_000_000: the chest opens in 95 s.
 * const chest: CountdownValue = { until: 1_790_000_095_000, left: 95_000 };
 * ```
 */
export type CountdownValue = { until: number; left: number };

/**
 * What the `Text` component holds. `resolved` is engine-owned: a game writes `content`, `style`,
 * `bind`, `anchor` and `alpha`, and reads `resolved`. `alpha` fades every run, shadow and icon of
 * the block together, 1 by default; a change is written in place and a tween can drive it.
 *
 * @example
 * ```ts
 * const value: TextValue = {
 *   content: "+5", style: "body", bind: undefined, anchor: { x: 0.5, y: 0.5 }, alpha: 1,
 *   resolved: "+5"
 * };
 * // The hint of an empty name field, at half alpha.
 * const hint: TextValue = { ...value, content: "Your name", alpha: 0.5, resolved: "Your name" };
 * ```
 */
export type TextValue = {
  content: string | Message;
  style: string;
  bind: TextBind | undefined;
  anchor: Point;
  alpha: number;
  resolved: string;
};

/**
 * Where the lines of a block sit inside the widest of them.
 *
 * @example
 * ```ts
 * const align: TextAlign = "center";
 * ```
 */
export type TextAlign = "left" | "center" | "right";

/**
 * The wrap width of a style in reference pixels, or `"none"` for one line per `\n` segment.
 *
 * @example
 * ```ts
 * const wrap: TextWrap = 480;
 * ```
 */
export type TextWrap = number | "none";

/**
 * The drop shadow of a style as the plugin stores it: a copy of every glyph run in `color`, at
 * `alpha`, moved by `dx` and `dy` reference pixels.
 *
 * @example
 * ```ts
 * const shadow: TextShadow = { color: 0x5b3a1e, dx: 0, dy: 4, alpha: 1 };
 * ```
 */
export type TextShadow = { color: number; dx: number; dy: number; alpha: number };

/**
 * One style as a game writes it: the font and the size are required, the rest has defaults.
 *
 * @example
 * ```ts
 * // A popup title: cream display glyphs over a brown shadow 4 px down.
 * const title: TextStyleInput = {
 *   font: "ui.font-display", size: 56, fill: 0xfff3d6, shadow: { color: 0x5b3a1e, dx: 0, dy: 4 }
 * };
 *
 * defineTextStyles({ "popup.title": title }).map["popup.title"]?.shadow;
 * // { color: 0x5b3a1e, dx: 0, dy: 4, alpha: 1 }
 * ```
 */
export type TextStyleInput = {
  font: string;
  bold?: string;
  italic?: string;
  size: number;
  fill: number;
  /** The outline colour. Drawn only when `strokeWidth` is above 0. */
  stroke?: number;
  /**
   * The outline width in reference px: 8 copies of each glyph run on a circle this wide (12 from 6
   * on), tinted `stroke`. 0 draws none. It never changes what `measure` answers.
   */
  strokeWidth?: number;
  letterSpacing?: number;
  align?: TextAlign;
  wrap?: TextWrap;
  digits?: boolean;
  /**
   * A drop shadow under every glyph run, in reference px at the style size. `alpha` is 1 when
   * left out. It never changes what `measure` answers.
   */
  shadow?: { color: number; dx: number; dy: number; alpha?: number };
};

/**
 * One style as the plugin stores it: every field filled, `bold` and `italic` only when the game
 * shipped those MSDF fonts, `shadow` only when the style has one.
 *
 * @example
 * ```ts
 * const style: TextStyle = {
 *   font: "ui.font-body", bold: undefined, italic: undefined, size: 32, fill: 0xffffff,
 *   stroke: 0x000000, strokeWidth: 0, letterSpacing: 0, align: "left", wrap: "none",
 *   digits: false, shadow: undefined
 * };
 * ```
 */
export type TextStyle = {
  font: string;
  bold: string | undefined;
  italic: string | undefined;
  size: number;
  fill: number;
  stroke: number;
  strokeWidth: number;
  letterSpacing: number;
  align: TextAlign;
  wrap: TextWrap;
  digits: boolean;
  shadow: TextShadow | undefined;
};

/**
 * What `defineTextStyles` returns and a feature registers under its `textStyles` key. Structural
 * on purpose: `flow` carries the map, `text` reads it.
 *
 * @example
 * ```ts
 * const styles: TextStyles = { kind: "textStyles", map: { "hud.title": bodyStyle } };
 * ```
 */
export type TextStyles = { readonly kind: "textStyles"; readonly map: Record<string, TextStyle> };

/**
 * The advances of one font at the size the `.fnt` was exported with. Widths scale by
 * `style.size / size`; kerning pairs are ignored.
 *
 * @example
 * ```ts
 * const table: AdvanceTable = { size: 32, lineHeight: 40, advances: new Map([["1", 18]]) };
 * ```
 */
export type AdvanceTable = { size: number; lineHeight: number; advances: Map<string, number> };

/**
 * One run of glyphs: the text and the flags every glyph in it shares.
 *
 * @example
 * ```ts
 * const run: TextRun = { kind: "text", text: "+5", bold: true, italic: false, color: 0xffe082 };
 * ```
 */
export type TextRun = {
  kind: "text";
  text: string;
  bold: boolean;
  italic: boolean;
  color: number | undefined;
};

/**
 * One inline icon: an asset key drawn square at the line height.
 *
 * @example
 * ```ts
 * const run: IconRun = { kind: "icon", key: "hud.coin" };
 * ```
 */
export type IconRun = { kind: "icon"; key: string };

/**
 * A piece of a line: glyphs or one inline icon.
 *
 * @example
 * ```ts
 * const runs: Run[] = [{ kind: "icon", key: "hud.coin" }];
 * ```
 */
export type Run = TextRun | IconRun;

/**
 * One laid-out line and how wide it is.
 *
 * @example
 * ```ts
 * const line: Line = { runs: [{ kind: "icon", key: "hud.coin" }], width: 38.4 };
 * ```
 */
export type Line = { runs: Run[]; width: number };

/**
 * A laid-out block: its lines and the size `measure` answers with.
 *
 * @example
 * ```ts
 * const layout: TextLayout = { lines: [], width: 0, height: 0 };
 * ```
 */
export type TextLayout = { lines: Line[]; width: number; height: number };

/**
 * What one label container was last filled from: the style object, the laid-out block and the
 * generation of the state at that moment. An update with the same style object, the same
 * generation, the same anchor and the same lines and runs writes the new text and positions into
 * the objects already there. An older generation means a dev hot swap replaced a font or an icon
 * since: the objects hold textures that are destroyed, so they are built again.
 */
export type DrawnLabel = { style: TextStyle; layout: TextLayout; generation: number };

/**
 * A dev warning that is written once per key. Pure modules take it as an argument, so nothing
 * below the plugin context reaches the log itself.
 *
 * @example
 * ```ts
 * const warn: Warn = (key, message) => seen.has(key) || log.warn(message);
 * ```
 */
export type Warn = (key: string, message: string, data?: Record<string, unknown>) => void;

/**
 * What the pure layout needs next to the runs, the style and the tables.
 *
 * @example
 * ```ts
 * const options: LayoutOptions = { warn: () => undefined };
 * ```
 */
export type LayoutOptions = { warn: Warn };

/**
 * What was resolved for one entity last, so the frame step knows whether anything moved. `unit`
 * is what the shown string of a bound label was built from: the rounded value for `"int"`, whole
 * seconds for a time format.
 *
 * @example
 * ```ts
 * const seen: SeenText = {
 *   content: "", style: "digits", bind: "Countdown.left:mm:ss", locale: "ru", unit: 95
 * };
 * ```
 */
export type SeenText = {
  content: unknown;
  style: string;
  bind: string | undefined;
  locale: string;
  unit: number | undefined;
};

/**
 * text plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { text: { fonts: { body: "ui.body", digits: "ui.digits" } } } });
 * ```
 */
export type Config = {
  /** The two fonts every game ships in its boot bundle. They back the built-in styles. */
  fonts: { body: string; digits: string };
};

/**
 * text plugin state.
 */
export type State = {
  /** Built-in styles first, then the styles of every feature in feature order. */
  styles: Map<string, TextStyle>;
  /** Style name to the feature that brought it, for the duplicate error. */
  styleOwner: Map<string, string>;
  /** The config fonts plus every `font`, `bold` and `italic` of every style. */
  fontKeys: Set<string>;
  /** The parsed advance table per font key, filled when `assets` has the font. */
  tables: Map<string, AdvanceTable>;
  /** The font keys handed to `renderer.sync.fonts.install`. */
  installed: Set<string>;
  /** What was resolved for an entity last. */
  seen: Map<Entity, SeenText>;
  /** `bind.component` to its world type; `undefined` after the one warning. */
  bindTypes: Map<string, AnyComponent | undefined>;
  /** The measured size of every live label, for `ui`. */
  measured: Map<Entity, Size>;
  /** Layout per `style + resolved`, oldest dropped first. */
  cache: Map<string, TextLayout>;
  /** What every live label container was last filled from, by container. */
  drawn: WeakMap<object, DrawnLabel>;
  /** Entities to re-resolve in the next layout phase. */
  dirty: Set<Entity>;
  /**
   * Counts the dev hot swaps that replaced a font or an inline icon of a live label. A label
   * container drawn under an older count is built again on its next update.
   */
  generation: number;
  /** Warning keys already written, so a style, a tag, a glyph or a font warns once. */
  warned: Set<string>;
  /** The system, the two world hooks and the display adapter. */
  removers: Array<() => void>;
};

/**
 * text plugin API, `app.text`. Two questions: how big a piece of text is, and which styles the
 * game registered; and one order, the dev hot swap of a styles file. Everything else happens in
 * the frame.
 *
 * @example
 * ```ts
 * app.text.measure("120", "digits"); // { width: 57.6, height: 38.4 }
 * app.text.styles(); // ["body", "digits"]
 * ```
 */
export type TextApi = {
  /**
   * The size of a piece of text in reference pixels, from the advance table of the style's font.
   * A `Message` is formatted in the current locale first. Never touches a canvas, so the answer
   * is the same in a browser and in plain Bun. Cached per style and resolved string.
   *
   * @param content - A plain string, or what `tr` returned.
   * @param style - A registered style name. An unknown one warns once and measures as `body`.
   * @returns The width and height of the block.
   * @example
   * ```ts
   * // `ui.layout` asks once per invalidation, from the Yoga measure function of a text element.
   * const text = ctx.require(textPlugin);
   *
   * text.measure("120", "digits"); // { width: 57.6, height: 38.4 } on the 0.6 em fallback
   * ```
   */
  measure(content: string | Message, style: string): Size;

  /**
   * Whether the font of a style has a glyph for one character, the lookup Pixi draws by. A
   * character its font lacks is drawn as nothing and `measure` counts it 0 wide. While the font is
   * not loaded every character counts, as the 0.6 em fallback measures it. An unknown style warns
   * once and looks up `body`.
   *
   * @param char - One character, a whole code point.
   * @param style - A registered style name.
   * @returns False only for a character a loaded font has no glyph for.
   * @example
   * ```ts
   * // `ui` measures the caret of a text field over the characters the font draws.
   * const text = ctx.require(textPlugin);
   *
   * text.hasGlyph("A", "body"); // true
   * text.hasGlyph("😀", "body"); // false once the body font is loaded: it has no emoji glyph
   * ```
   */
  hasGlyph(char: string, style: string): boolean;

  /**
   * The registered style names: the two built-ins first, then the styles of every feature in
   * feature order.
   *
   * @returns A frozen list of style names.
   * @example
   * ```ts
   * // A dev overlay lists what a game may write in a `style` prop.
   * app.text.styles(); // ["body", "digits", "hud.digits"]
   * ```
   */
  styles(): readonly string[];

  /**
   * The dev hot swap of a styles file: writes every style of the map over the table. A known
   * name keeps the feature that owns it, a new name is added and usable at once. The fonts the
   * styles name are read, the measured layouts are dropped, and every label is laid out again
   * on the next frame and redrawn with the new style, even when its text and its style name did
   * not change. The game loop is woken for that frame.
   *
   * @param styles - What `defineTextStyles` returned in the saved module.
   * @example
   * ```ts
   * // `ui` hot swaps a saved `hud/styles.ts`: the "hud.title" labels redraw at 64 px.
   * const uiStyles = defineTextStyles({
   *   "hud.title": { font: "ui.font-body", size: 64, fill: 0xff0000 }
   * });
   *
   * ctx.require(textPlugin).replaceStyles(uiStyles);
   * ctx.require(textPlugin).measure("12", "hud.title").height; // 76.8 on the 0.6 em fallback
   * ```
   */
  replaceStyles(styles: TextStyles): void;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = {
  time: TimeApi;
  flow: FlowApi;
  world: WorldApi;
  renderer: RendererApi;
  assets: AssetsApi;
  i18n: I18nApi;
  clock: ClockApi;
};

/**
 * What the kernel context offers before the deps are attached.
 *
 * `text` owns no event, so `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the files of the plugin: the kernel slice plus the resolved deps.
 */
export type TextCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the `assets:bundle-loaded` hook: a bundle landed, so a font may be readable now.
 */
export type BundleLoaded = AssetsEvents["assets:bundle-loaded"];

/**
 * Payload of the `assets:bundle-unloaded` hook: `keys` names the assets that left.
 */
export type BundleUnloaded = AssetsEvents["assets:bundle-unloaded"];

/**
 * Payload of the `assets:replaced` hook: a dev hot swap put new bytes behind `keys`. Each of them
 * answers a new font or texture already, and the old pages and textures are destroyed.
 */
export type AssetsReplaced = AssetsEvents["assets:replaced"];

/**
 * Payload of the `i18n:locale-changed` hook: every message has to be resolved again.
 */
export type LocaleChanged = I18nEvents["i18n:locale-changed"];
