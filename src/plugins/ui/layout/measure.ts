/**
 * @file ui/layout — the measure function of a text that sizes itself. Yoga calls it once per
 * invalidation; the answer comes from the advance table of `text`, never from a canvas.
 */
import type { MeasureFunction, Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Message } from "../../i18n/types";
import type { Element } from "../jsx/types";
import type { LayoutState } from "./types";

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
 * Installs the measure function of a text element, or drops it when the text is fixed.
 *
 * @param state - The layout state, for the Yoga module and the `measured` counter.
 * @param node - The node of the element.
 * @param element - The text element.
 * @param measure - What `text.measure` is reached through.
 */
export function installMeasure(
  state: LayoutState,
  node: YogaNode,
  element: Element,
  measure: (content: string | Message, style: string) => { width: number; height: number }
): void {
  const yoga = state.yoga;

  if (yoga === undefined) return;

  if (!needsMeasure(element)) {
    // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
    node.setMeasureFunc(null);

    return;
  }

  const measureFunction: MeasureFunction = (width, widthMode, height, heightMode) => {
    const { content, style } = contentOf(element);

    state.measured += 1;

    const size =
      element.type === "icon" ? squareOf(measure(LINE_SAMPLE, style)) : measure(content, style);

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
