/**
 * @file renderer/kept — the picture grid: the bounds of a linear part, the stage boxes, the quad origin and the keys.
 * Pure. Every texture works on the same pixel grid as Pixi's live filter pass: the subtree picture on the grid of the
 * stack's resolution, the filter output on the renderer's.
 */

/**
 * Where each number of a record's key lives (`KeptRecord.key`). The take keys are written when stage 1 runs, the seen
 * keys every drawn frame, the stage-3 keys when stage 3 runs.
 */
export const KEY = {
  /** The linear part of the top's world transform at the take. */
  a: 0,
  b: 1,
  c: 2,
  d: 3,
  /** The stack resolution at the take. */
  rs: 4,
  /** The translation of the top at the take. */
  tx: 5,
  ty: 6,
  /** The picture's box on the canvas at the take, CSS px: its origin and its size. */
  X0: 7,
  Y0: 8,
  w1: 9,
  h1: 10,
  /** The padding of the stack on the `rs` grid. */
  Ps: 11,
  /** The renderer resolution and the padding sum at the last stage 3. */
  r: 12,
  P: 13,
  /** The translation the last stage 3 was drawn at (a placed filter's origin follows it). */
  s3Tx: 14,
  s3Ty: 15,
  /** The linear part and the stack resolution of the last drawn frame (a live record's stillness). */
  seenA: 16,
  seenB: 17,
  seenC: 18,
  seenD: 19,
  seenRs: 20,
  /** The translation of the last drawn frame (rest, P2.5). */
  lastTx: 21,
  lastTy: 22,
  /** The local transform last written on the quad (compared before a write). */
  qa: 23,
  qb: 24,
  qc: 25,
  qd: 26,
  qtx: 27,
  qty: 28,
  /** The canvas size at the take, CSS px: a picture cut to it is taken again when it changes (F53). */
  sw: 29,
  sh: 30
} as const;

/** Numbers a key holds. */
export const KEY_SIZE = 31;

/** Numbers of a 2D affine matrix: `a`, `b`, `c`, `d`, `tx`, `ty`. */
export const MATRIX_CELLS = 6;

/** The most device pixels a picture has on a side (P2.7). */
export const MAX_SIDE = 4096;

/** A whole number of texels within this much (P2.5). */
const ON_GRID = 1 / 64;

/** Bytes of one RGBA texel. */
const TEXEL_BYTES = 4;

/**
 * The bounds of a box under the linear part (a, b, c, d) of a transform.
 *
 * @param a - Matrix a.
 * @param b - Matrix b.
 * @param c - Matrix c.
 * @param d - Matrix d.
 * @param box - The local bounds.
 * @param box.minX - Left.
 * @param box.minY - Top.
 * @param box.maxX - Right.
 * @param box.maxY - Bottom.
 * @returns The box of the four corners.
 * @example
 * ```ts
 * linearBounds(2, 0, 0, 2, { minX: -32, minY: -32, maxX: 32, maxY: 32 }); // { x0: -64, y0: -64, x1: 64, y1: 64 }
 * ```
 */
export function linearBounds(
  a: number,
  b: number,
  c: number,
  d: number,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): { x0: number; y0: number; x1: number; y1: number } {
  const { minX, minY, maxX, maxY } = box;
  const xs = [a * minX + c * minY, a * maxX + c * minY, a * minX + c * maxY, a * maxX + c * maxY];
  const ys = [b * minX + d * minY, b * maxX + d * minY, b * minX + d * maxY, b * maxX + d * maxY];

  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * The texels of a span on the grid of a resolution: from the texel the start falls in to the one the end falls in.
 *
 * @param start - The span's start on the canvas, CSS px.
 * @param end - Its end.
 * @param resolution - Texels per CSS px.
 * @returns The first texel and the texel count.
 * @example
 * ```ts
 * gridSpan(100.3, 164.3, 2); // { first: 200, texels: 129 }
 * ```
 */
export function gridSpan(
  start: number,
  end: number,
  resolution: number
): { first: number; texels: number } {
  const first = Math.floor(start * resolution);

  return { first, texels: Math.ceil(end * resolution) - first };
}

/**
 * A span on the canvas cut to the canvas and the padding around it (F53). Pixi's live filter pass cuts its target to
 * the viewport and pads it after, so it draws what lies within the padding of the canvas too: a glow just off the
 * screen still reaches in. A span wholly outside comes back empty: its end is not after its start.
 *
 * @param start - The span's start on the canvas, CSS px.
 * @param end - Its end.
 * @param size - The canvas size on that axis, CSS px.
 * @param padding - The padding of the filters, CSS px.
 * @returns The part of the span kept.
 * @example
 * ```ts
 * cutSpan(-40, 120, 100, 10); // { start: -10, end: 110 }
 * ```
 */
export function cutSpan(
  start: number,
  end: number,
  size: number,
  padding: number
): { start: number; end: number } {
  return { start: Math.max(start, -padding), end: Math.min(end, size + padding) };
}

/**
 * The padding of a stack on the grid of its resolution: what stage 3 adds on each side of the subtree picture, so the
 * picture's bounds stay on that grid inside the output texture.
 *
 * @param padding - The sum of the enabled filters' paddings, whole pixels.
 * @param resolution - The stack resolution.
 * @returns CSS px.
 * @example
 * ```ts
 * paddingOnGrid(10, 0.5); // 10
 * ```
 */
export function paddingOnGrid(padding: number, resolution: number): number {
  return Math.ceil(padding * resolution) / resolution;
}

/**
 * Tells whether a number is a whole number within 1/64.
 *
 * @param value - The number.
 * @returns True when it is.
 */
function nearWhole(value: number): boolean {
  return Math.abs(value - Math.round(value)) <= ON_GRID;
}

/**
 * Tells whether a move keeps a picture on the texel grids of both its textures: the subtree picture's and the output's.
 *
 * @param delta - The move since the take, CSS px, one axis.
 * @param stackResolution - The stack resolution.
 * @param resolution - The renderer resolution.
 * @returns True when the quad draws texel for texel after the move.
 * @example
 * ```ts
 * onGrid(0.25, 2, 2); // false: half a texel off, a settle retake is owed at rest
 * ```
 */
export function onGrid(delta: number, stackResolution: number, resolution: number): boolean {
  return nearWhole(delta * stackResolution) && nearWhole(delta * resolution);
}

/**
 * Tells whether a picture can be taken at this size: not empty, and at most 4096 device pixels on a side.
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param resolution - Device pixels per CSS px of its texture.
 * @returns True when it fits.
 * @example
 * ```ts
 * fitsTexture(2100, 300, 2); // false: 4200 device pixels wide
 * ```
 */
export function fitsTexture(width: number, height: number, resolution: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    Math.ceil(width * resolution) <= MAX_SIDE &&
    Math.ceil(height * resolution) <= MAX_SIDE
  );
}

/**
 * The estimated bytes of a texture: four per texel, no mips.
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param resolution - Texels per CSS px.
 * @returns Bytes.
 * @example
 * ```ts
 * textureBytes(384, 832, 2); // 5111808: a full phone screen at resolution 2
 * ```
 */
export function textureBytes(width: number, height: number, resolution: number): number {
  return Math.ceil(width * resolution) * Math.ceil(height * resolution) * TEXEL_BYTES;
}

/**
 * Keeps the six numbers of a matrix in `cells` from `at` on, written only when one differs from what they hold: a
 * frame whose transform stands writes nothing. A held NaN always differs, so a fresh row is written.
 *
 * @param cells - Where the numbers are kept.
 * @param at - The index of `a`; `b`, `c`, `d`, `tx` and `ty` follow it.
 * @param matrix - The matrix now.
 * @returns True when a number differed and the six were written.
 * @example
 * ```ts
 * storeMatrix(new Float64Array(6).fill(Number.NaN), 0, { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 5 }); // true
 * ```
 */
export function storeMatrix(
  cells: Float64Array,
  at: number,
  matrix: Readonly<{ a: number; b: number; c: number; d: number; tx: number; ty: number }>
): boolean {
  if (
    cells[at] === matrix.a &&
    cells[at + 1] === matrix.b &&
    cells[at + 2] === matrix.c &&
    cells[at + 3] === matrix.d &&
    cells[at + 4] === matrix.tx &&
    cells[at + 5] === matrix.ty
  ) {
    return false;
  }

  cells[at] = matrix.a;
  cells[at + 1] = matrix.b;
  cells[at + 2] = matrix.c;
  cells[at + 3] = matrix.d;
  cells[at + 4] = matrix.tx;
  cells[at + 5] = matrix.ty;

  return true;
}
