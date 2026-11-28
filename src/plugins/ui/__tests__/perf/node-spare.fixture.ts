/**
 * @file ui plugin — the perf fixture of the spare Yoga nodes (change 2026-11-27-hp-2ab-style-layout): a parent with
 * fifty placed children, as a window holds its rows, and one more child that enters and leaves, its node taken from
 * the spare and put back, or made new each time as before the spare.
 */
import type { Element } from "../../jsx/types";
import { applyStyleToNode } from "../../layout/apply";
import { appendChildren, createNode, detachNode, freeNode, freeSpare } from "../../layout/nodes";
import { createLayoutState } from "../../layout/state";
import { loadYogaModule } from "../../layout/yoga";
import type { ResolvedStyle } from "../../styles/types";

/** The rows the parent keeps while the one child comes and goes. */
const ROWS = 50;

/** A style that sets a width and a min height, which a node taken back sets back to a fresh node's. */
const SIZED: ResolvedStyle = Object.freeze({ width: 120, minHeight: 40 });

/** One element's enter and exit, three ways. */
export type SpareFixture = {
  /** The node taken from the spare, placed, and put back: what `ui` does now. */
  reused: () => void;
  /** The same, the node written with a width and a min height while it stands, so its take-back sets them back. */
  reusedSized: () => void;
  /** A node made new and freed each time: what `ui` did before the spare. */
  fresh: () => void;
  /**
   * The control: the same placement, removal and map writes on a node that stays, so no node is made, taken back or
   * put aside. What `reused` allocates over it is the spare's own.
   */
  control: () => void;
};

/**
 * Starts a layout state with Yoga loaded, the parent and its rows placed, and the child's node made once and put
 * aside.
 *
 * @returns The three cycles.
 */
export async function startSpareFixture(): Promise<SpareFixture> {
  const state = createLayoutState();
  const yoga = await loadYogaModule();
  const parent = { entity: 1, type: "column" } as Element;
  const rows = Array.from(
    { length: ROWS },
    (_, index) => ({ entity: 2 + index, type: "row" }) as Element
  );
  const child = [{ entity: 1000, type: "row" } as Element];
  const one = child[0] as Element;

  state.yoga = yoga;
  createNode(state, parent);
  for (const row of rows) createNode(state, row);
  appendChildren(state, parent, rows);
  createNode(state, one);
  freeNode(state, one);

  /** The child enters, is placed after the rows, and leaves. */
  const cycle = (): void => {
    createNode(state, one);
    appendChildren(state, parent, child);
    freeNode(state, one);
  };

  return {
    reused: cycle,
    reusedSized: () => {
      const node = createNode(state, one);

      if (node !== undefined) {
        applyStyleToNode(yoga, node, SIZED, "row", "column", state.kept.get(node), state.tables);
      }
      appendChildren(state, parent, child);
      freeNode(state, one);
    },
    fresh: () => {
      freeSpare(state);
      cycle();
    },
    control: () => {
      const node = createNode(state, one);

      if (node === undefined) return;

      const kept = state.kept.get(node);

      appendChildren(state, parent, child);
      detachNode(state, one);
      state.placed.delete(node);
      state.parents.delete(node);
      state.kept.delete(node);
      state.byEntity.delete(one.entity);
      state.nodes -= 1;
      // Back where `createNode` finds it, as the spare would hand it.
      state.byEntity.set(one.entity, node);
      if (kept !== undefined) state.kept.set(node, kept);
      state.nodes += 1;
    }
  };
}
