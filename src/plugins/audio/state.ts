/**
 * @file audio plugin — state factory. The buses start at the configured volumes, so a headless
 * run answers `volume()` with the same numbers a run with a context does.
 */
import type { Bus, BusState, Config, MusicTrack, SfxRequest, State } from "./types";

/**
 * Creates the decode cache. Its own function because lint rule L5 refuses a collection built
 * inside an exported declaration.
 *
 * @returns An empty cache of decoded buffers.
 */
function emptyCache(): Map<string, Promise<AudioBuffer>> {
  return new Map();
}

/**
 * Creates the set of keys that already got their one warning.
 *
 * @returns An empty set of asset keys.
 */
function emptyWarned(): Set<string> {
  return new Set();
}

/**
 * Creates the queue of sounds fired while the unlock is pending.
 *
 * @returns An empty queue, keyed by asset key.
 */
function emptyPending(): Map<string, SfxRequest> {
  return new Map();
}

/**
 * Creates one bus at its configured volume, unmuted and without a gain node.
 *
 * @param volume - The start volume of the bus, 0..1.
 * @returns The bus entry.
 * @example
 * ```ts
 * busState(0.6); // { gain: undefined, volume: 0.6, muted: false }
 * ```
 */
function busState(volume: number): BusState {
  return { gain: undefined, volume, muted: false };
}

/**
 * Creates the initial audio state: headless, silent, locked and with nothing decoded. `onStart`
 * puts the context and the gain nodes in.
 *
 * @param ctx - What the kernel hands a state factory.
 * @param ctx.config - The resolved plugin config, which carries the start volumes.
 * @returns A fresh state, owned by one app.
 */
export function createAudioState(ctx: { readonly config: Config }): State {
  const buses: Record<Bus, BusState> = {
    master: busState(ctx.config.buses.master),
    music: busState(ctx.config.buses.music),
    sfx: busState(ctx.config.buses.sfx)
  };
  const music: MusicTrack | undefined = undefined;

  return {
    context: undefined,
    buses,
    paused: false,
    unlocked: false,
    resuming: false,
    pendingSfx: emptyPending(),
    decoded: emptyCache(),
    warned: emptyWarned(),
    warnedVolumes: false,
    music,
    unlock: undefined,
    removers: []
  };
}
