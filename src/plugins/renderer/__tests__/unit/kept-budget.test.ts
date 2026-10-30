import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import { createRendererState } from "../../state";
import type { Config } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// The budget of the kept pictures (spec 23 P6): `renderer.keptMb`, least
// recently drawn first out, never a picture drawn in this frame, one warning
// for a refusal, every texture destroyed and unregistered when its record goes.
// ---------------------------------------------------------------------------

/** The bytes of one kept 40 x 40 shape without padding at resolution 1: its picture and its output. */
const PICTURE_BYTES = 2 * 40 * 40 * 4;

/** One MiB. */
const MIB = 1024 * 1024;

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

/**
 * Starts the renderer with a budget of so many pictures, every frame drawn.
 *
 * @param pictures - How many 40 x 40 pictures fit, a half more than that.
 * @returns The running renderer.
 */
async function withRoomFor(pictures: number): Promise<Drawn> {
  const drawn = await startDrawn({
    onDemand: false,
    config: { keptMb: ((pictures + 0.5) * PICTURE_BYTES) / MIB }
  });

  running.push(drawn);

  return drawn;
}

/**
 * Spawns a 40 x 40 shape with a kept filter and runs the three frames of its take.
 *
 * @param drawn - The running renderer.
 * @param x - Its x.
 * @returns The entity.
 */
function keep(drawn: Drawn, x: number): Entity {
  const entity = drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [
    { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
  ]);
  drawn.frames(3);

  return entity;
}

/**
 * Whether an entity is drawn from its picture now.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns True when kept.
 */
function isKept(drawn: Drawn, entity: Entity): boolean {
  return drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode === "kept";
}

describe("the budget of the kept pictures", () => {
  it("a take that does not fit evicts the least recently drawn picture first, never one drawn this frame", async () => {
    const drawn = await withRoomFor(2);
    const faded = keep(drawn, 100);
    const shown = keep(drawn, 200);

    expect([isKept(drawn, faded), isKept(drawn, shown)]).toEqual([true, true]);

    // Transparent: drawn live from now on, its textures still held, its picture drawn last two frames ago.
    drawn.mock.world.ecs.set(faded, Shape, { alpha: 0 });
    drawn.frames(2);

    const third = keep(drawn, 300);
    const kept = drawn.mock.ctx.state.kept;

    expect(isKept(drawn, third)).toBe(true);
    expect(isKept(drawn, shown)).toBe(true);
    expect(kept.byEntity.get(faded)?.bytes).toBe(0);
    expect(kept.byEntity.get(faded)?.s1).toBeUndefined();
    expect(kept.bytes).toBe(2 * PICTURE_BYTES);
  });

  it("a take that cannot fit is refused once with renderer:kept-budget and not offered again until it fits", async () => {
    const drawn = await withRoomFor(1);
    const first = keep(drawn, 100);
    const second = keep(drawn, 200);
    const warn = vi.mocked(drawn.mock.log.warn);
    const refused = () => warn.mock.calls.filter(([event]) => event === "renderer:kept-budget");

    drawn.frames(5);

    expect(isKept(drawn, first)).toBe(true);
    expect(isKept(drawn, second)).toBe(false);
    expect(refused()).toHaveLength(1);
    expect(refused()[0]?.[1]).toEqual({
      mb: Number((PICTURE_BYTES / MIB).toFixed(2)),
      keptMb: (1.5 * PICTURE_BYTES) / MIB,
      refused: `Shape#${second}`
    });
    expect(
      drawn.stage.targets().filter(call => call.container.label === `Shape#${second}`)
    ).toEqual([]);

    drawn.mock.world.ecs.despawn(first);
    drawn.frames(3);

    expect(isKept(drawn, second)).toBe(true);
    expect(refused()).toHaveLength(1);
  });

  it("keptMb 0 keeps nothing, and the debug switch cannot turn it on", async () => {
    const drawn = await startDrawn({ onDemand: false, config: { keptMb: 0 } });

    running.push(drawn);

    const entity = keep(drawn, 100);

    drawn.mock.api.sync.debug.kept(true);
    drawn.frames(3);

    expect(isKept(drawn, entity)).toBe(false);
    expect(drawn.stage.targets()).toEqual([]);
    expect(drawn.mock.api.sync.debug.state().kept).toBe(false);
  });

  it("a keptMb that is negative or not a number throws at createApp", () => {
    const base = createMockRenderer({ dom: false }).ctx.config;

    for (const keptMb of [-1, Number.NaN, Number.POSITIVE_INFINITY, "64" as unknown as number]) {
      const config: Config = { ...base, keptMb };

      expect(() => createRendererState({ config })).toThrow(
        `[game] renderer.keptMb is ${String(keptMb)}.\n  Give the MiB kept pictures may hold, or 0 to keep none.`
      );
    }
  });

  // Bug F119: a board that leaves and comes back made and destroyed every render target of its pictures again.
  it("a record's textures wait in the pool when its view goes, counted in the budget, and the next take of their size takes them", async () => {
    const drawn = await withRoomFor(2);
    const gone = keep(drawn, 100);
    const record = drawn.mock.ctx.state.kept.byEntity.get(gone);
    const textures = [record?.s1, record?.s3].filter(texture => texture !== undefined);
    const kept = drawn.mock.ctx.state.kept;

    drawn.mock.world.ecs.despawn(gone);
    drawn.frame();

    expect(textures.map(texture => texture.destroyed)).toEqual([false, false]);
    expect(kept.pool).toHaveLength(2);
    expect(kept.bytes).toBe(kept.poolBytes);
    expect(kept.bytes).toBeGreaterThan(0);

    const back = keep(drawn, 200);
    const again = kept.byEntity.get(back);

    expect(isKept(drawn, back)).toBe(true);
    expect(textures).toContain(again?.s1);
    expect(textures).toContain(again?.s3);
    expect(kept.pool).toHaveLength(0);
    expect(kept.poolBytes).toBe(0);
    expect(again?.s1?.source.label).toBe(`kept:Shape#${back}#1`);
  });

  // Bug: the pool held its textures past the budget, or past a reset (device loss, stop).
  it("the pool's textures are destroyed and unregistered from host.keep when a take needs their room, and at a reset", async () => {
    const drawn = await withRoomFor(1);
    const gone = keep(drawn, 100);
    const record = drawn.mock.ctx.state.kept.byEntity.get(gone);
    const textures = [record?.s1, record?.s3].filter(texture => texture !== undefined);
    const host = drawn.mock.ctx.state.host;
    const kept = drawn.mock.ctx.state.kept;

    drawn.mock.world.ecs.despawn(gone);
    drawn.frame();

    const larger = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 41, h: 40 }));

    drawn.mock.api.sync.filters.set(larger, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frames(3);

    expect(isKept(drawn, larger)).toBe(true);
    expect(textures.map(texture => texture.destroyed)).toEqual([true, true]);
    expect(textures.map(texture => host.kept.has(texture.source))).toEqual([false, false]);

    const left = [kept.byEntity.get(larger)?.s1, kept.byEntity.get(larger)?.s3];

    drawn.mock.world.ecs.despawn(larger);
    drawn.frame();
    drawn.mock.modules.kept.reset();

    expect(left.map(texture => texture?.destroyed)).toEqual([true, true]);
    expect(kept.pool).toHaveLength(0);
    expect([kept.bytes, kept.poolBytes]).toEqual([0, 0]);
  });
});

describe("the budget of a kept picture with a filter area (F43)", () => {
  // Bug (A Memory Missing, splash lens): a full-screen picture whose filter draws only a disc was sized and
  // budgeted at its whole box (25.5 MB refused instead of ~0.6 MB).
  it("sizes the picture of a view with an area at that area, not at its box", async () => {
    const drawn = await withRoomFor(2);
    const entity = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 400, h: 400 }));

    drawn.mock.api.sync.filters.set(entity, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.mock.api.sync.filters.area(entity, [100, 100, 40, 40]);
    drawn.frames(3);

    expect(isKept(drawn, entity)).toBe(true);
    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.bytes).toBe(PICTURE_BYTES);
  });

  // The other side: with no area the picture still takes the whole box.
  it("sizes the picture of a view without an area at its box", async () => {
    const drawn = await startDrawn({ onDemand: false });

    running.push(drawn);

    const entity = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 400, h: 400 }));

    drawn.mock.api.sync.filters.set(entity, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frames(3);

    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.bytes).toBe(2 * 400 * 400 * 4);
  });
});
