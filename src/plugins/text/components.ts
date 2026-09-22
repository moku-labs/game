/**
 * @file text plugin — the component a game writes and the two pure helpers `defineGame` binds to
 * one game's keys. Pure: no ctx, no state, no Pixi. Made with the `component()` helper of `world`,
 * so nothing has to be registered.
 */
import type { Message } from "../i18n/types";
import { Transform, type TransformValue } from "../renderer/components";
import { component } from "../world/ecs/define";
import type { ComponentValue } from "../world/ecs/types";
import type { Point, TextStyle, TextStyleInput, TextStyles, TextValue } from "./types";

/** What a `Text` starts as. Its own const, because a component takes a typed defaults object. */
const textDefaults: TextValue = {
  content: "",
  style: "body",
  bind: undefined,
  anchor: { x: 0.5, y: 0.5 },
  resolved: ""
};

/**
 * Words on the screen: a string or a message, the style it is drawn in, and the string `text`
 * resolved out of it. A game writes `content`, `style`, `bind` and `anchor`; `resolved` is
 * engine-owned and `ui` and the tests read it.
 */
export const Text = /*#__PURE__*/ component("Text", textDefaults, { owned: ["resolved"] });

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
 * //   anchor: { x: 0.5, y: 0.5 }, resolved: "" }),
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
 * Fills the defaults of one style and refuses a wrap that is neither a width nor `"none"`.
 *
 * @param name - The style name, for the error.
 * @param input - What the game wrote.
 * @returns The style with every field filled.
 * @throws {Error} When `wrap` is a number that is not greater than zero.
 */
function normalizeStyle(name: string, input: TextStyleInput): TextStyle {
  const wrap = input.wrap ?? "none";

  if (wrap !== "none" && wrap <= 0) {
    throw new Error(
      `[game] Text style "${name}" has wrap ${wrap}.\n  Use a width in reference px or "none".`
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
    digits: input.digits ?? false
  };
}

/**
 * Declares the text styles of a feature. The result goes under the `textStyles` key of the
 * feature description, and `text` reads it in `onStart`.
 *
 * @param map - Style name to what that style looks like.
 * @returns The registration a feature carries.
 * @throws {Error} When a style names a wrap that is not a width and not `"none"`.
 * @example
 * ```ts
 * defineTextStyles({ "hud.digits": { font: "ui.font-digits", size: 40, fill: 0xffe082 } });
 * // { kind: "textStyles", map: { "hud.digits": { font: "ui.font-digits", bold: undefined,
 * //   italic: undefined, size: 40, fill: 0xffe082, stroke: 0x000000, strokeWidth: 0,
 * //   letterSpacing: 0, align: "left", wrap: "none", digits: false } } }
 * ```
 */
export function defineTextStyles(map: Record<string, TextStyleInput>): TextStyles {
  const styles: Record<string, TextStyle> = {};

  for (const [name, input] of Object.entries(map)) styles[name] = normalizeStyle(name, input);

  return { kind: "textStyles", map: styles };
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
    digits: value.digits
  };

  return normalizeStyle(name, { ...input, ...pruned(optional) });
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
 * The text helpers bound to one game's style names and font keys: a label only takes a style the
 * game registered, and a style only takes a font the asset scanner generated.
 *
 * @example
 * ```ts
 * const kit: TextKit<"body", "ui.font-body"> = textFor<"body", "ui.font-body">();
 * kit.label({ text: "+5", style: "body", at: { x: 0, y: 0 } })[0].value.style; // "body"
 * ```
 */
export type TextKit<StyleKey extends string, Font extends string> = {
  label: (options: Omit<LabelOptions, "style"> & { style: StyleKey }) => ReturnType<typeof label>;
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
 * Binds `label` and `defineTextStyles` to one game's style names and font keys. Type-only: the
 * same two functions.
 *
 * @returns The two helpers, with the style and font arguments narrowed.
 * @example
 * ```ts
 * const { label } = textFor<"body", "ui.font-body">();
 * label({ text: "+5", style: "body", at: { x: 90, y: 180 } })[1].value.x; // 90
 * ```
 */
export function textFor<StyleKey extends string, Font extends string>(): TextKit<StyleKey, Font> {
  return { label, defineTextStyles };
}
