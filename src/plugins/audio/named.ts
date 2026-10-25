/**
 * @file audio plugin — named sounds: an `sfx` with an `id` plays through a gain of its own into its
 * bus, so the next sound with that id, `stopSfx` and `app.audio.stop` can fade it out. One entry
 * per id in `state.named`; the entry object is the token a sound still decoding checks before it
 * starts. A sound without an id never comes here.
 */
import { ramp } from "./graph";
import type { AudioContextLike, NamedSound, State } from "./types";

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
 * Starts one named sound: a gain at 1 into the bus, the source into that gain. When the source
 * ends, its gain is disconnected and the id is freed, unless a later sound took the id meanwhile.
 *
 * @param state - The plugin state.
 * @param context - The running audio context.
 * @param named - The id, its entry, the decoded buffer and the gain of the bus.
 * @param named.id - The id the sound plays under.
 * @param named.entry - The entry `claimNamed` returned for it.
 * @param named.buffer - The decoded buffer of the sound.
 * @param named.bus - The gain node of the bus the sound goes to.
 */
export function startNamed(
  state: State,
  context: AudioContextLike,
  named: { id: string; entry: NamedSound; buffer: AudioBuffer; bus: GainNode }
): void {
  const { id, entry } = named;
  const gain = context.createGain();
  const source = context.createBufferSource();

  gain.gain.value = 1;
  gain.connect(named.bus);
  source.buffer = named.buffer;
  source.connect(gain);
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
 * Ends the sound under one id: the stop of `stopSfx` and of `app.audio.stop`. The entry leaves the
 * map, so a sound still decoding starts nothing, and the one that plays fades out. A sound with
 * that id waiting for the unlock is dropped. An id nothing plays under changes nothing.
 *
 * @param state - The plugin state.
 * @param id - The id the sound was started with.
 * @param fadeMs - Length of the fade, in real milliseconds.
 */
export function stopNamed(state: State, id: string, fadeMs: number): void {
  state.pendingSfx.delete(waitingKey(id));

  const entry = state.named.get(id);

  if (entry === undefined) return;

  state.named.delete(id);
  fadeNamed(state, entry, fadeMs / 1000);
}

/**
 * Stops every named sound at once and forgets the ids. `onStop` runs it: a teardown has no time
 * for a fade, and the context is closed right after.
 *
 * @param state - The plugin state.
 */
export function stopAllNamed(state: State): void {
  for (const entry of state.named.values()) entry.source?.stop();

  state.named.clear();
}
