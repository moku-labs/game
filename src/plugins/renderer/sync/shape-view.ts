/**
 * @file renderer/sync — SPIKE (hot path 5, second try): the view a `Shape` is drawn as when its numbers change often,
 * an arc or a rounded or stroked rectangle. Its fill and its stroke are two batchable parts of the default batcher,
 * with Pixi's own vertices (`shape-mesh.ts`) in buffers that keep their size: a changed shape moves vertices, and the
 * host's `mokuShape` pipe packs them again in place. The buffers grow, and the stage's instructions are built again,
 * only when a shape needs more vertices than they hold.
 */
import type { PixiContainer, PixiModule } from "../types";
import {
  arcPoints,
  fillIndices,
  fillVertices,
  type LineCap,
  rectPoints,
  roundRectPoints,
  strokeIndices,
  strokeVertices
} from "./shape-mesh";

/** The key of a shape view's parts: the registry symbol the host's pipe reads. */
const PARTS: unique symbol = Symbol.for("moku-shape-parts") as never;

/** Floats of the shared point scratch. */
const POINT_FLOATS = 4096;

/** Floats of the shared vertex scratch. */
const VERTEX_FLOATS = 32_768;

/** Vertices a buffer grows by past what a shape needs. */
const SLACK = 16;

/** A part of the default batcher. */
type Part = InstanceType<PixiModule["BatchableGraphics"]>;

/** The vertices, uvs and indices of a part. */
type PartGeometry = {
  vertices: Float64Array;
  uvs: Float32Array;
  indices: Uint32Array;
  layout: Layout | undefined;
};

/** How a part's vertices make triangles. */
type Layout = "rect" | "fan" | "strip";

/** The parts of a shape view, as the host's pipe reads them. */
type Parts = { list: Part[]; count: number; changed: boolean };

/** What a shape view draws from. */
type ShapeInput = {
  kind: string;
  w: number;
  h: number;
  radius: number;
  fillAlpha: number;
  stroke: number;
  strokeWidth: number;
  sweep?: number;
  cap?: "round" | "butt";
};

/** A view that draws a shape. */
export type ShapeView = PixiContainer & {
  [PARTS]: Parts;
  draw(value: Readonly<ShapeInput>, fillColor: number): void;
};

/** The made class and the scratch it shares. */
type Made = { pixi: object; made: new () => PixiContainer };

/**
 * The share of the circle an arc sweeps, clamped to 0..1; a whole ring without one.
 *
 * @param value - The shape.
 * @returns The share.
 */
function sweepOf(value: Readonly<ShapeInput>): number {
  const sweep = value.sweep;

  if (sweep === undefined || Number.isNaN(sweep)) return 1;

  return Math.min(Math.max(sweep, 0), 1);
}

/**
 * Writes a shape's points from index 2: an arc's, a rectangle's or a rounded rectangle's.
 *
 * @param points - The points.
 * @param value - The shape.
 * @param radius - The clamped corner radius, 0 for an arc or square corners.
 * @param sweep - The arc's share of the circle.
 * @returns The floats written.
 */
function pointsOf(
  points: Float64Array,
  value: Readonly<ShapeInput>,
  radius: number,
  sweep: number
): number {
  if (value.kind === "arc") return arcPoints(points, value.w, value.h, value.strokeWidth, sweep);
  if (radius === 0) return rectPoints(points, value.w, value.h);

  return roundRectPoints(points, value.w, value.h, radius);
}

/**
 * The view class that draws a shape, made once per module.
 *
 * @param state - The sync branch of the state, which keeps the class.
 * @param state.shapeView - The class made so far, with its module.
 * @param pixi - The loaded Pixi module.
 * @returns The class.
 */
export function shapeViewClass(
  state: { shapeView: Made | undefined },
  pixi: PixiModule
): new () => ShapeView {
  if (state.shapeView?.pixi === pixi) return state.shapeView.made as unknown as new () => ShapeView;

  const points = new Float64Array(POINT_FLOATS);
  const scratch = new Float64Array(VERTEX_FLOATS);

  /**
   * A part with buffers for `capacity` vertices.
   *
   * @param view - The view it belongs to.
   * @returns The part.
   */
  const newPart = (view: PixiContainer): Part => {
    const part = new pixi.BatchableGraphics();

    part.renderable = view as never;
    part.texture = pixi.Texture.WHITE;
    part.attributeOffset = 0;
    part.indexOffset = 0;
    part.attributeSize = 0;
    part.indexSize = 0;
    part.alpha = 1;
    part.baseColor = 0xff_ff_ff;
    part.geometryData = {
      vertices: new Float64Array(0),
      uvs: new Float32Array(0),
      indices: new Uint32Array(0),
      layout: undefined
    } as never;

    return part;
  };

  /**
   * Copies `used` vertices of the scratch into a part, the last one repeated to its capacity; grows the part's buffers
   * when they are too small.
   *
   * @param part - The part.
   * @param used - The vertices written to the scratch.
   * @param layout - A rectangle's two triangles, a fan, or a stroke's strip.
   * @returns True when the buffers grew.
   */
  const fillPart = (part: Part, used: number, layout: Layout): boolean => {
    const geometry = part.geometryData as unknown as PartGeometry;
    let grew = false;

    if (used > part.attributeSize || geometry.layout !== layout) {
      const capacity = layout === "rect" ? 4 : used + SLACK + (used >> 2);

      geometry.vertices = new Float64Array(capacity * 2);
      geometry.uvs = new Float32Array(capacity * 2);
      geometry.indices = new Uint32Array(capacity * 3);
      geometry.layout = layout;
      part.attributeSize = capacity;
      part.indexSize =
        layout === "strip"
          ? strokeIndices(geometry.indices, capacity)
          : fillIndices(geometry.indices, capacity, layout === "rect");
      grew = true;
    }

    const vertices = geometry.vertices;
    const floats = used * 2;
    const lastX = scratch[floats - 2] ?? 0;
    const lastY = scratch[floats - 1] ?? 0;

    for (let at = 0; at < floats; at++) vertices[at] = scratch[at] ?? 0;
    for (let at = floats; at < vertices.length; at += 2) {
      vertices[at] = lastX;
      vertices[at + 1] = lastY;
    }

    return grew;
  };

  /** A container of Pixi's view type whose render pipe is the host's `mokuShape`. */
  class Drawn extends pixi.ViewContainer {
    public override readonly renderPipeId = "mokuShape";
    public batched = true;
    public [PARTS]: Parts;
    private readonly fillPart: Part;
    private readonly strokePart: Part;
    private minX = 0;
    private minY = 0;
    private maxX = 0;
    private maxY = 0;

    /** An empty view. */
    public constructor() {
      super({});
      this.fillPart = newPart(this);
      this.strokePart = newPart(this);
      this[PARTS] = { list: [this.fillPart, this.strokePart], count: 0, changed: true };
    }

    /**
     * Writes a shape's vertices and colours and asks Pixi to pack them again.
     *
     * @param value - The shape.
     * @param fillColor - White for a tinted shape, its fill otherwise.
     */
    public draw(value: Readonly<ShapeInput>, fillColor: number): void {
      const parts = this[PARTS];
      const arc = value.kind === "arc";
      const radius = arc ? 0 : Math.max(0, Math.min(value.radius, value.w / 2, value.h / 2));
      const rect = !arc && radius === 0;
      const sweep = sweepOf(value);
      const floats = pointsOf(points, value, radius, sweep);
      const hasStroke = value.strokeWidth > 0 && floats > 0;
      const before = parts.count;
      let changed = false;

      parts.count = 0;
      this.boundsOf(floats, hasStroke ? value.strokeWidth / 2 : 0);

      if (!arc && value.fillAlpha > 0 && floats > 0) {
        const used = fillVertices(points, floats, rect, scratch);

        changed = this.use(this.fillPart, used, rect ? "rect" : "fan", fillColor) || changed;
        this.fillPart.alpha = Math.min(value.fillAlpha, 1);
      }

      if (hasStroke) {
        const cap: LineCap = value.cap ?? "round";
        const closed = !arc || sweep >= 1;
        const used = strokeVertices(points, floats, closed, value.strokeWidth, cap, scratch);

        changed = this.use(this.strokePart, used, "strip", value.stroke) || changed;
        this.strokePart.alpha = 1;
      }

      if (changed || parts.count !== before) parts.changed = true;
      this.onViewUpdate();
    }

    /**
     * Copies the scratch into a part and puts it next in the list.
     *
     * @param part - The part.
     * @param used - The vertices in the scratch.
     * @param layout - How they make triangles.
     * @param color - The part's colour.
     * @returns True when the list or the buffers changed.
     */
    private use(part: Part, used: number, layout: Layout, color: number): boolean {
      const parts = this[PARTS];
      const moved = parts.list[parts.count] !== part;

      parts.list[parts.count++] = part;
      part.baseColor = color;

      return fillPart(part, used, layout) || moved;
    }

    /**
     * Keeps the bounds of the points, padded by half the stroke.
     *
     * @param floats - The floats of the points, from index 2.
     * @param pad - Half the stroke width.
     */
    private boundsOf(floats: number, pad: number): void {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      for (let at = 2; at < floats + 2; at += 2) {
        const x = points[at] ?? 0;
        const y = points[at + 1] ?? 0;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }

      if (floats === 0) {
        minX = minY = maxX = maxY = 0;
      }

      this.minX = minX - pad;
      this.minY = minY - pad;
      this.maxX = maxX + pad;
      this.maxY = maxY + pad;
    }

    /** The bounds: the points and half the stroke. */
    public override updateBounds(): void {
      const bounds = this._bounds;

      bounds.minX = this.minX;
      bounds.minY = this.minY;
      bounds.maxX = this.maxX;
      bounds.maxY = this.maxY;
    }
  }

  state.shapeView = { pixi, made: Drawn as unknown as new () => PixiContainer };

  return Drawn as unknown as new () => ShapeView;
}

/**
 * Tells whether an object is a shape view.
 *
 * @param object - A display object.
 * @returns True for a shape view.
 */
export function isShapeView(object: unknown): object is ShapeView {
  return typeof object === "object" && object !== null && PARTS in object;
}
