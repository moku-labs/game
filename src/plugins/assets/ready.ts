/**
 * @file assets plugin — a bundle ready to show. `warm` loads a bundle and puts its textures on the
 * GPU before a scene shows them (F60): on a Galaxy A26 the frame that showed 6 cold textures took
 * 55 ms, 8 ms once they were uploaded before. The `ready` effect lets a node rest on that work and
 * stay answerable (F52). A `ready` also waits for the warm view the world builds aside (F202): the
 * system `assets.ready` posts it once that build ended, reading one field a frame at rest. Otherwise
 * nothing here is on the frame path: one promise per bundle, and the inbox event is posted from a
 * promise.
 */

import type { NodeInfo } from "../flow/types";
import { emptyAssets, isAbortError, loadBundle, unknownBundle } from "./tiers";
import type { AssetsCtx, State, WarmEntry } from "./types";

/**
 * Runs one warm: loads the bundle when it is not loaded, then hands every texture and atlas page
 * of it to the renderer's upload queue. The answer of the upload is not read: when the renderer
 * could not upload, the first draw does. A failure drops the entry, so the next `warm` tries again.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @param entry - The entry of this warm in `state.warmed`.
 * @returns A promise that resolves once the upload answered.
 * @throws {Error} When the load fails or is aborted.
 */
async function runWarm(ctx: AssetsCtx, bundle: string, entry: WarmEntry): Promise<void> {
  try {
    await loadBundle(ctx, bundle, undefined, "request");

    // A slice shares its page's source: the renderer queues that source once.
    const { textures, pages } = ctx.state.records.get(bundle) ?? emptyAssets();

    await ctx.deps.renderer.sync.textures.upload([...textures.values(), ...pages.values()]);
    entry.done = true;
  } catch (error) {
    // An unload during the warm may have dropped it already, and a new warm may stand there.
    if (ctx.state.warmed.get(bundle) === entry) ctx.state.warmed.delete(bundle);

    throw error;
  }
}

/**
 * Starts the one warm of a bundle and records it.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @returns The entry every later caller joins.
 */
function startWarm(ctx: AssetsCtx, bundle: string): WarmEntry {
  const entry: WarmEntry = { promise: Promise.resolve(), done: false };

  ctx.state.warmed.set(bundle, entry);
  entry.promise = runWarm(ctx, bundle, entry);

  return entry;
}

/**
 * Warms one bundle, or joins its running or finished warm. Headless it resolves at once, whatever
 * the name, as `load` does.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @returns A promise that resolves once the bundle is loaded and its textures went to the GPU.
 * @throws {Error} When the manifest has no such bundle, and when the load fails or is aborted.
 */
export async function warmBundle(ctx: AssetsCtx, bundle: string): Promise<void> {
  const state = ctx.state;

  if (state.io === undefined) return;
  if (state.manifest.bundles[bundle] === undefined) throw unknownBundle(bundle);

  await (state.warmed.get(bundle) ?? startWarm(ctx, bundle)).promise;
}

/**
 * Tells whether the `ready` effect counts a bundle as there: loaded and warmed, or its last warm
 * for `ready` failed.
 *
 * @param state - The plugin state.
 * @param bundle - Name of a bundle of the manifest.
 * @returns True when a node need not rest on it.
 */
function isThere(state: State, bundle: string): boolean {
  if (state.readyFailed.has(bundle)) return true;

  return isWarm(state, bundle);
}

/**
 * Tells whether a bundle is loaded and its textures went to the GPU: the `ready` answer `true` without a failed load.
 * The `load` effect answers at once for such bundles (F203).
 *
 * @param state - State of the assets plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @returns True when the bundle is loaded and warmed.
 */
export function isWarm(state: State, bundle: string): boolean {
  return state.records.get(bundle)?.status === "loaded" && state.warmed.get(bundle)?.done === true;
}

/**
 * Warms one bundle for the `ready` effect. It never rejects: a failure that is not an abort marks
 * the bundle failed and is logged, so the node resting on it moves on; an abort (an unload, a stop)
 * marks nothing, and the next `ready` starts the bundle again.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @returns A promise that resolves once the warm settled.
 */
async function warmForReady(ctx: AssetsCtx, bundle: string): Promise<void> {
  try {
    await warmBundle(ctx, bundle);
  } catch (error) {
    if (isAbortError(error)) return;

    ctx.state.readyFailed.add(bundle);
    ctx.log.warn("assets:ready-failed", { bundle, error: String(error) });
  }
}

/**
 * Ages the bundles nodes rest on through `ready` by one live rest (F190). The rest a node waits on
 * is the first: the bundle stays held through it, so the node that asks again finds it. A bundle
 * no `ready` asked for again by its second rest is let go, because the node it was asked for was
 * left another way (Back): from then on the budget and the `"leave"` release may take it again.
 * Called by the `flow:rest` hook of a live rest, before its budget pass.
 *
 * @param state - The plugin state.
 */
export function ageReadyWaiting(state: State): void {
  for (const [name, rests] of state.readyWaiting) {
    if (rests >= 1) state.readyWaiting.delete(name);
    else state.readyWaiting.set(name, rests + 1);
  }
}

/**
 * The longest a `ready` waits for a warm view in work once its bundles settled, in game-clock ms (F202): then it posts
 * anyway, so a build that never ends never holds a window.
 */
export const READY_WARM_CAP_MS = 400;

/**
 * Tells whether a warm view is in work for a `ready` to wait on: `world.projection.left()` is finite (a warm record
 * builds, or a scene build runs), and no capped post waived the wait.
 *
 * @param ctx - Domain context of the plugin.
 * @returns True while the `ready` waits for the build too.
 */
function warmInWork(ctx: AssetsCtx): boolean {
  return (
    ctx.state.readyWait !== "waived" &&
    ctx.deps.world.projection.left() !== Number.POSITIVE_INFINITY
  );
}

/**
 * Lets the post of `ready` wait for the warm view in work: the system `assets.ready` posts it once `left()` turns
 * infinite, or at the cap. A wait already running keeps its start.
 *
 * @param state - The plugin state.
 * @param ask - The number `beginAsk` gave the ask whose post waits.
 */
function waitForWarm(state: State, ask: number): void {
  state.readyWarmAsk = ask;
  if (state.readyWait === "warm") return;

  state.readyWait = "warm";
  state.readySince = -1;
}

/**
 * Posts the `ready` of the latest waiting ask, through `settleAsk` (F204): only to the rest that ask leads to.
 *
 * @param ctx - Domain context of the plugin.
 */
function postReady(ctx: AssetsCtx): void {
  settleAsk(ctx, ctx.state.readyWarmAsk);
}

/**
 * The bundles a `ready` answered `false` for settled: it posts at once, or, in a live game with a warm view in work,
 * leaves the post to the system `assets.ready`.
 *
 * @param ctx - Domain context of the plugin.
 * @param live - Whether the effect ran in live mode.
 * @param ask - The number `beginAsk` gave the ask.
 */
function bundlesSettled(ctx: AssetsCtx, live: boolean, ask: number): void {
  if (live && warmInWork(ctx)) waitForWarm(ctx.state, ask);
  else settleAsk(ctx, ask);
}

/**
 * One frame of the system `assets.ready` (phase `sync`): with no wait it reads one field. A `ready` waiting for the
 * warm view in work posts once `left()` turns infinite (the record became ready, or was discarded, paused or dropped by
 * a scene build or a restore: every end of it counts), or `READY_WARM_CAP_MS` after its first frame, which waives the
 * wait until the build ends, so the re-ask goes on and nothing posts again. A waived wait ends when `left()` turns
 * infinite.
 *
 * @param ctx - Domain context of the plugin.
 * @param frame - What the system run gets: the frame's `Time`.
 * @param frame.time - The frame's `Time`, its game clock read only while a wait runs.
 * @param frame.time.elapsed - The game clock, in scaled ms.
 */
export function stepReady(
  ctx: AssetsCtx,
  frame: { readonly time: { readonly elapsed: number } }
): void {
  const state = ctx.state;
  const wait = state.readyWait;

  if (wait === "none") return;

  const rests = ctx.deps.world.projection.left() === Number.POSITIVE_INFINITY;

  if (wait === "waived") {
    if (rests) state.readyWait = "none";

    return;
  }

  if (rests) {
    state.readyWait = "none";
    postReady(ctx);

    return;
  }

  const now = frame.time.elapsed;

  if (state.readySince < 0) {
    state.readySince = now;
  } else if (now - state.readySince >= READY_WARM_CAP_MS) {
    state.readyWait = "waived";
    postReady(ctx);
  }
}

/**
 * The handler of the `ready` effect (F52). Headless it answers `true` before any name check, as the
 * `load` effect does. Every bundle there and no warm view in work: `true`, and nothing is posted.
 * Otherwise it starts the warm of each bundle that is not there, answers `false`, and posts
 * `{ type: "ready" }` into `flow.inbox` once all of them settled and, in live mode, the warm view in
 * work is built (F202: the open view of a gated window, built under its dim; at most
 * `READY_WARM_CAP_MS` later, see `stepReady`), for the rest this ask leads to only (F204,
 * `settleAsk`): a `ready` nobody rests on would end the next wait at once. The posting does not
 * wait on the node's signal: the warm is shared work. A bundle it answers `false` for
 * is rested on (`readyWaiting`) until a `ready` finds it there: neither the budget nor the `"leave"`
 * release of the rest in between takes it, else the node that asks again finds it gone and the two
 * nodes cycle forever (F190). `ageReadyWaiting` ends the hold of one nobody asks for again.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundles - The bundle names of the descriptor.
 * @param live - Whether the effect runs in live mode: a fast walk builds no warm view and waits for none.
 * @returns True when the node may go on, false when it should rest until the inbox event `ready`.
 * @throws {Error} When the manifest has no such bundle.
 */
export function answerReady(ctx: AssetsCtx, bundles: readonly string[], live = true): boolean {
  const state = ctx.state;

  if (state.io === undefined) return true;

  for (const name of bundles) {
    if (state.manifest.bundles[name] === undefined) throw unknownBundle(name);
  }

  const missing = bundles.filter(name => !isThere(state, name));

  // What is there is no longer rested on; what is missing is, from now, until a ready finds it there.
  for (const name of bundles) {
    if (missing.includes(name)) state.readyWaiting.set(name, 0);
    else state.readyWaiting.delete(name);
  }

  if (missing.length === 0) {
    if (!live || !warmInWork(ctx)) return true;

    waitForWarm(state, beginAsk(ctx));

    return false;
  }

  const ask = beginAsk(ctx);

  Promise.all(missing.map(name => warmForReady(ctx, name))).then(() =>
    bundlesSettled(ctx, live, ask)
  );

  return false;
}

/**
 * Tells whether a rest node takes the inbox event `ready`. The graph's validation makes every `inbox` type an
 * outcome, so a rest without the outcome `ready` never takes it.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node entered.
 * @returns True when the node is a rest with the outcome `ready`.
 */
function takesReady(ctx: AssetsCtx, node: NodeInfo): boolean {
  if (!node.rest) return false;

  return (
    ctx.deps.flow.describe().flows[node.flow]?.nodes[node.node]?.outcomes.includes("ready") === true
  );
}

/**
 * Records a `ready` ask answered `false` as the latest one (F204). Its event belongs to one rest: the rest whose body
 * asked, or else the first rest entered after the ask.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The number of this ask.
 */
function beginAsk(ctx: AssetsCtx): number {
  const state = ctx.state;
  const current = state.current;

  state.readyAsk += 1;
  state.readyHeld = false;
  if (current?.rest === true) state.readyPlace = takesReady(ctx, current) ? "at" : "gone";
  else state.readyPlace = "before";

  return state.readyAsk;
}

/**
 * Posts `{ type: "ready" }` for an ask whose bundles settled, when its rest takes it now (F204). A newer ask owns the
 * event; an ask whose rest is not entered yet holds it for that rest; an ask whose rest was left, or does not list
 * `ready`, posts nothing, so no later rest ends at once on it.
 *
 * @param ctx - Domain context of the plugin.
 * @param ask - The number `beginAsk` gave the ask.
 */
function settleAsk(ctx: AssetsCtx, ask: number): void {
  const state = ctx.state;

  if (ask !== state.readyAsk) return;

  if (state.readyPlace === "before") {
    state.readyHeld = true;
    return;
  }

  if (state.readyPlace !== "at") return;

  state.readyPlace = "gone";
  ctx.deps.flow.inbox.post({ type: "ready" });
}

/**
 * Moves the latest `false` ask past one entered node (F204), from the `load` stage of every node. The first rest
 * entered after a transit node's ask is its rest: one that lists `ready` gets the held event now and waits for it
 * otherwise; one that does not ends the ask. Any node entered after that rest ends it too. Allocates nothing: it runs
 * on every node the graph enters.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node entered.
 */
export function passReadyNode(ctx: AssetsCtx, node: NodeInfo): void {
  const state = ctx.state;

  if (state.readyPlace === "gone") return;

  // The ask's rest was left.
  if (state.readyPlace === "at") {
    state.readyPlace = "gone";
    return;
  }

  if (!node.rest) return;

  if (!takesReady(ctx, node)) {
    state.readyPlace = "gone";
    return;
  }

  state.readyPlace = "at";
  if (!state.readyHeld) return;

  state.readyHeld = false;
  state.readyPlace = "gone";
  ctx.deps.flow.inbox.post({ type: "ready" });
}
