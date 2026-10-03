/**
 * @file effects/particles — what an effect bakes to on first use: the 64-entry curve tables, the
 * reach of its particles and its textures; and the cosmetic random source every instance owns.
 * Pure: no ctx, no state, no Pixi.
 */
import type { PixiTexture } from "../../renderer/types";
import type {
  BakedEmitter,
  Curve,
  EmitterDefinition,
  ResolvedEmitterConfig,
  Rng,
  Shape
} from "./types";

/** Entries of a curve table: the life of a particle in 64 steps. */
export const TABLE_SIZE = 64;

/** The 32-bit range a seed and the xorshift state live in. */
const UINT32 = 0x1_00_00_00_00;

/** What a seed of 0 becomes: xorshift never leaves 0. */
const ZERO_SEED = 0x9e_37_79_b9;

/**
 * Creates the cosmetic random source of one instance: xorshift32 over its seed. Never
 * `Math.random` and never the model's rng, so a visual checkpoint renders the same twice.
 *
 * @param seed - Any number; its low 32 bits are used, 0 is replaced.
 * @returns The random source.
 * @example
 * ```ts
 * createRng(42).next() === createRng(42).next(); // true
 * ```
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0 || ZERO_SEED;

  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;

    return state / UINT32;
  };

  return {
    next,
    int: (count: number): number => Math.min(count - 1, Math.floor(next() * count)),
    between: (min: number, max: number): number => min + (max - min) * next()
  };
}

/**
 * The seed of the instance number `ordinal` of an effect: FNV-1a of the id, mixed with the
 * ordinal. Two instances of one effect never share a seed.
 *
 * @param id - The effect id.
 * @param ordinal - How many instances started before this one.
 * @returns A seed above 0.
 * @example
 * ```ts
 * seedOf("fx.steam", 0) === seedOf("fx.steam", 1); // false
 * ```
 */
export function seedOf(id: string, ordinal: number): number {
  let hash = 0x81_1c_9d_c5;

  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }

  hash = (hash ^ Math.imul(ordinal + 1, 0x9e_37_79_b1)) >>> 0;

  return hash === 0 ? 1 : hash;
}

/**
 * The byte Pixi packs an alpha into, from 0..1.
 *
 * @param alpha - The alpha; clamped to 0..1.
 * @returns 0..255.
 * @example
 * ```ts
 * alphaByte(0.5); // 128
 * ```
 */
export function alphaByte(alpha: number): number {
  return Math.round(Math.min(1, Math.max(0, alpha)) * 255);
}

/**
 * Packs a `0xrrggbb` colour the way Pixi's particle colour reads it, `0xbbggrr`.
 *
 * @param rgb - The colour.
 * @returns The same channels, swapped.
 * @example
 * ```ts
 * toBgr(0xff_00_00); // 0x0000ff
 * ```
 */
function toBgr(rgb: number): number {
  return ((rgb & 0xff) << 16) | (rgb & 0xff_00) | ((rgb >> 16) & 0xff);
}

/**
 * A point between two numbers.
 *
 * @param curve - The two ends.
 * @param t - Where between them, 0..1.
 * @returns The number at `t`.
 * @example
 * ```ts
 * along({ from: 1, to: 0 }, 0.25); // 0.75
 * ```
 */
function along(curve: Curve, t: number): number {
  return curve.from + (curve.to - curve.from) * t;
}

/**
 * A colour between two colours, linear per channel.
 *
 * @param curve - The two `0xrrggbb` ends.
 * @param t - Where between them, 0..1.
 * @returns The `0xrrggbb` colour at `t`.
 * @example
 * ```ts
 * mixColor({ from: 0x000000, to: 0xff_ff_ff }, 0.5); // 0x808080
 * ```
 */
function mixColor(curve: Curve, t: number): number {
  let color = 0;

  for (const shift of [16, 8, 0]) {
    const from = (curve.from >> shift) & 0xff;
    const to = (curve.to >> shift) & 0xff;

    color |= Math.round(from + (to - from) * t) << shift;
  }

  return color;
}

/**
 * How far from the origin a particle is born at most.
 *
 * @param shape - The birth shape.
 * @returns The distance in reference units.
 * @example
 * ```ts
 * shapeExtent({ kind: "rect", w: 60, h: 80 }); // 50
 * ```
 */
function shapeExtent(shape: Shape): number {
  switch (shape.kind) {
    case "circle": {
      return shape.radius;
    }
    case "rect": {
      return Math.hypot(shape.w, shape.h) / 2;
    }
    case "ring": {
      return shape.radius + shape.width / 2;
    }
    default: {
      return 0;
    }
  }
}

/**
 * The half side of the box no particle of an effect leaves: the fastest flight over the longest
 * life, the fall, the birth shape and the largest particle.
 *
 * @param config - The resolved config.
 * @param maxSide - The largest side of its textures, in pixels.
 * @returns The reach in reference units.
 */
function reachOf(config: ResolvedEmitterConfig, maxSide: number): number {
  const seconds = config.lifeMs[1] / 1000;
  const flight = config.speed[1] * seconds + 0.5 * Math.abs(config.gravity) * seconds * seconds;

  return (
    flight + shapeExtent(config.shape) + maxSide * Math.max(config.scale.from, config.scale.to)
  );
}

/**
 * Bakes an effect over its resolved textures: the scale, alpha and tint of every 1/64 of a life,
 * the reach and the textures. Entry `k` holds the value at `t = k / 63`.
 *
 * @param definition - The effect.
 * @param textures - Its textures, in the order of `config.textures`; at least one.
 * @returns The baked effect.
 */
export function bakeEmitter(
  definition: EmitterDefinition,
  textures: readonly PixiTexture[]
): BakedEmitter {
  const { config } = definition;
  const scaleTable = new Float32Array(TABLE_SIZE);
  const alphaTable = new Float32Array(TABLE_SIZE);
  const tintTable = new Uint32Array(TABLE_SIZE);

  for (let index = 0; index < TABLE_SIZE; index += 1) {
    const t = index / (TABLE_SIZE - 1);

    scaleTable[index] = along(config.scale, t);
    alphaTable[index] = along(config.alpha, t);
    tintTable[index] = toBgr(mixColor(config.tint, t));
  }

  const maxSide = Math.max(...textures.map(texture => Math.max(texture.width, texture.height)));

  return {
    id: definition.id,
    config,
    scaleTable,
    alphaTable,
    tintTable,
    reach: reachOf(config, maxSide),
    textures: Object.freeze([...textures]),
    source: textures[0]?.source,
    maxSide
  };
}
