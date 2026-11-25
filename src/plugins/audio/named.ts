/**
 * @file audio plugin — named sounds: an `sfx` with an `id` plays through a gain of its own into its
 * bus, so the next sound with that id, `stopSfx` and `app.audio.stop` can fade it out. One entry
 * per id in `state.named`; the entry object is the token a sound still decoding checks before it
 * starts. A sound without an id never comes here. A loop is a named sound that fades in and loops;
 * `state.loops` remembers it past its sound, until a stop or the leave of its scene.
 */
import { ramp } from "./graph";
import type { AudioContextLike, LoopSound, NamedSound, State } from "./types";

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

  gain.gain.value = loopFadeIn === undefined ? 1 : 0;
  gain.connect(named.bus);
  source.buffer = named.buffer;
  source.connect(gain);

  if (loopFadeIn !== undefined) {
    source.loop = true;
    ramp(gain, 1, loopFadeIn, context.currentTime);
  }

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

/** What `stopSceneLoops` walks with, read by its module-level callback: no closure per call. `state` is set for the walk only. */
const leaving: { state: State | undefined; scene: string; fadeMs: number } = {
  state: undefined,
  scene: "",
  fadeMs: 0
};

/**
 * Stops one loop when it belongs to the scene that leaves.
 *
 * @param loop - The loop.
 * @param id - The id it plays under.
 */
function stopIfLeaving(loop: LoopSound, id: string): void {
  const state = leaving.state;

  if (state === undefined || loop.scene !== leaving.scene) return;

  stopNamed(state, id, leaving.fadeMs);
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

  leaving.state = state;
  leaving.scene = from;
  leaving.fadeMs = fadeMs;
  // A `for…of` over the entries makes an iterator and an entry array per loop (128 B for two, measured).
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.loops.forEach(stopIfLeaving);
  leaving.state = undefined;
}
