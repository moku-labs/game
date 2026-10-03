import { describe, expect, it } from "vitest";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import type { EmitterConfig } from "../../particles/types";

// ---------------------------------------------------------------------------
// Unit test: defineEmitter validates every field, fills the defaults and
// returns a frozen definition; Emitter is a plain component
// ---------------------------------------------------------------------------

/**
 * Defines "fx.x" with one texture, a burst of 10 and the given overrides.
 *
 * @param patch - Fields that replace the base config.
 * @returns The definition.
 */
function define(patch: Record<string, unknown>) {
  return defineEmitter("fx.x", { textures: ["fx.star"], burst: 10, ...patch } as EmitterConfig);
}

/**
 * The message of an out-of-range field.
 *
 * @param field - The field.
 * @param rule - What it must be.
 * @param got - What it was, as JSON.
 * @returns The two-line message.
 */
function outOfRange(field: string, rule: string, got: string): string {
  return `[game] Emitter "fx.x": ${field} must be ${rule}.\n  Got ${got}.`;
}

describe("defineEmitter", () => {
  it("fills every default and keeps what was given", () => {
    const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 });

    expect(steam.id).toBe("fx.steam");
    expect(steam.config).toEqual({
      textures: ["fx.puff"],
      rate: 12,
      lifeMs: [600, 1000],
      speed: [0, 0],
      angle: [0, 360],
      gravity: 0,
      drag: 0,
      spin: [0, 0],
      shape: { kind: "point" },
      scale: { from: 1, to: 1 },
      alpha: { from: 1, to: 1 },
      tint: { from: 0xff_ff_ff, to: 0xff_ff_ff },
      space: "world",
      prewarmMs: 0,
      maxParticles: 256,
      blend: "normal"
    });
    expect("burst" in steam.config).toBe(false);
  });

  it("freezes the definition, the config and every nested value", () => {
    const stars = define({ shape: { kind: "circle", radius: 24 }, scale: { from: 1, to: 0.2 } });

    expect(Object.isFrozen(stars)).toBe(true);
    expect(Object.isFrozen(stars.config)).toBe(true);
    expect(Object.isFrozen(stars.config.textures)).toBe(true);
    expect(Object.isFrozen(stars.config.lifeMs)).toBe(true);
    expect(Object.isFrozen(stars.config.shape)).toBe(true);
    expect(Object.isFrozen(stars.config.scale)).toBe(true);
  });

  it("does not keep the caller's arrays", () => {
    const textures = ["fx.star"];
    const stars = defineEmitter("fx.x", { textures, burst: 1 });

    textures.push("fx.sparkle");

    expect(stars.config.textures).toEqual(["fx.star"]);
  });

  it("refuses an empty id", () => {
    expect(() => defineEmitter("", { textures: ["fx.star"], burst: 1 })).toThrow(
      "[game] An emitter needs an id.\n  Pass a non-empty string as the first argument."
    );
  });

  it("refuses a config without a texture", () => {
    expect(() => define({ textures: [] })).toThrow(
      '[game] Emitter "fx.x" names no texture.\n  List at least one texture key.'
    );
  });

  it("refuses more than 16 textures", () => {
    const textures = Array.from({ length: 17 }, (_, index) => `fx.t${index}`);

    expect(() => define({ textures })).toThrow(outOfRange("textures", "at most 16 keys", "17"));
  });

  it("refuses both burst and rate, and neither", () => {
    expect(() => define({ rate: 4 })).toThrow(
      '[game] Emitter "fx.x" has burst and rate.\n  Keep one of them.'
    );
    expect(() => defineEmitter("fx.x", { textures: ["fx.star"] })).toThrow(
      '[game] Emitter "fx.x" has neither burst nor rate.\n  Give it one.'
    );
  });

  it("refuses a burst below 1 or a fraction, and a rate of 0", () => {
    expect(() => define({ burst: 0 })).toThrow(
      outOfRange("burst", "an integer of at least 1", "0")
    );
    expect(() => define({ burst: 2.5 })).toThrow(
      outOfRange("burst", "an integer of at least 1", "2.5")
    );
    expect(() => defineEmitter("fx.x", { textures: ["fx.star"], rate: 0 })).toThrow(
      outOfRange("rate", "above 0", "0")
    );
  });

  it("checks every range", () => {
    expect(() => define({ lifeMs: [0, 100] })).toThrow(
      outOfRange("lifeMs", "a range with 0 < min ≤ max", "[0,100]")
    );
    expect(() => define({ lifeMs: [900, 500] })).toThrow(
      outOfRange("lifeMs", "a range with 0 < min ≤ max", "[900,500]")
    );
    expect(() => define({ speed: [-1, 10] })).toThrow(
      outOfRange("speed", "a range with 0 ≤ min ≤ max", "[-1,10]")
    );
    expect(() => define({ angle: [90, 0] })).toThrow(
      outOfRange("angle", "a range with min ≤ max", "[90,0]")
    );
    expect(() => define({ spin: [3, -3] })).toThrow(
      outOfRange("spin", "a range with min ≤ max", "[3,-3]")
    );
    expect(() => define({ spin: [1] })).toThrow(
      outOfRange("spin", "a range with min ≤ max", "[1]")
    );
  });

  it("checks gravity and drag", () => {
    expect(() => define({ gravity: Number.NaN })).toThrow(
      outOfRange("gravity", "a finite number", "null")
    );
    expect(() => define({ drag: 1.5 })).toThrow(outOfRange("drag", "between 0 and 1", "1.5"));
    expect(define({ gravity: -200, drag: 1 }).config.gravity).toBe(-200);
  });

  it("checks the shape", () => {
    expect(() => define({ shape: { kind: "circle", radius: -1 } })).toThrow(
      outOfRange(
        "shape",
        "a point, a circle, a rect or a ring of sizes at least 0",
        '{"kind":"circle","radius":-1}'
      )
    );
    expect(() => define({ shape: { kind: "star" } })).toThrow(
      outOfRange(
        "shape",
        "a point, a circle, a rect or a ring of sizes at least 0",
        '{"kind":"star"}'
      )
    );
    expect(define({ shape: { kind: "rect", w: 40, h: 20 } }).config.shape).toEqual({
      kind: "rect",
      w: 40,
      h: 20
    });
    expect(define({ shape: { kind: "ring", radius: 30, width: 8 } }).config.shape.kind).toBe(
      "ring"
    );
  });

  it("checks the curves", () => {
    expect(() => define({ scale: { from: -1, to: 1 } })).toThrow(
      outOfRange("scale", "a curve of numbers of at least 0", '{"from":-1,"to":1}')
    );
    expect(() => define({ alpha: { from: 1, to: 2 } })).toThrow(
      outOfRange("alpha", "a curve between 0 and 1", '{"from":1,"to":2}')
    );
    expect(() => define({ tint: { from: 0x1_00_00_00, to: 0 } })).toThrow(
      outOfRange("tint", "a curve of 0xrrggbb colours", '{"from":16777216,"to":0}')
    );
  });

  it("checks space, prewarm, the particle ceiling and the blend", () => {
    expect(() => define({ space: "screen" })).toThrow(
      outOfRange("space", '"world" or "local"', '"screen"')
    );
    expect(() => define({ prewarmMs: 5001 })).toThrow(
      outOfRange("prewarmMs", "between 0 and 5000", "5001")
    );
    expect(() => define({ maxParticles: 0 })).toThrow(
      outOfRange("maxParticles", "an integer from 1 to 5000", "0")
    );
    expect(() => define({ maxParticles: 5001 })).toThrow(
      outOfRange("maxParticles", "an integer from 1 to 5000", "5001")
    );
    expect(() => define({ blend: "screen" })).toThrow(
      outOfRange("blend", '"normal" or "add"', '"screen"')
    );
    expect(define({ blend: "add", prewarmMs: 5000, maxParticles: 5000 }).config.blend).toBe("add");
  });
});

describe("Emitter", () => {
  it("defaults to no effect, active", () => {
    expect(Emitter().value).toEqual({ effect: "", active: true });
    expect(Emitter({ effect: "fx.steam" }).value).toEqual({ effect: "fx.steam", active: true });
    expect(Emitter.componentName).toBe("Emitter");
  });
});
