/**
 * @file renderer/sync — how a sized sprite fills its box. Pure numbers: the box, the stretch from
 * texture to box, the anchor the Pixi sprite needs, and the crop of a `"cover"` sprite, each written
 * into an object the caller keeps, so a sprite written every frame makes no object.
 */
import type { SpriteValue } from "../components";
import type { Point } from "../types";
import type { HitBox } from "./types";

/**
 * Width and height of something: a texture in pixels, a box in reference units.
 *
 * @example
 * ```ts
 * const size: Size = { width: 200, height: 100 };
 * ```
 */
export type Size = { width: number; height: number };

/**
 * Where a sprite draws and what it shows: one object a caller keeps and `layoutSpriteInto` writes in place.
 *
 * @example
 * ```ts
 * const layout: SpriteLayout = {
 *   box: { width: 100, height: 100 }, drawScale: { x: 0.5, y: 0.5 },
 *   anchor: { x: 0.5, y: 0.5 }, crop: { x: 0, y: 0, width: 0, height: 0 }, cover: false
 * };
 * ```
 */
export type SpriteLayout = {
  /** The box the sprite fills, in local units. With the anchor it is the hit box. */
  box: Size;
  /** Drawn size over the size of the texture it draws, per axis. */
  drawScale: Point;
  /** The anchor of the Pixi sprite, so the drawn texture lands where the fit puts it. */
  anchor: Point;
  /** The part of the texture a `"cover"` sprite shows, in texture pixels; read only when `cover` is true. */
  crop: HitBox;
  /** True for a `"cover"` sprite: it draws `crop` of its texture. */
  cover: boolean;
};

/**
 * Creates a layout to write into, every field present.
 *
 * @returns A layout of a 0 x 0 box at scale 1.
 */
export function createSpriteLayout(): SpriteLayout {
  return {
    box: { width: 0, height: 0 },
    drawScale: { x: 1, y: 1 },
    anchor: { x: 0, y: 0 },
    crop: { x: 0, y: 0, width: 0, height: 0 },
    cover: false
  };
}

/**
 * Writes the box a sprite fills: its own size on an axis where the component says 0.
 *
 * @param out - The size to write.
 * @param texture - The size of the texture.
 * @param value - The sprite component.
 * @returns `out`, in local units.
 * @example
 * ```ts
 * boxInto({ width: 0, height: 0 }, { width: 200, height: 100 }, { ...Sprite.defaults, width: 400 });
 * // { width: 400, height: 100 }
 * ```
 */
export function boxInto(out: Size, texture: Readonly<Size>, value: Readonly<SpriteValue>): Size {
  out.width = value.width > 0 ? value.width : texture.width;
  out.height = value.height > 0 ? value.height : texture.height;

  return out;
}

/**
 * Writes the box around an anchor: the part of the box left and above the anchor point is negative.
 *
 * @param out - The box to write.
 * @param anchor - The anchor, a fraction of the box.
 * @param box - The box.
 * @returns `out`, in local units, with the anchor at the origin.
 * @example
 * ```ts
 * anchoredBoxInto({ x: 0, y: 0, width: 0, height: 0 }, { x: 0.5, y: 0 }, { width: 64, height: 32 });
 * // { x: -32, y: 0, width: 64, height: 32 }
 * ```
 */
export function anchoredBoxInto(out: HitBox, anchor: Readonly<Point>, box: Readonly<Size>): HitBox {
  // Subtracting from 0 keeps a zero anchor at +0 instead of the -0 a negation gives.
  out.x = 0 - anchor.x * box.width;
  out.y = 0 - anchor.y * box.height;
  out.width = box.width;
  out.height = box.height;

  return out;
}

/**
 * The anchor that puts a uniformly scaled picture in the middle of a larger box: the component's
 * anchor names a point of the box, and the picture is centred in it.
 *
 * @param anchor - The anchor of the component, a fraction of the box.
 * @param box - The box size on this axis.
 * @param drawn - The drawn size of the picture on this axis.
 * @returns The anchor of the picture on this axis.
 * @example
 * ```ts
 * centredAnchor(0, 100, 50); // -0.5: the picture starts 25 units into the box
 * ```
 */
function centredAnchor(anchor: number, box: number, drawn: number): number {
  return (anchor * box - (box - drawn) / 2) / drawn;
}

/**
 * Lays a sprite out in its box, written into a layout the caller keeps: a sprite written every frame (an alpha tween)
 * makes no object. A texture with no area is drawn as it is.
 *
 * @param out - The layout to write.
 * @param texture - The size of the texture it draws.
 * @param value - The sprite component.
 * @returns `out`: the box, the stretch, the anchor and, for a `"cover"` sprite, the crop.
 * @example
 * ```ts
 * const value = { ...Sprite.defaults, width: 100, height: 100 };
 * layoutSpriteInto(createSpriteLayout(), { width: 200, height: 100 }, value).drawScale; // { x: 0.5, y: 1 }
 * ```
 */
export function layoutSpriteInto(
  out: SpriteLayout,
  texture: Readonly<Size>,
  value: Readonly<SpriteValue>
): SpriteLayout {
  const box = boxInto(out.box, texture, value);

  out.anchor.x = value.anchor.x;
  out.anchor.y = value.anchor.y;
  out.cover = false;

  if (texture.width <= 0 || texture.height <= 0) {
    out.drawScale.x = 1;
    out.drawScale.y = 1;

    return out;
  }

  const scaleX = box.width / texture.width;
  const scaleY = box.height / texture.height;

  if (value.fit === "contain") {
    const scale = Math.min(scaleX, scaleY);

    out.drawScale.x = scale;
    out.drawScale.y = scale;
    out.anchor.x = centredAnchor(value.anchor.x, box.width, texture.width * scale);
    out.anchor.y = centredAnchor(value.anchor.y, box.height, texture.height * scale);

    return out;
  }

  if (value.fit === "cover") {
    const scale = Math.max(scaleX, scaleY);
    const width = box.width / scale;
    const height = box.height / scale;

    out.drawScale.x = scale;
    out.drawScale.y = scale;
    out.crop.x = (texture.width - width) / 2;
    out.crop.y = (texture.height - height) / 2;
    out.crop.width = width;
    out.crop.height = height;
    out.cover = true;

    return out;
  }

  out.drawScale.x = scaleX;
  out.drawScale.y = scaleY;

  return out;
}
