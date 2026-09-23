/**
 * @file renderer/sync — nine-slice borders and the debug outline. Pixi reads a texture's borders
 * only in the `NineSliceSprite` constructor, so `sync` copies them on every write; the outline
 * strokes the same cut lines Pixi draws the panel with, so a wrong inset shows on screen.
 */
import type { PixiContainer, PixiModule, PixiTexture } from "../types";
import type { View } from "./types";

/**
 * Nine-slice widths in reference units: left, top, right and bottom.
 */
export type SliceBorders = { left: number; top: number; right: number; bottom: number };

/**
 * What the outline of one nine-slice is drawn from.
 */
export type OutlineShape = {
  entity: number;
  width: number;
  height: number;
  borders: SliceBorders;
  /** No provider answered the key: the placeholder is drawn, so the slicing is not the art's. */
  missing: boolean;
};

/** Above every child of the wrapper, whatever `Order` a child carries. */
const OUTLINE_Z = Number.MAX_SAFE_INTEGER;
const CYAN = 0x00_ff_ff;
const RED = 0xff_00_00;

/**
 * The slice widths a texture asks for, in the units it is drawn in: its default borders divided
 * by the resolution of its source. A texture without borders gets 0 on every side, never Pixi's 10.
 *
 * @param texture - The texture a nine-slice draws, or `undefined` while nothing can draw.
 * @returns The four widths.
 */
export function bordersOf(texture: PixiTexture | undefined): SliceBorders {
  const borders = texture?.defaultBorders;

  if (texture === undefined || borders === undefined) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const resolution = texture.source.resolution > 0 ? texture.source.resolution : 1;

  return {
    left: borders.left / resolution,
    top: borders.top / resolution,
    right: borders.right / resolution,
    bottom: borders.bottom / resolution
  };
}

/**
 * The factor Pixi shrinks the corners of a nine-slice by when two of them would overlap.
 *
 * @param size - The drawn size.
 * @param size.width - Drawn width.
 * @param size.height - Drawn height.
 * @param borders - The slice widths.
 * @returns 1 when the corners fit, less when they overlap.
 * @example
 * ```ts
 * sliceScale({ width: 100, height: 200 }, { left: 72, top: 76, right: 72, bottom: 76 }); // 0.6944
 * ```
 */
export function sliceScale(size: { width: number; height: number }, borders: SliceBorders): number {
  const across = borders.left + borders.right;
  const down = borders.top + borders.bottom;
  const scaleX = across > 0 && size.width < across ? size.width / across : 1;
  const scaleY = down > 0 && size.height < down ? size.height / down : 1;

  return Math.min(scaleX, scaleY);
}

/**
 * Strokes the bounds of a nine-slice and the four lines Pixi cuts it at, into the wrapper of its
 * view: cyan, red when the corners overlap or the texture is missing. The graphics is kept on the
 * view and redrawn in place.
 *
 * @param pixi - The Pixi module the renderer loaded.
 * @param wrapper - The wrapper of the view, which carries its pose.
 * @param view - The view of the nine-slice.
 * @param shape - Size, borders and whether the texture is missing.
 */
export function drawOutline(
  pixi: PixiModule,
  wrapper: PixiContainer,
  view: View,
  shape: OutlineShape
): void {
  const outline = view.outline ?? new pixi.Graphics();
  const { width, height, borders } = shape;
  const scale = sliceScale(shape, borders);
  const left = borders.left * scale;
  const right = width - borders.right * scale;
  const top = borders.top * scale;
  const bottom = height - borders.bottom * scale;

  outline.label = `outline#${shape.entity}`;
  outline.zIndex = OUTLINE_Z;
  outline.clear();
  outline
    .rect(0, 0, width, height)
    .moveTo(left, 0)
    .lineTo(left, height)
    .moveTo(right, 0)
    .lineTo(right, height)
    .moveTo(0, top)
    .lineTo(width, top)
    .moveTo(0, bottom)
    .lineTo(width, bottom);
  outline.stroke({ color: shape.missing || scale < 1 ? RED : CYAN, width: 1, pixelLine: true });

  if (outline.parent !== wrapper) wrapper.addChild(outline);

  view.outline = outline;
}
