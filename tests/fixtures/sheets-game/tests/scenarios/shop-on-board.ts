/**
 * @file The prepared start `?session=shop-on-board`: the player is on the board with the shop open over it. A test
 * starts here to see an overlay restored with its screen.
 */
import type { Scenario } from "@moku-labs/game/app";
import type { Player } from "../../state";

/** The board, the shop over it. */
const shopOnBoard: Scenario<Player> = () => ({
  player: { level: 3, energy: 5, gems: 12 }
});

export default shopOnBoard;
