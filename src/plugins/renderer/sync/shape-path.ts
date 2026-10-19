/**
 * @file renderer/sync — the path of a `Shape`: a rectangle, a rounded rectangle or a triangle,
 * its fill, and its stroke, solid or dashed, or an arc, a stroke alone. A dashed stroke walks the
 * outline (straight edges, and rounded corners sampled as arcs) and strokes one open line per dash.
 * An arc runs on the circle inscribed in its box, from 12 o'clock clockwise.
 */
import { arcDefaults, type ShapeValue } from "../components";
import type { PixiGraphics, Point } from "../types";

/** Chords per rounded corner of a dashed outline: under 0.3 u off the arc at a 48 u radius. */
const CORNER_SAMPLES = 8;

/** The gap between two dashes, as a fraction of the dash length. */
const GAP_RATIO = 0.5;

/** Segments of a full ring: a ring of 28 u across strays under 0.03 u off its circle. */
const RING_SEGMENTS = 48;

/** The fewest segments of an arc that draws: a sliver still bends. */
const ARC_MIN_SEGMENTS = 2;

/** 12 o'clock, where an arc starts: Pixi's angles run clockwise from 3 o'clock. */
const TWELVE = -Math.PI / 2;

/**
 * The corner radius the rectangle is drawn with: Pixi clamps it to half the shorter side.
 *
 * @param value - The shape value.
 * @returns The radius in reference units, 0 for square corners.
 * @example
 * ```ts
 * radiusOf({ ...Shape.defaults, w: 100, h: 20, radius: 40 }); // 10
 * ```
 */
function radiusOf(value: Readonly<ShapeValue>): number {
  return Math.max(0, Math.min(value.radius, value.w / 2, value.h / 2));
}

/**
 * The closed outline of a shape as points, clockwise from the top left (from the end of the top
 * left corner on a rounded rectangle); the last point repeats the first.
 *
 * @param value - The shape value.
 * @returns The points of the outline.
 * @example
 * ```ts
 * outlineOf({ ...Shape.defaults, kind: "triangle", w: 60, h: 40 });
 * // [{ x: 0, y: 0 }, { x: 60, y: 20 }, { x: 0, y: 40 }, { x: 0, y: 0 }]
 * ```
 */
export function outlineOf(value: Readonly<ShapeValue>): Point[] {
  const { w, h } = value;

  if (value.kind === "triangle") {
    return [
      { x: 0, y: 0 },
      { x: w, y: h / 2 },
      { x: 0, y: h },
      { x: 0, y: 0 }
    ];
  }

  const radius = radiusOf(value);

  if (radius === 0) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
      { x: 0, y: 0 }
    ];
  }

  const corners = [
    { edge: { x: w - radius, y: 0 }, center: { x: w - radius, y: radius } },
    { edge: { x: w, y: h - radius }, center: { x: w - radius, y: h - radius } },
    { edge: { x: radius, y: h }, center: { x: radius, y: h - radius } },
    { edge: { x: 0, y: radius }, center: { x: radius, y: radius } }
  ];
  const points: Point[] = [{ x: radius, y: 0 }];

  for (const [index, { edge, center }] of corners.entries()) {
    const from = -Math.PI / 2 + (index * Math.PI) / 2;

    points.push(edge);

    for (let sample = 1; sample <= CORNER_SAMPLES; sample += 1) {
      const angle = from + (sample * Math.PI) / 2 / CORNER_SAMPLES;

      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      });
    }
  }

  return points;
}

/**
 * Adds a point to a line unless the line already ends there.
 *
 * @param line - The line.
 * @param point - The point.
 */
function extend(line: Point[], point: Point): void {
  const last = line.at(-1);

  if (last?.x !== point.x || last.y !== point.y) line.push(point);
}

/**
 * Cuts a polyline into dashes of `dash` length with gaps of half a dash, starting with a dash at
 * its first point. A dash bends round the corners it crosses; the last one may be shorter.
 *
 * @param outline - The points of the polyline.
 * @param dash - The dash length, above 0.
 * @returns One open line per dash.
 * @example
 * ```ts
 * dashesOf([{ x: 0, y: 0 }, { x: 40, y: 0 }], 10);
 * // [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 15, y: 0 }, { x: 25, y: 0 }], [{ x: 30, y: 0 }, { x: 40, y: 0 }]]
 * ```
 */
export function dashesOf(outline: readonly Point[], dash: number): Point[][] {
  const first = outline[0];

  if (first === undefined) return [];

  const dashes: Point[][] = [];
  let line: Point[] | undefined = [first];
  let left = dash;

  for (let index = 1; index < outline.length; index += 1) {
    let from = outline[index - 1] ?? first;
    const to = outline[index] ?? first;
    let length = Math.hypot(to.x - from.x, to.y - from.y);

    while (length > left) {
      from = {
        x: from.x + ((to.x - from.x) * left) / length,
        y: from.y + ((to.y - from.y) * left) / length
      };
      length -= left;

      if (line === undefined) {
        line = [from];
        left = dash;
      } else {
        extend(line, from);
        dashes.push(line);
        line = undefined;
        left = dash * GAP_RATIO;
      }
    }

    left -= length;

    if (line !== undefined) extend(line, to);
  }

  if (line !== undefined && line.length > 1) dashes.push(line);

  return dashes;
}

/**
 * Draws the path of a shape and fills it in a colour at the alpha given. At alpha 0 the path stays unfilled, so only
 * a stroke shows. A clip mask is drawn here too, never dashed; the path of an arc here is its box, which is what it
 * clips its children to. A fill-only shape is drawn white and coloured by the object's tint, so a colour change draws
 * no path (spec 26 R2.1).
 *
 * @param object - The graphics to draw on.
 * @param value - The shape value.
 * @param fillAlpha - The alpha of the fill: the value's own for the shape, 1 for a clip mask.
 * @param color - The colour of the fill: the value's own by default, white for a tinted shape.
 */
export function drawShapePath(
  object: PixiGraphics,
  value: Readonly<ShapeValue>,
  fillAlpha: number,
  color: number = value.fill
): void {
  object.clear();

  if (value.kind === "triangle") {
    object
      .moveTo(0, 0)
      .lineTo(value.w, value.h / 2)
      .lineTo(0, value.h)
      .closePath();
  } else if (value.kind === "rect" && value.radius > 0) {
    object.roundRect(0, 0, value.w, value.h, value.radius);
  } else {
    object.rect(0, 0, value.w, value.h);
  }

  if (fillAlpha <= 0) return;

  object.fill(fillAlpha < 1 ? { color, alpha: fillAlpha } : { color });
}

/**
 * Strokes the outline drawn by `drawShapePath`: solid over the same path, or, with a `dash`, as
 * one open line per dash on a new path. Nothing without a stroke width.
 *
 * @param object - The graphics the shape was drawn on.
 * @param value - The shape value.
 */
export function strokeShape(object: PixiGraphics, value: Readonly<ShapeValue>): void {
  if (value.strokeWidth <= 0) return;

  const style = { color: value.stroke, width: value.strokeWidth };

  if (value.dash <= 0) {
    object.stroke(style);

    return;
  }

  object.beginPath();

  for (const [start, ...rest] of dashesOf(outlineOf(value), value.dash)) {
    if (start === undefined) continue;

    object.moveTo(start.x, start.y);

    for (const point of rest) object.lineTo(point.x, point.y);
  }

  object.stroke(style);
}

/**
 * The share of the circle an arc sweeps, clamped to 0..1: anything not above 0, `NaN` too, is 0; a whole ring when
 * the value leaves it out.
 *
 * @param value - The shape value.
 * @returns The share.
 * @example
 * ```ts
 * sweepOf({ ...Shape.defaults, kind: "arc", sweep: 1.4 }); // 1
 * ```
 */
export function sweepOf(value: Readonly<ShapeValue>): number {
  const sweep = value.sweep ?? arcDefaults.sweep;

  if (Number.isNaN(sweep) || sweep <= 0) return 0;

  return Math.min(sweep, 1);
}

/**
 * The radius of the circle an arc runs on: inscribed in the shorter side of its box, inside its stroke.
 *
 * @param value - The shape value.
 * @returns The radius in reference units; 0 or below when the stroke leaves no circle.
 * @example
 * ```ts
 * arcRadiusOf({ ...Shape.defaults, kind: "arc", w: 28, h: 40, strokeWidth: 2 }); // 13
 * ```
 */
export function arcRadiusOf(value: Readonly<ShapeValue>): number {
  return (Math.min(value.w, value.h) - value.strokeWidth) / 2;
}

/**
 * Tells whether an arc draws nothing: no stroke width, no sweep, or no circle inside its stroke.
 *
 * @param value - The shape value, an arc.
 * @returns True for an arc whose `Graphics` would hold no instruction.
 * @example
 * ```ts
 * isEmptyArc({ ...Shape.defaults, kind: "arc", w: 28, h: 28, strokeWidth: 2, sweep: 0 }); // true
 * ```
 */
export function isEmptyArc(value: Readonly<ShapeValue>): boolean {
  return value.strokeWidth <= 0 || sweepOf(value) <= 0 || arcRadiusOf(value) <= 0;
}

/**
 * Strokes an arc: from 12 o'clock clockwise over its share of the circle, in segments as many as its angle needs (48
 * for a ring, at least 2), ended by its `cap`. A full ring is closed and has no ends. Nothing for an empty arc. Drawn
 * only when the shape changed: never rebuilt per frame.
 *
 * @param object - The graphics, cleared.
 * @param value - The shape value, an arc.
 */
function strokeArc(object: PixiGraphics, value: Readonly<ShapeValue>): void {
  if (isEmptyArc(value)) return;

  const sweep = sweepOf(value);
  const radius = arcRadiusOf(value);
  const ring = sweep >= 1;
  const segments = Math.max(ARC_MIN_SEGMENTS, Math.ceil(sweep * RING_SEGMENTS));
  const step = (sweep * 2 * Math.PI) / segments;
  const centreX = value.w / 2;
  const centreY = value.h / 2;
  // A ring closes on its first point instead of drawing its last segment there.
  const last = ring ? segments - 1 : segments;

  object.moveTo(centreX, centreY - radius);

  for (let index = 1; index <= last; index += 1) {
    const angle = TWELVE + index * step;

    object.lineTo(centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle));
  }

  if (ring) {
    object.closePath();
    object.stroke({ color: value.stroke, width: value.strokeWidth });

    return;
  }

  object.stroke({
    color: value.stroke,
    width: value.strokeWidth,
    cap: value.cap ?? arcDefaults.cap
  });
}

/**
 * Paints a shape on its graphics: an arc as its stroke alone, every other kind as its path, its fill in a colour at its
 * own fill alpha, and its stroke. The one call that draws a shape's visual.
 *
 * @param object - The graphics.
 * @param value - The shape value.
 * @param color - The colour of the fill: white for a tinted shape, the value's own otherwise.
 */
export function paintShape(object: PixiGraphics, value: Readonly<ShapeValue>, color: number): void {
  if (value.kind === "arc") {
    object.clear();
    strokeArc(object, value);

    return;
  }

  drawShapePath(object, value, value.fillAlpha, color);
  strokeShape(object, value);
}
