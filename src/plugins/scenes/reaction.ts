/**
 * @file scenes plugin — the reaction frame of a live switch (spec 33, slice R): the frame after the answer that switches
 * the scene draws only what answers the player (the press look, the veil), and the build of the coming scene starts in
 * the frame after it. The answer of a release runs the node's stages in the release event's microtasks, so a build that
 * started there put the mount of the whole coming scene into the first frame after the release: 10–32 ms on a Galaxy
 * A26, one to three frames late. The `begin` stage watches for the first drawn frame; the `scene` stage starts the
 * build in the `signals` phase of the frame after it, where every build aside swaps: a build done at once swaps there
 * and is drawn in that frame, and a swap never comes in the middle of a frame's steps (in `input` the frame's own
 * steps released the old scene's bundles before its reconcile started their exit, F51b).
 *
 * The `time` plugin captures its callback lists at the start of a frame: a callback added during a frame first runs
 * in the next one, and one removed during a frame still runs in it. So both callbacks are registered before the frames
 * they watch, and the waiting one checks that its watch is still the current one.
 */
import type { Reaction, RunContext, ScenesCtx, State } from "./types";

/**
 * A build the `scene` stage started: the promise of the switch, or `undefined` when the world refused to build aside.
 */
export type Started = { building: Promise<void> | undefined };

/**
 * Starts the build aside.
 */
type StartBuild = () => Promise<void> | undefined;

/**
 * Starts watching for the reaction frame of a switch that builds aside: the first frame drawn after its `begin`
 * stage. One a node before left is forgotten first. The first scene of a run watches nothing: it has nothing on screen
 * to react with. The caller watches only for a switch that builds aside (a fast walk, a world that is not live and a
 * headless app build in one block).
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal of the node that switches.
 */
export function watchReaction(ctx: ScenesCtx, run: RunContext): void {
  forgetReaction(ctx.state);

  if (ctx.state.current === undefined || run.signal.aborted) return;

  const reaction: Reaction = { signal: run.signal, drawn: false, off: () => {} };
  const offRender = ctx.deps.time.onFrame("render", () => {
    reaction.drawn = true;
    offRender();
  });

  reaction.off = offRender;
  ctx.state.reaction = reaction;
}

/**
 * Forgets the reaction watch: its frame listener goes, and a build waiting for it returns with nothing started.
 *
 * @param state - The scenes state.
 */
export function forgetReaction(state: State): void {
  const reaction = state.reaction;

  if (reaction === undefined) return;

  delete state.reaction;
  reaction.off();
}

/**
 * Runs `start` once the reaction frame of the node is drawn: at once when it was drawn already or the node watched
 * none, otherwise in the `signals` phase of the frame after the drawn one. A node aborted while it waits, and a plugin
 * stopped meanwhile, start nothing, also when the abort comes in the frame the build would start in.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal, not aborted.
 * @param start - Starts the build aside.
 * @returns What `start` returned, or `false` when nothing was started.
 */
export function afterReaction(
  ctx: ScenesCtx,
  run: RunContext,
  start: StartBuild
): Promise<Started | false> {
  const reaction = ctx.state.reaction;
  const mine = reaction?.signal === run.signal ? reaction : undefined;

  if (mine === undefined || mine.drawn) {
    if (mine !== undefined) forgetReaction(ctx.state);

    return startNow(start);
  }

  return new Promise<Started | false>((resolve, reject) => {
    const offRender = mine.off;
    const stopWaiting = (): void => {
      offSignals();
      run.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      forgetReaction(ctx.state);
    };
    const offSignals = ctx.deps.time.onFrame("signals", () => {
      // Forgotten earlier in this frame (an abort, a stop): the captured list still calls it once.
      if (!mine.drawn || ctx.state.reaction !== mine) return;

      stopWaiting();
      delete ctx.state.reaction;

      try {
        resolve({ building: start() });
      } catch (error) {
        reject(error);
      }
    });

    // The abort and the stop both forget the watch: nothing is started, the switch returns.
    mine.off = (): void => {
      offRender();
      stopWaiting();
      resolve(false);
    };
    run.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Starts the build now, between two frames, its throw a rejection.
 *
 * @param start - Starts the build aside.
 * @returns What `start` returned.
 */
function startNow(start: () => Promise<void> | undefined): Promise<Started> {
  try {
    return Promise.resolve({ building: start() });
  } catch (error) {
    return Promise.reject(error as Error);
  }
}
