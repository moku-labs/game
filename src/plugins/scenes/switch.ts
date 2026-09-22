/**
 * @file scenes plugin — the switch, run inside the awaited `flow.onEnter("scene")` callback. It
 * loads the bundle first and touches the world in one synchronous block, so the renderer never
 * sees a scene half built.
 */
import type { NodeInfo } from "../flow/types";
import type { EmitChanged, RunContext, SceneDefinition, ScenesCtx } from "./types";

/**
 * A promise that resolves when the node was aborted. Already aborted resolves at once.
 *
 * @param signal - The abort signal of the node being entered.
 * @returns A promise that resolves on abort and never rejects.
 */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve();

      return;
    }

    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Loads the bundle of the scene and returns as soon as the load settles or the node is aborted.
 * A load that fails while the node still runs is rethrown, so `flow` rolls the node back; one
 * that fails after the abort is logged, because nobody waits for it any more.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle of the scene being entered.
 * @param signal - The abort signal of the node.
 * @returns A promise that resolves when the load settled or the node was aborted.
 * @throws {Error} Whatever the load rejected with, while the node was not aborted.
 */
async function untilAborted(ctx: ScenesCtx, bundle: string, signal: AbortSignal): Promise<void> {
  const load: { failed: boolean; error: unknown } = { failed: false, error: undefined };
  const settled = ctx.deps.assets.load(bundle).catch((error: unknown) => {
    load.failed = true;
    load.error = error;

    if (signal.aborted) ctx.log.warn("scenes: a cancelled bundle load failed", { bundle, error });
  });

  await Promise.race([settled, whenAborted(signal)]);

  if (load.failed && !signal.aborted) throw load.error;
}

/**
 * Reads the scene the node asks for. In fast mode a transit node only records it: the walk passes
 * through many of them and the picture is built once, at the rest point.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @returns The scene id to switch to, or `undefined` when nothing has to happen.
 */
function targetOf(ctx: ScenesCtx, node: NodeInfo, run: RunContext): string | undefined {
  const state = ctx.state;

  if (run.mode === "fast" && !node.rest) {
    if (node.scene !== undefined) state.pending = node.scene;

    return undefined;
  }

  if (!node.rest) return node.scene;

  const target = node.scene ?? state.pending;

  state.pending = undefined;

  if (target === undefined && state.current === undefined) {
    ctx.log.warn("scenes: a rest node was entered with no scene", { path: node.path });
  }

  return target;
}

/**
 * Builds the scene in one synchronous block: the layers, then the projections of the old scene
 * out, then the ones of the new scene in, then the frame loop out of its idle cap, and only then
 * the event.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene whose bundle is there.
 */
function apply(ctx: ScenesCtx, scene: SceneDefinition): void {
  const state = ctx.state;
  const projection = ctx.deps.world.projection;
  const from = state.current;
  const previous = from === undefined ? undefined : state.scenes.get(from);

  projection.setLayers(scene.layers);

  if (previous !== undefined) projection.unmount(previous.projections);

  projection.mount(scene.projections, state.owner);
  state.current = scene.id;
  // A fresh picture is drawn at the full frame rate, even when the loop had gone idle.
  ctx.deps.time.wake();

  // The one narrowing of the plugin: see the note on `KernelSlice`. Only `emit` is cast.
  const emit = ctx.emit as EmitChanged;

  emit("scenes:changed", { from, to: scene.id, music: scene.music });
}

/**
 * The `scene` stage of entering a node: the whole switch. An `over` node never switches, a node
 * without a scene keeps the current one, and an aborted node returns without touching anything.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @returns A promise that resolves once the scene stands, or at once when nothing changed.
 * @throws {Error} For a scene id no feature declared. A failed load and a failed `mount` also
 *   reject, so `flow` rolls the node back with the old scene still mounted.
 * @example
 * ```ts
 * // The graph entered the rest node of the board. `node` is what the runner handed over.
 * await enterScene(ctx, node, { mode: "live", signal: controller.signal });
 *
 * ctx.state.current; // "board"
 * ```
 */
export async function enterScene(ctx: ScenesCtx, node: NodeInfo, run: RunContext): Promise<void> {
  if (node.over) {
    if (node.scene !== undefined) {
      ctx.log.warn("scenes: an over node cannot name a scene", { path: node.path });
    }

    return;
  }

  const target = targetOf(ctx, node, run);

  if (target === undefined || target === ctx.state.current) return;

  const scene = ctx.state.scenes.get(target);

  if (scene === undefined) {
    throw new Error(
      `[game] Scene "${target}" is not registered.\n  List it in the scenes of a feature.`
    );
  }

  await untilAborted(ctx, scene.bundle, run.signal);

  if (run.signal.aborted) return;

  apply(ctx, scene);
}
