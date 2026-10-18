/**
 * @file renderer/kept — readers of the kept state, for the modules built before `kept` (O18): `demand` asks whether
 * a node is drawn through its quad and with what padding, and notes a change under a kept picture at mark time,
 * without the module.
 */
import type { FilterSlot } from "../sync/types";
import type { PixiContainer } from "../types";
import type { KeptState } from "./types";

/** What `drawnThrough` answers for a node no quad draws. */
export const NOT_THROUGH = -1;

/**
 * The paddings of every filter of a slot list, enabled or not: a superset of what any of them could spill.
 *
 * @param slots - The slots.
 * @returns The sum; 0 without a slot.
 */
export function slotsPadding(slots: readonly FilterSlot[]): number {
  let pad = 0;

  // per walk through a kept top: a frozen list, walked by index (`for…of` allocates over a frozen array).
  for (let index = 0; index < slots.length; index += 1) pad += slots[index]?.filter.padding ?? 0;

  return pad;
}

/**
 * Whether a node is a kept top drawn through its quad: hidden for the stage pass, its picture shown beside it, and the
 * padding its filters hang with on the stand-in.
 *
 * @param state - The kept state.
 * @param node - A display object on the chain of a view.
 * @returns The padding of its filters, or `NOT_THROUGH`.
 */
export function drawnThrough(state: KeptState, node: PixiContainer): number {
  const record = state.byTop.get(node);

  if (record?.mode !== "kept" || record.quad?.visible !== true) return NOT_THROUGH;

  return slotsPadding(record.slots);
}

/**
 * Notes a change under a node for every picture above it: each record whose top is an ancestor owes a retake. Called
 * by `demand` at the first mark of an entity in a decision, before the write, so a view that leaves a kept subtree
 * (a reparent, a release) retakes the picture it leaves; the collect of the frame walks the tree as it is after the
 * writes (P10.3).
 *
 * @param state - The kept state.
 * @param node - The top of the view about to change.
 */
export function changeBelow(state: KeptState, node: PixiContainer): void {
  if (state.byTop.size === 0) return;

  for (let at = node.parent; at !== null; at = at.parent) {
    const record = state.byTop.get(at);

    if (record !== undefined) record.dirtyS1 = true;
  }
}
