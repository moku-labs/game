/**
 * @file effects/particles — `defineEmitter`: a particle effect as frozen, validated data. Pure: no
 * ctx and no state, so a mistake throws at definition, when the module of the feature loads.
 */
import type {
  Curve,
  EmitterConfig,
  EmitterDefinition,
  Range,
  ResolvedEmitterConfig,
  Shape
} from "./types";

/** The most textures one effect may name. */
const MAX_TEXTURES = 16;

/** The most live particles one instance may have, and the longest prewarm. */
const MAX_CEILING = 5000;

/** The size fields of every shape kind. */
const SHAPE_SIZES: Readonly<Record<string, readonly string[]>> = {
  point: [],
  circle: ["radius"],
  rect: ["w", "h"],
  ring: ["radius", "width"]
};

/** The rule every shape follows, as the message words it. */
const SHAPE_RULE = "a point, a circle, a rect or a ring of sizes at least 0";

/** Every field of a config that is not given. */
const DEFAULTS: Omit<ResolvedEmitterConfig, "textures"> = {
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
};

/**
 * Builds the error of a field out of its range.
 *
 * @param id - The emitter id.
 * @param field - The field.
 * @param rule - What the field must be.
 * @param value - What it was.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * outOfRange("fx.x", "drag", "between 0 and 1", 2).message; // '[game] Emitter "fx.x": drag must be between 0 and 1.\n  Got 2.'
 * ```
 */
function outOfRange(id: string, field: string, rule: string, value: unknown): Error {
  return new Error(
    `[game] Emitter "${id}": ${field} must be ${rule}.\n  Got ${JSON.stringify(value)}.`
  );
}

/**
 * Tells whether a value is a finite number.
 *
 * @param value - Anything from the config.
 * @returns True for a number that is neither NaN nor infinite.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tells whether a value is a range whose minimum is at least `floor` (or above it, when `strict`).
 *
 * @param value - Anything from the config.
 * @param floor - The lowest allowed minimum; none when left out.
 * @param strict - True when the minimum must be above `floor`.
 * @returns True for a valid range.
 * @example
 * ```ts
 * isRange([0, 100], 0, true); // false: the minimum must be above 0
 * ```
 */
function isRange(value: unknown, floor?: number, strict = false): value is Range {
  if (!Array.isArray(value) || value.length !== 2) return false;

  const [min, max]: unknown[] = value;

  if (!isFiniteNumber(min) || !isFiniteNumber(max) || min > max) return false;
  if (floor === undefined) return true;

  return strict ? min > floor : min >= floor;
}

/**
 * Tells whether a value is a curve whose two ends lie in `[low, high]`.
 *
 * @param value - Anything from the config.
 * @param low - The lowest allowed end.
 * @param high - The highest allowed end.
 * @returns True for a valid curve.
 * @example
 * ```ts
 * isCurve({ from: 1, to: 2 }, 0, 1); // false
 * ```
 */
function isCurve(value: unknown, low: number, high: number): value is Curve {
  if (typeof value !== "object" || value === null) return false;

  return ["from", "to"].every(end => {
    const number: unknown = Reflect.get(value, end);

    return isFiniteNumber(number) && number >= low && number <= high;
  });
}

/**
 * Tells whether a value is a shape with every size at least 0.
 *
 * @param value - Anything from the config.
 * @returns True for a valid shape.
 * @example
 * ```ts
 * isShape({ kind: "ring", radius: 30, width: 8 }); // true
 * ```
 */
function isShape(value: unknown): value is Shape {
  if (typeof value !== "object" || value === null) return false;

  const kind: unknown = Reflect.get(value, "kind");

  if (typeof kind !== "string" || !Object.hasOwn(SHAPE_SIZES, kind)) return false;

  return (SHAPE_SIZES[kind] ?? []).every(field => {
    const size: unknown = Reflect.get(value, field);

    return isFiniteNumber(size) && size >= 0;
  });
}

/**
 * Tells whether a value is an integer in `[low, high]`.
 *
 * @param value - Anything from the config.
 * @param low - The lowest allowed value.
 * @param high - The highest allowed value.
 * @returns True for such an integer.
 * @example
 * ```ts
 * isIntegerIn(2.5, 1, 10); // false
 * ```
 */
function isIntegerIn(value: unknown, low: number, high: number): value is number {
  return Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
}

/**
 * Checks the textures, and that exactly one of `burst` and `rate` is given.
 *
 * @param id - The emitter id.
 * @param config - The config as the game wrote it.
 * @throws {Error} When the textures or the emission break their rules.
 */
function checkEmission(id: string, config: EmitterConfig): void {
  if (!Array.isArray(config.textures) || config.textures.length === 0) {
    throw new Error(`[game] Emitter "${id}" names no texture.\n  List at least one texture key.`);
  }

  if (config.textures.length > MAX_TEXTURES) {
    throw outOfRange(id, "textures", `at most ${MAX_TEXTURES} keys`, config.textures.length);
  }

  if (config.burst !== undefined && config.rate !== undefined) {
    throw new Error(`[game] Emitter "${id}" has burst and rate.\n  Keep one of them.`);
  }

  if (config.burst === undefined && config.rate === undefined) {
    throw new Error(`[game] Emitter "${id}" has neither burst nor rate.\n  Give it one.`);
  }

  if (config.burst !== undefined && !isIntegerIn(config.burst, 1, Number.MAX_SAFE_INTEGER)) {
    throw outOfRange(id, "burst", "an integer of at least 1", config.burst);
  }

  if (config.rate !== undefined && !(isFiniteNumber(config.rate) && config.rate > 0)) {
    throw outOfRange(id, "rate", "above 0", config.rate);
  }
}

/**
 * Checks the ranges and the forces of a resolved config.
 *
 * @param id - The emitter id.
 * @param config - The config with its defaults.
 * @throws {Error} When a range, the gravity or the drag break their rules.
 */
function checkMotion(id: string, config: ResolvedEmitterConfig): void {
  if (!isRange(config.lifeMs, 0, true)) {
    throw outOfRange(id, "lifeMs", "a range with 0 < min ≤ max", config.lifeMs);
  }

  if (!isRange(config.speed, 0)) {
    throw outOfRange(id, "speed", "a range with 0 ≤ min ≤ max", config.speed);
  }

  if (!isRange(config.angle)) {
    throw outOfRange(id, "angle", "a range with min ≤ max", config.angle);
  }

  if (!isRange(config.spin)) {
    throw outOfRange(id, "spin", "a range with min ≤ max", config.spin);
  }

  if (!isFiniteNumber(config.gravity)) {
    throw outOfRange(id, "gravity", "a finite number", config.gravity);
  }

  if (!(isFiniteNumber(config.drag) && config.drag >= 0 && config.drag <= 1)) {
    throw outOfRange(id, "drag", "between 0 and 1", config.drag);
  }
}

/**
 * Checks the shape, the curves and the instance settings of a resolved config.
 *
 * @param id - The emitter id.
 * @param config - The config with its defaults.
 * @throws {Error} When one of them breaks its rule.
 */
function checkLook(id: string, config: ResolvedEmitterConfig): void {
  if (!isShape(config.shape)) throw outOfRange(id, "shape", SHAPE_RULE, config.shape);

  if (!isCurve(config.scale, 0, Number.MAX_VALUE)) {
    throw outOfRange(id, "scale", "a curve of numbers of at least 0", config.scale);
  }

  if (!isCurve(config.alpha, 0, 1)) {
    throw outOfRange(id, "alpha", "a curve between 0 and 1", config.alpha);
  }

  if (!isCurve(config.tint, 0, 0xff_ff_ff)) {
    throw outOfRange(id, "tint", "a curve of 0xrrggbb colours", config.tint);
  }

  if (config.space !== "world" && config.space !== "local") {
    throw outOfRange(id, "space", '"world" or "local"', config.space);
  }

  if (
    !(isFiniteNumber(config.prewarmMs) && config.prewarmMs >= 0 && config.prewarmMs <= MAX_CEILING)
  ) {
    throw outOfRange(id, "prewarmMs", `between 0 and ${MAX_CEILING}`, config.prewarmMs);
  }

  if (!isIntegerIn(config.maxParticles, 1, MAX_CEILING)) {
    throw outOfRange(
      id,
      "maxParticles",
      `an integer from 1 to ${MAX_CEILING}`,
      config.maxParticles
    );
  }

  if (config.blend !== "normal" && config.blend !== "add") {
    throw outOfRange(id, "blend", '"normal" or "add"', config.blend);
  }
}

/**
 * Copies a range into a frozen pair.
 *
 * @param range - A checked range.
 * @returns The same two numbers, frozen.
 * @example
 * ```ts
 * Object.isFrozen(frozenRange([1, 2])); // true
 * ```
 */
function frozenRange(range: Range): Range {
  return Object.freeze([range[0], range[1]] as const);
}

/**
 * Copies a checked config, every nested value copied and frozen, so the caller's arrays and
 * objects never reach the definition.
 *
 * @param config - The config with its defaults.
 * @returns The frozen config.
 */
function freezeConfig(config: ResolvedEmitterConfig): ResolvedEmitterConfig {
  return Object.freeze({
    ...config,
    textures: Object.freeze([...config.textures]),
    lifeMs: frozenRange(config.lifeMs),
    speed: frozenRange(config.speed),
    angle: frozenRange(config.angle),
    spin: frozenRange(config.spin),
    shape: Object.freeze({ ...config.shape }),
    scale: Object.freeze({ ...config.scale }),
    alpha: Object.freeze({ ...config.alpha }),
    tint: Object.freeze({ ...config.tint })
  });
}

/**
 * Describes a particle effect. Every field is optional except `textures` and exactly one of
 * `burst` and `rate`; the definition is frozen, registered through the `emitters` key of a feature
 * and started by an `Emitter` component naming its id.
 *
 * @param id - The effect id, unique across the features of the game.
 * @param config - The effect as data.
 * @returns The frozen definition `{ id, config }`, the config with every default filled in.
 * @throws {Error} When the id is empty or a field breaks its rule.
 * @example
 * ```ts
 * // features/board/effects.ts: the steam over the generator.
 * const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12, space: "local" });
 * steam.config.rate; // 12
 * steam.config.lifeMs; // [600, 1000], the default
 * ```
 */
export function defineEmitter(id: string, config: EmitterConfig): EmitterDefinition {
  if (typeof id !== "string" || id === "") {
    throw new Error(
      "[game] An emitter needs an id.\n  Pass a non-empty string as the first argument."
    );
  }

  checkEmission(id, config);

  const resolved: ResolvedEmitterConfig = { ...DEFAULTS, ...config };

  checkMotion(id, resolved);
  checkLook(id, resolved);

  return Object.freeze({ id, config: freezeConfig(resolved) });
}
