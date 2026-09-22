/**
 * @file The board scene: the layers in draw order, the projections mounted into them and the
 * music that plays while it is on. The layer names are checked against the `layer` and `lift` of
 * every projection, here and by the compiler.
 */
import { hudCoins } from "../features/hud/coins";
import { hud } from "../features/hud/view";
import { defineScene } from "../kit";
import { boardCells, boardGenerators, boardItems } from "./projections";

export const boardScene = defineScene("board", {
  bundle: "board",
  music: "board.theme",
  // The `ui` layer is declared, not appended, because it sorts by `Order`: the coin counter is its
  // own projection and has to draw above the bar of the HUD, which is laid out after it.
  layers: {
    background: {},
    cells: {},
    items: { sort: "y" },
    lifted: {},
    fx: {},
    ui: { sort: "order" }
  },
  projections: [boardCells, boardItems, boardGenerators, hud, hudCoins]
});

/** The menu scene: nothing to draw yet, so the start of a session names a scene and warns no more. */
export const homeScene = defineScene("home", { bundle: "board", layers: {}, projections: [] });
