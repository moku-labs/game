/**
 * @file world/projection — the mute tables: the fields another writer owns on one entity. `mute()`
 * hands fields over for a while. A projection's `initialOnly` hands them over for the whole life of
 * each of its views: one frozen table, built when the spec is registered, is shared by every view,
 * so a birth makes no set and the driver's ask on every frame finds the fields as for a mute. A
 * view a listener of its spawn muted already (`anim` in its `onAdded(Frames)`) keeps that table,
 * and the seed joins it in place, so the remover of that mute still finds what it wrote.
 */
import type { Entity } from "../ecs/types";
import { forgetJoined } from "./driver";
import type { AnyProjectionSpec, MuteTable, ProjectionState } from "./types";

/**
 * Tells a table `mute()` made apart from a shared `initialOnly` seed, which is frozen.
 *
 * @param table - A table of `state.mutes`.
 * @returns True when the table may be written.
 */
function isOwnTable(table: MuteTable): table is Map<string, ReadonlySet<string>> {
  return !Object.isFrozen(table);
}

/**
 * Tells a field set `mute()` made apart from a set of a shared `initialOnly` seed, which is frozen.
 *
 * @param fields - A field set of one table.
 * @returns True when the set may be written.
 */
function isOwnFields(fields: ReadonlySet<string>): fields is Set<string> {
  return !Object.isFrozen(fields);
}

/**
 * The table a mute may write: the entity's own one, a copy of the seed it was born with, or a new one.
 *
 * @param stored - The table the entity has now, if any.
 * @returns A writable table.
 */
function ownTable(stored: MuteTable | undefined): Map<string, ReadonlySet<string>> {
  if (stored === undefined) return new Map();

  return isOwnTable(stored) ? stored : new Map(stored);
}

/**
 * The field set a mute may write: the component's own one, a copy of its seed set, or a new one.
 *
 * @param stored - The field set the component has now, if any.
 * @returns A writable set.
 */
function ownFields(stored: ReadonlySet<string> | undefined): Set<string> {
  if (stored === undefined) return new Set();

  return isOwnFields(stored) ? stored : new Set(stored);
}

/**
 * The `initialOnly` fields of one component of a view, from the spec of its projection.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity of the view.
 * @param name - The component name.
 * @returns The seed set, or `undefined` for an entity that is no view of such a projection.
 */
function initialFieldsOf(
  state: ProjectionState,
  entity: Entity,
  name: string
): ReadonlySet<string> | undefined {
  const projection = state.byEntity.get(entity)?.projection;
  const spec = projection === undefined ? undefined : state.specs.get(projection);

  return spec === undefined ? undefined : state.initialOnly.get(spec)?.get(name);
}

/**
 * Deletes a released field set once it is empty, and the entity's table once no component is
 * left. Only the table and the set this mute filled are touched, so a remover that runs after a
 * clear or a new birth on the same id never drops a newer mute.
 *
 * @param mutes - The mute tables of every entity.
 * @param entity - The muted entity.
 * @param table - The table the mute wrote.
 * @param name - The muted component's name.
 * @param owned - The field set the remover released from.
 */
function dropEmptyMute(
  mutes: Map<Entity, MuteTable>,
  entity: Entity,
  table: Map<string, ReadonlySet<string>>,
  name: string,
  owned: Set<string>
): void {
  if (owned.size > 0 || mutes.get(entity) !== table || table.get(name) !== owned) return;

  table.delete(name);
  if (table.size === 0) mutes.delete(entity);
}

/**
 * Hands fields of one component of one entity to another writer, until the remover runs. A view
 * born with an `initialOnly` seed gets its own copy first. The remover keeps the seed fields, asked
 * when it runs: a mute made inside the spawn came before the view was known.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity.
 * @param name - The component name.
 * @param fields - The field names the caller owns.
 * @returns The remover; a no-op when called twice.
 */
export function muteFields(
  state: ProjectionState,
  entity: Entity,
  name: string,
  fields: readonly string[]
): () => void {
  const table = ownTable(state.mutes.get(entity));
  const owned = ownFields(table.get(name));

  for (const field of fields) owned.add(field);
  forgetJoined(state, owned);
  table.set(name, owned);
  state.mutes.set(entity, table);

  let released = false;

  return (): void => {
    if (released) return;

    released = true;

    // The projection's own fields stay muted when this mute is released.
    const kept = initialFieldsOf(state, entity, name);

    for (const field of fields) {
      if (kept?.has(field) !== true) owned.delete(field);
    }

    forgetJoined(state, owned);
    dropEmptyMute(state.mutes, entity, table, name, owned);
  };
}

/**
 * Builds the frozen seed of a projection's `initialOnly` list: component name to its fields, a
 * component named twice with both lists joined.
 *
 * @param spec - The projection spec.
 * @param pairs - Its `initialOnly` list, not empty.
 * @returns The seed.
 * @throws {Error} For a pair with no field.
 */
function buildSeed(
  spec: AnyProjectionSpec,
  pairs: NonNullable<AnyProjectionSpec["initialOnly"]>
): MuteTable {
  const seed = new Map<string, ReadonlySet<string>>();

  for (const [component, fields] of pairs) {
    const name = component.componentName;

    if (fields.length === 0) {
      throw new Error(
        `[game] Projection "${spec.name}" lists ${name} in initialOnly with no field.\n` +
          "  Name the fields only the birth of a view writes, or drop the pair."
      );
    }

    seed.set(name, Object.freeze(new Set([...(seed.get(name) ?? []), ...fields])));
  }

  return Object.freeze(seed);
}

/**
 * Checks the `initialOnly` list of a spec and keeps its seed: once per spec, since a name is
 * registered once and `replace` brings a new spec. A spec without the option, or with an empty
 * list, has none.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The spec `register` or `replace` stores.
 * @returns The seed, or `undefined`.
 * @throws {Error} For a pair with no field; nothing is kept then.
 */
export function learnSeed(state: ProjectionState, spec: AnyProjectionSpec): MuteTable | undefined {
  const pairs = spec.initialOnly;

  if (pairs === undefined || pairs.length === 0) return undefined;

  const seed = buildSeed(spec, pairs);

  state.initialOnly.set(spec, seed);

  return seed;
}

/**
 * Joins a seed into a table of the entity's own, in place, so the remover of every mute that wrote
 * the table still holds its table and its sets: a component the table lacks gets the shared set
 * of the seed, the set a mute wrote gets the fields of the seed.
 *
 * @param state - The projection branch of the plugin state.
 * @param table - The entity's own table.
 * @param seed - The seed to join.
 */
function joinSeed(
  state: ProjectionState,
  table: Map<string, ReadonlySet<string>>,
  seed: MuteTable
): void {
  for (const [name, fields] of seed) {
    const stored = table.get(name);

    if (stored === undefined) {
      table.set(name, fields);

      continue;
    }

    const owned = ownFields(stored);

    for (const field of fields) owned.add(field);
    forgetJoined(state, owned);
    table.set(name, owned);
  }
}

/**
 * Gives a view that was just born the seed of its projection, so from now on nothing of the
 * projection writes or compares those fields. The birth itself wrote them from `view`. A view a
 * listener of its spawn muted already keeps its table, and the seed joins it.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The projection spec.
 * @param entity - The entity of the new view.
 */
export function seedMutes(state: ProjectionState, spec: AnyProjectionSpec, entity: Entity): void {
  if (spec.initialOnly === undefined) return;

  const seed = state.initialOnly.get(spec);

  if (seed === undefined) return;

  const stored = state.mutes.get(entity);

  if (stored === undefined) {
    state.mutes.set(entity, seed);

    return;
  }

  const table = ownTable(stored);

  joinSeed(state, table, seed);
  state.mutes.set(entity, table);
}

/**
 * Moves a view with a table of its own from one seed to the next: a set of the old seed goes, the
 * new seed joins. A set a mute wrote keeps every field it holds, an old seed's field it copied too,
 * since the table does not say which mute named it. A table left empty goes.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity of the view.
 * @param stored - The table the view has now, if any.
 * @param from - The seed of the old spec, if any.
 * @param to - The seed of the new spec, if any.
 */
function reseedOwn(
  state: ProjectionState,
  entity: Entity,
  stored: MuteTable | undefined,
  from: MuteTable | undefined,
  to: MuteTable | undefined
): void {
  const table = ownTable(stored);

  for (const [name, fields] of from ?? []) {
    if (table.get(name) === fields) table.delete(name);
  }

  if (to !== undefined) joinSeed(state, table, to);

  if (table.size === 0) state.mutes.delete(entity);
  else state.mutes.set(entity, table);
}

/**
 * Moves the views of a replaced projection from the seed of the old spec to the seed of the new
 * one. A view that holds the old seed, or none when the old spec had none, takes the new seed. A
 * view a `mute()` gave its own table keeps it: the sets of the old seed in it go, the new seed
 * joins it.
 *
 * @param state - The projection branch of the plugin state.
 * @param name - The projection name.
 * @param from - The seed of the old spec, if any.
 * @param to - The seed of the new spec, if any.
 */
export function reseedViews(
  state: ProjectionState,
  name: string,
  from: MuteTable | undefined,
  to: MuteTable | undefined
): void {
  if (from === to) return;

  for (const view of state.byEntity.values()) {
    if (view.projection !== name) continue;

    const stored = state.mutes.get(view.entity);

    if (stored !== from) reseedOwn(state, view.entity, stored, from, to);
    else if (to === undefined) state.mutes.delete(view.entity);
    else state.mutes.set(view.entity, to);
  }
}
