/* eslint-disable unicorn/no-null -- a frame rate is JSON: an unknown display and an absent shell are null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameMeasure } from "../../types";
import { createScript, type FrameScript, type Script } from "./rate-script";

// ---------------------------------------------------------------------------
// Unit: the governor of the adaptive frame rate (spec 21 G3): what counts as a
// sample, when the rate drops, when it returns, the dwell and its back-off, and
// what a stepped or resumed frame never feeds. Driven by a scripted frame source
// on a 120 Hz display; every interval is a timestamp the script chose.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const AT_120 = 1000 / 120;

/** The config of a ladder [120, 60, 40, 30]. */
const FLOOR_30 = { config: { adaptive: { floor: 30 } } } as const;

/**
 * A screen near the line at 120: eight late intervals a second, under the drop line (12) on their own.
 *
 * @param s - The script.
 * @param seconds - How long.
 */
function nearLine(s: Script, seconds: number): void {
  for (let index = 0; index < seconds * 120; index += 1) s.gap(index % 15 === 0 ? 17 : AT_120);
}

/**
 * Light frames that keep each rate on time: 8.3 ms apart at 120, 20 ms apart below.
 *
 * @param s - The script.
 * @param count - How many frames.
 * @param frame - What they do.
 */
function steady(s: Script, count: number, frame: FrameScript = {}): void {
  for (let index = 0; index < count; index += 1) {
    s.gap(s.api.rate().fps === 120 ? AT_120 : 20, frame);
  }
}

/**
 * A script whose display is known (one second of light frames at 120), then dropped to 60 at a whole-millisecond
 * tick, so the frames after it can be placed exactly.
 *
 * @param options - The options of the script.
 * @returns The script and the timestamp of the drop.
 */
function droppedTo60(options: Parameters<typeof createScript>[0] = {}): {
  s: Script;
  droppedAt: number;
} {
  const s = createScript(options);

  s.play(2000);
  s.tickAt(Math.ceil(s.last()) + 17);

  return { s, droppedAt: s.untilRate(60, 17) };
}

/**
 * Tells whether the drop window is late now: it turned late and has not cleared.
 *
 * @param s - The script.
 * @returns True while the window is late.
 */
function lateNow(s: Script): boolean {
  return !Number.isNaN(s.governor().lateSince);
}

/**
 * One second of light frames at 120, then `late` intervals of 12.6 ms in a row.
 *
 * @param late - How many late intervals.
 * @returns The script.
 */
function burst(late: number): Script {
  const s = createScript();

  s.play(2000);
  s.gaps(12.6, late);

  return s;
}

/**
 * A still screen that draws now and then: each drawn frame comes 16.7 ms late, then three undrawn frames.
 *
 * @param late - How many drawn frames.
 * @returns True when the drop window is late after them.
 */
function sparse(late: number): boolean {
  const s = createScript();

  s.play(2000);
  s.play(1100, { drawn: false });

  for (let index = 0; index < late; index += 1) {
    s.gap(AT_120);
    s.gap(16.7, { drawn: false });
    s.gaps(AT_120, 2, { drawn: false });
  }

  return lateNow(s);
}

/**
 * Twelve intervals of `gapMs` once the display is known, at 120 or at 60 (floor 30).
 *
 * @param gapMs - The interval.
 * @param at60 - Drop to 60 first.
 * @returns True when the drop window is late after them, or dropped on it.
 */
function twelveOf(gapMs: number, at60: boolean): boolean {
  const s = at60 ? droppedTo60(FLOOR_30).s : createScript();

  if (at60) s.gaps(1000 / 60, 60);
  else s.play(2000);

  s.gaps(gapMs, 12);

  // At 60, within 3 s of the drop, a late window drops at once.
  return lateNow(s) || s.api.rate().fps < (at60 ? 60 : 120);
}

/**
 * Undrawn frames past the dwell, then `drawn` drawn frames and one undrawn frame that ends the last interval.
 *
 * @param drawn - How many drawn frames.
 * @returns The rate after them.
 */
function afterDrawn(drawn: number): number {
  const { s } = droppedTo60();

  s.gaps(20, 260, { drawn: false });
  s.gaps(20, drawn);
  s.gap(20, { drawn: false });

  return s.api.rate().fps;
}

/**
 * Light frames at 60 with `late` intervals of 25 ms at 4 s after the drop, until 6 s after it.
 *
 * @param late - How many late intervals.
 * @returns The rate at 6 s.
 */
function afterLate(late: number): number {
  const { s } = droppedTo60();

  s.gaps(20, 200);
  s.gaps(25, late);
  steady(s, 100);

  return s.api.rate().fps;
}

/**
 * Frames for 8 s after the drop, the work of each from `workOf`.
 *
 * @param workOf - The work of the frame at an index.
 * @returns The rate after them.
 */
function afterWork(workOf: (index: number) => number): number {
  const { s } = droppedTo60();

  for (let index = 0; index < 400; index += 1) steady(s, 1, { workMs: workOf(index) });

  return s.api.rate().fps;
}

/**
 * A pause and a resume at 60 (floor 30), then `late` intervals of 25 ms.
 *
 * @param late - How many.
 * @returns The rate after them.
 */
function lateAfterResume(late: number): number {
  const { s } = droppedTo60(FLOOR_30);

  s.gaps(1000 / 60, 30);
  s.api.pause();
  s.api.resume();
  // The first frame after the resume has no interval; the next interval is the first after it.
  s.gap(20);
  s.gaps(25, late);

  return s.api.rate().fps;
}

/**
 * A GPU-bound screen whose JS is light: at 120 every interval is 17 ms (late), at 60 every frame is on time.
 *
 * @param s - The script.
 * @param until - Stop when this returns true.
 */
function probe(s: Script, until: () => boolean): void {
  for (let index = 0; index < 60_000 && !until(); index += 1) {
    s.gap(s.api.rate().fps === 120 ? 17 : 20);
  }
}

/**
 * The dwells of the drops so far.
 *
 * @param s - The script.
 * @returns `dwellMs` of every `missed` change.
 */
function dwells(s: Script): number[] {
  return s
    .changes()
    .filter(change => change.reason === "missed")
    .map(change => change.dwellMs);
}

describe("what counts as a sample", () => {
  it("a frame the renderer did not draw never counts as late", () => {
    const still = createScript();
    const drawn = createScript();

    still.play(1200);
    still.gaps(50, 60, { drawn: false });
    drawn.play(1200);
    drawn.gaps(50, 60);

    expect(still.api.rate().fps).toBe(120);
    expect(still.changes()).toEqual([]);
    expect(drawn.api.rate().fps).toBe(60);
  });

  it("a probed frame never feeds the rule", () => {
    const s = createScript();

    s.play(1200);
    s.gaps(50, 40, { probed: true });

    expect(s.api.rate().fps).toBe(120);
    expect(s.changes()).toEqual([]);
  });

  it("a frame under the idle cap never counts as late", () => {
    const s = createScript({ config: { idleFps: 30, idleAfterMs: 2000 } });

    s.play(5000);

    expect(s.api.snapshot().idle).toBe(true);
    expect(s.api.rate().fps).toBe(120);
    expect(s.changes()).toEqual([]);
  });

  it("an interval over 500 ms is not a sample", () => {
    const hidden = createScript();
    const short = createScript();

    hidden.play(2000);
    hidden.gap(2000);
    hidden.gaps(16.7, 7);
    short.play(2000);
    short.gap(400);
    short.gaps(16.7, 7);

    expect(hidden.governor().dropMissed).toBe(7);
    expect(short.governor().dropMissed).toBe(8);
    expect(lateNow(hidden)).toBe(false);
    expect(lateNow(short)).toBe(true);
  });

  it("the first interval after a switch is not judged", () => {
    const seven = droppedTo60(FLOOR_30).s;
    const eight = droppedTo60(FLOOR_30).s;

    // The first of them straddles the switch: 7 late intervals are judged, then 8.
    seven.gaps(25, 8);
    eight.gaps(25, 9);

    expect(seven.api.rate().fps).toBe(60);
    expect(eight.api.rate().fps).toBe(40);
  });

  it("a stepped frame never feeds the rule, and its drawn report is forgotten", () => {
    const s = createScript();
    const governor = s.governor();

    s.play(2000);

    const written = governor.written;

    for (let index = 0; index < 600; index += 1) s.api.step(16);

    expect(governor.written).toBe(written);

    // The interval after the last real frame is a sample; the one after the undrawn frame is not.
    s.gap(AT_120, { drawn: false });
    s.gap(30, { drawn: false });

    expect(governor.written).toBe(written + 1);
    expect(s.api.rate().fps).toBe(120);
  });

  it("without adaptive no clock is read, and the ticks only teach the display rate", () => {
    const s = createScript({ config: { maxFps: 60, adaptive: false } });
    const reads = s.clockReads();

    s.play(8400);

    expect(s.clockReads()).toBe(reads);
    expect(s.ctx.state.rate.governor).toBeUndefined();
    expect(s.api.rate()).toEqual({
      fps: 60,
      mode: "fixed",
      reason: "start",
      displayHz: 120,
      ladder: [],
      thermal: null,
      asked: 60,
      heldBy: null,
      scale: 1
    });
  });
});

describe("the drop", () => {
  it("the window turns late when 12 of the second's drawn intervals are late, not at 11 (p90 of a full window)", () => {
    expect(lateNow(burst(11))).toBe(false);
    expect(lateNow(burst(12))).toBe(true);
  });

  it("a burst of late intervals shorter than the hold never drops the rate (F64)", () => {
    const s = burst(40);

    s.gaps(AT_120, 240);

    expect(s.api.rate().fps).toBe(120);
    expect(s.changes()).toEqual([]);
    expect(lateNow(s)).toBe(false);
  });

  it("drops 120 → 60 once the window has been late for 2 s, not before", () => {
    const s = createScript();

    s.play(2000);
    s.gaps(12.6, 12);

    const lateAt = s.last();

    while (s.changes().length === 0) s.gap(12.6);

    expect(s.last() - lateAt).toBeGreaterThanOrEqual(2000);
    expect(s.last() - lateAt).toBeLessThan(2000 + 12.6);
    expect(s.api.rate()).toMatchObject({ fps: 60, mode: "auto", reason: "missed" });
    expect(s.changes()).toHaveLength(1);
    expect(s.changes()[0]).toMatchObject({
      from: 120,
      to: 60,
      reason: "missed",
      mode: "auto",
      displayHz: 120,
      thermal: null,
      window: { heavy: 0 },
      dwellMs: 5000
    });
    expect(s.changes()[0]?.window.missed).toBe(s.changes()[0]?.window.drawn);
    expect(s.log.info).toHaveBeenCalledWith("time: frame rate", {
      from: 120,
      to: 60,
      reason: "missed"
    });
  });

  it("a sparse window turns late at 8 late intervals, not at 7", () => {
    expect(sparse(7)).toBe(false);
    expect(sparse(8)).toBe(true);
  });

  it("a late interval is one past the half-period line", () => {
    expect(twelveOf(12.4, false)).toBe(false);
    expect(twelveOf(12.6, false)).toBe(true);
    expect(twelveOf(20.8, true)).toBe(false);
    expect(twelveOf(25, true)).toBe(true);
  });

  it("one mount of three 58 ms frames never drops the rate", () => {
    const s = createScript();

    s.play(2000);
    s.gaps(58, 3);
    s.play(2000);

    expect(s.api.rate().fps).toBe(120);
  });

  it("a mount burst on a screen near the line keeps 120; a sustained slow run drops it once (F64)", () => {
    const near = createScript();
    const slow = createScript();

    near.play(2000);
    nearLine(near, 2);
    // A mount: three long frames and two late ones after it, a window of 13 late in the second.
    near.gaps(58, 3);
    near.gaps(12.6, 2);
    nearLine(near, 4);
    slow.play(2000);
    slow.gaps(17, 300);

    expect(near.api.rate().fps).toBe(120);
    expect(near.changes()).toHaveLength(0);
    expect(slow.api.rate().fps).toBe(60);
    expect(slow.changes()).toHaveLength(1);
  });

  it("never drops below the floor", () => {
    const { s } = droppedTo60();

    s.gaps(25, 120);

    expect(s.api.rate().fps).toBe(60);
    expect(s.changes()).toHaveLength(1);
  });
});

describe("the return", () => {
  it("does not return before the dwell: 4999 ms after the drop no, at 5000 ms yes", () => {
    const early = droppedTo60();
    const due = droppedTo60();

    early.s.gaps(20, 249);
    early.s.tickAt(early.droppedAt + 4999);
    due.s.gaps(20, 250);

    expect(early.s.last()).toBe(early.droppedAt + 4999);
    expect(early.s.api.rate().fps).toBe(60);
    expect(due.s.last()).toBe(due.droppedAt + 5000);
    expect(due.s.api.rate()).toMatchObject({ fps: 120, reason: "headroom" });
  });

  it("does not return without 90 drawn frames in 3 s", () => {
    expect(afterDrawn(89)).toBe(60);
    expect(afterDrawn(90)).toBe(120);
  });

  it("does not return with two late intervals at the lower rate", () => {
    expect(afterLate(2)).toBe(60);
    expect(afterLate(1)).toBe(120);
  });

  it("a frame with work over half of the higher rate's frame is heavy", () => {
    // The line toward 120 is 4.1667 ms.
    expect(afterWork(() => 4.16)).toBe(120);
    expect(afterWork(() => 4.18)).toBe(60);
    // More than a tenth of heavy frames blocks the return; a twelfth does not.
    expect(afterWork(index => (index % 12 === 0 ? 5 : 1))).toBe(120);
    expect(afterWork(index => (index % 5 === 0 ? 5 : 1))).toBe(60);
  });

  it("returns one step at a time", () => {
    const s = createScript(FLOOR_30);

    s.play(2000);
    s.untilRate(60, 17);
    s.untilRate(40, 25);
    s.untilRate(30, 35);
    s.untilRate(40, 32.5);

    expect(s.governor().ladder).toEqual([120, 60, 40, 30]);
    expect(s.changes().at(-1)).toMatchObject({ from: 30, to: 40, reason: "headroom" });
  });
});

describe("the work of a frame", () => {
  it("is read where the render phase ends, never after the measure listeners", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const measured = droppedTo60();
    const plain = droppedTo60();

    // The listeners take 5 ms after the 3 ms of the phases: the work stays 3 ms, under the line of 4.17.
    measured.s.api.measure(() => measured.s.advance(5));
    steady(measured.s, 260, { workMs: 3 });

    const reads = plain.s.clockReads();

    plain.s.gaps(20, 50, { workMs: 3 });

    expect(measured.s.governor().lastWorkMs).toBeCloseTo(3, 5);
    expect(measured.s.api.rate().fps).toBe(120);
    // The plain path reads the clock once per run frame, right after the phases.
    expect(plain.s.clockReads() - reads).toBe(50);
    steady(plain.s, 210, { workMs: 3 });
    expect(plain.s.api.rate().fps).toBe(120);
  });

  it("a debug build leaves the overlay's span out of the heavy check, a store build does not", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const charged = droppedTo60();
    const uncharged = droppedTo60();

    steady(charged.s, 260, { workMs: 5, charge: 2 });
    steady(uncharged.s, 260, { workMs: 5 });

    expect(charged.s.api.rate().fps).toBe(120);
    expect(uncharged.s.api.rate().fps).toBe(60);

    // A charge between two frames counts for the next frame only.
    const between = droppedTo60();

    between.s.gap(20, { workMs: 5 });
    between.s.api.chargeAgent(2);
    between.s.gap(20, { workMs: 5 });
    expect(between.s.governor().lastWorkMs).toBeCloseTo(3, 5);
    between.s.gap(20, { workMs: 5 });
    expect(between.s.governor().lastWorkMs).toBeCloseTo(5, 5);

    vi.stubGlobal("__MOKU_GAME_AGENT__", false);
    const store = droppedTo60();

    steady(store.s, 260, { workMs: 5, charge: 2 });
    expect(store.s.api.rate().fps).toBe(60);
  });

  it("the measure record's rateMs follows the rate from the frame of the switch", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const s = createScript();
    const rates: number[] = [];

    s.api.measure((frame: Readonly<FrameMeasure>) => rates.push(frame.rateMs));
    s.play(2000);
    s.untilRate(60, 17);

    expect(rates.at(-2)).toBeCloseTo(1000 / 120, 5);
    expect(rates.at(-1)).toBeCloseTo(1000 / 60, 5);
  });
});

describe("the dwell", () => {
  it("a drop within 10 s of a return doubles the dwell, up to 120 s", () => {
    const s = createScript();

    s.play(2000);
    probe(s, () => dwells(s).length === 7);

    expect(dwells(s)).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
  });

  it("a returned rate held 60 s resets the dwell to 5 s at its next drop", () => {
    const s = createScript();

    s.play(2000);
    // The first drop, a failed probe (dwell 10 s), then the next return.
    probe(s, () => s.changes().length === 4);
    expect(s.api.rate().fps).toBe(120);

    s.play(60_000);
    s.untilRate(60, 17);

    expect(dwells(s)).toEqual([5000, 10_000, 5000]);
  });

  it("an alternation of heavy and light 3 s spans never flaps past the dwell back-off", () => {
    const s = createScript();

    s.play(2000);

    const start = s.last();

    while (s.last() < start + 600_000) {
      const heavy = Math.floor((s.last() - start) / 3000) % 2 === 0;

      if (s.api.rate().fps === 120) s.gap(heavy ? 17 : AT_120);
      else s.gap(20);
    }

    // Returns at 5, 15, 35, 75, 155, 275, 395 and 515 s, each followed by a drop: 1 + 2 × 8.
    expect(s.changes().length).toBeLessThanOrEqual(17);
    expect(s.changes().length).toBeGreaterThan(10);
    expect(dwells(s).at(-1)).toBe(120_000);
  });
});

describe("a resume", () => {
  it("restarts the windows: evidence from before the pause never returns the rate", () => {
    const { s, droppedAt } = droppedTo60();

    s.gaps(20, 245);
    s.api.pause();
    s.api.resume();
    s.gaps(20, 30);

    // Past the dwell, with 28 samples since the resume: before the pause the window held 240.
    expect(s.last() - droppedAt).toBeGreaterThan(5400);
    expect(s.api.rate().fps).toBe(60);

    steady(s, 70);
    expect(s.api.rate().fps).toBe(120);
  });

  it("the first interval after a resume is not judged", () => {
    expect(lateAfterResume(8)).toBe(60);
    expect(lateAfterResume(9)).toBe(40);
  });
});
