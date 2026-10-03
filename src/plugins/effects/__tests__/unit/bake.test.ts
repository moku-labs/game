import { describe, expect, it } from "vitest";
import type { PixiTexture } from "../../../renderer/types";
import { alphaByte, bakeEmitter, createRng, seedOf } from "../../particles/bake";
import { defineEmitter } from "../../particles/define";
import { atlasTexture } from "../fake-effects-pixi";

// ---------------------------------------------------------------------------
// Unit test: the bake of an emitter (curve tables, reach, textures) and the
// cosmetic random source
// ---------------------------------------------------------------------------

const page = { width: 256, height: 256, destroyed: false };

/**
 * Two fake textures of one page, 32 and 48 pixels wide.
 *
 * @returns The textures, typed as Pixi's.
 */
function textures(): PixiTexture[] {
  return [atlasTexture(page, 32), atlasTexture(page, 48)] as unknown as PixiTexture[];
}

describe("createRng", () => {
  it("draws the same sequence for the same seed", () => {
    const first = createRng(42);
    const second = createRng(42);
    const a = Array.from({ length: 5 }, () => first.next());
    const b = Array.from({ length: 5 }, () => second.next());

    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(5);
  });

  it("draws another sequence for another seed", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("stays in range", () => {
    const rng = createRng(7);

    for (let index = 0; index < 200; index += 1) {
      const value = rng.next();
      const integer = rng.int(3);
      const between = rng.between(-2, 5);

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect([0, 1, 2]).toContain(integer);
      expect(between).toBeGreaterThanOrEqual(-2);
      expect(between).toBeLessThanOrEqual(5);
    }
  });

  it("works with a seed of 0", () => {
    const rng = createRng(0);

    expect(rng.next()).toBeGreaterThan(0);
  });
});

describe("seedOf", () => {
  it("is fixed per id and ordinal and differs per ordinal", () => {
    expect(seedOf("fx.steam", 0)).toBe(seedOf("fx.steam", 0));
    expect(seedOf("fx.steam", 0)).not.toBe(seedOf("fx.steam", 1));
    expect(seedOf("fx.steam", 0)).not.toBe(seedOf("fx.stars", 0));
    expect(seedOf("fx.steam", 3)).toBeGreaterThan(0);
  });
});

describe("alphaByte", () => {
  it("maps 0..1 to 0..255 and clamps", () => {
    expect(alphaByte(0)).toBe(0);
    expect(alphaByte(0.5)).toBe(128);
    expect(alphaByte(1)).toBe(255);
    expect(alphaByte(2)).toBe(255);
    expect(alphaByte(-1)).toBe(0);
  });
});

describe("bakeEmitter", () => {
  it("bakes 64-entry tables from birth to death", () => {
    const def = defineEmitter("fx.x", {
      textures: ["a", "b"],
      burst: 1,
      scale: { from: 1, to: 0 },
      alpha: { from: 0, to: 1 },
      tint: { from: 0xff_00_00, to: 0x00_00_ff }
    });
    const baked = bakeEmitter(def, textures());

    expect(baked.scaleTable).toHaveLength(64);
    expect(baked.alphaTable).toHaveLength(64);
    expect(baked.tintTable).toHaveLength(64);
    expect(baked.scaleTable[0]).toBe(1);
    expect(baked.scaleTable[63]).toBe(0);
    expect(baked.scaleTable[32]).toBeCloseTo(1 - 32 / 63, 5);
    expect(baked.alphaTable[0]).toBe(0);
    expect(baked.alphaTable[63]).toBe(1);
    // Pixi packs a tint as 0xbbggrr: red is 0x0000ff, blue is 0xff0000.
    expect(baked.tintTable[0]).toBe(0x00_00_ff);
    expect(baked.tintTable[63]).toBe(0xff_00_00);
    expect(baked.tintTable[32]).toBe((130 << 16) | 125);
  });

  it("keeps the textures, their source and the largest side", () => {
    const list = textures();
    const baked = bakeEmitter(defineEmitter("fx.x", { textures: ["a", "b"], burst: 1 }), list);

    expect(baked.textures).toEqual(list);
    expect(baked.source).toBe(page);
    expect(baked.maxSide).toBe(48);
    expect(baked.id).toBe("fx.x");
  });

  it("reaches as far as a particle can fly, plus the shape and the largest particle", () => {
    const still = bakeEmitter(defineEmitter("fx.x", { textures: ["a"], burst: 1 }), textures());

    // Nothing moves: only the largest texture, 48 px at scale 1.
    expect(still.reach).toBe(48);

    const flying = bakeEmitter(
      defineEmitter("fx.x", {
        textures: ["a"],
        burst: 1,
        lifeMs: [500, 1000],
        speed: [0, 100],
        gravity: 200,
        shape: { kind: "circle", radius: 24 },
        scale: { from: 2, to: 1 }
      }),
      textures()
    );

    // 100 × 1 + ½ × 200 × 1² + 24 + 48 × 2
    expect(flying.reach).toBe(320);

    const ring = bakeEmitter(
      defineEmitter("fx.x", {
        textures: ["a"],
        burst: 1,
        shape: { kind: "ring", radius: 30, width: 10 }
      }),
      textures()
    );

    expect(ring.reach).toBe(35 + 48);

    const box = bakeEmitter(
      defineEmitter("fx.x", { textures: ["a"], burst: 1, shape: { kind: "rect", w: 60, h: 80 } }),
      textures()
    );

    expect(box.reach).toBe(50 + 48);
  });

  it("counts a negative gravity by its size", () => {
    const up = bakeEmitter(
      defineEmitter("fx.x", { textures: ["a"], burst: 1, lifeMs: [1000, 1000], gravity: -200 }),
      textures()
    );

    expect(up.reach).toBe(100 + 48);
  });
});
