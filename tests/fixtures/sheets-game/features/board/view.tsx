/**
 * @file The board: a full-screen root with a few cells and the button back to the ward.
 */
import { projection } from "../../kit";
import type { Player } from "../../state";
import { buttonAt, fullScreen } from "../ward/styles";

export const boardRoot = projection({
  name: "board.root",
  layer: "scene",
  from: (player: Player) => ({ gems: player.gems }),
  view: () => (
    <stack key="boardRoot" style={{ ...fullScreen, fill: 0x3b_2f_4a }}>
      <panel key="boardCellA" style={buttonAt(200, 500, 0x6a_5a_8a)} />
      <panel key="boardCellB" style={buttonAt(500, 500, 0x6a_5a_8a)} />
      <button key="boardWard" intent="ward" style={buttonAt(800, 1300, 0x4f_8d_5a)} />
    </stack>
  )
});
