/**
 * @file scenes plugin — the loader projection of a switch (spec 33 slice A2, F103, F107 part 3). While a scene stands,
 * the projection its leave loader names is held: `world` keeps it built and hidden in idle frames, so the frame the
 * loader is due only shows it, and its layer comes from its spec. A loader that is not held is mounted in the frame it
 * is due (A2). After the swap it fades out with the veil and is unmounted once the veil's `outMs` passed, or held again
 * when the scene that stands leaves with it too; a drop takes it down at once. A loader held is fed the switch of the
 * scene that stands right after the hold (F107 part 1), so the view built ahead reads `{ from, to, progress: 0 }` of it.
 */
import type { Time } from "../time/types";
import { Layer } from "../world/ecs/define";
import { frameMsOf } from "./build";
import { feedStanding } from "./progress";
import type {
  AnySceneProjection,
  FadingLoader,
  HeldLoader,
  Leaving,
  SceneDefinition,
  ScenesCtx,
  State
} from "./types";

/**
 * Does nothing: the remover of a fade before its frame callback is registered.
 */
function noFrame(): void {
  // Nothing was registered yet.
}

/**
 * Tells whether an entry of a feature's `projections` list names its layer. The key carries whatever the game put
 * there, so an entry that does not is skipped.
 *
 * @param entry - One entry of the list.
 * @returns True for an object with a string `name` and a string `layer`.
 * @example
 * ```ts
 * isLayered({ name: "loading", layer: "loading", view: () => [] }); // true
 * ```
 */
function isLayered(entry: unknown): entry is Pick<AnySceneProjection, "name" | "layer"> {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    typeof entry.name === "string" &&
    "layer" in entry &&
    typeof entry.layer === "string"
  );
}

/**
 * The layer a projection's spec names, read from the `projections` of the features, the list `world` registers.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The projection.
 * @returns Its `layer`, or `undefined` when no feature brings it.
 */
function specLayerOf(ctx: ScenesCtx, name: string): string | undefined {
  for (const feature of ctx.deps.flow.features.all()) {
    const list: unknown = feature.description.projections;

    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      if (isLayered(entry) && entry.name === name) return entry.layer;
    }
  }

  return undefined;
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
 * Refuses a loader whose layer a projection of the scene being left draws in too: lifted above the veil, that layer
 * would take the scene's own views with it. Warned; the renderer draws the ring.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader projection.
 * @param layer - The layer of the loader.
 * @param from - The scene being left.
 * @returns True when one of the scene's projections has a view in that layer.
 */
function refusesShared(
  ctx: ScenesCtx,
  name: string,
  layer: string,
  from: SceneDefinition
): boolean {
  if (!from.projections.some(other => layerOf(ctx, other) === layer)) return false;

  ctx.log.warn("scenes:loader-layer-shared", { projection: name, layer, scene: from.id });

  return true;
}

/**
 * Unmounts the loader projection a switch mounted or showed, at once: one it did not is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param leaving - The look of the switch.
 */
export function dropLoader(ctx: ScenesCtx, leaving: Leaving): void {
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
 * Mounts a loader projection the scene being left does not hold, in the frame it is due (A2), and answers the layer its
 * views draw in. A mount that throws, a layer a projection of the scene draws in too and a projection with no view give
 * the engine's ring.
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
  if (!mountOnce(ctx, name, from, leaving)) return undefined;

  // The layer its views draw in; a projection with no view has none.
  const layer = layerOf(ctx, name);

  if (layer === undefined || !refusesShared(ctx, name, layer, from)) return layer;

  dropLoader(ctx, leaving);

  return undefined;
}

/**
 * Shows the loader the scene being left holds: built already, it is on the screen in the next frame, the same views,
 * no spawn. Its layer is its spec's: the view `show` brings is reconciled in the next frame, so it has no `Layer` yet.
 * One whose layer a projection of the scene draws in too is unmounted instead, and the renderer draws the ring.
 *
 * @param ctx - Domain context of the plugin.
 * @param held - The loader the scene holds.
 * @param from - The scene being left.
 * @param leaving - The look of the switch: it keeps the name to unmount or fade out at the end.
 * @returns The layer, or `undefined` for the ring.
 */
function showHeld(
  ctx: ScenesCtx,
  held: HeldLoader,
  from: SceneDefinition,
  leaving: Leaving
): string | undefined {
  const projection = ctx.deps.world.projection;

  delete ctx.state.held;

  if (refusesShared(ctx, held.name, held.layer, from)) {
    projection.unmount([held.name]);

    return undefined;
  }

  projection.show(held.name);
  // Recorded right after the show: a drop from here on unmounts it, a land fades it out.
  leaving.projection = held.name;

  return held.layer;
}

/**
 * The `due` of a loader projection, called by the renderer in the first frame the loader is due: a loader the scene
 * being left holds is shown, any other is mounted then (A2). It answers the layer the renderer draws above the veil.
 * A switch that ended meanwhile shows nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader projection.
 * @param from - The scene being left.
 * @param leaving - The look of the switch.
 * @returns The layer, or `undefined` for the ring.
 */
export function dueLoader(
  ctx: ScenesCtx,
  name: string,
  from: SceneDefinition,
  leaving: Leaving
): string | undefined {
  // The switch landed or was dropped before the renderer asked: nothing to draw.
  if (leaving.done) return undefined;

  const held = ctx.state.held;

  if (held !== undefined && held.name === name) return showHeld(ctx, held, from, leaving);

  return mountLoader(ctx, name, from, leaving);
}

/**
 * Holds a loader for the next switch and feeds it the switch of the scene that stands right after, in the same call:
 * the first value fed after a hold is the one `world` builds the held view for. A hold `world` refuses (a `lift` the
 * scene does not declare) is warned and holds nothing: the loader is then mounted when it is due, and that mount is
 * refused the same way.
 *
 * @param ctx - Domain context of the plugin.
 * @param loader - The loader to hold.
 */
function holdNow(ctx: ScenesCtx, loader: HeldLoader): void {
  try {
    ctx.deps.world.projection.hold([loader.name], ctx.state.owner);
  } catch (error) {
    ctx.log.warn("scenes:loader-unmounted", {
      projection: loader.name,
      scene: ctx.state.current,
      error
    });

    return;
  }

  feedStanding(ctx, loader.name);
  ctx.state.held = loader;
}

/**
 * The loader a scene that stands may hold, by the rules of A2: a projection the scene does not list, whose spec's
 * layer the scene declares.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene that stands.
 * @param name - The projection its leave loader names.
 * @returns The loader, or `undefined` when the scene cannot hold it.
 */
function loaderToHold(
  ctx: ScenesCtx,
  scene: SceneDefinition,
  name: string
): HeldLoader | undefined {
  if (scene.projections.includes(name)) return undefined;

  const layer = specLayerOf(ctx, name);

  if (layer === undefined || !scene.layers.some(spec => spec.name === layer)) return undefined;

  return { name, layer };
}

/**
 * Holds the leave loader of a scene that stands for its next switch: `world` builds the view of its `from`'s first
 * item in idle frames and keeps it hidden, so the frame the loader is due only shows it. A loader the scene before held
 * and this one does not hold is unmounted: the next switch does not use it. The one this switch showed, still fading
 * out with the veil, is held again once the fade is over. A projection another owner shows is never held.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene that stands.
 * @param name - The projection its leave loader names; `undefined` when it holds none (no projection loader, a fast
 *   walk, a world that does not run live, a headless app).
 */
export function holdLoader(ctx: ScenesCtx, scene: SceneDefinition, name: string | undefined): void {
  const state = ctx.state;
  const want = name === undefined ? undefined : loaderToHold(ctx, scene, name);
  const held = state.held;

  // The loader the scene before held, which the next switch does not use: it goes with the swap.
  if (held !== undefined && held.name !== want?.name) {
    delete state.held;
    ctx.deps.world.projection.unmount([held.name]);
  }

  if (want === undefined) return;

  // The loader this switch showed fades out with the veil first, then is held again.
  const fading = state.fading;

  if (fading !== undefined && fading.name === want.name) {
    fading.rehold = want;

    return;
  }

  // A projection another owner shows is drawn as it is when due (A2); a held one shows nothing.
  if (ctx.deps.world.projection.entitiesOf(want.name).length > 0) return;

  holdNow(ctx, want);
}

/**
 * Unmounts the loader held for the running switch when the scene it switches to lists it, before that scene is built
 * or mounted: the scene mounts it as its own, and a projection still held would show nothing there.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene being switched to.
 */
export function releaseListed(ctx: ScenesCtx, scene: SceneDefinition): void {
  const held = ctx.state.held;

  if (held === undefined || !scene.projections.includes(held.name)) return;

  delete ctx.state.held;
  ctx.deps.world.projection.unmount([held.name]);
}

/**
 * Ends a fade: the frame callback goes, and the loader is unmounted, or held again for the scene that stands.
 *
 * @param ctx - Domain context of the plugin.
 * @param fading - The fade.
 */
function endFade(ctx: ScenesCtx, fading: FadingLoader): void {
  fading.off();
  delete ctx.state.fading;

  if (fading.rehold === undefined) ctx.deps.world.projection.unmount([fading.name]);
  else holdNow(ctx, fading.rehold);
}

/**
 * The `signals` callback of a fade: counts the frame's milliseconds before the time scale (a game time frozen at
 * scale 0 counts one frame of the loop's rate) and ends the fade in the frame the veil's `outMs` ran out, before that
 * frame is drawn: about the frame the renderer takes the veil down, which keeps the layer unseen until then. A fade a
 * new switch ended earlier in the frame does nothing: `time` runs the callbacks it took at the frame start. Per frame
 * while a loader fades: a subtraction, no allocation.
 *
 * @param ctx - Domain context of the plugin.
 * @param fading - The fade.
 * @param time - The frame's `Time`.
 */
function stepFade(ctx: ScenesCtx, fading: FadingLoader, time: Readonly<Time>): void {
  if (ctx.state.fading !== fading) return;

  fading.leftMs -= time.scale > 0 ? time.delta / time.scale : frameMsOf(ctx);

  if (fading.leftMs > 0) return;

  endFade(ctx, fading);
}

/**
 * The swap came (F107 part 3): the loader the switch mounted or showed fades out with the veil above the scene that
 * stands, and is unmounted in the frame the veil's `outMs` ran out, or held again when the scene that stands leaves with
 * it too (`holdLoader`). A look without a veil, or with `outMs: 0`, leaves the screen at once, and so does its loader.
 *
 * @param ctx - Domain context of the plugin.
 * @param leaving - The look of the switch.
 */
export function landLoader(ctx: ScenesCtx, leaving: Leaving): void {
  const name = leaving.projection;

  if (name === undefined) return;

  delete leaving.projection;

  if (leaving.outMs <= 0) {
    ctx.deps.world.projection.unmount([name]);

    return;
  }

  const fading: FadingLoader = { name, leftMs: leaving.outMs, off: noFrame };

  fading.off = ctx.deps.time.onFrame("signals", time => stepFade(ctx, fading, time));
  ctx.state.fading = fading;
}

/**
 * Ends a loader still fading out when the next switch starts: it is unmounted, or held again, before that switch shows
 * its look or touches the world.
 *
 * @param ctx - Domain context of the plugin.
 */
export function settleFade(ctx: ScenesCtx): void {
  const fading = ctx.state.fading;

  if (fading !== undefined) endFade(ctx, fading);
}

/**
 * Forgets the held loader and a fade when the plugin stops: the frame callback of the fade goes. Nothing is unmounted:
 * a teardown context may not call another plugin, and `world.onStop` clears the projections.
 *
 * @param state - The plugin state.
 */
export function forgetLoader(state: State): void {
  state.fading?.off();
  delete state.fading;
  delete state.held;
}
