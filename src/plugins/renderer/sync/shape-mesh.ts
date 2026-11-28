/**
 * @file renderer/sync — SPIKE (hot path 5, second try): the vertices of a shape the way Pixi 8.22 builds them, written
 * into arrays made once. The points of a rounded rectangle (`buildCircle`), of a rectangle (`buildRectangle`) and of an
 * arc (the path `shape-path.ts` strokes), the fan or the two triangles of a fill, and the strip of a stroke
 * (`buildLine`: alignment 0.5, miter joins, limit 10). Every vertex is Pixi's own, so the picture is Pixi's; the
 * difference is that a changed shape moves the vertices of buffers that keep their size, and Pixi packs them again
 * without rebuilding the stage's instructions. Nothing here allocates.
 *
 * The arithmetic is Pixi's, operation for operation, so the floats match: `Math.sqrt(x * x + y * y)` stays, because
 * `Math.hypot` rounds differently.
 */
/* eslint-disable unicorn/prefer-modern-math-apis -- Pixi's own arithmetic, see the file comment. */

/** Pixi's `closePointEps`: a path whose ends are this close is closed. */
const CLOSE_EPS = 1e-4;

/** Pixi's miter limit, squared. */
const MITER_LIMIT_SQUARED = 100;

/** Segments of a full ring, as `shape-path.ts` strokes it. */
const RING_SEGMENTS = 48;

/** The fewest segments of an arc. */
const ARC_MIN_SEGMENTS = 2;

/** 12 o'clock, where an arc starts. */
const TWELVE = -Math.PI / 2;

/**
 * A point coordinate, 0 past the end.
 *
 * @param points - The points.
 * @param index - The float.
 * @returns The coordinate.
 */
function at(points: Float64Array, index: number): number {
  return points[index] ?? 0;
}

/** The end of a stroke. */
export type LineCap = "butt" | "round" | "square";

/**
 * Writes the outline of a rounded rectangle at 0, 0 as Pixi's `buildCircle` does, from index 2 of `out`.
 *
 * @param out - The points, x and y in turn; index 0 and 1 stay free for a closing midpoint.
 * @param w - The width.
 * @param h - The height.
 * @param radius - The corner radius, clamped to half the shorter side.
 * @returns The number of floats written.
 */
export function roundRectPoints(out: Float64Array, w: number, h: number, radius: number): number {
  const halfWidth = w / 2;
  const halfHeight = h / 2;
  const x = halfWidth;
  const y = halfHeight;
  const r = Math.max(0, Math.min(radius, Math.min(halfWidth, halfHeight)));
  const dx = halfWidth - r;
  const dy = halfHeight - r;
  const n = Math.ceil(2.3 * Math.sqrt(r + r));
  const m = n * 8 + (dx ? 4 : 0) + (dy ? 4 : 0);
  const o = 2;

  if (dx < 0 || dy < 0 || m === 0) return 0;

  if (n === 0) {
    out[o] = out[o + 6] = x + dx;
    out[o + 1] = out[o + 3] = y + dy;
    out[o + 2] = out[o + 4] = x - dx;
    out[o + 5] = out[o + 7] = y - dy;

    return 8;
  }

  let first = 0;
  let second = n * 4 + (dx ? 2 : 0) + 2;
  let third = second;
  let fourth = m;
  let x0 = dx + r;
  let y0 = dy;
  let x1 = x + x0;
  let x2 = x - x0;
  let y1 = y + y0;

  out[o + first++] = x1;
  out[o + first++] = y1;
  out[o + --second] = y1;
  out[o + --second] = x2;

  if (dy) {
    const y22 = y - y0;

    out[o + third++] = x2;
    out[o + third++] = y22;
    out[o + --fourth] = y22;
    out[o + --fourth] = x1;
  }

  for (let step = 1; step < n; step++) {
    const a = (Math.PI / 2) * (step / n);
    const x02 = dx + Math.cos(a) * r;
    const y02 = dy + Math.sin(a) * r;
    const x12 = x + x02;
    const x22 = x - x02;
    const y12 = y + y02;
    const y22 = y - y02;

    out[o + first++] = x12;
    out[o + first++] = y12;
    out[o + --second] = y12;
    out[o + --second] = x22;
    out[o + third++] = x22;
    out[o + third++] = y22;
    out[o + --fourth] = y22;
    out[o + --fourth] = x12;
  }

  x0 = dx;
  y0 = dy + r;
  x1 = x + x0;
  x2 = x - x0;
  y1 = y + y0;

  const y2 = y - y0;

  out[o + first++] = x1;
  out[o + first++] = y1;
  out[o + --fourth] = y2;
  out[o + --fourth] = x1;

  if (dx) {
    out[o + first++] = x2;
    out[o + first++] = y1;
    out[o + --fourth] = y2;
    out[o + --fourth] = x2;
  }

  return m;
}

/**
 * Writes the corners of a rectangle at 0, 0 as Pixi's `buildRectangle` does, from index 2 of `out`.
 *
 * @param out - The points; index 0 and 1 stay free.
 * @param w - The width.
 * @param h - The height.
 * @returns The number of floats written, 0 for an empty rectangle.
 */
export function rectPoints(out: Float64Array, w: number, h: number): number {
  if (!(w > 0 && h > 0)) return 0;

  out[2] = 0;
  out[3] = 0;
  out[4] = w;
  out[5] = 0;
  out[6] = w;
  out[7] = h;
  out[8] = 0;
  out[9] = h;

  return 8;
}

/**
 * Writes the points of an arc as `shape-path.ts` draws its path, from index 2 of `out`: from 12 o'clock clockwise on
 * the circle inscribed in the box inside the stroke.
 *
 * @param out - The points; index 0 and 1 stay free.
 * @param w - The box width.
 * @param h - The box height.
 * @param strokeWidth - The stroke width.
 * @param sweep - The share of the circle, 0 to 1.
 * @returns The number of floats written.
 */
export function arcPoints(
  out: Float64Array,
  w: number,
  h: number,
  strokeWidth: number,
  sweep: number
): number {
  const radius = (Math.min(w, h) - strokeWidth) / 2;
  const ring = sweep >= 1;
  const segments = Math.max(ARC_MIN_SEGMENTS, Math.ceil(sweep * RING_SEGMENTS));
  const step = (sweep * 2 * Math.PI) / segments;
  const centreX = w / 2;
  const centreY = h / 2;
  const last = ring ? segments - 1 : segments;
  let at = 2;

  out[at++] = centreX;
  out[at++] = centreY - radius;

  for (let index = 1; index <= last; index += 1) {
    const angle = TWELVE + index * step;

    out[at++] = centreX + radius * Math.cos(angle);
    out[at++] = centreY + radius * Math.sin(angle);
  }

  return at - 2;
}

/**
 * Writes a fill: Pixi's fan around the points' centre for a rounded rectangle, its two triangles' corners for a
 * rectangle.
 *
 * @param points - The points, from index 2.
 * @param floats - Their number of floats.
 * @param rect - True for a rectangle.
 * @param out - The vertices.
 * @returns The number of vertices written.
 */
export function fillVertices(
  points: Float64Array,
  floats: number,
  rect: boolean,
  out: Float64Array
): number {
  if (rect) {
    out[0] = points[2] ?? 0;
    out[1] = points[3] ?? 0;
    out[2] = points[4] ?? 0;
    out[3] = points[5] ?? 0;
    out[4] = points[8] ?? 0;
    out[5] = points[9] ?? 0;
    out[6] = points[6] ?? 0;
    out[7] = points[7] ?? 0;

    return 4;
  }

  let centreX = 0;
  let centreY = 0;

  for (let index = 0; index < floats; index += 2) {
    centreX += points[2 + index] ?? 0;
    centreY += points[3 + index] ?? 0;
  }

  out[0] = centreX / (floats / 2);
  out[1] = centreY / (floats / 2);

  for (let index = 0; index < floats; index++) out[2 + index] = points[2 + index] ?? 0;

  return 1 + floats / 2;
}

/**
 * Writes the indices of a fill of `capacity` vertices: the rectangle's two triangles, or Pixi's fan with its closing
 * triangle on the last vertex, which the padding repeats.
 *
 * @param out - The indices.
 * @param capacity - The vertices the buffer holds.
 * @param rect - True for a rectangle.
 * @returns The number of indices written.
 */
export function fillIndices(out: Uint32Array, capacity: number, rect: boolean): number {
  if (rect) {
    out[0] = 0;
    out[1] = 1;
    out[2] = 2;
    out[3] = 1;
    out[4] = 3;
    out[5] = 2;

    return 6;
  }

  let at = 0;

  for (let count = 2; count < capacity; count++) {
    out[at++] = count;
    out[at++] = 0;
    out[at++] = count - 1;
  }

  out[at++] = 1;
  out[at++] = 0;
  out[at++] = capacity - 1;

  return at;
}

/**
 * Writes the indices of a stroke of `capacity` vertices: Pixi's strip, every three in a row a triangle.
 *
 * @param out - The indices.
 * @param capacity - The vertices the buffer holds.
 * @returns The number of indices written.
 */
export function strokeIndices(out: Uint32Array, capacity: number): number {
  let at = 0;

  for (let index = 0; index < capacity - 2; index++) {
    out[at++] = index;
    out[at++] = index + 1;
    out[at++] = index + 2;
  }

  return at;
}

/**
 * Writes the vertices of Pixi's round cap or join (`round` in `buildLine`).
 *
 * @param cx - The centre x.
 * @param cy - The centre y.
 * @param sx - The start x.
 * @param sy - The start y.
 * @param ex - The end x.
 * @param ey - The end y.
 * @param out - The vertices.
 * @param at - The first float to write.
 * @param clockwise - The turn.
 * @returns The next float to write.
 */
function roundInto(
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  out: Float64Array,
  at: number,
  clockwise: boolean
): number {
  const cx2p0x = sx - cx;
  const cy2p0y = sy - cy;
  let angle0 = Math.atan2(cx2p0x, cy2p0y);
  let angle1 = Math.atan2(ex - cx, ey - cy);

  if (clockwise && angle0 < angle1) angle0 += Math.PI * 2;
  else if (!clockwise && angle0 > angle1) angle1 += Math.PI * 2;

  let startAngle = angle0;
  const angleDiff = angle1 - angle0;
  const radius = Math.sqrt(cx2p0x * cx2p0x + cy2p0y * cy2p0y);
  const segCount = Math.trunc((15 * Math.abs(angleDiff) * Math.sqrt(radius)) / Math.PI) + 1;
  const angleInc = angleDiff / segCount;
  let v = at;

  startAngle += angleInc;

  if (clockwise) {
    out[v++] = cx;
    out[v++] = cy;
    out[v++] = sx;
    out[v++] = sy;

    for (let index = 1, angle = startAngle; index < segCount; index++, angle += angleInc) {
      out[v++] = cx;
      out[v++] = cy;
      out[v++] = cx + Math.sin(angle) * radius;
      out[v++] = cy + Math.cos(angle) * radius;
    }

    out[v++] = cx;
    out[v++] = cy;
    out[v++] = ex;
    out[v++] = ey;
  } else {
    out[v++] = sx;
    out[v++] = sy;
    out[v++] = cx;
    out[v++] = cy;

    for (let index = 1, angle = startAngle; index < segCount; index++, angle += angleInc) {
      out[v++] = cx + Math.sin(angle) * radius;
      out[v++] = cy + Math.cos(angle) * radius;
      out[v++] = cx;
      out[v++] = cy;
    }

    out[v++] = ex;
    out[v++] = ey;
    out[v++] = cx;
    out[v++] = cy;
  }

  return v;
}

/**
 * Writes the vertices of Pixi's square cap.
 *
 * @param x - The end x.
 * @param y - The end y.
 * @param nx - The scaled normal x.
 * @param ny - The scaled normal y.
 * @param clockwise - The side.
 * @param out - The vertices.
 * @param at - The first float to write.
 * @returns The next float to write.
 */
function squareInto(
  x: number,
  y: number,
  nx: number,
  ny: number,
  clockwise: boolean,
  out: Float64Array,
  at: number
): number {
  const exx = clockwise ? ny : -ny;
  const eyy = clockwise ? -nx : nx;

  out[at] = x - nx + exx;
  out[at + 1] = y - ny + eyy;
  out[at + 2] = x + nx + exx;
  out[at + 3] = y + ny + eyy;

  return at + 4;
}

/**
 * Writes the two vertices of a point across a line: the point minus and plus the scaled normal.
 *
 * @param x - The point x.
 * @param y - The point y.
 * @param nx - The normal x, scaled to half the width.
 * @param ny - The normal y, scaled to half the width.
 * @param out - The vertices.
 * @param v - The first float to write.
 * @returns The next float to write.
 */
function pairInto(
  x: number,
  y: number,
  nx: number,
  ny: number,
  out: Float64Array,
  v: number
): number {
  out[v] = x - nx;
  out[v + 1] = y - ny;
  out[v + 2] = x + nx;
  out[v + 3] = y + ny;

  return v + 4;
}

/**
 * Writes one end of a line as Pixi does: the cap, then the pair at the first point; or the pair at the last point,
 * then the cap. The normal is the one of the segment from `a` to `b`, in the line's direction.
 *
 * @param points - The points.
 * @param a - The float of the segment's first point.
 * @param b - The float of the segment's second point.
 * @param half - Half the width.
 * @param cap - The cap, `undefined` for a closed line.
 * @param start - True for the start of the line.
 * @param out - The vertices.
 * @param v - The first float to write.
 * @returns The next float to write.
 */
function endInto(
  points: Float64Array,
  a: number,
  b: number,
  half: number,
  cap: LineCap | undefined,
  start: boolean,
  out: Float64Array,
  v: number
): number {
  const x0 = at(points, a);
  const y0 = at(points, a + 1);
  const x1 = at(points, b);
  const y1 = at(points, b + 1);
  let nx = -(y0 - y1);
  let ny = x0 - x1;
  const dist = Math.sqrt(nx * nx + ny * ny);

  nx = (nx / dist) * half;
  ny = (ny / dist) * half;

  const x = start ? x0 : x1;
  const y = start ? y0 : y1;
  let next = v;

  if (!start) next = pairInto(x, y, nx, ny, out, next);
  if (cap === "round") next = roundInto(x, y, x - nx, y - ny, x + nx, y + ny, out, next, start);
  else if (cap === "square") next = squareInto(x, y, nx, ny, start, out, next);
  if (start) next = pairInto(x, y, nx, ny, out, next);

  return next;
}

/**
 * Writes a bevel at a join whose miter is past Pixi's limit, on the outer side of the turn.
 *
 * @param x1 - The joint x.
 * @param y1 - The joint y.
 * @param n0x - The scaled normal x of the segment before.
 * @param n0y - The scaled normal y of the segment before.
 * @param n1x - The scaled normal x of the segment after.
 * @param n1y - The scaled normal y of the segment after.
 * @param imx - Pixi's inner miter point x.
 * @param imy - Pixi's inner miter point y.
 * @param omx - Pixi's outer miter point x.
 * @param omy - Pixi's outer miter point y.
 * @param clockwise - The turn.
 * @param out - The vertices.
 * @param v - The first float to write.
 * @returns The next float to write.
 */
function bevelInto(
  x1: number,
  y1: number,
  n0x: number,
  n0y: number,
  n1x: number,
  n1y: number,
  imx: number,
  imy: number,
  omx: number,
  omy: number,
  clockwise: boolean,
  out: Float64Array,
  v: number
): number {
  if (clockwise) {
    out[v] = imx;
    out[v + 1] = imy;
    out[v + 2] = x1 + n0x;
    out[v + 3] = y1 + n0y;
    out[v + 4] = imx;
    out[v + 5] = imy;
    out[v + 6] = x1 + n1x;
    out[v + 7] = y1 + n1y;
  } else {
    out[v] = x1 - n0x;
    out[v + 1] = y1 - n0y;
    out[v + 2] = omx;
    out[v + 3] = omy;
    out[v + 4] = x1 - n1x;
    out[v + 5] = y1 - n1y;
    out[v + 6] = omx;
    out[v + 7] = omy;
  }

  return v + 8;
}

/**
 * Writes the join at a point of a line as Pixi's `buildLine` does with miter joins.
 *
 * @param points - The points.
 * @param p - The float of the point before the joint.
 * @param half - Half the width.
 * @param out - The vertices.
 * @param v - The first float to write.
 * @returns The next float to write.
 */
function joinInto(
  points: Float64Array,
  p: number,
  half: number,
  out: Float64Array,
  v: number
): number {
  const x0 = at(points, p);
  const y0 = at(points, p + 1);
  const x1 = at(points, p + 2);
  const y1 = at(points, p + 3);
  const x2 = at(points, p + 4);
  const y2 = at(points, p + 5);
  let n0x = -(y0 - y1);
  let n0y = x0 - x1;
  let dist = Math.sqrt(n0x * n0x + n0y * n0y);

  n0x = (n0x / dist) * half;
  n0y = (n0y / dist) * half;

  let n1x = -(y1 - y2);
  let n1y = x1 - x2;

  dist = Math.sqrt(n1x * n1x + n1y * n1y);
  n1x = (n1x / dist) * half;
  n1y = (n1y / dist) * half;

  const dx0 = x1 - x0;
  const dy0 = y0 - y1;
  const dx1 = x1 - x2;
  const dy1 = y2 - y1;
  const dot = dx0 * dx1 + dy0 * dy1;
  const cross = dy0 * dx1 - dy1 * dx0;
  const clockwise = cross < 0;

  if (Math.abs(cross) < 1e-3 * Math.abs(dot)) {
    const next = pairInto(x1, y1, n0x, n0y, out, v);

    return dot >= 0 ? pairInto(x1, y1, n1x, n1y, out, next) : next;
  }

  const c1 = (-n0x + x0) * (-n0y + y1) - (-n0x + x1) * (-n0y + y0);
  const c2 = (-n1x + x2) * (-n1y + y1) - (-n1x + x1) * (-n1y + y2);
  const px = (dx0 * c2 - dx1 * c1) / cross;
  const py = (dy1 * c1 - dy0 * c2) / cross;
  const miterSquared = (px - x1) * (px - x1) + (py - y1) * (py - y1);
  const widthSquared = half * half;
  const inside =
    miterSquared <= Math.min(dx0 * dx0 + dy0 * dy0, dx1 * dx1 + dy1 * dy1) + widthSquared;
  const pastLimit = miterSquared / widthSquared > MITER_LIMIT_SQUARED;
  // Pixi's inner (`im`) and outer (`om`) miter points.
  const imx = x1 + (px - x1);
  const imy = y1 + (py - y1);
  const omx = x1 - (px - x1);
  const omy = y1 - (py - y1);

  if (inside && pastLimit)
    return bevelInto(x1, y1, n0x, n0y, n1x, n1y, imx, imy, omx, omy, clockwise, out, v);

  if (inside) {
    out[v] = imx;
    out[v + 1] = imy;
    out[v + 2] = omx;
    out[v + 3] = omy;

    return v + 4;
  }

  let next = pairInto(x1, y1, n0x, n0y, out, v);

  if (!pastLimit) {
    out[next] = out[next + 2] = clockwise ? omx : imx;
    out[next + 1] = out[next + 3] = clockwise ? omy : imy;
    next += 4;
  }

  return pairInto(x1, y1, n1x, n1y, out, next);
}

/**
 * Writes the strip of a stroke as Pixi's `buildLine` does for alignment 0.5 and miter joins. A closed line gets
 * Pixi's midpoint of its ends at index 0 and again after its last point, so its points start at index 2 of `points`.
 *
 * @param points - The points from index 2, with room for one more point.
 * @param floats - Their number of floats.
 * @param closed - True for a closed outline.
 * @param width - The stroke width.
 * @param cap - The end of an open line.
 * @param out - The vertices.
 * @returns The number of vertices written.
 */
export function strokeVertices(
  points: Float64Array,
  floats: number,
  closed: boolean,
  width: number,
  cap: LineCap,
  out: Float64Array
): number {
  if (floats === 0) return 0;

  let from = 2;
  let count = floats;

  if (closed) {
    const firstX = at(points, 2);
    const firstY = at(points, 3);
    let lastX = at(points, floats);
    let lastY = at(points, floats + 1);

    if (Math.abs(firstX - lastX) < CLOSE_EPS && Math.abs(firstY - lastY) < CLOSE_EPS) {
      count -= 2;
      lastX = at(points, count);
      lastY = at(points, count + 1);
    }

    const midX = (firstX + lastX) * 0.5;
    const midY = (lastY + firstY) * 0.5;

    points[0] = midX;
    points[1] = midY;
    points[2 + count] = midX;
    points[3 + count] = midY;
    from = 0;
    count += 4;
  }

  const half = width / 2;
  const ends = closed ? undefined : cap;
  const last = from + count - 2;
  let v = endInto(points, from, from + 2, half, ends, true, out, 0);

  for (let point = from; point < last - 2; point += 2) v = joinInto(points, point, half, out, v);

  return endInto(points, last - 2, last, half, ends, false, out, v) / 2;
}
