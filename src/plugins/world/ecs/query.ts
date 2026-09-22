/**
 * @file world/ecs — the query walk: the store of the first term in insertion order, filtered by
 * the other terms, with `mut()` marking every row it yields.
 */
import type { WorldCtx } from "../types";
import { markChanged } from "./changes";
import { registerType, termType } from "./storage";
import type { Entity, QueryTerm } from "./types";

/**
 * Walks the store of the first term and keeps the entities that carry every term. The order is
 * the insertion order of that store, so two runs of the same world yield the same rows.
 *
 * @param ctx - Domain context of the world plugin.
 * @param terms - The query terms, in the order the row is built.
 * @yields {readonly unknown[]} One row: the entity, then one stored value per term.
 */
export function* runQuery(
  ctx: WorldCtx,
  terms: readonly QueryTerm[]
): Generator<readonly unknown[]> {
  const state = ctx.state.ecs;
  const names = terms.map(term => {
    registerType(ctx, termType(term));

    return termType(term).componentName;
  });
  const written = terms.filter(term => "of" in term).map(term => termType(term).componentName);
  const first = names[0];

  if (first === undefined) return;

  const store = state.stores.get(first);

  if (store === undefined) return;

  // The store is written while the rows are consumed: a system may spawn or despawn as it walks.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const [entity, value] of [...store]) {
    const row = rowOf(state.stores, entity, names, value);

    if (row === undefined) continue;

    for (const name of written) markChanged(state, name, entity);

    yield row;
  }
}

/**
 * Builds one query row, or answers `undefined` when the entity misses a term.
 *
 * @param stores - Every component store of the world.
 * @param entity - The entity of this row.
 * @param names - Component names of the terms, in order.
 * @param first - The stored value of the first term.
 * @returns The row, or `undefined`.
 */
function rowOf(
  stores: Map<string, Map<Entity, object | true>>,
  entity: Entity,
  names: readonly string[],
  first: object | true
): readonly unknown[] | undefined {
  const row: unknown[] = [entity, first];

  for (const name of names.slice(1)) {
    const value = stores.get(name)?.get(entity);

    if (value === undefined) return undefined;

    row.push(value);
  }

  return row;
}
