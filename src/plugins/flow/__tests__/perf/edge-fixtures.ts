/**
 * @file flow plugin — the fixtures of the edge timer's perf test and bench (hot-path item 8). Not a test file. One
 * `commitEdge` of A Memory Missing's merge drag, `mergeBoard/drop --merged--> mergeBoard/awaitIntent`, with the
 * commit, the hooks and the fx gateway as no-ops, so what is left is the edge's own work.
 */
import type { Json } from "../../../model/types";
import { commitEdge } from "../../runner/edge";
import type { Commit } from "../../runner/loop-types";
import { createRunnerState } from "../../runner/state";
import { createEdgeTiming } from "../../runner/timing";
import type { Modules } from "../../runner/types";
import type { FlowCtx } from "../../types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/** Does nothing: the commit's listeners, the wake and the release of hints. */
const noop = (): void => undefined;

/** The commit a transaction answers: nothing patched. */
const committed = { patches: [] };

/** The page clock of the timed edge: a cell, so the stub itself keeps no number. */
const page = new Float64Array(1);

/**
 * A page clock that moves 0.25 ms a read.
 *
 * @returns The page clock, ms.
 */
const stubClock = (): number => {
  page[0] = (page[0] ?? 0) + 0.25;

  return page[0];
};

/** Which page clock times the edge: none, the stub, or `performance.now()` as on a page. */
export type EdgeClock = "untimed" | "stub" | "performance";

/**
 * Builds one edge, ready to be taken again and again: the context, the modules and the result of the drop.
 *
 * @param clock - Which page clock times it.
 * @returns The call that takes the edge once.
 */
export function edgeCall(clock: EdgeClock): () => void {
  const runner = createRunnerState();

  if (clock !== "untimed") {
    runner.timing = createEdgeTiming(clock === "stub" ? stubClock : () => performance.now());
  }

  const ctx = {
    config: { journalLimit: 1 },
    state: { runner },
    deps: { time: { wake: noop } },
    emit: noop
  } as unknown as FlowCtx;
  const modules = { fx: { release: noop } } as unknown as Modules;
  const step = {
    location: { flow: { id: "mergeBoard" }, name: "drop" },
    transaction: { commit: () => committed },
    result: { outcome: "merged", payload: noPayload },
    barrier: false,
    now: 1000,
    path: "mergeBoard/drop"
  } as unknown as Commit;

  return () => void commitEdge(ctx, modules, step, "mergeBoard/awaitIntent");
}
