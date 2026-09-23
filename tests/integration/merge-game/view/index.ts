/**
 * @file The screen half of the board feature: what the game brings to the screen plugins. The
 * logic half — the flows and the nodes — is composed through `flow.mainFlow` and does not change
 * because this feature exists. The look of the board under the pointer is `boardLookPlugin`, which
 * the game composes next to this feature.
 */
import { boardAssets } from "../features/board/assets";
import { toastBoardFull } from "../features/board/toast";
import { defineFeature } from "../kit";
import { lookAnimations, mergeBurst, refuseShake, sawmillTap } from "./animations";
import { boardBadges } from "./badges";
import { boardClock } from "./clock";
import { Generator, Glow, Highlighted, Item, SelectionRing } from "./components";
import { boardCells, boardGenerators, boardGlows, boardItems, boardSelection } from "./projections";
import { marchRing } from "./ring";
import { boardScene } from "./scene";
import { glowCells, highlightLegal } from "./systems";

/**
 * The board on the screen: one scene, its seven projections, three systems, five components, the
 * animations of the board, and the bundle that carries their pictures. A game composes it next to
 * `...screen`; a headless test leaves it out and the same graph plays on.
 *
 * The feature name shares its namespace with the flow ids, and "board" is already the sub-flow of
 * the board, so the screen half of the same feature is registered under its own name.
 */
export const boardView = defineFeature("boardScreen", {
  scenes: [boardScene],
  projections: [
    boardCells,
    boardGlows,
    boardSelection,
    boardItems,
    boardGenerators,
    boardClock,
    boardBadges
  ],
  systems: [highlightLegal, glowCells, marchRing],
  components: [Item, Highlighted, Generator, Glow, SelectionRing],
  animations: [
    toastBoardFull,
    mergeBurst,
    sawmillTap,
    refuseShake,
    lookAnimations.rest,
    lookAnimations.hover,
    lookAnimations.pressed
  ],
  assets: boardAssets
});
