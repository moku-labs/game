/**
 * @file Root integration — still screens (spec 14 T2, F6, F18a, K3), the engine's own versions of
 * the game's `still-screens.test.ts`: what stands still is not drawn, and what changes is drawn
 * in the frame it changes in, also when it disappears or appears. The fixture spawns its views
 * straight into one layer; loops are world systems that write every frame. The renderer draws on
 * demand over Pixi's own objects and the tree oracle checks every frame (`drawn-helpers.ts`).
 */
import type { World } from "@moku-labs/game";
import { bind, Countdown, Display, Shape, Text, Transform } from "@moku-labs/game";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Emitter,
  Env,
  Flicker,
  Hold,
  open,
  running,
  Spin,
  type Still,
  square,
  TWO_SECONDS,
  Veil
} from "./still-fixture";

afterEach(async () => {
  for (const still of running.splice(0)) {
    still.oracle.expectNoMissedFrame();
    await still.app.stop();
  }

  vi.unstubAllGlobals();
});

describe("a screen that stands still is not drawn", () => {
  it("asks for no frame of an endless loop in a hidden subtree", async () => {
    const still = await open();
    const stack = still.spawn(Transform({ x: 100, y: 100 }), square(80, { alpha: 0 }));

    still.child(stack, Transform({ x: 10, y: 10 }), square(20), Spin());
    await still.frames(2);

    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });

  it("asks for no frame of a light fully off the screen that flickers; draws the frame it slides onto the screen", async () => {
    const still = await open();
    const light = still.spawn(Transform({ x: -500, y: 100 }), square(40), Flicker());

    await still.frames(2);

    expect(await still.frames(30)).toBe(0);

    still.app.world.ecs.set(light, Transform, { x: 100 });

    expect(await still.frames(5)).toBe(5);
  });

  it("asks for no frame of a camera that writes a new pose with the same numbers after its glide", async () => {
    const still = await open();
    const camera = still.spawn(Transform({ x: 40, y: 40 }), square(300), Hold({ x: 40, y: 40 }));

    still.child(camera, Transform({ x: 20, y: 20 }), square(30));
    await still.frames(2);

    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });

  it("draws one frame for a filter value written from a resource once, then nothing", async () => {
    const still = await open();

    still.spawn(Transform({ x: 100, y: 100 }), square(80), Veil());
    await still.frames(5);

    expect(await still.frames(10)).toBe(0);

    still.app.world.ecs.resource(Env).x = 24;

    expect(await still.frames(1)).toBe(1);
    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });

  it("draws a resting screen again after a resize, then nothing", async () => {
    const still = await open();

    still.spawn(Transform({ x: 100, y: 100 }), square(80));
    await still.frames(2);
    still.page.resize(390, 900);

    expect(await still.frames(1)).toBe(1);
    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });

  it("rests again after a pause and a resume", async () => {
    const still = await open();

    still.spawn(Transform({ x: 100, y: 100 }), square(80));
    still.app.lifecycle.push("background");
    await still.frames(30);
    still.app.lifecycle.pop("background");
    await still.frames(60);

    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });
});

describe("what changes is drawn in the frame it changes in", () => {
  it("draws every frame of a visible endless loop", async () => {
    const still = await open();

    still.spawn(Transform({ x: 100, y: 100 }), square(40), Spin());
    await still.frames(2);

    expect(await still.frames(TWO_SECONDS)).toBe(TWO_SECONDS);
  });

  it("draws the frame a view fades to 0 in; the loops under it are not drawn after", async () => {
    const still = await open();
    const stack = still.spawn(Transform({ x: 100, y: 100 }), square(80));

    still.child(stack, Transform({ x: 10, y: 10 }), square(20), Spin());

    expect(await still.frames(10)).toBe(10);

    still.app.world.ecs.set(stack, Shape, { alpha: 0 });

    expect(await still.each(3)).toEqual([true, false, false]);
    expect(await still.frames(60)).toBe(0);
  });

  it("draws a view shown again in the frame its child moved", async () => {
    const still = await open();
    const stack = still.spawn(Transform({ x: 100, y: 100 }), square(80, { alpha: 0 }));
    const item = still.child(stack, Transform({ x: 10, y: 10 }), square(20));

    await still.frames(5);
    still.app.world.ecs.set(item, Transform, { x: 30 });
    still.app.world.ecs.set(stack, Shape, { alpha: 1 });

    expect(await still.frames(1)).toBe(1);
    expect(await still.frames(10)).toBe(0);
  });

  it("asks for nothing for a view spawned under a hidden parent; draws the frame the parent shows it", async () => {
    const still = await open();
    const stack = still.spawn(Transform({ x: 100, y: 100 }), square(80, { alpha: 0 }));

    await still.frames(5);
    still.child(stack, Transform({ x: 10, y: 10 }), square(20));

    expect(await still.frames(5)).toBe(0);

    still.app.world.ecs.set(stack, Shape, { alpha: 1 });

    expect(await still.frames(1)).toBe(1);
  });

  it("draws a despawned view that was on the screen away", async () => {
    const still = await open();
    const item = still.spawn(Transform({ x: 100, y: 100 }), square(40));

    await still.frames(5);
    still.app.world.ecs.despawn(item);

    expect(await still.frames(1)).toBe(1);
    expect(await still.frames(10)).toBe(0);
  });

  it("draws a burst of particles until its last particle dies, then nothing", async () => {
    const still = await open();

    still.spawn(Transform({ x: 200, y: 300 }), Emitter({ effect: "fx.spark" }));

    const living: boolean[] = [];

    for (
      let frame = 0;
      frame < 120 && (frame < 3 || still.app.effects.stats().particles > 0);
      frame += 1
    ) {
      living.push((await still.frames(1)) === 1);
    }

    expect(living.length).toBeGreaterThan(10);
    expect(living.slice(1).every(Boolean)).toBe(true);
    expect(await still.frames(30)).toBe(0);
  });
});

/**
 * A label counting down to a moment of the clock, as `mm:ss`, under a parent panel.
 *
 * @param still - The running fixture.
 * @param panelAlpha - The alpha of the panel.
 * @returns The panel.
 */
function countdown(still: Still, panelAlpha = 1): World.Entity {
  const panel = still.spawn(Transform({ x: 40, y: 40 }), square(200, { alpha: panelAlpha }));

  still.child(
    panel,
    Transform({ x: 100, y: 100 }),
    Countdown({ until: still.clock.now() + 105_400 }),
    Text({ style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) })
  );

  return panel;
}

describe("what lives on the clock gets its frame on a still screen", () => {
  it("draws a countdown once a second, the frame its text changes in, and no other", async () => {
    const still = await open();

    countdown(still);
    await still.frames(5);

    const drawn = await still.frames(TWO_SECONDS);

    expect(drawn).toBeGreaterThanOrEqual(2);
    expect(drawn).toBeLessThanOrEqual(6);
  });

  it("draws a panel fading out to its end, and nothing once it is gone", async () => {
    const still = await open();
    const panel = countdown(still);

    await still.frames(5);

    const fading: boolean[] = [];

    for (let step = 1; step <= 15; step += 1) {
      still.app.world.ecs.set(panel, Shape, { alpha: 1 - step / 15 });
      fading.push((await still.frames(1)) === 1);
    }

    expect(fading.every(Boolean)).toBe(true);
    expect(await still.frames(TWO_SECONDS)).toBe(0);
  });

  it("asks for nothing for the countdown of a panel that left", async () => {
    const still = await open();

    countdown(still, 0);
    await still.frames(5);

    expect(await still.frames(3 * TWO_SECONDS)).toBe(0);
  });
});

describe("the oracle itself", () => {
  it("passes a Display object written with invalidate, and reports one written without it", async () => {
    const still = await open();
    const flame = new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00);
    const stove = still.spawn(Transform({ x: 100, y: 100 }), Display({ object: flame }));

    await still.frames(3);
    still.app.renderer.invalidate(stove);
    flame.x = 20;

    expect(await still.frames(1)).toBe(1);
    expect(still.oracle.missed).toEqual([]);

    // A game that forgets the call: the renderer cannot see the write, the frame is skipped.
    flame.x = 40;

    expect(await still.frames(1)).toBe(0);
    expect(still.oracle.missed).toHaveLength(1);
    expect(still.oracle.missed[0]?.node).toContain("Graphics");

    // The self-test is done: the frozen view is the expected finding, not a failure.
    still.oracle.missed.length = 0;
  });
});
