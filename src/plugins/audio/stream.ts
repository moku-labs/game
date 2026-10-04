/**
 * @file audio plugin — streamed music: the only file that touches `Audio`, `URL` and
 * `setTimeout`. A track is an `<audio>` element on a `blob:` URL of the bytes `assets` holds,
 * routed through a media element source into its own gain, so every level and every fade still
 * runs on the context clock. Nothing here runs without a context: headless stays silent and
 * allocation-free.
 */
import type { AudioAsset } from "../assets/types";
import type { AudioContextLike, State, StreamTrack } from "./types";

/**
 * Tells whether the runtime can build a media element. A runtime with WebAudio but without
 * `Audio` plays music by the decode path instead.
 *
 * @returns True when the global `Audio` constructor exists.
 */
export function canStream(): boolean {
  return typeof globalThis.Audio === "function";
}

/**
 * Builds one streamed track: a `blob:` URL of the asset bytes typed by the asset's MIME, a
 * looping element on it, its source node and a track gain at 0 that feeds the music bus. The
 * Blob copies the bytes, so the track outlives a bundle unload. The element is not playing yet.
 *
 * @param context - The running audio context.
 * @param bus - The gain of the `music` bus.
 * @param asset - The undecoded bytes and MIME type `assets` holds for the key.
 * @returns The track, silent and paused.
 */
export function startStream(
  context: AudioContextLike,
  bus: GainNode,
  asset: AudioAsset
): StreamTrack {
  const url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }));
  const element = new Audio();

  element.src = url;
  element.loop = true;
  element.preload = "auto";

  const node = context.createMediaElementSource(element);
  const gain = context.createGain();

  gain.gain.value = 0;
  node.connect(gain);
  gain.connect(bus);

  return { element, node, gain, url };
}

/**
 * Asks the element to play. An autoplay policy or a decoder error refuses it; the refusal is an
 * answer, not a failure, so the promise never rejects.
 *
 * @param stream - The track to play.
 * @returns True once the element plays, false when `play()` was refused.
 */
export function resumeStream(stream: StreamTrack): Promise<boolean> {
  return stream.element.play().then(
    () => true,
    () => false
  );
}

/**
 * Pauses the element, so a backgrounded game burns no decoder and shows no Now Playing card.
 *
 * @param stream - The track to pause.
 */
export function pauseStream(stream: StreamTrack): void {
  stream.element.pause();
}

/**
 * Frees a track for good: pauses the element, disconnects both nodes, unloads the element so the
 * decoder is released, and revokes the URL. Every URL the plugin made is revoked here and
 * nowhere else. A track that was retiring loses its timer and its entry.
 *
 * @param state - The plugin state, which holds the retiring tracks.
 * @param stream - The track to free.
 */
export function disposeStream(state: State, stream: StreamTrack): void {
  for (const entry of state.retiring) {
    if (entry.stream !== stream) continue;

    clearTimeout(entry.timer);
    state.retiring.delete(entry);
  }

  stream.element.pause();
  stream.node.disconnect();
  stream.gain.disconnect();
  stream.element.removeAttribute("src");
  stream.element.load();
  URL.revokeObjectURL(stream.url);
}

/**
 * Lets a track fade out and frees it when the fade ends. This is the one wall-clock timer of the
 * plugin: it only frees a decoder whose output is already at 0, so a throttled background tab
 * just frees it later.
 *
 * @param state - The plugin state, which holds the retiring tracks.
 * @param stream - The track whose gain already ramps to 0.
 * @param fadeMs - Length of the fade, in milliseconds.
 */
export function retireStream(state: State, stream: StreamTrack, fadeMs: number): void {
  const timer = setTimeout(() => {
    disposeStream(state, stream);
  }, fadeMs);

  state.retiring.add({ stream, timer });
}
