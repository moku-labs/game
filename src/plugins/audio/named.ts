/**
 * @file audio plugin — named sounds: an `sfx` with an `id` plays through a gain of its own into its
 * bus, so the next sound with that id, `stopSfx` and `app.audio.stop` can fade it out. One entry
 * per id in `state.named`; the entry object is the token a sound still decoding checks before it
 * starts. A sound without an id never comes here. A loop is a named sound that fades in and loops;
 * `state.loops` remembers it past its sound (`loops.ts`), until a stop or the leave of its scene.
 */
import { bufferOf } from "./decode";
import { ramp } from "./graph";
import { recordSound } from "./journal";
import type { AudioContextLike, AudioCtx, Bus, LoopSound, NamedSound, State } from "./types";

/** One named sound on its way: the id, the key, the checked bus, the fade in milliseconds, and the loop it is, if one. */
type NamedPlay = { id: string; key: string; bus: Bus; fadeMs: number; loop: LoopSound | undefined };

/**
 * The key a sound with an id waits under in `pendingSfx` while the unlock resumes the context.
 * The `#` keeps the ids apart from the asset keys, so the latest sound per id waits.
 *
 * @param id - The id of the sound.
 * @returns The key of the waiting sound.
 * @example
 * ```ts
 * waitingKey("voice"); // "#voice"
 * ```
 */
export function waitingKey(id: string): string {
  return `#${id}`;
}

/**
 * Fades one named sound out on the context clock and stops its source at the end of the fade. A
 * sound still decoding has neither a gain nor a source, so nothing is scheduled.
 *
 * @param state - The plugin state.
 * @param entry - The sound to fade.
 * @param seconds - Length of the fade, in seconds of the context clock.
 */
function fadeNamed(state: State, entry: NamedSound, seconds: number): void {
  const context = state.context;

  if (context === undefined) return;

  const now = context.currentTime;

  if (entry.gain !== undefined) ramp(entry.gain, 0, seconds, now);

  entry.source?.stop(now + seconds);
}

/**
 * Takes an id for a new sound: the sound that plays, or decodes, under it fades out over the fade
 * of the new one, and a fresh entry takes its place.
 *
 * @param state - The plugin state.
 * @param id - The id of the new sound.
 * @param seconds - Length of the fade of the replaced sound, in seconds.
 * @returns The entry of the new sound, its token.
 */
export function claimNamed(state: State, id: string, seconds: number): NamedSound {
  const playing = state.named.get(id);

  if (playing !== undefined) fadeNamed(state, playing, seconds);

  const entry: NamedSound = { gain: undefined, source: undefined };

  state.named.set(id, entry);

  return entry;
}

/**
 * Starts one named sound: a gain into the bus, the source into that gain. A sound that plays once
 * starts at gain 1; a loop loops and fades in from 0. When the source ends, its gain is
 * disconnected and the id is freed, unless a later sound took the id meanwhile.
 *
 * @param state - The plugin state.
 * @param context - The running audio context.
 * @param named - The id, its entry, the decoded buffer, the gain of the bus and the fade-in of a loop.
 * @param named.id - The id the sound plays under.
 * @param named.entry - The entry `claimNamed` returned for it.
 * @param named.buffer - The decoded buffer of the sound.
 * @param named.bus - The gain node of the bus the sound goes to.
 * @param named.loopFadeIn - The fade-in of a loop, in seconds; `undefined` for a sound that plays once.
 */
export function startNamed(
  state: State,
  context: AudioContextLike,
  named: {
    id: string;
    entry: NamedSound;
    buffer: AudioBuffer;
    bus: GainNode;
    loopFadeIn: number | undefined;
  }
): void {
  const { id, entry, loopFadeIn } = named;
  const gain = context.createGain();
  const source = context.createBufferSource();

  // The sound's own gain sits between it and the bus, so a fade touches this sound only; a loop starts silent.
  gain.gain.value = loopFadeIn === undefined ? 1 : 0;
  gain.connect(named.bus);
  source.buffer = named.buffer;
  source.connect(gain);

  // A loop plays its buffer over and over and rises from silence over its fade.
  if (loopFadeIn !== undefined) {
    source.loop = true;
    ramp(gain, 1, loopFadeIn, context.currentTime);
  }

  // At its end the gain leaves the graph, and the id is freed unless a later sound took it meanwhile.
  source.addEventListener(
    "ended",
    (): void => {
      gain.disconnect();

      if (state.named.get(id) === entry) state.named.delete(id);
    },
    { once: true }
  );
  entry.gain = gain;
  entry.source = source;
  source.start();
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
export async function playNamed(ctx: AudioCtx, sound: NamedPlay): Promise<void> {
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

  try {
    startNamed(state, context, {
      id,
      entry,
      buffer,
      bus: gain,
      loopFadeIn: loop === undefined ? undefined : seconds
    });
  } catch (error) {
    // A context that refused the source frees the id, so the next unlock starts a loop again.
    releaseNamed(state, id, entry);

    throw error;
  }

  journalNamed(ctx, sound);
}

/**
 * Frees an id whose sound could not start: its gain leaves the bus, and the entry leaves the map
 * when it is still the one claimed, so a later sound under the id keeps its own. The loop stays
 * remembered in `loops`.
 *
 * @param state - The plugin state.
 * @param id - The id the sound was to play under.
 * @param entry - The entry `claimNamed` returned for it.
 */
function releaseNamed(state: State, id: string, entry: NamedSound): void {
  entry.gain?.disconnect();

  if (state.named.get(id) === entry) state.named.delete(id);
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
 * Ends the sound under one id: the stop of `stopSfx`, of `app.audio.stop` and of the leave of a
 * loop's scene. The entry leaves the map, so a sound still decoding starts nothing, and the one
 * that plays fades out. A sound with that id waiting for the unlock is dropped, and so is the loop
 * remembered under it: neither the unlock nor a renewal starts it again. An id nothing plays under
 * changes nothing.
 *
 * @param state - The plugin state.
 * @param id - The id the sound was started with.
 * @param fadeMs - Length of the fade, in real milliseconds.
 */
export function stopNamed(state: State, id: string, fadeMs: number): void {
  // Only a context the unlock resumes has sounds waiting: the key, a new string, is made only then.
  if (state.pendingSfx.size > 0) state.pendingSfx.delete(waitingKey(id));

  state.loops.delete(id);

  const entry = state.named.get(id);

  if (entry === undefined) return;

  state.named.delete(id);
  fadeNamed(state, entry, fadeMs / 1000);
}

/**
 * Stops every named sound at once and forgets the ids. `onStop` and the iOS renewal run it: a
 * teardown has no time for a fade, and the context is closed right after. The loops stay
 * remembered, so the renewal's unlock starts them again; `onStop` forgets them itself.
 *
 * @param state - The plugin state.
 */
export function stopAllNamed(state: State): void {
  for (const entry of state.named.values()) entry.source?.stop();

  state.named.clear();
}
