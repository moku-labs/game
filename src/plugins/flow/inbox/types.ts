/**
 * @file flow/inbox — type definitions.
 */
import type { Json } from "../../model/types";

/**
 * One event of the world: time that passed, a push message, a purchase that arrived.
 *
 * @example
 * ```ts
 * const event: WorldEvent = { type: "elapsed", payload: { now: 1000 } };
 * ```
 */
export type WorldEvent = { type: string; payload?: Json };

/**
 * inbox module state.
 */
export type InboxState = {
  /** Undelivered events, oldest first. One entry per `type`. */
  queue: WorldEvent[];
  /** Callbacks woken by every `post`. Kept in state so every API instance over this state shares them. */
  listeners: Array<() => void>;
};

/**
 * inbox module API, `app.flow.inbox`: world events wait here until a rest node that lists their
 * type is active.
 *
 * @example
 * ```ts
 * // The shop SDK confirms a purchase at any moment. The graph takes it at the next rest node
 * // that declares `inbox: ["purchased"]`, as the outcome "purchased" of that node.
 * app.flow.inbox.post({ type: "purchased", payload: { sku: "coins100" } });
 * ```
 */
export type InboxApi = {
  /**
   * Queues one world event. It is delivered only when the active node is a rest node whose
   * `inbox` lists the type; until then it waits. Duplicates of one type collapse to the latest.
   *
   * @param event - Type and optional payload.
   * @example
   * ```ts
   * // Two push messages arrive while a transit node runs. The next rest node gets one event.
   * app.flow.inbox.post({ type: "gift", payload: { coins: 50 } });
   * app.flow.inbox.post({ type: "gift", payload: { coins: 75 } }); // delivered: { coins: 75 }
   * ```
   */
  post(event: WorldEvent): void;
};

/**
 * inbox methods injected into `runner`. Not public.
 */
export type InboxInternal = {
  /**
   * Takes the first event the active rest node accepts and leaves the rest queued.
   *
   * @param accepted - The types the rest node lists in its `inbox`.
   * @returns The event to deliver, or `undefined` when nothing is deliverable.
   */
  take(accepted: readonly string[]): WorldEvent | undefined;

  /**
   * Registers a listener that is called after every `post`, so the runner can look at a resting
   * node again. The list is copied before delivery: a listener that unsubscribes during the
   * call does not hide its neighbour.
   *
   * @param listener - Called once per posted event.
   * @returns The unsubscribe function.
   */
  onPost(listener: () => void): () => void;
};
