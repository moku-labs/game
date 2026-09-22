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
 * Creates the one owner every mount of this plugin carries. One is enough: a single scene is
 * mounted at a time and `unmount` is what flushes.
 *
 * @returns The owner of every entity the scenes plugin mounts.
 */
function sceneOwner(): SceneOwner {
  return { kind: "plugin", name: "scenes" };
}

/**
 * Creates the initial scenes state: nothing declared, nothing mounted, nothing pending. The
 * registry is filled in `onStart` from the feature descriptions.
 *
 * @returns A fresh state, owned by one app.
 */
export function createScenesState(): State {
  return {
    scenes: emptyRegistry(),
    current: undefined,
    pending: undefined,
    owner: sceneOwner(),
    teardown: undefined
  };
}
