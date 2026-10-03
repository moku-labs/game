/**
 * @file platform plugin — state factory, and the one question the hooks ask of it: does the
 * plugin run right now.
 */
import type { State } from "./types";

/**
 * Creates the set of haptic kinds that already got their one warning. Its own function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of kinds.
 */
function emptyWarned(): Set<string> {
  return new Set();
}

/**
 * Creates the initial platform state: the screen is not kept on, nothing is subscribed and no
 * kind was warned about. `onStart` subscribes to the provider.
 *
 * @returns A fresh state, owned by one app.
 */
export function createPlatformState(): State {
  return { awake: false, offs: [], warned: emptyWarned() };
}

/**
 * Tells whether the plugin started with a provider and has not stopped. A start with a provider
 * always leaves at least the haptic handler and the keep-awake release in `offs`, and the stop
 * empties it.
 *
 * @param state - The plugin state.
 * @returns True between a start with a provider and the stop.
 */
export function isRunning(state: State): boolean {
  return state.offs.length > 0;
}
