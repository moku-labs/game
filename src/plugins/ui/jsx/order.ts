/**
 * @file ui — the draw order of a child element among its siblings: a composite `Order` below its `zIndex` step.
 */

/**
 * How many element siblings one `zIndex` step holds before their order spills into the next step.
 */
export const SIBLING_SPAN = 4096;

/**
 * The `Order` of a child element: its `zIndex` (0 without one), minus a half, plus its place among its siblings in
 * steps of 1 / (2 × SIBLING_SPAN). Every value lies strictly between `zIndex − 0.5` and `zIndex` while the parent has
 * fewer than SIBLING_SPAN children: above the parent's own visual (depth −0.5, U1.8), under a hosted view or another
 * non-element child at the same integer `Order`, under a sibling with a higher `zIndex`.
 *
 * @param zIndex - The element's `zIndex`, if any.
 * @param index - Its place among the element children of its parent.
 * @returns The composite order.
 * @example
 * ```ts
 * childOrder(undefined, 0); // -0.4998779296875
 * childOrder(1, 2); // 0.5003662109375
 * ```
 */
export function childOrder(zIndex: number | undefined, index: number): number {
  return (zIndex ?? 0) - 0.5 + (index + 1) / (2 * SIBLING_SPAN);
}
