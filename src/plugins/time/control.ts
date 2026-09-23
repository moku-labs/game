/**
 * @file time plugin — the time command of the `/control` door: step frames by hand. Dev builds
 * only: the body starts with the inline dev guard, so a bundler `define` of `false` drops it, and
 * logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";

/** The length of one frame at 60 fps, the step a frame count takes by default. */
const FRAME_MS = 1000 / 60;

/**
 * Refuses a frame count that is not a whole number of zero or more.
 *
 * @param frames - The frame count.
 * @throws {Error} When it is negative, fractional or not finite.
 */
function checkFrames(frames: number): void {
  if (Number.isInteger(frames) && frames >= 0) return;

  throw new Error(
    `[game] game.step takes a whole number of frames.\n  Pass 0 or a positive whole number, not ${String(frames)}.`
  );
}

/**
 * Runs frames by hand, one `time.step` each, also while the game is paused, and answers the time
 * after them. A frame lasts 1000/60 ms unless `deltaMs` says otherwise.
 *
 * @example
 * ```ts
 * // The editor paused the game on a merge; step three frames to watch the item land.
 * const ran = await run(app, commands.step, { frames: 3 });
 * ran.value; // { delta: 16.666…, elapsed: 50, scale: 1, frame: 3, idle: false }
 * ```
 */
export const stepCommand = defineCommand({
  id: "game.step",
  title: "Step frames",
  input: { frames: "number", deltaMs: "number?" },
  effect: "cosmetic",
  run: (app: ControlApp, { frames, deltaMs = FRAME_MS }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.step", frames });
    checkFrames(frames);

    for (let frame = 0; frame < frames; frame += 1) app.time.step(deltaMs);

    return app.time.snapshot();
  }
});
