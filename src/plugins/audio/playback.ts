/**
 * @file audio plugin — the three effect handlers and the decode cache. A sound is a new source
 * every time, and a sound with an id also gets a gain of its own (`named.ts`), which is what the
 * next sound with that id and `stopSfx` fade; a loop is a sound with an id that fades in, loops, and
 * is remembered in `loops` for the unlock. Music is one looping track on its own gain, which is
 * what cross-fades. At `music: "decode"` the track is a buffer source, at `music: "stream"` a
 * media element.
 */
import type { Descriptor, Hint } from "../flow/types";
import type { Json } from "../model/types";
import { isBus, ramp } from "./graph";
import { recordSound } from "./journal";
import { claimNamed, isSameLoop, startNamed, stopNamed, waitingKey } from "./named";
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
  Bus,
  LoopSound,
  MusicRequest,
  MusicSwitch,
  SfxRequest,
  State
} from "./types";

/** One music switch on its way: the key, the length of the cross-fade in seconds, and its token. */
type TrackStart = { key: string; seconds: number; pending: MusicSwitch };

/** One named sound on its way: the id, the key, the checked bus, the fade in milliseconds, and the loop it is, if one. */
type NamedPlay = { id: string; key: string; bus: Bus; fadeMs: number; loop: LoopSound | undefined };

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
 * Reads the fade of a descriptor that ends a named sound.
 *
 * @param descriptor - The descriptor the handler was called with.
 * @param fadeMs - The configured fade, used when the descriptor names none.
 * @returns The fade, in milliseconds.
 */
function fadeOf(descriptor: Descriptor | Hint, fadeMs: number): number {
  return validFade(fieldOf(descriptor.payload, "fadeMs"), fadeMs);
}

/**
 * Takes a fade a descriptor named only when the clock can schedule it: a finite number, 0 or more.
 * `NaN` or a negative fade would make the ramp and the stop throw inside the handler.
 *
 * @param fade - The `fadeMs` the payload carries.
 * @param fallback - The configured fade.
 * @returns The fade, in milliseconds.
 * @example
 * ```ts
 * validFade(-5, 120); // 120
 * ```
 */
function validFade(fade: Json | undefined, fallback: number): number {
  return typeof fade === "number" && Number.isFinite(fade) && fade >= 0 ? fade : fallback;
}

/**
 * Reads the key, the bus, the id, the fade and the loop flag out of the `sfx` descriptor `anim`
 * builds.
 *
 * @param descriptor - The descriptor the handler was called with.
 * @param fadeMs - The configured fade of a named sound, used when the descriptor names none.
 * @returns The request, or `undefined` when the descriptor names no key.
 */
function sfxOf(descriptor: Descriptor | Hint, fadeMs: number): SfxRequest | undefined {
  const key = fieldOf(descriptor.payload, "key");
  const bus = fieldOf(descriptor.payload, "bus");
  const id = fieldOf(descriptor.payload, "id");

  if (typeof key !== "string") return undefined;

  return {
    key,
    bus: typeof bus === "string" ? bus : DEFAULT_BUS,
    id: typeof id === "string" ? id : undefined,
    fadeMs: fadeOf(descriptor, fadeMs),
    loop: fieldOf(descriptor.payload, "loop") === true
  };
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

  return {
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    key: typeof key === "string" ? key : null,
    fadeMs: validFade(fieldOf(descriptor.payload, "fadeMs"), fadeMs)
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
 * ignores its signal: a sound that began plays to its end, unless a sound with its id or a stop
 * ends it. While a gesture's `resume()` is pending the sound waits in `pendingSfx`, one per id
 * and one per key without an id. A locked context no gesture is resuming drops it: the start
 * attempt of the unlock queues nothing. A loop goes through `playLoop`, and the latest request
 * for an id wins: a sound that plays once under it forgets the loop there.
 *
 * @param ctx - Domain context of the plugin.
 * @param descriptor - The `sfx` descriptor `anim` built.
 */
export async function playSfx(ctx: AudioCtx, descriptor: Descriptor | Hint): Promise<void> {
  const state = ctx.state;

  // Headless: no context, and no renewal on its way to a new one.
  if (state.context === undefined && state.renewing === undefined) return;

  const request = sfxOf(descriptor, ctx.config.sfxFadeMs);

  if (request === undefined) return;

  // A loop with no id plays once: nothing could stop it.
  if (request.loop && request.id !== undefined) {
    await playLoop(ctx, request, request.id);

    return;
  }

  if (request.id !== undefined) state.loops.delete(request.id);

  // Between the two contexts of a renewal a sound that plays once is dropped.
  if (state.context === undefined) return;

  if (!state.unlocked) {
    queueWhileResuming(state, request);

    return;
  }

  await playRequest(ctx, request);
}

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
async function playLoop(ctx: AudioCtx, request: SfxRequest, id: string): Promise<void> {
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
 * so a gesture and the start attempt that settle together start it once.
 *
 * @param ctx - Domain context of the plugin.
 */
export function startLoops(ctx: AudioCtx): void {
  const state = ctx.state;

  for (const [id, loop] of state.loops) {
    if (!state.named.has(id)) void startLoop(ctx, id, loop);
  }
}

/**
 * Keeps a sound fired while the context is locked, one per key and one per id, when a gesture's
 * `resume()` is on its way. A locked context nobody resumes drops it.
 *
 * @param state - The plugin state.
 * @param request - The sound that was fired.
 */
function queueWhileResuming(state: State, request: SfxRequest): void {
  if (!state.resuming) return;

  state.pendingSfx.set(request.id === undefined ? request.key : waitingKey(request.id), request);
}

/**
 * Ends the sound under one id: the handler of the kind `"stopSfx"`, for an effect, an animation
 * step and a released hint alike. A descriptor without an id ends nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param descriptor - The `stopSfx` descriptor `anim` built.
 */
export function stopNamedSfx(ctx: AudioCtx, descriptor: Descriptor | Hint): void {
  const id = fieldOf(descriptor.payload, "id");

  if (typeof id !== "string") return;

  stopNamed(ctx.state, id, fadeOf(descriptor, ctx.config.sfxFadeMs));
}

/**
 * Plays a sound under its id: the sound that has the id fades out over the fade of this one, and
 * this one starts through its own gain once its buffer is there, unless a later sound with the id
 * or a stop took its place while it decoded. A loop fades in over the same fade. A file that is
 * missing frees the id, and forgets a loop, so no unlock tries it again.
 *
 * @param ctx - Domain context of the plugin.
 * @param sound - The id, the key, the checked bus, the fade and the loop it is.
 */
async function playNamed(ctx: AudioCtx, sound: NamedPlay): Promise<void> {
  const state = ctx.state;
  const { id, loop } = sound;
  const seconds = sound.fadeMs / 1000;
  const entry = claimNamed(state, id, seconds);
  const buffer = await bufferOf(ctx, sound.key);

  // A later sound with this id, or a stop, took its place: it starts nothing.
  if (state.named.get(id) !== entry) return;

  const context = state.context;
  const gain = state.buses[sound.bus].gain;

  if (buffer === undefined || context === undefined || gain === undefined) {
    state.named.delete(id);

    if (loop !== undefined) state.loops.delete(id);

    return;
  }

  startNamed(state, context, {
    id,
    entry,
    buffer,
    bus: gain,
    loopFadeIn: loop === undefined ? undefined : seconds
  });
  journalNamed(ctx, sound);
}

/**
 * Writes the journal entry of a named sound that started. A loop has one, at its first start: its
 * start again after an iOS renewal is the same sound.
 *
 * @param ctx - Domain context of the plugin.
 * @param sound - The named sound that started.
 */
function journalNamed(ctx: AudioCtx, sound: NamedPlay): void {
  const { key, bus, id, loop } = sound;

  if (loop === undefined) {
    recordSound(ctx, { key, bus, kind: "sfx", id });

    return;
  }

  if (loop.started) return;

  loop.started = true;
  recordSound(ctx, { key, bus, kind: "sfx", id, loop: true });
}

/**
 * Starts one source of a sound on its bus. `playSfx` calls it for a live play and the unlock for
 * every sound that waited for the resume. A sound with an id goes through `playNamed`.
 *
 * @param ctx - Domain context of the plugin.
 * @param request - The key, the bus, the id and the fade of the sound.
 */
export async function playRequest(ctx: AudioCtx, request: SfxRequest): Promise<void> {
  const state = ctx.state;
  const context = state.context;

  if (context === undefined) return;

  if (!isBus(state, request.bus)) {
    ctx.log.warn("audio: unknown bus", { bus: request.bus });

    return;
  }

  if (request.id !== undefined) {
    const { key, bus, fadeMs } = request;

    await playNamed(ctx, { id: request.id, key, bus, fadeMs, loop: undefined });

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
 * Forgets the decoded buffer of a music key that no longer plays, so only the playing track stays
 * decoded: a 60 s stereo track is about 22 MB. A source that still fades out keeps its own buffer;
 * a later switch back decodes the key again while the current track keeps playing.
 *
 * @param state - The plugin state.
 * @param key - The key of the track that left, or `undefined` when none played.
 */
export function forgetTrack(state: State, key: string | undefined): void {
  if (key === undefined || state.music?.key === key) return;

  state.decoded.delete(key);
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

  const left = state.music?.key;

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
  forgetTrack(state, left);
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

  // A later request replaced this switch: it neither starts nor fades anything, nor keeps its buffer.
  if (state.musicPending !== start.pending) {
    forgetTrack(state, start.key);

    return;
  }

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
 * is only remembered; the unlock starts it. A key that is still on its way counts as the
 * same key, and every other request replaces it: the replaced switch starts nothing when its
 * buffer or its element is ready, so one tap that unlocks the context and enters a scene with the
 * same track starts it once. `config.music` picks the decode or the stream path; on the decode path
 * the track that leaves, by a switch, by `null` or replaced while it decoded, leaves the cache too.
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
    const left = state.music?.key;

    fadeOut(state, seconds);
    state.music = undefined;
    forgetTrack(state, left);

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
