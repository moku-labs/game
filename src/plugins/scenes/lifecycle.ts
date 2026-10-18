/**
 * @file scenes plugin — lifecycle: the scenes read out of the feature descriptions in `onStart`,
 * the one `onEnter` registration, and the teardown that removes exactly that registration.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { isSceneDefinition } from "./bundles";
import { enterScene } from "./switch";
import type { Deps, KernelSlice, ScenesCtx, State } from "./types";

/**
 * Resolves the dependency APIs `flow`, `world`, `assets`, `time`, `model` and `renderer` with
 * `ctx.require`.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The six dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    flow: ctx.require(flowPlugin),
    world: ctx.require(worldPlugin),
    assets: ctx.require(assetsPlugin),
    time: ctx.require(timePlugin),
    model: ctx.require(modelPlugin),
    renderer: ctx.require(rendererPlugin)
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
 * Reads the `scenes` key of every registered feature into the registry, and which feature declared
 * each scene: a duplicate id names both, and the switch holds the declaring feature while its
 * scene is mounted. Features register in their own `onInit`, which runs before this `onStart`, so
 * every scene of the game is here.
 *
 * @param ctx - Domain context of the plugin.
 * @throws {Error} When two features declare the same scene id.
 */
function readScenes(ctx: ScenesCtx): void {
  const owners = ctx.state.owners;

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
 * Removes the `onEnter` callback in `onStop` and forgets every scene, the bundles the mounted
 * one named and the hold on its feature. Nothing is unmounted and nothing is released: a teardown
 * context may not call another plugin, and `world.onStop` clears every entity and its scope anyway.
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
  state.owners.clear();
  state.held = undefined;
  state.current = undefined;
  state.pending = undefined;
  state.named = [];
}
