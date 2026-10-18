/**
 * @file world/ecs — the scenes a system runs on. `scenes` tells the world which scene it mounted;
 * the scene before keeps leaving until nothing carries `Exiting` any more. A system that lists
 * `scenes` runs while one of them is mounted or leaving. A switch writes the state; a phase only
 * reads it, and allocates nothing.
 */
import type { FeatureDescription } from "../../flow/types";
import { Exiting } from "./define";
import type { AnySystem, EcsState, SceneState } from "./types";

/**
 * Creates the set of declared scene ids. Its own function: a collection is built outside the
 * exported declarations.
 *
 * @returns An empty set.
 */
function emptyIds(): Set<string> {
  return new Set();
}

/**
 * Reads the id of one entry of a feature's `scenes` list, without trusting the entry.
 *
 * @param entry - What the feature put in the list.
 * @returns The id, or `undefined` when the entry carries none.
 * @example
 * ```ts
 * sceneIdOf({ id: "board", layers: {} }); // "board"
 * ```
 */
function sceneIdOf(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const id: unknown = (entry as { id?: unknown }).id;

  return typeof id === "string" ? id : undefined;
}

/**
 * Records the scene ids every feature declares, so the systems registered from now on have their
 * `scenes` checked. Called once at start, before the features' systems register.
 *
 * @param scene - The scene state.
 * @param features - The registered features.
 */
export function declareScenes(
  scene: SceneState,
  features: ReadonlyArray<{ description: FeatureDescription }>
): void {
  const declared = emptyIds();

  for (const feature of features) {
    const list: unknown = feature.description.scenes;

    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      const id = sceneIdOf(entry);

      if (id !== undefined) declared.add(id);
    }
  }

  scene.declared = declared;
}

/**
 * Throws for a name in a system's `scenes` that no feature declares as a scene: such a system
 * would never run. Nothing is checked before start, when the declared scenes are not known yet.
 * The caller guards it for dev builds.
 *
 * @param scene - The scene state.
 * @param definition - The system being registered.
 * @throws {Error} When a name in `scenes` is not a declared scene.
 */
export function checkScenes(scene: SceneState, definition: AnySystem): void {
  const declared = scene.declared;

  if (declared === undefined || definition.scenes === undefined) return;

  for (const name of definition.scenes) {
    if (declared.has(name)) continue;

    const known = [...declared].join(", ") || "none";

    throw new Error(
      `[game] System "${definition.name}" runs on the scene "${name}", which no feature declares.\n` +
        `  Name a scene a feature lists in its scenes (declared: ${known}).`
    );
  }
}

/**
 * Mounts a scene for the systems: the scene mounted before starts leaving. The same scene again
 * changes nothing.
 *
 * @param scene - The scene state.
 * @param id - The id of the scene now mounted.
 */
export function mountScene(scene: SceneState, id: string): void {
  const before = scene.mounted;

  if (before === id) return;
  if (before !== undefined && !scene.leaving.includes(before)) scene.leaving.push(before);

  scene.mounted = id;
}

/**
 * Ends the leave of every leaving scene once nothing carries `Exiting`: the elements of the JSX
 * views of the scenes before played their exit. Called at the start of a phase while a scene leaves.
 *
 * @param state - The ecs branch of the plugin state.
 */
export function endLeaving(state: EcsState): void {
  const exiting = state.stores.get(Exiting.componentName);

  if (exiting !== undefined && exiting.size > 0) return;

  // Popped, not cut: the array keeps its storage for the next switch.
  const leaving = state.scene.leaving;

  while (leaving.length > 0) leaving.pop();
}

/**
 * Tells whether one of a system's scenes is mounted or leaving.
 *
 * @param scene - The scene state.
 * @param names - The system's `scenes`.
 * @returns True when the system may run.
 */
export function onScene(scene: SceneState, names: readonly string[]): boolean {
  const { mounted, leaving } = scene;
  const count = names.length;
  const left = leaving.length;

  // Per scoped system: index loops over two short lists, string identity first.
  for (let index = 0; index < count; index += 1) {
    const name = names[index];

    if (name === undefined) continue;
    if (name === mounted) return true;

    for (let at = 0; at < left; at += 1) {
      if (leaving[at] === name) return true;
    }
  }

  return false;
}
