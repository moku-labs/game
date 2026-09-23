/**
 * @file renderer/sync — the path of a `Shape`: a rectangle, a rounded rectangle or a triangle,
 * its fill, and its stroke, solid or dashed. A dashed stroke walks the outline (straight edges, and
 * rounded corners sampled as arcs) and strokes one open line per dash.
 */
import type { ShapeValue } from "../components";
import type { PixiGraphics, Point } from "../types";

/** Chords per rounded corner of a dashed outline: under 0.3 u off the arc at a 48 u radius. */
const CORNER_SAMPLES = 8;

/** The gap between two dashes, as a fraction of the dash length. */
const GAP_RATIO = 0.5;

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
 * Draws the path of a shape and fills it in the colour of the value at the alpha given. At alpha
 * 0 the path stays unfilled, so only a stroke shows. A clip mask is drawn here too, never dashed.
 *
 * @param object - The graphics to draw on.
 * @param value - The shape value.
 * @param fillAlpha - The alpha of the fill: the value's own for the shape, 1 for a clip mask.
 */
export function drawShapePath(
  object: PixiGraphics,
  value: Readonly<ShapeValue>,
  fillAlpha: number
): void {
  object.clear();

  if (value.kind === "triangle") {
    object
      .moveTo(0, 0)
      .lineTo(value.w, value.h / 2)
      .lineTo(0, value.h)
      .closePath();
  } else if (value.radius > 0) {
    object.roundRect(0, 0, value.w, value.h, value.radius);
  } else {
    object.rect(0, 0, value.w, value.h);
  }

  if (fillAlpha <= 0) return;

  object.fill(fillAlpha < 1 ? { color: value.fill, alpha: fillAlpha } : { color: value.fill });
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
