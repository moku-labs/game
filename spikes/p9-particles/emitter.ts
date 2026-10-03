// Spike P9. A thin emitter on Pixi 8.21 ParticleContainer + Particle, stepped by our own clock.
// No Pixi ticker. The caller calls step(dtMs) once per frame and then renders.

import { Particle, type ParticleContainer, type Texture } from "pixi.js";

/** A seeded RNG, separate from game RNG: effects never shift gameplay randomness. */
export function createRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (min: number, max: number) => min + (max - min) * next();
  return { next, range };
}

export type Range = readonly [number, number];
/** Keyframes over normalized life 0..1, piecewise linear. */
export type Curve = readonly (readonly [t: number, value: number])[];
/** Keyframes of 0xRRGGBB colors over normalized life. */
export type ColorCurve = readonly (readonly [t: number, rgb: number])[];
export type Shape =
  | { kind: "point" }
  | { kind: "circle"; radius: number }
  | { kind: "ring"; inner: number; outer: number };

export interface EmitterConfig {
  maxParticles: number;
  /** particles per second, 0 = bursts only */
  rate: number;
  lifetimeMs: Range;
  speed: Range;
  /** direction in radians */
  angle: Range;
  gravity: { x: number; y: number };
  /** velocity decay per second: v *= exp(-drag * dt) */
  drag: number;
  spinRadPerS: Range;
  shape: Shape;
  /** frames of one atlas page; picked at random per particle */
  textures: readonly Texture[];
  /** a curve over life, or one fixed value written at spawn */
  scale?: Curve | number;
  alpha?: Curve;
  tint?: ColorCurve;
  seed: number;
}

const LUT = 64;

const sampleCurve = (curve: Curve, t: number) => {
  const first = curve[0] as readonly [number, number];
  if (t <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i] as readonly [number, number];
    if (t <= b[0]) {
      const a = curve[i - 1] as readonly [number, number];
      return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1);
    }
  }
  return (curve[curve.length - 1] as readonly [number, number])[1];
};

const bakeCurve = (curve: Curve) => {
  const out = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) out[i] = sampleCurve(curve, i / (LUT - 1));
  return out;
};

/** Bakes a color curve into packed BGR (Pixi's particle color layout without alpha). */
const bakeColor = (curve: ColorCurve) => {
  const channel = (shift: number) => bakeCurve(curve.map(([t, rgb]) => [t, (rgb >> shift) & 0xff] as const));
  const r = channel(16);
  const g = channel(8);
  const b = channel(0);
  const out = new Uint32Array(LUT);
  for (let i = 0; i < LUT; i++) out[i] = (((b[i] as number) << 16) | ((g[i] as number) << 8) | (r[i] as number)) >>> 0;
  return out;
};

export interface Emitter {
  /** Advance by dtMs: integrate, retire, spawn from rate. Returns live count. */
  step(dtMs: number): number;
  /** Spawn count particles now at (x, y), clipped by maxParticles. Returns how many spawned. */
  burst(count: number, x: number, y: number): number;
  /** Emitter origin for rate spawning. */
  moveTo(x: number, y: number): void;
  readonly live: number;
  readonly dropped: number;
  clear(): void;
}

export function createEmitter(container: ParticleContainer, config: EmitterConfig): Emitter {
  const max = config.maxParticles;
  const rng = createRng(config.seed);
  const children = container.particleChildren as Particle[];

  // struct-of-arrays state, slot i matches children[i]
  const age = new Float32Array(max);
  const life = new Float32Array(max);
  const vx = new Float32Array(max);
  const vy = new Float32Array(max);
  const spin = new Float32Array(max);

  // pool: every Particle is created once
  const pool: Particle[] = [];
  const first = config.textures[0] as Texture;
  for (let i = 0; i < max; i++) pool.push(new Particle({ texture: first, anchorX: 0.5, anchorY: 0.5 }));

  const scaleFixed = typeof config.scale === "number" ? config.scale : 1;
  const scaleLut = typeof config.scale === "object" ? bakeCurve(config.scale) : undefined;
  const alphaLut = config.alpha ? bakeCurve(config.alpha) : undefined;
  const tintLut = config.tint ? bakeColor(config.tint) : undefined;
  const alpha0 = alphaLut ? (alphaLut[0] as number) : 1;
  const tint0 = tintLut ? (tintLut[0] as number) : 0xffffff;

  let originX = 0;
  let originY = 0;
  let carry = 0;
  let dropped = 0;
  let dirty = false;

  const spawnOne = (x: number, y: number) => {
    if (children.length >= max) {
      dropped++;
      return false;
    }
    const p = pool.pop() as Particle;
    const i = children.length;
    children.push(p);

    // position from the shape
    const shape = config.shape;
    if (shape.kind === "point") {
      p.x = x;
      p.y = y;
    } else {
      const a = rng.next() * Math.PI * 2;
      const r = shape.kind === "circle" ? shape.radius * Math.sqrt(rng.next()) : rng.range(shape.inner, shape.outer);
      p.x = x + Math.cos(a) * r;
      p.y = y + Math.sin(a) * r;
    }

    const dir = rng.range(config.angle[0], config.angle[1]);
    const speed = rng.range(config.speed[0], config.speed[1]);
    vx[i] = Math.cos(dir) * speed;
    vy[i] = Math.sin(dir) * speed;
    spin[i] = rng.range(config.spinRadPerS[0], config.spinRadPerS[1]);
    age[i] = 0;
    life[i] = rng.range(config.lifetimeMs[0], config.lifetimeMs[1]);

    const variants = config.textures;
    p.texture = variants[(rng.next() * variants.length) | 0] as Texture;
    p.rotation = rng.next() * Math.PI * 2;
    const s = scaleLut ? (scaleLut[0] as number) : scaleFixed;
    p.scaleX = s;
    p.scaleY = s;
    // write the packed color directly: the tint/alpha setters go through Color.shared
    p.color = (tint0 + (((alpha0 * 255) | 0) << 24)) >>> 0;
    dirty = true;
    return true;
  };

  const retire = (i: number) => {
    const last = children.length - 1;
    const dead = children[i] as Particle;
    if (i !== last) {
      children[i] = children[last] as Particle;
      age[i] = age[last] as number;
      life[i] = life[last] as number;
      vx[i] = vx[last] as number;
      vy[i] = vy[last] as number;
      spin[i] = spin[last] as number;
    }
    children.length = last;
    pool.push(dead);
    dirty = true;
  };

  const step = (dtMs: number) => {
    const dt = dtMs / 1000;
    const gx = config.gravity.x * dt;
    const gy = config.gravity.y * dt;
    const damp = Math.exp(-config.drag * dt);

    // integrate and retire; swap-remove keeps the arrays dense
    for (let i = 0; i < children.length; i++) {
      const a = (age[i] as number) + dtMs;
      const l = life[i] as number;
      if (a >= l) {
        retire(i);
        i--;
        continue;
      }
      age[i] = a;
      const p = children[i] as Particle;
      const nvx = ((vx[i] as number) + gx) * damp;
      const nvy = ((vy[i] as number) + gy) * damp;
      vx[i] = nvx;
      vy[i] = nvy;
      p.x += nvx * dt;
      p.y += nvy * dt;

      const k = ((a / l) * (LUT - 1)) | 0;
      if (scaleLut) {
        const s = scaleLut[k] as number;
        p.scaleX = s;
        p.scaleY = s;
      }
      if (alphaLut || tintLut) {
        const al = alphaLut ? (alphaLut[k] as number) : 1;
        const bgr = tintLut ? (tintLut[k] as number) : 0xffffff;
        p.color = (bgr + (((al * 255) | 0) << 24)) >>> 0;
      }
      const sp = spin[i] as number;
      if (sp !== 0) p.rotation += sp * dt;
    }

    // rate spawning with a carry, so 60 Hz and 120 Hz emit the same count
    if (config.rate > 0) {
      carry += config.rate * dt;
      while (carry >= 1) {
        carry -= 1;
        spawnOne(originX, originY);
      }
    }

    // static attributes (and slots moved by swap-remove) need a re-upload
    if (dirty) {
      container.update();
      dirty = false;
    }
    return children.length;
  };

  const burst = (count: number, x: number, y: number) => {
    let spawned = 0;
    for (let n = 0; n < count; n++) if (spawnOne(x, y)) spawned++;
    if (dirty) {
      container.update();
      dirty = false;
    }
    return spawned;
  };

  const clear = () => {
    while (children.length > 0) pool.push(children.pop() as Particle);
    carry = 0;
    container.update();
  };

  return {
    step,
    burst,
    moveTo(x, y) {
      originX = x;
      originY = y;
    },
    get live() {
      return children.length;
    },
    get dropped() {
      return dropped;
    },
    clear
  };
}
