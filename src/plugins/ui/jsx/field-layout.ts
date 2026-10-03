/**
 * @file ui/jsx — where the parts of a text field go, and how far the keyboard lifts it. Pure: the
 * mirror, the measured prefixes and the box in, numbers out. No ctx, no state, no DOM.
 */
import type { ResolvedStyle } from "../styles/types";
import type { Composing, Mirror } from "./types";

/** The four edges of a padding, in reference units. */
export type Edges = { top: number; right: number; bottom: number; left: number };

/** One part of a field: its box in the field's own space, and whether it is drawn. */
export type PartBox = { x: number; y: number; w: number; h: number; shown: boolean };

/**
 * Where everything of one field goes, in the field's own space: the text and what it shows, the
 * caret, the selection box and the composing underline.
 */
export type FieldLayout = {
  content: "value" | "placeholder";
  text: { x: number; y: number };
  caret: PartBox;
  selection: PartBox;
  composing: PartBox;
};

/**
 * What a field is laid out from. `mirror` is set only while the field is edited; `prefix`
 * measures a piece of the value in the field's text style.
 */
export type FieldLayoutInput = {
  value: string;
  mirror: Mirror | undefined;
  composing: Composing | undefined;
  size: { w: number; h: number };
  padding: Edges;
  lineHeight: number;
  caretWidth: number;
  underline: number;
  prefix: (text: string) => number;
};

/**
 * The four edges of a resolved padding.
 *
 * @param padding - One number for every edge, the edges a style names, or nothing.
 * @returns The edges, 0 where nothing is named.
 * @example
 * ```ts
 * paddingOf({ left: 8, top: 4 }); // { top: 4, right: 0, bottom: 0, left: 8 }
 * ```
 */
export function paddingOf(padding: ResolvedStyle["padding"]): Edges {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }

  return {
    top: padding?.top ?? 0,
    right: padding?.right ?? 0,
    bottom: padding?.bottom ?? 0,
    left: padding?.left ?? 0
  };
}

/**
 * Where the caret stands: at the end a selection was made towards, and at the end of the range
 * while an IME composes (iOS reports the whole marked range as the selection).
 *
 * @param mirror - The text and its selection.
 * @param composing - Whether an IME composes.
 * @returns The caret index, in UTF-16 units.
 * @example
 * ```ts
 * caretIndexOf({ value: "Alex", selectionStart: 1, selectionEnd: 3, direction: "backward" }, false); // 1
 * ```
 */
export function caretIndexOf(mirror: Mirror, composing: boolean): number {
  if (!composing && mirror.direction === "backward") return mirror.selectionStart;

  return mirror.selectionEnd;
}

/**
 * How far a value wider than the box scrolls left, so the caret stays inside.
 *
 * @param caretPrefix - The measured width of the value before the caret.
 * @param inner - The width inside the padding.
 * @returns The shift, 0 while the caret fits.
 * @example
 * ```ts
 * shiftOf(300, 260); // 40
 * ```
 */
export function shiftOf(caretPrefix: number, inner: number): number {
  return Math.max(0, caretPrefix - inner);
}

/**
 * Clamps an index into a value.
 *
 * @param index - The index the DOM or the IME reported.
 * @param value - The value it points into.
 * @returns The index, between 0 and the length.
 * @example
 * ```ts
 * clampIndex(9, "Alex"); // 4
 * ```
 */
function clampIndex(index: number, value: string): number {
  return Math.min(Math.max(0, index), value.length);
}

/**
 * A part that is not drawn: it keeps its place and its height, so it reads as the same part.
 *
 * @param x - Where it stands.
 * @param y - Its top.
 * @param w - Its width.
 * @param h - Its height.
 * @returns The hidden box.
 * @example
 * ```ts
 * hiddenPart(20, 30, 3, 40); // { x: 20, y: 30, w: 3, h: 40, shown: false }
 * ```
 */
function hiddenPart(x: number, y: number, w: number, h: number): PartBox {
  return { x, y, w, h, shown: false };
}

/**
 * Lays out the parts of one field. The text sits at the left padding minus the shift, centred
 * on its line; the caret after the measured prefix; the selection from one prefix to the other,
 * never while composing; the composing underline at the bottom of the line under its range.
 * Outside the editing only the text is drawn, unshifted.
 *
 * @param input - The value, the mirror, the box and the measure.
 * @returns Where every part goes, in the field's own space.
 * @example
 * ```ts
 * layoutField({
 *   value: "Al", mirror: undefined, composing: undefined, size: { w: 300, h: 100 },
 *   padding: { top: 0, right: 20, bottom: 0, left: 20 }, lineHeight: 40, caretWidth: 3,
 *   underline: 3, prefix: text => text.length * 10
 * }).text; // { x: 20, y: 30 }
 * ```
 */
export function layoutField(input: FieldLayoutInput): FieldLayout {
  const { value, mirror, padding, lineHeight, prefix, underline } = input;
  const y = (input.size.h - lineHeight) / 2;
  const content = value === "" ? "placeholder" : "value";
  const lineBottom = y + lineHeight - underline;

  if (mirror === undefined) {
    return {
      content,
      text: { x: padding.left, y },
      caret: hiddenPart(padding.left, y, input.caretWidth, lineHeight),
      selection: hiddenPart(padding.left, y, 0, lineHeight),
      composing: hiddenPart(padding.left, lineBottom, 0, underline)
    };
  }

  const composing = input.composing;
  const caret = clampIndex(caretIndexOf(mirror, composing !== undefined), value);
  const inner = input.size.w - padding.left - padding.right;
  const shift = shiftOf(prefix(value.slice(0, caret)), inner);
  const xOf = (index: number): number => padding.left + prefix(value.slice(0, index)) - shift;
  const start = clampIndex(Math.min(mirror.selectionStart, mirror.selectionEnd), value);
  const end = clampIndex(Math.max(mirror.selectionStart, mirror.selectionEnd), value);
  const selected = composing === undefined && start !== end;

  return {
    content,
    text: { x: padding.left - shift, y },
    caret: { x: xOf(caret), y, w: input.caretWidth, h: lineHeight, shown: true },
    selection: selected
      ? { x: xOf(start), y, w: xOf(end) - xOf(start), h: lineHeight, shown: true }
      : hiddenPart(xOf(caret), y, 0, lineHeight),
    composing:
      composing === undefined
        ? hiddenPart(xOf(caret), lineBottom, 0, underline)
        : composingPart(composing, value, xOf, lineBottom, underline)
  };
}

/**
 * The underline under a composing range.
 *
 * @param composing - The range the IME composes.
 * @param value - The value it points into.
 * @param xOf - Where an index of the value is drawn.
 * @param y - The top of the underline.
 * @param height - The height of the underline.
 * @returns The underline box.
 */
function composingPart(
  composing: Composing,
  value: string,
  xOf: (index: number) => number,
  y: number,
  height: number
): PartBox {
  const start = clampIndex(composing.start, value);
  const end = clampIndex(composing.end, value);

  return { x: xOf(start), y, w: xOf(end) - xOf(start), h: height, shown: true };
}

/**
 * The height the keyboard covers at the bottom of the window: what the visual viewport leaves
 * out below itself.
 *
 * @param viewport - The window height and the visual viewport's offset and height, in CSS px.
 * @param viewport.innerHeight - The layout viewport height.
 * @param viewport.offsetTop - How far the visual viewport is scrolled down.
 * @param viewport.height - The visual viewport height.
 * @returns The inset, 0 while the keyboard is down.
 * @example
 * ```ts
 * insetOf({ innerHeight: 714, offsetTop: 0, height: 404 }); // 310
 * ```
 */
export function insetOf(viewport: {
  innerHeight: number;
  offsetTop: number;
  height: number;
}): number {
  return Math.max(0, viewport.innerHeight - (viewport.offsetTop + viewport.height));
}

/**
 * How far the root of the edited field moves up so the field's bottom plus a margin clears the
 * keyboard.
 *
 * @param input - The field's drawn bottom, the margin, the window height and the inset, in CSS px.
 * @param input.fieldBottom - The bottom of the field, through `toScreen`, before any lift.
 * @param input.margin - How far above the keyboard the field ends.
 * @param input.innerHeight - The window height.
 * @param input.inset - The height the keyboard covers.
 * @returns The lift in CSS px, 0 when the field already clears it.
 * @example
 * ```ts
 * liftOf({ fieldBottom: 540, margin: 16, innerHeight: 714, inset: 310 }); // 152
 * ```
 */
export function liftOf(input: {
  fieldBottom: number;
  margin: number;
  innerHeight: number;
  inset: number;
}): number {
  return Math.max(0, input.fieldBottom + input.margin - (input.innerHeight - input.inset));
}
