import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import type { Entity, TweenDriver } from "../../../world/types";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver, startStepTrack } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: tracks with `repeat` on the real tween driver, and the offsets an additive
// keyframe walk names. Delta 6, item B6.
// ---------------------------------------------------------------------------

/**
 * Nothing is muted.
 *
 * @returns An empty field set.
 */
function open(): ReadonlySet<string> {
  return new Set();
}

/**
 * Runs one frame step of the track table only.
 *
 * @param mock - The mock anim world.
 * @param deltaMs - Milliseconds of the frame.
 */
function step(mock: MockAnim, deltaMs: number): void {
  beginFrame(mock.actx);
  advanceTracks(mock.actx, deltaMs);
}

/**
 * Creates the real driver over the mock world with one entity.
 *
 * @param x - Where the entity stands on x.
 * @returns The mock, the driver and the entity.
 */
function setup(x = 0): { mock: MockAnim; driver: TweenDriver; entity: Entity } {
  const mock = createMockAnim();
  const entity = spawnTestEntity(mock, [Transform({ x })]);

  return { mock, driver: createDriver(mock.actx), entity };
}

/**
 * Reads x of the entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity.
 * @returns Its x.
 */
function xOf(mock: MockAnim, entity: Entity): number | undefined {
  return mock.world.ecs.get(entity, Transform)?.x;
}

describe("anim/tween driver — repeat", () => {
  it("restarts the walk when it ends and counts the extra runs", () => {
    const { mock, driver, entity } = setup();
    const handle = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: 1 },
      open
    );

    step(mock, 50);
    step(mock, 50);

    expect(xOf(mock, entity)).toBe(100);
    expect(handle.active()).toBe(true);

    step(mock, 50);

    expect(xOf(mock, entity)).toBe(50);

    step(mock, 50);

    expect(xOf(mock, entity)).toBe(100);
    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("never ends a forever track: it stays in the table and its motion never resolves", () => {
    const { mock, driver, entity } = setup();
    const handle = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );

    for (let frame = 0; frame < 25; frame += 1) step(mock, 40);

    expect(handle.active()).toBe(true);
    expect(mock.api.active()).toBe(1);
    // 25 × 40 ms = 1000 ms: ten whole runs, the tenth ends on its target.
    expect(xOf(mock, entity)).toBe(100);

    step(mock, 30);

    expect(xOf(mock, entity)).toBe(30);
  });

  it("carries a frame longer than one run into the next run", () => {
    const { mock, driver, entity } = setup();

    driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );
    step(mock, 250);

    expect(xOf(mock, entity)).toBe(50);
  });

  it("hands the time past its last run back to the caller", () => {
    const { mock, entity } = setup();
    const motion = startStepTrack(
      mock.actx,
      entity,
      Transform,
      { x: 100 },
      {
        ms: 100,
        ease: "linear",
        repeat: 2
      }
    );

    expect(motion.advance(350)).toBe(50);
    expect(xOf(mock, entity)).toBe(100);
    expect(motion.active()).toBe(false);
  });

  it("treats a repeat that is not a positive number as one run", () => {
    const { mock, driver, entity } = setup();
    const handle = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: -2 },
      open
    );

    step(mock, 100);

    expect(handle.active()).toBe(false);
  });

  it("ends a forever track on its target when it is finished, and in place when cancelled", () => {
    const { mock, driver, entity } = setup();
    const finished = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );

    step(mock, 30);
    finished.finish();

    expect(xOf(mock, entity)).toBe(100);
    expect(finished.active()).toBe(false);

    const cancelled = driver.track(
      entity,
      Transform,
      { x: 0 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );

    step(mock, 50);
    cancelled.cancel();

    expect(xOf(mock, entity)).toBe(50);
    expect(mock.api.active()).toBe(0);
  });

  it("stands a forever track with no length on its first key, without ending it", () => {
    const { mock, driver, entity } = setup();
    const segments = [
      { at: 0, to: { x: 5 } },
      { at: 1, to: { x: 5 } }
    ] as const;
    const handle = driver.track(
      entity,
      Transform,
      { x: 5 },
      { ms: 0, repeat: "forever", segments },
      open
    );

    step(mock, 16);
    step(mock, 16);

    expect(xOf(mock, entity)).toBe(5);
    expect(handle.active()).toBe(true);
  });
});

describe("anim/tween driver — additive keyframe walk", () => {
  it("names offsets over the base: the walk starts at no offset", () => {
    const { mock, driver, entity } = setup(40);
    const segments = [
      { at: 0.5, ease: "linear", to: { x: 10 } },
      { at: 1, ease: "linear", to: { x: 0 } }
    ] as const;

    driver.track(entity, Transform, { x: 0 }, { ms: 100, additive: true, segments }, open);
    step(mock, 25);

    expect(xOf(mock, entity)).toBe(45);

    step(mock, 25);

    expect(xOf(mock, entity)).toBe(50);

    step(mock, 50);

    expect(xOf(mock, entity)).toBe(40);
    expect(mock.api.active()).toBe(0);
  });

  it("adds its offsets over an absolute track of the same field", () => {
    const { mock, driver, entity } = setup(0);
    const segments = [
      { at: 0.5, ease: "linear", to: { x: 10 } },
      { at: 1, ease: "linear", to: { x: 0 } }
    ] as const;

    driver.track(
      entity,
      Transform,
      { x: 0 },
      { ms: 100, additive: true, repeat: "forever", segments },
      open
    );
    driver.track(entity, Transform, { x: 200 }, { ms: 200, ease: "linear" }, open);
    step(mock, 50);

    // Base 50 of the absolute track, plus the offset 10 of the walk at its peak.
    expect(xOf(mock, entity)).toBe(60);

    step(mock, 150);

    // The absolute track landed on 200; the walk is back at no offset and runs on.
    expect(xOf(mock, entity)).toBe(200);
    expect(mock.api.active()).toBe(1);

    step(mock, 50);

    expect(xOf(mock, entity)).toBe(210);
  });
});
