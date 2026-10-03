import { describe, expect, it } from "vitest";
import type { PixiModule, PixiTexture } from "../../../renderer/types";
import { bakeEmitter, createRng } from "../../particles/bake";
import { defineEmitter } from "../../particles/define";
import { bornFields } from "../../particles/instance";
import { advanceParticles, emitParticles, fillInstance, stepInstance } from "../../particles/step";
import type { EmitterConfig, EmitterInstance, PixiParticleContainer } from "../../particles/types";
import { atlasTexture, FakeFxParticle, FakeFxParticleContainer } from "../fake-effects-pixi";

// ---------------------------------------------------------------------------
// Unit test: the particle step on a fake container — emission with a carry,
// the advance, swap-remove, the packed colour, the ceiling, prewarm
// ---------------------------------------------------------------------------

const page = { width: 256, height: 256, destroyed: false };
const ORIGIN = { x: 0, y: 0 };

/**
 * Builds an instance by hand over a fake container, without a world.
 *
 * @param config - The emitter config of "fx.x".
 * @param space - World or local.
 * @returns The instance and its container.
 */
function instanceOf(
  config: EmitterConfig,
  space: "world" | "local" = "world"
): { instance: EmitterInstance; container: FakeFxParticleContainer } {
  const def = defineEmitter("fx.x", config);
  const texture = atlasTexture(page, 16) as unknown as PixiTexture;
  const baked = bakeEmitter(def, [texture]);
  const container = new FakeFxParticleContainer({});
  const instance: EmitterInstance = {
    id: def.id,
    baked,
    host: 1,
    entity: 2,
    container: container as unknown as PixiParticleContainer,
    pool: [],
    born: bornFields(def.config.maxParticles),
    carry: 0,
    rng: createRng(1),
    origin: { x: 0, y: 0 },
    space,
    particleClass: FakeFxParticle as unknown as PixiModule["Particle"]
  };

  return { instance, container };
}

/**
 * Runs frames of one length.
 *
 * @param instance - The instance.
 * @param count - How many frames.
 * @param deltaMs - Length of one frame.
 * @param emitting - Whether a stream emits.
 */
function run(instance: EmitterInstance, count: number, deltaMs: number, emitting = true): void {
  for (let index = 0; index < count; index += 1) stepInstance(instance, deltaMs, ORIGIN, emitting);
}

describe("emitParticles and fillInstance", () => {
  it("emits a burst of min(burst, maxParticles) and uploads once", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 40,
      maxParticles: 30
    });

    fillInstance(instance, true);

    expect(container.particleChildren).toHaveLength(30);
    expect(container.updates).toBe(1);
  });

  it("makes centred particles from the instance's texture and rng", () => {
    const { instance, container } = instanceOf({ textures: ["a"], burst: 2 });

    expect(emitParticles(instance, 2, { x: 30, y: 40 })).toBe(2);

    const particle = container.particleChildren[0];

    expect(particle).toBeInstanceOf(FakeFxParticle);
    expect(particle?.anchorX).toBe(0.5);
    expect(particle?.anchorY).toBe(0.5);
    expect(particle?.texture).toBe(instance.baked.textures[0]);
    // A point shape: born at the offset, which is the host's root pose minus the origin.
    expect(particle?.x).toBe(30);
    expect(particle?.y).toBe(40);
  });

  it("prewarms a stream in 16 ms slices and uploads once", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      rate: 10,
      lifeMs: [5000, 5000],
      prewarmMs: 1000
    });

    fillInstance(instance, true);

    // 62 slices of 16 ms and one of 8 ms: 1000 ms at 10 per second.
    expect(container.particleChildren).toHaveLength(10);
    expect(container.updates).toBe(1);
  });

  it("uploads nothing when the fill made nothing", () => {
    const { instance, container } = instanceOf({ textures: ["a"], rate: 10 });

    fillInstance(instance, true);

    expect(container.particleChildren).toHaveLength(0);
    expect(container.updates).toBe(0);
  });
});

describe("stepInstance", () => {
  it("emits the same count at 60 Hz and at 120 Hz", () => {
    const slow = instanceOf({ textures: ["a"], rate: 12, lifeMs: [5000, 5000] });
    const fast = instanceOf({ textures: ["a"], rate: 12, lifeMs: [5000, 5000] });

    run(slow.instance, 60, 1000 / 60);
    run(fast.instance, 120, 1000 / 120);

    expect(slow.container.particleChildren).toHaveLength(12);
    expect(fast.container.particleChildren).toHaveLength(12);
  });

  it("emits nothing while not emitting", () => {
    const { instance, container } = instanceOf({ textures: ["a"], rate: 100 });

    run(instance, 10, 16, false);

    expect(container.particleChildren).toHaveLength(0);
    expect(container.updates).toBe(0);
  });

  it("holds maxParticles", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      rate: 1000,
      lifeMs: [5000, 5000],
      maxParticles: 5
    });

    run(instance, 10, 100);

    expect(container.particleChildren).toHaveLength(5);
  });

  it("retires at life by swap-remove; the born fields follow and the pool grows", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 3,
      lifeMs: [5000, 5000]
    });

    emitParticles(instance, 3, ORIGIN);
    const [first, second, third] = container.particleChildren;

    instance.born.life[0] = 50;
    instance.born.life[1] = 1000;
    instance.born.life[2] = 2000;

    stepInstance(instance, 60, ORIGIN, false);

    expect(container.particleChildren).toEqual([third, second]);
    expect(instance.born.life[0]).toBe(2000);
    expect(instance.born.life[1]).toBe(1000);
    expect(instance.born.age[0]).toBe(60);
    expect(instance.pool).toEqual([first]);
    expect(container.updates).toBe(1);

    // A step where nothing is born and nothing dies uploads nothing.
    stepInstance(instance, 60, ORIGIN, false);
    expect(container.updates).toBe(1);
  });

  it("reuses a pooled particle before making a new one", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 1,
      lifeMs: [10, 10]
    });

    emitParticles(instance, 1, ORIGIN);
    const [first] = container.particleChildren;

    stepInstance(instance, 20, ORIGIN, false);
    expect(container.particleChildren).toHaveLength(0);

    emitParticles(instance, 1, ORIGIN);
    expect(container.particleChildren[0]).toBe(first);
    expect(instance.pool).toHaveLength(0);
  });

  it("moves by gravity, drag and spin", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 1,
      lifeMs: [5000, 5000],
      speed: [100, 100],
      angle: [0, 0],
      gravity: 1000,
      drag: 0.5,
      spin: [2, 2]
    });

    emitParticles(instance, 1, ORIGIN);
    stepInstance(instance, 100, ORIGIN, false);

    const keep = 0.5 ** 0.1;
    const particle = container.particleChildren[0];

    expect(instance.born.vx[0]).toBeCloseTo(100 * keep, 3);
    expect(instance.born.vy[0]).toBeCloseTo(100 * keep, 3);
    expect(particle?.x).toBeCloseTo(10 * keep, 3);
    expect(particle?.y).toBeCloseTo(10 * keep, 3);
    expect(particle?.rotation).toBeCloseTo(0.2, 5);
  });

  it("aims 90 degrees down the screen", () => {
    const { instance } = instanceOf({
      textures: ["a"],
      burst: 1,
      speed: [50, 50],
      angle: [90, 90]
    });

    emitParticles(instance, 1, ORIGIN);

    expect(instance.born.vx[0]).toBeCloseTo(0, 5);
    expect(instance.born.vy[0]).toBeCloseTo(50, 5);
  });

  it("writes the scale and the packed colour of its age", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 1,
      lifeMs: [1000, 1000],
      scale: { from: 1, to: 0 },
      tint: { from: 0x00_ff_00, to: 0x00_ff_00 }
    });

    emitParticles(instance, 1, ORIGIN);
    stepInstance(instance, 500, ORIGIN, false);

    const particle = container.particleChildren[0];

    // t = 0.5 reads entry floor(0.5 × 64) = 32.
    expect(particle?.scaleX).toBeCloseTo(1 - 32 / 63, 5);
    expect(particle?.scaleY).toBe(particle?.scaleX);
    // Green as 0xbbggrr, under an alpha byte of 255.
    expect(particle?.color).toBe(0xff_00_ff_00);
  });

  it("packs a fading alpha into the top byte", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      burst: 1,
      lifeMs: [1000, 1000],
      alpha: { from: 0, to: 0 }
    });

    emitParticles(instance, 1, ORIGIN);
    stepInstance(instance, 10, ORIGIN, false);

    expect(container.particleChildren[0]?.color).toBe(0x00_ff_ff_ff);
  });

  it("emits a stream from where the host is now", () => {
    const { instance, container } = instanceOf({
      textures: ["a"],
      rate: 10,
      lifeMs: [5000, 5000]
    });

    stepInstance(instance, 100, { x: 30, y: -40 }, true);

    // Born at the offset, then moved by a speed of 0.
    expect(container.particleChildren[0]?.x).toBe(30);
    expect(container.particleChildren[0]?.y).toBe(-40);
  });

  it("borns inside its shape", () => {
    const circle = instanceOf({
      textures: ["a"],
      burst: 50,
      shape: { kind: "circle", radius: 10 }
    });
    const ring = instanceOf({
      textures: ["a"],
      burst: 50,
      shape: { kind: "ring", radius: 20, width: 4 }
    });
    const box = instanceOf({ textures: ["a"], burst: 50, shape: { kind: "rect", w: 40, h: 10 } });

    emitParticles(circle.instance, 50, ORIGIN);
    emitParticles(ring.instance, 50, ORIGIN);
    emitParticles(box.instance, 50, ORIGIN);

    for (const particle of circle.container.particleChildren) {
      expect(Math.hypot(particle.x, particle.y)).toBeLessThanOrEqual(10);
    }

    for (const particle of ring.container.particleChildren) {
      const distance = Math.hypot(particle.x, particle.y);

      expect(distance).toBeGreaterThanOrEqual(18 - 1e-9);
      expect(distance).toBeLessThanOrEqual(22 + 1e-9);
    }

    for (const particle of box.container.particleChildren) {
      expect(Math.abs(particle.x)).toBeLessThanOrEqual(20);
      expect(Math.abs(particle.y)).toBeLessThanOrEqual(5);
    }
  });

  it("returns whether anything was born or died", () => {
    const { instance } = instanceOf({ textures: ["a"], rate: 1, lifeMs: [5000, 5000] });

    expect(advanceParticles(instance, 100, ORIGIN, true)).toBe(false);
    expect(advanceParticles(instance, 1000, ORIGIN, true)).toBe(true);
  });
});
