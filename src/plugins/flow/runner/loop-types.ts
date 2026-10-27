/**
 * @file flow/runner — shared types and constants of the loop.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Json, Transaction } from "../../model/types";
import type { WorldEvent } from "../inbox/types";
import type { AnyFlow, AnyNode, FlowEntry, Frame, Result, Stage } from "./types";

/** The stages of entering a node, in the order they run: what reacts at once, the loads, the scene. */
export const stages: readonly Stage[] = ["begin", "load", "scene"];

/** How deep the graph may nest or exit before the runner calls it a mistake. */
export const maxDepth = 32;

/**
 * The JSON value of a node or edge that carries no payload.
 */
// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
export const noPayload: Json = null;

/** Where one frame points: the flow, the name inside it and the entry itself. */
export type Location = { flow: AnyFlow; name: string; entry: FlowEntry };

/** Why the runner aborted the active node. */
export type AbortReason = "stop" | "inbox" | "restore";

/** What one node run produced. Nothing here throws: the loop reads the variant. */
export type NodeOutcome =
  | { kind: "result"; result: Result }
  | { kind: "event"; event: WorldEvent }
  | { kind: "aborted"; reason: AbortReason }
  | { kind: "failed"; error: unknown };

/** A run the runner aborted: the variant a node run and a recovery share. */
export type Aborted = Extract<NodeOutcome, { kind: "aborted" }>;

/**
 * What one recovery produced: `recover` returned, the runner aborted it, or it failed. Nothing
 * here throws: the loop reads the variant.
 */
export type RecoveryOutcome =
  | { kind: "recovered" }
  | Aborted
  | Extract<NodeOutcome, { kind: "failed" }>;

/** What one turn of the loop decided: keep running, or end because `onStop` aborted. */
export type StepOutcome = "continue" | "stop";

/**
 * A place the loop can arrive at: the frames, the path, and whether the node there rests. `after`
 * is set when the place is a slot the loop comes back to: the contribution it just finished.
 */
export type Arrival = {
  stack: Frame[];
  next: string;
  rest: boolean;
  checkpoint: boolean;
  after?: string;
  /** Set when a contribution exited an outcome its slot declares: the slot leaves on it. */
  leave?: { outcome: string; payload: Json };
};

/** Where the loop goes after one result, or the problem that stops it going anywhere. */
export type Plan = Arrival | { problem: string };

/** One node run in progress. */
export type Step = {
  location: Location;
  node: AnyNode;
  transaction: Transaction;
  abort: AbortController;
  signal: AbortSignal;
  now: number;
  path: string;
  input: Json;
  gateOpened: () => void;
  /** The engine log: an effect the body started with `fx.start` that fails is written there. */
  log: Log.LogApi;
};

/** One result ready to be committed onto its edge. */
export type Commit = {
  location: Location;
  transaction: Transaction;
  result: Result;
  barrier: boolean;
  now: number;
  path: string;
};

/**
 * How the loop stands after it gave up on a transition. `inside`: it is in the safe node, and a
 * failure there is fatal; it stays true until the safe node's own edge commits. `recover`: the
 * safe node has not been entered yet, so its `recover` is still to run. A restore clears both:
 * the bookmark is a new position, and a failure of its node is retried.
 */
export type Safe = { inside: boolean; recover: boolean };

/**
 * Does nothing. It stands in for an unsubscribe function until the real one arrives.
 *
 * @example
 * ```ts
 * const watch = { off: noop };
 * ```
 */
export function noop(): void {
  // Nothing to undo yet.
}

/** The event delivered by the inbox to the node that is running. */
export type Delivery = { event: WorldEvent | undefined };
