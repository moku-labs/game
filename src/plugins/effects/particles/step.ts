/**
 * @file effects/particles — the particle step: emission with a fractional carry, the advance of
 * every live particle, retirement by swap-remove, and one `update()` when anything was born or
 * died. Works on one instance and its container; no ctx, no world.
 */
import type { Point } from "../../renderer/types";
import { alphaByte, TABLE_SIZE } from "./bake";
import type { BakedEmitter, BornFields, EmitterInstance, Rng, Shape } from "./types";

/** The slice a prewarm is simulated in, in milliseconds. */
const SLICE_MS = 16;

/** What a carry may miss a whole particle by and still emit it: float sums of exact frames. */
const EPSILON = 1e-6;

/** Radians per degree. */
const DEGREES = Math.PI / 180;

/** The origin, where a prewarm and a burst are born. */
const ORIGIN: Readonly<Point> = Object.freeze({ x: 0, y: 0 });

/**
 * Where a particle is born inside its shape, around the origin.
 *
 * @param shape - The birth shape.
 * @param rng - The instance's random source.
 * @returns The offset from the origin.
 */
function birthPoint(shape: Shape, rng: Rng): Point {
  if (shape.kind === "point") return { x: 0, y: 0 };

  if (shape.kind === "rect") {
    return { x: (rng.next() - 0.5) * shape.w, y: (rng.next() - 0.5) * shape.h };
  }

  const inner = shape.kind === "ring" ? Math.max(0, shape.radius - shape.width / 2) : 0;
  const outer = shape.kind === "ring" ? shape.radius + shape.width / 2 : shape.radius;
  // Uniform over the area: the square root of a uniform share of the annulus.
  const distance = Math.sqrt(inner * inner + rng.next() * (outer * outer - inner * inner));
  const turn = rng.next() * 2 * Math.PI;

  return { x: Math.cos(turn) * distance, y: Math.sin(turn) * distance };
}

/**
 * The packed colour of a particle at one step of its life: the tint under the alpha byte.
 *
 * @param baked - The baked effect.
 * @param step - The table entry, 0..63.
 * @returns Pixi's `0xaabbggrr` particle colour.
 */
function colorAt(baked: BakedEmitter, step: number): number {
  return ((baked.tintTable[step] ?? 0) | (alphaByte(baked.alphaTable[step] ?? 1) << 24)) >>> 0;
}

/**
 * Moves the born fields of one particle to another index, the way the swap-remove moves it.
 *
 * @param born - The born fields.
 * @param from - The index the particle leaves.
 * @param to - The index it takes.
 */
function moveBorn(born: BornFields, from: number, to: number): void {
  for (const field of [born.age, born.life, born.vx, born.vy, born.spin, born.variant]) {
    field[to] = field[from] ?? 0;
  }
}

/**
 * Takes one particle out: the last particle takes its index, the born fields follow, and the
 * particle goes to the pool. Never `removeParticle`, which is O(n) per particle.
 *
 * @param instance - The instance.
 * @param index - The index of the particle that died.
 */
function swapRemove(instance: EmitterInstance, index: number): void {
  const children = instance.container.particleChildren;
  const dead = children[index];
  const last = children.pop();

  if (last !== undefined && index < children.length) {
    children[index] = last;
    moveBorn(instance.born, children.length, index);
  }

  if (dead !== undefined) instance.pool.push(dead);
}

/**
 * Advances every live particle by `deltaMs`: age, gravity, drag, position, spin, then the scale
 * and the packed colour of its new age. A particle at its life is swap-removed.
 *
 * @param instance - The instance.
 * @param deltaMs - Milliseconds of game time.
 * @returns How many particles died.
 */
function advanceLive(instance: EmitterInstance, deltaMs: number): number {
  const { baked, born } = instance;
  const children = instance.container.particleChildren;
  const seconds = deltaMs / 1000;
  const keep = (1 - baked.config.drag) ** seconds;
  const fall = baked.config.gravity * seconds;
  let died = 0;
  let index = 0;

  while (index < children.length) {
    const particle = children[index];
    const age = (born.age[index] ?? 0) + deltaMs;
    const life = born.life[index] ?? 0;

    if (particle === undefined || age >= life) {
      swapRemove(instance, index);
      died += 1;
      continue;
    }

    const vx = (born.vx[index] ?? 0) * keep;
    const vy = ((born.vy[index] ?? 0) + fall) * keep;
    const step = Math.min(TABLE_SIZE - 1, Math.floor((age / life) * TABLE_SIZE));
    const scale = baked.scaleTable[step] ?? 1;

    born.age[index] = age;
    born.vx[index] = vx;
    born.vy[index] = vy;
    particle.x += vx * seconds;
    particle.y += vy * seconds;
    particle.rotation += (born.spin[index] ?? 0) * seconds;
    particle.scaleX = scale;
    particle.scaleY = scale;
    particle.color = colorAt(baked, step);
    index += 1;
  }

  return died;
}

/**
 * Emits up to `count` particles, never past `maxParticles`. A particle comes from the pool before
 * a new one is made; its texture, birth point, velocity, life and spin are drawn from the
 * instance's own random source.
 *
 * @param instance - The instance.
 * @param count - How many particles are due.
 * @param offset - Where the origin of the emission is now, in the container's space.
 * @returns How many particles were born.
 */
export function emitParticles(
  instance: EmitterInstance,
  count: number,
  offset: Readonly<Point>
): number {
  const { baked, born, rng } = instance;
  const { config } = baked;
  const children = instance.container.particleChildren;
  const due = Math.max(0, Math.min(count, config.maxParticles - children.length));

  for (let made = 0; made < due; made += 1) {
    const variant = rng.int(baked.textures.length);
    const texture = baked.textures[variant];

    if (texture === undefined) return made;

    const particle =
      instance.pool.pop() ?? new instance.particleClass({ texture, anchorX: 0.5, anchorY: 0.5 });
    const at = birthPoint(config.shape, rng);
    const turn = rng.between(config.angle[0], config.angle[1]) * DEGREES;
    const speed = rng.between(config.speed[0], config.speed[1]);
    const index = children.length;

    particle.texture = texture;
    particle.x = offset.x + at.x;
    particle.y = offset.y + at.y;
    particle.rotation = 0;
    particle.scaleX = baked.scaleTable[0] ?? 1;
    particle.scaleY = particle.scaleX;
    particle.color = colorAt(baked, 0);
    born.age[index] = 0;
    born.life[index] = rng.between(config.lifeMs[0], config.lifeMs[1]);
    born.vx[index] = Math.cos(turn) * speed;
    born.vy[index] = Math.sin(turn) * speed;
    born.spin[index] = rng.between(config.spin[0], config.spin[1]);
    born.variant[index] = variant;
    children.push(particle);
  }

  return due;
}

/**
 * Runs one step without the upload: a stream emits what its carry owes, then every live particle
 * advances. A burst emits only when its instance starts.
 *
 * @param instance - The instance.
 * @param deltaMs - Milliseconds of game time.
 * @param offset - Where the origin of the emission is now, in the container's space.
 * @param emitting - Whether a stream emits: the `active` flag of its `Emitter`.
 * @returns True when a particle was born or died, which needs one `update()`.
 */
export function advanceParticles(
  instance: EmitterInstance,
  deltaMs: number,
  offset: Readonly<Point>,
  emitting: boolean
): boolean {
  const rate = instance.baked.config.rate;
  let born = 0;

  if (rate !== undefined && emitting) {
    instance.carry += (rate * deltaMs) / 1000;

    const due = Math.floor(instance.carry + EPSILON);

    instance.carry = Math.max(0, instance.carry - due);
    born = emitParticles(instance, due, offset);
  }

  return advanceLive(instance, deltaMs) > 0 || born > 0;
}

/**
 * Runs one step of an instance and uploads once when a particle was born or died. Never
 * `addParticle` or `removeParticle` per particle: `update()` marks every attribute dirty, which
 * the churn needs anyway.
 *
 * @param instance - The instance.
 * @param deltaMs - Milliseconds of game time.
 * @param offset - Where the origin of the emission is now, in the container's space.
 * @param emitting - Whether a stream emits.
 */
export function stepInstance(
  instance: EmitterInstance,
  deltaMs: number,
  offset: Readonly<Point>,
  emitting: boolean
): void {
  if (advanceParticles(instance, deltaMs, offset, emitting)) instance.container.update();
}

/**
 * Fills a new instance before its first frame: the prewarm in 16 ms slices, then the burst, then
 * one upload.
 *
 * @param instance - The new instance.
 * @param emitting - Whether a stream emits.
 */
export function fillInstance(instance: EmitterInstance, emitting: boolean): void {
  const { prewarmMs, burst } = instance.baked.config;
  let changed = false;

  for (let spent = 0; spent < prewarmMs; spent += SLICE_MS) {
    const slice = Math.min(SLICE_MS, prewarmMs - spent);

    changed = advanceParticles(instance, slice, ORIGIN, emitting) || changed;
  }

  if (burst !== undefined) changed = emitParticles(instance, burst, ORIGIN) > 0 || changed;

  if (changed) instance.container.update();
}
