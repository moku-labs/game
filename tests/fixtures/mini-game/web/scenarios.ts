/**
 * @file Prepared saves for the dev page, picked with `?player=<name>`. An e2e script or a visual
 * test starts from a save instead of tapping its way there. Test code of the fixture.
 */
import type { Player } from "../state";
import { startingPlayer } from "../state";

/** The popup was answered with OK three times: the counter reads 3. */
export const ready: Player = { count: 3 };

/** The saves the page knows, by the name `?player=` gives. */
export const scenarios: Readonly<Record<string, Player>> = { ready };

/**
 * The save the page starts from: the one `?player=` names, or the starting save.
 *
 * @param search - `location.search` of the page.
 * @returns The player to seed the model with.
 * @example
 * ```ts
 * playerFor("?player=ready").count; // 3
 * playerFor("").count; // 0
 * ```
 */
export function playerFor(search: string): Player {
  const name = new URLSearchParams(search).get("player") ?? "";

  return scenarios[name] ?? startingPlayer;
}
