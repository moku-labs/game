/**
 * @file The marching ring around the selected cell (design §6 F9): cream dashes with a thin ink
 * edge, drawn as a picture, because a `Shape` strokes a solid line. Four pictures of the same
 * ring hold the dashes a quarter of a dash period apart, and the `Frames` loop of the ring view
 * shows them in turn, so the dashes walk clockwise around the cell.
 */
import type { AssetKey } from "../generated/assets";
import { cellSize } from "./layout";

/**
 * The four dash phases, in the order they are shown. Each picture is the ring 300 px square:
 * 32 cream dashes of 22 px, 9 px thick, on a rounded square 8 px outside the cell.
 */
export const ringFrames = [
  "board.selection-ring-0",
  "board.selection-ring-1",
  "board.selection-ring-2",
  "board.selection-ring-3"
] as const satisfies readonly AssetKey[];

/** Edge of the ring picture: the cell and 14 units on every side, so the dashes lie in the gap. */
export const ringSize = cellSize + 28;

/** How many dash phases the ring shows per second: one every 250 ms. */
export const ringFps = 4;
