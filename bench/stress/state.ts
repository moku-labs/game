/**
 * @file The state of the stress bench. Nothing is saved; the session says which scene stands and where its walk is.
 * The scene and its size come from the address at load: `#album&sets=15`, `#scroll&sets=72`, `#popup`, `#board&items=63`, `#worst`.
 */

/** The scenes of the bench. */
export type StressScene = "album" | "scroll" | "popup" | "board" | "worst";

/** The saved player: nothing. */
export type Player = Record<string, never>;

/** The session: the scene, its size, and where the album, the popups and the board are. */
export type Session = {
  scene: StressScene;
  /** The sets of the album: 15 is the game's, 72 gives about 2 000 elements. */
  sets: number;
  /** The items of the board: 63 is the game's full field. */
  items: number;
  /** Whether the popup panel is frosted glass over a `Source`. */
  glass: boolean;
  /** The culling experiment of the page, `""` for none: see `plugins/stress/cull.ts`. */
  cull: string;
  /** Frames of one walk of the driver: 30 is two flips a second at 60 fps, 16 a fast finger. */
  cycle: number;
  /** The set page on show. */
  on: number;
  /** The second page of the strip, -1 for none, and its side. */
  beside: number;
  side: number;
  /** How many popups stand, 0 to 2. */
  popups: number;
  /** Merges done: each one takes two items off the board and brings one. */
  merges: number;
};

/**
 * A number of the address, or its default.
 *
 * @param hash - The address after `#`.
 * @param name - The token.
 * @param fallback - The value without it.
 * @returns The number.
 * @example
 * ```ts
 * numberOf("album&sets=40", "sets", 15); // 40
 * ```
 */
export function numberOf(hash: string, name: string, fallback: number): number {
  const found = new RegExp(String.raw`(?:^|&)${name}=(\d+)`).exec(hash);

  return found === null ? fallback : Number(found[1]);
}

/**
 * The session an address asks for.
 *
 * @param hash - The address after `#`.
 * @returns The session at the start.
 * @example
 * ```ts
 * sessionOf("album&sets=40").sets; // 40
 * ```
 */
export function sessionOf(hash: string): Session {
  const name = hash.split("&")[0] ?? "";
  const scene: StressScene =
    name === "scroll" || name === "popup" || name === "board" || name === "worst" ? name : "album";

  return {
    scene,
    sets: numberOf(hash, "sets", 15),
    items: numberOf(hash, "items", 63),
    glass: numberOf(hash, "glass", 0) === 1,
    cull: /(?:^|&)cull=([a-z]+)/.exec(hash)?.[1] ?? "",
    cycle: numberOf(hash, "cycle", 30),
    on: 0,
    beside: -1,
    side: 1,
    popups: 0,
    merges: 0
  };
}

export const startingPlayer: Player = {};

/** The session of this page: read from its address once, at load. */
export const startingSession: Session = sessionOf(
  typeof location === "undefined" ? "" : location.hash.slice(1)
);
