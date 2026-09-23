/**
 * @file The look of the board screen around the board: the HUD row and the board area with its
 * slot. Styles are data, so the markup reads as structure and nothing else. The numbers are the
 * layout rules of design §5, in reference units.
 */
import { defineStyle } from "../../kit";
import { slot } from "../../view/layout";

/** How tall the HUD row is (design §5.3). The toast hangs a fixed distance under it. */
export const hudRowHeight = 144;

/** The HUD row: 40 units under the top safe edge, 144 tall, its four controls spread across. */
export const hudRow = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  alignSelf: "stretch",
  height: hudRowHeight,
  margin: { top: 40 },
  padding: { left: 24, right: 24 }
});

/** What is left between the order strip and the info bar: the board shrinks into it. */
export const boardArea = defineStyle({
  grow: 1,
  alignSelf: "stretch",
  align: "center",
  justify: "center",
  padding: 12
});

/**
 * The board slot: the wooden tray, square at its natural 970 units, scaled down to fit the board
 * area and never past its natural size. It hosts the cells, the selection ring, the generator
 * and the items.
 */
export const boardSlot = defineStyle({
  width: slot.size,
  height: slot.size,
  fit: "contain",
  nineSlice: "board.board-tray"
});
