/**
 * @file anim plugin — the dense lists of running tracks and timelines. The frame step walks them by
 * index and drops what ended in place, so a frame builds no snapshot array.
 */

/**
 * Drops every ended item of a dense list in place and keeps the order of the rest. Allocates
 * nothing: a list with nothing ended is only read.
 *
 * @param list - The tracks or the timelines, in start order.
 * @example
 * ```ts
 * const list = [{ ended: false }, { ended: true }, { ended: false }];
 * dropEnded(list); // list.length === 2
 * ```
 */
export function dropEnded<Item extends { readonly ended: boolean }>(list: Item[]): void {
  let kept = 0;

  for (let index = 0; index < list.length; index++) {
    const item = list[index];

    if (item === undefined || item.ended) continue;

    list[kept] = item;
    kept++;
  }

  // `pop` and not `length = kept`: a list cut to nothing would let its storage go, and the next
  // start would allocate it again.
  while (list.length > kept) list.pop();
}
