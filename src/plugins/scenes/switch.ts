/**
 * @file scenes plugin — the switch, run inside the awaited `flow.onEnter("scene")` callback. It
 * loads every bundle the scene names first and touches the world in one synchronous block, so the
 * renderer never sees a scene half built. In live mode it then waits until the textures of those
 * bundles are on the GPU. The upload queue sends `renderer.uploads` of them per drawn frame while
 * the old scene is still on screen, so the frame that shows the new scene uploads nothing. On a
 * Galaxy A26 the first switch to a board took one frame of 284 ms with 8 uploads in it (F61). At a node of the mounted scene it re-reads what the
 * scene names and awaits a bundle that is new, without mounting again.
 */
import type { NodeInfo } from "../flow/types";
import { namedBundles } from "./bundles";
import type { RunContext, SceneDefinition, SceneState, ScenesCtx } from "./types";

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
 * Waits for the textures of loaded bundles to reach the GPU, or for the abort. It never rejects:
 * a warm that fails (an unload during it) is logged and the switch goes on, its first draw
 * uploads as before. Headless, without a device or with `uploads: 0` the warms answer at once,
 * and textures already on the GPU are not waited for.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundles - The bundles the scene being entered names, all of them loaded.
 * @param signal - The abort signal of the node.
 * @returns A promise that resolves when every warm settled or the node was aborted.
 */
async function untilWarmed(
  ctx: ScenesCtx,
  bundles: readonly string[],
  signal: AbortSignal
): Promise<void> {
  const warms = bundles.map(bundle =>
    ctx.deps.assets.warm(bundle).catch((error: unknown) => {
      ctx.log.warn("scenes: a bundle's textures were not uploaded before the switch", {
        bundle,
        error
      });
    })
  );

  await Promise.race([Promise.all(warms), whenAborted(signal)]);
}

/**
 * Loads every bundle the scene names at once and returns as soon as all loads settled or the node
 * is aborted. The first load that fails while the node still runs is rethrown, so `flow` rolls
 * the node back; one that fails after the abort is logged, because nobody waits for it any more.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundles - The bundles the scene being entered names, its own bundle first.
 * @param signal - The abort signal of the node.
 * @returns A promise that resolves when the loads settled or the node was aborted.
 * @throws {Error} Whatever the first failed load rejected with, while the node was not aborted.
 */
async function untilAborted(
  ctx: ScenesCtx,
  bundles: readonly string[],
  signal: AbortSignal
): Promise<void> {
  const load: { failed: boolean; error: unknown } = { failed: false, error: undefined };
  const loads = bundles.map(bundle =>
    ctx.deps.assets.load(bundle).catch((error: unknown) => {
      if (!load.failed) {
        load.failed = true;
        load.error = error;
      }

      if (signal.aborted) ctx.log.warn("scenes: a cancelled bundle load failed", { bundle, error });
    })
  );

  await Promise.race([Promise.all(loads), whenAborted(signal)]);

  if (load.failed && !signal.aborted) throw load.error;
}

/**
 * Reads the committed state a scene's `bundles` gets: the frozen trees of the store, in a frozen
 * wrapper. During the scene stage no node writes, so it is the state the node is entered with.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The committed `player` and `session`.
 */
function committedState(ctx: ScenesCtx): SceneState {
  const { player, session } = ctx.deps.model.store.snapshot();

  return Object.freeze({ player, session });
}

/**
 * Tells whether two lists name the same bundles in the same order.
 *
 * @param left - One list.
 * @param right - The other list.
 * @returns True when both have the same names at the same places.
 * @example
 * ```ts
 * sameNames(["location", "ep01"], ["location", "ep02"]); // false
 * ```
 */
function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/**
 * Takes the expected scene and clears the record, so one `expect` mounts one scene.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The scene id that was recorded or expected, or `undefined` when there was none.
 */
function takePending(ctx: ScenesCtx): string | undefined {
  const target = ctx.state.pending;

  ctx.state.pending = undefined;

  return target;
}

/**
 * Tells whether the node is a transit node of a fast walk: the walk passes through it and builds
 * no scene there.
 *
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @returns True for a node without `rest` entered in fast mode.
 */
function isFastTransit(node: NodeInfo, run: RunContext): boolean {
  return run.mode === "fast" && !node.rest;
}

/**
 * Reads the scene the node asks for. In fast mode a transit node only records it: the walk passes
 * through many of them and the picture is built once, at the rest point. In live mode a transit
 * node without a scene of its own takes the expected one, so a restore at a popup that waits for
 * its answer builds the scene under it; one with its own scene leaves the record alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @returns The scene id to switch to, or `undefined` when nothing has to happen.
 */
function targetOf(ctx: ScenesCtx, node: NodeInfo, run: RunContext): string | undefined {
  const state = ctx.state;

  if (isFastTransit(node, run)) {
    state.pending = node.scene ?? state.pending;

    return undefined;
  }

  if (!node.rest) return node.scene ?? takePending(ctx);

  const target = node.scene ?? state.pending;

  state.pending = undefined;

  if (target === undefined && state.current === undefined) {
    ctx.log.warn("scenes: a rest node was entered with no scene", { path: node.path });
  }

  return target;
}

/**
 * Reads the scene an `over` node asks for. An over node takes the expected scene and clears the
 * record, whatever is mounted, so a restore at a popup builds the scene under it, whether the
 * popup rests or waits for its answer. With nothing expected it switches nothing. In fast mode an
 * over transit node takes nothing and leaves the record alone: a walk builds no scene on the way.
 * A scene the over node names itself is only warned about.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The over node being entered.
 * @param run - The runner's mode and signal.
 * @returns The expected scene id, or `undefined` when nothing has to happen.
 */
function overTargetOf(ctx: ScenesCtx, node: NodeInfo, run: RunContext): string | undefined {
  if (node.scene !== undefined) {
    ctx.log.warn("scenes: an over node cannot name a scene", { path: node.path });
  }

  if (isFastTransit(node, run)) return undefined;

  return takePending(ctx);
}

/**
 * The projections of the scene that leaves which the scene that comes does not list. A projection
 * both list stays mounted: the layers of a projection are the ones its spec names, and both scenes
 * declare them, so its views stay in the same layer containers.
 *
 * @param previous - The scene that leaves.
 * @param scene - The scene that comes.
 * @returns The names to unmount, in the order the leaving scene lists them.
 */
function leavingOf(previous: SceneDefinition, scene: SceneDefinition): readonly string[] {
  return previous.projections.filter(name => !scene.projections.includes(name));
}

/**
 * Builds the scene in one synchronous block: the layers, then the projections only the old scene
 * lists out, then the list of the new scene in (a projection both list stays and takes its new
 * place), the new scene to the world's systems, then the list the scene names to `assets`, then
 * the frame loop out of its idle cap and the adaptive frame rate told of the new screen, and only then the event.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene whose bundles are there.
 * @param named - The bundles the scene names, as they were awaited.
 */
function apply(ctx: ScenesCtx, scene: SceneDefinition, named: readonly string[]): void {
  const state = ctx.state;
  const projection = ctx.deps.world.projection;
  const from = state.current;
  const previous = from === undefined ? undefined : state.scenes.get(from);

  projection.setLayers(scene.layers);

  if (previous !== undefined) projection.unmount(leavingOf(previous, scene));

  projection.mount(scene.projections, state.owner);
  state.current = scene.id;
  // The systems with `scenes` run on the new scene from the next phase; the old one leaves.
  ctx.deps.world.ecs.setScene(scene.id);
  state.named = named;
  ctx.deps.assets.sceneBundles(named);
  // A fresh picture is drawn at the full frame rate, even when the loop had gone idle.
  ctx.deps.time.wake();
  // The adaptive frame rate judges the new screen on its own frames, its back-off started over.
  ctx.deps.time.sceneChanged();

  ctx.emit("scenes:changed", { from, to: scene.id, music: scene.music });

  // Inline and positive: the performance log of an agent build names the switch; a production
  // `define` folds the guard and the call goes.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    // eslint-disable-next-line unicorn/no-null -- the log is JSON: no scene before is `null`.
    ctx.deps.renderer.monitor.event("scene", { from: from ?? null, to: scene.id });
  }
}

/**
 * Switches to another scene: it reads what the scene names from the committed state, awaits all
 * of it and only then builds the scene. In live mode it waits between the two for the textures of
 * those bundles to reach the GPU; a fast walk does not, so tests and restores keep their pace. An
 * aborted node, or a plugin stopped during the wait, returns without touching anything.
 *
 * @param ctx - Domain context of the plugin.
 * @param target - Id of the scene to mount.
 * @param run - The runner's mode and signal.
 * @returns A promise that resolves once the scene stands, or the node was aborted.
 * @throws {Error} For a scene id no feature declared, and whatever `bundles` or a load threw.
 */
async function switchTo(ctx: ScenesCtx, target: string, run: RunContext): Promise<void> {
  const scene = ctx.state.scenes.get(target);

  if (scene === undefined) {
    throw new Error(
      `[game] Scene "${target}" is not registered.\n  List it in the scenes of a feature.`
    );
  }

  const named = namedBundles(scene, committedState(ctx));

  await untilAborted(ctx, named, run.signal);

  const warmsFirst = run.mode === "live" && !run.signal.aborted;

  if (warmsFirst) await untilWarmed(ctx, named, run.signal);

  // A stop resolves a waiting warm instead of rejecting it, before `flow` aborts the node.
  const stopped = ctx.state.teardown === undefined;

  if (run.signal.aborted || stopped) return;

  apply(ctx, scene, named);
}

/**
 * Reads again what the mounted scene names, at a node that keeps it: a bundle it names now and
 * did not before is awaited, and `assets` learns the new list. Nothing is mounted again, nothing
 * is emitted and the loop is not woken. A scene without `bundles` is never re-read.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal.
 * @returns A promise that resolves once the new bundles are in, at once when nothing changed.
 * @throws {Error} Whatever `bundles` or a load threw.
 */
async function reread(ctx: ScenesCtx, run: RunContext): Promise<void> {
  const state = ctx.state;
  const scene = state.current === undefined ? undefined : state.scenes.get(state.current);

  if (scene?.bundles === undefined) return;

  const named = namedBundles(scene, committedState(ctx));

  if (sameNames(named, state.named)) return;

  await untilAborted(ctx, named, run.signal);

  if (run.signal.aborted) return;

  state.named = named;
  ctx.deps.assets.sceneBundles(named);
}

/**
 * The `scene` stage of entering a node, on one of two paths. A node that asks for another scene
 * switches: every bundle the scene names for the committed state is awaited before the world is
 * touched. Any other node keeps the mounted scene and re-reads what it names, so a restore or a
 * recovery that changed the state awaits the new bundles before the node's gate opens. A transit
 * node of a fast walk does neither. An `over` node switches only to an expected scene, and an
 * aborted node returns without touching anything.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @param run - The runner's mode and signal.
 * @returns A promise that resolves once the scene stands, or at once when nothing changed.
 * @throws {Error} For a scene id no feature declared, and for a `bundles` that throws or returns
 *   something that is not a list of names. A failed load and a failed `mount` also reject, so
 *   `flow` rolls the node back with the old scene still mounted.
 */
export async function enterScene(ctx: ScenesCtx, node: NodeInfo, run: RunContext): Promise<void> {
  const target = node.over ? overTargetOf(ctx, node, run) : targetOf(ctx, node, run);

  if (target !== undefined && target !== ctx.state.current) {
    await switchTo(ctx, target, run);

    return;
  }

  if (isFastTransit(node, run)) return;

  await reread(ctx, run);
}
