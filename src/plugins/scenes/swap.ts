/**
 * @file scenes plugin — the swap: the one synchronous block that makes a scene the mounted one.
 * The one-block switch runs it with a `mount`, the commit of a scene built aside with
 * `projection.commit()` in the mount's place; every other step and its order are the same, so a
 * game sees one switch, whichever path built the scene.
 */
import type { SceneBuild, SceneDefinition, ScenesCtx } from "./types";

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
 * Names the switch in the performance log of an agent build: the scenes it went between and,
 * for a scene built aside, the frames and the milliseconds of page clock the build took.
 *
 * @param ctx - Domain context of the plugin.
 * @param from - The scene that left, `undefined` for the first one.
 * @param to - The scene that is mounted now.
 * @param build - The build that was committed; absent for a one-block switch.
 */
function logSwitch(
  ctx: ScenesCtx,
  from: string | undefined,
  to: string,
  build: SceneBuild | undefined
): void {
  // eslint-disable-next-line unicorn/no-null -- the log is JSON: no scene before is `null`.
  const scenes = { from: from ?? null, to };

  if (build === undefined) {
    ctx.deps.renderer.monitor.event("scene", scenes);

    return;
  }

  const clock = ctx.deps.time.agentClock();
  const buildMs = clock === undefined ? 0 : clock() - build.startedAt;

  ctx.deps.renderer.monitor.event("scene", { ...scenes, buildFrames: build.frames, buildMs });
}

/**
 * Makes a scene the mounted one in one synchronous block: the layers, then the projections only
 * the old scene lists out, then the new scene in (a `mount` of its list, or the commit of the
 * build that made it aside; a projection both list stays and takes its new place), the new scene
 * to the world's systems, then the list the scene names to `assets`, then the frame loop out of
 * its idle cap and the adaptive frame rate told of the new screen, and only then the event.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene whose bundles are there.
 * @param named - The bundles the scene names, as they were awaited.
 * @param build - The build to commit in the mount's place; absent for a one-block switch.
 * @throws {Error} Whatever the mount threw: a `view` or an unknown projection.
 */
export function swapIn(
  ctx: ScenesCtx,
  scene: SceneDefinition,
  named: readonly string[],
  build?: SceneBuild
): void {
  const state = ctx.state;
  const projection = ctx.deps.world.projection;
  const from = build === undefined ? state.current : build.from;
  const previous = from === undefined ? undefined : state.scenes.get(from);

  projection.setLayers(scene.layers);

  if (previous !== undefined) projection.unmount(leavingOf(previous, scene));

  if (build === undefined) projection.mount(scene.projections, state.owner);
  else projection.commit();

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
    logSwitch(ctx, from, scene.id, build);
  }
}
