/**
 * @file time plugin — the time commands of the `/control` door: step frames by hand, set the
 * time scale and force the frame rate. Dev and debug builds: every body starts with the inline agent guard of a cosmetic
 * command, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import type { Api as ClockApi } from "../clock/types";
import { defineCommand, inputSchema } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Api as LifecycleApi } from "../lifecycle/types";
import type { RateChoice } from "./types";

/** What `game.step` needs of an app: the control app, and the clock and the pause stack when installed. */
type StepApp = ControlApp & {
  readonly clock?: ClockApi;
  readonly lifecycle?: LifecycleApi;
};

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
 * Picks the clock `game.step` moves with the frames: the clock stands while the game is paused for
 * `devtools` (F169), so the step moves it; on a running clock the step leaves it alone.
 *
 * @param app - The app the command runs on.
 * @returns The standing clock, or `undefined`.
 */
function standingClock(app: StepApp): ClockApi | undefined {
  if (app.lifecycle?.reasons().includes("devtools") !== true) return undefined;

  return app.clock;
}

/**
 * Refuses a time scale that is not a finite number of zero or more. `setScale` clamps silently;
 * the command refuses, so an editor slider cannot pass `NaN`.
 *
 * @param scale - The time scale.
 * @throws {Error} When it is negative or not finite.
 */
function checkScale(scale: number): void {
  if (Number.isFinite(scale) && scale >= 0) return;

  throw new Error(
    `[game] game.timeScale takes a scale of 0 or more.\n  Pass a finite number, not ${String(scale)}.`
  );
}

/**
 * Runs frames by hand, one `time.step` each, also while the game is paused, and answers the time
 * after them. A frame lasts 1000/60 ms unless `deltaMs` says otherwise. While `game.pause` holds,
 * the clock stands, and each frame moves it by `deltaMs` before the frame runs, so `clock.now()`
 * and the frame time go on together and a moment the flow scheduled arrives on the frame that
 * reaches it. Otherwise the clock follows the device and the step leaves it alone.
 *
 * @example
 * ```ts
 * // The editor paused the game on a merge; step three frames to watch the item land.
 * await run(app, commands.pause);
 * app.clock.now(); // 1000000
 * const ran = await run(app, commands.step, { frames: 3, deltaMs: 20 });
 * ran.value; // { delta: 20, elapsed: 60, scale: 1, frame: 3, idle: false }
 * app.clock.now(); // 1000060
 * ```
 */
export const stepCommand = defineCommand({
  id: "game.step",
  title: "Step frames",
  input: inputSchema(["frames", "number"], ["deltaMs", "number?"]),
  effect: "cosmetic",
  run: (app: StepApp, { frames, deltaMs = FRAME_MS }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.step", frames });
    checkFrames(frames);

    const clock = deltaMs > 0 ? standingClock(app) : undefined;

    for (let frame = 0; frame < frames; frame += 1) {
      clock?.advance(deltaMs);
      app.time.step(deltaMs);
    }

    return app.time.snapshot();
  }
});

/**
 * Sets the time scale and answers the time after the write. 0 freezes game time while the frames
 * keep running; `game.step` still steps.
 *
 * @example
 * ```ts
 * // The editor slows a merge to a quarter speed to watch the item land.
 * (await run(app, commands.timeScale, { scale: 0.25 })).value.scale; // 0.25
 * ```
 */
export const timeScaleCommand = defineCommand({
  id: "game.timeScale",
  title: "Time scale",
  input: inputSchema(["scale", "number"]),
  effect: "cosmetic",
  run: (app: ControlApp, { scale }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.timeScale", scale });
    checkScale(scale);
    app.time.setScale(scale);

    return app.time.snapshot();
  }
});

/**
 * Forces the frame rate, or gives it back to the config without `fps`, and answers the rate after
 * the call: the rate the loop really runs at, the rate asked and whether the panel holds it lower.
 * For an A/B run on the phone: the same screen at 120 and at 60. A wrong `fps` is refused by
 * `setRate` with its own message.
 *
 * @example
 * ```ts
 * (await run(app, commands.frameRate, { fps: 60 })).value.fps; // 60
 * // a pin of 120 on a 60 Hz phone runs at the panel's rate:
 * (await run(app, commands.frameRate, { fps: 120 })).value; // { fps: 60, mode: "forced", …, asked: 120, heldBy: "panel", scale: 1 }
 * (await run(app, commands.frameRate, {})).value.mode; // "auto" with adaptive, "fixed" without
 * ```
 */
export const frameRateCommand = defineCommand({
  id: "game.frameRate",
  title: "Frame rate",
  input: inputSchema(["fps", "number?"]),
  effect: "cosmetic",
  run: (app: ControlApp, { fps }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.frameRate", fps });

    // `setRate` checks the number: the door passes it on as the player's choice would come.
    return app.time.setRate(fps === undefined ? "auto" : (fps as RateChoice));
  }
});
