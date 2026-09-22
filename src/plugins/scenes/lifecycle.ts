/**
 * @file scenes plugin — lifecycle: the scenes read out of the feature descriptions in `onStart`,
 * the one `onEnter` registration, and the teardown that removes exactly that registration.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { worldPlugin } from "../world";
import { enterScene } from "./switch";
import type { Deps, KernelSlice, SceneDefinition, ScenesCtx, State } from "./types";

/**
 * Resolves the dependency APIs `flow`, `world` and `assets` with `ctx.require`.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The three dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    flow: ctx.require(flowPlugin),
    world: ctx.require(worldPlugin),
    assets: ctx.require(assetsPlugin)
  };
}

/**
 * Builds the domain context the switch and the API share.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The domain context of the scenes plugin.
 */
export function withDeps(ctx: KernelSlice): ScenesCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
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
 * ```
 */
function isSceneDefinition(entry: unknown): entry is SceneDefinition {
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

/**
 * Records which feature declared which scene, so a duplicate id can name both of them.
 *
 * @returns An empty table of scene id to feature name.
 */
function emptyOwners(): Map<string, string> {
  return new Map();
}

/**
 * Reads the `scenes` key of every registered feature into the registry. Features register in
 * their own `onInit`, which runs before this `onStart`, so every scene of the game is here.
 *
 * @param ctx - Domain context of the plugin.
 * @throws {Error} When two features declare the same scene id.
 */
function readScenes(ctx: ScenesCtx): void {
  const owners = emptyOwners();

  for (const feature of ctx.deps.flow.features.all()) {
    const list: unknown = feature.description.scenes;

    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      if (!isSceneDefinition(entry)) continue;

      const owner = owners.get(entry.id);

      if (owner !== undefined) {
        throw new Error(
          `[game] Scene "${entry.id}" is declared by the features "${owner}" and "${feature.name}".\n` +
            "  Give one of the two scenes another id."
        );
      }

      owners.set(entry.id, feature.name);
      ctx.state.scenes.set(entry.id, entry);
    }
  }
}

/**
 * Starts the plugin in `onStart`: it collects the scenes of the features and registers the one
 * callback that switches them, on the `scene` stage of entering a node.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @throws {Error} When two features declare the same scene id.
 * @example
 * ```ts
 * startScenes(ctx);
 * ctx.state.scenes.get("board")?.bundle; // "board", read out of the feature description
 * ```
 */
export function startScenes(ctx: KernelSlice): void {
  const scenes = withDeps(ctx);

  readScenes(scenes);

  scenes.state.teardown = scenes.deps.flow.onEnter("scene", (node, run) =>
    enterScene(scenes, node, run)
  );
}

/**
 * Removes the `onEnter` callback in `onStop` and forgets every scene. Nothing is unmounted: a
 * teardown context may not call another plugin, and `world.onStop` clears every entity anyway.
 *
 * @param teardown - What the teardown context carries.
 * @param teardown.state - The plugin state.
 * @example
 * ```ts
 * stopScenes({ state });
 * state.scenes.size; // 0, and the runner calls this plugin no more
 * ```
 */
export function stopScenes(teardown: { state: State }): void {
  const state = teardown.state;

  state.teardown?.();
  state.teardown = undefined;
  state.scenes.clear();
  state.current = undefined;
  state.pending = undefined;
}
