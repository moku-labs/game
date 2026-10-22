/**
 * @file renderer plugin — the components a game writes (the five of a view, the overlay marker and the HUD
 * part), the engine's own overlay level, and the `sprite()` bundle helper. Pure: no ctx, no state, no Pixi. Made with the `component()` helper of `world`, so nothing has
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
 * there. `anchor` is the point of the box that sits on the `Transform`. `alpha` fades the quad
 * and the entity's children.
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
 * the texture is missing. `clip` masks the children of the entity to the `width × height` box,
 * the same rule as `Shape.clip`: the mask is a filled rectangle and is never drawn, and the panel
 * itself is never masked. `alpha` fades the panel and the entity's children. `hollow` draws the
 * rim alone: the eight border pieces, never the centre.
 *
 * @example
 * ```ts
 * const value: NineSliceValue = {
 *   texture: "ui.panel", width: 600, height: 320, alpha: 1, tint: 0xffffff, debug: false,
 *   clip: false, hollow: false
 * };
 * // The board tray, outlined while its insets are checked.
 * const tray: NineSliceValue = {
 *   ...value, texture: "board.board-tray", width: 1000, height: 1040, debug: true
 * };
 * // A text field: a long value never draws outside the frame.
 * const field: NineSliceValue = {
 *   ...value, texture: "ui.field", width: 480, height: 96, clip: true
 * };
 * // The frost frame of the memory screen: its rim is drawn, its empty centre costs no pixel.
 * const frost: NineSliceValue = {
 *   ...value, texture: "glass.frost", width: 960, height: 1400, hollow: true
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
  clip: boolean;
  /**
   * Draws the rim alone: the four corners and the four edges of the slicing, never the centre cell, so a frame or a
   * glass panel whose middle is empty fills no pixel there. The hit box stays the whole `width × height`, and `debug`
   * and `clip` work as on a filled panel. `false` by default.
   *
   * @example
   * ```ts
   * // A 960 x 1400 frame over the memory board, its slices 48 u wide: 8 rim pieces are drawn, the 864 x 1304 centre
   * // is not, and a tap in the middle still lands on the frame's entity.
   * world.ecs.spawn(owner, [Layer({ name: "ui" }), Transform(), NineSlice({ texture: "glass.frost", width: 960, height: 1400, hollow: true })]);
   * ```
   */
  hollow: boolean;
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
 * A filled rounded rectangle, a triangle or an arc, anchored at the top left of the `Transform`. `kind` picks the
 * outline: `"rect"` (the default), `"triangle"`, which fills its `w × h` box pointing right (rotate the element for
 * another direction) and ignores `radius`, or `"arc"`. `fillAlpha` is the alpha of the fill alone: 0 draws only the
 * stroke, a ring. `alpha` fades the whole shape and the entity's children: a disabled button at 0.6 draws its icon at
 * 0.6 too. `dash` is the dash length of the stroke in reference units, with gaps of half a dash; 0 strokes a solid
 * line. `clip` masks the children of the entity to the shape, always solid, which is how `ui` draws a scroll and an
 * overflow. The shape itself is never masked, so its stroke is drawn whole. An arc is a stroke on the circle inscribed
 * in the box: its diameter is `min(w, h) − strokeWidth`, centred, so the stroke stays inside the box. It starts at 12
 * o'clock and runs clockwise over `sweep` of the circle (0 to 1, clamped): 0 draws nothing, 1 a closed ring. `cap` ends
 * an open arc round or flat (`"butt"`). Both are optional: left out, `sweep` is 1 and `cap` is `"round"`
 * (`arcDefaults`). Only an arc reads them; a rectangle or a triangle ignores them. An arc draws only its stroke, in
 * `stroke`, `strokeWidth` and `alpha`: `fill`, `fillAlpha`, `radius` and `dash` are ignored, and `clip` masks the
 * children to its box. The path is built again only when a field it is drawn from changes: a still arc costs nothing a
 * frame, a new `fill` builds no arc again.
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
 * // The time left on a slot's timer: 42 % of a ring 25.8 u across in a 28 u box, from 12 o'clock clockwise, round ends.
 * const timer: ShapeValue = { ...ring, kind: "arc", w: 28, h: 28, stroke: 0xc8a15a, strokeWidth: 2.2, sweep: 0.42 };
 * ```
 */
export type ShapeValue = {
  kind: "rect" | "triangle" | "arc";
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
  /** The share of the circle an arc sweeps, 0 to 1, from 12 o'clock clockwise; clamped. Only an arc reads it: 1 left out. */
  sweep?: number;
  /** How an open arc ends: `"round"` or `"butt"` (flat at its end). Only an arc reads it: `"round"` left out. */
  cap?: "round" | "butt";
};

/**
 * What an arc draws with when its `Shape` leaves `sweep` or `cap` out: the whole ring, round ends.
 *
 * @example
 * ```ts
 * arcDefaults.sweep; // 1
 * ```
 */
export const arcDefaults: Readonly<{ sweep: number; cap: "round" | "butt" }> = Object.freeze({
  sweep: 1,
  cap: "round"
});

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

/**
 * How an overlay lies over what is drawn before it: the dim it brings, whether it hides what is under it, which parts
 * of the HUD stay shown, and how long its dim and the HUD take to follow it when its root has no motion of its own.
 * The level the overlay is at and whether it has landed are the engine's: `app.renderer.sync.debug.overlays()`
 * reports them.
 *
 * @example
 * ```ts
 * // The shop: the board dims to 56 %, the energy and the gems stay shown above the dim, the dim takes 270 ms, and the
 * // glints of the board under it rest while the shop stands.
 * const shop: OverlayValue = {
 *   dim: 0.56, dimColor: 0x1b1430, cover: "none", hud: ["energy", "gems"], fade: 270, hold: true
 * };
 * ```
 */
export type OverlayValue = {
  /** How dark the dim is at full level, 0 to 1; 0 draws no dim. */
  dim: number;
  /** The colour of the dim, 0xRRGGBB. */
  dimColor: number;
  /** `"opaque"`: the overlay covers the whole screen once it has landed at alpha 1, so nothing under it is drawn. */
  cover: "none" | "opaque";
  /** The HUD parts that stay shown: every part, none, or the parts with these keys. */
  hud: "all" | "none" | readonly string[];
  /**
   * Milliseconds the dim and the HUD parts take to come and go when the root plays no enter or exit motion; a root
   * with a motion is followed for its own length. 0 follows at once.
   */
  fade: number;
  /**
   * True: the endless loops under the overlay (glows, glints, breathing) write nothing while it stands, as under an
   * opaque cover or a blurred picture; their phase follows time, so nothing jumps when it leaves. Real changes under it
   * still draw.
   */
  hold: boolean;
};

/**
 * A part of the HUD an overlay can keep shown or let fade: the view it is on and everything under it.
 *
 * @example
 * ```ts
 * const energy: HudPartValue = { key: "energy" };
 * ```
 */
export type HudPartValue = { key: string };

/**
 * The engine's state of one overlay: how much it is there (0 to 1, carried by its root's own enter and exit motion,
 * or by `fade`) and whether its enter motion is over. Written by `ui`, read by the renderer; a game reads it through
 * `app.renderer.sync.debug.overlays()`.
 *
 * @example
 * ```ts
 * const shown: OverlayLevelValue = { level: 1, landed: true };
 * ```
 */
export type OverlayLevelValue = { level: number; landed: boolean };

const overlayDefaults: OverlayValue = {
  dim: 0,
  dimColor: 0x00_00_00,
  cover: "none",
  hud: "all",
  fade: 250,
  hold: false
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
 * the slice outline over it. `clip: true` masks the children of the entity to the panel box.
 * `hollow: true` draws its rim alone, never the centre cell.
 */
export const NineSlice = /*#__PURE__*/ component("NineSlice", {
  texture: "",
  width: 0,
  height: 0,
  alpha: 1,
  tint: 0xff_ff_ff,
  debug: false,
  clip: false,
  hollow: false
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
 * A filled rounded rectangle, a right-pointing triangle or an arc (`kind: "arc"`, a stroke from 12 o'clock clockwise
 * over `sweep` of the circle in its box), drawn with Pixi `Graphics` and redrawn only when a field changed.
 * `fillAlpha: 0` draws only the stroke, `dash` above 0 dashes it. `clip: true` masks the children of the entity to the
 * shape.
 */
export const Shape = /*#__PURE__*/ component("Shape", shapeDefaults);

/**
 * Marks the view an overlay is drawn from. Everything drawn before the root of that view is kept as one picture while
 * the overlay is there, and drawn again in the same frame anything in it changes; `cover: "opaque"` draws nothing
 * under it while it is fully shown. The engine draws its dim and fades the HUD parts it does not keep, with the root's
 * own enter and exit motion (`fade` when it has none). `hold: true` holds the endless loops of what lies under it
 * while it stands, so a dimmed sheet over a sharp scene draws no frame at rest.
 *
 * @example
 * ```tsx
 * // The case file: opaque once it has faded in, the ward under it is not drawn until it starts to leave.
 * <panel key="caseSheet" motion={sheetFade} components={[Overlay({ cover: "opaque" })]} />
 * // The shop: the ward dims to 56 % and its glints rest while the shop stands; the energy and the gems stay shown.
 * <stack key="shopDimLayer" components={[Overlay({ dim: 0.56, hold: true, hud: ["energy", "gems"] })]} />
 * ```
 */
export const Overlay = /*#__PURE__*/ component("Overlay", overlayDefaults);

/**
 * Tags a view of the HUD layer as a part an overlay may keep or let fade, by `key`.
 *
 * @example
 * ```tsx
 * <stack key="resEnergy" components={[HudPart({ key: "energy" })]} />
 * ```
 */
export const HudPart = /*#__PURE__*/ component("HudPart", { key: "" });

/**
 * The level and the landing of an overlay, on the entity that carries `Overlay`. Engine state: `ui` writes it, the
 * renderer reads it; a game never writes it.
 */
export const OverlayLevel = /*#__PURE__*/ component("OverlayLevel", { level: 0, landed: false });

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
 * The display helpers bound to one game's asset keys and HUD part keys: `texture` only takes a key the scanner
 * generated, `HudPart({ key })` and the `hud` list of `Overlay` only a key the game declared. The component objects
 * are the same; only the call signatures narrow.
 *
 * @example
 * ```ts
 * const kit: RendererKit<"board.cell", "energy" | "gems"> = componentsFor<"board.cell", "energy" | "gems">();
 * kit.sprite({ texture: "board.cell", at: { x: 90, y: 90 } });
 * kit.Overlay({ dim: 0.56, hud: ["energy"] }).value.hud; // ["energy"]
 * ```
 */
export type RendererKit<Asset extends string, HudKey extends string = string> = {
  sprite: (
    options: Omit<SpriteOptions, "texture"> & { texture: Asset }
  ) => ReturnType<typeof sprite>;
  Sprite: Narrowed<SpriteValue, Partial<Omit<SpriteValue, "texture">> & { texture?: Asset }>;
  NineSlice: Narrowed<
    NineSliceValue,
    Partial<Omit<NineSliceValue, "texture">> & { texture?: Asset }
  >;
  Overlay: Narrowed<
    OverlayValue,
    Partial<Omit<OverlayValue, "hud">> & { hud?: "all" | "none" | readonly HudKey[] }
  >;
  HudPart: Narrowed<HudPartValue, { key: HudKey }>;
};

/**
 * Binds `sprite`, `Sprite` and `NineSlice` to one game's asset keys, and `Overlay` and `HudPart` to its HUD part keys.
 * Type-only: the same objects.
 *
 * @returns The five helpers with `texture` narrowed to `Asset` and the HUD keys to `HudKey`.
 * @example
 * ```ts
 * const { Sprite, HudPart } = componentsFor<"board.cell" | "board.item-wood-1", "energy">();
 * Sprite({ texture: "board.cell" }).value.texture; // "board.cell"
 * HudPart({ key: "energy" }).value.key; // "energy"
 * ```
 */
export function componentsFor<Asset extends string, HudKey extends string = string>(): RendererKit<
  Asset,
  HudKey
> {
  return { sprite, Sprite, NineSlice, Overlay, HudPart };
}
