/**
 * @file The coin counter: a number in the save, a numeric component on the screen. `Counter`
 * carries the value, the label shows `Math.round` of it through the digits font, and the change
 * hook decides how the number travels — at once, or after the coins that fly to it have landed.
 *
 * It is its own projection because a `bind` reads the component of the entity the label sits on,
 * and a JSX element carries only what `ui` writes on it.
 */
import type { Flow, World } from "@moku-labs/game";
import { component, Order, Text, Transform } from "@moku-labs/game";
import { projection } from "../../kit";
import type { Player } from "../../state";
import { barItemHeight, barPadding } from "./styles";

/** How long the number rolls when nothing announced a flight. */
const ROLL_MS = 200;

/** How long it rolls after a flight landed. */
const FLIGHT_ROLL_MS = 400;

/**
 * Where the counter is drawn, in reference units. It is the origin of the `coinSlot` element of
 * the HUD, computed from the same two style numbers the markup uses: the label cannot sit inside
 * the markup, because a `bind` reads the component of the entity its label sits on and a ui
 * element carries only what `ui` writes on it.
 */
const at = { x: barPadding, y: barPadding + barItemHeight / 4 };

/** The number the counter shows. A component, so the engine can tween it like a position. */
export const Counter = component("Counter", { value: 0 });

/**
 * One coin counter as the view reads it.
 *
 * @example
 * ```ts
 * const item: CoinsView = { id: "coins", value: 25 };
 * ```
 */
export type CoinsView = { id: string; value: number };

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
 * @param view - The view of the counter.
 * @param _previous - The value before the commit. Not read: the roll always goes home.
 * @param _next - The value after the commit.
 * @param hint - The hint the node released, when it released one.
 * @returns The motion that brings the number home.
 */
export function rollCoins(
  view: World.ViewHandle<CoinsView>,
  _previous: CoinsView,
  _next: CoinsView,
  hint?: Flow.Hint
): World.Motion {
  if (hint?.kind === "coins.fly") {
    return view.toRest(Counter, { delayMs: delayOf(hint), ms: FLIGHT_ROLL_MS });
  }

  return view.toRest(Counter, { ms: ROLL_MS });
}

/**
 * The coin counter of the HUD: one entity that carries the number and the label bound to it.
 * The label resolves to the rounded value every frame, so the roll is drawn without a single
 * string being built.
 */
export const hudCoins = projection({
  name: "hud.coins",
  layer: "ui",
  from: (player: Player): CoinsView[] => [{ id: "coins", value: player.merge.wallet.coins ?? 0 }],
  key: item => item.id,
  view: item => [
    Counter({ value: item.value }),
    Text({
      style: "hud.digits",
      bind: { component: "Counter", field: "value" },
      anchor: { x: 0, y: 0 }
    }),
    Transform({ x: at.x, y: at.y }),
    // Above the bar of the HUD, which shares the `ui` layer and is drawn after the counter spawns.
    Order({ value: 1 })
  ],
  motion: { change: { Counter: rollCoins } }
});
