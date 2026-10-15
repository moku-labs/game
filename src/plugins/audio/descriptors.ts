/**
 * @file audio plugin — the authoring helper. Pure: it turns a key into frozen data, so a game
 * imports it from the package root and a node writes `await fx(music("board.theme"))`.
 */
import type { Descriptor } from "../flow/types";
import type { Json } from "../model/types";
import type { MusicDescriptor, MusicOptions, Volumes, VolumesFor } from "./types";

/**
 * Creates the awaited effect that switches the music track. The same key as the one playing does
 * nothing, and `null` fades the current track out. An absent `fadeMs` leaves the key out of the
 * payload, so the descriptor stays plain JSON and the plugin's `musicFadeMs` decides at play time.
 *
 * @param key - Asset key of an `.mp3`, or `null` to stop the music.
 * @param options - `fadeMs` overrides the configured cross-fade for this switch.
 * @returns The descriptor a node awaits, frozen.
 * @example
 * ```ts
 * // A node of a game: the menu goes quiet before the ending cinematic starts.
 * await fx(music(null, { fadeMs: 1500 }));
 * // music("board.theme") is { kind: "music", payload: { key: "board.theme" }, cosmetic: true }
 * ```
 */
export function music(key: string | null, options?: MusicOptions): Descriptor<void> {
  const fadeMs = options?.fadeMs;
  const payload = fadeMs === undefined ? { key } : { key, fadeMs };

  return Object.freeze({ kind: "music", payload: Object.freeze(payload), cosmetic: true });
}

/**
 * Typed `Volumes` of one game: the reader itself.
 *
 * @param read - Reads the volumes out of the game's player.
 * @returns The same function, typed as the plugin config takes it.
 */
function volumesOf<Player>(read: (player: Player) => ReturnType<Volumes>): Volumes {
  // The engine hands the committed player, which the game's types describe.
  return read as Volumes;
}

/**
 * Binds `music` to the audio asset keys of one game, and `volumes` to its player. Type-only: the
 * same function, and the reader returned as it is.
 *
 * @returns `{ music, volumes }`: the key is checked by the compiler, and the player is the game's.
 * @example
 * ```ts
 * const { music: themeOf } = audioFor<"board.theme">();
 * themeOf("board.theme").payload; // { key: "board.theme" }
 * audioFor<"board.theme", { settings: { music: number } }>().volumes(player => ({ music: player.settings.music }));
 * ```
 */
export function audioFor<Asset extends string, Player = Json>(): {
  music: MusicDescriptor<Asset>;
  volumes: VolumesFor<Player>;
} {
  return { music, volumes: volumesOf };
}
