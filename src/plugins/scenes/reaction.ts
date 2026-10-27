/**
 * @file scenes plugin — the reaction frame of a live switch (spec 33, slice R): the frame after the answer that switches
 * the scene draws only what answers the player (the press look, the veil), and the build of the coming scene starts in
 * the frame after it. The answer of a release runs the node's stages in the release event's microtasks, so a build that
 * started there put the mount of the whole coming scene into the first frame after the release: 10–32 ms on a Galaxy
 * A26, one to three frames late. The `begin` stage watches for the first drawn frame; the `scene` stage starts the
 * build inside the `input` phase of the frame after it, so the build's first frame also lays out, builds parts and
 * draws, and a build done at once swaps in that frame's `signals` phase, as every build aside does.
 */
import type { Reaction, RunContext, ScenesCtx, State } from "./types";

/**
 * A build the `scene` stage started: the promise of the switch, or `undefined` when the world refused to build aside.
 */
export type Started = { building: Promise<void> | undefined };

/**
 * Starts the build aside; `inFrame` is true inside a frame's `input` phase, false between two frames.
 */
type StartBuild = (inFrame: boolean) => Promise<void> | undefined;

/**
 * Starts watching for the reaction frame of a live switch: the first frame drawn after its `begin` stage. One a node
 * before left is forgotten first. A fast walk watches nothing, it builds in one block; nor does the first scene of a
 * run, which has nothing on screen to react with.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal of the node that switches.
 */
export function watchReaction(ctx: ScenesCtx, run: RunContext): void {
  forgetReaction(ctx.state);

  if (run.mode !== "live" || ctx.state.current === undefined) return;

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
 * none, otherwise inside the `input` phase of the next frame. A node aborted while it waits, and a plugin stopped
 * meanwhile, start nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param run - The runner's mode and signal, not aborted.
 * @param start - Starts the build aside.
 * @returns What `start` returned, or `undefined` when nothing was started.
 */
export function afterReaction(
  ctx: ScenesCtx,
  run: RunContext,
  start: StartBuild
): Promise<Started | undefined> {
  const reaction = ctx.state.reaction;
  const mine = reaction?.signal === run.signal ? reaction : undefined;

  if (mine === undefined || mine.drawn) {
    if (mine !== undefined) forgetReaction(ctx.state);

    return startNow(() => start(false));
  }

  return new Promise<Started | undefined>((resolve, reject) => {
    const offRender = mine.off;
    const stopWaiting = (): void => {
      offInput();
      run.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      forgetReaction(ctx.state);
    };
    const offInput = ctx.deps.time.onFrame("input", () => {
      if (!mine.drawn) return;

      stopWaiting();
      delete ctx.state.reaction;

      try {
        resolve({ building: start(true) });
      } catch (error) {
        reject(error);
      }
    });

    // The abort and the stop both forget the watch: nothing is started, the switch returns.
    mine.off = (): void => {
      offRender();
      stopWaiting();
      resolve();
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
