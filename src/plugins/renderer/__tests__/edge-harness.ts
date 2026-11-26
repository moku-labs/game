/**
 * @file renderer plugin — the flow edges of the monitor tests. Not a test file. The ring of `flow.edgeTimes()` as the
 * flow's runner makes it, and a writer that takes one edge into it the way the runner's `recordEdge` does: the strings
 * by reference, the times into the ring's arrays, then `written` moves on. Writes nothing else, allocates nothing.
 */
import { createEdgeTiming } from "../../flow/runner/timing";
import type { EdgeTimingState } from "../../flow/runner/types";

/** The page-clock times of one edge; a time left out is NaN, as the runner writes "not measured". */
export type EdgeTimes = {
  at?: number;
  ms: number;
  commitMs?: number;
  hooksMs?: number;
  bodyMs?: number;
  wallMs?: number;
};

/**
 * Creates the flow's ring of timed edges, empty.
 *
 * @returns The ring, nothing written.
 */
export function edgeRing(): EdgeTimingState {
  return createEdgeTiming(() => 0);
}

/**
 * Takes one edge into the ring.
 *
 * @param ring - The ring.
 * @param node - Path of the node that took the edge.
 * @param outcome - The outcome.
 * @param next - Path the edge leads to.
 * @param times - Its times; reuse one object where a window counts bytes.
 */
export function pushEdge(
  ring: EdgeTimingState,
  node: string,
  outcome: string,
  next: string,
  times: Readonly<EdgeTimes>
): void {
  const slot = ring.written % ring.capacity;

  ring.node[slot] = node;
  ring.outcome[slot] = outcome;
  ring.next[slot] = next;
  ring.at[slot] = times.at ?? Number.NaN;
  ring.ms[slot] = times.ms;
  ring.commitMs[slot] = times.commitMs ?? Number.NaN;
  ring.hooksMs[slot] = times.hooksMs ?? Number.NaN;
  ring.bodyMs[slot] = times.bodyMs ?? Number.NaN;
  ring.wallMs[slot] = times.wallMs ?? Number.NaN;
  ring.written += 1;
}
