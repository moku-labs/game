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
 * Appends text to the runs, merging it into the last one when the flags and the span are the
 * same.
 *
 * @param runs - The runs built so far.
 * @param text - The characters to append.
 * @param stack - The tags that are open around them.
 */
function pushText(runs: Run[], text: string, stack: readonly OpenTag[]): void {
  let color: number | undefined;

  for (const open of stack) if (open.name === "color") color = open.color;

  const piece: TextRun = {
    kind: "text",
    text,
    bold: stack.some(open => open.name === "b"),
    italic: stack.some(open => open.name === "i"),
    color,
    span: spanOf(stack)
  };
  const last = runs.at(-1);

  if (
    last !== undefined &&
    last.kind === "text" &&
    last.bold === piece.bold &&
    last.italic === piece.italic &&
    last.color === piece.color &&
    last.span === piece.span
  ) {
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
  const icon = ICON_TAG.exec(body);

  if (icon !== null) {
    flush(state);
    state.runs.push({ kind: "icon", key: icon[1] ?? "", span: spanOf(state.stack) });

    return;
  }

  const open = openTag(body);

  if (open !== undefined) {
    flush(state);
    state.stack.push(open);

    return;
  }

  const closes = body.startsWith("/");
  const at = closes ? state.stack.map(entry => entry.name).lastIndexOf(body.slice(1)) : -1;

  if (at !== -1) {
    flush(state);
    state.stack.splice(at, 1);

    return;
  }

  complain(state, closes ? "text: stray closing tag" : "text: unknown tag", body);
  state.buffer += `<${body}>`;
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
    const char = source[index] ?? "";

    if (char === "\\" && source[index + 1] === "<") {
      state.buffer += "<";
      index += 2;

      continue;
    }

    const close = char === "<" ? source.indexOf(">", index + 1) : -1;

    if (close === -1) {
      state.buffer += char;
      index += 1;

      continue;
    }

    applyTag(state, source.slice(index + 1, close));
    index = close + 1;
  }

  flush(state);

  if (state.stack.length > 0) complain(state, "text: unclosed tag", state.stack[0]?.name ?? "");

  return state.runs;
}
