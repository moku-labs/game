/**
 * @file audio plugin — the two effect handlers and the decode cache. A sound is a new source
 * every time; music is one looping track on its own gain, which is what cross-fades. At
 * `music: "decode"` the track is a buffer source, at `music: "stream"` a media element.
 */
import type { Descriptor, Hint } from "../flow/types";
import type { Json } from "../model/types";
import { isBus, ramp } from "./graph";
import { recordSound } from "./journal";
import {
  canStream,
  disposeStream,
  pauseStream,
  resumeStream,
  retireStream,
  startStream
} from "./stream";
import type {
  AudioContextLike,
  AudioCtx,
  MusicRequest,
  MusicSwitch,
  SfxRequest,
  State
} from "./types";

/** One music switch on its way: the key, the length of the cross-fade in seconds, and its token. */
type TrackStart = { key: string; seconds: number; pending: MusicSwitch };

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
  recordSound(ctx, { key: request.key, bus: request.bus, kind: "sfx" });
}

/**
 * Fades the track that is playing out. A decoded source stops at the end of the fade on the
 * context clock; a streamed track retires and its element is freed when the fade ends.
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

  if (current.stream !== undefined) retireStream(state, current.stream, seconds * 1000);
}

/**
 * Tells whether a track really plays, not one only remembered for the unlock.
 *
 * @param state - The plugin state.
 * @returns True when a decoded source or a streamed element is running.
 */
export function isMusicPlaying(state: State): boolean {
  return state.music?.source !== undefined || state.music?.stream !== undefined;
}

/**
 * Tells whether a key is the track that really plays.
 *
 * @param state - The plugin state.
 * @param key - The asset key a switch asks for.
 * @returns True when a track of that key is running.
 */
function isPlaying(state: State, key: string): boolean {
  return state.music?.key === key && isMusicPlaying(state);
}

/**
 * Cross-fades from the track that plays to a new looping source of the decoded buffer.
 *
 * @param ctx - Domain context of the plugin.
 * @param context - The running audio context.
 * @param track - The key, its decoded buffer and the length of the fade in seconds.
 * @param track.key - Asset key of the new track.
 * @param track.buffer - The decoded buffer of that key.
 * @param track.seconds - Length of the cross-fade, in seconds of the context clock.
 */
function startTrack(
  ctx: AudioCtx,
  context: AudioContextLike,
  track: { key: string; buffer: AudioBuffer; seconds: number }
): void {
  const state = ctx.state;
  const bus = state.buses.music.gain;

  if (bus === undefined) return;

  fadeOut(state, track.seconds);

  const gain = context.createGain();
  const source = context.createBufferSource();

  gain.gain.value = 0;
  gain.connect(bus);
  source.buffer = track.buffer;
  source.loop = true;
  source.connect(gain);
  ramp(gain, 1, track.seconds, context.currentTime);
  source.start();

  state.music = { key: track.key, gain, source, stream: undefined };
  recordSound(ctx, { key: track.key, bus: "music", kind: "music" });
}

/**
 * Plays a key by the decode path: waits for its buffer, then cross-fades to a new looping source.
 *
 * @param ctx - Domain context of the plugin.
 * @param context - The running audio context.
 * @param start - The key, the length of the fade and the token of this switch.
 */
async function playDecoded(
  ctx: AudioCtx,
  context: AudioContextLike,
  start: TrackStart
): Promise<void> {
  const state = ctx.state;
  const buffer = await bufferOf(ctx, start.key);

  // A later request replaced this switch: it neither starts nor fades anything.
  if (state.musicPending !== start.pending) return;

  state.musicPending = undefined;

  // A key without a file changes nothing: the track that plays keeps playing.
  if (buffer === undefined) return;

  startTrack(ctx, context, { key: start.key, buffer, seconds: start.seconds });
}

/**
 * Plays a key through a media element. The fades start when `play()` fulfilled, not at the
 * request: the element makes sound only from then on, and a refused play leaves the old track
 * untouched. A refused play warns once per key and remembers the key when no track plays, so the
 * next switch to it, or the next unlock, tries again.
 *
 * @param ctx - Domain context of the plugin.
 * @param context - The running audio context.
 * @param start - The key, the length of the fade and the token of this switch.
 */
async function playStreamed(
  ctx: AudioCtx,
  context: AudioContextLike,
  start: TrackStart
): Promise<void> {
  const state = ctx.state;
  const bus = state.buses.music.gain;
  const asset = ctx.deps.assets.audio(start.key);

  if (asset === undefined) {
    warnOnce(ctx, start.key, "audio: no audio for key");

    return;
  }

  if (bus === undefined) return;

  const stream = startStream(context, bus, asset);

  state.musicPending = start.pending;

  const played = await resumeStream(stream);

  // A later request replaced this switch: its element is freed and nothing fades.
  if (state.musicPending !== start.pending) {
    disposeStream(state, stream);

    return;
  }

  state.musicPending = undefined;

  if (!played) {
    disposeStream(state, stream);
    refused(ctx, start.key);

    return;
  }

  fadeOut(state, start.seconds);
  ramp(stream.gain, 1, start.seconds, context.currentTime);
  state.music = { key: start.key, gain: stream.gain, source: undefined, stream };

  // A push that came while play() was on its way found no track to pause: pause it now.
  if (state.paused) pauseStream(stream);

  recordSound(ctx, { key: start.key, bus: "music", kind: "music" });
}

/**
 * Handles a music element that refused to play: one warning per key, and the key is remembered
 * when nothing else plays. A track that plays keeps playing and stays the one `stop` frees.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - The key whose element refused.
 */
function refused(ctx: AudioCtx, key: string): void {
  warnOnce(ctx, key, "audio: the music element did not play");

  if (isMusicPlaying(ctx.state)) return;

  ctx.state.music = { key, gain: undefined, source: undefined, stream: undefined };
}

/**
 * Switches the music: the handler of the kind `"music"` and what `scenes:changed` calls. The same
 * key does nothing, a new key cross-fades, `null` fades out. While the context is locked the key
 * is only remembered; the first touch starts it. A key that is still on its way counts as the
 * same key, and every other request replaces it: the replaced switch starts nothing when its
 * buffer or its element is ready, so one tap that unlocks the context and enters a scene with the
 * same track starts it once. `config.music` picks the decode or the stream path.
 *
 * @param ctx - Domain context of the plugin.
 * @param request - The key to play and the length of the cross-fade.
 */
export async function playMusic(ctx: AudioCtx, request: MusicRequest): Promise<void> {
  const state = ctx.state;
  const key = request.key;
  const seconds = request.fadeMs / 1000;

  if (key !== null && state.musicPending?.key === key) return;

  state.musicPending = undefined;

  if (key === null) {
    fadeOut(state, seconds);
    state.music = undefined;

    return;
  }

  if (isPlaying(state, key)) return;

  const context = state.context;

  if (context === undefined || !state.unlocked) {
    state.music = { key, gain: undefined, source: undefined, stream: undefined };

    return;
  }

  const start: TrackStart = { key, seconds, pending: { key } };

  if (ctx.config.music === "stream") {
    if (canStream()) {
      await playStreamed(ctx, context, start);

      return;
    }

    warnOnce(ctx, key, "audio: no media element, music decodes");
  }

  state.musicPending = start.pending;
  await playDecoded(ctx, context, start);
}

/**
 * Pauses the streamed track that plays. A lifecycle push runs it once every bus is at zero;
 * retiring tracks are left to their timers, and a decoded track needs nothing but the gains.
 *
 * @param state - The plugin state.
 */
export function pauseMusic(state: State): void {
  const stream = state.music?.stream;

  if (stream !== undefined) pauseStream(stream);
}

/**
 * Plays the streamed track again when the pause ends. A refused `play()` warns once per key and
 * the track stays as it is: the next switch replaces it.
 *
 * @param ctx - Domain context of the plugin.
 */
export function resumeMusic(ctx: AudioCtx): void {
  const music = ctx.state.music;
  const stream = music?.stream;

  if (music === undefined || stream === undefined) return;

  resumeStream(stream).then(played => {
    if (!played) warnOnce(ctx, music.key, "audio: the music element did not play");
  });
}

/**
 * Stops the music at once and forgets the track and the switch still on its way. `onStop` runs
 * it: a teardown has no time for a fade, and the context is closed right after. A streamed track
 * is freed here, while its nodes can still disconnect.
 *
 * @param state - The plugin state.
 */
export function stopMusic(state: State): void {
  const music = state.music;

  music?.source?.stop();

  if (music?.stream !== undefined) disposeStream(state, music.stream);

  state.music = undefined;
  state.musicPending = undefined;
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
