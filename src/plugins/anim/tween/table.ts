/**
 * @file anim/tween — the table of the running tracks by id, over the dense list the frame step walks. A `Map` of ids
 * would take a new entry under a new id at every start and drop it at every end, and its store grows and shrinks with
 * that churn: a page turn's 0 ms rest tracks made it allocate at every turn (F244 В). The list holds the tracks in
 * start order, so in id order, and an ended one until the frame step drops it: a lookup by id is a binary search of
 * the list, and the table itself keeps only the count.
 */
import type { Track } from "./types";

/**
 * The running tracks of one anim state, by id. A track is in the table from the start that files it until it ends:
 * `get` and `has` answer only a track that has not ended. Iteration runs in start order.
 */
export class TrackTable {
  /** The dense list of the state: every filed track, an ended one until the frame step drops it. */
  readonly #list: readonly Track[];

  /** How many filed tracks have not ended. */
  #size = 0;

  /**
   * Creates the table over the dense list of an anim state.
   *
   * @param list - The list `startTrack` pushes every filed track onto.
   */
  constructor(list: readonly Track[]) {
    this.#list = list;
  }

  /**
   * How many tracks run.
   *
   * @returns The count.
   */
  get size(): number {
    return this.#size;
  }

  /**
   * The running track of an id.
   *
   * @param id - The id of a track.
   * @returns The track, or `undefined` once it ended or for an id no running track has.
   */
  get(id: number): Track | undefined {
    const track = this.#find(id);

    return track === undefined || track.ended ? undefined : track;
  }

  /**
   * Tells whether a track of this id runs.
   *
   * @param id - The id of a track.
   * @returns True while it runs.
   */
  has(id: number): boolean {
    return this.get(id) !== undefined;
  }

  /** Counts a track `startTrack` filed and pushed onto the list. */
  filed(): void {
    this.#size += 1;
  }

  /** Counts a running track that just ended; its record stays on the list until the frame step drops it. */
  ended(): void {
    this.#size -= 1;
  }

  /** Forgets every track, with the list the state empties beside it. */
  clear(): void {
    this.#size = 0;
  }

  /**
   * The ids of the running tracks, in start order.
   *
   * @yields {number} Each id.
   */
  *keys(): IterableIterator<number> {
    for (const track of this.values()) yield track.id;
  }

  /**
   * The running tracks, in start order. A snapshot of the list is walked, so a track that ends meanwhile is still
   * handed out.
   *
   * @yields {Track} Each track.
   */
  *values(): IterableIterator<Track> {
    for (const track of this.#list.filter(each => !each.ended)) yield track;
  }

  /**
   * The record of an id on the list: a binary search, the list being in id order, then a walk for a track a nested
   * start pushed ahead of the start that took the id before it.
   *
   * @param id - The id of a track.
   * @returns The record, ended or not, or `undefined`.
   */
  #find(id: number): Track | undefined {
    const list = this.#list;
    let low = 0;
    let high = list.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const track = list[middle];

      if (track === undefined) break;
      if (track.id === id) return track;
      if (track.id < id) low = middle + 1;
      else high = middle - 1;
    }

    // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing, also cold.
    for (let index = 0; index < list.length; index += 1) {
      if (list[index]?.id === id) return list[index];
    }

    return undefined;
  }
}
