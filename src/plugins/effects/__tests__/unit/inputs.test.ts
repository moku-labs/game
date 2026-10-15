import * as pixi from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, type Mock, vi } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { type FakeFilter, FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { Sprite, Transform } from "../../../renderer/components";
import type { PixiFilter, PixiModule, PixiTexture } from "../../../renderer/types";
import type { Entity } from "../../../world/types";
import { defineFilter } from "../../filters/define";
import { createFilter } from "../../filters/instance";
import type { FilterInstance, FilterKind, FilterStep } from "../../filters/types";
import { FakeFxGpuProgram } from "../fake-effects-pixi";
import {
  Along,
  Bad,
  Small,
  Smaller,
  SOFT_BODIES,
  SOFT_STAGES,
  Soft,
  softChain
} from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: a filter that reads a second texture. Each place of a chain is its
// own Pixi filter drawn through Pixi's public applyFilter from inside the main
// filter's apply, into pooled textures given back in a finally; the chain runs
// at creation, after a uniform or a resolution changed, and never otherwise. The
// apply cases run on the real pixi.js module (filters, uniform groups, the
// texture pool and texture sources are plain objects in Node), the sync cases
// on the fake module of the mock.
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const REAL = pixi as unknown as PixiModule;

/** One draw a filter asked Pixi's filter system for. */
type Applied = { filter: PixiFilter; from: PixiTexture; to: PixiTexture; clear: boolean };

/** A Pixi filter system as an apply sees it. */
type Manager = Parameters<PixiFilter["apply"]>[0];

/**
 * A stand-in for Pixi's filter system that writes down every draw, and runs `during` inside it.
 *
 * @param during - Called inside each draw, with the filter it draws.
 * @returns The manager and its records.
 */
function recorder(during: (filter: PixiFilter) => void = () => undefined): {
  manager: Manager;
  applied: Applied[];
} {
  const applied: Applied[] = [];
  const manager = {
    applyFilter: (filter: PixiFilter, from: PixiTexture, to: PixiTexture, clear: boolean) => {
      applied.push({ filter, from, to, clear });
      during(filter);
    }
  } as unknown as Manager;

  return { manager, applied };
}

/**
 * Reads one uniform of a Pixi filter of ours.
 *
 * @param filter - The filter.
 * @param name - The uniform.
 * @returns A number, or the numbers of a vector.
 */
function uniformOf(filter: PixiFilter, name: string): number | number[] {
  const { fu } = filter.resources as { fu: { uniforms: Record<string, number | Float32Array> } };
  const value = fu.uniforms[name];

  return typeof value === "number" ? value : [...(value ?? [])];
}

/**
 * A started mock whose renderer draws at two real pixels per CSS pixel.
 *
 * @param filters - The filters of the one feature.
 * @returns The mock.
 */
function started(filters: readonly FeatureFilter[] = [Soft]): MockEffects {
  const mock = createMockEffects();

  mock.renderer.resolution = 2;
  mock.features.push({ name: "fixture", description: { filters } });
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

/**
 * Builds an instance on the real Pixi module.
 *
 * @param mock - The started mock.
 * @param value - The stored value.
 * @param id - The kind id.
 * @returns The instance.
 */
function build(mock: MockEffects, value = Soft().value, id = "fixture.soft"): FilterInstance {
  const instance = createFilter(mock.ectx, REAL, kindOf(mock, id), value);

  if (instance === undefined) throw new Error(`no instance of ${id}`);

  return instance;
}

/**
 * A texture of the view's input and one of its output, 390 × 844 CSS px.
 *
 * @param resolution - Real pixels per CSS pixel.
 * @returns Both.
 */
function textures(resolution = 2): { input: PixiTexture; output: PixiTexture } {
  return {
    input: pixi.RenderTexture.create({ width: 390, height: 844, resolution }),
    output: pixi.RenderTexture.create({ width: 390, height: 844, resolution })
  };
}

describe("the apply of a filter with an input — on the real Pixi module", () => {
  it("draws each place from the one before into a texture of its share of the input's resolution, then the main body", () => {
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const { manager, applied } = recorder();

    instance.filter.apply(manager, input, output, false);

    const [small, alongX, alongY, body] = applied;

    expect(applied).toHaveLength(4);
    expect(small?.from).toBe(input);
    expect(alongX?.from).toBe(small?.to);
    expect(alongY?.from).toBe(alongX?.to);
    expect(applied.slice(0, 3).map(draw => draw.to.source.resolution)).toEqual([1, 0.5, 0.5]);
    expect(applied.slice(0, 3).map(draw => [draw.to.frame.width, draw.to.frame.height])).toEqual([
      [390, 844],
      [390, 844],
      [390, 844]
    ]);
    expect(body).toEqual({ filter: instance.filter, from: input, to: output, clear: false });
  });

  it("gives two places of one stage their own filter and their own uniform values", () => {
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const { manager, applied } = recorder();

    instance.filter.apply(manager, input, output, false);

    const [, alongX, alongY] = applied;

    expect(alongX?.filter).not.toBe(alongY?.filter);
    expect(alongX === undefined ? undefined : uniformOf(alongX.filter, "dir")).toEqual([1, 0]);
    expect(alongY === undefined ? undefined : uniformOf(alongY.filter, "dir")).toEqual([0, 1]);
    expect(alongY === undefined ? undefined : uniformOf(alongY.filter, "sigma")).toBe(1);
  });

  it("binds the last texture to the main body and fills its scale and clamp from the pooled size", () => {
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const resources = instance.filter.resources as Record<string, unknown>;
    const bound: unknown[] = [];
    const { manager, applied } = recorder(filter => {
      if (filter === instance.filter) bound.push(resources.softTexture, resources.softSampler);
    });

    // Before the first apply the names are bound to the empty texture, so Pixi can build its groups.
    expect(resources.softTexture).toBe(pixi.Texture.EMPTY.source);

    instance.filter.apply(manager, input, output, false);

    const last = applied[2]?.to;

    expect(bound).toEqual([last?.source, last?.source.style]);
    // The copy of 390 × 844 at half a pixel per unit sits in a pooled texture of 256 × 512 pixels.
    expect(uniformOf(instance.filter, "softScale")).toEqual(
      [1 / 512, 1 / 1024].map(value => Math.fround(value))
    );
    expect(uniformOf(instance.filter, "softClamp")).toEqual(
      [0.5 / 256, 0.5 / 512, 390 / 512 - 0.5 / 256, 844 / 1024 - 0.5 / 512].map(value =>
        Math.fround(value)
      )
    );
  });

  it("binds the input itself for an empty chain, and costs one pass", () => {
    const mock = started();
    const instance = build(mock, Soft({ spread: 0 }).value);
    const { input, output } = textures();
    const resources = instance.filter.resources as Record<string, unknown>;
    const bound: unknown[] = [];
    const { manager, applied } = recorder(() => bound.push(resources.softTexture));

    instance.filter.apply(manager, input, output, true);

    expect(applied).toEqual([{ filter: instance.filter, from: input, to: output, clear: true }]);
    expect(bound).toEqual([input.source]);
    expect(uniformOf(instance.filter, "softScale")).toEqual(
      [1 / input.source.width, 1 / input.source.height].map(value => Math.fround(value))
    );
    expect(instance.passes).toBe(1);
  });

  it("leaves no pooled texture bound after an apply", () => {
    // Bug: a pool trim destroys a texture the filter still binds; the next bind throws.
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const resources = instance.filter.resources as Record<string, unknown>;

    instance.filter.apply(recorder().manager, input, output, false);

    expect(resources.softTexture).toBe(pixi.Texture.EMPTY.source);
    expect(resources.softSampler).toBe(pixi.Texture.EMPTY.source.style);
  });

  it("gives every pooled texture back, also when a place throws, and the guard breaks the instance", () => {
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const returned = vi.spyOn(pixi.TexturePool, "returnTexture");
    const taken: PixiTexture[] = [];
    const manager = {
      applyFilter: (_filter: PixiFilter, _from: PixiTexture, to: PixiTexture) => {
        taken.push(to);
        if (taken.length === 2) throw new Error("the device said no");
      }
    } as unknown as Manager;

    expect(() => instance.filter.apply(manager, input, output, false)).not.toThrow();

    // Both textures the chain took are the pool's again; the third draw is the view straight through.
    expect(returned.mock.calls.map(call => call[0])).toEqual(taken.slice(0, 2));
    expect(taken[2]).toBe(output);
    expect(instance.broken).toBe(true);
    expect(instance.filter.enabled).toBe(false);
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:broken", {
      filter: "fixture.soft",
      reason: "apply",
      message: "the device said no"
    });
  });

  it("draws the main body only over held results, never returns them, and draws the chain again after the loan", () => {
    const mock = started();
    const instance = build(mock);
    const { input, output } = textures();
    const kept = pixi.RenderTexture.create({ width: 390, height: 844, resolution: 0.5 });
    const returned = vi.spyOn(pixi.TexturePool, "returnTexture");
    const resources = instance.filter.resources as Record<string, unknown>;
    const bound: unknown[] = [];
    const slot = instance.kind === "wgsl" ? instance.inputs?.slot : undefined;
    const { manager, applied } = recorder(filter => {
      if (filter === instance.filter) bound.push(resources.softTexture);
    });

    slot?.hold([kept]);
    instance.filter.apply(manager, input, output, false);

    expect(applied.map(draw => draw.filter)).toEqual([instance.filter]);
    expect(bound).toEqual([kept.source]);
    expect(returned).not.toHaveBeenCalled();

    slot?.hold(undefined);
    instance.filter.apply(manager, input, output, false);

    expect(applied).toHaveLength(5);
  });

  it("draws the last place into the caller's target and gives the textures in between back", () => {
    const mock = started();
    const instance = build(mock);
    const slot = instance.kind === "wgsl" ? instance.inputs?.slot : undefined;
    const picture = pixi.RenderTexture.create({ width: 390, height: 844, resolution: 1 });
    const target = pixi.RenderTexture.create({ width: 390, height: 844, resolution: 0.25 });
    const returned = vi.spyOn(pixi.TexturePool, "returnTexture");
    const { manager, applied } = recorder();

    expect(slot?.version()).toBe(1);

    slot?.draw(manager, picture, [target]);

    // At one real pixel per CSS pixel the chain draws the first stage and one Gaussian.
    expect(applied.map(draw => draw.from)).toEqual([picture, applied[0]?.to]);
    expect(applied.at(-1)?.to).toBe(target);
    expect(returned.mock.calls.map(call => call[0])).toEqual([applied[0]?.to]);
    expect(slot?.version()).toBe(2);
    expect(slot?.scaleOf(0)).toBe(1 / 4);
  });
});

/**
 * A `Soft` of its own with a spy as its chain, so a test counts the runs.
 *
 * @returns The filter and its chain.
 */
function spied(): { Spied: typeof Soft; chain: Mock<typeof softChain> } {
  const chain = vi.fn(softChain);
  const Spied = defineFilter("fixture.spied", {
    ...SOFT_BODIES,
    uniforms: { spread: 1, tone: 0 },
    inputs: { soft: { stages: SOFT_STAGES, chain } }
  });

  return { Spied, chain };
}

/**
 * Spawns a view with a filter and runs one frame.
 *
 * @param mock - The started mock.
 * @param component - The filter component value.
 * @returns The entity.
 */
function viewWith(mock: MockEffects, component: ReturnType<typeof Soft>): Entity {
  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), component]);

  mock.renderer.displays.add(entity);
  mock.frame();

  return entity;
}

/**
 * The instance of a kind on a view.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @param id - The kind id.
 * @returns The instance.
 */
function instanceOf(mock: MockEffects, entity: Entity, id = "fixture.spied"): FilterInstance {
  const instance = mock.state.views.get(entity)?.instances.get(id);

  if (instance === undefined) throw new Error(`no instance of ${id}`);

  return instance;
}

/**
 * The chains of an instance of ours.
 *
 * @param instance - The instance.
 * @returns Its places by input, as definition ids, and its version.
 */
function chainsOf(instance: FilterInstance): { ids: string[][]; version: number } {
  const inputs = instance.kind === "wgsl" ? instance.inputs : undefined;

  return {
    ids: inputs?.places.map(places => places.map(place => place.definition.id)) ?? [],
    version: inputs?.version ?? 0
  };
}

describe("the chain — when it runs, on the filter sync", () => {
  it("runs the chain once for a value that does not change", () => {
    // Bug: the patch called the chain on every apply.
    const { Spied, chain } = spied();
    const mock = started([Spied]);

    viewWith(mock, Spied());

    for (let frame = 0; frame < 30; frame += 1) mock.frame();

    expect(chain).toHaveBeenCalledTimes(1);
  });

  it("runs the chain again when a uniform changes in place, and destroys the old place in the next sync", () => {
    const { Spied, chain } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());
    const instance = instanceOf(mock, entity);
    const before = (
      instance.kind === "wgsl" ? instance.inputs?.places[0]?.[0]?.body.filter : undefined
    ) as FakeFilter | undefined;

    mock.world.ecs.set(entity, Spied, { spread: 3 });
    mock.frame();

    expect(chain).toHaveBeenCalledTimes(2);
    expect(chain.mock.lastCall?.[0].spread).toBe(3);
    expect(chainsOf(instance).ids).toEqual([["fixture.smaller", "fixture.along", "fixture.along"]]);
    expect(before?.destroyed).toBe(false);

    mock.frame();

    expect(before?.destroyed).toBe(true);
    expect(chain).toHaveBeenCalledTimes(2);
  });

  it("does not run the chain for enabled or order", () => {
    const { Spied, chain } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());

    mock.world.ecs.set(entity, Spied, { order: 4 });
    mock.frame();
    mock.world.ecs.set(entity, Spied, { enabled: false });
    mock.frame();
    mock.world.ecs.set(entity, Spied, { enabled: true });
    mock.frame();

    expect(chain).toHaveBeenCalledTimes(1);
  });

  it("keeps the version when the chain returns the same steps, and builds no Pixi filter", () => {
    const { Spied, chain } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());
    const instance = instanceOf(mock, entity);
    const programs = FakeFxGpuProgram.made.length;

    mock.world.ecs.set(entity, Spied, { tone: 0.5 });
    mock.frame();

    expect(chain).toHaveBeenCalledTimes(2);
    expect(chainsOf(instance).version).toBe(1);
    expect(FakeFxGpuProgram.made).toHaveLength(programs);
  });

  it("moves the version when a stage uniform changes", () => {
    const { Spied } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied({ spread: 0.5 }));
    const instance = instanceOf(mock, entity);

    mock.world.ecs.set(entity, Spied, { spread: 0.75 });
    mock.frame();

    expect(chainsOf(instance).version).toBe(2);
  });

  it("evaluates nothing while the filter is off and catches up when it is on again", () => {
    const { Spied, chain } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());

    mock.world.ecs.set(entity, Spied, { enabled: false, spread: 3 });
    mock.frame();

    expect(chain).toHaveBeenCalledTimes(1);

    mock.world.ecs.set(entity, Spied, { enabled: true });
    mock.frame();

    expect(chain).toHaveBeenCalledTimes(2);
    expect(chain.mock.lastCall?.[0].spread).toBe(3);
  });

  it("evaluates once at a resolution the apply finds, and the next slot carries the new passes", () => {
    const { Spied, chain } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());
    const instance = instanceOf(mock, entity);
    const input = new FakeTexture({
      source: { width: 390, height: 844, destroyed: false, resolution: 1 },
      frame: new FakeRectangle(0, 0, 390, 844)
    }) as unknown as PixiTexture;
    const { manager } = recorder();

    expect(mock.renderer.sets.at(-1)?.slots[0]?.passes).toBe(4);

    instance.filter.apply(manager, input, input, false);
    instance.filter.apply(manager, input, input, false);

    expect(chain).toHaveBeenCalledTimes(2);
    expect(chain.mock.lastCall?.[1].resolution).toBe(1);

    mock.frame();

    expect(mock.renderer.sets.at(-1)?.slots[0]?.passes).toBe(3);
    expect(chain).toHaveBeenCalledTimes(2);
  });

  it("allocates nothing per apply of a stable filter: one options object, one taken list, no new filter", () => {
    const { Spied } = spied();
    const mock = started([Spied]);
    const entity = viewWith(mock, Spied());
    const instance = instanceOf(mock, entity);
    const inputs = instance.kind === "wgsl" ? instance.inputs : undefined;
    const taken = inputs?.taken;
    const programs = FakeFxGpuProgram.made.length;
    const pool = mock.pixi.module.TexturePool as unknown as { requests: object[] };
    const input = new FakeTexture({
      source: { width: 390, height: 844, destroyed: false, resolution: 2 },
      frame: new FakeRectangle(0, 0, 390, 844)
    }) as unknown as PixiTexture;
    const { manager } = recorder();

    for (let apply = 0; apply < 100; apply += 1)
      instance.filter.apply(manager, input, input, false);

    expect(pool.requests).toHaveLength(300);
    expect(new Set(pool.requests).size).toBe(1);
    expect(inputs?.taken).toBe(taken);
    expect(taken).toHaveLength(0);
    expect(FakeFxGpuProgram.made).toHaveLength(programs);
  });
});

/** What a broken chain returned, by case. */
const REFUSALS: Array<[string, unknown, string]> = [
  [
    "not an array",
    { stage: Small, scale: 1 },
    'input "soft": chain must return an array of steps.'
  ],
  [
    "more than 16 steps",
    Array.from({ length: 17 }, () => ({ stage: Small, scale: 1 })),
    'input "soft": chain returned 17 steps; at most 16.'
  ],
  [
    "a stage not in its stages",
    [{ stage: Bad, scale: 1 / 2 }],
    'input "soft" names stage "fixture.bad", which is not in its stages: only listed stages are checked and warmed up before they draw.'
  ],
  [
    "a scale of 0",
    [{ stage: Small, scale: 0 }],
    `input "soft": step 0 has scale 0; a scale is a share of the input's resolution above 0 and at most 1.`
  ],
  [
    "a scale above 1",
    [
      { stage: Small, scale: 1 },
      { stage: Small, scale: 1.5 }
    ],
    `input "soft": step 1 has scale 1.5; a scale is a share of the input's resolution above 0 and at most 1.`
  ],
  [
    "a uniform the stage does not declare",
    [{ stage: Along, scale: 1 / 2, uniforms: { radius: 2 } }],
    'input "soft": step 0 gives "radius", which stage "fixture.along" does not declare.'
  ],
  [
    "a vector of the wrong size",
    [{ stage: Along, scale: 1 / 2, uniforms: { dir: [1, 0, 0] } }],
    'input "soft": step 0 gives "dir" a value of another form.'
  ],
  [
    "a number for a vector",
    [{ stage: Along, scale: 1 / 2, uniforms: { dir: 1 } }],
    'input "soft": step 0 gives "dir" a value of another form.'
  ]
];

/**
 * A filter whose chain the test steers through a holder: one stage, `Along`, or none.
 *
 * @param steps - What the chain returns, by resolution.
 * @returns The filter.
 */
function steered(steps: (resolution: number) => readonly FilterStep[]): typeof Soft {
  return defineFilter("fixture.steered", {
    ...SOFT_BODIES,
    uniforms: { spread: 1, tone: 0 },
    inputs: {
      soft: { stages: [Small, Along, Wide], chain: (_value, { resolution }) => steps(resolution) }
    }
  });
}

/** A blur along a direction whose default reach is not 0. */
const Wide = defineFilter("fixture.wide", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(fu.sigma); }",
  glsl: "void main() { finalColor = vec4(sigma); }",
  uniforms: { dir: [0, 0], sigma: 5 }
});

describe("the chain — what a place is given", () => {
  it("gives a stage uniform the step leaves out the stage's default, never the value of an earlier step", () => {
    const held = { sigma: 3 as number | undefined };
    const Steered = steered(() => [
      {
        stage: Wide,
        scale: 1 / 2,
        uniforms: held.sigma === undefined ? { dir: [1, 0] } : { dir: [1, 0], sigma: held.sigma }
      }
    ]);
    const mock = started([Steered]);
    const entity = viewWith(mock, Steered());
    const instance = instanceOf(mock, entity, "fixture.steered");
    const place = instance.kind === "wgsl" ? instance.inputs?.places[0]?.[0] : undefined;
    const sigma = (): unknown =>
      (place?.body.group?.uniforms as Record<string, unknown> | undefined)?.sigma;

    expect(sigma()).toBe(3);

    held.sigma = undefined;
    mock.world.ecs.set(entity, Steered, { tone: 1 });
    mock.frame();

    expect(sigma()).toBe(5);
  });

  it("moves the version and the pooled resolution when only a scale changes", () => {
    const held = { scale: 1 / 2 };
    const Steered = steered(() => [{ stage: Small, scale: held.scale }]);
    const mock = started([Steered]);
    const entity = viewWith(mock, Steered());
    const instance = instanceOf(mock, entity, "fixture.steered");
    const pool = mock.pixi.module.TexturePool as unknown as {
      requests: Array<{ resolution: number }>;
    };
    const input = new FakeTexture({
      source: { width: 390, height: 844, destroyed: false, resolution: 2 },
      frame: new FakeRectangle(0, 0, 390, 844)
    }) as unknown as PixiTexture;

    held.scale = 1 / 4;
    mock.world.ecs.set(entity, Steered, { tone: 1 });
    mock.frame();
    instance.filter.apply(recorder().manager, input, input, false);

    expect(chainsOf(instance).version).toBe(2);
    expect(pool.requests.at(-1)?.resolution).toBe(0.5);
  });

  it("draws a chain the apply's resolution breaks like a broken instance, in that apply", () => {
    const Steered = steered(resolution => {
      if (resolution < 2) throw new Error("no blur below two pixels");

      return [{ stage: Small, scale: 1 / 2 }];
    });
    const mock = started([Steered]);
    const entity = viewWith(mock, Steered());
    const instance = instanceOf(mock, entity, "fixture.steered");
    const input = new FakeTexture({
      source: { width: 390, height: 844, destroyed: false, resolution: 1 },
      frame: new FakeRectangle(0, 0, 390, 844)
    }) as unknown as PixiTexture;
    const { manager, applied } = recorder();

    expect(() => instance.filter.apply(manager, input, input, false)).not.toThrow();

    expect(instance.broken).toBe(true);
    expect(applied.map(draw => draw.filter)).toEqual([instance.filter]);
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:broken", {
      filter: "fixture.steered",
      reason: "chain",
      message: "no blur below two pixels",
      input: "soft"
    });
  });
});

describe("the chain — what it may return, in every build", () => {
  // Bug: a stage outside the list was never checked; drawing it blanks a WebGPU frame.
  it.each(REFUSALS)("breaks the instance on %s and draws no stage", (_case, steps, message) => {
    const Refused = defineFilter("fixture.refused", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      inputs: {
        soft: { stages: [Small, Smaller, Along], chain: () => steps as readonly FilterStep[] }
      }
    });
    const mock = started([Refused]);
    const entity = viewWith(mock, Refused());
    const instance = instanceOf(mock, entity, "fixture.refused");
    const input = new FakeTexture({ source: { width: 390, height: 844, destroyed: false } });
    const { manager, applied } = recorder();

    instance.filter.apply(
      manager,
      input as unknown as PixiTexture,
      input as unknown as PixiTexture,
      false
    );

    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:broken", {
      filter: "fixture.refused",
      reason: "chain",
      message,
      input: "soft"
    });
    expect(instance.broken).toBe(true);
    expect(applied.map(draw => draw.filter)).toEqual([instance.filter]);
  });

  it("breaks the instance with the message of a chain that throws", () => {
    const Throwing = defineFilter("fixture.throwing", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      inputs: {
        soft: {
          stages: [Small],
          chain: () => {
            throw new Error("no blur for this screen");
          }
        }
      }
    });
    const mock = started([Throwing]);
    const entity = viewWith(mock, Throwing());

    expect(instanceOf(mock, entity, "fixture.throwing").broken).toBe(true);
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:broken", {
      filter: "fixture.throwing",
      reason: "chain",
      message: "no blur for this screen",
      input: "soft"
    });
  });
});
