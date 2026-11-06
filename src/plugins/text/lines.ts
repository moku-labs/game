/**
 * @file text plugin — the line box (F152). Which look a run is in (the paragraph's style, the
 * style its `<span>` borrows, or the bold look of either), which font it stands by, and how high
 * every line is and where its baseline sits, as CSS builds a line box with a strut of the
 * paragraph's look. Pure: styles, runs and advance tables in, numbers out.
 */
import type { AdvanceTable, LayoutOptions, Line, Run, TextRun, TextStyle } from "./types";

/** Line height of a style whose font is not loaded, as a share of the style size. */
const FALLBACK_LINE = 1.2;

/** Baseline of a font that names none, or of a style whose font is not loaded, as a share of the size. */
export const FALLBACK_BASE = 0.8;

/**
 * The look one run measures and draws in, one of the objects already stored: the style its span
 * borrows (the paragraph's when it is in none, or in one of a key no style has), or the bold look
 * of that style for a `<b>` run when the style has `boldStyle`. Silent: the layout warns of an
 * unknown key once per string.
 *
 * @param paragraph - The style of the label.
 * @param run - The run.
 * @param styles - The style table, by name; left out, every span is the paragraph's.
 * @param looks - The bold looks, by the style they belong to.
 * @returns The look of the run.
 * @example
 * ```ts
 * const run: Run = { kind: "icon", key: "hud.coin", span: "price.22" };
 *
 * lookOf(bodyStyle, run, new Map([["price.22", priceStyle]]), new Map()); // priceStyle
 * ```
 */
export function lookOf(
  paragraph: TextStyle,
  run: Run,
  styles: ReadonlyMap<string, TextStyle> | undefined,
  looks: ReadonlyMap<TextStyle, TextStyle> | undefined
): TextStyle {
  const own = (run.span === undefined ? undefined : styles?.get(run.span)) ?? paragraph;

  if (run.kind === "icon" || !run.bold) return own;

  return looks?.get(own) ?? own;
}

/**
 * The look of a run under the style table and the bold looks a layout was handed.
 *
 * @param style - The style of the label.
 * @param run - The run.
 * @param options - What the layout was handed.
 * @returns The look of the run.
 */
export function lookIn(style: TextStyle, run: Run, options: LayoutOptions): TextStyle {
  return lookOf(style, run, options.styles, options.looks);
}

/**
 * The font one run is drawn with: the bold or italic font when its look names it, else the
 * font of the look.
 *
 * @param style - The look of the run: the style of the label, or what `lookOf` answered.
 * @param run - The run to draw.
 * @returns The asset key of the font.
 * @example
 * ```ts
 * const run: TextRun = {
 *   kind: "text", text: "a", bold: true, italic: false, color: undefined, span: undefined
 * };
 *
 * fontOfRun(bodyStyle, run); // "ui.font-body": the body style names no bold font, so the bold is synthetic
 * ```
 */
export function fontOfRun(style: TextStyle, run: TextRun): string {
  if (run.bold && style.bold !== undefined) return style.bold;
  if (run.italic && style.italic !== undefined) return style.italic;

  return style.font;
}

/**
 * The font whose metrics a run stands in its line by. A run in a look of its own, a span's style or
 * a bold look of `boldStyle`, stands by the font its glyphs are drawn with (the bold or italic one
 * when the look names it). A run in the paragraph's look, a plain `<b>` or `<i>` included, stands
 * by the paragraph's own font, as every label did before runs had looks. An icon stands by the
 * font of its look.
 *
 * @param paragraph - The style of the label.
 * @param look - The look of the run, what `lookOf` answered.
 * @param run - The run.
 * @returns The asset key of the font.
 * @example
 * ```ts
 * const body = builtInStyles({ body: "ui.font-body", digits: "ui.font-digits" }).body;
 * const row = { ...body, bold: "ui.font-bold" };
 * const bold: Run = { kind: "text", text: "1", bold: true, italic: false, color: undefined, span: undefined };
 *
 * metricsFontOf(row, row, bold); // "ui.font-body": a plain <b> keeps the paragraph's line
 * metricsFontOf(row, { ...row, size: 16 }, bold); // "ui.font-bold": a look of its own stands by its font
 * ```
 */
export function metricsFontOf(paragraph: TextStyle, look: TextStyle, run: Run): string {
  return run.kind === "icon" || look === paragraph ? look.font : fontOfRun(look, run);
}

/**
 * The height of one line of a style: `lineHeight × size` when the style names its line, else the
 * line of the font at the style size, its own font unless another is named.
 *
 * @param style - The style of the label, or the look of a run.
 * @param tables - The advance tables that are loaded.
 * @param font - The font whose line it is: what `metricsFontOf` answers for a run.
 * @returns The line height in reference pixels.
 * @example
 * ```ts
 * lineHeightOf(bodyStyle, new Map()); // 38.4: 1.2 em of a 32 px style with no font loaded
 * ```
 */
export function lineHeightOf(
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  font: string = style.font
): number {
  return style.lineHeight === undefined
    ? fontLineOf(style, tables, font)
    : style.lineHeight * style.size;
}

/**
 * The height of one line of a font at the style size, whatever line the style names: what the
 * glyphs are drawn into, so the gap to `lineHeightOf` is the leading.
 *
 * @param style - The style of the label, or the look of a run.
 * @param tables - The advance tables that are loaded.
 * @param font - The font whose line it is; the style's own when left out.
 * @returns The font's line height in reference pixels.
 * @example
 * ```ts
 * fontLineOf({ ...bodyStyle, lineHeight: 1.5 }, new Map()); // 38.4: the font's 1.2 em, not 48
 * ```
 */
export function fontLineOf(
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  font: string = style.font
): number {
  const table = tables.get(font);

  return table === undefined
    ? FALLBACK_LINE * style.size
    : table.lineHeight * (style.size / table.size);
}

/**
 * How far the baseline sits below the top of a font's line: the `base` of the font at the style
 * size, or 0.8 em while the font is not loaded.
 *
 * @param style - The look of a run.
 * @param tables - The advance tables that are loaded.
 * @param font - The font the run is drawn with; the style's own when left out.
 * @returns The ascent in reference pixels.
 * @example
 * ```ts
 * ascentOf(bodyStyle, new Map()); // 25.6: 0.8 em of a 32 px style with no font loaded
 * ```
 */
export function ascentOf(
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  font: string = style.font
): number {
  const table = tables.get(font);

  return table === undefined ? FALLBACK_BASE * style.size : table.base * (style.size / table.size);
}

/**
 * Half the leading of a style: how far below the top of its line its font's line starts, as CSS
 * centres the glyphs in a line taller or shorter than the font's.
 *
 * @param style - The look of a run.
 * @param tables - The advance tables that are loaded.
 * @param font - The font the run is drawn with; the style's own when left out.
 * @returns The half-leading in reference pixels; below 0 in a line shorter than the font's.
 * @example
 * ```ts
 * leadingOf({ ...bodyStyle, lineHeight: 2 }, new Map()); // 12.8: (64 - 38.4) / 2
 * ```
 */
export function leadingOf(
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  font: string = style.font
): number {
  return (lineHeightOf(style, tables, font) - fontLineOf(style, tables, font)) / 2;
}

/**
 * Writes the line box of every line, as CSS builds it: each run stands in the line of its look,
 * the line of its metrics font (`metricsFontOf`) centred in it, and its baseline that font's
 * `ascent` below that line's top. Every line holds a strut too, an empty piece of the paragraph's
 * look, so a line is never shorter than the paragraph's line and its baseline never higher. The
 * baseline of the line is the lowest of them, and the line reaches as far below it as the deepest.
 * A line no run reaches past the strut, a line of the paragraph's look and an empty one included,
 * is exactly the paragraph's line, to the last bit.
 *
 * @param lines - The lines of the block.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @param options - The styles and bold looks a run may take.
 */
export function boxLines(
  lines: readonly Line[],
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): void {
  // The strut: the paragraph's own line, which every line holds.
  const strutRaise = leadingOf(style, tables) + ascentOf(style, tables);
  const strutBox = lineHeightOf(style, tables);
  const strutBelow = strutBox - strutRaise;

  for (const line of lines) {
    let above = strutRaise;
    let below = strutBelow;

    for (const run of line.runs) {
      const look = lookIn(style, run, options);
      const font = metricsFontOf(style, look, run);
      const raise = leadingOf(look, tables, font) + ascentOf(look, tables, font);

      above = Math.max(above, raise);
      below = Math.max(below, lineHeightOf(look, tables, font) - raise);
    }

    // No run past the strut: the paragraph's line to the last bit, so such a label stays as it was.
    const strutOnly = above === strutRaise && below === strutBelow;

    line.baseline = strutOnly ? strutRaise : above;
    line.height = strutOnly ? strutBox : above + below;
  }
}

/**
 * The height of a block: the sum of its lines, or the count times the line when every line is
 * as high, which is to the last bit what a block of one look measured before lines had boxes.
 *
 * @param lines - The lines, their boxes written.
 * @returns The height in reference pixels.
 * @example
 * ```ts
 * blockHeight([{ runs: [], width: 0, height: 40, baseline: 32 }]); // 40
 * ```
 */
export function blockHeight(lines: readonly Line[]): number {
  const first = lines[0]?.height ?? 0;
  let sum = 0;
  let even = true;

  for (const line of lines) {
    sum += line.height;
    even &&= line.height === first;
  }

  return even ? lines.length * first : sum;
}
