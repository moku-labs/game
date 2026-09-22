/**
 * @file world/ecs — the coarse change sets of one frame.
 */
import type { EcsState, Entity } from "./types";

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

/**
 * Marks an entity changed for one component.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @param entity - The entity that changed.
 */
export function markChanged(state: EcsState, name: string, entity: Entity): void {
  const set = state.changed.get(name) ?? setOf<Entity>();

  set.add(entity);
  state.changed.set(name, set);
}

/**
 * Reads the change set of one component.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @returns The entities marked changed for it this frame.
 */
export function changesOf(state: EcsState, name: string): Iterable<Entity> {
  return state.changed.get(name) ?? [];
}

/**
 * Empties every change set. Runs in `time` phase `signals`.
 *
 * @param state - ecs module state.
 */
export function clearAllChanges(state: EcsState): void {
  state.changed.clear();
}

/**
 * Takes one entity out of every change set, so a despawned entity is never reported.
 *
 * @param state - ecs module state.
 * @param entity - The entity that left.
 */
export function forgetChanges(state: EcsState, entity: Entity): void {
  for (const set of state.changed.values()) set.delete(entity);
}
