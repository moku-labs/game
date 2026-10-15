/* eslint-disable unicorn/no-null -- `FrameRate` and `RateChange` are JSON: an unknown display rate and an absent thermal status are null (spec 21 G1.3). */
/**
 * @file time — the adaptive frame rate (spec 21 G3–G6): the governor that drops to the next divisor of the display
 * rate when drawn frames come late and returns one step after steady room, the display rate it learns from the ticks
 * and the native shell, the thermal input, and `setRate`. Every number of the per-frame path lives in the governor,
 * allocated once; a frame allocates nothing here. Only a switch allocates: its payload, the snapshot, the request.
 */
import { pageNow } from "./measure";
import {
  followNativeRate,
  handBackRate,
  hertzOf,
  type NativeShell,
  nativeShell,
  type RateAnswer,
  readingOf,
  watchThermal
} from "./native";
import {
  DISPLAY_LOWER_WINDOWS,
  DISPLAY_RATES,
  DISPLAY_SHARE,
  DISPLAY_WINDOW_TICKS,
  DROP_MIN_MISSES,
  DROP_SHARE,
  DROP_WINDOW_MS,
  DWELL_BASE_MS,
  DWELL_MAX_MS,
  displayIndexOf,
  HOLD_RESET_MS,
  INTERVAL_IGNORE_MS,
  ladderOf,
  missLineMs,
  RETURN_GRACE_MS,
  RETURN_HEAVY_SHARE,
  RETURN_MAX_MISSES,
  RETURN_MIN_FRAMES,
  RETURN_WINDOW_MS,
  RETURN_WORK_SHARE,
  RING,
  stepAbove,
  stepBelow,
  TICK_IGNORE_MS,
  thermalOf,
  thermalRank,
  thermalTarget
} from "./rate-rules";
import type {
  Config,
  FrameRate,
  Governor,
  RateChange,
  RateChoice,
  RateMode,
  RateReason,
  RateState,
  State,
  ThermalReading,
  ThermalStatus,
  TimeCtx
} from "./types";

/** The ladder before the display rate is known, and always without `adaptive`. */
const NO_STEPS: readonly number[] = Object.freeze([]);

/** Bit of a sample that came late. */
const MISSED = 1;

/** Bit of a sample whose frame was heavy for the higher rate. */
const HEAVY = 2;

/** What a promise of the shell that nobody reads settles into. */
const ignore = (): void => {};

/**
 * Refuses an `adaptive` that is not `false` or `{ floor: 30 | 60 }`, and a floor above `maxFps`.
 *
 * @param config - Resolved plugin config.
 * @returns The floor, or `undefined` without `adaptive`.
 * @throws {Error} When the value or its floor is wrong.
 */
function floorOf(config: Readonly<Config>): number | undefined {
  // A game written in plain JS passes anything: the config is a boundary.
  const value: unknown = config.adaptive;

  if (value === false) return undefined;

  const floor: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "floor") : undefined;

  if (floor !== 30 && floor !== 60) {
    throw new Error(
      `[game] time.adaptive is ${String(JSON.stringify(value))}.\n  Give false, or { floor: 60 } (or 30).`
    );
  }

  if (floor > config.maxFps) {
    throw new Error(
      `[game] time.adaptive.floor is ${String(floor)}, above time.maxFps ${String(config.maxFps)}.\n` +
        "  Give a floor at or below maxFps."
    );
  }

  return floor;
}

/**
 * Allocates the governor once: every number and typed array the rule reads per frame.
 *
 * @param floor - The lowest rate the rule may choose.
 * @returns A fresh governor.
 */
function createGovernor(floor: number): Governor {
  return {
    floor,
    displayHz: null,
    ladder: NO_STEPS,
    thermal: null,
    lastTickAt: Number.NaN,
    ticks: 0,
    tickCounts: new Uint16Array(DISPLAY_RATES.length),
    lowerStreak: 0,
    lastDrawn: false,
    lastIdle: false,
    lastProbed: false,
    lastWorkMs: 0,
    lastFps: 0,
    skipNext: true,
    sampleAt: new Float64Array(RING),
    sampleFlags: new Uint8Array(RING),
    written: 0,
    dropTail: 0,
    dropDrawn: 0,
    dropMissed: 0,
    returnTail: 0,
    returnDrawn: 0,
    returnMissed: 0,
    returnHeavy: 0,
    switchedAt: Number.NEGATIVE_INFINITY,
    lastReturnAt: Number.NEGATIVE_INFINITY,
    dwellMs: DWELL_BASE_MS,
    requested: 0,
    requestSeq: 0
  };
}

/**
 * The frozen object `rate()` answers, built from the rate now.
 *
 * @param rate - The rate, its mode, its reason and the governor.
 * @returns A fresh frozen snapshot.
 */
function snapshotOf(
  rate: Pick<RateState, "fps" | "mode" | "reason" | "governor">
): Readonly<FrameRate> {
  const { governor } = rate;

  return Object.freeze({
    fps: rate.fps,
    mode: rate.mode,
    reason: rate.reason,
    displayHz: governor?.displayHz ?? null,
    ladder: governor?.ladder ?? NO_STEPS,
    thermal: governor?.thermal ?? null
  });
}

/**
 * Creates the rate state of a time plugin: `maxFps` in mode `"auto"` with a governor when `adaptive` is configured,
 * in mode `"fixed"` without one. Validates `adaptive` at `createApp`, in every build.
 *
 * @param config - Resolved plugin config.
 * @returns The rate branch of the time state.
 * @throws {Error} When `adaptive` is wrong.
 */
export function createRateState(config: Readonly<Config>): RateState {
  const floor = floorOf(config);
  const mode: RateMode = floor === undefined ? "fixed" : "auto";
  const parts: Pick<RateState, "fps" | "mode" | "reason" | "governor"> = {
    fps: config.maxFps,
    mode,
    reason: "start",
    governor: floor === undefined ? undefined : createGovernor(floor)
  };

  return {
    ...parts,
    drawnNow: false,
    probedNow: false,
    snapshot: snapshotOf(parts),
    native: undefined
  };
}

/**
 * The page clock for a switch outside a frame: `pageNow()`, or 0 where the platform has no `performance`.
 *
 * @returns The page clock, ms.
 */
function nowOf(): number {
  return typeof globalThis.performance === "undefined" ? 0 : pageNow();
}

/**
 * Empties both windows: evidence of one rate never judges another, and a resume is a new situation.
 *
 * @param g - The governor.
 */
function emptyWindows(g: Governor): void {
  g.dropTail = g.written;
  g.dropDrawn = 0;
  g.dropMissed = 0;
  g.returnTail = g.written;
  g.returnDrawn = 0;
  g.returnMissed = 0;
  g.returnHeavy = 0;
}

/**
 * Takes the oldest sample of the drop window out of its counts.
 *
 * @param g - The governor.
 */
function dropOldest(g: Governor): void {
  const flags = g.sampleFlags[g.dropTail % RING] ?? 0;

  g.dropDrawn -= 1;
  if ((flags & MISSED) !== 0) g.dropMissed -= 1;
  g.dropTail += 1;
}

/**
 * Takes the oldest sample of the return window out of its counts.
 *
 * @param g - The governor.
 */
function returnOldest(g: Governor): void {
  const flags = g.sampleFlags[g.returnTail % RING] ?? 0;

  g.returnDrawn -= 1;
  if ((flags & MISSED) !== 0) g.returnMissed -= 1;
  if ((flags & HEAVY) !== 0) g.returnHeavy -= 1;
  g.returnTail += 1;
}

/**
 * Moves both windows to the page time `at`: samples older than a window leave its counts. A full ring gives up its
 * oldest sample first (it cannot fill at 120 fps; the guard keeps the ring honest).
 *
 * @param g - The governor.
 * @param at - The page time of the new sample.
 */
function evict(g: Governor, at: number): void {
  if (g.written - g.returnTail >= RING) {
    if (g.dropTail === g.returnTail) dropOldest(g);
    returnOldest(g);
  }

  while (g.dropTail < g.written && (g.sampleAt[g.dropTail % RING] ?? at) < at - DROP_WINDOW_MS) {
    dropOldest(g);
  }

  while (
    g.returnTail < g.written &&
    (g.sampleAt[g.returnTail % RING] ?? at) < at - RETURN_WINDOW_MS
  ) {
    returnOldest(g);
  }
}

/**
 * The evidence of a switch for its payload: the drop window for a drop, the return window for a return, zeros for a
 * reason that reads none.
 *
 * @param g - The governor, or `undefined` without `adaptive`.
 * @param reason - The reason of the switch.
 * @returns The window of the payload.
 */
function evidenceOf(g: Governor | undefined, reason: RateReason): RateChange["window"] {
  if (g !== undefined && reason === "missed") {
    return { drawn: g.dropDrawn, missed: g.dropMissed, heavy: 0 };
  }

  if (g !== undefined && reason === "headroom") {
    return { drawn: g.returnDrawn, missed: g.returnMissed, heavy: g.returnHeavy };
  }

  return { drawn: 0, missed: 0, heavy: 0 };
}

/**
 * The dwell's bookkeeping of a switch: a drop soon after a return doubles it (a failed return), a drop after a long
 * hold resets it, a return notes when it happened, `setRate` starts it over; the display and the heat leave it.
 *
 * @param g - The governor.
 * @param reason - The reason of the switch.
 * @param at - When the switch happens.
 */
function keepDwell(g: Governor, reason: RateReason, at: number): void {
  switch (reason) {
    case "missed": {
      const held = at - g.lastReturnAt;

      if (held < RETURN_GRACE_MS) g.dwellMs = Math.min(2 * g.dwellMs, DWELL_MAX_MS);
      else if (held >= HOLD_RESET_MS) g.dwellMs = DWELL_BASE_MS;
      break;
    }
    case "headroom": {
      g.lastReturnAt = at;
      break;
    }
    case "forced":
    case "auto": {
      g.dwellMs = DWELL_BASE_MS;
      g.lastReturnAt = Number.NEGATIVE_INFINITY;
      break;
    }
    default: {
      // "display", "thermal" and "start" leave the dwell as it is.
      break;
    }
  }
}

/**
 * Reads the shell's answer to a request: a stale one (a newer request went out) and one after stop are ignored;
 * `maxHz`, the panel's highest rate, is the display rate. `panelHz`, the rate set now, is only logged.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param seq - The sequence number of the request.
 * @param answer - The answer.
 */
function readAnswer(ctx: TimeCtx, g: Governor, seq: number, answer: RateAnswer): void {
  if (seq !== g.requestSeq || ctx.state.rate.native === undefined) return;

  ctx.log.debug("time: the panel rate", { asked: g.requested, ...answer });

  if (answer.maxHz !== null) learnDisplay(ctx, g, answer.maxHz, nowOf());
}

/**
 * Asks the shell for the rate now; with a governor, notes the request and its sequence number for the answer.
 *
 * @param ctx - Domain context of the time plugin.
 */
function requestRate(ctx: TimeCtx): void {
  const { rate } = ctx.state;
  const g = rate.governor;

  if (rate.native === undefined) return;

  if (g === undefined) {
    followNativeRate(ctx, ignore);

    return;
  }

  g.requested = rate.fps;
  g.requestSeq += 1;

  const seq = g.requestSeq;

  followNativeRate(ctx, answer => readAnswer(ctx, g, seq, answer));
}

/**
 * The one place the rate or its mode changes (the governor, the display, the heat and `setRate` call it). Nothing
 * when both stay. Otherwise the dwell is kept, both windows are emptied and the next interval is skipped, the
 * snapshot is rebuilt, `time:rate` is emitted with the evidence, the change is logged and the shell is asked for the
 * new rate. The new cap applies from the next tick: the frame that is due still runs.
 *
 * @param ctx - Domain context of the time plugin.
 * @param to - The new rate.
 * @param mode - The new mode.
 * @param reason - Why.
 * @param at - When, on the page clock.
 */
function switchRate(
  ctx: TimeCtx,
  to: number,
  mode: RateMode,
  reason: RateReason,
  at: number
): void {
  const { rate } = ctx.state;

  if (to === rate.fps && mode === rate.mode) return;

  const g = rate.governor;
  const from = rate.fps;
  const evidence = evidenceOf(g, reason);

  if (g !== undefined) {
    keepDwell(g, reason, at);
    g.switchedAt = at;
    g.skipNext = true;
    emptyWindows(g);
  }

  rate.fps = to;
  rate.mode = mode;
  rate.reason = reason;
  rate.snapshot = snapshotOf(rate);

  ctx.emit("time:rate", {
    from,
    to,
    reason,
    mode,
    displayHz: g?.displayHz ?? null,
    thermal: g?.thermal ?? null,
    window: evidence,
    dwellMs: g?.dwellMs ?? 0
  });
  ctx.log.info("time: frame rate", { from, to, reason });
  requestRate(ctx);
}

/**
 * Drops on heat in mode `"auto"` with a known ladder: `severe` and above to the lowest step, `moderate` one step.
 * Nothing when the rate is already there; a forced rate stays.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 */
function applyThermal(ctx: TimeCtx, g: Governor): void {
  const { rate } = ctx.state;

  if (rate.mode !== "auto" || g.ladder.length === 0) return;

  const to = thermalTarget(g.ladder, g.thermal, rate.fps);

  if (to < rate.fps) switchRate(ctx, to, "auto", "thermal", nowOf());
}

/**
 * Stores a new thermal status of the shell and applies it. A status the shell sent wrong, and the same status
 * again, change nothing.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param status - The normalized status.
 */
function noteThermal(ctx: TimeCtx, g: Governor, status: ThermalStatus | null): void {
  if (status === null || status === g.thermal) return;

  g.thermal = status;
  ctx.state.rate.snapshot = snapshotOf(ctx.state.rate);
  applyThermal(ctx, g);
}

/**
 * The thermal status of a reading: its status, or Android's when the top one is left out.
 *
 * @param reading - The normalized reading.
 * @returns The status, or `null`.
 */
function statusOf(reading: ThermalReading): ThermalStatus | null {
  return thermalOf(reading.status ?? reading.android?.status);
}

/**
 * Learns a display rate: the ladder follows it, and in mode `"auto"` a rate that is not on the new ladder moves to
 * the highest step at or below it (the lowest when none is), reason `"display"`. A rising display never raises the
 * rate by itself. The first ladder also applies a thermal reading that came before it.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param hz - The display rate.
 * @param at - When, on the page clock.
 */
function learnDisplay(ctx: TimeCtx, g: Governor, hz: number, at: number): void {
  if (hz === g.displayHz) return;

  const { rate } = ctx.state;
  const first = g.ladder.length === 0;

  g.displayHz = hz;
  g.ladder = ladderOf(hz, ctx.config.maxFps, g.floor);
  rate.snapshot = snapshotOf(rate);

  if (rate.mode !== "auto") return;

  if (!g.ladder.includes(rate.fps)) {
    const to = g.ladder.find(step => step <= rate.fps) ?? g.ladder.at(-1) ?? rate.fps;

    switchRate(ctx, to, "auto", "display", at);
  }

  if (first) applyThermal(ctx, g);
}

/**
 * Tells whether the panel runs below its top on our own request: a panel the shell set to 60 Hz because we asked
 * for 60 shows 16.7 ms ticks that must not erase what it can do.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @returns True while the shell holds the panel below the ladder's top for us.
 */
function heldByUs(ctx: TimeCtx, g: Governor): boolean {
  return ctx.state.rate.native !== undefined && g.requested < (g.ladder[0] ?? 0);
}

/**
 * Closes a display window: the highest rate with a quarter of its ticks is what the panel showed. A higher or a first
 * rate is learned at once; a lower one only after two windows in a row, and never while the shell holds the panel
 * low for us.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param at - The timestamp of the tick that closed it.
 */
function closeDisplayWindow(ctx: TimeCtx, g: Governor, at: number): void {
  const need = DISPLAY_SHARE * g.ticks;
  let windowHz = 0;

  for (let index = DISPLAY_RATES.length - 1; index >= 0 && windowHz === 0; index -= 1) {
    if ((g.tickCounts[index] ?? 0) >= need) windowHz = DISPLAY_RATES[index] ?? 0;
  }

  g.ticks = 0;
  g.tickCounts.fill(0);

  if (windowHz !== 0 && (g.displayHz === null || windowHz > g.displayHz)) {
    g.lowerStreak = 0;
    learnDisplay(ctx, g, windowHz, at);
  } else if (windowHz !== 0 && windowHz < (g.displayHz ?? 0) && !heldByUs(ctx, g)) {
    g.lowerStreak += 1;

    if (g.lowerStreak >= DISPLAY_LOWER_WINDOWS) {
      g.lowerStreak = 0;
      learnDisplay(ctx, g, windowHz, at);
    }
  } else {
    g.lowerStreak = 0;
  }
}

/**
 * Counts one tick of the frame source, run or skipped, for the display rate: the cap skips frames inside the
 * callback, so the ticks show the panel's period at any rate. A tick after a hitch or a hidden page is not counted.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param timestamp - The tick's `requestAnimationFrame` timestamp.
 */
export function observeTick(ctx: TimeCtx, g: Governor, timestamp: number): void {
  const tickMs = timestamp - g.lastTickAt;

  g.lastTickAt = timestamp;

  if (!(tickMs > 0 && tickMs <= TICK_IGNORE_MS)) return;

  const index = displayIndexOf(tickMs);

  g.ticks += 1;
  if (index !== -1) g.tickCounts[index] = (g.tickCounts[index] ?? 0) + 1;
  if (g.ticks >= DISPLAY_WINDOW_TICKS) closeDisplayWindow(ctx, g, timestamp);
}

/**
 * Tells whether the interval that ended now is a sample: the frame was drawn, not idle-capped, not a warm-up frame,
 * ran at the rate now, under the rule, on a known display, and the page was not away.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param intervalMs - The interval.
 * @returns True for a sample.
 */
function isSample(ctx: TimeCtx, g: Governor, intervalMs: number): boolean {
  const { rate } = ctx.state;

  return (
    g.lastDrawn &&
    !g.lastIdle &&
    !g.lastProbed &&
    intervalMs <= INTERVAL_IGNORE_MS &&
    g.lastFps === rate.fps &&
    rate.mode === "auto" &&
    g.displayHz !== null
  );
}

/**
 * Decides on the windows after a sample: down one step when late intervals reach `max(8, 10 %)` of the second's,
 * up one step after the dwell with 90 steady drawn frames in three seconds, at most one late and a tenth heavy, and
 * no heat.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param at - The page time of the sample.
 */
function decide(ctx: TimeCtx, g: Governor, at: number): void {
  const { fps } = ctx.state.rate;
  const lower = stepBelow(g.ladder, fps);
  const higher = stepAbove(g.ladder, fps);

  if (
    lower !== undefined &&
    g.dropMissed >= Math.max(DROP_MIN_MISSES, Math.ceil(DROP_SHARE * g.dropDrawn))
  ) {
    switchRate(ctx, lower, "auto", "missed", at);
  } else if (
    higher !== undefined &&
    thermalRank(g.thermal) < 2 &&
    at - g.switchedAt >= g.dwellMs &&
    g.returnDrawn >= RETURN_MIN_FRAMES &&
    g.returnMissed <= RETURN_MAX_MISSES &&
    g.returnHeavy <= Math.floor(RETURN_HEAVY_SHARE * g.returnDrawn)
  ) {
    switchRate(ctx, higher, "auto", "headroom", at);
  }
}

/**
 * Judges the interval from the last run frame's start to this one: the first after a change is skipped, one that is
 * not a sample is dropped, otherwise it goes into both windows (late past the line, heavy for the higher rate) and
 * the rule decides.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param intervalMs - The interval, ms.
 * @param at - The timestamp that ends it.
 */
export function judgeFrame(ctx: TimeCtx, g: Governor, intervalMs: number, at: number): void {
  if (g.skipNext) {
    g.skipNext = false;

    return;
  }

  if (!isSample(ctx, g, intervalMs)) return;

  const { fps } = ctx.state.rate;
  const higher = stepAbove(g.ladder, fps);
  const missed = intervalMs > missLineMs(fps, g.displayHz ?? fps);
  const heavy = higher !== undefined && g.lastWorkMs > (RETURN_WORK_SHARE * 1000) / higher;
  const slot = g.written % RING;

  evict(g, at);
  g.sampleAt[slot] = at;
  g.sampleFlags[slot] = (missed ? MISSED : 0) | (heavy ? HEAVY : 0);
  g.written += 1;
  g.dropDrawn += 1;
  g.returnDrawn += 1;

  if (missed) {
    g.dropMissed += 1;
    g.returnMissed += 1;
  }

  if (heavy) g.returnHeavy += 1;

  decide(ctx, g, at);
}

/**
 * Notes what the frame that just ran left for the judgment of its interval: drawn, idle, a warm-up frame, its rate,
 * and its work. In an agent build the agent's own spans charged to the frame are left out of the work.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param workMs - From the frame's start to the end of its `render` phase.
 */
export function closeFrame(ctx: TimeCtx, g: Governor, workMs: number): void {
  const { rate } = ctx.state;
  let agentMs = 0;

  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    agentMs = ctx.state.measure?.agentMs ?? 0;
  }

  g.lastDrawn = rate.drawnNow;
  g.lastIdle = ctx.state.idle;
  g.lastProbed = rate.probedNow;
  g.lastFps = rate.fps;
  g.lastWorkMs = Math.max(0, workMs - agentMs);
}

/**
 * Restarts the tick history and both windows after a resume, and skips the next interval: a return from the
 * background is a new situation.
 *
 * @param g - The governor.
 */
export function resetGovernor(g: Governor): void {
  g.lastTickAt = Number.NaN;
  g.ticks = 0;
  g.tickCounts.fill(0);
  g.lowerStreak = 0;
  g.skipNext = true;
  emptyWindows(g);
}

/**
 * Tells whether a value is a choice of `setRate`.
 *
 * @param value - What the caller passed.
 * @returns True for `"auto"`, 30, 60 or 120.
 */
function isChoice(value: unknown): value is RateChoice {
  return value === "auto" || value === 30 || value === 60 || value === 120;
}

/**
 * The rate `"auto"` gives back with a governor: the ladder's top, a step lower under heat, or `maxFps` before the
 * display is known.
 *
 * @param g - The governor.
 * @param maxFps - The config's cap.
 * @returns The rate.
 */
function autoRate(g: Governor, maxFps: number): number {
  const top = g.ladder[0];

  return top === undefined ? maxFps : thermalTarget(g.ladder, g.thermal, top);
}

/**
 * Forces the rate (the exact cap, never above `maxFps`) or gives it back to the config with `"auto"`.
 *
 * @param ctx - Domain context of the time plugin.
 * @param choice - `"auto"`, 30, 60 or 120.
 * @returns The frame rate after the call.
 * @throws {Error} When `choice` is none of them.
 */
export function setRateChoice(ctx: TimeCtx, choice: RateChoice): Readonly<FrameRate> {
  const value: unknown = choice;

  if (!isChoice(value)) {
    throw new Error(
      `[game] time.setRate takes "auto", 30, 60 or 120.\n  Pass one of them, not ${String(value)}.`
    );
  }

  const { rate } = ctx.state;
  const { maxFps } = ctx.config;
  const g = rate.governor;

  if (value !== "auto") {
    switchRate(ctx, Math.min(value, maxFps), "forced", "forced", nowOf());
  } else if (rate.mode === "forced") {
    if (g === undefined) switchRate(ctx, maxFps, "fixed", "auto", nowOf());
    else switchRate(ctx, autoRate(g, maxFps), "auto", "auto", nowOf());
  }

  return rate.snapshot;
}

/**
 * Learns the panel's highest rate from the shell's `display.maxHz`: now when it is filled, else once the shell is
 * ready (null until then, native's contract). A null `maxHz` leaves the display to the ticks.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param shell - The shell found at start.
 */
function learnMaxHz(ctx: TimeCtx, g: Governor, shell: NativeShell): void {
  const now = hertzOf(shell.display.maxHz);

  if (now !== null) {
    learnDisplay(ctx, g, now, nowOf());

    return;
  }

  shell.ready?.then(() => {
    const later = hertzOf(nativeShell()?.display.maxHz);

    if (later !== null && ctx.state.rate.native !== undefined) learnDisplay(ctx, g, later, nowOf());
  }, ignore);
}

/**
 * Reads the shell's thermal status once at start, for the governor only (the monitor's header reads the shell
 * itself). A reader that throws or rejects gives no input.
 *
 * @param ctx - Domain context of the time plugin.
 * @param g - The governor.
 * @param shell - The shell found at start.
 */
function readThermal(ctx: TimeCtx, g: Governor, shell: NativeShell): void {
  const { thermal } = shell;

  if (thermal === undefined) return;

  try {
    Promise.resolve(thermal.read()).then(answer => {
      if (ctx.state.rate.native !== undefined) noteThermal(ctx, g, statusOf(readingOf(answer)));
    }, ignore);
  } catch {
    // A shell that cannot read its temperature gives the rule no thermal input.
  }
}

/**
 * The rate's part of `onStart`, after the loop: the shell link, the first request of the rate, the one thermal
 * listener (with the governor's input when there is one), and with a governor the shell's `maxHz` and one thermal
 * read. Without a shell nothing happens.
 *
 * @param ctx - Domain context of the time plugin.
 */
export function startRate(ctx: TimeCtx): void {
  const { rate } = ctx.state;
  const shell = nativeShell();
  const g = rate.governor;

  rate.native = shell;

  if (shell === undefined) return;

  requestRate(ctx);
  watchThermal(
    ctx,
    g === undefined ? undefined : reading => noteThermal(ctx, g, statusOf(reading))
  );

  if (g === undefined) return;

  learnMaxHz(ctx, g, shell);
  readThermal(ctx, g, shell);
}

/**
 * The rate's part of `onStop`: hands the frame rate back to the shell and forgets it, so a late answer or reading
 * changes nothing. Works on the state alone, because `onStop` has no context.
 *
 * @param state - State of the time plugin.
 */
export function stopRate(state: State): void {
  const shell = state.rate.native;

  state.rate.native = undefined;

  if (shell !== undefined) handBackRate(shell);
}
