/**
 * @file audio plugin — loops: a named sound asked for with `sfx(key, { id, loop: true })`. `state.loops`
 * remembers each one by id past its sound, so the unlock and the unlock after an iOS renewal start it
 * again, and the leave of the scene it was asked in ends it. The sound itself plays through
 * `named.ts`, as every sound with an id does.
 */
import { isBus } from "./graph";
import { playNamed, stopNamed, waitingKey } from "./named";
import type { AudioCtx, LoopSound, SfxRequest, State } from "./types";

/**
 * Plays a loop, or remembers it: the loop that already holds its id with its key changes nothing,
 * any other request takes the id, and a one-shot waiting for the unlock under it is dropped. A
 * locked context, or a renewal between two contexts, only keeps it in `loops`; the unlock starts
 * it. The scene it belongs to is the one mounted now.
 *
 * @param ctx - Domain context of the plugin.
 * @param request - The key, the bus and the fade of the loop.
 * @param id - The id it plays under.
 */
export async function playLoop(ctx: AudioCtx, request: SfxRequest, id: string): Promise<void> {
  const state = ctx.state;
  const bus = request.bus;

  if (!isBus(state, bus)) {
    ctx.log.warn("audio: unknown bus", { bus });

    return;
  }

  if (isSameLoop(state, id, request.key)) return;

  const loop: LoopSound = {
    key: request.key,
    bus,
    fadeMs: request.fadeMs,
    scene: state.scene,
    started: false
  };

  state.loops.set(id, loop);
  state.pendingSfx.delete(waitingKey(id));

  if (!state.unlocked) return;

  await startLoop(ctx, id, loop);
}

/**
 * Starts one loop the plugin keeps under its id, with its own fade.
 *
 * @param ctx - Domain context of the plugin.
 * @param id - The id the loop plays under.
 * @param loop - The loop, as `loops` keeps it.
 */
async function startLoop(ctx: AudioCtx, id: string, loop: LoopSound): Promise<void> {
  await playNamed(ctx, { id, key: loop.key, bus: loop.bus, fadeMs: loop.fadeMs, loop });
}

/**
 * Starts every remembered loop whose id has no sound: what the unlock does once the context runs,
 * the first one and the one after an iOS renewal. A loop that already plays or decodes is left alone,
 * so a gesture and the start attempt that settle together start it once. Nobody awaits these
 * starts, so a failure goes to the log.
 *
 * @param ctx - Domain context of the plugin.
 */
export function startLoops(ctx: AudioCtx): void {
  const state = ctx.state;

  for (const [id, loop] of state.loops) {
    if (!state.named.has(id)) trackLoop(ctx, startLoop(ctx, id, loop));
  }
}

/**
 * Follows a loop start nobody awaits. A failure of the audio hardware is not the graph's problem,
 * so it goes to the log and the game plays on.
 *
 * @param ctx - Domain context of the plugin.
 * @param pending - The start that was made.
 */
function trackLoop(ctx: AudioCtx, pending: Promise<void>): void {
  pending.catch((error: unknown) => {
    ctx.log.error(
      "audio: the loop did not start",
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  });
}

/**
 * Tells whether an id already holds a loop of a key, playing, decoding or remembered for the
 * unlock: a request for it changes nothing, so the bed plays on from where it is.
 *
 * @param state - The plugin state.
 * @param id - The id of the loop request.
 * @param key - The asset key it asks for.
 * @returns True when that loop is already there.
 */
export function isSameLoop(state: State, id: string, key: string): boolean {
  return state.loops.get(id)?.key === key;
}

/**
 * Stops one loop when it belongs to the scene that leaves. `this` is the plugin state, handed in
 * by the walk of `stopSceneLoops`.
 *
 * @param this - The plugin state, whose `leaving` names the scene and the fade.
 * @param loop - The loop.
 * @param id - The id it plays under.
 */
function stopIfLeaving(this: State, loop: LoopSound, id: string): void {
  if (loop.scene === this.leaving.scene) stopNamed(this, id, this.leaving.fadeMs);
}

/**
 * Ends every loop asked for while the scene that leaves was mounted, each over the fade given,
 * through `stopNamed`. A loop asked for before any scene belongs to none and stays. The walk deletes
 * from the map it walks, which a `Map` allows, and makes nothing.
 *
 * @param state - The plugin state.
 * @param from - The scene that leaves, `undefined` at the first switch.
 * @param fadeMs - Length of the fade, in real milliseconds.
 */
export function stopSceneLoops(state: State, from: string | undefined, fadeMs: number): void {
  if (from === undefined || state.loops.size === 0) return;

  state.leaving.scene = from;
  state.leaving.fadeMs = fadeMs;
  // A `for…of` over the entries makes an iterator and an entry array per loop (128 B for two, measured);
  // `forEach` with the state as `this` makes neither, and no closure.
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference, unicorn/no-array-method-this-argument -- a Map, walked without an iterator
  state.loops.forEach(stopIfLeaving, state);
}
