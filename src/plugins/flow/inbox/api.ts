/**
 * @file flow/inbox — API factory. World events wait here until a rest node that lists their type
 * is active; one entry per type, the latest payload wins.
 */
import type { FlowCtx } from "../types";
import type { InboxApi, InboxInternal, InboxState, WorldEvent } from "./types";

/**
 * Puts one event into the queue. A second event of the same type replaces the first one in place:
 * the queue keeps one entry per type, oldest first, and the payload is the latest one.
 *
 * @param state - Inbox state.
 * @param event - The event that arrived.
 * @example
 * ```ts
 * queueEvent(ctx.state.inbox, { type: "elapsed", payload: { now: 1000 } });
 * ```
 */
function queueEvent(state: InboxState, event: WorldEvent): void {
  const index = state.queue.findIndex(queued => queued.type === event.type);

  if (index === -1) {
    state.queue.push(event);
    return;
  }

  state.queue[index] = event;
}

/**
 * Removes one listener. A second removal of the same listener does nothing.
 *
 * @param listeners - The registered listeners.
 * @param listener - The listener registered by `onPost`.
 * @example
 * ```ts
 * removeListener(listeners, listener);
 * ```
 */
function removeListener(listeners: Array<() => void>, listener: () => void): void {
  const index = listeners.indexOf(listener);

  if (index === -1) return;

  listeners.splice(index, 1);
}

/**
 * Creates the inbox API: `post` queues a world event, duplicates of one `type` collapse to the
 * latest; the internal `take` removes the first event a rest node accepts and `onPost` tells the
 * runner that something arrived.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The public inbox API plus the methods injected into `runner`.
 * @example
 * ```ts
 * const inbox = createInboxApi(ctx);
 * inbox.post({ type: "elapsed", payload: { now: 1000 } });
 * ```
 */
export function createInboxApi(ctx: FlowCtx): InboxApi & InboxInternal {
  const listeners = ctx.state.inbox.listeners;

  return {
    /**
     * Queues one world event. It is delivered only when the active node is a rest node whose
     * `inbox` lists the type; until then it waits. Duplicates of one type collapse to the latest.
     *
     * @param event - Type and optional payload.
     * @example
     * ```ts
     * app.flow.inbox.post({ type: "elapsed", payload: { now: 1000 } });
     * ```
     */
    post: (event: WorldEvent): void => {
      queueEvent(ctx.state.inbox, event);

      const current = [...listeners];

      for (const listener of current) listener();
    },

    /**
     * Takes the first event the active rest node accepts and leaves the rest queued.
     *
     * @param accepted - The types the rest node lists in its `inbox`.
     * @returns The event to deliver, or `undefined` when nothing is deliverable.
     * @example
     * ```ts
     * const event = modules.inbox.take(["elapsed"]);
     * ```
     */
    take: (accepted: readonly string[]): WorldEvent | undefined => {
      const queue = ctx.state.inbox.queue;
      const index = queue.findIndex(queued => accepted.includes(queued.type));

      if (index === -1) return undefined;

      const [event] = queue.splice(index, 1);

      return event;
    },

    /**
     * Registers a listener that is called after every `post`, so the runner can look at a resting
     * node again. The list is copied before delivery: a listener that unsubscribes during the
     * call does not hide its neighbour.
     *
     * @param listener - Called once per posted event.
     * @returns The unsubscribe function.
     * @example
     * ```ts
     * const off = modules.inbox.onPost(() => wake());
     * ```
     */
    onPost: (listener: () => void): (() => void) => {
      listeners.push(listener);

      return () => removeListener(listeners, listener);
    }
  };
}
