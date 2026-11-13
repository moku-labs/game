import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, type SpriteBlend, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of the blend of a filter's output (F178): the slot's `blend` goes on the Pixi filter that is the last
// enabled one of its view, `"normal"` on every other, each written only when it differs. Pixi draws the last filter
// onto what is under the view; an earlier one draws into a cleared texture, where multiply turns the group black. A
// blended slot that is not the last enabled one draws normal and is warned once per kind.
// ---------------------------------------------------------------------------

const running: MockRenderer[] = [];

afterEach(() => {
  for (const mock of running.splice(0)) mock.stop();
});

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Starts a mock renderer with one layer, "items", and one sprite in it, built.
 *
 * @returns The started mock and the sprite.
 */
async function startedWithSprite(): Promise<{ mock: MockRenderer; entity: Entity }> {
  const mock = createMockRenderer();

  await mock.start();
  running.push(mock);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.cell" })
  ]);

  mock.modules.sync.pass();

  return { mock, entity };
}

/**
 * One slot of a fake filter.
 *
 * @param filter - The fake filter.
 * @param blend - The slot's blend; left out when `undefined`.
 * @param kind - The slot's kind; left out when `undefined`.
 * @returns The slot.
 */
function slot(filter: FakeFilter, blend?: SpriteBlend, kind?: string): FilterSlot {
  return {
    filter: filter as unknown as PixiFilter,
    passes: 1,
    ...(blend === undefined ? {} : { blend }),
    ...(kind === undefined ? {} : { kind })
  };
}

/**
 * Hands the filters of an entity to the renderer, as `effects` does.
 *
 * @param mock - The running renderer.
 * @param entity - The entity.
 * @param slots - The filters in draw order.
 */
function handOver(mock: MockRenderer, entity: Entity, slots: readonly FilterSlot[]): void {
  mock.api.sync.filters.set(entity, slots);
}

/**
 * The details of every `renderer:filter-blend-not-last` warning.
 *
 * @param mock - The running renderer.
 * @returns The details, in order.
 */
function notLast(mock: MockRenderer): unknown[] {
  return vi
    .mocked(mock.log.warn)
    .mock.calls.filter(([message]) => message === "renderer:filter-blend-not-last")
    .map(([, detail]) => detail);
}

describe("the blend of a filter's output", () => {
  // Bug: the blend lands on an intermediate pass, which draws into a cleared texture and turns the group black; or the
  // blend stays on a filter the new order moved off the end; or a slot handed again without its blend keeps it.
  it("goes on the last enabled filter alone and follows the order of every list handed over", async () => {
    const { mock, entity } = await startedWithSprite();
    const object = mock.api.sync.displayOf(entity) as { filters: unknown };
    const rough = new FakeFilter();
    const ink = new FakeFilter();

    handOver(mock, entity, [slot(rough), slot(ink, "multiply")]);

    expect([rough.blendMode, ink.blendMode]).toEqual(["normal", "multiply"]);
    // A filter that holds the blend it should is never written.
    expect(rough.blendWrites).toBe(0);

    handOver(mock, entity, [slot(ink, "multiply"), slot(rough)]);

    expect(object.filters).toEqual([ink, rough]);
    expect([ink.blendMode, rough.blendMode]).toEqual(["normal", "normal"]);

    handOver(mock, entity, [slot(rough), slot(ink, "multiply")]);

    expect([rough.blendMode, ink.blendMode]).toEqual(["normal", "multiply"]);
  });

  // Bug: the renderer resets the blend mode a game set on its own filter, whose slot names no blend.
  it("leaves the blend mode of a slot without `blend` as the game set it", async () => {
    const { mock, entity } = await startedWithSprite();
    const own = new FakeFilter();
    const ink = new FakeFilter();

    own.blendMode = "add";
    handOver(mock, entity, [slot(ink, "multiply"), slot(own)]);

    expect([ink.blendMode, own.blendMode]).toEqual(["normal", "add"]);
  });

  // Bug: a disabled filter's blend leaks onto the filter before it, or the frame's step that writes a switch leaves the
  // blends of the last write, so the filter that became last draws normal.
  it("follows a switch: the new last carries its own slot's blend, a switched-off filter is not written", async () => {
    const { mock, entity } = await startedWithSprite();
    const object = mock.api.sync.displayOf(entity) as { filters: unknown };
    const rough = new FakeFilter();
    const ink = new FakeFilter();

    handOver(mock, entity, [slot(rough), slot(ink, "multiply")]);
    ink.enabled = false;
    mock.modules.sync.stepFilters();

    expect(object.filters).toEqual([rough]);
    expect(rough.blendMode).toBe("normal");
    expect([ink.blendMode, ink.blendWrites]).toEqual(["multiply", 1]);

    // The blended filter first, the one after it switched off: the blended one is the last Pixi draws.
    const veil = new FakeFilter();
    const stamp = new FakeFilter();

    veil.enabled = false;
    handOver(mock, entity, [slot(stamp, "multiply"), slot(veil)]);

    expect(stamp.blendMode).toBe("multiply");

    veil.enabled = true;
    mock.modules.sync.stepFilters();

    expect(object.filters).toEqual([stamp, veil]);
    expect([stamp.blendMode, veil.blendMode]).toEqual(["normal", "normal"]);

    // A still frame writes nothing.
    const writes = stamp.blendWrites + veil.blendWrites;

    mock.modules.sync.stepFilters();

    expect(stamp.blendWrites + veil.blendWrites).toBe(writes);
  });

  // Bug: a blended filter put before another draws normal with no word, or the log repeats it at every write.
  it("warns a blended filter that is not the last once per kind, a slot without a kind as other", async () => {
    const { mock, entity } = await startedWithSprite();
    const ink = new FakeFilter();
    const rough = new FakeFilter();

    handOver(mock, entity, [slot(ink, "multiply", "effects.StampInk"), slot(rough)]);
    handOver(mock, entity, [slot(rough)]);
    handOver(mock, entity, [slot(ink, "multiply", "effects.StampInk"), slot(rough)]);

    expect(notLast(mock)).toEqual([{ filter: "effects.StampInk" }]);

    handOver(mock, entity, [slot(ink, "screen"), slot(rough)]);

    expect(notLast(mock)).toEqual([{ filter: "effects.StampInk" }, { filter: "other" }]);
  });
});
