/**
 * @file scenes plugin — what a live switch shows over the scene being left (spec 33, slices A2 and A3): a veil from the
 * `begin` stage of the node that switches, before the `load` stage downloads its bundles, so a cold first visit reacts in
 * the next frame, and a loader when the switch is not done `afterMs` after its start. The scene being left decides: its
 * `leave` over `config.leave` over the engine's default, field by field. The renderer draws both
 * (`renderer.sync.leave`); this file resolves the look, mounts a loader projection once its loader is due, and lands
 * the look at the swap or drops it on an abort, a throw, or at the next node when its own never reached the swap.
 */
import type { LeaveLoader, LeaveLook } from "../renderer/types";
import { Layer } from "../world/ecs/define";
import type {
  FullCover,
  FullLeave,
  FullLoader,
  Leaving,
  RunContext,
  SceneCover,
  SceneDefinition,
  SceneLeave,
  SceneLoader,
  ScenesCtx,
  State
} from "./types";

/**
 * What a game gets when it writes nothing: black at 45 %, 150 ms in and out, the engine's ring once the switch took
 * 400 ms. The level under `config.leave`, and where a part written over `false` starts. `index.ts` writes the same
 * value inline as the plugin's default config; a test pins the two equal.
 */
export const FALLBACK_LEAVE: {
  readonly cover: Readonly<FullCover>;
  readonly loader: Readonly<FullLoader>;
} = Object.freeze({
  cover: Object.freeze({ color: 0x00_00_00, alpha: 0.45, inMs: 150, outMs: 150 }),
  loader: Object.freeze({ afterMs: 400 })
});

/**
 * Merges one level's veil over the one below, field by field. `false` turns it off; a veil written over `false`
 * starts from the engine's.
 *
 * @param below - The veil of the levels below, or `false`.
 * @param over - What this level writes: nothing, `false` or fields.
 * @returns The veil, or `false`.
 * @example
 * ```ts
 * coverOver(false, { alpha: 0.6 }); // { color: 0, alpha: 0.6, inMs: 150, outMs: 150 }
 * ```
 */
function coverOver(
  below: Readonly<FullCover> | false,
  over: SceneCover | false | undefined
): Readonly<FullCover> | false {
  if (over === undefined) return below;
  if (over === false) return false;

  const base = below === false ? FALLBACK_LEAVE.cover : below;

  return {
    color: over.color ?? base.color,
    alpha: over.alpha ?? base.alpha,
    inMs: over.inMs ?? base.inMs,
    outMs: over.outMs ?? base.outMs
  };
}

/**
 * The look of a loader: its projection, else its texture, else nothing (the engine's ring).
 *
 * @param loader - A level that names a look, or the level below.
 * @returns At most one of the two fields.
 * @example
 * ```ts
 * lookOf({ texture: "ui.loader.ring", projection: "loading" }); // { projection: "loading" }
 * ```
 */
function lookOf(loader: Readonly<SceneLoader> | Readonly<FullLoader>): {
  texture?: string;
  projection?: string;
} {
  if (loader.projection !== undefined) return { projection: loader.projection };
  if (loader.texture !== undefined) return { texture: loader.texture };

  return {};
}

/**
 * Merges one level's loader over the one below. `afterMs` is a field of its own; `texture` and `projection` are one
 * choice: a level that names either replaces both of the level below. `false` turns it off; a loader written over
 * `false` starts from the engine's.
 *
 * @param below - The loader of the levels below, or `false`.
 * @param over - What this level writes: nothing, `false` or fields.
 * @returns The loader, or `false`.
 * @example
 * ```ts
 * loaderOver({ afterMs: 400, projection: "loading" }, { texture: "ui.loader.ring" }); // { afterMs: 400, texture: "ui.loader.ring" }
 * ```
 */
function loaderOver(
  below: Readonly<FullLoader> | false,
  over: SceneLoader | false | undefined
): Readonly<FullLoader> | false {
  if (over === undefined) return below;
  if (over === false) return false;

  const base = below === false ? FALLBACK_LEAVE.loader : below;
  const named = over.texture !== undefined || over.projection !== undefined;

  return { afterMs: over.afterMs ?? base.afterMs, ...lookOf(named ? over : base) };
}

/**
 * Resolves what a switch shows over the scene being left: the scene's `leave` over the config's over the engine's,
 * field by field. `false` at a level turns both parts off there.
 *
 * @param config - `config.leave`.
 * @param scene - The `leave` of the scene being left.
 * @returns Both parts, each resolved or `false`; `undefined` when both are off.
 * @example
 * ```ts
 * leaveOf({ loader: false }, { cover: { alpha: 0.6 } }); // { cover: { color: 0, alpha: 0.6, inMs: 150, outMs: 150 }, loader: false }
 * ```
 */
export function leaveOf(
  config: SceneLeave | undefined,
  scene: SceneLeave | undefined
): FullLeave | undefined {
  let cover: Readonly<FullCover> | false = FALLBACK_LEAVE.cover;
  let loader: Readonly<FullLoader> | false = FALLBACK_LEAVE.loader;

  for (const level of [config, scene]) {
    if (level === false) {
      cover = false;
      loader = false;
    } else if (level !== undefined) {
      cover = coverOver(cover, level.cover);
      loader = loaderOver(loader, level.loader);
    }
  }

  if (cover === false && loader === false) return undefined;

  return { cover, loader };
}

/**
 * The layer a mounted projection's views draw in, read from its first view.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The projection.
 * @returns The layer, or `undefined` while it has no view.
 */
function layerOf(ctx: ScenesCtx, name: string): string | undefined {
  const { projection, ecs } = ctx.deps.world;
  const entity = projection.entitiesOf(name)[0];

  return entity === undefined ? undefined : ecs.get(entity, Layer)?.name;
}

/**
 * Unmounts the loader projection a switch mounted, once: one it did not mount is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param leaving - The look of the switch.
 */
function unmountLoader(ctx: ScenesCtx, leaving: Leaving): void {
  const name = leaving.projection;

  if (name === undefined) return;

  delete leaving.projection;
  ctx.deps.world.projection.unmount([name]);
}

/**
 * Mounts a loader projection for the switch, unless it is mounted already (by another owner): such a one is drawn as it
 * is and never unmounted by the switch. A mount that throws (an unknown name, a layer the scene being left does not
 * declare) is warned.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader projection.
 * @param from - The scene being left.
 * @param leaving - The look of the switch: it keeps the name to unmount at the end.
 * @returns False when the mount threw.
 */
function mountOnce(ctx: ScenesCtx, name: string, from: SceneDefinition, leaving: Leaving): boolean {
  const projection = ctx.deps.world.projection;

  if (projection.entitiesOf(name).length > 0) return true;

  try {
    projection.mount([name], ctx.state.owner);
  } catch (error) {
    ctx.log.warn("scenes:loader-unmounted", { projection: name, scene: from.id, error });

    return false;
  }

  // Recorded right after the mount: an abort or a throw from here on unmounts it.
  leaving.projection = name;

  return true;
}

/**
 * Tells whether a projection of the scene being left draws in a layer: lifted above the veil, that layer would take
 * the scene's own views with it.
 *
 * @param ctx - Domain context of the plugin.
 * @param from - The scene being left.
 * @param layer - The layer of the loader.
 * @returns True when one of its projections has a view in that layer.
 */
function sharesLayer(ctx: ScenesCtx, from: SceneDefinition, layer: string): boolean {
  return from.projections.some(other => layerOf(ctx, other) === layer);
}

/**
 * Mounts a loader projection once its loader is due, called by the renderer in that frame, and answers the layer its
 * views draw in, which the renderer draws above the veil. A mount that throws, a layer a projection of the scene being
 * left draws in too, and a projection with no view give the engine's ring. A switch that ended meanwhile mounts
 * nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader projection.
 * @param from - The scene being left.
 * @param leaving - The look of the switch: it keeps the name to unmount at the end.
 * @returns The layer, or `undefined` for the ring.
 */
function mountLoader(
  ctx: ScenesCtx,
  name: string,
  from: SceneDefinition,
  leaving: Leaving
): string | undefined {
  // The switch landed or was dropped before the renderer asked: nothing to draw.
  if (leaving.done || !mountOnce(ctx, name, from, leaving)) return undefined;

  // The layer its views draw in; a projection with no view has none.
  const layer = layerOf(ctx, name);

  if (layer === undefined || !sharesLayer(ctx, from, layer)) return layer;

  // A shared layer would lift the scene's own views above the veil: the ring instead.
  ctx.log.warn("scenes:loader-layer-shared", { projection: name, layer, scene: from.id });
  unmountLoader(ctx, leaving);

  return undefined;
}

/**
 * The renderer's loader of a resolved one: a texture as it is, nothing for the ring, and for a projection the `due`
 * the renderer calls once the loader is due, which mounts it then: a switch done sooner never runs its `from` and
 * `view`. A projection a scene of the switch lists is no loader: warned, the ring.
 *
 * @param ctx - Domain context of the plugin.
 * @param loader - The resolved loader.
 * @param between - The scene being left and the scene being switched to.
 * @param between.from - The scene being left.
 * @param between.to - The scene being switched to.
 * @param leaving - The look of the switch.
 * @returns What the renderer draws.
 */
function loaderLook(
  ctx: ScenesCtx,
  loader: Readonly<FullLoader>,
  between: { from: SceneDefinition; to: SceneDefinition },
  leaving: Leaving
): LeaveLoader {
  const { afterMs, texture, projection } = loader;
  const { from, to } = between;

  if (texture !== undefined) return { afterMs, texture };
  if (projection === undefined) return { afterMs };

  if (from.projections.includes(projection) || to.projections.includes(projection)) {
    ctx.log.warn("scenes:loader-listed", { projection, from: from.id, to: to.id });

    return { afterMs };
  }

  return { afterMs, due: () => mountLoader(ctx, projection, from, leaving) };
}

/**
 * Tells whether a switch shows anything over the scene being left: a real change of scene, a live run that was not
 * aborted, a world that runs live, a drawing renderer. The first scene of a run, a fast walk, a world walking fast or
 * paused and a headless app show nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal.
 * @returns The scene being left, or `undefined` when nothing is shown.
 */
function leftScene(ctx: ScenesCtx, run: RunContext): SceneDefinition | undefined {
  const current = ctx.state.current;

  if (current === undefined || run.mode !== "live" || run.signal.aborted) return undefined;
  // A node entered live while the world walks fast or stands paused (the restore of a repro) switches in one block.
  if (ctx.deps.world.ecs.mode() !== "live" || !ctx.deps.renderer.host.ready()) return undefined;

  return ctx.state.scenes.get(current);
}

/**
 * Shows the veil and the loader of a switch that starts now, before its bundles are awaited: the scene being left
 * decides. A loader projection is mounted only once its loader is due. An abort of the node drops both at once, from
 * its listener. The look keeps the node's signal, so the `scene` stage of the same node takes it over.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene being switched to.
 * @param run - The runner's mode and signal.
 * @returns The look of the switch, or `undefined` when it shows nothing.
 */
export function startLeave(
  ctx: ScenesCtx,
  scene: SceneDefinition,
  run: RunContext
): Leaving | undefined {
  // Whether this switch shows anything, and what: the scene being left decides.
  const from = leftScene(ctx, run);

  if (from === undefined) return undefined;

  const leave = leaveOf(ctx.config.leave, from.leave);

  if (leave === undefined) return undefined;

  // The record of the switch's look; `off`, by aborting `listening`, takes its abort listener away.
  const listening = new AbortController();
  const leaving: Leaving = { signal: run.signal, done: false, off: (): void => listening.abort() };

  // The look the renderer draws: only the parts that are on.
  const look: LeaveLook = {};

  if (leave.cover !== false) look.cover = leave.cover;
  if (leave.loader !== false) {
    look.loader = loaderLook(ctx, leave.loader, { from, to: scene }, leaving);
  }

  // Shown now, before the bundles are awaited; an abort of the node drops it at once.
  ctx.deps.renderer.sync.leave.show(look);
  run.signal.addEventListener("abort", () => endLeave(ctx, leaving, "drop"), {
    once: true,
    signal: listening.signal
  });
  ctx.state.leaving = leaving;

  return leaving;
}

/**
 * The look the `begin` stage of this node started: its `scene` stage takes it over instead of starting a second one.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal of the node.
 * @returns The running look of this node, or `undefined`.
 */
export function ownLeave(ctx: ScenesCtx, run: RunContext): Leaving | undefined {
  const leaving = ctx.state.leaving;

  return leaving?.signal === run.signal ? leaving : undefined;
}

/**
 * Drops a look still running when another node is entered: the node that started it never reached its swap, because a
 * stage after its `begin` threw (a download that failed) and flow rolled back. An abort drops a look from its listener,
 * but a throw aborts nothing, so the next node entered (the rest node the rollback returned to) drops it here.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal of the node being entered.
 */
export function dropLeftOver(ctx: ScenesCtx, run: RunContext): void {
  const leaving = ctx.state.leaving;

  if (leaving !== undefined && leaving.signal !== run.signal) endLeave(ctx, leaving, "drop");
}

/**
 * Ends the look of a switch once: `"land"` at the swap (the loader goes, the veil fades out over the next scene),
 * `"drop"` on an abort or a throw (both go at once). A loader projection mounted for the wait is unmounted. A look
 * ended already, or a switch that showed nothing, is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param leaving - The look of the switch.
 * @param how - `"land"` after the swap, `"drop"` without one.
 */
export function endLeave(ctx: ScenesCtx, leaving: Leaving | undefined, how: "land" | "drop"): void {
  if (leaving === undefined || leaving.done) return;

  leaving.done = true;
  leaving.off();
  if (ctx.state.leaving === leaving) delete ctx.state.leaving;

  const leave = ctx.deps.renderer.sync.leave;

  if (how === "land") leave.land();
  else leave.drop();

  unmountLoader(ctx, leaving);
}

/**
 * Forgets the look of a running switch when the plugin stops: its abort listener goes and a later end does nothing.
 * Nothing else is called: a teardown context may not call another plugin; the renderer drops the look at its own stop,
 * and `world.onStop` the loader projection.
 *
 * @param state - The plugin state.
 */
export function forgetLeave(state: State): void {
  const leaving = state.leaving;

  if (leaving === undefined) return;

  leaving.done = true;
  leaving.off();
  delete state.leaving;
}
