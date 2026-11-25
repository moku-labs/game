/**
 * @file audio plugin — the decode cache and the one warning per key. Every sound and every decoded
 * music track reads its buffer through here, so a key decodes once per run however often it plays,
 * and a missing or broken file says so once.
 */
import type { AudioCtx } from "./types";

/**
 * Warns about one key exactly once per run. A missing file is a mistake in the manifest, not a
 * reason to flood the log of every frame that plays the sound.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - The asset key the warning is about.
 * @param event - What happened.
 */
export function warnOnce(ctx: AudioCtx, key: string, event: string): void {
  if (ctx.state.warned.has(key)) return;

  ctx.state.warned.add(key);
  ctx.log.warn(event, { key });
}

/**
 * Decodes one key, at most once. The promise is cached before it settles, so two plays of the
 * same sound in one frame decode a single time.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - Asset key of an audio file, `.mp3` or `.m4a`.
 * @returns The pending buffer, or `undefined` when the bundle carries no such file.
 */
export function decode(ctx: AudioCtx, key: string): Promise<AudioBuffer> | undefined {
  const state = ctx.state;
  const cached = state.decoded.get(key);

  if (cached !== undefined) return cached;

  const context = state.context;

  if (context === undefined) return undefined;

  const asset = ctx.deps.assets.audio(key);

  if (asset === undefined) {
    warnOnce(ctx, key, "audio: no audio for key");

    return undefined;
  }

  // eslint-disable-next-line unicorn/prefer-spread -- an ArrayBuffer copy: decodeAudioData detaches what it gets.
  const pending = context.decodeAudioData(asset.bytes.slice(0));

  state.decoded.set(key, pending);

  return pending;
}

/**
 * Awaits the decoded buffer of one key. A file that does not decode warns once and plays nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - Asset key of an audio file, `.mp3` or `.m4a`.
 * @returns The buffer, or `undefined` when there is nothing to play.
 */
export async function bufferOf(ctx: AudioCtx, key: string): Promise<AudioBuffer | undefined> {
  const pending = decode(ctx, key);

  if (pending === undefined) return undefined;

  try {
    return await pending;
  } catch {
    warnOnce(ctx, key, "audio: the audio file did not decode");

    return undefined;
  }
}
