/**
 * @file The screen half of the board feature: what the game brings to the screen plugins. The
 * logic half — the flows and the nodes — is composed through `flow.mainFlow` and does not change
 * because this feature exists.
 */
import { boardAssets } from "../features/board/assets";
import { toastBoardFull } from "../features/board/toast";
import { defineFeature } from "../kit";
import { mergeBurst, sawmillTap } from "./animations";
import { Highlighted, Item } from "./components";
import { boardCells, boardGenerators, boardItems, boardSelection } from "./projections";
import { boardScene } from "./scene";
import { highlightLegal } from "./systems";

/**
 * The board on the screen: one scene, four projections, one system, two components, the
 * animations of the board, and the bundle that carries their pictures. A game composes it next to `...screen`; a headless test
 * leaves it out and the same graph plays on.
 *
 * The feature name shares its namespace with the flow ids, and "board" is already the sub-flow of
 * the board, so the screen half of the same feature is registered under its own name.
 */
export const boardView = defineFeature("boardScreen", {
  scenes: [boardScene],
  projections: [boardCells, boardSelection, boardItems, boardGenerators],
  systems: [highlightLegal],
  components: [Item, Highlighted],
  animations: [toastBoardFull, mergeBurst, sawmillTap],
  assets: boardAssets
});
