import { describe, expect, it } from "vitest";
import { Shape, Sprite, Transform } from "../../../renderer/components";
import { component } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import { createMockAnim, type MockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test (F219): a tween of a colour field mixes 0xrrggbb per channel and lands on whole
// numbers. Mixed as one number, 0xffffff → 0xc7c7c7 passed 0xff3cec and 0xfff91a.9fe6, and the
// album flap flashed magenta on the A26.
// ---------------------------------------------------------------------------

/** A game's own component with a field named like a colour: not a colour, mixed as a number. */
const Meter = component("Meter", { fill: 0 });

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/**
 * Splits a colour into its three channels.
 *
 * @param color - A `0xrrggbb` colour.
 * @returns Red, green and blue, 0..255 each.
 */
function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/**
 * Runs frames of 16 ms and reads one field of one component after each.
 *
 * @param mock - The started mock.
 * @param entity - The tweened entity.
 * @param read - Reads the field off the world.
 * @param frames - How many frames to run.
 * @returns The field after each frame.
 */
function framesOf(
  mock: MockAnim,
  entity: Entity,
  read: (entity: Entity) => number,
  frames: number
): number[] {
  const seen: number[] = [];

  for (let index = 0; index < frames; index += 1) {
    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);
    seen.push(read(entity));
  }

  return seen;
}

describe("anim/tween — a colour field mixes per channel (F219)", () => {
  // The bug: the tint passes 0xff3cec and fractions on its way from white to grey.
  it("takes a Sprite tint from white to grey through greys of whole numbers", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Sprite({ texture: "x", tint: 0xff_ff_ff })]);

    createDriver(mock.actx).track(
      entity,
      Sprite,
      { tint: 0xc7_c7_c7 },
      { ms: 160, ease: "linear" },
      open
    );

    const tints = framesOf(mock, entity, at => mock.world.ecs.get(at, Sprite)?.tint ?? -1, 10);

    for (const tint of tints) {
      const [red, green, blue] = channels(tint);

      expect(Number.isInteger(tint)).toBe(true);
      expect([green, blue]).toEqual([red, red]);
    }

    // Halfway, linear: (0xff + 0xc7) / 2 = 0xe3 on every channel.
    expect(tints[4]).toBe(0xe3_e3_e3);
    expect(tints.at(-1)).toBe(0xc7_c7_c7);
  });

  // The bug: a fill and a stroke are mixed as numbers too; a channel borrows from its neighbour.
  it("mixes a Shape fill and stroke per channel, each channel on its own line", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Shape({ fill: 0xff_00_00, stroke: 0x00_00_ff })]);

    createDriver(mock.actx).track(
      entity,
      Shape,
      { fill: 0x00_00_ff, stroke: 0xff_00_00 },
      { ms: 160, ease: "linear" },
      open
    );

    const half = framesOf(mock, entity, at => mock.world.ecs.get(at, Shape)?.fill ?? -1, 5).at(-1);

    expect(half).toBe(0x80_00_80);
    expect(mock.world.ecs.get(entity, Shape)?.stroke).toBe(0x80_00_80);
  });

  // The bug: every field is taken for a colour, so a size or a game's number is rounded.
  it("keeps mixing a number field as a number: a Transform and a game's own `fill`", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0 }), Meter({ fill: 0 })]);
    const driver = createDriver(mock.actx);

    driver.track(entity, Transform, { x: 1 }, { ms: 160, ease: "linear" }, open);
    driver.track(entity, Meter, { fill: 1 }, { ms: 160, ease: "linear" }, open);
    framesOf(mock, entity, () => 0, 5);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBeCloseTo(0.5, 9);
    expect(mock.world.ecs.get(entity, Meter)?.fill).toBeCloseTo(0.5, 9);
  });
});
