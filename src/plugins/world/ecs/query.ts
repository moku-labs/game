/**
 * @file world/ecs — the query walk: the store of the first term in insertion order, filtered by
 * the other terms, with `mut()` marking every row it yields. A system's terms are resolved once,
 * when it registers; the walk itself copies nothing and builds a row only for an entity that
 * carries every term.
 */
import type { WorldCtx } from "../types";
import { markChanged } from "./changes";
import { registerType, termType } from "./storage";
import type { EcsState, Entity, QueryTerm } from "./types";

/**
 * A query resolved once: the component names in order, and the names the system writes (marked as it walks).
 */
export type QueryPlan = { readonly names: readonly string[]; readonly written: readonly string[] };

/**
 * Resolves query terms into a plan, registering every term's type in the world on the way.
 *
 * @param ctx - Domain context of the world plugin.
 * @param terms - The query terms, in the order the row is built.
 * @returns The component names in term order and the names of the `mut()` terms.
 * @throws {Error} When a term's type clashes with another type of the same name.
 */
export function planOf(ctx: WorldCtx, terms: readonly QueryTerm[]): QueryPlan {
  const names: string[] = [];
  const written: string[] = [];

  const count = terms.length;

  // Index loops on the per-frame path: no iterator object.
  for (let index = 0; index < count; index += 1) {
    const term = terms[index];

    if (term === undefined) continue;

    const componentType = termType(term);

    registerType(ctx, componentType);
    names.push(componentType.componentName);

    if ("of" in term) written.push(componentType.componentName);
  }

  return { names, written };
}

/**
 * Tells whether the walk runs in a dev build, behind the inline positive guard a production
 * bundle folds away.
 *
 * @returns True in a dev build.
 */
function devBuild(): boolean {
  return typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__;
}

/** What a walk answers once it has no row left. */
const DONE: IteratorReturnResult<undefined> = Object.freeze({ done: true, value: undefined });

/** The value of a walk's step before its first row. */
const NO_ROW: readonly unknown[] = Object.freeze([]);

/**
 * One walk of a plan: an iterator over its rows that allocates nothing but the rows. A generator
 * would allocate a result object for every row, and a `for…of` over the store's keys one for every
 * entity of the store, matching or not; this walk reuses one result object and reads the store
 * with `forEach`.
 */
class QueryWalk implements Iterator<readonly unknown[], undefined> {
  /** The step handed back for every row: only its `value` changes. */
  private readonly step: IteratorYieldResult<readonly unknown[]> = { done: false, value: NO_ROW };
  /** The entities to visit, taken at the first step; `undefined` before it. */
  private entities: Entity[] | undefined = undefined;
  /** The next entity to visit. */
  private index = 0;
  /** The walked store's size at the last step: a dev build's walk inside a phase compares it. */
  private size = -1;

  /**
   * Prepares a walk. Nothing is read before the first step, as a generator would.
   *
   * @param ctx - Domain context of the world plugin.
   * @param plan - The resolved query.
   */
  constructor(
    private readonly ctx: WorldCtx,
    private readonly plan: QueryPlan
  ) {}

  /**
   * The walk is its own iterator, so `ecs.query()` hands it out as the iterable.
   *
   * @returns This walk.
   */
  [Symbol.iterator](): QueryWalk {
    return this;
  }

  /**
   * Hands out the next row: the next entity that still carries every name, marked for every
   * `mut()` name.
   *
   * @returns The step of the row, or the end.
   */
  next(): IteratorResult<readonly unknown[], undefined> {
    const state = this.ctx.state.ecs;
    const { names, written } = this.plan;
    const first = names[0];
    const store = first === undefined ? undefined : state.stores.get(first);

    if (first === undefined || store === undefined) return DONE;

    const entities = this.entities ?? this.start(store);

    if (this.size !== -1 && store.size !== this.size) {
      this.size = store.size;
      reportStoreChange(this.ctx, first);
    }

    while (this.index < entities.length) {
      const entity = entities[this.index];

      this.index += 1;

      const value = entity === undefined ? undefined : store.get(entity);

      if (entity === undefined || value === undefined) continue;
      if (!carriesAll(state.stores, names, entity)) continue;

      markWritten(state, written, entity);
      this.step.value = rowOf(state.stores, names, entity, value);

      return this.step;
    }

    return DONE;
  }

  /**
   * Takes the entities to visit. Inside a phase only the matching ones, read live in one pass:
   * structural changes are queued until the phase ends, so the matches stay true while the rows
   * are consumed. Outside a phase every key of the store, checked at its turn: an entity spawned
   * during the walk is not visited, one despawned before its turn is skipped.
   *
   * @param store - The store of the first name.
   * @returns The entities, in the store's insertion order.
   */
  private start(store: ReadonlyMap<Entity, object | true>): Entity[] {
    const state = this.ctx.state.ecs;
    const stores = state.stores;
    const names = this.plan.names;
    const inPhase = state.running !== undefined;
    const entities: Entity[] = inPhase ? [] : [...store.keys()];

    if (inPhase) {
      // `forEach` hands every key without a result object per entry; nothing is yielded inside.
      // eslint-disable-next-line unicorn/no-array-for-each -- a Map, read without an iterator
      store.forEach((_value, entity) => {
        if (carriesAll(stores, names, entity)) entities.push(entity);
      });

      if (devBuild()) this.size = store.size;
    }

    this.entities = entities;

    return entities;
  }
}

/**
 * Marks a yielded entity changed for every `mut()` name of its plan.
 *
 * @param state - ecs module state.
 * @param written - The names of the `mut()` terms.
 * @param entity - The yielded entity.
 */
function markWritten(state: EcsState, written: readonly string[], entity: Entity): void {
  const count = written.length;

  for (let index = 0; index < count; index += 1) {
    const name = written[index];

    if (name !== undefined) markChanged(state, name, entity);
  }
}

/**
 * Tells whether an entity carries every name of a plan after the first.
 *
 * @param stores - Every component store of the world.
 * @param names - Component names of the terms, in order.
 * @param entity - The entity.
 * @returns True when every other store holds the entity.
 */
function carriesAll(
  stores: ReadonlyMap<string, ReadonlyMap<Entity, object | true>>,
  names: readonly string[],
  entity: Entity
): boolean {
  const count = names.length;

  for (let index = 1; index < count; index += 1) {
    const name = names[index];

    if (name === undefined || stores.get(name)?.has(entity) !== true) return false;
  }

  return true;
}

/**
 * Walks the store of the first name of a plan and yields the entities that carry every name, in
 * that store's insertion order, so two runs of the same world yield the same rows. Inside a phase
 * the store is read live: structural changes are queued until the phase ends, so no key comes or
 * goes while it is walked (a dev build reports it once when one does). Outside a phase the keys
 * are taken at the start. Every row is a new array.
 *
 * @param ctx - Domain context of the world plugin.
 * @param plan - The resolved query.
 * @returns The rows: the entity, then one stored value per name.
 */
export function walkPlan(ctx: WorldCtx, plan: QueryPlan): Iterable<readonly unknown[]> {
  return new QueryWalk(ctx, plan);
}

/**
 * Builds the row of an entity that carries every name, at its exact length: a row of up to four
 * terms is one array literal, since a `push` past an array's length grows it with spare room the
 * collector then sweeps, for every row of every frame.
 *
 * @param stores - Every component store of the world.
 * @param names - Component names of the terms, in order.
 * @param entity - The entity of this row.
 * @param value - Its stored value of the first term.
 * @returns The row: the entity, then one stored value per name.
 */
function rowOf(
  stores: ReadonlyMap<string, ReadonlyMap<Entity, object | true>>,
  names: readonly string[],
  entity: Entity,
  value: object | true
): unknown[] {
  switch (names.length) {
    case 1: {
      return [entity, value];
    }
    case 2: {
      return [entity, value, valueAt(stores, names, 1, entity)];
    }
    case 3: {
      return [entity, value, valueAt(stores, names, 1, entity), valueAt(stores, names, 2, entity)];
    }
    case 4: {
      return [
        entity,
        value,
        valueAt(stores, names, 1, entity),
        valueAt(stores, names, 2, entity),
        valueAt(stores, names, 3, entity)
      ];
    }
    default: {
      const row: unknown[] = [entity, value];

      for (let index = 1; index < names.length; index += 1) {
        row.push(valueAt(stores, names, index, entity));
      }

      return row;
    }
  }
}

/**
 * Reads the stored value of one term of a row.
 *
 * @param stores - Every component store of the world.
 * @param names - Component names of the terms, in order.
 * @param index - The term.
 * @param entity - The entity of the row.
 * @returns The stored value; the walk only asks for a term the entity carries.
 */
function valueAt(
  stores: ReadonlyMap<string, ReadonlyMap<Entity, object | true>>,
  names: readonly string[],
  index: number,
  entity: Entity
): object | true | undefined {
  const name = names[index];

  return name === undefined ? undefined : stores.get(name)?.get(entity);
}

/**
 * Logs, once per app, that a store changed its keys while a phase walked it: an engine path that
 * writes a store past the command queue.
 *
 * @param ctx - Domain context of the world plugin.
 * @param component - The walked component.
 */
function reportStoreChange(ctx: WorldCtx, component: string): void {
  if (ctx.state.ecs.walkReported) return;

  ctx.state.ecs.walkReported = true;
  ctx.log.error("world:store-changed-during-walk", { component });
}

/**
 * Resolves the terms and walks them: the query of `ecs.query()`, whose terms are a fresh array
 * every call.
 *
 * @param ctx - Domain context of the world plugin.
 * @param terms - The query terms, in the order the row is built.
 * @returns The rows: the entity, then one stored value per term.
 */
export function runQuery(ctx: WorldCtx, terms: readonly QueryTerm[]): Iterable<readonly unknown[]> {
  return walkPlan(ctx, planOf(ctx, terms));
}
