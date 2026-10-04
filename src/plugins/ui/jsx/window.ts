/**
 * @file ui/jsx — the windowed scroll: its props read and checked, the node a row callback answers
 * made into one keyed slot, and the spacers that stand for the rows that do not exist. Pure: the
 * range step in `range.ts` logs what these functions report.
 */
import type { ResolvedStyle } from "../styles/types";
import { flatten } from "./flatten";
import type { DescriptionNode, JsxChild } from "./types";

/** The overscan of a windowed scroll that names none: P18's margin of five rows. */
const DEFAULT_OVERSCAN = 5;

/** The start of every key `ui` gives a node of its own: a character no markup writes. */
const OWN_KEY = "\u0000";

/** The key of the spacer that stands for the rows above the window. */
export const TOP_SPACER = `${OWN_KEY}top`;

/** The key of the spacer that stands for the rows below the window. */
export const BOTTOM_SPACER = `${OWN_KEY}bottom`;

/** What the props of a windowed scroll say, checked: the numbers `ui` cuts the range with. */
export type WindowForm = {
  rows: number;
  rowHeight: number;
  overscan: number;
  row: (index: number) => JsxChild;
  /** `rows` was not a whole number of 0 or more, and was rounded down. */
  rounded: boolean;
};

/**
 * Tells a key `ui` gave a node of its own from one the markup wrote: such a node is never
 * registered as a key and never listed by `tree()`.
 *
 * @param key - The key of a node.
 * @returns True for a spacer or the empty slot of a broken row.
 * @example
 * ```ts
 * isOwnKey(TOP_SPACER); // true
 * ```
 */
export function isOwnKey(key: string | undefined): boolean {
  return key?.startsWith(OWN_KEY) === true;
}

/**
 * Reads the overscan: 5 when left out, 0 for a negative one, rounded down.
 *
 * @param overscan - What the markup wrote.
 * @returns The rows kept beyond each edge.
 * @example
 * ```ts
 * overscanOf(-2); // 0
 * ```
 */
function overscanOf(overscan: unknown): number {
  if (typeof overscan !== "number" || !Number.isFinite(overscan)) return DEFAULT_OVERSCAN;

  return Math.max(0, Math.floor(overscan));
}

/**
 * Tells a row height `ui` can cut a range with: a finite number above 0.
 *
 * @param value - The `rowHeight` prop.
 * @returns True for a finite number above 0.
 * @example
 * ```ts
 * isUsableRowHeight(0); // false
 * ```
 */
function isUsableRowHeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Reads the `rows` prop as a whole number: rounded down, and 0 for a negative one or for anything
 * that is not a finite number.
 *
 * @param rows - The `rows` prop.
 * @returns The whole number of rows.
 * @example
 * ```ts
 * wholeRowsOf(10.7); // 10
 * ```
 */
function wholeRowsOf(rows: unknown): number {
  return typeof rows === "number" && Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
}

/**
 * Reads the windowed form of a scroll: `rows`, `rowHeight` and `row` together. A scroll with none
 * of the three is the child form.
 *
 * @param node - The node of a scroll.
 * @returns The props, or `undefined` for the child form.
 * @throws {Error} When some but not all of the three are given, or `rowHeight` is not above 0.
 * @example
 * ```ts
 * windowFormOf({ type: "scroll", props: { rows: 10.7, rowHeight: 80, row: () => [] }, children: [] })?.rows; // 10
 * ```
 */
export function windowFormOf(node: DescriptionNode): WindowForm | undefined {
  const { rows, rowHeight, overscan, row } = node.props;

  // All three props or none: none is the child form, some of them is a mistake.
  const given = [rows !== undefined, rowHeight !== undefined, typeof row === "function"].filter(
    Boolean
  ).length;

  if (given === 0) return undefined;

  if (given < 3) {
    throw new Error(
      "[game] A windowed scroll needs rows, rowHeight and row.\n" +
        "  Write <scroll rows={n} rowHeight={80} row={index => <Row key={ids[index]} />} />."
    );
  }

  // The range is cut in rows of this height, so it must be a finite number above 0.
  if (!isUsableRowHeight(rowHeight)) {
    throw new Error(
      "[game] Scroll rowHeight must be above 0.\n  Give the row height in reference units."
    );
  }

  // The row count is rounded down to a whole number; a rounded count is reported, not refused.
  const whole = wholeRowsOf(rows);

  return {
    rows: whole,
    rowHeight,
    overscan: overscanOf(overscan),
    row: row as (index: number) => JsxChild,
    rounded: whole !== rows
  };
}

/**
 * Refuses the props of a scroll its windowed form cannot take: some but not all of `rows`,
 * `rowHeight` and `row`, or a row height that is not above 0. Called before anything is spawned or
 * patched, so a refused scroll leaves no half-made element.
 *
 * @param node - The node being placed.
 * @throws {Error} For a windowed scroll whose props do not hold.
 * @example
 * ```ts
 * checkWindow({ type: "scroll", props: { rows: 3 }, children: [] }); // throws "[game] A windowed scroll needs rows, rowHeight and row."
 * ```
 */
export function checkWindow(node: DescriptionNode): void {
  if (node.type === "scroll") windowFormOf(node);
}

/**
 * Builds a spacer: an empty node of a fixed height that never shrinks.
 *
 * @param key - Its own key.
 * @param height - Its height in reference units.
 * @returns The node.
 * @example
 * ```ts
 * spacerNode(TOP_SPACER, 3240).props; // { style: { height: 3240, shrink: 0 } }
 * ```
 */
export function spacerNode(key: string, height: number): DescriptionNode {
  return { type: "spacer", key, props: { style: { height, shrink: 0 } }, children: [] };
}

/**
 * Makes what a row callback answered into the slot of its index: exactly one node, keyed by its
 * index when it has no key of its own.
 *
 * @param produced - What `row(index)` answered.
 * @param index - The index of the row.
 * @returns The node of the slot, or `undefined` when the callback answered none or several.
 * @example
 * ```ts
 * slotOf({ type: "row", props: {}, children: [] }, 7)?.key; // "7"
 * ```
 */
export function slotOf(produced: JsxChild, index: number): DescriptionNode | undefined {
  const nodes = flatten(produced);
  const single = nodes.length === 1 ? nodes[0] : undefined;

  if (single === undefined) return undefined;

  return single.key === undefined ? { ...single, key: String(index) } : single;
}

/**
 * The empty slot that stands for a row whose callback answered none or several nodes.
 *
 * @param index - The index of the row.
 * @param rowHeight - The height of every row.
 * @returns A spacer of the row height.
 * @example
 * ```ts
 * emptySlot(3, 120).props; // { style: { height: 120, shrink: 0 } }
 * ```
 */
export function emptySlot(index: number, rowHeight: number): DescriptionNode {
  return spacerNode(`${OWN_KEY}${index}`, rowHeight);
}

/**
 * The style a row is laid out with: its own, with the row height written over it, so the
 * arithmetic of the range and the layout agree.
 *
 * @param style - The resolved style of the row.
 * @param rowHeight - The height of every row.
 * @returns The style with `height` and `shrink` set.
 * @example
 * ```ts
 * rowStyleOf({ height: 200, gap: 8 }, 120); // { height: 120, gap: 8, shrink: 0 }
 * ```
 */
export function rowStyleOf(style: ResolvedStyle, rowHeight: number): ResolvedStyle {
  return { ...style, height: rowHeight, shrink: 0 };
}
