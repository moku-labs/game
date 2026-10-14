/**
 * @file The state of the episodes game: what a save holds, what one session holds, and where a
 * new player and a new session start.
 */

/**
 * An episode of the game: the name of its sub-feature under `features/episodes/`, which is also
 * the name of its bundle.
 *
 * @example
 * ```ts
 * const episode: Episode = "ep02";
 * ```
 */
export type Episode = "ep01" | "ep02";

/** The saved player: one counter, so the save has a shape. No node of the fixture changes it. */
export type Player = { visits: number };

/** The session: never saved, kept in a bookmark. The episode the ward shows. */
export type Session = { episode: Episode };

/** The state of a new player. */
export const startingPlayer: Player = { visits: 0 };

/** The session at every start. */
export const startingSession: Session = { episode: "ep01" };
