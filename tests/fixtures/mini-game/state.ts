/**
 * @file The state of the mini game: what a save holds, what one session holds, and where a new
 * player and a new session start.
 */

/** The saved player: one counter, how many times the player said OK to the info popup. */
export type Player = { count: number };

/** The session: never saved. How many times the info popup opened in this run. */
export type Session = { opened: number };

/** The state of a new player. */
export const startingPlayer: Player = { count: 0 };

/** The session at every start. */
export const startingSession: Session = { opened: 0 };
