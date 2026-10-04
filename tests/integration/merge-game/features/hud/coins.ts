/**
 * @file The coin counter: a number in the save, a numeric component on the screen. `Counter`
 * carries the value on the text element of the coin pill, the label shows `Math.round` of it
 * through the digits font, and the change hook decides how the number travels — at once, or after
 * the coins that fly to it have landed.
 *
 * The pill renders the text with `components={[Counter({ value: coins })]}` and
 * `motion={{ change: { Counter: rollCoins } }}`: `ui` records the new rest of `Counter` on every
 * commit that changes the coins and plays the hook with the hint of that commit.
 */
import type { Flow, World } from "@moku-labs/game";
import { component } from "@moku-labs/game";

/** How long the number rolls when nothing announced a flight. */
const ROLL_MS = 200;

/** How long it rolls after a flight landed. */
const FLIGHT_ROLL_MS = 400;

/** The number the counter shows. A component, so the engine can tween it like a position. */
export const Counter = component("Counter", { value: 0 });

/**
 * The value of `Counter`, as the change hook receives it.
 *
 * @example
 * ```ts
 * const value: CounterValue = { value: 25 };
 * ```
 */
export type CounterValue = { value: number };

/**
 * How long a hint asks the counter to wait. The `coins.fly` hint carries the flight time, so the
 * number starts moving when the coins arrive.
 *
 * @param hint - What the node released after its commit.
 * @returns The delay in milliseconds, zero when the hint carries none.
 */
function delayOf(hint: Flow.Hint): number {
  const payload = hint.payload as { ms?: number } | undefined;

  return typeof payload?.ms === "number" ? payload.ms : 0;
}

/**
 * Change of `Counter`: the number rolls to the value the save now holds. With a `coins.fly` hint
 * it waits for the flight first, so the counter rises exactly when the coins land on it.
 *
 * @param view - The view of the text element that carries the counter.
 * @param _previous - The value before the commit. Not read: the roll always goes home.
 * @param _next - The value after the commit.
 * @param hint - The hint the node released, when it released one for this element.
 * @returns The motion that brings the number home.
 */
export function rollCoins(
  view: World.ViewHandle<unknown>,
  _previous: CounterValue,
  _next: CounterValue,
  hint?: Flow.Hint
): World.Motion {
  if (hint?.kind === "coins.fly") {
    return view.toRest(Counter, { delayMs: delayOf(hint), ms: FLIGHT_ROLL_MS });
  }

  return view.toRest(Counter, { ms: ROLL_MS });
}
