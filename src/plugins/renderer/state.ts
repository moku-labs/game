/**
 * @file renderer plugin — state factory.
 */
import { SCALE_STEPS } from "../time/rate-rules";
import { createDemandState } from "./demand/state";
import { createHostState } from "./host/state";
import { createKeptState } from "./kept/state";
import { createMonitorState } from "./monitor/state";
import { createShotsState } from "./shots/state";
import { createSyncState } from "./sync/state";
import type { Config, State } from "./types";
import { createViewportState } from "./viewport/state";

/** The fewest and the most frames the ring of the performance monitor keeps. */
const RING_FRAMES = { min: 64, max: 16_384 } as const;

/** The most probe draws of the warm-up a drawn frame may make. */
const MAX_WARM = 16;

/** The most textures the upload queue may put on the GPU in one drawn frame: about 9 ms each on a Galaxy A26. */
const MAX_UPLOADS = 8;

/** The most texels a side of a shot may have. */
const MAX_SHOT_SIDE = 512;

/**
 * Tells a finite number of at least 0 from anything else a config can hold.
 *
 * @param value - The config value.
 * @returns True for a finite number `>= 0`.
 * @example
 * ```ts
 * isCount(0); // true
 * ```
 */
function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Checks the pool trim of the config: `false`, or an object of two numbers of at least 0.
 *
 * @param poolTrim - What the config holds.
 * @throws {Error} When it is neither `false` nor an object, or `restMs` or `aboveMb` is not a
 *   finite number of at least 0.
 */
function checkPoolTrim(poolTrim: unknown): void {
  if (poolTrim === false) return;

  if (typeof poolTrim !== "object" || poolTrim === null) {
    throw new Error(
      `[game] renderer.poolTrim is ${String(poolTrim)}.\n  Give { restMs, aboveMb } or false.`
    );
  }

  const restMs = "restMs" in poolTrim ? poolTrim.restMs : undefined;
  const aboveMb = "aboveMb" in poolTrim ? poolTrim.aboveMb : undefined;

  if (!isCount(restMs)) {
    throw new Error(
      `[game] renderer.poolTrim.restMs is ${String(restMs)}.\n` +
        "  Give the clock milliseconds of a still screen, 0 or more."
    );
  }

  if (!isCount(aboveMb)) {
    throw new Error(
      `[game] renderer.poolTrim.aboveMb is ${String(aboveMb)}.\n` +
        "  Give the MiB the targets must grow by, 0 or more."
    );
  }
}

/**
 * Checks the adaptive render scale of the config: `false`, or a floor that is a step of the scale and the devices it
 * applies to.
 *
 * @param adaptiveScale - What the config holds.
 * @throws {Error} When it is neither `false` nor an object, the floor is not 1, 0.85, 0.75, 0.6 or 0.5, or the
 *   devices are neither `"phone"` nor `"all"`.
 */
function checkAdaptiveScale(adaptiveScale: unknown): void {
  if (adaptiveScale === false) return;

  if (typeof adaptiveScale !== "object" || adaptiveScale === null) {
    throw new Error(
      `[game] renderer.adaptiveScale is ${String(adaptiveScale)}.\n  Give { floor, devices } or false.`
    );
  }

  const floor = "floor" in adaptiveScale ? adaptiveScale.floor : undefined;
  const devices = "devices" in adaptiveScale ? adaptiveScale.devices : undefined;

  if (typeof floor !== "number" || !SCALE_STEPS.includes(floor)) {
    throw new Error(
      `[game] renderer.adaptiveScale.floor is ${String(floor)}.\n` +
        "  Give a step of the scale: 1, 0.85, 0.75, 0.6 or 0.5."
    );
  }

  if (devices !== "phone" && devices !== "all") {
    throw new Error(
      `[game] renderer.adaptiveScale.devices is ${String(devices)}.\n  Give "phone" or "all".`
    );
  }
}

/**
 * Tells a side of a shot from anything else a config can hold.
 *
 * @param value - The config value.
 * @returns True for a whole number from 1 to 512.
 * @example
 * ```ts
 * isShotSide(512); // true
 * ```
 */
function isShotSide(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_SHOT_SIDE;
}

/**
 * Checks the shots of the config: left out, or an object of a size, a blur and, when given, a limit.
 *
 * @param shots - What the config holds.
 * @throws {Error} When it is no object, `width` or `height` is not a whole number from 1 to 512, `blur` is not a finite
 *   number of at least 0, or `keep` is given and not a whole number of at least 1.
 */
function checkShots(shots: unknown): void {
  if (shots === undefined) return;

  if (typeof shots !== "object" || shots === null) {
    throw new Error(
      `[game] renderer.shots is ${String(shots)}.\n  Give { width, height, blur } or leave it out.`
    );
  }

  const width = "width" in shots ? shots.width : undefined;
  const height = "height" in shots ? shots.height : undefined;
  const blur = "blur" in shots ? shots.blur : undefined;
  const keep = "keep" in shots ? shots.keep : undefined;

  if (!isShotSide(width)) {
    throw new Error(
      `[game] renderer.shots.width is ${String(width)}.\n  Give the texels across, a whole number from 1 to 512.`
    );
  }

  if (!isShotSide(height)) {
    throw new Error(
      `[game] renderer.shots.height is ${String(height)}.\n  Give the texels down, a whole number from 1 to 512.`
    );
  }

  if (!isCount(blur)) {
    throw new Error(
      `[game] renderer.shots.blur is ${String(blur)}.\n  Give the sigma in reference units, 0 or more.`
    );
  }

  if (keep !== undefined && !(Number.isInteger(keep) && Number(keep) >= 1)) {
    throw new Error(
      `[game] renderer.shots.keep is ${String(keep)}.\n  Give the shots kept, a whole number of at least 1.`
    );
  }
}

/**
 * Checks the numbers of the config a game can get wrong, at `createApp`, in every build: the
 * resolution cap, the pool trim, the adaptive render scale, the performance monitor, the budget of the kept pictures,
 * the probe draws of the warm-up, the textures uploaded per drawn frame and the shots.
 *
 * @param config - The resolved plugin config.
 * @throws {Error} When `maxResolution` is not a number above 0, `poolTrim`, `adaptiveScale` or `shots` fails its check,
 *   `monitor.budgetMs` is neither `"rate"` nor a number above 0, `monitor.frames` is not a whole
 *   number from 64 to 16384, `keptMb` is not a finite number of at least 0, `warm` is not a
 *   whole number from 0 to 16, or `uploads` is not a whole number from 0 to 8.
 */
function checkConfig(config: Readonly<Config>): void {
  const { maxResolution, keptMb } = config;
  const { budgetMs, frames } = config.monitor;

  if (!Number.isFinite(maxResolution) || maxResolution <= 0) {
    throw new Error(`[game] renderer.maxResolution is ${maxResolution}.\n  Give a number above 0.`);
  }

  checkPoolTrim(config.poolTrim);
  checkAdaptiveScale(config.adaptiveScale);
  checkShots(config.shots);

  if (budgetMs !== "rate" && !(Number.isFinite(budgetMs) && budgetMs > 0)) {
    throw new Error(
      `[game] renderer.monitor.budgetMs is ${String(budgetMs)}.\n` +
        '  Give the frame budget in milliseconds, or "rate" for one frame of the current rate.'
    );
  }

  if (!Number.isInteger(frames) || frames < RING_FRAMES.min || frames > RING_FRAMES.max) {
    throw new Error(
      `[game] renderer.monitor.frames is ${frames}.\n  Give a whole number from 64 to 16384.`
    );
  }

  if (typeof keptMb !== "number" || !Number.isFinite(keptMb) || keptMb < 0) {
    throw new Error(
      `[game] renderer.keptMb is ${String(keptMb)}.\n  Give the MiB kept pictures may hold, or 0 to keep none.`
    );
  }

  const { warm } = config;

  if (!Number.isInteger(warm) || warm < 0 || warm > MAX_WARM) {
    throw new Error(
      `[game] renderer.warm is ${String(warm)}.\n  Give the probe draws per frame, a whole number from 0 to 16.`
    );
  }

  const { uploads } = config;

  if (!Number.isInteger(uploads) || uploads < 0 || uploads > MAX_UPLOADS) {
    throw new Error(
      `[game] renderer.uploads is ${String(uploads)}.\n` +
        "  Give the textures uploaded per drawn frame, a whole number from 0 to 8."
    );
  }
}

/**
 * Creates the initial renderer state: one branch per module, composed from the module state
 * factories, after the config passed its checks. Nothing is created here; `onStart` fills it
 * when a DOM and a mount exist. The debug switches start from the config.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 * @throws {Error} When the config fails a check of `checkConfig`.
 */
export function createRendererState(ctx: { readonly config: Readonly<Config> }): State {
  checkConfig(ctx.config);

  return {
    host: createHostState(),
    viewport: createViewportState(),
    sync: createSyncState(ctx.config.debug),
    monitor: createMonitorState(ctx.config.monitor),
    demand: createDemandState(ctx.config.debug.verifyFrames === true),
    kept: createKeptState(ctx.config),
    shots: createShotsState()
  };
}
