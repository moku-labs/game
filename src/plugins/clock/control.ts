/**
 * @file clock plugin — the clock command of the `/control` door: move the clock forward (F157).
 * Dev and debug builds: the body starts with the inline control guard of a cheat command, so a
 * bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import { defineCommand, inputSchema } from "../flow/doors/define";
import { controlRefused, notInstalled } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Api as ClockApi } from "./types";

/**
 * Moves the game clock forward by `advanceMs`: a moment the rules scheduled with `clock.scheduleAt`
 * that is due now arrives as `elapsed`, through the graph. A visual test reaches a clock-armed
 * moment with it while its fake clock stands. While `game.pause` holds the clock stands, and this
 * command and `game.step` are the only things that move it. Changes what the game sees, so the
 * session is tainted and the command journaled. Answers the clock after the move.
 *
 * @throws {Error} `[game] The command game.clock needs clockPlugin.` when the app has no `clockPlugin`.
 * @throws {RangeError} When `advanceMs` is 0 or negative.
 * @example
 * ```ts
 * // A board tick is armed 60 s ahead: the visual test moves the clock and checks the board after it.
 * // steps: [{ clock: { advanceMs: 60_000 } }, { checkpoint: "after-tick" }]
 * (await run(app, commands.clock, { advanceMs: 60_000 })).value; // { now: 1000060000 }
 * ```
 */
export const clockCommand = defineCommand({
  id: "game.clock",
  title: "Move the clock",
  input: inputSchema(["advanceMs", "number"]),
  effect: "cheat",
  run: (app: ControlApp & { readonly clock?: ClockApi }, { advanceMs }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }
    if (app.clock === undefined) throw notInstalled("game.clock", "clockPlugin", "command");

    app.log.debug("moku:dev", { command: "game.clock", advanceMs });

    return { now: app.clock.advance(advanceMs) };
  }
});
