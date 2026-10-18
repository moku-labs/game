/* eslint-disable unicorn/no-null -- a thermal status is JSON: an unknown one is null, as `FrameRate.thermal` (spec 21 G1.3). */
/**
 * @file time — the rules of the adaptive frame rate (spec 21 G2): the constants and the pure functions of the drop,
 * the return, the render scale, the display detection and the thermal input. No state, no clock: `rate.ts` applies
 * them.
 */
import type { ThermalStatus } from "./types";

/** Refresh rates a tick interval is matched against, lowest first. */
export const DISPLAY_RATES: readonly number[] = [50, 60, 75, 90, 100, 120, 144, 165, 240];

/** A tick matches a rate within ±5 % of its period: the windows of two rates do not overlap. */
export const DISPLAY_TOLERANCE = 0.05;

/** Ticks per display detection window: one second at 120 Hz. */
export const DISPLAY_WINDOW_TICKS = 120;

/** Ticks per window while the display is unknown and no governor waits for it: half a second at 60 Hz. */
export const DISPLAY_FIRST_WINDOW_TICKS = 30;

/** The cap's slack before the display is known, as a share of one frame of the cap: 2 ms at 60. */
export const CAP_SLACK_SHARE = 0.12;

/** A rate qualifies in a window with at least this share of its ticks. */
export const DISPLAY_SHARE = 0.25;

/** Windows in a row that must agree before the display rate goes down. */
export const DISPLAY_LOWER_WINDOWS = 2;

/** A tick interval above this is not a display sample: a hitch, a hidden page. */
export const TICK_IGNORE_MS = 50;

/** A frame interval above this is not a sample: the page was away. */
export const INTERVAL_IGNORE_MS = 500;

/** Page time the drop rule looks back, ms. */
export const DROP_WINDOW_MS = 1000;

/** The fewest late drawn intervals that drop the rate. */
export const DROP_MIN_MISSES = 8;

/** …and at least this share of the window's drawn intervals: the p90 rule written as a count. */
export const DROP_SHARE = 0.1;

/** Page time the return rule looks back, ms. */
export const RETURN_WINDOW_MS = 3000;

/** The fewest drawn frames in the return window for any return: a still screen gives no evidence. */
export const RETURN_MIN_FRAMES = 90;

/** The most late drawn intervals in the return window that still allow a return. */
export const RETURN_MAX_MISSES = 1;

/** A drawn frame is heavy when its work is over this share of the higher rate's frame. */
export const RETURN_WORK_SHARE = 0.5;

/** The most share of heavy frames in the return window that still allows a return. */
export const RETURN_HEAVY_SHARE = 0.1;

/** The least time at a rate before a return, ms. */
export const DWELL_BASE_MS = 5000;

/** The dwell never grows past this, ms. */
export const DWELL_MAX_MS = 120_000;

/** A return held this long before its first drop resets the dwell to the base; held shorter it failed: it doubles, ms. */
export const HOLD_RESET_MS = 60_000;

/** A step up of the render scale waits this many dwells: every change of the scale redraws the whole canvas. */
export const SCALE_DWELL_FACTOR = 2;

/** The render scales the adaptive rule steps through, highest first: shares of the canvas resolution. */
export const SCALE_STEPS: readonly number[] = Object.freeze([1, 0.85, 0.75, 0.6, 0.5]);

/** No scale to step through: the renderer allows none. */
const NO_SCALES: readonly number[] = Object.freeze([]);

/** Samples the ring holds: three seconds at 120 fps are 360. */
export const RING = 512;

/** The thermal statuses in order of heat: Android's `THERMAL_STATUS_*` numbers are their indexes. */
const THERMAL_STATUSES: readonly ThermalStatus[] = [
  "none",
  "light",
  "moderate",
  "severe",
  "critical",
  "emergency",
  "shutdown"
];

/**
 * The rates the rule may choose on a display: its divisors at or below `maxFps` and at or above `floor`, highest
 * first, frozen. When none reaches the floor, the highest divisor at or below `maxFps` alone. Allocates: called when
 * the display rate changes, never per frame.
 *
 * @param displayHz - The display's refresh rate.
 * @param maxFps - The top of the ladder.
 * @param floor - The lowest rate.
 * @returns The ladder.
 * @example
 * ```ts
 * ladderOf(240, 120, 60); // [120, 80, 60]
 * ```
 */
export function ladderOf(displayHz: number, maxFps: number, floor: number): readonly number[] {
  const steps: number[] = [];

  for (let divisor = 1; displayHz / divisor >= floor; divisor += 1) {
    const step = displayHz / divisor;

    if (step <= maxFps) steps.push(step);
  }

  if (steps.length === 0) steps.push(displayHz / Math.ceil(displayHz / maxFps));

  return Object.freeze(steps);
}

/**
 * The render scales the rule may choose down to a floor, highest first, frozen; none when 1 alone reaches it. A floor
 * between two steps stops at the step above it (the renderer's config only takes a step). Allocates: called when the
 * renderer allows a floor, never per frame.
 *
 * @param floor - The lowest scale the renderer allows.
 * @returns The scales.
 * @example
 * ```ts
 * scaleStepsOf(0.75); // [1, 0.85, 0.75]
 * ```
 */
export function scaleStepsOf(floor: number): readonly number[] {
  const steps = SCALE_STEPS.filter(step => step >= floor);

  return steps.length > 1 ? Object.freeze(steps) : NO_SCALES;
}

/**
 * The index in `DISPLAY_RATES` a tick interval votes for: the rate whose period is within `DISPLAY_TOLERANCE` of
 * it, or -1. An indexed loop: no allocation.
 *
 * @param tickMs - The interval between two ticks of the frame source.
 * @returns The index, or -1.
 * @example
 * ```ts
 * displayIndexOf(8.4); // 5 (120 Hz)
 * ```
 */
export function displayIndexOf(tickMs: number): number {
  const count = DISPLAY_RATES.length;

  for (let index = 0; index < count; index += 1) {
    const period = 1000 / (DISPLAY_RATES[index] ?? 1);

    if (Math.abs(tickMs - period) <= DISPLAY_TOLERANCE * period) return index;
  }

  return -1;
}

/**
 * The interval above which a drawn frame came late: one frame of the rate plus half a display period, so a frame
 * that took one vsync more is late and timestamp jitter is not.
 *
 * @param fps - The loop's rate.
 * @param displayHz - The display's refresh rate.
 * @returns The line, ms.
 * @example
 * ```ts
 * missLineMs(120, 120); // 12.5
 * ```
 */
export function missLineMs(fps: number, displayHz: number): number {
  return 1000 / fps + 500 / displayHz;
}

/**
 * How much earlier than one frame of the cap a tick may come and still run. Half a display period when the frame is
 * a whole number of display periods (within `DISPLAY_TOLERANCE`), so vsync jitter never drops a frame and a tick one
 * period early is still skipped. One millisecond when it is not, so a cap between two vsyncs keeps its old rate. Before
 * the display is known, `CAP_SLACK_SHARE` of the frame, at least one millisecond. Called per tick: no allocation.
 *
 * @param displayHz - The display's refresh rate, or `null` while unknown.
 * @param frameMs - One frame of the cap, ms.
 * @returns The slack, ms.
 * @example
 * ```ts
 * capSlackMs(144, 1000 / 60); // 1: 13.9 ms ticks of a 144 Hz panel stay skipped under a 60 cap
 * ```
 */
export function capSlackMs(displayHz: number | null, frameMs: number): number {
  if (displayHz === null) return Math.max(1, CAP_SLACK_SHARE * frameMs);

  const periods = (frameMs * displayHz) / 1000;
  const whole = Math.round(periods);

  return whole >= 1 && Math.abs(periods - whole) <= DISPLAY_TOLERANCE ? 500 / displayHz : 1;
}

/**
 * The rate the loop really runs at under a cap: the cap skips every tick that comes more than `capSlackMs` early, so
 * a frame runs on the first vsync at or after one frame of the cap minus the slack, never faster than the display. The
 * cap itself while the display is unknown. Called when the snapshot is rebuilt, never per frame.
 *
 * @param fps - The cap: the loop's rate, the idle cap left out.
 * @param displayHz - The display's refresh rate, or `null` while unknown.
 * @returns Frames per second the loop runs at.
 * @example
 * ```ts
 * loopRateOf(60, 144); // 48: every third tick of a 144 Hz panel
 * ```
 */
export function loopRateOf(fps: number, displayHz: number | null): number {
  if (displayHz === null) return fps;

  const frameMs = 1000 / fps;
  const ticks = Math.ceil(((frameMs - capSlackMs(displayHz, frameMs)) * displayHz) / 1000);

  return displayHz / Math.max(1, ticks);
}

/**
 * Normalizes a thermal status of the shell: a status name, or Android's whole number 0–6 mapped in order.
 *
 * @param value - The raw status.
 * @returns The status, or `null` for anything else.
 * @example
 * ```ts
 * thermalOf(2); // "moderate"
 * ```
 */
export function thermalOf(value: unknown): ThermalStatus | null {
  if (typeof value === "number") return THERMAL_STATUSES[value] ?? null;

  return THERMAL_STATUSES.find(status => status === value) ?? null;
}

/**
 * The rank of a thermal status: its index in order of heat, -1 for none known.
 *
 * @param status - The normalized status.
 * @returns The rank.
 * @example
 * ```ts
 * thermalRank("moderate"); // 2
 * ```
 */
export function thermalRank(status: ThermalStatus | null): number {
  return status === null ? -1 : THERMAL_STATUSES.indexOf(status);
}

/**
 * The ladder step just below a rate.
 *
 * @param ladder - The ladder, highest first.
 * @param fps - The rate.
 * @returns The step, or `undefined` at the bottom.
 * @example
 * ```ts
 * stepBelow([120, 60], 120); // 60
 * ```
 */
export function stepBelow(ladder: readonly number[], fps: number): number | undefined {
  const count = ladder.length;

  // Indexed: the rule runs per frame and makes no iterator.
  for (let index = 0; index < count; index += 1) {
    const step = ladder[index];

    if (step !== undefined && step < fps) return step;
  }

  return undefined;
}

/**
 * The ladder step just above a rate.
 *
 * @param ladder - The ladder, highest first.
 * @param fps - The rate.
 * @returns The step, or `undefined` at the top.
 * @example
 * ```ts
 * stepAbove([120, 60, 40, 30], 30); // 40
 * ```
 */
export function stepAbove(ladder: readonly number[], fps: number): number | undefined {
  for (let index = ladder.length - 1; index >= 0; index -= 1) {
    const step = ladder[index];

    if (step !== undefined && step > fps) return step;
  }

  return undefined;
}

/**
 * The rate a thermal status allows from a rate: the lowest step from `severe` on, the step below at `moderate`, the
 * rate itself below that.
 *
 * @param ladder - The ladder, highest first.
 * @param status - The thermal status.
 * @param fps - The rate it starts from.
 * @returns The rate.
 * @example
 * ```ts
 * thermalTarget([120, 60, 40, 30], "moderate", 120); // 60
 * ```
 */
export function thermalTarget(
  ladder: readonly number[],
  status: ThermalStatus | null,
  fps: number
): number {
  const rank = thermalRank(status);

  if (rank >= 3) return ladder.at(-1) ?? fps;
  if (rank === 2) return stepBelow(ladder, fps) ?? fps;

  return fps;
}
