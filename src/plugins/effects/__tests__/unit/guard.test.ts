import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeFilter,
  FakeRectangle,
  FakeTexture,
  type FakeTexturePool
} from "../../../renderer/__tests__/fake-pixi";
import { Sprite, Transform } from "../../../renderer/components";
import type { PixiFilter, PixiTexture } from "../../../renderer/types";
import type { Entity } from "../../../world/types";
import type { FilterInstance } from "../../filters/types";
import { FakeFxGpuProgram } from "../fake-effects-pixi";
import { Soft, SoftDim, Veiled } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the one broken state, as the guard draws it. A broken instance
// with a checked fallback draws the fallback in the very apply that broke, and
// the next sync puts that stand-in in its place; without one the view draws
// through. A dev build marks a broken view with magenta stripes, over its
// fallback when it has one; a production build never does.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Pixi filter system as an apply sees it. */
type Manager = Parameters<PixiFilter["apply"]>[0];

/** The view's input and output: 390 × 844 CSS px at two real pixels per CSS pixel. */
const INPUT = new FakeTexture({
  source: { width: 390, height: 844, destroyed: false, resolution: 2 },
  frame: new FakeRectangle(0, 0, 390, 844)
}) as unknown as PixiTexture;

/**
 * A filter system stand-in that throws for the draws `fails` picks and writes every draw down.
 *
 * @param fails - Which draw throws, by its count from 1.
 * @returns The manager and the filters it was asked to draw.
 */
function managerThat(fails: (count: number) => boolean): {
  manager: Manager;
  drawn: unknown[];
} {
  const drawn: unknown[] = [];
  const manager = {
    applyFilter: (filter: unknown) => {
      drawn.push(filter);
      if (fails(drawn.length)) throw new Error("the device said no");
    }
  } as unknown as Manager;

  return { manager, drawn };
}

/**
 * A started mock with one view of a filter, drawn once.
 *
 * @param component - The filter component of the view.
 * @returns The mock, the entity and its instance.
 */
function started(component: typeof Soft): {
  mock: MockEffects;
  entity: Entity;
  instance: FilterInstance;
} {
  const mock = createMockEffects();

  mock.renderer.resolution = 2;
  mock.features.push({ name: "fixture", description: { filters: [component] } });
  mock.start();

  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), component()]);

  mock.renderer.displays.add(entity);
  mock.frame();

  const instance = mock.state.views.get(entity)?.instances.get(component.componentName);

  if (instance === undefined) throw new Error("no instance");

  return { mock, entity, instance };
}

describe("the broken state — what a broken instance draws", () => {
  it("draws the fallback in the very apply that broke, and the next sync puts it in place without building another", () => {
    const { mock, entity, instance } = started(Veiled);
    const programs = FakeFxGpuProgram.made.length;
    const { manager, drawn } = managerThat(count => count === 1);

    expect(() => instance.filter.apply(manager, INPUT, INPUT, false)).not.toThrow();

    const standIn = instance.replacement;

    expect(standIn?.kind === "wgsl" ? standIn.definition : undefined).toBe(SoftDim.filter);
    expect(drawn).toHaveLength(2);
    expect(drawn[1]).toBe(standIn?.filter);
    expect(FakeFxGpuProgram.made).toHaveLength(programs + 1);
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:broken", {
      filter: "fixture.veiled",
      reason: "apply",
      message: "the device said no",
      fallback: "fixture.softDim"
    });

    mock.frame();

    expect(mock.renderer.sets.at(-1)?.slots.map(slot => slot.filter)).toEqual([standIn?.filter]);
    expect(mock.state.views.get(entity)?.instances.get("fixture.veiled")).toBe(standIn);
    expect(FakeFxGpuProgram.made).toHaveLength(programs + 1);
    expect((instance.filter as unknown as FakeFilter).destroyed).toBe(true);
    expect((standIn?.filter as unknown as FakeFilter | undefined)?.destroyed).toBe(false);
  });

  it("writes the kind's value into its stand-in through the fallback's own uniforms", () => {
    const { mock, entity, instance } = started(Veiled);

    instance.filter.apply(managerThat(count => count === 1).manager, INPUT, INPUT, false);
    mock.frame();
    mock.world.ecs.set(entity, Veiled, { spread: 0.25 });
    mock.frame();

    const standIn = mock.state.views.get(entity)?.instances.get("fixture.veiled");
    const group = standIn?.filter.resources.fu as { uniforms: Record<string, number> } | undefined;

    expect(group?.uniforms.spread).toBe(0.25);
  });

  it("switches a stand-in that breaks off and draws through: no stand-in of a stand-in, no second line", () => {
    const { mock, entity, instance } = started(Veiled);

    instance.filter.apply(managerThat(count => count === 1).manager, INPUT, INPUT, false);
    mock.frame();

    const standIn = mock.state.views.get(entity)?.instances.get("fixture.veiled");
    const { manager, drawn } = managerThat(() => true);

    expect(() => standIn?.filter.apply(manager, INPUT, INPUT, false)).not.toThrow();

    expect(standIn?.broken).toBe(true);
    expect(standIn?.replacement).toBeUndefined();
    expect(standIn?.filter.enabled).toBe(false);
    expect(drawn).toEqual([standIn?.filter, standIn?.filter]);
    expect(mock.log.error).toHaveBeenCalledTimes(1);
  });
});

describe("the broken state — the dev mark", () => {
  it("marks a broken view over its fallback in a dev build: the fallback into a pooled texture, then the stripes", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { mock, instance } = started(Veiled);
    const pool = mock.pixi.module.TexturePool as unknown as FakeTexturePool;
    const { manager, drawn } = managerThat(count => count === 1);

    instance.filter.apply(manager, INPUT, INPUT, false);

    const standIn = instance.replacement;
    const mark = standIn?.kind === "wgsl" ? standIn.mark : undefined;
    const temp = pool.taken.at(-1);

    expect(mark?.definition.id).toBe("effects.broken-mark");
    expect(drawn.slice(1)).toEqual([standIn?.filter, mark?.filter]);
    expect(pool.returned.at(-1)).toBe(temp);
    expect(standIn?.passes).toBe(2);
  });

  it("marks a broken view with no fallback in a dev build, and draws it through in a production build", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const dev = started(Soft);
    const marked = managerThat(count => count === 1);

    dev.instance.filter.apply(marked.manager, INPUT, INPUT, false);

    const standIn = dev.instance.replacement;

    expect(standIn?.kind === "wgsl" ? standIn.definition.id : undefined).toBe(
      "effects.broken-mark"
    );
    expect(marked.drawn.slice(1)).toEqual([standIn?.filter]);

    vi.unstubAllGlobals();

    const production = started(Soft);
    const through = managerThat(count => count === 1);

    production.instance.filter.apply(through.manager, INPUT, INPUT, false);

    expect(production.instance.replacement).toBeUndefined();
    expect(through.drawn.slice(1)).toEqual([production.instance.filter]);
  });
});
