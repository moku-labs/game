/**
 * @file assets plugin — lifecycle: the seven registrations of `onInit`, the boot of `onStart`
 * and the teardown that frees every texture and cancels every fetch.
 */
import { flowPlugin } from "../flow";
import type { Descriptor, Hint, NodeInfo } from "../flow/types";
import { modelPlugin } from "../model";
import { rendererPlugin } from "../renderer";
import { isSceneDefinition } from "../scenes/bundles";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { Exiting, system } from "../world/ecs/define";
import { lookupTexture } from "./api";
import { createBrowserIo } from "./browser";
import { releaseAssets, releaseLeftBundles, releaseSceneLeft } from "./budget";
import { bundlesOfNode } from "./preload";
import { answerReady } from "./ready";
import { bootTiers, loadBundle } from "./tiers";
import type { AssetsCtx, AssetsIo, Deps, KernelSlice, LoadResult, State } from "./types";

/** What `onEnter` and an effect handler both hand over. */
type RunContext = { mode: "live" | "fast"; signal: AbortSignal };

/**
 * Resolves the dependency APIs `flow`, `renderer`, `time`, `model` and `world` with `ctx.require`.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @returns The five dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    flow: ctx.require(flowPlugin),
    renderer: ctx.require(rendererPlugin),
    time: ctx.require(timePlugin),
    model: ctx.require(modelPlugin),
    world: ctx.require(worldPlugin)
  };
}

/**
 * Builds the domain context the files of the plugin share.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @returns The domain context.
 */
export function withDeps(ctx: KernelSlice): AssetsCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Reads the bundle names out of a `load` or a `ready` descriptor.
 *
 * @param descriptor - What the node awaited.
 * @returns The bundle names, in the order the node listed them.
 * @example
 * ```ts
 * bundlesOfDescriptor({ kind: "load", payload: { bundles: ["board"] } }); // ["board"]
 * ```
 */
function bundlesOfDescriptor(descriptor: Descriptor | Hint): string[] {
  const payload: unknown = descriptor.payload;

  if (typeof payload !== "object" || payload === null) return [];

  const list: unknown = (payload as { bundles?: unknown }).bundles;

  if (!Array.isArray(list)) return [];

  return list.filter((name): name is string => typeof name === "string");
}

/**
 * The handler of the `load` effect. It loads the bundles of the payload one after another with
 * the node's signal and reports what arrived, so a loading node can write its own progress.
 * It writes no game state.
 *
 * @param ctx - Domain context of the plugin.
 * @param descriptor - The descriptor the node awaited.
 * @param run - The node's mode and signal.
 * @returns What was loaded and what it cost.
 */
async function runLoadEffect(
  ctx: AssetsCtx,
  descriptor: Descriptor | Hint,
  run: RunContext
): Promise<LoadResult> {
  const loaded: string[] = [];
  let mb = 0;

  if (ctx.state.io === undefined) return { loaded, mb };

  for (const name of bundlesOfDescriptor(descriptor)) {
    await loadBundle(ctx, name, run.signal, "request");
    loaded.push(name);
    mb += ctx.state.manifest.bundles[name]?.mb ?? 0;
  }

  return { loaded, mb: Number(mb.toFixed(3)) };
}

/**
 * Runs the release a live rest marked, once: the arriving node's bundles are pinned by now, so a
 * bundle its scene names is held. A fast entry clears the mark and releases nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal.
 */
function releaseMarkedRest(ctx: AssetsCtx, run: RunContext): void {
  if (!ctx.state.restPending) return;

  ctx.state.restPending = false;

  if (run.mode === "live") releaseLeftBundles(ctx);
}

/**
 * The `load` stage of entering a node: the bundles of the node become the pinned set, the release
 * a rest marked runs, and in live mode the node waits for its bundles. A bundle the preload did not
 * reach is a dev warning, except a `"leave"` bundle, which the preload skips on purpose.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @throws {Error} When the `bundles` of the node's scene throws: flow rolls the node back.
 */
async function enterNode(ctx: AssetsCtx, node: NodeInfo, run: RunContext): Promise<void> {
  const state = ctx.state;
  const bundles = bundlesOfNode(ctx, node);

  state.current = node;
  state.pinned = new Set(bundles);
  if (node.scene !== undefined && state.scenes.has(node.scene)) state.sceneId = node.scene;

  releaseMarkedRest(ctx, run);

  if (state.io === undefined || run.mode === "fast") return;

  for (const name of bundles) {
    const isLeaving = state.manifest.bundles[name]?.release === "leave";

    if (state.records.get(name)?.status !== "loaded" && !isLeaving) {
      ctx.log.warn("assets: the node waited for a bundle", { bundle: name, path: node.path });
    }

    await loadBundle(ctx, name, run.signal, "enter");
  }
}

/**
 * Connects the plugin in `onInit`: the `load` stage of `onEnter`, the handlers of the `load` and
 * the `ready` effects (F52), both run in fast mode too, the texture provider of `renderer`, the
 * start and the end of an exit in `world`, counted, and the system `assets.leave` of phase `sync`,
 * which lets a leaving scene's bundles go once its elements played their exit (F51). The seven
 * removers go to the state, because `onStop` has nothing but the state.
 *
 * @param ctx - Kernel context of the assets plugin.
 */
export function connectAssets(ctx: KernelSlice): void {
  const assets = withDeps(ctx);

  assets.state.removers.push(
    assets.deps.flow.onEnter("load", (node, run) => enterNode(assets, node, run)),
    assets.deps.flow.fx.handle(
      "load",
      (descriptor, run) => runLoadEffect(assets, descriptor, run),
      { runInFast: true }
    ),
    assets.deps.flow.fx.handle(
      "ready",
      descriptor => answerReady(assets, bundlesOfDescriptor(descriptor)),
      { runInFast: true }
    ),
    assets.deps.renderer.sync.textures.provide(key => lookupTexture(assets, key)),
    // The world's exits are counted (F51).
    assets.deps.world.ecs.onAdded(Exiting, () => {
      assets.state.exiting += 1;
    }),
    assets.deps.world.ecs.onRemoved(Exiting, () => {
      assets.state.exiting -= 1;
    }),
    // In phase `sync`, after the reconcile of `layout` tagged what leaves: a leaving scene with
    // nothing left exiting lets its bundles go (F51b).
    assets.deps.world.ecs.system(
      system({
        name: "assets.leave",
        phase: "sync",
        query: [],
        run: () => releaseSceneLeft(assets)
      })
    )
  );
}

/**
 * Picks the I/O seam: the configured one, the browser pair over `renderer.sync.textures` when
 * the renderer draws, or nothing at all, which is the headless mode.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The io, or `undefined` while headless.
 */
function pickIo(ctx: AssetsCtx): AssetsIo | undefined {
  if (ctx.config.io !== undefined) return ctx.config.io;
  if (!ctx.deps.renderer.host.ready()) return undefined;

  return createBrowserIo(ctx.deps.renderer);
}

/**
 * Reads one list out of a feature description.
 *
 * @param value - What the feature put under that key.
 * @returns The entries, or an empty list.
 */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads one own string property of a value that may be anything.
 *
 * @param entry - What the feature put in the list.
 * @param key - The property to read.
 * @returns The string, or `undefined`.
 * @example
 * ```ts
 * stringField({ id: "board" }, "id"); // "board"
 * ```
 */
function stringField(entry: unknown, key: string): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const value = Object.getOwnPropertyDescriptor(entry, key)?.value;

  return typeof value === "string" ? value : undefined;
}

/**
 * Records what the features brought: every scene by its id, and which feature owns a flow. Both
 * are read by the preload; the bundle maps themselves are checked by the boot sequence. An entry
 * of `scenes` that is not a scene declaration is skipped.
 *
 * @param ctx - Domain context of the plugin.
 */
function readFeatures(ctx: AssetsCtx): void {
  for (const feature of ctx.deps.flow.features.all()) {
    for (const scene of listOf(feature.description.scenes)) {
      if (isSceneDefinition(scene)) ctx.state.scenes.set(scene.id, scene);
    }

    for (const flow of listOf(feature.description.flows)) {
      const id = stringField(flow, "id");

      if (id !== undefined) ctx.state.featureOfFlow.set(id, feature.name);
    }
  }
}

/**
 * Starts the plugin in `onStart`: it picks the io, reads the feature descriptions and runs the
 * boot sequence. Only the manifest and the `boot` tier are awaited.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @returns A promise that resolves once the boot tier is there.
 * @throws {Error} In a browser, when the manifest or a boot bundle cannot be read.
 */
export async function startAssets(ctx: KernelSlice): Promise<void> {
  const assets = withDeps(ctx);

  assets.state.io = pickIo(assets);
  readFeatures(assets);

  await bootTiers(assets);
}

/**
 * Frees everything in `onStop`: the preload and every running load are aborted, every texture is
 * destroyed, the seven registrations are removed and the registries are emptied, the companions
 * too. A teardown context carries the state and nothing else, so no other plugin is called here:
 * no companion's `unload` either, its plugin stopped before this one.
 *
 * @param state - The plugin state.
 */
export function releaseAll(state: State): void {
  state.queue?.controller.abort();
  state.queue = undefined;

  for (const record of state.records.values()) {
    record.inflight?.controller.abort();
    releaseAssets(state.io, record);

    record.status = "idle";
    record.inflight = undefined;
  }

  for (const remove of state.removers) remove();
  state.removers.length = 0;

  state.records.clear();
  state.bundleOfKey.clear();
  state.scenes.clear();
  state.featureOfFlow.clear();
  state.pinned.clear();
  state.warned.clear();
  state.warmed.clear();
  state.readyFailed.clear();
  state.companions.length = 0;
  state.current = undefined;
  state.sceneId = undefined;
  state.sceneNamed = [];
  state.sceneLeaving = [];
  state.exiting = 0;
  state.restPending = false;
  state.stamps = undefined;
  state.swapping = undefined;
  state.io = undefined;
}
