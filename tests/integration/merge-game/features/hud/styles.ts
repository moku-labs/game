/**
 * @file The look of the board screen around the board: the HUD row, the board area with its
 * slot, and the design tokens the reward popup and the settings still read until they move onto
 * the signboard. Styles are data, so the markup reads as structure and nothing else. The numbers
 * are the layout rules of design §5, in reference units.
 */
import { defineStyle, defineTokens } from "../../kit";
import { slot } from "../../view/layout";

/** The V3 table the reward popup and the settings are still drawn with. */
export const tokens = defineTokens({
  space: { xs: 8, sm: 16, md: 24 },
  color: { bar: 0x1b_22_30, card: 0x2a_33_42, accent: 0xc9_8b_2e, text: 0xff_e0_82 },
  radius: { card: 16 }
});

/** The HUD row: 40 units under the top safe edge, 144 tall, its four controls spread across. */
export const hudRow = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  alignSelf: "stretch",
  height: 144,
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
 * area and never past its natural size. It hosts the cells, the generator and the items.
 */
export const boardSlot = defineStyle({
  width: slot.size,
  height: slot.size,
  fit: "contain",
  nineSlice: "board.board-tray"
});
