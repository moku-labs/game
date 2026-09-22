/**
 * @file renderer/sync — how a sized sprite fills its box. Pure numbers: the box, the stretch from
 * texture to box, the anchor the Pixi sprite needs, and the crop of a `"cover"` sprite.
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
 * Where a sprite draws and what it shows.
 *
 * @example
 * ```ts
 * const layout: SpriteLayout = {
 *   box: { width: 100, height: 100 }, drawScale: { x: 0.5, y: 0.5 },
 *   anchor: { x: 0.5, y: 0.5 }, crop: undefined
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
  /** The part of the texture a `"cover"` sprite shows, in texture pixels; else `undefined`. */
  crop: HitBox | undefined;
};

/**
 * The box a sprite fills: its own size on an axis where the component says 0.
 *
 * @param texture - The size of the texture.
 * @param value - The sprite component.
 * @returns The box, in local units.
 * @example
 * ```ts
 * boxOf({ width: 200, height: 100 }, { ...Sprite.defaults, width: 400 });
 * // { width: 400, height: 100 }
 * ```
 */
export function boxOf(texture: Size, value: Readonly<SpriteValue>): Size {
  return {
    width: value.width > 0 ? value.width : texture.width,
    height: value.height > 0 ? value.height : texture.height
  };
}

/**
 * The box around an anchor: the part of the box left and above the anchor point is negative.
 *
 * @param anchor - The anchor, a fraction of the box.
 * @param box - The box.
 * @returns The box in local units, with the anchor at the origin.
 * @example
 * ```ts
 * anchoredBox({ x: 0.5, y: 0 }, { width: 64, height: 32 });
 * // { x: -32, y: 0, width: 64, height: 32 }
 * ```
 */
export function anchoredBox(anchor: Point, box: Size): HitBox {
  // Subtracting from 0 keeps a zero anchor at +0 instead of the -0 a negation gives.
  return {
    x: 0 - anchor.x * box.width,
    y: 0 - anchor.y * box.height,
    width: box.width,
    height: box.height
  };
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
 * Lays a sprite out in its box. A texture with no area is drawn as it is.
 *
 * @param texture - The size of the texture it draws.
 * @param value - The sprite component.
 * @returns The box, the stretch, the anchor and the crop.
 * @example
 * ```ts
 * const value = { ...Sprite.defaults, width: 100, height: 100 };
 * layoutSprite({ width: 200, height: 100 }, value).drawScale; // { x: 0.5, y: 1 }
 * ```
 */
export function layoutSprite(texture: Size, value: Readonly<SpriteValue>): SpriteLayout {
  const box = boxOf(texture, value);
  const anchor = { x: value.anchor.x, y: value.anchor.y };

  if (texture.width <= 0 || texture.height <= 0) {
    return { box, drawScale: { x: 1, y: 1 }, anchor, crop: undefined };
  }

  const scaleX = box.width / texture.width;
  const scaleY = box.height / texture.height;

  if (value.fit === "contain") {
    const scale = Math.min(scaleX, scaleY);

    return {
      box,
      drawScale: { x: scale, y: scale },
      anchor: {
        x: centredAnchor(anchor.x, box.width, texture.width * scale),
        y: centredAnchor(anchor.y, box.height, texture.height * scale)
      },
      crop: undefined
    };
  }

  if (value.fit === "cover") {
    const scale = Math.max(scaleX, scaleY);
    const width = box.width / scale;
    const height = box.height / scale;

    return {
      box,
      drawScale: { x: scale, y: scale },
      anchor,
      crop: {
        x: (texture.width - width) / 2,
        y: (texture.height - height) / 2,
        width,
        height
      }
    };
  }

  return { box, drawScale: { x: scaleX, y: scaleY }, anchor, crop: undefined };
}
