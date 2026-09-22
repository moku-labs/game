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
 *
 * @example
 * ```ts
 * const value: TransformValue = { x: 540, y: 300, rotation: 0, scale: 1 };
 * ```
 */
export type TransformValue = { x: number; y: number; rotation: number; scale: number };

/**
 * One textured quad. `texture` is an asset key; `defineGame` narrows it to the game's keys.
 *
 * @example
 * ```ts
 * const value: SpriteValue = {
 *   texture: "board.cell", tint: 0xffffff, alpha: 1, anchor: { x: 0.5, y: 0.5 }
 * };
 * ```
 */
export type SpriteValue = { texture: string; tint: number; alpha: number; anchor: Point };

/**
 * A stretchable panel. The slice borders come with the texture, not with the component.
 *
 * @example
 * ```ts
 * const value: NineSliceValue = { texture: "ui.panel", width: 600, height: 320 };
 * ```
 */
export type NineSliceValue = { texture: string; width: number; height: number };

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
 * A filled rounded rectangle, anchored at the top left of the `Transform`. `clip` masks the
 * children of the entity to the rectangle, which is how `ui` draws a scroll and an overflow.
 *
 * @example
 * ```ts
 * const value: ShapeValue = {
 *   w: 320, h: 96, fill: 0x101018, alpha: 1, radius: 16, stroke: 0x000000,
 *   strokeWidth: 0, clip: false
 * };
 * ```
 */
export type ShapeValue = {
  w: number;
  h: number;
  fill: number;
  alpha: number;
  radius: number;
  stroke: number;
  strokeWidth: number;
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

/**
 * Where a view sits: reference units, radians, uniform scale.
 */
export const Transform = /*#__PURE__*/ component("Transform", {
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1
});

/**
 * One textured quad. `texture` is an asset key, resolved through the texture providers.
 */
export const Sprite = /*#__PURE__*/ component("Sprite", {
  texture: "",
  tint: 0xff_ff_ff,
  alpha: 1,
  anchor: { x: 0.5, y: 0.5 }
});

/**
 * A stretchable panel, sized in reference units.
 */
export const NineSlice = /*#__PURE__*/ component("NineSlice", { texture: "", width: 0, height: 0 });

/**
 * The entity this view moves with. `0` means no parent.
 */
export const Parent = /*#__PURE__*/ component("Parent", { entity: 0 });

/**
 * A display object the game owns. Never pooled, never destroyed by `sync`.
 */
export const Display = /*#__PURE__*/ component("Display", displayDefaults);

/**
 * A filled rounded rectangle, drawn with Pixi `Graphics` and redrawn only when a field changed.
 * `clip: true` masks the children of the entity to the rectangle.
 */
export const Shape = /*#__PURE__*/ component("Shape", {
  w: 0,
  h: 0,
  fill: 0xff_ff_ff,
  alpha: 1,
  radius: 0,
  stroke: 0x00_00_00,
  strokeWidth: 0,
  clip: false
});

/**
 * Bundles the two components every visual needs, so a projection `view` reads as one line.
 *
 * @param options - Texture key, position, and the four values that have defaults.
 * @returns The `Sprite` and the `Transform` value, in that order.
 * @example
 * ```ts
 * sprite({ texture: "board.cell", at: { x: 540, y: 300 } });
 * // [Sprite({ texture: "board.cell", tint: 0xffffff, alpha: 1, anchor: { x: 0.5, y: 0.5 } }),
 * //  Transform({ x: 540, y: 300, rotation: 0, scale: 1 })]
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
