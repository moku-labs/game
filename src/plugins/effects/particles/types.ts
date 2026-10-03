/**
 * @file effects/particles — type definitions: what a game writes (`EmitterConfig`, the `Emitter`
 * value) and what the particle step runs on (`BakedEmitter`, `EmitterInstance`).
 */
import type { PixiModule, PixiTexture, Point } from "../../renderer/types";
import type { Entity } from "../../world/types";

/**
 * An inclusive `[min, max]` range; every particle draws its own value from it.
 *
 * @example
 * ```ts
 * const lifeMs: Range = [500, 900];
 * ```
 */
export type Range = readonly [min: number, max: number];

/**
 * A value over the life of a particle, linear from its birth (`from`) to its death (`to`).
 *
 * @example
 * ```ts
 * const shrink: Curve = { from: 1, to: 0.2 };
 * ```
 */
export type Curve = { readonly from: number; readonly to: number };

/**
 * Where a particle is born, around the origin of its emitter, in reference units. `circle` is
 * uniform over the disc, `ring` uniform between `radius − width / 2` and `radius + width / 2`,
 * `rect` uniform over the centred box.
 *
 * @example
 * ```ts
 * const burstRing: Shape = { kind: "ring", radius: 48, width: 16 };
 * ```
 */
export type Shape =
  | { readonly kind: "point" }
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "rect"; readonly w: number; readonly h: number }
  | { readonly kind: "ring"; readonly radius: number; readonly width: number };

/**
 * A particle effect as data, what `defineEmitter` takes. Every field is optional except
 * `textures` and exactly one of `burst` and `rate`. Speeds are reference units per second, angles
 * degrees with 0 to the right and 90 down, spins radians per second.
 *
 * @example
 * ```ts
 * const stars: EmitterConfig = {
 *   textures: ["fx.star", "fx.sparkle"], burst: 40, lifeMs: [500, 900], speed: [300, 700],
 *   gravity: 900, drag: 0.2, shape: { kind: "circle", radius: 24 }, alpha: { from: 1, to: 0 }
 * };
 * ```
 */
export type EmitterConfig = {
  /** 1 to 16 asset keys of one atlas page; a particle picks one at random. */
  readonly textures: readonly string[];
  /** Particles emitted once, when the component appears or its `effect` changes. */
  readonly burst?: number;
  /** Particles per second while `active` is true and the entity lives. */
  readonly rate?: number;
  /** Life of a particle in milliseconds. Default `[600, 1000]`. */
  readonly lifeMs?: Range;
  /** Start speed in reference units per second. Default `[0, 0]`. */
  readonly speed?: Range;
  /** Start direction in degrees, 0 right, 90 down. Default `[0, 360]`. */
  readonly angle?: Range;
  /** Downward acceleration in reference units per second². Default `0`. */
  readonly gravity?: number;
  /** Velocity lost per second, 0..1: `v *= (1 − drag) ^ seconds`. Default `0`. */
  readonly drag?: number;
  /** Spin in radians per second. Default `[0, 0]`. */
  readonly spin?: Range;
  /** Where particles are born around the origin. Default `{ kind: "point" }`. */
  readonly shape?: Shape;
  /** Scale over life. Default `{ from: 1, to: 1 }`. */
  readonly scale?: Curve;
  /** Alpha over life, 0..1. Default `{ from: 1, to: 1 }`. */
  readonly alpha?: Curve;
  /** Tint over life, `0xrrggbb`, linear per channel. Default white to white. */
  readonly tint?: Curve;
  /** `"world"`: particles outlive the entity. `"local"`: they move and die with it. Default `"world"`. */
  readonly space?: "world" | "local";
  /** Milliseconds simulated before the first frame, for streams, 0..5000. Default `0`. */
  readonly prewarmMs?: number;
  /** Hard ceiling of live particles of one instance, 1..5000. Default `256`. */
  readonly maxParticles?: number;
  /** Blend mode of the particle container. Default `"normal"`. */
  readonly blend?: "normal" | "add";
};

/**
 * An `EmitterConfig` with every default filled in. `burst` and `rate` stay as given: exactly one
 * of them is present.
 *
 * @example
 * ```ts
 * defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 }).config.lifeMs; // [600, 1000]
 * ```
 */
export type ResolvedEmitterConfig = Required<Omit<EmitterConfig, "burst" | "rate">> &
  Pick<EmitterConfig, "burst" | "rate">;

/**
 * A particle effect as `defineEmitter` returns it: frozen, registered through the `emitters` key
 * of a feature and started by an `Emitter` component that names its id.
 *
 * @example
 * ```ts
 * const steam: EmitterDefinition = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 });
 * steam.config.rate; // 12
 * ```
 */
export type EmitterDefinition = { readonly id: string; readonly config: ResolvedEmitterConfig };

/**
 * The value of the `Emitter` component: which effect runs on the entity and whether a stream
 * emits. `""` draws nothing.
 *
 * @example
 * ```ts
 * const value: EmitterValue = { effect: "fx.steam", active: true };
 * ```
 */
export type EmitterValue = { effect: string; active: boolean };

/**
 * The cosmetic random source of one instance: xorshift32 over its own seed, never `Math.random`
 * and never the model's rng.
 */
export type Rng = {
  /** The next number in `[0, 1)`. */
  next(): number;
  /** An integer in `[0, count)`. */
  int(count: number): number;
  /** A number in `[min, max]`. */
  between(min: number, max: number): number;
};

/**
 * A Pixi particle container: what one emitter instance draws in.
 */
export type PixiParticleContainer = InstanceType<PixiModule["ParticleContainer"]>;

/**
 * One particle of a container, as the container keeps it.
 */
export type PixiParticle = PixiParticleContainer["particleChildren"][number];

/**
 * What one effect id bakes to on first use: the 64-entry curve tables, the reach rectangle's half
 * side and the resolved textures. Dropped when a bundle with one of its textures leaves.
 */
export type BakedEmitter = {
  readonly id: string;
  readonly config: ResolvedEmitterConfig;
  /** Scale per 1/64 of the life. */
  readonly scaleTable: Float32Array;
  /** Alpha per 1/64 of the life, 0..1. */
  readonly alphaTable: Float32Array;
  /** Tint per 1/64 of the life, packed as Pixi's `0xbbggrr`. */
  readonly tintTable: Uint32Array;
  /** Half side of the box no particle leaves, in reference units. */
  readonly reach: number;
  readonly textures: readonly PixiTexture[];
  /** The texture source of the first texture: every texture of the effect samples it. */
  readonly source: PixiTexture["source"] | undefined;
  /** The largest side of the textures, in pixels. */
  readonly maxSide: number;
};

/**
 * The per-particle numbers a Pixi particle has no field for, one entry per live particle, in the
 * order of `particleChildren`.
 */
export type BornFields = {
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly spin: Float32Array;
  readonly variant: Float32Array;
};

/**
 * One running effect: its container, the plugin-owned entity that carries it, the particle pool
 * and the numbers the step needs.
 */
export type EmitterInstance = {
  readonly id: string;
  readonly baked: BakedEmitter;
  /** The entity whose `Emitter` started it. */
  readonly host: Entity;
  /** The plugin-owned entity whose `Display` is the container. */
  readonly entity: Entity;
  readonly container: PixiParticleContainer;
  /** Retired particles, reused before a new one is made. */
  readonly pool: PixiParticle[];
  readonly born: BornFields;
  /** Fraction of a particle owed to the next frame of a stream. */
  carry: number;
  readonly rng: Rng;
  /** The point the container was placed at, in root space (world space only). */
  readonly origin: Readonly<Point>;
  readonly space: "world" | "local";
  /** Pixi's particle class, from the module the renderer loaded. */
  readonly particleClass: PixiModule["Particle"];
};
