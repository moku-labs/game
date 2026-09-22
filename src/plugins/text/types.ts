/**
 * @file text plugin — shared types: the component a game writes, the style table a feature
 * brings, the runs and lines a tagged string becomes, the advance table a `.fnt` is read into,
 * the plugin state, and the two-member API `ui.layout` stands on.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Api as FlowApi } from "../flow/types";
import type { I18nApi, Events as I18nEvents, Message } from "../i18n/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";
import type { AnyComponent, Entity } from "../world/ecs/types";
import type { Api as WorldApi } from "../world/types";

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
 * Which numeric component field a label shows. The component is named, not imported: a HUD is
 * written before the game's components are in scope.
 *
 * @example
 * ```ts
 * const bind: TextBind = { component: "Counter", field: "value" };
 * ```
 */
export type TextBind = { component: string; field: string };

/**
 * What the `Text` component holds. `resolved` is engine-owned: a game writes `content`, `style`,
 * `bind` and `anchor`, and reads `resolved`.
 *
 * @example
 * ```ts
 * const value: TextValue = {
 *   content: "+5", style: "body", bind: undefined, anchor: { x: 0.5, y: 0.5 }, resolved: "+5"
 * };
 * ```
 */
export type TextValue = {
  content: string | Message;
  style: string;
  bind: TextBind | undefined;
  anchor: Point;
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
 * One style as a game writes it: the font and the size are required, the rest has defaults.
 *
 * @example
 * ```ts
 * const input: TextStyleInput = { font: "ui.font-digits", size: 40, fill: 0xffe082, digits: true };
 * ```
 */
export type TextStyleInput = {
  font: string;
  bold?: string;
  italic?: string;
  size: number;
  fill: number;
  stroke?: number;
  strokeWidth?: number;
  letterSpacing?: number;
  align?: TextAlign;
  wrap?: TextWrap;
  digits?: boolean;
};

/**
 * One style as the plugin stores it: every field filled, `bold` and `italic` only when the game
 * shipped those MSDF fonts.
 *
 * @example
 * ```ts
 * const style: TextStyle = {
 *   font: "ui.font-body", bold: undefined, italic: undefined, size: 32, fill: 0xffffff,
 *   stroke: 0x000000, strokeWidth: 0, letterSpacing: 0, align: "left", wrap: "none", digits: false
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
 * const options: LayoutOptions = { missingGlyph: "□", warn: () => undefined };
 * ```
 */
export type LayoutOptions = { missingGlyph: string; warn: Warn };

/**
 * What was resolved for one entity last, so the frame step knows whether anything moved.
 *
 * @example
 * ```ts
 * const seen: SeenText = { content: "+5", style: "body", bind: undefined, locale: "ru" };
 * ```
 */
export type SeenText = {
  content: unknown;
  style: string;
  bind: string | undefined;
  locale: string;
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
  /** Drawn and measured for a character the font does not have. */
  missingGlyph: string;
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
  /** Entities to re-resolve in the next layout phase. */
  dirty: Set<Entity>;
  /** Warning keys already written, so a style, a tag, a glyph or a font warns once. */
  warned: Set<string>;
  /** The system, the two world hooks and the display adapter. */
  removers: Array<() => void>;
};

/**
 * text plugin API, `app.text`. Two questions: how big a piece of text is, and which styles the
 * game registered. Everything else happens in the frame.
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
};

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: `text` owns no event, and a
 * property-typed `emit` breaks the kernel's event inference when a factory is passed to
 * `createPlugin` by direct reference.
 */
export type KernelSlice = Omit<PluginCtx<Config, State>, "emit"> & {
  emit(...args: never[]): void;
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
 * Payload of the `i18n:locale-changed` hook: every message has to be resolved again.
 */
export type LocaleChanged = I18nEvents["i18n:locale-changed"];
