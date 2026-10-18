import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Alpha, Blur } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import type { FilterArea, FilterComponent, FilterValueOf } from "../../filters/types";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test of the filter area (spec 27 B4) in the filter sync: a view hands
// the renderer the union of its enabled filters' areas, none when an enabled
// filter declares none, only when it changed; an area is asked again only
// after a value changed, and a broken answer counts as none.
// ---------------------------------------------------------------------------

/** A body that copies its input, in both languages. */
const COPY = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord); }"
} as const;

/** The uniforms of the lens: a disc of `reach` around (`cx`, `cy`), and a tone the area does not read. */
const LENS_UNIFORMS = { cx: 100, cy: 100, reach: 10, tone: 0 };

/** The value of the lens. */
type LensValue = FilterValueOf<typeof LENS_UNIFORMS>;

/** The box around the lens's disc. */
const lensBox = (value: Readonly<LensValue>): FilterArea => [
  value.cx - value.reach,
  value.cy - value.reach,
  2 * value.reach,
  2 * value.reach
];

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A lens filter whose area is asked through a spy.
 *
 * @param area - The area function; the disc's box when left out.
 * @returns The component and the spy.
 */
function lensFilter(area: (value: Readonly<LensValue>) => FilterArea | undefined = lensBox): {
  Lens: FilterComponent<LensValue>;
  asked: ReturnType<typeof vi.fn>;
} {
  const asked = vi.fn(area);
  const Lens = defineFilter("fixture.lens", { ...COPY, uniforms: LENS_UNIFORMS, area: asked });

  return { Lens, asked };
}

/** A second filter with an area: a 5 × 5 box at (`x`, `y`). */
const Ring = defineFilter("fixture.ring", {
  ...COPY,
  uniforms: { x: 0, y: 0 },
  area: value => [value.x, value.y, 5, 5]
});

/**
 * A started mock with the fixture filters registered by one feature.
 *
 * @param filters - The filters of the feature.
 * @returns The mock.
 */
function started(filters: readonly FilterComponent<never>[]): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "fixture", description: { filters } });
  mock.start();

  return mock;
}

/**
 * The areas handed to the renderer for one entity, oldest first.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns The areas.
 */
function areasOf(mock: MockEffects, entity: Entity): Array<readonly number[] | undefined> {
  return mock.renderer.areas.filter(call => call.entity === entity).map(call => call.area);
}

describe("the area of a filtered view", () => {
  // Bug: the lens keeps filling the whole cover: no area reaches the renderer.
  it("a view with one area filter sends that area; a second area filter sends the union", () => {
    const { Lens } = lensFilter();
    const mock = started([Lens, Ring] as never);
    const view = mock.spawn([Lens({ cx: 100, cy: 100, reach: 10 })]);

    mock.frame();

    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20]]);

    mock.world.ecs.add(view, Ring({ x: 0, y: 0 }));
    mock.frame();

    expect(areasOf(mock, view)).toEqual([
      [90, 90, 20, 20],
      [0, 0, 110, 110]
    ]);
  });

  // Bug: a Blur over the lens is cut to the lens's box, and the rest of the view vanishes.
  it("an enabled filter without an area (a built-in) sends no area", () => {
    const { Lens } = lensFilter();
    const mock = started([Lens] as never);
    const view = mock.spawn([Lens(), Blur()]);

    mock.frame();
    mock.frame();

    expect(areasOf(mock, view)).toEqual([]);
  });

  // Bug: the fog's Alpha beside the lens cancels the lens's box, and the lens fills the whole cover again.
  it("an Alpha beside an area filter keeps that area; an Alpha alone sends none", () => {
    const { Lens } = lensFilter();
    const mock = started([Lens] as never);
    const lens = mock.spawn([Lens(), Alpha({ alpha: 0.5 })]);
    const alone = mock.spawn([Alpha({ alpha: 0.5 })]);

    mock.frame();

    expect(areasOf(mock, lens)).toEqual([[90, 90, 20, 20]]);
    expect(areasOf(mock, alone)).toEqual([]);
  });

  // Bug: a Blur that draws nothing still widens the area to the view's bounds; a kind measured off still counts.
  it("a disabled or switched-off filter does not count", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const { Lens } = lensFilter();
    const mock = started([Lens] as never);
    const view = mock.spawn([Lens(), Blur({ enabled: false })]);

    mock.frame();

    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20]]);

    mock.world.ecs.set(view, Blur, { enabled: true });
    mock.frame();

    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20], undefined]);

    mock.api.diagnostics.disable(Blur.componentName);
    mock.frame();

    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20], undefined, [90, 90, 20, 20]]);
  });

  // Bug: the area function runs in every frame of every view.
  it("the area is computed only when the value changed", () => {
    const { Lens, asked } = lensFilter();
    const mock = started([Lens] as never);
    const view = mock.spawn([Lens()]);

    for (let frame = 0; frame < 60; frame += 1) mock.frame();

    expect(asked).toHaveBeenCalledTimes(1);

    mock.world.ecs.set(view, Lens, { cx: 120 });
    mock.frame();
    mock.frame();

    expect(asked).toHaveBeenCalledTimes(2);
    expect(areasOf(mock, view)).toEqual([
      [90, 90, 20, 20],
      [110, 90, 20, 20]
    ]);
  });

  // Bug: a throwing area breaks the frame, or floods the log once per frame.
  it("an area function that throws or answers garbage is reported once and counts as no area", () => {
    const throwing = lensFilter(() => {
      throw new Error("no disc");
    });
    const garbage = lensFilter(() => [1, 2, -3, 4]);
    const mock = started([throwing.Lens] as never);
    const view = mock.spawn([throwing.Lens()]);

    mock.frame();
    mock.world.ecs.set(view, throwing.Lens, { cx: 50 });
    mock.frame();

    const other = started([garbage.Lens] as never);
    const second = other.spawn([garbage.Lens()]);

    other.frame();
    other.world.ecs.set(second, garbage.Lens, { cx: 50 });
    other.frame();

    expect(throwing.asked).toHaveBeenCalledTimes(2);
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "effects:area-failed",
      expect.objectContaining({ kind: "fixture.lens", error: expect.any(Error) })
    );
    expect(other.log.warn).toHaveBeenCalledTimes(1);
    expect(other.log.warn).toHaveBeenCalledWith("effects:bad-area", {
      kind: "fixture.lens",
      area: [1, 2, -3, 4]
    });
    expect(areasOf(mock, view)).toEqual([]);
    expect(areasOf(other, second)).toEqual([]);
  });

  // Bug: a value change the area does not read hands the renderer the same box again, which marks the view.
  it("nothing is sent when the union did not change", () => {
    const { Lens, asked } = lensFilter();
    const mock = started([Lens] as never);
    const view = mock.spawn([Lens()]);

    mock.frame();
    mock.world.ecs.set(view, Lens, { tone: 0.5 });
    mock.frame();

    expect(asked).toHaveBeenCalledTimes(2);
    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20]]);
  });

  // Bug: the lens is switched off, but its box still clips the cover.
  it("a filter that becomes enabled or disabled re-judges the union", () => {
    const { Lens } = lensFilter();
    const mock = started([Lens] as never);
    const view = mock.spawn([Lens()]);

    mock.frame();
    mock.world.ecs.set(view, Lens, { enabled: false });
    mock.frame();
    mock.world.ecs.set(view, Lens, { enabled: true });
    mock.frame();

    expect(areasOf(mock, view)).toEqual([[90, 90, 20, 20], undefined, [90, 90, 20, 20]]);
  });
});
