/**
 * @file world/ecs — state factory.
 */
import type { EcsState } from "./types";

/**
 * Creates an empty collection. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates the initial ecs state: no entity, no type, no system and no resource. Every collection
 * is its own object, so two apps in one process never share a world.
 *
 * @returns The ecs branch of the plugin state.
 */
export function createEcsState(): EcsState {
  return {
    generations: [],
    free: [],
    owners: emptyMap(),
    byOwner: emptyMap(),
    types: emptyMap(),
    stores: emptyMap(),
    resources: emptyMap(),
    systems: { input: [], animate: [], layout: [], sync: [] },
    running: undefined,
    commands: [],
    changed: emptyMap(),
    added: emptyMap(),
    removed: emptyMap(),
    ownerLeft: [],
    mode: "live",
    offFrame: [],
    frameSnapshot: undefined
  };
}
