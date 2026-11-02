import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// F126 stage 0: `stats().kept.evicted` and `.refused`, the pictures the budget evicted and the takes it refused in the
// last full second, drained with the takes.
// ---------------------------------------------------------------------------

/** The bytes of one kept 40 x 40 shape without padding at resolution 1: its picture and its output. */
const PICTURE_BYTES = 2 * 40 * 40 * 4;

/** One MiB. */
const MIB = 1024 * 1024;

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

/**
 * Starts the renderer with a budget of so many pictures, every frame drawn.
 *
 * @param pictures - How many 40 x 40 pictures fit, a half more than that.
 * @returns The running renderer.
 */
async function withRoomFor(pictures: number): Promise<Drawn> {
  const drawn = await startDrawn({
    onDemand: false,
    config: { keptMb: ((pictures + 0.5) * PICTURE_BYTES) / MIB }
  });

  running.push(drawn);

  return drawn;
}

/**
 * Spawns a 40 x 40 shape with a kept filter and runs the three frames of its take.
 *
 * @param drawn - The running renderer.
 * @param x - Its x.
 * @returns The entity.
 */
function keep(drawn: Drawn, x: number): Entity {
  const entity = drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [
    { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
  ]);
  drawn.frames(3);

  return entity;
}

/**
 * Runs the frames of one second of the clock: the window open at the start closes in the last, and no other.
 *
 * @param drawn - The running renderer.
 * @param clock - The clock of the test.
 * @param clock.now - Its time.
 */
function second(drawn: Drawn, clock: { now: number }): void {
  for (let frame = 0; frame < 2; frame += 1) {
    clock.now += 500;
    drawn.mock.setNow(clock.now);
    drawn.frame();
  }
}

describe("the budget's counts", () => {
  // Bug: an eviction is not counted, is counted again every second, or never leaves the report.
  it("counts one eviction once, in the second it closes with", async () => {
    const drawn = await withRoomFor(2);
    const clock = { now: 0 };

    drawn.mock.setNow(clock.now);

    const faded = keep(drawn, 100);

    keep(drawn, 200);
    second(drawn, clock);

    expect(drawn.mock.api.stats().kept.evicted).toBe(0);

    // Transparent: drawn live from now on, its textures held: the next take evicts them.
    drawn.mock.world.ecs.set(faded, Shape, { alpha: 0 });
    drawn.frames(2);
    keep(drawn, 300);

    // Still the second before: the numbers are of a full second, as `retakes`.
    expect(drawn.mock.api.stats().kept.evicted).toBe(0);

    second(drawn, clock);

    expect(drawn.mock.api.stats().kept.evicted).toBe(1);

    second(drawn, clock);

    expect(drawn.mock.api.stats().kept.evicted).toBe(0);
  });

  // Bug: a refusal that holds counts in every frame it holds, which reads as a storm of takes that never happens.
  it("counts one refusal once, however many frames it holds, and forgets it with the second", async () => {
    const drawn = await withRoomFor(1);
    const clock = { now: 0 };

    drawn.mock.setNow(clock.now);
    keep(drawn, 100);
    second(drawn, clock);
    keep(drawn, 200);
    drawn.frames(3);
    second(drawn, clock);

    expect(drawn.mock.api.stats().kept).toMatchObject({ refused: 1, evicted: 0 });

    second(drawn, clock);

    expect(drawn.mock.api.stats().kept.refused).toBe(0);
  });

  it("stays at 0 with keptMb 0, which takes nothing", async () => {
    const drawn = await startDrawn({ onDemand: false, config: { keptMb: 0 } });
    const clock = { now: 0 };

    running.push(drawn);
    keep(drawn, 100);
    second(drawn, clock);

    expect(drawn.mock.api.stats().kept).toMatchObject({ evicted: 0, refused: 0 });
  });

  // Bug: a stopped renderer starts its next run with the last run's numbers.
  it("forgets both when the cache stops", async () => {
    const drawn = await withRoomFor(1);
    const clock = { now: 0 };

    drawn.mock.setNow(clock.now);
    keep(drawn, 100);
    second(drawn, clock);
    keep(drawn, 200);

    const kept = drawn.mock.ctx.state.kept;

    expect(kept.frameRefused).toBe(1);

    second(drawn, clock);
    keep(drawn, 300);

    drawn.mock.stop();
    running.length = 0;

    expect([kept.frameRefused, kept.frameEvicted, kept.refusedWindow, kept.evictedWindow]).toEqual([
      0, 0, 0, 0
    ]);
  });
});
