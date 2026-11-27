/**
 * @file renderer/sync — SPIKE (hot path 5): the sprite a `Shape` is drawn as when the shape batcher draws it, and the
 * write of a shape value into its record. The record's key is the registry symbol `moku-shape`, the one the host's
 * batcher reads.
 */
import type { PixiContainer, PixiModule, PixiSprite } from "../types";

/** The key of the shape's numbers on its sprite: the registry symbol the host's batcher reads. */
const SHAPE: unique symbol = Symbol.for("moku-shape") as never;

/** What the shader draws one shape from, as the host's batcher reads it. */
type ShapeRecord = {
  w: number;
  h: number;
  radius: number;
  strokeWidth: number;
  sweep: number;
  arc: number;
  butt: number;
  fill: number;
  stroke: number;
  margin: number;
};

/** A sprite that draws a shape. */
export type ShapeSprite = PixiSprite & { [SHAPE]: ShapeRecord; redraw(): void };

/** What `writeShape` reads of a shape value. */
type ShapeInput = {
  kind: string;
  w: number;
  h: number;
  radius: number;
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeWidth: number;
  sweep?: number;
  cap?: "round" | "butt";
};

/**
 * Writes a shape value into a sprite's record and asks Pixi to pack it again.
 *
 * @param object - The shape sprite.
 * @param value - The shape.
 * @param fillColor - White for a tinted shape, its fill otherwise.
 */
export function writeShape(object: ShapeSprite, value: ShapeInput, fillColor: number): void {
  const record = object[SHAPE];
  const arc = value.kind === "arc";
  const sweep = value.sweep ?? 1;

  record.w = value.w;
  record.h = value.h;
  record.radius = arc ? 0 : Math.max(0, Math.min(value.radius, value.w / 2, value.h / 2));
  record.strokeWidth = value.strokeWidth;
  record.sweep = Number.isNaN(sweep) || sweep <= 0 ? 0 : Math.min(sweep, 1);
  record.arc = arc ? 1 : 0;
  record.butt = (value.cap ?? "round") === "butt" ? 1 : 0;
  record.fill = arc ? 0 : abgrOf(fillColor, value.fillAlpha);
  record.stroke = abgrOf(value.stroke, 1);
  record.margin = arc ? 0.5 : value.strokeWidth / 2 + 0.5;
  object.redraw();
}

/**
 * The sprite class that carries a shape, made once per module.
 *
 * @param state - The sync branch of the state, which keeps the class.
 * @param state.shapeSprite - The class made so far, with its module.
 * @param pixi - The loaded Pixi module.
 * @returns The class.
 */
export function shapeSpriteClass(
  state: { shapeSprite: { pixi: object; made: new () => PixiContainer } | undefined },
  pixi: PixiModule
): new () => ShapeSprite {
  if (state.shapeSprite?.pixi === pixi)
    return state.shapeSprite.made as unknown as new () => ShapeSprite;

  /** A sprite of the white texture whose bounds are its shape's box. */
  class Drawn extends pixi.Sprite {
    public [SHAPE]: ShapeRecord = {
      w: 0,
      h: 0,
      radius: 0,
      strokeWidth: 0,
      sweep: 1,
      arc: 0,
      butt: 0,
      fill: 0,
      stroke: 0,
      margin: 0
    };

    /** A sprite of the white texture. */
    public constructor() {
      super(pixi.Texture.WHITE);
    }

    /** Asks Pixi to pack the quad again: a view update, no rebuild. */
    public redraw(): void {
      this.onViewUpdate();
    }

    /** The bounds: the shape's box and its margin. */
    public override updateBounds(): void {
      const record = this[SHAPE];
      const bounds = this._bounds;

      bounds.minX = -record.margin;
      bounds.minY = -record.margin;
      bounds.maxX = record.w + record.margin;
      bounds.maxY = record.h + record.margin;
    }
  }

  state.shapeSprite = { pixi, made: Drawn };

  return Drawn as unknown as new () => ShapeSprite;
}

/**
 * Tells whether an object is a shape sprite.
 *
 * @param object - A display object.
 * @returns True for a shape sprite.
 */
export function isShapeSprite(object: unknown): object is ShapeSprite {
  return typeof object === "object" && object !== null && SHAPE in object;
}

/**
 * Packs an `0xRRGGBB` colour and an alpha as the vertex takes it (`abgr`).
 *
 * @param rgb - The colour.
 * @param alpha - The alpha, 0 to 1.
 * @returns The packed colour.
 */
export function abgrOf(rgb: number, alpha: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;

  return ((Math.trunc(alpha * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
