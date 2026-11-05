/**
 * @file text plugin — the measurement. A `.fnt` becomes an advance table, runs become lines, and
 * a block becomes a size in reference pixels. Pure and canvas-free: the same numbers on a screen
 * and in plain Bun, which is what keeps `ui.layout` honest. A character the font has no glyph for
 * measures 0 wide, because Pixi draws nothing for it. Every run measures in its look: the
 * paragraph's style, the style its `<span>` borrows, or the bold look of either; and every line is
 * a CSS line box, as high as its looks need, all of them on one baseline.
 */
import { blockHeight, boxLines, FALLBACK_BASE, fontOfRun, lineHeightOf, lookIn } from "./lines";
import { sameLook } from "./tags";
import type {
  AdvanceTable,
  LayoutOptions,
  Line,
  Run,
  TextLayout,
  TextRun,
  TextStyle
} from "./types";

/** Advance of a glyph no table knows, as a share of the style size. */
const FALLBACK_ADVANCE = 0.6;

/**
 * How much wider than its box a line of a `"box"` style may be. `ui` lays a text out in whole units
 * and rounds its measure with this tolerance, so a line that adds up to a hair over a whole unit
 * (ten glyphs of 14.4 are 144.00000000000003) stays on the line the measure kept it on.
 */
const BOX_SLACK = 0.0001;

/** Splits a run's text into words, runs of spaces and line breaks, separators kept. */
const TOKENS = /(\n| +)/;

/**
 * Splits a word after a hyphen (`-` or U+2010) that joins two parts, the hyphen kept on the first:
 * `купли-продажи` may break as `купли-` / `продажи`. No break after a leading hyphen, between two
 * hyphens or before a digit (`-5`, `10-20`), as a browser keeps them.
 */
const HYPHEN_BREAKS = /(?<=[^\-\u2010][-\u2010])(?=[^\-\u2010\d])/;

/** The soft hyphen: a break the text allows, drawn as `-` only when the line breaks there. */
const SOFT_HYPHEN = "\u00AD";

/** The most lines a balanced style evens out; a longer block keeps its greedy lines, as Chrome. */
const BALANCE_MAX_LINES = 6;

/** How many halvings the search for the balanced width takes: 2⁻¹⁶ of the range is left. */
const BALANCE_STEPS = 16;

/**
 * Tells whether a value is a plain record, so its fields can be read one by one.
 *
 * @param value - Anything `JSON.parse` returned.
 * @returns True for a plain object.
 * @example
 * ```ts
 * isRecord({ size: 32 }); // true
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a finite number, whatever a file carried.
 *
 * @param value - The field as it was parsed.
 * @returns The number, or `undefined`.
 * @example
 * ```ts
 * numberOf("32"); // undefined: a BMFont JSON writes numbers as numbers
 * ```
 */
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The character one BMFont entry stands for: its own `char` field, or the code point of its id.
 *
 * @param entry - One entry of the `chars` array.
 * @returns The character, or an empty string when the entry names none.
 */
function charOf(entry: Record<string, unknown>): string {
  if (typeof entry.char === "string") return entry.char;

  const id = numberOf(entry.id);

  return id === undefined ? "" : String.fromCodePoint(id);
}

/**
 * Reads the advance of every char entry of a BMFont JSON.
 *
 * @param chars - The `chars` array of the file.
 * @returns One advance per character.
 */
function readChars(chars: readonly unknown[]): Map<string, number> {
  const advances = emptyAdvances();

  for (const entry of chars) {
    if (!isRecord(entry)) continue;

    const advance = numberOf(entry.xadvance);
    const char = charOf(entry);

    if (char.length === 0 || advance === undefined) continue;

    advances.set(char, advance);
  }

  return advances;
}

/**
 * Reads a `.fnt` in BMFont JSON.
 *
 * @param fnt - The file as text.
 * @returns The advance table, or `undefined` when the file is not BMFont JSON.
 */
function readJson(fnt: string): AdvanceTable | undefined {
  let data: unknown;

  try {
    data = JSON.parse(fnt);
  } catch {
    return undefined;
  }

  if (!isRecord(data) || !isRecord(data.info) || !Array.isArray(data.chars)) return undefined;

  const size = Math.abs(numberOf(data.info.size) ?? 0);

  if (size <= 0) return undefined;

  const common = isRecord(data.common) ? data.common : {};
  const lineHeight = numberOf(common.lineHeight) ?? 0;

  return {
    size,
    lineHeight: lineHeight > 0 ? lineHeight : size,
    base: baseOf(numberOf(common.base), size),
    advances: readChars(data.chars)
  };
}

/**
 * The baseline a file names, or 0.8 of its size when it names none above 0.
 *
 * @param base - The `base` of the file's `common` block, as it was read.
 * @param size - The export size of the font.
 * @returns How far the baseline sits below the top of a line, at the export size.
 * @example
 * ```ts
 * baseOf(undefined, 40); // 32
 * ```
 */
function baseOf(base: number | undefined, size: number): number {
  return base !== undefined && base > 0 ? base : FALLBACK_BASE * size;
}

/**
 * Creates the empty glyph table. Its own function because lint rule L5 refuses a collection built
 * inside an exported declaration.
 *
 * @returns An empty map of advances.
 */
function emptyAdvances(): Map<string, number> {
  return new Map();
}

/**
 * Reads one numeric attribute out of an XML fragment.
 *
 * @param source - The fragment.
 * @param pattern - A pattern whose first group is the number.
 * @returns The number, or `undefined`.
 */
function attribute(source: string, pattern: RegExp): number | undefined {
  const found = pattern.exec(source);

  return found === null ? undefined : numberOf(Number(found[1]));
}

/**
 * Reads a `.fnt` in BMFont XML.
 *
 * @param fnt - The file as text.
 * @returns The advance table, or `undefined` when the file is not BMFont XML.
 */
function readXml(fnt: string): AdvanceTable | undefined {
  if (!fnt.includes("<font")) return undefined;

  const size = Math.abs(attribute(fnt, /<info[^>]*\ssize="(-?\d+)"/) ?? 0);

  if (size <= 0) return undefined;

  const lineHeight = attribute(fnt, /<common[^>]*\slineHeight="(-?\d+)"/) ?? 0;
  const base = attribute(fnt, /<common[^>]*\sbase="(-?\d+)"/);
  const advances = emptyAdvances();

  // An attribute value may hold a ">" (msdf-bmfont-xml writes char=">"), so quoted values are skipped whole.
  for (const match of fnt.matchAll(/<char\s(?:[^>"]|"[^"]*")*>/g)) {
    const tag = match[0];
    const id = attribute(tag, /\sid="(-?\d+)"/);
    const advance = attribute(tag, /\sxadvance="(-?\d+)"/);

    if (id === undefined || advance === undefined) continue;

    advances.set(String.fromCodePoint(id), advance);
  }

  return {
    size,
    lineHeight: lineHeight > 0 ? lineHeight : size,
    base: baseOf(base, size),
    advances
  };
}

/**
 * Reads the advance table of a font out of its `.fnt` file. Kerning pairs are ignored: an MSDF
 * HUD does not need them, and leaving them out keeps the measure the same everywhere.
 *
 * @param fnt - The `.fnt` file as text, in BMFont XML or BMFont JSON.
 * @param key - The asset key of the font, for the error.
 * @returns The export size, the line height, the baseline and one advance per character.
 * @throws {Error} When the file is in neither format.
 * @example
 * ```ts
 * parseAdvances('{"info":{"size":32},"common":{"lineHeight":40,"base":30},"chars":[]}', "ui.font-body");
 * // { size: 32, lineHeight: 40, base: 30, advances: Map(0) }
 * ```
 */
export function parseAdvances(fnt: string, key: string): AdvanceTable {
  const table = readJson(fnt) ?? readXml(fnt);

  if (table === undefined) {
    throw new Error(
      `[game] Font "${key}" is not BMFont XML or JSON.\n` +
        "  Export the MSDF font with a BMFont .fnt file."
    );
  }

  return table;
}

/**
 * The width of one character, letter spacing included. A character the loaded font has no glyph
 * for is 0 wide, spacing and all: Pixi skips it when it lays the run out and draws nothing.
 *
 * @param char - The character.
 * @param style - The look of the run.
 * @param fontKey - The font of the run.
 * @param tables - The advance tables that are loaded.
 * @param options - Where a warning goes.
 * @returns The advance in reference pixels.
 */
function advanceOf(
  char: string,
  style: TextStyle,
  fontKey: string,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): number {
  const table = tables.get(fontKey);

  if (table === undefined) {
    options.warn(`font:${fontKey}`, "text: the font is not loaded, measuring with 0.6 em", {
      font: fontKey
    });

    return FALLBACK_ADVANCE * style.size + style.letterSpacing;
  }

  const scale = style.size / table.size;
  const own = table.advances.get(char);

  if (own !== undefined) return own * scale + style.letterSpacing;

  options.warn(`glyph:${fontKey}:${char}`, "text: the font has no glyph", {
    font: fontKey,
    glyph: char
  });

  return 0;
}

/**
 * The width of one run in its look: the advances of its glyphs, or a square at the line of the
 * look for an icon.
 *
 * @param run - The run to measure.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @param options - Where a warning goes, and the styles and bold looks a run may take.
 * @returns The width in reference pixels.
 * @example
 * ```ts
 * measureRun({ kind: "icon", key: "hud.coin", span: undefined }, bodyStyle, new Map(), options); // 38.4
 * ```
 */
export function measureRun(
  run: Run,
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): number {
  const look = lookIn(style, run, options);

  if (run.kind === "icon") return lineHeightOf(look, tables) + look.letterSpacing;

  const fontKey = fontOfRun(look, run);
  let width = 0;

  for (const char of run.text) width += advanceOf(char, look, fontKey, tables, options);

  return width;
}

/**
 * Tells whether a glyph piece may join the last run of a line: both glyphs, with the same bold,
 * italic, colour and span. An icon never merges.
 *
 * @param last - The last run of the line, if any.
 * @param piece - The glyph piece to append.
 * @returns True when the piece's text may be added to `last`.
 */
function canMerge(last: Run | undefined, piece: TextRun): last is TextRun {
  return last?.kind === "text" && sameLook(last, piece);
}

/**
 * Appends a piece to a line, merging glyphs into the last run when both are glyphs with the same
 * flags. An icon is always a run of its own. A glyph piece is pushed as a copy, so the merge
 * writes into the line's own run and never into the token the piece came from: a balanced style
 * runs the wrap pass over the same tokens more than once.
 *
 * @param runs - The runs of the line so far.
 * @param piece - The piece to append.
 */
function appendRun(runs: Run[], piece: Run): void {
  const last = runs.at(-1);

  if (piece.kind === "text" && canMerge(last, piece)) {
    last.text += piece.text;

    return;
  }

  runs.push(piece.kind === "text" ? { ...piece } : piece);
}

/**
 * Creates one line whose box is not measured yet: `boxLines` writes its height and baseline.
 *
 * @param runs - The runs of the line.
 * @param width - How wide they are, the indent of the first line included.
 * @returns The line.
 * @example
 * ```ts
 * openLine([], 0); // { runs: [], width: 0, height: 0, baseline: 0 }
 * ```
 */
function openLine(runs: Run[], width: number): Line {
  return { runs, width, height: 0, baseline: 0 };
}

/**
 * The width of a line with the indent it starts at: the first line of a block that holds a run is
 * as wide as its runs plus the indent, every other line as its runs.
 *
 * @param runs - The runs of the line.
 * @param width - How wide they are.
 * @param indent - The indent the line starts at: `textIndent` on the first line, else 0.
 * @returns The width of the line.
 * @example
 * ```ts
 * indentedWidth([], 0, 20); // 0: an empty first line takes no indent
 * ```
 */
function indentedWidth(runs: readonly Run[], width: number, indent: number): number {
  return runs.length > 0 ? indent + width : width;
}

/**
 * Lays runs out with no wrapping: one line per `\n` segment, the first one shifted by the indent.
 *
 * @param runs - The runs of the block.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @param options - Where a warning goes.
 * @returns The lines, each with its width.
 */
function layoutFixed(
  runs: readonly Run[],
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): Line[] {
  const lines: Line[] = [];
  let current: Run[] = [];
  let width = 0;

  // Closes the open line; the first one starts after the indent.
  const push = (): void => {
    const indent = lines.length === 0 ? (style.textIndent ?? 0) : 0;

    lines.push(openLine(current, indentedWidth(current, width, indent)));
    current = [];
    width = 0;
  };

  for (const run of runs) {
    // An icon joins the open line whole.
    if (run.kind === "icon") {
      current.push(run);
      width += measureRun(run, style, tables, options);

      continue;
    }

    // Glyphs join it segment by segment: every `\n` closes a line. No soft hyphen is drawn.
    const segments = run.text.replaceAll(SOFT_HYPHEN, "").split("\n");

    for (const [index, segment] of segments.entries()) {
      if (index > 0) push();
      if (segment.length === 0) continue;

      const piece: TextRun = { ...run, text: segment };

      appendRun(current, piece);
      width += measureRun(piece, style, tables, options);
    }
  }

  push();

  return lines;
}

/**
 * One word, one run of spaces, one line break, or a break inside a word (`soft`): after a hyphen,
 * with no runs, or at a soft hyphen, with the `-` it draws when the line breaks there. `tail` is
 * the width of that `-` on the word right before it, so the word is placed where its hyphen fits.
 */
type Token = {
  kind: "word" | "space" | "break" | "soft";
  runs: Run[];
  width: number;
  tail: number;
};

/**
 * What one piece of a split run is: a line break, a run of spaces, or a word.
 *
 * @param piece - One piece of the split.
 * @returns Which of the three it is.
 */
function kindOf(piece: string): Token["kind"] {
  if (piece === "\n") return "break";

  return piece.trim().length === 0 ? "space" : "word";
}

/**
 * Puts one piece into the tokens: onto the last word when the piece is a word that touches it,
 * as a token of its own otherwise.
 *
 * @param tokens - The tokens so far.
 * @param token - The piece, as a token of one run.
 * @param touches - True when nothing stands between the piece and the token before it.
 */
function pushToken(tokens: Token[], token: Token, touches: boolean): void {
  const last = tokens.at(-1);

  if (touches && token.kind === "word" && last?.kind === "word") {
    last.runs.push(...token.runs);
    last.width += token.width;
    last.tail = token.tail;

    return;
  }

  tokens.push(token);
}

/**
 * Splits the runs into words, spaces and breaks. An icon is a glyph: one unbreakable piece of the
 * word it touches, or a word of its own between spaces.
 *
 * @param runs - The runs of the block.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @param options - Where a warning goes.
 * @returns The tokens, in reading order.
 */
function tokenise(
  runs: readonly Run[],
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): Token[] {
  const tokens: Token[] = [];

  for (const run of runs) {
    // An icon is a glyph: part of the word it touches.
    if (run.kind === "icon") {
      const width = measureRun(run, style, tables, options);

      pushToken(tokens, { kind: "word", runs: [run], width, tail: 0 }, true);

      continue;
    }

    // A glyph run splits into words, spaces and breaks; its first piece touches the token before.
    for (const [index, piece] of run.text.split(TOKENS).entries()) {
      if (piece.length === 0) continue;

      const kind = kindOf(piece);

      // A word splits again at its hyphen breaks.
      if (kind === "word") {
        pushWord(tokens, run, piece, index === 0, { style, tables, options });

        continue;
      }

      // Spaces are as wide as they are drawn; a line break takes no room.
      const part: TextRun = { ...run, text: piece };
      const width = kind === "break" ? 0 : measureRun(part, style, tables, options);

      pushToken(tokens, { kind, runs: [part], width, tail: 0 }, index === 0);
    }
  }

  return tokens;
}

/**
 * Puts one word of a run into the tokens, split at its breaks: after a joining hyphen, and at a
 * soft hyphen, which is dropped from the glyphs and becomes the `-` of a break there.
 *
 * @param tokens - The tokens so far.
 * @param run - The run the word is part of.
 * @param word - The word, with no spaces and no line break.
 * @param touches - True when nothing stands between the word and the token before it.
 * @param metrics - The style, the tables and the warning.
 */
function pushWord(
  tokens: Token[],
  run: TextRun,
  word: string,
  touches: boolean,
  metrics: Metrics
): void {
  for (const [softIndex, between] of word.split(SOFT_HYPHEN).entries()) {
    // A soft hyphen is a break that draws "-" only when the line ends there.
    if (softIndex > 0) pushSoft(tokens, { ...run, text: "-" }, metrics);

    // The part between soft hyphens splits after its joining hyphens, one word token per piece.
    for (const [index, piece] of between.split(HYPHEN_BREAKS).entries()) {
      if (index > 0) pushSoft(tokens, undefined, metrics);
      if (piece.length === 0) continue;

      const part: TextRun = { ...run, text: piece };
      const width = measureRun(part, metrics.style, metrics.tables, metrics.options);
      const first = touches && softIndex === 0 && index === 0;

      pushToken(tokens, { kind: "word", runs: [part], width, tail: 0 }, first);
    }
  }
}

/**
 * Puts a break inside a word into the tokens, and gives the word before it the width of the `-`
 * the break draws.
 *
 * @param tokens - The tokens so far.
 * @param hyphen - The `-` of a soft hyphen, or `undefined` after a hyphen the word already has.
 * @param metrics - The style, the tables and the warning.
 */
function pushSoft(tokens: Token[], hyphen: TextRun | undefined, metrics: Metrics): void {
  const width =
    hyphen === undefined ? 0 : measureRun(hyphen, metrics.style, metrics.tables, metrics.options);
  const last = tokens.at(-1);

  if (last?.kind === "word") last.tail = width;

  tokens.push({ kind: "soft", runs: hyphen === undefined ? [] : [hyphen], width, tail: 0 });
}

/** The metrics one wrapped block is laid out with. */
type Metrics = {
  style: TextStyle;
  tables: Map<string, AdvanceTable>;
  options: LayoutOptions;
};

/**
 * The lines built so far and the one that is still open. `indent` is the room the open line
 * starts after: `textIndent` on the first line of the block, 0 from the second on.
 */
type Builder = { lines: Line[]; runs: Run[]; width: number; indent: number };

/**
 * Closes the open line and starts a new one at the edge.
 *
 * @param builder - The lines built so far.
 */
function commit(builder: Builder): void {
  builder.lines.push(
    openLine(builder.runs, indentedWidth(builder.runs, builder.width, builder.indent))
  );
  builder.runs = [];
  builder.width = 0;
  builder.indent = 0;
}

/**
 * Puts a whole token on the open line.
 *
 * @param builder - The lines built so far.
 * @param token - The word or the spaces to place.
 */
function add(builder: Builder, token: Token): void {
  for (const part of token.runs) appendRun(builder.runs, part);

  builder.width += token.width;
}

/**
 * The unbreakable pieces of one run: one run per character of a glyph run, the icon itself for
 * an icon.
 *
 * @param run - One run of a word.
 * @returns The pieces, in reading order.
 * @example
 * ```ts
 * glyphsOf({ kind: "icon", key: "hud.coin", span: undefined });
 * // [{ kind: "icon", key: "hud.coin", span: undefined }]
 * ```
 */
function glyphsOf(run: Run): Run[] {
  if (run.kind === "icon") return [run];

  return Array.from(run.text, (char): TextRun => ({ ...run, text: char }));
}

/**
 * Tells whether a piece of this width no longer fits on the open line: the line holds something
 * already, and its indent, its runs and the piece stand past the wrap. The first piece of a line
 * always fits, so a glyph wider than the wrap gets a line of its own.
 *
 * @param builder - The lines built so far.
 * @param width - The width of the piece.
 * @param wrap - The wrap width in reference pixels.
 * @returns True when the piece goes to the next line.
 */
function overflows(builder: Builder, width: number, wrap: number): boolean {
  return builder.runs.length > 0 && builder.indent + builder.width + width > wrap;
}

/**
 * Places a word that is wider than the room of its line, glyph by glyph. An icon is one glyph.
 *
 * @param builder - The lines built so far.
 * @param token - The word to break.
 * @param wrap - The wrap width in reference pixels.
 * @param metrics - The style, the tables and the warning.
 */
function breakWord(builder: Builder, token: Token, wrap: number, metrics: Metrics): void {
  for (const part of token.runs) {
    for (const piece of glyphsOf(part)) {
      const glyph = measureRun(piece, metrics.style, metrics.tables, metrics.options);

      if (overflows(builder, glyph, wrap)) commit(builder);

      appendRun(builder.runs, piece);
      builder.width += glyph;
    }
  }
}

/**
 * Places one word: on the open line when it still fits there with the spaces before it and the
 * hyphen a break after it would draw, on the next one when it does not, and glyph by glyph when
 * it fits on no line at all, or as the first word of a block not in the room its indent leaves. A
 * break inside a word stands before it with no width: the line ends there with the `-` of a soft
 * hyphen, and the word goes on with nothing between when it fits.
 *
 * @param builder - The lines built so far.
 * @param token - The word to place.
 * @param pending - The spaces or the break inside a word that stand before it.
 * @param wrap - The wrap width in reference pixels.
 * @param metrics - The style, the tables and the warning.
 */
function placeWord(
  builder: Builder,
  token: Token,
  pending: Token | undefined,
  wrap: number,
  metrics: Metrics
): void {
  const space = pending?.kind === "space" ? pending : undefined;
  const lead = space?.width ?? 0;
  const overflows =
    builder.runs.length > 0 &&
    builder.indent + builder.width + lead + token.width + token.tail > wrap;

  // The word goes to the next line when it does not fit; a soft hyphen leaves its "-" behind.
  if (overflows) {
    if (pending?.kind === "soft") add(builder, pending);
    commit(builder);
  } else if (space !== undefined) add(builder, space);

  // The word is placed whole, or glyph by glyph when it fits on no line.
  if (builder.indent + token.width <= wrap) add(builder, token);
  else breakWord(builder, token, wrap, metrics);
}

/**
 * Lays tokens out into lines no wider than the wrap: the greedy pass. Words break between them,
 * after a hyphen that joins two parts and at a soft hyphen; a word wider than the wrap breaks
 * between its glyphs. The tokens are read and never changed, so the pass may run on them again.
 *
 * @param tokens - The tokens of the block.
 * @param metrics - The style, the tables and the warning.
 * @param wrap - The wrap width in reference pixels.
 * @returns The lines, each with its width.
 */
function wrapTokens(tokens: readonly Token[], metrics: Metrics, wrap: number): Line[] {
  const builder: Builder = {
    lines: [],
    runs: [],
    width: 0,
    indent: metrics.style.textIndent ?? 0
  };
  let pending: Token | undefined;

  for (const token of tokens) {
    // A line break closes the line.
    if (token.kind === "break") {
      commit(builder);
      pending = undefined;

      continue;
    }

    // Spaces wait for the word after them, and are dropped at the start of a line.
    if (token.kind === "space") {
      if (builder.runs.length > 0) pending = token;

      continue;
    }

    // A break inside a word waits the same way; spaces before the word win over it.
    if (token.kind === "soft") {
      if (builder.runs.length > 0 && pending === undefined) pending = token;

      continue;
    }

    placeWord(builder, token, pending, wrap, metrics);
    pending = undefined;
  }

  commit(builder);

  return builder.lines;
}

/**
 * The narrowest line a word may stand on whole: the widest word with the `-` a break after it
 * draws. Below it a word breaks between its glyphs or its hyphen stands past the line.
 *
 * @param tokens - The tokens of the block.
 * @returns The width in reference pixels; 0 for a block with no word.
 * @example
 * ```ts
 * widestWord([{ kind: "word", runs: [], width: 80, tail: 0 }]); // 80
 * ```
 */
function widestWord(tokens: readonly Token[]): number {
  let widest = 0;

  for (const token of tokens) {
    if (token.kind === "word") widest = Math.max(widest, token.width + token.tail);
  }

  return widest;
}

/**
 * The narrowest line the first word of a block stands on whole after the indent: the word, the
 * `-` a break after it draws, and the indent. 0 for a block whose first line holds no word.
 *
 * @param tokens - The tokens of the block.
 * @param indent - The `textIndent` of the style.
 * @returns The width in reference pixels.
 * @example
 * ```ts
 * firstWord([{ kind: "word", runs: [], width: 50, tail: 0 }], 45); // 95
 * ```
 */
function firstWord(tokens: readonly Token[], indent: number): number {
  for (const token of tokens) {
    if (token.kind === "break") return 0;
    if (token.kind === "word") return token.width + token.tail + indent;
  }

  return 0;
}

/**
 * Tells whether a block of this many lines is evened out: 2 to 6, as Chrome.
 *
 * @param count - The number of greedy lines.
 * @returns True when the balance searches a narrower width.
 * @example
 * ```ts
 * isBalanced(7); // false: past six lines a block keeps its greedy lines
 * ```
 */
function isBalanced(count: number): boolean {
  return count >= 2 && count <= BALANCE_MAX_LINES;
}

/**
 * Evens the greedy lines of a balanced style: the narrowest width in `[widest word, wrap]` that
 * keeps their number, found in 16 halvings, and the lines at that width. The first word stands
 * whole after the indent at every width tried. A block of one line or of more than six, or with
 * a word that does not fit the wrap whole, keeps its greedy lines.
 *
 * @param tokens - The tokens of the block, as the greedy pass read them.
 * @param greedy - The greedy lines at the wrap.
 * @param metrics - The style, the tables and the warning.
 * @param wrap - The wrap width in reference pixels.
 * @returns The balanced lines, or the greedy ones.
 */
function balanceLines(
  tokens: readonly Token[],
  greedy: Line[],
  metrics: Metrics,
  wrap: number
): Line[] {
  const count = greedy.length;

  if (!isBalanced(count)) return greedy;

  // The search runs between the narrowest line every word stands on whole, the first one after
  // the indent, and the wrap; a word that does not fit the wrap whole keeps the greedy lines.
  let low = Math.max(widestWord(tokens), firstWord(tokens, metrics.style.textIndent ?? 0));
  let high = wrap;

  if (low >= high) return greedy;

  // A narrower width never gives fewer lines, so `high` always keeps the count.
  for (let step = 0; step < BALANCE_STEPS; step += 1) {
    const middle = (low + high) / 2;

    if (wrapTokens(tokens, metrics, middle).length <= count) high = middle;
    else low = middle;
  }

  return high === wrap ? greedy : wrapTokens(tokens, metrics, high);
}

/**
 * Lays runs out into lines no wider than the wrap, evened out when the style balances. The tokens
 * are made once; the balance runs the wrap pass on them again.
 *
 * @param runs - The runs of the block.
 * @param metrics - The style, the tables and the warning.
 * @param wrap - The wrap width in reference pixels.
 * @returns The lines, each with its width.
 */
function layoutWrapped(runs: readonly Run[], metrics: Metrics, wrap: number): Line[] {
  const tokens = tokenise(runs, metrics.style, metrics.tables, metrics.options);
  const greedy = wrapTokens(tokens, metrics, wrap);

  return metrics.style.balance === true ? balanceLines(tokens, greedy, metrics, wrap) : greedy;
}

/**
 * Wraps the caller's warning so one key is reported once per layout.
 *
 * @param options - What the caller passed.
 * @returns The same options with a warning that repeats nothing.
 */
function onceOnly(options: LayoutOptions): LayoutOptions {
  const seen = emptyKeys();

  return {
    ...options,
    warn: (key, message, data): void => {
      if (seen.has(key)) return;

      seen.add(key);
      options.warn(key, message, data);
    }
  };
}

/**
 * Creates the empty key set of one layout, for the same reason as `emptyAdvances`.
 *
 * @returns An empty set of warning keys.
 */
function emptyKeys(): Set<string> {
  return new Set();
}

/**
 * The width a block of a style wraps at: the width of the style, the box for a `"box"` style that
 * has one, or nothing for one line per `\n` segment.
 *
 * @param style - The style of the label.
 * @param box - The laid-out width of the text element; 0 when it has none.
 * @returns The wrap width in reference pixels, or `undefined` for no wrapping.
 * @example
 * ```ts
 * wrapOf({ ...bodyStyle, wrap: "box" }, 0); // undefined: no box, one line
 * ```
 */
function wrapOf(style: TextStyle, box: number): number | undefined {
  if (style.wrap === "none") return undefined;
  if (style.wrap !== "box") return style.wrap;

  return box > 0 ? box + BOX_SLACK : undefined;
}

/**
 * Lays a block of runs out: the lines with their boxes, the width of the widest one and the total
 * height. The alignment of the style changes nothing here; it moves the lines when they are
 * drawn. A style with `wrap: "box"` wraps at `box`, the width `ui` laid its text element out at,
 * and is one line without one; any other style ignores `box`. `options` carries the style table
 * and the bold looks a run in a span or in `<b>` takes its look from.
 *
 * @param runs - What `parseTags` made of the resolved string.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded, by font key.
 * @param options - Where a warning goes, and the styles and bold looks a run may take.
 * @param box - The width a `"box"` style wraps at, in reference pixels; 0 for none.
 * @returns The lines and the size of the block in reference pixels.
 * @example
 * ```ts
 * layoutRuns([], bodyStyle, new Map(), { warn: () => undefined });
 * // { lines: [{ runs: [], width: 0, height: 38.4, baseline: 25.6 }], width: 0, height: 38.4 }
 * ```
 */
export function layoutRuns(
  runs: readonly Run[],
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions,
  box = 0
): TextLayout {
  // The lines: one per `\n` segment, or wrapped at the wrap of the style.
  const once = onceOnly(options);
  const wrap = wrapOf(style, box);
  const lines =
    wrap === undefined
      ? layoutFixed(runs, style, tables, once)
      : layoutWrapped(runs, { style, tables, options: once }, wrap);

  // The box of every line, then the size of the block.
  boxLines(lines, style, tables, once);

  let width = 0;

  for (const line of lines) width = Math.max(width, line.width);

  return { lines, width, height: blockHeight(lines) };
}
