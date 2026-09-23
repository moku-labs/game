/**
 * @file The look of the HUD row of the board screen. Styles are data, so the markup reads as
 * structure and nothing else. The numbers are the layout rules of design §5, in reference units;
 * the tray under the order strip is the board feature's.
 */
import { defineStyle } from "../../kit";

/** How tall the HUD row is (design §5.3). The toast hangs a fixed distance under it. */
export const hudRowHeight = 144;

/**
 * The HUD row (design §6 B1, F4): 40 units under the top safe edge, 144 tall, the home button,
 * the two pills and the gear spread across it, 40 units in from each side.
 */
export const hudRow = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  alignSelf: "stretch",
  height: hudRowHeight,
  margin: { top: 40 },
  padding: { left: 40, right: 40 }
});
