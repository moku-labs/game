import { expectTypeOf } from "vitest";
import type { Config as GameConfig } from "../../../../config";
import type { Api as TimeApi } from "../../../time/types";
import type { Entity } from "../../../world/types";
import type {
  NineSliceValue,
  ShapeValue,
  SpriteFit,
  SpriteValue,
  TransformValue
} from "../../components";
import { componentsFor, NineSlice, Shape, Sprite, Transform } from "../../components";
import type {
  Api,
  Captured,
  CaptureOptions,
  Config,
  CreateTextureOptions,
  DebugSwitches,
  DisplayAdapter,
  FilterCache,
  FilterSlot,
  FilterSlotInputs,
  HitBox,
  KeptStats,
  LegendEntry,
  Orientation,
  PerfCounts,
  PictureRect,
  PixiFilter,
  PixiTexture,
  Point,
  PoolTrim,
  RenderStats,
  RetakeWhy,
  SafeArea,
  SliceFrame,
  Under,
  ViewportSize,
  WhyEntry,
  WhyLive
} from "../../types";

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

// The board tray, outlined while its insets are checked.
expectTypeOf<NineSliceValue["debug"]>().toEqualTypeOf<boolean>();
NineSlice({ texture: "board.board-tray", width: 1000, height: 1040, debug: true });

// @ts-expect-error — debug is on or off
NineSlice({ debug: "on" });

// A text field framed by a nine-slice keeps a long value inside the frame.
expectTypeOf<NineSliceValue["clip"]>().toEqualTypeOf<boolean>();
NineSlice({ texture: "ui.field", width: 480, height: 96, clip: true });

// @ts-expect-error — clip is on or off
NineSlice({ clip: "yes" });

// ─── blend: a glow lays its pixels over what is under it (F68) ────────

Sprite({ texture: "board.bg-forest-meadow", blend: "screen" });
kit.NineSlice({ blend: "add" });
NineSlice({ blend: "normal" });

// @ts-expect-error — Pixi's other modes are not offered: normal, add or screen
Sprite({ blend: "multiply" });

// @ts-expect-error — the nine-slice takes the same three
kit.NineSlice({ blend: "overlay" });

// ─── Shape: the fill has its own alpha ────────────────────────

expectTypeOf<ShapeValue["fillAlpha"]>().toEqualTypeOf<number>();
expectTypeOf(Shape.defaults).toEqualTypeOf<Readonly<ShapeValue>>();

// The honey ring on a selected cell: a stroke and no fill.
Shape({ w: 140, h: 140, fillAlpha: 0, radius: 24, stroke: 0xff_c2_33, strokeWidth: 6 });

// @ts-expect-error — fillAlpha is a number
Shape({ fillAlpha: "0" });

// ─── Shape: a kind that stays a union, and a dash length ──────

expectTypeOf<ShapeValue["kind"]>().toEqualTypeOf<"rect" | "triangle" | "arc">();
expectTypeOf<ShapeValue["dash"]>().toEqualTypeOf<number>();
expectTypeOf(Shape.defaults.kind).toEqualTypeOf<"rect" | "triangle" | "arc">();

// The play glyph of a watch button, and a dashed focus ring.
Shape({ w: 36, h: 40, kind: "triangle", fill: 0xff_ff_ff });
Shape({ w: 200, h: 80, radius: 16, fillAlpha: 0, stroke: 0x3a_22_12, strokeWidth: 4, dash: 10 });

// @ts-expect-error — a shape is a rect, a triangle or an arc
Shape({ kind: "circle" });

// ─── Shape: an arc's ends stay a union ────────────────────────

// The time left on a slot's timer: 42 % of a ring with round ends.
Shape({
  kind: "arc",
  w: 28,
  h: 28,
  stroke: 0xc8_a1_5a,
  strokeWidth: 2.2,
  sweep: 0.42,
  cap: "round"
});
expectTypeOf<ShapeValue["cap"]>().toEqualTypeOf<"round" | "butt" | undefined>();

// @ts-expect-error — an arc ends round or butt; Pixi's "square" would draw past its sweep
Shape({ kind: "arc", cap: "square" });

// ─── the renderer API keeps its types ─────────────────────────

declare const renderer: Api;

expectTypeOf(renderer.sync.hitTest).toEqualTypeOf<
  (x: number, y: number, accept: (entity: Entity) => boolean) => Entity | undefined
>();

// @ts-expect-error — the caller always names its filter
renderer.sync.hitTest(540, 300);

// One frozen object (spec 25 F11): read-only, and still assignable where a game annotates a `ViewportSize`.
expectTypeOf(renderer.viewport.size).toEqualTypeOf<() => Readonly<ViewportSize>>();
expectTypeOf(renderer.viewport.size()).toEqualTypeOf<{
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly orientation: Orientation;
  readonly safeArea: SafeArea;
}>();
expectTypeOf(renderer.viewport.size()).toExtend<ViewportSize>();

const frame = renderer.viewport.size();

// @ts-expect-error — the frame is read, never written: the object is frozen
frame.width = 1;
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

// ─── debug switches and the long side of the reference space ──

expectTypeOf(renderer.sync.debug.nineSlice).toEqualTypeOf<(on: boolean) => void>();
expectTypeOf(renderer.sync.debug.state()).toEqualTypeOf<{
  nineSlice: boolean;
  verifyFrames: boolean;
  kept: boolean;
  overdraw: boolean;
}>();
expectTypeOf(renderer.sync.debug.overdraw).toEqualTypeOf<(on: boolean) => void>();
expectTypeOf(renderer.sync.debug.kept).toEqualTypeOf<(on: boolean) => void>();
// The editor's A/B switch of a measurement passes the one key it changes.
expectTypeOf<{ kept: false }>().toExtend<Config["debug"]>();
expectTypeOf(renderer.sync.debug.verifyFrames).toEqualTypeOf<(on: boolean) => void>();
// A game that sets only the outline at start keeps compiling: a switch left out is off.
expectTypeOf<{ nineSlice: true }>().toExtend<Config["debug"]>();
expectTypeOf<Config["debug"]>().toEqualTypeOf<Partial<DebugSwitches>>();
expectTypeOf<GameConfig["referenceLong"]>().toEqualTypeOf<number>();

// @ts-expect-error — the switch takes a boolean
renderer.sync.debug.nineSlice("yes");

// ─── the doors of the editor: toScreen, stats, capture ────────

expectTypeOf(renderer.viewport.toScreen).toEqualTypeOf<(point: Point) => Point>();
expectTypeOf(renderer.stats()).toEqualTypeOf<RenderStats>();
expectTypeOf<RenderStats>().toEqualTypeOf<{
  fps: number;
  drawn: number;
  frameMs: number;
  textures: number;
  textureMb: number;
  textureMbSplit: { art: number; targets: number; kept: number };
  views: number;
  pooled: number;
  renderPasses: number;
  renderPassesMax: number;
  canvasPasses: number;
  canvasPassesMax: number;
  kept: KeptStats;
  drawCalls?: number;
  redraws?: number;
  rebuilds?: number;
  counts?: PerfCounts;
}>();
expectTypeOf<RenderStats["redraws"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<RenderStats["rebuilds"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<RenderStats["kept"]>().toEqualTypeOf<{
  pictures: number;
  mb: number;
  retakes: number;
  evicted: number;
  refused: number;
}>();

// A report entry reads by its names: a tool switches on `reason` and `retake.why`.
expectTypeOf<ReturnType<typeof renderer.sync.debug.why>>().toEqualTypeOf<readonly WhyEntry[]>();
expectTypeOf<WhyEntry["reason"]>().toEqualTypeOf<WhyLive | null>();
expectTypeOf<NonNullable<WhyEntry["retake"]>["why"]>().toEqualTypeOf<RetakeWhy>();

declare const entry: WhyEntry;

// @ts-expect-error — "cached" is no reason: a kept view's reason is `null`
if (entry.reason === "cached") throw new Error("never");
expectTypeOf<Config["keptMb"]>().toEqualTypeOf<number>();
expectTypeOf(renderer.capture).toEqualTypeOf<
  (options?: CaptureOptions) => Promise<Captured | undefined>
>();

// @ts-expect-error — toScreen takes one point, not two numbers
renderer.viewport.toScreen(540, 960);

// @ts-expect-error — `begin` is the monitor's internal half, not on the public API
renderer.begin;

// ─── the effects seam: filters on a view, the live device ─────

declare const glow: PixiFilter;

expectTypeOf<FilterSlot>().toEqualTypeOf<{
  filter: PixiFilter;
  passes: number;
  kind?: string;
  inputs?: FilterSlotInputs;
  cache?: FilterCache;
  origin?: Float32Array;
  blurs?: boolean;
}>();
expectTypeOf(renderer.sync.filters.set).toEqualTypeOf<
  (entity: Entity, slots: readonly FilterSlot[]) => void
>();
expectTypeOf(renderer.host.device).toEqualTypeOf<() => GPUDevice | undefined>();
expectTypeOf(renderer.host.gl).toEqualTypeOf<() => WebGL2RenderingContext | undefined>();
expectTypeOf(renderer.sync.renderPasses).toEqualTypeOf<() => number>();

renderer.sync.filters.set(1_048_576, [{ filter: glow, passes: 1 }]);
// A slot of effects says what the kept cache may do with its filter; a game's own slot leaves it out.
renderer.sync.filters.set(1_048_580, [
  { filter: glow, passes: 1, cache: "placed", origin: new Float32Array(2) }
]);

// @ts-expect-error — a slot's cache is one of the three categories
renderer.sync.filters.set(1_048_579, [{ filter: glow, passes: 1, cache: "always" }]);

// @ts-expect-error — a slot says what one apply of its filter costs
renderer.sync.filters.set(1_048_577, [{ filter: glow }]);

// @ts-expect-error — the slot holds a Pixi filter instance, not a kind name
renderer.sync.filters.set(1_048_578, [{ filter: "glow", passes: 1 }]);

// ─── wave B: a slice out of an atlas page, for assets ─────────

declare const page: PixiTexture;
declare const packed: { page: string; x: number; y: number; width: number; height: number };

expectTypeOf<SliceFrame>().toEqualTypeOf<{ x: number; y: number; width: number; height: number }>();
expectTypeOf(renderer.sync.textures.slice).toEqualTypeOf<
  (page: PixiTexture, frame: SliceFrame, options?: CreateTextureOptions) => PixiTexture
>();

renderer.sync.textures.slice(
  page,
  { x: 583, y: 595, width: 256, height: 128 },
  { nine: [24, 24, 24, 24] }
);

// The manifest frame of assets carries its page id too, and passes where a SliceFrame is asked.
renderer.sync.textures.slice(page, packed);

// @ts-expect-error — a frame has a height
renderer.sync.textures.slice(page, { x: 0, y: 0, width: 256 });

// @ts-expect-error — the page is a texture, not its id
renderer.sync.textures.slice("ui/main-0", { x: 0, y: 0, width: 256, height: 128 });

// ─── engine features: the doors read what is under a point and where ───

expectTypeOf(renderer.sync.hitAll).toEqualTypeOf<(x: number, y: number) => readonly Entity[]>();
expectTypeOf(renderer.sync.boundsOf).toEqualTypeOf<(entity: Entity) => HitBox | undefined>();
expectTypeOf(renderer.sync.hitBoxOf).toEqualTypeOf<(entity: Entity) => HitBox | undefined>();
expectTypeOf<HitBox>().toEqualTypeOf<{ x: number; y: number; width: number; height: number }>();

// @ts-expect-error — hitAll takes no filter: the caller filters the list
renderer.sync.hitAll(540, 300, () => true);

// @ts-expect-error — `layerOf` is sync's internal half, not on the public API
renderer.sync.layerOf;

// ─── engine features: capture options and the answer ──────────

expectTypeOf<PictureRect>().toEqualTypeOf<{ x: number; y: number; w: number; h: number }>();
expectTypeOf<LegendEntry>().toEqualTypeOf<{
  n: number;
  projection: string;
  key: string;
  rect: PictureRect;
}>();
expectTypeOf<Captured>().toEqualTypeOf<{ png: string; legend?: readonly LegendEntry[] }>();
expectTypeOf<CaptureOptions>().toEqualTypeOf<{
  legend?: boolean;
  layers?: readonly string[];
  sheet?: { frames: number; everyMs: number };
  against?: string;
}>();
expectTypeOf<Under["key"]>().toEqualTypeOf<{ projection: string; key: string } | undefined>();
expectTypeOf<Under["layer"]>().toEqualTypeOf<string | undefined>();

renderer.capture({ legend: true, layers: ["board", "hud"] });
renderer.capture({ sheet: { frames: 6, everyMs: 100 } });

// @ts-expect-error — a sheet names its frames and their spacing
renderer.capture({ sheet: { frames: 6 } });

// @ts-expect-error — layers are names, not one name
renderer.capture({ layers: "hud" });

// ─── render on demand: the switch, invalidate, adapters that answer, wakes ──

expectTypeOf<Config["onDemand"]>().toEqualTypeOf<boolean>();

// ─── the pool trim (spec 25 C14) ──────────────────────────────

expectTypeOf<false>().toExtend<Config["poolTrim"]>();
expectTypeOf<{ restMs: number; aboveMb: number }>().toExtend<Config["poolTrim"]>();
expectTypeOf<PoolTrim>().toExtend<Config["poolTrim"]>();

declare function trimWith(poolTrim: Config["poolTrim"]): void;

trimWith({ restMs: 500, aboveMb: 32 });
// @ts-expect-error — `true` is not a trim: give the two numbers, or false to keep the targets
trimWith(true);
// @ts-expect-error — a trim names both numbers
trimWith({ restMs: 1000 });
expectTypeOf(renderer.invalidate).toEqualTypeOf<(entity: Entity) => void>();

// @ts-expect-error — there is no whole-frame form: invalidate names the entity it is about to write
renderer.invalidate();

// An adapter typed `: void` before the change still compiles, and so does one that answers.
const quiet: DisplayAdapter<{ s: string }> = {
  create: () => undefined,
  update: (): void => undefined,
  destroy: () => undefined
};
const answering: DisplayAdapter<{ s: string }> = {
  create: () => undefined,
  update: (_object, previous, next) => previous.s !== next.s,
  destroy: () => undefined
};

// biome-ignore lint/suspicious/noConfusingVoidType: the return type of the adapter, as it is declared
expectTypeOf(quiet.update).returns.toEqualTypeOf<boolean | void>();
// biome-ignore lint/suspicious/noConfusingVoidType: the return type of the adapter, as it is declared
expectTypeOf(answering.update).returns.toEqualTypeOf<boolean | void>();
expectTypeOf<TimeApi["wakes"]>().toEqualTypeOf<() => number>();

// ─── spec 27: the filter area and the warm-up ────────────────────────

declare const filtersApi: Api["sync"]["filters"];
declare const someFilter: PixiFilter;

// An area is four numbers in the entity's units, or `undefined` for the view's bounds.
filtersApi.area(1_048_590, [107, 101, 176, 176]);
filtersApi.area(1_048_590, undefined);
// @ts-expect-error — three numbers are no rectangle
filtersApi.area(1_048_590, [107, 101, 176]);
// The warm-up answers whether the pipelines were created.
expectTypeOf(filtersApi.warm(someFilter)).toEqualTypeOf<Promise<boolean>>();
expectTypeOf<Config["warm"]>().toEqualTypeOf<number>();
