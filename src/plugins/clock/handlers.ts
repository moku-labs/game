/**
 * @file clock plugin — event handlers: the clock stands while the pause stack holds `devtools`
 * (F169), so the editor's pause, `game.step` and `game.clock` move time alone.
 */
import type { Events as LifecycleEvents } from "../lifecycle/types";
import { freezeClock, thawClock } from "./api";
import type { State } from "./types";

/** Payload of `lifecycle:changed`: the pause stack after the change. */
type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/**
 * Creates the hook handlers. On `lifecycle:changed` the clock stops when the stack holds
 * `devtools` and goes on when it no longer does; any other reason leaves it on the source. The
 * clock sits before flow among the plugins, so this hook runs first, at the change itself. The
 * order does not matter for the reading: going on again keeps the moment it stood at, so the
 * resume poke of flow reads the same `now` before or after it.
 *
 * @param ctx - Kernel context of the clock plugin.
 * @param ctx.state - Clock state.
 * @returns The one hook of the plugin.
 */
export function createHandlers(ctx: { readonly state: State }): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  return {
    /**
     * Stops or lets go the clock after a change of the pause stack.
     *
     * @param payload - The stack after the change.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      if (payload.reasons.includes("devtools")) freezeClock(ctx.state);
      else thawClock(ctx.state);
    }
  };
}
