/**
 * @file The prepared save `?player=ready`: the popup was answered with OK three times, so the
 * counter of Home reads 3. An e2e script or a visual test starts here instead of tapping its way.
 */
import type { Scenario } from "@moku-labs/game/app";
import type { Player } from "../../state";

/** The counter reads 3. */
const ready: Scenario<Player> = () => ({ player: { count: 3 } });

export default ready;
