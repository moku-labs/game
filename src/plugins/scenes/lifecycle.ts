/**
 * @file scenes plugin — lifecycle: the config checked in `onInit`, the scenes read out of the
 * feature descriptions in `onStart`, the two `onEnter` registrations (`begin` and `scene`), and the
 * teardown that removes exactly those registrations.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { dropBuild, isPositiveFinite } from "./build";
import { isSceneDefinition } from "./bundles";
import { forgetLeave } from "./leave";
import { checkLeave } from "./leave-check";
import { beginScene, enterScene } from "./switch";
import type { Config, Deps, KernelSlice, ScenesCtx, State } from "./types";

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
 * Refuses a config a switch cannot run with, in `onInit`, so `createApp` throws: a building budget
 * that is neither `"auto"` nor a finite number above 0, and a `leave` of the wrong shape. A game
 * written in plain JS passes anything, so the config is a boundary.
 *
 * @param config - The resolved config of the plugin.
 * @throws {Error} When `buildMs` is neither `"auto"` nor a finite number above 0, and for a `leave`
 *   `checkLeave` refuses.
 */
export function checkConfig(config: Readonly<Config>): void {
  const value: unknown = config.buildMs;

  checkLeave("scenes.leave", config.leave);

  if (value === "auto") return;
  if (isPositiveFinite(value)) return;

  throw new Error(
    `[game] scenes.buildMs is ${String(value)}.\n` +
      '  Give "auto" or the milliseconds a frame may spend on the next scene, a finite number above 0 such as 4.'
  );
}

/**
 * Starts the plugin in `onStart`: it collects the scenes of the features and registers two
 * callbacks of entering a node: at `begin` the look of the scene being left, before `assets`
 * downloads anything at `load`, and at `scene` the switch.
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

  const flow = scenes.deps.flow;
  const offBegin = flow.onEnter("begin", (node, run) => beginScene(scenes, node, run));
  const offScene = flow.onEnter("scene", (node, run) => enterScene(scenes, node, run));

  scenes.state.teardown = (): void => {
    offBegin();
    offScene();
  };
}

/**
 * Removes the two `onEnter` callbacks in `onStop` and forgets every scene and the bundles the mounted
 * one named. A running build loses its frame callback and its switch returns; the look of a running
 * switch loses its abort listener (the renderer drops it at its own stop). Nothing is unmounted
 * or discarded: a teardown context may not call another plugin, and `world.onStop` clears every
 * entity and the build table anyway.
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
  dropBuild(state.build);
  delete state.build;
  forgetLeave(state);
  state.scenes.clear();
  state.current = undefined;
  state.pending = undefined;
  state.named = [];
}
