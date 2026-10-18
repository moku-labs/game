/**
 * @file world/ecs — the query walk: the store of the first term in insertion order, filtered by
 * the other terms, with `mut()` marking every row it yields. A system's terms are resolved once,
 * when it registers, into one walk the runner resets every run: it allocates nothing and hands out
 * one row array, rewritten for every row. `ecs.query()` walks with a fresh walk and fresh rows.
 */
import type { WorldCtx } from "../types";
import { markChanged } from "./changes";
import { registerType, termType } from "./storage";
import type { EcsState, Entity, QueryTerm, SystemEntry } from "./types";

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
function walkPlan(ctx: WorldCtx, plan: QueryPlan): Iterable<readonly unknown[]> {
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

/** One component store, read by entity. */
type Store = ReadonlyMap<Entity, object | true>;

/**
 * The walk `collectMatch` fills while the first store hands it its keys: set for the length of
 * one `forEach`, a scratch read by a module-level callback, never kept between runs.
 */
const collecting: { walk: SystemWalk | undefined } = { walk: undefined };

/**
 * Hands one key of the first store to the walk that collects: the module-level callback of
 * `Map.forEach`, so a run makes no closure.
 *
 * @param _value - The stored value, read later by the row.
 * @param entity - The key.
 */
function collectMatch(_value: object | true, entity: Entity): void {
  collecting.walk?.keep(entity);
}

/**
 * The walk of one system's declared query, made once when the system registers and reset by the
 * runner before every run. It allocates nothing per run: the entity list and the store list are
 * kept and overwritten by index, and every row it yields is the same array, written in place.
 * A row is valid until the next row; a system that keeps one copies it.
 */
export class SystemWalk implements Iterator<readonly unknown[], undefined> {
  /** The step handed back for every row: always the one row array. */
  private readonly step: IteratorYieldResult<readonly unknown[]>;
  /** The one row: the entity, then one stored value per name, sized at registration. */
  private readonly row: unknown[];
  /** The component names of the terms, in order. */
  private readonly names: readonly string[];
  /** The names of the `mut()` terms, marked for every yielded row. */
  private readonly written: readonly string[];
  /** The store of each name, read once per run at the first step; `undefined` for a name no entity carried yet. */
  private readonly stores: Array<Store | undefined> = [];
  /** The matching entities of this run, from index 0 to `count`; kept and overwritten by index. */
  private readonly entities: Entity[] = [];
  /** How many entities this run collected. */
  private count = 0;
  /** The next entity to visit. */
  private index = 0;
  /** Whether this run took its entities yet. */
  private started = false;
  /** The first store's size at the first step: a dev build compares it; -1 when not watched. */
  private size = -1;

  /**
   * Prepares the walk of one system.
   *
   * @param ctx - Domain context of the world plugin.
   * @param plan - The system's resolved query.
   */
  constructor(
    private readonly ctx: WorldCtx,
    plan: QueryPlan
  ) {
    this.names = plan.names;
    this.written = plan.written;
    this.step = { done: false, value: NO_ROW };
    this.row = [];

    // Filled with `push`, so the row is a packed array of its exact length from the start.
    for (let index = 0; index <= plan.names.length; index += 1) this.row.push(undefined);

    this.step.value = this.row;
  }

  /**
   * The walk is its own iterator, so the runner hands it to `run` as the rows. A second loop over
   * it in the same run finds it walked.
   *
   * @returns This walk.
   */
  [Symbol.iterator](): SystemWalk {
    return this;
  }

  /**
   * Starts a new run: nothing is read before the first step.
   *
   * @returns This walk, the rows of the run.
   */
  reset(): SystemWalk {
    this.started = false;
    this.index = 0;
    this.count = 0;
    this.size = -1;

    return this;
  }

  /**
   * Keeps one key of the first store when the entity carries every other name.
   *
   * @param entity - The key.
   */
  keep(entity: Entity): void {
    const stores = this.stores;
    const count = stores.length;

    for (let index = 1; index < count; index += 1) {
      if (stores[index]?.has(entity) !== true) return;
    }

    // Per run: overwritten by index, never cut, so the list keeps its store from run to run.
    this.entities[this.count] = entity;
    this.count += 1;
  }

  /**
   * Hands out the next row: the next collected entity, its values written into the one row, and
   * marked for every `mut()` name.
   *
   * @returns The step of the row, or the end.
   */
  next(): IteratorResult<readonly unknown[], undefined> {
    if (!this.started) this.start();

    const first = this.stores[0];

    if (first === undefined) return DONE;

    if (this.size !== -1 && first.size !== this.size) {
      this.size = first.size;
      reportStoreChange(this.ctx, this.names[0] ?? "");
    }

    while (this.index < this.count) {
      const entity = this.entities[this.index];

      this.index += 1;

      if (entity === undefined || !this.fill(entity)) continue;

      markWritten(this.ctx.state.ecs, this.written, entity);

      return this.step;
    }

    return DONE;
  }

  /**
   * Reads the stores of this run and collects the entities that carry every name, in the first
   * store's order. Structural changes are queued until the phase ends, so the matches stay true
   * while the rows are consumed.
   */
  private start(): void {
    const all = this.ctx.state.ecs.stores;
    const names = this.names;
    const stores = this.stores;
    const count = names.length;

    this.started = true;

    for (let index = 0; index < count; index += 1) {
      const name = names[index];

      stores[index] = name === undefined ? undefined : all.get(name);
    }

    const first = stores[0];

    if (first === undefined) return;

    collecting.walk = this;
    // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
    first.forEach(collectMatch);
    collecting.walk = undefined;

    if (devBuild()) this.size = first.size;
  }

  /**
   * Writes the row of one entity in place: the entity, then the value of every name.
   *
   * @param entity - The entity.
   * @returns False when the entity no longer carries a name, and the row is not handed out.
   */
  private fill(entity: Entity): boolean {
    const row = this.row;
    const stores = this.stores;
    const count = stores.length;

    row[0] = entity;

    for (let index = 0; index < count; index += 1) {
      const value = stores[index]?.get(entity);

      if (value === undefined) return false;

      row[index + 1] = value;
    }

    return true;
  }
}

/**
 * The rows of a system with an empty query: none, from one shared iterator.
 */
const NO_ROWS: Iterable<readonly unknown[]> & Iterator<readonly unknown[], undefined> = {
  /**
   * The rows are their own iterator.
   *
   * @returns The same empty rows.
   */
  [Symbol.iterator](): Iterator<readonly unknown[], undefined> {
    return NO_ROWS;
  },
  next: () => DONE
};

/**
 * The rows the runner hands a system's `run`: its walk, reset; none for an empty query. A system
 * entry made without a walk gets one here, once.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entry - The registered system.
 * @returns The rows of this run.
 */
export function systemRows(ctx: WorldCtx, entry: SystemEntry): Iterable<readonly unknown[]> {
  if (entry.plan.names.length === 0) return NO_ROWS;

  entry.walk ??= new SystemWalk(ctx, entry.plan);

  return entry.walk.reset();
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
