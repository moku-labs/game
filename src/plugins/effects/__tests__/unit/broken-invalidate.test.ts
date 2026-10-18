import { describe, expect, it, vi } from "vitest";
import { FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { Sprite, Transform } from "../../../renderer/components";
import type { PixiFilter, PixiTexture } from "../../../renderer/types";
import type { Entity } from "../../../world/types";
import { writeFilter } from "../../filters/instance";
import type { FilterInstance } from "../../filters/types";
import { SoftDim } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: a broken filter switched off is a change the renderer cannot see,
// so it is told first (`renderer.invalidate`): under `onDemand` the view gets
// its frame and its render passes are counted again
// ---------------------------------------------------------------------------

/** A Pixi filter system as an apply sees it. */
type Manager = Parameters<PixiFilter["apply"]>[0];

/** The view's input and output. */
const INPUT = new FakeTexture({
  source: { width: 390, height: 844, destroyed: false, resolution: 1 },
  frame: new FakeRectangle(0, 0, 390, 844)
}) as unknown as PixiTexture;

/**
 * A filter system whose first draw throws, as a device that refuses the program.
 *
 * @returns The manager.
 */
function refusing(): Manager {
  let draws = 0;

  return {
    applyFilter: (): void => {
      draws += 1;
      if (draws === 1) throw new Error("the device said no");
    }
  } as unknown as Manager;
}

/**
 * A started mock with one view of `SoftDim`, a filter with no fallback, drawn once.
 *
 * @returns The mock, the entity and its instance.
 */
function started(): { mock: MockEffects; entity: Entity; instance: FilterInstance } {
  const mock = createMockEffects();

  mock.features.push({ name: "fixture", description: { filters: [SoftDim] } });
  mock.start();

  const entity = mock.spawn([Sprite({ texture: "board.cell" }), Transform(), SoftDim()]);

  mock.renderer.displays.add(entity);
  mock.frame();

  const instance = mock.state.views.get(entity)?.instances.get(SoftDim.componentName);

  if (instance === undefined) throw new Error("no instance");

  return { mock, entity, instance };
}

describe("a broken filter switched off tells the renderer first", () => {
  it("a break inside a render, with no stand-in, invalidates its view before the filter goes off", () => {
    // Bug: the filter was switched off silently; under onDemand the view kept its filtered picture.
    const { mock, entity, instance } = started();
    const enabledAtCall: boolean[] = [];

    vi.mocked(mock.ectx.deps.renderer.invalidate).mockImplementation(() => {
      enabledAtCall.push(instance.filter.enabled);
    });

    instance.filter.apply(refusing(), INPUT, INPUT, false);

    expect(mock.ectx.deps.renderer.invalidate).toHaveBeenCalledExactlyOnceWith(entity);
    expect(enabledAtCall).toEqual([true]);
    expect(instance.filter.enabled).toBe(false);
  });

  it("the sync switching a broken filter off asks once, and not again while it stays off", () => {
    // Bug: the write of a broken instance switched it off without the `before` every visible write makes.
    const { mock, instance } = started();
    const before = vi.fn();

    instance.broken = true;
    writeFilter(mock.ectx, instance, instance.value, false, before);
    writeFilter(mock.ectx, instance, instance.value, false, before);

    expect(before).toHaveBeenCalledOnce();
    expect(instance.filter.enabled).toBe(false);
  });
});
