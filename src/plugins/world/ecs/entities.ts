/**
 * @file world/ecs — entity ids: reserve, release and the generational check.
 */
import type { EcsState, Entity, Owner } from "./types";

/**
 * Creates an empty set. It lives in its own non-exported function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @param entries - What the set starts with.
 * @returns A set of those entries.
 */
function setOf<Value>(entries: Iterable<Value> = []): Set<Value> {
  return new Set(entries);
}

/** How many indices one generation spans. An id is `generation * INDEX_SPAN + index`. */
const INDEX_SPAN = 2 ** 20;

/**
 * Builds the key of the owner index.
 *
 * @param owner - The owner.
 * @returns The key `"kind:name"`.
 * @example
 * ```ts
 * ownerKey({ kind: "projection", name: "board.items" }); // "projection:board.items"
 * ```
 */
export function ownerKey(owner: Owner): string {
  return `${owner.kind}:${owner.name}`;
}

/**
 * Reads the index part of an entity id.
 *
 * @param entity - The entity id.
 * @returns The index.
 * @example
 * ```ts
 * indexOf(2 ** 20 + 3); // 3
 * ```
 */
export function indexOf(entity: Entity): number {
  return entity % INDEX_SPAN;
}

/**
 * Reads the generation part of an entity id.
 *
 * @param entity - The entity id.
 * @returns The generation.
 * @example
 * ```ts
 * generationOf(2 * 2 ** 20 + 3); // 2
 * ```
 */
export function generationOf(entity: Entity): number {
  return Math.floor(entity / INDEX_SPAN);
}

/**
 * Tells whether an id still names a living entity.
 *
 * @param state - ecs module state.
 * @param entity - The entity id.
 * @returns True while the entity lives.
 */
export function isAlive(state: EcsState, entity: Entity): boolean {
  return state.owners.has(entity);
}

/**
 * Reserves an index for a new entity and records its owner. The id is valid at once, also inside
 * a phase, where only the components wait for the flush.
 *
 * @param state - ecs module state.
 * @param owner - Who owns the entity.
 * @returns The new entity id.
 */
export function reserveEntity(state: EcsState, owner: Owner): Entity {
  const reused = state.free.pop();
  const index = reused ?? state.generations.length;

  if (reused === undefined) state.generations.push(1);

  const entity = (state.generations[index] ?? 1) * INDEX_SPAN + index;
  const key = ownerKey(owner);
  const owned = state.byOwner.get(key) ?? setOf<Entity>();

  owned.add(entity);
  state.byOwner.set(key, owned);
  state.owners.set(entity, owner);

  return entity;
}

/**
 * Frees the index of an entity and bumps its generation, so the id never comes back.
 *
 * @param state - ecs module state.
 * @param entity - The entity id.
 */
export function releaseEntity(state: EcsState, entity: Entity): void {
  const owner = state.owners.get(entity);

  if (owner === undefined) return;

  const key = ownerKey(owner);
  const owned = state.byOwner.get(key);

  owned?.delete(entity);
  if (owned?.size === 0) state.byOwner.delete(key);
  state.owners.delete(entity);

  const index = indexOf(entity);

  state.generations[index] = (state.generations[index] ?? 1) + 1;
  state.free.push(index);
}
