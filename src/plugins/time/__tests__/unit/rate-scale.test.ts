import { afterEach, describe, expect, it, vi } from "vitest";
import { createScript, type FrameScript, type Script } from "./rate-script";

// ---------------------------------------------------------------------------
// Unit: the render scale of the adaptive frame rate (change 2026-10-18-memory-render
// B2) and the back-off of failed returns. A late window whose frames were light on
// the main thread is GPU-bound: the rule lowers the render scale before the rate
// and raises it first on the way back, after twice the dwell. A screen is modelled
// by the GPU time of its frame at scale 1: the pixels, and so the GPU time, go with
// the square of the scale, and a frame takes a whole number of vsyncs.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** One switch the rule made, as the script saw it. */
type Step = { at: number; fps: number; scale: number; reason: string; dwellMs: number };

/**
 * The interval of one frame on a screen: a whole number of vsyncs, at least one frame of the rate, at least the GPU
 * time at the scale now.
 *
 * @param s - The script.
 * @param gpuMs - The GPU time of a frame at scale 1.
 * @param hz - The panel.
 * @returns The interval, ms.
 */
function intervalOf(s: Script, gpuMs: number, hz: number): number {
  const { fps, scale } = s.api.rate();
  const vsync = 1000 / hz;
  const vsyncs = Math.max(Math.round(hz / fps), Math.ceil((gpuMs * scale * scale) / vsync - 1e-9));

  return vsyncs * vsync;
}

/**
 * Plays a screen for `ms` and notes every switch.
 *
 * @param s - The script.
 * @param gpuMs - The GPU time of a frame at scale 1.
 * @param ms - How long.
 * @param options - The frames' work and the panel.
 * @param options.frame - What every frame does; light by default.
 * @param options.hz - The panel; 120 when left out.
 * @returns The switches, in order.
 */
function screen(
  s: Script,
  gpuMs: number,
  ms: number,
  options: { frame?: FrameScript; hz?: number } = {}
): Step[] {
  const steps: Step[] = [];
  const end = s.last() + ms;

  while (s.last() < end) {
    const seen = s.changes().length;

    s.gap(intervalOf(s, gpuMs, options.hz ?? 120), options.frame);

    const change = s.changes()[seen];

    if (change !== undefined) {
      steps.push({
        at: s.last(),
        fps: change.to,
        scale: change.scale,
        reason: change.reason,
        dwellMs: change.dwellMs
      });
    }
  }

  return steps;
}

/**
 * The rate, the scale and the reason of each switch.
 *
 * @param steps - The switches.
 * @returns One triple per switch.
 */
function rungs(steps: readonly Step[]): Array<[number, number, string]> {
  return steps.map(step => [step.fps, step.scale, step.reason]);
}

/**
 * A 120 Hz phone whose renderer allows the scale down to 0.75, after a second of light frames at 120.
 *
 * @returns The script.
 */
function scaled(): Script {
  const s = createScript();

  s.api.allowScale(0.75);
  s.play(2000);

  return s;
}

/**
 * The first switch of late frames 17 ms apart at 120, each with the work `frame` gives it.
 *
 * @param frame - What the frame at an index does.
 * @returns The rate and the scale after the switch.
 */
function firstStep(frame: (index: number) => FrameScript): [number, number] {
  const s = scaled();

  for (let index = 0; s.changes().length === 0 && index < 1000; index += 1) s.gap(17, frame(index));

  const [change] = s.changes();

  return [change?.to ?? 0, change?.scale ?? 0];
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

describe("down on a GPU-bound screen", () => {
  it("lowers the scale before the rate: 1 → 0.85 → 0.75, then 120 → 60 at 0.75", () => {
    const s = scaled();

    expect(rungs(screen(s, 20, 3000))).toEqual([
      [120, 0.85, "missed"],
      [120, 0.75, "missed"],
      [60, 0.75, "missed"]
    ]);
    expect(s.api.rate()).toMatchObject({ fps: 60, scale: 0.75, reason: "missed" });
  });

  it("a late frame whose work took over three quarters of its frame is CPU-bound: the rate drops, the scale stays", () => {
    // Three quarters of 8.33 ms is 6.25 ms.
    expect(firstStep(() => ({ workMs: 6.2 }))).toEqual([120, 0.85]);
    expect(firstStep(() => ({ workMs: 6.3 }))).toEqual([60, 1]);
    // Two of three late frames busy is CPU-bound; one of three is not.
    expect(firstStep(index => ({ workMs: index % 3 === 0 ? 1 : 7 }))).toEqual([60, 1]);
    expect(firstStep(index => ({ workMs: index % 3 === 0 ? 7 : 1 }))).toEqual([120, 0.85]);
  });

  it("at the floor of the rate it lowers the scale when 60 cannot hold, never under the scale's floor", () => {
    const s = createScript({ config: { maxFps: 60 }, displayHz: 60 });

    s.api.allowScale(0.75);
    s.play(2500);

    expect(rungs(screen(s, 40, 5000, { hz: 60 }))).toEqual([
      [60, 0.85, "missed"],
      [60, 0.75, "missed"]
    ]);
    expect(s.api.rate()).toMatchObject({ fps: 60, scale: 0.75 });
  });

  it("never touches the scale while the renderer allows none", () => {
    const s = createScript();

    s.play(2000);

    expect(rungs(screen(s, 20, 3000))).toEqual([[60, 1, "missed"]]);
  });
});

describe("up again", () => {
  it("raises the scale first, a step after twice the dwell, then the rate after the dwell", () => {
    const s = scaled();
    const down = screen(s, 20, 3000);
    const up = screen(s, 4, 30_000);
    const [scaleUp, full, rate] = up;

    expect(rungs(up)).toEqual([
      [60, 0.85, "headroom"],
      [60, 1, "headroom"],
      [120, 1, "headroom"]
    ]);

    const droppedAt = down.at(-1)?.at ?? 0;

    expect((scaleUp?.at ?? 0) - droppedAt).toBeGreaterThanOrEqual(10_000);
    expect((scaleUp?.at ?? 0) - droppedAt).toBeLessThan(10_020);
    expect((full?.at ?? 0) - (scaleUp?.at ?? 0)).toBeGreaterThanOrEqual(10_000);
    expect((full?.at ?? 0) - (scaleUp?.at ?? 0)).toBeLessThan(10_020);
    expect((rate?.at ?? 0) - (full?.at ?? 0)).toBeGreaterThanOrEqual(5000);
    expect((rate?.at ?? 0) - (full?.at ?? 0)).toBeLessThan(5020);
  });

  it("raises the scale when the frames are too heavy for the higher rate: the scale costs the GPU, not the main thread", () => {
    const s = scaled();

    screen(s, 20, 3000);

    // 5 ms of work is heavy toward 120 (over 4.17 ms): the rate stays, the scale comes back.
    expect(rungs(screen(s, 4, 30_000, { frame: { workMs: 5 } }))).toEqual([
      [60, 0.85, "headroom"],
      [60, 1, "headroom"]
    ]);
  });
});

describe("the back-off of a failed return", () => {
  it("one failed climb doubles the dwell once, however many steps down follow it", () => {
    const s = scaled();

    screen(s, 20, 3000);
    screen(s, 4, 26_000);
    screen(s, 20, 3000);

    expect(dwells(s)).toEqual([5000, 5000, 5000, 10_000, 10_000, 10_000]);
  });

  it("a return that fails 20 s after it still doubles the dwell", () => {
    const s = createScript();

    s.play(2000);
    screen(s, 12, 1000);
    screen(s, 4, 6000);
    expect(s.api.rate().fps).toBe(120);

    screen(s, 4, 20_000);
    screen(s, 12, 1000);

    expect(dwells(s)).toEqual([5000, 10_000]);
  });

  it("under an alternation of heavy and light seconds the switches thin out to the longest dwell", () => {
    const s = scaled();
    const start = s.last();
    const steps: Step[] = [];

    while (s.last() < start + 600_000) {
      const heavy = Math.floor((s.last() - start) / 1000) % 2 === 0;

      steps.push(...screen(s, heavy ? 20 : 4, 1000 - ((s.last() - start) % 1000)));
    }

    // The scale 1 fails in every heavy second: each failed return doubles the wait for the next one, up to twice the
    // longest dwell (20, 40, 80, 160, then 240 s).
    const climbs = steps.filter(step => step.reason === "headroom").map(step => step.at);
    const waits = climbs.slice(1).map((at, index) => at - (climbs[index] ?? 0));

    expect(waits.every((wait, index) => wait >= (waits[index - 1] ?? 0))).toBe(true);
    expect(waits.at(-1)).toBeGreaterThanOrEqual(240_000);
    expect(steps.length).toBeLessThanOrEqual(16);
    expect(dwells(s).at(-1)).toBe(120_000);
  });
});

describe("a new scene", () => {
  it("starts the back-off over and judges the new screen on its own frames", () => {
    const s = createScript();

    s.play(2000);

    // Four failed climbs: the dwell is 40 s.
    while (dwells(s).length < 4) s.gap(s.api.rate().fps === 120 ? 17 : 20);
    expect(dwells(s).at(-1)).toBe(40_000);

    s.gaps(20, 300);
    expect(s.api.rate().fps).toBe(60);

    const sceneAt = s.last();

    s.api.sceneChanged();

    // The windows start empty: 90 drawn frames at 60 after the skipped first interval.
    const returnedAt = s.untilRate(120, 20);

    expect(returnedAt - sceneAt).toBeGreaterThanOrEqual(1820);
    expect(returnedAt - sceneAt).toBeLessThan(1900);

    s.untilRate(60, 17);

    expect(dwells(s).at(-1)).toBe(10_000);
  });
});

describe("what takes the scale back to 1", () => {
  it("a floor of 1 withdraws a lower scale at once, without time:rate", () => {
    const s = scaled();

    expect(rungs(screen(s, 12, 3000))).toEqual([
      [120, 0.85, "missed"],
      [120, 0.75, "missed"]
    ]);

    expect(s.api.allowScale(1)).toMatchObject({ fps: 120, scale: 1 });
    expect(s.changes()).toHaveLength(2);
  });

  it("a forced rate draws at scale 1", () => {
    const s = scaled();

    screen(s, 12, 3000);

    expect(s.api.setRate(60)).toMatchObject({ fps: 60, mode: "forced", scale: 1 });
    expect(s.changes().at(-1)).toMatchObject({ to: 60, reason: "forced", scale: 1 });
  });
});
