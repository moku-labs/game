/**
 * @file scenes plugin — the next scene built aside on a live switch (spec 31, F61 S2). The world
 * mounts the coming projections into a table of its own while the old scene stays current, drawn
 * and alive; `ui` and the renderer do their part under the budget of a frame (`buildMs`); the frame
 * `world.projection.built()` first answers true commits it with the swap of a one-block switch, or,
 * under a floor on the swap (`leave.loader.holdMs`, F130), the first such frame the floor passed
 * in. An abort of the node discards the build and leaves the world as it stood.
 */
import { swapIn } from "./swap";
import type { SceneBuild, SceneDefinition, ScenesCtx } from "./types";

/** A second in ms: the frame interval is this over the frame rate. */
const SECOND_MS = 1000;

/** The share of a frame interval `"auto"` gives the building work: two thirds. */
const BUILD_SHARE = 2 / 3;

/** The frame interval when `time` answers no usable frame rate: a 60 Hz frame, ≈ 16.7 ms. */
const FALLBACK_FRAME_MS = SECOND_MS / 60;

/**
 * The frames past the counter at the look's start a floor asks for: `signals` runs before `render`, so a swap in the
 * first frame has no `render` of the look behind it, and a swap in the second has one, even when one long frame ate the
 * whole floor.
 */
const HOLD_FRAMES = 2;

/**
 * Tells whether a value is a number a frame can count with: finite and above 0. Pure.
 *
 * @param value - The value.
 * @returns True for a finite number above 0.
 * @example
 * ```ts
 * isPositiveFinite(Number.NaN); // false
 * ```
 */
export function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Does nothing: the listeners of a build that commits at once, before it registered any.
 */
function noListeners(): void {
  // Nothing was registered yet.
}

/**
 * Reads the page clock of an agent build, for the milliseconds a build took.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The page clock in ms, or 0 in a build without the flag.
 */
function agentNow(ctx: ScenesCtx): number {
  const clock = ctx.deps.time.agentClock();

  return clock === undefined ? 0 : clock();
}

/**
 * The frame interval the loop runs at now, `1000 / time.rate().fps`. A rate that is not a finite number above 0 gives
 * a 60 Hz frame.
 *
 * @param ctx - Domain context of the plugin.
 * @returns Milliseconds of one frame.
 */
export function frameMsOf(ctx: ScenesCtx): number {
  const { fps } = ctx.deps.time.rate();

  return isPositiveFinite(fps) ? SECOND_MS / fps : FALLBACK_FRAME_MS;
}

/**
 * The building budget of a frame for a build that starts now: the number a game configured, or
 * for `"auto"` two thirds of the frame interval the loop runs at, `(1000 / time.rate().fps) * 2 / 3`,
 * read once here. A rate that is not a finite number above 0 gives two thirds of a 60 Hz frame.
 *
 * @param ctx - Domain context of the plugin.
 * @returns Milliseconds per frame the building work may take.
 */
function budgetOf(ctx: ScenesCtx): number {
  const { buildMs } = ctx.config;

  if (buildMs !== "auto") return buildMs;

  return frameMsOf(ctx) * BUILD_SHARE;
}

/**
 * Ends the build with the swap: its listeners go and the record is dropped, then the swap of a
 * one-block switch runs, with the commit in the mount's place, or, for `"mount"`, after the build
 * was discarded, with the mount itself. A swap that throws rejects the switch, so `flow` rolls the
 * node back; the build is discarded and the coming bundles are held no more first, so the next
 * switch can build again.
 *
 * @param ctx - Domain context of the plugin.
 * @param build - The running build.
 * @param how - `"commit"` to commit the build, `"mount"` to discard it and mount in one block.
 */
function endBuild(ctx: ScenesCtx, build: SceneBuild, how: "commit" | "mount"): void {
  build.off();
  delete ctx.state.build;

  if (how === "mount") ctx.deps.world.projection.discard();

  try {
    swapIn(ctx, build.scene, build.named, how === "commit" ? build : undefined);
  } catch (error) {
    // A `setLayers` or an `unmount` that threw before `commit()` leaves the world's build table set: without the
    // discard every later live switch throws "A scene is already being built". Both calls do nothing when done.
    ctx.deps.world.projection.discard();
    ctx.deps.assets.sceneComing([]);
    build.reject(error);

    return;
  }

  build.resolve();
}

/**
 * Tells whether the floor on the swap lets a built scene commit: no floor, or the clock passed it and the look was drawn
 * once. The count is the look's, never the build's, so a switch slower than the floor is many frames past it and the
 * floor adds no frame. While it holds, the loop is kept awake: it may stop at `idleFps: 0` during a long floor. No floor
 * is one read; no allocation either way.
 *
 * @param ctx - Domain context of the plugin.
 * @param frame - The frame counter now.
 * @returns True when the build may commit.
 */
function holdOver(ctx: ScenesCtx, frame: number): boolean {
  const hold = ctx.state.leaving?.hold;

  if (hold === undefined) return true;

  const floorPassed = ctx.deps.clock.now() >= hold.until && frame >= hold.frame + HOLD_FRAMES;

  if (floorPassed) return true;

  ctx.deps.time.wake();

  return false;
}

/**
 * The `signals` callback of a running build: counts the frame and commits the build the frame
 * every part of it is done and the floor on the swap passed. A world that stopped running live
 * during the build or its wait (a walk that went fast, as the restore of a repro walks its route,
 * or a pause) skips its `layout` phase, so `ui` would never lay the coming scene out: the build is
 * given up and the scene mounted in one block, as a switch in that mode is. While the build is not
 * done, a counter step and two calls, and while a floor holds it two calls more, no allocation:
 * the frame comes with the callback, as `snapshot()` copies.
 *
 * @param ctx - Domain context of the plugin.
 * @param build - The running build.
 * @param frame - The frame counter of this frame.
 */
function stepBuild(ctx: ScenesCtx, build: SceneBuild, frame: number): void {
  build.frames += 1;

  const world = ctx.deps.world;

  if (world.ecs.mode() !== "live") {
    endBuild(ctx, build, "mount");

    return;
  }

  if (world.projection.built() && holdOver(ctx, frame)) endBuild(ctx, build, "commit");
}

/**
 * Drops the running build on an abort of its node (a restore, the inbox, a stop of the runner):
 * the world despawns what the build made, the coming bundles are held no more, and the switch
 * returns with the old scene current. The layers, the scene of the world, the named bundles and
 * the mounted projections were never touched. The commit and a stop remove this listener first.
 *
 * @param ctx - Domain context of the plugin.
 * @param build - The build of the aborted node.
 */
function abortBuild(ctx: ScenesCtx, build: SceneBuild): void {
  build.off();
  delete ctx.state.build;
  ctx.deps.world.projection.discard();
  ctx.deps.assets.sceneComing([]);
  build.resolve();
}

/**
 * Creates the record of a build that starts now, its listeners not registered yet.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene being built.
 * @param named - The bundles it names, as they were awaited.
 * @param budgetMs - The building budget of a frame the world was given.
 * @param settle - The callbacks of the switch's promise.
 * @param settle.resolve - Settles the switch.
 * @param settle.reject - Rejects the switch.
 * @returns The record, at frame 0, with no listeners to remove.
 */
function startBuildRecord(
  ctx: ScenesCtx,
  scene: SceneDefinition,
  named: readonly string[],
  budgetMs: number,
  settle: { resolve: () => void; reject: (error: unknown) => void }
): SceneBuild {
  return {
    scene,
    named,
    from: ctx.state.current,
    frames: 0,
    budgetMs,
    startedAt: agentNow(ctx),
    off: noListeners,
    resolve: settle.resolve,
    reject: settle.reject
  };
}

/**
 * Registers the listeners of a running build: the `signals` callback that asks every frame
 * whether it is done, and the abort of its node, which discards it. `build.off` removes both; the
 * build becomes the plugin's running one.
 *
 * @param ctx - Domain context of the plugin.
 * @param build - The build that starts waiting for its frames.
 * @param signal - The abort signal of the node, not aborted.
 */
function watchBuild(ctx: ScenesCtx, build: SceneBuild, signal: AbortSignal): void {
  const onAbort = (): void => abortBuild(ctx, build);
  const offFrame = ctx.deps.time.onFrame("signals", time => stepBuild(ctx, build, time.frame));

  signal.addEventListener("abort", onAbort, { once: true });
  build.off = (): void => {
    offFrame();
    signal.removeEventListener("abort", onAbort);
  };
  ctx.state.build = build;
}

/**
 * Starts the build of a scene aside and answers the promise of the switch. The world mounts what
 * only the coming scene lists, against the committed state, and gets the budget of a frame
 * (`budgetOf`); the coming bundles are held from now.
 * When nothing is left for `ui` and the renderer and no floor holds the swap, the commit runs at
 * once, with no frame between. Otherwise a `signals` callback asks every frame whether the build is
 * done and the floor passed, and an abort of the node discards it.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene whose bundles are there.
 * @param named - The bundles it names, as they were awaited.
 * @param signal - The abort signal of the node, not aborted.
 * @returns The promise of the switch, settled at the commit or the abort; `undefined` when the
 *   world refused to build (a listed projection is mounted under other layer rules), so the
 *   caller switches in one block.
 * @throws {Error} Whatever `world.projection.build` threw: a `view`, an unknown projection or an
 *   undeclared layer. Nothing is built then.
 */
export function buildAside(
  ctx: ScenesCtx,
  scene: SceneDefinition,
  named: readonly string[],
  signal: AbortSignal
): Promise<void> | undefined {
  const projection = ctx.deps.world.projection;
  const budgetMs = budgetOf(ctx);
  const started = projection.build(scene.projections, ctx.state.owner, scene.layers, budgetMs);

  if (!started) return undefined;

  // After `build`, not before: a build that throws or refuses leaves the coming list untouched.
  ctx.deps.assets.sceneComing(named);

  // Inline and positive: the performance log of an agent build names the build start; a production `define` folds
  // the guard and the call goes.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const from = ctx.state.current;

    // eslint-disable-next-line unicorn/no-null -- the log is JSON: no scene before is `null`.
    ctx.deps.renderer.monitor.event("scene:build", { from: from ?? null, to: scene.id });
  }

  return new Promise<void>((resolve, reject) => {
    const build = startBuildRecord(ctx, scene, named, budgetMs, { resolve, reject });

    // A build with nothing left for ui and the renderer swaps now: fake-clock tests keep their frames.
    if (projection.built() && holdOver(ctx, ctx.deps.time.snapshot().frame)) {
      endBuild(ctx, build, "commit");

      return;
    }

    watchBuild(ctx, build, signal);
  });
}

/**
 * Drops a running build when the plugin stops: its frame callback and its abort listener go and
 * the switch returns. Nothing else is called: a teardown context may not call another plugin, and
 * `world.onStop` drops the build table with every entity.
 *
 * @param build - The running build, if any.
 */
export function dropBuild(build: SceneBuild | undefined): void {
  if (build === undefined) return;

  build.off();
  build.resolve();
}
