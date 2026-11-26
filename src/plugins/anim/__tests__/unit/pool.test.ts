import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { component } from "../../../world/ecs/define";
import { advanceTracks, beginFrame, startTrack } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: the kept records of the track table (change 2026-11-26-f244-peek-pool, slice 1). A track the frame step
// dropped gives its record to the next start of as many slots; a handle of the old start never reaches the new one.
// A field a newer track took is dead by its slot: the older track never writes it back.
// ---------------------------------------------------------------------------

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/** A rest move of 0 ms, as `ui` asks for one. */
const NOW = { ms: 0, ease: "out" } as const;

/** A long straight track, so nothing ends by time. */
const LONG = { ms: 100_000, ease: "linear" } as const;

/** Three numbers, so a newer track can take one field of an older one. */
const Pos = component("PoolPos", { a: 0, b: 0, c: 0 });

describe("anim track records — kept for the next start", () => {
  it("gives the record of a dropped track to the next start of as many slots", () => {
    // Bug caught: a pool that never takes back a record, or hands out one still in the dense list.
    const mock = createMockAnim();
    const first = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const second = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const older = startTrack(mock.actx, first, Transform, { x: 10, y: 20 }, NOW, open);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    const newer = startTrack(mock.actx, second, Transform, { x: 30, y: 40 }, NOW, open);

    expect(newer).toBe(older);
    expect(newer.entity).toBe(second);
    expect(newer.slotKeys).toEqual([`${second}:Transform:x`, `${second}:Transform:y`]);
    expect(mock.world.ecs.get(second, Transform)).toMatchObject({ x: 30, y: 40 });
    expect(mock.world.ecs.get(first, Transform)).toMatchObject({ x: 10, y: 20 });
  });

  it("keeps a handle of a released record from finishing, cancelling or reporting the new owner", () => {
    // Bug caught: a hook that kept its handle drives the track of the next element the record was written for.
    const mock = createMockAnim();
    const driver = createDriver(mock.actx);
    const first = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const second = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const kept = driver.track(first, Transform, { x: 10, y: 20 }, NOW, open);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    const owner = driver.track(second, Transform, { x: 500, y: 600 }, LONG, open);

    expect(owner).not.toBe(kept);
    expect(kept.active()).toBe(false);
    expect(owner.active()).toBe(true);

    kept.finish();
    kept.cancel();

    expect(owner.active()).toBe(true);
    expect(mock.world.ecs.get(second, Transform)).toMatchObject({ x: 0, y: 0 });
    expect(mock.api.active()).toBe(1);
  });
});

describe("anim dropField — a field a newer track took", () => {
  it("is never written back by the older track, frame by frame, on finish and on its last frame", () => {
    // Bug caught: the older track writes its whole patch, which still names the lost field, and puts it back.
    const mock = createMockAnim();
    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Pos({ a: 0, b: 0, c: 0 })]);
    const older = driver.track(entity, Pos, { a: 100, b: 100, c: 100 }, { ms: 100 }, open);
    const step = (deltaMs: number): void => {
      beginFrame(mock.actx);
      advanceTracks(mock.actx, deltaMs);
    };

    step(16);
    driver.track(entity, Pos, { a: -5 }, LONG, open);
    step(16);
    step(16);

    const a = mock.world.ecs.get(entity, Pos)?.a;

    expect(typeof a).toBe("number");

    // The exact last frame of the older track, then a finish of it: `a` stays the newer track's.
    step(100);
    expect(mock.world.ecs.get(entity, Pos)).toMatchObject({ b: 100, c: 100 });
    expect(mock.world.ecs.get(entity, Pos)?.a).not.toBe(100);
    older.finish();
    expect(mock.world.ecs.get(entity, Pos)?.a).not.toBe(100);
    expect(typeof mock.world.ecs.get(entity, Pos)?.a).toBe("number");
  });

  it("ends a track that lost every field, and its record starts the next track whole", () => {
    // Bug caught: a record that lost its fields starts the next track with dead slots and writes nothing.
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Pos({ a: 1, b: 2, c: 3 })]);
    const other = spawnTestEntity(mock, [Pos({ a: 0, b: 0, c: 0 })]);
    const older = startTrack(mock.actx, entity, Pos, { a: 9, b: 9, c: 9 }, LONG, open);

    startTrack(mock.actx, entity, Pos, { a: 4, b: 5, c: 6 }, LONG, open);
    expect(older.ended).toBe(true);
    expect(older.kept).toBe(0);

    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);

    const reused = startTrack(mock.actx, other, Pos, { a: 7, b: 0, c: 9 }, NOW, open);

    expect(reused).toBe(older);
    expect([...reused.live]).toEqual([1, 1, 1]);
    expect(reused.kept).toBe(3);
    expect(mock.world.ecs.get(other, Pos)).toEqual({ a: 7, b: 0, c: 9 });
  });
});

describe("anim bookkeeping of fields let go", () => {
  it("drops the entries of fields whose entities left once 512 are kept", () => {
    // Bug caught: the base and owner entries of every element ever moved stay for the life of the app.
    const mock = createMockAnim();

    for (let index = 0; index < 600; index++) {
      const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

      startTrack(mock.actx, entity, Transform, { x: index }, NOW, open);
      beginFrame(mock.actx);
      advanceTracks(mock.actx, 16);
    }

    expect(mock.state.bases.size).toBeLessThan(512);
    expect(mock.state.owner.size).toBeLessThan(512);
  });

  it("reads the new base of a field let go and taken again, not the one it had", () => {
    // Bug caught: a kept, absent base read as the field's start: the track jumps back to where it last stood.
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);

    startTrack(mock.actx, entity, Transform, { x: 50 }, NOW, open);
    beginFrame(mock.actx);
    advanceTracks(mock.actx, 16);
    mock.world.ecs.set(entity, Transform, { x: 200 });
    startTrack(mock.actx, entity, Transform, { x: 300 }, { ms: 100, ease: "linear" }, open);
    beginFrame(mock.actx);
    advanceTracks(mock.actx, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBeCloseTo(250);
  });
});
