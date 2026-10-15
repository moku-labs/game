/**
 * @file renderer/host — the pool trim (C14): gives back the idle render targets Pixi's global `TexturePool` keeps,
 * strictly between frames, with Pixi's public `TexturePool.clear(true)`. A trim runs at rest, `restMs` after a scene
 * change, and on a pause. The trim reaches the monitor of an agent build through the listeners it registers with
 * `onTrim`, so this file never imports the monitor (LEAD-FIXES-3 O24).
 */
import { BYTES_PER_MB, roundTo } from "../monitor/units";
import type { PixiApplication, PoolTrim, RendererCtx } from "../types";
import { textureUsage } from "./readback";
import type { PoolState, TrimReason } from "./types";

/**
 * The bytes of the render targets the GPU holds now: the `targets` share of `host.textures()`. One walk of Pixi's
 * managed textures; called only when a trim is due.
 *
 * @param app - The application that draws.
 * @param kept - The sources the engine keeps as pictures: never counted as targets.
 * @returns The bytes.
 */
function targetBytes(app: PixiApplication, kept: WeakSet<object>): number {
  return textureUsage(app, kept).targets;
}

/**
 * Which trim is due after a frame: a rest once the screen drew nothing for `restMs`, once per rest; else a scene
 * change `restMs` ago.
 *
 * @param pool - The pool branch of the host state.
 * @param config - The trim config.
 * @param now - Clock milliseconds of the frame.
 * @param drawn - True when the frame was drawn.
 * @returns The reason, or `undefined` when none is due.
 */
function dueReason(
  pool: PoolState,
  config: PoolTrim,
  now: number,
  drawn: boolean
): TrimReason | undefined {
  if (
    !drawn &&
    !pool.restDone &&
    pool.lastDrawnAt !== undefined &&
    now - pool.lastDrawnAt >= config.restMs
  ) {
    return "rest";
  }

  return pool.sceneAt !== undefined && now - pool.sceneAt >= config.restMs ? "scene" : undefined;
}

/**
 * Trims the pool now: every idle texture of every bucket is destroyed, a texture handed out survives and is destroyed
 * when it comes back. The new baseline is what the targets hold after it; the rest and the scene change are done.
 * Logged in every build (rare: at most once per rest, scene change or pause); an agent build tells the listeners.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param reason - Why: a rest, a scene change, a pause.
 * @returns The bytes freed; 0 while the host is not ready.
 */
export function trimPool(ctx: RendererCtx, reason: TrimReason): number {
  const state = ctx.state.host;
  const { app, pixi } = state;

  if (!state.ready || pixi === undefined || app === undefined) return 0;

  const before = targetBytes(app, state.kept);

  pixi.TexturePool.clear(true);

  const after = targetBytes(app, state.kept);
  const freedMb = roundTo((before - after) / BYTES_PER_MB, 2);

  state.pool.baseline = after;
  state.pool.restDone = true;
  state.pool.sceneAt = undefined;
  ctx.log.debug("renderer:pool-trim", { reason, freedMb });

  // Inline and positive (spec 11 "The guard"): a production `define` folds it and the loop goes.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    for (const listener of state.onTrim) listener(reason, freedMb);
  }

  return before - after;
}

/**
 * The trim policy after each frame, once the frame closed: a rest or a settled scene change trims when the targets
 * grew by `aboveMb` since the last trim; less is judged not worth it, and the rest or the scene change is done.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param drawn - True when the frame was drawn.
 */
export function afterFrame(ctx: RendererCtx, drawn: boolean): void {
  const config = ctx.config.poolTrim;
  const state = ctx.state.host;
  const app = state.app;

  if (config === false || !state.ready || app === undefined) return;

  const pool = state.pool;
  const now = ctx.deps.clock.now();

  if (drawn) {
    pool.lastDrawnAt = now;
    pool.restDone = false;
  }

  const due = dueReason(pool, config, now, drawn);

  if (due === undefined) return;

  if (targetBytes(app, state.kept) - pool.baseline < config.aboveMb * BYTES_PER_MB) {
    // One look per rest or scene change: a still screen does not walk the textures every frame.
    pool.restDone = true;
    pool.sceneAt = undefined;

    return;
  }

  trimPool(ctx, due);
}

/**
 * The trim of a pause: whatever grew since the last trim goes, below `aboveMb` too, so a game in the background holds
 * no target it does not need. Nothing grew: nothing is done. The hook calls it only with a trim configured.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The bytes freed.
 */
export function trimOnPause(ctx: RendererCtx): number {
  const state = ctx.state.host;
  const app = state.app;

  if (!state.ready || app === undefined) return 0;

  return targetBytes(app, state.kept) > state.pool.baseline ? trimPool(ctx, "pause") : 0;
}

/**
 * Remembers a scene change; the policy trims `restMs` after it. A later change moves the moment.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function sceneChanged(ctx: RendererCtx): void {
  ctx.state.host.pool.sceneAt = ctx.deps.clock.now();
}
