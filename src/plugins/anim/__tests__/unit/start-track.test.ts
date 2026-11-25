import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { startTrack } from "../../tween/advance";
import { slotCellsOf } from "../../tween/slots";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: what starting a track builds (change 2026-11-24-f230-hot-path, A1) — the nine typed
// arrays over one buffer, and the count of fields a track keeps when a newer track takes some.
// ---------------------------------------------------------------------------

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/** A long straight track, so nothing ends by time. */
const LONG = { ms: 100_000, ease: "linear" } as const;

describe("anim startTrack — shared buffer", () => {
  it("cuts the nine typed arrays of a started track out of one buffer, each with its start value", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const track = startTrack(mock.actx, entity, Transform, { x: 30, y: 40 }, LONG, open);
    const arrays = [
      track.clock,
      track.targets,
      track.starts,
      track.live,
      track.moved,
      track.values,
      track.colors,
      track.seen,
      track.partialMoved
    ];

    expect(new Set(arrays.map(view => view.buffer)).size).toBe(1);
    // A view that overlapped its neighbour would show the other's numbers.
    expect([...track.targets]).toEqual([30, 40]);
    expect([...track.live]).toEqual([1, 1]);
    expect([...track.colors]).toEqual([0, 0]);
    expect([...track.starts]).toEqual([0, 0]);
    expect([...track.seen].every(value => Number.isNaN(value))).toBe(true);
    expect(track.clock).toHaveLength(2);
  });

  it("keeps the views apart: a write to one cell of each array reaches no other", () => {
    const cells = slotCellsOf(3);

    cells.clock.fill(1);
    cells.targets.fill(2);
    cells.starts.fill(3);
    cells.values.fill(4);
    cells.seen.fill(5);
    cells.live.fill(6);
    cells.moved.fill(7);
    cells.colors.fill(8);
    cells.partialMoved.fill(9);

    expect([...cells.clock]).toEqual([1, 1]);
    expect([...cells.targets]).toEqual([2, 2, 2]);
    expect([...cells.starts]).toEqual([3, 3, 3]);
    expect([...cells.values]).toEqual([4, 4, 4]);
    expect([...cells.seen]).toEqual([5, 5, 5]);
    expect([...cells.live]).toEqual([6, 6, 6]);
    expect([...cells.moved]).toEqual([7, 7, 7]);
    expect([...cells.colors]).toEqual([8, 8, 8]);
    expect([...cells.partialMoved]).toEqual([9, 9, 9]);
  });
});

describe("anim startTrack — claiming fields", () => {
  it("counts the fields a newer track took and ends the older one at its last", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const older = startTrack(mock.actx, entity, Transform, { x: 100, y: 100 }, LONG, open);

    expect(older.kept).toBe(2);

    const first = startTrack(mock.actx, entity, Transform, { x: 5 }, LONG, open);

    expect(older.kept).toBe(1);
    expect(older.ended).toBe(false);
    expect([...older.live]).toEqual([0, 1]);
    expect(older.patch).toEqual({ y: 100 });

    const second = startTrack(mock.actx, entity, Transform, { y: 6 }, LONG, open);

    expect(older.kept).toBe(0);
    expect(older.ended).toBe(true);
    expect(mock.state.tracks.has(older.id)).toBe(false);
    expect(first.ended).toBe(false);
    expect(second.ended).toBe(false);
  });

  it("ends the older track when one newer track takes both its fields", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const older = startTrack(mock.actx, entity, Transform, { x: 100, y: 100 }, LONG, open);
    const newer = startTrack(mock.actx, entity, Transform, { x: 1, y: 2 }, LONG, open);

    expect(older.kept).toBe(0);
    expect(older.ended).toBe(true);
    expect(newer.kept).toBe(2);
    expect([...mock.state.tracks.keys()]).toEqual([newer.id]);
    // The newer track owns both fields now, so the older one's end released none of them.
    expect(mock.state.owner.size).toBe(2);
  });
});
