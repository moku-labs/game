/**
 * @file ui/layout — the measure function of a text that sizes itself. Yoga calls it once per
 * invalidation; the answer comes from the advance table of `text`, never from a canvas. A text
 * with `bind` is sized by the string `text` shows for it, and its node is marked dirty when a new
 * shown string measures to another size.
 */
import type { MeasureFunction, Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Message } from "../../i18n/types";
import { formatBound, isTextFormat } from "../../text/format";
import type { Size, TextBind } from "../../text/types";
import type { AnyComponentValue } from "../../world/types";
import type { Element } from "../jsx/types";
import type { LayoutState, TextSource } from "./types";

/** What a text is drawn in when its `style` prop is a layout style instead of a style key. */
const DEFAULT_TEXT_STYLE = "body";

/** The glyph an icon is sized from: one line of the text style it sits in. */
const LINE_SAMPLE = "M";

/**
 * Makes an icon square on the line height of the text next to it.
 *
 * @param line - What one line of that text style measures.
 * @param line.height - The line height.
 * @returns The square the icon takes.
 * @example
 * ```ts
 * squareOf({ height: 24 }); // { width: 24, height: 24 }
 * ```
 */
function squareOf(line: { height: number }): { width: number; height: number } {
  return { width: line.height, height: line.height };
}

/**
 * Tells whether an element needs a measure function: a `text` or an `icon` whose width or height
 * is not fixed. An icon follows the line height of the text style next to it.
 *
 * @param element - The element to ask about.
 * @returns True when Yoga has to ask how big its content is.
 */
export function needsMeasure(element: Element): boolean {
  if (element.type !== "text" && element.type !== "icon") return false;

  return typeof element.style.width !== "number" || typeof element.style.height !== "number";
}

/**
 * Reads what a text draws out of its props.
 *
 * @param element - The text element.
 * @returns The content and the style key `text.measure` takes.
 */
export function contentOf(element: Element): {
  content: string | Message;
  style: string;
} {
  const { content, style } = element.node.props;
  const styleKey = typeof style === "string" ? style : DEFAULT_TEXT_STYLE;

  if (typeof content === "string") return { content, style: styleKey };
  if (typeof content === "object" && content !== null && "key" in content) {
    return { content: content as Message, style: styleKey };
  }

  return { content: "", style: styleKey };
}

/**
 * The bind of a text, when the markup gave it one.
 *
 * @param element - The element to ask about.
 * @returns What `bind()` built, or `undefined` for any other element.
 */
function bindOf(element: Element): TextBind | undefined {
  const { bind } = element.node.props;
  const isBound = element.type === "text" && typeof bind === "object" && bind !== null;

  return isBound ? (bind as TextBind) : undefined;
}

/**
 * The bound number as the `components` prop of a text lists it. Of two values of the bound
 * component the last wins, as it does for the element.
 *
 * @param element - The bound text.
 * @param bind - Its bind.
 * @returns The number, or `undefined` when no listed value carries one in the bound field.
 */
function listedValueOf(element: Element, bind: TextBind): number | undefined {
  const listed: unknown = element.node.props.components;

  if (!Array.isArray(listed)) return undefined;

  const value = (listed as readonly AnyComponentValue[]).findLast(
    entry => entry.type.componentName === bind.component
  )?.value;
  const field: unknown =
    value === undefined || value === true ? undefined : Reflect.get(value, bind.field);

  return typeof field === "number" ? field : undefined;
}

/**
 * The string a bound text shows: `Text.resolved` once the entity carries its `Text`. Before that,
 * for the first solve, the bound field of its `components` value in the format of the bind, so
 * `text` resolves what was measured. A `Countdown` shows the `left` it lists, 0, until `text`
 * derives it.
 *
 * @param element - The text element.
 * @param source - Where `Text.resolved` and the duration words are read.
 * @returns The string, or `undefined` for a text with no bind.
 */
export function shownOf(element: Element, source: TextSource): string | undefined {
  const bind = bindOf(element);

  if (bind === undefined) return undefined;

  const resolved = source.resolved(element.entity);

  if (resolved !== undefined) return resolved;

  const value = listedValueOf(element, bind);
  const format = isTextFormat(bind.format) ? bind.format : "int";

  return value === undefined ? "" : formatBound(value, format, ms => source.duration(ms));
}

/**
 * The size a text or an icon takes before Yoga clamps it: an icon is square on one line of its
 * text style, a bound text measures the string it shows, any other text its content.
 *
 * @param element - The text or icon element.
 * @param source - What it is measured through.
 * @returns The width and the height.
 */
function naturalSize(element: Element, source: TextSource): Size {
  const { content, style } = contentOf(element);

  if (element.type === "icon") return squareOf(source.measure(LINE_SAMPLE, style));

  return source.measure(shownOf(element, source) ?? content, style);
}

/**
 * Clamps one axis of a measured size to what Yoga offered on that axis.
 *
 * @param yoga - The loaded Yoga module, for the three measure modes.
 * @param measured - What the advance table answered on this axis.
 * @param offered - What Yoga offered on this axis.
 * @param mode - How to read the offer.
 * @returns The length the node takes on this axis.
 */
function alongAxis(yoga: Yoga, measured: number, offered: number, mode: number): number {
  if (mode === yoga.MEASURE_MODE_EXACTLY) return offered;
  if (mode === yoga.MEASURE_MODE_AT_MOST) return Math.min(measured, offered);

  return measured;
}

/**
 * Clamps a measured size to what Yoga asked for: an exact mode wins, an at-most mode caps.
 *
 * @param yoga - The loaded Yoga module, for the three measure modes.
 * @param measured - What `text.measure` answered.
 * @param measured.width - The measured width.
 * @param measured.height - The measured height.
 * @param asked - The size and mode Yoga passed.
 * @param asked.width - The width Yoga offered.
 * @param asked.widthMode - How to read that width.
 * @param asked.height - The height Yoga offered.
 * @param asked.heightMode - How to read that height.
 * @returns The size the node takes.
 */
export function clampToMode(
  yoga: Yoga,
  measured: { width: number; height: number },
  asked: { width: number; widthMode: number; height: number; heightMode: number }
): { width: number; height: number } {
  return {
    width: alongAxis(yoga, measured.width, asked.width, asked.widthMode),
    height: alongAxis(yoga, measured.height, asked.height, asked.heightMode)
  };
}

/**
 * Installs the measure function of a text element, or drops it when the text is fixed. The
 * function keeps the size it answered on the element, for `remeasureShown`.
 *
 * @param state - The layout state, for the Yoga module and the `measured` counter.
 * @param node - The node of the element.
 * @param element - The text element.
 * @param source - What the text is measured through.
 */
export function installMeasure(
  state: LayoutState,
  node: YogaNode,
  element: Element,
  source: TextSource
): void {
  const yoga = state.yoga;

  if (yoga === undefined) return;

  if (!needsMeasure(element)) {
    // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
    node.setMeasureFunc(null);

    return;
  }

  const measureFunction: MeasureFunction = (width, widthMode, height, heightMode) => {
    const size = naturalSize(element, source);

    state.measured += 1;
    element.measuredSize = size;

    return clampToMode(yoga, size, { width, widthMode, height, heightMode });
  };

  node.setMeasureFunc(measureFunction);
}

/**
 * Marks a measured node dirty, which is allowed only on a node that has a measure function.
 *
 * @param state - The layout state.
 * @param element - The text element whose content changed.
 */
export function markMeasured(state: LayoutState, element: Element): void {
  if (!needsMeasure(element)) return;

  state.byEntity.get(element.entity)?.markDirty();
}

/**
 * Marks the node of a bound text dirty when the string `text` shows for it now measures to another
 * size than the node was laid out with. `text` writes `resolved` only when the shown string
 * changes, and a counter that rolls through digits of one width asks for no solve.
 *
 * @param state - The layout state, for the node of the element.
 * @param element - An element whose `Text` changed this frame.
 * @param source - What the text is measured through.
 * @returns True when the node was marked, so its root has to solve again.
 */
export function remeasureShown(state: LayoutState, element: Element, source: TextSource): boolean {
  const node = state.byEntity.get(element.entity);
  const before = element.measuredSize;

  if (node === undefined || before === undefined) return false;
  if (bindOf(element) === undefined || !needsMeasure(element)) return false;

  const size = naturalSize(element, source);

  if (size.width === before.width && size.height === before.height) return false;

  node.markDirty();

  return true;
}
