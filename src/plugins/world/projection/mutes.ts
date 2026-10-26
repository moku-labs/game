/**
 * @file world/projection — the mute tables: the fields another writer owns on one entity. `mute()`
 * hands fields over for a while. A projection's `initialOnly` hands them over for the whole life of
 * each of its views: one frozen table, built when the spec is registered, is shared by every view,
 * so a birth makes no set and the driver's ask on every frame finds the fields as for a mute.
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
 * born with an `initialOnly` seed gets its own copy first, and the remover keeps the seed fields.
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
  // The projection's own fields stay muted when this mute is released.
  const kept = initialFieldsOf(state, entity, name);

  for (const field of fields) owned.add(field);
  forgetJoined(state, owned);
  table.set(name, owned);
  state.mutes.set(entity, table);

  let released = false;

  return (): void => {
    if (released) return;

    released = true;

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
 * Gives a view that was just born the seed of its projection, so from now on nothing of the
 * projection writes or compares those fields. The birth itself wrote them from `view`.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The projection spec.
 * @param entity - The entity of the new view.
 */
export function seedMutes(state: ProjectionState, spec: AnyProjectionSpec, entity: Entity): void {
  if (spec.initialOnly === undefined) return;

  const seed = state.initialOnly.get(spec);

  if (seed !== undefined) state.mutes.set(entity, seed);
}

/**
 * Moves the views of a replaced projection from the seed of the old spec to the seed of the new
 * one: a view that holds the old seed, or none when the old spec had none. A view a `mute()` gave
 * its own table keeps that table.
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
    if (view.projection !== name || state.mutes.get(view.entity) !== from) continue;

    if (to === undefined) state.mutes.delete(view.entity);
    else state.mutes.set(view.entity, to);
  }
}
