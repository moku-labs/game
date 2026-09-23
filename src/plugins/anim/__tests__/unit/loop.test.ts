import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { defineMotion } from "../../motion";
import type { MotionKeyframe } from "../../types";
import { createViewProbe, poseOf, stepProbe } from "./view-probe";

// ---------------------------------------------------------------------------
// Unit test: the `loop` of `defineMotion` on the real tween driver. Delta 6, item B6.
// ---------------------------------------------------------------------------

/** A bob of 1 s: out to 20 u right, tilted and grown, and home. Every Transform key is an offset. */
const BOB: readonly MotionKeyframe[] = [
  { at: 0, Transform: { dx: 0, rotation: 0, scale: 0 } },
  { at: 0.5, ease: "linear", Transform: { dx: 20, rotation: 0.1, scale: 0.2 } },
  { at: 1, ease: "linear", Transform: { dx: 0, rotation: 0, scale: 0 } }
];

/** A blink of 1 s: the alpha keys are absolute. */
const BLINK: readonly MotionKeyframe[] = [
  { at: 0, Shape: { alpha: 1 } },
  { at: 0.5, ease: "linear", Shape: { alpha: 0.5 } },
  { at: 1, ease: "linear", Shape: { alpha: 1 } }
];

/** A loop alone: no `on.enter`, only the loop hook is built. */
const bobbing = defineMotion({
  keyframes: { bob: BOB },
  transition: { ms: 1000 },
  loop: { track: "bob" },
  on: {}
});

describe("anim defineMotion — loop", () => {
  it("builds the loop hook for a loop alone, and no enter; the loop's motion never ends", () => {
    const probe = createViewProbe();

    expect(bobbing.loop).toBeTypeOf("function");
    expect(bobbing.enter).toBeUndefined();
    expect(bobbing.exit).toBeUndefined();

    const loop = bobbing.loop?.(probe.view);

    stepProbe(probe, 5000);

    expect(loop?.active()).toBe(true);
    expect(probe.mock.api.active()).toBe(1);
  });

  it("stops when its motion is cancelled, and the view stands at rest again", () => {
    const probe = createViewProbe();
    const loop = bobbing.loop?.(probe.view);

    stepProbe(probe, 250);

    expect(poseOf(probe).x).toBe(550);

    loop?.cancel();
    stepProbe(probe, 16);

    expect(loop?.active()).toBe(false);
    expect(probe.mock.api.active()).toBe(0);
    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });
  });

  it("adds every Transform key to the rest pose, scale included", () => {
    const probe = createViewProbe();

    bobbing.loop?.(probe.view);
    stepProbe(probe, 250);

    expect(poseOf(probe)).toEqual({ x: 550, y: 300, rotation: 0.05, scale: 1.1, alpha: 1 });

    stepProbe(probe, 250);

    expect(poseOf(probe)).toEqual({ x: 560, y: 300, rotation: 0.1, scale: 1.2, alpha: 1 });
  });

  it("repeats forever: the second cycle walks the same poses and nothing ends", () => {
    const probe = createViewProbe();

    bobbing.loop?.(probe.view);
    stepProbe(probe, 1000);

    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });

    stepProbe(probe, 250);

    expect(poseOf(probe)).toMatchObject({ x: 550, rotation: 0.05 });
    expect(probe.mock.api.active()).toBe(1);
  });

  it("walks alpha keys as absolute values", () => {
    const probe = createViewProbe();
    const blinking = defineMotion({
      keyframes: { blink: BLINK },
      transition: { ms: 1000 },
      loop: { track: "blink" },
      on: {}
    });

    blinking.loop?.(probe.view);
    stepProbe(probe, 250);

    expect(poseOf(probe).alpha).toBeCloseTo(0.75, 6);

    stepProbe(probe, 250);

    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 0.5 });
  });

  it("starts next to the enter motion and stays out of it", () => {
    const probe = createViewProbe();
    const popIn = defineMotion({
      states: { small: { Transform: { scale: 0.5 } } },
      keyframes: { bob: BOB },
      transition: { ms: 1000, ease: "linear" },
      loop: { track: "bob" },
      on: { enter: "small" }
    });
    const motion = popIn.enter?.(probe.view, {});

    popIn.loop?.(probe.view);

    expect(probe.mock.api.active()).toBe(2);

    stepProbe(probe, 500);

    // The enter is halfway from 0.5 to 1; the loop adds its peak 0.2 on top.
    expect(poseOf(probe).scale).toBeCloseTo(0.95, 6);

    stepProbe(probe, 500);

    expect(motion?.active()).toBe(false);
    expect(probe.mock.api.active()).toBe(1);
    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });
  });

  it("runs one cycle on loop.ms, apart from a 250 ms enter", () => {
    const probe = createViewProbe();
    const popIn = defineMotion({
      states: { small: { Transform: { scale: 0.5 } } },
      keyframes: { bob: BOB },
      transition: { ms: 250, ease: "linear" },
      loop: { track: "bob", ms: 2000 },
      on: { enter: "small" }
    });
    const motion = popIn.enter?.(probe.view, {});

    popIn.loop?.(probe.view);

    stepProbe(probe, 250);

    // The enter landed; the loop is an eighth into its 2000 ms cycle: a quarter of its peak.
    expect(motion?.active()).toBe(false);
    expect(poseOf(probe).x).toBe(545);
    expect(poseOf(probe).scale).toBeCloseTo(1.05, 6);

    stepProbe(probe, 750);

    expect(poseOf(probe)).toEqual({ x: 560, y: 300, rotation: 0.1, scale: 1.2, alpha: 1 });
    expect(probe.mock.api.active()).toBe(1);
  });

  it("stays additive over a change: the new rest pose carries the loop along", () => {
    const probe = createViewProbe();

    bobbing.loop?.(probe.view);
    stepProbe(probe, 250);

    expect(poseOf(probe).x).toBe(550);

    probe.rests.Transform = { x: 600, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };
    probe.view.toRest(Transform, { ms: 500, ease: "linear" });
    stepProbe(probe, 250);

    // The base is halfway from 540 to 600; the loop is at its peak, 20 u.
    expect(poseOf(probe).x).toBe(590);

    stepProbe(probe, 250);

    expect(poseOf(probe).x).toBe(610);

    stepProbe(probe, 250);

    expect(poseOf(probe)).toEqual({ x: 600, y: 300, rotation: 0, scale: 1, alpha: 1 });
    expect(probe.mock.api.active()).toBe(1);
  });

  it("stands on its first key from 0 until the key's at, so a cycle closes without a jump", () => {
    const probe = createViewProbe();
    const wiggle = defineMotion({
      keyframes: {
        wiggle: [
          { at: 0.25, Transform: { rotation: 0.1 } },
          { at: 0.5, ease: "linear", Transform: { rotation: -0.1 } },
          { at: 0.75, ease: "linear", Transform: { rotation: 0.1 } }
        ]
      },
      transition: { ms: 1000 },
      loop: { track: "wiggle" },
      on: {}
    });

    wiggle.loop?.(probe.view);
    stepProbe(probe, 100);

    expect(poseOf(probe).rotation).toBe(0.1);

    stepProbe(probe, 900);
    stepProbe(probe, 100);

    expect(poseOf(probe).rotation).toBe(0.1);
  });
});

describe("anim defineMotion — loop definition errors", () => {
  it("refuses a loop whose last key differs from its first", () => {
    expect(() =>
      defineMotion({
        keyframes: {
          sway: [
            { at: 0, Transform: { rotation: 0 } },
            { at: 1, Transform: { rotation: 0.1 } }
          ]
        },
        loop: { track: "sway" },
        on: {}
      })
    ).toThrow(
      '[game] Motion loop "sway" ends somewhere else than it starts.\n  Give its last key the pose of its first key.'
    );
  });

  it("refuses a loop that holds a field at the end the first key does not start from", () => {
    expect(() =>
      defineMotion({
        keyframes: {
          sway: [
            { at: 0, Transform: { rotation: 0 } },
            { at: 0.5, Transform: { rotation: 0.1, dy: -5 } },
            { at: 1, Transform: { rotation: 0 } }
          ]
        },
        loop: { track: "sway" },
        on: {}
      })
    ).toThrow('[game] Motion loop "sway" ends somewhere else than it starts.');
  });

  it("refuses a loop that names an alpha its first key leaves out", () => {
    expect(() =>
      defineMotion({
        keyframes: {
          fade: [
            { at: 0, Transform: { rotation: 0 } },
            { at: 0.5, Shape: { alpha: 0.5 } },
            { at: 1, Transform: { rotation: 0 }, Shape: { alpha: 0.5 } }
          ]
        },
        loop: { track: "fade" },
        on: {}
      })
    ).toThrow('[game] Motion loop "fade" ends somewhere else than it starts.');
  });

  it("accepts a rotation that ends whole turns away from its start: a blade spins", () => {
    const probe = createViewProbe();
    const spin = defineMotion({
      keyframes: {
        spin: [
          { at: 0, Transform: { rotation: 0 } },
          { at: 1, ease: "linear", Transform: { rotation: 2 * Math.PI } }
        ]
      },
      transition: { ms: 1000 },
      loop: { track: "spin" },
      on: {}
    });

    spin.loop?.(probe.view);
    stepProbe(probe, 500);

    expect(poseOf(probe).rotation).toBeCloseTo(Math.PI, 9);

    stepProbe(probe, 750);

    // The second turn restarted at offset 0: a quarter turn in.
    expect(poseOf(probe).rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(probe.mock.api.active()).toBe(1);
  });

  it("accepts a turn backwards, and one that misses a whole turn by less than 1e-9", () => {
    const backwards = [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: -2 * Math.PI } }
    ];
    const nearly = [
      { at: 0, Transform: { rotation: 0.5 } },
      { at: 1, Transform: { rotation: 0.5 + 4 * Math.PI + 5e-10 } }
    ];

    expect(() =>
      defineMotion({ keyframes: { spin: backwards }, loop: { track: "spin" }, on: {} })
    ).not.toThrow();
    expect(() =>
      defineMotion({ keyframes: { spin: nearly }, loop: { track: "spin" }, on: {} })
    ).not.toThrow();
  });

  it("refuses a rotation that ends half a turn away, and whole turns on another field", () => {
    const half = [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: Math.PI } }
    ];
    const shifted = [
      { at: 0, Transform: { dx: 0 } },
      { at: 1, Transform: { dx: 2 * Math.PI } }
    ];

    expect(() =>
      defineMotion({ keyframes: { spin: half }, loop: { track: "spin" }, on: {} })
    ).toThrow('[game] Motion loop "spin" ends somewhere else than it starts.');
    expect(() =>
      defineMotion({ keyframes: { spin: shifted }, loop: { track: "spin" }, on: {} })
    ).toThrow('[game] Motion loop "spin" ends somewhere else than it starts.');
  });

  it("refuses a loop of no length", () => {
    expect(() =>
      defineMotion({ keyframes: { bob: BOB }, loop: { track: "bob", ms: 0 }, on: {} })
    ).toThrow('[game] Motion loop "bob" has ms 0.\n  Give one cycle a finite length above 0.');
  });

  it("refuses a loop that names no keyframe track", () => {
    expect(() => defineMotion({ states: { idle: {} }, loop: { track: "idle" }, on: {} })).toThrow(
      '[game] Motion names "idle" in loop, but no keyframe track has it.\n  Define it in keyframes.'
    );
  });
});
