/**
 * @file audio plugin — the two effect handlers and the decode cache. A sound is a new source
 * every time; music is one looping source on its own gain, which is what cross-fades.
 */
import type { Descriptor, Hint } from "../flow/types";
import type { Json } from "../model/types";
import { isBus, ramp } from "./graph";
import type { AudioCtx, MusicRequest, SfxRequest, State } from "./types";

/** The bus a sound goes to when the descriptor names none. */
const DEFAULT_BUS = "sfx";

/**
 * Reads one field of a descriptor payload. A payload is plain JSON built by another plugin, so
 * anything that is not an object answers `undefined` instead of throwing.
 *
 * @param payload - The payload of the descriptor.
 * @param field - Name of the field to read.
 * @returns The value, or `undefined`.
 * @example
 * ```ts
 * fieldOf({ key: "ui.click" }, "key"); // "ui.click"
 * ```
 */
function fieldOf(payload: Json | undefined, field: string): Json | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;

  return payload[field];
}

/**
 * Reads the key and the bus out of the `sfx` descriptor `anim` builds.
 *
 * @param descriptor - The descriptor the handler was called with.
 * @returns The request, or `undefined` when the descriptor names no key.
 */
function sfxOf(descriptor: Descriptor | Hint): SfxRequest | undefined {
  const key = fieldOf(descriptor.payload, "key");
  const bus = fieldOf(descriptor.payload, "bus");

  if (typeof key !== "string") return undefined;

  return { key, bus: typeof bus === "string" ? bus : DEFAULT_BUS };
}

/**
 * Reads the key and the fade out of a `music` descriptor.
 *
 * @param descriptor - The descriptor the handler was called with.
 * @param fadeMs - The configured cross-fade, used when the descriptor names none.
 * @returns The request the switch runs on.
 */
export function musicOf(descriptor: Descriptor | Hint, fadeMs: number): MusicRequest {
  const key = fieldOf(descriptor.payload, "key");
  const fade = fieldOf(descriptor.payload, "fadeMs");

  return {
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    key: typeof key === "string" ? key : null,
    fadeMs: typeof fade === "number" ? fade : fadeMs
  };
}

/**
 * Warns about one key exactly once per run. A missing file is a mistake in the manifest, not a
 * reason to flood the log of every frame that plays the sound.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - The asset key the warning is about.
 * @param event - What happened.
 */
function warnOnce(ctx: AudioCtx, key: string, event: string): void {
  if (ctx.state.warned.has(key)) return;

  ctx.state.warned.add(key);
  ctx.log.warn(event, { key });
}

/**
 * Decodes one key, at most once. The promise is cached before it settles, so two plays of the
 * same sound in one frame decode a single time.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - Asset key of an `.mp3`.
 * @returns The pending buffer, or `undefined` when the bundle carries no such file.
 */
export function decode(ctx: AudioCtx, key: string): Promise<AudioBuffer> | undefined {
  const state = ctx.state;
  const cached = state.decoded.get(key);

  if (cached !== undefined) return cached;

  const context = state.context;

  if (context === undefined) return undefined;

  const bytes = ctx.deps.assets.audio(key);

  if (bytes === undefined) {
    warnOnce(ctx, key, "audio: no audio for key");

    return undefined;
  }

  // eslint-disable-next-line unicorn/prefer-spread -- an ArrayBuffer copy: decodeAudioData detaches what it gets.
  const pending = context.decodeAudioData(bytes.slice(0));

  state.decoded.set(key, pending);

  return pending;
}

/**
 * Awaits the decoded buffer of one key. A file that does not decode warns once and plays nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - Asset key of an `.mp3`.
 * @returns The buffer, or `undefined` when there is nothing to play.
 */
async function bufferOf(ctx: AudioCtx, key: string): Promise<AudioBuffer | undefined> {
  const pending = decode(ctx, key);

  if (pending === undefined) return undefined;

  try {
    return await pending;
  } catch {
    warnOnce(ctx, key, "audio: the audio file did not decode");

    return undefined;
  }
}

/**
 * Plays one sound: the handler of the kind `"sfx"`. Every play is its own source, so the same key
 * twice in one frame is heard twice, and the promise resolves when the sound STARTED. The handler
 * ignores its signal: a sound that began plays to its end. While the first gesture's `resume()` is
 * pending the sound waits in `pendingSfx`, one per key; before any gesture it is dropped.
 *
 * @param ctx - Domain context of the plugin.
 * @param descriptor - The `sfx` descriptor `anim` built.
 */
export async function playSfx(ctx: AudioCtx, descriptor: Descriptor | Hint): Promise<void> {
  const state = ctx.state;

  if (state.context === undefined) return;

  const request = sfxOf(descriptor);

  if (request === undefined) return;

  if (!state.unlocked) {
    if (state.resuming) state.pendingSfx.set(request.key, request);

    return;
  }

  await playRequest(ctx, request);
}

/**
 * Starts one source of a sound on its bus. `playSfx` calls it for a live play and the unlock for
 * every sound that waited for the resume.
 *
 * @param ctx - Domain context of the plugin.
 * @param request - The key and the bus of the sound.
 */
export async function playRequest(ctx: AudioCtx, request: SfxRequest): Promise<void> {
  const state = ctx.state;
  const context = state.context;

  if (context === undefined) return;

  if (!isBus(state, request.bus)) {
    ctx.log.warn("audio: unknown bus", { bus: request.bus });

    return;
  }

  const buffer = await bufferOf(ctx, request.key);
  const gain = state.buses[request.bus].gain;

  if (buffer === undefined || gain === undefined) return;

  const source = context.createBufferSource();

  source.buffer = buffer;
  source.connect(gain);
  source.start();
}

/**
 * Fades the track that is playing out and stops its source at the end of the fade.
 *
 * @param state - The plugin state.
 * @param seconds - Length of the fade, in seconds of the context clock.
 */
function fadeOut(state: State, seconds: number): void {
  const current = state.music;
  const context = state.context;

  if (current === undefined || context === undefined) return;

  if (current.gain !== undefined) ramp(current.gain, 0, seconds, context.currentTime);

  current.source?.stop(context.currentTime + seconds);
}

/**
 * Switches the music: the handler of the kind `"music"` and what `scenes:changed` calls. The same
 * key does nothing, a new key cross-fades, `null` fades out. While the context is locked the key
 * is only remembered; the first touch starts it.
 *
 * @param ctx - Domain context of the plugin.
 * @param request - The key to play and the length of the cross-fade.
 */
export async function playMusic(ctx: AudioCtx, request: MusicRequest): Promise<void> {
  const state = ctx.state;
  const key = request.key;
  const seconds = request.fadeMs / 1000;
  const current = state.music;

  if (key !== null && current?.key === key && current.source !== undefined) return;

  if (key === null) {
    fadeOut(state, seconds);
    state.music = undefined;

    return;
  }

  const context = state.context;

  if (context === undefined || !state.unlocked) {
    state.music = { key, source: undefined, gain: undefined };

    return;
  }

  const buffer = await bufferOf(ctx, key);
  const bus = state.buses.music.gain;

  // A key without a file changes nothing: the track that plays keeps playing.
  if (buffer === undefined || bus === undefined) return;

  fadeOut(state, seconds);

  const gain = context.createGain();
  const source = context.createBufferSource();

  gain.gain.value = 0;
  gain.connect(bus);
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  ramp(gain, 1, seconds, context.currentTime);
  source.start();

  state.music = { key, source, gain };
}

/**
 * Stops the music at once and forgets the track. `onStop` runs it: a teardown has no time for a
 * fade, and the context is closed right after.
 *
 * @param state - The plugin state.
 */
export function stopMusic(state: State): void {
  state.music?.source?.stop();
  state.music = undefined;
}

/**
 * Follows a music switch nobody awaits. A failure of the audio hardware is not the graph's
 * problem, so it goes to the log and the game plays on.
 *
 * @param ctx - Domain context of the plugin.
 * @param pending - The switch that was started.
 */
export function trackMusic(ctx: AudioCtx, pending: Promise<void>): void {
  pending.catch((error: unknown) => {
    ctx.log.error(
      "audio: the music switch failed",
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  });
}
