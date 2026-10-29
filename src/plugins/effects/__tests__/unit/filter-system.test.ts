import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeFilter, FakeUniformGroup } from "../../../renderer/__tests__/fake-pixi";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import type { AnyComponentValue, Entity } from "../../../world/types";
import {
  Alpha,
  Blur,
  ColorMatrix,
  Displacement,
  Glow,
  Noise,
  Outline
} from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { atlasTexture, type FakeFxBlurFilter } from "../fake-effects-pixi";
import { Bad, Hazy, Smaller, Soft, SoftDim } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the filter sync over the real ecs of world and a fake renderer —
// one instance per view and kind, assignment only on kind and passes changes,
// order, passes, removal, budgets, the dev check
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
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

const Tint = defineFilter("fx.tint", {
  wgsl: BODY,
  glsl: GLSL,
  uniforms: { amount: 0, color: { color: 0xff_d7_00 } }
});

const Heavy = defineFilter("fx.heavy", { wgsl: BODY, glsl: GLSL, passes: 3 });

/**
 * A started mock with the feature filters `fx.tint` and `fx.heavy`.
 *
 * @param options - Passed to `createMockEffects`.
 * @returns The started mock.
 */
function started(options: Parameters<typeof createMockEffects>[0] = {}): MockEffects {
  const mock = createMockEffects(options);

  mock.features.push({ name: "board", description: { filters: [Tint, Heavy] } });
  mock.start();

  return mock;
}

/**
 * Spawns a sprite view with a drawn display object and the given filter components.
 *
 * @param mock - The mock.
 * @param components - The filter components and anything else.
 * @returns The entity.
 */
function view(mock: MockEffects, components: readonly AnyComponentValue[]): Entity {
  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), ...components]);

  mock.renderer.displays.add(entity);

  return entity;
}

/**
 * The filters of the last assignment.
 *
 * @param mock - The mock.
 * @returns The filter instances of the last `filters.set`, in order.
 */
function lastFilters(mock: MockEffects): unknown[] {
  return (mock.renderer.sets.at(-1)?.slots ?? []).map(slot => slot.filter);
}

/**
 * The instance of one kind on one entity.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @param id - The kind id.
 * @returns The Pixi filter, as the fake.
 */
function filterOf(mock: MockEffects, entity: Entity, id: string): FakeFilter | undefined {
  return mock.state.views.get(entity)?.instances.get(id)?.filter as unknown as
    | FakeFilter
    | undefined;
}

describe("the filter sync — instances and assignment", () => {
  it("keeps one instance per view and kind and hangs them with one set", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();
    mock.frame();
    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");
    const tint = filterOf(mock, entity, "fx.tint");

    expect(mock.state.views.get(entity)?.instances.size).toBe(2);
    expect(mock.renderer.sets).toHaveLength(1);
    expect(mock.renderer.sets[0]?.entity).toBe(entity);
    expect(lastFilters(mock)).toEqual([glow, tint]);
    expect(Object.isFrozen(mock.renderer.sets[0]?.slots)).toBe(true);
    expect(mock.api.stats().filters).toBe(2);
  });

  it("writes our uniforms every frame and flips enabled without assigning", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();
    mock.world.ecs.set(entity, Tint, { amount: 0.7 });
    mock.world.ecs.set(entity, Glow, { enabled: false });
    mock.frame();

    const tint = filterOf(mock, entity, "fx.tint");

    expect((tint?.resources.fu as FakeUniformGroup).uniforms.amount).toBe(0.7);
    expect(filterOf(mock, entity, "effects.glow")?.enabled).toBe(false);
    expect(mock.renderer.sets).toHaveLength(1);
  });

  it("assigns a new list when a kind joins or leaves and destroys the one that left", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();

    const first = mock.renderer.sets[0]?.slots;
    const tint = filterOf(mock, entity, "fx.tint");

    mock.world.ecs.add(entity, Blur());
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(2);
    expect(mock.renderer.sets[1]?.slots).not.toBe(first);
    expect(mock.renderer.sets[1]?.slots).toHaveLength(3);

    mock.world.ecs.remove(entity, Tint);
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(3);
    expect(lastFilters(mock)).toEqual([
      filterOf(mock, entity, "effects.glow"),
      filterOf(mock, entity, "effects.blur")
    ]);
    expect(tint?.destroyed).toBe(true);
    expect((tint?.resources.fu as FakeUniformGroup).buffer.destroyed).toBe(true);

    mock.world.ecs.remove(entity, Glow);
    mock.world.ecs.remove(entity, Blur);
    mock.frame();

    expect(mock.renderer.sets.at(-1)?.slots).toEqual([]);
    expect(mock.state.views.has(entity)).toBe(false);
    expect(mock.api.stats().filters).toBe(0);
  });

  it("assigns the same instances again when a kind's passes change", () => {
    const mock = started();
    const entity = view(mock, [Blur({ quality: 1 })]);

    mock.frame();
    expect(mock.renderer.sets[0]?.slots[0]?.passes).toBe(2);
    // The performance log of the renderer names the filter by its kind.
    expect(mock.renderer.sets[0]?.slots[0]?.kind).toBe("effects.blur");

    mock.world.ecs.set(entity, Blur, { quality: 3 });
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(2);
    expect(mock.renderer.sets[1]?.slots[0]?.filter).toBe(mock.renderer.sets[0]?.slots[0]?.filter);
    expect(mock.renderer.sets[1]?.slots[0]?.passes).toBe(6);
    expect((filterOf(mock, entity, "effects.blur") as unknown as FakeFxBlurFilter).quality).toBe(3);

    mock.world.ecs.set(entity, Blur, { strength: 2 });
    mock.frame();
    expect(mock.renderer.sets).toHaveLength(2);
  });

  it("writes a core kind only on the frame its component changed, and only on that view", () => {
    const mock = started();
    const changed = view(mock, [Blur()]);
    const still = view(mock, [Blur()]);

    mock.frame();
    mock.world.ecs.set(changed, Blur, { strength: 2 });
    mock.frame();

    const written = filterOf(mock, changed, "effects.blur") as unknown as FakeFxBlurFilter;
    const untouched = filterOf(mock, still, "effects.blur") as unknown as FakeFxBlurFilter;
    const calls = written.calls.length;

    expect(written.calls).toContain("strength=2");
    expect(untouched.calls).not.toContain("strength=2");

    mock.frame();

    expect(written.calls).toHaveLength(calls);
  });

  it("orders the filters by order, then by registration", () => {
    const mock = started();
    const entity = view(mock, [Tint(), Glow()]);

    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");
    const tint = filterOf(mock, entity, "fx.tint");

    expect(lastFilters(mock)).toEqual([glow, tint]);

    mock.world.ecs.set(entity, Glow, { order: 5 });
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(2);
    expect(lastFilters(mock)).toEqual([tint, glow]);
  });

  it("gives every slot the passes of one apply of its kind", () => {
    const mock = started();

    view(mock, [Glow(), Blur(), Heavy(), Tint()]);
    mock.frame();

    expect(mock.renderer.sets[0]?.slots.map(slot => slot.passes)).toEqual([1, 4, 1, 3]);
  });

  it("calls nothing for a despawned view and destroys its instances", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");

    mock.world.ecs.despawn(entity);
    mock.renderer.displays.delete(entity);
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(1);
    expect(glow?.destroyed).toBe(true);
    expect(mock.state.views.has(entity)).toBe(false);
  });

  it("tracks the filters of entities that existed before the start", () => {
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { filters: [Tint] } });

    const entity = view(mock, [Glow()]);

    mock.start();
    mock.frame();

    expect(filterOf(mock, entity, "effects.glow")).toBeDefined();
  });

  it("waits for the map of a Displacement", () => {
    const mock = started();
    const entity = view(mock, [Displacement({ map: "fx.ripple" })]);

    mock.frame();
    expect(filterOf(mock, entity, "effects.displacement")).toBeUndefined();
    expect(mock.renderer.sets).toHaveLength(0);

    mock.textures.set("fx.ripple", atlasTexture({ width: 8, height: 8, destroyed: false }));
    mock.frame();

    expect(filterOf(mock, entity, "effects.displacement")).toBeDefined();
    expect(mock.renderer.sets).toHaveLength(1);
  });

  it("does nothing while the renderer is not ready", () => {
    const mock = started({ ready: false });

    view(mock, [Glow(), Tint()]);
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(0);
    expect(mock.api.stats().filters).toBe(0);
  });

  it("forgets a view that never got an instance when its last filter leaves", () => {
    const mock = started({ ready: false });
    const entity = view(mock, [Glow()]);

    expect(mock.state.views.has(entity)).toBe(true);

    mock.world.ecs.despawn(entity);

    expect(mock.state.views.has(entity)).toBe(false);
  });
});

describe("the filter sync — the WGSL check, in every build", () => {
  it("instantiates a kind only once its WGSL compiled clean", async () => {
    const mock = started();

    mock.renderer.device = mock.gpu.device;

    const entity = view(mock, [Tint()]);

    mock.frame();
    expect(filterOf(mock, entity, "fx.tint")).toBeUndefined();
    expect(mock.state.checks.status.get(Tint.filter)).toBe("pending");

    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    mock.frame();

    expect(filterOf(mock, entity, "fx.tint")).toBeDefined();
  });

  it("never instantiates a broken kind, and the view renders as if it had none", async () => {
    const mock = started();

    mock.renderer.device = mock.gpu.device;
    mock.gpu.messages.push({ type: "error", lineNum: 3, linePos: 9, message: "bad" });

    const entity = view(mock, [Tint()]);

    mock.frame();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    mock.frame();
    mock.frame();

    expect(filterOf(mock, entity, "fx.tint")).toBeUndefined();
    expect(mock.renderer.sets).toHaveLength(0);
    expect(mock.state.broken.has("fx.tint")).toBe(true);
  });
});

/**
 * A full-screen sprite with an enabled blur.
 *
 * @returns Its components.
 */
function cover(): AnyComponentValue[] {
  return [Sprite({ texture: "board.bg", width: 1080, height: 1920 }), Transform(), Blur()];
}

describe("the filter sync — budgets", () => {
  it("warns once per steady crossing of the renderer's render passes: 60 frames in a row", () => {
    const mock = started();

    view(mock, [Glow()]);
    mock.renderer.passes = 30;
    for (let frame = 0; frame < 59; frame += 1) mock.frame();

    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.frame();
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:pass-budget", { passes: 30, budget: 24 });

    mock.renderer.passes = 10;
    mock.frame();
    mock.renderer.passes = 25;
    for (let frame = 0; frame < 60; frame += 1) mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
  });

  // Bug (F117): the first takes of a scene that appears go over the budget for a few frames and were warned.
  it("names no start-up overshoot that falls back under the budget within 60 frames", () => {
    const mock = started();

    view(mock, [Glow()]);
    mock.renderer.passes = 26;
    for (let frame = 0; frame < 59; frame += 1) mock.frame();
    mock.renderer.passes = 7;
    mock.frame();
    mock.renderer.passes = 26;
    for (let frame = 0; frame < 59; frame += 1) mock.frame();

    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("reads neither the renderer's passes nor a change set while no view carries a filter", () => {
    const mock = started();
    const changed = vi.spyOn(mock.world.ecs, "changed");
    const passes = vi.spyOn(mock.ectx.deps.renderer.sync, "renderPasses");

    mock.renderer.passes = 30;
    mock.frame();

    expect(changed).not.toHaveBeenCalled();
    expect(passes).not.toHaveBeenCalled();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("reads sync.renderPasses() once per frame while a view carries a filter, never stats()", () => {
    const mock = started();
    const passes = vi.spyOn(mock.ectx.deps.renderer.sync, "renderPasses");
    const stats = vi.spyOn(mock.ectx.deps.renderer, "stats");

    view(mock, [Glow()]);
    mock.frame();
    mock.frame();

    expect(passes).toHaveBeenCalledTimes(2);
    expect(stats).not.toHaveBeenCalled();
  });

  it("warns once per crossing of more than one full-screen filtered view", () => {
    const mock = started();
    const first = mock.spawn(cover());

    mock.frame();
    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.spawn(cover());
    mock.frame();
    mock.spawn(cover());
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:full-screen-filters", { count: 2 });

    mock.world.ecs.despawn(first);
    mock.frame();
    mock.spawn(cover());
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
  });

  it("counts a box times its scale, from a sprite, a nine-slice or a shape, and only enabled filters", () => {
    const mock = started();

    mock.spawn([Sprite({ texture: "a" }), Transform(), Blur()]);
    mock.spawn([
      NineSlice({ texture: "a", width: 2160, height: 3840 }),
      Transform({ scale: 0.5 }),
      Blur()
    ]);
    mock.spawn([Shape({ w: 1080, h: 1920 }), Transform(), Blur({ enabled: false })]);
    mock.spawn([Sprite({ texture: "a", width: 1080, height: 1000 }), Transform(), Blur()]);
    mock.frame();

    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.spawn([Shape({ w: 1200, h: 2000 }), Transform(), Glow()]);
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledWith("effects:full-screen-filters", { count: 2 });
  });
});

describe("the filter sync — kinds a debug switch turned off", () => {
  it("an off kind is left out of the slots handed to the renderer, once; the other kinds of the view stay", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();
    mock.api.diagnostics.disable("effects.glow");
    mock.frame();
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(2);
    expect(lastFilters(mock)).toEqual([filterOf(mock, entity, "fx.tint")]);
    expect(mock.api.stats().filters).toBe(2);

    mock.api.diagnostics.enable("effects.glow");
    mock.frame();
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(3);
    expect(lastFilters(mock)).toEqual([
      filterOf(mock, entity, "effects.glow"),
      filterOf(mock, entity, "fx.tint")
    ]);
  });

  it("an off kind's instance is kept and still written; on enable it returns with the value written while it was off", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");
    const tint = filterOf(mock, entity, "fx.tint");

    mock.api.diagnostics.disable("effects.glow");
    mock.api.diagnostics.disable("fx.tint");
    mock.frame();
    mock.world.ecs.set(entity, Glow, { enabled: false });
    mock.world.ecs.set(entity, Tint, { amount: 0.4 });
    mock.frame();

    expect(filterOf(mock, entity, "effects.glow")).toBe(glow);
    expect(glow?.enabled).toBe(false);
    expect((tint?.resources.fu as FakeUniformGroup).uniforms.amount).toBe(0.4);

    mock.api.diagnostics.enable("effects.glow");
    mock.frame();

    expect(lastFilters(mock)).toEqual([glow]);
    expect(glow?.enabled).toBe(false);
  });

  it("a view that gains an off kind gets an instance and no slot", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();

    mock.api.diagnostics.disable("effects.glow");

    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();

    expect(filterOf(mock, entity, "effects.glow")).toBeDefined();
    expect(lastFilters(mock)).toEqual([filterOf(mock, entity, "fx.tint")]);
  });

  it("the full-screen budget does not count a full-screen view whose only filter is off", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();

    mock.api.diagnostics.disable("effects.blur");
    mock.spawn(cover());
    mock.spawn(cover());
    mock.frame();

    expect(mock.log.warn).not.toHaveBeenCalledWith("effects:full-screen-filters", { count: 2 });

    mock.api.diagnostics.enable("effects.blur");
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledWith("effects:full-screen-filters", { count: 2 });
  });
});

describe("the filter sync — compare on write and renderer.invalidate", () => {
  it("a system that rewrites a filter with the same value every frame makes no invalidate call", () => {
    const mock = started();
    const entity = view(mock, [Tint({ amount: 0.6 }), Blur({ strength: 4 })]);

    for (let index = 0; index < 30; index += 1) {
      mock.world.ecs.set(entity, Tint, { amount: 0.6 });
      mock.world.ecs.set(entity, Blur, { strength: 4 });
      mock.frame();
    }

    expect(mock.ectx.deps.renderer.invalidate).not.toHaveBeenCalled();
  });

  it("two kinds of one view changing in one frame make one invalidate call, and the next frame may ask again", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);
    const invalidate = vi.mocked(mock.ectx.deps.renderer.invalidate);

    mock.frame();
    mock.world.ecs.set(entity, Glow, { strength: 5 });
    mock.world.ecs.set(entity, Tint, { amount: 0.3 });
    mock.frame();

    expect(invalidate.mock.calls).toEqual([[entity]]);

    mock.world.ecs.set(entity, Tint, { amount: 0.4 });
    mock.frame();

    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("a new filter list goes to set, not to invalidate: a kind added, an order changed", () => {
    const mock = started();
    const entity = view(mock, [Glow(), Tint()]);

    mock.frame();
    mock.world.ecs.add(entity, Heavy());
    mock.frame();
    mock.world.ecs.set(entity, Glow, { order: 5 });
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(3);
    expect(mock.ectx.deps.renderer.invalidate).not.toHaveBeenCalled();
  });

  it("invalidate comes before the new value reaches the Pixi filter", () => {
    const mock = started();
    const entity = view(mock, [Glow({ distance: 4 }), Tint({ amount: 0.1 })]);
    const seen: unknown[] = [];

    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");
    const tint = filterOf(mock, entity, "fx.tint");

    vi.mocked(mock.ectx.deps.renderer.invalidate).mockImplementation(() => {
      seen.push(glow?.padding, (tint?.resources.fu as FakeUniformGroup).uniforms.amount);
    });
    mock.world.ecs.set(entity, Glow, { distance: 12 });
    mock.world.ecs.set(entity, Tint, { amount: 0.8 });
    mock.frame();

    expect(seen).toEqual([4, 0.1]);
    expect(glow?.padding).toBe(12);
  });

  it("an off kind's value change asks for no frame and is still written; without the agent flag it asks", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const entity = view(mock, [Glow({ strength: 0.6 })]);

    mock.frame();
    mock.api.diagnostics.disable("effects.glow");
    mock.frame();
    mock.world.ecs.set(entity, Glow, { strength: 0.2 });
    mock.frame();

    const glow = filterOf(mock, entity, "effects.glow");

    expect(mock.ectx.deps.renderer.invalidate).not.toHaveBeenCalled();
    expect((glow?.resources.fu as FakeUniformGroup).uniforms.strength).toBe(0.2);

    const sets = mock.renderer.sets.length;

    mock.api.diagnostics.enable("effects.glow");
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(sets + 1);
    expect(lastFilters(mock)).toEqual([glow]);

    vi.unstubAllGlobals();

    const release = started();
    const other = view(release, [Glow({ strength: 0.6 })]);

    release.frame();
    release.api.diagnostics.disable("effects.glow");
    release.world.ecs.set(other, Glow, { strength: 0.2 });
    release.frame();

    expect(release.ectx.deps.renderer.invalidate).toHaveBeenCalledTimes(1);
  });
});

/**
 * A started mock with the fixture filters of the inputs: `Soft` and `Hazy`, whose stage `Bad` compiles on no device.
 *
 * @returns The started mock, on WebGPU with its device.
 */
function inputsMock(): MockEffects {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  mock.gpu.answer = code =>
    code === Bad.filter.source ? [{ type: "error", lineNum: 12, linePos: 1, message: "bad" }] : [];
  mock.features.push({ name: "fixture", description: { filters: [Soft, Hazy] } });
  mock.start();

  return mock;
}

/**
 * A started mock with the fixture filter `Soft`; every check answers ok at the first frame.
 *
 * @param resolution - The renderer's resolution.
 * @returns The started mock.
 */
function softMock(resolution = 1): MockEffects {
  const mock = createMockEffects();

  mock.renderer.resolution = resolution;
  mock.features.push({ name: "fixture", description: { filters: [Soft] } });
  mock.start();

  return mock;
}

/** Lets the compilation info resolve. */
async function answered(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("the filter sync — inputs, broken kinds and pending checks", () => {
  it("draws a broken kind's checked fallback with the kind's value", async () => {
    const mock = inputsMock();
    const entity = view(mock, [Hazy({ spread: 0.5 })]);

    mock.frame();
    await answered();
    mock.frame();

    const [slot] = mock.renderer.sets.at(-1)?.slots ?? [];
    const standIn = mock.state.views.get(entity)?.instances.get("fixture.hazy");

    expect(standIn?.kind === "wgsl" ? standIn.definition : undefined).toBe(SoftDim.filter);
    expect(slot?.filter).toBe(standIn?.filter);
    expect(slot?.kind).toBe("fixture.hazy");
    expect(slot?.passes).toBe(1);

    const invalidate = vi.mocked(mock.ectx.deps.renderer.invalidate);

    invalidate.mockClear();
    mock.world.ecs.set(entity, Hazy, { spread: 0.75 });
    mock.frame();

    expect((standIn?.filter.resources.fu as FakeUniformGroup).uniforms.spread).toBe(0.75);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(entity);
  });

  it("waits for a broken kind's fallback to answer, and never draws an unchecked shader", async () => {
    const held = Promise.withResolvers<void>();
    const mock = inputsMock();

    mock.gpu.waits.set(SoftDim.filter.source, held.promise);

    const entity = view(mock, [Hazy()]);

    mock.frame();
    await answered();
    mock.frame();

    expect(mock.state.broken.has("fixture.hazy")).toBe(true);
    expect(mock.renderer.sets).toHaveLength(0);
    expect(mock.state.views.get(entity)?.instances.size).toBe(0);

    held.resolve();
    await answered();
    mock.frame();

    expect(mock.renderer.sets).toHaveLength(1);
  });

  it("logs effects:check-pending once per kind for a view left unfiltered while its check is pending", () => {
    const mock = inputsMock();

    view(mock, [Soft()]);
    view(mock, [Soft()]);
    mock.frame();
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith("effects:check-pending", {
      filter: "fixture.soft"
    });
    expect(mock.renderer.sets).toHaveLength(0);
  });

  it("hands a slot of a filter with inputs that counts the main body and every step, with its seam", () => {
    const mock = softMock(2);
    const entity = view(mock, [Soft()]);

    mock.frame();

    const [slot] = mock.renderer.sets.at(-1)?.slots ?? [];
    const instance = mock.state.views.get(entity)?.instances.get("fixture.soft");

    // The main body and three steps: the first stage and a Gaussian along x and along y.
    expect(slot?.passes).toBe(4);
    expect(slot?.inputs).toBe(instance?.kind === "wgsl" ? instance.inputs?.slot : "none");
    expect(slot?.inputs?.count).toBe(1);
    expect(slot?.inputs?.stages).toHaveLength(3);
  });

  it("hands a new slot list when a place is rebuilt, naming the new stage filter", () => {
    const mock = softMock();
    const entity = view(mock, [Soft()]);

    mock.frame();

    const first = mock.renderer.sets.at(-1)?.slots[0]?.inputs;

    mock.world.ecs.set(entity, Soft, { spread: 3 });
    mock.frame();

    const instance = mock.state.views.get(entity)?.instances.get("fixture.soft");
    const place = instance?.kind === "wgsl" ? instance.inputs?.places[0]?.[0] : undefined;
    const next = mock.renderer.sets.at(-1)?.slots[0]?.inputs;

    expect(mock.renderer.sets).toHaveLength(2);
    expect(place?.definition).toBe(Smaller.filter);
    expect(next).not.toBe(first);
    expect(next?.stages[0]).toBe(place?.body.filter);
  });

  it("evaluates no chain of a kind switched off by the diagnostics, and catches up when it is on", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = softMock();
    const entity = view(mock, [Soft()]);

    mock.frame();

    const instance = mock.state.views.get(entity)?.instances.get("fixture.soft");
    const version = (): number | undefined =>
      instance?.kind === "wgsl" ? instance.inputs?.version : undefined;

    mock.api.diagnostics.disable("fixture.soft");
    mock.world.ecs.set(entity, Soft, { spread: 3 });
    mock.frame();

    expect(version()).toBe(1);

    mock.api.diagnostics.enable("fixture.soft");
    mock.frame();

    expect(version()).toBe(2);
  });
});

describe("the filter sync — what the kept-picture cache may do with a slot (spec 23 P8.5)", () => {
  /** A body that asks for its canvas position. */
  const Lamp = defineFilter("fx.lamp", {
    wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let at = canvasPixel(uv); return textureSample(uTexture, uSampler, uv) * fu.amount + vec4<f32>(at * 0.0, 0.0, 0.0); }",
    glsl: "void main() { vec2 at = canvasPixel(vTextureCoord); finalColor = texture(uTexture, vTextureCoord) * amount + vec4(at * 0.0, 0.0, 0.0); }",
    uniforms: { amount: 1 }
  });

  it("slots carry their category: noise and displacement are screen; blur, colorMatrix, alpha, glow and outline are local", () => {
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { filters: [Tint] } });
    mock.start();
    mock.textures.set("fx.ripple", atlasTexture({ width: 8, height: 8, destroyed: false }));

    const views = [
      view(mock, [Noise()]),
      view(mock, [Displacement({ map: "fx.ripple" })]),
      view(mock, [Blur()]),
      view(mock, [ColorMatrix({ saturation: 0.5 })]),
      view(mock, [Alpha({ alpha: 0.5 })]),
      view(mock, [Glow()]),
      view(mock, [Outline()]),
      view(mock, [Tint()])
    ];

    mock.frame();

    const cacheOf = (entity: Entity) =>
      mock.renderer.sets.findLast(set => set.entity === entity)?.slots[0]?.cache;

    expect(views.map(entity => cacheOf(entity))).toEqual([
      "screen",
      "screen",
      "local",
      "local",
      "local",
      "local",
      "local",
      "local"
    ]);
  });

  it("a placed filter's slot hands over its keptOrigin array by reference; another slot has no origin", () => {
    const mock = createMockEffects();

    mock.features.push({ name: "ward", description: { filters: [Lamp, Tint] } });
    mock.start();

    const lamp = view(mock, [Lamp()]);
    const tint = view(mock, [Tint()]);

    mock.frame();

    const slotOf = (entity: Entity) =>
      mock.renderer.sets.findLast(set => set.entity === entity)?.slots[0];
    const group = mock.state.views.get(lamp)?.instances.get("fx.lamp")?.filter.resources.fu as
      | FakeUniformGroup
      | undefined;

    expect(slotOf(lamp)?.cache).toBe("placed");
    expect(slotOf(lamp)?.origin).toBeInstanceOf(Float32Array);
    expect(slotOf(lamp)?.origin).toBe(group?.uniforms.keptOrigin);
    expect([...(slotOf(lamp)?.origin ?? [])]).toEqual([0, 0]);
    expect(slotOf(tint)?.origin).toBeUndefined();
    expect("origin" in (slotOf(tint) ?? {})).toBe(false);
  });

  it("binds a uniform group for a placed filter with no uniform of its own, so its origin can be written", () => {
    const Spot = defineFilter("fx.spot", {
      wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let at = canvasPixel(uv); return textureSample(uTexture, uSampler, uv) + vec4<f32>(at * 0.0, 0.0, 0.0); }",
      glsl: "void main() { vec2 at = canvasPixel(vTextureCoord); finalColor = texture(uTexture, vTextureCoord) + vec4(at * 0.0, 0.0, 0.0); }"
    });
    const mock = createMockEffects();

    mock.features.push({ name: "ward", description: { filters: [Spot] } });
    mock.start();

    const spot = view(mock, [Spot()]);

    mock.frame();

    const slot = mock.renderer.sets.findLast(set => set.entity === spot)?.slots[0];
    const group = mock.state.views.get(spot)?.instances.get("fx.spot")?.filter.resources.fu as
      | FakeUniformGroup
      | undefined;

    expect(slot?.origin).toBeInstanceOf(Float32Array);
    expect(slot?.origin).toBe(group?.uniforms.keptOrigin);
  });

  it("marks a slot that shows a blurred copy: a Blur and a filter with inputs, no other", () => {
    const mock = softMock();
    const soft = view(mock, [Soft()]);
    const blur = view(mock, [Blur()]);
    const glow = view(mock, [Glow()]);

    mock.frame();

    const blursOf = (entity: Entity) =>
      mock.renderer.sets.findLast(set => set.entity === entity)?.slots[0]?.blurs;

    expect([blursOf(soft), blursOf(blur), blursOf(glow)]).toEqual([true, true, undefined]);
  });
});
