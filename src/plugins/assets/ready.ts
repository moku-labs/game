/**
 * @file assets plugin — a bundle ready to show. `warm` loads a bundle and puts its textures on the
 * GPU before a scene shows them (F60): on a Galaxy A26 the frame that showed 6 cold textures took
 * 55 ms, 8 ms once they were uploaded before. The `ready` effect lets a node rest on that work and
 * stay answerable (F52). Nothing here is on the frame path: one promise per bundle, and the inbox
 * event is posted from a promise.
 */
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
 * The handler of the `ready` effect (F52). Headless it answers `true` before any name check, as the
 * `load` effect does. Every bundle there: `true`, and nothing is posted. Otherwise it starts the
 * warm of each bundle that is not there, answers `false`, and posts `{ type: "ready" }` into
 * `flow.inbox` once all of them settled. The posting does not wait on the node's signal: the warm
 * is shared work, and the inbox keeps only the latest `ready`.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundles - The bundle names of the descriptor.
 * @returns True when the node may go on, false when it should rest until the inbox event `ready`.
 * @throws {Error} When the manifest has no such bundle.
 */
export function answerReady(ctx: AssetsCtx, bundles: readonly string[]): boolean {
  const state = ctx.state;

  if (state.io === undefined) return true;

  for (const name of bundles) {
    if (state.manifest.bundles[name] === undefined) throw unknownBundle(name);
  }

  const missing = bundles.filter(name => !isThere(state, name));

  if (missing.length === 0) return true;

  Promise.all(missing.map(name => warmForReady(ctx, name))).then(() =>
    ctx.deps.flow.inbox.post({ type: "ready" })
  );

  return false;
}
