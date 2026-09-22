/**
 * @file The board scene: the layers in draw order and the projections mounted into them. The
 * layer names are checked against the `layer` and `lift` of every projection, here and by the
 * compiler.
 */
import { defineScene } from "../kit";
import { boardCells, boardGenerators, boardItems } from "./projections";

export const boardScene = defineScene("board", {
  bundle: "board",
  layers: { background: {}, cells: {}, items: { sort: "y" }, lifted: {}, fx: {} },
  projections: [boardCells, boardItems, boardGenerators]
});

/** The menu scene: nothing to draw yet, so the start of a session names a scene and warns no more. */
export const homeScene = defineScene("home", { bundle: "board", layers: {}, projections: [] });
