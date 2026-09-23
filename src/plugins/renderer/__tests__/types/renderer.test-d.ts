import { expectTypeOf } from "vitest";
import type { Entity } from "../../../world/types";
import type {
  NineSliceValue,
  ShapeValue,
  SpriteFit,
  SpriteValue,
  TransformValue
} from "../../components";
import { componentsFor, NineSlice, Shape, Sprite, Transform } from "../../components";
import type { Api, Orientation, Point, SafeArea, ViewportSize } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error.
// ---------------------------------------------------------------------------

// ─── Transform: the pivot is a point ──────────────────────────

expectTypeOf<TransformValue["pivot"]>().toEqualTypeOf<Point>();
expectTypeOf(Transform.defaults.pivot).toEqualTypeOf<{ x: number; y: number }>();

// A 200 x 80 button that grows around its centre.
Transform({ x: 640, y: 340, scale: 1.1, pivot: { x: 100, y: 40 } });

// @ts-expect-error — a pivot is a whole point, `y` is missing
Transform({ pivot: { x: 100 } });

// ─── Sprite: a box and a fit ──────────────────────────────────

expectTypeOf<SpriteFit>().toEqualTypeOf<"fill" | "contain" | "cover">();
expectTypeOf<SpriteValue["fit"]>().toEqualTypeOf<SpriteFit>();
expectTypeOf<SpriteValue["width"]>().toEqualTypeOf<number>();
expectTypeOf<SpriteValue["height"]>().toEqualTypeOf<number>();
expectTypeOf(Sprite.defaults).toEqualTypeOf<Readonly<SpriteValue>>();

// A background drawn over the whole portrait frame.
Sprite({ texture: "board.bg-forest-meadow", width: 1080, height: 1920, fit: "cover" });
Sprite({ width: 96, height: 96, fit: "contain" });
Sprite({ fit: "fill" });

// @ts-expect-error — the fit is fill, contain or cover, nothing else
Sprite({ fit: "stretch" });

// @ts-expect-error — the box is in reference units, a number
Sprite({ width: "100%" });

// The kit of a game narrows the texture and keeps the same fit.
const kit = componentsFor<"board.bg-forest-meadow">();

kit.Sprite({ texture: "board.bg-forest-meadow", width: 1080, height: 1920, fit: "cover" });

// @ts-expect-error — the kit's Sprite keeps the same three fits
kit.Sprite({ texture: "board.bg-forest-meadow", fit: "scale-down" });

// ─── NineSlice: its own alpha and tint ────────────────────────

expectTypeOf<NineSliceValue["alpha"]>().toEqualTypeOf<number>();
expectTypeOf<NineSliceValue["tint"]>().toEqualTypeOf<number>();
expectTypeOf(NineSlice.defaults).toEqualTypeOf<Readonly<NineSliceValue>>();

NineSlice({ texture: "ui.panel", width: 600, height: 320, alpha: 0.5, tint: 0xff_c2_33 });
kit.NineSlice({ alpha: 0, tint: 0xff_ff_ff });

// @ts-expect-error — alpha is a number from 0 to 1
NineSlice({ alpha: "0.5" });

// ─── Shape: the fill has its own alpha ────────────────────────

expectTypeOf<ShapeValue["fillAlpha"]>().toEqualTypeOf<number>();
expectTypeOf(Shape.defaults).toEqualTypeOf<Readonly<ShapeValue>>();

// The honey ring on a selected cell: a stroke and no fill.
Shape({ w: 140, h: 140, fillAlpha: 0, radius: 24, stroke: 0xff_c2_33, strokeWidth: 6 });

// @ts-expect-error — fillAlpha is a number
Shape({ fillAlpha: "0" });

// ─── the renderer API keeps its types ─────────────────────────

declare const renderer: Api;

expectTypeOf(renderer.sync.hitTest).toEqualTypeOf<
  (x: number, y: number, accept: (entity: Entity) => boolean) => Entity | undefined
>();

// @ts-expect-error — the caller always names its filter
renderer.sync.hitTest(540, 300);

expectTypeOf(renderer.viewport.size).toEqualTypeOf<() => ViewportSize>();
expectTypeOf(renderer.viewport.size()).toEqualTypeOf<{
  width: number;
  height: number;
  scale: number;
  orientation: Orientation;
  safeArea: SafeArea;
}>();
expectTypeOf(renderer.viewport.size().orientation).toEqualTypeOf<"portrait" | "landscape">();
expectTypeOf(renderer.viewport.size().safeArea).toEqualTypeOf<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>();
expectTypeOf(renderer.viewport.toReference).toEqualTypeOf<
  (clientX: number, clientY: number) => Point
>();

// @ts-expect-error — `apply` is the viewport's internal half, not on the public API
renderer.viewport.apply;
