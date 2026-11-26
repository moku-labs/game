import { describe, expect, it } from "vitest";
import { TrackTable } from "../../tween/table";
import type { Track } from "../../tween/types";

/**
 * A track record as the table reads it: its id and whether it ended.
 *
 * @param id - The id of the start.
 * @param ended - Whether it ended.
 * @returns The record.
 */
function trackOf(id: number, ended = false): Track {
  // The table reads only these two fields of a record.
  return { id, ended } as unknown as Track;
}

describe("anim/tween — the table of the running tracks", () => {
  // Bug caught: an ended track still answered by id, so a newer track drops a field of a track that is gone.
  it("answers a running track by id and none once it ended", () => {
    const list = [trackOf(1), trackOf(2), trackOf(3)];
    const table = new TrackTable(list);

    for (let index = 0; index < list.length; index += 1) table.filed();

    expect(table.get(2)).toBe(list[1]);
    expect(table.has(3)).toBe(true);
    expect(table.size).toBe(3);

    (list[1] as { ended: boolean }).ended = true;
    table.ended();

    expect(table.get(2)).toBeUndefined();
    expect(table.has(2)).toBe(false);
    expect(table.size).toBe(2);
    expect([...table.keys()]).toEqual([1, 3]);
    expect([...table.values()]).toEqual([list[0], list[2]]);
  });

  // Bug caught: a start nested in another (a hook of the first one's start) pushed ahead of it, and missed by the search.
  it("finds a track the list holds out of id order", () => {
    const list = [trackOf(1), trackOf(5), trackOf(4), trackOf(6)];
    const table = new TrackTable(list);

    expect(table.get(4)).toBe(list[2]);
    expect(table.get(5)).toBe(list[1]);
    expect(table.get(7)).toBeUndefined();
  });
});
