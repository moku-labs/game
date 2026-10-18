/**
 * @file renderer/demand — the change marks of one decision as a list that empties without allocating (audit row 20).
 * A `Set` would do the job, but V8 gives a set a new table at every `clear()` and grows it again on the next frame:
 * 20 marks a frame cost 2.7 KB. Here the entities sit in a dense array, overwritten by index, and each carries the
 * number of the decision it was last marked in: a mark of this decision has the list's own number. Emptying the list is
 * a new number. The read side (`has`, `size`, `at`, a walk) is the one a `Set` had.
 */
import type { Entity } from "../../world/types";
import type { Marks } from "./types";

/**
 * Distinct entities the stamps keep before an emptying drops them: every stamp is stale right after it, and an entity
 * marked again gets a new one. Bounds the map when entities come and go.
 */
const STAMPS_KEPT = 1024;

/** The highest decision number: past it the numbers start again, with the stamps dropped. A small integer to V8. */
const LAST_STAMP = 2 ** 30 - 1;

/**
 * The marks of one kind of the decision running now, in mark order, each entity once.
 */
export class MarkList implements Marks {
  /** Entities marked in this decision. */
  public size = 0;
  /** The marked entities: the first `size` of them; the rest is left from earlier decisions. */
  private readonly entities: Entity[] = [];
  /** The decision each entity was last marked in. */
  private readonly stamps = new Map<Entity, number>();
  /** The number of this decision. */
  private stamp = 1;

  /**
   * Tells whether an entity is marked in this decision.
   *
   * @param entity - The entity.
   * @returns True when it is.
   */
  public has(entity: Entity): boolean {
    return this.stamps.get(entity) === this.stamp;
  }

  /**
   * The entity marked `index`-th in this decision.
   *
   * @param index - 0 to `size - 1`.
   * @returns The entity; 0 past the end.
   */
  public at(index: number): Entity {
    return index < this.size ? (this.entities[index] ?? 0) : 0;
  }

  /**
   * Marks an entity; a second mark of the same decision changes nothing.
   *
   * @param entity - The entity.
   */
  public add(entity: Entity): void {
    if (this.stamps.get(entity) === this.stamp) return;

    // per mark: an entity marked before takes the new number in its entry; the array slot is overwritten.
    this.stamps.set(entity, this.stamp);
    this.entities[this.size] = entity;
    this.size += 1;
  }

  /**
   * Empties the list: the next decision gets a new number, so every stamp is stale. Allocates nothing, except when the
   * stamps grew past `STAMPS_KEPT` or the numbers ran out: then they are dropped.
   */
  public clear(): void {
    this.size = 0;
    this.stamp += 1;

    if (this.stamps.size > STAMPS_KEPT || this.stamp > LAST_STAMP) {
      this.stamps.clear();
      this.stamp = 1;
    }
  }

  /**
   * Walks the marks of this decision in mark order. Allocates an iterator: for a test or a spread, never per frame.
   *
   * @yields {Entity} Each marked entity.
   */
  public *[Symbol.iterator](): Iterator<Entity> {
    for (let index = 0; index < this.size; index += 1) yield this.at(index);
  }
}
