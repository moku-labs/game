import * as pixi from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PixiModule } from "../../../renderer/types";
import { Alpha, Blur, ColorMatrix, Displacement, Noise } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { createFilter } from "../../filters/instance";
import type { FilterFields, FilterInstance, FilterKind } from "../../filters/types";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the one guard around the
// apply of every filter the engine builds. Filters, uniform groups and the
// texture pool are plain objects in Node; the filter system is a stand-in
// whose applyFilter throws as a destroyed binding does.
// ---------------------------------------------------------------------------

// Pixi asks a test canvas for the GLSL precision when it builds a GL program; Node has no DOM, so
// the environment adapter, Pixi's own seam for other runtimes, hands out a canvas with no WebGL.
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
});

const BODY = `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}`;

const GLSL = `
void main() {
  finalColor = texture(uTexture, vTextureCoord) * amount;
}`;

const Tint = defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL, uniforms: { amount: 0.5 } });
const Shade = defineFilter("fx.shade", { wgsl: BODY, glsl: GLSL, uniforms: { amount: 0.2 } });

const REAL = pixi as unknown as PixiModule;

/** What Pixi's filter system throws for a texture binding the engine never filled. */
const DESTROYED = "the resource bound as 'uMap' was destroyed";

/** A Pixi filter system as a guarded apply sees it. */
type Manager = Parameters<FilterInstance["filter"]["apply"]>[0];

/** The input, the output and a pooled texture: stand-ins Pixi only passes along. */
const INPUT = { label: "input" } as unknown as pixi.Texture;
const OUTPUT = { label: "output" } as unknown as pixi.Texture;
const TEMP = { label: "temp" } as unknown as pixi.Texture;

/**
 * A started mock: its kinds are registered and its log is spied.
 *
 * @returns The mock.
 */
function started(): MockEffects {
  const mock = createMockEffects();

  mock.start();

  return mock;
}

/**
 * Builds an instance on the real Pixi module and fails the test when none came out.
 *
 * @param mock - The started mock.
 * @param kind - The kind.
 * @param value - The stored filter value.
 * @returns The instance.
 */
function build(mock: MockEffects, kind: FilterKind, value: FilterFields): FilterInstance {
  const instance = createFilter(mock.ectx, REAL, kind, value);

  if (instance === undefined) throw new Error(`no instance of ${kind.id}`);

  return instance;
}

/**
 * The kind of one of the test's own filters.
 *
 * @param component - The filter component.
 * @param index - Its registration index.
 * @returns The kind.
 */
function own(component: typeof Tint, index: number): FilterKind {
  return {
    id: component.componentName,
    component,
    source: "wgsl",
    definition: component.filter,
    index
  };
}

/**
 * A registered core kind of the mock.
 *
 * @param mock - The started mock.
 * @param id - The kind id.
 * @returns The kind.
 */
function core(mock: MockEffects, id: string): FilterKind {
  const kind = mock.state.kinds.get(id);

  if (kind === undefined) throw new Error(`no kind ${id}`);

  return kind;
}

/**
 * A filter system stand-in whose `applyFilter` throws for every enabled filter `fails` picks.
 *
 * @param fails - Which filters throw.
 * @returns The manager and its spy.
 */
function managerThat(fails: (filter: pixi.Filter) => boolean): {
  manager: Manager;
  applyFilter: ReturnType<typeof vi.fn>;
} {
  const applyFilter = vi.fn((filter: pixi.Filter) => {
    if (fails(filter)) throw new Error(DESTROYED);
  });

  return { manager: { applyFilter } as unknown as Manager, applyFilter };
}

describe("the apply guard — on the real Pixi module", () => {
  it("a throw inside apply never leaves the guard, and the view is drawn straight through in the same call", () => {
    const mock = started();
    const instance = build(mock, own(Tint, 7), Tint().value);
    const { manager, applyFilter } = managerThat(filter => filter.enabled);

    expect(() => instance.filter.apply(manager, INPUT, OUTPUT, true)).not.toThrow();

    expect(instance.broken).toBe(true);
    expect(instance.filter.enabled).toBe(false);
    expect(applyFilter).toHaveBeenCalledTimes(2);
    expect(applyFilter).toHaveBeenLastCalledWith(instance.filter, INPUT, OUTPUT, true);
  });

  it("a Blur whose first pass throws still gives its temp texture back to the pool", () => {
    const mock = started();
    const instance = build(
      mock,
      core(mock, "effects.blur"),
      Blur({ strength: 8, quality: 1 }).value
    );

    if (instance.kind !== "blur") throw new Error("not a blur");

    const blur = instance.filter;
    const taken = vi.spyOn(pixi.TexturePool, "getSameSizeTexture").mockReturnValue(TEMP);
    const returned = vi
      .spyOn(pixi.TexturePool, "returnTexture")
      .mockImplementation(() => undefined);
    const { manager, applyFilter } = managerThat(filter => filter === blur.blurXFilter);

    expect(() => blur.apply(manager, INPUT, OUTPUT, false)).not.toThrow();

    expect(taken).toHaveBeenCalledTimes(1);
    expect(returned.mock.calls).toEqual([[TEMP]]);
    // The X pass drew the input into the temp texture, the Y pass the temp into the output, both
    // straight through the switched-off Blur.
    expect(applyFilter.mock.calls.slice(1)).toEqual([
      [blur, INPUT, TEMP, true],
      [blur, TEMP, OUTPUT, false]
    ]);
    expect(instance.broken).toBe(true);
  });

  it("one effects:broken line per kind, however many instances break", () => {
    const mock = started();
    const first = build(mock, own(Tint, 7), Tint().value);
    const second = build(mock, own(Tint, 7), Tint().value);
    const shade = build(mock, own(Shade, 8), Shade().value);
    const { manager } = managerThat(filter => filter.enabled);

    first.filter.apply(manager, INPUT, OUTPUT, true);
    second.filter.apply(manager, INPUT, OUTPUT, true);

    expect(second.broken).toBe(true);
    expect(mock.log.error).toHaveBeenCalledTimes(1);
    expect(mock.log.error).toHaveBeenCalledWith("effects:broken", {
      filter: "fx.tint",
      reason: "apply",
      message: DESTROYED
    });

    shade.filter.apply(manager, INPUT, OUTPUT, true);

    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(mock.log.error).toHaveBeenLastCalledWith("effects:broken", {
      filter: "fx.shade",
      reason: "apply",
      message: DESTROYED
    });
  });

  it("a second throw while drawing straight through is swallowed", () => {
    const mock = started();
    const instance = build(mock, own(Tint, 7), Tint().value);
    const { manager, applyFilter } = managerThat(() => true);

    expect(() => instance.filter.apply(manager, INPUT, OUTPUT, true)).not.toThrow();
    expect(() => instance.filter.apply(manager, INPUT, OUTPUT, true)).not.toThrow();

    expect(applyFilter).toHaveBeenCalledTimes(3);
    expect(mock.log.error).toHaveBeenCalledTimes(1);
  });

  it("every kind gets its own guarded apply, a Blur on both passes too, and an apply that passes draws once", () => {
    const mock = started();

    mock.textures.set("fx.ripple", pixi.Texture.WHITE as never);

    const values: Array<[string, FilterFields]> = [
      ["effects.blur", Blur().value],
      ["effects.colorMatrix", ColorMatrix().value],
      ["effects.noise", Noise().value],
      ["effects.alpha", Alpha().value],
      ["effects.displacement", Displacement({ map: "fx.ripple" }).value]
    ];
    const instances = [
      build(mock, own(Tint, 7), Tint().value),
      ...values.map(([id, value]) => build(mock, core(mock, id), value))
    ];
    const blur = instances[1];

    for (const instance of instances) expect(Object.hasOwn(instance.filter, "apply")).toBe(true);
    if (blur?.kind !== "blur") throw new Error("not a blur");
    expect(Object.hasOwn(blur.filter.blurXFilter, "apply")).toBe(true);
    expect(Object.hasOwn(blur.filter.blurYFilter, "apply")).toBe(true);

    const tint = instances[0];
    const { manager, applyFilter } = managerThat(() => false);

    tint?.filter.apply(manager, INPUT, OUTPUT, true);

    expect(applyFilter.mock.calls).toEqual([[tint?.filter, INPUT, OUTPUT, true]]);
    expect(tint?.broken).toBe(false);
  });
});
