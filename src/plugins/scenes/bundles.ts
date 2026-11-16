/**
 * @file scenes plugin — what a scene names: its bundle and the bundles its `bundles(state)`
 * returns, and the check that an entry of a feature's `scenes` list is a scene. Pure; read by the
 * switch and by `assets`, so both read a scene one way.
 */
import type { NamedMemo, SceneDefinition, SceneState } from "./types";

/**
 * Tells whether what a scene's `bundles` returned is a list of bundle names.
 *
 * @param value - The return value of `bundles(state)`.
 * @returns True for an array whose every entry is a string.
 * @example
 * ```ts
 * isNameList(["ep01", 3]); // false
 * ```
 */
function isNameList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(name => typeof name === "string");
}

/**
 * Lists the bundles a scene names for a committed state: its `bundle` first, then what its
 * `bundles(state)` returns, in order, each name once. An error the game's `bundles` throws
 * propagates unchanged. With a memo, a scene is asked once per committed state: while `player`
 * and `session` are the trees it last answered for, the same frozen list comes back and `bundles`
 * is not called (F194: the look-ahead asked every scene of the neighbourhood at every rest).
 *
 * @param scene - The scene declaration.
 * @param state - The committed player and session, frozen.
 * @param memo - The last answer of each scene, kept by the plugin that asks; none to ask every time.
 * @returns The bundle names, the scene bundle first; frozen when they come from the memo.
 * @throws {Error} When `bundles` returns something that is not a list of names.
 * @example
 * ```ts
 * // assets pins what the scene of the node being entered names, read from the committed state.
 * const { player, session } = model.store.snapshot();
 * namedBundles(wardScene, { player, session }); // ["location", "ep01"] while session.episode is "ep01"
 * ```
 */
export function namedBundles(
  scene: SceneDefinition,
  state: SceneState,
  memo?: WeakMap<SceneDefinition, NamedMemo>
): readonly string[] {
  const known = memo?.get(scene);

  if (known !== undefined && known.player === state.player && known.session === state.session) {
    return known.names;
  }

  const names = Object.freeze(readNames(scene, state));

  memo?.set(scene, { player: state.player, session: state.session, names });

  return names;
}

/**
 * Asks a scene for its bundles: its `bundle`, then what `bundles(state)` returns, each name once.
 *
 * @param scene - The scene declaration.
 * @param state - The committed player and session, frozen.
 * @returns A new list of names, the scene bundle first.
 * @throws {Error} When `bundles` returns something that is not a list of names.
 */
function readNames(scene: SceneDefinition, state: SceneState): string[] {
  const names = [scene.bundle];

  if (scene.bundles === undefined) return names;

  const listed: unknown = scene.bundles(state);

  if (!isNameList(listed)) {
    throw new Error(
      `[game] Scene "${scene.id}": bundles() must return a list of bundle names.\n` +
        '  Return the bundle keys the scene needs, such as ["ep01"].'
    );
  }

  for (const name of listed) {
    if (!names.includes(name)) names.push(name);
  }

  return names;
}

/**
 * Tells whether the `bundles` slot of an entry can be called: absent, `undefined` or a function.
 *
 * @param entry - One entry of a feature's `scenes` list.
 * @returns True when the switch can call what the slot holds, or there is nothing to call.
 * @example
 * ```ts
 * hasCallableBundles({ bundles: 3 }); // false
 * ```
 */
function hasCallableBundles(entry: object): boolean {
  if (!("bundles" in entry)) return true;

  return entry.bundles === undefined || typeof entry.bundles === "function";
}

/**
 * Tells whether one entry of a feature's `scenes` list is a scene declaration. The key carries
 * whatever the game put there, so an entry that is not one is skipped instead of crashing.
 *
 * @param entry - One entry of the list.
 * @returns True when the entry can be read as a scene.
 * @example
 * ```ts
 * isSceneDefinition({ id: "board", bundle: "board", layers: [], projections: [] }); // true
 * isSceneDefinition("board"); // false: a scene is an object
 * isSceneDefinition({ id: "ward", bundle: "location", layers: [], projections: [], bundles: 3 }); // false
 * ```
 */
export function isSceneDefinition(entry: unknown): entry is SceneDefinition {
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
    Array.isArray(entry.projections) &&
    hasCallableBundles(entry)
  );
}
