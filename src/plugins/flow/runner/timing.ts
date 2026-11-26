/**
 * @file flow/runner — the edge timer of an agent build: a ring of the last 256 edges with the page-clock time of each
 * part. Imported only from code inside the inline guard `__MOKU_GAME_AGENT__`, so a release bundle drops this file.
 * Nothing here allocates per edge: a clock read stays in a local or goes straight into a `Float64Array`, and the
 * strings are stored by reference.
 */
import type { EdgeTimingState } from "./types";

/** Edges the ring keeps. */
const CAPACITY = 256;

/**
 * Creates the empty ring, with no node in progress.
 *
 * @param clock - The page clock of `time.agentClock()`.
 * @returns The ring, nothing written.
 */
export function createEdgeTiming(clock: () => number): EdgeTimingState {
  return {
    capacity: CAPACITY,
    written: 0,
    node: Array.from({ length: CAPACITY }, () => ""),
    outcome: Array.from({ length: CAPACITY }, () => ""),
    next: Array.from({ length: CAPACITY }, () => ""),
    at: new Float64Array(CAPACITY),
    ms: new Float64Array(CAPACITY),
    commitMs: new Float64Array(CAPACITY),
    hooksMs: new Float64Array(CAPACITY),
    bodyMs: new Float64Array(CAPACITY),
    wallMs: new Float64Array(CAPACITY),
    clock,
    scratch: Float64Array.of(Number.NaN, Number.NaN),
    stage: new Float64Array(3)
  };
}

/**
 * Notes the entry of a node: its stay counts from now, and no body ran yet.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 */
export function enterNode(timing: EdgeTimingState | undefined): void {
  if (timing === undefined) return;

  timing.scratch[0] = timing.clock();
  timing.scratch[1] = Number.NaN;
}

/**
 * Notes the start of a node body. The start waits in the body's own cell until `endBody`.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 */
export function startBody(timing: EdgeTimingState | undefined): void {
  if (timing === undefined) return;

  timing.scratch[1] = timing.clock();
}

/**
 * Notes the end of a body's first synchronous slice: the body's cell becomes its time.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 */
export function endBody(timing: EdgeTimingState | undefined): void {
  if (timing === undefined) return;

  timing.scratch[1] = timing.clock() - (timing.scratch[1] ?? Number.NaN);
}

/**
 * Drops the body of the node in progress: its edge is not the body's (an inbox event ended the node).
 *
 * @param timing - The ring, `undefined` without the agent clock.
 */
export function dropBody(timing: EdgeTimingState | undefined): void {
  if (timing === undefined) return;

  timing.scratch[1] = Number.NaN;
}

/**
 * Forgets the node in progress: the next edge belongs to no node entry (a recovery, a slot, a substituted sub-flow),
 * and a node that failed or was aborted before it left its numbers behind.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 */
export function clearNode(timing: EdgeTimingState | undefined): void {
  if (timing === undefined) return;

  timing.scratch.fill(Number.NaN);
}

/**
 * Stamps one moment of the edge in progress: `0` before the commit, `1` after it, `2` before the `flow:edge` emit.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 * @param moment - Which moment.
 */
export function stampEdge(timing: EdgeTimingState | undefined, moment: 0 | 1 | 2): void {
  if (timing === undefined) return;

  timing.stage[moment] = timing.clock();
}

/**
 * Writes the edge that just ended into its slot, after the `flow:edge` emit: the strings by reference, the times from
 * the stamps, the body and the stay of the node in progress. Then no node is in progress.
 *
 * @param timing - The ring, `undefined` without the agent clock.
 * @param node - Path of the node that took the edge.
 * @param outcome - The outcome.
 * @param next - Path the edge leads to.
 */
export function recordEdge(
  timing: EdgeTimingState | undefined,
  node: string,
  outcome: string,
  next: string
): void {
  if (timing === undefined) return;

  const end = timing.clock();
  const start = timing.stage[0] ?? Number.NaN;
  const slot = timing.written % timing.capacity;

  timing.node[slot] = node;
  timing.outcome[slot] = outcome;
  timing.next[slot] = next;
  timing.at[slot] = start;
  timing.ms[slot] = end - start;
  timing.commitMs[slot] = (timing.stage[1] ?? Number.NaN) - start;
  timing.hooksMs[slot] = end - (timing.stage[2] ?? Number.NaN);
  timing.bodyMs[slot] = timing.scratch[1] ?? Number.NaN;
  timing.wallMs[slot] = start - (timing.scratch[0] ?? Number.NaN);
  timing.written += 1;
  timing.scratch.fill(Number.NaN);
}
