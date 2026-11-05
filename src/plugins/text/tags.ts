/**
 * @file text plugin — the one grammar of a resolved string: `<b>`, `<i>`, `<color=#rrggbb>`,
 * `<span style=KEY>` and `<icon=key>`, the escape `\<`, and a line break that is a line break in
 * every style. Pure: it knows nothing about fonts, widths or which style keys exist.
 */
import type { Run, TextRun, Warn } from "./types";

/** One tag that is still open, and what it does to the runs inside it. */
type OpenTag = { name: string; color: number | undefined; span: string | undefined };

/** What one parse carries along: what was built, what is open, and what is not written yet. */
type ParseState = {
  source: string;
  runs: Run[];
  stack: OpenTag[];
  buffer: string;
  warned: boolean;
  warn: Warn;
};

/** Matches an opening colour tag. Six hex digits: `#rgb` is not accepted. */
const COLOR_TAG = /^color=#([\da-f]{6})$/i;

/** Matches an inline icon tag, which has no closing tag. */
const ICON_TAG = /^icon=(\S+)$/;

/** Matches an opening span tag. The key is unquoted: `style="x"` is not this grammar. */
const SPAN_TAG = /^span style=([^\s"']+)$/;

/**
 * Reads an opening tag.
 *
 * @param body - What stood between the angle brackets.
 * @returns The tag, or `undefined` when it is not one this grammar knows.
 * @example
 * ```ts
 * openTag("color=#ff0000"); // { name: "color", color: 16711680, span: undefined }
 * ```
 */
function openTag(body: string): OpenTag | undefined {
  if (body === "b" || body === "i") return { name: body, color: undefined, span: undefined };

  const span = SPAN_TAG.exec(body);

  if (span !== null) return { name: "span", color: undefined, span: span[1] };

  const colour = COLOR_TAG.exec(body);

  if (colour === null) return undefined;

  return { name: "color", color: Number.parseInt(colour[1] ?? "0", 16), span: undefined };
}

/**
 * The key of the innermost open span: a nested span wins over the one around it.
 *
 * @param stack - The tags that are open.
 * @returns The style key, or `undefined` outside a span.
 * @example
 * ```ts
 * spanOf([{ name: "span", color: undefined, span: "price.22" }]); // "price.22"
 * ```
 */
function spanOf(stack: readonly OpenTag[]): string | undefined {
  let span: string | undefined;

  for (const open of stack) if (open.name === "span") span = open.span;

  return span;
}

/**
 * Tells whether two glyph runs are drawn in the same look: the same bold, italic, colour and span.
 * Only then may their text be one run: the parse, the layout and the draw all ask this.
 *
 * @param first - One glyph run.
 * @param second - The other.
 * @returns True when nothing but the text tells them apart.
 */
export function sameLook(first: TextRun, second: TextRun): boolean {
  return (
    first.bold === second.bold &&
    first.italic === second.italic &&
    first.color === second.color &&
    first.span === second.span
  );
}

/**
 * Appends text to the runs, merging it into the last one when it is in the same look.
 *
 * @param runs - The runs built so far.
 * @param text - The characters to append.
 * @param stack - The tags that are open around them.
 */
function pushText(runs: Run[], text: string, stack: readonly OpenTag[]): void {
  let color: number | undefined;

  for (const open of stack) if (open.name === "color") color = open.color;

  // The look the open tags give the text: the innermost colour and span win.
  const piece: TextRun = {
    kind: "text",
    text,
    bold: stack.some(open => open.name === "b"),
    italic: stack.some(open => open.name === "i"),
    color,
    span: spanOf(stack)
  };
  const last = runs.at(-1);

  // Text in the look of the run before it joins that run.
  if (last?.kind === "text" && sameLook(last, piece)) {
    last.text += text;

    return;
  }

  runs.push(piece);
}

/**
 * Reports one source string once, whatever is wrong with it.
 *
 * @param state - The parse in progress.
 * @param message - The log event.
 * @param tag - The tag that was wrong.
 */
function complain(state: ParseState, message: string, tag: string): void {
  if (state.warned) return;

  state.warned = true;
  state.warn(`tag:${state.source}`, message, { tag, text: state.source });
}

/**
 * Writes what was read so far into a run.
 *
 * @param state - The parse in progress.
 */
function flush(state: ParseState): void {
  if (state.buffer.length === 0) return;

  pushText(state.runs, state.buffer, state.stack);
  state.buffer = "";
}

/**
 * Applies one tag: an icon run, an opening tag, a matching close, or, when it is none of those,
 * literal text and one warning.
 *
 * @param state - The parse in progress.
 * @param body - What stood between the angle brackets.
 */
function applyTag(state: ParseState, body: string): void {
  // An icon is a run of its own, in the span around it.
  const icon = ICON_TAG.exec(body);

  if (icon !== null) {
    flush(state);
    state.runs.push({ kind: "icon", key: icon[1] ?? "", span: spanOf(state.stack) });

    return;
  }

  // An opening tag changes the look of what follows.
  const open = openTag(body);

  if (open !== undefined) {
    flush(state);
    state.stack.push(open);

    return;
  }

  // A close ends the innermost open tag of its name.
  const closes = body.startsWith("/");
  const at = closes ? state.stack.map(entry => entry.name).lastIndexOf(body.slice(1)) : -1;

  if (at !== -1) {
    flush(state);
    state.stack.splice(at, 1);

    return;
  }

  // Anything else stays visible, and the source is reported once.
  complain(state, closes ? "text: stray closing tag" : "text: unknown tag", body);
  state.buffer += `<${body}>`;
}

/**
 * Tells whether the character at an index starts the escape `\<`, a literal `<`.
 *
 * @param source - The resolved string.
 * @param index - Where the parse stands.
 * @returns True for a backslash right before a `<`.
 * @example
 * ```ts
 * isEscape(String.raw`a\<b`, 1); // true
 * ```
 */
function isEscape(source: string, index: number): boolean {
  return source[index] === "\\" && source[index + 1] === "<";
}

/**
 * Writes a plain string so the grammar reads it as exactly these characters: every `<` becomes
 * the escape `\<`. A string without `<` comes back as it is. A typed field value goes through it.
 *
 * @param text - The plain string.
 * @returns The string `parseTags` reads as one run of the same characters.
 * @example
 * ```ts
 * escapeTags("<b>x"); // "\\<b>x"
 * ```
 */
export function escapeTags(text: string): string {
  return text.includes("<") ? text.replaceAll("<", String.raw`\<`) : text;
}

/**
 * Turns a resolved string into runs of glyphs and inline icons. Everything the grammar does not
 * know stays visible: the tag is kept as literal text and the source is reported once. A run in a
 * `<span style=KEY>` carries `KEY`; whether a style has that key is the layout's question.
 *
 * @param source - The resolved string, as it was written or formatted.
 * @param warn - Called at most once per source, with the key `tag:<source>`.
 * @returns The runs, in reading order, with equal neighbours merged.
 * @example
 * ```ts
 * parseTags("<b>a</b><span style=price.22>b</span>", () => undefined);
 * // [{ kind: "text", text: "a", bold: true, italic: false, color: undefined, span: undefined },
 * //  { kind: "text", text: "b", bold: false, italic: false, color: undefined, span: "price.22" }]
 * ```
 */
export function parseTags(source: string, warn: Warn): Run[] {
  const state: ParseState = { source, runs: [], stack: [], buffer: "", warned: false, warn };
  let index = 0;

  while (index < source.length) {
    // The escape `\<` is a literal `<`.
    if (isEscape(source, index)) {
      state.buffer += "<";
      index += 2;

      continue;
    }

    // A character that opens no tag with a `>` after it is text.
    const char = source[index] ?? "";
    const close = char === "<" ? source.indexOf(">", index + 1) : -1;

    if (close === -1) {
      state.buffer += char;
      index += 1;

      continue;
    }

    applyTag(state, source.slice(index + 1, close));
    index = close + 1;
  }

  // What is left is text; a tag still open is closed by the end and reported.
  flush(state);

  if (state.stack.length > 0) complain(state, "text: unclosed tag", state.stack[0]?.name ?? "");

  return state.runs;
}
