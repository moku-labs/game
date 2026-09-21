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
 *
 * @example
 * ```ts
 * const inbox: InboxState = createInboxState();
 * ```
 */
export type InboxState = {
  /** Undelivered events, oldest first. One entry per `type`. */
  queue: WorldEvent[];
};

/**
 * inbox module API.
 *
 * @example
 * ```ts
 * app.flow.inbox.post({ type: "elapsed", payload: { now: 1000 } });
 * ```
 */
export type InboxApi = { post(event: WorldEvent): void };

/**
 * inbox methods injected into `runner`. Not public.
 *
 * @example
 * ```ts
 * const event = modules.inbox.take(["elapsed"]);
 * ```
 */
export type InboxInternal = {
  take(accepted: readonly string[]): WorldEvent | undefined;
  onPost(listener: () => void): () => void;
};
