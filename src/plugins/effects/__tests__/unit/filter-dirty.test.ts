import { afterEach, describe, expect, it, vi } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import type { AnyComponentValue, ComponentHandle, Entity } from "../../../world/types";
import { Blur, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the filter sync brings up to date only the views something happened to
// (change 2026-10-18-cheap-idle-tick, E1), and judges the full-screen budget again
// only when a view, a box, a scale or the viewport moved
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

const Tint = defineFilter("fx.tint", {
  wgsl: `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}`,
  glsl: `
void main() {
  finalColor = texture(uTexture, vTextureCoord) * amount;
}`,
  uniforms: { amount: 0 }
});

/**
 * A started mock with the feature filter `fx.tint`.
 *
 * @returns The started mock.
 */
function started(): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "board", description: { filters: [Tint] } });
  mock.start();

  return mock;
}

/**
 * Spawns a sprite view with a drawn display object and the given components.
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
 * The entities whose filter component the sync read through `world.ecs.get` while `run` ran.
 *
 * @param mock - The mock.
 * @param run - What to run.
 * @returns The entities, one per read of a filter component.
 */
function filterReads(mock: MockEffects, run: () => void): Entity[] {
  const filters = new Set<ComponentHandle<object>>(
    mock.state.kindList.map(kind => kind.component as ComponentHandle<object>)
  );
  const get = vi.spyOn(mock.world.ecs, "get");

  run();

  const reads = get.mock.calls
    .filter(([, component]) => filters.has(component as ComponentHandle<object>))
    .map(([entity]) => entity);

  get.mockRestore();

  return reads;
}

describe("the filter sync — only the views something happened to", () => {
  it("syncs no view and reads no component on a frame where nothing changed", () => {
    // Bug: every view brought up to date every frame, and the full-screen budget walked every view.
    const mock = started();

    view(mock, [Glow()]);
    view(mock, [Tint()]);
    view(mock, [Blur()]);
    mock.frame();
    vi.mocked(mock.ectx.deps.renderer.invalidate).mockClear();

    const get = vi.spyOn(mock.world.ecs, "get");

    mock.frame();
    mock.frame();

    expect(get).not.toHaveBeenCalled();
    expect(mock.ectx.deps.renderer.invalidate).not.toHaveBeenCalled();
  });

  it("reads the filter component of the changed view only", () => {
    const mock = started();
    const changed = view(mock, [Tint()]);

    view(mock, [Tint()]);
    view(mock, [Glow()]);
    mock.frame();

    const reads = filterReads(mock, () => {
      mock.world.ecs.set(changed, Tint, { amount: 0.4 });
      mock.frame();
    });

    expect(reads).toEqual([changed]);
  });

  it("lets go of a despawned view in the list it walks", () => {
    // Bug: a forgotten view stayed in the dense list for good.
    const mock = started();
    const gone = view(mock, [Glow()]);
    const kept = view(mock, [Glow()]);

    mock.frame();
    mock.world.ecs.despawn(gone);
    mock.frame();

    expect(mock.state.viewList.map(record => record.entity)).toEqual([kept]);
  });
});

/**
 * A sprite view of 540 × 960 with an enabled blur: half the reference size on each side.
 *
 * @param mock - The mock.
 * @returns The entity.
 */
function halfScreen(mock: MockEffects): Entity {
  return mock.spawn([
    Sprite({ texture: "board.bg", width: 540, height: 960 }),
    Transform(),
    Blur()
  ]);
}

describe("the filter sync — the full-screen budget, judged when it can change", () => {
  it("counts views again when their scale grows to cover the screen, with no filter changed", () => {
    // Bug: the budget judged only on a filter change missed views scaled up to the whole screen.
    const mock = started();
    const first = halfScreen(mock);
    const second = halfScreen(mock);

    mock.frame();
    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.world.ecs.set(first, Transform, { scale: 2 });
    mock.world.ecs.set(second, Transform, { scale: 2 });
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith("effects:full-screen-filters", {
      count: 2
    });
  });

  it("counts views again when the viewport shrinks under them, with nothing changed in the world", () => {
    // Bug: the budget judged only on a world change missed a resize.
    const mock = started();

    halfScreen(mock);
    halfScreen(mock);
    mock.frame();
    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.renderer.viewport = { width: 540, height: 960 };
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith("effects:full-screen-filters", {
      count: 2
    });
  });
});
