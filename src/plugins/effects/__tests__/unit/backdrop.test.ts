import * as pixi from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeatureFilter } from "../../../flow/types";
import { Sprite, Transform } from "../../../renderer/components";
import type { FilterSlot, PixiFilter, PixiModule, PixiTexture } from "../../../renderer/types";
import type { Entity } from "../../../world/types";
import { defineFilter } from "../../filters/define";
import { createFilter, createStandIn } from "../../filters/instance";
import type { FilterInstance, FilterKind, FilterStep } from "../../filters/types";
import {
  Frosted,
  Small,
  SOFT_BODIES,
  SOFT_STAGES,
  Soft,
  softChain,
  UNDER_BODIES,
  Under
} from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: a backdrop filter reads what was drawn under its view, inside its
// box. Pixi copies that part of the canvas before the view draws (the filter's
// `blendRequired`) and binds it at group 0 binding 3; the engine gives the body
// `sampleBack(uv)` and lets an input chain start from it. The apply cases run
// on the real pixi.js module, the sync cases on the fake module of the mock.
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
 * A stand-in for Pixi's filter system inside the pop of a backdrop view: the back texture it copied, and every draw.
 *
 * @param back - What `activeBackTexture` answers.
 * @param during - Called inside each draw, with the filter it draws.
 * @returns The manager and its records.
 */
function recorder(
  back: PixiTexture | undefined,
  during: (filter: PixiFilter) => void = () => undefined
): { manager: Manager; applied: Applied[] } {
  const applied: Applied[] = [];
  const manager = {
    activeBackTexture: back,
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
function started(filters: readonly FeatureFilter[]): MockEffects {
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
 * @param id - The kind id.
 * @param value - The stored value.
 * @returns The instance.
 */
function build(
  mock: MockEffects,
  id: string,
  value: Parameters<typeof createFilter>[3]
): FilterInstance {
  const instance = createFilter(mock.ectx, REAL, kindOf(mock, id), value);

  if (instance === undefined) throw new Error(`no instance of ${id}`);

  return instance;
}

/**
 * The texture Pixi copies the canvas under a 390 × 844 box into: pooled, so its backing is larger than its frame.
 *
 * @param resolution - The resolution of the surface it was copied from.
 * @returns The texture.
 */
function backAt(resolution: number): PixiTexture {
  return pixi.TexturePool.getOptimalTexture({ width: 390, height: 844, resolution });
}

/**
 * The input of the view and its output, 390 × 844 CSS px.
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

describe("defineFilter — a backdrop filter", () => {
  // Bug: the body names `uBackTexture` or `sampleBack` and the header never declared it: no device compiles it; or every
  // filter's group 0 gains binding 3 and its programs change.
  it("declares the back texture at group 0 binding 3 and sampleBack in both languages; a filter that is none, neither", () => {
    expect(Under.filter.backdrop).toBe(true);
    expect(Under.filter.source).toContain(
      "@group(0) @binding(3) var uBackTexture: texture_2d<f32>;"
    );
    expect(Under.filter.source).toContain("fn sampleBack(uv: vec2<f32>) -> vec4<f32> {");
    expect(Under.filter.source).toContain(
      "  spread: f32,\n  backScale: vec2<f32>,\n  backClamp: vec4<f32>,\n};"
    );
    expect(Under.filter.source.endsWith(UNDER_BODIES.wgsl)).toBe(true);
    expect(Under.filter.glsl).toContain("uniform sampler2D uBackTexture;");
    expect(Under.filter.glsl).toContain(
      "uniform float spread;\nuniform vec2 backScale;\nuniform vec4 backClamp;\n"
    );
    expect(Under.filter.glsl).toContain("vec4 sampleBack(vec2 uv) {");
    expect(Under.filter.glsl.endsWith(UNDER_BODIES.glsl)).toBe(true);
    expect(Soft.filter.backdrop).toBe(false);
    expect(`${Soft.filter.source}${Soft.filter.glsl}`).not.toMatch(/uBackTexture|sampleBack/);
  });

  // Bug: a backdrop view is kept as a picture: the panel shows the blur of the scene of the frame it was taken in.
  it("is drawn live, never kept, also when its body calls canvasPixel", () => {
    const Placed = defineFilter("fixture.placedUnder", {
      wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleBack(uv) + vec4<f32>(canvasPixel(uv), 0.0, 0.0) * 0.0; }",
      glsl: "void main() { finalColor = sampleBack(vTextureCoord) + vec4(canvasPixel(vTextureCoord), 0.0, 0.0) * 0.0; }",
      backdrop: true
    });

    expect(Under.filter.cache).toBe("screen");
    expect(Frosted.filter.cache).toBe("screen");
    expect(Placed.filter.cache).toBe("screen");
    expect(Placed.filter.origin?.name).toBe("keptOrigin");
  });

  it("reads where each input starts: the view's own input by default, what was drawn under it for back", () => {
    expect(Frosted.filter.inputs.map(input => input.from)).toEqual(["back"]);
    expect(Soft.filter.inputs.map(input => input.from)).toEqual(["input"]);
  });

  /** A stage that is a backdrop, for the refusal of a stage. */
  const BackStage = defineFilter("fixture.backStage", { ...UNDER_BODIES, backdrop: true });

  it.each([
    [
      "an input from back on a filter that is no backdrop",
      () =>
        defineFilter("fixture.x", {
          ...SOFT_BODIES,
          uniforms: { spread: 1, tone: 0 },
          inputs: { soft: { from: "back", stages: SOFT_STAGES, chain: softChain } }
        }),
      '[game] Filter "fixture.x": input "soft" starts from "back", which only a backdrop filter can read.\n  Give the filter backdrop: true.'
    ],
    [
      "an input from a place it does not know",
      () =>
        defineFilter("fixture.x", {
          ...SOFT_BODIES,
          uniforms: { spread: 1, tone: 0 },
          backdrop: true,
          inputs: {
            soft: { from: "front" as "back", stages: SOFT_STAGES, chain: softChain }
          }
        }),
      '[game] Filter "fixture.x": input "soft" starts from "front".\n  Write from: "input" or from: "back".'
    ],
    [
      "a padding",
      () =>
        defineFilter("fixture.x", {
          ...UNDER_BODIES,
          uniforms: { spread: 1 },
          backdrop: true,
          padding: 4
        }),
      '[game] Filter "fixture.x" is a backdrop: its padding must be 0.\n  Pixi copies the canvas under the padded box, and a copy past the canvas edge fails: leave padding out.'
    ],
    [
      "a padding named after a uniform",
      () =>
        defineFilter("fixture.x", {
          ...UNDER_BODIES,
          uniforms: { spread: 1 },
          backdrop: true,
          padding: "spread"
        }),
      '[game] Filter "fixture.x" is a backdrop: its padding must be 0.\n  Pixi copies the canvas under the padded box, and a copy past the canvas edge fails: leave padding out.'
    ],
    [
      "a cache that keeps it",
      () =>
        defineFilter("fixture.x", {
          ...UNDER_BODIES,
          uniforms: { spread: 1 },
          backdrop: true,
          cache: "local"
        }),
      '[game] Filter "fixture.x" is a backdrop: it reads what is drawn under its view, so it is drawn live in every frame.\n  Leave cache out, or set it to false.'
    ],
    [
      "a backdrop that is no switch",
      () =>
        defineFilter("fixture.x", {
          ...UNDER_BODIES,
          uniforms: { spread: 1 },
          backdrop: "yes" as unknown as boolean
        }),
      '[game] Filter "fixture.x": backdrop must be true or false.\n  Got "yes".'
    ],
    [
      "a stage that is a backdrop",
      () =>
        defineFilter("fixture.x", {
          ...SOFT_BODIES,
          uniforms: { spread: 1, tone: 0 },
          inputs: { soft: { stages: [Small, BackStage], chain: softChain } }
        }),
      '[game] Filter "fixture.x": stage "fixture.backStage" of input "soft" is a backdrop.\n  A stage reads the step before it: give it no backdrop.'
    ],
    [
      "a backdrop fallback of a filter that is none",
      () =>
        defineFilter("fixture.x", {
          ...SOFT_BODIES,
          uniforms: { spread: 1, tone: 0 },
          fallback: Under
        }),
      '[game] Filter "fixture.x": its fallback "fixture.under" is a backdrop, and "fixture.x" is not.\n  A fallback draws in its place on the same view: give it no backdrop, or make "fixture.x" a backdrop too.'
    ],
    [
      "a uniform named after the engine's scale of the back",
      () =>
        defineFilter("fixture.x", {
          ...UNDER_BODIES,
          uniforms: { spread: 1, backScale: 1 },
          backdrop: true
        }),
      '[game] Filter "fixture.x": uniform "backScale" is reserved.\n  Rename it.'
    ]
  ])("refuses %s", (_case, define, message) => {
    expect(define).toThrow(message);
  });
});

describe("the apply of a backdrop filter — on the real Pixi module", () => {
  // Bug: the Pixi filter is built without `blendRequired`: Pixi copies nothing and binds its empty texture at binding 3.
  it("asks Pixi for the canvas under its view; a filter that is no backdrop does not", () => {
    const mock = started([Under, Soft]);

    expect(build(mock, "fixture.under", Under().value).filter.blendRequired).toBe(true);
    expect(build(mock, "fixture.soft", Soft().value).filter.blendRequired).toBe(false);
  });

  // Bug: sampleBack reads the back texture with the input's scale: wrong as soon as the two backings differ.
  it("fills sampleBack's scale and clamp from the back texture Pixi copied, then draws the body once from the view's input", () => {
    const mock = started([Under]);
    const instance = build(mock, "fixture.under", Under().value);
    const { input, output } = textures(1);
    const back = backAt(2);
    const seen: Array<number | number[]> = [];
    const { manager, applied } = recorder(back, () => {
      seen.push(uniformOf(instance.filter, "backScale"), uniformOf(instance.filter, "backClamp"));
    });

    instance.filter.apply(manager, input, output, false);

    // The copy of 390 × 844 at two pixels per unit sits in a pooled texture of 1024 × 2048 pixels.
    expect(applied).toEqual([{ filter: instance.filter, from: input, to: output, clear: false }]);
    expect(seen).toEqual([
      [1 / 512, 1 / 1024].map(value => Math.fround(value)),
      [0.5 / 1024, 0.5 / 2048, 390 / 512 - 0.5 / 1024, 844 / 1024 - 0.5 / 2048].map(value =>
        Math.fround(value)
      )
    ]);
  });

  // Bug: the chain blurs the view's own content (the panel) instead of the scene under it.
  it("draws a chain that starts from back from the back texture, at the back's resolution, then the body from the view's input", () => {
    const mock = started([Frosted]);
    const instance = build(mock, "fixture.frosted", Frosted().value);
    const { input, output } = textures(2);
    const back = backAt(2);
    const { manager, applied } = recorder(back);

    instance.filter.apply(manager, input, output, false);

    const [small, alongX, alongY, body] = applied;

    expect(applied).toHaveLength(4);
    expect(small?.from).toBe(back);
    expect(alongX?.from).toBe(small?.to);
    expect(alongY?.from).toBe(alongX?.to);
    expect(applied.slice(0, 3).map(draw => draw.to.source.resolution)).toEqual([1, 0.5, 0.5]);
    expect(body).toEqual({ filter: instance.filter, from: input, to: output, clear: false });
  });

  // Bug: the chain of a backdrop runs at the view's resolution while it reads a back of another: its blur is too
  // wide or too narrow by their ratio; or it runs again in every frame.
  it("runs a chain from back at the back's resolution, once over many frames, and again when the back's changes", () => {
    const chain = vi.fn(softChain);
    const Spied = defineFilter("fixture.spiedBack", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      backdrop: true,
      inputs: { soft: { from: "back", stages: SOFT_STAGES, chain } }
    });
    const mock = started([Spied]);
    const instance = build(mock, "fixture.spiedBack", Spied().value);
    const { input, output } = textures(0.5);
    const first = recorder(backAt(2));

    for (let frame = 0; frame < 10; frame += 1)
      instance.filter.apply(first.manager, input, output, false);

    // Built at the canvas's 2, then never again: ten frames of the view at 0.5 over a back at 2.
    expect(chain).toHaveBeenCalledTimes(1);
    expect(first.applied).toHaveLength(40);
    expect(first.applied[0]?.to.source.resolution).toBe(1);

    instance.filter.apply(recorder(backAt(1)).manager, input, output, false);

    expect(chain).toHaveBeenCalledTimes(2);
    expect(chain.mock.lastCall?.[1].resolution).toBe(1);
  });

  // Bug: the stand-in that draws for a broken frost is a backdrop whose sampleBack nobody fills: it reads at scale 0.
  it.each([
    ["a release build", false],
    ["a dev build, under the striped mark", true]
  ])("fills the back of a backdrop fallback in %s", (_build, dev) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", dev);

    const Veiled = defineFilter("fixture.veiledBack", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      backdrop: true,
      inputs: { soft: { from: "back", stages: SOFT_STAGES, chain: softChain } },
      fallback: Under
    });
    const mock = started([Veiled]);

    mock.state.checks.status.set(Under.filter, "ok");

    const standIn = createStandIn(
      mock.ectx,
      REAL,
      kindOf(mock, "fixture.veiledBack"),
      Veiled().value
    );
    const fallback = standIn?.filter;
    const { input, output } = textures(1);
    const scales: Array<number | number[]> = [];
    const { manager, applied } = recorder(backAt(2), filter => {
      if (filter === fallback) scales.push(uniformOf(filter, "backScale"));
    });

    fallback?.apply(manager, input, output, false);

    expect(fallback?.blendRequired).toBe(true);
    expect(applied[0]?.filter).toBe(fallback);
    expect(applied).toHaveLength(dev ? 2 : 1);
    expect(scales).toEqual([[1 / 512, 1 / 1024].map(value => Math.fround(value))]);
  });
});

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
 * The first slot last handed to the renderer for an entity.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns The slot.
 */
function slotOf(mock: MockEffects, entity: Entity): FilterSlot | undefined {
  return mock.renderer.sets.findLast(set => set.entity === entity)?.slots[0];
}

describe("the slot of a backdrop view", () => {
  // Bug: the renderer keeps the panel as a picture, or an overlay over it holds the loops of a scene that is sharp
  // around the panels, because the slot says it shows a blurred copy of its own subtree.
  it("is drawn live and shows no blurred copy of the view's own subtree; a chain from the input does", () => {
    const mock = started([Frosted, Soft]);
    const frosted = slotOf(mock, viewWith(mock, Frosted()));
    const soft = slotOf(mock, viewWith(mock, Soft()));

    expect(frosted?.cache).toBe("screen");
    expect(frosted?.blurs).toBeUndefined();
    // The body and the three steps of the chain at the back's two real pixels per CSS pixel.
    expect(frosted?.passes).toBe(4);
    expect(soft?.blurs).toBe(true);
  });
});

describe("the chain of a backdrop — what it may return", () => {
  // Bug: a chain from back of an empty list binds nothing: the body reads the empty texture.
  it("binds the back itself for an empty chain from back", () => {
    const Empty = defineFilter("fixture.emptyBack", {
      ...SOFT_BODIES,
      uniforms: { spread: 0, tone: 0 },
      backdrop: true,
      inputs: { soft: { from: "back", stages: [Small], chain: (): readonly FilterStep[] => [] } }
    });
    const mock = started([Empty]);
    const instance = build(mock, "fixture.emptyBack", Empty().value);
    const resources = instance.filter.resources as Record<string, unknown>;
    const back = backAt(2);
    const { input, output } = textures(2);
    const bound: unknown[] = [];
    const { manager } = recorder(back, () => bound.push(resources.softTexture));

    instance.filter.apply(manager, input, output, false);

    expect(bound).toEqual([back.source]);
  });
});
