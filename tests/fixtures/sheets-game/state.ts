/**
 * @file The state of the sheets game: what a save holds, what one session holds, and where a new player and a new
 * session start.
 */

/** The saved player: the counters the HUD shows and the shop sells. */
export type Player = { level: number; energy: number; gems: number };

/** Which sheet lies over the scene: none, the shop, the case file or the inspection. */
export type Sheet = "none" | "shop" | "casefile" | "inspect";

/**
 * The session: never saved. The scene the player is in, the sheet over it, the settings over the shop, and whether
 * the inspection shows its page.
 */
export type Session = {
  at: "ward" | "board";
  sheet: Sheet;
  over: "none" | "settings";
  page: boolean;
};

/** The state of a new player. */
export const startingPlayer: Player = { level: 3, energy: 5, gems: 12 };

/** The session at every start: the ward, no sheet. */
export const startingSession: Session = { at: "ward", sheet: "none", over: "none", page: false };
