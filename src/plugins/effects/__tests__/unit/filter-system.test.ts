import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeFilter, FakeUniformGroup } from "../../../renderer/__tests__/fake-pixi";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import type { AnyComponentValue, Entity } from "../../../world/types";
import { Blur, Displacement, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { atlasTexture, type FakeFxBlurFilter } from "../fake-effects-pixi";
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

const Tint = defineFilter("fx.tint", {
  wgsl: BODY,
  uniforms: { amount: 0, color: { color: 0xff_d7_00 } }
});

const Heavy = defineFilter("fx.heavy", { wgsl: BODY, passes: 3 });

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

describe("the filter sync — the dev WGSL check", () => {
  it("instantiates a kind only once its WGSL compiled clean", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = started();
    const entity = view(mock, [Tint()]);

    mock.frame();
    expect(filterOf(mock, entity, "fx.tint")).toBeUndefined();
    expect(mock.state.checks.get("fx.tint")).toBe("pending");

    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    mock.frame();

    expect(filterOf(mock, entity, "fx.tint")).toBeDefined();
  });

  it("never instantiates a broken kind, and the view renders as if it had none", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = started();

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
  it("warns once per crossing of the renderer's render passes", () => {
    const mock = started();

    view(mock, [Glow()]);
    mock.renderer.passes = 30;
    mock.frame();
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:pass-budget", { passes: 30, budget: 24 });

    mock.renderer.passes = 10;
    mock.frame();
    mock.renderer.passes = 25;
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
  });

  it("reads neither the renderer's passes nor a change set while no view carries a filter", () => {
    const mock = started();
    const changed = vi.spyOn(mock.world.ecs, "changed");
    const stats = vi.spyOn(mock.ectx.deps.renderer, "stats");

    mock.renderer.passes = 30;
    mock.frame();

    expect(changed).not.toHaveBeenCalled();
    expect(stats).not.toHaveBeenCalled();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("reads the renderer's passes once per frame while a view carries a filter", () => {
    const mock = started();
    const stats = vi.spyOn(mock.ectx.deps.renderer, "stats");

    view(mock, [Glow()]);
    mock.frame();
    mock.frame();

    expect(stats).toHaveBeenCalledTimes(2);
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
