/**
 * @file text plugin — the components a game writes (`Text`, `Countdown`), the `bind` of a numeric
 * field, and the pure helpers `defineGame` binds to one game's keys. Pure: no ctx, no state,
 * no Pixi. Made with the `component()` helper of `world`, so nothing has to be registered.
 */
import type { Message } from "../i18n/types";
import { Transform, type TransformValue } from "../renderer/components";
import { component } from "../world/ecs/define";
import type { ComponentHandle, ComponentValue } from "../world/ecs/types";
import type {
  BindField,
  BindOptions,
  CountdownValue,
  Point,
  TextBind,
  TextFormatFunction,
  TextFormats,
  TextShadow,
  TextStyle,
  TextStyleInput,
  TextStyles,
  TextValue,
  TextWrap
} from "./types";

/** What a `Text` starts as. Its own const, because a component takes a typed defaults object. */
const textDefaults: TextValue = {
  content: "",
  style: "body",
  bind: undefined,
  anchor: { x: 0.5, y: 0.5 },
  alpha: 1,
  resolved: ""
};

/**
 * Words on the screen: a string or a message, the style it is drawn in, and the string `text`
 * resolved out of it. A game writes `content`, `style`, `bind`, `anchor` and `alpha`; `resolved`
 * is engine-owned and `ui` and the tests read it. `alpha` (1 by default) fades the whole block and
 * is patched in place, so a tween on it rebuilds nothing. `box` (none by default) is the width a
 * style with `wrap: "box"` wraps at; `ui` writes the laid-out width of a text element there.
 */
export const Text = /*#__PURE__*/ component("Text", textDefaults, { owned: ["resolved"] });

/** What a `Countdown` starts as. Its own const, because a component takes a typed defaults object. */
const countdownDefaults: CountdownValue = { until: 0, left: 0 };

/**
 * Shows a numeric component field of the label's own entity: read every frame, written to
 * `Text.resolved` only when the shown string changes. The field must hold a number; the format
 * is `"int"` (rounded) unless named. This root `bind` takes the four built-in formats; the `bind`
 * of `defineGame` is this function and takes the names of the game's `defineTextFormats` too. Reads
 * the component's own name, so a renamed component cannot drift from its label.
 *
 * @param component - The component whose field the label shows.
 * @param field - A numeric field of that component.
 * @param options - How the number is shown.
 * @returns The bind a `Text` carries.
 * @example
 * ```ts
 * const Counter = component("Counter", { value: 0 });
 *
 * bind(Counter, "value"); // { component: "Counter", field: "value", format: "int" }
 *
 * // The chest timer: the time left, as minutes and seconds.
 * Text({ style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) });
 * // bind is { component: "Countdown", field: "left", format: "mm:ss" }; 95 s left shows "01:35"
 * ```
 */
export function bind<Value extends object>(
  component: ComponentHandle<Value>,
  field: BindField<Value>,
  options: BindOptions = {}
): TextBind {
  // The one place the brand is put on: the stored value is the three plain fields.
  return { component: component.componentName, field, format: options.format ?? "int" } as TextBind;
}

/**
 * A moment to count down to. A game writes `until`, a moment of `clock` in epoch milliseconds;
 * `text` keeps `left` at the time that is left, computed from one `clock.now()` per frame on the
 * render side, and writes it only when the label bound to it changes. At zero both stay at zero.
 * Nothing of it reaches the save.
 *
 * @example
 * ```ts
 * // The chest of the board opens at a moment of the save; clock.now() is 1_790_000_000_000.
 * view: chest => [
 *   Countdown({ until: chest.opensAt }), // opensAt: 1_790_000_095_000
 *   Text({ style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) })
 * ]
 * // after the frame that spawns it: Text.resolved is "01:35", Countdown.left is 95000
 * ```
 */
export const Countdown = /*#__PURE__*/ component("Countdown", countdownDefaults, {
  owned: ["left"]
});

/**
 * What `label` takes: the two things every label needs, and the anchor that has a default.
 *
 * @example
 * ```ts
 * const options: LabelOptions = { text: "+5", style: "board.float", at: { x: 90, y: 180 } };
 * ```
 */
export type LabelOptions = {
  text: string | Message;
  style: string;
  at: Point;
  anchor?: Point;
};

/**
 * Bundles the two components a label needs, so a projection `view` reads as one line. The anchor
 * is the point of the block that sits on the transform.
 *
 * @param options - The text, its style, where it sits, and which point of it sits there.
 * @returns The `Text` and the `Transform` value, in that order.
 * @example
 * ```ts
 * label({ text: "+5", style: "board.float", at: { x: 90, y: 180 } });
 * // [Text({ content: "+5", style: "board.float", bind: undefined,
 * //   anchor: { x: 0.5, y: 0.5 }, alpha: 1, resolved: "" }),
 * //  Transform({ x: 90, y: 180, rotation: 0, scale: 1 })]
 * ```
 */
export function label(
  options: LabelOptions
): [ComponentValue<TextValue>, ComponentValue<TransformValue>] {
  return [
    Text({
      content: options.text,
      style: options.style,
      anchor: options.anchor ?? Text.defaults.anchor
    }),
    Transform({ x: options.at.x, y: options.at.y })
  ];
}

/**
 * Fills the alpha of a shadow a game wrote. Its own function, so the stored shadow carries the
 * four fields and nothing else.
 *
 * @param input - The shadow of a style, when it has one.
 * @returns The shadow to draw with, or `undefined`.
 * @example
 * ```ts
 * shadowOf({ color: 0, dx: 0, dy: 4 }); // { color: 0, dx: 0, dy: 4, alpha: 1 }
 * ```
 */
function shadowOf(input: TextStyleInput["shadow"]): TextShadow | undefined {
  if (input === undefined) return undefined;

  return { color: input.color, dx: input.dx, dy: input.dy, alpha: input.alpha ?? 1 };
}

/**
 * Tells whether a wrap is one a style can carry: a width above zero, `"box"` or `"none"`. A style
 * read back from a feature may carry anything, so a word is checked as well as a number.
 *
 * @param wrap - The wrap a style names, as it was stored.
 * @returns False for a number that is not above zero, and for anything else.
 * @example
 * ```ts
 * isWrap("box"); // true
 * ```
 */
function isWrap(wrap: unknown): wrap is TextWrap {
  return typeof wrap === "number" ? wrap > 0 : wrap === "box" || wrap === "none";
}

/**
 * Tells whether a line height is one a style can carry: left out, or a finite number above zero.
 * A style read back from a feature may carry anything, so the type is checked as well.
 *
 * @param lineHeight - The line height a style names, as it was stored.
 * @returns False for a number that is not finite and above zero, and for anything else.
 * @example
 * ```ts
 * isLineHeight(1.28); // true
 * ```
 */
function isLineHeight(lineHeight: unknown): lineHeight is number | undefined {
  if (lineHeight === undefined) return true;

  return typeof lineHeight === "number" && Number.isFinite(lineHeight) && lineHeight > 0;
}

/**
 * Fills the defaults of one style and refuses a wrap that is not a width, `"box"` or `"none"`,
 * and a line height that is not a number above zero.
 *
 * @param name - The style name, for the error.
 * @param input - What the game wrote.
 * @returns The style with every field filled.
 * @throws {Error} When `wrap` is a number that is not greater than zero, or another word.
 * @throws {Error} When `lineHeight` is not a finite number greater than zero.
 */
function normalizeStyle(name: string, input: TextStyleInput): TextStyle {
  const wrap = input.wrap ?? "none";

  if (!isWrap(wrap)) {
    throw new Error(
      `[game] Text style "${name}" has wrap ${wrap}.\n  Use a width in reference px, "box" or "none".`
    );
  }

  if (!isLineHeight(input.lineHeight)) {
    throw new Error(
      `[game] Text style "${name}" has lineHeight ${input.lineHeight}.\n` +
        "  Use a multiple of size above 0, such as 1.2."
    );
  }

  return {
    font: input.font,
    bold: input.bold,
    italic: input.italic,
    size: input.size,
    fill: input.fill,
    stroke: input.stroke ?? 0x00_00_00,
    strokeWidth: input.strokeWidth ?? 0,
    letterSpacing: input.letterSpacing ?? 0,
    align: input.align ?? "left",
    wrap,
    digits: input.digits ?? false,
    shadow: shadowOf(input.shadow),
    lineHeight: input.lineHeight
  };
}

/**
 * Declares the text styles of a feature. The result goes under the `textStyles` key of the
 * feature description, and `text` reads it in `onStart`.
 *
 * @param map - Style name to what that style looks like.
 * @returns The registration a feature carries.
 * @throws {Error} When a style names a wrap that is not a width, `"box"` or `"none"`.
 * @throws {Error} When a style names a lineHeight that is not a number above 0.
 * @example
 * ```ts
 * defineTextStyles({ "hud.digits": { font: "ui.font-digits", size: 40, fill: 0xffe082 } });
 * // { kind: "textStyles", map: { "hud.digits": { font: "ui.font-digits", bold: undefined,
 * //   italic: undefined, size: 40, fill: 0xffe082, stroke: 0x000000, strokeWidth: 0,
 * //   letterSpacing: 0, align: "left", wrap: "none", digits: false, shadow: undefined,
 * //   lineHeight: undefined } } }
 * ```
 */
export function defineTextStyles(map: Record<string, TextStyleInput>): TextStyles {
  const styles: Record<string, TextStyle> = {};

  for (const [name, input] of Object.entries(map)) styles[name] = normalizeStyle(name, input);

  return { kind: "textStyles", map: styles };
}

/**
 * Declares the number formats of a feature. The result goes under the `textFormats` key of the
 * feature description, and `text` reads it in `onStart`; a label names a format in its `bind`. A
 * format takes the whole value and answers what the label shows and its style.
 *
 * @param map - Format name to its function. The four built-in names are refused at start.
 * @returns The registration a feature carries.
 * @example
 * ```ts
 * const formats = defineTextFormats({
 *   "pill.number": value => ({ content: String(value), style: "digits.17" })
 * });
 *
 * formats.kind; // "textFormats"
 * formats.map["pill.number"]?.(950); // { content: "950", style: "digits.17" }
 * ```
 */
export function defineTextFormats(map: Readonly<Record<string, TextFormatFunction>>): TextFormats {
  return { kind: "textFormats", map };
}

/**
 * Tells whether a value is a plain record, so its fields can be read one by one.
 *
 * @param value - What a feature put in its description.
 * @returns True for a plain object.
 * @example
 * ```ts
 * isRecord({ font: "ui.font-body" }); // true
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one entry of a registered style map back into a full style. A feature carries the map as
 * plain objects, so this is where it becomes a style again.
 *
 * @param name - The style name, for the error message.
 * @param value - One entry of a feature's `textStyles` map.
 * @returns The style, or `undefined` when the entry is not one.
 * @example
 * ```ts
 * readStyle("hud.body", { font: "ui.font-body", size: 32, fill: 0 })?.align; // "left"
 * ```
 */
export function readStyle(name: string, value: object): TextStyle | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.font !== "string" || typeof value.size !== "number") return undefined;
  if (typeof value.fill !== "number") return undefined;

  const input: TextStyleInput = { font: value.font, size: value.size, fill: value.fill };
  const optional: Record<string, unknown> = {
    bold: value.bold,
    italic: value.italic,
    stroke: value.stroke,
    strokeWidth: value.strokeWidth,
    letterSpacing: value.letterSpacing,
    align: value.align,
    wrap: value.wrap,
    digits: value.digits,
    shadow: readShadow(value.shadow),
    lineHeight: value.lineHeight
  };

  return normalizeStyle(name, { ...input, ...pruned(optional) });
}

/**
 * Reads the shadow of a registered style back. One that lacks a numeric colour or offset is not
 * a shadow and is left out, so the style still draws.
 *
 * @param value - The `shadow` field of a stored style.
 * @returns The shadow as a game writes it, or `undefined`.
 * @example
 * ```ts
 * readShadow({ color: 0, dx: 0, dy: 4, alpha: 1 }); // { color: 0, dx: 0, dy: 4, alpha: 1 }
 * ```
 */
function readShadow(value: unknown): TextStyleInput["shadow"] {
  if (!isRecord(value)) return undefined;

  const { color, dx, dy, alpha } = value;

  if (typeof color !== "number" || typeof dx !== "number" || typeof dy !== "number") {
    return undefined;
  }

  return typeof alpha === "number" ? { color, dx, dy, alpha } : { color, dx, dy };
}

/**
 * Drops the fields a style did not name, so the defaults win over an explicit `undefined`.
 *
 * @param fields - The optional fields of a style, as they were stored.
 * @returns The fields that carry a value.
 * @example
 * ```ts
 * pruned({ bold: undefined, wrap: 480 }); // { wrap: 480 }
 * ```
 */
function pruned(fields: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(fields)) if (value !== undefined) kept[name] = value;

  return kept;
}

/**
 * The two styles every game has, built from the fonts of the plugin config. A feature may
 * override either by name.
 *
 * @param fonts - The body and digits font keys of the config.
 * @param fonts.body - Font key of the built-in `body` style.
 * @param fonts.digits - Font key of the built-in `digits` style.
 * @returns The built-in styles, `body` first.
 * @example
 * ```ts
 * builtInStyles({ body: "ui.font-body", digits: "ui.font-digits" }).digits.digits; // true
 * ```
 */
export function builtInStyles(fonts: { body: string; digits: string }): {
  body: TextStyle;
  digits: TextStyle;
} {
  return {
    body: normalizeStyle("body", { font: fonts.body, size: 32, fill: 0xff_ff_ff }),
    digits: normalizeStyle("digits", {
      font: fonts.digits,
      size: 32,
      fill: 0xff_ff_ff,
      digits: true
    })
  };
}

/**
 * The text helpers bound to one game's style names, font keys and format names: a label only takes
 * a style the game registered, a style only takes a font the asset scanner generated, a format
 * only answers a style of the game, and a bind only takes a format the game named.
 *
 * @example
 * ```ts
 * const kit: TextKit<"body", "ui.font-body"> = textFor<"body", "ui.font-body">();
 * kit.label({ text: "+5", style: "body", at: { x: 0, y: 0 } })[0].value.style; // "body"
 * ```
 */
export type TextKit<
  StyleKey extends string,
  Font extends string,
  FormatKey extends string = never
> = {
  label: (options: Omit<LabelOptions, "style"> & { style: StyleKey }) => ReturnType<typeof label>;
  bind: <Value extends object>(
    component: ComponentHandle<Value>,
    field: BindField<Value>,
    options?: BindOptions<FormatKey>
  ) => TextBind;
  defineTextFormats: (map: Readonly<Record<string, TextFormatFunction<StyleKey>>>) => TextFormats;
  defineTextStyles: (
    map: Record<
      string,
      Omit<TextStyleInput, "font" | "bold" | "italic"> & { font: Font } & {
        bold?: Font;
        italic?: Font;
      }
    >
  ) => TextStyles;
};

/**
 * Binds `label`, `bind`, `defineTextStyles` and `defineTextFormats` to one game's style names, font
 * keys and format names. Type-only: the same four functions.
 *
 * @returns The four helpers, with the style, font and format arguments narrowed.
 * @example
 * ```ts
 * const { label } = textFor<"body", "ui.font-body">();
 * label({ text: "+5", style: "body", at: { x: 90, y: 180 } })[1].value.x; // 90
 * ```
 */
export function textFor<
  StyleKey extends string,
  Font extends string,
  FormatKey extends string = never
>(): TextKit<StyleKey, Font, FormatKey> {
  // The same function: the type of the kit only lets it take the names of this game too.
  return {
    label,
    bind: bind as TextKit<StyleKey, Font, FormatKey>["bind"],
    defineTextStyles,
    defineTextFormats
  };
}
