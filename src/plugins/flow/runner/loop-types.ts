/**
 * @file flow/runner — shared types and constants of the loop.
 */
import type { Json, Transaction } from "../../model/types";
import type { WorldEvent } from "../inbox/types";
import type { AnyFlow, AnyNode, FlowEntry, Frame, Result, Stage } from "./types";

/** The stages of entering a node, in the order they run. */
export const stages: readonly Stage[] = ["load", "scene"];

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

/** What one turn of the loop decided: keep running, or end because `onStop` aborted. */
export type StepOutcome = "continue" | "stop";

/** A place the loop can arrive at: the frames, the path, and whether the node there rests. */
export type Arrival = { stack: Frame[]; next: string; rest: boolean; checkpoint: boolean };

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

/** Whether the loop is already recovering inside the safe node. A failure there is fatal. */
export type Safe = { inside: boolean };

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
