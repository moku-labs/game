import * as pixi from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { Sprite, Transform } from "../../../renderer/components";
import type { FilterSlot, PixiModule } from "../../../renderer/types";
import type { Entity } from "../../../world/types";
import { defineFilter } from "../../filters/define";
import { createFilter, createStandIn, createWarmFilter } from "../../filters/instance";
import type { FilterInstance, FilterKind } from "../../filters/types";
import type { FakeFxFilter } from "../fake-effects-pixi";
import { Small, SOFT_BODIES, SOFT_STAGES, softChain, UNDER_BODIES } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test (F178): `defineFilter({ blend })` lays a whole filtered group over what is under it. The definition keeps
// the blend; define refuses it where it cannot work (a backdrop, a stage, a fallback with another blend); only the
// instance that draws onto the canvas (the main one, a stand-in, the warm probe) gets Pixi's `blendMode`.
// ---------------------------------------------------------------------------

// Pixi asks a test canvas for the GLSL precision when it builds a GL program; Node has no DOM.
const browser = pixi.DOMAdapter.get();

beforeAll(() => {
  pixi.DOMAdapter.set({
    ...browser,
    // eslint-disable-next-line unicorn/no-null -- a canvas answers null for a context it cannot make.
    createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement
  });
});

afterAll(() => {
  pixi.DOMAdapter.set(browser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REAL = pixi as unknown as PixiModule;

/** The WGSL and GLSL of a body that copies its input. */
const COPY = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord); }"
} as const;

/** The same body with another text, so two definitions have two sources. */
const COPY_B = { wgsl: `${COPY.wgsl}\n`, glsl: `${COPY.glsl}\n` } as const;

/** The multiply fallback of `Stamp`: the same ink, flat. */
const StampFlat = defineFilter("blendtest.stampFlat", { ...COPY_B, blend: "multiply" });

/** A stamp's ink: drawn over the page with multiply, a flat ink in its place when it is broken. */
const Stamp = defineFilter("blendtest.stamp", { ...COPY, blend: "multiply", fallback: StampFlat });

/** A filter that blends nothing. */
const Plain = defineFilter("blendtest.plain", COPY);

/** A multiply filter with an input: the main body multiplies, the places of its chain do not. */
const StampSoft = defineFilter("blendtest.stampSoft", {
  ...SOFT_BODIES,
  uniforms: { spread: 1, tone: 0 },
  blend: "multiply",
  inputs: { soft: { stages: SOFT_STAGES, chain: softChain } }
});

/**
 * A started mock with the filters of one feature.
 *
 * @param filters - The filters.
 * @returns The mock.
 */
function started(filters: readonly FeatureFilter[]): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "blendtest", description: { filters } });
  mock.start();

  return mock;
}

/**
 * A registered kind of the mock.
 *
 * @param mock - The started mock.
 * @param id - The kind id.
 * @returns The kind.
 */
function kindOf(mock: MockEffects, id: string): FilterKind {
  const kind = mock.state.kinds.get(id);

  if (kind === undefined) throw new Error(`no kind ${id}`);

  return kind;
}

/** A filter component made by `defineFilter`, as far as `build` reads it. */
type BlendComponent = { filter: { id: string }; defaults: object };

/** An instance, or any object that holds a Pixi filter. */
type Holder = { filter: unknown };

/**
 * Builds an instance of a registered kind with its defaults.
 *
 * @param mock - The started mock.
 * @param module - The Pixi module it is built on.
 * @param component - The filter component.
 * @returns The instance.
 */
function build(mock: MockEffects, module: PixiModule, component: BlendComponent): FilterInstance {
  const value = { enabled: true, order: 0, ...component.defaults };
  const instance = createFilter(mock.ectx, module, kindOf(mock, component.filter.id), value);

  if (instance === undefined) throw new Error(`no instance of ${component.filter.id}`);

  return instance;
}

/**
 * The blend mode of a fake Pixi filter.
 *
 * @param instance - An instance on the mock's fake Pixi module.
 * @returns Its `blendMode`.
 */
function blendOf(instance: Holder): string {
  return (instance.filter as FakeFxFilter).blendMode;
}

describe("defineFilter — blend", () => {
  // Bug: the blend is dropped by define, and Def.filter.blend reads undefined where the renderer expects a string.
  it.each([
    "normal",
    "add",
    "screen",
    "multiply"
  ] as const)("keeps blend %s on the definition", blend => {
    expect(defineFilter(`blendtest.keep.${blend}`, { ...COPY, blend }).filter.blend).toBe(blend);
  });

  // Bug: a filter that names no blend gets one by accident: every existing game would draw differently.
  it("draws normally when blend is left out", () => {
    expect(Plain.filter.blend).toBe("normal");
  });

  // Bug: a typo ("overlay" is no Pixi blend the renderer maps) reaches the renderer, which draws it normally and says nothing.
  it.each(["overlay", 3, ""])("refuses blend %j", blend => {
    expect(() =>
      defineFilter("blendtest.bad", { ...COPY, blend: blend as unknown as "normal" })
    ).toThrow(/Filter "blendtest\.bad": blend must be/);
  });

  // Bug: a backdrop that blends is drawn twice over the canvas: it reads the canvas under itself already.
  it("refuses a backdrop with a blend other than normal; normal stays allowed", () => {
    const backdrop = { ...UNDER_BODIES, uniforms: { spread: 1 }, backdrop: true } as const;

    expect(() =>
      defineFilter("blendtest.backMultiply", { ...backdrop, blend: "multiply" })
    ).toThrow(/Filter "blendtest\.backMultiply" is a backdrop[\s\S]*blend/);
    expect(
      defineFilter("blendtest.backNormal", { ...backdrop, blend: "normal" }).filter.blend
    ).toBe("normal");
  });

  // Bug: a stage draws into a cleared pooled texture: multiply over its transparent pixels turns the chain black.
  it("refuses a stage with a blend other than normal", () => {
    const Multiplied = defineFilter("blendtest.stageMultiply", { ...COPY_B, blend: "multiply" });

    expect(() =>
      defineFilter("blendtest.withStage", {
        ...SOFT_BODIES,
        uniforms: { spread: 1, tone: 0 },
        inputs: { soft: { stages: [Small, Multiplied], chain: softChain } }
      })
    ).toThrow(/stage "blendtest\.stageMultiply" of input "soft"[\s\S]*blend/);
  });

  // Bug: the ink loses its multiply the day its main body breaks: the stand-in draws opaque over the page text.
  it.each([
    ["a normal fallback of a multiply filter", "multiply", "normal"],
    ["a multiply fallback of a normal filter", "normal", "multiply"]
  ] as const)("refuses %s", (_name, own, fallback) => {
    const Fallback = defineFilter(`blendtest.fallback.${fallback}.of.${own}`, {
      ...COPY_B,
      blend: fallback
    });

    expect(() =>
      defineFilter(`blendtest.main.${own}`, { ...COPY, blend: own, fallback: Fallback })
    ).toThrow(/its fallback "blendtest\.fallback[\w.]*" draws with blend[\s\S]*same blend/);
  });

  it("accepts a fallback with the same blend", () => {
    expect(Stamp.filter.fallback).toBe(StampFlat.filter);
  });
});

describe("the instance of a blended filter", () => {
  // Bug: the blend is on the definition only: Pixi's filter keeps `normal` and the stamp covers the page.
  it("sets Pixi's blendMode on the real Pixi filter of the main instance", () => {
    const mock = started([Stamp, Plain]);

    expect(blendOf(build(mock, REAL, Stamp))).toBe("multiply");
    expect(blendOf(build(mock, REAL, Plain))).toBe("normal");
  });

  // Bug: every instance gets a blend write, and a game filter that sets its own blendMode loses it.
  it("writes no blend for a filter that declares none", () => {
    const mock = started([Stamp, Plain]);
    const plain = build(mock, mock.pixi.module, Plain).filter as unknown as FakeFxFilter;
    const stamp = build(mock, mock.pixi.module, Stamp).filter as unknown as FakeFxFilter;

    expect(plain.blendWrites).toBe(0);
    expect(stamp.blendMode).toBe("multiply");
  });

  // Bug: the blend is set on every body the instance builds: a place of the chain draws into a cleared pooled texture,
  // where multiply gives black.
  it("lays the blend on the main body only, never on a place of its chain", () => {
    const mock = started([StampSoft]);
    const instance = build(mock, mock.pixi.module, StampSoft);
    const places = instance.kind === "wgsl" ? (instance.inputs?.places.flat() ?? []) : [];

    expect(blendOf(instance)).toBe("multiply");
    expect(places.length).toBeGreaterThan(0);
    expect(places.map(place => blendOf(place.body))).toEqual(places.map(() => "normal"));
  });

  // Bug: the warm probe draws normally, so the pipeline of filter + multiply is first built in the frame of the first stamp.
  it("warms a blended filter with its blend, a plain one normally", () => {
    const mock = started([Stamp, Plain]);

    expect(blendOf(createWarmFilter(mock.pixi.module, Stamp.filter))).toBe("multiply");
    expect(blendOf(createWarmFilter(mock.pixi.module, Plain.filter))).toBe("normal");
  });
});

/**
 * A mock whose fallback answered ok.
 *
 * @returns The mock.
 */
function withFallback(): MockEffects {
  const mock = started([Stamp]);

  mock.state.checks.status.set(StampFlat.filter, "ok");

  return mock;
}

describe("the stand-in of a blended filter", () => {
  // Bug: the fallback of a broken release stamp draws opaque: the "same look" the define rule promised is lost.
  it("draws the fallback of a release build with the blend", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const mock = withFallback();
    const standIn = createStandIn(mock.ectx, mock.pixi.module, kindOf(mock, Stamp.filter.id), {
      enabled: true,
      order: 0
    });

    expect(standIn?.standIn).toBe(true);
    expect(standIn === undefined ? undefined : blendOf(standIn)).toBe("multiply");
  });

  // Bug: the dev stand-in draws the fallback into its pooled texture with multiply: black, and the mark over black.
  it("draws the dev fallback normal into its pooled texture and lets the mark pass carry the blend", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = withFallback();
    const standIn = createStandIn(mock.ectx, mock.pixi.module, kindOf(mock, Stamp.filter.id), {
      enabled: true,
      order: 0
    });
    const mark = standIn?.kind === "wgsl" ? standIn.mark : undefined;

    expect(standIn === undefined ? undefined : blendOf(standIn)).toBe("normal");
    expect(mark === undefined ? undefined : blendOf(mark)).toBe("multiply");
  });
});

/**
 * Spawns a view with a filter and runs one frame.
 *
 * @param mock - The started mock.
 * @param component - The filter component value.
 * @returns The entity.
 */
function viewWith(mock: MockEffects, component: ReturnType<typeof Stamp>): Entity {
  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), component]);

  mock.renderer.displays.add(entity);
  mock.frame();

  return entity;
}

/**
 * The first slot last handed to the renderer for an entity.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns The slot.
 */
function slotOf(mock: MockEffects, entity: Entity): FilterSlot | undefined {
  return mock.renderer.sets.findLast(set => set.entity === entity)?.slots[0];
}

/**
 * A started mock whose `Stamp` does not compile, on a device, with its fallback ok.
 *
 * @returns The mock.
 */
function brokenStamp(): MockEffects {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  mock.gpu.answer = code =>
    code === Stamp.filter.source ? [{ type: "error", lineNum: 1, linePos: 1, message: "bad" }] : [];
  mock.features.push({ name: "blendtest", description: { filters: [Stamp] } });
  mock.start();

  return mock;
}

/**
 * The slot of a stamp that is broken: the checks answer, then the stand-in takes its place.
 *
 * @param mock - The mock from `brokenStamp`.
 * @returns The slot.
 */
async function standInSlot(mock: MockEffects): Promise<FilterSlot | undefined> {
  const entity = viewWith(mock, Stamp());

  for (let index = 0; index < 8; index += 1) await Promise.resolve();

  mock.frame();

  return slotOf(mock, entity);
}

describe("the slot of a blended filter", () => {
  // Bug: the renderer never hears of the blend: it keeps the view as a picture and does not write the last filter's mode.
  it("carries the blend; a plain filter's slot carries none, so the renderer leaves its blendMode alone", () => {
    const mock = started([Stamp, Plain]);
    const stamp = slotOf(mock, viewWith(mock, Stamp()));
    const plain = slotOf(mock, viewWith(mock, Plain()));

    expect(stamp?.blend).toBe("multiply");
    expect(stamp?.filter.blendMode).toBe("multiply");
    expect(plain).toBeDefined();
    expect(plain && "blend" in plain).toBe(false);
  });

  // Bug: a release stand-in is the last filter drawn onto the canvas: without the blend on its slot the renderer keeps
  // its mode normal and the fallback ink covers the page.
  it("hands a release stand-in's blend over", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const slot = await standInSlot(brokenStamp());

    expect(slot?.blend).toBe("multiply");
    expect(slot?.filter.blendMode).toBe("multiply");
  });

  // Bug: the slot of a dev stand-in names the blend: the renderer writes multiply on the filter that draws the fallback
  // into the pooled texture, and the mark is drawn over black.
  it("hands a dev stand-in no blend: its outer filter draws into a pooled texture", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const slot = await standInSlot(brokenStamp());

    expect(slot).toBeDefined();
    expect(slot && "blend" in slot).toBe(false);
    expect(slot?.filter.blendMode).toBe("normal");
  });
});
