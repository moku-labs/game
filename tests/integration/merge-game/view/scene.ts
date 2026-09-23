/**
 * @file The board scene: the layers in draw order, the projections mounted into them and the
 * music that plays while it is on. The layer names are checked against the `layer` and `lift` of
 * every projection, here and by the compiler.
 *
 * The board screen is one `ui` root, and its slot hosts the cells, the selection ring, the
 * generator and the items, so they draw inside it whatever layer they name. `ui` is declared under `lifted`: an item in the
 * hand leaves the slot for the lifted layer and must draw over the whole screen, background
 * included. The layers `cells` and `items` are where a view falls back to when no slot hosts it.
 */
import { hudCoins } from "../features/hud/coins";
import { hud } from "../features/hud/view";
import { defineScene } from "../kit";
import { boardCells, boardGenerators, boardItems, boardSelection } from "./projections";

export const boardScene = defineScene("board", {
  bundle: "board",
  music: "board.theme",
  layers: {
    cells: {},
    items: { sort: "y" },
    ui: { sort: "order" },
    lifted: {},
    fx: {}
  },
  projections: [boardCells, boardSelection, boardItems, boardGenerators, hud, hudCoins]
});
