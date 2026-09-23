/**
 * @file renderer plugin — the five components a game writes and the `sprite()` bundle helper.
 * Pure: no ctx, no state, no Pixi. Made with the `component()` helper of `world`, so nothing has
 * to be registered.
 */
import { component } from "../world/ecs/define";
import type { ComponentValue, Entity, Narrowed } from "../world/types";
import type { Point } from "./types";

/**
 * Where a view sits, in reference units and radians. Relative to the `Parent` when there is one.
 * `pivot` is the local point the view turns and scales around, and `x`, `y` is where that point
 * lands; the default pivot `{ x: 0, y: 0 }` is the view's own origin.
 *
 * @example
 * ```ts
 * // A 200 x 80 button that grows around its centre.
 * const value: TransformValue = {
 *   x: 640, y: 340, rotation: 0, scale: 1.1, pivot: { x: 100, y: 40 }
 * };
 * ```
 */
export type TransformValue = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  pivot: Point;
};

/**
 * How a sized sprite fills its box: `"fill"` stretches, `"contain"` scales uniformly inside the
 * box and centres, `"cover"` scales uniformly over the box and crops the overflow.
 *
 * @example
 * ```ts
 * const fit: SpriteFit = "cover";
 * ```
 */
export type SpriteFit = "fill" | "contain" | "cover";

/**
 * One textured quad. `texture` is an asset key; `defineGame` narrows it to the game's keys.
 * `width` and `height` are the box in reference units; 0 on an axis keeps the texture's own size
 * there. `anchor` is the point of the box that sits on the `Transform`.
 *
 * @example
 * ```ts
 * const value: SpriteValue = {
 *   texture: "board.bg-forest-meadow", tint: 0xffffff, alpha: 1, anchor: { x: 0, y: 0 },
 *   width: 1080, height: 1920, fit: "cover"
 * };
 * ```
 */
export type SpriteValue = {
  texture: string;
  tint: number;
  alpha: number;
  anchor: Point;
  width: number;
  height: number;
  fit: SpriteFit;
};

/**
 * A stretchable panel. The slice borders come with the texture, not with the component. `debug`
 * strokes the bounds and the four cut lines over the panel: cyan, red when the corners overlap or
 * the texture is missing.
 *
 * @example
 * ```ts
 * const value: NineSliceValue = {
 *   texture: "ui.panel", width: 600, height: 320, alpha: 1, tint: 0xffffff, debug: false
 * };
 * // The board tray, outlined while its insets are checked.
 * const tray: NineSliceValue = {
 *   texture: "board.board-tray", width: 1000, height: 1040, alpha: 1, tint: 0xffffff, debug: true
 * };
 * ```
 */
export type NineSliceValue = {
  texture: string;
  width: number;
  height: number;
  alpha: number;
  tint: number;
  debug: boolean;
};

/**
 * "Moves with its parent". It never decides draw order between layers.
 *
 * @example
 * ```ts
 * const value: ParentValue = { entity: 1_048_576 };
 * ```
 */
export type ParentValue = { entity: Entity };

/**
 * The escape hatch: the game owns a Pixi object and `sync` only attaches and detaches it.
 *
 * @example
 * ```ts
 * const value: DisplayValue = { object: spineAnimation };
 * ```
 */
export type DisplayValue = { object: unknown };

/**
 * A filled rounded rectangle or a triangle, anchored at the top left of the `Transform`. `kind`
 * picks the outline: `"rect"` (the default) or `"triangle"`, which fills its `w × h` box pointing
 * right (rotate the element for another direction) and ignores `radius`. `fillAlpha` is the alpha
 * of the fill alone: 0 draws only the stroke, a ring. `alpha` fades the whole shape. `dash` is the
 * dash length of the stroke in reference units, with gaps of half a dash; 0 strokes a solid line.
 * `clip` masks the children of the entity to the shape, always solid, which is how `ui` draws a
 * scroll and an overflow.
 *
 * @example
 * ```ts
 * const value: ShapeValue = {
 *   kind: "rect", w: 320, h: 96, fill: 0x101018, fillAlpha: 1, alpha: 1, radius: 16,
 *   stroke: 0x000000, strokeWidth: 0, dash: 0, clip: false
 * };
 * // The honey ring on a selected cell: a stroke and no fill.
 * const ring: ShapeValue = {
 *   kind: "rect", w: 140, h: 140, fill: 0xffffff, fillAlpha: 0, alpha: 1, radius: 24,
 *   stroke: 0xffc233, strokeWidth: 6, dash: 0, clip: false
 * };
 * // The play glyph of a watch button, and a dashed focus ring: 10 u dashes, 5 u gaps.
 * const play: ShapeValue = { ...ring, kind: "triangle", w: 36, h: 40, fillAlpha: 1, strokeWidth: 0 };
 * const focus: ShapeValue = { ...ring, w: 200, h: 80, stroke: 0x3a2212, strokeWidth: 4, dash: 10 };
 * ```
 */
export type ShapeValue = {
  kind: "rect" | "triangle";
  w: number;
  h: number;
  fill: number;
  fillAlpha: number;
  alpha: number;
  radius: number;
  stroke: number;
  strokeWidth: number;
  dash: number;
  clip: boolean;
};

/**
 * What `sprite()` takes: the two things every visual needs, and the four that have defaults.
 *
 * @example
 * ```ts
 * const options: SpriteOptions = { texture: "board.cell", at: { x: 540, y: 300 } };
 * ```
 */
export type SpriteOptions = {
  texture: string;
  at: Point;
  tint?: number;
  alpha?: number;
  anchor?: Point;
  scale?: number;
};

const displayDefaults: DisplayValue = { object: undefined };

const shapeDefaults: ShapeValue = {
  kind: "rect",
  w: 0,
  h: 0,
  fill: 0xff_ff_ff,
  fillAlpha: 1,
  alpha: 1,
  radius: 0,
  stroke: 0x00_00_00,
  strokeWidth: 0,
  dash: 0,
  clip: false
};

const transformDefaults: TransformValue = {
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  pivot: { x: 0, y: 0 }
};

const spriteDefaults: SpriteValue = {
  texture: "",
  tint: 0xff_ff_ff,
  alpha: 1,
  anchor: { x: 0.5, y: 0.5 },
  width: 0,
  height: 0,
  fit: "fill"
};

/**
 * Where a view sits: reference units, radians, uniform scale, and the local point it turns
 * around.
 */
export const Transform = /*#__PURE__*/ component("Transform", transformDefaults);

/**
 * One textured quad. `texture` is an asset key, resolved through the texture providers; a size
 * and a `fit` draw it into a box.
 */
export const Sprite = /*#__PURE__*/ component("Sprite", spriteDefaults);

/**
 * A stretchable panel, sized in reference units, with its own alpha and tint. `debug: true` draws
 * the slice outline over it.
 */
export const NineSlice = /*#__PURE__*/ component("NineSlice", {
  texture: "",
  width: 0,
  height: 0,
  alpha: 1,
  tint: 0xff_ff_ff,
  debug: false
});

/**
 * The entity this view moves with. `0` means no parent.
 */
export const Parent = /*#__PURE__*/ component("Parent", { entity: 0 });

/**
 * A display object the game owns. Never pooled, never destroyed by `sync`.
 */
export const Display = /*#__PURE__*/ component("Display", displayDefaults);

/**
 * A filled rounded rectangle or a right-pointing triangle, drawn with Pixi `Graphics` and redrawn
 * only when a field changed. `fillAlpha: 0` draws only the stroke, `dash` above 0 dashes it.
 * `clip: true` masks the children of the entity to the shape.
 */
export const Shape = /*#__PURE__*/ component("Shape", shapeDefaults);

/**
 * Bundles the two components every visual needs, so a projection `view` reads as one line.
 *
 * @param options - Texture key, position, and the four values that have defaults.
 * @returns The `Sprite` and the `Transform` value, in that order.
 * @example
 * ```ts
 * sprite({ texture: "board.cell", at: { x: 540, y: 300 } });
 * // [Sprite({ texture: "board.cell", tint: 0xffffff, alpha: 1, anchor: { x: 0.5, y: 0.5 },
 * //   width: 0, height: 0, fit: "fill" }),
 * //  Transform({ x: 540, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } })]
 * ```
 */
export function sprite(
  options: SpriteOptions
): [ComponentValue<SpriteValue>, ComponentValue<TransformValue>] {
  return [
    Sprite({
      texture: options.texture,
      tint: options.tint ?? Sprite.defaults.tint,
      alpha: options.alpha ?? Sprite.defaults.alpha,
      anchor: options.anchor ?? Sprite.defaults.anchor
    }),
    Transform({
      x: options.at.x,
      y: options.at.y,
      rotation: Transform.defaults.rotation,
      scale: options.scale ?? Transform.defaults.scale
    })
  ];
}

/**
 * The display helpers bound to one game's asset keys: `texture` only takes a key the scanner
 * generated. The component objects are the same; only the call signatures narrow.
 *
 * @example
 * ```ts
 * const kit: RendererKit<"board.cell"> = componentsFor<"board.cell">();
 * kit.sprite({ texture: "board.cell", at: { x: 90, y: 90 } });
 * ```
 */
export type RendererKit<Asset extends string> = {
  sprite: (
    options: Omit<SpriteOptions, "texture"> & { texture: Asset }
  ) => ReturnType<typeof sprite>;
  Sprite: Narrowed<SpriteValue, Partial<Omit<SpriteValue, "texture">> & { texture?: Asset }>;
  NineSlice: Narrowed<
    NineSliceValue,
    Partial<Omit<NineSliceValue, "texture">> & { texture?: Asset }
  >;
};

/**
 * Binds `sprite`, `Sprite` and `NineSlice` to one game's asset keys. Type-only: the same objects.
 *
 * @returns The three helpers with `texture` narrowed to `Asset`.
 * @example
 * ```ts
 * const { Sprite } = componentsFor<"board.cell" | "board.item-wood-1">();
 * Sprite({ texture: "board.cell" }).value.texture; // "board.cell"
 * ```
 */
export function componentsFor<Asset extends string>(): RendererKit<Asset> {
  return { sprite, Sprite, NineSlice };
}
