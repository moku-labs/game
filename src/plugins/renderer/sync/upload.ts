/**
 * @file renderer/sync — the texture upload queue (F60): the sources of the textures `assets` hands over go to the GPU
 * before the screen that shows them mounts, `renderer.uploads` per drawn frame, before the stage pass, with Pixi's
 * public `renderer.texture.initSource`. On a Galaxy A26 (Chrome, WebGPU, Pixi 8.22) one upload costs about 9 ms
 * whatever its size, and the frame that showed 6 cold textures (9.4 MB) took 55 ms against 8 ms with them uploaded
 * before: the budget counts sources, not bytes. A source is queued once, however many calls and slices name it; each
 * call waits for its own sources and answers true after the last of them. The queue is an array read from `head` and
 * emptied when the head reaches its end, the warm-up's pattern (`warm.ts`): an empty queue costs one compare a frame.
 * A source whose upload throws is logged and counted done, so its first draw uploads it the old way; one destroyed
 * while it waits is skipped. The device that goes (a stop, a lost WebGPU device) answers every waiting call false and
 * forgets what it had uploaded.
 */
import type { PixiTexture, PixiTextureSource } from "../types";
import type { SyncCtx, SyncState, UploadState, UploadWaiter } from "./types";

/** The calls of a source nobody waits for: none. */
const NOBODY: readonly UploadWaiter[] = Object.freeze([]);

/**
 * The resolve of a waiter before its promise exists: answers nobody.
 */
function unanswered(): void {
  // The promise is made right after the sources are counted.
}

/**
 * Creates the set of the sources uploaded on a device. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty weak set.
 */
function emptyDone(): WeakSet<PixiTextureSource> {
  return new WeakSet();
}

/**
 * Counts one source for a call: queued once whoever names it first, waited for once by each call, however many of its
 * textures share it. A source uploaded on this device, or destroyed, is not waited for.
 *
 * @param upload - The upload branch of the sync state.
 * @param source - The source of one texture of the call.
 * @param waiter - The call.
 */
function enqueue(upload: UploadState, source: PixiTextureSource, waiter: UploadWaiter): void {
  if (source.destroyed || upload.done.has(source)) return;

  let waiters = upload.waiting.get(source);

  if (waiters === undefined) {
    waiters = [];
    upload.waiting.set(source, waiters);
    upload.queue.push(source);
  }

  // The slices of one atlas page share its source: the call counts it once.
  if (waiters.at(-1) === waiter) return;

  waiters.push(waiter);
  waiter.left += 1;
}

/**
 * Queues the sources of textures for the GPU; resolves true once each went through `initSource` (the body of
 * `TexturesApi.upload`). Answers false at once while nothing draws or with `uploads: 0`, and true at once when every
 * source is on this device already. Asks for a frame.
 *
 * @param sctx - Domain context of the sync module.
 * @param textures - The textures.
 * @returns Whether every source is on the GPU.
 */
export function uploadTextures(sctx: SyncCtx, textures: readonly PixiTexture[]): Promise<boolean> {
  const { upload } = sctx.ctx.state.sync;

  if (sctx.ctx.config.uploads === 0 || !sctx.deps.host.ready()) return Promise.resolve(false);

  const waiter: UploadWaiter = { left: 0, resolve: unanswered };

  for (const texture of textures) enqueue(upload, texture.source, waiter);

  if (waiter.left === 0) return Promise.resolve(true);

  sctx.deps.demand.request();

  return new Promise(resolve => {
    waiter.resolve = resolve;
  });
}

/**
 * Uploads one source, the error of a throw logged: the source counts as done either way, so a failing one is logged
 * once and never stops the queue.
 *
 * @param sctx - Domain context of the sync module.
 * @param upload - The upload branch of the sync state.
 * @param source - The source.
 */
function put(sctx: SyncCtx, upload: UploadState, source: PixiTextureSource): void {
  try {
    sctx.deps.host.initSource(source);
  } catch (error) {
    // Its first draw uploads it the old way.
    sctx.ctx.log.warn("renderer:upload-failed", { source: source.label, error });
  }

  upload.done.add(source);
}

/**
 * Counts a source off for the calls that wait for it; a call whose last source it was answers true.
 *
 * @param upload - The upload branch of the sync state.
 * @param source - The source uploaded or skipped.
 */
function settle(upload: UploadState, source: PixiTextureSource): void {
  const waiters = upload.waiting.get(source) ?? NOBODY;

  upload.waiting.delete(source);

  for (const waiter of waiters) {
    waiter.left -= 1;
    if (waiter.left === 0) waiter.resolve(true);
  }
}

/**
 * Uploads up to `renderer.uploads` queued sources before the stage pass of a drawn frame; a source destroyed while it
 * waited is skipped and costs nothing of the budget. A queue that still holds sources asks for the next frame; one
 * that ran out empties. Reads two numbers and returns while the queue is empty.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when a source went to the GPU in this frame, so the frame is no sample of the adaptive rate.
 */
export function uploadStep(sctx: SyncCtx): boolean {
  const { upload } = sctx.ctx.state.sync;

  // per frame: an empty queue reads two numbers, allocates nothing and returns.
  if (upload.head >= upload.queue.length) return false;

  const budget = sctx.ctx.config.uploads;
  let made = 0;

  while (made < budget && upload.head < upload.queue.length) {
    const source = upload.queue[upload.head];

    upload.head += 1;

    if (source === undefined) continue;

    if (!source.destroyed) {
      put(sctx, upload, source);
      made += 1;
    }

    settle(upload, source);
  }

  if (upload.head < upload.queue.length) {
    sctx.deps.demand.request();

    return made > 0;
  }

  upload.queue.length = 0;
  upload.head = 0;

  return made > 0;
}

/**
 * Ends the queue of a device that goes, from state alone (`onStop` has no context): every waiting call answers false,
 * the queue empties, and the sources uploaded on it are forgotten, since a new device holds none of them.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopUploads(state: SyncState): void {
  const { upload } = state;

  // A call waits for several sources: it answers once, the later answers of its promise are ignored.
  for (const waiters of upload.waiting.values())
    for (const waiter of waiters) waiter.resolve(false);

  upload.waiting.clear();
  upload.queue.length = 0;
  upload.head = 0;
  upload.done = emptyDone();
}
