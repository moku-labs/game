/**
 * @file scenes plugin — what a live switch shows over the scene being left (spec 33, slice A2): a veil from the switch
 * start, before the bundles are awaited, so a cold first visit reacts in the next frame, and a loader when the switch is
 * not done `afterMs` after its start. The scene being left decides: its `leave` over `config.leave` over the engine's
 * default, field by field. The renderer draws both (`renderer.sync.leave`); this file resolves the look, mounts a
 * loader projection for the wait, and lands the look at the swap or drops it on an abort or a throw.
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

/** The veil a game gets when it writes nothing: black at 45 %, 150 ms in, 150 ms out. */
const DEFAULT_COVER: Readonly<FullCover> = Object.freeze({
  color: 0x00_00_00,
  alpha: 0.45,
  inMs: 150,
  outMs: 150
});

/** The loader a game gets when it writes nothing: the engine's ring, once the switch took 400 ms. */
const DEFAULT_LOADER: Readonly<FullLoader> = Object.freeze({ afterMs: 400 });

/**
 * The `leave` of the config a game gets when it writes nothing: the engine's veil and ring.
 *
 * @example
 * ```ts
 * DEFAULT_LEAVE; // { cover: { color: 0, alpha: 0.45, inMs: 150, outMs: 150 }, loader: { afterMs: 400 } }
 * ```
 */
export const DEFAULT_LEAVE: SceneLeave = Object.freeze({
  cover: DEFAULT_COVER,
  loader: DEFAULT_LOADER
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

  const base = below === false ? DEFAULT_COVER : below;

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

  const base = below === false ? DEFAULT_LOADER : below;
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
  let cover: Readonly<FullCover> | false = DEFAULT_COVER;
  let loader: Readonly<FullLoader> | false = DEFAULT_LOADER;

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
 * Mounts a loader projection for the wait and reads the layer its views draw in, which the renderer draws above the
 * veil. A projection a scene of the switch lists is no loader, and one the scene being left cannot mount (an unknown
 * name, a layer it does not declare) is warned; both, and a projection with no view, give the engine's ring instead.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader projection.
 * @param between - The scene being left and the scene being switched to.
 * @param between.from - The scene being left.
 * @param between.to - The scene being switched to.
 * @param leaving - The look of the switch: it keeps the name to unmount at the end.
 * @returns The layer, or `undefined` for the ring.
 */
function mountLoader(
  ctx: ScenesCtx,
  name: string,
  between: { from: SceneDefinition; to: SceneDefinition },
  leaving: Leaving
): string | undefined {
  const { projection, ecs } = ctx.deps.world;
  const { from, to } = between;

  if (from.projections.includes(name) || to.projections.includes(name)) {
    ctx.log.warn("scenes:loader-listed", { projection: name, from: from.id, to: to.id });

    return undefined;
  }

  try {
    projection.mount([name], ctx.state.owner);
  } catch (error) {
    ctx.log.warn("scenes:loader-unmounted", { projection: name, scene: from.id, error });

    return undefined;
  }

  leaving.projection = name;

  const entity = projection.entitiesOf(name)[0];

  return entity === undefined ? undefined : ecs.get(entity, Layer)?.name;
}

/**
 * The renderer's loader of a resolved one: a texture as it is, a projection mounted and turned into the layer it draws
 * in, nothing for the ring.
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

  if (texture !== undefined) return { afterMs, texture };
  if (projection === undefined) return { afterMs };

  const layer = mountLoader(ctx, projection, between, leaving);

  return layer === undefined ? { afterMs } : { afterMs, layer };
}

/**
 * Tells whether a switch shows anything over the scene being left: a real change of scene, a live run that was not
 * aborted, a drawing renderer. The first scene of a run, a fast walk and a headless app show nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal.
 * @returns The scene being left, or `undefined` when nothing is shown.
 */
function leftScene(ctx: ScenesCtx, run: RunContext): SceneDefinition | undefined {
  const current = ctx.state.current;

  if (current === undefined || run.mode !== "live" || run.signal.aborted) return undefined;
  if (!ctx.deps.renderer.host.ready()) return undefined;

  return ctx.state.scenes.get(current);
}

/**
 * Shows the veil and the loader of a switch that starts now, before its bundles are awaited: the scene being left
 * decides. A loader projection is mounted for the wait. An abort of the node drops both at once, from its listener.
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
  const from = leftScene(ctx, run);

  if (from === undefined) return undefined;

  const leave = leaveOf(ctx.config.leave, from.leave);

  if (leave === undefined) return undefined;

  // Aborted by `off`, it takes the abort listener of the node's signal away.
  const listening = new AbortController();
  const leaving: Leaving = { done: false, off: (): void => listening.abort() };
  const look: LeaveLook = {};

  if (leave.cover !== false) look.cover = leave.cover;
  if (leave.loader !== false) {
    look.loader = loaderLook(ctx, leave.loader, { from, to: scene }, leaving);
  }

  ctx.deps.renderer.sync.leave.show(look);
  run.signal.addEventListener("abort", () => endLeave(ctx, leaving, "drop"), {
    once: true,
    signal: listening.signal
  });
  ctx.state.leaving = leaving;

  return leaving;
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

  if (leaving.projection !== undefined) ctx.deps.world.projection.unmount([leaving.projection]);
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
