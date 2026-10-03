/**
 * @file text plugin — the measurement. A `.fnt` becomes an advance table, runs become lines, and
 * a block becomes a size in reference pixels. Pure and canvas-free: the same numbers on a screen
 * and in plain Bun, which is what keeps `ui.layout` honest. A character the font has no glyph for
 * measures 0 wide, because Pixi draws nothing for it.
 */
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

/** Line height of a style whose font is not loaded, as a share of the style size. */
const FALLBACK_LINE = 1.2;

/** Splits a run's text into words, runs of spaces and line breaks, separators kept. */
const TOKENS = /(\n| +)/;

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
 * Tells whether a BMFont JSON names a distance field. Pixi reads `distanceField.type`, the
 * exporters write `distanceField.fieldType`; a field of type `none` is no field.
 *
 * @param data - The parsed file.
 * @returns True when Pixi draws the font with its distance-field shader.
 * @example
 * ```ts
 * jsonField({ distanceField: { fieldType: "msdf", distanceRange: 6 } }); // true
 * ```
 */
function jsonField(data: Record<string, unknown>): boolean {
  const field = data.distanceField;

  if (!isRecord(field)) return false;

  return (field.fieldType ?? field.type) !== "none";
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

  const common = isRecord(data.common) ? (numberOf(data.common.lineHeight) ?? 0) : 0;

  return {
    size,
    lineHeight: common > 0 ? common : size,
    advances: readChars(data.chars),
    distanceField: jsonField(data)
  };
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
 * Tells whether a BMFont XML names a distance field: a `<distanceField>` whose `fieldType` is not
 * `none`, the test Pixi decides its shader by.
 *
 * @param fnt - The file as text.
 * @returns True when Pixi draws the font with its distance-field shader.
 * @example
 * ```ts
 * xmlField('<font><distanceField fieldType="msdf" distanceRange="6"/></font>'); // true
 * ```
 */
function xmlField(fnt: string): boolean {
  const tag = /<distanceField\s(?:[^>"]|"[^"]*")*>/.exec(fnt);

  if (tag === null) return false;

  return /\sfieldType="([^"]*)"/.exec(tag[0])?.[1] !== "none";
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
    advances,
    distanceField: xmlField(fnt)
  };
}

/**
 * Reads the advance table of a font out of its `.fnt` file. Kerning pairs are ignored: an MSDF
 * HUD does not need them, and leaving them out keeps the measure the same everywhere.
 *
 * @param fnt - The `.fnt` file as text, in BMFont XML or BMFont JSON.
 * @param key - The asset key of the font, for the error.
 * @returns The export size, the line height, one advance per character, and whether the file
 * names a distance field.
 * @throws {Error} When the file is in neither format.
 * @example
 * ```ts
 * parseAdvances('{"info":{"size":32},"common":{"lineHeight":40},"chars":[]}', "ui.font-body");
 * // { size: 32, lineHeight: 40, advances: Map(0), distanceField: false }
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
 * The font one run is drawn with: the bold or italic font when the style names it, else the
 * font of the style.
 *
 * @param style - The style of the label.
 * @param run - The run to draw.
 * @returns The asset key of the font.
 * @example
 * ```ts
 * fontOfRun(bodyStyle, { kind: "text", text: "a", bold: true, italic: false, color: undefined });
 * // "ui.font-body": the body style names no bold font, so the bold is synthetic
 * ```
 */
export function fontOfRun(style: TextStyle, run: TextRun): string {
  if (run.bold && style.bold !== undefined) return style.bold;
  if (run.italic && style.italic !== undefined) return style.italic;

  return style.font;
}

/**
 * The height of one line of a style, from the table of its own font.
 *
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @returns The line height in reference pixels.
 * @example
 * ```ts
 * lineHeightOf(bodyStyle, new Map()); // 38.4: 1.2 em of a 32 px style with no font loaded
 * ```
 */
export function lineHeightOf(style: TextStyle, tables: Map<string, AdvanceTable>): number {
  const table = tables.get(style.font);

  return table === undefined
    ? FALLBACK_LINE * style.size
    : table.lineHeight * (style.size / table.size);
}

/**
 * The width of one character, letter spacing included. A character the loaded font has no glyph
 * for is 0 wide, spacing and all: Pixi skips it when it lays the run out and draws nothing.
 *
 * @param char - The character.
 * @param style - The style of the label.
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
 * The width of one run: the advances of its glyphs, or a square at the line height for an icon.
 *
 * @param run - The run to measure.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded.
 * @param options - Where a warning goes.
 * @returns The width in reference pixels.
 * @example
 * ```ts
 * measureRun({ kind: "icon", key: "hud.coin" }, bodyStyle, new Map(), options); // 38.4
 * ```
 */
export function measureRun(
  run: Run,
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): number {
  if (run.kind === "icon") return lineHeightOf(style, tables) + style.letterSpacing;

  const fontKey = fontOfRun(style, run);
  let width = 0;

  for (const char of run.text) width += advanceOf(char, style, fontKey, tables, options);

  return width;
}

/**
 * Appends a piece to a line, merging glyphs into the last run when both are glyphs with the same
 * flags. An icon is always a run of its own.
 *
 * @param runs - The runs of the line so far.
 * @param piece - The piece to append.
 */
function appendRun(runs: Run[], piece: Run): void {
  const last = runs.at(-1);

  if (
    piece.kind === "text" &&
    last?.kind === "text" &&
    last.bold === piece.bold &&
    last.italic === piece.italic &&
    last.color === piece.color
  ) {
    last.text += piece.text;

    return;
  }

  runs.push(piece);
}

/**
 * Lays runs out with no wrapping: one line per `\n` segment.
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

  const push = (): void => {
    lines.push({ runs: current, width });
    current = [];
    width = 0;
  };

  for (const run of runs) {
    if (run.kind === "icon") {
      current.push(run);
      width += measureRun(run, style, tables, options);

      continue;
    }

    const segments = run.text.split("\n");

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

/** One word, one run of spaces or one line break, with the runs it is made of. */
type Token = { kind: "word" | "space" | "break"; runs: Run[]; width: number };

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
    if (run.kind === "icon") {
      const width = measureRun(run, style, tables, options);

      pushToken(tokens, { kind: "word", runs: [run], width }, true);

      continue;
    }

    for (const [index, piece] of run.text.split(TOKENS).entries()) {
      if (piece.length === 0) continue;

      const part: TextRun = { ...run, text: piece };
      const kind = kindOf(piece);
      const width = kind === "break" ? 0 : measureRun(part, style, tables, options);

      pushToken(tokens, { kind, runs: [part], width }, index === 0);
    }
  }

  return tokens;
}

/** The metrics one wrapped block is laid out with. */
type Metrics = {
  style: TextStyle;
  tables: Map<string, AdvanceTable>;
  options: LayoutOptions;
};

/** The lines built so far and the one that is still open. */
type Builder = { lines: Line[]; runs: Run[]; width: number };

/**
 * Closes the open line and starts a new one.
 *
 * @param builder - The lines built so far.
 */
function commit(builder: Builder): void {
  builder.lines.push({ runs: builder.runs, width: builder.width });
  builder.runs = [];
  builder.width = 0;
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
 * glyphsOf({ kind: "icon", key: "hud.coin" }); // [{ kind: "icon", key: "hud.coin" }]
 * ```
 */
function glyphsOf(run: Run): Run[] {
  if (run.kind === "icon") return [run];

  return Array.from(run.text, (char): TextRun => ({ ...run, text: char }));
}

/**
 * Places a word that is wider than the wrap, glyph by glyph. An icon is one glyph.
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

      if (builder.runs.length > 0 && builder.width + glyph > wrap) commit(builder);

      appendRun(builder.runs, piece);
      builder.width += glyph;
    }
  }
}

/**
 * Places one word: on the open line when it still fits there with the spaces before it, on the
 * next one when it does not, and glyph by glyph when it fits on no line at all.
 *
 * @param builder - The lines built so far.
 * @param token - The word to place.
 * @param pending - The spaces that stand before it, dropped at a line break.
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
  const lead = pending?.width ?? 0;

  if (builder.runs.length > 0 && builder.width + lead + token.width > wrap) commit(builder);
  else if (pending !== undefined) add(builder, pending);

  if (token.width <= wrap) add(builder, token);
  else breakWord(builder, token, wrap, metrics);
}

/**
 * Lays runs out into lines no wider than the wrap. Words break between them; a word wider than
 * the wrap breaks between its glyphs.
 *
 * @param runs - The runs of the block.
 * @param metrics - The style, the tables and the warning.
 * @param wrap - The wrap width in reference pixels.
 * @returns The lines, each with its width.
 */
function layoutWrapped(runs: readonly Run[], metrics: Metrics, wrap: number): Line[] {
  const builder: Builder = { lines: [], runs: [], width: 0 };
  let pending: Token | undefined;

  for (const token of tokenise(runs, metrics.style, metrics.tables, metrics.options)) {
    if (token.kind === "break") {
      commit(builder);
      pending = undefined;

      continue;
    }

    if (token.kind === "space") {
      if (builder.runs.length > 0) pending = token;

      continue;
    }

    placeWord(builder, token, pending, wrap, metrics);
    pending = undefined;
  }

  commit(builder);

  return builder.lines;
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
 * Lays a block of runs out: the lines, the width of the widest one and the total height. The
 * alignment of the style changes nothing here; it moves the lines when they are drawn.
 *
 * @param runs - What `parseTags` made of the resolved string.
 * @param style - The style of the label.
 * @param tables - The advance tables that are loaded, by font key.
 * @param options - Where a warning goes.
 * @returns The lines and the size of the block in reference pixels.
 * @example
 * ```ts
 * layoutRuns([], bodyStyle, new Map(), { warn: () => undefined });
 * // { lines: [{ runs: [], width: 0 }], width: 0, height: 38.4 }
 * ```
 */
export function layoutRuns(
  runs: readonly Run[],
  style: TextStyle,
  tables: Map<string, AdvanceTable>,
  options: LayoutOptions
): TextLayout {
  const once = onceOnly(options);
  const lines =
    style.wrap === "none"
      ? layoutFixed(runs, style, tables, once)
      : layoutWrapped(runs, { style, tables, options: once }, style.wrap);
  let width = 0;

  for (const line of lines) width = Math.max(width, line.width);

  return { lines, width, height: lines.length * lineHeightOf(style, tables) };
}
