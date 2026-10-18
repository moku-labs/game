/**
 * @file scenes plugin — state factory.
 */
import type { SceneDefinition, SceneOwner, State } from "./types";

/**
 * Creates the registry of declared scenes. Its own function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty scene registry.
 */
function emptyRegistry(): Map<string, SceneDefinition> {
  return new Map();
}

/**
 * Creates the table of which feature declared which scene, for the same reason as
 * `emptyRegistry`.
 *
 * @returns An empty table of scene id to feature name.
 */
function emptyOwners(): Map<string, string> {
  return new Map();
}

/**
 * Creates the one owner every mount of this plugin carries. One is enough: a single scene is
 * mounted at a time and `unmount` is what flushes.
 *
 * @returns The owner of every entity the scenes plugin mounts.
 */
function sceneOwner(): SceneOwner {
  return { kind: "plugin", name: "scenes" };
}

/**
 * Creates the initial scenes state: nothing declared, nothing mounted, nothing pending, nothing
 * held. The registry and its owners are filled in `onStart` from the feature descriptions.
 *
 * @returns A fresh state, owned by one app.
 */
export function createScenesState(): State {
  return {
    scenes: emptyRegistry(),
    current: undefined,
    pending: undefined,
    named: [],
    owner: sceneOwner(),
    teardown: undefined,
    owners: emptyOwners(),
    held: undefined
  };
}
