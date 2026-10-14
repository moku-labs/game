/**
 * @file scenes plugin — what a scene names: its bundle and the bundles its `bundles(state)` returns, and the check that
 * an entry of a feature's `scenes` list is a scene. Pure; read by the switch and by `assets`.
 */
import type { SceneDefinition, SceneState } from "./types";

/**
 * Lists the bundles a scene names for a committed state: its `bundle` first, then what its `bundles(state)` returns, in
 * order, each name once.
 *
 * @param scene - The scene declaration.
 * @param _state - The committed player and session (read by 04 S3.1 once built).
 * @returns The bundle names, the scene bundle first.
 * @throws {Error} When `bundles` returns something that is not a list of names (04 S3.1).
 */
export function namedBundles(scene: SceneDefinition, _state: SceneState): readonly string[] {
  // Skeleton body: the scene bundle alone. Spec 04 S3.1 appends `bundles(state)`, dedupes and validates.
  return [scene.bundle];
}

/**
 * Tells whether one entry of a feature's `scenes` list is a scene declaration. The key carries whatever the game put
 * there, so an entry that is not one is skipped instead of crashing.
 *
 * @param entry - One entry of the list.
 * @returns True when the entry can be read as a scene.
 * @example
 * ```ts
 * isSceneDefinition({ id: "board", bundle: "board", layers: [], projections: [] }); // true
 * ```
 */
export function isSceneDefinition(entry: unknown): entry is SceneDefinition {
  // Moved unchanged from `scenes/lifecycle.ts`; spec 04 S3.2 adds: `bundles` absent, undefined or a function.
  return (
    typeof entry === "object" &&
    entry !== null &&
    "id" in entry &&
    typeof entry.id === "string" &&
    "bundle" in entry &&
    typeof entry.bundle === "string" &&
    "layers" in entry &&
    Array.isArray(entry.layers) &&
    "projections" in entry &&
    Array.isArray(entry.projections)
  );
}
