/**
 * @file flow/inbox — state factory.
 */
import type { InboxState } from "./types";

/**
 * Creates the inbox module state: an empty queue.
 *
 * @returns The initial inbox state.
 */
export function createInboxState(): InboxState {
  return { queue: [], listeners: [] };
}
