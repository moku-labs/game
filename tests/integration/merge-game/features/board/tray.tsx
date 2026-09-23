/**
 * @file The board tray of the board screen (design p2, §6 B3): the wooden tray at its natural 970
 * units, in the flow right under the order strip. It is the slot that hosts the board
 * projections, so the cells, their glows, the selection ring, the sawmill with its clock and its
 * charges plate, the items and their check badges are drawn inside it, in its own units. It is
 * never scaled on its own: the viewport fits the whole column (`referenceLong`), so the tray, the
 * cards and the bars scale together.
 */
import { defineStyle } from "../../kit";
import { slot } from "../../view/layout";

/** The projections the tray draws inside itself. */
const boardProjections = [
  "board.cells",
  "board.glows",
  "board.selection",
  "board.generators",
  "board.clock",
  "board.badges",
  "board.items"
] as const;

/** The tray: square at its natural size, 24 units under the cards at the ends of the rope. */
const trayStyle = defineStyle({
  width: slot.size,
  height: slot.size,
  margin: { top: 24 },
  nineSlice: "board.board-tray"
});

/**
 * The board tray, the slot of the board projections.
 *
 * @returns The stack element of the tray.
 */
export function BoardTray() {
  return <stack key="boardSlot" hosts={boardProjections} style={trayStyle} />;
}
