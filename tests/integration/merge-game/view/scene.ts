/**
 * @file The board scene: the layers in draw order, the projections mounted into them and the
 * music that plays while it is on: `ui.theme`, the track of Home too, so it does not restart when
 * Play opens the board. The layer names are checked against the `layer` and `lift` of
 * every projection, here and by the compiler.
 *
 * The board screen is one `ui` root, and its slot hosts the cells, their glows, the selection
 * ring, the generator with its clock badge, the badges (the charges plate and the checks) and the
 * items, so they draw inside it whatever layer they name. `ui` is declared under `lifted`: an item in the
 * hand leaves the slot for the lifted layer and must draw over the whole screen, background
 * included. The layers `cells`, `glows` and `items` are where a view falls back to when no slot
 * hosts it.
 */
import { hudCoins } from "../features/hud/coins";
import { hud } from "../features/hud/view";
import { defineScene } from "../kit";
import { boardBadges } from "./badges";
import { boardClock } from "./clock";
import { boardCells, boardGenerators, boardGlows, boardItems, boardSelection } from "./projections";

export const boardScene = defineScene("board", {
  bundle: "board",
  music: "ui.theme",
  layers: {
    cells: {},
    glows: {},
    items: { sort: "y" },
    ui: { sort: "order" },
    lifted: {},
    fx: {}
  },
  projections: [
    boardCells,
    boardGlows,
    boardSelection,
    boardItems,
    boardGenerators,
    boardClock,
    boardBadges,
    hud,
    hudCoins
  ]
});
